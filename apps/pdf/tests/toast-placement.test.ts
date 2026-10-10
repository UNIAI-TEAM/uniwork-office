/**
 * P-N2 (visual round 3): the "use the app" toast sat centred on the window, over the AI panel's
 * composer, and its "Open in app" action wrapped to two lines. Source assertions (the toasts live
 * inside the full App, too heavy to mount): with the AI panel open the toasts centre on the
 * document area, and an action never wraps.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')
const panel = readFileSync(join(__dirname, '../src/renderer/ai/AiPanel.tsx'), 'utf8')

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

describe('toast placement beside the AI panel', () => {
  it('centres on the document area while the panel is open', () => {
    expect(rule('.app-main:has(.ai-dock:not(.collapsed)) .pdf-toast')).toMatch(
      /left:\s*calc\(50% \+ var\(--ai-panel-width, 360px\) \/ 2\)/,
    )
  })

  it('publishes the panel width on the container that holds the toasts', () => {
    expect(panel).toMatch(/closest\('\.app-main'\)/)
    expect(panel).toMatch(/main\?\.style\.setProperty\('--ai-panel-width'/)
  })

  it('keeps a toast action on one line', () => {
    expect(rule('.pdf-toast button')).toMatch(/white-space:\s*nowrap/)
    expect(rule('.pdf-toast button')).toMatch(/flex-shrink:\s*0/)
  })
})
