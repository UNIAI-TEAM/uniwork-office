// The presenter view paints on pure black in both themes: every text colour it uses must read at
// WCAG AA (4.5:1) there. White-with-alpha tokens (--slides-show-ink-NN) blend onto black, so the
// contrast of NN% white on #000 is (L + 0.05) / 0.05 with L the linear luminance of NN% grey.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')

function linear(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function contrastOnBlack(alphaPercent: number): number {
  const grey = alphaPercent / 100
  return (linear(grey) + 0.05) / 0.05
}

function inkOf(selector: string): number | undefined {
  const block = new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
  const alpha = /color:\s*var\(--slides-show-ink-(\d+)\)/.exec(block ?? '')?.[1]
  return alpha === undefined ? undefined : Number(alpha)
}

describe('presenter view text contrast on black', () => {
  it.each([
    '.presenter .pv-top-hint',
    '.presenter .pv-next-none',
    '.presenter .pv-section-label',
    '.presenter .pv-nav-label',
    '.presenter .pv-notes',
    '.presenter .pv-mini-btn',
    '.presenter .pv-top-btn',
  ])('%s is at least 4.5:1', (selector) => {
    const alpha = inkOf(selector)
    expect(alpha, `${selector} uses a --slides-show-ink-NN colour`).toBeDefined()
    expect(contrastOnBlack(alpha!)).toBeGreaterThanOrEqual(4.5)
  })

  it('the hint that explains the audience window is no longer the dim 40% white', () => {
    expect(inkOf('.presenter .pv-top-hint')).toBeGreaterThanOrEqual(60)
  })
})
