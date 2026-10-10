import { describe, expect, it } from 'vitest'
import {
  NARROW_FIT_MIN_SCALE,
  NARROW_FIT_PANE_PX,
  narrowPane,
  widthFitScale,
} from '../src/renderer/fit-scale'

describe('width-fit scale floor', () => {
  it('a 390 px pane never opens below the readable floor (was 26 %)', () => {
    // 390 px pane, 24 px scroll padding both sides, A4 width 595 pt with the 150 px sidebar open
    const raw = (390 - 150 - 48) / 595
    expect(raw).toBeLessThan(0.35)
    expect(widthFitScale(raw, 390)).toBe(NARROW_FIT_MIN_SCALE)
  })

  it('keeps a raw ratio above the floor in a narrow pane', () => {
    expect(widthFitScale(0.8, 390)).toBe(0.8)
  })

  it('the floor applies up to and including the 600 px boundary only', () => {
    expect(widthFitScale(0.4, NARROW_FIT_PANE_PX)).toBe(NARROW_FIT_MIN_SCALE)
    expect(widthFitScale(0.4, NARROW_FIT_PANE_PX + 1)).toBe(0.4)
  })
})

describe('narrow pane', () => {
  it('is the same boundary as the width-fit floor', () => {
    expect(narrowPane(390)).toBe(true)
    expect(narrowPane(NARROW_FIT_PANE_PX)).toBe(true)
    expect(narrowPane(NARROW_FIT_PANE_PX + 1)).toBe(false)
  })
})
