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
import { KEEP, engineCanReplaySave, type CachedEntry, type CachedValue } from './stale-values'

type SaveEdit = WorkbookSaveRequest['edits'][number]
type FormulaValue = WorkbookSaveRequest['formulaValues'][number]
/** a formula value of the refresh: the gateway's, or KEEP (the file's own cached value stays) */
export type RefreshValue = Omit<FormulaValue, 'value'> & { value: CachedEntry }

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
  /**
   * every cell the refresh answers for: no result for one of them means no cached value;
   * `original` is the cached value the file holds for it (absent: none)
   */
  targets: { sheet: string; row: number; column: number; original?: CachedValue }[]
}

const cellKey = (sheet: string, row: number, column: number) => `${sheet}\u0000${row}:${column}`

/**
 * The recalc plan that refreshes EVERY formula cell of the saved file (stale-values.ts rule 1), or
 * null when the engine cannot: it cannot replay the save, the file or the edit list is above the
 * engine's limits, or a typed cell sits on a sheet the engine does not know.
 * `fileFormulas` are the formula cells of the source file by sheet name (0-based), with the cached
 * value the file holds for each.
 */
export function planRefresh(
  request: WorkbookSaveRequest,
  sheetNames: ReadonlyMap<string, string>,
  fileBytes: number,
  fileFormulas: ReadonlyMap<
    string,
    readonly { row: number; column: number; original?: CachedValue }[]
  >,
): RefreshPlan | null {
  if (fileBytes > RECALC_MAX_FILE_BYTES) return null
  if (!engineCanReplaySave(request)) return null
  const edits: RecalcRequestEdit[] = []
  const edited = new Set<string>()
  const targets = new Map<string, RefreshPlan['targets'][number]>()
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
    for (const { row, column, original } of cells) {
      const key = cellKey(sheet, row, column)
      if (!targets.has(key)) {
        targets.set(key, { sheet, row, column, ...(original === undefined ? {} : { original }) })
      }
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

/** the errors Excel and IronCalc agree on; any other error text may just be a function IronCalc lacks */
const TRUSTED_ERRORS: ReadonlySet<string> = new Set([
  '#DIV/0!',
  '#N/A',
  '#REF!',
  '#VALUE!',
  '#NUM!',
  '#NULL!',
])

const isErrorValue = (value: CachedValue | undefined): value is { readonly error: string } =>
  typeof value === 'object' && value !== null

/** `|a - b| <= 1e-12 * max(1, |a|, |b|)`: the engine's float noise (0.1+0.2) is not a new value */
const sameNumber = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))

/** the engine's non-error answer, as the cached value the file already holds? */
function sameResult(original: CachedValue, cell: RecalcResponseCell): boolean {
  if (typeof original === 'number')
    return cell.number !== undefined && sameNumber(cell.number, original)
  // booleans reach us as formatted TRUE / FALSE (recalc.rs answers `number` for numbers only)
  if (typeof original === 'boolean') {
    return cell.number === undefined && cell.formatted === (original ? 'TRUE' : 'FALSE')
  }
  return typeof original === 'string' && cell.number === undefined && cell.formatted === original
}

/**
 * What an untouched formula is saved with (it has no edit of its own; `original` is what the file
 * holds, `cell` the engine's answer, undefined when it gave none or `#ERROR!`):
 * - the answer is the file's value (numbers within 1e-12): KEEP, the cell stays byte-identical;
 * - the file holds an error and the answer is an error or none: KEEP (it was an error, it stays);
 * - an error from the trusted set where the file held no error: the new error (a dependent);
 * - any other error, or no answer, where the file held no error: no value (IronCalc may lack the
 *   function; Excel recomputes on open);
 * - any other answer: written (a real dependent, or a formula with no cached value yet).
 */
function untouchedValue(
  original: CachedValue | undefined,
  cell: RecalcResponseCell | undefined,
): CachedEntry {
  if (!cell) return isErrorValue(original) ? KEEP : null
  if (cell.isError) {
    if (isErrorValue(original)) return KEEP
    return TRUSTED_ERRORS.has(cell.formatted) ? { error: cell.formatted } : null
  }
  if (original !== undefined && !isErrorValue(original) && sameResult(original, cell)) return KEEP
  if (typeof original === 'boolean' && cell.number === undefined) {
    if (cell.formatted === 'TRUE') return true
    if (cell.formatted === 'FALSE') return false
  }
  return cell.number ?? cell.formatted
}

/**
 * The gateway's formulaValues for a refresh: the result for every target. A typed formula gets the
 * engine's result (its errors are real); an untouched one keeps the cached value the file holds
 * unless the engine really differs (`untouchedValue`). A target the engine could not answer is
 * `null` (the cached value is dropped), or absent for a typed formula.
 */
export function refreshFormulaValues(
  plan: Pick<RefreshPlan, 'edited' | 'targets'>,
  cells: readonly RecalcResponseCell[],
  sheetNames: ReadonlyMap<string, string>,
): RefreshValue[] {
  const idsByName = new Map([...sheetNames].map(([id, name]) => [name, id]))
  const results = new Map(cells.map((cell) => [cellKey(cell.sheet, cell.row, cell.column), cell]))
  const values: RefreshValue[] = []
  for (const target of plan.targets) {
    const sheetId = idsByName.get(target.sheet)
    if (sheetId === undefined) continue
    const key = cellKey(target.sheet, target.row, target.column)
    const found = results.get(key)
    const cell = found?.isFormula && found.formatted !== '#ERROR!' ? found : undefined
    let value: CachedEntry
    if (!plan.edited.has(key)) value = untouchedValue(target.original, cell)
    else if (!cell) {
      // as before: a typed formula the engine failed on saves without a cached value
      continue
    } else
      value = cell.isError
        ? { error: cell.formatted.slice(0, 32) }
        : (cell.number ?? cell.formatted)
    values.push({ sheetId, row: target.row, column: target.column, value })
  }
  return values
}
