/**
 * Narrow-viewport layout of the AI dock (UNI-1016 S-03). Below this width a docked 280-360 px panel
 * would leave the grid a sliver (390 px phone: ~30 px), so the panel starts collapsed and, once the
 * user opens it, overlays the grid instead of taking a grid column (styles.css, same breakpoint).
 * 719 = one pixel under the desktop window's minimum width (720, sheets-main.ts): only the web
 * frame can be this narrow, the desktop layout is unchanged.
 */
export const NARROW_VIEWPORT_MAX_PX = 719

export const NARROW_VIEWPORT_QUERY = `(max-width: ${NARROW_VIEWPORT_MAX_PX}px)`

export function isNarrowViewport(): boolean {
  try {
    return window.matchMedia(NARROW_VIEWPORT_QUERY).matches
  } catch {
    return false
  }
}
