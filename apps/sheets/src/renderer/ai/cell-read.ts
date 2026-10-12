/**
 * Cell typing for the AI read tools: what kind of value a cell holds, judged
 * from its raw model value and number format, so the model can tell 10 from
 * 10 % (raw 0.1) and from the text "10" without guessing from display text.
 */
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'

import { EXCEL_ERROR_LITERALS } from '../univer-sync'

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
