import type { IpcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { registerUniworkWork, type UniworkWorkDeps } from '../src/main/uniwork-work/wiring'
import { UNIWORK_WORK_CHANNELS as C } from '../src/shared/uniwork-work-api'

const PROFILE: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  channel: 'stable',
}
const TOKEN = 'secret-token-8c1d'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const HOME = {
  today: '2026-10-13',
  timezone: 'UTC',
  counts: { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 },
  my_work: [],
  upcoming_meetings: [],
  inbox: [],
  partial: [],
  generated_at: '',
}
const PERSON = {
  user_id: 'acc_1',
  display_name: 'Ada',
  email: 'ada@example.test',
  title: '',
  department: null,
  manager: null,
  timezone: '',
}

type Handler = (event: unknown, ...args: unknown[]) => unknown

/** an IPC event from the shell window's main frame (sender checks live in ipc-sender-guard) */
function shellEvent() {
  const mainFrame = { url: 'app://shell' }
  return { sender: { isDestroyed: () => false, mainFrame }, senderFrame: mainFrame }
}

function setup(
  over: Partial<UniworkWorkDeps> = {},
  fetch: FetchLike = vi.fn<FetchLike>(async () => json(200, HOME)),
) {
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) }
  const openExternal = vi.fn(async (_url: string) => undefined)
  registerUniworkWork(ipc as unknown as IpcMain, {
    profile: () => PROFILE,
    identity: () => ({ accountId: 'acc_1' }),
    org: () => ({ id: 'org_1', slug: 'acme' }),
    authorized: (call) => call(TOKEN),
    openExternal,
    fetch,
    ...over,
  })
  const call = (channel: string, ...args: unknown[]) =>
    Promise.resolve(handlers.get(channel)!(shellEvent(), ...args))
  return { handlers, call, openExternal }
}

describe('uniwork-work IPC', () => {
  it('registers one handler per channel', () => {
    const { handlers } = setup()
    expect([...handlers.keys()].sort()).toEqual(Object.values(C).sort())
  })

  it('answers {ok, value} and never puts the token in a reply', async () => {
    const reply = await setup().call(C.homeSummary, 'ws_1')
    expect(reply).toMatchObject({ ok: true, value: { today: '2026-10-13' } })
    expect(JSON.stringify(reply)).not.toContain(TOKEN)
  })

  it('turns every failure into one of the four work errors', async () => {
    const failing = (fetch: FetchLike) => setup({}, fetch).call(C.myTasks, 'ws_1')
    expect(await setup({ identity: () => null }).call(C.myTasks, 'ws_1')).toEqual({
      ok: false,
      error: 'signed-out',
    })
    expect(await setup({ profile: () => null }).call(C.myTasks, 'ws_1')).toEqual({
      ok: false,
      error: 'signed-out',
    })
    expect(await failing(async () => json(403, { error: { code: 'forbidden' } }))).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(
      await failing(async () => {
        throw new TypeError('fetch failed')
      }),
    ).toEqual({ ok: false, error: 'offline' })
    expect(await failing(async () => json(502, {}))).toEqual({ ok: false, error: 'server' })
    expect(await setup().call(C.createTask, null)).toEqual({ ok: false, error: 'server' })
  })

  it('a non-string id never reaches the network', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, HOME))
    const { call } = setup({}, fetch)
    expect(await call(C.homeSummary, { id: 'ws_1' })).toEqual({ ok: false, error: 'forbidden' })
    expect(await call(C.setTaskStatus, 42, 'done')).toEqual({ ok: false, error: 'forbidden' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('myProfile reads the selected org (by slug) and the signed-in account', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { person: PERSON, reports: [] }))
    expect(await setup({}, fetch).call(C.myProfile)).toMatchObject({
      ok: true,
      value: { user_id: 'acc_1', display_name: 'Ada' },
    })
    expect(fetch.mock.calls[0]![0]).toBe('https://uniwork.example/api/v1/orgs/acme/people/acc_1')
    expect(await setup({ org: () => null }).call(C.myProfile)).toEqual({
      ok: false,
      error: 'server',
    })
  })

  it('openWeb opens only the UniWork pages it builds itself', async () => {
    const { call, openExternal } = setup()
    expect(await call(C.openWeb, { kind: 'task', orgSlug: 'acme', wsSlug: 'eng', id: 't_1' })).toBe(
      true,
    )
    expect(await call(C.openWeb, { kind: 'room', orgSlug: 'acme', wsSlug: 'eng', id: 'm_1' })).toBe(
      true,
    )
    expect(await call(C.openWeb, { kind: 'my-tasks', orgSlug: 'acme', wsSlug: 'eng' })).toBe(true)
    expect(await call(C.openWeb, { kind: 'onboarding' })).toBe(true)
    expect(openExternal.mock.calls.map(([url]) => url)).toEqual([
      'https://uniwork.example/acme/eng/tasks/t_1',
      'https://uniwork.example/acme/eng/meetings/m_1/room',
      'https://uniwork.example/acme/eng/my-tasks',
      'https://uniwork.example/onboarding',
    ])
  })

  it('openWeb builds the document page of a UniNote from slugs and the id', async () => {
    const { call, openExternal } = setup()
    expect(
      await call(C.openWeb, { kind: 'document', orgSlug: 'acme', wsSlug: 'eng', id: '01J8X4DOC' }),
    ).toBe(true)
    expect(openExternal.mock.calls.map(([url]) => url)).toEqual([
      'https://uniwork.example/acme/eng/documents/01J8X4DOC',
    ])
    for (const target of [
      { kind: 'document', orgSlug: 'acme', wsSlug: 'eng' },
      { kind: 'document', orgSlug: 'acme', wsSlug: 'eng', id: '../x' },
      { kind: 'document', orgSlug: 'a/b', wsSlug: 'eng', id: 'd_1' },
    ]) {
      expect(await call(C.openWeb, target)).toBe(false)
    }
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  it('openWeb refuses a bad slug, a missing id, an unknown kind or a URL', async () => {
    const { call, openExternal } = setup()
    for (const target of [
      { kind: 'task', orgSlug: '..', wsSlug: 'eng', id: 't_1' },
      { kind: 'task', orgSlug: 'acme', wsSlug: 'eng' },
      { kind: 'person', orgSlug: 'acme', wsSlug: 'eng', id: 'u/1' },
      { kind: 'constructor', orgSlug: 'acme', wsSlug: 'eng', id: 'x' },
      'https://evil.example',
      null,
    ]) {
      expect(await call(C.openWeb, target)).toBe(false)
    }
    expect(openExternal).not.toHaveBeenCalled()
    expect(await setup({ profile: () => null }).call(C.openWeb, { kind: 'onboarding' })).toBe(false)
  })

  it('openWeb never throws: a profile whose origin cannot be parsed answers false', async () => {
    const bad = { ...PROFILE, apiOrigin: 'not a url' }
    expect(await setup({ profile: () => bad }).call(C.openWeb, { kind: 'onboarding' })).toBe(false)
  })

  it('openWeb and webUrl build Drive hand-off URLs with query strings intact (UNI-2196)', async () => {
    const { call, openExternal } = setup()
    const cases: Array<{ target: unknown; url: string }> = [
      {
        target: { kind: 'drive-pick', orgSlug: 'acme', wsSlug: 'eng' },
        url: 'https://uniwork.example/acme/eng/documents?view=drive&pick=1',
      },
      {
        target: { kind: 'drive-pick', orgSlug: 'acme', wsSlug: 'eng', accountId: 'conn-a' },
        url: 'https://uniwork.example/acme/eng/documents?view=drive&pick=1&account=conn-a',
      },
      {
        target: { kind: 'drive-connect', orgSlug: 'acme', wsSlug: 'eng' },
        url: 'https://uniwork.example/acme/eng/settings?tab=integrations&connect=drive',
      },
      {
        target: { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: 'df-1' },
        url: 'https://uniwork.example/acme/eng/documents/drive/df-1',
      },
      {
        target: {
          kind: 'drive-file',
          orgSlug: 'acme',
          wsSlug: 'eng',
          id: 'df-1',
          action: 'propose',
        },
        url: 'https://uniwork.example/acme/eng/documents/drive/df-1?propose=1',
      },
      {
        target: { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: 'df-1', action: 'ask' },
        url: 'https://uniwork.example/acme/eng/documents/drive/df-1?ask=1',
      },
    ]
    for (const { target, url } of cases) {
      expect(await call(C.webUrl, target)).toBe(url)
      expect(await call(C.openWeb, target)).toBe(true)
    }
    expect(openExternal.mock.calls.map(([url]) => url)).toEqual(cases.map((c) => c.url))
  })

  it('openWeb and webUrl refuse bad Drive slugs, ids, accountIds, actions and types (UNI-2196)', async () => {
    const { call, openExternal } = setup()
    const tooLong = 'a'.repeat(129)
    const badTargets: unknown[] = [
      { kind: 'drive-pick', orgSlug: 'a/b', wsSlug: 'eng' },
      { kind: 'drive-pick', orgSlug: 'acme', wsSlug: '..' },
      { kind: 'drive-pick', orgSlug: 'acme', wsSlug: 'eng', accountId: 'a/b' },
      { kind: 'drive-pick', orgSlug: 'acme', wsSlug: 'eng', accountId: 'x?y' },
      { kind: 'drive-pick', orgSlug: 'acme', wsSlug: 'eng', accountId: '..' },
      { kind: 'drive-pick', orgSlug: 'acme', wsSlug: 'eng', accountId: '' },
      { kind: 'drive-pick', orgSlug: 'acme', wsSlug: 'eng', accountId: tooLong },
      { kind: 'drive-pick', orgSlug: 'acme', wsSlug: 'eng', accountId: 42 },
      { kind: 'drive-pick', orgSlug: 'acme', wsSlug: 'eng', accountId: null },
      { kind: 'drive-connect', orgSlug: '', wsSlug: 'eng' },
      { kind: 'drive-connect', orgSlug: 'acme', wsSlug: tooLong },
      { kind: 'drive-connect', orgSlug: 123, wsSlug: 'eng' },
      { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng' },
      { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: 'a/b' },
      { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: 'x?y' },
      { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: '..' },
      { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: '' },
      { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: tooLong },
      { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: 7 },
      { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: 'df-1', action: 'delete' },
      { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: 'df-1', action: '' },
      { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: 'df-1', action: null },
      { kind: 'drive-file', orgSlug: 'acme', wsSlug: 'eng', id: 'df-1', action: 1 },
    ]
    for (const target of badTargets) {
      expect(await call(C.webUrl, target)).toBeNull()
      expect(await call(C.openWeb, target)).toBe(false)
    }
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('uniwork-work IPC: notification documents (G3)', () => {
  const PAGE = {
    documents: [
      { id: 'd_1', title: 'Budget', kind: 'docx', trashed: false, shelved: false, deleted: false },
    ],
    next_cursor: 'ndc1.next.mac',
  }
  const pageServer = () => vi.fn<FetchLike>(async () => json(200, PAGE))

  it('answers the parsed page for a notification id', async () => {
    const fetch = pageServer()
    expect(await setup({}, fetch).call(C.notificationDocuments, 'n_9')).toEqual({
      ok: true,
      value: PAGE,
    })
    expect(new URL(fetch.mock.calls[0]![0]).pathname).toBe('/api/v1/me/notifications/n_9/documents')
  })

  it('carries the cursor and the limit from the renderer', async () => {
    const fetch = pageServer()
    await setup({}, fetch).call(C.notificationDocuments, 'n_9', { cursor: 'ndc1.a.b', limit: 20 })
    const query = new URL(fetch.mock.calls[0]![0]).searchParams
    expect(query.get('cursor')).toBe('ndc1.a.b')
    expect(query.get('limit')).toBe('20')
  })

  it('a non-string id, a bad query or a bad cursor/limit never reaches the network', async () => {
    const fetch = pageServer()
    const { call } = setup({}, fetch)
    expect(await call(C.notificationDocuments, { id: 'n_9' })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(await call(C.notificationDocuments, 'n_9', 'cursor')).toEqual({
      ok: false,
      error: 'server',
    })
    expect(await call(C.notificationDocuments, 'n_9', [])).toEqual({ ok: false, error: 'server' })
    expect(await call(C.notificationDocuments, 'n_9', { cursor: 7 })).toEqual({
      ok: false,
      error: 'server',
    })
    expect(await call(C.notificationDocuments, 'n_9', { limit: '20' })).toEqual({
      ok: false,
      error: 'server',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a null query is the first page', async () => {
    const fetch = pageServer()
    const reply = await setup({}, fetch).call(C.notificationDocuments, 'n_9', null)
    expect(reply).toMatchObject({ ok: true })
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.has('cursor')).toBe(false)
  })

  it('turns 404, 403 and 400 into the work errors and never echoes the token', async () => {
    const failing = (status: number, code: string) =>
      setup(
        {},
        vi.fn<FetchLike>(async () => json(status, { error: { code, message: 'x' } })),
      ).call(C.notificationDocuments, 'n_9')
    expect(await failing(404, 'not_found')).toEqual({ ok: false, error: 'forbidden' })
    expect(await failing(403, 'forbidden')).toEqual({ ok: false, error: 'forbidden' })
    const bad = await failing(400, 'invalid_request')
    expect(bad).toEqual({ ok: false, error: 'server' })
    expect(JSON.stringify(bad)).not.toContain(TOKEN)
    expect(await setup({ identity: () => null }).call(C.notificationDocuments, 'n_9')).toEqual({
      ok: false,
      error: 'signed-out',
    })
  })
})

describe('uniwork-work IPC: the inbox (UNI-2079)', () => {
  const NOTE = {
    id: 'n_1',
    kind: 'task_assigned',
    workspace_id: 'ws_1',
    resource_type: 'task',
    resource_id: 't_1',
    actor_kind: 'human',
    title_key: 'notifications.kind.task_assigned',
    params: {},
    created_at: '2026-10-13T07:00:00Z',
  }
  /** one body per route path; a POST answers its route's body too */
  const inboxServer = () =>
    vi.fn<FetchLike>(async (url) => {
      const path = new URL(url).pathname.replace('/api/v1', '')
      const bodies: Record<string, unknown> = {
        '/me/notifications': { notifications: [NOTE], next_before: 'n_1' },
        '/me/notifications/unread-count': { total: 2, by_workspace: { ws_1: 2 } },
        '/me/notifications/read': { status: 'ok', ids: ['n_1'] },
        '/me/notifications/unread': { status: 'ok' },
        '/me/notifications/archive': { status: 'ok' },
        '/me/notifications/unarchive': { status: 'ok' },
      }
      return path in bodies
        ? json(200, bodies[path])
        : json(404, { error: { code: 'not_found', message: 'x' } })
    })
  const NEW = [
    C.listNotifications,
    C.unreadCount,
    C.markNotificationsUnread,
    C.archiveNotifications,
    C.unarchiveNotifications,
    C.markAllNotificationsRead,
  ]

  it('names every new channel under uniwork-work:', () => {
    for (const channel of NEW) expect(channel).toMatch(/^uniwork-work:/)
  })

  it('answers each inbox call with {ok, value}', async () => {
    const fetch = inboxServer()
    const { call } = setup({}, fetch)
    expect(await call(C.listNotifications, { unread: true })).toMatchObject({
      ok: true,
      value: { notifications: [{ id: 'n_1' }], next_before: 'n_1' },
    })
    expect(await call(C.unreadCount)).toEqual({
      ok: true,
      value: { total: 2, by_workspace: { ws_1: 2 } },
    })
    expect(await call(C.markNotificationsUnread, ['n_1'])).toEqual({ ok: true, value: null })
    expect(await call(C.archiveNotifications, ['n_1'])).toEqual({ ok: true, value: null })
    expect(await call(C.unarchiveNotifications, ['n_1'])).toEqual({ ok: true, value: null })
    expect(await call(C.markAllNotificationsRead, { workspaceId: 'ws_1' })).toEqual({
      ok: true,
      value: ['n_1'],
    })
    expect(
      fetch.mock.calls.map(([url, init]) => `${init.method} ${new URL(url).pathname}`),
    ).toEqual([
      'GET /api/v1/me/notifications',
      'GET /api/v1/me/notifications/unread-count',
      'POST /api/v1/me/notifications/unread',
      'POST /api/v1/me/notifications/archive',
      'POST /api/v1/me/notifications/unarchive',
      'POST /api/v1/me/notifications/read',
    ])
  })

  it('a null list query or mark-all query reads as none', async () => {
    const fetch = inboxServer()
    const { call } = setup({}, fetch)
    expect(await call(C.listNotifications, null)).toMatchObject({ ok: true })
    expect(await call(C.markAllNotificationsRead, null)).toMatchObject({ ok: true })
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toEqual({ all: true })
  })

  it('maps failures to the work errors; bad renderer input never reaches the network', async () => {
    const failing = (status: number, code: string) =>
      setup(
        {},
        vi.fn<FetchLike>(async () => json(status, { error: { code, message: 'x' } })),
      ).call(C.archiveNotifications, ['n_1'])
    // someone else's id: 404, nothing changed
    expect(await failing(404, 'not_found')).toEqual({ ok: false, error: 'forbidden' })
    expect(await failing(500, 'internal')).toEqual({ ok: false, error: 'server' })
    expect(await setup({ identity: () => null }).call(C.unreadCount)).toEqual({
      ok: false,
      error: 'signed-out',
    })
    const fetch = inboxServer()
    const { call } = setup({}, fetch)
    expect(await call(C.listNotifications, { limit: 500 })).toEqual({ ok: false, error: 'server' })
    expect(await call(C.markNotificationsUnread, [])).toEqual({ ok: false, error: 'server' })
    expect(await call(C.unarchiveNotifications, 'n_1')).toEqual({ ok: false, error: 'server' })
    expect(await call(C.markAllNotificationsRead, { workspaceId: 7 })).toEqual({
      ok: false,
      error: 'server',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
