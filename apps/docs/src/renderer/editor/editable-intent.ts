/**
 * Whether the App wants the editor editable (Read Mode, protection, a view-only UniWork copy),
 * kept apart from `editor.options.editable`: @tiptap/react's useEditor re-applies the options on
 * every render as `editable: editor.isEditable`, so while something else holds the view
 * read-only (an AI run) any App render writes that hold into the option and it would outlive it.
 */
const intents = new WeakMap<object, boolean>()

export function noteEditableIntent(editor: object, editable: boolean): void {
  intents.set(editor, editable)
}

/** the App's last word on editability, or undefined when it never said */
export function editableIntent(editor: object): boolean | undefined {
  return intents.get(editor)
}
