/**
 * UNI-1993 (UW-SOURCE-RO) slice C1: the IPC handlers over the real wiring, the
 * account-boundary hook, and the "view only" hint to the window that owns the
 * path. Electron is mocked the way the other wiring tests do; the network is a
 * stubbed `fetch`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SOURCE_VIEW_CHANNELS, type OpenSourceInput } from '../src/shared/source-view'
import type { AccountStatus } from '../src/shared/home-api'
import {
  SourceViewRegistry,
  createSourceSaveHint,
  withSourceViews,
} from '../src/main/uniwork-docs/source-view'

let dir = ''
let statusListener: ((status: AccountStatus) => void) | null = null
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null
const BYTES = new Uint8Array([80, 75, 3, 4, 9, 9])

vi.mock('electron', () => ({
  app: { getPath: () => dir, configureHostResolver: () => undefined },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`ENC1${text}`),
    decryptString: (buf: Buffer) => buf.toString().slice(4),
  },
  session: {
    defaultSession: {
      setSpellCheckerDictionaryDownloadURL: () => undefined,
      getSpellCheckerLanguages: () => ['en-US'],
      setSpellCheckerLanguages: () => undefined,
      isSpellCheckerEnabled: () => true,
      setSpellCheckerEnabled: () => undefined,
    },
  },
}))

vi.mock('../src/main/uniwork-auth', () => ({
  authorizedRequest: <T>(call: (token: string) => Promise<T>) => call('tok'),
  setUniworkSignOutHooks: vi.fn(),
  onUniworkAccountStatus: (listener: (status: AccountStatus) => void) => {
    statusListener = listener
    return () => undefined
  },
  uniworkAccount: () => ({ status: () => ({ loggedIn: true, state: 'signed-in' }) }),
  uniworkDeploymentProfile: () => ({
    deploymentId: 'default',
    apiOrigin: 'https://uniwork.example',
    clientId: 'uniwork-office',
    channel: 'stable',
  }),
  uniworkSessionIdentity: () => identity,
}))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-source-view-ipc-'))
  statusListener = null
  identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    if (/\/documents\/sources\/[^/]+\/download$/.test(path)) {
      return Promise.resolve(new Response(BYTES, { status: 200 }))
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          sync_feed: false,
          sync_write: false,
          offline_library: false,
          ai_uniwork: false,
          ai_uniwork_formats: [],
          ttl_seconds: 300,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

const input = (over: Partial<OpenSourceInput> = {}): OpenSourceInput => ({
  workspaceId: 'ws_1',
  sourceId: 'chat:msg-1',
  name: 'Plan.docx',
  extension: 'docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sizeBytes: BYTES.length,
  updatedAt: '2026-10-20T00:00:00Z',
  origin: 'chat',
  parent: { kind: 'chat', title: 'Launch' },
  ...over,
})

async function setup() {
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const opened: string[] = []
  const closedNow: string[] = []
  const handle = createUniworkDocs(
    {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    } as never,
    {
      shellWindow: () => null,
      shellContents: () => null,
      openPath: (path: string) => {
        opened.push(path)
        return true
      },
      refuseLockedPath: () => false,
      isPathOpen: (path: string) => opened.includes(path) && !closedNow.includes(path),
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      reveal: () => undefined,
      lang: () => 'en',
      defaultSaveDir: () => dir,
      openPaths: () => opened.filter((p) => !closedNow.includes(p)),
      closePath: async () => true,
      confirmClosePath: async () => true,
      closePathNow: (path: string) => void closedNow.push(path),
      aiHistoryPaths: () => [],
      forgetAiHistory: () => undefined,
      editorStateOf: async () => ({ dirty: false, aiRunning: false, aiEpoch: 0 }),
      notifyPathRenamed: () => undefined,
    },
  )
  return { handle, handlers, opened, closedNow }
}

describe('the source-view IPC (FIXED API)', () => {
  it('registers invoke handlers for open-source and source-view-state, and none for the hint push', async () => {
    const { handlers } = await setup()
    expect(SOURCE_VIEW_CHANNELS.hint).toBe('uniwork-doc:source-view-hint')
    expect(handlers.has(SOURCE_VIEW_CHANNELS.openSource)).toBe(true)
    expect(handlers.has(SOURCE_VIEW_CHANNELS.sourceViewState)).toBe(true)
    expect(handlers.has(SOURCE_VIEW_CHANNELS.hint)).toBe(false)
  })

  it('open-source maps onto service.openSource and answers the result shape', async () => {
    const { handle, handlers, opened } = await setup()
    const res = (await handlers.get(SOURCE_VIEW_CHANNELS.openSource)!(null, input())) as {
      ok: boolean
      value: { path: string; reused: boolean }
    }
    expect(res.ok).toBe(true)
    expect(opened).toEqual([res.value.path])
    expect(handle.service.sourceViews.has(res.value.path)).toBe(true)
  })

  it('answers an error result (never throws across IPC) for a malformed input, a signed-out session and a service that rejects', async () => {
    const { handle, handlers } = await setup()
    const call = handlers.get(SOURCE_VIEW_CHANNELS.openSource)!
    expect(await call(null, null)).toEqual({ ok: false, error: 'not_found' })
    expect(await call(null, 'x')).toEqual({ ok: false, error: 'not_found' })
    identity = null
    expect(await call(null, input())).toEqual({ ok: false, error: 'not_signed_in' })
    identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
    vi.spyOn(handle.service, 'openSource').mockRejectedValueOnce(new Error('boom'))
    expect(await call(null, input())).toEqual({ ok: false, error: 'open_failed' })
  })

  it('source-view-state answers the registry meta, and null for anything else', async () => {
    const { handlers } = await setup()
    const call = handlers.get(SOURCE_VIEW_CHANNELS.sourceViewState)!
    const res = (await handlers.get(SOURCE_VIEW_CHANNELS.openSource)!(null, input())) as {
      value: { path: string }
    }
    expect(await call(null, res.value.path)).toEqual({
      name: 'Plan.docx',
      origin: 'chat',
      parentTitle: 'Launch',
    })
    expect(await call(null, join(dir, 'other.docx'))).toBeNull()
    expect(await call(null, undefined)).toBeNull()
    expect(await call(null, 42)).toBeNull()
    expect(await call(null, { path: res.value.path })).toBeNull()
  })
})

describe('the account boundary through the wiring', () => {
  it('an account status push that crosses the boundary closes the source tabs and deletes the files', async () => {
    const { handle, handlers, closedNow } = await setup()
    handle.activate(() => undefined)
    const res = (await handlers.get(SOURCE_VIEW_CHANNELS.openSource)!(null, input())) as {
      value: { path: string }
    }
    expect(existsSync(res.value.path)).toBe(true)
    identity = null
    statusListener?.({ loggedIn: false, state: 'signed-out' } as AccountStatus)
    await vi.waitFor(() => expect(closedNow).toContain(res.value.path))
    await vi.waitFor(() => expect(existsSync(res.value.path)).toBe(false))
    expect(handle.service.sourceViews.paths()).toEqual([])
  })
})

describe('the explicit-Save hint', () => {
  const host = (destroyed = false) => {
    const sent: Array<{ channel: string; payload: unknown }> = []
    return {
      sent,
      contents: {
        isDestroyed: () => destroyed,
        send: (channel: string, payload: unknown) => void sent.push({ channel, payload }),
      },
    }
  }

  it('sends { path } on the hint channel to the window that owns the path', () => {
    const owner = host()
    const asked: string[] = []
    const hint = createSourceSaveHint({
      hostForPath: (path) => {
        asked.push(path)
        return owner.contents
      },
    })
    hint('/x/sources-1/ab/Plan.docx')
    expect(asked).toEqual(['/x/sources-1/ab/Plan.docx'])
    expect(owner.sent).toEqual([
      { channel: 'uniwork-doc:source-view-hint', payload: { path: '/x/sources-1/ab/Plan.docx' } },
    ])
  })

  it('sends nothing when no window shows the path or its window is gone', () => {
    const gone = host(true)
    expect(() => createSourceSaveHint({ hostForPath: () => undefined })('/x/a.docx')).not.toThrow()
    createSourceSaveHint({ hostForPath: () => gone.contents })('/x/a.docx')
    expect(gone.sent).toEqual([])
  })

  it('the seam delivers an explicit Save on a registered source to the hint, and nothing for another path', () => {
    const owner = host()
    const registry = new SourceViewRegistry()
    registry.add('/x/sources-1/ab/Plan.docx', {
      name: 'Plan.docx',
      origin: 'chat',
      parentTitle: '',
    })
    const hint = createSourceSaveHint({ hostForPath: () => owner.contents })
    const seam = withSourceViews(
      {
        isBound: () => false,
        isReadOnly: () => false,
        onUserSave: () => undefined,
        refuseLockedPath: () => false,
      } as never,
      registry,
      { onSourceSave: hint },
    )
    seam.onReadOnlySave?.('/x/sources-1/ab/Plan.docx')
    expect(owner.sent).toHaveLength(1)
    seam.onReadOnlySave?.('/x/local.docx')
    expect(owner.sent).toHaveLength(1)
  })
})

describe('main-side entries that act on a path must not touch a source view', () => {
  const index = readFileSync(join(__dirname, '..', 'src/main/index.ts'), 'utf8')

  it('renameFile refuses a registered source path before anything is validated or renamed', () => {
    const from = index.indexOf('HOME_CHANNELS.renameFile,')
    expect(from).toBeGreaterThan(-1)
    const handler = index.slice(from, index.indexOf('HOME_CHANNELS.duplicateFile', from))
    const guard = handler.indexOf('uniworkDocs?.service.sourceViews.has(path)')
    expect(guard).toBeGreaterThan(-1)
    // a renamed temp file would leave the registry and read as a plain editable local file
    expect(guard).toBeLessThan(handler.indexOf('renameSync('))
    expect(handler.slice(guard, guard + 160)).toContain("ok: false, error: tm('errBadArgs')")
  })

  it('the native tab menu has only Open in new window, the bound-document offline pin and Close', () => {
    const from = index.indexOf('TABS_CHANNELS.showTabMenu,')
    const menu = index.slice(from, index.indexOf('TABS_CHANNELS.showNewMenu', from))
    const labels = [...menu.matchAll(/label: (tm\('\w+'\))/g)].map((m) => m[1])
    expect(labels).toEqual(["tm('menuOpenInNewWindow')", "tm('menuClose')"])
    // the one document-only entry is keyed by a stored binding, which a source never has
    expect(menu).toContain('offlineBindingOf(tab.filePath)')
  })
})
