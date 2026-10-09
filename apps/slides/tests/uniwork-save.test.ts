import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The crash-recovery tick is a module-level setInterval: fake only that timer
// (installed before slides-main loads) so the test can fire one tick on demand.
const env = vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  return {
    dir: '',
    handlers: new Map<string, (...args: never[]) => unknown>(),
    saveDialogPath: '' as string,
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => env.dir,
    getName: () => 'slides-test',
    getVersion: () => '0',
    whenReady: () => Promise.resolve(),
  },
  dialog: {
    showSaveDialog: async () => ({ canceled: false, filePath: env.saveDialogPath }),
  },
  clipboard: { writeBuffer: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (...args: never[]) => unknown) => env.handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {
    static getFocusedWindow() {
      return null
    }
  },
  webContents: { getAllWebContents: () => [], fromId: () => null },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  session: {
    defaultSession: { protocol: {}, setDisplayMediaRequestHandler: () => {} },
  },
  nativeImage: {},
  shell: {},
  desktopCapturer: { getSources: async () => [] },
  WebContentsView: class {},
}))
vi.mock('../src/main/shaped-metrics', () => ({
  shapedMetricsReady: async () => {},
  refineComplexWidths: async () => {},
  complexScriptOf: () => null,
  initShapedMetrics: () => {},
  gtMeasure: (t: string) => ({ width: t.length * 8 }),
  shapedFamily: () => null,
  shapedMeasure: () => ({ width: 0 }),
}))

import { createBlankPptx, openPptx } from '@genoffice/pptx-engine'
import {
  registerSlidesIpc,
  saveSessionDeckTo,
  setSlidesUserSaveHook,
  setUniworkDocumentPolicy,
} from '../src/main/slides-main'
import { sessions, type Session } from '../src/main/session-state'
import { parseUniworkSaveOrigin, uniworkSaveDecision } from '../src/main/uniwork-policy'

const WC = 1
const FIT = 1280
const event = { sender: { id: WC } } as never
const ORIGINAL = 'original bytes'

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = env.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve((fn as (...a: unknown[]) => unknown)(event, ...args))
}

let session: Session
let deckPath: string
const hook = vi.fn<(path: string) => void>()

function bindPolicy(opts: { bound?: string[]; readOnly?: string[] }): void {
  const bound = new Set([...(opts.bound ?? []), ...(opts.readOnly ?? [])])
  const ro = new Set(opts.readOnly ?? [])
  setUniworkDocumentPolicy({ isBound: (p) => bound.has(p), isReadOnly: (p) => ro.has(p) })
}

/** true once the deck file holds a pptx (zip) instead of the placeholder bytes */
function written(path: string): boolean {
  return existsSync(path) && readFileSync(path).subarray(0, 2).toString() === 'PK'
}

beforeAll(() => {
  env.dir = mkdtempSync(join(tmpdir(), 'slides-uniwork-'))
  registerSlidesIpc()
})

afterAll(() => {
  vi.useRealTimers()
  rmSync(env.dir, { recursive: true, force: true })
})

beforeEach(async () => {
  sessions.clear()
  hook.mockReset()
  setSlidesUserSaveHook(hook)
  setUniworkDocumentPolicy(null)
  deckPath = join(env.dir, `deck-${Math.random().toString(36).slice(2)}.pptx`)
  writeFileSync(deckPath, ORIGINAL)
  session = {
    path: deckPath,
    fitWidthPx: FIT,
    undoStack: [],
    redoStack: [],
    opened: await openPptx(await createBlankPptx()),
  }
  sessions.set(WC, session)
})

afterEach(() => {
  setSlidesUserSaveHook(null)
  setUniworkDocumentPolicy(null)
})

describe('uniworkSaveDecision (pure gate)', () => {
  afterEach(() => setUniworkDocumentPolicy(null))

  it('fires the hook only for an explicit in-place save of a titled deck', () => {
    const p = '/d/a.pptx'
    const base = { currentPath: p, targetPath: p }
    expect(uniworkSaveDecision({ ...base, kind: 'save', origin: 'user' })).toEqual({
      write: true,
      fireHook: true,
    })
    expect(uniworkSaveDecision({ ...base, kind: 'save', origin: 'auto' }).fireHook).toBe(false)
    expect(uniworkSaveDecision({ ...base, kind: 'save-as', origin: 'user' }).fireHook).toBe(false)
    expect(uniworkSaveDecision({ ...base, kind: 'mcp', origin: 'user' }).fireHook).toBe(false)
    expect(
      uniworkSaveDecision({ kind: 'save', origin: 'user', currentPath: null, targetPath: p })
        .fireHook,
    ).toBe(false)
  })

  it('refuses read-only targets and AutoSave on bound paths', () => {
    bindPolicy({ bound: ['/d/b.pptx'], readOnly: ['/d/r.pptx'] })
    const at = (targetPath: string, origin: 'user' | 'auto', kind: 'save' | 'save-as' = 'save') =>
      uniworkSaveDecision({ kind, origin, currentPath: targetPath, targetPath })
    expect(at('/d/r.pptx', 'user')).toEqual({ write: false, fireHook: false })
    expect(at('/d/r.pptx', 'user', 'save-as').write).toBe(false)
    expect(at('/d/b.pptx', 'auto')).toEqual({ write: false, fireHook: false })
    expect(at('/d/b.pptx', 'user')).toEqual({ write: true, fireHook: true })
    expect(at('/d/plain.pptx', 'auto')).toEqual({ write: true, fireHook: false })
  })

  it('reads a missing or unknown origin as an explicit save', () => {
    expect(parseUniworkSaveOrigin(undefined)).toBe('user')
    expect(parseUniworkSaveOrigin('weird')).toBe('user')
    expect(parseUniworkSaveOrigin('auto')).toBe('auto')
  })
})

describe('slides:save UniWork seam', () => {
  it('null policy: an explicit save writes and fires the hook once', async () => {
    const r = (await call('slides:save')) as { ok: boolean; path?: string }
    expect(r.ok).toBe(true)
    expect(written(deckPath)).toBe(true)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(deckPath)
  })

  it('an AutoSave pass on an unbound deck still writes but never fires the hook', async () => {
    const r = (await call('slides:save', 'auto')) as { ok: boolean }
    expect(r.ok).toBe(true)
    expect(written(deckPath)).toBe(true)
    expect(hook).not.toHaveBeenCalled()
  })

  it('bound: an AutoSave pass writes nothing', async () => {
    bindPolicy({ bound: [deckPath] })
    const r = (await call('slides:save', 'auto')) as { ok: boolean; error?: string }
    expect(r).toEqual({ ok: false })
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    expect(hook).not.toHaveBeenCalled()
  })

  it('bound: an explicit save of a clean deck still writes and fires the hook once', async () => {
    bindPolicy({ bound: [deckPath] })
    expect(env.handlers.has('slides:is-dirty')).toBe(true)
    expect(await call('slides:is-dirty')).toBe(false)
    const r = (await call('slides:save', 'user')) as { ok: boolean }
    expect(r.ok).toBe(true)
    expect(written(deckPath)).toBe(true)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(deckPath)
  })

  it('read-only: Save is refused with no write and no hook', async () => {
    bindPolicy({ readOnly: [deckPath] })
    const r = (await call('slides:save', 'user')) as { ok: boolean }
    expect(r).toEqual({ ok: false })
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    expect(hook).not.toHaveBeenCalled()
  })

  it('an untitled deck save (first save into drafts) does not fire the hook', async () => {
    session.path = ''
    const r = (await call('slides:save', 'user')) as { ok: boolean; path?: string }
    expect(r.ok).toBe(true)
    expect(r.path && written(r.path)).toBe(true)
    expect(hook).not.toHaveBeenCalled()
  })

  it('reports bound / read-only for the sender deck only', async () => {
    expect(await call('slides:uniwork-state')).toEqual({ bound: false, readOnly: false })
    bindPolicy({ bound: [deckPath] })
    expect(await call('slides:uniwork-state')).toEqual({ bound: true, readOnly: false })
    bindPolicy({ readOnly: [deckPath] })
    expect(await call('slides:uniwork-state')).toEqual({ bound: true, readOnly: true })
    session.path = ''
    expect(await call('slides:uniwork-state')).toEqual({ bound: false, readOnly: false })
  })
})

describe('slides:save-as and MCP save UniWork seam', () => {
  it('Save As of a bound deck to another path writes a plain copy, no hook', async () => {
    bindPolicy({ bound: [deckPath] })
    env.saveDialogPath = join(env.dir, 'copy.pptx')
    const r = (await call('slides:save-as', 'deck.pptx')) as { ok: boolean; path?: string }
    expect(r.ok).toBe(true)
    expect(written(env.saveDialogPath)).toBe(true)
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    expect(hook).not.toHaveBeenCalled()
  })

  it('Save As onto a read-only path is refused', async () => {
    const ro = join(env.dir, 'ro-target.pptx')
    writeFileSync(ro, ORIGINAL)
    bindPolicy({ readOnly: [ro] })
    env.saveDialogPath = ro
    const r = (await call('slides:save-as', 'deck.pptx')) as { ok: boolean }
    expect(r).toEqual({ ok: false })
    expect(readFileSync(ro, 'utf8')).toBe(ORIGINAL)
    expect(session.path).toBe(deckPath)
    expect(hook).not.toHaveBeenCalled()
  })

  it('MCP save to the same bound path writes but never fires the hook', async () => {
    bindPolicy({ bound: [deckPath] })
    await saveSessionDeckTo(session, deckPath)
    expect(written(deckPath)).toBe(true)
    expect(hook).not.toHaveBeenCalled()
  })

  it('MCP save onto a read-only path throws without writing', async () => {
    bindPolicy({ readOnly: [deckPath] })
    await expect(saveSessionDeckTo(session, deckPath)).rejects.toThrow()
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    expect(hook).not.toHaveBeenCalled()
  })
})

describe('crash-recovery copy', () => {
  it('still writes the userData recovery copy of a bound dirty deck, with no hook', async () => {
    bindPolicy({ bound: [deckPath] })
    session.metaDirty = true
    vi.advanceTimersByTime(30_000)
    const dir = join(env.dir, 'slides-autosave')
    let copies: string[] = []
    for (let i = 0; i < 100 && copies.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50))
      copies = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.pptx')) : []
      if (copies.length && statSync(join(dir, copies[0]!)).size === 0) copies = []
    }
    expect(copies.length).toBe(1)
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    expect(hook).not.toHaveBeenCalled()
  })
})
