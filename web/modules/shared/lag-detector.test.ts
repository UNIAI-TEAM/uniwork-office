// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FRAME_EVENT_TYPES, type LagDetectedPayload } from '../../docs/protocol/types'
import { createMockPort } from '../../docs/bridge/testing/mock-port'
import { createWebApi } from '../../docs/bridge/webapi'
import { createPdfWebApi } from '../pdf/webapi'
import type { PdfCore } from '../pdf/core'
import { createSheetsWebApi } from '../sheets/bridge'
import type { SheetsEngineTransport } from '../sheets/engine/transport'
import { createTextWebApi } from './text-webapi'
import {
  INTERACTION_WINDOW_MS,
  LOAD_SETTLE_GRACE_MS,
  configureSharedLagDetector,
  createLagDetector,
  onMarkDocumentLoaded,
  resetSharedLagDetector,
  type LagPerformanceEntry,
  type LagPerformanceObserverCallback,
  type LagPerformanceObserverConstructor,
  type LagPerformanceObserverInstance,
} from './lag-detector'

vi.mock('@genoffice/pptx-engine', () => ({
  createBlankPptx: vi.fn(async () => new Uint8Array([0x50, 0x4b, 3, 4])),
  savePptx: vi.fn(async () => new Uint8Array([0x50, 0x4b, 3, 4])),
}))

vi.mock('@genoffice/pptx-ops', () => ({
  runTxn: vi.fn(),
}))

vi.mock('../../../apps/slides/src/session', () => {
  const sessions = new Map<string, unknown>()
  return {
    appClipboard: {},
    callSessionHandler: vi.fn(),
    configureSessionPlatform: vi.fn(),
    ELEMENTS_MARKER: 'slides-elements',
    openResultFor: vi.fn((s: { result: unknown }) => s.result),
    openSessionFromBytes: vi.fn(
      async (clientId: string, opts: { path: string; fitWidthPx: number }) => {
        const result = { path: opts.path, slideCount: 1 }
        const session = { path: opts.path, fitWidthPx: opts.fitWidthPx, opened: {}, result }
        sessions.set(clientId, session)
        return { session, result }
      },
    ),
    resetFontMetricsCache: vi.fn(),
    sessionDirty: vi.fn(() => false),
    sessions,
    SLIDE_MARKER: 'slides-slide',
  }
})

vi.mock('../slides/fonts', () => ({
  createWebFontMetrics: vi.fn(() => ({})),
  embeddedFontSources: vi.fn(() => []),
  loadBundledFonts: vi.fn(async () => {}),
  registerEmbeddedFonts: vi.fn(async () => ({ registered: [], relaid: false })),
}))

import { createWebSlidesApi } from '../slides/web-slides-api'

const SAMPLE_PPTX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 10, 20, 30, 40, 50, 60, 70, 80])

interface FakeObserverRecord extends LagPerformanceObserverInstance {
  readonly callback: LagPerformanceObserverCallback
  readonly observed: Array<{ type: string; buffered?: boolean; durationThreshold?: number }>
  disconnected: boolean
  push(entries: LagPerformanceEntry[]): void
}

function makeFakeObserver(
  supportedEntryTypes: readonly string[] | undefined = ['longtask', 'event'],
) {
  const instances: FakeObserverRecord[] = []

  class FakePerformanceObserver implements LagPerformanceObserverInstance {
    static supportedEntryTypes = supportedEntryTypes
    readonly callback: LagPerformanceObserverCallback
    readonly observed: Array<{ type: string; buffered?: boolean; durationThreshold?: number }> = []
    disconnected = false

    constructor(callback: LagPerformanceObserverCallback) {
      this.callback = callback
      instances.push(this)
    }

    observe(options: { type: string; buffered?: boolean; durationThreshold?: number }): void {
      this.observed.push(options)
    }

    disconnect(): void {
      this.disconnected = true
    }

    push(entries: LagPerformanceEntry[]): void {
      if (this.disconnected) return
      this.callback({
        getEntries: () => entries,
      })
    }
  }

  return {
    Observer: FakePerformanceObserver as unknown as LagPerformanceObserverConstructor,
    instances,
    latest(): FakeObserverRecord {
      const inst = instances[instances.length - 1]
      if (!inst) throw new Error('expected a PerformanceObserver instance')
      return inst
    },
  }
}

describe('lag-detector protocol & unit behavior (UNI-1865)', () => {
  afterEach(() => {
    resetSharedLagDetector()
    vi.restoreAllMocks()
  })

  it('registers lag_detected in FRAME_EVENT_TYPES', () => {
    expect(FRAME_EVENT_TYPES).toContain('lag_detected')
  })

  it('window maths: 2 slow interactions -> nothing; 3 in 2 min -> one event; 3 spread over > 2 min -> nothing', () => {
    const fake = makeFakeObserver()
    const emitted: LagDetectedPayload[] = []
    const now = 1_000
    const detector = createLagDetector({
      observer: fake.Observer,
      now: () => now,
      requestAnimationFrame: (cb) => {
        cb(now)
        return 1
      },
      onLagDetected: (p) => emitted.push(p),
    })

    detector.markDocumentLoaded('doc-window-1', 52_428_800)
    const obs1 = fake.latest()
    expect(obs1.observed).toEqual([
      { type: 'longtask', buffered: false },
      { type: 'event', durationThreshold: 300, buffered: false },
    ])

    // 2 slow interactions within 2 min -> nothing
    obs1.push([
      { entryType: 'event', name: 'keydown', interactionId: 1, startTime: 3_500, duration: 340 },
      { entryType: 'event', name: 'click', interactionId: 2, startTime: 10_000, duration: 480 },
    ])
    expect(emitted).toHaveLength(0)
    expect(obs1.disconnected).toBe(false)

    // 3rd slow interaction > 2 min after the 1st (3_500 + 120_001 = 123_501) -> 1st evicted, only 2 in window -> nothing
    obs1.push([
      {
        entryType: 'event',
        name: 'pointerdown',
        interactionId: 3,
        startTime: 123_501,
        duration: 390,
      },
    ])
    expect(emitted).toHaveLength(0)
    expect(obs1.disconnected).toBe(false)

    // One more slow interaction within 2 min of #2 (10_000..125_000 is < 120_000) -> 3 in window (#2, #3, #4) -> trips!
    obs1.push([
      {
        entryType: 'event',
        name: 'keydown',
        interactionId: 4,
        startTime: 125_000,
        duration: 512.4,
      },
    ])
    expect(emitted).toEqual([
      {
        reason: 'interactions',
        worst_ms: 512,
        count: 3,
        window_ms: INTERACTION_WINDOW_MS,
        bytes: 52_428_800,
      },
    ])
    expect(obs1.disconnected).toBe(true)
  })

  it('deduplicates slow event entries sharing the same interactionId (keydown + input + keyup = 1 interaction)', () => {
    const fake = makeFakeObserver()
    const emitted: LagDetectedPayload[] = []
    const detector = createLagDetector({
      observer: fake.Observer,
      now: () => 0,
      requestAnimationFrame: (cb) => {
        cb(0)
        return 1
      },
      onLagDetected: (p) => emitted.push(p),
    })

    detector.markDocumentLoaded('doc-dedupe', 10_000)
    const obs = fake.latest()

    // Three events with the same interactionId = 101 count as ONE slow interaction
    obs.push([
      { entryType: 'event', name: 'keydown', interactionId: 101, startTime: 3_000, duration: 320 },
      { entryType: 'event', name: 'input', interactionId: 101, startTime: 3_002, duration: 450 },
      { entryType: 'event', name: 'keyup', interactionId: 101, startTime: 3_010, duration: 380 },
    ])
    expect(emitted).toHaveLength(0)

    // Second distinct interactionId = 102
    obs.push([
      {
        entryType: 'event',
        name: 'pointerdown',
        interactionId: 102,
        startTime: 5_000,
        duration: 350,
      },
      {
        entryType: 'event',
        name: 'pointerup',
        interactionId: 102,
        startTime: 5_005,
        duration: 410,
      },
      { entryType: 'event', name: 'click', interactionId: 102, startTime: 5_006, duration: 405 },
    ])
    expect(emitted).toHaveLength(0)

    // Third distinct interactionId = 103 -> now 3 distinct interactions in window; worst is 450 from interaction 101
    obs.push([
      { entryType: 'event', name: 'keydown', interactionId: 103, startTime: 7_000, duration: 330 },
    ])
    expect(emitted).toEqual([
      {
        reason: 'interactions',
        worst_ms: 450,
        count: 3,
        window_ms: INTERACTION_WINDOW_MS,
        bytes: 10_000,
      },
    ])
    expect(obs.disconnected).toBe(true)
  })

  it('trips on a single longtask of 1_001 ms and ignores a longtask of 999 ms (or 1_000 ms)', () => {
    const fake = makeFakeObserver()
    const emitted: LagDetectedPayload[] = []
    const detector = createLagDetector({
      observer: fake.Observer,
      now: () => 500,
      requestAnimationFrame: (cb) => {
        cb(500)
        return 1
      },
      onLagDetected: (p) => emitted.push(p),
    })

    detector.markDocumentLoaded('doc-longtask', 88_000_000)
    const obs = fake.latest()

    // 999 ms and 1_000 ms do not exceed > 1_000 ms threshold
    obs.push([
      { entryType: 'longtask', startTime: 3_000, duration: 999 },
      { entryType: 'longtask', startTime: 4_500, duration: 1_000 },
    ])
    expect(emitted).toHaveLength(0)
    expect(obs.disconnected).toBe(false)

    // 1_001 ms trips immediately
    obs.push([{ entryType: 'longtask', startTime: 6_000, duration: 1_001 }])
    expect(emitted).toEqual([
      {
        reason: 'longtask',
        worst_ms: 1_001,
        count: 1,
        window_ms: 0,
        bytes: 88_000_000,
      },
    ])
    expect(obs.disconnected).toBe(true)
  })

  it('ignores entries before loadSettledAt (first post-mount requestAnimationFrame + 2_000 ms)', () => {
    const fake = makeFakeObserver()
    const emitted: LagDetectedPayload[] = []
    let currentNow = 100
    let rafCallback: ((ts: number) => void) | null = null

    const detector = createLagDetector({
      observer: fake.Observer,
      now: () => currentNow,
      requestAnimationFrame: (cb) => {
        rafCallback = cb
        return 1
      },
      onLagDetected: (p) => emitted.push(p),
    })

    detector.markDocumentLoaded('doc-grace', 4_096)
    // First post-mount rAF fires at t = 250 -> loadSettledAt = 250 + 2_000 = 2_250
    currentNow = 250
    rafCallback!(250)
    expect(detector.loadSettledAt).toBe(250 + LOAD_SETTLE_GRACE_MS)

    const obs = fake.latest()
    // Longtasks and slow interactions before 2_250 ms are ignored
    obs.push([
      { entryType: 'longtask', startTime: 500, duration: 2_500 },
      { entryType: 'longtask', startTime: 2_249.9, duration: 1_800 },
      { entryType: 'event', name: 'click', interactionId: 1, startTime: 1_000, duration: 600 },
      { entryType: 'event', name: 'click', interactionId: 2, startTime: 1_500, duration: 600 },
      { entryType: 'event', name: 'click', interactionId: 3, startTime: 2_249, duration: 600 },
    ])
    expect(emitted).toHaveLength(0)
    expect(obs.disconnected).toBe(false)

    // Entry at loadSettledAt (2_250) is processed
    obs.push([{ entryType: 'longtask', startTime: 2_250, duration: 1_200 }])
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ reason: 'longtask', worst_ms: 1_200, bytes: 4_096 })
  })

  it('emits at most once per documentId and re-arms only when a new documentId is opened', () => {
    const fake = makeFakeObserver()
    const emitted: LagDetectedPayload[] = []
    const portEmit = vi.fn()
    const detector = createLagDetector({
      observer: fake.Observer,
      now: () => 0,
      requestAnimationFrame: (cb) => {
        cb(0)
        return 1
      },
      port: { emit: portEmit },
      onLagDetected: (p) => emitted.push(p),
    })

    detector.markDocumentLoaded('doc-A', 1_024)
    const obsA = fake.latest()

    // Two longtasks in the same callback batch -> only one event emitted
    obsA.push([
      { entryType: 'longtask', startTime: 3_000, duration: 1_100 },
      { entryType: 'longtask', startTime: 5_000, duration: 1_500 },
    ])
    expect(emitted).toHaveLength(1)
    expect(portEmit).toHaveBeenCalledTimes(1)
    expect(portEmit).toHaveBeenCalledWith('lag_detected', {
      reason: 'longtask',
      worst_ms: 1_100,
      count: 1,
      window_ms: 0,
      bytes: 1_024,
    })
    expect(obsA.disconnected).toBe(true)

    // Calling markDocumentLoaded again with the SAME documentId does not re-arm
    const countBeforeSame = fake.instances.length
    detector.markDocumentLoaded('doc-A', 2_048)
    expect(fake.instances.length).toBe(countBeforeSame)
    expect(emitted).toHaveLength(1)

    // Calling markDocumentLoaded with a NEW documentId re-arms
    detector.markDocumentLoaded('doc-B', 8_192)
    expect(fake.instances.length).toBe(countBeforeSame + 1)
    const obsB = fake.latest()
    expect(obsB.disconnected).toBe(false)

    obsB.push([{ entryType: 'longtask', startTime: 3_000, duration: 1_250 }])
    expect(emitted).toHaveLength(2)
    expect(emitted[1]).toEqual({
      reason: 'longtask',
      worst_ms: 1_250,
      count: 1,
      window_ms: 0,
      bytes: 8_192,
    })
  })

  it('is a no-op when PerformanceObserver is missing or supports neither longtask nor event', () => {
    const emitted: LagDetectedPayload[] = []

    const missingObsDetector = createLagDetector({
      observer: null,
      onLagDetected: (p) => emitted.push(p),
    })
    missingObsDetector.markDocumentLoaded('doc-safari-1', 100)
    expect(missingObsDetector.loadSettledAt).toBeNull()
    expect(emitted).toHaveLength(0)

    const unsupportedTypesFake = makeFakeObserver(['paint', 'navigation'])
    const unsupportedTypesDetector = createLagDetector({
      observer: unsupportedTypesFake.Observer,
      onLagDetected: (p) => emitted.push(p),
    })
    unsupportedTypesDetector.markDocumentLoaded('doc-safari-2', 100)
    expect(unsupportedTypesFake.instances).toHaveLength(0)
    expect(emitted).toHaveLength(0)
  })

  it('stays off when desktopOpen is false or in the desktop app', () => {
    const fake = makeFakeObserver()
    const emitted: LagDetectedPayload[] = []

    const noDesktopOpen = createLagDetector({
      observer: fake.Observer,
      desktopOpen: false,
      onLagDetected: (p) => emitted.push(p),
    })
    noDesktopOpen.markDocumentLoaded('doc-no-desktop', 5_000)
    expect(fake.instances).toHaveLength(0)
    expect(emitted).toHaveLength(0)

    const capFalse = createLagDetector({
      observer: fake.Observer,
      capabilities: { save: true, desktopOpen: false },
      onLagDetected: (p) => emitted.push(p),
    })
    capFalse.markDocumentLoaded('doc-cap-false', 5_000)
    expect(fake.instances).toHaveLength(0)

    const electronApp = createLagDetector({
      observer: fake.Observer,
      isDesktopApp: true,
      desktopOpen: true,
      onLagDetected: (p) => emitted.push(p),
    })
    electronApp.markDocumentLoaded('doc-electron', 5_000)
    expect(fake.instances).toHaveLength(0)
    expect(emitted).toHaveLength(0)
  })

  it('prefers port.reportLagDetected over port.emit and emits no raw postMessage fallback (d1-1)', () => {
    const fake = makeFakeObserver()
    const emit = vi.fn()
    const reportLagDetected = vi.fn()
    const parentPost = vi.spyOn(window.parent, 'postMessage')
    const detector = createLagDetector({
      observer: fake.Observer,
      now: () => 0,
      requestAnimationFrame: (cb) => {
        cb(0)
        return 1
      },
      port: { emit, reportLagDetected },
    })

    expect(reportLagDetected).toHaveBeenCalledTimes(1)
    expect(reportLagDetected).toHaveBeenCalledWith({
      reason: 'longtask',
      worst_ms: 1_100,
      count: 1,
      window_ms: 0,
      bytes: 2_048,
    })
    expect(emit).not.toHaveBeenCalled()
    expect(parentPost).not.toHaveBeenCalled()
  })

    const emitted: LagDetectedPayload[] = []
    const detector = createLagDetector({
      observer: fake.Observer,
      now: () => 0,
      requestAnimationFrame: (cb) => {
        cb(0)
        return 1
      },
      onLagDetected: (p) => emitted.push(p),
    })

})

describe('lag-detector module open-path wiring (docs, text, pdf, sheets, slides)', () => {
  let calls: Array<{ documentId: string; bytes?: number }> = []
  let unsubscribe: (() => void) | null = null

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    calls = []
    const fake = makeFakeObserver()
    configureSharedLagDetector({
      observer: fake.Observer,
      now: () => 0,
      requestAnimationFrame: (cb) => {
        cb(0)
        return 1
      },
    })
    unsubscribe = onMarkDocumentLoaded((call) => calls.push(call))
  })

  afterEach(() => {
    unsubscribe?.()
    unsubscribe = null
    resetSharedLagDetector()
    vi.restoreAllMocks()
  })

  it('wires markDocumentLoaded(documentId, bytes) after open in docs (web/docs/bridge/webapi.ts)', async () => {
    const mock = createMockPort()
    const payloadBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5])
    const meta = mock.seed('Report.docx', payloadBytes)
    const api = createWebApi(mock.port, { session: { pollMs: 0 } })
    mock.init({ documentId: meta.fileId, capabilities: { save: true, desktopOpen: true } })

    const opened = await api.consumePendingOpenDocx()
    expect(opened?.name).toBe('Report.docx')
    expect(calls).toContainEqual({ documentId: meta.fileId, bytes: payloadBytes.byteLength })
  })

  it('wires markDocumentLoaded(documentId, bytes) after open in text modules (markdown/html via text-webapi.ts)', async () => {
    const mock = createMockPort()
    const payloadBytes = new TextEncoder().encode('# Hello Markdown\n\nSome content.\n')
    const meta = mock.seed('Readme.md', payloadBytes)
    const api = createTextWebApi(
      mock.port,
      {
        module: 'markdown',
        ext: '.md',
        extPattern: /\.(md|markdown)$/i,
        mimeType: 'text/markdown',
      },
      { print: async () => ({ ok: true }) },
    )
    mock.init({ documentId: meta.fileId, capabilities: { save: true, desktopOpen: true } })

    const path = await api.consumePending()
    expect(path).toContain(meta.fileId)
    expect(calls).toContainEqual({ documentId: meta.fileId, bytes: payloadBytes.byteLength })
  })

  it('wires markDocumentLoaded(documentId, bytes) after open in pdf (web/modules/pdf/webapi.ts)', async () => {
    const mock = createMockPort()
    const payloadBytes = new TextEncoder().encode('%PDF-1.7 sample pdf bytes')
    const meta = mock.seed('Manual.pdf', payloadBytes)
    const fakePdfCore = {
      blankPdfBuffer: async () => payloadBytes.buffer,
    } as unknown as PdfCore
    const { api } = createPdfWebApi(mock.port, {
      capabilities: { edit: true },
      core: async () => fakePdfCore,
      ensureFonts: async () => {},
    })
    mock.init({ documentId: meta.fileId, capabilities: { save: true, desktopOpen: true } })

    const path = await api.consumePending()
    expect(path).toContain(meta.fileId)
    expect(calls).toContainEqual({ documentId: meta.fileId, bytes: payloadBytes.byteLength })
  })

  it('wires markDocumentLoaded(documentId, bytes) after open in sheets (web/modules/sheets/bridge.ts)', async () => {
    const mock = createMockPort()
    const payloadBytes = new Uint8Array([10, 20, 30, 40, 50, 60])
    const meta = mock.seed('Budget.xlsx', payloadBytes)
    const fakeTransport: SheetsEngineTransport = {
      kind: 'wasm',
      features: { xlsImport: false, pivotRefresh: false, recalcFallback: false },
      open: async (input) =>
        ({
          sessionId: 'sess-1',
          name: input.name,
          sheets: [{ id: 's1', name: 'Sheet1' }],
          readOnly: false,
        }) as never,
      readRange: async () => ({ cells: [], rows: [] }) as never,
      readFormulaCells: async () => ({ cells: [] }) as never,
      readMedia: async () => ({ mediaType: 'image/png', base64: '' }),
      readPivotDefinition: async () => ({}) as never,
      recalc: async () => ({ cells: [] }),
      serialize: async () => ({ data: payloadBytes.buffer, touchedEntries: [] }),
      replaceSession: async () => ({}) as never,
      close: async () => {},
    }
    const { desktopApi } = createSheetsWebApi(mock.port, {
      transport: fakeTransport,
      capabilities: { open: true, save: true, saveAs: true },
    })
    mock.init({ documentId: meta.fileId, capabilities: { save: true, desktopOpen: true } })

    const wb = await desktopApi.selectWorkbook()
    expect(wb?.name).toBe('Budget.xlsx')
    expect(calls).toContainEqual({ documentId: meta.fileId, bytes: payloadBytes.byteLength })
  })

  it('wires markDocumentLoaded(documentId, bytes) after open in slides (web/modules/slides/web-slides-api.ts)', async () => {
    const mock = createMockPort()
    const meta = mock.seed('Deck.pptx', SAMPLE_PPTX)
    const { slidesApi } = createWebSlidesApi({
      client: mock.port,
      capabilities: { open: true, save: true, saveAs: true },
    })
    mock.init({ documentId: meta.fileId, capabilities: { save: true, desktopOpen: true } })

    const opened = await slidesApi.consumePendingOpen(1280)
    expect(opened).not.toBeNull()
    expect(calls).toContainEqual({ documentId: meta.fileId, bytes: SAMPLE_PPTX.byteLength })
  })
})
