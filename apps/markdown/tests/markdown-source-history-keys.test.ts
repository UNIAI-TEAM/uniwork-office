// UNI-2011 S-html-md: the text editor's undo and redo (the plain-text / source pane) come from the
// markdown shortcut table, so Ctrl+Shift+Z redoes there as it does in the document (CodeMirror's
// stock keymap does not).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { PlainTextEditor, type PlainTextEditorHandle } from '../src/renderer/source/PlainTextEditor'

const cleanups: Array<() => void> = []
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

function mountEditor() {
  const ref = { current: null as PlainTextEditorHandle | null }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() =>
    root.render(
      createElement(PlainTextEditor, {
        ref,
        className: 'source-editor',
        initialText: '',
        mode: 'plain',
        spellcheck: false,
        onChange: () => {},
      }),
    ),
  )
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  const text = () => view.state.doc.toString()
  const type = (insert: string) =>
    view.dispatch({ changes: { from: view.state.doc.length, insert }, userEvent: 'input.type' })
  const press = (
    key: string,
    code: string,
    init: { shiftKey?: boolean; isComposing?: boolean; keyCode?: number } = {},
  ) => {
    const event = new KeyboardEvent('keydown', {
      key,
      code,
      ctrlKey: true,
      shiftKey: init.shiftKey ?? false,
      isComposing: init.isComposing ?? false,
      bubbles: true,
      cancelable: true,
    })
    if (init.keyCode) Object.defineProperty(event, 'keyCode', { value: init.keyCode })
    act(() => {
      view.contentDOM.dispatchEvent(event)
    })
    return event
  }
  return { text, type, press, handle: () => ref.current! }
}

describe('markdown plain-text editor: history keys', () => {
  it('Ctrl+Z undoes; Ctrl+Y and Ctrl+Shift+Z (Caps Lock or not) redo', () => {
    const ed = mountEditor()
    ed.type('hello')
    expect(ed.text()).toBe('hello')
    ed.press('z', 'KeyZ')
    expect(ed.text()).toBe('')
    ed.press('y', 'KeyY')
    expect(ed.text()).toBe('hello')
    ed.press('z', 'KeyZ')
    expect(ed.text()).toBe('')
    const redo = ed.press('Z', 'KeyZ', { shiftKey: true })
    expect(ed.text()).toBe('hello')
    expect(redo.defaultPrevented).toBe(true)
    ed.press('z', 'KeyZ')
    ed.press('z', 'KeyZ', { shiftKey: true })
    expect(ed.text()).toBe('hello')
  })

  it('leaves an IME composition alone (isComposing and keyCode 229)', () => {
    const ed = mountEditor()
    ed.type('hello')
    ed.press('z', 'KeyZ')
    expect(ed.text()).toBe('')
    const composing = ed.press('Z', 'KeyZ', { shiftKey: true, isComposing: true })
    expect(ed.text()).toBe('')
    expect(composing.defaultPrevented).toBe(false)
    ed.press('Z', 'KeyZ', { shiftKey: true, keyCode: 229 })
    expect(ed.text()).toBe('')
  })
})
