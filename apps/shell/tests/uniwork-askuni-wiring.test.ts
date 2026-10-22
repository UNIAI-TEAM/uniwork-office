import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain, WebContents } from 'electron'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { registerUniworkAskUni, type UniworkAskUniWiring } from '../src/main/uniwork-askuni/index'
import { ASKUNI_CHANNELS, ASKUNI_DOC_CHANNELS, ASKUNI_V2_CHANNELS } from '../src/shared/askuni-api'

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
// UNI-2076: only the shell's main frame reaches the handlers (sender.ts)
const SHELL = { mainFrame: {}, isDestroyed: () => false }
const FROM_SHELL = { sender: SHELL, senderFrame: SHELL.mainFrame }
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
    openDocument: async () => ({ ok: true, value: { path: '/tmp/doc.docx' } }),
    openExternal: async () => undefined,
    shellContents: () => SHELL as unknown as WebContents,
    ...over,
  }
}

const ask = (question: string) =>
  handlers.get(ASKUNI_CHANNELS.ask)!(FROM_SHELL, { workspaceId: WS, question, locale: 'en' })
const context = () => handlers.get(ASKUNI_CHANNELS.context)!(FROM_SHELL)

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
    const result = await handlers.get(ASKUNI_CHANNELS.ask)!(FROM_SHELL, {
      workspaceId: ctx.workspaces[0].id,
      question: 'none: x',
      locale: 'en',
    })
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

describe('registerUniworkAskUni: the editor family (UNI-2076 s7b)', () => {
  const EDITOR = {
    id: 7,
    mainFrame: { url: 'genoffice-app://docs/index.html' },
    isDestroyed: () => false,
  }
  const FROM_EDITOR = { sender: EDITOR, senderFrame: EDITOR.mainFrame }
  const editorWiring = (over: Partial<UniworkAskUniWiring> = {}) =>
    wiring({
      packaged: false,
      isEditorContents: (id) => id === 7,
      editorPath: (sender) => (sender.id === 7 ? '/w/plan.docx' : null),
      docBinding: () => ({ workspaceId: WS, documentId: '01J8DOC0000000000000000001' }),
      ...over,
    })
  const docFlags = (event: unknown) => handlers.get(ASKUNI_DOC_CHANNELS.flags)!(event)

  it('an editor main frame reaches the doc family with its bound state', async () => {
    registerUniworkAskUni(ipcMain, editorWiring())
    expect(await docFlags(FROM_EDITOR)).toEqual({ streamEnabled: true, bound: 'document' })
  })

  it('the shell page is refused on the doc family; an editor on the shell family', async () => {
    registerUniworkAskUni(ipcMain, editorWiring({ isEditorContents: () => true }))
    expect(await docFlags(FROM_SHELL)).toEqual({ ok: false, error: 'forbidden' })
    expect(await handlers.get(ASKUNI_V2_CHANNELS.flags)!(FROM_EDITOR)).toEqual({
      ok: false,
      error: 'forbidden',
    })
  })

  it('without the editor wiring every editor call is refused', async () => {
    registerUniworkAskUni(ipcMain, wiring({ packaged: false }))
    expect(await docFlags(FROM_EDITOR)).toEqual({ ok: false, error: 'forbidden' })
  })
})

describe('registerUniworkAskUni: a stream client that throws synchronously (UNI-2076 s1f RB-4)', () => {
  it('a profile with an unusable apiOrigin ends the editor run with one error terminal', async () => {
    const sent: unknown[] = []
    const EDITOR = {
      id: 7,
      mainFrame: { url: 'genoffice-app://docs/index.html' },
      isDestroyed: () => false,
      send: (_channel: string, ev: unknown) => void sent.push(ev),
      once: () => undefined,
      on: () => undefined,
      removeListener: () => undefined,
    }
    registerUniworkAskUni(
      ipcMain,
      wiring({
        packaged: false,
        env: {},
        profile: () => ({ ...PROFILE, apiOrigin: 'not a url' }),
        isEditorContents: (id) => id === 7,
        editorPath: () => '/w/plan.docx',
        docBinding: () => ({ workspaceId: WS, documentId: '01J8DOC0000000000000000001' }),
      }),
    )
    const start = await handlers.get(ASKUNI_DOC_CHANNELS.stream)!(
      { sender: EDITOR, senderFrame: EDITOR.mainFrame },
      { question: 'hi', locale: 'en' },
    )
    expect(start).toMatchObject({ ok: true })
    await new Promise((r) => setTimeout(r, 20))
    expect(sent).toEqual([
      { type: 'error', code: 'error', requestId: (start as { requestId: string }).requestId },
    ])
  })
})
