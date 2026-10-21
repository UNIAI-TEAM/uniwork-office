import { describe, expect, it, vi } from 'vitest'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import type { UniworkShareClient } from '../src/main/uniwork-docs/share-client'
import {
  createUniworkShareService,
  shareErrorOf,
  type UniworkShareServiceDeps,
} from '../src/main/uniwork-docs/share-service'
import type {
  ShareAccess,
  ShareBulkPlan,
  ShareLinkCreated,
  ShareUpdate,
} from '../src/shared/share-api'

/**
 * UNI-2047 SD-A: the service layer between IPC and the client: auth / org
 * resolution, the error mapping of the contract (section 3), and the bulk helper
 * that shares documents one after another like the web's hooks-bulk-share.
 */

const UPDATE: ShareUpdate = {
  batchId: 'b',
  dryRun: false,
  results: [{ index: 0, status: 'granted' }],
  preview: { users: [], groups: [], warnings: [] },
}
const ACCESS: ShareAccess = { myLevel: 'manage', adminScope: false, via: 'member', links: [] }
const CREATED: ShareLinkCreated = {
  link: {
    id: 'ln_new',
    expiresAt: null,
    viewCount: 0,
    createdBy: '',
    createdByKind: 'human',
    createdAt: '',
  },
  token: 't',
  url: 'https://uniwork.example/p/t',
}

function fakeClient(over: Partial<UniworkShareClient> = {}): UniworkShareClient {
  return {
    getDocumentShares: vi.fn(async () => ACCESS),
    updateDocumentAccess: vi.fn(async () => UPDATE),
    listShareCandidates: vi.fn(async () => ({ items: [], nextCursor: '' })),
    createDocumentLink: vi.fn(async () => CREATED),
    revokeDocumentLink: vi.fn(async () => undefined),
    getDocumentSettings: vi.fn(async (orgId: string) => ({
      organizationId: orgId,
      publicLinksEnabled: true,
    })),
    listAccessRequests: vi.fn(async () => []),
    approveAccessRequest: vi.fn(async () => ({ id: 'rq', status: 'approved', shareId: 's' })),
    declineAccessRequest: vi.fn(async () => ({ id: 'rq', status: 'declined', shareId: '' })),
    ...over,
  }
}

function service(client: UniworkShareClient, over: Partial<UniworkShareServiceDeps> = {}) {
  return createUniworkShareService({
    client: () => client,
    isSignedIn: () => true,
    selectedOrgId: () => 'org_1',
    wait: async () => undefined,
    ...over,
  })
}

describe('shareErrorOf: the contract error mapping', () => {
  const at = (
    code: ConstructorParameters<typeof UniworkDocError>[0],
    serverCode?: string,
    status?: number,
  ) =>
    new UniworkDocError(code, {
      ...(serverCode ? { serverCode } : {}),
      ...(status ? { status } : {}),
    })

  it('keeps the server verdicts by their own names', () => {
    for (const code of [
      'document_link_limit',
      'document_links_disabled',
      'document_shelved',
      'my_folder_locked',
      'folder_not_shareable',
      'break_glass_required',
      'access_request_closed',
    ] as const) {
      expect(shareErrorOf(at('server_error', code, 409)).error).toBe(code)
    }
  })

  it('document_access_rejected carries the rejected items and the status', () => {
    const error = new UniworkDocError('server_error', {
      serverCode: 'document_access_rejected',
      status: 422,
      rejected: [{ index: 1, principalType: 'user', principalId: 'u', code: 'level_not_allowed' }],
    })
    expect(shareErrorOf(error)).toEqual({
      ok: false,
      error: 'document_access_rejected',
      status: 422,
      rejected: [{ index: 1, principalType: 'user', principalId: 'u', code: 'level_not_allowed' }],
    })
  })

  it('permission answers are forbidden, missing documents not_found (403/404)', () => {
    expect(shareErrorOf(at('forbidden', undefined, 403)).error).toBe('forbidden')
    expect(shareErrorOf(at('permission_revoked', 'forbidden', 403)).error).toBe('forbidden')
    expect(shareErrorOf(at('member_deactivated')).error).toBe('forbidden')
    expect(shareErrorOf(at('organization_suspended')).error).toBe('forbidden')
    expect(shareErrorOf(at('not_found', undefined, 404)).error).toBe('not_found')
    expect(shareErrorOf(at('deleted', undefined, 410)).error).toBe('not_found')
    expect(shareErrorOf(at('document_deleted')).error).toBe('not_found')
    expect(shareErrorOf(at('document_archived')).error).toBe('document_archived')
  })

  it('the transport failures keep the app codes', () => {
    for (const code of [
      'not_signed_in',
      'session_expired',
      'wrong_deployment',
      'network',
      'timeout',
      'malformed_response',
    ] as const) {
      expect(shareErrorOf(at(code)).error).toBe(code)
    }
    expect(shareErrorOf(at('server_error', undefined, 500)).error).toBe('server_error')
  })

  it('a client-side refusal is invalid_request; a throttle is retryable', () => {
    expect(shareErrorOf(at('server_error', 'invalid_input')).error).toBe('invalid_request')
    const throttled = shareErrorOf(at('server_error', 'rate_limited', 429))
    expect(throttled).toMatchObject({
      ok: false,
      error: 'server_error',
      retryable: true,
      status: 429,
    })
    expect(shareErrorOf(at('server_error', undefined, 503))).toMatchObject({ retryable: true })
  })

  it('anything that is not a UniworkDocError is server_error', () => {
    expect(shareErrorOf(new Error('boom'))).toEqual({ ok: false, error: 'server_error' })
    expect(shareErrorOf('x')).toEqual({ ok: false, error: 'server_error' })
  })
})

describe('the service answers every call with a result', () => {
  it('get / update / candidates / links / requests resolve ok with the client value', async () => {
    const client = fakeClient()
    const s = service(client)
    expect(await s.get('doc_1')).toEqual({ ok: true, value: ACCESS })
    expect(
      await s.update({
        documentId: 'doc_1',
        items: [{ principalType: 'user', principalId: 'u', level: 'view' }],
        dryRun: true,
      }),
    ).toEqual({ ok: true, value: UPDATE })
    expect(client.updateDocumentAccess).toHaveBeenCalledWith('doc_1', {
      items: [{ principalType: 'user', principalId: 'u', level: 'view' }],
      dryRun: true,
    })
    await s.candidates({ documentId: 'doc_1', q: 'mi', cursor: 'c', limit: 10 })
    expect(client.listShareCandidates).toHaveBeenCalledWith('doc_1', {
      q: 'mi',
      cursor: 'c',
      limit: 10,
    })
    expect(await s.linkCreate({ documentId: 'doc_1', expiresInDays: 7 })).toEqual({
      ok: true,
      value: CREATED,
    })
    expect(client.createDocumentLink).toHaveBeenCalledWith('doc_1', 7)
    expect(await s.linkRevoke({ documentId: 'doc_1', linkId: 'ln_1' })).toEqual({
      ok: true,
      value: { documentId: 'doc_1', linkId: 'ln_1' },
    })
    expect(await s.requests('doc_1')).toEqual({ ok: true, value: [] })
    await s.requestApprove({ documentId: 'doc_1', requestId: 'rq', level: 'edit' })
    expect(client.approveAccessRequest).toHaveBeenCalledWith('doc_1', 'rq', 'edit')
    await s.requestDecline({ documentId: 'doc_1', requestId: 'rq' })
    expect(client.declineAccessRequest).toHaveBeenCalledWith('doc_1', 'rq')
  })

  it('settings reads the selected organization; none selected is not_found', async () => {
    const client = fakeClient()
    expect(await service(client).settings()).toEqual({
      ok: true,
      value: { organizationId: 'org_1', publicLinksEnabled: true },
    })
    expect(client.getDocumentSettings).toHaveBeenCalledWith('org_1')
    const none = service(fakeClient(), { selectedOrgId: () => null })
    expect(await none.settings()).toEqual({ ok: false, error: 'not_found' })
  })

  it('signed out: every call is not_signed_in, the client is never built', async () => {
    const build = vi.fn(() => fakeClient())
    const s = service(fakeClient(), { client: build, isSignedIn: () => false })
    expect(await s.get('doc_1')).toEqual({ ok: false, error: 'not_signed_in' })
    expect(await s.settings()).toEqual({ ok: false, error: 'not_signed_in' })
    expect(
      await s.bulk({ docs: [], people: [], onExisting: 'keep', workspace: 'keep', link: 'keep' }),
    ).toEqual({
      ok: false,
      error: 'not_signed_in',
    })
    expect(build).not.toHaveBeenCalled()
  })

  it('a thrown UniworkDocError becomes the mapped failure, never a rejection', async () => {
    const s = service(
      fakeClient({
        getDocumentShares: async () => {
          throw new UniworkDocError('server_error', { serverCode: 'document_shelved', status: 409 })
        },
      }),
    )
    expect(await s.get('doc_1')).toEqual({ ok: false, error: 'document_shelved', status: 409 })
  })

  it('rejects input of the wrong shape as invalid_request without calling the client', async () => {
    const client = fakeClient()
    const s = service(client)
    expect(await s.get(undefined as never)).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(await s.update(null as never)).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(await s.update({ documentId: 'd', items: 'x' } as never)).toMatchObject({
      ok: false,
      error: 'invalid_request',
    })
    expect(await s.linkRevoke({ documentId: 'd' } as never)).toMatchObject({
      ok: false,
      error: 'invalid_request',
    })
    expect(await s.bulk(null as never)).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(client.getDocumentShares).not.toHaveBeenCalled()
    expect(client.updateDocumentAccess).not.toHaveBeenCalled()
  })
})

describe('bulk: per document, one after another', () => {
  const plan = (over: Partial<ShareBulkPlan> = {}): ShareBulkPlan => ({
    docs: [
      { id: 'd1', workspaceId: 'ws_a' },
      { id: 'd2', workspaceId: 'ws_b' },
    ],
    people: [{ principalType: 'user', principalId: 'u_2', level: 'edit' }],
    onExisting: 'keep',
    workspace: 'keep',
    link: 'keep',
    ...over,
  })

  it('updates access then creates a link for each document, in order, never in parallel', async () => {
    const log: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    const track = async <T>(label: string, value: T): Promise<T> => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      log.push(`start ${label}`)
      await new Promise((r) => setTimeout(r, 1))
      log.push(`end ${label}`)
      inFlight -= 1
      return value
    }
    const client = fakeClient({
      updateDocumentAccess: vi.fn(async (id: string) => track(`access ${id}`, UPDATE)),
      createDocumentLink: vi.fn(async (id: string) =>
        track(`link ${id}`, { ...CREATED, url: `https://uniwork.example/p/${id}` }),
      ),
    })
    const res = await service(client).bulk(plan({ link: 'create', expiresInDays: 14 }))
    expect(res).toEqual({
      ok: true,
      value: {
        ok: ['d1', 'd2'],
        failed: [],
        links: [
          { id: 'd1', url: 'https://uniwork.example/p/d1' },
          { id: 'd2', url: 'https://uniwork.example/p/d2' },
        ],
      },
    })
    expect(maxInFlight).toBe(1)
    expect(log.filter((l) => l.startsWith('start'))).toEqual([
      'start access d1',
      'start link d1',
      'start access d2',
      'start link d2',
    ])
    expect(client.createDocumentLink).toHaveBeenCalledWith('d1', 14)
  })

  it('builds the items like the web: the same people with on_existing, plus the home workspace row', async () => {
    const client = fakeClient()
    await service(client).bulk(plan({ workspace: 'comment', onExisting: 'update' }))
    expect(client.updateDocumentAccess).toHaveBeenNthCalledWith(1, 'd1', {
      items: [
        { principalType: 'user', principalId: 'u_2', level: 'edit', onExisting: 'update' },
        { principalType: 'workspace', principalId: 'ws_a', level: 'comment', onExisting: 'update' },
      ],
      dryRun: false,
    })
    expect(client.updateDocumentAccess).toHaveBeenNthCalledWith(2, 'd2', {
      items: [
        { principalType: 'user', principalId: 'u_2', level: 'edit', onExisting: 'update' },
        { principalType: 'workspace', principalId: 'ws_b', level: 'comment', onExisting: 'update' },
      ],
      dryRun: false,
    })
  })

  it('workspace none removes the row (level null); keep with no people sends no access call', async () => {
    const client = fakeClient()
    await service(client).bulk(plan({ workspace: 'none', people: [] }))
    expect(client.updateDocumentAccess).toHaveBeenCalledWith('d1', {
      items: [{ principalType: 'workspace', principalId: 'ws_a', level: null }],
      dryRun: false,
    })
    const quiet = fakeClient()
    await service(quiet).bulk(plan({ people: [], workspace: 'keep', link: 'keep' }))
    expect(quiet.updateDocumentAccess).not.toHaveBeenCalled()
    expect(quiet.createDocumentLink).not.toHaveBeenCalled()
  })

  it('link revoke reads the document and revokes each of its live links', async () => {
    const client = fakeClient({
      getDocumentShares: vi.fn(async () => ({
        ...ACCESS,
        links: [
          {
            id: 'ln_a',
            expiresAt: null,
            viewCount: 0,
            createdBy: '',
            createdByKind: 'human',
            createdAt: '',
          },
          {
            id: 'ln_b',
            expiresAt: null,
            viewCount: 0,
            createdBy: '',
            createdByKind: 'human',
            createdAt: '',
          },
        ],
      })),
    })
    const res = await service(client).bulk(
      plan({ docs: [{ id: 'd1', workspaceId: 'ws_a' }], link: 'revoke', people: [] }),
    )
    expect(res).toMatchObject({ ok: true, value: { ok: ['d1'], failed: [], links: [] } })
    expect(client.revokeDocumentLink).toHaveBeenNthCalledWith(1, 'd1', 'ln_a')
    expect(client.revokeDocumentLink).toHaveBeenNthCalledWith(2, 'd1', 'ln_b')
  })

  it('one refusal never stops the batch: it lands in failed with its mapped code and rejected items', async () => {
    const client = fakeClient({
      updateDocumentAccess: vi.fn(async (id: string) => {
        if (id === 'd1') {
          throw new UniworkDocError('server_error', {
            serverCode: 'document_access_rejected',
            status: 422,
            rejected: [
              { index: 0, principalType: 'user', principalId: 'u_2', code: 'level_not_allowed' },
            ],
          })
        }
        if (id === 'd2') throw new UniworkDocError('forbidden', { status: 403 })
        return UPDATE
      }),
    })
    const res = await service(client).bulk(
      plan({
        docs: [
          { id: 'd1', workspaceId: 'ws_a' },
          { id: 'd2', workspaceId: 'ws_b' },
          { id: 'd3', workspaceId: 'ws_c' },
        ],
      }),
    )
    expect(res).toEqual({
      ok: true,
      value: {
        ok: ['d3'],
        failed: [
          {
            id: 'd1',
            error: 'document_access_rejected',
            rejected: [
              { index: 0, principalType: 'user', principalId: 'u_2', code: 'level_not_allowed' },
            ],
          },
          { id: 'd2', error: 'forbidden' },
        ],
        links: [],
      },
    })
  })

  it('a failed access update does not create the document its link', async () => {
    const client = fakeClient({
      updateDocumentAccess: vi.fn(async () => {
        throw new UniworkDocError('forbidden', { status: 403 })
      }),
    })
    await service(client).bulk(plan({ link: 'create' }))
    expect(client.createDocumentLink).not.toHaveBeenCalled()
  })

  it('retries a throttled call once after the wait, then gives up with the mapped code', async () => {
    const wait = vi.fn(async () => undefined)
    let tries = 0
    const client = fakeClient({
      updateDocumentAccess: vi.fn(async (id: string) => {
        if (id === 'd1') {
          tries += 1
          if (tries === 1) {
            throw new UniworkDocError('server_error', {
              serverCode: 'rate_limited',
              status: 429,
              retryAfterMs: 2500,
            })
          }
        }
        if (id === 'd2')
          throw new UniworkDocError('server_error', { status: 429, retryAfterMs: 50_000 })
        return UPDATE
      }),
    })
    const res = await service(client, { wait }).bulk(plan())
    expect(res).toMatchObject({
      ok: true,
      value: { ok: ['d1'], failed: [{ id: 'd2', error: 'server_error', retryable: true }] },
    })
    expect(wait).toHaveBeenNthCalledWith(1, 2500)
    // the wait is capped, and a second throttle ends that document
    expect(wait).toHaveBeenNthCalledWith(2, 5000)
    expect(client.updateDocumentAccess).toHaveBeenCalledTimes(3 + 1)
  })

  it('shares each document once even when an id repeats', async () => {
    const client = fakeClient()
    await service(client).bulk(
      plan({
        docs: [
          { id: 'd1', workspaceId: 'ws_a' },
          { id: 'd1', workspaceId: 'ws_a' },
        ],
      }),
    )
    expect(client.updateDocumentAccess).toHaveBeenCalledTimes(1)
  })

  it('a create answer without a url is a failure for that document, not a silent success', async () => {
    const client = fakeClient({
      createDocumentLink: vi.fn(async () => ({ ...CREATED, url: '' })),
    })
    const res = await service(client).bulk(
      plan({ link: 'create', docs: [{ id: 'd1', workspaceId: 'ws_a' }] }),
    )
    expect(res).toMatchObject({
      ok: true,
      value: { ok: [], failed: [{ id: 'd1', error: 'malformed_response' }], links: [] },
    })
  })
})
