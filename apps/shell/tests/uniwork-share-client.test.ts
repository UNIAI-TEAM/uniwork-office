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
      // UNI-2105: the rest of the merged UNI-2084 refusals
      [envelope(409, 'my_folder_locked'), 'my_folder_locked', 409],
      [envelope(409, 'document_shelved'), 'document_shelved', 409],
      [envelope(400, 'invalid_input'), 'invalid_input', 400],
      [envelope(403, 'forbidden'), 'forbidden', 403],
      [envelope(404, 'not_found'), 'not_found', 404],
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

  it('UNI-2105: a 200 with empty previous_* (keep none, a folder, the owner again) is the transfer', async () => {
    const { client } = setup(() =>
      json(200, {
        document_id: 'doc_1',
        acl_owner_id: 'u_an',
        previous_owner_id: '',
        previous_owner_share_id: '',
      }),
    )
    expect(
      await client.transferDocumentOwner('doc_1', { userId: 'u_an', previousOwnerLevel: 'none' }),
    ).toEqual({
      documentId: 'doc_1',
      aclOwnerId: 'u_an',
      previousOwnerId: '',
      previousOwnerShareId: '',
    })
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

describe('folder contents access (UNI-2244)', () => {
  const ITEMS = [
    { principalType: 'user', principalId: 'u_2', level: 'edit' },
    { principalType: 'workspace', principalId: 'ws_1', level: 'view' },
  ] as const
  const PREVIEW = {
    total: 37,
    preview: {
      changed: 30,
      unchanged: 2,
      skipped_not_manageable: 5,
      skipped_locked: 0,
      losing_users: 12,
      downgraded_users: 1,
      warnings: ['wide_scope', 'to_private'],
    },
  }
  const SYNC = {
    batch_id: 'b_1',
    mode: 'sync',
    total: 40,
    changed: 30,
    unchanged: 5,
    skipped_not_manageable: 3,
    skipped_locked: 2,
  }
  const BATCH = {
    batch_id: 'b_1',
    status: 'running',
    total: 900,
    processed: 200,
    changed: 150,
    unchanged: 20,
    skipped_not_manageable: 20,
    skipped_locked: 10,
  }

  it('PUTs /documents/{folderId}/contents-access with snake_case items, mode and dry_run', async () => {
    const { client, seen } = setup(() => json(200, PREVIEW))
    const result = await client.updateFolderContentsAccess({
      folderId: 'fld_1',
      mode: 'merge',
      items: [...ITEMS],
      dryRun: true,
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ url: `${API}/documents/fld_1/contents-access`, method: 'PUT' })
    expect(seen[0]!.body).toEqual({
      mode: 'merge',
      items: [
        { principal_type: 'user', principal_id: 'u_2', level: 'edit' },
        { principal_type: 'workspace', principal_id: 'ws_1', level: 'view' },
      ],
      dry_run: true,
    })
    expect(seen[0]!.headers.Authorization).toBe('Bearer tok')
    expect(result).toEqual({
      kind: 'dryRun',
      total: 37,
      preview: {
        changed: 30,
        unchanged: 2,
        skippedNotManageable: 5,
        skippedLocked: 0,
        losingUsers: 12,
        downgradedUsers: 1,
        warnings: ['wide_scope', 'to_private'],
      },
    })
  })

  it('a 200 sync write answers the counts and the batch id', async () => {
    const { client, seen } = setup(() => json(200, SYNC))
    const result = await client.updateFolderContentsAccess({
      folderId: 'fld_1',
      mode: 'replace',
      items: [...ITEMS],
      dryRun: false,
    })
    expect(seen[0]!.body).toMatchObject({ mode: 'replace', dry_run: false })
    expect(result).toEqual({
      kind: 'sync',
      batchId: 'b_1',
      total: 40,
      changed: 30,
      unchanged: 5,
      skippedNotManageable: 3,
      skippedLocked: 2,
    })
  })

  it('a 202 answers a background run to poll', async () => {
    const { client } = setup(() => json(202, { batch_id: 'b_2', mode: 'background', total: 900 }))
    expect(
      await client.updateFolderContentsAccess({
        folderId: 'fld_1',
        mode: 'merge',
        items: [...ITEMS],
        dryRun: false,
      }),
    ).toEqual({ kind: 'background', batchId: 'b_2', total: 900 })
  })

  it('an empty list goes out for replace (it removes every share) and nothing else', async () => {
    const { client, seen } = setup(() => json(200, SYNC))
    await client.updateFolderContentsAccess({
      folderId: 'fld_1',
      mode: 'replace',
      items: [],
      dryRun: false,
    })
    expect(seen[0]!.body).toEqual({ mode: 'replace', items: [], dry_run: false })
    const refused = setup(() => json(200, SYNC))
    const err = await failure(
      refused.client.updateFolderContentsAccess({
        folderId: 'fld_1',
        mode: 'merge',
        items: [],
        dryRun: false,
      }),
    )
    expect(err.serverCode).toBe('invalid_input')
    expect(refused.seen).toHaveLength(0)
  })

  it('refuses a call it will not send before any request', async () => {
    const { client, seen } = setup(() => json(200, SYNC))
    const base = { folderId: 'fld_1', mode: 'merge', items: [...ITEMS], dryRun: false } as const
    const calls = [
      { ...base, mode: 'union' },
      { ...base, dryRun: 'yes' },
      { ...base, items: new Array(101).fill(ITEMS[0]) },
      { ...base, items: [{ ...ITEMS[0], level: null }] },
      { ...base, items: [{ ...ITEMS[0], level: 'owner' }] },
      { ...base, items: [{ ...ITEMS[0], principalType: 'group' }] },
      { ...base, items: [{ ...ITEMS[0], principalId: '../x' }] },
      { ...base, items: [null] },
    ]
    for (const call of calls) {
      const err = await failure(
        client.updateFolderContentsAccess(
          call as unknown as Parameters<typeof client.updateFolderContentsAccess>[0],
        ),
      )
      expect(err.serverCode).toBe('invalid_input')
    }
    expect(
      (await failure(client.updateFolderContentsAccess({ ...base, folderId: '../x' }))).code,
    ).toBe('not_found')
    expect(seen).toHaveLength(0)
  })

  it('accepts 100 items', async () => {
    const { client, seen } = setup(() => json(200, SYNC))
    const items = Array.from({ length: 100 }, (_, i) => ({
      principalType: 'user' as const,
      principalId: `u_${i}`,
      level: 'view' as const,
    }))
    await client.updateFolderContentsAccess({
      folderId: 'fld_1',
      mode: 'merge',
      items,
      dryRun: false,
    })
    expect((seen[0]!.body as { items: unknown[] }).items).toHaveLength(100)
  })

  it('keeps the server verdicts: not_a_folder, rejected items, a running batch with its id', async () => {
    const req = { folderId: 'fld_1', mode: 'merge', items: [...ITEMS], dryRun: false } as const
    const notFolder = await failure(
      setup(() => envelope(422, 'not_a_folder')).client.updateFolderContentsAccess(req),
    )
    expect(notFolder).toMatchObject({ status: 422, serverCode: 'not_a_folder' })

    const rejected = await failure(
      setup(() =>
        envelope(422, 'document_access_rejected', {
          rejected: [
            {
              index: 1,
              principal_type: 'workspace',
              principal_id: 'ws_1',
              code: 'level_not_allowed',
            },
          ],
        }),
      ).client.updateFolderContentsAccess(req),
    )
    expect(rejected.serverCode).toBe('document_access_rejected')
    expect(rejected.rejected).toEqual([
      { index: 1, principalType: 'workspace', principalId: 'ws_1', code: 'level_not_allowed' },
    ])

    const running = await failure(
      setup(() =>
        envelope(409, 'folder_access_batch_running', { batch_id: 'b_9' }),
      ).client.updateFolderContentsAccess(req),
    )
    expect(running).toMatchObject({ status: 409, serverCode: 'folder_access_batch_running' })
    expect(running.fields).toEqual({ batch_id: 'b_9' })
  })

  it('malformed answers are malformed_response', async () => {
    const req = { folderId: 'fld_1', mode: 'merge', items: [...ITEMS], dryRun: false } as const
    const dry = { ...req, dryRun: true }
    const answers: Array<[typeof req | typeof dry, number, unknown]> = [
      // a dry run that answers a write shape
      [dry, 200, SYNC],
      // a write that answers a preview
      [req, 200, PREVIEW],
      // 202 with the sync body, and 200 with the background body
      [req, 202, SYNC],
      [req, 200, { batch_id: 'b_2', mode: 'background', total: 900 }],
      // an unknown mode
      [req, 200, { ...SYNC, mode: 'turbo' }],
      // a count that is missing, negative, fractional or the wrong type
      [req, 200, { ...SYNC, changed: undefined }],
      [req, 200, { ...SYNC, skipped_locked: -1 }],
      [req, 200, { ...SYNC, unchanged: 1.5 }],
      [req, 200, { ...SYNC, total: '40' }],
      [req, 200, { ...SYNC, batch_id: '' }],
      [dry, 200, { total: 1 }],
      [dry, 200, { ...PREVIEW, preview: { ...PREVIEW.preview, losing_users: undefined } }],
      [dry, 200, { ...PREVIEW, preview: { ...PREVIEW.preview, warnings: 'wide_scope' } }],
      [dry, 200, { ...PREVIEW, preview: { ...PREVIEW.preview, warnings: [3] } }],
      [dry, 200, []],
    ]
    for (const [request, status, body] of answers) {
      const { client } = setup(() => json(status, body))
      expect((await failure(client.updateFolderContentsAccess(request))).code).toBe(
        'malformed_response',
      )
    }
  })

  it('GETs /documents/{folderId}/contents-access/{batchId} and reads the progress', async () => {
    const { client, seen } = setup(() => json(200, BATCH))
    const batch = await client.getFolderContentsAccessBatch('fld_1', 'b_1')
    expect(seen[0]).toMatchObject({
      url: `${API}/documents/fld_1/contents-access/b_1`,
      method: 'GET',
    })
    expect(seen[0]!.body).toBeUndefined()
    expect(batch).toEqual({
      batchId: 'b_1',
      status: 'running',
      total: 900,
      processed: 200,
      changed: 150,
      unchanged: 20,
      skippedNotManageable: 20,
      skippedLocked: 10,
    })
  })

  it('reads finished_at of an ended run', async () => {
    const { client } = setup(() =>
      json(200, {
        ...BATCH,
        status: 'completed',
        processed: 900,
        finished_at: '2026-10-27T10:00:00Z',
      }),
    )
    expect(await client.getFolderContentsAccessBatch('fld_1', 'b_1')).toMatchObject({
      status: 'completed',
      processed: 900,
      finishedAt: '2026-10-27T10:00:00Z',
    })
  })

  it('refuses ids that are not ids before any request', async () => {
    const { client, seen } = setup(() => json(200, BATCH))
    expect((await failure(client.getFolderContentsAccessBatch('../x', 'b_1'))).code).toBe(
      'not_found',
    )
    expect((await failure(client.getFolderContentsAccessBatch('fld_1', 'b/../1'))).code).toBe(
      'not_found',
    )
    expect(seen).toHaveLength(0)
  })

  it('a batch the caller does not own is the server 404, kept as not_found', async () => {
    const { client } = setup(() => envelope(404, 'not_found'))
    expect(await failure(client.getFolderContentsAccessBatch('fld_1', 'b_1'))).toMatchObject({
      code: 'not_found',
      status: 404,
    })
  })

  it('malformed batch answers are malformed_response', async () => {
    const bodies: unknown[] = [
      [],
      { ...BATCH, status: 'paused' },
      { ...BATCH, status: undefined },
      { ...BATCH, status: 3 },
      { ...BATCH, total: undefined },
      { ...BATCH, processed: '200' },
      { ...BATCH, processed: -1 },
      { ...BATCH, processed: 901 },
      { ...BATCH, changed: null },
      { ...BATCH, skipped_not_manageable: undefined },
      { ...BATCH, batch_id: '' },
      { ...BATCH, finished_at: 5 },
      // another run's progress is not the answer to this one
      { ...BATCH, batch_id: 'b_other' },
    ]
    for (const body of bodies) {
      const { client } = setup(() => json(200, body))
      expect((await failure(client.getFolderContentsAccessBatch('fld_1', 'b_1'))).code).toBe(
        'malformed_response',
      )
    }
  })
})
