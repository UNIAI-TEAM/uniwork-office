import { describe, expect, it, vi } from 'vitest'
import type { UniworkDocErrorCode } from '../src/shared/home-api'
import { workErrorOfDocCode, type UniworkWorkError } from '../src/shared/uniwork-work-api'
import { TransportError } from '../src/main/uniwork-auth/transport'
import type { FetchLike, UniworkDocsClientOptions } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { createUniworkWorkClient } from '../src/main/uniwork-work/client'

const ORIGIN = 'https://uniwork.example'
const TOKEN = 'secret-token-7f3a'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string) => json(status, { error: { code, message: 'x' } })

const TASK = {
  id: 't_1',
  organization_id: 'org_1',
  workspace_id: 'ws_1',
  number: 7,
  identifier: 'ENG-7',
  title: 'Call supplier',
  description: 'long text the UI does not read',
  status: 'todo',
  priority: 'high',
  due_date: '2026-10-14',
  project_id: null,
  position: 1,
  created_by: 'u_1',
  created_at: '2026-10-01T08:00:00Z',
  updated_at: '2026-10-13T08:00:00Z',
}
const PARSED_TASK = {
  id: 't_1',
  workspace_id: 'ws_1',
  identifier: 'ENG-7',
  title: 'Call supplier',
  status: 'todo',
  priority: 'high',
  due_date: '2026-10-14',
  project_id: null,
  updated_at: '2026-10-13T08:00:00Z',
}
const MEETING = {
  id: 'm_1',
  workspace_id: 'ws_1',
  title: 'Standup',
  description: '',
  starts_at: '2026-10-13T09:00:00Z',
  ends_at: '2026-10-13T09:15:00Z',
  room_name: 'room-1',
  created_by: 'u_1',
  status: 'IN_PROGRESS',
}
const NOTE = {
  id: 'n_1',
  kind: 'task_assigned',
  workspace_id: 'ws_1',
  resource_type: 'task',
  resource_id: 't_1',
  actor_kind: 'human',
  title_key: 'notifications.kind.task_assigned',
  params: { task: 'Call supplier' },
  created_at: '2026-10-13T07:00:00Z',
}
const HOME = {
  today: '2026-10-13',
  timezone: 'Asia/Ho_Chi_Minh',
  counts: { open: 3, overdue: 1, due_today: 1, meetings_today: 1, unread: 2 },
  my_work: [TASK],
  upcoming_meetings: [MEETING],
  inbox: [NOTE],
  partial: [],
  generated_at: '2026-10-13T08:00:00Z',
}
const statusRow = (key: string, archived = false) => ({
  id: `s_${key}`,
  key,
  name: key,
  category: key,
  color: 'gray',
  position: 1,
  ...(archived ? { archived_at: '2026-01-01T00:00:00Z' } : {}),
})
const EVENT = {
  id: 'e_1',
  kind: 'meeting',
  entity_id: 'm_1',
  title: 'Standup',
  start: '2026-10-13T09:00:00Z',
  end: '2026-10-13T09:15:00Z',
  all_day: false,
  status: null,
  priority: null,
  project_id: null,
}
const PERSON = {
  user_id: 'u_1',
  display_name: 'Ada',
  email: 'ada@example.test',
  org_role: 'member',
  status: 'active',
  title: 'Engineer',
  department: { id: 'd_1', name: 'R&D' },
  manager: null,
  timezone: 'Asia/Ho_Chi_Minh',
}

/** a fake server: one body per route; every body also echoes the Authorization header back */
function server(overrides: Record<string, () => Response> = {}) {
  return vi.fn<FetchLike>(async (url, init) => {
    const path = new URL(url).pathname.replace('/api/v1', '')
    const echo = (init.headers as Record<string, string>).Authorization
    const override = overrides[path]
    if (override) return override()
    const bodies: Record<string, unknown> = {
      '/workspaces/ws_1/home': { ...HOME, echo, my_work: [{ ...TASK, echo }] },
      '/workspaces/ws_1/my-tasks': { tasks: [{ ...TASK, echo }], total: 1, limit: 200, offset: 0 },
      '/workspaces/ws_1/task-statuses': {
        statuses: [statusRow('todo'), statusRow('done'), statusRow('old', true)],
        categories: [],
        total: 3,
      },
      '/tasks/t_1': { task: { ...TASK, status: 'done', echo } },
      '/workspaces/ws_1/tasks': { task: { ...TASK, id: 't_2', title: 'Call', echo } },
      '/workspaces/ws_1/calendar/events': { events: [{ ...EVENT, echo }] },
      '/orgs/acme/people/u_1': { person: { ...PERSON, echo }, reports: [] },
    }
    return path in bodies ? json(200, bodies[path]) : envelope(404, 'not_found')
  })
}

function client(fetch: FetchLike, extra: Partial<UniworkDocsClientOptions> = {}) {
  return createUniworkWorkClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    isSignedIn: () => true,
    fetch,
    ...extra,
  })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof UniworkDocError ? error.code : `other:${String(error)}`
  }
  return 'resolved'
}

const RANGE = { workspaceId: 'ws_1', from: '2026-10-13', to: '2026-10-27' }

describe('uniwork work client: routes', () => {
  it('calls only fixed routes under apiOrigin/api/v1, never follows redirects, never caches', async () => {
    const fetch = server()
    const api = client(fetch)
    await api.homeSummary('ws_1')
    await api.myTasks('ws_1')
    await api.taskStatuses('ws_1')
    await api.setTaskStatus('t_1', 'done')
    await api.createTask({ workspaceId: 'ws_1', title: 'Call', idempotencyKey: 'key-0001' })
    await api.calendarEvents(RANGE)
    await api.person('acme', 'u_1')
    expect(fetch.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/home`,
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/my-tasks?limit=200`,
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/task-statuses`,
      `PATCH ${ORIGIN}/api/v1/tasks/t_1`,
      `POST ${ORIGIN}/api/v1/workspaces/ws_1/tasks`,
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/calendar/events?from=2026-10-13&to=2026-10-27&mine=true`,
      `GET ${ORIGIN}/api/v1/orgs/acme/people/u_1`,
    ])
    for (const [, init] of fetch.mock.calls) {
      expect(init.redirect).toBe('error')
      expect(init.cache).toBe('no-store')
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    }
  })

  it('PATCH sends only the status key', async () => {
    const fetch = server()
    expect((await client(fetch).setTaskStatus('t_1', 'done')).status).toBe('done')
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ status: 'done' })
  })

  it('POST sends the trimmed title, the due date and the Idempotency-Key', async () => {
    const fetch = server()
    const api = client(fetch)
    const created = await api.createTask({
      workspaceId: 'ws_1',
      title: '  Call  ',
      dueDate: '2026-10-14',
      idempotencyKey: 'key-0001',
    })
    expect(created.id).toBe('t_2')
    await api.createTask({ workspaceId: 'ws_1', title: 'Call', idempotencyKey: 'key-0002' })
    const [first, second] = fetch.mock.calls.map(([, init]) => init)
    expect(JSON.parse(first!.body as string)).toEqual({ title: 'Call', due_date: '2026-10-14' })
    expect((first!.headers as Record<string, string>)['Idempotency-Key']).toBe('key-0001')
    expect(JSON.parse(second!.body as string)).toEqual({ title: 'Call' })
  })
})

describe('uniwork work client: parsing', () => {
  it('reads only the fields the Workbench shows', async () => {
    const api = client(server())
    expect(await api.homeSummary('ws_1')).toEqual({
      today: '2026-10-13',
      timezone: 'Asia/Ho_Chi_Minh',
      counts: { open: 3, overdue: 1, due_today: 1, meetings_today: 1, unread: 2 },
      my_work: [PARSED_TASK],
      upcoming_meetings: [
        {
          id: 'm_1',
          workspace_id: 'ws_1',
          title: 'Standup',
          starts_at: '2026-10-13T09:00:00Z',
          ends_at: '2026-10-13T09:15:00Z',
          status: 'IN_PROGRESS',
        },
      ],
      inbox: [
        {
          id: 'n_1',
          kind: 'task_assigned',
          workspace_id: 'ws_1',
          resource_type: 'task',
          resource_id: 't_1',
          actor_kind: 'human',
          title_key: 'notifications.kind.task_assigned',
          params: { task: 'Call supplier' },
          created_at: '2026-10-13T07:00:00Z',
        },
      ],
      partial: [],
      generated_at: '2026-10-13T08:00:00Z',
    })
    expect(await api.myTasks('ws_1')).toEqual([PARSED_TASK])
    expect((await api.taskStatuses('ws_1')).map((s) => s.key)).toEqual(['todo', 'done'])
    expect(await api.calendarEvents(RANGE)).toEqual([
      {
        id: 'e_1',
        kind: 'meeting',
        entity_id: 'm_1',
        title: 'Standup',
        start: '2026-10-13T09:00:00Z',
        end: '2026-10-13T09:15:00Z',
        all_day: false,
        status: null,
        project_id: null,
      },
    ])
    expect(await api.person('acme', 'u_1')).toEqual({
      user_id: 'u_1',
      display_name: 'Ada',
      email: 'ada@example.test',
      title: 'Engineer',
      department: { id: 'd_1', name: 'R&D' },
      manager: null,
      timezone: 'Asia/Ho_Chi_Minh',
    })
  })

  it('a home section that fails its schema becomes [] and is named in partial', async () => {
    const fetch = server({
      '/workspaces/ws_1/home': () =>
        json(200, {
          ...HOME,
          upcoming_meetings: [{ id: 'm_1' }],
          inbox: 'not a list',
          partial: ['tasks', 'weather'],
        }),
    })
    const home = await client(fetch).homeSummary('ws_1')
    expect(home.my_work).toEqual([PARSED_TASK])
    expect(home.upcoming_meetings).toEqual([])
    expect(home.inbox).toEqual([])
    expect(home.partial).toEqual(['tasks', 'meetings', 'notifications'])
  })

  it('a drifted count reads null; a home without today is malformed', async () => {
    const drifted = server({
      '/workspaces/ws_1/home': () =>
        json(200, { ...HOME, counts: { ...HOME.counts, overdue: -1, unread: 'x' } }),
    })
    expect((await client(drifted).homeSummary('ws_1')).counts).toEqual({
      open: 3,
      overdue: null,
      due_today: 1,
      meetings_today: 1,
      unread: null,
    })
    const noToday = server({
      '/workspaces/ws_1/home': () => json(200, { ...HOME, today: undefined }),
    })
    expect(await codeOf(client(noToday).homeSummary('ws_1'))).toBe('malformed_response')
  })

  it('a list route without its list is malformed', async () => {
    const fetch = server({ '/workspaces/ws_1/my-tasks': () => json(200, { tasks: null }) })
    expect(await codeOf(client(fetch).myTasks('ws_1'))).toBe('malformed_response')
  })
})

describe('uniwork work client: errors', () => {
  it('maps each failure to the work error the renderer shows', async () => {
    const cases: Array<[FetchLike, UniworkDocErrorCode, UniworkWorkError]> = [
      // a coded 403 is the server revoking access (G5-06 code)
      [async () => envelope(403, 'forbidden'), 'permission_revoked', 'forbidden'],
      [async () => envelope(404, 'not_found'), 'not_found', 'forbidden'],
      // a bare 403 from a proxy is not the server's verdict
      [async () => new Response('denied', { status: 403 }), 'server_error', 'server'],
      [async () => json(500, {}), 'server_error', 'server'],
      [
        async () => {
          throw new TypeError('fetch failed')
        },
        'network',
        'offline',
      ],
    ]
    for (const [fetch, code, work] of cases) {
      expect(await codeOf(client(fetch).homeSummary('ws_1'))).toBe(code)
      expect(workErrorOfDocCode(code)).toBe(work)
    }
  })

  it('a 401 refreshes once and retries; a second 401 is session_expired (signed-out)', async () => {
    const fetch = vi.fn<FetchLike>(async () => envelope(401, 'unauthorized'))
    const authorized = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await call('tok-1')
      } catch (error) {
        if (!(error instanceof TransportError) || error.code !== 'unauthorized') throw error
        return call('tok-2')
      }
    }
    expect(await codeOf(client(fetch, { authorized }).myTasks('ws_1'))).toBe('session_expired')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(workErrorOfDocCode('session_expired')).toBe('signed-out')
  })

  it('a call past its deadline is a timeout (offline)', async () => {
    const fetch = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    )
    expect(await codeOf(client(fetch, { metadataTimeoutMs: 10 }).homeSummary('ws_1'))).toBe(
      'timeout',
    )
    expect(workErrorOfDocCode('timeout')).toBe('offline')
  })

  it('signed out: nothing is sent', async () => {
    const fetch = server()
    expect(await codeOf(client(fetch, { isSignedIn: () => false }).myTasks('ws_1'))).toBe(
      'not_signed_in',
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(workErrorOfDocCode('not_signed_in')).toBe('signed-out')
  })

  it('refuses renderer input the server must never see', async () => {
    const fetch = server()
    const api = client(fetch)
    expect(await codeOf(api.setTaskStatus('../me', 'done'))).toBe('not_found')
    expect(await codeOf(api.setTaskStatus('t_1', 'done; drop'))).toBe('server_error')
    const task = { workspaceId: 'ws_1', title: 'A', idempotencyKey: 'key-0001' }
    expect(await codeOf(api.createTask({ ...task, title: '   ' }))).toBe('server_error')
    expect(await codeOf(api.createTask({ ...task, dueDate: '14/10/2026' }))).toBe('server_error')
    expect(await codeOf(api.createTask({ ...task, idempotencyKey: '' }))).toBe('server_error')
    expect(await codeOf(api.calendarEvents({ ...RANGE, from: 'today' }))).toBe('server_error')
    expect(await codeOf(api.person('acme', 'u_1/../../admin'))).toBe('not_found')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('no result or error carries the token, even when the server echoes it', async () => {
    const api = client(server())
    const results = [
      await api.homeSummary('ws_1'),
      await api.myTasks('ws_1'),
      await api.taskStatuses('ws_1'),
      await api.setTaskStatus('t_1', 'done'),
      await api.createTask({ workspaceId: 'ws_1', title: 'Call', idempotencyKey: 'key-0001' }),
      await api.calendarEvents(RANGE),
      await api.person('acme', 'u_1'),
    ]
    expect(JSON.stringify(results)).not.toContain(TOKEN)
    const failed: unknown = await client(async () =>
      json(403, { error: { code: 'forbidden', message: TOKEN } }),
    )
      .homeSummary('ws_1')
      .catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(UniworkDocError)
    const error = failed as UniworkDocError
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(TOKEN)
  })
})

describe('workErrorOfDocCode', () => {
  it('maps every documents error code to one of the four work errors', () => {
    const table: Record<UniworkDocErrorCode, UniworkWorkError> = {
      not_signed_in: 'signed-out',
      session_expired: 'signed-out',
      wrong_deployment: 'signed-out',
      forbidden: 'forbidden',
      not_found: 'forbidden',
      deleted: 'forbidden',
      network: 'offline',
      timeout: 'offline',
      conflict: 'server',
      quota_exceeded: 'server',
      too_large: 'server',
      unsupported_format: 'server',
      engine_incompatible: 'server',
      idempotency_mismatch: 'server',
      ticket_invalid: 'server',
      ticket_expired: 'server',
      server_error: 'server',
      malformed_response: 'server',
      keystore_locked: 'server',
      store_full: 'server',
      capability_off: 'server',
      intent_unknown: 'server',
      document_deleted: 'forbidden',
      document_archived: 'forbidden',
      permission_revoked: 'forbidden',
      member_deactivated: 'forbidden',
      organization_suspended: 'forbidden',
      drafts_full: 'server',
      other_window: 'server',
    }
    for (const [code, work] of Object.entries(table)) {
      expect(workErrorOfDocCode(code as UniworkDocErrorCode)).toBe(work)
    }
  })
})

describe('uniwork work client: notifications', () => {
  it('POST /me/notifications/read sends only the ids', async () => {
    const fetch = server({ '/me/notifications/read': () => json(200, { status: 'ok', ids: [] }) })
    expect(await client(fetch).markNotificationsRead(['n_1', 'n_2'])).toBeNull()
    const [url, init] = fetch.mock.calls[0]!
    expect(`${init.method} ${url}`).toBe(`POST ${ORIGIN}/api/v1/me/notifications/read`)
    expect(JSON.parse(init.body as string)).toEqual({ ids: ['n_1', 'n_2'] })
  })

  it('refuses an empty or oversized id list without calling the server', async () => {
    const fetch = server()
    expect(await codeOf(client(fetch).markNotificationsRead([]))).toBe('server_error')
    const many = Array.from({ length: 101 }, (_, i) => `n_${i}`)
    expect(await codeOf(client(fetch).markNotificationsRead(many))).toBe('server_error')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('uniwork work client: document-change rows in the home inbox', () => {
  it('homeSummary keeps count, updated_at and sample_documents of a document_changed row', async () => {
    const row = {
      ...NOTE,
      id: 'n_9',
      kind: 'document_changed',
      resource_type: 'document',
      resource_id: 'd_1',
      count: 3,
      updated_at: '2026-10-21T07:01:00Z',
      sample_documents: [{ id: 'd_1', title: 'Budget' }],
    }
    const fetch = server({
      '/workspaces/ws_1/home': () => json(200, { ...HOME, inbox: [row, NOTE] }),
    })
    const { inbox } = await client(fetch).homeSummary('ws_1')
    expect(inbox[0]).toMatchObject({
      kind: 'document_changed',
      count: 3,
      updated_at: '2026-10-21T07:01:00Z',
      sample_documents: [{ id: 'd_1', title: 'Budget' }],
    })
    expect(inbox[1]).not.toHaveProperty('sample_documents')
  })
})
