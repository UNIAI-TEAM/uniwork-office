// Workbench redesign foundation (spec 2): three tokens in every tokens.css theme block, and
// the shared .wb-* primitives in home.css, painted from tokens only.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(join(__dirname, '..', '..', '..', 'packages/ui/src/tokens.css'), 'utf8')
const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8').replace(
  /\r\n/g,
  '\n',
)
const blocks = tokens.split(/\n(?=\[data-theme='dark'\]|@media \(prefers-color-scheme: dark\))/)

const hexIn = (block: string, name: string) =>
  new RegExp(`\\n\\s*${name}:\\s*(#[0-9a-f]{6});`).exec(block)?.[1]
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
/** the body of the rule whose selector line is exactly `selector` */
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {\n`)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}', start + 1))
}

describe('workbench tokens', () => {
  it('defines --wb-shadow, --wb-row-hover and --wb-check-border in all three theme blocks', () => {
    expect(blocks).toHaveLength(3)
    for (const block of blocks) {
      expect(block).toMatch(/\n\s*--wb-shadow: [^;]+;/)
      expect(hexIn(block, '--wb-row-hover')).toBeDefined()
      expect(hexIn(block, '--wb-check-border')).toBeDefined()
    }
    // dark blocks separate by their border, not a shadow
    expect(blocks[1]).toMatch(/\n {2}--wb-shadow: none;/)
    expect(blocks[2]).toMatch(/\n {4}--wb-shadow: none;/)
  })

  it.each([
    ['light', 0],
    ['dark', 1],
    ['system-dark', 2],
  ] as const)(
    '%s: the checkbox outline reaches 3:1 on the surface and on a hovered row, and the hover shows',
    (_name, i) => {
      const block = blocks[i]!
      const surface = hexIn(block, '--surface')!
      const hover = hexIn(block, '--wb-row-hover')!
      const border = hexIn(block, '--wb-check-border')!
      expect(contrast(border, surface)).toBeGreaterThanOrEqual(3)
      expect(contrast(border, hover)).toBeGreaterThanOrEqual(3)
      expect(contrast(hover, surface)).toBeGreaterThanOrEqual(1.05)
    },
  )
})

describe('workbench primitives (home.css)', () => {
  it('the Workbench column: 24px side gutters, 18px between sections, capped at 1180px', () => {
    expect(rule('.wb-home')).toMatch(/gap: 18px;/)
    expect(rule('.wb-home')).toMatch(/padding-inline: 24px;/)
    // the fixed skill-confirm overlay must keep the full window
    expect(rule('.wb-home > :not(.modal-overlay)')).toMatch(/max-width: 1180px;/)
    expect(rule(':where(.wb-home) p')).toMatch(/max-width: 64ch;\n {2}text-wrap: pretty;/)
  })

  it('the primary button is the app accent, not the shared black --color-btn-primary', () => {
    expect(rule('.wb-btn-primary')).toMatch(
      /background: var\(--accent\);\n {2}color: var\(--on-accent\);/,
    )
    expect(rule('.wb-btn-primary:hover:not(:disabled)')).toMatch(
      /background: var\(--accent-hover\);/,
    )
  })

  it('buttons are 32px (28px small), radius 8, flat, press to 0.98, accent focus ring', () => {
    const btn = rule('.wb-btn')
    expect(btn).toMatch(/height: 32px;/)
    expect(btn).toMatch(/border-radius: var\(--radius-8\);/)
    expect(btn).not.toMatch(/box-shadow/)
    expect(rule('.wb-btn-sm')).toMatch(/height: 28px;/)
    expect(rule('.wb-btn:active:not(:disabled)')).toMatch(/transform: scale\(0\.98\);/)
    expect(css).toMatch(
      /\n\.wb-btn:focus-visible \{\n {2}outline: 2px solid var\(--accent\);\n {2}outline-offset: 2px;/,
    )
    expect(rule('.wb-btn:disabled')).toMatch(/opacity: 0\.5;\n {2}cursor: not-allowed;/)
  })

  it('reduced motion stops the button transition, the press scale and the shimmer', () => {
    expect(css).toContain(
      '@media (prefers-reduced-motion: reduce) {\n  .wb-btn {\n    transition: none;\n  }\n\n' +
        '  .wb-btn:active:not(:disabled) {\n    transform: none;\n  }\n\n' +
        '  .wb-skel {\n    animation: none;\n  }\n}',
    )
    expect(rule('.wb-skel')).toMatch(/animation: wb-skel-shimmer 1\.2s/)
    // the UniWork open picker keeps its own pulse
    expect(rule('.uw-skel')).toMatch(/animation: uw-skel-pulse/)
  })

  it('numbers, mono ids, blocks and rows read from tokens', () => {
    expect(rule('.wb-num')).toMatch(/font-variant-numeric: tabular-nums;/)
    expect(rule('.wb-mono')).toMatch(/color: var\(--text-secondary\);/)
    expect(rule('.wb-block')).toMatch(/box-shadow: var\(--wb-shadow\);/)
    expect(rule('.wb-row:hover')).toMatch(/background: var\(--wb-row-hover\);/)
    expect(rule('.wb-row + .wb-row')).toMatch(/border-top: 1px solid var\(--border-subtle\);/)
    expect(rule('.wb-group-head.is-overdue')).toMatch(/color: var\(--danger-text\);/)
  })

  it('row actions hide until the row is hovered or holds focus (always shown on touch)', () => {
    expect(rule('.wb-row-actions')).toMatch(/opacity: 0;/)
    expect(css).toContain(
      '\n.wb-row:hover .wb-row-actions,\n.wb-row:focus-within .wb-row-actions,\n',
    )
    expect(css).toContain('@media (hover: none) {\n  .wb-row-actions {\n    opacity: 1;\n  }\n}')
  })

  it('the drawn checkbox keeps a focus ring and fills with the accent when ticked', () => {
    expect(rule('.wb-check')).toMatch(/position: relative;/)
    expect(rule('.wb-check-box')).toMatch(/border: 1\.5px solid var\(--wb-check-border\);/)
    expect(rule('.wb-check input:checked + .wb-check-box')).toMatch(/background: var\(--accent\);/)
    expect(rule('.wb-check input:focus-visible + .wb-check-box')).toMatch(
      /outline: 2px solid var\(--accent\);/,
    )
  })

  it('the unused pill sub-tabs are gone', () => {
    expect(css).not.toMatch(/\.wb-subtab/)
  })
})

describe('workbench states and pane title (home.css)', () => {
  it('state panels draw no box: the dashed .wb-work-state is gone', () => {
    expect(rule('.wb-state')).not.toMatch(/border/)
    expect(css).not.toMatch(/\.wb-work-state\b/)
    expect(rule('.wb-state-icon')).toMatch(
      /width: 36px;\n {2}height: 36px;\n {2}border-radius: 10px;/,
    )
    expect(rule('.wb-state-title')).toMatch(/font-size: 14px;\n {2}font-weight: 600;/)
    expect(rule('.wb-state-body')).toMatch(/max-width: 52ch;/)
  })

  it('the skeleton wrapper is a column of shimmer rows, no fixed grey block', () => {
    expect(rule('.wb-work-skeleton')).not.toMatch(/height|background/)
  })

  it('the pane title is 16/600 with a one-line meta and a right-hand aside', () => {
    expect(rule('.wb-pane-title')).toMatch(
      /font-size: 16px;\n {2}font-weight: 600;\n {2}letter-spacing: -0\.01em;/,
    )
    expect(rule('.wb-pane-meta')).toMatch(/text-overflow: ellipsis;\n {2}white-space: nowrap;/)
    expect(rule('.wb-pane-text')).toMatch(/min-width: 0;/)
    expect(rule('.wb-pane-aside')).toMatch(/margin-left: auto;/)
  })
})

describe('long titles (review focus: very long workspace and task names)', () => {
  it.each(['.wb-ov-row-title', '.wb-work-title', '.wb-crumb-name', '.wb-pane-meta'])(
    '%s truncates to one line with an ellipsis instead of pushing its row apart',
    (selector) => {
      const body = rule(selector)
      expect(body).toMatch(/overflow: hidden;/)
      expect(body).toMatch(/text-overflow: ellipsis;/)
      expect(body).toMatch(/white-space: nowrap;/)
    },
  )

  it('the flexible title cells can shrink below their text width', () => {
    for (const selector of ['.wb-ov-row-title', '.wb-work-title', '.wb-pane-text', '.wb-ov-meet']) {
      expect(rule(selector), selector).toMatch(/min-width: 0;/)
    }
  })
})
