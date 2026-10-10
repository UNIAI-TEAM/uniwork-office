/**
 * DOCX → PDF without a system printer: the real docs:export-pdf / docs:print
 * handlers (electron mocked). Export PDF is a local file export through
 * printToPDF that never touches the UniWork working copy, and Print reports a
 * machine with no printer instead of silently doing nothing.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers, showSaveDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  showSaveDialog: vi.fn(),
}))

vi.mock('@genoffice/ai-search', () => ({}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpdir()),
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

import { hasNoPrinter } from '../src/main/print-args'
import {
  authorizeMcpDocWrite,
  registerDocsIpc,
  setDocsUserSaveHook,
  setUniworkDocumentPolicy,
} from '../src/main/docs-main'

const PDF_BYTES = Buffer.from('%PDF-1.7 test')
const LETTER_W = 12240
const LETTER_H = 15840

let dir: string
let nextWc = 2000

function fakeWc(printers: unknown[] | Error = [{ name: 'lp0' }]) {
  const printToPDF = vi.fn(async () => PDF_BYTES)
  const print = vi.fn((_opts: unknown, cb: (ok: boolean, reason: string) => void) => cb(true, ''))
  const getPrintersAsync = vi.fn(async () => {
    if (printers instanceof Error) throw printers
    return printers
  })
  return {
    id: nextWc++,
    isDestroyed: () => false,
    send: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    getURL: () => 'genoffice-app://docs/index.html',
    printToPDF,
    print,
    getPrintersAsync,
  }
}
type FakeWc = ReturnType<typeof fakeWc>

const hook = vi.fn()
const bound = new Set<string>()

function call<T = { ok: boolean }>(name: string, wc: FakeWc, ...args: unknown[]): Promise<T> {
  return Promise.resolve(handlers.get(name)!({ sender: wc }, ...args)) as Promise<T>
}

function openBoundDoc(wc: FakeWc): string {
  const path = join(dir, 'report.docx')
  writeFileSync(path, 'docx-bytes')
  authorizeMcpDocWrite(wc.id, path)
  bound.add(path)
  return path
}

describe('docs:export-pdf on a DOCX', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docs-pdf-'))
    registerDocsIpc()
    hook.mockReset()
    bound.clear()
    showSaveDialog.mockReset()
    setDocsUserSaveHook(hook)
    setUniworkDocumentPolicy({ isBound: (p) => bound.has(p), isReadOnly: () => false })
  })
  afterEach(() => {
    setUniworkDocumentPolicy(null)
    setDocsUserSaveHook(null)
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the printToPDF bytes to the picked file and leaves the bound document alone', async () => {
    const wc = fakeWc([])
    const docx = openBoundDoc(wc)
    const out = join(dir, 'report.pdf')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: out })
    const r = await call<{ ok: boolean; path?: string }>(
      'docs:export-pdf',
      wc,
      'report.docx',
      LETTER_W,
      LETTER_H,
    )
    expect(r).toMatchObject({ ok: true, path: out })
    // no system printer needed: the export never asks for the printer list
    expect(wc.getPrintersAsync).not.toHaveBeenCalled()
    expect(wc.printToPDF).toHaveBeenCalledTimes(1)
    expect(readFileSync(out)).toEqual(PDF_BYTES)
    expect(readFileSync(docx, 'utf8')).toBe('docx-bytes')
    // a local export: no UniWork version
    expect(hook).not.toHaveBeenCalled()
    expect(showSaveDialog.mock.calls.at(-1)?.at(-1)).toMatchObject({
      defaultPath: expect.stringMatching(/report\.pdf$/),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
  })

  it('a picked name without .pdf gets the extension, so it can never replace the .docx', async () => {
    const wc = fakeWc([])
    const docx = openBoundDoc(wc)
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: docx })
    const r = await call<{ ok: boolean; path?: string }>(
      'docs:export-pdf',
      wc,
      'report.docx',
      LETTER_W,
      LETTER_H,
    )
    expect(r).toMatchObject({ ok: true, path: `${docx}.pdf` })
    expect(readFileSync(docx, 'utf8')).toBe('docx-bytes')
    expect(readFileSync(`${docx}.pdf`)).toEqual(PDF_BYTES)
    expect(hook).not.toHaveBeenCalled()
  })

  it('a cancelled dialog writes nothing', async () => {
    const wc = fakeWc([])
    openBoundDoc(wc)
    showSaveDialog.mockResolvedValue({ canceled: true })
    const r = await call('docs:export-pdf', wc, 'report.docx', LETTER_W, LETTER_H)
    expect(r.ok).toBe(false)
    expect(wc.printToPDF).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'report.pdf'))).toBe(false)
  })

  it('a printToPDF failure reports the error and leaves no file behind', async () => {
    const wc = fakeWc([])
    openBoundDoc(wc)
    const out = join(dir, 'report.pdf')
    wc.printToPDF.mockRejectedValue(new Error('boom'))
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: out })
    const r = await call<{ ok: boolean; error?: string }>(
      'docs:export-pdf',
      wc,
      'report.docx',
      LETTER_W,
      LETTER_H,
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom')
    expect(existsSync(out)).toBe(false)
  })
})

describe('docs:print without a printer', () => {
  beforeEach(() => {
    registerDocsIpc()
  })

  it('reports noPrinter and never calls print() when the printer list is empty', async () => {
    const wc = fakeWc([])
    const r = await call<{ ok: boolean; noPrinter?: boolean }>('docs:print', wc)
    expect(r).toEqual({ ok: false, noPrinter: true })
    expect(wc.print).not.toHaveBeenCalled()
  })

  it('prints normally when a printer exists', async () => {
    const wc = fakeWc([{ name: 'lp0' }])
    const r = await call<{ ok: boolean; noPrinter?: boolean }>('docs:print', wc)
    expect(r).toEqual({ ok: true })
    expect(wc.print).toHaveBeenCalledTimes(1)
  })

  it('surfaces a real print failure but not a cancel', async () => {
    const wc = fakeWc([{ name: 'lp0' }])
    wc.print.mockImplementationOnce((_o, cb) => cb(false, 'Print job failed'))
    expect(await call('docs:print', wc)).toEqual({ ok: false, error: 'Print job failed' })
    wc.print.mockImplementationOnce((_o, cb) => cb(false, 'Print job canceled'))
    expect(await call('docs:print', wc)).toEqual({ ok: false })
  })

  it('still tries to print when the printer query itself fails', async () => {
    const wc = fakeWc(new Error('no cups'))
    const r = await call('docs:print', wc)
    expect(r).toEqual({ ok: true })
    expect(wc.print).toHaveBeenCalledTimes(1)
  })
})

describe('hasNoPrinter', () => {
  it('is true only for an empty list', async () => {
    expect(await hasNoPrinter({ getPrintersAsync: async () => [] })).toBe(true)
    expect(await hasNoPrinter({ getPrintersAsync: async () => [{}] })).toBe(false)
    expect(
      await hasNoPrinter({
        getPrintersAsync: async () => {
          throw new Error('x')
        },
      }),
    ).toBe(false)
    expect(await hasNoPrinter({})).toBe(false)
  })
})
