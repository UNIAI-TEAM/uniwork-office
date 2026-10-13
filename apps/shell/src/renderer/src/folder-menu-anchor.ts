/**
 * A folder menu is `position: fixed` at coordinates taken when it opened, so it
 * does not follow its row when a list scrolls. A scroll event is not proof that
 * the row moved: it is dispatched on the next frame, so it can report a layout
 * change that happened before the click that opened the menu. The menu therefore
 * compares where its row is now with where it was when the menu was drawn.
 */

export interface Box {
  top: number
  left: number
  bottom: number
  right: number
}

/** movement below this is rounding, not a scroll */
const EPSILON = 0.5

/**
 * What the open menu does after a scroll event:
 * - 'stay': the row did not move, nothing to do
 * - {dx, dy}: the row moved but is still visible in every box that clips it
 *   (the window and each scrollable list around it): the menu moves with it
 * - 'close': the row is gone or scrolled out of view
 */
export function followMenuAnchor(
  opened: Box,
  now: Box | null,
  clips: readonly Box[],
): 'stay' | 'close' | { dx: number; dy: number } {
  if (!now) return 'close'
  const dx = now.left - opened.left
  const dy = now.top - opened.top
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return 'stay'
  for (const clip of clips) {
    if (
      now.top < clip.top ||
      now.bottom > clip.bottom ||
      now.left < clip.left ||
      now.right > clip.right
    ) {
      return 'close'
    }
  }
  return { dx, dy }
}

const toBox = (rect: DOMRect): Box => ({
  top: rect.top,
  left: rect.left,
  bottom: rect.bottom,
  right: rect.right,
})

/** the window plus every scrollable ancestor of `el`, as boxes the row must stay inside */
export function clipBoxesOf(el: Element): Box[] {
  const boxes: Box[] = [{ top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth }]
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(parent)
    if (/(auto|scroll|hidden|clip)/.test(overflowX + overflowY)) {
      boxes.push(toBox(parent.getBoundingClientRect()))
    }
  }
  return boxes
}

export const boxOf = (el: Element): Box => toBox(el.getBoundingClientRect())
