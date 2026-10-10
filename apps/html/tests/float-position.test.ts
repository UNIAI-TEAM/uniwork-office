import { describe, expect, it } from 'vitest'
import {
  PANEL_RESERVE,
  floatPosition,
  parseDeclarations,
} from '../src/renderer/document/float-position'

const layout = { zoom: 100, offsetX: 0, offsetY: 0, stageWidth: 1000, barWidth: 300, barHeight: 32 }

describe('floatPosition', () => {
  it('sits above the element in stage coordinates', () => {
    expect(floatPosition({ x: 100, y: 200, width: 50, height: 20 }, layout)).toEqual({
      left: 100,
      top: 162,
      below: false,
      maxWidth: 992,
    })
  })

  it('flips below when there is no room above', () => {
    expect(floatPosition({ x: 10, y: 10, width: 50, height: 20 }, layout)).toEqual({
      left: 10,
      top: 36,
      below: true,
      maxWidth: 992,
    })
  })

  it('scales with zoom and applies the host offset', () => {
    const pos = floatPosition(
      { x: 100, y: 200, width: 50, height: 20 },
      { ...layout, zoom: 50, offsetX: 40, offsetY: 8 },
    )
    expect(pos).toEqual({ left: 90, top: 70, below: false, maxWidth: 992 })
  })

  it('keeps the bar inside the stage', () => {
    expect(floatPosition({ x: 950, y: 200, width: 50, height: 20 }, layout).left).toBe(696)
    expect(floatPosition({ x: -30, y: 200, width: 50, height: 20 }, layout).left).toBe(4)
  })

  it('returns finite in-bounds positions for hostile inputs', () => {
    const hostile = { x: NaN, y: Infinity, width: 50, height: -Infinity }
    const pos = floatPosition(
      hostile as never,
      {
        zoom: NaN,
        offsetX: Infinity,
        offsetY: -Infinity,
        stageWidth: NaN,
        barWidth: Infinity,
        barHeight: NaN,
      } as never,
    )
    expect(Number.isFinite(pos.left)).toBe(true)
    expect(Number.isFinite(pos.top)).toBe(true)
    expect(pos.left).toBeGreaterThanOrEqual(4)
  })
})

describe('floatPosition next to the style panel', () => {
  // 1440 wide stage, panel box 276 + 10 inset: the bar must end left of the panel's edge
  const stageWidth = 1440 - PANEL_RESERVE
  const wide = { ...layout, stageWidth, barWidth: 560 }

  it('the panel reserve covers the whole panel box, not just its width', () => {
    // .hx-panel: width 250 + padding 2 x 12 + border 2, right: 10  ->  286, plus the bar gap
    expect(PANEL_RESERVE).toBeGreaterThanOrEqual(250 + 24 + 2 + 10)
  })

  it('an element at the far right keeps the bar entirely left of the panel', () => {
    const pos = floatPosition({ x: 1300, y: 300, width: 110, height: 20 }, wide)
    expect(pos.left + wide.barWidth).toBeLessThanOrEqual(1440 - (250 + 24 + 2 + 10))
  })

  it('a bar wider than the room left of the panel may wrap instead of running under it', () => {
    const narrow = { ...layout, stageWidth: 520, barWidth: 622 }
    const pos = floatPosition({ x: 400, y: 300, width: 110, height: 20 }, narrow)
    expect(pos.left).toBe(4)
    expect(pos.maxWidth).toBe(512)
  })
})

describe('parseDeclarations', () => {
  it('splits declarations and drops junk', () => {
    expect(parseDeclarations('letter-spacing: 2px; box-shadow: 0 1px 2px #000;; nope; :x')).toEqual(
      {
        'letter-spacing': '2px',
        'box-shadow': '0 1px 2px #000',
      },
    )
  })
})
