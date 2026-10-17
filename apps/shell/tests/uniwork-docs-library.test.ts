import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import type { FetchLike } from '../src/main/uniwork-docs/client'

/**
 * G8-16 S17: shared-with-me aggregation, the properties panel and the
 * per-workspace role. The D routes are per workspace / per document, so these
 * tests drive the real HTTP client against a small fake server and assert the
 * calls, the merge/sort and the "—" (null) cases.
 */

const ORIGIN = 'https://uniwork.example'
const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const TOKEN = 'tok'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Call {
  path: string
  query: string
}

/** a small UniWork documents server: workspaces, roles, shared-with-me, members, document */
function fakeServer(options: {
  workspaces?: Array<{ id: string; name: string; organization_id?: string }>
  roles?: Record<string, string | null>
  shared?: Record<string, { documents: unknown[]; next_cursor?: string | null }>
  members?: Array<{ user_id: string; display_name: string }>
  document?: Record<string, unknown>
  fail?: 'members' | 'role' | 'shared'
}) {
  const calls: Call[] = []
  const state = { members: options.members ?? [] }
  const fetch = vi.fn(async (url: string, _init: RequestInit): Promise<Response> => {
    const u = new URL(url)
    calls.push({ path: u.pathname, query: u.search })
    const p = u.pathname
    if (p === '/api/v1/orgs/org_a/workspaces') {
      return json(200, {
        workspaces: options.workspaces ?? [
          { id: 'ws_1', name: 'Team' },
          { id: 'ws_2', name: 'Sales' },
        ],
      })
    }
    const roleMatch = /^\/api\/v1\/workspaces\/([^/]+)\/me$/.exec(p)
    if (roleMatch) {
      if (options.fail === 'role') return json(500, { error: { code: 'server_error' } })
      const id = roleMatch[1]!
      const role = options.roles?.[id] ?? 'member'
      return role === null
        ? json(200, { membership: {} })
        : json(200, { membership: { user_id: 'u1', role, source: 'membership' } })
    }
    const sharedMatch = /^\/api\/v1\/workspaces\/([^/]+)\/documents\/shared-with-me$/.exec(p)
    if (sharedMatch) {
      if (options.fail === 'shared') return json(500, { error: { code: 'server_error' } })
      const ws = sharedMatch[1]!
      const page = options.shared?.[ws] ?? { documents: [] }
      return json(200, { documents: page.documents, next_cursor: page.next_cursor ?? null })
    }
    if (p === '/api/v1/orgs/acme/members') {
      if (options.fail === 'members') return json(500, { error: { code: 'server_error' } })
      // page like D: default 50 rows, opaque offset cursor `m:<n>`
      const limit = Math.min(100, Math.max(1, Number(u.searchParams.get('limit')) || 50))
      const raw = u.searchParams.get('cursor')
      const offset = raw && /^m:(\d+)$/.test(raw) ? Number(raw.slice(2)) : 0
      const slice = state.members.slice(offset, offset + limit)
      const next = offset + limit < state.members.length ? `m:${offset + limit}` : null
      return json(200, { members: slice, next_cursor: next })
    }
    const docMatch = /^\/api\/v1\/documents\/([A-Za-z0-9_-]+)$/.exec(p)
    if (docMatch) {
      // echo the requested id so one fake serves several documents
      return json(200, { document: { ...(options.document ?? {}), id: docMatch[1]! } })
    }
    return json(404, { error: { code: 'not_found' } })
  })
  return {
    fetch: fetch as unknown as FetchLike,
    calls,
    get members() {
      return state.members
    },
    set members(next: Array<{ user_id: string; display_name: string }>) {
      state.members = next
    },
  }
}

function serviceWith(
  server: ReturnType<typeof fakeServer>,
  org: { id: string; slug: string } | null = { id: 'org_a', slug: 'acme' },
  fetchOverride?: FetchLike,
) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-docs-library-'))
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  const service = new UniworkDocsService({
    userDataDir: dir,
    profile: () => profile,
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    keystoreLocked: () => false,
    selectedOrg: () => org,
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    fetch: fetchOverride ?? server.fetch,
    openPath: () => true,
    isPathOpen: () => false,
    requestModuleSave: () => false,
    reloadPath: () => undefined,
    activePath: () => undefined,
    ui,
    pushStatus: () => undefined,
    pushLaunch: () => undefined,
    reveal: () => undefined,
  })
  return { service, dir }
}

const membersCalls = (server: ReturnType<typeof fakeServer>): number =>
  server.calls.filter((c) => c.path === '/api/v1/orgs/acme/members').length

/**
 * A service whose members list answers `answer` (a status/code, or a thrown
 * network error); every other route works, so the properties panel still
 * returns ok:true with null names. `setAnswer` changes it between calls.
 */
function serviceWithFailingMembers(answer: { status: number; code: string } | 'network') {
  const server = fakeServer({
    document: {
      id: 'd1',
      workspace_id: 'ws_1',
      title: 'P.docx',
      kind: 'file',
      revision: '1',
      current_version: 3,
      my_level: 'edit',
      owner_kind: 'human',
      owner_id: 'u_owner',
      created_by: 'u_creator',
      updated_by: 'u_updater',
    },
  })
  let current = answer
  const inner = server.fetch
  const fetch = (async (url: string, init: RequestInit) => {
    if (new URL(url).pathname === '/api/v1/orgs/acme/members') {
      // a 200 delegates to the real route, which records the call itself
      if (current.status === 200 && current !== 'network') return inner(url, init)
      server.calls.push({ path: '/api/v1/orgs/acme/members', query: '' })
      if (current === 'network') throw new TypeError('fetch failed')
      return json(current.status, { error: { code: current.code } })
    }
    return inner(url, init)
  }) as typeof inner
  const dir = mkdtempSync(join(tmpdir(), 'uw-docs-library-'))
  const service = new UniworkDocsService({
    userDataDir: dir,
    profile: () => profile,
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    keystoreLocked: () => false,
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    fetch,
    openPath: () => true,
    isPathOpen: () => false,
    requestModuleSave: () => false,
    reloadPath: () => undefined,
    activePath: () => undefined,
    ui: {
      chooseConflict: async () => 'later',
      confirmDiscard: async () => false,
      pickCopyPath: async () => null,
      showOpenLatestFailed: () => undefined,
      showCopyFailed: () => undefined,
      chooseUnsavedClose: async () => 'cancel',
    },
    pushStatus: () => undefined,
    pushLaunch: () => undefined,
    reveal: () => undefined,
  })
  return {
    service,
    server,
    setAnswer: (next: { status: number; code: string } | 'network') => {
      current = next
    },
  }
}

const docRow = (id: string, ws: string, title: string, updatedAt: string) => ({
  id,
  kind: 'file',
  workspace_id: ws,
  title,
  updated_at: updatedAt,
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-docs-library-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('workspaces with my role (S17)', () => {
  it('fills myRole from GET /workspaces/{id}/me, null when the role read fails', async () => {
    const server = fakeServer({
      workspaces: [
        { id: 'ws_1', name: 'Team' },
        { id: 'ws_2', name: 'Sales' },
      ],
      roles: { ws_1: 'admin' },
      fail: 'role',
    })
    // fail:'role' fails both; assert the null path in one go
    const { service } = serviceWith(server)
    const result = await service.listWorkspaces()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual([
      { id: 'ws_1', name: 'Team', orgId: 'org_a', slug: '', orgSlug: '', myRole: null },
      { id: 'ws_2', name: 'Sales', orgId: 'org_a', slug: '', orgSlug: '', myRole: null },
    ])
    expect(server.calls.filter((c) => c.path.endsWith('/me'))).toHaveLength(2)
  })

  it('reads each workspace role in parallel and keeps the rows', async () => {
    const server = fakeServer({
      workspaces: [
        { id: 'ws_1', name: 'Team' },
        { id: 'ws_2', name: 'Sales' },
      ],
      roles: { ws_1: 'admin', ws_2: 'member' },
    })
    const { service } = serviceWith(server)
    const result = await service.listWorkspaces()
    expect(result).toEqual({
      ok: true,
      value: [
        { id: 'ws_1', name: 'Team', orgId: 'org_a', slug: '', orgSlug: '', myRole: 'admin' },
        { id: 'ws_2', name: 'Sales', orgId: 'org_a', slug: '', orgSlug: '', myRole: 'member' },
      ],
    })
  })

  it('with no selected org returns an empty list and calls nothing', async () => {
    const server = fakeServer({})
    const { service } = serviceWith(server, null)
    expect(await service.listWorkspaces()).toEqual({ ok: true, value: [] })
    expect(server.calls).toHaveLength(0)
  })
})

describe('shared with me (S17)', () => {
  it('aggregates across the org workspaces, newest first, with workspaceName', async () => {
    const server = fakeServer({
      shared: {
        ws_1: { documents: [docRow('d1', 'ws_1', 'A.docx', '2026-04-01T00:00:00Z')] },
        ws_2: {
          documents: [
            docRow('d2', 'ws_2', 'B.docx', '2026-05-01T00:00:00Z'),
            docRow('d1', 'ws_1', 'A.docx', '2026-04-01T00:00:00Z'),
          ],
        },
      },
    })
    const { service } = serviceWith(server)
    const result = await service.listSharedWithMe()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.nextCursor).toBeNull()
    expect(result.value.documents.map((d) => d.id)).toEqual(['d2', 'd1'])
    expect(result.value.documents.map((d) => d.workspaceName)).toEqual(['Sales', 'Team'])
    expect(result.value.documents[0]).toMatchObject({ workspaceId: 'ws_2', format: 'docx' })
  })

  it('pages locally with an opaque cursor', async () => {
    const docs = Array.from({ length: 60 }, (_, i) =>
      docRow(
        `d${i}`,
        'ws_1',
        `F${i}.docx`,
        `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
      ),
    )
    const server = fakeServer({ shared: { ws_1: { documents: docs } } })
    const { service } = serviceWith(server)
    const first = await service.listSharedWithMe({ limit: 50 })
    expect(first.ok && first.value.documents).toHaveLength(50)
    const cursor = first.ok ? first.value.nextCursor : null
    expect(cursor).toBe('shared:50')
    const second = await service.listSharedWithMe({ limit: 50, cursor: cursor ?? undefined })
    expect(second.ok && second.value.documents).toHaveLength(10)
    expect(second.ok && second.value.nextCursor).toBeNull()
  })

  it('an empty account gets an empty page, not an error', async () => {
    const server = fakeServer({ shared: {} })
    const { service } = serviceWith(server)
    expect(await service.listSharedWithMe()).toEqual({
      ok: true,
      value: { documents: [], nextCursor: null },
    })
  })
})

describe('document properties (S17)', () => {
  const document = {
    id: 'd1',
    workspace_id: 'ws_1',
    title: 'Plan.docx',
    kind: 'file',
    revision: '41',
    current_version: 3,
    my_level: 'edit',
    owner_kind: 'work_product',
    owner_id: 'u_owner',
    created_by: 'u_creator',
    created_by_kind: 'human',
    created_at: '2026-03-01T09:00:00Z',
    updated_by: 'u_updater',
    updated_by_kind: 'human',
    updated_at: '2026-04-01T09:00:00Z',
  }

  it('resolves a member id to a name', async () => {
    const server = fakeServer({
      document: { ...document, owner_kind: 'human' },
      members: [
        { user_id: 'u_owner', display_name: 'Owner Name' },
        { user_id: 'u_creator', display_name: 'Creator Name' },
        { user_id: 'u_updater', display_name: 'Updater Name' },
      ],
    })
    const { service } = serviceWith(server)
    const result = await service.documentProperties('d1')
    expect(result).toEqual({
      ok: true,
      value: {
        documentId: 'd1',
        workspaceId: 'ws_1',
        title: 'Plan.docx',
        ownerName: 'Owner Name',
        createdByName: 'Creator Name',
        createdAt: '2026-03-01T09:00:00Z',
        updatedByName: 'Updater Name',
        updatedAt: '2026-04-01T09:00:00Z',
        myLevel: 'edit',
        version: 3,
        // D sends no per-version updater: never derived from updated_by
        versionByName: null,
        ownerId: 'u_owner',
        createdById: 'u_creator',
        updatedById: 'u_updater',
      },
    })
  })

  it('an id that is not a member resolves to null (person left / non-human)', async () => {
    const server = fakeServer({
      document: { ...document, owner_kind: 'work_product' },
      // the creator/updater ids are absent from the list; the owner is not a person
      members: [{ user_id: 'someone_else', display_name: 'Else' }],
    })
    const { service } = serviceWith(server)
    const result = await service.documentProperties('d1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ownerName).toBeNull()
    expect(result.value.createdByName).toBeNull()
    expect(result.value.updatedByName).toBeNull()
    // the raw ids stay available for the renderer
    expect(result.value.ownerId).toBe('u_owner')
    expect(result.value.updatedById).toBe('u_updater')
  })

  it('versionByName stays null even when updated_by resolves to a member', async () => {
    const server = fakeServer({
      document: { ...document, owner_kind: 'human' },
      members: [{ user_id: 'u_updater', display_name: 'Updater Name' }],
    })
    const { service } = serviceWith(server)
    const result = await service.documentProperties('d1')
    expect(result.ok && result.value.updatedByName).toBe('Updater Name')
    expect(result.ok && result.value.versionByName).toBeNull()
  })

  it('a 5xx members answer is null names, never cached, and the next open retries', async () => {
    const ctx = serviceWithFailingMembers({ status: 500, code: 'server_error' })
    const first = await ctx.service.documentProperties('d1')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.ownerName).toBeNull()
    expect(first.value.createdByName).toBeNull()
    expect(first.value.updatedByName).toBeNull()
    // the server-sent facts still ride through, no error result
    expect(first.value.myLevel).toBe('edit')
    expect(first.value.version).toBe(3)
    expect(membersCalls(ctx.server)).toBe(1)

    // a 5xx is not cached: the next panel open calls again
    ctx.setAnswer({ status: 200, code: '' })
    // the fake's members route only answers errors; point it at a real list
    ctx.server.members = [{ user_id: 'u_creator', display_name: 'Creator Name' }]
    const second = await ctx.service.documentProperties('d1')
    expect(membersCalls(ctx.server)).toBe(2)
    expect(second.ok && second.value.createdByName).toBe('Creator Name')
  })

  it('a network error is null names, never cached, and the next open retries', async () => {
    const ctx = serviceWithFailingMembers('network')
    const first = await ctx.service.documentProperties('d1')
    expect(first.ok && first.value.updatedByName).toBeNull()
    expect(membersCalls(ctx.server)).toBe(1)
    ctx.setAnswer({ status: 200, code: '' })
    ctx.server.members = [{ user_id: 'u_updater', display_name: 'Updater Name' }]
    const second = await ctx.service.documentProperties('d1')
    expect(membersCalls(ctx.server)).toBe(2)
    expect(second.ok && second.value.updatedByName).toBe('Updater Name')
  })

  it('a 403 from the members list is null names, never an error result, and IS cached', async () => {
    const { service, server } = serviceWithFailingMembers({ status: 403, code: 'forbidden' })
    const result = await service.documentProperties('d1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ownerName).toBeNull()
    expect(result.value.createdByName).toBeNull()
    expect(result.value.updatedByName).toBeNull()
    // a 403 is a stable answer: cached as "names unavailable for this org"
    await service.documentProperties('d2')
    expect(membersCalls(server)).toBe(1)
  })

  it('a 404 from the members list is null names, never an error result, and IS cached', async () => {
    const { service, server } = serviceWithFailingMembers({ status: 404, code: 'not_found' })
    const result = await service.documentProperties('d1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.createdByName).toBeNull()
    await service.documentProperties('d2')
    expect(membersCalls(server)).toBe(1)
  })

  it('two concurrent panel opens share one members request', async () => {
    const server = fakeServer({
      document: { ...document, owner_kind: 'human' },
      members: [{ user_id: 'u_creator', display_name: 'Creator Name' }],
    })
    // hold the members answer so both panels are in flight together
    const inner = server.fetch
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    let seen = 0
    const fetch = (async (url: string, init: RequestInit) => {
      if (new URL(url).pathname === '/api/v1/orgs/acme/members') {
        seen += 1
        await gate
      }
      return inner(url, init)
    }) as typeof inner
    const { service } = serviceWith(server, { id: 'org_a', slug: 'acme' }, fetch)
    const pending = [service.documentProperties('d1'), service.documentProperties('d2')]
    // let both panels reach the members read before the answer is released
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    const [a, b] = await Promise.all(pending)
    expect(seen).toBe(1)
    expect(a.ok && a.value.createdByName).toBe('Creator Name')
    expect(b.ok && b.value.createdByName).toBe('Creator Name')
  })

  it('the members list is fetched once per org, not once per document', async () => {
    const server = fakeServer({
      document: { ...document, owner_kind: 'human' },
      members: [{ user_id: 'u_creator', display_name: 'Creator Name' }],
    })
    const { service } = serviceWith(server)
    await service.documentProperties('d1')
    await service.documentProperties('d2')
    await service.documentProperties('d3')
    expect(membersCalls(server)).toBe(1)
    // a library reload (the renderer re-reads the workspace list) retries it
    await service.listWorkspaces()
    await service.documentProperties('d4')
    expect(membersCalls(server)).toBe(2)
  })

  it('resolves a member from page 2 of a >100-member org, still one logical read (RBE1-01)', async () => {
    // 120 members: D caps a page at 100 (the largest limit main asks for), so
    // the owner sits on the second page and a single-page read could never
    // resolve it
    const members = Array.from({ length: 120 }, (_, i) => ({
      user_id: `u${i}`,
      display_name: `Member ${i}`,
    }))
    members.push({ user_id: 'u_owner', display_name: 'Owner Name' })
    const server = fakeServer({
      document: { ...document, owner_kind: 'human' },
      members,
    })
    const { service } = serviceWith(server)
    const result = await service.documentProperties('d1')
    expect(result.ok && result.value.ownerName).toBe('Owner Name')
    // one logical read = the pages it took, and only once per org
    const memberCalls = membersCalls(server)
    expect(memberCalls).toBeGreaterThanOrEqual(2)
    await service.documentProperties('d2')
    expect(membersCalls(server)).toBe(memberCalls)
  })

  it('a non-human creator/updater resolves to null with no lookup (RBE1-06)', async () => {
    const server = fakeServer({
      document: {
        ...document,
        owner_kind: 'human',
        created_by_kind: 'agent',
        updated_by_kind: 'system',
      },
      // both ids exist in the member list, so only the kind can make them null
      members: [
        { user_id: 'u_owner', display_name: 'Owner Name' },
        { user_id: 'u_creator', display_name: 'Creator Name' },
        { user_id: 'u_updater', display_name: 'Updater Name' },
      ],
    })
    const { service } = serviceWith(server)
    const result = await service.documentProperties('d1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.createdByName).toBeNull()
    expect(result.value.updatedByName).toBeNull()
    // the human owner still resolves
    expect(result.value.ownerName).toBe('Owner Name')
  })

  it('missing server fields become null, never an error', async () => {
    const server = fakeServer({
      document: { id: 'd1', workspace_id: 'ws_1', title: 'Bare.docx', kind: 'file' },
    })
    const { service } = serviceWith(server)
    const result = await service.documentProperties('d1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      myLevel: null,
      version: null,
      createdAt: null,
      updatedAt: null,
      ownerId: null,
    })
  })
})

describe('member-name cache and org switch (S16)', () => {
  it('drops the cached names when the selected org changes', async () => {
    const server = fakeServer({
      document: {
        id: 'd1',
        workspace_id: 'ws_1',
        title: 'Plan.docx',
        kind: 'file',
        revision: '1',
        current_version: 1,
        updated_by: 'u1',
      },
      members: [{ user_id: 'u1', display_name: 'One' }],
    })
    const org: { id: string; slug: string } | null = { id: 'org_a', slug: 'acme' }
    const dir = mkdtempSync(join(tmpdir(), 'uw-docs-library-'))
    const service = new UniworkDocsService({
      userDataDir: dir,
      profile: () => profile,
      channel: () => 'stable',
      applyProfile: async () => 'unchanged',
      identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
      keystoreLocked: () => false,
      selectedOrg: () => org,
      authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
      fetch: server.fetch,
      openPath: () => true,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      ui: {
        chooseConflict: async () => 'later',
        confirmDiscard: async () => false,
        pickCopyPath: async () => null,
        showOpenLatestFailed: () => undefined,
        showCopyFailed: () => undefined,
        chooseUnsavedClose: async () => 'cancel',
      },
      pushStatus: () => undefined,
      pushLaunch: () => undefined,
      reveal: () => undefined,
    })
    const first = await service.documentProperties('d1')
    expect(first.ok && first.value.updatedByName).toBe('One')
    expect(server.calls.filter((c) => c.path === '/api/v1/orgs/acme/members')).toHaveLength(1)

    // switching orgs drops the map; the next read fetches again
    service.noteSelectedOrg('org_b')
    await service.documentProperties('d1')
    expect(server.calls.filter((c) => c.path === '/api/v1/orgs/acme/members')).toHaveLength(2)
    // sign-out (org -> null) drops it too
    service.noteSelectedOrg(null)
    await service.documentProperties('d1')
    expect(server.calls.filter((c) => c.path === '/api/v1/orgs/acme/members')).toHaveLength(3)
  })

  it('enriches listDocuments, listChildren, searchDocuments, listSharedByMe, and listTrash with workspace member names', async () => {
    let wsMembersCalls = 0
    const fetch: FetchLike = async (url) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/api/v1/workspaces/ws_1/members') {
        wsMembersCalls += 1
        return json(200, {
          members: [
            { user_id: 'u_alice', display_name: 'Alice Nguyen' },
            { user_id: 'u_bob', display_name: 'Bob Tran' },
          ],
        })
      }
      if (
        parsed.pathname === '/api/v1/workspaces/ws_1/documents' ||
        parsed.pathname === '/api/v1/workspaces/ws_1/documents/recent'
      ) {
        return json(200, {
          documents: [
            {
              id: 'doc_1',
              workspace_id: 'ws_1',
              title: 'Spec.docx',
              kind: 'file',
              updated_at: '2026-10-17T08:00:00Z',
              updated_by: 'u_alice',
              visibility: 'workspace',
              my_level: 'edit',
            },
            {
              id: 'doc_2',
              workspace_id: 'ws_1',
              title: 'Notes.docx',
              kind: 'file',
              updated_at: '2026-10-17T07:00:00Z',
              updated_by: 'u_ghost',
              visibility: 'private',
              my_level: 'manage',
            },
          ],
          next_cursor: null,
        })
      }
      return envelope(404, 'not_found')
    }
    const dir = mkdtempSync(join(tmpdir(), 'uw-docs-library-'))
    const service = new UniworkDocsService({
      userDataDir: dir,
      profile: () => profile,
      channel: () => 'stable',
      applyProfile: async () => 'unchanged',
      identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
      keystoreLocked: () => false,
      selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
      authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
      fetch,
      openPath: () => true,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      ui: {
        chooseConflict: async () => 'later',
        confirmDiscard: async () => false,
        pickCopyPath: async () => null,
        showOpenLatestFailed: () => undefined,
        showCopyFailed: () => undefined,
        chooseUnsavedClose: async () => 'cancel',
      },
      pushStatus: () => undefined,
      pushLaunch: () => undefined,
      reveal: () => undefined,
    })

    // Concurrent calls for the same workspace share one in-flight members read
    const [docs, children, search, sharedByMe, trash] = await Promise.all([
      service.listDocuments({ workspaceId: 'ws_1' }),
      service.listChildren({ workspaceId: 'ws_1', parentId: null }),
      service.searchDocuments({ workspaceId: 'ws_1', query: 'Spec', kind: 'all' }),
      service.listSharedByMe({ workspaceId: 'ws_1' }),
      service.listTrash({ workspaceId: 'ws_1' }),
    ])

    expect(wsMembersCalls).toBe(1)

    for (const res of [docs, sharedByMe, trash]) {
      expect(res.ok).toBe(true)
      if (!res.ok) continue
      expect(res.value.documents[0]).toMatchObject({
        id: 'doc_1',
        updatedById: 'u_alice',
        updatedByName: 'Alice Nguyen',
        visibility: 'workspace',
        myLevel: 'edit',
      })
      expect(res.value.documents[1]!.updatedById).toBe('u_ghost')
      expect(res.value.documents[1]!.updatedByName).toBeUndefined()
    }
    for (const res of [children, search]) {
      expect(res.ok).toBe(true)
      if (!res.ok) continue
      expect(res.value.items[0]).toMatchObject({
        id: 'doc_1',
        updatedById: 'u_alice',
        updatedByName: 'Alice Nguyen',
      })
      expect(res.value.items[1]!.updatedByName).toBeUndefined()
    }
  })

  it('caches a failed workspace members read as an empty Map and drops the cache on reload, org change, and account change', async () => {
    let wsMembersCalls = 0
    let shouldFail = true
    let accountId = 'acc_1'
    let currentOrg: { id: string; slug: string } | null = { id: 'org_a', slug: 'acme' }

    const fetch: FetchLike = async (url) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/api/v1/workspaces/ws_1/members') {
        wsMembersCalls += 1
        if (shouldFail) return envelope(500, 'internal_error')
        return json(200, {
          members: [{ user_id: 'u_1', display_name: 'Member One' }],
        })
      }
      if (parsed.pathname === '/api/v1/workspaces/ws_1/documents/recent') {
        return json(200, {
          documents: [
            {
              id: 'doc_1',
              workspace_id: 'ws_1',
              title: 'Plan.docx',
              kind: 'file',
              updated_at: '2026-10-17T08:00:00Z',
              updated_by: 'u_1',
            },
          ],
          next_cursor: null,
        })
      }
      return envelope(404, 'not_found')
    }

    const dir = mkdtempSync(join(tmpdir(), 'uw-docs-library-'))
    const service = new UniworkDocsService({
      userDataDir: dir,
      profile: () => profile,
      channel: () => 'stable',
      applyProfile: async () => 'unchanged',
      identity: () => ({ accountId, deviceSessionId: 'dev_1', deploymentId: 'default' }),
      keystoreLocked: () => false,
      selectedOrg: () => currentOrg,
      authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
      fetch,
      openPath: () => true,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      ui: {
        chooseConflict: async () => 'later',
        confirmDiscard: async () => false,
        pickCopyPath: async () => null,
        showOpenLatestFailed: () => undefined,
        showCopyFailed: () => undefined,
        chooseUnsavedClose: async () => 'cancel',
      },
      pushStatus: () => undefined,
      pushLaunch: () => undefined,
      reveal: () => undefined,
    })

    // First call fails: cached as empty Map, not retried on second call
    const first = await service.listDocuments({ workspaceId: 'ws_1' })
    expect(first.ok && first.value.documents[0]!.updatedByName).toBeUndefined()
    expect(wsMembersCalls).toBe(1)

    shouldFail = false
    const second = await service.listDocuments({ workspaceId: 'ws_1' })
    expect(second.ok && second.value.documents[0]!.updatedByName).toBeUndefined()
    expect(wsMembersCalls).toBe(1)

    // noteLibraryReload drops the cache -> retries and resolves name
    service.noteLibraryReload()
    const third = await service.listDocuments({ workspaceId: 'ws_1' })
    expect(third.ok && third.value.documents[0]!.updatedByName).toBe('Member One')
    expect(wsMembersCalls).toBe(2)

    // org change drops the cache
    currentOrg = { id: 'org_b', slug: 'beta' }
    service.noteSelectedOrg('org_b')
    await service.listDocuments({ workspaceId: 'ws_1' })
    expect(wsMembersCalls).toBe(3)

    // account change drops the cache
    accountId = 'acc_2'
    service.noteSessionIdentity()
    await service.listDocuments({ workspaceId: 'ws_1' })
    expect(wsMembersCalls).toBe(4)
  })

  it('drops in-flight workspace members replies when org or account switches before the read settles (DH1-R1-11d)', async () => {
    let wsMembersCalls = 0
    let accountId = 'acc_1'
    let currentOrg: { id: string; slug: string } | null = { id: 'org_a', slug: 'acme' }

    const pendingMembers: Array<{
      resolve: (members: Array<{ user_id: string; display_name: string }>) => void
    }> = []

    const fetch: FetchLike = async (url) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/api/v1/workspaces/ws_1/members') {
        wsMembersCalls += 1
        const members = await new Promise<Array<{ user_id: string; display_name: string }>>(
          (resolve) => {
            pendingMembers.push({ resolve })
          },
        )
        return json(200, { members })
      }
      if (parsed.pathname === '/api/v1/workspaces/ws_1/documents/recent') {
        return json(200, {
          documents: [
            {
              id: 'doc_1',
              workspace_id: 'ws_1',
              title: 'Plan.docx',
              kind: 'file',
              updated_at: '2026-10-17T08:00:00Z',
              updated_by: 'u_1',
            },
          ],
          next_cursor: null,
        })
      }
      return envelope(404, 'not_found')
    }

    const dir = mkdtempSync(join(tmpdir(), 'uw-docs-library-inflight-'))
    const service = new UniworkDocsService({
      userDataDir: dir,
      profile: () => profile,
      channel: () => 'stable',
      applyProfile: async () => 'unchanged',
      identity: () => ({ accountId, deviceSessionId: 'dev_1', deploymentId: 'default' }),
      keystoreLocked: () => false,
      selectedOrg: () => currentOrg,
      authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
      fetch,
      openPath: () => true,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      ui: {
        chooseConflict: async () => 'later',
        confirmDiscard: async () => false,
        pickCopyPath: async () => null,
        showOpenLatestFailed: () => undefined,
        showCopyFailed: () => undefined,
        chooseUnsavedClose: async () => 'cancel',
      },
      pushStatus: () => undefined,
      pushLaunch: () => undefined,
      reveal: () => undefined,
    })

    // 1. Start a listDocuments call in org_a; wait until /members is in flight
    const callOrgA = service.listDocuments({ workspaceId: 'ws_1' })
    while (pendingMembers.length < 1) {
      await new Promise((r) => setTimeout(r, 1))
    }
    expect(wsMembersCalls).toBe(1)

    // Switch org while org_a's /members read is still in flight
    currentOrg = { id: 'org_b', slug: 'beta' }
    service.noteSelectedOrg('org_b')

    // Now start org_b's listDocuments before org_a's late reply even settles
    const callOrgB = service.listDocuments({ workspaceId: 'ws_1' })
    while (pendingMembers.length < 2) {
      await new Promise((r) => setTimeout(r, 1))
    }
    expect(wsMembersCalls).toBe(2)

    // Resolve org_a's stale reply first, then org_b's reply
    pendingMembers[0]!.resolve([{ user_id: 'u_1', display_name: 'Stale Org A Name' }])
    await callOrgA
    pendingMembers[1]!.resolve([{ user_id: 'u_1', display_name: 'Fresh Org B Name' }])
    const resOrgB = await callOrgB
    expect(resOrgB.ok && resOrgB.value.documents[0]!.updatedByName).toBe('Fresh Org B Name')

    // Subsequent call in org_b uses org_b's cached name, not org_a's late reply
    const cachedOrgB = await service.listDocuments({ workspaceId: 'ws_1' })
    expect(cachedOrgB.ok && cachedOrgB.value.documents[0]!.updatedByName).toBe('Fresh Org B Name')
    expect(wsMembersCalls).toBe(2)

    // 2. Account switch while a members read is in flight
    service.noteLibraryReload()
    const callAcc1 = service.listDocuments({ workspaceId: 'ws_1' })
    while (pendingMembers.length < 3) {
      await new Promise((r) => setTimeout(r, 1))
    }
    expect(wsMembersCalls).toBe(3)

    // Switch account while acc_1's /members read is in flight
    accountId = 'acc_2'
    service.noteSessionIdentity()

    // Late reply from acc_1 resolves after account switch
    pendingMembers[2]!.resolve([{ user_id: 'u_1', display_name: 'Stale Acc 1 Name' }])
    await callAcc1

    // New call under acc_2 must not see Stale Acc 1 Name; it fetches fresh members for acc_2
    const callAcc2 = service.listDocuments({ workspaceId: 'ws_1' })
    while (pendingMembers.length < 4) {
      await new Promise((r) => setTimeout(r, 1))
    }
    expect(wsMembersCalls).toBe(4)
    pendingMembers[3]!.resolve([{ user_id: 'u_1', display_name: 'Fresh Acc 2 Name' }])
    const resAcc2 = await callAcc2
    expect(resAcc2.ok && resAcc2.value.documents[0]!.updatedByName).toBe('Fresh Acc 2 Name')
  })
})
