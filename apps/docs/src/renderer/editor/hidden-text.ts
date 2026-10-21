import type { Editor } from '@tiptap/core'

/** True when the selection holds text and every text node of it is hidden (Word hides the
 * whole selection unless it is all hidden already); a bare cursor reads its own marks. */
function isAllHidden(editor: Editor): boolean {
  const { selection, doc } = editor.state
  if (selection.empty) return editor.getAttributes('docTextStyle').vanish === true
  let texts = 0
  let hidden = 0
  for (const range of selection.ranges) {
    doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
      if (!node.isText) return
      texts++
      if (
        node.marks.some((mark) => mark.type.name === 'docTextStyle' && mark.attrs.vanish === true)
      )
        hidden++
    })
  }
  return texts > 0 && texts === hidden
}

/**
 * Word's Hide the selected text (Ctrl+Shift+H): flips the run's own w:vanish, the same
 * attribute the Font dialog's Hidden box writes. A mixed selection is hidden as a whole.
 * Turning it off writes an explicit false, like the dialog does for text that reads hidden:
 * the editor cannot tell the run's own w:vanish from a style's, and a bare null would let a
 * hiding style bring the text back after a save.
 */
export function toggleHiddenText(editor: Editor): boolean {
  const hidden = isAllHidden(editor)
  return editor
    .chain()
    .focus()
    .setMark(
      'docTextStyle',
      hidden ? { vanish: false, vanishOwn: false } : { vanish: true, vanishOwn: true },
    )
    .run()
}
