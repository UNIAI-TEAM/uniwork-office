import { Extension } from '@tiptap/core'
import { moveSelectedBlocks, uiOp } from './ops'

/**
 * SecondBrain-parity block shortcuts: ⌘⇧⌫ delete, ⌘⇧↑/↓ move the current
 * top-level block. Duplicate (⌘D) and link (⌘K) are table rows now, handled by
 * TableKeymap.
 */
export const BlockKeymap = Extension.create({
  name: 'blockKeymap',

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-Backspace': () => uiOp(this.editor, { op: 'deleteBlocks', target: 'selection' }),
      'Mod-Shift-ArrowUp': () => moveSelectedBlocks(this.editor, -1),
      'Mod-Shift-ArrowDown': () => moveSelectedBlocks(this.editor, 1),
    }
  },
})
