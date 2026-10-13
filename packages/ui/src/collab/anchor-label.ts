/**
 * Anchor -> the label parts the panel shows (spine S12 "Nhãn neo"): one string key with placeholders per
 * format, never a string glued in one language's order. The component fills the key through `format()`.
 */
import type { Lang } from '@genoffice/i18n'
import type { CollabAnchor } from './types'

export type AnchorLabelKey =
  'collabAnchorDocx' | 'collabAnchorCell' | 'collabAnchorSlide' | 'collabAnchorPage'

export interface AnchorLabelParts {
  key: AnchorLabelKey
  params: Record<string, string>
  /** the full docx quote when the label shows a cut one (tooltip / focus) */
  title?: string
}

export interface AnchorLabelOptions {
  lang: Lang
  /** name of the sheet the editor has open; undefined without an editor (the sheet is then always named) */
  activeSheet?: string
  /** stable sheet id -> display name, for workbooks whose anchors carry the id */
  resolveSheetName?: (sheet: string) => string | undefined
}

/** docx label cut (code points) and the longest quote kept for the title: the server caps a quote at 500 */
export const ANCHOR_QUOTE_LABEL_MAX = 60
export const ANCHOR_QUOTE_TITLE_MAX = 500

function formatInt(n: number, lang: Lang): string {
  try {
    return new Intl.NumberFormat(lang).format(n)
  } catch {
    return String(n)
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function count(v: unknown, min: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= min ? v : undefined
}

export function anchorLabel(
  anchor: CollabAnchor,
  opts: AnchorLabelOptions,
): AnchorLabelParts | null {
  switch (anchor.format) {
    case 'docx': {
      const quote = str(anchor.quote)?.replace(/\s+/g, ' ').trim()
      if (!quote) return null
      const chars = Array.from(quote)
      if (chars.length <= ANCHOR_QUOTE_LABEL_MAX)
        return { key: 'collabAnchorDocx', params: { quote } }
      return {
        key: 'collabAnchorDocx',
        params: { quote: chars.slice(0, ANCHOR_QUOTE_LABEL_MAX).join('') + '…' },
        title: chars.slice(0, ANCHOR_QUOTE_TITLE_MAX).join(''),
      }
    }
    case 'xlsx': {
      const range = str(anchor.range)
      if (!range) return null
      const sheet = str(anchor.sheet)
      const name = sheet === undefined ? undefined : (opts.resolveSheetName?.(sheet) ?? sheet)
      // Excel syntax, not translated; the open sheet gets the bare range
      const cell =
        name === undefined || name === opts.activeSheet
          ? range
          : `'${name.replace(/'/g, "''")}'!${range}`
      return { key: 'collabAnchorCell', params: { cell } }
    }
    case 'pptx': {
      const index = count(anchor.slide_index, 0)
      if (index === undefined) return null
      return { key: 'collabAnchorSlide', params: { slide: formatInt(index + 1, opts.lang) } }
    }
    case 'pdf': {
      const page = count(anchor.page, 1)
      if (page === undefined) return null
      return { key: 'collabAnchorPage', params: { page: formatInt(page, opts.lang) } }
    }
    default:
      return null
  }
}
