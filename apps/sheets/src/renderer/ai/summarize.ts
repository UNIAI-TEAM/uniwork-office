/**
 * summarize_range computation: conditional sum/count/average/min/max with an
 * optional group-by over rows read by range-rows.ts. Pure code — the model
 * never adds anything up itself — and every cell it could not use is counted
 * by reason, so the answer can state its coverage.
 */
import { formatAddress } from '@genoffice/xlsx-gateway/domain/cell-address'
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'

import { detectTotalRows, type TotalRow } from './total-rows'

export type SummarizeFunction = 'sum' | 'count' | 'average' | 'min' | 'max'

export const CRITERION_OPS = [
  '=',
  '<>',
  '>',
  '>=',
  '<',
  '<=',
  'contains',
  'not_contains',
  'blank',
  'not_blank',
] as const
export type CriterionOp = (typeof CRITERION_OPS)[number]

export interface Criterion {
  /** sheet column index */
  readonly column: number
  readonly op: CriterionOp
  readonly value?: string | number | boolean | undefined
}

export interface SummarizeSpec {
  /** sheet row / column of rows[0] / values[0] */
  readonly startRow: number
  readonly startColumn: number
  /** rows[0] is a header row, not data */
  readonly hasHeader: boolean
  readonly fn: SummarizeFunction
  /** sheet column index of the values (ignored by count) */
  readonly valueColumn?: number | undefined
  /** all must hold (AND) */
  readonly where: readonly Criterion[]
  readonly groupBy?: number | undefined
  readonly hiddenRows: 'include' | 'skip'
  /** detected total/subtotal rows (total-rows.ts): left out unless 'include' */
  readonly totalRows?: 'include' | 'skip' | undefined
  readonly maxGroups: number
}

export interface SummarizeRow {
  readonly row: number
  readonly hidden: boolean
  readonly values: readonly CellScalar[]
  readonly cached?: readonly boolean[] | undefined
  /** formula text per column, when known (total-row detection) */
  readonly formulas?: readonly (string | undefined)[] | undefined
  /** per column: the cell is withheld from the model */
  readonly withheld?: readonly boolean[] | undefined
}

export interface SkipBucket {
  count: number
  /** first few cells, for the answer to cite */
  readonly examples: { address: string; value: CellScalar }[]
}

export interface SummarizeGroup {
  readonly key: string
  rows: number
  valuesUsed: number
  result: number | null
}

export interface SummarizeResult {
  /** header text per sheet column (hasHeader only) */
  readonly headers: ReadonlyMap<number, string>
  /** first data row (sheet index) */
  readonly firstDataRow: number
  rowsProcessed: number
  rowsMatched: number
  /** hidden/filtered data rows, included or skipped per spec */
  hiddenRows: number
  valuesUsed: number
  /** value-column cells in matched rows that the reader withheld from the model */
  withheld: number
  readonly skipped: {
    readonly blank: SkipBucket
    readonly text: SkipBucket
    readonly error: SkipBucket
    readonly boolean: SkipBucket
  }
  /** criteria cells a numeric comparison could not use (text, errors) */
  criteriaNotComparable: number
  /** formula cells read with the file's cached value */
  cachedFormulaCells: number
  result: number | null
  /** sorted by result, largest first; capped at maxGroups */
  groups: SummarizeGroup[]
  /** total number of groups before the cap */
  groupCount: number
  /** detected total/subtotal rows, excluded unless spec.totalRows is 'include' */
  readonly totalRows: readonly TotalRow[]
}

const ERROR_LITERAL =
  /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!|FIELD!|BLOCKED!|CONNECT!|BUSY!|UNKNOWN!)$/
const MAX_EXAMPLES = 3

const isBlank = (value: CellScalar | undefined): boolean =>
  value === null || value === undefined || value === ''

/** A criterion value as a number: numbers, or plain decimal text ("100", "-2.5"). */
function criterionNumber(value: Criterion['value']): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return Number(value)
  return null
}

const textKey = (value: CellScalar | undefined): string =>
  isBlank(value) ? '' : String(value).trim().toLowerCase()

/** Like SUMIFS criteria: text compares case-insensitively, numbers numerically. */
function matches(
  value: CellScalar | undefined,
  criterion: Criterion,
): { ok: boolean; comparable: boolean } {
  switch (criterion.op) {
    case 'blank':
      return { ok: isBlank(value), comparable: true }
    case 'not_blank':
      return { ok: !isBlank(value), comparable: true }
    case 'contains':
    case 'not_contains': {
      const found = textKey(value).includes(textKey(criterion.value ?? ''))
      return { ok: criterion.op === 'contains' ? found : !found, comparable: true }
    }
    case '=':
    case '<>': {
      const target = criterionNumber(criterion.value)
      const equal =
        target !== null && typeof value === 'number'
          ? value === target
          : textKey(value) === textKey(criterion.value ?? '')
      return { ok: criterion.op === '=' ? equal : !equal, comparable: true }
    }
    default: {
      const target = criterionNumber(criterion.value)
      if (typeof value !== 'number' || target === null) {
        return { ok: false, comparable: isBlank(value) }
      }
      const ok =
        criterion.op === '>'
          ? value > target
          : criterion.op === '>='
            ? value >= target
            : criterion.op === '<'
              ? value < target
              : value <= target
      return { ok, comparable: true }
    }
  }
}

interface Accumulator {
  count: number
  sum: number
  min: number | null
  max: number | null
}

const emptyAccumulator = (): Accumulator => ({ count: 0, sum: 0, min: null, max: null })

function accumulate(acc: Accumulator, value: number): void {
  acc.count += 1
  acc.sum += value
  acc.min = acc.min === null ? value : Math.min(acc.min, value)
  acc.max = acc.max === null ? value : Math.max(acc.max, value)
}

function finish(fn: SummarizeFunction, acc: Accumulator, matchedRows: number): number | null {
  switch (fn) {
    case 'count':
      return matchedRows
    case 'sum':
      return acc.sum
    case 'average':
      return acc.count > 0 ? acc.sum / acc.count : null
    case 'min':
      return acc.min
    case 'max':
      return acc.max
  }
}

export function summarizeRows(rows: readonly SummarizeRow[], spec: SummarizeSpec): SummarizeResult {
  const at = (row: SummarizeRow, column: number): CellScalar | undefined =>
    row.values[column - spec.startColumn]
  const headers = new Map<number, string>()
  const header = spec.hasHeader ? rows.find((row) => row.row === spec.startRow) : undefined
  if (header) {
    header.values.forEach((value, offset) => {
      if (!isBlank(value)) headers.set(spec.startColumn + offset, String(value).trim())
    })
  }
  const bucket = (): SkipBucket => ({ count: 0, examples: [] })
  const result: SummarizeResult = {
    headers,
    firstDataRow: spec.startRow + (spec.hasHeader ? 1 : 0),
    rowsProcessed: 0,
    rowsMatched: 0,
    hiddenRows: 0,
    valuesUsed: 0,
    withheld: 0,
    skipped: { blank: bucket(), text: bucket(), error: bucket(), boolean: bucket() },
    criteriaNotComparable: 0,
    cachedFormulaCells: 0,
    result: null,
    groups: [],
    groupCount: 0,
    totalRows: detectTotalRows(rows, {
      startColumn: spec.startColumn,
      firstDataRow: spec.startRow + (spec.hasHeader ? 1 : 0),
    }),
  }
  const totalRowSet = new Set(
    spec.totalRows === 'include' ? [] : result.totalRows.map((entry) => entry.row),
  )
  const usedColumns = new Set<number>(spec.where.map((criterion) => criterion.column))
  if (spec.fn !== 'count' && spec.valueColumn !== undefined) usedColumns.add(spec.valueColumn)
  if (spec.groupBy !== undefined) usedColumns.add(spec.groupBy)

  const total = emptyAccumulator()
  const groups = new Map<string, { key: string; acc: Accumulator; rows: number }>()
  for (const row of rows) {
    if (row.row < result.firstDataRow) continue
    // a total row restates data rows: counting it would double count
    if (totalRowSet.has(row.row)) continue
    if (row.hidden) {
      result.hiddenRows += 1
      if (spec.hiddenRows === 'skip') continue
    }
    result.rowsProcessed += 1
    for (const column of usedColumns) {
      if (row.cached?.[column - spec.startColumn]) result.cachedFormulaCells += 1
    }
    let matched = true
    for (const criterion of spec.where) {
      const outcome = matches(at(row, criterion.column), criterion)
      if (!outcome.comparable) result.criteriaNotComparable += 1
      if (!outcome.ok) matched = false
    }
    if (!matched) continue
    result.rowsMatched += 1
    let group: { key: string; acc: Accumulator; rows: number } | undefined
    if (spec.groupBy !== undefined) {
      const raw = at(row, spec.groupBy)
      const key = isBlank(raw) ? '(blank)' : String(raw).trim()
      const normalized = key.toLowerCase()
      group = groups.get(normalized)
      if (!group) {
        group = { key, acc: emptyAccumulator(), rows: 0 }
        groups.set(normalized, group)
      }
      group.rows += 1
    }
    if (spec.fn === 'count' || spec.valueColumn === undefined) continue
    const valColIdx = spec.valueColumn - spec.startColumn
    if (row.withheld?.[valColIdx]) {
      result.withheld += 1
      continue
    }
    const value = at(row, spec.valueColumn)
    const skip = (target: SkipBucket): void => {
      target.count += 1
      if (target.examples.length < MAX_EXAMPLES) {
        target.examples.push({
          address: formatAddress(row.row, spec.valueColumn!),
          value: value ?? null,
        })
      }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      result.valuesUsed += 1
      accumulate(total, value)
      if (group) accumulate(group.acc, value)
    } else if (isBlank(value)) {
      skip(result.skipped.blank)
    } else if (typeof value === 'boolean') {
      skip(result.skipped.boolean)
    } else if (typeof value === 'string' && ERROR_LITERAL.test(value.trim())) {
      skip(result.skipped.error)
    } else {
      // never cast text to a number ("1.234,5" stays text)
      skip(result.skipped.text)
    }
  }
  if (spec.fn === 'count') result.valuesUsed = result.rowsMatched
  result.result = finish(spec.fn, total, result.rowsMatched)
  const allGroups = [...groups.values()].map((group): SummarizeGroup => ({
    key: group.key,
    rows: group.rows,
    valuesUsed: spec.fn === 'count' ? group.rows : group.acc.count,
    result: finish(spec.fn, group.acc, group.rows),
  }))
  allGroups.sort((left, right) => {
    if (left.result === right.result) return left.key.localeCompare(right.key)
    if (left.result === null) return 1
    if (right.result === null) return -1
    return right.result - left.result
  })
  result.groupCount = allGroups.length
  result.groups = allGroups.slice(0, Math.max(0, spec.maxGroups))
  return result
}
