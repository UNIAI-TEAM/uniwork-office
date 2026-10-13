import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import {
  UniworkDocsService,
  type ConflictUi,
} from '../src/main/uniwork-docs/service'
import { createUniworkDocsClient } from '../src/main/uniwork-docs/client'
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
const ID = /^[A-Za-z0-9_-]{1,128}$/

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
      return json(200, { members: options.members ?? [] })
    }
    if (/^\/api\/v1\/documents\/[A-Za-z0-9_-]+$/.test(p)) {
      return json(200, { document: options.document ?? {} })
    }
    return json(404, { error: { code: 'not_found' } })
  })
  return { fetch: fetch as unknown as FetchLike, calls }
}

function serviceWith(server: ReturnType<typeof fakeServer>, org: { id: string; slug: string } | null = { id: 'org_a', slug: 'acme' }) {
  let dir = mkdtempSync(join(tmpdir(), 'uw-docs-library-'))
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
    fetch: server.fetch,
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
      { id: 'ws_1', name: 'Team', orgId: 'org_a', myRole: null },
      { id: 'ws_2', name: 'Sales', orgId: 'org_a', myRole: null },
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
        { id: 'ws_1', name: 'Team', orgId: 'org_a', myRole: 'admin' },
        { id: 'ws_2', name: 'Sales', orgId: 'org_a', myRole: 'member' },
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
      docRow(`d${i}`, 'ws_1', `F${i}.docx`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`),
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

  it('resolves names through the org member list', async () => {
    const server = fakeServer({
      document,
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
        versionByName: 'Updater Name',
        ownerId: 'u_owner',
        createdById: 'u_creator',
        updatedById: 'u_updater',
      },
    })
  })

  it('leaves names null when the member read fails (the renderer shows "—")', async () => {
    const server = fakeServer({ document, fail: 'members' })
    const { service } = serviceWith(server)
    const result = await service.documentProperties('d1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ownerName).toBeNull()
    expect(result.value.createdByName).toBeNull()
    expect(result.value.updatedByName).toBeNull()
    expect(result.value.versionByName).toBeNull()
    // the server-sent facts still ride through
    expect(result.value.myLevel).toBe('edit')
    expect(result.value.version).toBe(3)
    expect(result.value.createdAt).toBe('2026-03-01T09:00:00Z')
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
    let org: { id: string; slug: string } | null = { id: 'org_a', slug: 'acme' }
    let dir = mkdtempSync(join(tmpdir(), 'uw-docs-library-'))
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
  })
})
