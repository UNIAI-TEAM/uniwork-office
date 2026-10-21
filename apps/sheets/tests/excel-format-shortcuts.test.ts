import { describe, expect, it } from 'vitest'

import { findShortcut } from '@genoffice/shortcuts'
import {
  accountingStyle,
  BORDER_SHORTCUT_ROW,
  COMMA_STYLE,
  currencyStyle,
  NUMBER_FORMAT_SHORTCUTS,
  PERCENT_STYLE,
} from '../src/renderer/excel-format-shortcuts'
import { numfmtOptionsOf, numfmtPreview } from '../src/renderer/numfmt-dialog'

// The chords themselves are matched in global-shortcuts.test.ts; this file
// locks which table row applies which format.
describe('number format shortcuts by table row', () => {
  it.each([
    ['sheets-68', 'General'],
    ['sheets-69', '#,##0.00'],
    ['sheets-70', 'h:mm AM/PM'],
    ['sheets-71', 'd-mmm-yy'],
    ['sheets-72', '$#,##0.00_);($#,##0.00)'],
    ['sheets-73', '0%'],
    ['sheets-74', '0.00E+00'],
  ])('%s applies %s', (id, pattern) => {
    expect(NUMBER_FORMAT_SHORTCUTS[id]).toBe(pattern)
  })

  it('names rows of the sheets table only', () => {
    for (const id of [...Object.keys(NUMBER_FORMAT_SHORTCUTS), BORDER_SHORTCUT_ROW]) {
      expect(findShortcut('sheets', id), id).toBeDefined()
    }
  })
})

describe('Home tab quick styles', () => {
  const render = numfmtPreview

  it('use the Excel codes', () => {
    expect(PERCENT_STYLE).toBe('0%')
    expect(COMMA_STYLE).toBe('_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)')
    expect(accountingStyle('$')).toBe(
      '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
    )
    expect(currencyStyle('US$')).toBe('"US$"#,##0.00_);("US$"#,##0.00)')
  })

  it('render through numfmt without leaking format tokens', () => {
    const accounting = accountingStyle('$')
    expect(render(accounting, 1234.5)).toBe(' $1,234.50 ')
    expect(render(accounting, -1234.5)).toBe(' $(1,234.50)')
    expect(render(accounting, 0)).toBe(' $-   ')
    expect(render(accounting, 'abc')).toBe(' abc ')
    expect(render(COMMA_STYLE, 1234.5)).toBe(' 1,234.50 ')
    expect(render(COMMA_STYLE, -1234.5)).toBe(' (1,234.50)')
    expect(render(COMMA_STYLE, 0)).toBe(' -   ')
    expect(render(PERCENT_STYLE, 0.125)).toBe('13%')
  })

  it('round-trip into the Format Cells dialog as Accounting', () => {
    expect(numfmtOptionsOf(accountingStyle('$'))).toMatchObject({
      category: 'accounting',
      symbol: '$',
      decimals: 2,
    })
    expect(numfmtOptionsOf(COMMA_STYLE)).toMatchObject({ category: 'accounting', symbol: '' })
  })
})
