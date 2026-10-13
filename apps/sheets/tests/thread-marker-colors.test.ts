/**
 * G8-13 (UNI-1408), V13-2: the corner markers on the grid. Univer paints the grid in dark mode by
 * inverting every canvas fill (`CanvasColorService`, `invertColorByMatrix`), so a marker colour
 * handed over as-is comes out inverted: the light-blue server marker turned dark blue on the dark
 * grid and nearly vanished. What reaches the screen must be the table's colour in both themes, at
 * >= 3:1 against the grid (non-text contrast), and the server marker is a size larger.
 */
import { invertColorByMatrix } from '@univerjs/core'
import { describe, expect, it } from 'vitest'

import {
  THREAD_MARKER_CANVAS_COLORS,
  THREAD_MARKER_SIZES,
  threadMarkerPaint,
  type ThreadMarkerTheme,
} from '../src/renderer/thread-marker-colors'

type Rgb = [number, number, number]

const rgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** what Univer puts on the canvas for a fill colour in each theme */
const onScreen = (theme: ThreadMarkerTheme, hex: string): Rgb =>
  theme === 'dark' ? (invertColorByMatrix(rgb(hex)) as Rgb) : rgb(hex)

const luminance = ([r, g, b]: Rgb): number => {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** the grid background: white, which dark mode inverts (plus Univer's dark grey chrome) */
const GRIDS: Record<ThreadMarkerTheme, Rgb[]> = {
  light: [rgb('#ffffff')],
  dark: [onScreen('dark', '#ffffff'), rgb('#1f1f1f')],
}

describe('thread marker colours on the canvas (V13-2)', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const kind of ['marker', 'server'] as const) {
      it(`${theme} ${kind}: the screen shows the table colour at >= 3:1 against the grid`, () => {
        const paint = threadMarkerPaint(theme, kind === 'marker' ? 'thread' : 'server')
        const shown = onScreen(theme, paint.color)
        const wanted = rgb(THREAD_MARKER_CANVAS_COLORS[theme][kind])
        shown.forEach((c, i) =>
          expect(Math.abs(c - wanted[i]!), `${theme} ${kind}`).toBeLessThanOrEqual(3),
        )
        for (const grid of GRIDS[theme]) expect(contrast(shown, grid)).toBeGreaterThanOrEqual(3)
      })
    }
  }

  it('the server marker is large enough to see at 1x and the thread one keeps its size', () => {
    expect(THREAD_MARKER_SIZES.server).toBeGreaterThanOrEqual(8)
    expect(THREAD_MARKER_SIZES.thread).toBe(6)
    expect(threadMarkerPaint('dark', 'server').size).toBe(THREAD_MARKER_SIZES.server)
  })
})
