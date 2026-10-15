import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../src/renderer/src/tabbar.css'), 'utf8').replace(
  /\r\n/g,
  '\n',
)

/** the body of the first rule whose selector line is exactly `selector` (top level or inside a block) */
function rule(selector: string, from = 0): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\n\\s*')
  // the selector starts right after a block end, a block start or a comment (not after a comma)
  const re = new RegExp(`(?:^|[{}]|\\*/)\\s*${escaped} \\{`)
  const rest = css.slice(from)
  const match = re.exec(rest)
  expect(match, selector).not.toBeNull()
  const start = from + match!.index + match![0].length
  return css.slice(start, css.indexOf('}', start))
}

/** everything inside every `@media (query) { ... }` block, braces balanced */
function media(query: string): string {
  const blocks: string[] = []
  for (let start = css.indexOf(`@media (${query}) {`); start >= 0;) {
    let depth = 0
    let end = start
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++
      if (css[i] === '}' && --depth === 0) {
        end = i
        break
      }
    }
    blocks.push(css.slice(start, end))
    start = css.indexOf(`@media (${query}) {`, end)
  }
  expect(blocks.length, query).toBeGreaterThan(0)
  return blocks.join('\n')
}

const px = (value: string | undefined): number => Number(/(-?\d+)px/.exec(value ?? '')![1])

describe('Save pill hit areas (T10)', () => {
  it('fine pointer: buttons grow a 1px invisible hit area on every side (22 -> 24px)', () => {
    expect(rule('.uw-pill-action,\n.uw-pill-close')).toMatch(/position: relative/)
    const before = rule('.uw-pill-action::before,\n.uw-pill-close::before')
    expect(before).toMatch(/content: ''/)
    expect(before).toMatch(/position: absolute/)
    expect(before).toMatch(/inset: -1px/)
  })

  it('coarse pointer: the holder is the full 40px bar, still not draggable', () => {
    const coarse = media('pointer: coarse')
    const chrome = rule('.uw-chrome', css.indexOf('@media (pointer: coarse)'))
    expect(chrome).toMatch(/align-self: stretch/)
    expect(chrome).toMatch(/height: 40px/)
    expect(coarse).toContain('.uw-chrome')
    // the base rule keeps the whole holder out of the window drag region
    expect(rule('.uw-chrome')).toMatch(/-webkit-app-region: no-drag/)
  })

  it('coarse pointer: 9px above and below reaches the bar edge, never past it', () => {
    const at = css.indexOf('@media (pointer: coarse)')
    const both = rule('.uw-pill-action::before,\n.uw-pill-close::before', at)
    expect(px(/top: (-?\d+px)/.exec(both)?.[1])).toBe(-9)
    expect(px(/bottom: (-?\d+px)/.exec(both)?.[1])).toBe(-9)
    // bar 40 = pill 28 + 6 + 6; button 22 centred in the pill = 3 more: 9px to the edge
    expect(Math.abs(px(/top: (-?\d+px)/.exec(both)?.[1]))).toBeLessThanOrEqual((40 - 22) / 2)
  })

  it('coarse pointer: Action extends left only, Close right only (no overlap between them)', () => {
    const at = css.indexOf('@media (pointer: coarse)')
    const action = rule('.uw-pill-action::before', at)
    const close = rule('.uw-pill-close::before', at)
    expect(px(/left: (-?\d+px)/.exec(action)?.[1])).toBe(-8)
    expect(px(/right: (-?\d+px)/.exec(action)?.[1])).toBe(-1)
    expect(px(/left: (-?\d+px)/.exec(close)?.[1])).toBe(-1)
    expect(px(/right: (-?\d+px)/.exec(close)?.[1])).toBe(-8)
  })

  it('coarse pointer: Close reaches less far right than the gap before the overflow divider', () => {
    const at = css.indexOf('@media (pointer: coarse)')
    const close = rule('.uw-pill-close::before', at)
    const gap = px(/--uw-divider-gap: (\d+px)/.exec(rule('.tab-bar'))?.[1])
    expect(Math.abs(px(/right: (-?\d+px)/.exec(close)?.[1]))).toBeLessThan(gap)
  })
})

describe('Save pill tones and buttons', () => {
  it('info tone uses semantic tokens only, on the pill and on the tab marker', () => {
    const pill = rule(".uw-pill[data-tone='info']")
    expect(pill).toMatch(/border-color: var\(--info\)/)
    expect(pill).toMatch(/background: var\(--info-bg\)/)
    expect(pill).toMatch(/color: var\(--info\)/)
    const marker = rule(".uw-tab-marker[data-tone='info']")
    expect(marker).toMatch(/background: var\(--info\)/)
    for (const body of [pill, marker]) expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })

  it('a busy button (aria-disabled) looks like the old :disabled one and gets no hover', () => {
    const busy = rule(".uw-pill-action[aria-disabled='true']")
    expect(busy).toMatch(/cursor: default/)
    expect(busy).toMatch(/opacity: 0\.6/)
    expect(css).not.toMatch(/\.uw-pill-action:disabled/)
    expect(css).toMatch(/\.uw-pill-action:hover:not\(\[aria-disabled='true'\]\)/)
  })

  it('the tooltip node is hidden until hover or focus, then shown, with tokens only', () => {
    const tip = rule('.uw-pill-tip')
    expect(tip).toMatch(/position: absolute/)
    expect(tip).toMatch(/visibility: hidden/)
    expect(tip).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    expect(css).toMatch(/\.uw-pill:hover > \.uw-pill-tip/)
    expect(css).toMatch(/\.uw-pill:focus-within > \.uw-pill-tip/)
    expect(rule('.uw-pill')).toMatch(/position: relative/)
  })

  it('a no-button pill that takes focus shows the same focus ring as the buttons', () => {
    expect(css).toMatch(/\.uw-pill:focus-visible/)
  })

  it('reduced motion stops the spinner', () => {
    expect(media('prefers-reduced-motion: reduce')).toMatch(/\.uw-spinner \{\s*animation: none/)
  })
})
