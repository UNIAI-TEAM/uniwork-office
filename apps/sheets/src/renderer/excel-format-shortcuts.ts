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

/// outline border / no border (the row's two sub-actions)
export const BORDER_SHORTCUT_ROW = 'sheets-75'
