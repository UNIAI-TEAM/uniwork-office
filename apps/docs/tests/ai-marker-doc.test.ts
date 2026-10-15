// G6-09 fix r1 (RFA-2, RFA-5): helpers that read the AI change marker off a document. A save
// compares the live doc against the reloaded file, and the marker is not file content, so a
// marked doc must still count as unchanged (the marker and the undo history survive an autosave).
// The "any marker?" read is memoised per document so an idle panel render does not walk it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { docHasAiMarks, sameDocIgnoringAiMarks } from '../src/renderer/editor/ai-marker'
import { createDocsEditor } from './helpers/docs-ai-run-harness'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** mark the given top-level blocks the way an AI run does */
function mark(e: Editor, blocks: number[]): void {
  const tr = e.state.tr
  e.state.doc.forEach((node, offset, index) => {
    if (blocks.includes(index))
      tr.setNodeMarkup(offset, undefined, { ...node.attrs, aiChanged: true })
  })
  e.view.dispatch(tr)
}

describe('sameDocIgnoringAiMarks', () => {
  it('a marked doc equals the same doc without the marker', () => {
    editor = createDocsEditor(['one', 'two', 'three'])
    const plain = editor.state.doc
    mark(editor, [0, 2])
    expect(editor.state.doc.eq(plain)).toBe(false)
    expect(sameDocIgnoringAiMarks(editor.state.doc, plain)).toBe(true)
    expect(sameDocIgnoringAiMarks(plain, editor.state.doc)).toBe(true)
  })

  it('a real difference is still a difference, marked or not', () => {
    editor = createDocsEditor(['one', 'two'])
    const other = createDocsEditor(['one', 'twenty'])
    try {
      mark(editor, [0])
      expect(sameDocIgnoringAiMarks(editor.state.doc, other.state.doc)).toBe(false)
      expect(sameDocIgnoringAiMarks(other.state.doc, editor.state.doc)).toBe(false)
    } finally {
      other.destroy()
    }
  })
})

describe('docHasAiMarks', () => {
  it('reports the marker, and walks a given document only once', () => {
    editor = createDocsEditor(['one', 'two', 'three'])
    expect(docHasAiMarks(editor.state.doc)).toBe(false)
    mark(editor, [1])
    const doc = editor.state.doc
    const walk = vi.spyOn(doc, 'descendants')
    expect(docHasAiMarks(doc)).toBe(true)
    expect(docHasAiMarks(doc)).toBe(true)
    expect(docHasAiMarks(doc)).toBe(true)
    expect(walk).toHaveBeenCalledTimes(1)
  })
})
