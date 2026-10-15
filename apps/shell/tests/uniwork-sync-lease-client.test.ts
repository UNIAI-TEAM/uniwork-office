import { describe, expect, it } from 'vitest'
import { TransportError } from '../src/main/uniwork-auth/transport'
import {
  LeaseClientError,
  createLeaseClient,
  parseLeaseError,
  parseLeaseSDO,
  type OfficeOfflineLeaseSDO,
} from '../src/main/uniwork-sync/lease/client'

const SAMPLE_SDO: OfficeOfflineLeaseSDO = {
  lease: 'ofl1.eyJ2IjoxfQ.c2lnbmF0dXJl',
  lease_id: '01J8X4LEASE1P2Q3R4S5T6U7V8',
  document_id: 'doc_1',
  organization_id: 'org_1',
  workspace_id: 'ws_1',
  version_id: 'ver_3',
  version: 3,
  revision: '9007199254740995',
  level: 'edit',
  policy_epoch: 0,
  generation: 1,
  renewed: false,
  issued_at: '2026-10-13T08:00:00Z',
  expires_at: '2026-10-14T08:00:00Z',
  renew_after: '2026-10-13T20:00:00Z',
  server_time: '2026-10-13T08:00:00Z',
}

describe('uniwork-sync lease client (G5-08c)', () => {
  it('PUT grant sends empty body, PUT renew sends {"lease": "<previous signed lease>"}, DELETE releases, and parses SDO', async () => {
    const calls: Array<{
      url: string
      method: string
      body: string | undefined
      auth: string | null
    }> = []

    const client = createLeaseClient({
      apiOrigin: 'https://uniwork.example',
      isSignedIn: () => true,
      authorized: (call) => call('token-123'),
      fetch: async (url, init) => {
        const headers = new Headers(init.headers)
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? init.body : undefined,
          auth: headers.get('Authorization'),
        })
        if (init.method === 'DELETE') {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
        }
        const renewed = typeof init.body === 'string' && init.body.includes('"lease"')
        return new Response(
          JSON.stringify({
            ...SAMPLE_SDO,
            generation: renewed ? 2 : 1,
            renewed,
          }),
          { status: 200 },
        )
      },
    })

    const granted = await client.grant('doc_1')
    expect(granted.lease_id).toBe('01J8X4LEASE1P2Q3R4S5T6U7V8')
    expect(granted.generation).toBe(1)
    expect(granted.renewed).toBe(false)
    expect(granted.revision).toBe('9007199254740995')
    expect(calls[0]).toEqual({
      url: 'https://uniwork.example/api/v1/documents/doc_1/office/offline-lease',
      method: 'PUT',
      body: undefined,
      auth: 'Bearer token-123',
    })

    const renewed = await client.renew('doc_1', SAMPLE_SDO.lease)
    expect(renewed.generation).toBe(2)
    expect(renewed.renewed).toBe(true)
    expect(calls[1]).toEqual({
      url: 'https://uniwork.example/api/v1/documents/doc_1/office/offline-lease',
      method: 'PUT',
      body: JSON.stringify({ lease: SAMPLE_SDO.lease }),
      auth: 'Bearer token-123',
    })

    await client.release('doc_1')
    expect(calls[2]).toEqual({
      url: 'https://uniwork.example/api/v1/documents/doc_1/office/offline-lease',
      method: 'DELETE',
      body: undefined,
      auth: 'Bearer token-123',
    })
  })

  it('maps contract-p0 errors: offline_lease_revoked, offline_lease_device_required, offline_lease_limit_reached, document_archived, office_capability_off, 401 session, network/offline', async () => {
    expect(
      parseLeaseError(403, { error: { code: 'offline_lease_revoked', error_class: 'permission' } }),
    ).toEqual({
      kind: 'revoked',
      code: 'offline_lease_revoked',
      status: 403,
    })

    expect(parseLeaseError(403, { error: { code: 'offline_lease_device_required' } })).toEqual({
      kind: 'device_required',
      code: 'offline_lease_device_required',
      status: 403,
    })

    expect(
      parseLeaseError(409, {
        error: { code: 'offline_lease_limit_reached', fields: { limit: 200 } },
      }),
    ).toEqual({
      kind: 'limit_reached',
      code: 'offline_lease_limit_reached',
      status: 409,
      limit: 200,
    })

    expect(parseLeaseError(403, { error: { code: 'document_archived' } })).toEqual({
      kind: 'archived',
      code: 'document_archived',
      status: 403,
    })

    expect(
      parseLeaseError(403, {
        error: { code: 'office_capability_off', fields: { capability: 'offline_library' } },
      }),
    ).toEqual({
      kind: 'capability_off',
      code: 'office_capability_off',
      status: 403,
      capability: 'offline_library',
    })

    expect(parseLeaseError(401, { error: { code: 'unauthorized' } })).toEqual({
      kind: 'session_expired',
      code: 'session_expired',
      status: 401,
    })

    // Transport 401 after refresh retry -> session_expired
    const unauthorizedClient = createLeaseClient({
      apiOrigin: 'https://uniwork.example',
      isSignedIn: () => true,
      authorized: async () => {
        throw new TransportError('unauthorized', 401)
      },
    })
    await expect(unauthorizedClient.grant('doc_1')).rejects.toMatchObject({
      name: 'LeaseClientError',
      kind: 'session_expired',
    })

    // Network rejection -> offline
    const offlineClient = createLeaseClient({
      apiOrigin: 'https://uniwork.example',
      isSignedIn: () => true,
      authorized: (call) => call('token'),
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
    })
    await expect(offlineClient.renew('doc_1', 'ofl1.token')).rejects.toMatchObject({
      name: 'LeaseClientError',
      kind: 'offline',
    })
  })

  it('refuses malformed SDO responses', () => {
    expect(() => parseLeaseSDO('{not json')).toThrow(LeaseClientError)
    expect(() => parseLeaseSDO({ ...SAMPLE_SDO, lease: '' })).toThrow(LeaseClientError)
    expect(() => parseLeaseSDO({ ...SAMPLE_SDO, level: 'owner' })).toThrow(LeaseClientError)
    expect(() => parseLeaseSDO({ ...SAMPLE_SDO, revision: 'abc' })).toThrow(LeaseClientError)
    expect(() => parseLeaseSDO({ ...SAMPLE_SDO, expires_at: 'bad-date' })).toThrow(LeaseClientError)
    expect(() => parseLeaseSDO({ ...SAMPLE_SDO, server_time: 'bad-date' })).toThrow(
      LeaseClientError,
    )
  })

  it('R1BE-9: a numeric revision is kept as its exact decimal string, small or above 2^53', () => {
    const body = (revision: string) =>
      JSON.stringify({ ...SAMPLE_SDO, revision: 0 }).replace(
        '"revision":0',
        `"revision":${revision}`,
      )
    expect(parseLeaseSDO(body('42')).revision).toBe('42')
    expect(parseLeaseSDO(body('9007199254740995')).revision).toBe('9007199254740995')
    expect(parseLeaseSDO(body('9223372036854775807')).revision).toBe('9223372036854775807')
    // a string revision stays as sent
    expect(parseLeaseSDO(JSON.stringify(SAMPLE_SDO)).revision).toBe('9007199254740995')
  })
})
