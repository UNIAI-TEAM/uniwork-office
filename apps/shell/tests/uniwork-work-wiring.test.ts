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
    Promise.resolve(handlers.get(channel)!({}, ...args))
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
})
