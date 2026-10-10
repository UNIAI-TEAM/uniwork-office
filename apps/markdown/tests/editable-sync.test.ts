/**
 * A local editable document must see zero setEditable calls on open (the call
 * resets the DOM caret and emits update); a view-only UniWork document gets one
 * non-emitting call, so it is not marked dirty.
 */
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { describe, expect, it, vi } from 'vitest'
import { syncEditorEditable } from '../src/renderer/editor/editable-sync'

function makeEditor(onUpdate: () => void): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text],
    content: '<p>hello</p>',
    onUpdate,
  })
}

describe('syncEditorEditable', () => {
  it('makes no setEditable call for an editable (unbound or local) document', () => {
    let updates = 0
    const editor = makeEditor(() => (updates += 1))
    const spy = vi.spyOn(editor, 'setEditable')
    syncEditorEditable(editor, false)
    expect(spy).not.toHaveBeenCalled()
    expect(editor.isEditable).toBe(true)
    expect(updates).toBe(0)
    editor.destroy()
  })

  it('makes one non-emitting call when the document becomes view-only', () => {
    let updates = 0
    const editor = makeEditor(() => (updates += 1))
    const spy = vi.spyOn(editor, 'setEditable')
    syncEditorEditable(editor, true)
    syncEditorEditable(editor, true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(false, false)
    expect(editor.isEditable).toBe(false)
    expect(updates).toBe(0)
    editor.destroy()
  })

  it('restores editability without emitting update', () => {
    let updates = 0
    const editor = makeEditor(() => (updates += 1))
    syncEditorEditable(editor, true)
    syncEditorEditable(editor, false)
    expect(editor.isEditable).toBe(true)
    expect(updates).toBe(0)
    editor.destroy()
  })
})
