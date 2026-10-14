/**
 * G8-13 (UNI-1408), V13-1: in the web frame a bar above the app (the Discussion document bar, or
 * the new-version bar) makes the page a column and `#root` the remaining height. The Sheets shell
 * was `100vh` tall regardless, so it overflowed by the bar's height and the status bar + sheet tabs
 * were clipped. The shell must take the remaining height there, scoped to Sheets (the Markdown /
 * HTML frames load the same shared bar CSS and keep their own layout). Also: the "save first" line
 * sits inside the panel, the panel wrapper owns the floating box.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
const SHEETS_CSS = read('src/renderer/styles.css')
const DISCUSSION_CSS = read('../../web/modules/shared/discussion/discussion.css')
const REMOTE_BAR_CSS = read('../../web/modules/shared/remote-bar.css')

/** the declarations of the first rule whose selector list contains `selector` */
function rule(css: string, selector: string): string | null {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(',').map((s) => s.trim())
    if (selectors.includes(selector)) return m[2]!
  }
  return null
}

describe('the Sheets shell fits under a frame bar (V13-1)', () => {
  for (const bar of ['uw-disc-on', 'uw-remote-bar-on']) {
    it(`html.${bar}: the body is the viewport and the shell the remaining height`, () => {
      expect(rule(SHEETS_CSS, `html.${bar} body`)).toMatch(/(^|;)\s*height:\s*100vh/)
      expect(rule(SHEETS_CSS, `html.${bar} .app-shell`)).toMatch(/(^|;)\s*height:\s*100%/)
    })
  }

  it('outside a frame bar the shell keeps the full viewport height (desktop unchanged)', () => {
    expect(rule(SHEETS_CSS, '.app-shell')).toMatch(/height:\s*100vh/)
  })

  it('the shared bar CSS stays as Markdown / HTML use it (the fix lives in the Sheets sheet only)', () => {
    for (const css of [DISCUSSION_CSS, REMOTE_BAR_CSS]) {
      expect(css).not.toContain('app-shell')
    }
    expect(rule(DISCUSSION_CSS, 'html.uw-disc-on #root')).toMatch(/flex:\s*1 1 0/)
    expect(rule(DISCUSSION_CSS, 'html.uw-disc-on body')).not.toMatch(/height/)
  })
})

describe('the server panel box (V13-1 save-first line)', () => {
  it('the wrapper floats; the kit panel fills it; the save-first line sits under it', () => {
    expect(rule(SHEETS_CSS, '.sheets-server-comments')).toMatch(/position:\s*fixed/)
    expect(rule(SHEETS_CSS, '.sheets-server-comments')).toMatch(/flex-direction:\s*column/)
    expect(rule(SHEETS_CSS, '.sheets-server-comments .sheets-server-panel')).toMatch(
      /min-height:\s*0/,
    )
    expect(rule(SHEETS_CSS, '.sheets-server-comments .sheets-server-save-first')).toMatch(
      /border-top:\s*1px solid var\(--warning-border\)/,
    )
  })
})
