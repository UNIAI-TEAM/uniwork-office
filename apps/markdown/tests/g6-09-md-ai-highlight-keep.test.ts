// The AI marker outlives its run (G6-09, approved Q1 for markdown): it stays until the user saves
// (an autosave is not the user), or the next run starts. It is a decoration: the saved text and
// every export are byte-equal to the unmarked document.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { runOps } from '../src/renderer/editor/ops'
import { clearAiHighlightsOnSave } from '../src/renderer/editor/aiHighlight'
import { buildPrintHtml } from '../src/renderer/export/printHtml'

vi.mock('katex/dist/katex.min.css?inline', () => ({ default: '' }))

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})

function markedEditor(): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '',
  })
  editor
    .chain()
    .setMeta('addToHistory', false)
    .setContent('one\n\ntwo', { contentType: 'markdown' })
    .run()
  editors.push(editor)
  runOps(editor, [{ op: 'replaceText', target: { start: 0 }, find: 'one', replace: 'ONE' }], {
    source: 'ai',
  })
  return editor
}
const marks = (editor: Editor): number => editor.view.dom.querySelectorAll('.ai-changed').length

describe('the AI marker through undo and redo', () => {
  it('redo of a run shows its marker again; undo takes it away', () => {
    const editor = markedEditor()
    expect(marks(editor)).toBeGreaterThan(0)
    expect(editor.commands.undo()).toBe(true)
    expect(marks(editor)).toBe(0)
    expect(editor.commands.redo()).toBe(true)
    expect(editor.getText()).toContain('ONE')
    expect(marks(editor)).toBeGreaterThan(0)
    expect(editor.view.dom.querySelector('.ai-changed')?.textContent).toBe('ONE')
  })

  it('redo of a run that inserted a block marks that block (the undo deleted it with its marker)', () => {
    const editor = markedEditor()
    runOps(editor, [{ op: 'insertContent', after: 1, markdown: 'three' }], { source: 'ai' })
    const marked = [...editor.view.dom.querySelectorAll('.ai-changed')].map((n) => n.textContent)
    expect(marked).toContain('three')
    editor.commands.undo()
    expect([...editor.view.dom.querySelectorAll('.ai-changed')].map((n) => n.textContent)).toEqual([
      'ONE',
    ])
    editor.commands.redo()
    expect([...editor.view.dom.querySelectorAll('.ai-changed')].map((n) => n.textContent)).toEqual(
      marked,
    )
  })

  it('a hand edit after the undo ends the redo: nothing is marked that the AI did not write', () => {
    const editor = markedEditor()
    editor.commands.undo()
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>mine</p>')
    expect(editor.commands.redo()).toBe(false)
    expect(marks(editor)).toBe(0)
  })

  it('a user Save between undo and redo: the redone run is not marked again', () => {
    const editor = markedEditor()
    editor.commands.undo()
    clearAiHighlightsOnSave(editor, undefined)
    editor.commands.redo()
    expect(marks(editor)).toBe(0)
  })
})

describe('the AI marker after a run', () => {
  it('an autosave keeps it, the user Save clears it', () => {
    const editor = markedEditor()
    expect(marks(editor)).toBeGreaterThan(0)
    clearAiHighlightsOnSave(editor, 'auto')
    expect(marks(editor)).toBeGreaterThan(0)
    clearAiHighlightsOnSave(editor, undefined)
    expect(marks(editor)).toBe(0)
  })

  it('the text a save writes is byte-equal with and without the marker', () => {
    const editor = markedEditor()
    expect(marks(editor)).toBeGreaterThan(0)
    const withMarker = { md: editor.getMarkdown(), json: JSON.stringify(editor.getJSON()) }
    clearAiHighlightsOnSave(editor, undefined)
    expect(marks(editor)).toBe(0)
    expect({ md: editor.getMarkdown(), json: JSON.stringify(editor.getJSON()) }).toEqual(withMarker)
  })

  it('print / PDF / image export of a marked document equals the unmarked one', () => {
    const editor = markedEditor()
    expect(marks(editor)).toBeGreaterThan(0)
    const marked = buildPrintHtml(editor.view.dom, 'T')
    expect(marked).not.toContain('ai-changed')
    clearAiHighlightsOnSave(editor, undefined)
    expect(buildPrintHtml(editor.view.dom, 'T')).toBe(marked)
  })
})
