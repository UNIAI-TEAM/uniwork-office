// UNI-1931 (SVF-1): at phone width the File menu is fixed and anchored from the File tab's measured
// rectangle; the tab row can be scrolled sideways, so the anchor follows the tab and is clamped into
// the viewport.
import { describe, expect, it } from 'vitest'
import { fileMenuAnchor } from '../src/renderer/components/file-menu-anchor'

const VW = 390
const MENU_W = 210

describe('fileMenuAnchor', () => {
  it('hangs under the tab, 2px below it, on the tab left edge', () => {
    expect(fileMenuAnchor({ left: 10, bottom: 34 }, MENU_W, VW)).toEqual({ left: 10, top: 36 })
  })

  it('follows the tab when the row is scrolled partly off-screen', () => {
    // scrollLeft 30: the tab sits 30px left of where it started, 8px is the viewport edge margin
    expect(fileMenuAnchor({ left: -20, bottom: 34 }, MENU_W, VW)).toEqual({ left: 8, top: 36 })
    expect(fileMenuAnchor({ left: 12, bottom: 34 }, MENU_W, VW)).toEqual({ left: 12, top: 36 })
  })

  it('clamps to the viewport edge when the tab is fully scrolled off', () => {
    const { left } = fileMenuAnchor({ left: -400, bottom: 34 }, MENU_W, VW)
    expect(left).toBe(8)
  })

  it('keeps the whole menu inside the right edge', () => {
    const { left } = fileMenuAnchor({ left: 300, bottom: 34 }, MENU_W, VW)
    expect(left).toBe(VW - MENU_W - 8)
    expect(left + MENU_W).toBeLessThanOrEqual(VW)
  })

  it('a menu wider than the viewport starts at the left margin', () => {
    expect(fileMenuAnchor({ left: 50, bottom: 34 }, 500, VW).left).toBe(8)
  })
})
