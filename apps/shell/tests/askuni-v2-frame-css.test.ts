import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Visual r1 F1: `--ui-vw` / `--ui-vh` are *lengths* (1vw / 1vh divided by the UI scale), so a
 * percentage of the window is `calc(var(--ui-vw) * 90)`. Multiplying by 0.9 gave ~12px and the
 * history popover, model menu and scope picker collapsed. The CSS text is pinned here because
 * only a real window shows the pixels.
 */

const dir = resolve(__dirname, '../src/renderer/src/askuni-v2')
const frame = readFileSync(resolve(dir, 'frame.css'), 'utf8')
const uiCss = readFileSync(
  resolve(__dirname, '../../../packages/ui/src/ask-uni/ask-uni.css'),
  'utf8',
)

/** `var(--ui-vw ...) * 0.9`: a viewport length scaled below one (comments are prose, not rules) */
const FRACTION = /var\(--ui-v[wh][^)]*\)\s*\*\s*0?\.\d+/g
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  expect(at, `${selector} rule exists`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

describe('Ask UNI v2 popovers use the scaled viewport lengths as lengths', () => {
  it.each([
    ['frame.css', frame],
    ['ask-uni.css', uiCss],
  ])('%s never multiplies --ui-vw / --ui-vh by a fraction', (_name, css) => {
    expect(strip(css).match(FRACTION) ?? []).toEqual([])
  })

  it('has no raw 100vw / 100vh fallback inside a --ui-v* var (the token already is 1vw / 1vh)', () => {
    expect(strip(frame)).not.toMatch(/var\(--ui-v[wh],\s*100v[wh]\)/)
  })

  it.each([
    ['.askuni2-history-pop', 320, 90, 360, 60],
    ['.askuni2-model-menu', 300, 90, 420, 70],
    ['.askuni2-scope', 300, 90, 360, 60],
  ])('%s is min(%ipx, %i vw) wide and min(%ipx, %i vh) tall', (selector, w, vw, h, vh) => {
    const body = rule(frame, selector)
    expect(body).toContain(`inline-size: min(${w}px, calc(var(--ui-vw, 1vw) * ${vw}));`)
    expect(body).toContain(`max-block-size: min(${h}px, calc(var(--ui-vh, 1vh) * ${vh}));`)
  })
})
