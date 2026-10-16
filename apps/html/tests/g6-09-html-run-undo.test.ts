// One Ctrl/Cmd+Z per AI run in the html source pane (G6-09 W5): every AI edit of a run joins ONE
// CodeMirror history event whatever the gap between them, so one undo returns the source (and,
// through onChange, the preview) to before the run and redo re-applies it; a read-only run leaves
// no step; Stop mid-run is one step back; a user edit mid-run is never part of the run's step.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { SourceEditor, type SourceEditorHandle } from '../src/renderer/source/SourceEditor'

const cleanups: Array<() => void> = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T10:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

const START = '<h1>One</h1>\n<p>Two</p>\n<p>Three</p>\n<p>Four</p>'

function mountEditor(initial = START) {
  const ref = { current: null as SourceEditorHandle | null }
  const changes: string[] = []
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() =>
    root.render(
      createElement(SourceEditor, {
        ref,
        className: 'source-editor',
        initialText: initial,
        onChange: (text: string) => changes.push(text),
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
  return {
    handle,
    changes,
    view,
    text: () => view.state.doc.toString(),
    /** an AI edit the way App.applyOps lands it: validated patches, highlighted */
    aiPatch: (find: string, replace: string) => {
      const from = view.state.doc.toString().indexOf(find)
      expect(from).toBeGreaterThanOrEqual(0)
      handle.applyPatches([{ from, to: from + find.length, text: replace }], true)
    },
  }
}

/** a pause longer than the history's own grouping delay (500 ms) */
const pause = (): void => {
  vi.setSystemTime(Date.now() + 5000)
}

describe('html AI run: one undo step', () => {
  it('folds the edits of a run, far apart in time and place, into one undo step', () => {
    const ed = mountEditor()
    const run = ed.handle.runHistory
    run.begin('run-1')
    ed.aiPatch('One', 'ONE')
    pause()
    ed.aiPatch('Three', 'THREE')
    pause()
    ed.aiPatch('Four', 'FOUR')
    run.end('run-1', true)
    const after = ed.text()
    expect(after).not.toBe(START)

    act(() => {
      ed.handle.undo()
    })
    expect(ed.text()).toBe(START)
    // the preview follows the source: the app hears the restored text
    expect(ed.changes.at(-1)).toBe(START)
    expect(ed.handle.canUndo()).toBe(false)

    act(() => {
      ed.handle.redo()
    })
    expect(ed.text()).toBe(after)
    expect(ed.changes.at(-1)).toBe(after)
    expect(ed.handle.canRedo()).toBe(false)
  })

  it('a whole-page rewrite and the patches after it in one run are one step', () => {
    const ed = mountEditor()
    const run = ed.handle.runHistory
    run.begin('run-gen')
    ed.handle.replaceDoc('<h1>New</h1>\n<p>Page</p>', true)
    pause()
    ed.aiPatch('Page', 'Pages')
    run.end('run-gen', true)
    act(() => {
      ed.handle.undo()
    })
    expect(ed.text()).toBe(START)
  })

  it('a read-only run, or a stop before any edit, leaves no undo step', () => {
    const ed = mountEditor()
    const run = ed.handle.runHistory
    run.begin('run-ro')
    run.end('run-ro', false)
    run.begin('run-stop')
    run.end('run-stop', true)
    expect(ed.handle.canUndo()).toBe(false)
  })

  it('a run that stops half way is still one step back', () => {
    const ed = mountEditor()
    const run = ed.handle.runHistory
    run.begin('run-stop')
    ed.aiPatch('One', '1')
    pause()
    ed.aiPatch('Four', '4')
    run.end('run-stop', true)
    act(() => {
      ed.handle.undo()
    })
    expect(ed.text()).toBe(START)
    expect(ed.handle.canUndo()).toBe(false)
  })

  it('the step before the run and the step after it stay separate', () => {
    const ed = mountEditor()
    const run = ed.handle.runHistory
    const typeAtEnd = (s: string) =>
      ed.view.dispatch({
        changes: { from: ed.view.state.doc.length, insert: s },
        userEvent: 'input.type',
      })
    typeAtEnd('A')
    const afterTyping = ed.text()
    run.begin('run-a')
    ed.aiPatch('One', 'ONE')
    ed.aiPatch('Two', 'TWO')
    run.end('run-a', true)
    const afterRun = ed.text()
    typeAtEnd('B')

    act(() => {
      ed.handle.undo()
    })
    expect(ed.text()).toBe(afterRun)
    act(() => {
      ed.handle.undo()
    })
    expect(ed.text()).toBe(afterTyping)
    act(() => {
      ed.handle.undo()
    })
    expect(ed.text()).toBe(START)
  })

  it('a user edit in the middle of a run is not swallowed: the run splits around it', () => {
    const ed = mountEditor()
    const run = ed.handle.runHistory
    run.begin('run-mid')
    ed.aiPatch('One', 'ONE')
    ed.view.dispatch({
      changes: { from: ed.view.state.doc.length, insert: '!' },
      userEvent: 'input.type',
    })
    ed.aiPatch('Two', 'TWO')
    run.end('run-mid', true)

    act(() => {
      ed.handle.undo()
    })
    expect(ed.text()).toContain('Two')
    expect(ed.text()).toContain('!')
    act(() => {
      ed.handle.undo()
    })
    expect(ed.text()).not.toContain('!')
    expect(ed.text()).toContain('ONE')
    act(() => {
      ed.handle.undo()
    })
    expect(ed.text()).toBe(START)
  })

  it('moving the caret during a run does not split the run', () => {
    const ed = mountEditor()
    const run = ed.handle.runHistory
    run.begin('run-caret')
    ed.aiPatch('One', 'ONE')
    ed.handle.revealRange(0, 3, false)
    ed.view.dispatch({ selection: { anchor: 5 }, userEvent: 'select.pointer' })
    ed.aiPatch('Four', 'FOUR')
    run.end('run-caret', true)
    act(() => {
      ed.handle.undo()
    })
    expect(ed.text()).toBe(START)
  })

  it('typing right after a run is a step of its own', () => {
    const ed = mountEditor()
    const run = ed.handle.runHistory
    run.begin('run-t')
    ed.aiPatch('One', 'ONE')
    run.end('run-t', true)
    ed.view.dispatch({
      changes: { from: ed.view.state.doc.length, insert: '?' },
      userEvent: 'input.type',
    })
    act(() => {
      ed.handle.undo()
    })
    expect(ed.text()).toContain('ONE')
    expect(ed.text()).not.toContain('?')
  })

  it('reports the open run while it is open', () => {
    const ed = mountEditor()
    const run = ed.handle.runHistory
    expect(run.activeRunId).toBeNull()
    run.begin('run-z')
    expect(run.activeRunId).toBe('run-z')
    run.end('run-z', false)
    expect(run.activeRunId).toBeNull()
  })
})
