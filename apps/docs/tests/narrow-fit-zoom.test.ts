import { describe, expect, it } from 'vitest'
import {
  NARROW_FIT_MIN_ZOOM,
  NARROW_FIT_PANE_PX,
  widthFitZoom,
} from '../src/renderer/narrow-viewport'

describe('width-fit zoom in a narrow pane', () => {
  it('keeps a readable floor at phone width instead of a 29 % thumbnail', () => {
    expect(widthFitZoom(29, 390)).toBe(NARROW_FIT_MIN_ZOOM)
    expect(widthFitZoom(42, 390)).toBe(NARROW_FIT_MIN_ZOOM)
  })
  it('keeps a fit that is already above the floor', () => {
    expect(widthFitZoom(75, 560)).toBe(75)
  })
  it('does not touch the fit above the narrow breakpoint (the page never overflows there)', () => {
    expect(widthFitZoom(45, NARROW_FIT_PANE_PX + 1)).toBe(45)
    expect(widthFitZoom(45, 1200)).toBe(45)
  })
})
