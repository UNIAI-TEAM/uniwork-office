/// A filtered Excel table, opened the way the app opens it (real wasm engine ->
/// WorkbookFile -> Univer skeleton -> table registration -> range load with the
/// open-time hidden rows), then filtered from the header dropdown. The command is
/// the one the dropdown runs, so the table plugin's own model drives the grid.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { LocaleType, LogLevel, Univer } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter'
import { UniverSheetsTablePlugin } from '@univerjs/sheets-table'
import '@univerjs/sheets-table/facade'
import tableLocale from '@univerjs/sheets-table/locale/en-US'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDirectChannel } from '../../../web/modules/sheets/engine/channel'
import { EngineHost } from '../../../web/modules/sheets/engine/host'
import { createWasmTransport } from '../../../web/modules/sheets/engine/wasm-transport'
import { TABLE_FILTER_COMMAND, TABLE_FILTER_MUTATION } from '../src/renderer/app-constants'
import { createEditJournal, journalSize, toSaveStructuralOps } from '../src/renderer/edit-journal'
import type { WorkbookFile, WorkbookSaveRequest } from '../src/shared/desktop-api'
import type { LazyWorkbookState, UniverRuntime } from '../src/renderer/univer-state'
import {
  clearSheetTableFilters,
  collectFilterStates,
  journalTableFilterMutation,
  loadVisibleRange,
  loadWorkbookSkeleton,
  registerFileTables,
} from '../src/renderer/univer-sync'

const repoRoot = resolve(__dirname, '../../..')
const WASM = resolve(repoRoot, 'apps/sheets/native/xlsx-engine/wasm/dist/xlsx-sidecar.wasm')
/// Table1 A1:C7 filtered to North / East / Central (rows 3, 5, 7 hidden in the file).
const FIXTURE = resolve(__dirname, 'fixtures/w4-table-filter-x14-list-combo.xlsx')
const TABLE_ID = 'file-table-sheet-1-0'

type Transport = ReturnType<typeof createWasmTransport>

function lazyState(file: WorkbookFile): LazyWorkbookState {
  // The literal App.tsx builds when it opens a file (formula mode, no engine budget).
  return {
    file,
    generation: Date.now(),
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
    formulaMode: true,
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

function saveRequest(
  file: WorkbookFile,
  state: LazyWorkbookState,
  runtime: UniverRuntime,
): WorkbookSaveRequest {
  return {
    sessionId: file.sessionId,
    mode: 'save',
    edits: [],
    structuralOps: toSaveStructuralOps(state.editJournal),
    chartEdits: [],
    visualEdits: [],
    visualAdditions: [],
    tableAdditions: [],
    pivotAdditions: [],
    sheetOps: [],
    sheetOrder: [],
    filterStates: collectFilterStates(runtime, state),
    hyperlinkEdits: [],
    cfStates: [],
    dvStates: [],
    pageSetupStates: [],
    noteStates: [],
    pivotCacheRefreshPaths: [],
    pivotRefreshUpdates: [],
    sheetProtections: [],
    sparklineAdditions: [],
    formulaValues: [],
    definedNamesState: null,
    themeState: null,
    workbookProtectionState: null,
    protectedRangeStates: [],
  } as unknown as WorkbookSaveRequest
}

/// 1-based worksheet rows the saved sheet part marks hidden.
function hiddenRowNumbers(sheetXml: string): number[] {
  return [...sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*\bhidden="1"/g)].map((match) =>
    Number(match[1]),
  )
}

describe.skipIf(!existsSync(WASM))(
  'a filtered table opened from a file, then filtered from its header dropdown',
  { timeout: 60_000 },
  () => {
    let transport: Transport
    let univer: Univer
    let api: FUniver
    let runtime: UniverRuntime
    let file: WorkbookFile
    let state: LazyWorkbookState
    let pending = 0
    let unitId = ''
    const mutationParams: unknown[] = []

    beforeAll(async () => {
      const host = await EngineHost.create(new WebAssembly.Module(readFileSync(WASM)))
      transport = createWasmTransport({ connect: () => createDirectChannel(host) })
      const bytes = readFileSync(FIXTURE)
      file = await transport.open({
        name: 'w4.xlsx',
        data: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
        locale: 'en',
      })
      vi.stubGlobal('window', {
        desktopApi: {
          readWorkbookRange: (request: never) => transport.readRange(request),
          readWorkbookFormulas: (request: never) => transport.readFormulaCells(request),
        },
      })
      univer = new Univer({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: tableLocale },
        logLevel: LogLevel.ERROR,
      })
      univer.registerPlugin(UniverFormulaEnginePlugin)
      univer.registerPlugin(UniverSheetsPlugin)
      univer.registerPlugin(UniverSheetsFilterPlugin)
      univer.registerPlugin(UniverSheetsTablePlugin)
      api = FUniver.newAPI(univer)
      runtime = { univer, univerAPI: api } as unknown as UniverRuntime
      state = lazyState(file)
      loadWorkbookSkeleton(runtime, file)
      const workbook = api.getActiveWorkbook()!
      unitId = workbook.getId()
      await Promise.all(registerFileTables(workbook, file, []))
      // The App's journal listener, reduced to the table filter wiring.
      api.addEvent(api.Event.CommandExecuted, (event) => {
        if (event.id !== TABLE_FILTER_MUTATION) return
        mutationParams.push(event.params)
        if (journalTableFilterMutation(runtime, state, event.params)) {
          pending = journalSize(state.editJournal)
        }
      })
      await loadVisibleRange(
        runtime,
        { current: state },
        workbook.getActiveSheet()!,
        () => undefined,
      )
    }, 60_000)

    afterAll(() => {
      univer.dispose()
      vi.unstubAllGlobals()
    })

    const sheet = () => api.getActiveWorkbook()!.getActiveSheet()!.getSheet()

    it('opens with the file filter hidden rows and a clean journal', () => {
      expect(state.filterOrigins.get('sheet-1')?.origin).toBe('table')
      // South, West, Coast: rows 3, 5, 7 of the file.
      expect([...(state.hiddenFileRows.get('sheet-1') ?? [])].sort()).toEqual([2, 4, 6])
      expect([0, 1, 2, 3, 4, 5, 6].map((row) => sheet().getRowRawVisible(row))).toEqual([
        true,
        true,
        false,
        true,
        false,
        true,
        false,
      ])
      expect(journalSize(state.editJournal)).toBe(0)
    })

    it('journals a header dropdown filter with no prior Clear, and saves exactly the East rows', async () => {
      api.syncExecuteCommand(TABLE_FILTER_COMMAND, {
        unitId,
        tableId: TABLE_ID,
        column: 0,
        tableFilter: { filterType: 'manual', values: ['East'] },
      })
      // SH-W4-V1: the mutation names a table, not a sheet, so it carries no subUnitId.
      expect(mutationParams[0]).not.toHaveProperty('subUnitId')
      expect(state.editJournal.filterDirty.has('sheet-1')).toBe(true)
      expect(pending).toBeGreaterThan(0)
      // The open-time hidden rows are released by the table model, never journaled as
      // a user unhide (it would replay at save as a manual "show rows").
      expect(state.hiddenFileRows.get('sheet-1')?.size).toBe(0)
      expect(toSaveStructuralOps(state.editJournal)).toEqual([])

      const saved = await transport.serialize(saveRequest(file, state, runtime))
      const zip = await JSZip.loadAsync(saved.data)
      const table = await zip.file('xl/tables/table1.xml')!.async('text')
      expect(table).toContain(
        '<autoFilter ref="A1:C7"><filterColumn colId="0"><filters><filter val="East"/></filters>',
      )
      // SH-W4-V8: everything but East (row 4), including the FIRST data row (row 2, North).
      const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('text')
      expect(hiddenRowNumbers(sheetXml)).toEqual([2, 3, 5, 6, 7])
    })

    it('Clear releases the rows and saves a bare table autoFilter with every row visible', async () => {
      clearSheetTableFilters(runtime, state, 'sheet-1')
      const saved = await transport.serialize(saveRequest(file, state, runtime))
      const zip = await JSZip.loadAsync(saved.data)
      const table = await zip.file('xl/tables/table1.xml')!.async('text')
      expect(table).toContain('<autoFilter ref="A1:C7"/>')
      expect(table).not.toContain('<filterColumn')
      const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('text')
      expect(hiddenRowNumbers(sheetXml)).toEqual([])
    })
  },
)

describe('the App journal listener', () => {
  it('handles a table filter mutation before its generic subUnitId guard', () => {
    // The listener is a closure inside App's effect, so its ORDER is checked in source:
    // set-table-filter carries no subUnitId, and the guard dropped every dropdown edit.
    const source = readFileSync(resolve(__dirname, '../src/renderer/App.tsx'), 'utf8')
    const branch = source.indexOf('if (event.id === TABLE_FILTER_MUTATION) {')
    const guard = source.indexOf('if (!params.subUnitId) return\n        if (axisAttr)')
    expect(branch).toBeGreaterThan(0)
    expect(guard).toBeGreaterThan(0)
    expect(branch).toBeLessThan(guard)
  })
})
