/**
 * Visual r2 H-04 (390 px): with the AI panel open the preview kept ~110 px, and the status bar
 * squeezed every item into a few letters. jsdom has no layout, so this pins the stylesheet contract
 * (the real widths are measured by the web e2e probes); the rules mirror the Docs frame's.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '..', 'src/renderer/styles.css'), 'utf8')

/** every block of that media query, joined (the stylesheet has more than one per breakpoint) */
function media(query: string): string {
  const head = `@media (${query}) {`
  const blocks: string[] = []
  for (let at = css.indexOf(head); at > -1; at = css.indexOf(head, at + 1)) {
    blocks.push(css.slice(at, css.indexOf('\n}\n', at)))
  }
  expect(blocks.length, head).toBeGreaterThan(0)
  return blocks.join('\n')
}

describe('narrow layout of the HTML frame', () => {
  it('the open AI dock overlays the page below 900 px and fills the row on a phone', () => {
    const tablet = media('max-width: 900px')
    expect(tablet).toMatch(/\.ai-dock \{[^}]*position: absolute;/)
    expect(tablet).toMatch(/\.app-main:has\(> \.ai-dock\) \{\s*padding-left: 34px;/)
    expect(tablet).toMatch(/\.ai-dock\.collapsed \{\s*width: 34px;/)
    expect(media('max-width: 520px')).toMatch(/\.ai-dock:not\(\.collapsed\) \{\s*width: 100%;/)
  })

  it('split stacks on a phone and each pane keeps a usable height', () => {
    const phone = media('max-width: 700px')
    expect(phone).toMatch(/\.workspace\.view-split \{\s*flex-direction: column;/)
    expect(phone).toMatch(/\.view-split \.pane \{[^}]*min-height: 200px;/)
  })

  it('the status bar wraps on a phone, the save state first and the cursor position dropped', () => {
    const phone = media('max-width: 520px')
    expect(phone).toMatch(/\.status-bar \{\s*flex-wrap: wrap;/)
    expect(phone).toMatch(/\.status-save \{\s*order: -1;/)
    expect(phone).toMatch(/\.status-cursor \{\s*display: none;/)
  })
})
