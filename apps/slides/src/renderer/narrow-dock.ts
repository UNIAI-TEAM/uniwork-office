/**
 * G8-14 (V14b-01): a narrow window with the comments pane open leaves the slide stage almost no
 * room (900 px: 900 - 120 thumbnails - 360 AI dock - 300 pane = ~120 px, the slide at 10 %). The AI
 * dock then yields: it shows its collapsed rail while the pane is open and the stage would fall
 * under MIN_STAGE_PX, and comes back when the pane closes or the window widens. This is a display
 * state only; the user's stored dock preference is never written by it.
 *
 * App-local on purpose, free of App state so another app (pdf has the same pane + dock layout)
 * can lift it into a shared package later without changes.
 */
import { useEffect, useState } from 'react'

/** the comments pane's CSS width (.comments-pane) */
export const COMMENTS_PANE_PX = 300
/** the expanded AI dock's default CSS width (.ai-dock) */
export const AI_DOCK_PX = 360
/**
 * The least stage width worth working in next to an open pane: 400 px keeps the 56 px stage
 * padding plus a slide of ~27 % zoom (a 16:9 deck still reads at ~345 px) and the AI toolbar
 * unclipped. With the default 120 px thumbnails that puts the switch at a 1180 px window.
 */
export const MIN_STAGE_PX = 400

export interface DockYieldInput {
  /** the comments pane is shown */
  paneOpen: boolean
  windowWidth: number
  /** the thumbnail column's width, 0 when hidden */
  thumbsWidth: number
}

/** the stage width the layout leaves with the AI dock expanded and the pane open */
export function stageWidthWithDock({ windowWidth, thumbsWidth }: DockYieldInput): number {
  return windowWidth - thumbsWidth - AI_DOCK_PX - COMMENTS_PANE_PX
}

/** true when the AI dock should show its collapsed rail for this layout */
export function aiDockShouldYield(input: DockYieldInput): boolean {
  return input.paneOpen && stageWidthWithDock(input) < MIN_STAGE_PX
}

/** the window's inner width, kept current on resize */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}
