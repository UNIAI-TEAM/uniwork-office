/**
 * Cached values for the formulas a save writes (UNI-1016, SH3).
 *
 * A formula typed into a streamed workbook (one too big for Univer's own formula closure) is
 * saved with its text but no cached `<v>`: the renderer computes nothing for it, and on the
 * desktop the IronCalc recalc fallback paints the value after the reopen. On the web that
 * fallback stays hidden as a UI operation (CONTRACT C11), so without this the reopened cell
 * would show blank. At save time the transport asks the wasm engine's `recalc_cells` (IronCalc)
 * for the edited formula cells and hands the results to the gateway as `formulaValues`, which
 * writes them into `<v>` next to the untouched `<f>`. Never run on an autosave (there is none,
 * CONTRACT C10): only on an explicit save.
 *
 * Fail-soft like the desktop fallback: anything that stops the recalc (too big, busy, a sheet
 * with no file part, an IronCalc import error) saves the formulas without cached values.
 * Only an engine crash is rethrown, because the sessions are gone.
 */
import type { WorkbookSaveRequest } from '../../../../apps/sheets/src/shared/desktop-api'

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

/**
 * The recalc call for a save, or null when the save needs none (no formula edit without a
 * value already) or when the engine cannot represent it (structure or sheet changes desync the
 * file coordinates, a sheet added this session has no file part).
 */
export function planCachedValues(
  request: WorkbookSaveRequest,
  sheetNames: ReadonlyMap<string, string>,
  fileBytes: number,
): { edits: RecalcRequestEdit[]; reads: { sheet: string; range: object }[] } | null {
  if (fileBytes > RECALC_MAX_FILE_BYTES) return null
  if (request.structuralOps.length > 0) return null
  if (request.sheetOps.some((op) => op.kind !== 'set-sheet-tab-color')) return null
  const covered = new Set(
    request.formulaValues.map((v) => `${v.sheetId}\u0000${v.row}:${v.column}`),
  )
  const edits: RecalcRequestEdit[] = []
  const reads: { sheet: string; range: object }[] = []
  for (const edit of request.edits) {
    if (!edit.formula && !edit.writeValue) continue
    const sheet = sheetNames.get(edit.sheetId)
    if (sheet === undefined) return null
    edits.push({ sheet, row: edit.row, column: edit.column, input: recalcInput(edit) })
    if (edit.formula && !covered.has(`${edit.sheetId}\u0000${edit.row}:${edit.column}`)) {
      reads.push({
        sheet,
        range: {
          startRow: edit.row,
          endRow: edit.row,
          startColumn: edit.column,
          endColumn: edit.column,
        },
      })
    }
  }
  if (reads.length === 0) return null
  if (edits.length > RECALC_MAX_EDITS || reads.length > RECALC_MAX_READ_CELLS) return null
  return { edits, reads }
}

/** recalc cells -> the gateway's formulaValues (the renderer's overlay rules) */
export function toFormulaValues(
  cells: readonly RecalcResponseCell[],
  sheetNames: ReadonlyMap<string, string>,
): FormulaValue[] {
  const idsByName = new Map([...sheetNames].map(([id, name]) => [name, id]))
  const values: FormulaValue[] = []
  for (const cell of cells) {
    const sheetId = idsByName.get(cell.sheet)
    // #ERROR! is IronCalc's own failure, never a value Excel would cache
    if (!cell.isFormula || sheetId === undefined || cell.formatted === '#ERROR!') continue
    const value = cell.isError
      ? { error: cell.formatted.slice(0, 32) }
      : (cell.number ?? cell.formatted)
    values.push({ sheetId, row: cell.row, column: cell.column, value })
  }
  return values
}
