import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { isEditorCommand, markdownShortcutCommand, type MarkdownEditorCommand } from '../shortcuts'
import { uiOp } from './ops'

/** an open link popover (the ribbon's) is asked for through this window event */
export const OPEN_LINK_EVENT = 'mdapp:open-link'

type EditorKey = Exclude<MarkdownEditorCommand, 'undo' | 'redo'>

const heading = (editor: Editor, level: 1 | 2 | 3) =>
  uiOp(editor, { op: 'setBlockType', target: 'selection', type: 'heading', level })

/** what each editor chord does; history is left to ProseMirror's own keymap */
const RUN: Readonly<Record<EditorKey, (editor: Editor) => boolean>> = {
  bold: (e) => uiOp(e, { op: 'setStyle', target: 'selection', style: 'bold', mode: 'toggle' }),
  italic: (e) => uiOp(e, { op: 'setStyle', target: 'selection', style: 'italic', mode: 'toggle' }),
  strike: (e) => uiOp(e, { op: 'setStyle', target: 'selection', style: 'strike', mode: 'toggle' }),
  heading1: (e) => heading(e, 1),
  heading2: (e) => heading(e, 2),
  heading3: (e) => heading(e, 3),
  paragraph: (e) => uiOp(e, { op: 'setBlockType', target: 'selection', type: 'paragraph' }),
  bulletList: (e) => uiOp(e, { op: 'toggleList', target: 'selection', list: 'bullet' }),
  orderedList: (e) => uiOp(e, { op: 'toggleList', target: 'selection', list: 'ordered' }),
  duplicateBlock: (e) => uiOp(e, { op: 'duplicateBlocks', target: 'selection' }),
  link: () => {
    window.dispatchEvent(new CustomEvent(OPEN_LINK_EVENT))
    return true
  },
}

/**
 * Text and block keys from the markdown shortcut table, matched by the shared
 * matcher (key vs code, IME composition, AltGr). It replaces the keys TipTap's
 * marks bound by themselves: Mod-Shift-s (strikethrough, shadowed Save As on
 * macOS) and Mod-e (inline code, shadowed the source toggle) are stripped from
 * `TableStrike` / `CodeSpan`, and strikethrough answers Ctrl+Shift+S on Windows
 * and Shift+Cmd+X on macOS. The headings, lists, bold and italic still carry
 * TipTap's own keys; those equal the table's chords (or a subset), so they
 * cannot take a key the table gave to another action.
 */
export const TableKeymap = Extension.create({
  name: 'tableKeymap',
  priority: 1000,

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('tableKeymap'),
        props: {
          handleKeyDown(_view, event) {
            const command = markdownShortcutCommand(event)
            if (!command || !isEditorCommand(command)) return false
            if (command === 'undo' || command === 'redo') return false
            return RUN[command](editor)
          },
        },
      }),
    ]
  },
})
