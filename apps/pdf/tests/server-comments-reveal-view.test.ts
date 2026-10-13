/** G8-15 fix r1 (V15-06, V15-11): the reveal scroll and the minimum frame size, as pure geometry. */
import { describe, expect, it } from 'vitest'
import {
  MIN_COMMENT_FRAME_PX,
  commentFrameBox,
  scrollLeftToReveal,
} from '../src/renderer/server-comments/reveal-view'

describe('scrollLeftToReveal', () => {
  it('leaves the scroll alone when the rect is already in view', () => {
    expect(scrollLeftToReveal({ scrollLeft: 100, viewWidth: 400, left: 200, width: 50 })).toBe(100)
  })

  it('scrolls right until a rect past the right edge is in view with air', () => {
    // 144 px scroller (900 px window with AI dock + thumbnails + panel), frame at x 300..324
    expect(scrollLeftToReveal({ scrollLeft: 0, viewWidth: 144, left: 300, width: 24 })).toBe(196)
  })

  it('scrolls left for a rect before the left edge, and never below 0', () => {
    expect(scrollLeftToReveal({ scrollLeft: 300, viewWidth: 400, left: 120, width: 30 })).toBe(104)
    expect(scrollLeftToReveal({ scrollLeft: 50, viewWidth: 400, left: 4, width: 30 })).toBe(0)
  })

  it('lines a rect wider than the viewport up with its left edge', () => {
    expect(scrollLeftToReveal({ scrollLeft: 0, viewWidth: 100, left: 300, width: 500 })).toBe(284)
  })
})

describe('commentFrameBox', () => {
  it('grows a small frame to the minimum side from the same corner', () => {
    expect(commentFrameBox({ left: 10, top: 20, width: 14, height: 14 })).toEqual({
      left: 10,
      top: 20,
      width: MIN_COMMENT_FRAME_PX,
      height: MIN_COMMENT_FRAME_PX,
    })
  })

  it('leaves a frame that is big enough as it is', () => {
    const big = { left: 1, top: 2, width: 200, height: 40 }
    expect(commentFrameBox(big)).toEqual(big)
  })
})
