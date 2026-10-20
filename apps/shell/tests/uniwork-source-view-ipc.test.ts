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

  it('a refused Save As / export / print sends { path, copy: true } so the band also says where to get a copy', () => {
    const owner = host()
    const hint = createSourceSaveHint({ hostForPath: () => owner.contents })
    hint('/x/sources-1/ab/Plan.docx', true)
    expect(owner.sent).toEqual([
      {
        channel: 'uniwork-doc:source-view-hint',
        payload: { path: '/x/sources-1/ab/Plan.docx', copy: true },
      },
    ])
  })

  it('the seam asks for the hint when a registered source is refused, and for nothing on another path', () => {
    const registry = new SourceViewRegistry()
    registry.add('/x/sources-1/ab/Plan.docx', {
      name: 'Plan.docx',
      origin: 'chat',
      parentTitle: '',
    })
    const onSourceLocked = vi.fn()
    const seam = withSourceViews(
      {
        isBound: () => false,
        isReadOnly: () => false,
        isLocked: (path: string) => path === '/x/revoked.docx',
        onUserSave: () => undefined,
        refuseLockedPath: () => false,
      } as never,
      registry,
      { onSourceLocked },
    )
    expect(seam.isLocked?.('/x/sources-1/ab/Plan.docx')).toBe(true)
    expect(onSourceLocked).toHaveBeenCalledWith('/x/sources-1/ab/Plan.docx')
    expect(seam.isLocked?.('/x/revoked.docx')).toBe(true)
    expect(seam.isLocked?.('/x/local.docx')).toBe(false)
    expect(onSourceLocked).toHaveBeenCalledTimes(1)
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

describe('the explicit-Save hint in a detached editor window', () => {
  // a detached window is a bare BrowserWindow around the editor view: no renderer listens there,
  // so the sentence is a native message box on that window
  const win = (label: string) => ({ label })
  const hostSpy = () => {
    const sent: unknown[] = []
    return {
      sent,
      contents: { isDestroyed: () => false, send: (...args: unknown[]) => void sent.push(args) },
    }
  }
  const make = (
    detached: { label: string } | undefined,
    notify: (w: { label: string }, copy?: boolean) => Promise<void>,
  ) => {
    const shell = hostSpy()
    const hint = createSourceSaveHint({
      hostForPath: () => shell.contents,
      detached: { windowForPath: () => detached, notify },
    })
    return { shell, hint }
  }

  it('shows the native box on the detached window and sends nothing to a renderer', () => {
    const w = win('detached-1')
    const shown: Array<{ label: string }> = []
    const { shell, hint } = make(w, (target) => {
      shown.push(target)
      return new Promise<void>(() => undefined)
    })
    hint('/x/sources-1/ab/Plan.docx')
    expect(shown).toEqual([w])
    expect(shell.sent).toEqual([])
  })

  it('tells the native box whether the copy sentence belongs to it', async () => {
    const w = win('detached-1')
    const asked: Array<boolean | undefined> = []
    const { hint } = make(w, (_target, copy) => {
      asked.push(copy)
      return Promise.resolve()
    })
    hint('/x/a.docx')
    // the first box was dismissed (its promise settled), so the next refusal shows again
    await Promise.resolve()
    await Promise.resolve()
    hint('/x/b.docx', true)
    expect(asked.map(Boolean)).toEqual([false, true])
  })

  it('keeps the shell-window path when no detached window shows the path', () => {
    const shown: unknown[] = []
    const { shell, hint } = make(undefined, async (target) => void shown.push(target))
    hint('/x/sources-1/ab/Plan.docx')
    expect(shown).toEqual([])
    expect(shell.sent).toEqual([
      ['uniwork-doc:source-view-hint', { path: '/x/sources-1/ab/Plan.docx' }],
    ])
  })

  it('shows at most one box at a time per window, and again once it was dismissed', async () => {
    const w = win('detached-1')
    let calls = 0
    let dismiss: () => void = () => undefined
    const { hint } = make(w, () => {
      calls++
      return new Promise<void>((resolve) => {
        dismiss = resolve
      })
    })
    hint('/x/a.docx')
    hint('/x/a.docx')
    hint('/x/a.docx')
    expect(calls).toBe(1)
    dismiss()
    await vi.waitFor(() => {
      hint('/x/a.docx')
      expect(calls).toBe(2)
    })
  })

  it('throttles per window: a second detached window still gets its own box', () => {
    const windows = new Map([
      ['/x/a.docx', win('A')],
      ['/x/b.docx', win('B')],
    ])
    const shown: string[] = []
    const hint = createSourceSaveHint({
      hostForPath: () => undefined,
      detached: {
        windowForPath: (path) => windows.get(path),
        notify: (target) => {
          shown.push(target.label)
          return new Promise<void>(() => undefined)
        },
      },
    })
    hint('/x/a.docx')
    hint('/x/b.docx')
    hint('/x/a.docx')
    expect(shown).toEqual(['A', 'B'])
  })

  it('a box that failed to show frees the window for the next Save', async () => {
    const w = win('detached-1')
    let calls = 0
    const { hint } = make(w, () => {
      calls++
      return Promise.reject(new Error('window gone'))
    })
    hint('/x/a.docx')
    await vi.waitFor(() => {
      hint('/x/a.docx')
      expect(calls).toBeGreaterThanOrEqual(2)
    })
  })

  it('index.ts glue: the detached branch is a native box with the main-side sentence in every locale', () => {
    const index = readFileSync(join(__dirname, '..', 'src/main/index.ts'), 'utf8')
    const glue = index.slice(index.indexOf('createSourceSaveHint({'))
    expect(glue.slice(0, 1500)).toMatch(
      /detached: \{[\s\S]*?dialog\.showMessageBox\([\s\S]*?message: tm\('uwSourceViewSaveHint'\)/,
    )
    // the refusal of Save As / export / print goes through the same hint, with the copy sentence
    expect(glue.slice(0, 1500)).toMatch(/onSourceLocked: \(path\) => \w+\(path, true\)/)
    expect(glue.slice(0, 1500)).toContain("tm('uwSourceViewCopyHint')")
    const table = index.slice(
      index.indexOf('const tMain = createI18n('),
      index.indexOf('const tm = '),
    )
    // the shell's main table is per-locale (zh defines the key set, the type check covers the rest)
    expect([...table.matchAll(/^ {4}uwSourceViewSaveHint:/gm)]).toHaveLength(
      [...table.matchAll(/^ {2}(?:'zh-TW'|[a-z]{2}): \{$/gm)].length,
    )
    expect([...table.matchAll(/^ {4}uwSourceViewCopyHint:/gm)]).toHaveLength(
      [...table.matchAll(/^ {2}(?:'zh-TW'|[a-z]{2}): \{$/gm)].length,
    )
    expect(table).toContain("uwSourceViewSaveHint: 'Tệp này chỉ để xem — thay đổi không được lưu.'")
    expect(table).toContain(
      'uwSourceViewSaveHint: "This file is view only — changes aren\'t saved."',
    )
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
