import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { registerUniworkAskUni, type UniworkAskUniWiring } from '../src/main/uniwork-askuni/index'
import { registerAskUniIpc, type AskUniService } from '../src/main/uniwork-askuni/service'
import { registerAskUniOpenIpc, type AskUniOpener } from '../src/main/uniwork-askuni/open-citation'
import {
  registerAskUniStreamIpc,
  type AskUniFlagsReader,
  type AskUniStreamService,
} from '../src/main/uniwork-askuni/stream-service'
import { IPC_SENDER_REFUSED } from '../src/main/ipc-sender-guard'
import {
  ASKUNI_CHANNELS,
  ASKUNI_V2_CHANNELS,
  type AskUniStreamEvent,
} from '../src/shared/askuni-api'
import { SHELL_URL, createGuardedFakeIpc } from './uniwork-askuni-guard-fixture'

/**
 * UNI-2076 s1: the shell sender rule on every Ask UNI handler (the new v2 ones
 * and the three P1 ones; since s8-guard it is the UNI-2073 guard's `shell`
 * policy, not a helper of ours), the v2 IPC registration, and the wiring (fake
 * switch, flag read from GET /api/v1/config, the real stream path).
 */

const ORIGIN = 'https://uniwork.example'
const WS = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const PROFILE: DeploymentProfile = {
  deploymentId: 'prod',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}

function contents(id: number) {
  const sent: AskUniStreamEvent[] = []
  let destroyed = false
  const listeners = new Set<() => void>()
  const wc = {
    id,
    mainFrame: { name: `main-${id}`, url: SHELL_URL },
    sent,
    isDestroyed: () => destroyed,
    send: (_channel: string, ev: AskUniStreamEvent) => void sent.push(ev),
    once: (_n: string, fn: () => void) => void listeners.add(fn),
    on: () => undefined,
    removeListener: (_n: string, fn: () => void) => void listeners.delete(fn),
    destroy() {
      destroyed = true
      for (const fn of [...listeners]) fn()
    },
  }
  return wc
}
type FakeContents = ReturnType<typeof contents>

const shell = contents(1)
const other = contents(2)
const fromShell = () => ({ sender: shell, senderFrame: shell.mainFrame })
const fromSubframe = () => ({ sender: shell, senderFrame: { name: 'iframe', url: SHELL_URL } })
const fromOther = () => ({ sender: other, senderFrame: other.mainFrame })

// the shell window the guard reads on every call
let shellContents: unknown = shell
const { ipcMain, handlers, call } = createGuardedFakeIpc({ shell: () => shellContents })

beforeEach(() => {
  handlers.clear()
  shellContents = shell
  shell.sent.length = 0
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('registerAskUniStreamIpc', () => {
  function register() {
    const stream: AskUniStreamService = {
      start: vi.fn(async () => ({ ok: true as const, requestId: 'req_1' })),
      cancel: vi.fn(() => ({ ok: true as const })),
      abortAll: vi.fn(),
      active: () => 0,
    }
    const flags: AskUniFlagsReader = { flags: vi.fn(async () => ({ streamEnabled: true })) }
    registerAskUniStreamIpc(ipcMain, { stream, flags })
    return { stream, flags }
  }

  it('registers stream, cancel and flags and hands the sender to the service', async () => {
    const { stream, flags } = register()
    expect([...handlers.keys()].sort()).toEqual(
      [ASKUNI_V2_CHANNELS.flags, ASKUNI_V2_CHANNELS.stream, ASKUNI_V2_CHANNELS.streamCancel].sort(),
    )
    const req = { workspaceId: WS, question: 'q', locale: 'en' }
    expect(await call(ASKUNI_V2_CHANNELS.stream, fromShell(), req)).toEqual({
      ok: true,
      requestId: 'req_1',
    })
    expect(stream.start).toHaveBeenCalledWith(shell, req)
    expect(
      await call(ASKUNI_V2_CHANNELS.streamCancel, fromShell(), { requestId: 'req_1' }),
    ).toEqual({
      ok: true,
    })
    expect(stream.cancel).toHaveBeenCalledWith(shell, { requestId: 'req_1' })
    expect(await call(ASKUNI_V2_CHANNELS.flags, fromShell())).toEqual({ streamEnabled: true })
    expect(flags.flags).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a subframe', fromSubframe],
    ['another webContents', fromOther],
  ])('refuses %s through the guard with no side effect', async (_name, event) => {
    const { stream, flags } = register()
    const refused = (promise: Promise<unknown>) =>
      expect(promise).rejects.toThrow(IPC_SENDER_REFUSED)
    await refused(call(ASKUNI_V2_CHANNELS.stream, event(), { question: 'q' }))
    await refused(call(ASKUNI_V2_CHANNELS.streamCancel, event(), { requestId: 'r' }))
    await refused(call(ASKUNI_V2_CHANNELS.flags, event()))
    expect(stream.start).not.toHaveBeenCalled()
    expect(stream.cancel).not.toHaveBeenCalled()
    expect(flags.flags).not.toHaveBeenCalled()
  })
})

describe('P1 handlers get the same sender rule', () => {
  it('ask, context and open-citation refuse a non-shell sender without calling the service', async () => {
    const service: AskUniService = {
      ask: vi.fn(async () => ({ ok: false as const, code: 'error' as const })),
      context: vi.fn(async () => ({ workspaces: [], currentWorkspaceId: null, signedIn: true })),
      checkWorkspace: vi.fn(async () => null),
    }
    const opener: AskUniOpener = { open: vi.fn(async () => ({ ok: true as const })) }
    registerAskUniIpc(ipcMain, service)
    registerAskUniOpenIpc(ipcMain, opener)
    for (const event of [fromSubframe(), fromOther()]) {
      await expect(call(ASKUNI_CHANNELS.ask, event, { question: 'q' })).rejects.toThrow(
        IPC_SENDER_REFUSED,
      )
      await expect(call(ASKUNI_CHANNELS.context, event)).rejects.toThrow(IPC_SENDER_REFUSED)
      await expect(
        call(ASKUNI_CHANNELS.openCitation, event, { kind: 'task', href: '/a/b/tasks/1' }),
      ).rejects.toThrow(IPC_SENDER_REFUSED)
    }
    expect(service.ask).not.toHaveBeenCalled()
    expect(service.context).not.toHaveBeenCalled()
    expect(opener.open).not.toHaveBeenCalled()
    // the shell's own page still reaches them
    await call(ASKUNI_CHANNELS.ask, fromShell(), { question: 'q' })
    await call(ASKUNI_CHANNELS.context, fromShell())
    await call(ASKUNI_CHANNELS.openCitation, fromShell(), { kind: 'task', href: '/a/b/tasks/1' })
    expect(service.ask).toHaveBeenCalledTimes(1)
    expect(service.context).toHaveBeenCalledTimes(1)
    expect(opener.open).toHaveBeenCalledTimes(1)
  })
})

describe('registerUniworkAskUni (v2 wiring)', () => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  function wiring(over: Partial<UniworkAskUniWiring> = {}): UniworkAskUniWiring {
    return {
      profile: () => PROFILE,
      authorized: (c) => c('tok_secret'),
      isSignedIn: () => true,
      scopeKey: () => 'acc_1:org_a',
      selectedOrgId: () => 'org_a',
      activeWorkspaceId: () => null,
      packaged: true,
      env: {},
      openDocument: async () => ({ ok: true, value: { path: '/tmp/doc.docx' } }),
      openExternal: async () => undefined,
      ...over,
    }
  }

  const waitFor = async (pred: () => boolean) => {
    for (let i = 0; i < 200 && !pred(); i += 1) await new Promise((r) => setTimeout(r, 5))
  }

  it('reads ask_uni_stream from GET /api/v1/config for the selected org, with the bearer', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      json({ flags: { ask_uni_stream: true, other: false } }),
    )
    vi.stubGlobal('fetch', fetch)
    registerUniworkAskUni(ipcMain, wiring())
    expect(await call(ASKUNI_V2_CHANNELS.flags, fromShell())).toEqual({ streamEnabled: true })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${ORIGIN}/api/v1/config?organization_id=org_a`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_secret')
    // cached for the scope
    await call(ASKUNI_V2_CHANNELS.flags, fromShell())
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a config without the flag, a failed read or no profile is off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ flags: {} })),
    )
    registerUniworkAskUni(ipcMain, wiring())
    expect(await call(ASKUNI_V2_CHANNELS.flags, fromShell())).toEqual({ streamEnabled: false })
    handlers.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 500 })),
    )
    registerUniworkAskUni(ipcMain, wiring({ scopeKey: () => 'acc_2:org_a' }))
    expect(await call(ASKUNI_V2_CHANNELS.flags, fromShell())).toEqual({ streamEnabled: false })
    handlers.clear()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    registerUniworkAskUni(ipcMain, wiring({ profile: () => null }))
    expect(await call(ASKUNI_V2_CHANNELS.flags, fromShell())).toEqual({ streamEnabled: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a packaged build ignores the fake switch and streams from the server', async () => {
    const sse =
      'event: run\ndata: {"run_id":"","conversation_id":"01K4AICONV000000000000001"}\n\n' +
      'event: done\ndata: {"message":{"id":"m1","role":"assistant","content":"real","citations":[],"created_at":"2026-10-21T08:00:00Z"}}\n\n'
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/orgs/org_a/workspaces')
        ? json({ workspaces: [{ id: WS, name: 'Team', organization_id: 'org_a' }] })
        : new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    )
    vi.stubGlobal('fetch', fetch)
    registerUniworkAskUni(ipcMain, wiring({ env: { UNIWORK_ASKUNI_FAKE: '1' } }))
    const start = await call(ASKUNI_V2_CHANNELS.stream, fromShell(), {
      workspaceId: WS,
      question: 'docs: x',
      locale: 'en',
    })
    expect(start).toMatchObject({ ok: true })
    await waitFor(() => shell.sent.some((e) => e.type === 'done'))
    expect(shell.sent.map((e) => e.type)).toEqual(['run', 'done'])
    expect(fetch.mock.calls.map(([u]) => u)).toEqual([
      `${ORIGIN}/api/v1/orgs/org_a/workspaces`,
      `${ORIGIN}/api/v1/workspaces/${WS}/ai/ask/stream`,
    ])
  })

  it('an unpackaged build with the switch streams from the fake and never calls fetch', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    registerUniworkAskUni(
      ipcMain,
      wiring({ packaged: false, env: { UNIWORK_ASKUNI_FAKE: '1' }, fakeStreamDelayMs: 0 }),
    )
    expect(await call(ASKUNI_V2_CHANNELS.flags, fromShell())).toEqual({ streamEnabled: true })
    const ctx = (await call(ASKUNI_CHANNELS.context, fromShell())) as {
      workspaces: Array<{ id: string }>
    }
    const start = await call(ASKUNI_V2_CHANNELS.stream, fromShell(), {
      workspaceId: ctx.workspaces[0].id,
      question: 'docs: budget',
      locale: 'en',
    })
    expect(start).toMatchObject({ ok: true })
    await waitFor(() => shell.sent.some((e) => e.type === 'done'))
    expect(shell.sent[0].type).toBe('run')
    expect(shell.sent.at(-1)?.type).toBe('done')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('UNIWORK_ASKUNI_FAKE_STREAM=0 turns the fake flag off', async () => {
    registerUniworkAskUni(
      ipcMain,
      wiring({
        packaged: false,
        env: { UNIWORK_ASKUNI_FAKE: '1', UNIWORK_ASKUNI_FAKE_STREAM: '0' },
      }),
    )
    expect(await call(ASKUNI_V2_CHANNELS.flags, fromShell())).toEqual({ streamEnabled: false })
  })

  it('a destroyed shell window ends its stream', async () => {
    const wc: FakeContents = contents(7)
    shellContents = wc
    registerUniworkAskUni(ipcMain, wiring({ packaged: false, env: { UNIWORK_ASKUNI_FAKE: '1' } }))
    const start = (await call(
      ASKUNI_V2_CHANNELS.stream,
      { sender: wc, senderFrame: wc.mainFrame },
      { workspaceId: 'ws_fake', question: 'slow: x', locale: 'en' },
    )) as { ok: boolean }
    expect(start.ok).toBe(true)
    wc.destroy()
    await new Promise((r) => setTimeout(r, 50))
    expect(wc.sent.some((e) => e.type === 'done' || e.type === 'error')).toBe(false)
  })
})
