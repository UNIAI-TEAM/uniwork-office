import { existsSync } from 'node:fs'
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
  on: ReturnType<typeof vi.fn>
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
    on: vi.fn(),
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

import { createHtmlView } from '../src/main/html-main'
import { HTML_CHANNELS } from '../src/shared/ipc'
import type { SaveHtmlRequest, SaveHtmlResult } from '../src/shared/ipc'

// First save of an untitled page (G6-09 W8): an AI-suggested name only pre-fills the Save dialog;
// the dialog always opens, nothing is written before it is confirmed.
const directories: string[] = []

function save(
  contents: FakeWebContents,
  request: Partial<SaveHtmlRequest>,
): Promise<SaveHtmlResult> {
  const handler = handlers.get(HTML_CHANNELS.save)!
  return handler(
    { sender: contents },
    { text: '<h1>Draft</h1>', imageSources: [], mode: 'save', ...request },
  ) as Promise<SaveHtmlResult>
}

afterEach(async () => {
  showSaveDialogWithMemory.mockReset()
  for (const contents of webContents.splice(0)) contents.listeners.get('destroyed')?.()
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('first save of an untitled html page', () => {
  it('an AI-suggested name only fills the Save dialog: nothing is written until it is confirmed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'html-first-save-'))
    directories.push(directory)
    const contents = createHtmlView(null).webContents as unknown as FakeWebContents
    showSaveDialogWithMemory.mockResolvedValue({ canceled: true })

    const result = await save(contents, { suggestedName: 'Quarterly page-g6w8' })

    expect(result).toMatchObject({ ok: true, canceled: true })
    expect(showSaveDialogWithMemory).toHaveBeenCalledTimes(1)
    const options = showSaveDialogWithMemory.mock.calls[0]![2] as { defaultPath: string }
    expect(options.defaultPath.endsWith('Quarterly page-g6w8.html')).toBe(true)
    expect(existsSync(options.defaultPath)).toBe(false)

    const target = join(directory, 'Quarterly page.html')
    showSaveDialogWithMemory.mockResolvedValue({ canceled: false, filePath: target })
    await expect(save(contents, { suggestedName: 'Quarterly page' })).resolves.toMatchObject({
      ok: true,
      path: target,
    })
    expect(await readFile(target, 'utf8')).toBe('<h1>Draft</h1>')
  })

  it('without a suggested name the dialog starts with the provisional name, as today', async () => {
    const contents = createHtmlView(null).webContents as unknown as FakeWebContents
    showSaveDialogWithMemory.mockResolvedValue({ canceled: true })
    await save(contents, { defaultName: 'Landing page' })
    const options = showSaveDialogWithMemory.mock.calls[0]![2] as { defaultPath: string }
    expect(options.defaultPath.endsWith('Landing page.html')).toBe(true)
  })

  it('a titled page still saves in place with no dialog, whatever name is passed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'html-first-save-'))
    directories.push(directory)
    const path = join(directory, 'page.html')
    await writeFile(path, 'old')
    const contents = createHtmlView(path).webContents as unknown as FakeWebContents
    await expect(save(contents, { suggestedName: 'Ignored' })).resolves.toMatchObject({
      ok: true,
      path,
    })
    expect(showSaveDialogWithMemory).not.toHaveBeenCalled()
    expect(await readFile(path, 'utf8')).toBe('<h1>Draft</h1>')
  })
})
