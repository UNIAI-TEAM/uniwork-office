import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { afterRespellKick, beginSpellingEdit } from './respell-kick-gate'

const WORD_CHAR = /[\p{L}\p{N}\p{M}'’_-]/u

const isWordChar = (ch: string | undefined) => ch !== undefined && WORD_CHAR.test(ch)

/**
 * Document range of Chromium's misspelled word around `pos` (the right-click
 * position). The word text is matched inside the clicked textblock at word
 * boundaries; when it occurs several times the occurrence containing (or
 * touching) the click wins. Null when the click is not on that word.
 */
export function misspelledRangeAt(
  doc: PMNode,
  pos: number,
  word: string,
): { from: number; to: number } | null {
  if (!word || pos < 0 || pos > doc.content.size) return null
  const $pos = doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock) return null
  const start = $pos.start()
  // one placeholder char per inline atom keeps string offsets aligned with positions
  const text = parent.textBetween(0, parent.content.size, undefined, '￼')
  const offset = pos - start
  let best: { from: number; to: number } | null = null
  let bestDist = Infinity
  let idx = text.indexOf(word)
  while (idx !== -1) {
    const end = idx + word.length
    if (!isWordChar(text[idx - 1]) && !isWordChar(text[end])) {
      const dist = offset < idx ? idx - offset : offset > end ? offset - end : 0
      if (dist < bestDist) {
        bestDist = dist
        best = { from: start + idx, to: start + end }
      }
    }
    idx = text.indexOf(word, idx + 1)
  }
  return best && bestDist <= 1 ? best : null
}

/** Replace the misspelled word at the right-click position through ProseMirror so undo and marks survive. */
export function replaceMisspelledWord(
  editor: Editor,
  pos: number,
  word: string,
  replacement: string,
): boolean {
  const range = misspelledRangeAt(editor.state.doc, pos, word)
  if (!range) return false
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.insertText(replacement, range.from, range.to)
      return true
    })
    .run()
}

/** Blink's edit and the IPC reply travel on different pipes: time for the edit to land. */
const BLINK_REPLACE_GRACE_MS = 150

/**
 * Blink's replaceMisspelling first: a scripted ProseMirror replacement rewrites
 * the run's DOM text node and Chromium drops the spelling markers of the node's
 * other misspelled words until the user types again. Blink edits inside the
 * node (siblings keep their squiggles) and ProseMirror records the DOM change
 * as one undo step; the ProseMirror path stays as the fallback when Blink
 * finds no marker under the caret.
 */
export function applySpellingSuggestion(
  editor: Editor,
  pos: number | null,
  word: string,
  replacement: string,
  blinkReplace?: (replacement: string) => Promise<void>,
): void {
  // the right-click position goes stale if the document changes while the
  // edit waits: follow it through every transaction until the edit runs
  let at = pos
  const follow = ({ transaction }: { transaction: Transaction }) => {
    if (at != null) at = transaction.mapping.map(at)
  }
  editor.on('transaction', follow)
  // after Add to Dictionary the respell kick may still own the caret text node
  afterRespellKick(() => {
    editor.off('transaction', follow)
    applyNow(editor, at, word, replacement, blinkReplace)
  })
}

function applyNow(
  editor: Editor,
  pos: number | null,
  word: string,
  replacement: string,
  blinkReplace?: (replacement: string) => Promise<void>,
): void {
  if (editor.isDestroyed) return
  const range = pos != null ? misspelledRangeAt(editor.state.doc, pos, word) : null
  const fallback = () => {
    if (range) replaceMisspelledWord(editor, range.from, word, replacement)
  }
  if (!blinkReplace) return fallback()
  // Blink replaces the marker under the selection, and a right-click inside a
  // range keeps that range: aim it at the clicked word first
  if (range) editor.commands.setTextSelection(range)
  else if (!editor.state.selection.empty) return
  const before = editor.state.doc
  // a respell kick must not snapshot the caret text node until Blink's edit
  // (or the fallback) has landed: its scrub would restore the pre-edit text
  const endEdit = beginSpellingEdit()
  editor.view.focus()
  void blinkReplace(replacement)
    .catch(() => undefined)
    .then(() => {
      setTimeout(() => {
        try {
          if (!editor.isDestroyed && editor.state.doc === before) fallback()
        } finally {
          endEdit()
        }
      }, BLINK_REPLACE_GRACE_MS)
    })
}
