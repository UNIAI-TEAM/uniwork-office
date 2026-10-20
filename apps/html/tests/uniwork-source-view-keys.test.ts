import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: { sender: FakeWebContents }, ...args: unknown[]) => unknown

interface FakeWebContents {
  id: number
  listeners: Map<string, () => void>
  isDestroyed: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  setWindowOpenHandler: ReturnType<typeof vi.fn>
}

const inputListeners = new Map<string, (...args: never[]) => void>()
const handlers = new Map<string, IpcHandler>()
const showSaveDialogWithMemory = vi.fn()
const webContents: FakeWebContents[] = []
let nextWebContentsId = 1

function makeWebContents(): FakeWebContents {
  const listeners = new Map<string, () => void>()
  const contents: FakeWebContents = {
    id: nextWebContentsId++,
    listeners,
    isDestroyed: vi.fn(() => false),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    on: vi.fn((event: string, listener: (...args: never[]) => void) =>
      inputListeners.set(event, listener),
    ),
    once: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  }
  webContents.push(contents)
  return contents
}

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpdir()),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => {})),
  },
  BrowserWindow: class {
    static fromWebContents() {
      return null
    }
    static getFocusedWindow() {
      return null
    }
  },
  dialog: { showMessageBox: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    removeHandler: vi.fn(),
  },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  WebContentsView: class {
    webContents = makeWebContents()
  },
}))

vi.mock('@genoffice/electron-utils', () => ({
  configuredDefaultSaveDir: vi.fn(() => tmpdir()),
  contextMenuLabels: vi.fn(() => ({})),
  installContextMenu: vi.fn(),
  installNavigationGuard: vi.fn(),
  rendererUrl: vi.fn(() => 'genoffice-app://html/index.html'),
  safeExternalUrl: vi.fn(() => null),
  showOpenDialogWithMemory: vi.fn(),
  showSaveDialogWithMemory: (...args: unknown[]) => showSaveDialogWithMemory(...args),
}))

import { createHtmlView, setUniworkDocumentPolicy } from '../src/main/html-main'
import { HTML_CHANNELS } from '../src/shared/ipc'

const directories: string[] = []

async function openDocument(): Promise<{ path: string; contents: FakeWebContents }> {
  const directory = await mkdtemp(join(tmpdir(), 'html-source-keys-'))
  directories.push(directory)
  const path = join(directory, 'mail.html')
  await writeFile(path, 'old')
  const view = createHtmlView(path)
  return { path, contents: view.webContents as unknown as FakeWebContents }
}

/** a key reaching the view's webContents from any frame, before the page or the menu sees it */
function press(
  key: string,
  mods: { control?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
) {
  const preventDefault = vi.fn()
  const listener = inputListeners.get('before-input-event')
  listener?.(
    { preventDefault } as never,
    {
      type: 'keyDown',
      key,
      isAutoRepeat: false,
      control: false,
      meta: false,
      shift: false,
      alt: false,
      ...mods,
    } as never,
  )
  return { preventDefault }
}

afterEach(async () => {
  setUniworkDocumentPolicy(null)
  inputListeners.clear()
  for (const contents of webContents.splice(0)) contents.listeners.get('destroyed')?.()
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

/**
 * F2: Ctrl+S with the focus inside the preview frame never reached the renderer's own key handler.
 * Main sees every key of the view (any frame, scripts or not), so a read-only UniWork copy gets
 * the same explanation as Ctrl+S outside the frame, once.
 */
describe('Ctrl+S on a read-only UniWork copy, whichever frame has the focus', () => {
  it.each([
    ['control', { control: true }],
    ['meta', { meta: true }],
  ])('explains instead of saving, and swallows the key (%s)', async (_n, mods) => {
    const { path } = await openDocument()
    const readOnlySave = vi.fn()
    setUniworkDocumentPolicy({
      isBound: (p) => p === path,
      isReadOnly: (p) => p === path,
      readOnlySave,
    })
    const { preventDefault } = press('s', mods)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(readOnlySave).toHaveBeenCalledTimes(1)
    expect(readOnlySave).toHaveBeenCalledWith(path)
  })

  it('does not repeat the explanation for a held key', async () => {
    const { path } = await openDocument()
    const readOnlySave = vi.fn()
    setUniworkDocumentPolicy({
      isBound: (p) => p === path,
      isReadOnly: (p) => p === path,
      readOnlySave,
    })
    inputListeners.get('before-input-event')?.(
      { preventDefault: vi.fn() } as never,
      { type: 'keyDown', key: 's', control: true, isAutoRepeat: true } as never,
    )
    expect(readOnlySave).not.toHaveBeenCalled()
  })

  it.each([
    ['an editable bound copy', { isBound: () => true, isReadOnly: () => false }],
    ['an unbound read-only file', { isBound: () => false, isReadOnly: () => true }],
  ])('leaves the key alone on %s', async (_n, policy) => {
    await openDocument()
    const readOnlySave = vi.fn()
    setUniworkDocumentPolicy({ ...policy, readOnlySave })
    const { preventDefault } = press('s', { control: true })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(readOnlySave).not.toHaveBeenCalled()
  })

  it('leaves other chords alone (Save As, plain s, Ctrl+Alt+S)', async () => {
    const { path } = await openDocument()
    const readOnlySave = vi.fn()
    setUniworkDocumentPolicy({
      isBound: (p) => p === path,
      isReadOnly: (p) => p === path,
      readOnlySave,
    })
    for (const mods of [{ control: true, shift: true }, {}, { control: true, alt: true }]) {
      const { preventDefault } = press('s', mods)
      expect(preventDefault).not.toHaveBeenCalled()
    }
    expect(readOnlySave).not.toHaveBeenCalled()
  })
})

describe('uniworkState answers the lock to the renderer', () => {
  it.each([
    [true, { bound: true, readOnly: true, locked: true }],
    [false, { bound: true, readOnly: true }],
  ])('isLocked=%s answers %j', async (locked, expected) => {
    const { path, contents } = await openDocument()
    setUniworkDocumentPolicy({
      isBound: (p) => p === path,
      isReadOnly: (p) => p === path,
      isLocked: () => locked,
    })
    const state = handlers.get(HTML_CHANNELS.uniworkState)!({ sender: contents })
    expect(state).toEqual(expected)
  })

  it('asks the quiet peekLocked, never isLocked: opening a locked file is not a refusal', async () => {
    const { path, contents } = await openDocument()
    const isLocked = vi.fn(() => true)
    setUniworkDocumentPolicy({
      isBound: (p) => p === path,
      isReadOnly: (p) => p === path,
      isLocked,
      peekLocked: () => true,
    })
    const state = handlers.get(HTML_CHANNELS.uniworkState)!({ sender: contents })
    expect(state).toEqual({ bound: true, readOnly: true, locked: true })
    expect(isLocked).not.toHaveBeenCalled()
  })

  it('falls back to isLocked when the policy has no peekLocked', async () => {
    const { path, contents } = await openDocument()
    setUniworkDocumentPolicy({
      isBound: (p) => p === path,
      isReadOnly: (p) => p === path,
      isLocked: () => true,
    })
    const state = handlers.get(HTML_CHANNELS.uniworkState)!({ sender: contents })
    expect(state).toEqual({ bound: true, readOnly: true, locked: true })
  })

  it('is not locked without a policy or without isLocked', async () => {
    const { contents } = await openDocument()
    expect(handlers.get(HTML_CHANNELS.uniworkState)!({ sender: contents })).toEqual({
      bound: false,
      readOnly: false,
    })
  })
})
