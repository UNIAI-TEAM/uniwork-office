// @vitest-environment jsdom
/**
 * UNI-1922 (G7-08 X-E1): AI and UI plan writes whose targets lie outside the
 * sheet's current grid (default 1000 rows × 26 columns for A..G sheets) must:
 *   - NOT mutate the workbook at propose time (a rejected or unapplied batch
 *     leaves getMaxColumns() / getMaxRows() unchanged; cells outside the
 *     current grid but inside MAX_GRID_* read as empty during planning),
 *   - grow the worksheet grid at apply time inside beginUndoBatch (via raw
 *     set-worksheet-column-count / -row-count mutations, clamped to
 *     MAX_GRID_COLUMNS / MAX_GRID_ROWS) so the batch lands as one undo step,
 *   - refuse targets beyond MAX_GRID_* with a clear English message,
 *   - round-trip through the xlsx save + desktop open skeleton path with
 *     <dimension> covering the written cells and columnCount >= 27.
 */
import {
  IUndoRedoService,
  IUniverInstanceService,
  LocaleType,
  LogLevel,
  RANGE_TYPE,
  Univer,
} from '@univerjs/core'
import { FUniver } from '@univerjs/core/lib/facade'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { columnIndex, parseAddress } from '@genoffice/xlsx-gateway/domain/cell-address'
import { InMemoryWorkbookAdapter } from '@genoffice/xlsx-gateway/domain/in-memory-workbook'
import type { WorkbookOperation } from '@genoffice/xlsx-gateway/domain/workbook-dsl'
import type { ChangePlan } from '@genoffice/xlsx-gateway/domain/workbook.types'
import {
  applyCellEditsToXlsx,
  MAX_GRID_COLUMNS,
  MAX_GRID_ROWS,
  type CellEdit,
} from '@genoffice/xlsx-gateway/gateway/xlsx-gateway'
import { anchorTileExpansion } from '../src/renderer/clipboard-anchor-tile'
import { createEditJournal, recordSetRangeValues, toSaveEdits } from '../src/renderer/edit-journal'
import { applyChangePlan, planFromOps, type OpExecutorContext } from '../src/renderer/op-executor'
import type { PivotActionContext } from '../src/renderer/pivot-actions'
import { proposeOperations, type PlanContext } from '../src/renderer/plan-operations'
import { UNPROTECTED_SHEET } from '../src/renderer/sheet-protection'
import type { LazyWorkbookState, UniverRuntime } from '../src/renderer/univer-state'
import { loadWorkbookSkeleton, MINIMUM_SHEET_COLUMN_COUNT } from '../src/renderer/univer-sync'
import type { VisualActionContext } from '../src/renderer/visual-actions'
import { buildStructureFixture } from './fixture-builder'

const UNIT_ID = 'sgrid-w2-unit'
const SHEET_ID = 'sgrid-w2-sheet'
const SHEET_NAME = 'Data'

function bootWorkbook(rowCount = 1000, columnCount = 26) {
  const univer = new Univer({
    logLevel: LogLevel.SILENT,
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: {} },
  })
  univer.registerPlugin(UniverRenderEnginePlugin)
  univer.registerPlugin(UniverSheetsPlugin)
  const univerAPI = FUniver.newAPI(univer)
  univerAPI.createWorkbook({
    id: UNIT_ID,
    name: 'book.xlsx',
    sheetOrder: [SHEET_ID],
    sheets: {
      [SHEET_ID]: {
        id: SHEET_ID,
        name: SHEET_NAME,
        rowCount,
        columnCount,
      },
    },
  })
  const injector = univer.__getInjector()
  injector.get(IUniverInstanceService).focusUnit(UNIT_ID)
  const undoRedoService = injector.get(IUndoRedoService)
  const workbook = univerAPI.getActiveWorkbook()!
  const worksheet = workbook.getActiveSheet()!
  const runtime = { univer, univerAPI } as unknown as UniverRuntime

  const state: LazyWorkbookState = {
    file: {
      sessionId: 'sgrid-session',
      path: '/tmp/book.xlsx',
      name: 'book.xlsx',
      sha256: 'sgrid-sha',
      styles: [],
      definedNames: [],
      visuals: [],
      sheets: [
        {
          id: SHEET_ID,
          name: SHEET_NAME,
          rowCount: 10,
          columnCount: 7,
          hidden: false,
          showGridLines: true,
          tabColor: null,
          defaultRowHeight: null,
          defaultColumnWidth: null,
          freeze: null,
          columnWidths: [],
          tables: [],
          pivotTables: [],
          pivotRanges: [],
          sparklines: [],
          comments: [],
        },
      ],
    },
    generation: 1,
    loadedRanges: new Map([
      [SHEET_ID, { startRow: 0, endRow: rowCount - 1, startColumn: 0, endColumn: columnCount - 1 }],
    ]),
    streamAliases: new Map(),
    loadingKeys: new Map(),
    retryTimers: new Map(),
    appliedMerges: new Map(),
    appliedRowKeys: new Map(),
    measuredWrapRows: new Map(),
    rowColStyleKeys: new Map(),
    appliedCfSheets: new Set([SHEET_ID]),
    appliedFilterSheets: new Set([SHEET_ID]),
    appliedDvSheets: new Set([SHEET_ID]),
    decorationsPendingSheets: new Set(),
    sheetProtections: new Map([[SHEET_ID, UNPROTECTED_SHEET]]),
    sheetPageBreaks: new Map(),
    sheetFilePageSetups: new Map(),
    sheetProtectedRanges: new Map([[SHEET_ID, []]]),
    uninstalledDefinedNames: new Set(),
    hyperlinkTargets: new Map(),
    frozenStripKeys: new Map(),
    filterOrigins: new Map(),
    restoredFilterSpans: new Map(),
    showFormulaSheets: new Set(),
    formulaMode: true,
    editJournal: createEditJournal(),
    flags: { preloadComplete: true, preloadRunning: false },
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

  const lazyWorkbookRef = { current: state as LazyWorkbookState | null }
  const lazyPreviewRef = {
    current: null as { sessionId: string; sheetId: string; plan: ChangePlan } | null,
  }
  const emptyVisualContext = {} as VisualActionContext
  const emptyPivotContext = {} as PivotActionContext
  const execCtx: OpExecutorContext = {
    runtime,
    workbook,
    state,
    lazyWorkbookRef,
    sparklineDisposablesRef: { current: [] },
    sparklineTimerRef: { current: null },
    shapeEditRef: { current: () => {} },
    chartEditRef: { current: () => {} },
    setMessage: () => {},
    setPendingEdits: () => {},
    visualContext: () => emptyVisualContext,
    pivotContext: () => emptyPivotContext,
    queueChartDataSync: () => {},
  }

  /** Proposes without auto-applying so the test can inspect post-propose grid size before apply. */
  function proposeOnly(ops: readonly WorkbookOperation[], summary = 'test') {
    const planCtx: PlanContext = {
      adapterRef: { current: new InMemoryWorkbookAdapter({ revision: 0, sheets: [] }) },
      univerRef: { current: runtime },
      lazyWorkbookRef,
      lazyPreviewRef,
      setPreview: () => {},
      autoApplySafePlan: async () => ({ ok: true }),
    }
    return proposeOperations(planCtx, ops, summary)
  }

  // Univer's LocalUndoRedoService stores per-unit stacks in _undoStacks
  const undoStacks = undoRedoService as unknown as { _undoStacks: Map<string, unknown[]> }

  function undoDepth(): number {
    return undoStacks._undoStacks.get(UNIT_ID)?.length ?? 0
  }

  return {
    runtime,
    univerAPI,
    workbook,
    worksheet,
    state,
    execCtx,
    proposeOnly,
    apply: (plan: ChangePlan) => applyChangePlan(plan, execCtx),
    undoDepth,
  }
}

describe('UNI-1922: AI write past the current sheet grid grows the grid on apply', () => {
  it('case 1: set_range AA2:AA7 and set_formula AA1 on a 1000×26 sheet keep 26 cols at propose, grow on apply, and undo in one step', async () => {
    const { univerAPI, worksheet, proposeOnly, apply, undoDepth } = bootWorkbook(1000, 26)
    worksheet.getRange('A2').setValue(10)
    worksheet.getRange('B2').setValue(3)
    const undoBefore = undoDepth()

    const proposed = proposeOnly([
      {
        op: 'set_formula',
        sheetId: SHEET_ID,
        address: 'AA1',
        formula: '=SUM(AA2:AA7)',
      },
      {
        op: 'set_range',
        sheetId: SHEET_ID,
        range: 'AA2:AA7',
        values: [[30], [40], [50], [60], [70], [80]],
      },
    ])
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    // D2: propose must NOT mutate the workbook grid
    expect(worksheet.getMaxColumns()).toBe(26)
    expect(undoDepth()).toBe(undoBefore)

    const outcome = await apply(proposed.plan)
    expect(outcome).toEqual({ ok: true })
    expect(worksheet.getMaxColumns()).toBeGreaterThanOrEqual(27)
    expect(worksheet.getRange('AA1').getFormula()).toBe('=SUM(AA2:AA7)')
    expect(worksheet.getRange('AA2').getValue()).toBe(30)
    expect(worksheet.getRange('AA7').getValue()).toBe(80)
    // D3: exactly one undo entry for the batch (growth pushed no undo item)
    expect(undoDepth()).toBe(undoBefore + 1)

    await univerAPI.undo()
    expect(undoDepth()).toBe(undoBefore)
    expect(worksheet.getRange('AA1').getFormula()).toBeFalsy()
    expect(worksheet.getRange('AA2').getValue()).toBeNull()
    expect(worksheet.getRange('AA7').getValue()).toBeNull()
  })

  it('case 2: fill_range and copy_range targeting column AA propose cleanly and apply (not refused as beyond grid)', async () => {
    const { worksheet, proposeOnly, apply } = bootWorkbook(1000, 26)
    worksheet.getRange('A2').setValue(7)
    worksheet.getRange('B2').setValue(11)

    const fillProposed = proposeOnly([
      {
        op: 'fill_range',
        sheetId: SHEET_ID,
        source: 'A2',
        target: 'A2:AA2',
      },
    ])
    expect(fillProposed.ok).toBe(true)
    if (!fillProposed.ok) return
    expect(worksheet.getMaxColumns()).toBe(26)
    expect(await apply(fillProposed.plan)).toEqual({ ok: true })
    expect(worksheet.getMaxColumns()).toBeGreaterThanOrEqual(27)
    expect(worksheet.getRange('AA2').getValue()).toBe(7)

    const copyHolder = bootWorkbook(1000, 26)
    copyHolder.worksheet.getRange('A2').setValue(42)
    const copyProposed = copyHolder.proposeOnly([
      {
        op: 'copy_range',
        sheetId: SHEET_ID,
        source: 'A2:A2',
        target: 'AA2',
      },
    ])
    expect(copyProposed.ok).toBe(true)
    if (!copyProposed.ok) return
    expect(copyHolder.worksheet.getMaxColumns()).toBe(26)
    expect(await copyHolder.apply(copyProposed.plan)).toEqual({ ok: true })
    expect(copyHolder.worksheet.getMaxColumns()).toBeGreaterThanOrEqual(27)
    expect(copyHolder.worksheet.getRange('AA2').getValue()).toBe(42)
  })

  it('case 3: format_range AA1:AA5 and merge_cells AA6:AB7 grow the grid and apply without throwing', async () => {
    const { workbook, worksheet, proposeOnly, apply } = bootWorkbook(1000, 26)

    const proposed = proposeOnly([
      {
        op: 'format_range',
        sheetId: SHEET_ID,
        range: 'AA1:AA5',
        format: { bold: true, fillColor: '#FFEECC' },
      },
      {
        op: 'merge_cells',
        sheetId: SHEET_ID,
        range: 'AA6:AB7',
      },
    ])
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    expect(worksheet.getMaxColumns()).toBe(26)

    expect(await apply(proposed.plan)).toEqual({ ok: true })
    expect(worksheet.getMaxColumns()).toBeGreaterThanOrEqual(28)
    const aa1Cell = worksheet.getRange('AA1').getCellDatas()[0]?.[0]
    const aa1Style = workbook.getWorkbook().getStyles().getStyleByCell(aa1Cell)
    expect(aa1Style?.bl).toBe(1)
    expect(worksheet.getRange('AA6:AB7').isMerged()).toBe(true)
  })

  it('case 4: row growth — set_cell A1001 on a 1000-row sheet grows getMaxRows() to >= 1001 on apply (including via planFromOps)', async () => {
    const { workbook, worksheet, proposeOnly, apply } = bootWorkbook(1000, 26)

    const proposed = proposeOnly([
      {
        op: 'set_cell',
        sheetId: SHEET_ID,
        address: 'A1001',
        value: 'row-1001',
      },
    ])
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    expect(worksheet.getMaxRows()).toBe(1000)

    expect(await apply(proposed.plan)).toEqual({ ok: true })
    expect(worksheet.getMaxRows()).toBeGreaterThanOrEqual(1001)
    expect(worksheet.getRange('A1001').getValue()).toBe('row-1001')

    // Ribbon / direct planFromOps path also grows on apply without prior propose
    const uiPlan = planFromOps(
      [{ op: 'set_cell', sheetId: SHEET_ID, address: 'AB1005', value: 'from-ui' }],
      workbook,
      'ui write',
    )
    expect(worksheet.getMaxColumns()).toBe(26)
    expect(await apply(uiPlan)).toEqual({ ok: true })
    expect(worksheet.getMaxRows()).toBeGreaterThanOrEqual(1005)
    expect(worksheet.getMaxColumns()).toBeGreaterThanOrEqual(28)
    expect(worksheet.getRange('AB1005').getValue()).toBe('from-ui')
  })

  it('case 5: a rejected batch (valid AA op + invalid op) leaves getMaxColumns() at 26', () => {
    const { worksheet, proposeOnly } = bootWorkbook(1000, 26)

    // Mixed batch: valid AA write followed by unknown sheet op -> rejected byUnknown sheet, not FRange
    const unknownSheet = proposeOnly([
      { op: 'set_cell', sheetId: SHEET_ID, address: 'AA2', value: 99 },
      { op: 'set_cell', sheetId: 'no-such-sheet', address: 'A1', value: 1 },
    ])
    expect(unknownSheet.ok).toBe(false)
    if (!unknownSheet.ok) {
      expect(unknownSheet.error).toMatch(/Unknown sheet: no-such-sheet/)
    }
    expect(worksheet.getMaxColumns()).toBe(26)

    // Standalone insert_cols anchored past the current 26-col grid stays refused
    const badInsert = proposeOnly([
      { op: 'insert_cols', sheetId: SHEET_ID, column: 'AA', count: 1 },
    ])
    expect(badInsert.ok).toBe(false)
    if (!badInsert.ok) {
      expect(badInsert.error).toMatch(/insert_cols.*beyond the sheet grid/i)
    }
    expect(worksheet.getMaxColumns()).toBe(26)
  })

  it('case 6: targets beyond MAX_GRID (row 1048577 or column XFE, or copy_range overhanging XFD) stay refused with a clear English message', () => {
    const { worksheet, proposeOnly } = bootWorkbook(1000, 26)

    const pastMaxRow = proposeOnly([
      { op: 'set_cell', sheetId: SHEET_ID, address: 'A1048577', value: 1 },
    ])
    expect(pastMaxRow.ok).toBe(false)
    if (!pastMaxRow.ok) {
      expect(pastMaxRow.error).toMatch(/grid|XFD1048576/i)
    }

    const pastMaxCol = proposeOnly([
      { op: 'set_cell', sheetId: SHEET_ID, address: 'XFE1', value: 1 },
    ])
    expect(pastMaxCol.ok).toBe(false)
    if (!pastMaxCol.ok) {
      expect(pastMaxCol.error).toMatch(/grid|XFD1048576/i)
    }

    // copy_range whose single-cell target anchor is XFD1 (valid schema address)
    // but whose 2-column source overhangs past XFD (endColumn = 16384 >= MAX_GRID_COLUMNS)
    const overhangCopy = proposeOnly([
      {
        op: 'copy_range',
        sheetId: SHEET_ID,
        source: 'A1:B1',
        target: 'XFD1',
      },
    ])
    expect(overhangCopy.ok).toBe(false)
    if (!overhangCopy.ok) {
      expect(overhangCopy.error).toMatch(/extends beyond.*grid/i)
    }
    expect(worksheet.getMaxColumns()).toBe(26)
  })

  it('case 7: save round-trip — applying AA writes updates saved <dimension> to cover AA and reopens with columnCount >= 27', async () => {
    const { worksheet, state, proposeOnly, apply } = bootWorkbook(1000, 26)

    const proposed = proposeOnly([
      {
        op: 'set_range',
        sheetId: SHEET_ID,
        range: 'AA2:AA3',
        values: [[123], [456]],
      },
    ])
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    expect(await apply(proposed.plan)).toEqual({ ok: true })

    // Record the applied AA2:AA3 cell values into the edit journal (mirroring App.tsx:2986)
    recordSetRangeValues(state.editJournal, SHEET_ID, {
      1: { 26: { v: worksheet.getRange('AA2').getValue() } },
      2: { 26: { v: worksheet.getRange('AA3').getValue() } },
    })
    const saveEdits: CellEdit[] = toSaveEdits(state.editJournal).map((entry) => ({
      sheetName: SHEET_NAME,
      row: entry.row,
      column: entry.column,
      writeValue: entry.writeValue,
      cell: { value: entry.value, ...(entry.formula ? { formula: entry.formula } : {}) },
    }))
    expect(saveEdits).toHaveLength(2)

    // Save against a fixture whose initial <dimension ref="A1:D10"/> is narrower than AA
    const sourceBytes = await buildStructureFixture()
    const mutation = await applyCellEditsToXlsx(sourceBytes, saveEdits)
    const savedZip = await JSZip.loadAsync(mutation.buffer)
    const sheetXml = await savedZip.file('xl/worksheets/sheet1.xml')!.async('string')

    // Saved worksheet XML contains the AA cells and a <dimension> covering AA
    expect(sheetXml).toContain('<c r="AA2"><v>123</v></c>')
    expect(sheetXml).toContain('<c r="AA3"><v>456</v></c>')
    const dimMatch = /<dimension\b[^>]*\bref="([^"]+)"/.exec(sheetXml)
    expect(dimMatch?.[1]).toBe('A1:AA10')

    // Reopen through the sidecar dimension rule (workbook.rs:423-428) + loadWorkbookSkeleton
    const [, endRef = 'A1'] = dimMatch![1]!.split(':')
    const dimEnd = parseAddress(endRef)
    let maxCellRow = 0
    let maxCellCol = 0
    for (const m of sheetXml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"/g)) {
      const addr = parseAddress(m[1]!)
      maxCellRow = Math.max(maxCellRow, addr.row)
      maxCellCol = Math.max(maxCellCol, addr.column)
    }
    const sidecarRowCount = Math.max(
      dimEnd.row + 1 < MAX_GRID_ROWS ? dimEnd.row + 1 : 0,
      maxCellRow + 1,
    )
    const sidecarColumnCount = Math.max(
      dimEnd.column + 1 < MAX_GRID_COLUMNS ? dimEnd.column + 1 : 0,
      maxCellCol + 1,
    )
    expect(sidecarColumnCount).toBe(columnIndex('AA') + 1)

    const reopenedHolder = bootWorkbook(1000, MINIMUM_SHEET_COLUMN_COUNT)
    loadWorkbookSkeleton(reopenedHolder.runtime, {
      ...state.file,
      sha256: 'reopened-sha',
      sheets: [
        {
          ...state.file.sheets[0]!,
          rowCount: sidecarRowCount,
          columnCount: sidecarColumnCount,
        },
      ],
    })
    const reopenedSheet = reopenedHolder.univerAPI.getActiveWorkbook()!.getSheetBySheetId(SHEET_ID)!
    expect(reopenedSheet.getMaxColumns()).toBeGreaterThanOrEqual(27)
    // And the grown grid accepts reading/writing AA2 without throwing FRange out-of-bounds
    reopenedSheet.getRange('AA2').setValue(123)
    expect(reopenedSheet.getRange('AA2').getValue()).toBe(123)
  })

  it('case 8 (D6): anchorTileExpansion allows repeat-paste tiling past the current 26-col grid up to MAX_GRID', () => {
    // Selecting Z2:Z5 (col 25, 4 rows) and pasting a 1×2 source (2 columns wide)
    // expands to Z2:AA5 (cols 25..26), which crosses column Z into AA; only MAX_GRID caps it.
    const acrossZ = anchorTileExpansion(
      { startRow: 1, endRow: 4, startColumn: 25, endColumn: 25 },
      1,
      2,
      { rowCount: MAX_GRID_ROWS, columnCount: MAX_GRID_COLUMNS },
    )
    expect(acrossZ).toEqual({
      startRow: 1,
      endRow: 4,
      startColumn: 25,
      endColumn: 26,
      rangeType: RANGE_TYPE.NORMAL,
    })
  })
})
