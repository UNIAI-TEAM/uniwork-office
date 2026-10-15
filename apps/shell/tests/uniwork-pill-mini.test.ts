import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chipModelOf, miniGlyphOf, type MiniGlyph } from '../src/renderer/src/uniwork-docs-model'
import type { UniworkDocStatus, UniworkSaveState } from '../src/shared/home-api'

/**
 * FXT6u part 2: the mini pill (the dot alone). The shape of the dot comes from the chip model, never
 * from colour alone; the stylesheet draws it as a 28px circle (44px target on a coarse pointer) with
 * theme tokens only.
 */

function status(over: Partial<UniworkDocStatus> = {}): UniworkDocStatus {
  return {
    path: '/work/uniwork-documents/d1/Plan.docx',
    documentId: 'd1',
    workspaceId: 'w1',
    title: 'Plan',
    format: 'docx',
    access: 'edit',
    state: 'queued',
    ...over,
  }
}

const glyphOf = (over: Partial<UniworkDocStatus>): MiniGlyph => {
  const s = status(over)
  return miniGlyphOf(chipModelOf(s, { needsSignIn: false }), s.state)
}

describe('FXT6u: the mini dot has a shape per state', () => {
  it('each tone has its own shape (colour is never the only cue)', () => {
    const byTone = {
      ok: glyphOf({ state: 'saved' }),
      info: glyphOf({ state: 'queued' }),
      warn: glyphOf({ state: 'conflict' }),
      error: glyphOf({ state: 'failed' }),
      busy: glyphOf({ state: 'saving' }),
      neutral: glyphOf({ state: 'dirty' }),
    }
    expect(byTone).toEqual({
      ok: 'check',
      info: 'clock',
      warn: 'warn',
      error: 'alert',
      busy: 'busy',
      neutral: 'ring',
    })
    expect(new Set(Object.values(byTone)).size).toBe(6)
  })

  it('a paused save is told from a queued one by its shape too', () => {
    expect(glyphOf({ state: 'paused_user' })).toBe('pause')
    expect(glyphOf({ state: 'queued' })).toBe('clock')
    expect(glyphOf({ state: 'paused_admin' })).toBe('pause')
  })

  it('view-only and offline have shapes of their own', () => {
    expect(glyphOf({ state: 'saved', access: 'view' })).toBe('lock')
    expect(glyphOf({ state: 'offline' })).toBe('offline')
  })

  it('blocked, error and signed-out read as an alert, reconciling as a warning', () => {
    expect(glyphOf({ state: 'blocked' })).toBe('alert')
    expect(glyphOf({ state: 'error' })).toBe('alert')
    expect(glyphOf({ state: 'signed-out' })).toBe('alert')
    expect(glyphOf({ state: 'reconciling' })).toBe('warn')
    expect(glyphOf({ state: 'reconciling-stuck' })).toBe('warn')
  })

  it('every save state has a shape', () => {
    const states: UniworkSaveState[] = [
      'ready',
      'saved',
      'dirty',
      'saving',
      'offline',
      'signed-out',
      'conflict',
      'blocked',
      'error',
      'queued',
      'paused_offline',
      'paused_user',
      'paused_admin',
      'reconciling',
      'reconciling-stuck',
      'failed',
    ]
    for (const state of states) expect(glyphOf({ state }), state).toBeTruthy()
  })
})

const css = readFileSync(resolve(__dirname, '../src/renderer/src/tabbar.css'), 'utf8').replace(
  /\r\n/g,
  '\n',
)

/** the body of the rule whose selector is `selector`, from `from` on (the block ends at the next `}`) */
function rule(selector: string, from = 0): string {
  const at = css.indexOf(`\n${selector} {`, from)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  const start = at + selector.length + 3
  return css.slice(start, css.indexOf('}', start))
}

/** the text of the first `@media (pointer: coarse) { ... }` block that holds `needle` */
function coarse(needle: string): string {
  let from = 0
  for (;;) {
    const start = css.indexOf('@media (pointer: coarse) {', from)
    expect(start, needle).toBeGreaterThanOrEqual(0)
    let depth = 0
    let end = start
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++
      if (css[i] === '}' && --depth === 0) {
        end = i
        break
      }
    }
    const block = css.slice(start, end)
    if (block.includes(needle)) return block
    from = end
  }
}

describe('FXT6u: the mini pill stylesheet', () => {
  it('the pill is a 28px circle with no padding or gap; the dot is the button inside it', () => {
    const pill = rule(".uw-pill[data-variant='mini']")
    expect(pill).toMatch(/width: 28px/)
    expect(pill).toMatch(/padding: 0;/)
    expect(pill).toMatch(/gap: 0/)
    const dot = rule('.uw-pill-mini')
    expect(dot).toMatch(/width: 26px/)
    expect(dot).toMatch(/height: 26px/)
    expect(dot).toMatch(/border-radius: 50%/)
    expect(dot).toMatch(/background: transparent/)
    expect(dot).toMatch(/color: inherit/)
  })

  it('hover and keyboard focus use tokens; the focus ring is the pill one and shows the description chip', () => {
    const hover = css.slice(css.indexOf(".uw-pill-mini:hover:not([aria-disabled='true'])"))
    expect(hover.slice(0, hover.indexOf('}'))).toMatch(/background: var\(--hover\)/)
    expect(css).toMatch(/\.uw-pill-mini:focus-visible,/)
    expect(css).toMatch(/\.uw-pill-mini:focus-visible ~ \.uw-pill-focus-tip/)
    // the ring is the one of the other pill controls
    const ring = css.slice(css.indexOf('.uw-pill-action:focus-visible,'))
    expect(ring.slice(0, ring.indexOf('}'))).toMatch(/\.uw-pill-mini:focus-visible/)
    expect(ring.slice(0, ring.indexOf('}'))).toMatch(
      /outline: 2px solid var\(--color-border-brand\)/,
    )
  })

  it('a coarse pointer gets a 44px target: the pill widens, the hit area reaches 44px tall, nothing past the pill sideways', () => {
    const block = coarse(".uw-pill[data-variant='mini']")
    expect(block).toMatch(/\.uw-pill\[data-variant='mini'\] \{\s*width: 44px;/)
    const before = block.slice(block.indexOf('.uw-pill-mini::before'))
    const body = before.slice(0, before.indexOf('}'))
    // 26px dot + 9px above and below = 44px; sideways it stays inside the 44px pill (1px = its border)
    expect(body).toMatch(/top: -9px/)
    expect(body).toMatch(/bottom: -9px/)
    expect(body).toMatch(/left: -1px/)
    expect(body).toMatch(/right: -1px/)
  })

  it('the hit area is drawn only in the dot (a pseudo-element), and the mini rules use theme tokens only', () => {
    expect(css).toMatch(/\.uw-pill-mini::before/)
    const rules = [
      rule(".uw-pill[data-variant='mini']"),
      rule('.uw-pill-mini'),
      rule(".uw-pill[data-variant='mini'] > .uw-pill-status"),
      rule('.uw-pill-mini-glyph'),
    ].join('\n')
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  })
})
