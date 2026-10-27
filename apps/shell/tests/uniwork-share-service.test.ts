import { describe, expect, it, vi } from 'vitest'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import {
  createUniworkShareClient,
  type UniworkShareClient,
} from '../src/main/uniwork-docs/share-client'
import {
  createUniworkShareService,
  shareErrorOf,
  type UniworkShareServiceDeps,
} from '../src/main/uniwork-docs/share-service'
import type {
  FolderContentsAccessBatch,
  FolderContentsAccessResult,
  ShareAccess,
  ShareBreakGlassGrant,
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

const GRANT: ShareBreakGlassGrant = {
  id: 'bg_1',
  documentId: 'doc_1',
  actorId: 'u_admin',
  actorName: 'Admin',
  level: 'view',
  reason: 'Audit of the Q3 file',
  grantedAt: '2026-10-21T01:00:00Z',
  expiresAt: '2026-10-22T01:00:00Z',
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
    createDocumentBreakGlass: vi.fn(async () => GRANT),
    revokeDocumentBreakGlass: vi.fn(async () => undefined),
    listOrgMembers: vi.fn(async () => ({
      members: [{ userId: 'u_1', displayName: 'Minh Trần' }],
      nextCursor: '',
    })),
    transferDocumentOwner: vi.fn(async (documentId: string, body: { userId: string }) => ({
      documentId,
      aclOwnerId: body.userId,
      previousOwnerId: 'u_owner',
      previousOwnerShareId: 'sh_9',
    })),
    getOwnerGate: vi.fn(async (documentId: string) => ({
      id: documentId,
      workspaceId: 'ws_1',
      ownerKind: '',
      shelved: false,
      visibility: 'workspace',
    })),
    updateFolderContentsAccess: vi.fn(async (): Promise<FolderContentsAccessResult> => ({
      kind: 'background',
      batchId: 'b_1',
      total: 900,
    })),
    getFolderContentsAccessBatch: vi.fn(
      async (_folderId: string, batchId: string): Promise<FolderContentsAccessBatch> => ({
        batchId,
        status: 'running',
        total: 900,
        processed: 200,
        changed: 100,
        unchanged: 50,
        skippedNotManageable: 40,
        skippedLocked: 10,
      }),
    ),
    listWorkspaceMemberIds: vi.fn(async () => ['u_owner', 'u_an', 'u_off', 'u_me']),
    listActiveOrgMembers: vi.fn(async () => ({
      members: [
        { userId: 'u_owner', name: 'Hoa', email: 'hoa@acme.test' },
        { userId: 'u_an', name: 'An Lê', email: 'an@acme.test' },
        { userId: 'u_me', name: 'Me Admin', email: 'me@acme.test' },
      ],
      nextCursor: '',
    })),
    ...over,
  }
}

function service(client: UniworkShareClient, over: Partial<UniworkShareServiceDeps> = {}) {
  return createUniworkShareService({
    client: () => client,
    isSignedIn: () => true,
    selectedOrgId: () => 'org_1',
    selectedOrgSlug: () => 'acme',
    selfUserId: () => 'u_me',
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

describe('break-glass and members', () => {
  it('breakGlassGrant / breakGlassRevoke resolve with the client value', async () => {
    const client = fakeClient()
    const s = service(client)
    expect(
      await s.breakGlassGrant({ documentId: 'doc_1', reason: 'Audit of the Q3 file' }),
    ).toEqual({
      ok: true,
      value: GRANT,
    })
    expect(client.createDocumentBreakGlass).toHaveBeenCalledWith('doc_1', 'Audit of the Q3 file')
    expect(await s.breakGlassRevoke({ documentId: 'doc_1', grantId: 'bg_1' })).toEqual({
      ok: true,
      value: { documentId: 'doc_1', grantId: 'bg_1' },
    })
    expect(client.revokeDocumentBreakGlass).toHaveBeenCalledWith('doc_1', 'bg_1')
  })

  it('keeps break_glass_reason_invalid and break_glass_required by their own names', () => {
    const invalid = new UniworkDocError('server_error', {
      serverCode: 'break_glass_reason_invalid',
      status: 422,
    })
    expect(shareErrorOf(invalid)).toEqual({
      ok: false,
      error: 'break_glass_reason_invalid',
      status: 422,
    })
    const required = new UniworkDocError('server_error', {
      serverCode: 'break_glass_required',
      status: 403,
    })
    expect(shareErrorOf(required)).toEqual({
      ok: false,
      error: 'break_glass_required',
      status: 403,
    })
  })

  it('members reads one page of the selected organization by its slug', async () => {
    const client = fakeClient()
    const s = service(client)
    expect(await s.members({ cursor: 'c1', limit: 50 })).toEqual({
      ok: true,
      value: { members: [{ userId: 'u_1', displayName: 'Minh Trần' }], nextCursor: '' },
    })
    expect(client.listOrgMembers).toHaveBeenCalledWith({ orgSlug: 'acme', cursor: 'c1', limit: 50 })
    await s.members({})
    expect(client.listOrgMembers).toHaveBeenLastCalledWith({ orgSlug: 'acme' })
  })

  it('members with no selected organization is not_found; signed out is not_signed_in', async () => {
    const client = fakeClient()
    expect(await service(client, { selectedOrgSlug: () => null }).members({})).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(await service(client, { isSignedIn: () => false }).members({})).toEqual({
      ok: false,
      error: 'not_signed_in',
    })
    expect(client.listOrgMembers).not.toHaveBeenCalled()
  })

  it('wrong-shaped input is invalid_request without calling the client', async () => {
    const client = fakeClient()
    const s = service(client)
    expect(await s.breakGlassGrant({ documentId: 'doc_1' } as never)).toMatchObject({
      ok: false,
      error: 'invalid_request',
    })
    expect(await s.breakGlassGrant(null as never)).toMatchObject({
      ok: false,
      error: 'invalid_request',
    })
    expect(await s.breakGlassRevoke({ documentId: 'doc_1' } as never)).toMatchObject({
      ok: false,
      error: 'invalid_request',
    })
    expect(await s.members(7 as never)).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(client.createDocumentBreakGlass).not.toHaveBeenCalled()
    expect(client.revokeDocumentBreakGlass).not.toHaveBeenCalled()
    expect(client.listOrgMembers).not.toHaveBeenCalled()
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

  it('a 503 on link create is not retried (a second live link could be created); a 429 still is', async () => {
    const wait = vi.fn(async () => undefined)
    const client = fakeClient({
      createDocumentLink: vi.fn(async (id: string) => {
        throw new UniworkDocError('server_error', { status: id === 'd1' ? 503 : 429 })
      }),
    })
    const res = await service(client, { wait }).bulk(plan({ link: 'create', people: [] }))
    expect(res).toMatchObject({
      ok: true,
      value: {
        failed: [
          { id: 'd1', error: 'server_error' },
          { id: 'd2', error: 'server_error' },
        ],
      },
    })
    // d1: one try; d2: the 429 is retried once
    expect(client.createDocumentLink).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('a bad expiry or an oversized plan is invalid_request before anything is written', async () => {
    const client = fakeClient()
    const s = service(client)
    for (const expiresInDays of [0, 1.5, Number.NaN, 91, -3]) {
      expect(await s.bulk(plan({ link: 'create', expiresInDays }))).toMatchObject({
        ok: false,
        error: 'invalid_request',
      })
    }
    const docs = Array.from({ length: 501 }, (_, i) => ({ id: `d${i}`, workspaceId: 'ws_a' }))
    expect(await s.bulk(plan({ docs }))).toMatchObject({ ok: false, error: 'invalid_request' })
    const people = Array.from({ length: 101 }, (_, i) => ({
      principalType: 'user' as const,
      principalId: `u_${i}`,
      level: 'view' as const,
    }))
    expect(await s.bulk(plan({ people }))).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(client.updateDocumentAccess).not.toHaveBeenCalled()
    expect(client.createDocumentLink).not.toHaveBeenCalled()
    expect(await s.bulk(plan({ link: 'create', expiresInDays: 90 }))).toMatchObject({ ok: true })
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

describe('owner transfer (UNI-2078 slice 4)', () => {
  const OWNED: ShareAccess = {
    myLevel: 'manage',
    adminScope: false,
    via: 'member',
    owner: { userId: 'u_owner', level: 'manage', via: 'member' },
  }
  const ADMIN_ONLY: ShareAccess = { ...OWNED, myLevel: '', adminScope: true, via: '' }
  const gate = (over: Record<string, unknown> = {}) =>
    vi.fn(async (documentId: string) => ({
      id: documentId,
      workspaceId: 'ws_1',
      ownerKind: '',
      shelved: false,
      visibility: 'workspace',
      ...over,
    }))
  const throttle = (status: number) =>
    new UniworkDocError('server_error', { status, serverCode: 'rate_limited' })
  const shares = (access: ShareAccess) => vi.fn(async () => access)

  describe('ownerCandidates', () => {
    it('workspace members who are active in the organization, minus the current owner', async () => {
      const client = fakeClient({ getDocumentShares: shares(OWNED) })
      const res = await service(client).ownerCandidates('doc_1')
      expect(res).toEqual({
        ok: true,
        value: [
          { userId: 'u_an', name: 'An Lê', email: 'an@acme.test' },
          { userId: 'u_me', name: 'Me Admin', email: 'me@acme.test' },
        ],
      })
      expect(client.listWorkspaceMemberIds).toHaveBeenCalledWith('ws_1')
      expect(client.listActiveOrgMembers).toHaveBeenCalledWith({ orgSlug: 'acme' })
    })

    it('walks every page of active members, cursor by cursor', async () => {
      const pages = vi
        .fn()
        .mockResolvedValueOnce({
          members: [{ userId: 'u_an', name: 'An', email: 'an@acme.test' }],
          nextCursor: 'c2',
        })
        .mockResolvedValueOnce({
          members: [{ userId: 'u_off', name: 'Back', email: 'b@acme.test' }],
          nextCursor: '',
        })
      const client = fakeClient({ getDocumentShares: shares(OWNED), listActiveOrgMembers: pages })
      const res = await service(client).ownerCandidates('doc_1')
      expect(res.ok && res.value.map((c) => c.userId)).toEqual(['u_an', 'u_off'])
      expect(pages.mock.calls).toEqual([[{ orgSlug: 'acme' }], [{ orgSlug: 'acme', cursor: 'c2' }]])
    })

    it('an admin reaching a restricted document only through admin_scope is not a candidate', async () => {
      const client = fakeClient({
        getDocumentShares: shares(ADMIN_ONLY),
        getOwnerGate: gate({ visibility: 'restricted' }),
      })
      const res = await service(client).ownerCandidates('doc_1')
      expect(res.ok && res.value.map((c) => c.userId)).toEqual(['u_an'])
      // on a workspace-visible document the same admin may take it
      const open = fakeClient({ getDocumentShares: shares(ADMIN_ONLY) })
      const all = await service(open).ownerCandidates('doc_1')
      expect(all.ok && all.value.map((c) => c.userId)).toEqual(['u_an', 'u_me'])
    })

    it('the gate is checked in main: no member read below manage, on a work product or a shelved document', async () => {
      const cases: Array<[Partial<UniworkShareClient>, string]> = [
        [{ getDocumentShares: shares({ ...OWNED, myLevel: 'edit' }) }, 'forbidden'],
        [
          { getDocumentShares: shares(OWNED), getOwnerGate: gate({ ownerKind: 'work_product' }) },
          'document_owned_by_work_product',
        ],
        [
          { getDocumentShares: shares(OWNED), getOwnerGate: gate({ shelved: true }) },
          'document_shelved',
        ],
      ]
      for (const [over, error] of cases) {
        const client = fakeClient(over)
        expect(await service(client).ownerCandidates('doc_1')).toMatchObject({ ok: false, error })
        expect(client.listWorkspaceMemberIds).not.toHaveBeenCalled()
        expect(client.listActiveOrgMembers).not.toHaveBeenCalled()
      }
    })

    it('a bad id is invalid_request; no organization selected is not_found', async () => {
      const client = fakeClient({ getDocumentShares: shares(OWNED) })
      expect(await service(client).ownerCandidates('')).toEqual({
        ok: false,
        error: 'invalid_request',
      })
      expect(
        await service(client, { selectedOrgSlug: () => null }).ownerCandidates('doc_1'),
      ).toMatchObject({ ok: false, error: 'not_found' })
    })
  })

  describe('transferOwner', () => {
    it('re-checks the gate, then PUTs the owner with the keep level and answers the transfer', async () => {
      const client = fakeClient({ getDocumentShares: shares(OWNED) })
      const res = await service(client).transferOwner({
        documentId: 'doc_1',
        userId: 'u_an',
        previousOwnerLevel: 'view',
      })
      expect(res).toEqual({
        ok: true,
        value: {
          documentId: 'doc_1',
          aclOwnerId: 'u_an',
          previousOwnerId: 'u_owner',
          previousOwnerShareId: 'sh_9',
        },
      })
      expect(client.getOwnerGate).toHaveBeenCalledWith('doc_1')
      expect(client.transferDocumentOwner).toHaveBeenCalledWith('doc_1', {
        userId: 'u_an',
        previousOwnerLevel: 'view',
      })
    })

    it('refuses in main without a PUT: below manage, work product, shelved, the owner again, self under admin_scope', async () => {
      const cases: Array<[Partial<UniworkShareClient>, string, string]> = [
        [{ getDocumentShares: shares({ ...OWNED, myLevel: 'edit' }) }, 'u_an', 'forbidden'],
        [
          { getDocumentShares: shares(OWNED), getOwnerGate: gate({ ownerKind: 'work_product' }) },
          'u_an',
          'document_owned_by_work_product',
        ],
        [
          { getDocumentShares: shares(OWNED), getOwnerGate: gate({ shelved: true }) },
          'u_an',
          'document_shelved',
        ],
        [{ getDocumentShares: shares(OWNED) }, 'u_owner', 'invalid_request'],
        [
          {
            getDocumentShares: shares(ADMIN_ONLY),
            getOwnerGate: gate({ visibility: 'restricted' }),
          },
          'u_me',
          'break_glass_required',
        ],
      ]
      for (const [over, userId, error] of cases) {
        const client = fakeClient(over)
        expect(await service(client).transferOwner({ documentId: 'doc_1', userId })).toMatchObject({
          ok: false,
          error,
        })
        expect(client.transferDocumentOwner).not.toHaveBeenCalled()
      }
    })

    it('maps the refusals the dialog names; anything else stays generic', async () => {
      const cases: Array<[UniworkDocError, Record<string, unknown>]> = [
        [
          new UniworkDocError('server_error', {
            status: 422,
            serverCode: 'owner_target_not_member',
          }),
          { error: 'owner_target_not_member', status: 422 },
        ],
        [
          new UniworkDocError('forbidden', { status: 403, serverCode: 'break_glass_required' }),
          { error: 'break_glass_required', status: 403 },
        ],
        [
          new UniworkDocError('server_error', {
            status: 409,
            serverCode: 'document_owned_by_work_product',
          }),
          { error: 'document_owned_by_work_product', status: 409 },
        ],
        [
          new UniworkDocError('server_error', { status: 500 }),
          { error: 'server_error', status: 500 },
        ],
      ]
      for (const [thrown, expected] of cases) {
        const client = fakeClient({
          getDocumentShares: shares(OWNED),
          transferDocumentOwner: vi.fn(async () => {
            throw thrown
          }),
        })
        const res = await service(client).transferOwner({ documentId: 'doc_1', userId: 'u_an' })
        expect(res).toEqual({ ok: false, ...expected })
      }
    })

    it('a server without the route (an envelope-less 404 / 405 / 501) is endpointMissing', async () => {
      for (const thrown of [
        new UniworkDocError('server_error', { status: 404 }),
        new UniworkDocError('server_error', { status: 405 }),
        new UniworkDocError('server_error', { status: 501 }),
      ]) {
        const client = fakeClient({
          getDocumentShares: shares(OWNED),
          transferDocumentOwner: vi.fn(async () => {
            throw thrown
          }),
        })
        const res = await service(client).transferOwner({ documentId: 'doc_1', userId: 'u_an' })
        expect(res).toMatchObject({ ok: false, endpointMissing: true, status: thrown.status })
      }
    })

    it('a coded 404 (the route is there, the document is not) is a plain failure, never endpointMissing', async () => {
      for (const thrown of [
        new UniworkDocError('not_found', { status: 404, serverCode: 'not_found' }),
        new UniworkDocError('server_error', { status: 404, serverCode: 'document_not_found' }),
        new UniworkDocError('server_error', { status: 405, serverCode: 'method_not_allowed' }),
      ]) {
        const client = fakeClient({
          getDocumentShares: shares(OWNED),
          transferDocumentOwner: vi.fn(async () => {
            throw thrown
          }),
        })
        const res = await service(client).transferOwner({ documentId: 'doc_1', userId: 'u_an' })
        expect(res.ok).toBe(false)
        expect(res).not.toHaveProperty('endpointMissing')
        expect(res).toMatchObject({ status: thrown.status })
      }
    })

    it('a 429 is repeated once after the wait; a 503 (may have committed) is not', async () => {
      const put = vi.fn().mockRejectedValueOnce(throttle(429)).mockResolvedValueOnce({
        documentId: 'doc_1',
        aclOwnerId: 'u_an',
        previousOwnerId: 'u_owner',
        previousOwnerShareId: '',
      })
      const wait = vi.fn(async () => undefined)
      const client = fakeClient({ getDocumentShares: shares(OWNED), transferDocumentOwner: put })
      const res = await service(client, { wait }).transferOwner({
        documentId: 'doc_1',
        userId: 'u_an',
      })
      expect(res.ok).toBe(true)
      expect(put).toHaveBeenCalledTimes(2)
      expect(wait).toHaveBeenCalledTimes(1)

      const busy = vi.fn().mockRejectedValue(throttle(503))
      const again = fakeClient({ getDocumentShares: shares(OWNED), transferDocumentOwner: busy })
      expect(
        await service(again).transferOwner({ documentId: 'doc_1', userId: 'u_an' }),
      ).toMatchObject({ ok: false, error: 'server_error', retryable: true })
      expect(busy).toHaveBeenCalledTimes(1)
    })

    it('wrong-shaped input is invalid_request without any read', async () => {
      const client = fakeClient()
      for (const input of [
        null,
        { documentId: 'doc_1' },
        { documentId: '', userId: 'u_an' },
        { documentId: 'doc_1', userId: 'u_an', previousOwnerLevel: 'comment' },
      ]) {
        expect(await service(client).transferOwner(input as never)).toEqual({
          ok: false,
          error: 'invalid_request',
        })
      }
      expect(client.getDocumentShares).not.toHaveBeenCalled()
      expect(client.transferDocumentOwner).not.toHaveBeenCalled()
    })
  })
})

/**
 * BE-2 (UNI-2078 fix 1): the owner gate on the REAL share client. An admin who reaches a restricted
 * document only through admin_scope cannot `GET /documents/{id}` (403 document_restricted); the gate
 * reads /admin-summary instead, so the selfExcluded rule is live on the real path.
 */
describe('owner transfer through the real client, admin on a restricted document (BE-2)', () => {
  const ORIGIN = 'https://uniwork.example'
  const API = `${ORIGIN}/api/v1`
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  function realService() {
    const seen: string[] = []
    const fetch = vi.fn<FetchLike>(async (url, init) => {
      const path = url.replace(API, '').replace(/\?.*$/, '')
      seen.push(`${init?.method ?? 'GET'} ${path}`)
      switch (path) {
        case '/documents/doc_1/shares':
          return json(200, {
            my_level: '',
            admin_scope: true,
            acl_owner: { user_id: 'u_owner', level: 'manage', via: 'owner' },
            shares: [],
            links: [],
          })
        case '/documents/doc_1':
          return json(403, { error: { code: 'document_restricted', message: 'x' } })
        case '/documents/doc_1/admin-summary':
          return json(200, {
            document: {
              id: 'doc_1',
              workspace_id: 'ws_1',
              visibility: 'restricted',
              archived_at: null,
            },
            admin_scope: true,
            my_level: '',
          })
        case '/workspaces/ws_1/members':
          return json(200, {
            members: [{ user_id: 'u_owner' }, { user_id: 'u_an' }, { user_id: 'u_me' }],
          })
        case '/orgs/acme/members':
          return json(200, {
            members: [
              { user_id: 'u_owner', display_name: 'Hoa', email: 'hoa@acme.test' },
              { user_id: 'u_an', display_name: 'An Lê', email: 'an@acme.test' },
              { user_id: 'u_me', display_name: 'Me Admin', email: 'me@acme.test' },
            ],
          })
        default:
          return json(404, { error: { code: 'not_found', message: path } })
      }
    })
    const client = createUniworkShareClient({
      apiOrigin: ORIGIN,
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => true,
      fetch,
    })
    return { seen, svc: service(client) }
  }

  it('ownerCandidates lists the workspace members minus the owner and minus self', async () => {
    const { svc, seen } = realService()
    const res = await svc.ownerCandidates('doc_1')
    expect(res).toEqual({
      ok: true,
      value: [{ userId: 'u_an', name: 'An Lê', email: 'an@acme.test' }],
    })
    expect(seen).toContain('GET /documents/doc_1/admin-summary')
  })

  it('transferOwner to self is break_glass_required and nothing is PUT', async () => {
    const { svc, seen } = realService()
    const res = await svc.transferOwner({ documentId: 'doc_1', userId: 'u_me' })
    expect(res).toMatchObject({ ok: false, error: 'break_glass_required' })
    expect(seen.some((line) => line.startsWith('PUT '))).toBe(false)
  })
})

/**
 * UNI-2105 (BE-5 folded in): the REAL client + service against the answer shapes the merged UNI-2084
 * route sends (`PUT /documents/{id}/owner`, D root 098585e7f). Every coded refusal is a plain
 * failure with its own ShareErrorCode; only the chi router's envelope-less 404 / 405 / 501 means
 * "this server has no owner route".
 */
describe('owner transfer against the merged UNI-2084 answers (UNI-2105)', () => {
  const ORIGIN = 'https://uniwork.example'
  const API = `${ORIGIN}/api/v1`
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const coded = (status: number, code: string) => json(status, { error: { code, message: 'x' } })

  function putAnswering(answer: Response) {
    const fetch = vi.fn<FetchLike>(async (url, init) => {
      const path = url.replace(API, '').replace(/\?.*$/, '')
      if (init?.method === 'PUT' && path === '/documents/doc_1/owner') return answer.clone()
      if (path === '/documents/doc_1/shares') {
        return json(200, {
          my_level: 'manage',
          admin_scope: false,
          acl_owner: { user_id: 'u_owner', level: 'manage', via: 'owner' },
          shares: [],
          links: [],
        })
      }
      if (path === '/documents/doc_1') {
        return json(200, {
          document: { id: 'doc_1', workspace_id: 'ws_1', visibility: 'workspace' },
        })
      }
      return coded(404, 'not_found')
    })
    const client = createUniworkShareClient({
      apiOrigin: ORIGIN,
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => true,
      fetch,
    })
    return service(client)
  }
  const transfer = (answer: Response) =>
    putAnswering(answer).transferOwner({ documentId: 'doc_1', userId: 'u_an' })

  it('200 with the full answer is the transfer', async () => {
    expect(
      await transfer(
        json(200, {
          document_id: 'doc_1',
          acl_owner_id: 'u_an',
          previous_owner_id: 'u_owner',
          previous_owner_share_id: 'sh_9',
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        documentId: 'doc_1',
        aclOwnerId: 'u_an',
        previousOwnerId: 'u_owner',
        previousOwnerShareId: 'sh_9',
      },
    })
  })

  it('200 with empty previous_* (keep none, a folder, or the owner again) is still the transfer', async () => {
    expect(
      await transfer(
        json(200, {
          document_id: 'doc_1',
          acl_owner_id: 'u_an',
          previous_owner_id: '',
          previous_owner_share_id: '',
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        documentId: 'doc_1',
        aclOwnerId: 'u_an',
        previousOwnerId: '',
        previousOwnerShareId: '',
      },
    })
  })

  it.each([
    ['400 invalid_input', coded(400, 'invalid_input'), 'invalid_request', 400],
    ['403 forbidden', coded(403, 'forbidden'), 'forbidden', 403],
    ['404 not_found', coded(404, 'not_found'), 'not_found', 404],
    ['403 break_glass_required', coded(403, 'break_glass_required'), 'break_glass_required', 403],
    [
      '409 document_owned_by_work_product',
      coded(409, 'document_owned_by_work_product'),
      'document_owned_by_work_product',
      409,
    ],
    ['409 my_folder_locked', coded(409, 'my_folder_locked'), 'my_folder_locked', 409],
    ['409 document_shelved', coded(409, 'document_shelved'), 'document_shelved', 409],
    [
      '422 owner_target_not_member',
      coded(422, 'owner_target_not_member'),
      'owner_target_not_member',
      422,
    ],
  ] as const)(
    '%s keeps its ShareErrorCode and is never endpointMissing',
    async (_n, answer, error, status) => {
      const res = await transfer(answer)
      expect(res).toMatchObject({ ok: false, error })
      if (error !== 'invalid_request') expect(res).toMatchObject({ status })
      expect(res).not.toHaveProperty('endpointMissing')
    },
  )

  it.each([
    ['plain 404 page not found', () => new Response('404 page not found', { status: 404 }), 404],
    ['plain 405', () => new Response('', { status: 405 }), 405],
    ['plain 501', () => new Response('', { status: 501 }), 501],
  ] as const)('%s is a server without the route', async (_n, make, status) => {
    expect(await transfer(make())).toMatchObject({ ok: false, endpointMissing: true, status })
  })
})

describe('folder contents access (UNI-2244)', () => {
  const REQUEST = {
    folderId: 'fld_1',
    mode: 'merge',
    items: [{ principalType: 'user', principalId: 'u_an', level: 'edit' }],
    dryRun: false,
  } as const
  const refusal = (serverCode: string, status: number, fields?: Record<string, unknown>) =>
    new UniworkDocError('server_error', { serverCode, status, ...(fields ? { fields } : {}) })

  it('forwards the plain request and answers the result', async () => {
    const client = fakeClient()
    const res = await service(client).folderContentsAccess({
      ...REQUEST,
      // whatever else the renderer sends does not reach the client
      extra: 'x',
      items: [{ ...REQUEST.items[0], note: 'x' }],
    } as never)
    expect(res).toEqual({ ok: true, value: { kind: 'background', batchId: 'b_1', total: 900 } })
    expect(client.updateFolderContentsAccess).toHaveBeenCalledWith({
      folderId: 'fld_1',
      mode: 'merge',
      dryRun: false,
      items: [{ principalType: 'user', principalId: 'u_an', level: 'edit' }],
    })
  })

  it('refuses a structurally bad request without calling the client', async () => {
    const client = fakeClient()
    const svc = service(client)
    const bad: unknown[] = [
      null,
      'fld_1',
      { ...REQUEST, folderId: '' },
      { ...REQUEST, folderId: 3 },
      { ...REQUEST, mode: 'union' },
      { ...REQUEST, dryRun: undefined },
      { ...REQUEST, dryRun: 'false' },
      { ...REQUEST, items: 'x' },
      { ...REQUEST, items: [] },
      { ...REQUEST, items: new Array(101).fill(REQUEST.items[0]) },
      { ...REQUEST, items: [{ ...REQUEST.items[0], level: null }] },
      { ...REQUEST, items: [{ ...REQUEST.items[0], level: 'owner' }] },
      { ...REQUEST, items: [{ ...REQUEST.items[0], principalType: 'group' }] },
      { ...REQUEST, items: [{ ...REQUEST.items[0], principalId: '' }] },
      { ...REQUEST, items: [null] },
    ]
    for (const input of bad) {
      expect(await svc.folderContentsAccess(input as never)).toEqual({
        ok: false,
        error: 'invalid_request',
      })
    }
    expect(client.updateFolderContentsAccess).not.toHaveBeenCalled()
  })

  it('an empty list is valid for replace only, and 100 items are allowed', async () => {
    const client = fakeClient()
    const svc = service(client)
    expect(
      await svc.folderContentsAccess({ ...REQUEST, mode: 'replace', items: [] }),
    ).toMatchObject({
      ok: true,
    })
    const hundred = new Array(100).fill(REQUEST.items[0])
    expect(await svc.folderContentsAccess({ ...REQUEST, items: hundred })).toMatchObject({
      ok: true,
    })
  })

  it('not signed in is not_signed_in', async () => {
    const client = fakeClient()
    expect(
      await service(client, { isSignedIn: () => false }).folderContentsAccess(REQUEST),
    ).toEqual({ ok: false, error: 'not_signed_in' })
    expect(
      await service(client, { isSignedIn: () => false }).folderContentsAccessBatch({
        folderId: 'fld_1',
        batchId: 'b_1',
      }),
    ).toEqual({ ok: false, error: 'not_signed_in' })
  })

  it('not_a_folder keeps its name and status', async () => {
    const client = fakeClient({
      updateFolderContentsAccess: vi.fn(async () => {
        throw refusal('not_a_folder', 422)
      }),
    })
    expect(await service(client).folderContentsAccess(REQUEST)).toEqual({
      ok: false,
      error: 'not_a_folder',
      status: 422,
    })
  })

  it('document_access_rejected carries the refused items', async () => {
    const rejected = [
      {
        index: 0,
        principalType: 'user',
        principalId: 'u_an',
        code: 'principal_not_in_organization',
      },
    ] as const
    const client = fakeClient({
      updateFolderContentsAccess: vi.fn(async () => {
        throw new UniworkDocError('server_error', {
          serverCode: 'document_access_rejected',
          status: 422,
          rejected: [...rejected],
        })
      }),
    })
    expect(await service(client).folderContentsAccess(REQUEST)).toEqual({
      ok: false,
      error: 'document_access_rejected',
      status: 422,
      rejected: [...rejected],
    })
  })

  it('folder_access_batch_running carries the batch id of the run that holds the folder', async () => {
    const running = (fields?: Record<string, unknown>) =>
      fakeClient({
        updateFolderContentsAccess: vi.fn(async () => {
          throw refusal('folder_access_batch_running', 409, fields)
        }),
      })
    expect(await service(running({ batch_id: 'b_9' })).folderContentsAccess(REQUEST)).toEqual({
      ok: false,
      error: 'folder_access_batch_running',
      status: 409,
      batchId: 'b_9',
    })
    // an id that is not an id (or none) is not passed on; the refusal still stands
    for (const fields of [undefined, { batch_id: '' }, { batch_id: '../x' }, { batch_id: 7 }]) {
      const res = await service(running(fields)).folderContentsAccess(REQUEST)
      expect(res).toEqual({ ok: false, error: 'folder_access_batch_running', status: 409 })
    }
  })

  it('a batchId never rides another refusal', async () => {
    const client = fakeClient({
      updateFolderContentsAccess: vi.fn(async () => {
        throw refusal('not_a_folder', 422, { batch_id: 'b_9' })
      }),
    })
    expect(await service(client).folderContentsAccess(REQUEST)).not.toHaveProperty('batchId')
  })

  it('403 is forbidden, a coded 404 is not_found', async () => {
    expect(
      await service(
        fakeClient({
          updateFolderContentsAccess: vi.fn(async () => {
            throw new UniworkDocError('forbidden', { status: 403, serverCode: 'forbidden' })
          }),
        }),
      ).folderContentsAccess(REQUEST),
    ).toMatchObject({ ok: false, error: 'forbidden', status: 403 })
    expect(
      await service(
        fakeClient({
          getFolderContentsAccessBatch: vi.fn(async () => {
            throw new UniworkDocError('not_found', { status: 404, serverCode: 'not_found' })
          }),
        }),
      ).folderContentsAccessBatch({ folderId: 'fld_1', batchId: 'b_1' }),
    ).toEqual({ ok: false, error: 'not_found', status: 404 })
  })

  it('a dry run is repeated once after any throttle, a write after a 429 only (a 503 may follow the commit)', async () => {
    const throttled = (status: number) => new UniworkDocError('server_error', { status })
    const retried = (status: number, dryRun: boolean) => {
      const call = vi
        .fn<UniworkShareClient['updateFolderContentsAccess']>()
        .mockRejectedValueOnce(throttled(status))
        .mockResolvedValueOnce({ kind: 'background', batchId: 'b', total: 1 })
      return service(fakeClient({ updateFolderContentsAccess: call }))
        .folderContentsAccess({ ...REQUEST, dryRun })
        .then((res) => ({ res, calls: call.mock.calls.length }))
    }
    expect(await retried(429, true)).toMatchObject({ res: { ok: true }, calls: 2 })
    expect(await retried(503, true)).toMatchObject({ res: { ok: true }, calls: 2 })
    expect(await retried(429, false)).toMatchObject({ res: { ok: true }, calls: 2 })
    expect(await retried(503, false)).toMatchObject({
      res: { ok: false, error: 'server_error', retryable: true },
      calls: 1,
    })
  })

  it('a server without the routes (envelope-less 404 / 405 / 501) is endpointMissing, a coded 404 is not', async () => {
    for (const status of [404, 405, 501]) {
      const thrown = new UniworkDocError('server_error', { status })
      const client = fakeClient({
        updateFolderContentsAccess: vi.fn(async () => {
          throw thrown
        }),
        getFolderContentsAccessBatch: vi.fn(async () => {
          throw thrown
        }),
      })
      const svc = service(client)
      expect(await svc.folderContentsAccess(REQUEST)).toMatchObject({
        ok: false,
        endpointMissing: true,
        status,
      })
      expect(
        await svc.folderContentsAccessBatch({ folderId: 'fld_1', batchId: 'b_1' }),
      ).toMatchObject({ ok: false, endpointMissing: true, status })
    }
    const coded = fakeClient({
      updateFolderContentsAccess: vi.fn(async () => {
        throw new UniworkDocError('not_found', { status: 404, serverCode: 'not_found' })
      }),
    })
    expect(await service(coded).folderContentsAccess(REQUEST)).not.toHaveProperty('endpointMissing')
  })

  it('the batch read validates its ids and answers the progress', async () => {
    const client = fakeClient()
    const svc = service(client)
    for (const input of [
      null,
      {},
      { folderId: 'fld_1' },
      { folderId: '', batchId: 'b' },
      { batchId: 'b' },
    ]) {
      expect(await svc.folderContentsAccessBatch(input as never)).toEqual({
        ok: false,
        error: 'invalid_request',
      })
    }
    expect(client.getFolderContentsAccessBatch).not.toHaveBeenCalled()
    expect(
      await svc.folderContentsAccessBatch({ folderId: 'fld_1', batchId: 'b_1' }),
    ).toMatchObject({
      ok: true,
      value: { batchId: 'b_1', status: 'running', processed: 200, total: 900 },
    })
    expect(client.getFolderContentsAccessBatch).toHaveBeenCalledWith('fld_1', 'b_1')
  })

  it('a malformed answer reaches the caller as malformed_response', async () => {
    const client = fakeClient({
      getFolderContentsAccessBatch: vi.fn(async () => {
        throw new UniworkDocError('malformed_response')
      }),
    })
    expect(
      await service(client).folderContentsAccessBatch({ folderId: 'fld_1', batchId: 'b_1' }),
    ).toEqual({ ok: false, error: 'malformed_response' })
  })
})

describe('folder contents access through the real client (UNI-2244)', () => {
  const ORIGIN = 'https://uniwork.example'
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  function through(answer: Response) {
    const fetch = vi.fn<FetchLike>(async () => answer.clone())
    return service(
      createUniworkShareClient({
        apiOrigin: ORIGIN,
        authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
        isSignedIn: () => true,
        fetch,
      }),
    )
  }
  const req = {
    folderId: 'fld_1',
    mode: 'replace',
    items: [{ principalType: 'workspace', principalId: 'ws_1', level: 'view' }],
    dryRun: false,
  } as const

  it('409 folder_access_batch_running with fields.batch_id gives the id to attach to', async () => {
    const svc = through(
      json(409, {
        error: { code: 'folder_access_batch_running', message: 'x', fields: { batch_id: 'b_7' } },
      }),
    )
    expect(await svc.folderContentsAccess(req)).toEqual({
      ok: false,
      error: 'folder_access_batch_running',
      status: 409,
      batchId: 'b_7',
    })
  })

  it('422 not_a_folder and 422 document_access_rejected keep their codes', async () => {
    expect(
      await through(
        json(422, { error: { code: 'not_a_folder', message: 'x' } }),
      ).folderContentsAccess(req),
    ).toEqual({ ok: false, error: 'not_a_folder', status: 422 })
    const rejected = await through(
      json(422, {
        error: {
          code: 'document_access_rejected',
          message: 'x',
          fields: {
            rejected: [
              {
                index: 0,
                principal_type: 'workspace',
                principal_id: 'ws_1',
                code: 'level_not_allowed',
              },
            ],
          },
        },
      }),
    ).folderContentsAccess(req)
    expect(rejected).toEqual({
      ok: false,
      error: 'document_access_rejected',
      status: 422,
      rejected: [
        { index: 0, principalType: 'workspace', principalId: 'ws_1', code: 'level_not_allowed' },
      ],
    })
  })

  it('202 is a background run, 200 a dry run, a foreign batch is 404', async () => {
    expect(
      await through(
        json(202, { batch_id: 'b_2', mode: 'background', total: 900 }),
      ).folderContentsAccess(req),
    ).toEqual({ ok: true, value: { kind: 'background', batchId: 'b_2', total: 900 } })
    expect(
      await through(
        json(200, {
          total: 3,
          preview: {
            changed: 3,
            unchanged: 0,
            skipped_not_manageable: 0,
            skipped_locked: 0,
            losing_users: 0,
            downgraded_users: 0,
            warnings: [],
          },
        }),
      ).folderContentsAccess({ ...req, dryRun: true }),
    ).toMatchObject({ ok: true, value: { kind: 'dryRun', total: 3 } })
    expect(
      await through(
        json(404, { error: { code: 'not_found', message: 'x' } }),
      ).folderContentsAccessBatch({
        folderId: 'fld_1',
        batchId: 'b_1',
      }),
    ).toEqual({ ok: false, error: 'not_found', status: 404 })
  })
})
