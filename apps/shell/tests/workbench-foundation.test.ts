// Workbench redesign foundation (spec 2): three tokens in every tokens.css theme block, and
// the shared .wb-* primitives in home.css, painted from tokens only.
import { existsSync, readFileSync } from 'node:fs'
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
/** the column rows: the page's, and the Desk's inside its box-less drop wrapper */
const COLUMN_ROWS = '.wb-home > :not(.wb-confirm, .wb-desk-drop),\n.wb-desk-drop > *'
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {\n`)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}', start + 1))
}

describe('workbench tokens', () => {
  it('defines --wb-row-hover, --wb-check-border and --wb-focus-ring in all three theme blocks', () => {
    expect(blocks).toHaveLength(3)
    for (const block of blocks) {
      // cards are border only (spec 1.3): no card shadow token left
      expect(block).not.toMatch(/--wb-shadow/)
      expect(hexIn(block, '--wb-row-hover')).toBeDefined()
      expect(hexIn(block, '--wb-check-border')).toBeDefined()
    }
    // the input focus ring: accent 22% in light, 35% in dark (spec 2.2)
    expect(blocks[0]).toMatch(
      /\n {2}--wb-focus-ring: color-mix\(in srgb, var\(--accent\) 22%, transparent\);/,
    )
    expect(blocks[1]).toMatch(
      /\n {2}--wb-focus-ring: color-mix\(in srgb, var\(--accent\) 35%, transparent\);/,
    )
    expect(blocks[2]).toMatch(
      /\n {4}--wb-focus-ring: color-mix\(in srgb, var\(--accent\) 35%, transparent\);/,
    )
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
      // a hover that shows (P3-1: #f7f8fa on white was 1.06:1)
      expect(contrast(hover, surface)).toBeGreaterThanOrEqual(1.1)
    },
  )
})

describe('workbench primitives (home.css)', () => {
  it('the Workbench column: one 32px gutter, a 1200px centred column, UniWork Sans at 13px', () => {
    const home = rule('.wb-home')
    expect(home).toMatch(/gap: 16px;/)
    // replaces .content's padding on the same element instead of adding a second gutter
    expect(home).toMatch(/padding: 24px 32px 56px;/)
    expect(home).not.toMatch(/padding-inline/)
    expect(home).toMatch(/font-family: 'UniWork Sans', var\(--ui-cjk\), system-ui, sans-serif;/)
    expect(home).toMatch(/font-size: 13px;/)
    // the fixed confirm popover places itself
    expect(rule(COLUMN_ROWS)).toMatch(/max-width: 1200px;\n {2}margin-inline: auto;/)
    expect(rule(':where(.wb-home) p')).toMatch(/max-width: 64ch;\n {2}text-wrap: pretty;/)
  })

  it('UniWork Sans is self-hosted Inter for every subset, Vietnamese included, 400–700', () => {
    const fonts = readFileSync(join(__dirname, '../src/renderer/src/workbench-fonts.css'), 'utf8')
    const faces = [...fonts.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1]!)
    expect(faces).toHaveLength(12)
    for (const face of faces) {
      expect(face).toMatch(/font-family: 'UniWork Sans';/)
      // offline: only files bundled with the renderer, never a CDN
      const url = /src: url\('([^']+)'\)/.exec(face)![1]!
      expect(url).toMatch(/^\.\/assets\/fonts\/[a-z-]+-\d00\.woff2$/)
      expect(existsSync(join(__dirname, '../src/renderer/src', url))).toBe(true)
    }
    // one typeface: a Vietnamese word takes its base letters from inter-latin and its accented
    // letters from inter-vietnamese, so no second family may draw any glyph
    for (const face of faces) expect(face).toMatch(/url\('\.\/assets\/fonts\/inter-/)
    expect(faces.filter((f) => /inter-vietnamese-/.test(f))).toHaveLength(4)
    expect(fonts).not.toMatch(/vietnam-pro/i)
    expect(faces.map((f) => /font-weight: (\d+);/.exec(f)![1]).sort()).toEqual([
      '400',
      '400',
      '400',
      '500',
      '500',
      '500',
      '600',
      '600',
      '600',
      '700',
      '700',
      '700',
    ])
    const main = readFileSync(join(__dirname, '../src/renderer/src/main.tsx'), 'utf8')
    expect(main).toContain("import './workbench-fonts.css'")
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
    expect(btn).toMatch(/transition:\n {4}background-color var\(--transition-fast\)/)
    expect(rule('.wb-btn-sm')).toMatch(/height: 28px;\n {2}padding: 0 10px;\n {2}font-size: 12px;/)
    expect(rule('.wb-btn:active:not(:disabled)')).toMatch(/transform: scale\(0\.98\);/)
    expect(css).toMatch(
      /\n\.wb-btn:focus-visible \{\n {2}outline: 2px solid var\(--accent\);\n {2}outline-offset: 2px;/,
    )
    // locked is neutral grey, never a faded accent
    const locked = rule('.wb-btn:disabled')
    expect(locked).toMatch(/background: var\(--surface-subtle\);/)
    expect(locked).toMatch(/color: var\(--text-tertiary\);/)
    expect(locked).not.toMatch(/opacity/)
    expect(rule('.wb-btn-danger')).toMatch(
      /background: var\(--danger-text\);\n {2}color: var\(--surface\);/,
    )
  })

  it('one 32px input with an accent border and a 3px ring on focus', () => {
    expect(rule('.wb-input')).toMatch(/height: 32px;/)
    expect(rule('.wb-input')).toMatch(/border-radius: var\(--radius-8\);/)
    expect(rule('.wb-input:focus,\n.wb-input:focus-visible')).toMatch(
      /border-color: var\(--accent\);\n {2}outline: none;\n {2}box-shadow: 0 0 0 3px var\(--wb-focus-ring\);/,
    )
    // the six one-off input styles are gone
    for (const old of [
      '.wb-form input',
      '.wb-forms-add input',
      '.wb-kn-search input',
      '.wb-notes-add input',
      '.wb-desk-split input',
      '.wb-add-row select',
    ]) {
      expect(css, old).not.toContain(`\n${old}`)
    }
  })

  it('pills: 20px, radius 6, neutral by default with danger, warning, success and info', () => {
    const pill = rule('.wb-pill')
    expect(pill).toMatch(/height: 20px;/)
    expect(pill).toMatch(/border-radius: var\(--radius-6\);/)
    expect(pill).toMatch(
      /background: var\(--surface-subtle\);\n {2}color: var\(--text-secondary\);/,
    )
    expect(rule('.wb-pill.is-success')).toMatch(/background: var\(--success-bg\);/)
    expect(rule('.wb-pill.is-info')).toMatch(/background: var\(--info-bg\);/)
    expect(rule('.wb-pill-dot')).toMatch(/background: currentColor;/)
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
    expect(rule('.wb-block')).not.toMatch(/box-shadow/)
    expect(rule('.wb-row:hover')).toMatch(/background: var\(--wb-row-hover\);/)
    expect(rule('.wb-row + .wb-row')).toMatch(/border-top: 1px solid var\(--border-subtle\);/)
    expect(rule('.wb-group-head.is-overdue')).toMatch(/color: var\(--danger-text\);/)
  })

  it('row actions hide until the row is hovered or holds focus (always shown on touch)', () => {
    expect(rule('.wb-row-actions')).toMatch(/opacity: 0;/)
    expect(css).toContain(
      '\n.wb-row:hover .wb-row-actions,\n.wb-row:focus-within .wb-row-actions {\n',
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

describe('workbench states and the tab toolbar (home.css)', () => {
  it('state panels draw no box: the full one centres, the compact one sits left with a 28px tile', () => {
    expect(rule('.wb-state')).not.toMatch(/border/)
    expect(rule('.wb-state')).toMatch(/align-items: center;/)
    expect(css).not.toMatch(/\.wb-work-state\b/)
    expect(rule('.wb-state-icon')).toMatch(
      /width: 36px;\n {2}height: 36px;\n {2}border-radius: var\(--radius-8\);/,
    )
    expect(rule('.wb-state-title')).toMatch(/font-size: 13px;\n {2}font-weight: 600;/)
    expect(rule('.wb-state-body')).toMatch(/max-width: 52ch;/)
    expect(rule('.wb-state.is-compact')).toMatch(/padding: 12px;\n {2}text-align: start;/)
    expect(rule('.wb-state.is-compact .wb-state-icon')).toMatch(/width: 28px;\n {2}height: 28px;/)
  })

  it('the skeleton wrapper holds row-shaped placeholders, no fixed grey block', () => {
    expect(rule('.wb-work-skeleton')).not.toMatch(/height|background/)
    expect(rule('.wb-skel-dot')).toMatch(/border-radius: 50%;/)
  })

  it('the toolbar: a one-line summary left, the actions right, no visible tab title', () => {
    expect(rule('.wb-toolbar')).toMatch(/justify-content: space-between;/)
    expect(rule('.wb-toolbar-summary')).toMatch(/min-width: 0;/)
    expect(rule('.wb-toolbar-text')).toMatch(/max-width: none;/)
    expect(css).not.toMatch(/\.wb-pane-(?:head|title|meta|aside)\b/)
  })

  it('the toast host ends the column even on a short tab, and sticks 24px above the bottom', () => {
    const body = rule('.wb-toast-host')
    // sticky insets count from inside .wb-home's 56px bottom padding: -32px is 24px above the
    // edge, the same place the stack ends at the bottom of the page, so scrolling down uncovers
    expect(body).toMatch(/position: sticky;\n {2}bottom: -32px;/)
    // a short tab: pushed to the column end; 56px padding - 32px = 24px from the edge
    expect(body).toMatch(/margin-top: auto;\n {2}margin-bottom: -32px;/)
  })
})

describe('long titles (review focus: very long workspace and task names)', () => {
  it.each([
    '.wb-row-title',
    '.wb-row-sub',
    '.wb-crumb-name',
    '.wb-forms-name',
    '.wb-forms-file-name',
  ])('%s truncates to one line with an ellipsis instead of pushing its row apart', (selector) => {
    const body = rule(selector)
    expect(body).toMatch(/overflow: hidden;/)
    expect(body).toMatch(/text-overflow: ellipsis;/)
    expect(body).toMatch(/white-space: nowrap;/)
  })

  it('the flexible title cells can shrink below their text width', () => {
    for (const selector of ['.wb-row-title', '.wb-toolbar-summary', '.wb-ov-meet']) {
      expect(rule(selector), selector).toMatch(/min-width: 0;/)
    }
  })
})

describe('the Workbench lays out by its own width (impeccable audit P1-2, P2-1, P2-3..6, P3-2, P3-3)', () => {
  it('rows never shrink; breakpoints are container queries on .wb-home, not the window', () => {
    expect(rule('.wb-home')).toMatch(/container: wb-home \/ inline-size;/)
    expect(rule('.wb-desk-drop')).toMatch(/display: contents;/)
    expect(rule(COLUMN_ROWS)).toMatch(/flex-shrink: 0;/)
    // a viewport query misses the sidebar and the interface scale (zoom)
    expect(css).not.toMatch(/@media \(max-width: \d+px\) \{\n {2}\.wb-/)
    expect(css).toMatch(
      /@container wb-home \(max-width: 760px\) \{\n {2}\.wb-desk \{\n {4}grid-template-columns: minmax\(0, 1fr\);\n {2}\}\n\n {2}\.wb-desk-today \{\n {4}order: -1;/,
    )
    expect(css).toMatch(/@container wb-home \(max-width: 760px\) \{\n {2}\.wb-kn \{/)
  })

  it('the pack head wraps its actions; chips and the tool divider stay inside their card', () => {
    expect(rule('.wb-kn-head')).toMatch(/flex-wrap: wrap;/)
    expect(rule('.wb-kn-head-text')).toMatch(/flex: 1 1 240px;/)
    expect(rule('.wb-desk-chip')).toMatch(/max-width: 100%;/)
    expect(rule('.wb-desk-chip-text')).toMatch(/text-overflow: ellipsis;/)
    expect(rule('.wb-desk-tools')).toMatch(/container-type: inline-size;/)
    expect(css).toMatch(
      /@container \(max-width: 720px\) \{\n {2}\.wb-desk-tool-sep \{\n {4}display: none;/,
    )
    expect(rule('.wb-desk-head')).toMatch(/flex-wrap: wrap;/)
  })

  it('field and secondary-button outlines use the 3:1 control border; the active tab clears the fade', () => {
    expect(rule('.wb-input')).toMatch(/border: 1px solid var\(--border-control\);/)
    expect(rule('.wb-btn-secondary')).toMatch(/border-color: var\(--border-control\);/)
    expect(rule('.wb-kn-tags')).toMatch(/border: 1px solid var\(--border-control\);/)
    expect(rule('.wb-tabs-scroll')).toMatch(/scroll-padding-inline: 40px;/)
  })
})
