import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * G5-06u-TS: the compact strip's CSS (tabbar.css). jsdom has no layout and no zoom, so these pin the
 * rules as text; the pixels are measured in the real shell. The tab metrics the compact minimum is
 * built from are tokens declared once on `.tab-strip`, so the minimum is never a new number.
 */

const css = readFileSync(resolve(__dirname, '../src/renderer/src/tabbar.css'), 'utf8').replace(
  /\r\n/g,
  '\n',
)

/** the body of the first rule whose selector line is exactly `selector` */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[{}]|\\*/)\\s*${escaped} \\{`).exec(css)
  expect(match, selector).not.toBeNull()
  const start = match!.index + match![0].length
  return css.slice(start, css.indexOf('}', start))
}

const COMPACT = ".tab-bar[data-strip='compact']"

describe('the tab metrics are tokens', () => {
  it('.tab-strip declares --tab-min, --tab-close-size and --tab-gap with the values the tabs had', () => {
    const strip = rule('.tab-strip')
    expect(strip).toMatch(/--tab-min:\s*104px;/)
    expect(strip).toMatch(/--tab-close-size:\s*16px;/)
    expect(strip).toMatch(/--tab-gap:\s*8px;/)
  })

  it('.tab-item and .tab-close read them', () => {
    const item = rule('.tab-item')
    expect(item).toMatch(/min-width:\s*var\(--tab-min\);/)
    expect(item).toMatch(/gap:\s*var\(--tab-gap\);/)
    const close = rule('.tab-close')
    expect(close).toMatch(/width:\s*var\(--tab-close-size\);/)
    expect(close).toMatch(/height:\s*var\(--tab-close-size\);/)
  })
})

describe('the compact strip', () => {
  it('Home shows its icon only: the title is visually hidden (still in the DOM), the padding symmetric', () => {
    const title = rule(`${COMPACT} .tab-home .tab-title`)
    expect(title).toMatch(/position:\s*absolute;/)
    expect(title).toMatch(/width:\s*1px;/)
    expect(title).toMatch(/height:\s*1px;/)
    expect(title).toMatch(/overflow:\s*hidden;/)
    expect(title).toMatch(/clip:\s*rect\(0 0 0 0\);/)
    expect(title).not.toMatch(/display:\s*none/)
    expect(title).not.toMatch(/visibility:\s*hidden/)
    expect(rule(`${COMPACT} .tab-item.tab-home`)).toMatch(/padding-right:\s*12px;/)
  })

  it('an inactive document tab is narrower by its close button and the gap before it', () => {
    expect(rule(`${COMPACT} .tab-item:not(.active):not(.tab-home)`)).toMatch(
      /min-width:\s*calc\(var\(--tab-min\)\s*-\s*var\(--tab-close-size\)\s*-\s*var\(--tab-gap\)\);/,
    )
  })

  it("an inactive tab's close is hidden unless focus is inside the tab; the active tab keeps it", () => {
    const close = rule(`${COMPACT} .tab-item:not(.active):not(:focus-within) .tab-close`)
    expect(close).toMatch(/display:\s*none;/)
    // nothing in the compact form touches the active tab or hides a close any other way
    const compactRules = css.split('\n').filter((line) => line.includes(COMPACT))
    expect(compactRules.some((line) => /\.active(?!\))/.test(line))).toBe(false)
    expect(compactRules.filter((line) => line.includes('.tab-close'))).toHaveLength(1)
  })

  it('the compact rules carry geometry only, no raw colour', () => {
    const at = css.indexOf(COMPACT)
    expect(at).toBeGreaterThan(-1)
    const tail = css.slice(at)
    const end = tail.lastIndexOf(COMPACT)
    const block = tail.slice(0, tail.indexOf('}', end) + 1)
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })
})
