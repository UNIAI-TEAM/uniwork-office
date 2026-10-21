// @vitest-environment node
/**
 * UNI-2060 follow-up: controls whose tooltip shows no chord still announce their table row
 * (`aria-keyshortcuts`), and every ribbon tab that offers the collapse key announces it too.
 * The App is too big to mount in jsdom, so the wiring is read from its source.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP = readFileSync(
  fileURLToPath(new URL('../src/renderer/ExcelShell.tsx', import.meta.url)),
  'utf8',
)
const count = (re: RegExp) => [...APP.matchAll(re)].length

/** ribbon commands that have a table row but a tooltip without a chord */
const ROWS: ReadonlyArray<[string, string]> = [
  ['link-open', 'sheets-78'],
  ['note-open', 'sheets-79'],
  ['insert-function-open', 'sheets-49'],
  ['name-manager-open', 'sheets-50'],
  ['calculate-now', 'sheets-53'],
  ['calculate-sheet', 'sheets-54'],
  ['flash-fill', 'sheets-52'],
  ['comment-new', 'sheets-80'],
  ['bold', 'sheets-63'],
  ['italic', 'sheets-64'],
  ['underline', 'sheets-65'],
  ['strike', 'sheets-66'],
]

describe('Sheets ribbon controls', () => {
  it('every ribbon tab tip has its aria-keyshortcuts twin', () => {
    const tips = count(/data-tip=\{collapse\.tabTip\(/g)
    expect(tips).toBeGreaterThan(0)
    expect(count(/aria-keyshortcuts=\{collapse\.tabKeyshortcuts\(/g)).toBe(tips)
  })

  it.each(ROWS)('onCommand(%s) announces %s', (command, row) => {
    const needle = "onClick={() => onCommand('" + command + "')}"
    const uses: number[] = []
    for (let at = APP.indexOf(needle); at >= 0; at = APP.indexOf(needle, at + 1)) uses.push(at)
    expect(uses.length).toBeGreaterThan(0)
    for (const use of uses) {
      const before = APP.slice(Math.max(0, use - 120), use)
      expect(before, command).toContain(`sheetsAria('${row}', SHORTCUT_TARGET)`)
    }
  })

  it('quick-access Undo / Redo announce their rows', () => {
    expect(APP).toMatch(
      /aria-keyshortcuts=\{sheetsAria\('sheets-07', SHORTCUT_TARGET\) \|\| undefined\}\s+onClick=\{\(\) => onUndo\(\)\}/,
    )
    expect(APP).toMatch(
      /aria-keyshortcuts=\{sheetsAria\('sheets-08', SHORTCUT_TARGET\) \|\| undefined\}\s+onClick=\{onRedo\}/,
    )
  })
})
