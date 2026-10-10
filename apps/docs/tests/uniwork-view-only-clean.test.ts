/**
 * A view-only UniWork docx must open clean: switching the editor to read-only
 * must not count as an edit (TipTap's setEditable emits `update` unless told
 * not to), and the footer shows a neutral view-only label, never "Unsaved".
 */
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { describe, expect, it } from 'vitest'
import { en } from '../src/renderer/i18n/app/en'
import { vi as viStrings } from '../src/renderer/i18n/app/vi'
import { saveStateLabel, setEditorEditable } from '../src/renderer/uniwork-doc-state'

function makeEditor(onUpdate: () => void): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text],
    content: '<p>hello</p>',
    onUpdate,
  })
}

describe('setEditorEditable', () => {
  it('does not emit an update (so the doc is not marked dirty) when going read-only', () => {
    let updates = 0
    const editor = makeEditor(() => (updates += 1))
    setEditorEditable(editor, false)
    expect(editor.isEditable).toBe(false)
    setEditorEditable(editor, true)
    expect(editor.isEditable).toBe(true)
    expect(updates).toBe(0)
    editor.destroy()
  })

  it('documents the root cause: the plain setEditable call emits update', () => {
    let updates = 0
    const editor = makeEditor(() => (updates += 1))
    editor.setEditable(false)
    expect(updates).toBe(1)
    editor.destroy()
  })
})

describe('saveStateLabel', () => {
  it('shows view only for a read-only document even when marked dirty', () => {
    expect(saveStateLabel(true, true)).toEqual({ key: 'appSaveStateViewOnly', unsaved: false })
    expect(saveStateLabel(false, true)).toEqual({ key: 'appSaveStateViewOnly', unsaved: false })
  })

  it('keeps the genoffice labels for editable documents', () => {
    expect(saveStateLabel(true, false)).toEqual({ key: 'appSaveStateUnsaved', unsaved: true })
    expect(saveStateLabel(false, false)).toEqual({ key: 'appSaveStateSaved', unsaved: false })
  })

  it('has en and vi copy', () => {
    expect(en.appSaveStateViewOnly).toBe('View only')
    expect(viStrings.appSaveStateViewOnly).toBe('Chỉ xem')
  })
})
