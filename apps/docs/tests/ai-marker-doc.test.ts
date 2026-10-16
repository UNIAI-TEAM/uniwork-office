// G6-09 fix r1 (RFA-2, RFA-5): helpers that read the AI change marker off a document. A save
// compares the live doc against the reloaded file, and the marker is not file content, so a
// marked doc must still count as unchanged (the marker and the undo history survive an autosave).
// The "any marker?" read is memoised per document so an idle panel render does not walk it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import {
  carryAiMarks,
  docHasAiMarks,
  sameDocIgnoringAiMarks,
} from '../src/renderer/editor/ai-marker'
import type { PmNode } from '../src/renderer/editor/convert'
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

// G6-09 visual r1 F2: an autosave whose reload differs from the live doc (the written file gives
// every block a fresh docxIndex anchor) rewrites the editor from the reloaded file. The marker is
// not in the file, so the rewrite carries it over from the live doc: only a user Save or Accept
// clears it.
describe('carryAiMarks', () => {
  /** the reloaded document as the save builds it: the same texts, anchors from the written file */
  const reloaded = (texts: string[], firstIndex = 100): PmNode => ({
    type: 'doc',
    content: texts.map((text, i) => ({
      type: 'docParagraph',
      attrs: { docxIndex: firstIndex + i, aiChanged: false },
      content: [{ type: 'text', text }],
    })),
  })
  const marked = (doc: PmNode) =>
    (doc.content ?? []).flatMap((n, i) => (n.attrs?.aiChanged ? [i] : []))

  it('same blocks with new anchors: the marked blocks stay marked', () => {
    editor = createDocsEditor(['one', 'two', 'three'])
    mark(editor, [1, 2])
    const next = carryAiMarks(editor.state.doc, reloaded(['one', 'two', 'three']))
    expect(marked(next)).toEqual([1, 2])
    // the anchors are the reloaded file's
    expect(next.content?.[1]?.attrs?.docxIndex).toBe(101)
  })

  it('a reload with another block count: the marker follows the block text', () => {
    editor = createDocsEditor(['one', 'two', 'three'])
    mark(editor, [2])
    const next = carryAiMarks(editor.state.doc, reloaded(['one', 'inserted', 'two', 'three']))
    expect(marked(next)).toEqual([3])
  })

  it('no marker on the live doc: the reloaded doc is returned as it is', () => {
    editor = createDocsEditor(['one', 'two'])
    const doc = reloaded(['one', 'two'])
    expect(carryAiMarks(editor.state.doc, doc)).toBe(doc)
  })
})
