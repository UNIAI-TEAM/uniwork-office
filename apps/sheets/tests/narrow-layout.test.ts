// UNI-1016 S-03: the AI dock's narrow-viewport switch (collapsed start + overlay breakpoint).
import { afterEach, describe, expect, it } from 'vitest'

import {
  NARROW_VIEWPORT_MAX_PX,
  NARROW_VIEWPORT_QUERY,
  isNarrowViewport,
} from '../src/renderer/narrow-layout'

const g = globalThis as { window?: unknown }
const hadWindow = 'window' in g
const previousWindow = g.window

afterEach(() => {
  if (hadWindow) g.window = previousWindow
  else delete g.window
})

describe('isNarrowViewport', () => {
  it('asks the breakpoint query the stylesheet uses', () => {
    const asked: string[] = []
    g.window = {
      matchMedia: (query: string) => {
        asked.push(query)
        return { matches: true }
      },
    }
    expect(isNarrowViewport()).toBe(true)
    expect(asked).toEqual([NARROW_VIEWPORT_QUERY])
    expect(NARROW_VIEWPORT_QUERY).toBe(`(max-width: ${NARROW_VIEWPORT_MAX_PX}px)`)
  })

  it('is false on a wide viewport and when matchMedia is missing', () => {
    g.window = { matchMedia: () => ({ matches: false }) }
    expect(isNarrowViewport()).toBe(false)
    g.window = {}
    expect(isNarrowViewport()).toBe(false)
  })
})
