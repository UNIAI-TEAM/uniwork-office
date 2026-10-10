/** width at or below which side panes overlay the page instead of squeezing it (keep in sync with styles.css) */
export const NARROW_VIEWPORT_PX = 900

export function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= NARROW_VIEWPORT_PX
}

/** pane width (px) at or below which a width-fit zoom keeps a readable floor instead of shrinking the page to a thumbnail */
export const NARROW_FIT_PANE_PX = 600
/** the lowest width-fit zoom (%) in such a narrow pane: 11 pt text stays about 9 px; the page scrolls sideways */
export const NARROW_FIT_MIN_ZOOM = 60

/** width-fit zoom (%) for a pane: the raw ratio, lifted to the readable floor in a narrow pane */
export function widthFitZoom(rawFitPercent: number, paneWidthPx: number): number {
  return paneWidthPx <= NARROW_FIT_PANE_PX
    ? Math.max(rawFitPercent, NARROW_FIT_MIN_ZOOM)
    : rawFitPercent
}
