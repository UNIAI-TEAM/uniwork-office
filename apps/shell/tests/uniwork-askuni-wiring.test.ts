import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { registerUniworkAskUni, type UniworkAskUniWiring } from '../src/main/uniwork-askuni/index'
import { ASKUNI_CHANNELS } from '../src/shared/askuni-api'

/**
 * UNI-2069 s1f (RB-6): the registration that wires the real client, the real
 * workspace list and the fake switch together, against a stubbed global fetch.
 */

const ORIGIN = 'https://uniwork.example'
const WS = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const PROFILE: DeploymentProfile = {
  deploymentId: 'prod',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const ipcMain = {
  handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
    void handlers.set(channel, fn),
} as unknown as IpcMain

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

function wiring(over: Partial<UniworkAskUniWiring> = {}): UniworkAskUniWiring {
  return {
    profile: () => PROFILE,
    authorized: (call) => call('tok_secret'),
    isSignedIn: () => true,
    scopeKey: () => 'acc_1:org_a',
    selectedOrgId: () => 'org_a',
    activeWorkspaceId: () => null,
    packaged: true,
    env: { UNIWORK_ASKUNI_FAKE: '1' },
    ...over,
  }
}

const ask = (question: string) =>
  handlers.get(ASKUNI_CHANNELS.ask)!({}, { workspaceId: WS, question, locale: 'en' })
const context = () => handlers.get(ASKUNI_CHANNELS.context)!({})

beforeEach(() => handlers.clear())
afterEach(() => vi.unstubAllGlobals())

describe('registerUniworkAskUni', () => {
  it('a packaged build ignores UNIWORK_ASKUNI_FAKE and builds the real path', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/orgs/org_a/workspaces')
        ? json({ workspaces: [{ id: WS, name: 'Team', organization_id: 'org_a' }] })
        : json({
            conversation_id: 'c1',
            message: { id: 'm1', content: 'real answer', citations: [] },
          }),
    )
    vi.stubGlobal('fetch', fetch)
    registerUniworkAskUni(ipcMain, wiring())
    expect(await context()).toMatchObject({ workspaces: [{ id: WS, name: 'Team' }] })
    // a fake-prefixed question still goes to the server
    expect(await ask('docs: budget')).toMatchObject({
      ok: true,
      message: { content: 'real answer' },
    })
    const urls = fetch.mock.calls.map(([url]) => url)
    expect(urls).toEqual([
      `${ORIGIN}/api/v1/orgs/org_a/workspaces`,
      `${ORIGIN}/api/v1/workspaces/${WS}/ai/ask`,
    ])
  })

  it('an unpackaged build with the switch answers from the fake and never calls fetch', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    registerUniworkAskUni(ipcMain, wiring({ packaged: false }))
    const ctx = (await context()) as { workspaces: Array<{ id: string }> }
    const result = await handlers.get(ASKUNI_CHANNELS.ask)!(
      {},
      { workspaceId: ctx.workspaces[0].id, question: 'none: x', locale: 'en' },
    )
    expect(result).toMatchObject({ ok: true, message: { notice: 'no_sources' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('no deployment profile is signed_out and sends nothing', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    registerUniworkAskUni(ipcMain, wiring({ profile: () => null }))
    expect(await context()).toEqual({ workspaces: [], currentWorkspaceId: null, signedIn: false })
    expect(await ask('hello')).toEqual({ ok: false, code: 'signed_out' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('no selected org lists no workspace without a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    registerUniworkAskUni(ipcMain, wiring({ selectedOrgId: () => null }))
    expect(await context()).toEqual({ workspaces: [], currentWorkspaceId: null, signedIn: true })
    expect(await ask('hello')).toEqual({ ok: false, code: 'error' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
