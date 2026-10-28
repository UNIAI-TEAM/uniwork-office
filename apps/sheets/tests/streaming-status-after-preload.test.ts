import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '../src/renderer/i18n/locale'
import { loadVisibleRange, preloadEntireWorkbook } from '../src/renderer/univer-sync'
import { createEditJournal } from '../src/renderer/edit-journal'
import type { LazyWorkbookState } from '../src/renderer/univer-state'

/// UNI-1416: a loadRange tail that finishes after the full preload used to
/// overwrite "fully loaded" with the streaming status line for good. Two paths
/// reach it: the 250 ms retry timer armed while the sidecar was still
/// indexing, and a later viewport load on a sheet whose decorations were still
/// pending when the preload read it.

const ROWS = 9
const COLUMNS = 4

function sheetMeta(rowCount = ROWS, columnCount = COLUMNS) {
  return {
    id: 'sheet-1',
    name: 'Sheet1',
    rowCount,
    columnCount,
    tables: [],
    pivotTables: [],
    freeze: null,
    columnWidths: [],
  }
}

function lazyState(rowCount = ROWS, columnCount = COLUMNS): LazyWorkbookState {
  return {
    file: {
      sessionId: 'session-1',
      sha256: 'sha',
      name: 'Small.xlsx',
      styles: [],
      sheets: [sheetMeta(rowCount, columnCount)],
    },
    generation: 1,
    loadedRanges: new Map(),
    streamAliases: new Map(),
    loadingKeys: new Map(),
    retryTimers: new Map(),
    appliedMerges: new Map(),
    appliedRowKeys: new Map(),
    measuredWrapRows: new Map(),
    rowColStyleKeys: new Map(),
    sheetProtections: new Map(),
    sheetPageBreaks: new Map(),
    sheetFilePageSetups: new Map(),
    sheetProtectedRanges: new Map(),
    uninstalledDefinedNames: new Set(),
    appliedCfSheets: new Set(),
    appliedFilterSheets: new Set(),
    appliedDvSheets: new Set(),
    decorationsPendingSheets: new Set(),
    hyperlinkTargets: new Map(),
    frozenStripKeys: new Map(),
    filterOrigins: new Map(),
    restoredFilterSpans: new Map(),
    showFormulaSheets: new Set(),
    formulaMode: false,
    editJournal: createEditJournal(),
    flags: { preloadComplete: false, preloadRunning: false },
    closure: { status: 'idle', pinned: new Map() },
    formulaText: new Map(),
    formulaTextTruncated: new Set(),
    sharedFormulaGroups: new Map(),
    cachedFormulaValues: new Map(),
    pivotDefinitions: new Map(),
    hiddenFileRows: new Map(),
    hiddenRowsCoveredThrough: new Map(),
    outline: new Map(),
    recalc: {
      timer: null,
      generation: 0,
      failures: 0,
      engineOverBudget: false,
      formulaCells: new Map(),
      overlay: new Map(),
      follow: new Map(),
      running: false,
      lastRunAt: 0,
    },
  } as unknown as LazyWorkbookState
}

function rangeResult(indexingComplete: boolean) {
  return {
    cells: [],
    rows: [],
    merges: [],
    hyperlinks: [],
    conditionalRules: [],
    dataValidations: [],
    autoFilter: null,
    autoFilterColumns: [],
    sheetProtection: null,
    protectedRanges: [],
    rowBreaks: [],
    colBreaks: [],
    pageSetup: null,
    indexedThroughRow: ROWS - 1,
    indexingComplete,
  }
}

function makeWorksheet() {
  return {
    getSheetId: () => 'sheet-1',
    getRange: () => ({ setValues: () => undefined }),
    getVisibleRange: () => ({
      startRow: 0,
      endRow: ROWS - 1,
      startColumn: 0,
      endColumn: COLUMNS - 1,
    }),
  }
}

function makeRuntime(worksheet: ReturnType<typeof makeWorksheet>) {
  const workbook = {
    getActiveSheet: () => worksheet,
    getSheetBySheetId: () => worksheet,
  }
  return { univerAPI: { getActiveWorkbook: () => workbook } }
}

describe('streaming status after the full preload', () => {
  let reads: Array<ReturnType<typeof rangeResult>>
  let messages: string[]

  beforeEach(() => {
    vi.useFakeTimers()
    messages = []
    reads = []
    vi.stubGlobal('window', {
      desktopApi: {
        readWorkbookRange: vi.fn(async () => reads.shift() ?? rangeResult(true)),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('path A: the 250 ms retry armed before the preload does not replace the fully loaded status', async () => {
    const state = lazyState()
    const ref = { current: state }
    const worksheet = makeWorksheet()
    const runtime = makeRuntime(worksheet)
    const setMessage = (message: string) => messages.push(message)
    // Viewport load sees an indexing sidecar (arms the retry), the preload
    // then reads a finished one.
    reads = [rangeResult(false), rangeResult(true)]

    // App.tsx starts the preload right behind the viewport load without
    // awaiting it, so the two overlap.
    const viewport = loadVisibleRange(runtime as never, ref, worksheet as never, setMessage)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.retryTimers.size).toBe(1)
    await preloadEntireWorkbook(runtime as never, ref, setMessage)
    expect(state.flags.preloadComplete).toBe(true)
    expect(messages.at(-1)).toBe(t('appFullyLoaded'))

    await vi.advanceTimersByTimeAsync(300)
    await viewport

    expect(messages.at(-1)).toBe(t('appFullyLoaded'))
  })

  it('path B: a viewport load after the preload with decorations pending keeps the fully loaded status', async () => {
    const state = lazyState()
    const ref = { current: state }
    const worksheet = makeWorksheet()
    const runtime = makeRuntime(worksheet)
    const setMessage = (message: string) => messages.push(message)
    // The preload reads the sheet before indexing finished, so its
    // decorations stay pending although every row is installed.
    reads = [rangeResult(false)]

    await preloadEntireWorkbook(runtime as never, ref, setMessage)
    expect(state.flags.preloadComplete).toBe(true)
    expect(state.decorationsPendingSheets.has('sheet-1')).toBe(true)
    expect(messages.at(-1)).toBe(t('appFullyLoaded'))

    await loadVisibleRange(runtime as never, ref, worksheet as never, setMessage)
    await vi.advanceTimersByTimeAsync(300)

    expect(messages.at(-1)).toBe(t('appFullyLoaded'))
  })

  it('keeps redactionMessage visible when full preload finishes instead of overwriting with appFullyLoaded', async () => {
    const state = lazyState()
    state.redactionMessage = t('redactRecoveredFromNames')
    const ref = { current: state }
    const worksheet = makeWorksheet()
    const runtime = makeRuntime(worksheet)
    const setMessage = (message: string) => messages.push(message)
    reads = [rangeResult(true)]

    await preloadEntireWorkbook(runtime as never, ref, setMessage)

    expect(state.flags.preloadComplete).toBe(true)
    expect(messages.at(-1)).toBe(t('redactRecoveredFromNames'))
  })

  // UNI-2216: a workbook that never runs the full preload (small, non-formula
  // mode) kept "Streaming <name>: N rows available." on the bar for good.
  describe('without the full preload', () => {
    it('shows the indexing status while the stream runs and clears it once the sheet is complete', async () => {
      const state = lazyState()
      const ref = { current: state }
      const worksheet = makeWorksheet()
      const runtime = makeRuntime(worksheet)
      const setMessage = (message: string) => messages.push(message)
      reads = [{ ...rangeResult(false), indexedThroughRow: 3 }, rangeResult(true)]

      // The hidden-row probe polls on a timer while decorations are pending.
      const viewport = loadVisibleRange(runtime as never, ref, worksheet as never, setMessage)
      await vi.advanceTimersByTimeAsync(0)
      expect(messages.at(-1)).toBe(t('appIndexing', { name: 'Sheet1', rows: '4' }))

      await vi.advanceTimersByTimeAsync(10_000)
      await viewport

      expect(state.flags.preloadComplete).toBe(false)
      expect(messages.at(-1)).toBe('')
      expect(messages).not.toContain(
        t('appStreamingRows', { name: 'Small.xlsx', rows: String(ROWS) }),
      )
    })

    it('a small workbook that finishes indexing at once never shows the streaming status', async () => {
      const state = lazyState()
      const ref = { current: state }
      const worksheet = makeWorksheet()
      const runtime = makeRuntime(worksheet)
      const setMessage = (message: string) => messages.push(message)
      reads = [rangeResult(true)]

      await loadVisibleRange(runtime as never, ref, worksheet as never, setMessage)

      expect(messages).not.toContain(
        t('appStreamingRows', { name: 'Small.xlsx', rows: String(ROWS) }),
      )
      expect(messages.at(-1)).toBe('')
    })

    it('a sheet declared far wider than its viewport clears the status once every row is in', async () => {
      // A LibreOffice-converted .xls reports A:IW although only a few columns
      // hold data; the viewport load never spans them, rows are all loaded.
      const state = lazyState(ROWS, 257)
      const ref = { current: state }
      const worksheet = makeWorksheet()
      const runtime = makeRuntime(worksheet)
      const setMessage = (message: string) => messages.push(message)
      reads = [rangeResult(true)]

      await loadVisibleRange(runtime as never, ref, worksheet as never, setMessage)

      expect(state.loadedRanges.get('sheet-1')?.endColumn).toBeLessThan(256)
      expect(messages).not.toContain(
        t('appStreamingRows', { name: 'Small.xlsx', rows: String(ROWS) }),
      )
      expect(messages.at(-1)).toBe('')
    })

    it('keeps the streaming status while only part of the sheet is in the grid', async () => {
      const state = lazyState(100_000)
      const ref = { current: state }
      const worksheet = makeWorksheet()
      const runtime = makeRuntime(worksheet)
      const setMessage = (message: string) => messages.push(message)
      reads = [rangeResult(true)]

      await loadVisibleRange(runtime as never, ref, worksheet as never, setMessage)

      expect(messages.at(-1)).toBe(
        t('appStreamingRows', { name: 'Small.xlsx', rows: (100_000).toLocaleString() }),
      )
    })

    it('keeps redactionMessage visible when viewport load finishes on a small workbook instead of clearing to empty', async () => {
      const state = lazyState()
      state.redactionMessage = t('redactRecoveredFromNames')
      const ref = { current: state }
      const worksheet = makeWorksheet()
      const runtime = makeRuntime(worksheet)
      const setMessage = (message: string) => messages.push(message)
      reads = [rangeResult(true)]

      await loadVisibleRange(runtime as never, ref, worksheet as never, setMessage)

      expect(messages.at(-1)).toBe(t('redactRecoveredFromNames'))
    })
  })
})
