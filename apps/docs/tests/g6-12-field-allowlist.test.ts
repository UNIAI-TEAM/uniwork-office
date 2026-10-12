import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { executeOps } from '../src/renderer/ai/ops'

// G6-12 #1 (spec §6.3 (a)): the AI may only insert field types from an
// allowlist, and updateFields never re-arms an existing external-fetch field.

interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

const editors = new Set<Editor>()
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.clear()
})

function createEditor(content: JsonNode[]): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content },
  })
  editors.add(editor)
  return editor
}

const para = (content: JsonNode[]): JsonNode => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  content,
})
const field = (t: string, instr: string, dirty = false): JsonNode => ({
  type: 'text',
  text: t,
  marks: [{ type: 'instrField', attrs: { instr, dirty } }],
})

function dirtyByInstr(editor: Editor): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  editor.state.doc.descendants((node) => {
    const m = node.marks.find((x) => x.type.name === 'instrField')
    if (node.isText && m) out[String(m.attrs.instr)] = m.attrs.dirty
    return true
  })
  return out
}

const at = (index: number) => ({ blockIndexes: [index] })

describe('insertField allowlist', () => {
  const unsafe = [
    'DDE',
    'DDEAUTO',
    'LINK',
    'IMPORT',
    'INCLUDETEXT',
    'INCLUDEPICTURE',
    'INCLUDE',
    'DATABASE',
    'HYPERLINK',
    'MACROBUTTON',
    'AUTOTEXT',
    'ASK',
    'FILLIN',
    'SOMEUNKNOWNFIELD',
  ]
  for (const type of unsafe) {
    it(`rejects ${type} (also in lower case) and leaves the document unchanged`, () => {
      const editor = createEditor([para([{ type: 'text', text: 'Body ' }])])
      const before = JSON.stringify(editor.getJSON())
      for (const t of [type, type.toLowerCase()]) {
        const outcome = executeOps(editor, [
          { op: 'insertField', target: at(0), type: t, args: 'x', result: 'x' },
        ])
        expect(outcome.ok).toBe(false)
        expect(outcome.error).toMatch(/cannot be inserted/)
      }
      expect(JSON.stringify(editor.getJSON())).toBe(before)
    })
  }

  it('still inserts the allowed field types', () => {
    const editor = createEditor([para([{ type: 'text', text: 'A ' }])])
    const outcome = executeOps(editor, [
      { op: 'insertField', target: at(0), type: 'PAGE' },
      { op: 'insertField', target: at(0), type: 'AUTHOR', result: 'Ada' },
      { op: 'insertField', target: at(0), type: 'DATE', args: '\\@ "yyyy"' },
      { op: 'insertField', target: at(0), type: 'SEQ', args: 'Figure' },
    ])
    expect(outcome.ok, outcome.error).toBe(true)
  })
})

describe('updateFields scope "all" and external-fetch fields', () => {
  it('does not mark existing DDE / INCLUDE / LINK fields dirty, but still marks safe ones', () => {
    const editor = createEditor([
      para([
        field('a', 'DDEAUTO excel "C:\\\\x.xls" "R1C1"'),
        field('b', 'DDE excel x R1C1'),
        field('c', 'INCLUDETEXT "http://evil.example/x.docx"'),
        field('d', 'INCLUDEPICTURE "http://evil.example/x.png"'),
        field('e', 'LINK Excel.Sheet.8 "x.xls" ""'),
        field('f', 'IMPORT "x.png"'),
        field('g', 'DATABASE \\d "x.mdb"'),
        field('h', 'NUMPAGES'),
      ]),
    ])
    const outcome = executeOps(editor, [{ op: 'updateFields', scope: 'all' }])
    expect(outcome.ok, outcome.error).toBe(true)
    const dirty = dirtyByInstr(editor)
    expect(dirty['DDEAUTO excel "C:\\\\x.xls" "R1C1"']).toBe(false)
    expect(dirty['DDE excel x R1C1']).toBe(false)
    expect(dirty['INCLUDETEXT "http://evil.example/x.docx"']).toBe(false)
    expect(dirty['INCLUDEPICTURE "http://evil.example/x.png"']).toBe(false)
    expect(dirty['LINK Excel.Sheet.8 "x.xls" ""']).toBe(false)
    expect(dirty['IMPORT "x.png"']).toBe(false)
    expect(dirty['DATABASE \\d "x.mdb"']).toBe(false)
    expect(dirty['NUMPAGES']).toBe(true)
    expect(outcome.results[0]!.detail).toContain('1 marked for Word to recompute on open')
  })
})
