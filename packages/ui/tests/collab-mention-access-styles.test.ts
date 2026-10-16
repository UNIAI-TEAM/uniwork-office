import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** F2 (R20): every G8-18 surface has real, token-based styles (unstyled raw DOM was blocking) */
const dir = resolve(import.meta.dirname, '../src/collab')
const css = readFileSync(resolve(dir, 'collab-mention-access.css'), 'utf8')
const panelCss = readFileSync(resolve(dir, 'collab.css'), 'utf8')
const tokens = readFileSync(resolve(import.meta.dirname, '../src/tokens.css'), 'utf8')

const rule = (selector: string): string =>
  new RegExp(`(?:^|[,}\\s])${selector.replace(/[.\\[\]()]/g, '\\$&')}\\s*[,{]`, 'm').test(css)
    ? css
    : ''

describe('G8-18 mention access styles', () => {
  it('is part of the panel stylesheet', () => {
    expect(panelCss).toContain("@import './collab-mention-access.css'")
  })

  it.each([
    '.collab-mention-no-access',
    '.collab-mention-lock',
    '.collab-composer-chips',
    '.collab-mention-chip',
    '.collab-mention-chip-name',
    '.collab-composer-mark--no-access',
    '.collab-mention-warn-backdrop',
    '.collab-mention-warn',
    '.collab-mention-warn-title',
    '.collab-mention-warn-body',
    '.collab-mention-warn-text',
    '.collab-mention-warn-sub',
    '.collab-mention-warn-actions',
    '.collab-spinner',
    '.collab-post-send-notice',
    '.collab-post-send-text',
    '.collab-post-send-error',
    '.collab-post-send-retro',
    '.collab-post-send-share',
    '.collab-post-send-close',
  ])('styles %s', (selector) => {
    expect(rule(selector), selector).not.toBe('')
  })

  it('the panel title, a programmatic focus target, shows the collab focus ring (V10 F3)', () => {
    const focusRule = /\.collab-title:focus\s*\{([^}]*)\}/s.exec(panelCss)?.[1] ?? ''
    expect(focusRule).toMatch(/outline:\s*2px solid var\(--accent/)
    expect(focusRule).not.toMatch(/outline:\s*none/)
  })

  it('the dialog is a fixed, centred modal over a scrim, like the discard dialog', () => {
    const backdrop = /\.collab-mention-warn-backdrop\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    expect(backdrop).toMatch(/position:\s*fixed/)
    expect(backdrop).toMatch(/inset:\s*0/)
    expect(backdrop).toMatch(/place-items:\s*center/)
    expect(backdrop).toMatch(/background:\s*var\(--color-dialog-scrim\)/)
    const dialog = /\.collab-mention-warn\s*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
    expect(dialog).toMatch(/background:\s*var\(--surface\)/)
    expect(dialog).toMatch(/box-shadow:\s*var\(--shadow-modal-strong\)/)
  })

  it('uses no raw colour in a rule', () => {
    const raw = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !/^\s*--[\w-]+\s*:/.test(l))
      .filter((l) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(l))
    expect(raw).toEqual([])
  })

  it('every var(--token) is defined for light and dark (or is a per-app accent)', () => {
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!))
    const perApp = new Set(['--accent', '--accent-soft', '--accent-dark'])
    const darkStart = tokens.search(/^\[data-theme='dark'\]/m)
    expect(darkStart).toBeGreaterThan(0)
    const light = tokens.slice(0, darkStart)
    const dark = tokens.slice(darkStart)
    for (const t of used) {
      if (perApp.has(t)) continue
      if (/^--(radius-|text-small|text-caption)/.test(t)) {
        expect(light, `${t} in :root`).toContain(`${t}:`)
        continue
      }
      expect(light, `${t} in light`).toContain(`${t}:`)
      expect(dark, `${t} in dark`).toContain(`${t}:`)
    }
  })

  it('the notice close button is >= 24px and 44px under a coarse pointer', () => {
    expect(css).toMatch(/\.collab-post-send-close\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/s)
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
    expect(coarse).toMatch(/\.collab-post-send-close\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s)
  })

  it('the spinner slows down under prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.collab-spinner/)
  })
})
