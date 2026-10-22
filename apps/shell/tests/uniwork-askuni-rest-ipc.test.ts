import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { registerUniworkAskUni, type UniworkAskUniWiring } from '../src/main/uniwork-askuni/index'
import {
  registerAskUniRestIpc,
  type AskUniRestService,
} from '../src/main/uniwork-askuni/rest-service'
import { IPC_SENDER_REFUSED } from '../src/main/ipc-sender-guard'
import { ASKUNI_V2_CHANNELS } from '../src/shared/askuni-api'
import { SHELL_URL, createGuardedFakeIpc } from './uniwork-askuni-guard-fixture'

/**
 * UNI-2076 s2: the REST channels of Ask UNI v2: registration, the shell
 * sender rule on each one (the UNI-2073 guard's `shell` policy since
 * s8-guard), and the real wiring against a stubbed global fetch.
 */

const ORIGIN = 'https://uniwork.example'
const WS = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const CONV = '01K4AICONV000000000000001'
const PROFILE: DeploymentProfile = {
  deploymentId: 'prod',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}

const shell = { id: 1, mainFrame: { n: 'main', url: SHELL_URL }, isDestroyed: () => false }
const other = { id: 2, mainFrame: { n: 'other', url: SHELL_URL }, isDestroyed: () => false }
const fromShell = { sender: shell, senderFrame: shell.mainFrame }
const fromSubframe = { sender: shell, senderFrame: { n: 'iframe', url: SHELL_URL } }
const fromOther = { sender: other, senderFrame: other.mainFrame }

const { ipcMain, handlers, call } = createGuardedFakeIpc({ shell: () => shell })

const REST_CHANNELS: Array<[string, keyof AskUniRestService]> = [
  [ASKUNI_V2_CHANNELS.capabilities, 'capabilities'],
  [ASKUNI_V2_CHANNELS.conversations, 'conversations'],
  [ASKUNI_V2_CHANNELS.messages, 'messages'],
  [ASKUNI_V2_CHANNELS.rename, 'rename'],
  [ASKUNI_V2_CHANNELS.delete, 'remove'],
  [ASKUNI_V2_CHANNELS.feedbackSet, 'feedbackSet'],
  [ASKUNI_V2_CHANNELS.feedbackClear, 'feedbackClear'],
  [ASKUNI_V2_CHANNELS.lookup, 'lookup'],
]

beforeEach(() => handlers.clear())
afterEach(() => vi.unstubAllGlobals())

describe('registerAskUniRestIpc', () => {
  function register() {
    const service = Object.fromEntries(
      REST_CHANNELS.map(([, method]) => [method, vi.fn(async () => ({ ok: true }))]),
    ) as unknown as Record<keyof AskUniRestService, ReturnType<typeof vi.fn>>
    registerAskUniRestIpc(ipcMain, { rest: service as unknown as AskUniRestService })
    return service
  }

  it('registers the eight REST channels and hands each its input', async () => {
    const service = register()
    expect([...handlers.keys()].sort()).toEqual(REST_CHANNELS.map(([c]) => c).sort())
    for (const [channel, method] of REST_CHANNELS) {
      const input = { probe: channel }
      expect(await call(channel, fromShell, input)).toEqual({ ok: true })
      expect(service[method]).toHaveBeenCalledWith(input)
    }
  })

  it.each([
    ['a subframe', fromSubframe],
    ['another webContents', fromOther],
  ])('refuses %s on every channel through the guard with no side effect', async (_n, event) => {
    const service = register()
    for (const [channel, method] of REST_CHANNELS) {
      await expect(call(channel, event, { workspaceId: WS })).rejects.toThrow(IPC_SENDER_REFUSED)
      expect(service[method]).not.toHaveBeenCalled()
    }
  })
})

describe('registerUniworkAskUni (REST wiring)', () => {
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
      env: { UNIWORK_ASKUNI_FAKE: '1' },
      openDocument: async () => ({ ok: true, value: { path: '/tmp/doc.docx' } }),
      openExternal: async () => undefined,
      ...over,
    }
  }

  it('a packaged build reads the server: workspace check, then the route', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/orgs/org_a/workspaces')
        ? json({ workspaces: [{ id: WS, name: 'Team', organization_id: 'org_a' }] })
        : json({
            conversations: [{ id: CONV, title: 'Việc', created_at: 'a', updated_at: 'b' }],
          }),
    )
    vi.stubGlobal('fetch', fetch)
    registerUniworkAskUni(ipcMain, wiring())
    expect(await call(ASKUNI_V2_CHANNELS.conversations, fromShell, { workspaceId: WS })).toEqual({
      ok: true,
      conversations: [{ id: CONV, title: 'Việc', createdAt: 'a', updatedAt: 'b' }],
    })
    expect(fetch.mock.calls.map(([u]) => u)).toEqual([
      `${ORIGIN}/api/v1/orgs/org_a/workspaces`,
      `${ORIGIN}/api/v1/workspaces/${WS}/ai/conversations`,
    ])
  })

  it('no deployment profile is signed_out with no request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    registerUniworkAskUni(ipcMain, wiring({ profile: () => null }))
    expect(await call(ASKUNI_V2_CHANNELS.messages, fromShell, { conversationId: CONV })).toEqual({
      ok: false,
      error: 'signed_out',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('an unpackaged build with the switch answers from the fake with no fetch', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    registerUniworkAskUni(ipcMain, wiring({ packaged: false }))
    expect(
      await call(ASKUNI_V2_CHANNELS.capabilities, fromShell, { workspaceId: 'ws_fake' }),
    ).toMatchObject({ ok: true, enabled: true })
    expect(fetch).not.toHaveBeenCalled()
  })
})
