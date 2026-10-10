/**
 * Bring the editor's editability in line with the document's view-only state.
 * TipTap's setEditable runs view.update (which re-syncs the DOM selection from
 * ProseMirror and drops a caret that was set but not yet read) and emits
 * `update` by default (which marks the document dirty). So it is only called
 * when the state actually differs, and never emits.
 */
export function syncEditorEditable(
  editor: { isEditable: boolean; setEditable(editable: boolean, emitUpdate?: boolean): void },
  readOnly: boolean,
): void {
  if (editor.isEditable === !readOnly) return
  editor.setEditable(!readOnly, false)
}
