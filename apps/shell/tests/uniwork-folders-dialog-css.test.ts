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
