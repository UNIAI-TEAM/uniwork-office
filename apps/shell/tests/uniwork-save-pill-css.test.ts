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

  it('SIZE-v1-5: .uw-pill-close hit target is at least 24x24 px', () => {
    const close = rule('.uw-pill-close')
    expect(px(/width: (\d+px)/.exec(close)?.[1])).toBeGreaterThanOrEqual(24)
    expect(px(/height: (\d+px)/.exec(close)?.[1])).toBeGreaterThanOrEqual(24)
    expect(px(/min-width: (\d+px)/.exec(close)?.[1])).toBeGreaterThanOrEqual(24)
    expect(px(/min-height: (\d+px)/.exec(close)?.[1])).toBeGreaterThanOrEqual(24)
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

  it('RFE6u-01: no DOM tooltip under the 40px strip (the editor view would cover it)', () => {
    expect(css).not.toMatch(/\.uw-pill-tip/)
  })

  it('RFE6u-01: the queue popover band sits right under the strip, full width, tokens only', () => {
    const popCss = readFileSync(
      resolve(__dirname, '../src/renderer/src/queue-popover.css'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    const band = /\.uw-queue-band \{([^}]*)\}/.exec(popCss)?.[1] ?? ''
    expect(band).toMatch(/position: fixed/)
    expect(band).toMatch(/top: var\(--tab-bar-height, 40px\)/)
    expect(band).toMatch(/left: 0/)
    expect(band).toMatch(/right: 0/)
    expect(band).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    // the dialog is laid out inside the band, not placed on its own below the strip
    const pop = /\.uw-queue-pop \{([^}]*)\}/.exec(popCss)?.[1] ?? ''
    expect(pop).not.toMatch(/position: fixed/)
  })

  it('a no-button pill that takes focus shows the same focus ring as the buttons', () => {
    expect(css).toMatch(/\.uw-pill:focus-visible/)
  })

  it('reduced motion stops the spinner', () => {
    expect(media('prefers-reduced-motion: reduce')).toMatch(/\.uw-spinner \{\s*animation: none/)
  })
})

describe('V6u-01: the in-strip description on keyboard focus', () => {
  it('is hidden by default and drawn inside the 40px strip, left of the pill, over the tabs', () => {
    const tip = rule('.uw-pill-focus-tip')
    expect(tip).toMatch(/display: none/)
    expect(tip).toMatch(/position: absolute/)
    // to the left of the pill, vertically centred on it: never below the strip
    expect(tip).toMatch(/right: calc\(100% \+ \d+px\)/)
    expect(tip).toMatch(/top: 50%/)
    expect(tip).toMatch(/transform: translateY\(-50%\)/)
    expect(tip).not.toMatch(/top: calc\(100%/)
    // it overlays (no layout shift) and never takes a click
    expect(tip).toMatch(/overflow: hidden/)
    expect(tip).toMatch(/pointer-events: none/)
    expect(tip).toMatch(/z-index: \d+/)
  })

  it('theme tokens only (light + dark come from tokens.css)', () => {
    const tip = rule('.uw-pill-focus-tip')
    expect(tip).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    expect(tip).toMatch(/background: var\(--surface\)/)
    expect(tip).toMatch(/color: var\(--text\)/)
    expect(tip).toMatch(/border: 1px solid var\(--border\)/)
  })

  it('shows only on :focus-visible of the button or the button-less pill, and Esc / pointer hide it', () => {
    const shown = rule(
      '.uw-pill:focus-visible > .uw-pill-focus-tip,\n.uw-pill-action:focus-visible ~ .uw-pill-focus-tip',
    )
    expect(shown).toMatch(/display: (block|flex)/)
    const showAt = css.indexOf('.uw-pill:focus-visible > .uw-pill-focus-tip')
    const off = rule(
      ".uw-pill[data-tip-off] > .uw-pill-focus-tip,\n.uw-pill[data-tip-room='none'] > .uw-pill-focus-tip",
    )
    expect(off).toMatch(/display: none/)
    // same specificity: the off rule must come later to win
    expect(css.indexOf('.uw-pill[data-tip-off] > .uw-pill-focus-tip')).toBeGreaterThan(showAt)
    // never on plain :focus or :hover (hover keeps the native title)
    expect(css).not.toMatch(/:hover[^{]*\.uw-pill-focus-tip/)
    expect(css).not.toMatch(/:focus(?!-visible)[^{]*\.uw-pill-focus-tip/)
  })
})

describe('V6u2-01: the focus chip never passes the window edge', () => {
  it('its width is capped by the room measured left of the pill, never by the window alone', () => {
    const tip = rule('.uw-pill-focus-tip')
    // as wide as its text (not the 28px pill it hangs from), up to the smallest cap
    expect(tip).toMatch(/width: max-content/)
    expect(tip).toMatch(/max-width: min\([^;]*var\(--uw-tip-room, \d+px\)[^;]*\)/)
    expect(tip).toMatch(/max-width: min\(480px/)
  })
})

describe('V6u2-02: the focus chip reads in two lines inside the 40px strip', () => {
  it('the chip is 28px for one line and at most 36px for two, centred on the 28px pill', () => {
    const tip = rule('.uw-pill-focus-tip')
    expect(px(/min-height: (\d+px)/.exec(tip)?.[1])).toBe(28)
    const max = px(/max-height: (\d+px)/.exec(tip)?.[1])
    expect(max).toBeLessThanOrEqual(36)
    // centred on the pill (strip 40, pill 28 at y 6): y from 20 - max/2 to 20 + max/2 stays in 0..40
    expect(20 - max / 2).toBeGreaterThanOrEqual(0)
    expect(20 + max / 2).toBeLessThanOrEqual(40)
    expect(tip).toMatch(/top: 50%/)
    expect(tip).toMatch(/transform: translateY\(-50%\)/)
    // two lines + padding + border fit the max height
    const line = px(/line-height: (\d+px)/.exec(tip)?.[1])
    const padY = px(/padding: (\d+px) \d+px/.exec(tip)?.[1])
    expect(2 * line + 2 * padY + 2).toBeLessThanOrEqual(max)
    expect(tip).toMatch(/font-size: 12px/)
    expect(tip).not.toMatch(/white-space: nowrap/)
  })

  it('the text wraps and is cut with an ellipsis only after line 2', () => {
    const text = rule('.uw-pill-focus-tip-text')
    expect(text).toMatch(/display: -webkit-box/)
    expect(text).toMatch(/-webkit-box-orient: vertical/)
    expect(text).toMatch(/-webkit-line-clamp: 2/)
    expect(text).toMatch(/overflow: hidden/)
    expect(text).not.toMatch(/white-space: nowrap/)
  })

  it('the shown chip centres one line vertically', () => {
    const shown = rule(
      '.uw-pill:focus-visible > .uw-pill-focus-tip,\n.uw-pill-action:focus-visible ~ .uw-pill-focus-tip',
    )
    expect(shown).toMatch(/display: flex/)
    expect(shown).toMatch(/align-items: center/)
  })

  it('theme tokens only for the text node too', () => {
    expect(rule('.uw-pill-focus-tip-text')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  })
})

describe('U-1: the pill is a flex item of the tab bar, never laid over a tab', () => {
  it('the bar is a flex row; the strip scrolls and gives way, the holder is in the same row', () => {
    expect(rule('.tab-bar')).toMatch(/display: flex/)
    const strip = rule('.tab-strip')
    expect(strip).toMatch(/flex: 1 1 auto/)
    expect(strip).toMatch(/min-width: 0/)
    expect(strip).toMatch(/overflow-x: auto/)
    const holder = rule('.uw-chrome')
    expect(holder).toMatch(/flex: 0 0 auto/)
    expect(holder).not.toMatch(/position: (absolute|fixed)/)
  })

  it('neither the holder nor the pill is taken out of the flow (only the focus chip is absolute)', () => {
    expect(rule('.uw-pill')).toMatch(/position: relative/)
    expect(rule('.uw-pill')).not.toMatch(/position: (absolute|fixed)/)
    expect(rule('.uw-pill')).toMatch(/flex: 0 1 auto/)
  })

  it('the narrow variant drops the gap the hidden label would leave', () => {
    expect(rule(".uw-pill[data-variant='compact'] > .uw-pill-status")).toMatch(/gap: 0/)
  })

  it('theme tokens only in the new rule', () => {
    expect(rule(".uw-pill[data-variant='compact'] > .uw-pill-status")).not.toMatch(
      /#[0-9a-f]{3,8}\b|rgba?\(/i,
    )
  })
})

describe('FXT6u: the icon-only Discussion toggle keeps its label as visually hidden text', () => {
  const discussion = readFileSync(
    resolve(__dirname, '../src/renderer/src/discussion.css'),
    'utf8',
  ).replace(/\r\n/g, '\n')
  const body = (selector: string): string => {
    const at = discussion.indexOf(`${selector} {`)
    expect(at, selector).toBeGreaterThanOrEqual(0)
    const start = at + selector.length + 3
    return discussion.slice(start, discussion.indexOf('}', start))
  }

  it('the label is clipped out of the layout, not removed or display:none (the name stays)', () => {
    const label = body(".uw-discussion-toggle[data-icon-only='true'] .uw-discussion-toggle-label")
    expect(label).toMatch(/position: absolute/)
    expect(label).toMatch(/width: 1px/)
    expect(label).toMatch(/clip: rect\(0 0 0 0\)/)
    expect(label).not.toMatch(/display: none|visibility: hidden/)
  })

  it('the toggle narrows its padding in the icon-only form and keeps its height', () => {
    expect(body(".uw-discussion-toggle[data-icon-only='true']")).toMatch(/padding: 0 8px/)
    expect(body('.uw-discussion-toggle')).toMatch(/height: 28px/)
  })

  it('theme tokens only', () => {
    const rules = [
      body(".uw-discussion-toggle[data-icon-only='true']"),
      body(".uw-discussion-toggle[data-icon-only='true'] .uw-discussion-toggle-label"),
    ].join('\n')
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  })
})
