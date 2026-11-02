import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `save-keeps-caret-marks.test.ts` covers the helper. These assertions pin the
 * wiring inside saveOnce(), because that is where the defect actually lived:
 * with the restore call removed the whole helper suite still passes, yet the
 * autosave still eats the user's font.
 */

const SRC = join(__dirname, '../src/renderer')
const fileActions = (): string => readFileSync(join(SRC, 'file-actions.ts'), 'utf8')

describe('saveOnce caret-mark wiring', () => {
<<<<<<< ours
  it('snapshots the caret marks before the save round-trips the document', () => {
    const src = fileActions()
    const snapshot = src.indexOf('caretMarksSnapshot(editor)')
    // scope to saveOnce: the doc is snapshotted and the bytes built before the
    // off-thread reparse, and the caret marks must be captured with them
    const roundtrip = src.indexOf(
      'await parseDocxOffThread(',
      src.indexOf('async function saveOnce('),
    )
    expect(snapshot).toBeGreaterThan(-1)
    // the snapshot has to exist before the doc can be replaced under it
    expect(snapshot).toBeLessThan(roundtrip)
=======
  it('snapshots the caret marks live, right before the doc is replaced', () => {
    const src = fileActions()
    const rewrite = src.indexOf('if (!unchanged) {', src.indexOf('async function saveOnce('))
    const snapshot = src.indexOf('const caretMarks = caretMarksSnapshot(editor)', rewrite)
    const setContent = src.indexOf('.setContent(rebasedPm', rewrite)
    expect(snapshot).toBeGreaterThan(rewrite)
    // taken after the save awaited, so a font picked during the save is the
    // one that comes back — and before the replacement that would drop it
    expect(snapshot).toBeLessThan(setContent)
  })

  it('reads the caret position at the same moment as the marks', () => {
    // a caret moved during the save clears storedMarks and the snapshot then
    // describes the new spot; restoring it at a pre-await position would pin
    // that formatting onto text the user left
    const src = fileActions()
    const saveOnce = src.indexOf('async function saveOnce(')
    const rewrite = src.indexOf('if (!unchanged) {', saveOnce)
    const pos = src.indexOf('const selectionPos = editor.state.selection.from', saveOnce)
    expect(pos).toBeGreaterThan(rewrite)
    expect(src.indexOf('const selectionPos = editor.state.selection.from', pos + 1)).toBe(-1)
>>>>>>> theirs
  })

  it('restores the marks after setContent, inside the rewrite branch only', () => {
    const src = fileActions()
    const rewrite = src.indexOf('if (!unchanged) {')
<<<<<<< ours
    const setContent = src.indexOf('.setContent(carryAiMarks(', rewrite)
=======
    const setContent = src.indexOf('.setContent(rebasedPm', rewrite)
>>>>>>> theirs
    const restore = src.indexOf('restoreMarksAfterDocRewrite(editor, caretMarks)', rewrite)
    expect(rewrite).toBeGreaterThan(-1)
    expect(setContent).toBeGreaterThan(rewrite)
    // after the replacement, and before the branch closes — the equal-doc path
    // must stay untouched so undo history, caret and scroll keep surviving
    expect(restore).toBeGreaterThan(setContent)
    const branchEnd = src.indexOf('ctx.setDocCss(', restore)
    expect(restore).toBeLessThan(branchEnd)
  })

  it('keeps annotation marks out of the snapshot', () => {
    // FORMAT_MARKS is the filter; without it a restored comment mark would
    // extend the comment onto whatever the user types next
    const src = fileActions()
    expect(src).toContain('FORMAT_MARKS')
    expect(src).toContain('serializeMarks')
  })
})
