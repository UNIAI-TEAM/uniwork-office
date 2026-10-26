/**
 * The real docs handlers on a converted legacy .doc (electron mocked): open, Save As suggestion
 * and write target, the registry after Save As, and the in-place save the UniWork first save uses.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers, showSaveDialog, userData, writeHooks } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  showSaveDialog: vi.fn(),
  userData: { dir: '' },
  writeHooks: { duringWrite: null as null | (() => void) },
}))

interface FakeWebContents {
  id: number
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  getURL: () => string
}

vi.mock('@genoffice/ai-search', () => ({}))

// A86 (UNI-1362): the docs crash-recovery write lands through the shared
// atomic writer, so the test can run the shell's sweep while that write is in
// flight (the stale-recovery race the docs handler guards).
vi.mock('@genoffice/electron-utils/atomic-write', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  atomicWriteFile: async (path: string, bytes: Buffer | Uint8Array) => {
    writeHooks.duringWrite?.()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  },
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => userData.dir),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => {})),
    isPackaged: false,
    getVersion: () => '0.0.0',
    getName: () => 'test',
  },
  BrowserWindow: class {
    static fromWebContents() {
      return null
    }
    static getFocusedWindow() {
      return null
    }
    static getAllWindows() {
      return []
    }
  },
  dialog: {
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    once: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  session: { defaultSession: {} },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1000, height: 800 } }) },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  clipboard: {},
  webContents: { fromId: vi.fn() },
  WebContentsView: class {},
}))

import {
  convertedDocumentFor,
  forgetConvertedDocument,
  registerConvertedDocument,
} from '@genoffice/electron-utils'
import {
  authorizeMcpDocWrite,
  registerDocsIpc,
  setDocsUserSaveHook,
  setUniworkDocumentPolicy,
} from '../src/main/docs-main'

let dir: string
let nextWc = 3000
function fakeWc(): FakeWebContents {
  return {
    id: nextWc++,
    isDestroyed: () => false,
    send: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    getURL: () => 'genoffice-app://docs/index.html',
  }
}

const hook = vi.fn()

function call(
  name: string,
  wc: FakeWebContents,
  ...args: unknown[]
): Promise<Record<string, unknown>> {
  return Promise.resolve(handlers.get(name)!({ sender: wc }, ...args)) as Promise<
    Record<string, unknown>
  >
}

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

describe('docs real handlers on a converted legacy .doc', () => {
  let tempPath: string
  let original: string
  let suggested: string
  let wc: FakeWebContents

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docs-converted-'))
    userData.dir = dir
    writeHooks.duringWrite = null
    registerDocsIpc()
    hook.mockReset()
    showSaveDialog.mockReset()
    setDocsUserSaveHook(hook)
    setUniworkDocumentPolicy({ isBound: () => false, isReadOnly: () => false })
    const tempDir = join(dir, 'genoffice-imports', 'u1')
    mkdirSync(tempDir, { recursive: true })
    tempPath = join(tempDir, 'Memo.docx')
    original = join(dir, 'Memo.doc')
    suggested = join(dir, 'Memo.docx')
    writeFileSync(tempPath, 'converted bytes')
    writeFileSync(original, 'legacy bytes')
    registerConvertedDocument(tempPath, {
      originalPath: original,
      suggestSaveAs: suggested,
      tempDir,
    })
    wc = fakeWc()
    authorizeMcpDocWrite(wc.id, tempPath)
  })
  afterEach(() => {
    forgetConvertedDocument(tempPath)
    setUniworkDocumentPolicy(null)
    setDocsUserSaveHook(null)
    rmSync(dir, { recursive: true, force: true })
  })

  it('opens as an unsaved copy: the load reply carries the Save As suggestion', async () => {
    const opened = await call('docs:open-path', fakeWc(), tempPath)

    expect(opened.suggestSaveAs).toBe(suggested)
    const ordinary = join(dir, 'Plain.docx')
    writeFileSync(ordinary, 'plain bytes')
    expect((await call('docs:open-path', fakeWc(), ordinary)).suggestSaveAs).toBeUndefined()
  })

  it('Save As starts at the suggestion next to the original, writes there, and forgets the conversion', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: suggested })

    const r = await call('docs:save-as', wc, 'Memo.docx', bytes('edited'), tempPath)

    expect(showSaveDialog.mock.calls.at(-1)?.at(-1)).toMatchObject({ defaultPath: suggested })
    expect(r).toMatchObject({ ok: true })
    expect(readFileSync(suggested, 'utf8')).toBe('edited')
    expect(readFileSync(original, 'utf8')).toBe('legacy bytes')
    expect(convertedDocumentFor(tempPath)).toBeUndefined()
  })

  it('a Save As answered with the recorded original never writes it (R1-3)', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: original })

    const r = await call('docs:save-as', wc, 'Memo.docx', bytes('edited'), tempPath)

    expect(readFileSync(original, 'utf8')).toBe('legacy bytes')
    expect(r).toMatchObject({ ok: true })
    expect(existsSync(`${original}.docx`)).toBe(true)
    expect(readFileSync(`${original}.docx`, 'utf8')).toBe('edited')
  })

  it('any other legacy-extension answer is normalised too', async () => {
    const other = join(dir, 'Other.DOC')
    writeFileSync(other, 'someone else')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: other })

    await call('docs:save-as', wc, 'Memo.docx', bytes('edited'), tempPath)

    expect(readFileSync(other, 'utf8')).toBe('someone else')
    expect(readFileSync(`${other}.docx`, 'utf8')).toBe('edited')
  })

  it("the UniWork first save's in-place flush writes the temp copy and reports the user save, no dialog", async () => {
    const r = await call('docs:save', wc, tempPath, bytes('flushed'))

    expect(r).toMatchObject({ ok: true })
    expect(readFileSync(tempPath, 'utf8')).toBe('flushed')
    expect(showSaveDialog).not.toHaveBeenCalled()
    expect(hook).toHaveBeenCalledExactlyOnceWith(tempPath)
    // still a converted copy until the UniWork binding moves the tab
    expect(convertedDocumentFor(tempPath)).toBeDefined()
  })
})
