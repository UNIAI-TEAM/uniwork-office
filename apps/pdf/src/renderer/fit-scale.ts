/** pane width (px) at or below which a width-fit zoom keeps a readable floor instead of shrinking
    the page to a thumbnail (same numbers as the Docs renderer's narrow-pane fit) */
export const NARROW_FIT_PANE_PX = 600
/** the lowest width-fit scale in such a narrow pane: 11 pt text stays about 9 px; the page scrolls sideways */
export const NARROW_FIT_MIN_SCALE = 0.6

/** a pane this narrow gives the page the whole width: no thumbnail strip by default, slim scroll padding */
export function narrowPane(paneWidthPx: number): boolean {
  return paneWidthPx <= NARROW_FIT_PANE_PX
}

/** width-fit scale for a pane: the raw ratio, lifted to the readable floor in a narrow pane.
    Page-fit is an explicit "whole page" choice and keeps its raw ratio. */
export function widthFitScale(rawScale: number, paneWidthPx: number): number {
  return paneWidthPx <= NARROW_FIT_PANE_PX ? Math.max(rawScale, NARROW_FIT_MIN_SCALE) : rawScale
}
