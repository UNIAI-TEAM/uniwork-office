/**
 * Row-wise reads for summarize_range: every row of a range with its values,
 * its hidden/filtered state and, per cell, whether the value is a formula's
 * cached file result. Streamed workbooks are read through the sidecar in
 * batches (file values) overlaid with this session's fills and edits, the
 * same sources aggregate_range uses.
 */
import { formatAddress, type RangeBounds } from '@genoffice/xlsx-gateway/domain/cell-address'
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'

import { plainCellValue } from '../edit-journal'
import { fillSegmentAt, prepareLazyRange } from './aggregate-range'
import { sessionHasInputEdits } from './cell-read'
import { placeholderSource } from './redact'
import { redactionsOf, rowVisibilityProbe, type WorkbookReadContext } from './workbook-readers'

export interface RangeRow {
  readonly row: number
  /** hidden by hand / by the file, or filtered out */
  readonly hidden: boolean
  /** one value per column of the range */
  readonly values: CellScalar[]
  /** per column: the value is a formula's cached file result (lazy only) */
  readonly cached?: boolean[]
  /** per column: formula text with a leading '=', when the cell holds one */
  readonly formulas?: (string | undefined)[]
  /** per column: the cell is withheld from the model */
  readonly withheld?: boolean[]
}

export type RangeRowsOutcome =
  | {
      ok: true
      rows: RangeRow[]
      /** this session edited something formulas read, so cached values may be stale */
      staleInputs?: boolean
    }
  | { ok: false; error: string }

const withEquals = (formula: string): string => (formula.startsWith('=') ? formula : `=${formula}`)

/** Cells read per sidecar batch (aggregate_range uses the same budget). */
const BATCH_CELLS = 18_000

export async function collectWorkbookRows(
  ctx: WorkbookReadContext,
  sheetIdArg: string | undefined,
  bounds: RangeBounds,
): Promise<RangeRowsOutcome> {
  const width = bounds.endColumn - bounds.startColumn + 1
  const state = ctx.lazyWorkbookRef.current
  const redactions = redactionsOf(ctx)
  const workbook = ctx.univerRef.current?.univerAPI.getActiveWorkbook()
  const activeSheetId = workbook?.getActiveSheet()?.getSheetId()
  if (!state) {
    // Demo workbook: the snapshot holds every cell in memory.
    const snapshot = ctx.adapterRef.current.getSnapshot()
    const sheet = sheetIdArg
      ? snapshot.sheets.find((candidate) => candidate.id === sheetIdArg)
      : (snapshot.sheets.find((candidate) => candidate.id === activeSheetId) ?? snapshot.sheets[0])
    if (!sheet) {
      return {
        ok: false,
        error: sheetIdArg
          ? `Unknown sheet: ${sheetIdArg} (use an id from get_workbook_context)`
          : 'No workbook is open.',
      }
    }
    const worksheet = workbook?.getSheetBySheetId(sheet.id)
    const probe = rowVisibilityProbe(ctx, sheet.id)
    const rows: RangeRow[] = []
    for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
      const values: CellScalar[] = []
      let formulas: (string | undefined)[] | undefined
      let withheld: boolean[] | undefined
      for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
        const colIdx = column - bounds.startColumn
        const label = redactions.labelAt(sheet.id, row, column)
        if (label !== null) {
          values.push(placeholderSource(label))
          withheld ??= new Array<boolean>(width).fill(false)
          withheld[colIdx] = true
          continue
        }
        const address = formatAddress(row, column)
        const cell = sheet.cells[address]
        let value: CellScalar = cell?.value ?? null
        // Formula results live in Univer's engine, not in the snapshot.
        if (cell?.formula && value === null && worksheet) {
          try {
            const range = worksheet.getRange(address)
            const data = range.getCellDatas()[0]?.[0]
            value =
              (plainCellValue(data?.v, data?.t) as CellScalar | undefined) ??
              (range.getValue() as CellScalar | undefined) ??
              null
          } catch {
            /* fail-open: the cell reads as empty */
          }
        }
        values.push(value)
        if (cell?.formula) {
          formulas ??= new Array<string | undefined>(width).fill(undefined)
          formulas[colIdx] = withEquals(cell.formula)
        }
      }
      rows.push({
        row,
        hidden: probe?.(row) != null,
        values,
        ...(formulas ? { formulas } : {}),
        ...(withheld ? { withheld } : {}),
      })
    }
    return { ok: true, rows }
  }

  const prepared = prepareLazyRange(
    ctx,
    state,
    sheetIdArg ?? activeSheetId,
    bounds,
    'summarize_range',
  )
  if (!prepared.ok) return prepared
  const { sheetId, sheetMeta, clamped, fillBands, journalValues } = prepared
  const probe = rowVisibilityProbe(ctx, sheetId)
  const formulaIndex = state.formulaText?.get(sheetId)
  const sharedFormulas = state.sharedFormulaGroups?.get(sheetId)
  const rowCount = clamped.endRow - clamped.startRow + 1
  const values: CellScalar[][] = Array.from({ length: rowCount }, () =>
    new Array<CellScalar>(width).fill(null),
  )
  const cached: boolean[][] = Array.from({ length: rowCount }, () =>
    new Array<boolean>(width).fill(false),
  )
  const formulaTexts = new Map<number, (string | undefined)[]>()
  const setFormula = (row: number, column: number, text: string | undefined): void => {
    let rowFormulas = formulaTexts.get(row)
    if (!rowFormulas) {
      if (text === undefined) return
      rowFormulas = new Array<string | undefined>(width).fill(undefined)
      formulaTexts.set(row, rowFormulas)
    }
    rowFormulas[column - clamped.startColumn] = text === undefined ? undefined : withEquals(text)
  }
  const fileHidden = new Set<number>()
  const fileEndRow = Math.min(clamped.endRow, sheetMeta.rowCount - 1)
  const fileEndColumn = Math.min(clamped.endColumn, sheetMeta.columnCount - 1)
  if (clamped.startRow <= fileEndRow && clamped.startColumn <= fileEndColumn) {
    const batchRows = Math.max(
      1,
      Math.floor(BATCH_CELLS / (fileEndColumn - clamped.startColumn + 1)),
    )
    for (let startRow = clamped.startRow; startRow <= fileEndRow; startRow += batchRows) {
      const endRow = Math.min(startRow + batchRows - 1, fileEndRow)
      let result
      try {
        result = await window.desktopApi.readWorkbookRange({
          sessionId: state.file.sessionId,
          sheetId,
          range: { startRow, endRow, startColumn: clamped.startColumn, endColumn: fileEndColumn },
        })
      } catch (error: unknown) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to read the range.',
        }
      }
      if (result.indexedThroughRow === null || result.indexedThroughRow < endRow) {
        return {
          ok: false,
          error: 'The range is still being indexed — retry after workbook indexing completes.',
        }
      }
      for (const row of result.rows ?? []) {
        if (row.hidden && row.row >= startRow && row.row <= endRow) fileHidden.add(row.row)
      }
      for (const cell of result.cells) {
        if (
          cell.row < startRow ||
          cell.row > endRow ||
          cell.column < clamped.startColumn ||
          cell.column > fileEndColumn
        ) {
          continue
        }
        const rowValues = values[cell.row - clamped.startRow]!
        rowValues[cell.column - clamped.startColumn] = cell.value
        // The sidecar serves the file's cached <v> for formula cells.
        const formula =
          cell.formula ??
          formulaIndex?.get(`${cell.row}:${cell.column}`) ??
          sharedFormulas?.textAt(cell.row, cell.column)
        if (formula !== undefined) {
          cached[cell.row - clamped.startRow]![cell.column - clamped.startColumn] = true
          setFormula(cell.row, cell.column, formula)
        }
      }
    }
  }
  // This session's fills, then explicit edits, win over the file values.
  if (fillBands.length > 0) {
    for (let row = clamped.startRow; row <= clamped.endRow; row += 1) {
      for (let column = clamped.startColumn; column <= clamped.endColumn; column += 1) {
        const segment = fillSegmentAt(fillBands, row, column)
        if (!segment) continue
        values[row - clamped.startRow]![column - clamped.startColumn] = segment.value
        cached[row - clamped.startRow]![column - clamped.startColumn] = false
        setFormula(row, column, undefined)
      }
    }
  }
  for (const entry of journalValues.values()) {
    values[entry.row - clamped.startRow]![entry.column - clamped.startColumn] = entry.value
    cached[entry.row - clamped.startRow]![entry.column - clamped.startColumn] = false
    setFormula(entry.row, entry.column, entry.formula)
  }
  // Rows past the data extent are dropped; columns past it read as empty.
  const rows: RangeRow[] = values.map((rowValues, offset) => {
    const row = clamped.startRow + offset
    const rowCached = cached[offset]!
    let rowFormulas = formulaTexts.get(row)
    let withheld: boolean[] | undefined
    if (!redactions.isEmpty) {
      for (let colIdx = 0; colIdx < width; colIdx += 1) {
        const column = clamped.startColumn + colIdx
        const label = redactions.labelAt(sheetId, row, column)
        if (label !== null) {
          rowValues[colIdx] = placeholderSource(label)
          rowCached[colIdx] = false
          if (rowFormulas) rowFormulas[colIdx] = undefined
          withheld ??= new Array<boolean>(width).fill(false)
          withheld[colIdx] = true
        }
      }
      if (rowFormulas && rowFormulas.every((f) => f === undefined)) {
        rowFormulas = undefined
      }
    }
    return {
      row,
      hidden: fileHidden.has(row) || probe?.(row) != null,
      values: rowValues,
      cached: rowCached,
      ...(rowFormulas ? { formulas: rowFormulas } : {}),
      ...(withheld ? { withheld } : {}),
    }
  })
  return { ok: true, rows, staleInputs: sessionHasInputEdits(state.editJournal) }
}
