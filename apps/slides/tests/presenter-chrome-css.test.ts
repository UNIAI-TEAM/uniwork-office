// Presenter View chrome (visual round 2, S-07): readable sizes and text contrast on the black
// chrome, tokens only. The CSS is the contract: a rule that shrinks a label or dims a hint back
// below the floor fails here.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, '..', 'src', 'renderer', 'styles.css'), 'utf8')

const start = css.indexOf('/* ── Presenter view (PowerPoint style')
const end = css.indexOf('/* ── Insert tab: shape gallery')
const section = css.slice(start, end)

interface Rule {
  selector: string
  body: string
}

const rules: Rule[] = [...section.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1]!.trim(),
  body: m[2]!,
}))

/** white at `alpha` over the black chrome vs the same black: WCAG contrast ratio */
function contrastOnBlack(alpha: number): number {
  const c = alpha // white channel 1.0 * alpha over 0 -> alpha (sRGB, 0..1)
  const lin = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  return (lin + 0.05) / 0.05
}

function tokenAlpha(name: string): number {
  const m = new RegExp(`--${name}:\\s*rgb\\(255 255 255 / (\\d+)%\\)`).exec(css)
  if (!m) throw new Error(`no white-alpha token ${name}`)
  return Number(m[1]) / 100
}

describe('presenter view chrome', () => {
  it('has rules to check', () => {
    expect(rules.length).toBeGreaterThan(20)
  })

  it('every label and control is at least 13px (14px for the top bar and hint)', () => {
    for (const r of rules) {
      const m = /font-size:\s*(\d+)px/.exec(r.body)
      if (!m) continue
      expect(Number(m[1]), r.selector).toBeGreaterThanOrEqual(13)
    }
    for (const sel of ['.presenter .pv-top-btn', '.presenter .pv-top-hint']) {
      const r = rules.find((x) => x.selector === sel)!
      expect(Number(/font-size:\s*(\d+)px/.exec(r.body)![1]), sel).toBeGreaterThanOrEqual(14)
    }
  })

  it('round tools and navigation are at least 44px', () => {
    for (const sel of ['.presenter .pv-tool-btn', '.presenter .pv-round']) {
      const r = rules.find((x) => x.selector === sel)!
      expect(Number(/width:\s*(\d+)px/.exec(r.body)![1]), sel).toBeGreaterThanOrEqual(44)
      expect(Number(/height:\s*(\d+)px/.exec(r.body)![1]), sel).toBeGreaterThanOrEqual(44)
    }
  })

  it('text colours are tokens with at least 4.5:1 on the black chrome', () => {
    for (const r of rules) {
      const m = /(?:^|[;\s])color:\s*([^;]+);/.exec(r.body)
      if (!m) continue
      const value = m[1]!.trim()
      expect(value, r.selector).toMatch(/^var\(--/)
      const token = /^var\(--(slides-show-ink(?:-\d+)?)\)$/.exec(value)
      if (!token) continue
      const a = token[1] === 'slides-show-ink' ? 1 : tokenAlpha(token[1]!)
      expect(contrastOnBlack(a), `${r.selector} ${value}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
