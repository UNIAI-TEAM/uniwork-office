import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = join(__dirname, '../src/renderer/src')
const read = (file: string) => readFileSync(join(dir, file), 'utf8')

/** the declarations of the first rule whose selector list has `selector` (comments dropped) */
function rule(css: string, selector: string): string {
  for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const [selectors, body] = chunk.split('{')
    if (body !== undefined && selectors!.split(',').some((one) => one.trim() === selector)) {
      return body
    }
  }
  return ''
}

/**
 * UNI-2066 WS-V1: `.modal p` (0,1,1) outranks a bare one-class rule, so the paragraphs of the folder
 * dialogs lost their margin and small type (the create-folder workspace note sat flush under the
 * name field). Each is scoped under the dialog class `.uw-act` (0,2,0), as FU-V7 did for `.fu-note`.
 */
describe('folder dialog paragraphs beat .modal p', () => {
  const cases: Array<[string, string, string, RegExp]> = [
    ['home.css', '.uw-act .uw-act-note', '.uw-act-note', /margin:\s*8px 0 0/],
    // UNI-2080 FU-2066-1: the field/dialog error paragraph, shared with the Share dialogs
    ['home.css', '.uw-act .uw-act-error', '.uw-act-error', /margin:\s*4px 0 0/],
    ['uniwork-folders/first-save-name.css', '.uw-act .ufs-hint', '.ufs-hint', /margin:\s*8px 0 0/],
    ['uniwork-folders/save-dialog.css', '.uw-act .uws-hint', '.uws-hint', /margin:\s*4px 0 8px/],
    [
      'uniwork-folders/save-dialog.css',
      '.uw-act .ufs-share-hint',
      '.ufs-share-hint',
      /margin:\s*0;/,
    ],
    [
      'uniwork-folders/save-dialog.css',
      '.uw-act .uwf-picker-note',
      '.uwf-picker-note',
      /margin:\s*8px 0 0/,
    ],
    [
      'uniwork-folders/uniwork-folders.css',
      '.uw-act .uwf-picker-path',
      '.uwf-picker-path',
      /margin:\s*0 0 8px/,
    ],
    [
      'uniwork-folders/uniwork-folders.css',
      '.uw-act .uwf-picker-state',
      '.uwf-picker-state',
      /margin:\s*12px/,
    ],
  ]

  for (const [file, scoped, bare, margin] of cases) {
    it(`${scoped} carries the margin and the small type`, () => {
      const css = read(file)
      expect(rule(css, scoped)).toMatch(margin)
      expect(rule(css, scoped)).toMatch(/font-size:/)
      // no bare one-class rule is left behind to lose to .modal p
      expect(rule(css, bare)).toBe('')
    })
  }

  it('the workspace note keeps its muted small type', () => {
    const body = rule(read('home.css'), '.uw-act .uw-act-note')
    expect(body).toContain('color: var(--text-muted)')
    expect(body).toMatch(/font-size:\s*12px/)
  })
})

/** relative luminance contrast of two #rrggbb / #rgb colours */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const v = parseInt(full.slice(i, i + 2), 16) / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** the value of `--name` inside the first rule of tokens.css whose selector list has `selector` */
function token(selector: string, name: string): string {
  const css = readFileSync(join(__dirname, '../../../packages/ui/src/tokens.css'), 'utf8')
  const body = rule(css, selector)
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(body)![1]!
}

/**
 * UNI-2080 FU-2066-3: the locked rows of the move picker dimmed their title with --text-muted, which on
 * the dark hover surface (#333) is 4.17:1. --text-secondary clears 4.5 on every row surface in both themes.
 */
describe('move picker locked rows stay legible', () => {
  const locked = '.uwf-tree-row.blocked .uwf-tree-title'

  it('dims the title with --text-secondary, not --text-muted', () => {
    const body = rule(read('uniwork-folders/uniwork-folders.css'), locked)
    expect(body).toContain('color: var(--text-secondary)')
    expect(body).not.toContain('--text-muted')
  })

  it('--text-secondary reaches 4.5:1 on the row, hover and current-location surfaces (dark and light)', () => {
    for (const theme of [':root', "[data-theme='dark']"]) {
      const text = token(theme, '--text-secondary')
      for (const surface of ['--surface', '--hover', '--tint-blue']) {
        expect(contrast(text, token(theme, surface)), `${theme} ${surface}`).toBeGreaterThanOrEqual(
          4.5,
        )
      }
    }
  })
})
