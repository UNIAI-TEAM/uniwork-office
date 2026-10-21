import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom cannot measure layout, so the long-name clipping (UNI-1961 V1) is pinned as CSS rule text.
// The name button lives in a plain block wrapper (`.dh-name-stack`, min-width:0, flex:1) inside the
// flex `.dh-cell-name`, so `flex: 1` / `min-width: 0` on the button do nothing there: an inline-block
// button sizes to its text and prints over the next grid column unless it is a block capped at its
// wrapper's width.
const css = readFileSync(
  resolve(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
  'utf8',
).replace(/\r\n/g, '\n')

/** the body of the rule whose selector list is exactly `selector` (not `selector:hover` etc.) */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[{}]|\\*/)\\s*${escaped} \\{([^}]*)\\}`).exec(css)
  expect(match, selector).not.toBeNull()
  return match![1]!
}

describe('documents table long names stay inside the name column (V1)', () => {
  it('the name button is a block capped at its wrapper so the ellipsis can apply', () => {
    const open = rule('.dh-doc-open')
    expect(open).toMatch(/display:\s*block/)
    expect(open).toMatch(/max-width:\s*100%/)
    expect(open).toMatch(/overflow:\s*hidden/)
    expect(open).toMatch(/text-overflow:\s*ellipsis/)
    expect(open).toMatch(/white-space:\s*nowrap/)
  })

  it('the name cell is a grid item that may shrink below its content (all row contexts)', () => {
    expect(rule('.dh-cell-name')).toMatch(/min-width:\s*0/)
    // every list screen (the shelf and the trash included) draws on the same grid-row rule
    expect(rule('.dh-doc-head,\n.dh-doc-row')).toMatch(/display:\s*grid/)
    expect(rule('.dh-name-stack')).toMatch(/min-width:\s*0/)
  })

  it('a folder row title clips with an ellipsis like the name button', () => {
    const title = rule('.dh-doc-title')
    expect(title).toMatch(/text-overflow:\s*ellipsis/)
    expect(title).toMatch(/overflow:\s*hidden/)
  })
})
