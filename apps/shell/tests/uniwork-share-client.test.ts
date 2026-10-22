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

describe('break-glass (the web calls)', () => {
  const GRANT = {
    id: 'bg_1',
    document_id: 'doc_1',
    actor_id: 'u_admin',
    actor_name: 'Admin',
    level: 'view',
    reason: 'Audit of the Q3 file',
    granted_at: '2026-10-21T01:00:00Z',
    expires_at: '2026-10-22T01:00:00Z',
  }

  it('POSTs /documents/{id}/break-glass with the reason and an Idempotency-Key, reads a bare grant', async () => {
    const { client, seen } = setup(() => json(201, GRANT))
    const grant = await client.createDocumentBreakGlass('doc_1', 'Audit of the Q3 file')
    expect(seen[0]).toMatchObject({ url: `${API}/documents/doc_1/break-glass`, method: 'POST' })
    expect(seen[0]!.body).toEqual({ reason: 'Audit of the Q3 file' })
    expect(seen[0]!.headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9-]{8,}$/)
    expect(grant).toMatchObject({ id: 'bg_1', actorName: 'Admin', level: 'view' })
  })

  it('reads the enveloped grant ({grant}) too, and a grant it cannot read as null', async () => {
    const wrapped = setup(() => json(201, { grant: GRANT }))
    expect((await wrapped.client.createDocumentBreakGlass('doc_1', 'long enough reason'))?.id).toBe(
      'bg_1',
    )
    const odd = setup(() => json(201, { nothing: true }))
    await expect(
      odd.client.createDocumentBreakGlass('doc_1', 'long enough reason'),
    ).resolves.toBeNull()
  })

  it('a new key per call, so a retried click is a new grant and a replay is deduplicated by the server', async () => {
    const { client, seen } = setup(() => json(201, GRANT))
    await client.createDocumentBreakGlass('doc_1', 'long enough reason')
    await client.createDocumentBreakGlass('doc_1', 'long enough reason')
    expect(seen[0]!.headers['Idempotency-Key']).not.toBe(seen[1]!.headers['Idempotency-Key'])
  })

  it('refuses a reason outside 10-500 characters (counted as code points) before any request', async () => {
    const { client, seen } = setup(() => json(201, GRANT))
    for (const reason of ['', '   short   ', 'x'.repeat(501), 42 as never]) {
      expect((await failure(client.createDocumentBreakGlass('doc_1', reason))).serverCode).toBe(
        'break_glass_reason_invalid',
      )
    }
    expect(seen).toHaveLength(0)
    // ten emoji are ten characters, not twenty
    await client.createDocumentBreakGlass('doc_1', '😀'.repeat(10))
    expect(seen).toHaveLength(1)
  })

  it('keeps the server verdicts (reason invalid 422, break_glass_required 403) with their codes', async () => {
    const invalid = setup(() => envelope(422, 'break_glass_reason_invalid', { min: 10, max: 500 }))
    const e1 = await failure(invalid.client.createDocumentBreakGlass('doc_1', 'long enough reason'))
    expect(e1).toMatchObject({ status: 422, serverCode: 'break_glass_reason_invalid' })
    const required = setup(() => envelope(403, 'break_glass_required'))
    expect(
      (await failure(required.client.createDocumentBreakGlass('doc_1', 'long enough reason')))
        .serverCode,
    ).toBe('break_glass_required')
  })

  it('DELETEs /documents/{id}/break-glass/{grantId}; only {status:"ok"} is a revoke', async () => {
    const { client, seen } = setup(() => json(200, { status: 'ok' }))
    await client.revokeDocumentBreakGlass('doc_1', 'bg_1')
    expect(seen[0]).toMatchObject({
      url: `${API}/documents/doc_1/break-glass/bg_1`,
      method: 'DELETE',
    })
    expect(seen[0]!.body).toBeUndefined()
    const other = setup(() => json(200, { status: 'later' }))
    expect((await failure(other.client.revokeDocumentBreakGlass('doc_1', 'bg_1'))).code).toBe(
      'malformed_response',
    )
    const refuses = setup(() => json(200, { status: 'ok' }))
    expect((await failure(refuses.client.revokeDocumentBreakGlass('doc_1', '../x'))).code).toBe(
      'not_found',
    )
  })
})

describe('listOrgMembers (the web member walk, one page)', () => {
  it('GETs /orgs/{slug}/members with the largest page and the cursor, reads id + display name', async () => {
    const { client, seen } = setup(() =>
      json(200, {
        members: [
          { user_id: 'u_1', display_name: 'Minh Trần', email: 'minh@acme.test' },
          { user_id: 'u_2', display_name: '', email: 'an@acme.test' },
        ],
        next_cursor: 'c2',
      }),
    )
    const page = await client.listOrgMembers({ orgSlug: 'acme', cursor: 'c1' })
    expect(seen[0]).toMatchObject({ method: 'GET' })
    expect(seen[0]!.url).toBe(`${API}/orgs/acme/members?limit=100&cursor=c1`)
    expect(page.nextCursor).toBe('c2')
    // a member with no display name falls back to the email, like the web
    expect(page.members).toEqual([
      { userId: 'u_1', displayName: 'Minh Trần' },
      { userId: 'u_2', displayName: 'an@acme.test' },
    ])
  })

  it('an empty next_cursor ends the walk (empty string); a slug that is not a slug never leaves', async () => {
    const { client, seen } = setup(() => json(200, { members: [], next_cursor: null }))
    expect((await client.listOrgMembers({ orgSlug: 'acme' })).nextCursor).toBe('')
    expect((await failure(client.listOrgMembers({ orgSlug: '../x' }))).code).toBe('not_found')
    expect(seen).toHaveLength(1)
  })

  it('a malformed page is malformed_response', async () => {
    const { client } = setup(() => json(200, { nope: [] }))
    expect((await failure(client.listOrgMembers({ orgSlug: 'acme' }))).code).toBe(
      'malformed_response',
    )
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

/**
 * UNI-2078 slice 4: owner transfer, the web's `documents-owner.ts` exactly
 * (`PUT /documents/{id}/owner`, `{user_id, previous_owner_level}`), plus the
 * reads main needs to gate it and to list who can take the document.
 */
describe('transferDocumentOwner', () => {
  const ANSWER = {
    document_id: 'doc_1',
    acl_owner_id: 'u_an',
    previous_owner_id: 'u_owner',
    previous_owner_share_id: 'sh_9',
  }

  it('PUTs /documents/{id}/owner with user_id and previous_owner_level, reads the answer', async () => {
    const { client, seen } = setup(() => json(200, ANSWER))
    const res = await client.transferDocumentOwner('doc_1', {
      userId: 'u_an',
      previousOwnerLevel: 'view',
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ url: `${API}/documents/doc_1/owner`, method: 'PUT' })
    expect(seen[0]!.body).toEqual({ user_id: 'u_an', previous_owner_level: 'view' })
    expect(res).toEqual({
      documentId: 'doc_1',
      aclOwnerId: 'u_an',
      previousOwnerId: 'u_owner',
      previousOwnerShareId: 'sh_9',
    })
  })

  it('the previous owner keeps edit when nothing is asked; none is sent as none', async () => {
    const { client, seen } = setup(() => json(200, ANSWER))
    await client.transferDocumentOwner('doc_1', { userId: 'u_an' })
    await client.transferDocumentOwner('doc_1', { userId: 'u_an', previousOwnerLevel: 'none' })
    expect(seen.map((s) => s.body)).toEqual([
      { user_id: 'u_an', previous_owner_level: 'edit' },
      { user_id: 'u_an', previous_owner_level: 'none' },
    ])
  })

  it('refuses a keep level outside edit/view/none and a user id that is not an id before any request', async () => {
    const { client, seen } = setup(() => json(200, ANSWER))
    for (const level of ['comment', 'manage', 'owner', '']) {
      const err = await failure(
        client.transferDocumentOwner('doc_1', {
          userId: 'u_an',
          previousOwnerLevel: level as never,
        }),
      )
      expect(err.serverCode).toBe('invalid_input')
    }
    for (const userId of ['', '../x', 'a b']) {
      expect((await failure(client.transferDocumentOwner('doc_1', { userId }))).serverCode).toBe(
        'invalid_input',
      )
    }
    expect(seen).toHaveLength(0)
  })

  it('an answer that does not name the requested owner (or document) is not proof of the write', async () => {
    for (const body of [
      { ...ANSWER, acl_owner_id: 'u_other' },
      { ...ANSWER, document_id: 'doc_2' },
      { document_id: 'doc_1' },
      {},
    ]) {
      const { client } = setup(() => json(200, body))
      expect((await failure(client.transferDocumentOwner('doc_1', { userId: 'u_an' }))).code).toBe(
        'malformed_response',
      )
    }
  })

  it('keeps the server verdicts and the status of a missing route', async () => {
    const cases: Array<[Response, string | undefined, number]> = [
      [envelope(422, 'owner_target_not_member'), 'owner_target_not_member', 422],
      [envelope(403, 'break_glass_required'), 'break_glass_required', 403],
      [envelope(409, 'document_owned_by_work_product'), 'document_owned_by_work_product', 409],
      [new Response('404 page not found', { status: 404 }), undefined, 404],
      [new Response('', { status: 405 }), undefined, 405],
    ]
    for (const [answer, serverCode, status] of cases) {
      const { client } = setup(() => answer)
      const err = await failure(client.transferDocumentOwner('doc_1', { userId: 'u_an' }))
      expect(err.serverCode).toBe(serverCode)
      expect(err.status).toBe(status)
    }
  })
})

describe('owner transfer reads', () => {
  it('getOwnerGate GETs /documents/{id} and reads the workspace, owner kind, shelf and visibility', async () => {
    const { client, seen } = setup(() =>
      json(200, {
        document: {
          id: 'doc_1',
          workspace_id: 'ws_1',
          owner_kind: '',
          shelved_at: null,
          visibility: 'restricted',
        },
      }),
    )
    expect(await client.getOwnerGate('doc_1')).toEqual({
      id: 'doc_1',
      workspaceId: 'ws_1',
      ownerKind: '',
      shelved: false,
      visibility: 'restricted',
    })
    expect(seen[0]).toMatchObject({ url: `${API}/documents/doc_1`, method: 'GET' })
  })

  describe('getOwnerGate for a restricted document (BE-1)', () => {
    const SUMMARY = {
      document: {
        id: 'doc_1',
        workspace_id: 'ws_1',
        visibility: 'restricted',
        archived_at: null,
      },
      admin_scope: true,
      my_level: '',
    }
    const route = (seen: Seen) =>
      seen.url.endsWith('/admin-summary')
        ? json(200, SUMMARY)
        : envelope(403, 'document_restricted')

    it('a 403 document_restricted falls back to /admin-summary for the workspace and visibility', async () => {
      const { client, seen } = setup(route)
      expect(await client.getOwnerGate('doc_1')).toEqual({
        id: 'doc_1',
        workspaceId: 'ws_1',
        // the summary has no owner_kind / shelved_at: the server answers those two
        ownerKind: '',
        shelved: false,
        visibility: 'restricted',
      })
      expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
        `GET ${API}/documents/doc_1`,
        `GET ${API}/documents/doc_1/admin-summary`,
      ])
    })

    it('only document_restricted falls back; any other refusal of the read is the failure', async () => {
      for (const answer of [envelope(403, 'forbidden'), envelope(404, 'not_found')]) {
        const { client, seen } = setup(() => answer)
        await failure(client.getOwnerGate('doc_1'))
        expect(seen).toHaveLength(1)
      }
    })

    it('a summary the caller may not read is forbidden, not a retry loop', async () => {
      const { client, seen } = setup((s) =>
        s.url.endsWith('/admin-summary')
          ? envelope(403, 'forbidden')
          : envelope(403, 'document_restricted'),
      )
      expect((await failure(client.getOwnerGate('doc_1'))).code).toBe('forbidden')
      expect(seen).toHaveLength(2)
    })
  })

  it('a gate answer for another document is malformed_response (BE-4), on both reads', async () => {
    const other = { document: { id: 'doc_2', workspace_id: 'ws_1', visibility: 'workspace' } }
    const direct = setup(() => json(200, other))
    expect((await failure(direct.client.getOwnerGate('doc_1'))).code).toBe('malformed_response')
    const summary = setup((s) =>
      s.url.endsWith('/admin-summary') ? json(200, other) : envelope(403, 'document_restricted'),
    )
    expect((await failure(summary.client.getOwnerGate('doc_1'))).code).toBe('malformed_response')
  })

  it('listWorkspaceMemberIds GETs /workspaces/{ws}/members and keeps every user id', async () => {
    const { client, seen } = setup(() =>
      json(200, {
        members: [
          { user_id: 'u_1', display_name: 'Minh' },
          { user_id: 'u_2', display_name: '' },
          { display_name: 'no id' },
        ],
      }),
    )
    expect(await client.listWorkspaceMemberIds('ws_1')).toEqual(['u_1', 'u_2'])
    expect(seen[0]).toMatchObject({ url: `${API}/workspaces/ws_1/members`, method: 'GET' })
  })

  it('listActiveOrgMembers asks for status=active and drops anyone not active', async () => {
    const { client, seen } = setup(() =>
      json(200, {
        members: [
          { user_id: 'u_1', display_name: 'Minh Trần', email: 'minh@acme.test', status: 'active' },
          { user_id: 'u_2', display_name: '', email: 'an@acme.test' },
          { user_id: 'u_3', display_name: 'Gone', email: 'g@acme.test', status: 'deactivated' },
        ],
        next_cursor: 'c2',
      }),
    )
    const page = await client.listActiveOrgMembers({ orgSlug: 'acme', cursor: 'c1' })
    expect(seen[0]!.url).toBe(`${API}/orgs/acme/members?status=active&limit=100&cursor=c1`)
    expect(page).toEqual({
      members: [
        { userId: 'u_1', name: 'Minh Trần', email: 'minh@acme.test' },
        { userId: 'u_2', name: 'an@acme.test', email: 'an@acme.test' },
      ],
      nextCursor: 'c2',
    })
  })
})
