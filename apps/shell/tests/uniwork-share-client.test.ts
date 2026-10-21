import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { createUniworkShareClient } from '../src/main/uniwork-docs/share-client'

/**
 * UNI-2047 SD-A: the share client talks to the same routes as the web, with the
 * same bodies: paths, methods and JSON bodies are pinned here, and the server's
 * own refusals reach the caller with the code (and, for `document_access_rejected`,
 * the per-item list).
 */

const ORIGIN = 'https://uniwork.example'
const API = `${ORIGIN}/api/v1`
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string, fields?: Record<string, unknown>) =>
  json(status, { error: { code, message: 'x', ...(fields ? { fields } : {}) } })

interface Seen {
  url: string
  method: string
  body: unknown
  headers: Record<string, string>
}

function setup(answer: (seen: Seen) => Response) {
  const seen: Seen[] = []
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    const entry: Seen = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    }
    seen.push(entry)
    return answer(entry)
  })
  const client = createUniworkShareClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch,
  })
  return { client, seen }
}

async function failure(promise: Promise<unknown>): Promise<UniworkDocError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(UniworkDocError)
    return error as UniworkDocError
  }
  throw new Error('expected a failure')
}

const ACCESS = { my_level: 'manage', shares: [], links: [] }

describe('getDocumentShares', () => {
  it('GETs /documents/{id}/shares with the bearer and no body', async () => {
    const { client, seen } = setup(() => json(200, ACCESS))
    const access = await client.getDocumentShares('doc_1')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ url: `${API}/documents/doc_1/shares`, method: 'GET' })
    expect(seen[0]!.body).toBeUndefined()
    expect(seen[0]!.headers.Authorization).toBe('Bearer tok')
    expect(access.myLevel).toBe('manage')
  })

  it('refuses an id that is not an id before any request', async () => {
    const { client, seen } = setup(() => json(200, ACCESS))
    expect((await failure(client.getDocumentShares('../x'))).code).toBe('not_found')
    expect(seen).toHaveLength(0)
  })

  it('a malformed answer is malformed_response', async () => {
    const { client } = setup(() => json(200, { shares: [] }))
    expect((await failure(client.getDocumentShares('doc_1'))).code).toBe('malformed_response')
  })
})

describe('updateDocumentAccess', () => {
  const ok = { batch_id: 'b', results: [{ index: 0, status: 'granted' }] }

  it('PUTs /documents/{id}/access with snake_case items, level null kept (a revoke)', async () => {
    const { client, seen } = setup(() => json(200, ok))
    await client.updateDocumentAccess('doc_1', {
      items: [
        { principalType: 'user', principalId: 'u_2', level: 'edit', onExisting: 'update' },
        { principalType: 'workspace', principalId: 'ws_1', level: null },
      ],
    })
    expect(seen[0]).toMatchObject({ url: `${API}/documents/doc_1/access`, method: 'PUT' })
    expect(seen[0]!.headers['Content-Type']).toBe('application/json')
    expect(seen[0]!.body).toEqual({
      items: [
        { principal_type: 'user', principal_id: 'u_2', level: 'edit', on_existing: 'update' },
        { principal_type: 'workspace', principal_id: 'ws_1', level: null },
      ],
    })
  })

  it('sends dry_run exactly as asked (true for a preview, false for an explicit write)', async () => {
    const { client, seen } = setup(() => json(200, { ...ok, dry_run: true }))
    await client.updateDocumentAccess('doc_1', {
      items: [{ principalType: 'user', principalId: 'u_2', level: 'view' }],
      dryRun: true,
    })
    await client.updateDocumentAccess('doc_1', {
      items: [{ principalType: 'user', principalId: 'u_2', level: 'view' }],
      dryRun: false,
    })
    expect((seen[0]!.body as { dry_run?: boolean }).dry_run).toBe(true)
    expect((seen[1]!.body as { dry_run?: boolean }).dry_run).toBe(false)
  })

  it('refuses an empty list, an unknown level / principal type / on_existing before any request', async () => {
    const { client, seen } = setup(() => json(200, ok))
    const item = { principalType: 'user' as const, principalId: 'u_2', level: 'view' as const }
    for (const items of [
      [],
      [{ ...item, level: 'owner' as never }],
      [{ ...item, principalType: 'team' as never }],
      [{ ...item, onExisting: 'replace' as never }],
      [{ ...item, principalId: '' }],
    ]) {
      const error = await failure(client.updateDocumentAccess('doc_1', { items }))
      expect(error.serverCode).toBe('invalid_input')
    }
    expect(seen).toHaveLength(0)
  })

  it('keeps the per-item list of document_access_rejected', async () => {
    const { client } = setup(() =>
      envelope(422, 'document_access_rejected', {
        rejected: [
          {
            index: 0,
            principal_type: 'user',
            principal_id: 'u_2',
            code: 'principal_not_in_organization',
          },
        ],
      }),
    )
    const error = await failure(
      client.updateDocumentAccess('doc_1', {
        items: [{ principalType: 'user', principalId: 'u_2', level: 'view' }],
      }),
    )
    expect(error.serverCode).toBe('document_access_rejected')
    expect(error.status).toBe(422)
    expect(error.rejected).toEqual([
      {
        index: 0,
        principalType: 'user',
        principalId: 'u_2',
        code: 'principal_not_in_organization',
      },
    ])
  })
})

describe('listShareCandidates', () => {
  it('GETs /share-candidates with the trimmed q, cursor and limit; nothing when unset', async () => {
    const { client, seen } = setup(() => json(200, { items: [], next_cursor: '' }))
    await client.listShareCandidates('doc_1')
    await client.listShareCandidates('doc_1', { q: '  minh ', cursor: 'c1', limit: 20 })
    await client.listShareCandidates('doc_1', { q: '   ' })
    expect(seen.map((s) => s.url)).toEqual([
      `${API}/documents/doc_1/share-candidates`,
      `${API}/documents/doc_1/share-candidates?q=minh&cursor=c1&limit=20`,
      `${API}/documents/doc_1/share-candidates`,
    ])
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
  })

  it('caps the limit at 100', async () => {
    const { client, seen } = setup(() => json(200, { items: [] }))
    await client.listShareCandidates('doc_1', { limit: 5000 })
    expect(seen[0]!.url).toBe(`${API}/documents/doc_1/share-candidates?limit=100`)
  })
})

describe('links', () => {
  const created = { link: { id: 'ln_1' }, token: 't', url: 'https://uniwork.example/p/t' }

  it('POSTs /links with an empty body by default, expires_in_days when given', async () => {
    const { client, seen } = setup(() => json(201, created))
    await client.createDocumentLink('doc_1')
    await client.createDocumentLink('doc_1', 7)
    expect(seen[0]).toMatchObject({ url: `${API}/documents/doc_1/links`, method: 'POST', body: {} })
    expect(seen[1]!.body).toEqual({ expires_in_days: 7 })
  })

  it('refuses an expiry outside 1-90 whole days before any request', async () => {
    const { client, seen } = setup(() => json(201, created))
    for (const days of [0, 91, 1.5, -3, Number.NaN]) {
      expect((await failure(client.createDocumentLink('doc_1', days))).serverCode).toBe(
        'invalid_input',
      )
    }
    expect(seen).toHaveLength(0)
  })

  it('DELETEs /links/{linkId} and resolves with nothing', async () => {
    const { client, seen } = setup(() => new Response(null, { status: 204 }))
    await expect(client.revokeDocumentLink('doc_1', 'ln_1')).resolves.toBeUndefined()
    expect(seen[0]).toMatchObject({ url: `${API}/documents/doc_1/links/ln_1`, method: 'DELETE' })
  })

  it('a refused link carries the server code (limit / disabled)', async () => {
    const limit = setup(() => envelope(409, 'document_link_limit'))
    expect((await failure(limit.client.createDocumentLink('doc_1'))).serverCode).toBe(
      'document_link_limit',
    )
    const off = setup(() => envelope(403, 'document_links_disabled'))
    expect((await failure(off.client.createDocumentLink('doc_1'))).serverCode).toBe(
      'document_links_disabled',
    )
  })
})

describe('getDocumentSettings', () => {
  it('GETs /orgs/{orgId}/documents/settings', async () => {
    const { client, seen } = setup(() =>
      json(200, { organization_id: 'org_1', public_links_enabled: false }),
    )
    const settings = await client.getDocumentSettings('org_1')
    expect(seen[0]).toMatchObject({ url: `${API}/orgs/org_1/documents/settings`, method: 'GET' })
    expect(settings).toEqual({ organizationId: 'org_1', publicLinksEnabled: false })
  })
})

describe('access requests', () => {
  it('lists, approves (with and without a level) and declines', async () => {
    const { client, seen } = setup((s) =>
      s.method === 'GET'
        ? json(200, { requests: [{ id: 'rq_1', requester_id: 'u_5' }] })
        : json(200, { id: 'rq_1', status: 'ok', share_id: 'sh_1' }),
    )
    const rows = await client.listAccessRequests('doc_1')
    await client.approveAccessRequest('doc_1', 'rq_1')
    await client.approveAccessRequest('doc_1', 'rq_1', 'comment')
    await client.declineAccessRequest('doc_1', 'rq_1')
    expect(rows).toHaveLength(1)
    expect(seen.map((s) => `${s.method} ${s.url.slice(API.length)}`)).toEqual([
      'GET /documents/doc_1/access-requests',
      'POST /documents/doc_1/access-requests/rq_1/approve',
      'POST /documents/doc_1/access-requests/rq_1/approve',
      'POST /documents/doc_1/access-requests/rq_1/decline',
    ])
    expect(seen[1]!.body).toEqual({})
    expect(seen[2]!.body).toEqual({ level: 'comment' })
    expect(seen[3]!.body).toBeUndefined()
  })

  it('a server without the route (404) is null, not an error', async () => {
    const { client } = setup(() => envelope(404, 'not_found'))
    await expect(client.listAccessRequests('doc_1')).resolves.toBeNull()
  })

  it('other list failures stay errors', async () => {
    const { client } = setup(() => envelope(403, 'forbidden'))
    expect((await failure(client.listAccessRequests('doc_1'))).status).toBe(403)
  })

  it('refuses an approval level of manage', async () => {
    const { client, seen } = setup(() => json(200, {}))
    const error = await failure(client.approveAccessRequest('doc_1', 'rq_1', 'manage' as never))
    expect(error.serverCode).toBe('invalid_input')
    expect(seen).toHaveLength(0)
  })
})

describe('error answers', () => {
  it('maps a throttle to retryAfterMs, an unsigned client to not_signed_in, a bare 403 to server_error', async () => {
    const { client } = setup(() => envelope(429, 'rate_limited'))
    expect((await failure(client.getDocumentShares('doc_1'))).status).toBe(429)

    const signedOut = createUniworkShareClient({
      apiOrigin: ORIGIN,
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => false,
      fetch: vi.fn<FetchLike>(),
    })
    expect((await failure(signedOut.getDocumentShares('doc_1'))).code).toBe('not_signed_in')

    const bare = setup(() => json(403, {}))
    expect((await failure(bare.client.getDocumentShares('doc_1'))).code).toBe('server_error')
  })
})
