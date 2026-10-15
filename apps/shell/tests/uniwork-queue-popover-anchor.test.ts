import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { popoverLeftOf, POPOVER_GUTTER_PX } from '../src/renderer/src/queue-popover-model'

/**
 * U-2: the queue popover is anchored under the pill (contract §3: below the pill, right-aligned to
 * its right edge, inside the window with an 8px gutter). The component side (placing it, and again
 * on a resize or a change of the pill) is tested against the real chip in uniwork-pill-strip-ui.test.ts.
 */

describe('U-2: the popover is right-aligned to the pill, inside the window', () => {
  it('has a gutter of 8px', () => {
    expect(POPOVER_GUTTER_PX).toBe(8)
  })

  it('its right edge is the pill right edge', () => {
    for (const pillRight of [400, 520, 700, 862]) {
      const left = popoverLeftOf({ pillRight, width: 360, windowWidth: 890 })
      expect(left + 360, `pill at ${pillRight}`).toBe(pillRight)
    }
  })

  it('a pill near the left edge keeps the dialog inside the left gutter', () => {
    expect(popoverLeftOf({ pillRight: 200, width: 360, windowWidth: 890 })).toBe(8)
    expect(popoverLeftOf({ pillRight: 367, width: 360, windowWidth: 890 })).toBe(8)
    expect(popoverLeftOf({ pillRight: 368, width: 360, windowWidth: 890 })).toBe(8)
    expect(popoverLeftOf({ pillRight: 369, width: 360, windowWidth: 890 })).toBe(9)
  })

  it('a pill at the window edge keeps the dialog inside the right gutter', () => {
    expect(popoverLeftOf({ pillRight: 890, width: 360, windowWidth: 890 }) + 360).toBe(882)
    expect(popoverLeftOf({ pillRight: 2000, width: 360, windowWidth: 890 }) + 360).toBe(882)
  })

  it('a dialog wider than the window minus the gutters sits at the left gutter', () => {
    expect(popoverLeftOf({ pillRight: 500, width: 900, windowWidth: 720 })).toBe(8)
  })

  it('a bad measure falls back to the right gutter, never NaN', () => {
    expect(popoverLeftOf({ pillRight: Number.NaN, width: 360, windowWidth: 890 })).toBe(
      890 - 8 - 360,
    )
    expect(
      popoverLeftOf({ pillRight: 500, width: Number.NaN, windowWidth: 890 }),
    ).toBeGreaterThanOrEqual(8)
  })
})

describe('RFE6u6-01: right-to-left, the dialog is placed by its physical box', () => {
  const rtl = (pillLeft: number, windowWidth = 890) =>
    popoverLeftOf({ dir: 'rtl', pillLeft, pillRight: pillLeft + 309, width: 360, windowWidth })

  it('its LEFT edge is the pill LEFT edge, so it opens toward the window centre', () => {
    for (const pillLeft of [8, 40, 150, 300, 522]) {
      expect(rtl(pillLeft), `pill at ${pillLeft}`).toBe(pillLeft)
    }
  })

  it('a pill at the left window edge keeps the dialog inside the left gutter', () => {
    expect(rtl(0)).toBe(8)
    expect(rtl(-30)).toBe(8)
    expect(rtl(7)).toBe(8)
  })

  it('a pill near the right edge keeps the dialog inside the right gutter', () => {
    expect(rtl(600) + 360).toBe(882)
    expect(rtl(2000) + 360).toBe(882)
  })

  it('a dialog wider than the window minus the gutters sits at the left gutter', () => {
    expect(
      popoverLeftOf({ dir: 'rtl', pillLeft: 100, pillRight: 400, width: 900, windowWidth: 720 }),
    ).toBe(8)
  })

  it('a bad measure stays inside the window, never NaN', () => {
    const left = popoverLeftOf({
      dir: 'rtl',
      pillLeft: Number.NaN,
      pillRight: Number.NaN,
      width: 360,
      windowWidth: 890,
    })
    expect(Number.isFinite(left)).toBe(true)
    expect(left).toBeGreaterThanOrEqual(8)
    expect(left + 360).toBeLessThanOrEqual(882)
  })

  it('left-to-right is the same whether or not the direction is given', () => {
    for (const pillRight of [400, 520, 700, 862]) {
      const plain = popoverLeftOf({ pillRight, width: 360, windowWidth: 890 })
      const given = popoverLeftOf({
        dir: 'ltr',
        pillLeft: 0,
        pillRight,
        width: 360,
        windowWidth: 890,
      })
      expect(given).toBe(plain)
    }
  })
})

describe('U-2: queue-popover.css puts the dialog where the component says', () => {
  const css = readFileSync(
    resolve(__dirname, '../src/renderer/src/queue-popover.css'),
    'utf8',
  ).replace(/\r\n/g, '\n')
  const rule = (selector: string): string => {
    const start = css.indexOf(`\n${selector} {`)
    expect(start, selector).toBeGreaterThanOrEqual(0)
    const open = css.indexOf('{', start)
    return css.slice(open + 1, css.indexOf('}', open))
  }

  it('the band starts the dialog at the left and gives it no side padding: its margin is the x', () => {
    expect(rule('.uw-queue-band')).toMatch(/justify-content: flex-start/)
    expect(rule('.uw-queue-band')).toMatch(/padding: 6px 0 8px/)
    expect(rule('.uw-queue-band')).not.toMatch(/justify-content: flex-end/)
  })

  it('RFE6u6-01: the band lays out left-to-right whatever the document, so flex-start and margin-left are the physical left', () => {
    expect(rule('.uw-queue-band')).toMatch(/direction: ltr/)
  })

  it('RFE6u6-01: the dialog forces no text direction (its dir attribute gives the document one)', () => {
    expect(rule('.uw-queue-pop')).not.toMatch(/(^|\s)direction:/)
  })

  it('the dialog never passes the window minus the two gutters', () => {
    expect(rule('.uw-queue-pop')).toMatch(
      /width: min\(360px, calc\(var\(--ui-vw, 1vw\) \* 100 - 16px\)\)/,
    )
  })

  it('the band stays in the reserved band: fixed under the strip, the dialog is not positioned over the editor', () => {
    expect(rule('.uw-queue-band')).toMatch(/position: fixed/)
    expect(rule('.uw-queue-pop')).not.toMatch(/position: (fixed|absolute)/)
  })
})

describe('U-2: at the numbers measured in the real shell', () => {
  it('1280px: the pill ends at 1104, so the 360px dialog is 744..1104 (it was 923..1283, 179px past the pill)', () => {
    const left = popoverLeftOf({ pillRight: 1104, width: 360, windowWidth: 1280 })
    expect(left).toBe(744)
    expect(left + 360).toBe(1104)
  })

  it('800, 890 and 1024: the same, right edge on the pill whatever the window', () => {
    for (const w of [800, 890, 1024, 1280]) {
      const pillRight = w - 176
      expect(popoverLeftOf({ pillRight, width: 360, windowWidth: w }) + 360, `${w}px`).toBe(
        pillRight,
      )
    }
  })

  it('722px (V6u4-04): a 360px dialog under a 314px pill that starts at x 218 sticks out 46px left of it and still fits', () => {
    const pillRight = 218 + 314
    const left = popoverLeftOf({ pillRight, width: 360, windowWidth: 722 })
    expect(left).toBe(172)
    expect(218 - left).toBe(46)
    expect(left).toBeGreaterThanOrEqual(8)
    expect(left + 360).toBeLessThanOrEqual(722 - 8)
  })

  it('a pill so far left that the dialog would pass the window edge is clamped to the 8px gutter', () => {
    expect(popoverLeftOf({ pillRight: 300, width: 360, windowWidth: 722 })).toBe(8)
  })
})
