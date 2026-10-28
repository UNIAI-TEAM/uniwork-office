import { BooleanNumber } from '@univerjs/core'
import { describe, expect, it } from 'vitest'

import { NO_FILL_STYLE } from '../src/renderer/edit-journal'
import { themedTableCellStyle } from '../src/renderer/table-theme-paint'

const noFillXf = { bl: BooleanNumber.FALSE, bg: { ...NO_FILL_STYLE }, tb: 1 }

describe('themedTableCellStyle', () => {
  it('lets a theme fill win over the explicit no-fill of a file cell', () => {
    expect(themedTableCellStyle({ bg: { rgb: '#4472C4' } }, noFillXf)).toEqual({
      bl: BooleanNumber.FALSE,
      tb: 1,
    })
  })

  it('lets the theme header bold win over the xf default bold-off', () => {
    expect(themedTableCellStyle({ bl: BooleanNumber.TRUE }, noFillXf)).toEqual({
      bg: { ...NO_FILL_STYLE },
      tb: 1,
    })
  })

  it('drops both blockers for a styled header cell', () => {
    expect(
      themedTableCellStyle(
        { bg: { rgb: '#4472C4' }, cl: { rgb: '#FFFFFF' }, bl: BooleanNumber.TRUE },
        noFillXf,
      ),
    ).toEqual({ tb: 1 })
  })

  it('keeps a fill the user set on the cell', () => {
    const own = { ...noFillXf, bg: { rgb: '#FFFF00' } }
    expect(themedTableCellStyle({ bg: { rgb: '#4472C4' } }, own)).toBeNull()
  })

  it('keeps an explicit bold cell untouched', () => {
    expect(
      themedTableCellStyle({ bl: BooleanNumber.TRUE }, { bl: BooleanNumber.TRUE, tb: 1 }),
    ).toBeNull()
  })

  it('does nothing when the theme paints neither fill nor bold, or the cell has no style', () => {
    expect(themedTableCellStyle({ cl: { rgb: '#000000' } }, noFillXf)).toBeNull()
    expect(themedTableCellStyle({ bg: { rgb: '#4472C4' } }, null)).toBeNull()
    expect(themedTableCellStyle(null, noFillXf)).toBeNull()
  })

  it('leaves a cell with no bg key to the theme as before', () => {
    expect(themedTableCellStyle({ bg: { rgb: '#4472C4' } }, { tb: 1 })).toBeNull()
  })
})
