/**
 * The real docs:save / docs:save-as handlers on a UniWork working copy
 * (electron mocked): which writes land and which report a user save.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  authorizeMcpDocWrite,
  registerDocsIpc,
  setDocsUserSaveHook,
  setUniworkDocumentPolicy,
} from '../src/main/docs-main'

let dir: string
let nextWc = 1000
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
const bound = new Set<string>()
const readOnly = new Set<string>()

function call(name: string, wc: FakeWebContents, ...args: unknown[]): Promise<{ ok: boolean }> {
  return Promise.resolve(handlers.get(name)!({ sender: wc }, ...args)) as Promise<{ ok: boolean }>
}

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

function openDoc(name = 'report.docx'): { path: string; wc: FakeWebContents } {
  const path = join(dir, name)
  writeFileSync(path, 'old')
  const wc = fakeWc()
  authorizeMcpDocWrite(wc.id, path)
  return { path, wc }
}

describe('docs real handlers on a UniWork copy', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docs-uniwork-'))
    userData.dir = dir
    writeHooks.duringWrite = null
    registerDocsIpc()
    hook.mockReset()
    bound.clear()
    readOnly.clear()
    showSaveDialog.mockReset()
    setDocsUserSaveHook(hook)
    setUniworkDocumentPolicy({
      isBound: (p) => bound.has(p),
      isReadOnly: (p) => readOnly.has(p),
    })
  })
  afterEach(() => {
    setUniworkDocumentPolicy(null)
    setDocsUserSaveHook(null)
    rmSync(dir, { recursive: true, force: true })
  })

  it('docs:save fires the hook once for an explicit Save and never for autosave', async () => {
    const { path, wc } = openDoc()
    bound.add(path)
    expect((await call('docs:save', wc, path, bytes('one'))).ok).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('one')
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(path)
    // autosave onto a bound copy is refused: nothing written, nothing reported
    expect((await call('docs:save', wc, path, bytes('two'), true)).ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('one')
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('docs:save refuses a view-only copy', async () => {
    const { path, wc } = openDoc()
    bound.add(path)
    readOnly.add(path)
    expect((await call('docs:save', wc, path, bytes('x'))).ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('old')
    expect(hook).not.toHaveBeenCalled()
  })

  it('docs:save-as onto another file is a plain copy: no hook', async () => {
    const { path, wc } = openDoc()
    bound.add(path)
    const copy = join(dir, 'copy.docx')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: copy })
    expect((await call('docs:save-as', wc, 'report.docx', bytes('copy'), path)).ok).toBe(true)
    expect(readFileSync(copy, 'utf8')).toBe('copy')
    expect(hook).not.toHaveBeenCalled()
  })

  it('docs:save-as of a bound copy starts from the file name, not the hidden working-copy folder', async () => {
    const { path, wc } = openDoc()
    showSaveDialog.mockResolvedValue({ canceled: true })
    await call('docs:save-as', wc, 'report.docx', bytes('x'), path)
    expect(showSaveDialog.mock.calls.at(-1)?.at(-1)).toMatchObject({ defaultPath: path })
    bound.add(path)
    await call('docs:save-as', wc, 'report.docx', bytes('x'), path)
    const options = showSaveDialog.mock.calls.at(-1)?.at(-1) as { defaultPath: string }
    expect(options.defaultPath.endsWith('report.docx')).toBe(true)
    expect(options.defaultPath.startsWith(dir)).toBe(false)
  })

  it('docs:save-as onto the open file itself is an explicit Save and fires once', async () => {
    const { path, wc } = openDoc()
    bound.add(path)
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: path })
    expect((await call('docs:save-as', wc, 'report.docx', bytes('again'), path)).ok).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('again')
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(path)
  })

  it('docs:save-as onto a view-only copy is refused', async () => {
    const { path, wc } = openDoc()
    bound.add(path)
    readOnly.add(path)
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: path })
    expect((await call('docs:save-as', wc, 'report.docx', bytes('again'), path)).ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('old')
    expect(hook).not.toHaveBeenCalled()
  })

  it('docs:save-to (agent save) never reports a user save and never lands on a view-only copy', async () => {
    const { path, wc } = openDoc()
    bound.add(path)
    expect((await call('docs:save-to', wc, path, bytes('agent'), true)).ok).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('agent')
    expect(hook).not.toHaveBeenCalled()
    readOnly.add(path)
    expect((await call('docs:save-to', wc, path, bytes('nope'), true)).ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('agent')
  })

  // A86 (UNI-1362): the docs half of the stale-recovery race, exercised through
  // the real handler rather than the removed test-only epoch counter.
  it('docs:write-recovery undoes a copy the shell swept while the write was in flight', async () => {
    const { path, wc } = openDoc()
    // the sweep runs while the recovery write is mid-flight
    writeHooks.duringWrite = () => clearRecoveryCopy(path)
    expect(await call('docs:write-recovery', wc, path, bytes('dirty'))).toEqual({ ok: false })
    expect(existsSync(join(dir, 'docs-autosave'))).toBe(true)
    expect(readdirSync(join(dir, 'docs-autosave'))).toEqual([])
  })

  it('docs:write-recovery keeps a copy nothing raced, and refuses an unauthorized sender', async () => {
    const { path, wc } = openDoc()
    expect(await call('docs:write-recovery', wc, path, bytes('dirty'))).toEqual({ ok: true })
    expect(readdirSync(join(dir, 'docs-autosave'))).toHaveLength(1)
    // a renderer that never opened the document writes no recovery copy
    const stranger = fakeWc()
    expect(await call('docs:write-recovery', stranger, path, bytes('other'))).toEqual({ ok: false })
    expect(readdirSync(join(dir, 'docs-autosave'))).toHaveLength(1)
  })
})

describe('docs:comment-author (G8-02, BE-7)', () => {
  const BOUND = 'C:/u/uniwork-documents/dep/acc/doc1/Plan.docx'
  let signedIn: string | null = null
  beforeEach(() => {
    registerDocsIpc()
    signedIn = 'Nguyễn An'
    // the shell's resolver: bound + signed in = the display name, else "User"
    setUniworkDocumentPolicy({
      isBound: (p) => p === BOUND,
      isReadOnly: () => false,
      commentAuthor: (p) => (p === BOUND && signedIn ? signedIn : 'User'),
    })
  })
  afterEach(() => setUniworkDocumentPolicy(null))

  const author = (path: unknown) =>
    Promise.resolve(handlers.get('docs:comment-author')!({ sender: fakeWc() }, path))

  it('answers the display name for a bound document and "User" for anything else', async () => {
    expect(await author(BOUND)).toBe('Nguyễn An')
    expect(await author('C:/Users/me/notes.docx')).toBe('User')
    expect(await author(null)).toBe('User')
    expect(await author(42)).toBe('User')
  })

  it('follows the account live: after sign-out / session expiry the same path answers "User"', async () => {
    expect(await author(BOUND)).toBe('Nguyễn An')
    signedIn = null
    expect(await author(BOUND)).toBe('User')
  })

  it('without a shell policy (standalone app) the answer is "User"', async () => {
    setUniworkDocumentPolicy(null)
    expect(await author(BOUND)).toBe('User')
  })
})
