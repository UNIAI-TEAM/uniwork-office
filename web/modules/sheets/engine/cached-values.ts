/**
 * Cached values for the formulas a save writes (UNI-1016 SH3, UNI-1232 A2).
 *
 * A formula typed into a streamed workbook (one too big for Univer's own formula closure) is
 * saved with its text but no cached `<v>`: the renderer computes nothing for it, and on the
 * desktop the IronCalc recalc fallback paints the value after the reopen. On the web that
 * fallback stays hidden as a UI operation (CONTRACT C11), so without this the reopened cell
 * would show blank. The same holds for every formula that depends on a cell the save edits: its
 * old `<v>` must not be written back (stale-values.ts). At save time the transport asks the wasm
 * engine's `recalc_cells` (IronCalc) for every formula cell of the file and hands the results to
 * the gateway as `formulaValues`, which writes them into `<v>` next to the untouched `<f>`.
 * Never run on an autosave (there is none, CONTRACT C10): only on an explicit save.
 *
 * Fail-soft like the desktop fallback: anything that stops the recalc (too big, busy, a sheet
 * with no file part, an IronCalc import error) drops the cached values instead (the sweep of
 * stale-values.ts). Only an engine crash is rethrown by the engine call, because the sessions are
 * gone; the transport then sweeps.
 */
import type { WorkbookSaveRequest } from '../../../../apps/sheets/src/shared/desktop-api'
import { engineCanReplaySave } from './stale-values'

type SaveEdit = WorkbookSaveRequest['edits'][number]
type FormulaValue = WorkbookSaveRequest['formulaValues'][number]

/** the engine's own limits (recalc.rs MAX_RECALC_EDITS / MAX_RECALC_READ_CELLS) */
export const RECALC_MAX_EDITS = 10_000
export const RECALC_MAX_READ_CELLS = 20_000
/** a cold IronCalc import costs ~460 bytes per grid cell: the desktop caps the file at 64 MB */
export const RECALC_MAX_FILE_BYTES = 64 * 1024 * 1024

interface RecalcRequestEdit {
  sheet: string
  row: number
  column: number
  input: string
}

interface RecalcResponseCell {
  sheet: string
  row: number
  column: number
  formatted: string
  number?: number
  isError?: boolean
  isFormula: boolean
}

/** the renderer's toRecalcUserInput: formulas verbatim, text guarded against reinterpretation */
export function recalcInput(edit: SaveEdit): string {
  if (edit.formula) return edit.formula
  const { value } = edit
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return String(value)
  return value.startsWith('=') || value.startsWith("'") ? `'${value}` : value
}

/** recalc reads per engine call (recalc.rs MAX_RECALC_READ_CELLS), and the formulas one save refreshes */
export const REFRESH_MAX_FORMULAS = 200_000

export interface RefreshPlan {
  /** the save's cell edits, replayed in the engine's model */
  edits: RecalcRequestEdit[]
  /** every formula cell of the file (plus the typed ones), in engine calls of <= 20 000 reads */
  batches: { sheet: string; range: object }[][]
  /** the cells the user typed this session: their errors are real, an untouched cell's are not trusted */
  edited: Set<string>
  /** every cell the refresh answers for: no result for one of them means no cached value */
  targets: { sheet: string; row: number; column: number }[]
}

const cellKey = (sheet: string, row: number, column: number) => `${sheet}\u0000${row}:${column}`

/**
 * The recalc plan that refreshes EVERY formula cell of the saved file (stale-values.ts rule 1), or
 * null when the engine cannot: it cannot replay the save, the file or the edit list is above the
 * engine's limits, or a typed cell sits on a sheet the engine does not know.
 * `fileFormulas` are the formula cells of the source file by sheet name (0-based).
 */
export function planRefresh(
  request: WorkbookSaveRequest,
  sheetNames: ReadonlyMap<string, string>,
  fileBytes: number,
  fileFormulas: ReadonlyMap<string, readonly { row: number; column: number }[]>,
): RefreshPlan | null {
  if (fileBytes > RECALC_MAX_FILE_BYTES) return null
  if (!engineCanReplaySave(request)) return null
  const edits: RecalcRequestEdit[] = []
  const edited = new Set<string>()
  const targets = new Map<string, { sheet: string; row: number; column: number }>()
  for (const edit of request.edits) {
    if (!edit.formula && !edit.writeValue) continue
    const sheet = sheetNames.get(edit.sheetId)
    if (sheet === undefined) return null
    edits.push({ sheet, row: edit.row, column: edit.column, input: recalcInput(edit) })
    if (edit.formula) {
      edited.add(cellKey(sheet, edit.row, edit.column))
      targets.set(cellKey(sheet, edit.row, edit.column), {
        sheet,
        row: edit.row,
        column: edit.column,
      })
    }
  }
  if (edits.length > RECALC_MAX_EDITS) return null
  for (const [sheet, cells] of fileFormulas) {
    for (const { row, column } of cells) {
      const key = cellKey(sheet, row, column)
      if (!targets.has(key)) targets.set(key, { sheet, row, column })
    }
  }
  if (targets.size > REFRESH_MAX_FORMULAS) return null
  const list = [...targets.values()]
  const batches: RefreshPlan['batches'] = []
  for (let i = 0; i < list.length; i += RECALC_MAX_READ_CELLS) {
    batches.push(
      list.slice(i, i + RECALC_MAX_READ_CELLS).map(({ sheet, row, column }) => ({
        sheet,
        range: { startRow: row, endRow: row, startColumn: column, endColumn: column },
      })),
    )
  }
  return { edits, batches, edited, targets: list }
}

/**
 * The gateway's formulaValues for a refresh: the engine's result for every target, `null` (the
 * cached value is dropped) for a target it could not answer, and for an error on a formula the
 * user did not type (IronCalc may lack the function; Excel recomputes on open).
 */
export function refreshFormulaValues(
  plan: Pick<RefreshPlan, 'edited' | 'targets'>,
  cells: readonly RecalcResponseCell[],
  sheetNames: ReadonlyMap<string, string>,
): FormulaValue[] {
  const idsByName = new Map([...sheetNames].map(([id, name]) => [name, id]))
  const results = new Map(cells.map((cell) => [cellKey(cell.sheet, cell.row, cell.column), cell]))
  const values: FormulaValue[] = []
  for (const target of plan.targets) {
    const sheetId = idsByName.get(target.sheet)
    if (sheetId === undefined) continue
    const key = cellKey(target.sheet, target.row, target.column)
    const cell = results.get(key)
    const typed = plan.edited.has(key)
    let value: FormulaValue['value'] = null
    if (cell?.isFormula && cell.formatted !== '#ERROR!') {
      if (!cell.isError) value = cell.number ?? cell.formatted
      else if (typed) value = { error: cell.formatted.slice(0, 32) }
    } else if (typed) {
      // as before: a typed formula the engine failed on saves without a cached value
      continue
    }
    values.push({ sheetId, row: target.row, column: target.column, value })
  }
  return values
}
