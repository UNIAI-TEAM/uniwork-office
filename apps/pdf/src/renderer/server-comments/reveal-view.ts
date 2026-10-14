/**
 * G8-15 fix r1: where the page viewer scrolls and how big the comment frame draws when a thread's
 * rect is shown. Pure geometry (CSS px), so jsdom can test what it cannot lay out.
 */

/** the smallest side of a comment frame on screen, so a point-sized anchor stays visible at any zoom */
export const MIN_COMMENT_FRAME_PX = 24

export interface CssBox {
  left: number
  top: number
  width: number
  height: number
}

/** the frame's CSS box: grown to the minimum side from the same top-left corner (the anchor is unchanged) */
export function commentFrameBox(box: CssBox, min = MIN_COMMENT_FRAME_PX): CssBox {
  return {
    left: box.left,
    top: box.top,
    width: Math.max(box.width, min),
    height: Math.max(box.height, min),
  }
}

/**
 * The scrollLeft that brings `[left, left + width]` (scroller content coordinates) into a viewport
 * `viewWidth` wide, with `pad` of air; unchanged when it is already in view. A rect wider than the
 * viewport lines up with its left edge.
 */
export function scrollLeftToReveal(o: {
  scrollLeft: number
  viewWidth: number
  left: number
  width: number
  pad?: number
}): number {
  const pad = o.pad ?? 16
  let next = o.scrollLeft
  const right = o.left + o.width
  if (right + pad > next + o.viewWidth) next = right + pad - o.viewWidth
  if (o.left - pad < next) next = o.left - pad
  return Math.max(0, next)
}

/**
 * Runs `run` again each time `el` is resized, for `ms` (default 800), so a reveal that also opens the
 * comments panel lands its sideways scroll after the panel has narrowed the viewer. Returns a stop
 * function; a no-op where `ResizeObserver` does not exist.
 */
export function rerunOnResize(el: Element, run: () => void, ms = 800): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  const ro = new ResizeObserver(() => run())
  const stop = () => {
    ro.disconnect()
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  ro.observe(el)
  timer = setTimeout(stop, ms)
  return stop
}
