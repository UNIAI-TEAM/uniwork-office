/**
 * Canvas chrome colours of the threaded-comment corner markers (CLAUDE.md theming rule 5: canvas
 * affordances come from a constants table keyed by the UI theme, never inline hex in draw calls).
 *
 * The table holds the colours the user sees. Univer paints its grid in dark mode by inverting every
 * canvas fill colour it is handed (`CanvasColorService.getRenderColor` -> `invertColorByMatrix`), so
 * a dark-theme colour handed over as-is came out inverted (the light-blue server marker turned dark
 * blue on the dark grid, V13-2). `threadMarkerPaint` hands Univer the pre-image instead: the matrix
 * inversion is its own inverse, so the screen shows the table colour.
 */
import { invertColorByMatrix } from '@univerjs/core'

/** what the screen shows, per UI theme: in-file thread (Excel purple) and server comment (blue) */
export const THREAD_MARKER_CANVAS_COLORS = {
  light: { marker: '#7b3fe4', server: '#1a73e8' },
  dark: { marker: '#a78bfa', server: '#8ab4f8' },
} as const

/** corner triangle sizes (px): the display-only server marker is a size larger to read at 1x */
export const THREAD_MARKER_SIZES = { thread: 6, server: 8 } as const

export type ThreadMarkerTheme = keyof typeof THREAD_MARKER_CANVAS_COLORS
export type ThreadMarkerKind = keyof typeof THREAD_MARKER_SIZES

const hexOf = (rgb: readonly number[]): string =>
  `#${rgb.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`

const rgbOf = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** the marker to hand Univer's cell interceptor for `theme` (its dark mode inverts it back) */
export function threadMarkerPaint(
  theme: ThreadMarkerTheme,
  kind: ThreadMarkerKind,
): { color: string; size: number } {
  const shown = THREAD_MARKER_CANVAS_COLORS[theme][kind === 'thread' ? 'marker' : 'server']
  const color = theme === 'dark' ? hexOf(invertColorByMatrix(rgbOf(shown))) : shown
  return { color, size: THREAD_MARKER_SIZES[kind] }
}
