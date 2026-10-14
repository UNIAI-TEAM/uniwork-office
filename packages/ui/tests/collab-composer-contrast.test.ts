// Contrast of the composer's inactive Send label (G8-10 visual V6 F5 measured 2.65 light / 2.58 dark):
// the label must stay >= 3:1 on its fill in every theme block of tokens.css while still reading as inactive.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(resolve(import.meta.dirname, rel), 'utf8')
const css = read('../src/collab/collab-composer.css')
const tokensCss = read('../src/tokens.css')

const bodyCss = read('../src/collab/collab-body.css')
const panelCss = read('../src/collab/collab.css')

type Tokens = Record<string, string>

/** the custom properties declared between the braces that follow `header` in `src` */
function blockFrom(src: string, header: string): Tokens {
  const at = src.indexOf(header)
  if (at < 0) throw new Error(`no block ${header}`)
  const open = src.indexOf('{', at)
  let depth = 0
  let end = open
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++
    if (src[end] === '}' && --depth === 0) break
  }
  const out: Tokens = {}
  for (const m of src.slice(open + 1, end).matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    out[m[1]!] = m[2]!.trim()
  }
  return out
}

const block = (header: string): Tokens => blockFrom(tokensCss, header)

const light = block(':root {')
const themes: Record<string, Tokens> = {
  light,
  dark: { ...light, ...block("[data-theme='dark'] {") },
  'system-dark': {
    ...light,
    ...block(":root:not([data-theme='light']):not([data-theme='dark']) {"),
  },
}

const rgbOf = (hex: string): [number, number, number] => {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)?.[1]
  if (!h) throw new Error(`not a plain hex colour: ${hex}`)
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

const lum = (hex: string): number => {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG 2.x contrast ratio of two plain hex colours */
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** resolve var(--token[, fallback]) and color-mix(in srgb, ...) to a #rrggbb colour */
function resolveColor(expr: string, tokens: Tokens): string {
  const s = expr.replace(/\s+/g, ' ').trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s
  const v = /^var\(\s*(--[\w-]+)(?:\s*,\s*(.+))?\)$/.exec(s)
  if (v) {
    const val = tokens[v[1]!]
    if (val !== undefined) return resolveColor(val, tokens)
    if (v[2] !== undefined) return resolveColor(v[2], tokens)
    throw new Error(`unresolved token ${v[1]}`)
  }
  const mix = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*(.+)\)$/.exec(s)
  if (mix) {
    const a = rgbOf(resolveColor(mix[1]!, tokens))
    const b = rgbOf(resolveColor(mix[3]!, tokens))
    const w = Number(mix[2]) / 100
    const ch = [0, 1, 2].map((i) => Math.round(a[i]! * w + b[i]! * (1 - w)))
    return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`
  }
  throw new Error(`unsupported colour expression: ${s}`)
}

const DISABLED = ".collab-composer-btn[aria-disabled='true']"
const ruleBodyFrom = (src: string, selector: string): string => {
  const at = src.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no rule ${selector}`)
  return src.slice(src.indexOf('{', at) + 1, src.indexOf('}', at))
}
const ruleBody = (selector: string): string => ruleBodyFrom(css, selector)
const propValue = (body: string, prop: string): string => {
  const m = new RegExp(`(?:^|[\\s;])${prop}:\\s*([^;]+);`).exec(body)
  if (!m) throw new Error(`no ${prop} declaration`)
  return m[1]!.trim()
}
const tokenOf = (body: string, prop: string): string => {
  const m = new RegExp(`(?:^|[\\s;])${prop}:\\s*var\\((--[\\w-]+)`).exec(body)
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

describe('mention chip contrast across app accents (V14-09)', () => {
  const APP_STYLES: Record<string, string> = {
    docs: '../../../apps/docs/src/renderer/styles.css',
    sheets: '../../../apps/sheets/src/renderer/styles.css',
    slides: '../../../apps/slides/src/renderer/styles.css',
    pdf: '../../../apps/pdf/src/renderer/styles.css',
    web: '../../../apps/markdown/src/renderer/styles.css',
  }

  const kitVars: Tokens = {}
  for (const src of [bodyCss, panelCss]) {
    for (const m of src.matchAll(/^\s*(--collab-[\w-]+):\s*([^;]+);/gm)) {
      kitVars[m[1]!] = m[2]!.trim()
    }
  }

  const mentionRule = ruleBodyFrom(bodyCss, '.collab-mention')
  const fgExpr = propValue(mentionRule, 'color')
  const bgExpr = propValue(mentionRule, 'background')

  it('uses kit-scoped variables with no raw colours in .collab-mention', () => {
    expect(mentionRule).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/)
    expect(fgExpr).toMatch(/^var\(--collab-/)
    expect(bgExpr).toMatch(/^var\(--collab-/)
  })

  for (const [app, stylePath] of [...Object.entries(APP_STYLES), ['kit-fallback', ''] as const]) {
    const appCss = stylePath ? read(stylePath) : ''
    const appLight = appCss ? blockFrom(appCss, ':root {') : {}
    const appThemes: Record<string, Tokens> = {
      light: { ...themes.light!, ...appLight, ...kitVars },
      dark: {
        ...themes.dark!,
        ...appLight,
        ...(appCss ? blockFrom(appCss, "[data-theme='dark'] {") : {}),
        ...kitVars,
      },
      'system-dark': {
        ...themes['system-dark']!,
        ...appLight,
        ...(appCss
          ? blockFrom(appCss, ":root:not([data-theme='light']):not([data-theme='dark']) {")
          : {}),
        ...kitVars,
      },
    }

    for (const [theme, tokens] of Object.entries(appThemes)) {
      it(`${app} (${theme}): mention chip text contrast is >= 4.6:1`, () => {
        const fg = resolveColor(fgExpr, tokens)
        const bg = resolveColor(bgExpr, tokens)
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.6)
      })
    }
  }
})
