/** width at or below which side panes overlay the page instead of squeezing it (keep in sync with styles.css) */
export const NARROW_VIEWPORT_PX = 900

export function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= NARROW_VIEWPORT_PX
}
