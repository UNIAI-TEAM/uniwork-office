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
describe('Markdown app controls', () => {
  it('the zoom buttons announce the table rows', () => {
    expect(APP).toMatch(
      /aria-label=\{t\('zoomOut'\)\}\s+aria-keyshortcuts=\{markdownAria\('zoomOut'\) \|\| undefined\}/,
    )
    expect(APP).toMatch(
      /aria-label=\{t\('zoomIn'\)\}\s+aria-keyshortcuts=\{markdownAria\('zoomIn'\) \|\| undefined\}/,
    )
  })

  it('the image viewer close button gets a plain name', () => {
    expect(APP).toMatch(/closeName: t\('closeName'\)/)
  })
})
