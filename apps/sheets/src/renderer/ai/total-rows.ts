/**
 * Total / subtotal row detection for the AI read tools: report-style sheets
 * interleave data with SUBTOTAL rows, a SUM over the block above, or rows
 * labelled "Tổng cộng" / "Total", and an aggregate over the whole range would
 * count those amounts twice.
 */
import { columnLabel, formatAddress } from '@genoffice/xlsx-gateway/domain/cell-address'
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'

export interface TotalRow {
  readonly row: number
  readonly kind: 'total' | 'subtotal'
  /** the cue, citing the cell */
  readonly reason: string
}

export interface TotalRowInput {
  readonly row: number
  readonly values: readonly CellScalar[]
  /** formula text per column (with or without '='), when known */
  readonly formulas?: readonly (string | undefined)[] | undefined
}

const SUBTOTAL_CALL = /^=?\s*(?:_xlfn\.)?(?:SUBTOTAL|AGGREGATE)\s*\(/i
const SUM_OF_BLOCK =
  /^=?\s*SUM\s*\(\s*\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)\s*$/i

/**
 * Labels that mark a whole row as a total. Words that may lead a longer
 * label ("Total North", "Cộng Bắc", "Tổng cộng miền Nam") are separate from
 * those that must stand alone ("Tổng", "Tổng số") — "Tổng công ty" is a name.
 */
const LEADING_LABEL =
  /^(?:grand[\s-]*total|sub[\s-]*total|total|tổng\s+cộng|cộng|合计|总计|小计|合計|総計|小計)(?=$|[\s:：(-])/i
const STANDALONE_LABEL = /^(?:tổng|tổng\s+số|sum)\s*[:：]?$/i
const SUBTOTAL_LABEL = /^(?:sub[\s-]*total|小计|小計|cộng\s+\S)/i

function labelKind(text: string): 'total' | 'subtotal' | null {
  // decomposed Vietnamese (NFD) must match the precomposed patterns
  const trimmed = text.normalize('NFC').trim()
  if (!LEADING_LABEL.test(trimmed) && !STANDALONE_LABEL.test(trimmed)) return null
  return SUBTOTAL_LABEL.test(trimmed) ? 'subtotal' : 'total'
}

const withEquals = (formula: string): string => (formula.startsWith('=') ? formula : `=${formula}`)

/**
 * Rows at or after `firstDataRow` that hold totals, first cue wins per row:
 * a SUBTOTAL/AGGREGATE formula, a SUM whose single-column range ends on the
 * row directly above in the same column, then a total label in a text cell.
 */
export function detectTotalRows(
  rows: readonly TotalRowInput[],
  layout: { readonly startColumn: number; readonly firstDataRow: number },
): TotalRow[] {
  const found: TotalRow[] = []
  for (const row of rows) {
    if (row.row < layout.firstDataRow) continue
    let hit: TotalRow | null = null
    row.formulas?.forEach((formula, offset) => {
      if (hit || !formula) return
      const column = layout.startColumn + offset
      const address = formatAddress(row.row, column)
      if (SUBTOTAL_CALL.test(formula)) {
        hit = { row: row.row, kind: 'subtotal', reason: `${address} ${withEquals(formula)}` }
        return
      }
      const sum = SUM_OF_BLOCK.exec(formula)
      if (
        sum &&
        sum[1]!.toUpperCase() === columnLabel(column) &&
        sum[3]!.toUpperCase() === columnLabel(column) &&
        Number(sum[4]) === row.row &&
        Number(sum[2]) < row.row
      ) {
        hit = {
          row: row.row,
          kind: 'total',
          reason: `${address} ${withEquals(formula)} sums the block above`,
        }
      }
    })
    if (!hit) {
      row.values.forEach((value, offset) => {
        if (hit || typeof value !== 'string') return
        const kind = labelKind(value)
        if (kind) {
          hit = {
            row: row.row,
            kind,
            reason: `label "${value.trim()}" in ${formatAddress(row.row, layout.startColumn + offset)}`,
          }
        }
      })
    }
    if (hit) found.push(hit)
  }
  return found
}
