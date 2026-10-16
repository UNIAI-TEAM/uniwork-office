// G6-09 fix r1 (RFA-2, RFA-5): helpers that read the AI change marker off a document. A save
// compares the live doc against the reloaded file, and the marker is not file content, so a
// marked doc must still count as unchanged (the marker and the undo history survive an autosave).
// The "any marker?" read is memoised per document so an idle panel render does not walk it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import {
  carryAiMarks,
  docHasAiMarks,
  sameDocIgnoringAiMarks,
} from '../src/renderer/editor/ai-marker'
import type { PmNode } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'
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

  // RF3D-2: the AI marks the paragraph inside a table cell, not the table itself (the table
  // node has no marker attribute), so the carry has to walk down to the nested block
  describe('a marked block nested in a table cell', () => {
    const para = (text: string, docxIndex: number, aiChanged = false): PmNode => ({
      type: 'docParagraph',
      attrs: { docxIndex, aiChanged },
      content: [{ type: 'text', text }],
    })
    const tableOf = (cells: string[][], firstIndex: number): PmNode => ({
      type: 'docTable',
      attrs: { docxIndex: firstIndex },
      content: cells.map((row, r) => ({
        type: 'docTableRow',
        content: row.map((text, c) => ({
          type: 'docTableCell',
          content: [para(text, firstIndex + 1 + r * 10 + c)],
        })),
      })),
    })
    const docOf = (...content: PmNode[]): PmNode => ({ type: 'doc', content })
    /** the texts of every paragraph under the node that carries the marker */
    const markedTexts = (node: PmNode): string[] => [
      ...(node.attrs?.aiChanged ? [(node.content ?? []).map((n) => n.text ?? '').join('')] : []),
      ...(node.content ?? []).flatMap(markedTexts),
    ]
    const live = (cells: string[][]): Editor => {
      const e = new Editor({
        element: document.createElement('div'),
        extensions: editorExtensions,
        content: docOf(para('before', 0), tableOf(cells, 1), para('after', 20)),
      })
      const tr = e.state.tr
      e.state.doc.descendants((node, pos) => {
        if (node.type.name === 'docParagraph' && node.textContent === 'B2')
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, aiChanged: true })
      })
      e.view.dispatch(tr)
      return e
    }
    const cells = [
      ['A1', 'A2'],
      ['B1', 'B2'],
    ]

    it('same structure with new anchors: the cell paragraph stays marked', () => {
      editor = live(cells)
      expect(docHasAiMarks(editor.state.doc)).toBe(true)
      const next = carryAiMarks(
        editor.state.doc,
        docOf(para('before', 100), tableOf(cells, 101), para('after', 120)),
      )
      expect(markedTexts(next)).toEqual(['B2'])
    })

    it('a reload with another block count: the nested marker follows its text', () => {
      editor = live(cells)
      const next = carryAiMarks(
        editor.state.doc,
        docOf(para('new', 99), para('before', 100), tableOf(cells, 101), para('after', 120)),
      )
      expect(markedTexts(next)).toEqual(['B2'])
    })

    it('a marked block next to the table is still carried', () => {
      editor = createDocsEditor(['one', 'two'])
      mark(editor, [1])
      const next = carryAiMarks(editor.state.doc, reloaded(['one', 'two']))
      expect(marked(next)).toEqual([1])
    })
  })

  it('no marker on the live doc: the reloaded doc is returned as it is', () => {
    editor = createDocsEditor(['one', 'two'])
    const doc = reloaded(['one', 'two'])
    expect(carryAiMarks(editor.state.doc, doc)).toBe(doc)
  })
})
