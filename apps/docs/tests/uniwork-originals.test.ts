/**
 * G5-11 be-2: the docs "originals" archive (userData/originals/<sha256>.docx)
 * keeps local files only. A bound UniWork working copy is never archived - its
 * plaintext must not survive a sign-out outside the working-copy root - and
 * sign-out clears the archive of the owner's copies by hashing the bytes the
 * shell is about to delete.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers, userData } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  userData: { dir: '' },
}))

vi.mock('@genoffice/ai-search', () => ({}))

vi.mock('electron', () => ({
  app: {
    getPath: () => userData.dir,
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
  dialog: { showSaveDialog: vi.fn(), showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler),
    on: (channel: string, handler: IpcHandler) => handlers.set(channel, handler),
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
  clearDocsOriginalsFor,
  registerDocsIpc,
  setUniworkDocumentPolicy,
} from '../src/main/docs-main'

let nextWc = 2000

beforeEach(() => {
  userData.dir = mkdtempSync(join(tmpdir(), 'docs-originals-'))
  handlers.clear()
  registerDocsIpc()
})

afterEach(() => {
  rmSync(userData.dir, { recursive: true, force: true })
})

const bound = new Set<string>()

function fakeWc() {
  return {
    id: nextWc++,
    isDestroyed: () => false,
    send: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    getURL: () => 'genoffice-app://docs/index.html',
  }
}

function call(name: string, wc: ReturnType<typeof fakeWc>, ...args: unknown[]): Promise<unknown> {
  return Promise.resolve(handlers.get(name)!({ sender: wc }, ...args))
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const originalsDir = () => join(userData.dir, 'originals')

describe('the docs originals archive at the UniWork boundary (G5-11 be-2)', () => {
  afterEach(() => setUniworkDocumentPolicy(null))

  it('opening a bound working copy writes nothing to userData/originals', async () => {
    setUniworkDocumentPolicy({
      isBound: (p) => bound.has(p),
      isReadOnly: () => false,
    })
    const path = join(userData.dir, 'uniwork-documents', 'default', 'acc_1', 'doc_1', 'Plan.docx')
    mkdirSync(join(userData.dir, 'uniwork-documents', 'default', 'acc_1', 'doc_1'), {
      recursive: true,
    })
    writeFileSync(path, 'bound docx bytes')
    bound.add(path)

    const result = await call('docs:open-path', fakeWc(), path)
    expect(result).not.toBeNull()
    // the archive is not even created for a bound copy
    expect(existsSync(originalsDir())).toBe(false)
  })

  it('still archives a plain local file, as before', async () => {
    setUniworkDocumentPolicy({ isBound: () => false, isReadOnly: () => false })
    const path = join(userData.dir, 'Local.docx')
    writeFileSync(path, 'local docx bytes')

    const result = await call('docs:open-path', fakeWc(), path)
    expect(result).not.toBeNull()
    expect(existsSync(join(originalsDir(), `${sha256('local docx bytes')}.docx`))).toBe(true)
  })

  it('clearDocsOriginalsFor removes the archived copy of the open-time baseChecksum and the bytes on disk, and only those (d1-3)', () => {
    const path = join(userData.dir, 'uniwork-documents', 'default', 'acc_1', 'doc_1', 'Plan.docx')
    mkdirSync(join(userData.dir, 'uniwork-documents', 'default', 'acc_1', 'doc_1'), {
      recursive: true,
    })
    // archive written at open for v3, file later edited and saved as v4
    writeFileSync(path, 'v4 n+1 bytes')
    mkdirSync(originalsDir(), { recursive: true })
    const v3Archive = join(originalsDir(), `${sha256('v3 base bytes')}.docx`)
    const v4Archive = join(originalsDir(), `${sha256('v4 n+1 bytes')}.docx`)
    const other = join(originalsDir(), `${sha256('someone elses file')}.docx`)
    writeFileSync(v3Archive, 'v3 base bytes')
    writeFileSync(v4Archive, 'v4 n+1 bytes')
    writeFileSync(other, 'someone elses file')

    clearDocsOriginalsFor([{ path, baseChecksum: sha256('v3 base bytes') }])
    expect(existsSync(v3Archive)).toBe(false)
    expect(existsSync(v4Archive)).toBe(false)
    expect(existsSync(other)).toBe(true)
  })
})
