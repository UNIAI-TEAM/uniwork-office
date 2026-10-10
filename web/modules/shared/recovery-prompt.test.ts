// The draft prompt opens before the renderer has a document, so its scrim carries the page-sheet
// backdrop class (frame-dialog.css) instead of blurring an empty frame (UNI-1232 FX2, R2-07).
import { afterEach, expect, it } from 'vitest'
import { DRAFT_PROMPT_MARKER, DRAFT_PROMPT_MASK_CLASS, promptDraftRestore } from './recovery-prompt'

afterEach(() => {
  document.body.replaceChildren()
})

it('shows the draft prompt over the page-sheet scrim, Restore first and focused', async () => {
  const done = promptDraftRestore({ name: 'a.md', savedAt: 0, baseEtag: 'e', older: false })
  const mask = document.querySelector(`[data-office-web="${DRAFT_PROMPT_MARKER}"]`)!
  expect(mask.classList.contains('ow-dlg-mask')).toBe(true)
  expect(mask.classList.contains(DRAFT_PROMPT_MASK_CLASS)).toBe(true)
  const restore = mask.querySelector<HTMLButtonElement>('[data-choice="restore"]')!
  expect(document.activeElement).toBe(restore)
  restore.click()
  expect(await done).toBe('restore')
})
