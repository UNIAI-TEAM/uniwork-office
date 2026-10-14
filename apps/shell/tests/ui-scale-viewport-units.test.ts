import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * V2 / V3 (visual-1): `.app-frame` is `zoom: var(--ui-scale)`, and Chromium resolves `vh` / `vw`
 * inside a zoomed box to the real viewport size *before* the zoom multiplies it again. A box sized
 * `100vh` therefore paints `scale x` the window height (Home's footer fell off the bottom, the
 * Settings dialog's title row above the top). Every viewport unit under the frame goes through the
 * `--ui-vh` / `--ui-vw` tokens, which divide by the scale. Only a visual check proves the pixels;
 * these tests pin the CSS text so a raw unit cannot creep back in.
 */

const src = (file: string): string =>
  readFileSync(resolve(__dirname, '../src/renderer/src', file), 'utf8')

/** every declaration line that spends a raw viewport unit, minus the two token definitions */
function rawViewportUnits(css: string): string[] {
  return css
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /\d(?:\.\d+)?d?v[hw]\b/.test(line) && !line.startsWith('--ui-v'))
    .map(({ line, n }) => `${n}: ${line}`)
}

function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  expect(at, `${selector} rule exists`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

describe('viewport tokens under the zoomed frame', () => {
  it('defines --ui-vh and --ui-vw on .app-frame, dividing by the scale', () => {
    const frame = rule(src('tabbar.css'), '.app-frame')
    expect(frame).toMatch(/--ui-vh:\s*calc\(1vh\s*\/\s*var\(--ui-scale,\s*1\)\)/)
    expect(src('tabbar.css')).toMatch(/:root\s*\{\s*--ui-vh:\s*1vh;\s*--ui-vw:\s*1vw;/)
    expect(frame).toMatch(/--ui-vw:\s*calc\(1vw\s*\/\s*var\(--ui-scale,\s*1\)\)/)
  })

  it.each(['home.css', 'settings.css', 'onboarding.css'])(
    '%s spends no raw vh / vw / dvh',
    (file) => {
      expect(rawViewportUnits(src(file))).toEqual([])
    },
  )

  it('V2: Home and the failed-gate frame fill the zoomed viewport minus the tab bar', () => {
    const css = src('home.css')
    for (const selector of ['.home', '.wb-gate-failed']) {
      expect(rule(css, selector)).toMatch(
        /height:\s*calc\(var\(--ui-vh\)\s*\*\s*100\s*-\s*var\(--tab-bar-height,\s*40px\)\)/,
      )
    }
  })

  it('V3: the Settings dialog and its overlay padding use the scaled vh', () => {
    const css = src('settings.css')
    expect(rule(css, '.set-dialog')).toMatch(
      /height:\s*min\(720px,\s*calc\(var\(--ui-vh\)\s*\*\s*90\)\)/,
    )
    expect(rule(css, '.set-overlay')).toMatch(/padding:\s*calc\(var\(--ui-vh\)\s*\*\s*5\)\s+24px/)
  })

  it('V3: the onboarding card stays inside the zoomed viewport', () => {
    const card = rule(src('onboarding.css'), '.onb-card')
    expect(card).toMatch(/max-width:\s*calc\(var\(--ui-vw\)\s*\*\s*100\s*-\s*48px\)/)
    expect(card).toMatch(/max-height:\s*calc\(var\(--ui-vh\)\s*\*\s*100\s*-\s*48px\)/)
  })
})
