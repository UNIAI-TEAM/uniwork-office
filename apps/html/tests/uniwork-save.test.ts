import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  once: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  setWindowOpenHandler: ReturnType<typeof vi.fn>
}

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

import {
  createHtmlView,
  htmlSaveToPath,
  requestHtmlSave,
  setHtmlUserSaveHook,
  setUniworkDocumentPolicy,
} from '../src/main/html-main'
import { HTML_CHANNELS } from '../src/shared/ipc'
import type { SaveHtmlRequest, SaveHtmlResult } from '../src/shared/ipc'

const directories: string[] = []

async function openDocument(): Promise<{ path: string; contents: FakeWebContents }> {
  const directory = await mkdtemp(join(tmpdir(), 'html-uniwork-'))
  directories.push(directory)
  const path = join(directory, 'page.html')
  await writeFile(path, 'old')
  const view = createHtmlView(path)
  return { path, contents: view.webContents as unknown as FakeWebContents }
}

function save(
  contents: FakeWebContents,
  request: Partial<SaveHtmlRequest>,
): Promise<SaveHtmlResult> {
  const handler = handlers.get(HTML_CHANNELS.save)!
  return handler(
    { sender: contents },
    { text: 'new', imageSources: [], mode: 'save', ...request },
  ) as Promise<SaveHtmlResult>
}

function bindPolicy(path: string, readOnly = false): void {
  setUniworkDocumentPolicy({
    isBound: (p) => p === path,
    isReadOnly: (p) => readOnly && p === path,
  })
}

afterEach(async () => {
  setUniworkDocumentPolicy(null)
  setHtmlUserSaveHook(null)
  showSaveDialogWithMemory.mockReset()
  for (const contents of webContents.splice(0)) contents.listeners.get('destroyed')?.()
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('html UniWork user-save hook', () => {
  it('fires once for an explicit Save that rewrote the same file', async () => {
    const { path, contents } = await openDocument()
    const hook = vi.fn()
    setHtmlUserSaveHook(hook)
    await expect(save(contents, {})).resolves.toMatchObject({ ok: true, path })
    expect(await readFile(path, 'utf8')).toBe('new')
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(path)
  })

  it('does not fire for an AutoSave of a plain local file, which still writes', async () => {
    const { path, contents } = await openDocument()
    const hook = vi.fn()
    setHtmlUserSaveHook(hook)
    await expect(save(contents, { origin: 'auto' })).resolves.toMatchObject({ ok: true, path })
    expect(await readFile(path, 'utf8')).toBe('new')
    expect(hook).not.toHaveBeenCalled()
  })

  it('does not fire for Save As to another path', async () => {
    const { path, contents } = await openDocument()
    const copy = join(path, '..', 'copy.html')
    showSaveDialogWithMemory.mockResolvedValue({ canceled: false, filePath: copy })
    const hook = vi.fn()
    setHtmlUserSaveHook(hook)
    await expect(save(contents, { mode: 'saveAs' })).resolves.toMatchObject({
      ok: true,
      path: copy,
    })
    expect(hook).not.toHaveBeenCalled()
  })

  it('fires once for a Save As that picks the open file itself', async () => {
    const { path, contents } = await openDocument()
    showSaveDialogWithMemory.mockResolvedValue({ canceled: false, filePath: path })
    const hook = vi.fn()
    setHtmlUserSaveHook(hook)
    await expect(save(contents, { mode: 'saveAs' })).resolves.toMatchObject({ ok: true, path })
    expect(await readFile(path, 'utf8')).toBe('new')
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(path)
  })

  it('does not fire for an agent save-to-path', async () => {
    const { path, contents } = await openDocument()
    const hook = vi.fn()
    setHtmlUserSaveHook(hook)
    const done = htmlSaveToPath(contents as never, path)
    await save(contents, {})
    await expect(done).resolves.toBeUndefined()
    expect(await readFile(path, 'utf8')).toBe('new')
    expect(hook).not.toHaveBeenCalled()
  })
})

describe('html bound and view-only UniWork copies', () => {
  it('AutoSave never writes a bound copy', async () => {
    const { path, contents } = await openDocument()
    bindPolicy(path)
    const hook = vi.fn()
    setHtmlUserSaveHook(hook)
    await expect(save(contents, { origin: 'auto' })).resolves.toEqual({ ok: true, canceled: true })
    expect(await readFile(path, 'utf8')).toBe('old')
    expect(hook).not.toHaveBeenCalled()
  })

  it('an explicit Save of a clean bound copy still asks the renderer to write', async () => {
    const { path, contents } = await openDocument()
    void requestHtmlSave(contents as never, 'save')
    expect(contents.send).not.toHaveBeenCalledWith(HTML_CHANNELS.saveRequest, 'save')
    bindPolicy(path)
    void requestHtmlSave(contents as never, 'save')
    expect(contents.send).toHaveBeenCalledWith(HTML_CHANNELS.saveRequest, 'save')
  })

  it('refuses to write a view-only copy and does not fire the hook', async () => {
    const { path, contents } = await openDocument()
    bindPolicy(path, true)
    const hook = vi.fn()
    setHtmlUserSaveHook(hook)
    // an in-place Save ends quietly (the renderer leaves the decision to main)
    await expect(save(contents, {})).resolves.toEqual({ ok: true, canceled: true })
    expect(await readFile(path, 'utf8')).toBe('old')
    // picking the view-only file itself in Save As is refused with a reason
    showSaveDialogWithMemory.mockResolvedValue({ canceled: false, filePath: path })
    await expect(save(contents, { mode: 'saveAs' })).resolves.toMatchObject({ ok: false })
    expect(await readFile(path, 'utf8')).toBe('old')
    expect(hook).not.toHaveBeenCalled()
  })

  it('still lets Save As make a plain local copy of a view-only document', async () => {
    const { path, contents } = await openDocument()
    bindPolicy(path, true)
    const copy = join(path, '..', 'copy.html')
    showSaveDialogWithMemory.mockResolvedValue({ canceled: false, filePath: copy })
    await expect(save(contents, { mode: 'saveAs' })).resolves.toMatchObject({
      ok: true,
      path: copy,
    })
    expect(await readFile(copy, 'utf8')).toBe('new')
    expect(await readFile(path, 'utf8')).toBe('old')
  })

  it('reports bound and view-only state to the renderer for its own document', async () => {
    const { path, contents } = await openDocument()
    const state = handlers.get(HTML_CHANNELS.uniworkState)!
    expect(state({ sender: contents })).toEqual({ bound: false, readOnly: false })
    bindPolicy(path, true)
    expect(state({ sender: contents })).toEqual({ bound: true, readOnly: true })
  })
})
