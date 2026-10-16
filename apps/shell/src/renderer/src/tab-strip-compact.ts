/**
 * When the tab strip takes its compact form (G5-06u-TS, V6u8-02). At UI scale 1.25 a 722px window
 * holds 578 CSS px of tab bar, and Home with three document tabs at their minimum leaves the third
 * tab's label out of the strip. The compact form (tabbar.css, `.tab-bar[data-strip='compact']`)
 * draws Home as its icon and drops the close button of the inactive document tabs, which keeps
 * every label readable there.
 *
 * The form is read off the window width, the interface scale and the tab count only, never off a
 * rect of the strip, the pill holder or the pill: the pill's steps follow the strip, so a form that
 * followed them back could flip-flop.
 */

/**
 * Below this many CSS px of tab bar the strip is compact. It equals the window's `minWidth`
 * (`main/index.ts`), so at scale 1 the bar is never this narrow and the strip never changes form.
 */
export const TAB_STRIP_COMPACT_BELOW_PX = 720

export interface CompactStripInput {
  /** the tab bar's width in CSS px of the zoomed frame (window px / interface scale) */
  barCss: number
  /** the document tabs open in the strip (Home not counted) */
  docTabs: number
}

/** one document tab fits beside Home at every scale step: only two or more need the compact form */
export function compactStripOf(input: CompactStripInput): boolean {
  return (
    Number.isFinite(input.barCss) && input.barCss < TAB_STRIP_COMPACT_BELOW_PX && input.docTabs >= 2
  )
}
