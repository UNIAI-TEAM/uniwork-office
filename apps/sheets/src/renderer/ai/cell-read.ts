/**
 * Cell typing for the AI read tools: what kind of value a cell holds, judged
 * from its raw model value and number format, so the model can tell 10 from
 * 10 % (raw 0.1) and from the text "10" without guessing from display text.
 */
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'

import type { EditJournal } from '../edit-journal'
import { indexedFormulaText } from '../formula-view'
import { EXCEL_ERROR_LITERALS } from '../univer-sync'
import type { LazyWorkbookState } from '../univer-state'

export type CellReadType =
  'number' | 'percent' | 'currency' | 'date' | 'text' | 'boolean' | 'error' | 'empty'

/** One cell as the AI read tools see it (same shape in demo and lazy mode). */
export interface CellRead {
  /** what the grid shows (number format applied) */
  value: CellScalar
  formula?: string
  /** the model value behind `value` (0.1 behind "10%") */
  rawValue?: CellScalar | undefined
  type?: CellReadType
  /** explicit number format; omitted for General */
  numberFormat?: string
  /** formula cells in lazy mode: engine result or the file's cached value */
  valueSource?: 'engine' | 'cache'
  /** cache only: inputs changed this session, the cached value may be out of date */
  staleCache?: boolean
  /** the engine's own result when the shown value is the file's cached one */
  engineResult?: CellScalar
}

/** Currency glyphs and the codes Vietnamese/English files spell out. */
const CURRENCY_SYMBOL = /[$€£¥₫₩₹₽]/
const QUOTED_CURRENCY_CODE = /"[^"]*\b(?:VND|VNĐ|USD|EUR|JPY|CNY)\b[^"]*"|"\s*đ\s*"/i

/** True when a format code is the default (no explicit number format). */
export function isGeneralFormat(format: string | undefined): boolean {
  return format === undefined || format === '' || format.toLowerCase() === 'general'
}

/**
 * The value kind a raw value takes under a number format. Only the first
 * format section (positive numbers) decides; quoted literals, escaped
 * characters and colour/condition brackets never count as date tokens.
 */
export function classifyCellType(raw: CellScalar, format: string | undefined): CellReadType {
  if (raw === null || raw === '') return 'empty'
  if (typeof raw === 'boolean') return 'boolean'
  if (typeof raw === 'string') return EXCEL_ERROR_LITERALS.has(raw) ? 'error' : 'text'
  if (isGeneralFormat(format)) return 'number'
  const code = format ?? ''
  if (CURRENCY_SYMBOL.test(code) || code.includes('[$') || QUOTED_CURRENCY_CODE.test(code)) {
    return 'currency'
  }
  const section = (code.split(';')[0] ?? '')
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    // [h] / [mm] / [ss] are elapsed-time tokens; other brackets are colours
    // or conditions
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, '')
    .replace(/general/gi, '')
  if (section.includes('%')) return 'percent'
  if (/[ymdhs]/i.test(section.replace(/E[+-]/gi, ''))) return 'date'
  return 'number'
}

/**
 * Where a formula cell's value came from. 'engine': this app's formula engine
 * (Univer, or the IronCalc recalc overlay) computed it. 'cache': it is the
 * file's cached <v> — streamed cells the engine never sees, or the display
 * fallback over an engine error.
 */
export interface FormulaProvenance {
  /** formula text with a leading '=' */
  readonly formula: string
  readonly source: 'engine' | 'cache'
  /** cache only: inputs were edited this session, so the cached value may be out of date */
  readonly stale: boolean
  /** the engine's own result when the grid shows the file's cached value instead */
  readonly engineResult?: CellScalar
}

/**
 * True when this session changed anything a formula can read: cell values,
 * fills, row/column structure, defined names or the sheet set. A file
 * cached value is only trustworthy while none of that happened.
 */
export function sessionHasInputEdits(journal: EditJournal): boolean {
  for (const entries of journal.cells.values()) {
    for (const entry of entries.values()) if (entry.hasValue) return true
  }
  for (const fills of journal.bulkConstantFills.values()) if (fills.length > 0) return true
  for (const ops of journal.structuralOps.values()) if (ops.length > 0) return true
  return journal.definedNames?.dirty === true || (journal.sheets?.removed.size ?? 0) > 0
}

/**
 * Provenance of the value at (row, column) — screen coordinates — or null
 * when the cell holds no formula. `modelHasFormula` says whether the Univer
 * model carries the formula (then the engine computes it).
 */
export function formulaProvenance(
  state: LazyWorkbookState,
  sheetId: string,
  row: number,
  column: number,
  cell: {
    readonly formula?: string | undefined
    readonly modelHasFormula: boolean
    readonly value: CellScalar
    readonly rawValue?: CellScalar | undefined
  },
): FormulaProvenance | null {
  const text = cell.formula || indexedFormulaText(state, sheetId, row, column)
  if (!text) return null
  const formula = text.startsWith('=') ? text : `=${text}`
  if (cell.modelHasFormula) {
    const raw = cell.rawValue
    const display = cell.value
    // formula-cached-fallback.ts: an engine error shown as the file's value
    const fallback =
      typeof raw === 'string' &&
      EXCEL_ERROR_LITERALS.has(raw) &&
      display !== null &&
      display !== raw &&
      !(typeof display === 'string' && EXCEL_ERROR_LITERALS.has(display))
    if (!fallback) return { formula, source: 'engine', stale: false }
    return {
      formula,
      source: 'cache',
      stale: sessionHasInputEdits(state.editJournal),
      engineResult: raw,
    }
  }
  if (state.recalc?.overlay.get(sheetId)?.has(`${row}:${column}`)) {
    return { formula, source: 'engine', stale: false }
  }
  return { formula, source: 'cache', stale: sessionHasInputEdits(state.editJournal) }
}
