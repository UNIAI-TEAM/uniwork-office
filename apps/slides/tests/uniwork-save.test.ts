import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The crash-recovery tick is a module-level setInterval: fake only that timer
// (installed before slides-main loads) so the test can fire one tick on demand.
const env = vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  return {
    dir: '',
    handlers: new Map<string, (...args: never[]) => unknown>(),
    saveDialogPath: '' as string,
    saveDialogOptions: [] as Array<{ defaultPath?: string }>,
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
    showSaveDialog: async (...args: unknown[]) => {
      env.saveDialogOptions.push(args.at(-1) as { defaultPath?: string })
      return { canceled: false, filePath: env.saveDialogPath }
    },
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
  clearSlidesRecovery,
  queueSlidesForView,
  slidesRecoveryEpochEntries,
  recoveryCopyMtime,
  registerSlidesIpc,
  saveSessionDeckTo,
  setSlidesUserSaveHook,
  setUniworkDocumentPolicy,
  trackSlidesWebContents,
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

function bindPolicy(opts: { bound?: string[]; readOnly?: string[]; locked?: string[] }): void {
  const bound = new Set([...(opts.bound ?? []), ...(opts.readOnly ?? []), ...(opts.locked ?? [])])
  const ro = new Set(opts.readOnly ?? [])
  const locked = new Set(opts.locked ?? [])
  setUniworkDocumentPolicy({
    isBound: (p) => bound.has(p),
    isReadOnly: (p) => ro.has(p),
    isLocked: (p) => locked.has(p),
  })
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
    // a Save As that picks the deck's own file is an explicit Save; onto another file it is a copy
    expect(uniworkSaveDecision({ ...base, kind: 'save-as', origin: 'user' }).fireHook).toBe(true)
    expect(
      uniworkSaveDecision({ ...base, targetPath: '/d/copy.pptx', kind: 'save-as', origin: 'user' })
        .fireHook,
    ).toBe(false)
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

  it('reads a missing or unknown origin as an explicit save, and preserves capture', () => {
    expect(parseUniworkSaveOrigin(undefined)).toBe('user')
    expect(parseUniworkSaveOrigin('weird')).toBe('user')
    expect(parseUniworkSaveOrigin('auto')).toBe('auto')
    expect(parseUniworkSaveOrigin('capture')).toBe('capture')
  })

  it('capture origin writes a bound editable deck without firing the hook and refuses read-only', () => {
    bindPolicy({ bound: ['/d/b.pptx'], readOnly: ['/d/r.pptx'] })
    expect(
      uniworkSaveDecision({
        kind: 'save',
        origin: 'capture',
        currentPath: '/d/b.pptx',
        targetPath: '/d/b.pptx',
      }),
    ).toEqual({ write: true, fireHook: false })
    expect(
      uniworkSaveDecision({
        kind: 'save',
        origin: 'capture',
        currentPath: '/d/r.pptx',
        targetPath: '/d/r.pptx',
      }),
    ).toEqual({ write: false, fireHook: false })
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

  it('Save As of a bound deck starts from its name in the remembered folder, not next to the copy', async () => {
    const elsewhere = join(env.dir, 'elsewhere')
    mkdirSync(elsewhere, { recursive: true })
    env.saveDialogPath = join(elsewhere, 'copy.pptx')
    await call('slides:save-as', 'deck.pptx')
    // a local deck: Word parity, next to the file
    expect(env.saveDialogOptions.at(-1)?.defaultPath).toBe(join(dirname(deckPath), 'deck.pptx'))
    // that Save As moved the session onto the copy: back to the working copy
    session.path = deckPath
    bindPolicy({ bound: [deckPath] })
    await call('slides:save-as', 'deck.pptx')
    expect(env.saveDialogOptions.at(-1)?.defaultPath).toBe(join(elsewhere, 'deck.pptx'))
  })

  it('Save As onto the open deck itself is an explicit Save: it writes and fires once', async () => {
    bindPolicy({ bound: [deckPath] })
    env.saveDialogPath = deckPath
    const r = (await call('slides:save-as', 'deck.pptx')) as { ok: boolean; path?: string }
    expect(r.ok).toBe(true)
    expect(r.path).toBe(deckPath)
    expect(written(deckPath)).toBe(true)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(deckPath)
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

  it('Save As of a locked working copy is refused before the target picker opens', async () => {
    bindPolicy({ locked: [deckPath] })
    const pickersBefore = env.saveDialogOptions.length
    const r = (await call('slides:save-as', 'deck.pptx')) as { ok: boolean }
    expect(r).toEqual({ ok: false })
    // the host seam answers the lock (the session core never imports main/)
    expect(env.saveDialogOptions).toHaveLength(pickersBefore)
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
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
  it('a dirty bound deck writes no autosave copy', async () => {
    const localPath = join(env.dir, `local-${Math.random().toString(36).slice(2)}.pptx`)
    writeFileSync(localPath, ORIGINAL)
    const localSession: Session = {
      path: localPath,
      fitWidthPx: FIT,
      undoStack: [],
      redoStack: [],
      opened: await openPptx(await createBlankPptx()),
      metaDirty: true,
    }
    bindPolicy({ bound: [deckPath] })
    session.metaDirty = true
    sessions.set(WC + 1, localSession)
    vi.advanceTimersByTime(30_000)
    const dir = join(env.dir, 'slides-autosave')
    const localCopy = `${createHash('sha1').update(localPath).digest('hex').slice(0, 16)}.pptx`
    const boundCopy = `${createHash('sha1').update(deckPath).digest('hex').slice(0, 16)}.pptx`
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 50))
      if (existsSync(join(dir, localCopy)) && statSync(join(dir, localCopy)).size > 0) break
    }
    const copies = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.pptx')) : []
    expect(copies).toEqual([localCopy])
    expect(existsSync(join(dir, boundCopy))).toBe(false)
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    expect(hook).not.toHaveBeenCalled()
  })
})

describe('queueSlidesForView and slides:consume-pending-open reload routing', () => {
  it('re-opens the queued deck from disk instead of returning the stale in-memory session', async () => {
    writeFileSync(deckPath, await createBlankPptx())
    await call('slides:add-blank-slide', { sourceIndex: 0, before: false, fitWidthPx: FIT })
    expect(session.opened.deck.slides).toHaveLength(2)

    // Write a newer crash-recovery copy first: queueSlidesForView must clear it so
    // maybeRecoverBytes does not prompt Restore/Discard on S5 "Reload latest".
    vi.advanceTimersByTime(30_000)
    const dir = join(env.dir, 'slides-autosave')
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 50))
      const copies = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.pptx')) : []
      if (copies.length && statSync(join(dir, copies[0]!)).size > 0) break
    }

    queueSlidesForView({ id: WC } as never, deckPath)
    expect(sessions.get(WC)).toBeUndefined()

    const r = (await call('slides:consume-pending-open', FIT)) as {
      path: string
      slides: unknown[]
    } | null
    expect(r?.path).toBe(deckPath)
    expect(r?.slides).toHaveLength(1)
    expect(sessions.get(WC)?.opened.deck.slides).toHaveLength(1)
  })

  it('keeps aliased peers on the old session during the reload window, then swaps them to the fresh one', async () => {
    const PEER_WC = 2
    writeFileSync(deckPath, await createBlankPptx())
    await call('slides:add-blank-slide', { sourceIndex: 0, before: false, fitWidthPx: FIT })
    expect(session.opened.deck.slides).toHaveLength(2)
    sessions.set(PEER_WC, session)

    queueSlidesForView({ id: WC } as never, deckPath)
    // only the reloading view drops its session; the peer keeps editing the old one until the fresh deck exists
    expect(sessions.get(WC)).toBeUndefined()
    expect(sessions.get(PEER_WC)).toBe(session)

    const r = (await call('slides:consume-pending-open', FIT)) as {
      path: string
      slides: unknown[]
    } | null
    expect(r?.slides).toHaveLength(1)
    expect(sessions.get(WC)?.opened.deck.slides).toHaveLength(1)
    expect(sessions.get(PEER_WC)).toBe(sessions.get(WC))
    expect(sessions.get(WC)).not.toBe(session)
  })

  it('a failed re-open (file gone) restores the reloading view and keeps the peers on the old session', async () => {
    const PEER_WC = 2
    sessions.set(PEER_WC, session)
    queueSlidesForView({ id: WC } as never, deckPath)
    rmSync(deckPath)

    const r = (await call('slides:consume-pending-open', FIT)) as {
      path: string
      slides: unknown[]
    } | null
    expect(r?.path).toBe(deckPath)
    expect(r?.slides).toHaveLength(1)
    expect(sessions.get(WC)).toBe(session)
    expect(sessions.get(PEER_WC)).toBe(session)
    // the dead queue entry does not linger for the next remount
    const again = (await call('slides:consume-pending-open', FIT)) as { path: string } | null
    expect(again?.path).toBe(deckPath)
  })

  it('a refused re-open (newer-store working copy) restores the reloading view on its UniWork path', async () => {
    const PEER_WC = 2
    sessions.set(PEER_WC, session)
    queueSlidesForView({ id: WC } as never, deckPath)
    // G5-04g: the folder declares a store this build does not read
    setUniworkDocumentPolicy({
      isBound: () => true,
      isReadOnly: () => false,
      refuseOpen: (p) => p === deckPath,
    })

    const r = (await call('slides:consume-pending-open', FIT)) as {
      path: string
      slides: unknown[]
    } | null
    expect(r?.path).toBe(deckPath)
    expect(r?.slides).toHaveLength(1)
    expect(sessions.get(WC)).toBe(session)
    expect(sessions.get(PEER_WC)).toBe(session)
  })

  it('a re-open that throws resolves with the previous deck instead of rejecting (no blank boot)', async () => {
    const PEER_WC = 2
    sessions.set(PEER_WC, session)
    queueSlidesForView({ id: WC } as never, deckPath)
    // deckPath still holds the placeholder bytes: not a pptx, openPptx throws
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // a rejection would make the renderer boot a blank deck over the restored session (BE-502)
    const r = (await call('slides:consume-pending-open', FIT)) as {
      path: string
      slides: unknown[]
    } | null
    expect(r?.path).toBe(deckPath)
    expect(r?.slides).toHaveLength(1)
    expect(sessions.get(WC)).toBe(session)
    expect(sessions.get(PEER_WC)).toBe(session)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()

    // the dead queue entry is dropped, so the next remount restores the session instead of retrying
    const again = (await call('slides:consume-pending-open', FIT)) as { path: string } | null
    expect(again?.path).toBe(deckPath)
    expect(sessions.get(WC)).toBe(session)
  })

  it('restores the in-memory session when reloading without queueSlidesForView (freeze recovery)', async () => {
    writeFileSync(deckPath, await createBlankPptx())
    await call('slides:add-blank-slide', { sourceIndex: 0, before: false, fitWidthPx: FIT })
    expect(session.opened.deck.slides).toHaveLength(2)

    const r = (await call('slides:consume-pending-open', FIT)) as {
      path: string
      slides: unknown[]
    } | null
    expect(r?.path).toBe(deckPath)
    expect(r?.slides).toHaveLength(2)
    expect(sessions.get(WC)).toBe(session)
  })
})

describe('reload window state tied to the webContents lifecycle', () => {
  /** a webContents stand-in that records its lifecycle handlers so a test can fire `destroyed` */
  function trackedWc(id: number) {
    const once = new Map<string, () => void>()
    const wc = {
      id,
      on: () => wc,
      once: (event: string, fn: () => void) => {
        once.set(event, fn)
        return wc
      },
      setWindowOpenHandler: () => {},
    }
    trackSlidesWebContents(wc as never)
    return { wc, destroy: () => once.get('destroyed')?.() }
  }

  it('a peer destroyed during the reload window is not swapped onto the fresh session', async () => {
    const PEER_WC = 2
    writeFileSync(deckPath, await createBlankPptx())
    sessions.set(PEER_WC, session)
    const peer = trackedWc(PEER_WC)
    queueSlidesForView({ id: WC } as never, deckPath)

    peer.destroy()
    expect(sessions.has(PEER_WC)).toBe(false)

    await call('slides:consume-pending-open', FIT)
    expect(sessions.get(WC)).not.toBeUndefined()
    expect(sessions.has(PEER_WC)).toBe(false)
  })

  it('a reloading view destroyed before it consumes leaves no queue, no session and no restored deck', async () => {
    const view = trackedWc(WC)
    queueSlidesForView({ id: WC } as never, deckPath)
    view.destroy()

    expect(await call('slides:consume-pending-open', FIT)).toBeNull()
    expect(sessions.has(WC)).toBe(false)
  })
})

describe('recovery copy cleared while an autosave tick is in flight', () => {
  it('removes the copy the tick wrote after queueSlidesForView cleared it (target gone)', async () => {
    session.metaDirty = true
    expect(recoveryCopyMtime(deckPath)).toBeNull()

    vi.advanceTimersByTime(30_000) // the tick is now awaiting its write of the recovery copy
    queueSlidesForView({ id: WC } as never, deckPath) // S5 reload: bumps the clear epoch mid-tick

    await new Promise((r) => setTimeout(r, 1500)) // the tick finishes its write, then must undo it
    expect(recoveryCopyMtime(deckPath)).toBeNull()
  })
})

describe('the sign-out sweep against the autosave tick (G5-11f d3-1, d3-3)', () => {
  it('removes the copy a tick wrote after the sweep cleared the deck (target gone)', async () => {
    session.metaDirty = true
    expect(recoveryCopyMtime(deckPath)).toBeNull()

    vi.advanceTimersByTime(30_000) // the tick is awaiting its write of the recovery copy
    clearSlidesRecovery(deckPath) // the sweep's clearer runs mid-tick

    await new Promise((r) => setTimeout(r, 1500))
    expect(recoveryCopyMtime(deckPath)).toBeNull()
    expect(slidesRecoveryEpochEntries()).toBe(0)
  })

  it('a tick that starts after the sweep writes no copy while the deck is still open', async () => {
    // the sweep deleted the binding, so the bound gate no longer holds
    bindPolicy({})
    session.metaDirty = true
    clearSlidesRecovery(deckPath)

    vi.advanceTimersByTime(30_000)
    await new Promise((r) => setTimeout(r, 1500))
    expect(recoveryCopyMtime(deckPath)).toBeNull()
    const dir = join(env.dir, 'slides-autosave')
    const bound = `${createHash('sha1').update(deckPath).digest('hex').slice(0, 16)}.pptx`
    expect(existsSync(join(dir, bound))).toBe(false)
  })

  it('A82 (UNI-1362): closing the last session of a swept path drops its mark on close, while an aliased session keeps it', async () => {
    bindPolicy({})
    const once1 = new Map<string, () => void>()
    const wc1 = {
      id: WC,
      on: () => wc1,
      once: (event: string, fn: () => void) => {
        once1.set(event, fn)
        return wc1
      },
      setWindowOpenHandler: () => {},
    }
    trackSlidesWebContents(wc1 as never)
    const PEER_WC = 2
    const once2 = new Map<string, () => void>()
    const wc2 = {
      id: PEER_WC,
      on: () => wc2,
      once: (event: string, fn: () => void) => {
        once2.set(event, fn)
        return wc2
      },
      setWindowOpenHandler: () => {},
    }
    trackSlidesWebContents(wc2 as never)
    sessions.set(PEER_WC, session)
    session.metaDirty = true
    clearSlidesRecovery(deckPath)

    // closing one of two aliased sessions keeps the swept mark for the remaining one
    const dir = join(env.dir, 'slides-autosave')
    const bound = `${createHash('sha1').update(deckPath).digest('hex').slice(0, 16)}.pptx`
    once1.get('destroyed')?.()
    vi.advanceTimersByTime(30_000)
    await Promise.resolve()
    expect(recoveryCopyMtime(deckPath)).toBeNull()
    expect(existsSync(join(dir, bound))).toBe(false)

    // closing the last session drops the mark on close, so a session that
    // reopens the same path before any tick runs can write its recovery copy
    once2.get('destroyed')?.()
    sessions.set(WC, {
      ...session,
      metaDirty: true,
    })
    vi.advanceTimersByTime(30_000)
    await vi.waitFor(() => expect(existsSync(join(dir, bound))).toBe(true))
  })
})

describe('EL-1(b) fix6: slides:uniwork-read-only-save', () => {
  it('forwards the sender session deck path to policy.readOnlySave and ignores unknown senders or mismatched paths', async () => {
    const readOnlySaves: string[] = []
    const policy = {
      isBound: (p: string) => p === deckPath,
      isReadOnly: (p: string) => p === deckPath,
      readOnlySave: (p: string) => void readOnlySaves.push(p),
    }
    setUniworkDocumentPolicy(policy)
    await call('slides:uniwork-read-only-save')
    await call('slides:uniwork-read-only-save', deckPath)
    await call('slides:uniwork-read-only-save', join(env.dir, 'other.pptx'))
    const fn = env.handlers.get('slides:uniwork-read-only-save')
    if (fn) {
      const unknownSender = { sender: { id: 9999 } } as never
      fn(unknownSender)
    }
    expect(readOnlySaves).toEqual([deckPath, deckPath])
  })
})
