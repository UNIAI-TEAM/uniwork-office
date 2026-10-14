/**
 * G8-15 FX15d (V15c-01): keep the page viewer usable when the comments panel opens in a narrow
 * window. App-local on purpose (the Slides renderer has its own copy of the same rule).
 *
 * The AI dock is 360 px, the thumbnail strip 150 px and the comments panel up to 340 px (45% of the
 * content area, whichever is smaller). At 900 px that leaves a 144 px viewer. Below
 * `AI_DOCK_COLLAPSE_BELOW_PX` the dock collapses to its 34 px rail while the panel is open: the same
 * collapsed state the user can toggle. It is derived, never written to the stored preference, so
 * closing the panel or widening the window brings the dock back.
 */
import { useCallback, useEffect, useState } from 'react'
import { SIDEBAR_W_DEFAULT } from './view-config'

/** the AI dock's expanded and collapsed widths (styles.css `.ai-dock`) */
export const AI_DOCK_W = 360
export const AI_DOCK_RAIL_W = 34
/** the comments panel's width cap and its share of the content area (styles.css `.pdf-server-comments`) */
export const COMMENTS_PANEL_W = 340
const COMMENTS_PANEL_SHARE = 0.45

/**
 * The window width under which the viewer, with the dock expanded and the panel open, is smaller than
 * a width-fit page in a narrow pane (A4 at the 0.6 floor is about 357 px, plus scroll padding, so about
 * 405 px). Expanded, the viewer is `width - 850`: 350 px at 1200 and 590 px at 1440. Collapsed it
 * is `width - 524`, 376 px at 900 and 676 px at 1200.
 */
export const AI_DOCK_COLLAPSE_BELOW_PX = 1200

/** the dock folds away while the comments panel is open in a window narrower than the threshold */
export function aiDockAutoCollapsed(o: { panelOpen: boolean; windowWidth: number }): boolean {
  return o.panelOpen && o.windowWidth < AI_DOCK_COLLAPSE_BELOW_PX
}

/** estimated page-viewer width (CSS px) with the thumbnail strip open, from the same numbers as the CSS */
export function estimatedViewerWidth(o: {
  windowWidth: number
  dockCollapsed: boolean
  panelOpen: boolean
}): number {
  const content = o.windowWidth - (o.dockCollapsed ? AI_DOCK_RAIL_W : AI_DOCK_W)
  const panel = o.panelOpen ? Math.min(COMMENTS_PANEL_W, content * COMMENTS_PANEL_SHARE) : 0
  return content - SIDEBAR_W_DEFAULT - panel
}

export interface AiDockLayout {
  /** what the dock shows right now: the user's choice, or folded by the narrow-window rule */
  collapsed: boolean
  /** the user opens the dock: sets the stored choice open and keeps it open until the rule lifts */
  open: () => void
  /** the user collapses the dock: leaves the stored choice alone while the rule is holding it open */
  collapse: () => void
}

/**
 * `stored` is the user's own collapsed preference (what `rememberAiPanelOpen` persists); this hook only
 * derives the displayed state from it and the window.
 */
export function useAiDockLayout(
  stored: boolean,
  setStored: (collapsed: boolean) => void,
  panelOpen: boolean,
): AiDockLayout {
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const auto = aiDockAutoCollapsed({ panelOpen, windowWidth })
  // the user opened the dock while the rule was folding it: honour that until the rule lifts
  const [pinned, setPinned] = useState(false)
  useEffect(() => {
    if (!auto) setPinned(false)
  }, [auto])
  const collapsed = stored || (auto && !pinned)
  const open = useCallback(() => {
    setStored(false)
    if (auto) setPinned(true)
  }, [auto, setStored])
  const collapse = useCallback(() => {
    if (auto && pinned) setPinned(false)
    else setStored(true)
  }, [auto, pinned, setStored])
  return { collapsed, open, collapse }
}
