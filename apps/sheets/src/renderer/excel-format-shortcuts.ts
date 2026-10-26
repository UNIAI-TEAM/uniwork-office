/// Number formats and borders of Excel's Ctrl+Shift+<symbol> shortcuts, by
/// their row in the sheets shortcut table (the chords live there; the window
/// handler in global-shortcuts.ts matches them). The Home tab's quick buttons
/// share the Excel style codes below.

export const PERCENT_STYLE = '0%'
export const COMMA_STYLE = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)'

export function accountingStyle(symbol: string): string {
  const s = `"${symbol}"`
  return `_(${s}* #,##0.00_);_(${s}* \\(#,##0.00\\);_(${s}* "-"??_);_(@_)`
}

export function currencyStyle(symbol: string): string {
  const s = symbol.length === 1 ? symbol : `"${symbol}"`
  return `${s}#,##0.00_);(${s}#,##0.00)`
}

export const RIBBON_CURRENCY_SYMBOL = '$'

/// `shortcuts.csv` row → the number format its chord applies
export const NUMBER_FORMAT_SHORTCUTS: Readonly<Record<string, string>> = {
  'sheets-68': 'General',
  'sheets-69': '#,##0.00',
  'sheets-70': 'h:mm AM/PM',
  'sheets-71': 'd-mmm-yy',
  'sheets-72': currencyStyle(RIBBON_CURRENCY_SYMBOL),
  'sheets-73': PERCENT_STYLE,
  'sheets-74': '0.00E+00',
}

<<<<<<< ours
/// outline border / no border (the row's two sub-actions)
export const BORDER_SHORTCUT_ROW = 'sheets-75'
=======
const BORDER_SHORTCUTS: Readonly<Record<string, string>> = {
  Digit7: 'outer',
  Minus: 'none',
}

/// Excel for Mac additionally binds outline / no border to Cmd+Opt+0 / Cmd+Opt+-.
const MAC_BORDER_SHORTCUTS: Readonly<Record<string, string>> = {
  Digit0: 'outer',
  Minus: 'none',
}

export interface FormatShortcutKey {
  readonly code: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

/// Ribbon command for a keydown, or null when it is not a format shortcut.
/// The mac border chords need `isMac`: without the gate the Windows key
/// combined with Alt would trigger borders on Windows and Linux too.
export function formatShortcutCommand(event: FormatShortcutKey, isMac = false): string | null {
  if (isMac && event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey) {
    const preset = MAC_BORDER_SHORTCUTS[event.code]
    return preset ? `border:${preset}` : null
  }
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return null
  const pattern = NUMBER_FORMAT_SHORTCUTS[event.code]
  if (pattern) return `format:${pattern}`
  const preset = BORDER_SHORTCUTS[event.code]
  return preset ? `border:${preset}` : null
}
>>>>>>> theirs
