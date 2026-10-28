import { statSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DiskWatchFs, DocumentDiskWatcher } from '@genoffice/electron-utils/disk-watch'

type IpcHandler = (event: { sender: FakeWebContents }, ...args: unknown[]) => unknown

interface FakeWebContents {
  id: number
  listeners: Map<string, () => void>
  isDestroyed: Mock
  loadFile: Mock
  loadURL: Mock
  once: Mock
  send: Mock
  setWindowOpenHandler: Mock
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

type StatsLike = { mtimeMs: number; size: number; nlink: number }
const watchListeners = new Map<string, Set<(curr: StatsLike) => void>>()

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
  rendererUrl: vi.fn(() => 'genoffice-app://markdown/index.html'),
  safeExternalUrl: vi.fn(() => null),
  showOpenDialogWithMemory: vi.fn(),
  showSaveDialogWithMemory: (...args: unknown[]) => showSaveDialogWithMemory(...args),
}))

vi.mock('@genoffice/electron-utils/disk-watch', async () => {
  const actual = (await vi.importActual('@genoffice/electron-utils/disk-watch')) as {
    createDocumentDiskWatcher: (
      onChanged: (path: string) => void,
      options?: { intervalMs?: number; fs?: DiskWatchFs },
    ) => DocumentDiskWatcher
  }
  const testFs: DiskWatchFs = {
    watchFile(path, _interval, listener) {
      let set = watchListeners.get(path)
      if (!set) {
        set = new Set()
        watchListeners.set(path, set)
      }
      set.add(listener)
    },
    unwatchFile(path, listener) {
      watchListeners.get(path)?.delete(listener)
    },
    async stat(path) {
      try {
        const s = statSync(path)
        return { mtimeMs: s.mtimeMs, size: s.size, nlink: s.nlink }
      } catch {
        return null
      }
    },
  }
  return {
    ...actual,
    createDocumentDiskWatcher: (
      onChanged: (path: string) => void,
      options?: { intervalMs?: number; fs?: DiskWatchFs },
    ) => actual.createDocumentDiskWatcher(onChanged, { ...options, fs: testFs }),
  }
})

import {
  createMarkdownView,
  markdownFileRenamed,
  markdownSaveToPath,
  setUniworkDocumentPolicy,
} from '../src/main/markdown-main'
import { MARKDOWN_CHANNELS } from '../src/shared/ipc'
import type { SaveMarkdownRequest, SaveMarkdownResult } from '../src/shared/ipc'

const directories: string[] = []

async function settleWatch(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

async function openDocument(bind?: {
  readOnly?: boolean
}): Promise<{ path: string; dir: string; contents: FakeWebContents }> {
  const dir = await mkdtemp(join(tmpdir(), 'md-disk-watch-'))
  directories.push(dir)
  const path = join(dir, 'note.md')
  await writeFile(path, 'initial')
  if (bind) {
    setUniworkDocumentPolicy({
      isBound: (p) => p === path,
      isReadOnly: (p) => Boolean(bind.readOnly) && p === path,
    })
  }
  const view = createMarkdownView(path)
  await settleWatch()
  return { path, dir, contents: view.webContents as unknown as FakeWebContents }
}

async function externalEdit(path: string, nextText: string): Promise<void> {
  const before = await stat(path)
  await writeFile(path, nextText)
  const nextTime = new Date(before.mtimeMs + 5000)
  await utimes(path, nextTime, nextTime)
  const after = await stat(path)
  for (const listener of watchListeners.get(path) ?? []) {
    listener({ mtimeMs: after.mtimeMs, size: after.size, nlink: after.nlink })
  }
}

function save(
  contents: FakeWebContents,
  request: Partial<SaveMarkdownRequest>,
): Promise<SaveMarkdownResult> {
  const handler = handlers.get(MARKDOWN_CHANNELS.save)!
  return handler(
    { sender: contents },
    { text: 'my edit', imageSources: [], mode: 'save', ...request },
  ) as Promise<SaveMarkdownResult>
}

function ack(contents: FakeWebContents): void {
  const handler = handlers.get(MARKDOWN_CHANNELS.ackFileChangedOnDisk)!
  handler({ sender: contents })
}

afterEach(async () => {
  setUniworkDocumentPolicy(null)
  showSaveDialogWithMemory.mockReset()
  for (const contents of webContents.splice(0)) contents.listeners.get('destroyed')?.()
  watchListeners.clear()
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('markdown disk watcher vs UniWork bound copies', () => {
  it('local unbound file changed outside: emits fileChangedOnDisk, refuses Save with conflict:true until overwrite:true or acknowledged', async () => {
    const { path, contents } = await openDocument()
    expect(watchListeners.get(path)?.size).toBe(1)

    await externalEdit(path, 'outside edit from another program')
    expect(contents.send).toHaveBeenCalledWith(MARKDOWN_CHANNELS.fileChangedOnDisk, path)

    // Save without overwrite is refused with conflict:true; file on disk is untouched
    const refused = await save(contents, { text: 'user text' })
    expect(refused).toEqual({
      ok: false,
      error: 'markdown: file changed on disk',
      conflict: true,
    })
    expect(await readFile(path, 'utf8')).toBe('outside edit from another program')

    // Save with overwrite:true succeeds and re-baselines the watcher
    const written = await save(contents, { text: 'user overwrite', overwrite: true })
    expect(written).toMatchObject({ ok: true, path })
    expect(await readFile(path, 'utf8')).toBe('user overwrite')

    // Subsequent Save without overwrite succeeds because own write re-baselined
    const second = await save(contents, { text: 'second user save' })
    expect(second).toMatchObject({ ok: true, path })
    expect(await readFile(path, 'utf8')).toBe('second user save')

    // External edit followed by ackFileChangedOnDisk re-baselines so next Save succeeds
    await externalEdit(path, 'third party edit 2')
    ack(contents)
    await settleWatch()
    const afterAck = await save(contents, { text: 'saved after ack' })
    expect(afterAck).toMatchObject({ ok: true, path })
    expect(await readFile(path, 'utf8')).toBe('saved after ack')
  })

  it('UniWork bound copy: does not watch at open, emits no fileChangedOnDisk, and never refuses Save with conflict', async () => {
    const { path, contents } = await openDocument({ readOnly: false })
    expect(watchListeners.get(path)?.size ?? 0).toBe(0)

    // Shell rewrites the working copy on disk
    await externalEdit(path, 'shell synced remote head')
    expect(contents.send).not.toHaveBeenCalledWith(MARKDOWN_CHANNELS.fileChangedOnDisk, path)

    // User Save on bound copy writes in place without conflict refusal
    const res = await save(contents, { text: 'bound user edit' })
    expect(res).toMatchObject({ ok: true, path })
    expect(await readFile(path, 'utf8')).toBe('bound user edit')
    expect(watchListeners.get(path)?.size ?? 0).toBe(0)
  })

  it('file that becomes bound after open: suppresses onChanged and skips isCurrent conflict check on Save', async () => {
    const { path, contents } = await openDocument()
    expect(watchListeners.get(path)?.size).toBe(1)

    // Policy now marks the path bound
    setUniworkDocumentPolicy({
      isBound: (p) => p === path,
      isReadOnly: () => false,
    })

    await externalEdit(path, 'shell rewrote bound file')
    expect(contents.send).not.toHaveBeenCalledWith(MARKDOWN_CHANNELS.fileChangedOnDisk, path)

    const res = await save(contents, { text: 'bound save after external edit' })
    expect(res).toMatchObject({ ok: true, path })
    expect(await readFile(path, 'utf8')).toBe('bound save after external edit')
  })

  it('view-only bound copy: external edit does not make Save return conflict (still ends quietly after uniworkSaveDecision)', async () => {
    const { path, contents } = await openDocument()
    // Simulate external change on disk, then policy marks path bound + readOnly
    await externalEdit(path, 'changed on disk before lock')
    setUniworkDocumentPolicy({
      isBound: (p) => p === path,
      isReadOnly: (p) => p === path,
    })

    // In-place Save must hit uniworkSaveDecision first and return canceled:true, never conflict:true
    const res = await save(contents, { text: 'attempted edit' })
    expect(res).toEqual({ ok: true, canceled: true })
    expect(await readFile(path, 'utf8')).toBe('changed on disk before lock')
  })

  it('Save As to a new local path and markdownSaveToPath are not blocked by old baseline, and Save As re-watches the new path', async () => {
    const { path, dir, contents } = await openDocument()
    await externalEdit(path, 'external change on original file')

    // Save As to a new path succeeds even though original file changed on disk
    const copyPath = join(dir, 'copy.md')
    showSaveDialogWithMemory.mockResolvedValue({ canceled: false, filePath: copyPath })
    const saveAsRes = await save(contents, { mode: 'saveAs', text: 'saved as copy' })
    expect(saveAsRes).toMatchObject({ ok: true, path: copyPath })
    expect(await readFile(copyPath, 'utf8')).toBe('saved as copy')

    // Watcher moved from old path to copyPath
    expect(watchListeners.get(path)?.size ?? 0).toBe(0)
    expect(watchListeners.get(copyPath)?.size).toBe(1)

    // External edit on copyPath fires event for copyPath
    contents.send.mockClear()
    await externalEdit(copyPath, 'external change on copy')
    expect(contents.send).toHaveBeenCalledWith(MARKDOWN_CHANNELS.fileChangedOnDisk, copyPath)

    // markdownSaveToPath (MCP) is not blocked by unacknowledged disk change
    const mcpDone = markdownSaveToPath(contents as never, copyPath)
    const mcpSaveRes = await save(contents, { text: 'mcp save text' })
    expect(mcpSaveRes).toMatchObject({ ok: true, path: copyPath })
    await expect(mcpDone).resolves.toBeUndefined()
    expect(await readFile(copyPath, 'utf8')).toBe('mcp save text')

    // Rename re-watches new unbound path
    const renamedPath = join(dir, 'renamed.md')
    await writeFile(renamedPath, 'mcp save text')
    markdownFileRenamed(contents as never, copyPath, renamedPath)
    await settleWatch()
    expect(watchListeners.get(copyPath)?.size ?? 0).toBe(0)
    expect(watchListeners.get(renamedPath)?.size).toBe(1)
  })
})
