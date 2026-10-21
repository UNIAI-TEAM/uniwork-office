// @vitest-environment node
/**
 * UNI-2060 follow-up: controls whose tooltip shows no chord still announce their table row
 * (`aria-keyshortcuts`), and every ribbon tab that offers the collapse key announces it too.
 * The App is too big to mount in jsdom, so the wiring is read from its source.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP = readFileSync(fileURLToPath(new URL('../src/renderer/App.tsx', import.meta.url)), 'utf8')
describe('HTML app controls', () => {
  it('the zoom buttons announce the table rows', () => {
    expect(APP).toMatch(
      /aria-label=\{t\('zoomOut'\)\}\s+aria-keyshortcuts=\{htmlAria\('zoomOut'\) \|\| undefined\}/,
    )
    expect(APP).toMatch(
      /aria-label=\{t\('zoomIn'\)\}\s+aria-keyshortcuts=\{htmlAria\('zoomIn'\) \|\| undefined\}/,
    )
  })

  it('Exit presentation is named without its key, Escape in aria-keyshortcuts', () => {
    // the plain name is the button text and the (Esc) hint an aria-hidden span, so the visible
    // label contains the name (WCAG 2.5.3)
    expect(APP).toMatch(
      /className="present-exit"\s+aria-keyshortcuts="Escape"\s+onClick=\{[^\n]*\}\s*>\s*\{t\('presentExitName'\)\}\{' '\}\s*<span aria-hidden="true">\s*\{keyHintAfterName\(t\('presentExit'\), t\('presentExitName'\)\)\}/,
    )
  })
})
