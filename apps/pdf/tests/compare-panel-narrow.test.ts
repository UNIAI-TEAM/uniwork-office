// @vitest-environment node
/**
 * The Compare panel lives in the sidebar, which is ~130px wide by default: the pick button's
 * label wraps inside the button (not out of its fixed 32px) and a result row wraps its counts
 * instead of clipping them behind a horizontal scrollbar. Layout cannot be measured in jsdom,
 * so the rules are read from the stylesheet.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(
  fileURLToPath(new URL('../src/renderer/styles.css', import.meta.url)),
  'utf8',
)

const rule = (selector: string): string => {
  const start = CSS.indexOf(`\n${selector} {`)
  expect(start, selector).toBeGreaterThan(0)
  return CSS.slice(start, CSS.indexOf('}', start))
}

describe('Compare panel at a narrow sidebar', () => {
  it('lets the pick button grow with its wrapped label', () => {
    const pick = rule('.pdf-compare-pick')
    expect(pick).toContain('height: auto')
    expect(pick).toContain('min-height: 32px')
    expect(pick).toContain('white-space: normal')
    expect(pick).toContain('max-width: 100%')
  })

  it('wraps the counts of a result row and never scrolls sideways', () => {
    expect(rule('.pdf-compare-row')).toContain('flex-wrap: wrap')
    expect(rule('.pdf-compare')).toContain('overflow-x: hidden')
  })
})
