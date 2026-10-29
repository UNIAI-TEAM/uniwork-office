import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    saveDialogOptions: [] as Array<{ defaultPath?: string }>,
    openDialogPath: '' as string,
    openDialogOptions: [] as Array<{ filters?: Array<{ extensions: string[] }> }>,
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
    showOpenDialog: async (...args: unknown[]) => {
      env.openDialogOptions.push(args.at(-1) as { filters?: Array<{ extensions: string[] }> })
      return {
        canceled: !env.openDialogPath,
        filePaths: env.openDialogPath ? [env.openDialogPath] : [],
      }
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
    defaultSession: { protocol: { handle: () => {} }, setDisplayMediaRequestHandler: () => {} },
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
  convertedDocumentFor,
  forgetConvertedDocument,
  registerConvertedDocument,
} from '@genoffice/electron-utils'
import {
  registerSlidesIpc,
  setSlidesLegacyOpenHook,
  setSlidesUserSaveHook,
  setUniworkDocumentPolicy,
} from '../src/main/slides-main'
import { sessions, type Session } from '../src/main/session-state'

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
  setSlidesLegacyOpenHook(null)
  setUniworkDocumentPolicy(null)
  env.openDialogPath = ''
  env.openDialogOptions.length = 0
})

/**
 * A converted legacy .ppt is held as a temp .pptx. Its explicit Save is a Save As suggested
 * next to the original; AutoSave and the shell's flush for the UniWork first save ('in-place')
 * write the temp copy itself. Runs the real session handlers through the real IPC registration.
 */
describe('slides:save of a converted legacy deck', () => {
  let suggested: string

  beforeEach(() => {
    suggested = join(env.dir, `orig-${Math.random().toString(36).slice(2)}.pptx`)
    registerConvertedDocument(deckPath, {
      originalPath: suggested.replace(/\.pptx$/, '.ppt'),
      suggestSaveAs: suggested,
      tempDir: env.dir,
    })
    env.saveDialogPath = suggested
    env.saveDialogOptions.length = 0
  })

  afterEach(() => {
    forgetConvertedDocument(deckPath)
    forgetConvertedDocument(suggested)
  })

  it('an explicit Save asks where to write, suggested next to the original, never writes the temp copy', async () => {
    const r = (await call('slides:save')) as { ok: boolean; path?: string }

    expect(r).toMatchObject({ ok: true, path: suggested })
    expect(env.saveDialogOptions.at(-1)?.defaultPath).toBe(suggested)
    expect(written(suggested)).toBe(true)
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    expect(session.path).toBe(suggested)
    // the deck has its real home now: the conversion is forgotten and the next Save is plain
    expect(convertedDocumentFor(deckPath)).toBeUndefined()
    // the explicit Save landed on another file: a local copy, not the UniWork document's save
    expect(hook).not.toHaveBeenCalled()
    env.saveDialogOptions.length = 0
    const again = (await call('slides:save')) as { ok: boolean; path?: string }
    expect(again).toMatchObject({ ok: true, path: suggested })
    expect(env.saveDialogOptions).toHaveLength(0)
  })

  it("'in-place' (the shell's flush for the UniWork first save) writes the temp copy, no dialog, and reports the user save", async () => {
    const r = (await call('slides:save', 'in-place')) as { ok: boolean; path?: string }

    expect(r).toMatchObject({ ok: true, path: deckPath })
    expect(env.saveDialogOptions).toHaveLength(0)
    expect(written(deckPath)).toBe(true)
    expect(hook).toHaveBeenCalledExactlyOnceWith(deckPath)
    // still a converted copy until the UniWork binding moves the tab
    expect(convertedDocumentFor(deckPath)).toBeDefined()
  })

  it('tells the renderer a converted deck never autosaves, until Save As gives it a real home (F1)', async () => {
    expect(await call('slides:uniwork-state')).toMatchObject({ bound: false, converted: true })

    await call('slides:save')

    expect(await call('slides:uniwork-state')).toMatchObject({ bound: false, converted: false })
  })

  it('opening a converted deck never records its staging path in recents (F2)', async () => {
    const recent = () => {
      try {
        return readFileSync(join(env.dir, 'slides-recent.json'), 'utf8')
      } catch {
        return ''
      }
    }
    writeFileSync(deckPath, await createBlankPptx())
    expect(await call('slides:open-path', deckPath, FIT)).not.toBeNull()
    expect(recent()).not.toContain(deckPath)

    // an ordinary deck still lands in recents, and so does the real file a Save As writes
    const plain = join(env.dir, `plain-${Math.random().toString(36).slice(2)}.pptx`)
    writeFileSync(plain, await createBlankPptx())
    expect(await call('slides:open-path', plain, FIT)).not.toBeNull()
    expect(recent()).toContain(plain)
    sessions.set(WC, session)
    session.path = deckPath
    await call('slides:save')
    expect(recent()).toContain(suggested)
  })

  it('a same-stem sibling deck is an ordinary deck: Save writes in place', async () => {
    const sibling = suggested
    sessions.set(WC, { ...session, path: sibling })
    writeFileSync(sibling, ORIGINAL)

    const r = (await call('slides:save')) as { ok: boolean; path?: string }

    expect(r).toMatchObject({ ok: true, path: sibling })
    expect(env.saveDialogOptions).toHaveLength(0)
    expect(hook).toHaveBeenCalledExactlyOnceWith(sibling)
    expect(convertedDocumentFor(deckPath)).toBeDefined()
  })

  it('cancelling the Save As leaves the converted deck as it was', async () => {
    env.saveDialogPath = ''
    const r = (await call('slides:save')) as { ok: boolean }

    // silent in the renderer: no "Save failed: canceled" toast (F3)
    expect(r).toEqual({ ok: false, canceled: true })
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    expect(session.path).toBe(deckPath)
    expect(convertedDocumentFor(deckPath)).toBeDefined()
  })

  it('a Save As answered with the recorded original is refused: the pre-existing .ppt.pptx stays byte-identical (R1-3, R2-2)', async () => {
    const original = suggested.replace(/\.pptx$/, '.ppt')
    writeFileSync(original, ORIGINAL)
    // an independent deck already sits at the name a silent retarget would have used
    writeFileSync(`${original}.pptx`, 'someone else')
    env.saveDialogPath = original

    const r = (await call('slides:save')) as { ok: boolean; error?: string }

    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('.pptx') })
    expect(readFileSync(original, 'utf8')).toBe(ORIGINAL)
    expect(readFileSync(`${original}.pptx`, 'utf8')).toBe('someone else')
    expect(session.path).toBe(deckPath)
    expect(convertedDocumentFor(deckPath)).toBeDefined()
    rmSync(`${original}.pptx`, { force: true })
  })

  it('any other legacy-extension answer is refused too, for a converted and an ordinary deck', async () => {
    const other = join(env.dir, 'elsewhere.ppt')
    writeFileSync(other, ORIGINAL)
    env.saveDialogPath = other

    const converted = (await call('slides:save-as', 'x.pptx')) as { ok: boolean; error?: string }
    expect(converted).toMatchObject({ ok: false, error: expect.stringContaining('.pptx') })
    expect(readFileSync(other, 'utf8')).toBe(ORIGINAL)
    expect(written(`${other}.pptx`)).toBe(false)

    forgetConvertedDocument(deckPath)
    sessions.set(WC, { ...session, path: deckPath })
    const ordinary = (await call('slides:save-as', 'x.pptx')) as { ok: boolean; error?: string }
    expect(ordinary).toMatchObject({ ok: false })
    expect(readFileSync(other, 'utf8')).toBe(ORIGINAL)
    expect(written(`${other}.pptx`)).toBe(false)
  })

  it('offers .odp and .otp in slides:open and hands them to the shell legacy-open hook instead of openAndBuild', async () => {
    const handed: string[] = []
    setSlidesLegacyOpenHook((p) => {
      handed.push(p)
      return true
    })
    const odpPath = join(env.dir, 'Deck.odp')
    const otpPath = join(env.dir, 'Template.otp')
    writeFileSync(odpPath, 'PK\u0003\u0004')
    writeFileSync(otpPath, 'PK\u0003\u0004')

    env.openDialogPath = odpPath
    await expect(call('slides:open', FIT)).resolves.toBeNull()
    expect(env.openDialogOptions.at(-1)).toMatchObject({
      filters: [{ extensions: ['pptx', 'ppt', 'odp', 'otp'] }],
    })
    expect(handed).toEqual([odpPath])

    env.openDialogPath = otpPath
    await expect(call('slides:open', FIT)).resolves.toBeNull()
    expect(handed).toEqual([odpPath, otpPath])

    setSlidesLegacyOpenHook(null)
    env.openDialogPath = odpPath
    await expect(call('slides:open', FIT)).resolves.toBeNull()
  })
})
