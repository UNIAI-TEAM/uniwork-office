/**
 * D-N3 (visual round 3): inside the Zotero popover (.layout-menu) the menu-row button rules
 * stripped "Open in app" down to plain text, and in the Protect dialog the button touched the next
 * label while the password pair's inputs sat at different heights. Source assertions on the
 * stylesheet (jsdom does not compute the cascade).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')

function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

describe('app-only note styling', () => {
  it('keeps the Open-in-app button a filled primary inside a ribbon popover', () => {
    const r = rule('.app-only-note .btn-primary.app-only-open')
    expect(r).toMatch(/background:\s*var\(--docs-accent-fill\)/)
    expect(r).toMatch(/color:\s*var\(--docs-on-accent\)/)
    expect(r).toMatch(/width:\s*auto/)
    expect(rule('.app-only-note .btn-primary.app-only-open:not(:disabled):hover')).toMatch(
      /--docs-accent-fill-hover/,
    )
  })

  it('leaves air under the note in the Protect dialog and end-aligns the password pair', () => {
    expect(rule('.protect-dialog .app-only-note')).toMatch(/margin-bottom:\s*\d+px/)
    expect(rule('.gs-form .fld-row')).toMatch(/align-items:\s*end/)
  })
})
