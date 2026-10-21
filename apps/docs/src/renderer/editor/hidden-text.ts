import type { Editor } from '@tiptap/core'

/**
 * Word's Hide the selected text (Ctrl+Shift+H): flips the run's own w:vanish, the same
 * attribute the Font dialog's Hidden box writes. Turning it off writes an explicit false,
 * so a style that hides the text does not bring it back.
 */
export function toggleHiddenText(editor: Editor): boolean {
  const hidden = editor.getAttributes('docTextStyle').vanish === true
  return editor
    .chain()
    .focus()
    .setMark(
      'docTextStyle',
      hidden ? { vanish: false, vanishOwn: false } : { vanish: true, vanishOwn: true },
    )
    .run()
}
