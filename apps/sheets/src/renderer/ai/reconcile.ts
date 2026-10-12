/**
 * compare_ranges computation: reconcile two ranges (two sheets, ledger vs
 * bank export) row by row on a key column. Pure code — the model never
 * compares rows itself — reporting matched keys, keys missing on each side,
 * value differences, and coverage (rows processed, blank and duplicate keys,
 * hidden and total rows).
 */
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'

import type { SummarizeRow } from './summarize'
import { detectTotalRows, type TotalRow } from './total-rows'

export interface ReconcileSideInput {
  readonly rows: readonly SummarizeRow[]
  /** sheet row / column of rows[0] / values[0] */
  readonly startRow: number
  readonly startColumn: number
  /** sheet column index of the key */
  readonly keyColumn: number
}

export interface ReconcileSpec {
  readonly left: ReconcileSideInput
  readonly right: ReconcileSideInput
  readonly hasHeader: boolean
  /** [left column, right column] value pairs; by matching header text when omitted */
  readonly pairs?: readonly (readonly [number, number])[] | undefined
  readonly hiddenRows: 'include' | 'skip'
  readonly totalRows: 'include' | 'skip'
  /** numbers within this absolute difference compare equal */
  readonly tolerance: number
}

export interface ReconcileSideResult {
  rowsProcessed: number
  /** distinct non-blank keys */
  keys: number
  blankKeys: number
  hiddenRows: number
  readonly duplicateKeys: { key: string; rows: number[] }[]
  /** detected total/subtotal rows (excluded unless totalRows 'include') */
  totalRows: readonly TotalRow[]
  /** key or compared cells holding a formula's cached file value */
  cachedFormulaCells: number
  /** header text per sheet column (hasHeader only) */
  readonly headers: Map<number, string>
}

export interface ReconcileDifference {
  readonly key: string
  readonly leftRow: number
  readonly rightRow: number
  readonly leftColumn: number
  readonly rightColumn: number
  readonly left: CellScalar
  readonly right: CellScalar
  /** right − left, when both are numbers */
  readonly delta?: number
}

export interface ReconcileResult {
  readonly pairs: (readonly [number, number])[]
  readonly left: ReconcileSideResult
  readonly right: ReconcileSideResult
  matched: number
  /** matched keys whose compared values are all equal */
  identical: number
  readonly onlyLeft: { key: string; row: number }[]
  readonly onlyRight: { key: string; row: number }[]
  readonly differences: ReconcileDifference[]
}

const isBlank = (value: CellScalar | undefined): boolean =>
  value === null || value === undefined || value === ''

const normalizeText = (value: CellScalar | undefined): string =>
  isBlank(value) ? '' : String(value).normalize('NFC').trim()

interface IndexedSide {
  readonly result: ReconcileSideResult
  /** normalized key -> first row carrying it */
  readonly byKey: Map<string, { key: string; row: SummarizeRow }>
}

function indexSide(
  side: ReconcileSideInput,
  spec: ReconcileSpec,
  compared: readonly number[],
): IndexedSide {
  const firstDataRow = side.startRow + (spec.hasHeader ? 1 : 0)
  const headers = new Map<number, string>()
  const header = spec.hasHeader ? side.rows.find((row) => row.row === side.startRow) : undefined
  header?.values.forEach((value, offset) => {
    if (!isBlank(value)) headers.set(side.startColumn + offset, normalizeText(value))
  })
  const totalRows = detectTotalRows(side.rows, { startColumn: side.startColumn, firstDataRow })
  const totalSet = new Set(spec.totalRows === 'include' ? [] : totalRows.map((entry) => entry.row))
  const result: ReconcileSideResult = {
    rowsProcessed: 0,
    keys: 0,
    blankKeys: 0,
    hiddenRows: 0,
    duplicateKeys: [],
    totalRows,
    cachedFormulaCells: 0,
    headers,
  }
  const byKey = new Map<string, { key: string; row: SummarizeRow }>()
  const duplicates = new Map<string, { key: string; rows: number[] }>()
  const at = (row: SummarizeRow, column: number): CellScalar | undefined =>
    row.values[column - side.startColumn]
  for (const row of side.rows) {
    if (row.row < firstDataRow || totalSet.has(row.row)) continue
    if (row.hidden) {
      result.hiddenRows += 1
      if (spec.hiddenRows === 'skip') continue
    }
    result.rowsProcessed += 1
    for (const column of [side.keyColumn, ...compared]) {
      if (row.cached?.[column - side.startColumn]) result.cachedFormulaCells += 1
    }
    const raw = at(row, side.keyColumn)
    if (isBlank(raw)) {
      result.blankKeys += 1
      continue
    }
    const key = normalizeText(raw)
    const normalized = key.toLowerCase()
    const first = byKey.get(normalized)
    if (first) {
      const entry = duplicates.get(normalized) ?? { key: first.key, rows: [first.row.row] }
      entry.rows.push(row.row)
      duplicates.set(normalized, entry)
      continue
    }
    byKey.set(normalized, { key, row })
  }
  result.keys = byKey.size
  result.duplicateKeys.push(...duplicates.values())
  return { result, byKey }
}

/** Header-matched value pairs (case-insensitive), key columns excluded. */
function headerPairs(spec: ReconcileSpec): [number, number][] {
  const headersOf = (side: ReconcileSideInput): Map<number, string> => {
    const map = new Map<number, string>()
    const header = side.rows.find((row) => row.row === side.startRow)
    header?.values.forEach((value, offset) => {
      const column = side.startColumn + offset
      if (!isBlank(value) && column !== side.keyColumn) {
        map.set(column, normalizeText(value).toLowerCase())
      }
    })
    return map
  }
  const right = headersOf(spec.right)
  const pairs: [number, number][] = []
  for (const [leftColumn, name] of headersOf(spec.left)) {
    for (const [rightColumn, rightName] of right) {
      if (rightName === name) {
        pairs.push([leftColumn, rightColumn])
        break
      }
    }
  }
  return pairs
}

function sameValue(left: CellScalar, right: CellScalar, tolerance: number): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) <= tolerance
  }
  if (isBlank(left) && isBlank(right)) return true
  // a number and its text twin differ in type: report it, never cast
  if (typeof left !== typeof right) return false
  return normalizeText(left) === normalizeText(right)
}

export function reconcileRows(spec: ReconcileSpec): ReconcileResult {
  const pairs = spec.pairs ? [...spec.pairs] : spec.hasHeader ? headerPairs(spec) : []
  const left = indexSide(
    spec.left,
    spec,
    pairs.map(([column]) => column),
  )
  const right = indexSide(
    spec.right,
    spec,
    pairs.map(([, column]) => column),
  )
  const result: ReconcileResult = {
    pairs,
    left: left.result,
    right: right.result,
    matched: 0,
    identical: 0,
    onlyLeft: [],
    onlyRight: [],
    differences: [],
  }
  const valueAt = (side: ReconcileSideInput, row: SummarizeRow, column: number): CellScalar =>
    row.values[column - side.startColumn] ?? null
  for (const [normalized, entry] of left.byKey) {
    const other = right.byKey.get(normalized)
    if (!other) {
      result.onlyLeft.push({ key: entry.key, row: entry.row.row })
      continue
    }
    result.matched += 1
    let identical = true
    for (const [leftColumn, rightColumn] of pairs) {
      const leftValue = valueAt(spec.left, entry.row, leftColumn)
      const rightValue = valueAt(spec.right, other.row, rightColumn)
      if (sameValue(leftValue, rightValue, spec.tolerance)) continue
      identical = false
      result.differences.push({
        key: entry.key,
        leftRow: entry.row.row,
        rightRow: other.row.row,
        leftColumn,
        rightColumn,
        left: leftValue,
        right: rightValue,
        ...(typeof leftValue === 'number' && typeof rightValue === 'number'
          ? { delta: Number((rightValue - leftValue).toPrecision(15)) }
          : {}),
      })
    }
    if (identical) result.identical += 1
  }
  for (const [normalized, entry] of right.byKey) {
    if (!left.byKey.has(normalized)) result.onlyRight.push({ key: entry.key, row: entry.row.row })
  }
  return result
}
