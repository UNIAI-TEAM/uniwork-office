import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Visual r1 F2 (RF-5): the citation card was anchored to the marker, so a marker near the line end
 * pushed the 288px card past the window edge (LTR) or off the left edge (RTL). The card now hangs
 * off the answer block (the marker no longer positions it) and never exceeds that block's width.
 * The CSS text is pinned because only a real window shows the pixels.
 */

const css = readFileSync(resolve(__dirname, '../src/ask-uni/ask-uni.css'), 'utf8')

function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  expect(at, `${selector} rule exists`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

describe('Ask UNI citation card placement', () => {
  it('anchors the card to the answer block, not to the marker', () => {
    expect(rule('.askuni-v2-answer')).toMatch(/position:\s*relative;/)
    expect(rule('.askuni-v2-cite-wrap')).toMatch(/position:\s*static;/)
  })

  it('keeps the card at the answer block start, no wider than the block, logical properties only', () => {
    const card = rule('.askuni-v2-cite-card')
    expect(card).toMatch(/position:\s*absolute;/)
    expect(card).toMatch(/inset-inline-start:\s*0;/)
    expect(card).toMatch(/inline-size:\s*min\(288px,\s*100%\);/)
    // the vertical place is the marker's own line (static position), not a % of the block
    expect(card).not.toMatch(/inset-block-start:\s*calc\(100%/)
    expect(card).not.toMatch(/\b(?:left|right|top|bottom|width):/)
    expect(card).not.toMatch(/72vw/)
  })
})
