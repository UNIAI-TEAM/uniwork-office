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
    expect(skinCss).not.toMatch(
      /ai-step-title[^{]*:focus-visible|ai-work-group-summary[^{]*:focus-visible/,
    )
    expect(rule(appCss, '.ai-step-title.clickable:focus-visible')).toMatch(
      /outline:\s*2px solid var\(--color-border-brand\)/,
    )
    expect(rule(appCss, '.ai-work-group-summary:focus-visible')).toMatch(
      /outline:\s*2px solid var\(--color-border-brand\)/,
    )
  })
})

/* ---- visual r4 S-1 / S-2: AA contrast of the work-group summary and the docs result chip ---- */
const tokensCss = readFileSync(join(__dirname, '../../../packages/ui/src/tokens.css'), 'utf8')

/** The declarations of the first block that starts with `header` in `css` (flat blocks only). */
function block(css: string, header: string): string {
  const start = css.indexOf(`\n${header} {`)
  expect(start, `block ${header}`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}', start))
}

function tokenValue(decls: string, name: string): string {
  const m = decls.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))
  expect(m, `token ${name}`).not.toBeNull()
  return m![1]
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The `var(--x)` a rule gives `color`, resolved against the light / dark token blocks. */
function colorToken(decl: string): string {
  const m = decl.match(/(?:^|[\s;{])color:\s*var\((--[\w-]+)\)/)
  expect(m, 'color: var(--token)').not.toBeNull()
  return m![1]
}

const light = { shared: block(tokensCss, ':root'), docs: block(appCss, ':root') }
const dark = {
  shared: block(tokensCss, "[data-theme='dark']"),
  docs: block(appCss, "[data-theme='dark']"),
}

describe('AA contrast of the AI panel group summary and the docs result chip (visual r4 S-1 / S-2)', () => {
  it('S-1: the skin gives the interactive work-group summary the secondary text token, hover goes primary', () => {
    const summary = rule(skinCss, ':is(.ai-panel, .copilot) .ai-work-group-summary')
    expect(colorToken(summary)).toBe('--color-text-secondary')
    const hover = rule(skinCss, ':is(.ai-panel, .copilot) .ai-work-group-summary:hover')
    expect(colorToken(hover)).toBe('--color-text-primary')
  })

  it('S-1: that token reads >= 4.5:1 on the page surface in light and in dark', () => {
    const token = '--color-text-secondary'
    const page = '--color-bg-page'
    expect(
      contrast(tokenValue(light.shared, token), tokenValue(light.shared, page)),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(tokenValue(dark.shared, token), tokenValue(dark.shared, page)),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('S-1: no app stylesheet re-sets the summary lighter than the skin at higher specificity', () => {
    for (const app of ['docs', 'markdown', 'html', 'pdf', 'sheets', 'slides']) {
      const css = readFileSync(join(__dirname, `../../${app}/src/renderer/styles.css`), 'utf8')
      for (const m of css.matchAll(/([^{}]*\.ai-work-group-summary[^{}]*)\{([^}]*)\}/g)) {
        if (/color-text-tertiary/.test(m[2])) {
          // an app rule may keep the old tertiary colour only at (0,1,0): the skin (0,2,0) outranks it
          expect(m[1].trim(), `${app} summary rule`).toBe('.ai-work-group-summary')
        }
      }
    }
  })

  it('S-2: the docs "ok" result chip uses the darker existing green and reads >= 4.5:1 in light and dark', () => {
    const chip = rule(appCss, ".ai-result-chip[data-tone='ok']")
    expect(colorToken(chip)).toBe('--docs-ins-ink')
    expect(chip).toMatch(/background:\s*var\(--docs-ok-bg\)/)
    expect(
      contrast(tokenValue(light.docs, '--docs-ins-ink'), tokenValue(light.docs, '--docs-ok-bg')),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(tokenValue(dark.docs, '--docs-ins-ink'), tokenValue(dark.docs, '--docs-ok-bg')),
    ).toBeGreaterThanOrEqual(4.5)
  })
})

describe('status bar zoom button focus ring in dark (UNI-1876 SVF-8)', () => {
  it('gives .zoom-btn, .zoom-value, .status-btn, and .status-view-btn a visible 2px focus-visible ring', () => {
    const ring = rule(
      appCss,
      '.status-bar :is(.status-btn, .status-view-btn, .zoom-btn, .zoom-value):focus-visible',
    )
    expect(ring).toMatch(/outline:\s*2px solid var\(--accent\)/)
    expect(ring).toMatch(/outline-offset:\s*1px/)
  })
})
