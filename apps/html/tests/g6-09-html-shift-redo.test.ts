// G6-09 vfix F3: Ctrl/Cmd+Shift+Z is a redo in the html source pane whatever shape the key event
// has. CodeMirror's keymap drops Shift for a letter key, so a Ctrl+Shift+Z whose `key` is the
// lowercase "z" (Caps Lock on, a synthetic event) matched the Ctrl+Z binding and UNDID the typing
// that sat below an undone AI run, emptying the source. It only looked like a redo while the undo
// history was empty (the failed undo fell through to the redo binding).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { SourceEditor, type SourceEditorHandle } from '../src/renderer/source/SourceEditor'

const cleanups: Array<() => void> = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

function mountEditor() {
  const ref = { current: null as SourceEditorHandle | null }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() =>
    root.render(
      createElement(SourceEditor, {
        ref,
        className: 'source-editor',
        initialText: '',
        onChange: () => {},
        onCursor: () => {},
      }),
    ),
  )
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  const handle = ref.current!
  const text = () => view.state.doc.toString()
  /** the user typed the page, then an AI run edited it */
  const typedThenRun = () => {
    view.dispatch({
      changes: { from: 0, insert: '<h1>Alpha</h1><p>Beta</p>' },
      userEvent: 'input.type',
    })
    const typed = text()
    handle.runHistory.begin('run-1')
    for (const [find, replace] of [
      ['Alpha', 'Alpha AI'],
      ['Beta', 'Beta AI'],
    ]) {
      const from = text().indexOf(find)
      handle.applyPatches([{ from, to: from + find.length, text: replace }], true)
    }
    handle.runHistory.end('run-1', true)
    return { typed, afterRun: text() }
  }
  const press = (
    key: string,
    code: string,
    keyCode: number,
    shiftKey = false,
    isComposing = false,
  ) => {
    const event = new KeyboardEvent('keydown', {
      key,
      code,
      ctrlKey: true,
      shiftKey,
      isComposing,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, 'keyCode', { value: keyCode })
    act(() => {
      view.contentDOM.dispatchEvent(event)
    })
    return event
  }
  return { text, typedThenRun, press }
}

describe('html source pane: Ctrl+Shift+Z redoes the undone AI run', () => {
  it.each([
    ['uppercase Z (Shift held)', 'Z'],
    ['lowercase z (Caps Lock, synthetic keys)', 'z'],
  ])('after run -> undo, Ctrl+Shift+Z with %s equals Ctrl+Y', (_label, key) => {
    const ed = mountEditor()
    const { typed, afterRun } = ed.typedThenRun()
    ed.press('z', 'KeyZ', 90)
    expect(ed.text()).toBe(typed)
    ed.press('y', 'KeyY', 89)
    expect(ed.text()).toBe(afterRun)
    ed.press('z', 'KeyZ', 90)
    expect(ed.text()).toBe(typed)

    const event = ed.press(key, 'KeyZ', 90, true)
    expect(ed.text()).toBe(afterRun)
    expect(event.defaultPrevented).toBe(true)
  })

  it('keeps Ctrl+Z an undo and does not empty the source on a second Ctrl+Shift+Z', () => {
    const ed = mountEditor()
    const { typed, afterRun } = ed.typedThenRun()
    ed.press('z', 'KeyZ', 90)
    ed.press('z', 'KeyZ', 90, true)
    expect(ed.text()).toBe(afterRun)
    // nothing left to redo: the source stays as it is
    ed.press('z', 'KeyZ', 90, true)
    expect(ed.text()).toBe(afterRun)
    // and the typing under the run is still reachable by plain undos
    ed.press('z', 'KeyZ', 90)
    ed.press('z', 'KeyZ', 90)
    expect(ed.text()).toBe('')
    expect(typed).not.toBe('')
  })

  // RF3O-1: an IME composition owns its keys; the redo must not be hijacked mid-composition
  it.each([
    ['isComposing set', true, 90],
    ['keyCode 229 (the IME process key)', false, 229],
  ])('ignores Ctrl+Shift+Z while composing (%s)', (_label, isComposing, keyCode) => {
    const ed = mountEditor()
    const { typed, afterRun } = ed.typedThenRun()
    ed.press('z', 'KeyZ', 90)
    expect(ed.text()).toBe(typed)

    const event = ed.press('Z', 'KeyZ', keyCode, true, isComposing)
    expect(ed.text()).toBe(typed)
    expect(event.defaultPrevented).toBe(false)

    // the same keys outside a composition still redo
    ed.press('Z', 'KeyZ', 90, true)
    expect(ed.text()).toBe(afterRun)
  })
})
