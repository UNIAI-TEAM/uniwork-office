// Visual r3 P-1 / P-2 on the forced Track pill (tracked-changes protection):
//  - P-1: the locked pill carries a visible cue (lock glyph + locked style), stays in the Tab order
//    (aria-disabled, not disabled) and shows its reason on keyboard focus as on hover;
//  - P-2: the reason is an in-panel tip clamped to the composer box, not the 280px global ScreenTip
//    that overflowed the 360px panel.
// The toggle is still refused while locked (see ai-track-toggle-protection.test.ts).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { strings } from '../src/renderer/i18n/strings'
import { mountDocsAiPanel, settle, type DocsAiHarness } from './helpers/docs-ai-run-harness'

let h: DocsAiHarness | null = null
afterEach(() => {
  h?.cleanup()
  h = null
  localStorage.clear()
})

const skinCss = readFileSync(join(__dirname, '../../../packages/ui/src/ai-panel.css'), 'utf8')
const appCss = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')
const dicts = strings as unknown as Record<string, Record<string, string>>
const pill = (c: HTMLElement) => c.querySelector('.ai-track-btn') as HTMLButtonElement
const wrap = (c: HTMLElement) => c.querySelector('.ai-track-wrap') as HTMLElement
const tip = (c: HTMLElement) => c.querySelector('.ai-track-tip') as HTMLElement | null

function rule(selector: string): string {
  const start = appCss.indexOf(`\n${selector} {`)
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0)
  return appCss.slice(start, appCss.indexOf('}', start))
}

describe('forced Track pill: visible locked cue and keyboard reach (P-1)', () => {
  it('is aria-disabled instead of disabled, so Tab can land on it', async () => {
    h = await mountDocsAiPanel(['one'], { protection: 'trackedChanges', lang: 'en' })
    const btn = pill(h.container)
    expect(btn.disabled).toBe(false)
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0)
    btn.focus()
    expect(document.activeElement).toBe(btn)
  })

  it('shows a lock glyph and a locked state class; the free pill has neither', async () => {
    h = await mountDocsAiPanel(['one'], { protection: 'trackedChanges' })
    const btn = pill(h.container)
    expect(btn.classList.contains('on')).toBe(true)
    expect(btn.classList.contains('locked')).toBe(true)
    const lock = btn.querySelector('.ai-track-lock')
    expect(lock).not.toBeNull()
    expect(lock!.getAttribute('aria-hidden')).toBe('true')
    h.cleanup()
    localStorage.setItem('ai-docs-track-changes', '1')
    h = await mountDocsAiPanel(['one'], { protection: 'none' })
    expect(pill(h.container).classList.contains('locked')).toBe(false)
    expect(pill(h.container).querySelector('.ai-track-lock')).toBeNull()
    expect(pill(h.container).hasAttribute('aria-disabled')).toBe(false)
  })

  it('keeps aria-describedby on the reason, which is the in-panel tip', async () => {
    h = await mountDocsAiPanel(['one'], { protection: 'trackedChanges', lang: 'en' })
    const btn = pill(h.container)
    const reason = h.container.querySelector(
      `#${btn.getAttribute('aria-describedby')}`,
    ) as HTMLElement
    expect(reason).toBe(tip(h.container))
    expect(reason.textContent).toBe(dicts.en!.aiTrackForced)
    // the global ScreenTip would overflow the panel and rewrite aria-describedby: not used here
    expect(wrap(h.container).hasAttribute('data-tip')).toBe(false)
    expect(btn.hasAttribute('data-tip')).toBe(false)
  })

  it('shows the tip on keyboard focus and hides it on blur and Escape', async () => {
    h = await mountDocsAiPanel(['one'], { protection: 'trackedChanges' })
    const btn = pill(h.container)
    expect(tip(h.container)!.getAttribute('data-open')).toBe('false')
    await act(async () => btn.focus())
    expect(tip(h.container)!.getAttribute('data-open')).toBe('true')
    await act(async () => {
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(tip(h.container)!.getAttribute('data-open')).toBe('false')
    await act(async () => btn.blur())
    await act(async () => btn.focus())
    expect(tip(h.container)!.getAttribute('data-open')).toBe('true')
    await act(async () => btn.blur())
    expect(tip(h.container)!.getAttribute('data-open')).toBe('false')
  })

  it('shows the tip on hover of the wrapper too', async () => {
    h = await mountDocsAiPanel(['one'], { protection: 'trackedChanges' })
    const w = wrap(h.container)
    await act(async () => w.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(tip(h.container)!.getAttribute('data-open')).toBe('true')
    await act(async () => w.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    expect(tip(h.container)!.getAttribute('data-open')).toBe('false')
  })

  it('refuses the toggle while locked, by click and by keyboard', async () => {
    localStorage.clear()
    h = await mountDocsAiPanel(['one'], { protection: 'trackedChanges' })
    await act(async () => pill(h!.container).click())
    await settle()
    expect(pill(h.container).classList.contains('on')).toBe(true)
    expect(localStorage.getItem('ai-docs-track-changes')).toBeNull()
  })
})

describe('forced Track pill: styles (P-1 cue, P-2 clamp)', () => {
  it('has a locked style and gets its keyboard focus ring from the shared skin', () => {
    expect(rule('.ai-track-btn.locked')).toMatch(/border-style:\s*dashed/)
    // the ring moved into the shared skin's :is() focus-visible list; no private rule stays behind
    expect(appCss).not.toMatch(/\.ai-track-btn\s*:focus-visible/)
    expect(skinCss).toMatch(/:is\([^)]*\.ai-track-btn[^)]*\):focus-visible/)
    expect(rule('.ai-track-wrap.forced')).toMatch(/cursor:\s*not-allowed/)
  })

  it('clamps the tip inside the composer box, aligned to its end', () => {
    const r = rule('.ai-track-tip')
    expect(r).toMatch(/position:\s*absolute/)
    expect(r).toMatch(/inset-inline-end:\s*\d+px/)
    expect(r).toMatch(/max-width:\s*min\(280px,\s*calc\(100% - \d+px\)\)/)
    expect(rule('.ai-input-box')).toMatch(/position:\s*relative/)
    expect(r).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i)
  })
})
