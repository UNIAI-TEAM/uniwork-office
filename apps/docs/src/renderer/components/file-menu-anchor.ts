// UNI-1931 (SVF-1): at phone width the ribbon's tab row is a sideways scroller and the File menu is
// `position: fixed` (styles.css, max-width 700px) so the row does not clip it. A fixed box with auto
// offsets keeps the unscrolled static position, so Ribbon measures the File tab instead and anchors
// the menu from that rectangle.

/** the viewport width at and below which the tab row scrolls and the File menu is fixed */
export const FILE_MENU_FIXED_QUERY = '(max-width: 700px)'

const EDGE = 8
const GAP = 2

/**
 * Fixed-position offsets for the File menu: under the File tab, its left edge on the tab's, clamped
 * so the whole menu stays inside the viewport (a tab scrolled partly or fully off-screen puts the
 * menu at the viewport's edge, not off it).
 */
export function fileMenuAnchor(
  tab: { left: number; bottom: number },
  menuWidth: number,
  viewportWidth: number,
): { left: number; top: number } {
  const left = Math.max(EDGE, Math.min(tab.left, viewportWidth - menuWidth - EDGE))
  return { left, top: tab.bottom + GAP }
}

/**
 * The anchor is measured once when the menu opens, so a viewport change while it is open (rotation,
 * split-view drag, window resize) would leave it at stale offsets, or, past the breakpoint, at
 * viewport coordinates inside a now-absolute box. Close it on `resize`, like it closes on scroll.
 * Returns the cleanup.
 */
export function closeOnResize(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  close: () => void,
): () => void {
  target.addEventListener('resize', close)
  return () => target.removeEventListener('resize', close)
}
