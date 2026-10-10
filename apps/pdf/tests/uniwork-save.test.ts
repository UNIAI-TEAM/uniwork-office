import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: { sender: FakeWebContents }, ...args: unknown[]) => unknown
const handlers = new Map<string, IpcHandler>()

interface FakeWebContents {
  id: number
  once: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  setWindowOpenHandler: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
}

let nextWcId = 1
let lastWebContents: FakeWebContents

function makeFakeWebContents(): FakeWebContents {
  const webContents: FakeWebContents = {
    id: nextWcId++,
    once: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
    isDestroyed: () => false,
    setWindowOpenHandler: vi.fn(),
    loadURL: vi.fn(),
  }
  lastWebContents = webContents
  return webContents
}

vi.mock('electron', () => ({
  app: { on: vi.fn(), whenReady: vi.fn(() => new Promise(() => {})) },
  dialog: {},
  shell: {},
  BrowserWindow: class {},
  WebContentsView: class {
    webContents = makeFakeWebContents()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn(),
  },
}))

import {
  createPdfView,
  flushPdfSave,
  setPdfUserSaveHook,
  setUniworkDocumentPolicy,
} from '../src/main/pdf-main'
import { uniworkSaveDecision } from '../src/main/uniwork-policy'
import { PDF_CHANNELS } from '../src/shared/ipc'
import type { PdfUniworkState, SavePdfRequest, SavePdfResult } from '../src/shared/ipc'

let dir: string
let hook: ReturnType<typeof vi.fn>
const bound = new Set<string>()
const readOnly = new Set<string>()

async function makePdf(name: string): Promise<string> {
  const path = join(dir, name)
  const doc = await PDFDocument.create()
  doc.addPage([100, 200])
  writeFileSync(path, await doc.save({ useObjectStreams: false }))
  return path
}

function openView(path: string): FakeWebContents {
  createPdfView(path)
  return lastWebContents
}

function request(path: string, extra: Partial<SavePdfRequest> = {}): SavePdfRequest {
  return { path, markups: [], drawings: [], formValues: [], stamps: [], ...extra }
}

const rotate = { rotations: [{ pageIndex: 0, delta: 90 }] }

function save(wc: FakeWebContents, req: SavePdfRequest): Promise<SavePdfResult> {
  return handlers.get(PDF_CHANNELS.save)!({ sender: wc }, req) as Promise<SavePdfResult>
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdf-uniwork-'))
  hook = vi.fn()
  setPdfUserSaveHook(hook)
  bound.clear()
  readOnly.clear()
  setUniworkDocumentPolicy({
    isBound: (p) => bound.has(p),
    isReadOnly: (p) => readOnly.has(p),
  })
})

afterEach(() => {
  setUniworkDocumentPolicy(null)
  setPdfUserSaveHook(null)
  rmSync(dir, { recursive: true, force: true })
})

describe('uniworkSaveDecision (pure)', () => {
  it('is a pass-through without a policy: writes, hook only for an explicit in-place save', () => {
    setUniworkDocumentPolicy(null)
    const base = { currentPath: 'a.pdf', targetPath: 'a.pdf', saveAs: false }
    expect(uniworkSaveDecision({ ...base, origin: 'user' })).toEqual({
      write: true,
      fireHook: true,
      forceWrite: false,
    })
    expect(uniworkSaveDecision({ ...base, origin: 'auto' }).write).toBe(true)
    expect(uniworkSaveDecision({ ...base, origin: undefined }).fireHook).toBe(false)
  })

  it('a Save As onto the open file is an explicit Save, onto another file it is a copy', () => {
    setUniworkDocumentPolicy(null)
    const same = { currentPath: 'a.pdf', targetPath: 'a.pdf', saveAs: true }
    expect(uniworkSaveDecision({ ...same, origin: undefined }).fireHook).toBe(true)
    expect(uniworkSaveDecision({ ...same, targetPath: 'b.pdf', origin: undefined }).fireHook).toBe(
      false,
    )
  })
})

describe('pdf:save UniWork seam', () => {
  it('fires the hook once after an explicit Save of a bound document', async () => {
    const path = await makePdf('doc.pdf')
    bound.add(path)
    const wc = openView(path)
    const before = readFileSync(path)
    const result = await save(wc, request(path, { ...rotate, origin: 'user' }))
    expect(result.ok).toBe(true)
    expect(readFileSync(path).equals(before)).toBe(false)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(path)
  })

  it('refuses autosave onto a bound path: no write, no hook', async () => {
    const path = await makePdf('doc.pdf')
    bound.add(path)
    const wc = openView(path)
    const before = readFileSync(path)
    const result = await save(wc, request(path, { ...rotate, origin: 'auto' }))
    expect(result.ok).toBe(false)
    expect(readFileSync(path).equals(before)).toBe(true)
    expect(hook).not.toHaveBeenCalled()
  })

  it('never fires the hook for autosave, internal flushes or a missing origin on plain files', async () => {
    const path = await makePdf('doc.pdf')
    const wc = openView(path)
    for (const origin of ['auto', 'internal', undefined] as const) {
      const result = await save(wc, request(path, { ...rotate, origin }))
      expect(result.ok).toBe(true)
    }
    expect(hook).not.toHaveBeenCalled()
  })

  it('never fires the hook for Save As to another path', async () => {
    const path = await makePdf('doc.pdf')
    bound.add(path)
    const wc = openView(path)
    const target = join(dir, 'copy.pdf')
    const done = new Promise<void>((resolve) => {
      wc.send.mockImplementation(async (channel: string) => {
        if (channel !== PDF_CHANNELS.saveAsRequest) return
        const result = await save(wc, request(path, { ...rotate, targetPath: target }))
        handlers.get(PDF_CHANNELS.saveAsResult)!({ sender: wc }, result.ok)
        resolve()
      })
    })
    const { requestPdfSaveAs } = await import('../src/main/pdf-main')
    const ok = requestPdfSaveAs(wc as never, target)
    await done
    expect(await ok).toBe(true)
    expect(readFileSync(target).length).toBeGreaterThan(0)
    expect(hook).not.toHaveBeenCalled()
  })

  it('writes and fires the hook on an explicit Save of a clean bound document', async () => {
    const path = await makePdf('doc.pdf')
    bound.add(path)
    const wc = openView(path)
    const before = readFileSync(path)
    const result = await save(wc, request(path, { origin: 'user' }))
    expect(result.ok).toBe(true)
    // the file's own bytes, not a re-serialization
    expect(readFileSync(path).equals(before)).toBe(true)
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('refuses every write to a view-only document, but allows Save As elsewhere', async () => {
    const path = await makePdf('doc.pdf')
    bound.add(path)
    readOnly.add(path)
    const wc = openView(path)
    const before = readFileSync(path)
    expect((await save(wc, request(path, { ...rotate, origin: 'user' }))).ok).toBe(false)
    expect((await save(wc, request(path, { origin: 'user' }))).ok).toBe(false)
    const insert = (await handlers.get(PDF_CHANNELS.insertBlankPage)!(
      { sender: wc },
      { path, afterPageIndex: 0 },
    )) as { ok: boolean }
    expect(insert.ok).toBe(false)
    const crop = (await handlers.get(PDF_CHANNELS.cropPages)!(
      { sender: wc },
      { path, pages: [0], rect: [0, 0, 50, 50] },
    )) as { ok: boolean }
    expect(crop.ok).toBe(false)
    expect(readFileSync(path).equals(before)).toBe(true)
    expect(hook).not.toHaveBeenCalled()

    const target = join(dir, 'copy.pdf')
    const done = new Promise<boolean>((resolve) => {
      wc.send.mockImplementation(async (channel: string) => {
        if (channel !== PDF_CHANNELS.saveAsRequest) return
        const result = await save(wc, request(path, { ...rotate, targetPath: target }))
        handlers.get(PDF_CHANNELS.saveAsResult)!({ sender: wc }, result.ok)
        resolve(result.ok)
      })
    })
    const { requestPdfSaveAs } = await import('../src/main/pdf-main')
    void requestPdfSaveAs(wc as never, target)
    expect(await done).toBe(true)
    expect(hook).not.toHaveBeenCalled()
  })

  it('answers uniwork-state only for paths granted to the view', async () => {
    const path = await makePdf('doc.pdf')
    const other = await makePdf('other.pdf')
    bound.add(path)
    bound.add(other)
    readOnly.add(path)
    const wc = openView(path)
    const state = (p: string) =>
      handlers.get(PDF_CHANNELS.uniworkState)!({ sender: wc }, p) as PdfUniworkState
    expect(state(path)).toEqual({ bound: true, readOnly: true })
    expect(state(other)).toEqual({ bound: false, readOnly: false })
  })
})

describe('flushPdfSave UniWork seam', () => {
  it('asks a clean bound view to save on menu Save; a clean local view resolves at once', async () => {
    const local = await makePdf('local.pdf')
    const localWc = openView(local)
    expect(await flushPdfSave(localWc as never)).toBe(true)
    expect(localWc.send).not.toHaveBeenCalled()

    const path = await makePdf('doc.pdf')
    bound.add(path)
    const wc = openView(path)
    const pending = flushPdfSave(wc as never)
    expect(wc.send).toHaveBeenCalledWith(PDF_CHANNELS.closeSaveRequest, { origin: 'user' })
    handlers.get(PDF_CHANNELS.closeSaveResult)!({ sender: wc }, true)
    expect(await pending).toBe(true)
  })

  it('an export flush ({ explicit: false }) asks the renderer to save as internal', async () => {
    const path = await makePdf('doc.pdf')
    bound.add(path)
    const wc = openView(path)
    handlers.get(PDF_CHANNELS.dirtyChanged)!({ sender: wc }, true)
    // the renderer saves with the origin main asked for
    wc.send.mockImplementation(
      async (channel: string, payload: { origin: 'user' | 'internal' }) => {
        if (channel !== PDF_CHANNELS.closeSaveRequest) return
        const result = await save(wc, request(path, { ...rotate, origin: payload.origin }))
        handlers.get(PDF_CHANNELS.closeSaveResult)!({ sender: wc }, result.ok)
      },
    )
    expect(await flushPdfSave(wc as never, { explicit: false })).toBe(true)
    expect(wc.send).toHaveBeenLastCalledWith(PDF_CHANNELS.closeSaveRequest, { origin: 'internal' })
    expect(hook).not.toHaveBeenCalled()
    // the same flush as a menu Save does fire it
    expect(await flushPdfSave(wc as never)).toBe(true)
    expect(wc.send).toHaveBeenLastCalledWith(PDF_CHANNELS.closeSaveRequest, { origin: 'user' })
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('a user Save landing while an export flush is pending still fires the hook', async () => {
    const path = await makePdf('doc.pdf')
    bound.add(path)
    const wc = openView(path)
    handlers.get(PDF_CHANNELS.dirtyChanged)!({ sender: wc }, true)
    // the flush is asked for but the renderer has not answered yet
    const pending = flushPdfSave(wc as never, { explicit: false })
    expect(wc.send).toHaveBeenLastCalledWith(PDF_CHANNELS.closeSaveRequest, { origin: 'internal' })
    // the user presses Ctrl+S in the meantime: its own request carries origin user
    expect((await save(wc, request(path, { ...rotate, origin: 'user' }))).ok).toBe(true)
    expect(hook).toHaveBeenCalledTimes(1)
    handlers.get(PDF_CHANNELS.closeSaveResult)!({ sender: wc }, true)
    expect(await pending).toBe(true)
  })
})

describe('pdf:save Save As onto the open file', () => {
  async function saveAs(wc: FakeWebContents, path: string, target: string): Promise<boolean> {
    const done = new Promise<boolean>((resolve) => {
      wc.send.mockImplementation(async (channel: string) => {
        if (channel !== PDF_CHANNELS.saveAsRequest) return
        const result = await save(wc, request(path, { ...rotate, targetPath: target }))
        handlers.get(PDF_CHANNELS.saveAsResult)!({ sender: wc }, result.ok)
        resolve(result.ok)
      })
    })
    const { requestPdfSaveAs } = await import('../src/main/pdf-main')
    void requestPdfSaveAs(wc as never, target)
    return done
  }

  it('is an explicit Save: it writes and fires the hook once', async () => {
    const path = await makePdf('doc.pdf')
    bound.add(path)
    const wc = openView(path)
    expect(await saveAs(wc, path, path)).toBe(true)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(path)
  })

  it('still never fires for a view-only document', async () => {
    const path = await makePdf('doc.pdf')
    bound.add(path)
    readOnly.add(path)
    const wc = openView(path)
    expect(await saveAs(wc, path, path)).toBe(false)
    expect(hook).not.toHaveBeenCalled()
  })
})
