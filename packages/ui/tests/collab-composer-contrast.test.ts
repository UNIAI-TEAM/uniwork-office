// Contrast of the composer's inactive Send label (G8-10 visual V6 F5 measured 2.65 light / 2.58 dark):
// the label must stay >= 3:1 on its fill in every theme block of tokens.css while still reading as inactive.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(resolve(import.meta.dirname, rel), 'utf8')
const css = read('../src/collab/collab-composer.css')
const tokensCss = read('../src/tokens.css')

type Tokens = Record<string, string>

/** the custom properties declared between the braces that follow `header` */
function block(header: string): Tokens {
  const at = tokensCss.indexOf(header)
  if (at < 0) throw new Error(`no block ${header}`)
  const open = tokensCss.indexOf('{', at)
  let depth = 0
  let end = open
  for (; end < tokensCss.length; end++) {
    if (tokensCss[end] === '{') depth++
    if (tokensCss[end] === '}' && --depth === 0) break
  }
  const out: Tokens = {}
  for (const m of tokensCss.slice(open + 1, end).matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    out[m[1]!] = m[2]!.trim()
  }
  return out
}

const light = block(':root {')
const themes: Record<string, Tokens> = {
  light,
  dark: { ...light, ...block("[data-theme='dark'] {") },
  'system-dark': {
    ...light,
    ...block(":root:not([data-theme='light']):not([data-theme='dark']) {"),
  },
}

const lum = (hex: string): number => {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)?.[1]
  if (!h) throw new Error(`not a plain hex colour: ${hex}`)
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = parseInt(full.slice(i, i + 2), 16) / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG 2.x contrast ratio of two plain hex colours */
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const DISABLED = ".collab-composer-btn[aria-disabled='true']"
const ruleBody = (selector: string): string => {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no rule ${selector}`)
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}
const tokenOf = (body: string, prop: string): string => {
  const m = new RegExp(`(?:^|[\\s;])${prop}:\\s*var\\((--[\\w-]+)\\)`).exec(body)
  if (!m) throw new Error(`no ${prop} token`)
  return m[1]!
}

describe('inactive Send contrast', () => {
  const body = ruleBody(DISABLED)

  it('pins the label and fill to --text-secondary on --surface-subtle', () => {
    expect(tokenOf(body, 'color')).toBe('--text-secondary')
    expect(tokenOf(body, 'background')).toBe('--surface-subtle')
  })

  it('does not fade the button (opacity would drop the label under 3:1)', () => {
    expect(body).not.toMatch(/opacity\s*:/)
  })

  it('beats the primary Send and its hover (declared later at the same specificity)', () => {
    expect(css.indexOf(`${DISABLED} {`)).toBeGreaterThan(
      css.indexOf('.collab-composer-send:hover {'),
    )
    expect(css.indexOf(`${DISABLED} {`)).toBeGreaterThan(css.indexOf('.collab-composer-send {'))
  })

  it('stays visibly inactive: a different fill from the live Send and from a plain button', () => {
    expect(tokenOf(body, 'background')).not.toBe(
      tokenOf(ruleBody('.collab-composer-send'), 'background'),
    )
    expect(tokenOf(body, 'background')).not.toBe(
      tokenOf(ruleBody('.collab-composer-btn'), 'background'),
    )
    expect(body).toMatch(/cursor:\s*not-allowed/)
  })

  for (const [theme, tokens] of Object.entries(themes)) {
    it(`label is >= 3:1 on its fill in ${theme}`, () => {
      const ratio = contrast(tokens[tokenOf(body, 'color')]!, tokens[tokenOf(body, 'background')]!)
      expect(ratio).toBeGreaterThanOrEqual(3)
    })
  }
})
