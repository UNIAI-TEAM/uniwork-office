import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// G6-12 #27 (spec §6.3 (c)): an AI-generated deck for a UniWork-bound document stays in
// the editor until the user saves. No draft under <Documents>/UniWork Office, no
// re-pointing of the session path. Local documents keep the draft auto-save.

const env = vi.hoisted(() => {
  // the crash-recovery tick is a module-level setInterval; keep it from firing
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  return { dir: '', handlers: new Map<string, (...args: never[]) => unknown>() }
})

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => join(env.dir, name),
    getName: () => 'slides-test',
    getVersion: () => '0',
    whenReady: () => Promise.resolve(),
  },
  dialog: {},
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
  nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 0, height: 0 }) }) },
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
import { registerSlidesIpc, setUniworkDocumentPolicy } from '../src/main/slides-main'
import { sessions, type Session } from '../src/main/session-state'
import { sessionDirty } from '../src/session/state'

const WC = 7
const FIT = 1280
const ORIGINAL = 'original bytes'

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = env.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  const event = { sender: { id: WC, isDestroyed: () => false, send: () => {} } }
  return Promise.resolve((fn as (...a: unknown[]) => unknown)(event, ...args))
}

/** One generated page, issued by the real local-page handler (same marker contract as generation). */
async function issuePage(text: string): Promise<string> {
  const specJson = JSON.stringify({
    elements: [
      {
        type: 'text',
        x: 80,
        y: 80,
        w: 800,
        h: 60,
        paragraphs: [{ runs: [{ text, sizePt: 24 }] }],
      },
    ],
  })
  const r = (await call('slides:local-page-generate', { specJson })) as {
    ok: boolean
    marker?: string
    error?: string
  }
  if (!r.ok || !r.marker) throw new Error(`page generation failed: ${r.error}`)
  return r.marker
}

const draftsDir = () => join(env.dir, 'documents', 'UniWork Office')
const drafts = () => (existsSync(draftsDir()) ? readdirSync(draftsDir()) : [])

let session: Session
let deckPath: string

beforeAll(() => {
  env.dir = mkdtempSync(join(tmpdir(), 'slides-g6-12-draft-'))
  registerSlidesIpc()
})

afterAll(() => {
  vi.useRealTimers()
  rmSync(env.dir, { recursive: true, force: true })
})

beforeEach(async () => {
  sessions.clear()
  setUniworkDocumentPolicy(null)
  rmSync(draftsDir(), { recursive: true, force: true })
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

afterEach(() => setUniworkDocumentPolicy(null))

function bind(path: string): void {
  setUniworkDocumentPolicy({ isBound: (p) => p === path, isReadOnly: () => false })
}

type Landed = { path?: string; slides?: unknown[]; error?: string }

describe('generate_deck / regenerate_slide landing on a UniWork-bound deck', () => {
  it('append (generate_deck): no draft, path kept, deck stays dirty, file untouched', async () => {
    bind(deckPath)
    const before = session.opened.deck.slides.length
    const r = (await call(
      'slides:land-generated-pages',
      [await issuePage('appended')],
      FIT,
      'append',
      undefined,
      'Quarterly Review',
    )) as Landed
    expect(r.error).toBeUndefined()
    // empty path: the panel takes no path change (title, dirty flag) from the landing
    expect(r.path).toBe('')
    expect(sessions.get(WC)!.path).toBe(deckPath)
    expect(sessions.get(WC)!.opened.deck.slides.length).toBe(before + 1)
    expect(drafts()).toEqual([])
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    expect(sessionDirty(sessions.get(WC)!)).toBe(true)
  })

  it('replace_at (regenerate_slide): no draft, path kept, deck stays dirty', async () => {
    bind(deckPath)
    const r = (await call(
      'slides:land-generated-pages',
      [await issuePage('regenerated')],
      FIT,
      'replace_at',
      0,
    )) as Landed
    expect(r.error).toBeUndefined()
    // empty path: the panel takes no path change (title, dirty flag) from the landing
    expect(r.path).toBe('')
    expect(sessions.get(WC)!.path).toBe(deckPath)
    expect(drafts()).toEqual([])
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    expect(sessionDirty(sessions.get(WC)!)).toBe(true)
  })

  it('insert_at (failed-page retry): no draft, path kept', async () => {
    bind(deckPath)
    const r = (await call(
      'slides:land-generated-pages',
      [await issuePage('inserted')],
      FIT,
      'insert_at',
      0,
    )) as Landed
    expect(r.error).toBeUndefined()
    expect(sessions.get(WC)!.path).toBe(deckPath)
    expect(drafts()).toEqual([])
    expect(sessionDirty(sessions.get(WC)!)).toBe(true)
  })

  it('replace (new deck): the new deck keeps the bound path, no draft, unsaved', async () => {
    bind(deckPath)
    const r = (await call(
      'slides:land-generated-pages',
      [await issuePage('page one'), await issuePage('page two')],
      FIT,
      'replace',
      undefined,
      'Quarterly Review',
    )) as Landed
    expect(r.error).toBeUndefined()
    // empty path: the panel takes no path change (title, dirty flag) from the landing
    expect(r.path).toBe('')
    const now = sessions.get(WC)!
    expect(now).not.toBe(session)
    expect(now.path).toBe(deckPath)
    expect(now.opened.deck.slides.length).toBe(2)
    expect(drafts()).toEqual([])
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    expect(sessionDirty(now)).toBe(true)
  })
})

describe('explicit Save of a bound deck after an AI landing', () => {
  const slideTexts = (opened: Awaited<ReturnType<typeof openPptx>>) =>
    JSON.stringify(opened.deck.slides)

  it('writes the generated pages into the working copy (append)', async () => {
    bind(deckPath)
    const before = session.opened.deck.slides.length
    await call(
      'slides:land-generated-pages',
      [await issuePage('saved page text')],
      FIT,
      'append',
      undefined,
      'Quarterly Review',
    )
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
    const r = (await call('slides:save', 'user')) as { ok: boolean; path?: string }
    expect(r.ok).toBe(true)
    expect(drafts()).toEqual([])
    const saved = await openPptx(new Uint8Array(readFileSync(deckPath)))
    expect(saved.deck.slides.length).toBe(before + 1)
    expect(slideTexts(saved)).toContain('saved page text')
    expect(sessionDirty(sessions.get(WC)!)).toBe(false)
  })

  it('writes the new deck into the working copy (replace)', async () => {
    bind(deckPath)
    await call(
      'slides:land-generated-pages',
      [await issuePage('first new page'), await issuePage('second new page')],
      FIT,
      'replace',
      undefined,
      'Quarterly Review',
    )
    const r = (await call('slides:save', 'user')) as { ok: boolean }
    expect(r.ok).toBe(true)
    const saved = await openPptx(new Uint8Array(readFileSync(deckPath)))
    expect(saved.deck.slides.length).toBe(2)
    expect(slideTexts(saved)).toContain('first new page')
    expect(slideTexts(saved)).toContain('second new page')
    expect(drafts()).toEqual([])
  })
})

describe('local (unbound) deck keeps the draft auto-save', () => {
  it('append writes a named draft and re-points the session to it', async () => {
    const r = (await call(
      'slides:land-generated-pages',
      [await issuePage('appended')],
      FIT,
      'append',
      undefined,
      'Quarterly Review',
    )) as Landed
    expect(r.error).toBeUndefined()
    expect(drafts()).toEqual(['Quarterly Review.pptx'])
    expect(sessions.get(WC)!.path).toBe(join(draftsDir(), 'Quarterly Review.pptx'))
    expect(r.path).toBe(join(draftsDir(), 'Quarterly Review.pptx'))
    expect(sessionDirty(sessions.get(WC)!)).toBe(false)
  })

  it('replace writes a named draft for the new deck', async () => {
    const r = (await call(
      'slides:land-generated-pages',
      [await issuePage('page one')],
      FIT,
      'replace',
      undefined,
      'Launch Plan',
    )) as Landed
    expect(r.error).toBeUndefined()
    expect(drafts()).toEqual(['Launch Plan.pptx'])
    expect(sessions.get(WC)!.path).toBe(join(draftsDir(), 'Launch Plan.pptx'))
  })
})

describe('local deck whose draft write fails', () => {
  // a plain file where the drafts folder should be: the folder check passes, the write fails
  const breakDraftsDir = () => {
    mkdirSync(join(env.dir, 'documents'), { recursive: true })
    writeFileSync(draftsDir(), 'not a folder')
  }
  afterEach(() => rmSync(draftsDir(), { recursive: true, force: true }))

  it('append reports no draft (empty path) and keeps the session path', async () => {
    breakDraftsDir()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = (await call(
      'slides:land-generated-pages',
      [await issuePage('appended')],
      FIT,
      'append',
      undefined,
      'Quarterly Review',
    )) as Landed
    expect(r.error).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    // saveDraftAfterGenerate returns false on a failed write, so the panel gets no path
    expect(r.path).toBe('')
    expect(sessions.get(WC)!.path).toBe(deckPath)
    expect(readFileSync(deckPath, 'utf8')).toBe(ORIGINAL)
  })

  it('replace reports no draft (empty path) for the new deck', async () => {
    breakDraftsDir()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = (await call(
      'slides:land-generated-pages',
      [await issuePage('page one')],
      FIT,
      'replace',
      undefined,
      'Launch Plan',
    )) as Landed
    warn.mockRestore()
    expect(r.error).toBeUndefined()
    expect(r.path).toBe('')
    expect(sessions.get(WC)!.path).toBe('')
  })
})
