// G6-09 W2: every ProseMirror change an AI run makes is ONE undo step: a single Ctrl/Cmd+Z
// returns the document to the state before the run, redo re-applies the whole run, a read-only
// run leaves no step, and a run cut off by Stop is one step back to before it. The user cannot
// type into the document while the run is open (Stop ends it), so nothing of theirs is folded in.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { redo, redoDepth, undo, undoDepth } from '@tiptap/pm/history'
import type { Editor } from '@tiptap/core'
import { mountDocsAiPanel, type DocsAiHarness } from './helpers/docs-ai-run-harness'
import { setEditorEditable } from '../src/renderer/uniwork-doc-state'

const font = (blocks: number[], field: Record<string, unknown>) => ({
  name: 'apply_ops',
  input: { ops: [{ op: 'setFont', target: { blockIndexes: blocks }, ...field }] },
})

const TEXTS = ['first block', 'second block', 'third block']

let h: DocsAiHarness | null = null
beforeEach(() => localStorage.removeItem('ai-docs-track-changes'))
afterEach(() => {
  h?.cleanup()
  h = null
})

/** document content without the AI marker attribute (the marker is not content) */
function content(editor: Editor): unknown {
  const strip = (n: Record<string, unknown>): Record<string, unknown> => {
    const attrs = n.attrs as Record<string, unknown> | undefined
    const { aiChanged: _drop, ...rest } = attrs ?? {}
    return {
      ...n,
      ...(attrs ? { attrs: rest } : {}),
      ...(Array.isArray(n.content)
        ? { content: (n.content as Record<string, unknown>[]).map(strip) }
        : {}),
    }
  }
  return strip(editor.getJSON() as Record<string, unknown>)
}

const run = (editor: Editor, cmd: typeof undo) => cmd(editor.state, editor.view.dispatch)

describe('one undo step per AI run (docs)', () => {
  it('three tool edits in two turns: one undo restores the document, redo re-applies all of it', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    const before = content(editor)
    const depthBefore = undoDepth(editor.state)
    await h.send('format it')
    await h.toolTurn([font([0], { bold: true }), font([1], { italic: true })])
    await h.toolTurn([font([2], { underline: true })])
    await h.textTurn('Done.')
    const after = content(editor)
    expect(after).not.toEqual(before)
    expect(undoDepth(editor.state)).toBe(depthBefore + 1)

    expect(run(editor, undo)).toBe(true)
    expect(content(editor)).toEqual(before)
    expect(redoDepth(editor.state)).toBe(1)

    expect(run(editor, redo)).toBe(true)
    expect(content(editor)).toEqual(after)
  })

  it('the user edit right after a run is its own step', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    await h.send('bold it')
    await h.toolTurn([font([0], { bold: true })])
    await h.textTurn('Done.')
    const afterRun = content(editor)
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' typed')
    expect(run(editor, undo)).toBe(true)
    expect(content(editor)).toEqual(afterRun)
  })

  it('a read-only run leaves no undo step', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    const depth = undoDepth(editor.state)
    await h.send('what does it say?')
    await h.toolTurn([{ name: 'read_blocks', input: { startBlockIndex: 0, endBlockIndex: 2 } }])
    await h.textTurn('It lists three blocks.')
    expect(undoDepth(editor.state)).toBe(depth)
  })

  it('Stop mid-run: one undo goes back to before the run', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    const before = content(editor)
    await h.send('format it')
    await h.toolTurn([font([0], { bold: true }), font([1], { italic: true })])
    // the second turn is streaming when the user stops
    await h.stop()
    expect(content(editor)).not.toEqual(before)
    expect(run(editor, undo)).toBe(true)
    expect(content(editor)).toEqual(before)
  })

  it('the document is not editable while the run is open, and editable again after it', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    expect(editor.isEditable).toBe(true)
    await h.send('format it')
    expect(editor.isEditable).toBe(false)
    await h.toolTurn([font([0], { bold: true })])
    expect(editor.isEditable).toBe(false)
    await h.textTurn('Done.')
    expect(editor.isEditable).toBe(true)
  })
})

describe('the document unlocks when the run ends, whatever re-rendered meanwhile (docs)', () => {
  /**
   * What @tiptap/react's useEditor does on every App render whose options changed (the App
   * builds a fresh editorProps object each render): it re-applies the options with
   * `editable: editor.isEditable`, which reads false while the run holds the view.
   */
  const appRerender = (editor: Editor) =>
    editor.setOptions({ editorProps: {}, editable: editor.isEditable })

  /** Ctrl+Z on the page the way a keyboard sends it */
  const keyboardUndo = (editor: Editor) =>
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }),
    )

  it('an App render mid-run: editable after a mutating run, and Ctrl+Z undoes the run', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    const before = content(editor)
    await h.send('format it')
    await h.toolTurn([font([0], { bold: true })])
    appRerender(editor)
    await h.textTurn('Done.')
    expect(editor.view.editable).toBe(true)
    expect(editor.isEditable).toBe(true)
    expect(editor.view.dom.getAttribute('contenteditable')).toBe('true')
    keyboardUndo(editor)
    expect(content(editor)).toEqual(before)
  })

  it('an App render during a read-only run: the document is editable after it', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    await h.send('what does it say?')
    appRerender(editor)
    await h.textTurn('It lists three blocks.')
    expect(editor.isEditable).toBe(true)
    expect(editor.view.dom.getAttribute('contenteditable')).toBe('true')
  })

  it('an App render before Stop: the document is editable after the stopped run', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    await h.send('format it')
    await h.toolTurn([font([0], { bold: true })])
    appRerender(editor)
    await h.stop()
    expect(editor.isEditable).toBe(true)
  })

  it('a document the App made read-only during the run stays read-only', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    await h.send('what does it say?')
    // Read Mode / protection switched on while the run was open (the App's own switch)
    setEditorEditable(editor, false)
    appRerender(editor)
    await h.textTurn('It lists three blocks.')
    expect(editor.isEditable).toBe(false)
  })
})

describe('undo and redo during an open run (docs)', () => {
  it('the toolbar Undo and Redo commands do nothing while the run is open', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    // an edit of the user's own, so there is an older step an undo could reach
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' typed')
    const typed = content(editor)
    const depthBefore = undoDepth(editor.state)
    await h.send('format it')
    await h.toolTurn([font([0], { bold: true })])
    const midRun = content(editor)
    expect(midRun).not.toEqual(typed)

    // the commands the ribbon, menu and shortcuts run
    editor.chain().undo().run()
    expect(content(editor)).toEqual(midRun)
    editor.chain().redo().run()
    expect(content(editor)).toEqual(midRun)

    await h.toolTurn([font([1], { italic: true })])
    await h.textTurn('Done.')
    // the whole run is still one step on top of the user's: one undo goes back to their edit
    expect(undoDepth(editor.state)).toBe(depthBefore + 1)
    expect(run(editor, undo)).toBe(true)
    expect(content(editor)).toEqual(typed)
  })

  it('undo works again once the run ends', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    await h.send('bold it')
    await h.toolTurn([font([0], { bold: true })])
    await h.textTurn('Done.')
    expect(editor.can().undo()).toBe(true)
    expect(editor.chain().undo().run()).toBe(true)
  })
})

describe('a run that ends in an error (docs)', () => {
  it('is one undo step, and the document is editable again', async () => {
    h = await mountDocsAiPanel(TEXTS)
    const { editor } = h
    const before = content(editor)
    const depthBefore = undoDepth(editor.state)
    await h.send('format it')
    await h.toolTurn([font([0], { bold: true }), font([1], { italic: true })])
    expect(editor.isEditable).toBe(false)
    // the next model turn fails
    await h.errorTurn('provider unavailable')
    expect(editor.isEditable).toBe(true)
    expect(content(editor)).not.toEqual(before)
    expect(undoDepth(editor.state)).toBe(depthBefore + 1)
    expect(run(editor, undo)).toBe(true)
    expect(content(editor)).toEqual(before)
    // and the user's next edit is its own step
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' typed')
    expect(undoDepth(editor.state)).toBe(1)
  })
})
