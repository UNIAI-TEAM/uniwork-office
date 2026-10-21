import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom cannot measure layout, so the one-scroller rule of the Documents screen (UNI-2047 W3) is
// pinned as CSS rule text. The page has exactly one vertical scroller, `.dh-main`; its pane
// `.content.home-uw-pane` clips. Each row's path line carries a screen-reader label
// (`.uw-sr-only`, position:absolute). With no positioned box between it and `.app-frame-content`,
// that label escaped the `.dh-main` clip and stretched the document itself, drawing a second
// (window) scrollbar beside the list's own.
const read = (rel: string) =>
  readFileSync(resolve(__dirname, '../src/renderer/src', rel), 'utf8').replace(/\r\n/g, '\n')
const documentsHomeCss = read('uniwork-home/documents-home.css')
const homeCss = read('home.css')

/** the body of the first rule whose selector list is exactly `selector` (not `selector:hover` etc.) */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[{}]|\\*/)\\s*${escaped} \\{([^}]*)\\}`).exec(css)
  expect(match, selector).not.toBeNull()
  return match![1]!
}

describe('the Documents screen draws one vertical scrollbar (W3)', () => {
  it('the main column is the only scroller; its pane clips', () => {
    expect(rule(documentsHomeCss, '.dh-main')).toMatch(/overflow-y:\s*auto/)
    expect(rule(homeCss, '.content.home-uw-pane')).toMatch(/overflow:\s*hidden/)
  })

  it('the sr-only path label is anchored inside the scroller, not on the app frame', () => {
    // the label is taken out of flow, so its row path line must be its containing block
    expect(rule(homeCss, '.uw-sr-only')).toMatch(/position:\s*absolute/)
    expect(rule(documentsHomeCss, '.dh-doc-subpath')).toMatch(/position:\s*relative/)
  })
})
