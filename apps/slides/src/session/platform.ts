/**
 * Platform services the session core needs but must not import itself: the session
 * module is bundled into the web frame as well as Electron main, so anything that
 * reaches Node, Electron or the machine's font files is injected here by the host
 * (Electron main configures it from session-state.ts; the web frame from its bridge).
 */
import {
  HeuristicMetrics,
  type FontMetricsProvider,
  type RenderSlide,
} from '@genoffice/pptx-render'

/** Push notifications from the session to the renderer(s) attached to it. */
export interface SessionEventSink {
  /** slides:history-changed — the undo/redo button states of every attached client */
  historyChanged(clientIds: number[], state: { canUndo: boolean; canRedo: boolean }): void
  /** slides:deck-changed — full render state for a session shared by two or more clients */
  deckChanged(
    clientIds: number[],
    payload: { slides: RenderSlide[]; size: { cx: number; cy: number } },
  ): void
}

export interface DecodedImage {
  png: Uint8Array
  width: number
  height: number
}

export interface SessionPlatform {
  /** Text metrics for layout (desktop: system font files; web: canvas measurement). */
  createFontMetrics(): FontMetricsProvider
  /** TIFF → PNG for display (Chromium cannot decode TIFF); null when unsupported. */
  decodeTiff(bytes: Uint8Array): DecodedImage | null
  /** Run after the current task (coalesces history/deck notifications). */
  defer(fn: () => void): void
  events: SessionEventSink
}

const platform: SessionPlatform = {
  createFontMetrics: () => new HeuristicMetrics(),
  decodeTiff: () => null,
  defer: (fn) => void setTimeout(fn, 0),
  events: { historyChanged: () => {}, deckChanged: () => {} },
}

export function configureSessionPlatform(next: Partial<SessionPlatform>): void {
  Object.assign(platform, next)
  fontMetrics = null
}

export function sessionPlatform(): SessionPlatform {
  return platform
}

/** Text metrics (lazily built, shared by every session; unmatched fonts fall back to heuristics per run). */
let fontMetrics: FontMetricsProvider | null = null
export function getFontMetrics(): FontMetricsProvider {
  if (!fontMetrics) fontMetrics = platform.createFontMetrics()
  return fontMetrics
}

/** Drop the cached metrics so the next layout rebuilds them (font store changed). */
export function resetFontMetricsCache(): void {
  fontMetrics = null
}
