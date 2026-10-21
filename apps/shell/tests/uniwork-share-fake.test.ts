import { describe, expect, it } from 'vitest'
import { createFakeShareApi } from '../src/renderer/src/uniwork-share/fake-share-api'
import type { ShareAccess, ShareUpdate } from '../src/shared/share-api'

/**
 * UNI-2047 SD-A: the in-memory fake the SD-B / SD-C / SD-D renderer tests run
 * against. It must behave like the server where the dialog depends on it: the
 * manager / viewer split, atomic updates with per-item rejections, a dry run that
 * writes nothing, the link policy and limit, and a request that can be handled once.
 */

const DOC = 'doc_1'

function ok<T>(result: { ok: boolean }): T {
  expect(result.ok).toBe(true)
  return (result as unknown as { value: T }).value
}

describe('createFakeShareApi: the seeded document', () => {
  it('shows a manager the owner, 2-3 people, the workspace row, one link', async () => {
    const api = createFakeShareApi()
    const access = ok<ShareAccess>(await api.get(DOC))
    expect(access.myLevel).toBe('manage')
    expect(access.owner).toMatchObject({ level: 'manage' })
    expect(access.shares!.filter((s) => s.principalType === 'user').length).toBeGreaterThanOrEqual(
      2,
    )
    expect(access.shares!.filter((s) => s.principalType === 'user').length).toBeLessThanOrEqual(3)
    expect(access.homeWorkspace).toMatchObject({ workspaceId: 'ws_1', level: 'view' })
    expect(access.links).toHaveLength(1)
  })

  it('shows a viewer only their own level (the manager parts are absent)', async () => {
    const api = createFakeShareApi({ myLevel: 'edit' })
    const access = ok<ShareAccess>(await api.get(DOC))
    expect(access.myLevel).toBe('edit')
    expect(access.shares).toBeUndefined()
    expect(access.links).toBeUndefined()
    expect(access.owner).toBeUndefined()
  })

  it('an admin with no level administers the document (admin_scope)', async () => {
    const api = createFakeShareApi({ myLevel: '', adminScope: true })
    const access = ok<ShareAccess>(await api.get(DOC))
    expect(access).toMatchObject({ myLevel: '', adminScope: true })
    expect(access.shares).toBeDefined()
  })

  it('an unknown document is not_found', async () => {
    const api = createFakeShareApi()
    expect(await api.get('nope')).toEqual({ ok: false, error: 'not_found' })
  })
})

describe('candidates', () => {
  it('searches by name or secondary line and annotates the existing direct level', async () => {
    const api = createFakeShareApi()
    const all = ok<{
      items: Array<{ name: string; principalType: string; directLevel: string | null }>
    }>(await api.candidates({ documentId: DOC }))
    expect(all.items.length).toBeGreaterThan(3)
    expect(all.items.some((c) => c.principalType === 'workspace')).toBe(true)
    expect(all.items.some((c) => c.principalType === 'organization')).toBe(true)
    const found = ok<{ items: Array<{ name: string; directLevel: string | null }> }>(
      await api.candidates({ documentId: DOC, q: 'MINH' }),
    )
    expect(found.items).toHaveLength(1)
    expect(found.items[0]).toMatchObject({ directLevel: 'edit' })
  })

  it('pages with a cursor', async () => {
    const api = createFakeShareApi()
    const first = ok<{ items: unknown[]; nextCursor: string }>(
      await api.candidates({ documentId: DOC, limit: 2 }),
    )
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBe('')
    const second = ok<{ items: unknown[]; nextCursor: string }>(
      await api.candidates({ documentId: DOC, limit: 2, cursor: first.nextCursor }),
    )
    expect(second.items.length).toBeGreaterThan(0)
  })
})

describe('update', () => {
  it('a dry run previews before / after and writes nothing', async () => {
    const api = createFakeShareApi()
    const before = ok<ShareAccess>(await api.get(DOC))
    const preview = ok<ShareUpdate>(
      await api.update({
        documentId: DOC,
        dryRun: true,
        items: [
          { principalType: 'user', principalId: 'u_minh', level: 'view' },
          { principalType: 'organization', principalId: 'org_1', level: 'view' },
        ],
      }),
    )
    expect(preview.dryRun).toBe(true)
    expect(preview.preview.users[0]).toMatchObject({
      userId: 'u_minh',
      before: { level: 'edit' },
      after: { level: 'view' },
    })
    expect(preview.preview.groups[0]).toMatchObject({
      principalType: 'organization',
      principalId: 'org_1',
    })
    expect(preview.preview.warnings.map((w) => w.code).sort()).toEqual(['downgrade', 'wide_scope'])
    expect(ok<ShareAccess>(await api.get(DOC))).toEqual(before)
  })

  it('a write grants, updates, revokes, keeps and reports each item', async () => {
    const api = createFakeShareApi()
    const res = ok<ShareUpdate>(
      await api.update({
        documentId: DOC,
        items: [
          { principalType: 'user', principalId: 'u_binh', level: 'comment' },
          { principalType: 'user', principalId: 'u_minh', level: 'manage', onExisting: 'update' },
          { principalType: 'user', principalId: 'u_an', level: null },
          { principalType: 'user', principalId: 'u_chi', level: 'view' },
          { principalType: 'user', principalId: 'u_minh2', level: 'view' },
        ].slice(0, 4),
      }),
    )
    expect(res.results.map((r) => r.status)).toEqual(['granted', 'updated', 'revoked', 'granted'])
    const access = ok<ShareAccess>(await api.get(DOC))
    const level = (id: string) => access.shares!.find((s) => s.principalId === id)?.level
    expect(level('u_binh')).toBe('comment')
    expect(level('u_minh')).toBe('manage')
    expect(level('u_an')).toBeUndefined()
  })

  it('on_existing keep leaves an existing grant, and the same level is unchanged', async () => {
    const api = createFakeShareApi()
    const res = ok<ShareUpdate>(
      await api.update({
        documentId: DOC,
        items: [
          { principalType: 'user', principalId: 'u_minh', level: 'view', onExisting: 'keep' },
          { principalType: 'user', principalId: 'u_an', level: 'comment' },
        ],
      }),
    )
    expect(res.results.map((r) => r.status)).toEqual(['kept', 'unchanged'])
    const access = ok<ShareAccess>(await api.get(DOC))
    expect(access.shares!.find((s) => s.principalId === 'u_minh')!.level).toBe('edit')
  })

  it('setting the workspace row moves the home-workspace level', async () => {
    const api = createFakeShareApi()
    await api.update({
      documentId: DOC,
      items: [{ principalType: 'workspace', principalId: 'ws_1', level: 'edit' }],
    })
    expect(ok<ShareAccess>(await api.get(DOC)).homeWorkspace).toMatchObject({ level: 'edit' })
    await api.update({
      documentId: DOC,
      items: [{ principalType: 'workspace', principalId: 'ws_1', level: null }],
    })
    expect(ok<ShareAccess>(await api.get(DOC)).homeWorkspace).toMatchObject({ level: null })
  })

  it('rejects atomically with per-item codes: outsider, level not allowed, duplicate', async () => {
    const api = createFakeShareApi()
    const before = ok<ShareAccess>(await api.get(DOC))
    const res = await api.update({
      documentId: DOC,
      items: [
        { principalType: 'user', principalId: 'u_outsider', level: 'view' },
        { principalType: 'workspace', principalId: 'ws_1', level: 'manage' },
        { principalType: 'user', principalId: 'u_binh', level: 'view' },
        { principalType: 'user', principalId: 'u_binh', level: 'edit' },
      ],
    })
    expect(res).toEqual({
      ok: false,
      error: 'document_access_rejected',
      status: 422,
      rejected: [
        {
          index: 0,
          principalType: 'user',
          principalId: 'u_outsider',
          code: 'principal_not_in_organization',
        },
        { index: 1, principalType: 'workspace', principalId: 'ws_1', code: 'level_not_allowed' },
        { index: 3, principalType: 'user', principalId: 'u_binh', code: 'duplicate_principal' },
      ],
    })
    expect(ok<ShareAccess>(await api.get(DOC))).toEqual(before)
  })

  it('a viewer cannot write: forbidden', async () => {
    const api = createFakeShareApi({ myLevel: 'edit' })
    expect(
      await api.update({
        documentId: DOC,
        items: [{ principalType: 'user', principalId: 'u_binh', level: 'view' }],
      }),
    ).toMatchObject({ ok: false, error: 'forbidden', status: 403 })
  })
})

describe('links and the policy', () => {
  it('creates a link with a one-time url, then revokes it; revoking a stranger is not_found', async () => {
    const api = createFakeShareApi()
    const created = ok<{ link: { id: string }; url: string; token: string }>(
      await api.linkCreate({ documentId: DOC, expiresInDays: 7 }),
    )
    expect(created.url).toContain(created.token)
    expect(ok<ShareAccess>(await api.get(DOC)).links).toHaveLength(2)
    expect(await api.linkRevoke({ documentId: DOC, linkId: created.link.id })).toEqual({
      ok: true,
      value: { documentId: DOC, linkId: created.link.id },
    })
    expect(ok<ShareAccess>(await api.get(DOC)).links).toHaveLength(1)
    expect(await api.linkRevoke({ documentId: DOC, linkId: 'ln_nope' })).toEqual({
      ok: false,
      error: 'not_found',
    })
  })

  it('refuses a link when the organization switch is off, and past the limit', async () => {
    const off = createFakeShareApi({ publicLinksEnabled: false })
    expect(await off.linkCreate({ documentId: DOC })).toMatchObject({
      ok: false,
      error: 'document_links_disabled',
    })
    expect(ok<{ publicLinksEnabled: boolean }>(await off.settings()).publicLinksEnabled).toBe(false)
    const capped = createFakeShareApi({ maxLinks: 1 })
    expect(await capped.linkCreate({ documentId: DOC })).toMatchObject({
      ok: false,
      error: 'document_link_limit',
    })
  })
})

describe('access requests', () => {
  it('lists the pending request; approving grants the requested level once', async () => {
    const api = createFakeShareApi()
    const rows = ok<Array<{ id: string; requestedLevel: string; requesterId: string }>>(
      await api.requests(DOC),
    )
    expect(rows).toHaveLength(1)
    const decision = ok<{ status: string; shareId: string }>(
      await api.requestApprove({ documentId: DOC, requestId: rows[0]!.id }),
    )
    expect(decision.status).toBe('approved')
    expect(decision.shareId).not.toBe('')
    const access = ok<ShareAccess>(await api.get(DOC))
    expect(access.shares!.find((s) => s.principalId === rows[0]!.requesterId)!.level).toBe(
      rows[0]!.requestedLevel,
    )
    expect(ok<unknown[]>(await api.requests(DOC))).toHaveLength(0)
    expect(await api.requestApprove({ documentId: DOC, requestId: rows[0]!.id })).toMatchObject({
      ok: false,
      error: 'access_request_closed',
    })
  })

  it('approving with a level overrides the request; declining closes it without a grant', async () => {
    const approve = createFakeShareApi()
    const [row] = ok<Array<{ id: string; requesterId: string }>>(await approve.requests(DOC))
    await approve.requestApprove({ documentId: DOC, requestId: row!.id, level: 'comment' })
    expect(
      ok<ShareAccess>(await approve.get(DOC)).shares!.find(
        (s) => s.principalId === row!.requesterId,
      )!.level,
    ).toBe('comment')

    const decline = createFakeShareApi()
    const [again] = ok<Array<{ id: string; requesterId: string }>>(await decline.requests(DOC))
    expect(await decline.requestDecline({ documentId: DOC, requestId: again!.id })).toMatchObject({
      ok: true,
      value: { status: 'declined', shareId: '' },
    })
    expect(
      ok<ShareAccess>(await decline.get(DOC)).shares!.some(
        (s) => s.principalId === again!.requesterId,
      ),
    ).toBe(false)
  })

  it('a server without the route answers a null list', async () => {
    const api = createFakeShareApi({ requestsAvailable: false })
    expect(await api.requests(DOC)).toEqual({ ok: true, value: null })
  })
})

describe('bulk and the test hooks', () => {
  it('runs a plan per document and reports the ones the fake was told to refuse', async () => {
    const api = createFakeShareApi({ bulkRefuses: { d2: 'forbidden' } })
    const res = ok<{
      ok: string[]
      failed: Array<{ id: string; error: string }>
      links: Array<{ id: string }>
    }>(
      await api.bulk({
        docs: [
          { id: 'd1', workspaceId: 'ws_1' },
          { id: 'd2', workspaceId: 'ws_1' },
        ],
        people: [{ principalType: 'user', principalId: 'u_binh', level: 'view' }],
        onExisting: 'keep',
        workspace: 'keep',
        link: 'create',
        expiresInDays: 7,
      }),
    )
    expect(res.ok).toEqual(['d1'])
    expect(res.failed).toEqual([{ id: 'd2', error: 'forbidden' }])
    expect(res.links.map((l) => l.id)).toEqual(['d1'])
  })

  it('records every call, and failNext makes the next call of that method fail once', async () => {
    const api = createFakeShareApi()
    api.failNext('get', { ok: false, error: 'network' })
    expect(await api.get(DOC)).toEqual({ ok: false, error: 'network' })
    expect(ok<ShareAccess>(await api.get(DOC)).myLevel).toBe('manage')
    expect(api.calls.map((c) => c.method)).toEqual(['get', 'get'])
    expect(api.calls[0]!.args).toEqual([DOC])
  })
})

describe('break-glass and members', () => {
  const REASON = 'Audit of the Q3 numbers'

  it('an administering admin opens a grant that then shows in the overview, and can end it', async () => {
    const api = createFakeShareApi({ adminScope: true, myLevel: '' })
    const grant = ok<{ id: string; reason: string; level: string } | null>(
      await api.breakGlassGrant({ documentId: DOC, reason: REASON }),
    )
    expect(grant).toMatchObject({ reason: REASON, level: 'view' })
    const access = ok<ShareAccess>(await api.get(DOC))
    expect(access.breakGlass).toHaveLength(1)
    ok(await api.breakGlassRevoke({ documentId: DOC, grantId: grant!.id }))
    expect(ok<ShareAccess>(await api.get(DOC)).breakGlass).toEqual([])
  })

  it('refuses a reason outside 10-500 characters like the server (422) and a non-admin (403)', async () => {
    const admin = createFakeShareApi({ adminScope: true, myLevel: '' })
    expect(await admin.breakGlassGrant({ documentId: DOC, reason: 'short' })).toMatchObject({
      ok: false,
      error: 'break_glass_reason_invalid',
      status: 422,
    })
    expect(await admin.breakGlassGrant({ documentId: DOC, reason: 'x'.repeat(501) })).toMatchObject(
      {
        ok: false,
        error: 'break_glass_reason_invalid',
      },
    )
    const manager = createFakeShareApi()
    expect(await manager.breakGlassGrant({ documentId: DOC, reason: REASON })).toMatchObject({
      ok: false,
      error: 'forbidden',
      status: 403,
    })
    expect(await admin.breakGlassRevoke({ documentId: DOC, grantId: 'nope' })).toMatchObject({
      ok: false,
      error: 'not_found',
    })
  })

  it('members pages the organization (people with names, the owner included)', async () => {
    const api = createFakeShareApi()
    const first = ok<{ members: { userId: string; displayName: string }[]; nextCursor: string }>(
      await api.members({ limit: 3 }),
    )
    expect(first.members).toHaveLength(3)
    expect(first.nextCursor).not.toBe('')
    const all = ok<{ members: { userId: string; displayName: string }[]; nextCursor: string }>(
      await api.members({}),
    )
    expect(all.nextCursor).toBe('')
    expect(all.members.map((m) => m.userId)).toEqual(
      expect.arrayContaining(['u_owner', 'u_minh', 'u_an']),
    )
    expect(all.members.find((m) => m.userId === 'u_minh')!.displayName).toBe('Minh Trần')
  })
})
