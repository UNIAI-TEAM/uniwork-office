/**
 * The shared AI panel skin (packages/ui/src/ai-panel.css) is imported after styles.css and
 * outranks the per-app panel rules. Two places where it met the G6-09 panel work:
 *  - the skin lets the Track pill label ellipsize so Send never leaves the box; the forced-tracking
 *    wrapper (.ai-track-wrap) sits between the footer and that pill, so it has to shrink too;
 *  - the skin fades the log's top and bottom edge, so a keyboard-focused step title or work-group
 *    summary (2px brand ring) must be scrolled clear of the fade, not into it.
 * Source assertions on the stylesheets (jsdom does not compute the cascade).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')
const skinCss = readFileSync(join(__dirname, '../../../packages/ui/src/ai-panel.css'), 'utf8')

function rule(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

describe('shared AI panel skin vs the G6-09 panel rules (docs)', () => {
  it('the skin still ellipsizes the Track pill label, so its wrapper may not be a fixed width', () => {
    const btn = rule(skinCss, ':is(.ai-panel, .copilot) .ai-track-btn')
    expect(btn).toMatch(/flex-shrink:\s*1/)
    expect(btn).toMatch(/min-width:\s*0/)
    const wrap = rule(appCss, '.ai-track-wrap')
    expect(wrap).not.toMatch(/flex-shrink:\s*0/)
    expect(wrap).toMatch(/flex-shrink:\s*1/)
    expect(wrap).toMatch(/min-width:\s*0/)
  })

  it('the forced pill keeps the pointer on its wrapper (tip) and no skin rule re-enables the button', () => {
    expect(rule(appCss, '.ai-track-wrap.forced .ai-track-btn')).toMatch(/pointer-events:\s*none/)
    expect(skinCss).not.toMatch(/pointer-events/)
  })

  it('a focused row scrolls clear of the log fade the skin paints at its top and bottom edge', () => {
    const chat = rule(skinCss, ':is(.ai-panel, .copilot) .ai-chat')
    const fade = chat.match(/transparent,\s*black\s*(\d+)px,\s*black\s*calc\(100% - (\d+)px\)/)
    expect(fade, 'mask fade').not.toBeNull()
    const pad = chat.match(/scroll-padding-block:\s*(\d+)px/)
    expect(pad, 'scroll-padding-block').not.toBeNull()
    expect(Number(pad![1])).toBeGreaterThanOrEqual(Math.max(Number(fade![1]), Number(fade![2])))
  })

  it('the skin does not restyle the step-title / work-group-summary focus ring', () => {
    expect(skinCss).not.toMatch(/ai-step-title|ai-work-group-summary/)
    expect(rule(appCss, '.ai-step-title.clickable:focus-visible')).toMatch(
      /outline:\s*2px solid var\(--color-border-brand\)/,
    )
    expect(rule(appCss, '.ai-work-group-summary:focus-visible')).toMatch(
      /outline:\s*2px solid var\(--color-border-brand\)/,
    )
  })
})
