// WCAG contrast of the frame dialog's buttons in every theme block of tokens.css (light, dark, and
// the system-dark media fallback): text on its fill >= 4.5:1 for each button tone, hover included.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(import.meta.dirname, '../../../packages/ui/src/tokens.css'), 'utf8')

type Tokens = Record<string, string>

/** the custom properties declared between the braces that follow `header` */
function block(header: string): Tokens {
  const at = css.indexOf(header)
  if (at < 0) throw new Error(`no block ${header}`)
  const open = css.indexOf('{', at)
  let depth = 0
  let end = open
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++
    if (css[end] === '}' && --depth === 0) break
  }
  const out: Tokens = {}
  for (const m of css.slice(open + 1, end).matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    out[m[1]!] = m[2]!.trim()
  }
  return out
}

const light = block(':root {')
const darkBlock = block("[data-theme='dark'] {")
const systemBlock = block(":root:not([data-theme='light']):not([data-theme='dark']) {")
const themes: Record<string, Tokens> = {
  light,
  dark: { ...light, ...darkBlock },
  'system-dark': { ...light, ...systemBlock },
}

function rgbOf(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (!hex) throw new Error(`not a plain hex colour: ${value}`)
  const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

const channel = (v: number): number => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminance = (value: string): number => {
  const [r, g, b] = rgbOf(value)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x contrast ratio of two plain hex colours */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// [label, text token, fill token]: what frame-dialog.css paints for each tone
const PAIRS: ReadonlyArray<[string, string, string]> = [
  ['primary', '--color-dialog-primary-text', '--color-dialog-primary'],
  ['primary hover', '--color-dialog-primary-text', '--color-dialog-primary-hover'],
  ['danger', '--danger-text', '--danger-bg'],
  ['neutral', '--text', '--surface'],
  ['neutral hover', '--text', '--hover'],
  ['ghost on the footer band', '--text-dim', '--surface-subtle'],
  ['ghost hover', '--text', '--hover'],
  ['body copy', '--text-dim', '--surface'],
]

describe('frame dialog contrast', () => {
  it('computes the WCAG ratio', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    // the pre-fix dark Restore button: white on the light brand blue
    expect(contrast('#ffffff', '#5a96ff')).toBeLessThan(3)
  })

  for (const [theme, tokens] of Object.entries(themes)) {
    for (const [label, text, fill] of PAIRS) {
      it(`${theme}: ${label} text is at least 4.5:1`, () => {
        expect(tokens[text], text).toBeDefined()
        expect(tokens[fill], fill).toBeDefined()
        expect(contrast(tokens[text]!, tokens[fill]!)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('the dark primary reads dark-on-light, never white-on-light-blue', () => {
    expect(themes.dark!['--color-dialog-primary-text']).not.toBe('#ffffff')
    expect(themes['system-dark']!['--color-dialog-primary-text']).toBe(
      themes.dark!['--color-dialog-primary-text'],
    )
  })

  it('all three theme blocks define the dialog tokens themselves (CLAUDE.md: a token gets all three)', () => {
    for (const own of [light, darkBlock, systemBlock]) {
      for (const key of [
        '--color-dialog-scrim',
        '--color-dialog-primary',
        '--color-dialog-primary-hover',
        '--color-dialog-primary-text',
      ]) {
        expect(own[key], key).toBeDefined()
      }
    }
  })
})
