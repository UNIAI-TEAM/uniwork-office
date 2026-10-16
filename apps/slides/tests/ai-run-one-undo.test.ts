import { tmpdir } from 'node:os'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: never[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'slides-test',
    getVersion: () => '0',
    whenReady: () => Promise.resolve(),
  },
  dialog: {},
  clipboard: { writeBuffer: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (...args: never[]) => unknown) => handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  session: { defaultSession: { protocol: {}, setDisplayMediaRequestHandler: () => {} } },
  nativeImage: {},
  shell: {},
  desktopCapturer: { getSources: async () => [] },
  WebContentsView: class {},
}))
// The shaping chain loads a harfbuzz wasm that cannot resolve in the unit-test env;
// nothing measured here renders text.
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
import { registerSlidesIpc } from '../src/main/slides-main'
import { sessions, type Session } from '../src/main/session-state'

// G6-09 W9 (regression pin): the AI panel brackets a run with beginHistoryBatch/endHistoryBatch, so
// every edit the run's tools make is ONE undo step. These drive the real main-process handlers the
// tools call, in the order the panel does, and undo through the same IPC the Ctrl/Cmd+Z menu uses.

const WC = 1
const event = { sender: { id: WC } } as never

/** Forward a renderer call straight into the real main-process handler. */
function ipc(channel: string, ...args: unknown[]): unknown {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return (fn as (...a: unknown[]) => unknown)(event, ...args)
}

let session: Session

beforeAll(() => {
  // registerSlidesIpc is guarded by a module-level flag, so it must run exactly once
  registerSlidesIpc()
})

beforeEach(async () => {
  sessions.clear()
  session = {
    path: '',
    fitWidthPx: 1280,
    undoStack: [],
    redoStack: [],
    opened: await openPptx(await createBlankPptx()),
  }
  sessions.set(WC, session)
})

/** the deck as the user sees it: every slide with its elements */
const deckState = (): string => JSON.stringify(session.opened.deck.slides)

const rect = (slideIndex: number, xPx: number) => ({
  slideIndex,
  kind: 'rect',
  xPx,
  yPx: 40,
  wPx: 120,
  hPx: 80,
  fitWidthPx: 1280,
})

type Added = { sourceId: string } | null

describe('an AI run is one undo step in Slides', () => {
  it('several mutating tools (add shapes, add a slide, duplicate, delete) undo with one Ctrl/Cmd+Z', () => {
    const before = deckState()
    const slidesBefore = session.opened.deck.slides.length

    expect(ipc('slides:history-batch-begin')).toBe(true) // the panel opens the run's batch
    const a = ipc('slides:add-element', rect(0, 20)) as Added
    const b = ipc('slides:add-element', rect(0, 200)) as Added
    expect(a?.sourceId && b?.sourceId).toBeTruthy()
    ipc('slides:add-slide', { sourceIndex: 0, fitWidthPx: 1280 })
    ipc('slides:duplicate-elements', {
      slideIndex: 0,
      sourceIds: [a!.sourceId],
      dxPx: 10,
      dyPx: 10,
      fitWidthPx: 1280,
    })
    ipc('slides:delete-elements', { slideIndex: 0, sourceIds: [b!.sourceId] })
    expect(session.undoStack.length).toBeGreaterThan(1) // each tool pushed its own step while the run was open
    const snapshotId = ipc('slides:history-batch-end') // the panel closes it when the run ends

    expect(typeof snapshotId).toBe('number') // a rollback point exists for the run
    expect(session.undoStack).toHaveLength(1)
    expect(session.opened.deck.slides.length).toBe(slidesBefore + 1)
    expect(deckState()).not.toBe(before)

    ipc('slides:undo') // one Ctrl/Cmd+Z
    expect(deckState()).toBe(before)
    expect(session.opened.deck.slides.length).toBe(slidesBefore)
    expect(session.undoStack).toHaveLength(0)

    ipc('slides:redo') // and one redo brings the whole run back
    expect(session.opened.deck.slides.length).toBe(slidesBefore + 1)
  })

  it('a read-only run leaves no history step and no rollback point', () => {
    const before = deckState()
    expect(ipc('slides:history-batch-begin')).toBe(true)
    // read tools never reach a mutating handler: nothing is pushed while the run is open
    expect(session.undoStack).toHaveLength(0)
    const snapshotId = ipc('slides:history-batch-end')

    expect(snapshotId).toBeNull()
    expect(session.undoStack).toHaveLength(0)
    expect(deckState()).toBe(before)
    expect(ipc('slides:undo')).toBeNull() // nothing to undo: Ctrl/Cmd+Z must not touch the user's earlier work
  })

  it("a run that mutated nothing keeps the user's own earlier undo step as the top of the stack", () => {
    ipc('slides:add-element', rect(0, 20)) // the user's own edit before the run
    const userStep = session.undoStack.length
    expect(userStep).toBe(1)

    ipc('slides:history-batch-begin')
    ipc('slides:history-batch-end')
    expect(session.undoStack).toHaveLength(userStep)
  })

  it("a run on top of the user's own edit adds exactly one step (the user edit stays a separate step)", () => {
    ipc('slides:add-element', rect(0, 20))
    const afterUserEdit = deckState()

    ipc('slides:history-batch-begin')
    ipc('slides:add-element', rect(0, 200))
    ipc('slides:add-element', rect(0, 400))
    ipc('slides:history-batch-end')
    expect(session.undoStack).toHaveLength(2)

    ipc('slides:undo')
    expect(deckState()).toBe(afterUserEdit)
  })
})
