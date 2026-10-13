/**
 * G8-12 (UNI-1407): the docx anchor codec (lane contract §3.4, contract-collab §4.1). A ProseMirror
 * range becomes `{format:'docx', v:1, para_id?, path, start, end, quote, prefix, suffix}`; an anchor
 * becomes a range again by para_id, then path + quote check, then a quote search with prefix/suffix
 * disambiguation, else not found.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import {
  ANCHOR_MAX_BYTES,
  QUOTE_MAX,
  canonicalJson,
  encodeDocxAnchor,
  locateDocxAnchor,
  type DocxAnchor,
} from '../src/renderer/server-comments/anchor-codec'

interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
}

const para = (t: string, attrs: Record<string, unknown> = {}): JsonNode => ({
  type: 'docParagraph',
  attrs: { docxIndex: null, ...attrs },
  content: t ? [{ type: 'text', text: t }] : [],
})

/** the editor reads w14:paraId from the parsed block a paragraph came from (docxIndex) */
const PARA_IDS = new Map<number, string>([
  [11, '1A2B3C4D'],
  [12, '0000BEEF'],
])
const paraIdOf = (node: { attrs: Record<string, unknown> }) =>
  typeof node.attrs.docxIndex === 'number' ? PARA_IDS.get(node.attrs.docxIndex) : undefined
const opts = { paraIdOf }

const editors = new Set<Editor>()
afterEach(() => {
  for (const e of editors) e.destroy()
  editors.clear()
})

function editorOf(content: JsonNode[]): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content },
  })
  editors.add(editor)
  return editor
}

/** PM position of `needle` (nth occurrence) inside the doc text */
function rangeOf(editor: Editor, needle: string, nth = 1): { from: number; to: number } {
  let seen = 0
  let out: { from: number; to: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (out || !node.isTextblock) return
    const text = node.textContent
    let at = text.indexOf(needle)
    while (at !== -1) {
      seen++
      if (seen === nth) {
        out = { from: pos + 1 + at, to: pos + 1 + at + needle.length }
        return false
      }
      at = text.indexOf(needle, at + 1)
    }
  })
  if (!out) throw new Error(`no ${needle}`)
  return out
}

const textAt = (editor: Editor, r: { from: number; to: number } | null) =>
  r ? editor.state.doc.textBetween(r.from, r.to) : null

describe('encodeDocxAnchor', () => {
  it('encodes path, offsets, quote and context of a range inside one paragraph', () => {
    const editor = editorOf([para('Intro.'), para('Theo doanh thu quý 3 tăng mạnh.')])
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf(editor, 'doanh thu quý 3'))!
    expect(anchor).toEqual({
      format: 'docx',
      v: 1,
      path: [1],
      start: 5,
      end: 20,
      quote: 'doanh thu quý 3',
      prefix: 'Theo ',
      suffix: ' tăng mạnh.',
    })
  })

  it('carries para_id when the paragraph has one, and clips a multi-paragraph range to the first', () => {
    const editor = editorOf([para('First block text', { docxIndex: 11 }), para('Second')])
    const from = rangeOf(editor, 'block').from
    const to = rangeOf(editor, 'Sec').to
    const anchor = encodeDocxAnchor(editor.state.doc, { from, to }, opts)!
    expect(anchor.para_id).toBe('1A2B3C4D')
    expect(anchor.quote).toBe('block text')
    expect(anchor.end - anchor.start).toBe('block text'.length)
  })

  it('caps the quote at 500 code points and the canonical JSON at 4 KiB', () => {
    const long = '漢'.repeat(1400)
    const editor = editorOf([para(`a${long}b`)])
    const anchor = encodeDocxAnchor(editor.state.doc, { from: 2, to: 2 + 1400 })!
    expect([...anchor.quote].length).toBeLessThanOrEqual(QUOTE_MAX)
    expect([...anchor.prefix].length).toBeLessThanOrEqual(QUOTE_MAX)
    expect([...anchor.suffix].length).toBeLessThanOrEqual(QUOTE_MAX)
    expect(new TextEncoder().encode(canonicalJson(anchor)).length).toBeLessThanOrEqual(
      ANCHOR_MAX_BYTES,
    )
    expect(anchor.end - anchor.start).toBe(1400)
  })

  it('null for an empty range or a range outside any text block', () => {
    const editor = editorOf([para('abc')])
    expect(encodeDocxAnchor(editor.state.doc, { from: 2, to: 2 })).toBeNull()
  })

  it('canonical JSON sorts keys by byte order and drops whitespace', () => {
    expect(canonicalJson({ v: 1, format: 'docx', path: [3, 0], b: 'x' })).toBe(
      '{"b":"x","format":"docx","path":[3,0],"v":1}',
    )
  })
})

describe('locateDocxAnchor', () => {
  const doc = () =>
    editorOf([
      para('Alpha paragraph says hello.'),
      para('Beta mentions revenue growth here.', { docxIndex: 12 }),
      para('Gamma also mentions revenue growth twice: revenue growth.'),
    ])

  it('round-trips a range through encode + locate', () => {
    const editor = doc()
    const r = rangeOf(editor, 'revenue growth', 2)
    const anchor = encodeDocxAnchor(editor.state.doc, r)!
    expect(locateDocxAnchor(editor.state.doc, anchor)).toEqual(r)
  })

  it('finds the paragraph by para_id when blocks moved', () => {
    const editor = doc()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf(editor, 'revenue growth', 1), opts)!
    expect(anchor.para_id).toBe('0000BEEF')
    // a new paragraph above shifts the path; para_id still finds it
    editor.commands.insertContentAt(0, para('Inserted first.'))
    const hit = locateDocxAnchor(editor.state.doc, anchor, opts)
    expect(textAt(editor, hit)).toBe('revenue growth')
    expect(hit!.from).toBe(rangeOf(editor, 'revenue growth', 1).from)
  })

  it('falls back to a quote search disambiguated by prefix / suffix', () => {
    const editor = doc()
    const target = rangeOf(editor, 'revenue growth', 3) // "twice: revenue growth."
    const anchor = encodeDocxAnchor(editor.state.doc, target)!
    const moved: DocxAnchor = { ...anchor, path: [9], start: 0, end: 0 }
    const hit = locateDocxAnchor(editor.state.doc, moved)
    expect(hit).toEqual(target)
  })

  it('a path whose text changed falls through to the search', () => {
    const editor = doc()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf(editor, 'hello'))!
    editor.commands.insertContentAt(2, 'Big ')
    const hit = locateDocxAnchor(editor.state.doc, anchor)
    expect(textAt(editor, hit)).toBe('hello')
  })

  it('not found when the quote is gone', () => {
    const editor = doc()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf(editor, 'hello'))!
    const gone = editorOf([para('Nothing here.')])
    expect(locateDocxAnchor(gone.state.doc, anchor)).toBeNull()
  })

  it('rejects an anchor of another format or a malformed one', () => {
    const editor = doc()
    expect(
      locateDocxAnchor(editor.state.doc, { format: 'xlsx', v: 1, sheet: 's', range: 'A1' }),
    ).toBeNull()
    expect(locateDocxAnchor(editor.state.doc, { format: 'docx', v: 1 })).toBeNull()
  })
})

describe('a capped quote (FE12-5)', () => {
  // 'a'..'z' blocks keep every offset readable; 700 chars, the comment spans the first 600
  const body = Array.from({ length: 700 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
  const make = () => {
    const editor = editorOf([para(body)])
    const from = 1
    const anchor = encodeDocxAnchor(editor.state.doc, { from, to: from + 600 })!
    return { editor, anchor, from }
  }

  it('keeps the whole stored span while the text after it is unchanged', () => {
    const { editor, anchor, from } = make()
    expect(anchor.quote.length).toBe(QUOTE_MAX)
    expect(locateDocxAnchor(editor.state.doc, anchor)).toEqual({ from, to: from + 600 })
  })

  it('shrinks to the matched quote when the text after the capped quote changed', () => {
    const { editor, anchor, from } = make()
    // an edit inside the span, past the 500th character
    editor.commands.insertContentAt(from + 550, 'ZZZ')
    expect(locateDocxAnchor(editor.state.doc, anchor)).toEqual({ from, to: from + QUOTE_MAX })
  })
})

describe('locateDocxAnchor with requireContext (recovering a lost range)', () => {
  const opts2 = { requireContext: true }
  it('finds the range only where the stored prefix and suffix still surround it', () => {
    const editor = editorOf([
      para('Intro line.'),
      para('We agree on the plan today.'),
      para('We agree on the plan later, in the other place.'),
    ])
    const r = rangeOf(editor, 'the plan', 1)
    const anchor = encodeDocxAnchor(editor.state.doc, r)!
    expect(locateDocxAnchor(editor.state.doc, anchor, opts2)).toEqual(r)
    // the first paragraph goes away: the second one has other words around 'the plan'
    editor.commands.deleteRange({
      from: editor.state.doc.child(0).nodeSize,
      to: editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize,
    })
    expect(locateDocxAnchor(editor.state.doc, anchor, opts2)).toBeNull()
    // the default search still falls back to the other occurrence
    expect(locateDocxAnchor(editor.state.doc, anchor)).not.toBeNull()
  })
})
