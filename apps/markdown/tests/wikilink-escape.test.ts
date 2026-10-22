/**
 * A wiki link literal is source, not prose: the tokenizer keeps it raw, so the
 * serializer must write it back raw. Escaping it again grew `[[x\y]]` on every
 * save, rewrote `[[my_note]]` to a different target and split a table cell at
 * the pipe of `[[x\|y]]`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { parseDocText } from '../src/renderer/markdown/docText'
import { buildSourceMap, spliceMarkdown } from '../src/renderer/markdown/sourceSplice'
import { collectWikiTargets } from '../src/renderer/editor/wikilink'

;(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v }

beforeAll(() => vi.stubGlobal('ClipboardEvent', Event))
afterAll(() => vi.unstubAllGlobals())

const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy())
})
afterAll(() => editors.splice(0).forEach((e) => e.destroy()))

function open(source: string) {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
      wikiLink: { getDocumentPath: () => '/notes/Index.md', resolve: async () => ({}) },
    }),
    content: '',
  })
  editors.push(editor)
  const envelope = parseDocText(source)
  editor
    .chain()
    .setMeta('addToHistory', false)
    .setContent(envelope.body, { contentType: 'markdown' })
    .run()
  return { editor, envelope }
}

/** type one character at a time through the same hook a keystroke takes */
function type(editor: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = editor.state.selection
    const handled = editor.view.someProp('handleTextInput', (f) => f(editor.view, from, to, ch))
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to))
  }
}

/** end of the first textblock that holds wiki-marked text */
function endOfWikiBlock(editor: Editor): number {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos >= 0) return false
    if (node.isTextblock && node.textContent.length > 0) {
      let marked = false
      node.forEach((child) => {
        if (child.marks.some((m) => m.type.name === 'wikiLink')) marked = true
      })
      if (marked) pos = p + node.nodeSize - 1
      return false
    }
    return true
  })
  expect(pos, 'no wiki-marked text in the document').toBeGreaterThan(-1)
  return pos
}

/** edit the block that holds the link (plain text after it), then save through the splice path */
function editAndSave(source: string): { saved: string; targets: string[]; marked: string[] } {
  const { editor, envelope } = open(source)
  const map = buildSourceMap(editor, editor.state.doc, envelope.body)
  expect(map, 'the splice save path needs a source map').not.toBeNull()
  const at = endOfWikiBlock(editor)
  editor.view.dispatch(editor.state.tr.insert(at, editor.schema.text(' z')))
  const saved = spliceMarkdown(editor, editor.state.doc, map!)
  return { saved, targets: collectWikiTargets(editor.state.doc), marked: markedTexts(editor) }
}

function markedTexts(editor: Editor): string[] {
  const out: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === 'wikiLink')) out.push(node.text!)
  })
  return out
}

const LITERALS = [
  '[[x\\y]]',
  '[[my_note]]',
  '[[a*b]]',
  '[[a~b]]',
  '[[a`b]]',
  '[[b|Bee]]',
  '[[b#Head]]',
]

describe('wiki link literals are saved verbatim', () => {
  for (const literal of LITERALS) {
    it(`${literal}: edit + save keeps the bytes and the target for three cycles`, () => {
      const source = `a ${literal} b`
      let current = source
      for (let i = 1; i <= 3; i++) {
        const { saved, marked, targets } = editAndSave(current)
        expect(marked, `cycle ${i}: the wiki span text`).toEqual([literal])
        expect(targets.length, `cycle ${i}: one resolver key`).toBe(1)
        expect(saved, `cycle ${i}`).toBe(source + ' z'.repeat(i))
        current = saved
      }
    })

    it(`${literal}: a full getMarkdown re-serialize is byte-identical for three cycles`, () => {
      const source = `a ${literal} b`
      let current = source
      for (let i = 1; i <= 3; i++) {
        current = open(current).editor.getMarkdown()
        expect(current, `cycle ${i}`).toBe(source)
      }
    })
  }

  it('the resolver key of a reopened [[my_note]] is the name as written', () => {
    const first = editAndSave('a [[my_note]] b')
    const { editor } = open(first.saved)
    expect(collectWikiTargets(editor.state.doc)).toEqual(['my_note'])
  })

  it('a link in a table cell: `[[x\\|y]]` stays one cell and byte-identical for three cycles', () => {
    const head = '| a | b |\n| --- | --- |\n'
    const source = `${head}| [[x\\|y]] | d |`
    let current = source
    for (let i = 1; i <= 3; i++) {
      const { saved, marked } = editAndSave(current)
      expect(marked, `cycle ${i}: the wiki span text`).toEqual(['[[x|y]]'])
      expect(saved, `cycle ${i}`).toBe(`${head}| [[x\\|y]]${' z'.repeat(i)} | d |`)
      current = saved
    }
  })

  it('a table link without a pipe stays byte-identical too (`_` and `\\`)', () => {
    for (const literal of ['[[my_note]]', '[[x\\y]]']) {
      const head = '| a | b |\n| --- | --- |\n'
      let current = `${head}| ${literal} | d |`
      for (let i = 1; i <= 3; i++) {
        const { saved } = editAndSave(current)
        expect(saved, `${literal} cycle ${i}`).toBe(`${head}| ${literal}${' z'.repeat(i)} | d |`)
        current = saved
      }
    }
  })

  it('a typed [[x|y]] in a table cell saves [[x\\|y]]', () => {
    const { editor, envelope } = open('| a | b |\n| - | - |\n| c | d |')
    const map = buildSourceMap(editor, editor.state.doc, envelope.body)!
    let cell = -1
    editor.state.doc.descendants((node, pos) => {
      if (cell < 0 && node.isTextblock && node.textContent === 'c') cell = pos + 2
    })
    expect(cell).toBeGreaterThan(-1)
    editor.commands.setTextSelection(cell)
    type(editor, '[[x|y]]')
    expect(markedTexts(editor)).toEqual(['[[x|y]]'])
    const saved = spliceMarkdown(editor, editor.state.doc, map)
    // one cell: the table keeps its two columns and the pipe stays escaped
    expect(saved.split('\n')[2]).toMatch(/^\| c\[\[x\\\|y\]\] +\| d +\|$/)
    // and the saved cell reopens as one cell with the same link
    const again = open(saved).editor
    expect(markedTexts(again)).toEqual(['[[x|y]]'])
  })

  it('a backslash, `_` and `*` in plain text next to a wiki link are still escaped', () => {
    const { editor, envelope } = open('a [[b]] c')
    const map = buildSourceMap(editor, editor.state.doc, envelope.body)!
    editor.view.dispatch(editor.state.tr.insert(1, editor.schema.text('p\\q_r*s ')))
    expect(spliceMarkdown(editor, editor.state.doc, map)).toBe('p\\\\q\\_r\\*s a [[b]] c')
    expect(editor.getMarkdown()).toBe('p\\\\q\\_r\\*s a [[b]] c')
  })

  it('inline code next to a wiki link is untouched', () => {
    const source = 'a [[my_note]] `x\\y_z` b'
    const { saved } = editAndSave(source)
    expect(saved).toBe(`${source} z`)
    expect(open(source).editor.getMarkdown()).toBe(source)
  })
})

/** a paste through the editor's own paste handlers (plain text only) */
function paste(editor: Editor, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (t: string) => (t === 'text/plain' ? text : ''),
      files: [],
      items: [],
      types: ['text/plain'],
    },
  })
  editor.view.dom.dispatchEvent(event)
}

function caretAfter(editor: Editor, needle: string) {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isText && node.text!.includes(needle)) {
      pos = p + node.text!.indexOf(needle) + needle.length
    }
  })
  expect(pos, `no text ${needle}`).toBeGreaterThan(-1)
  editor.commands.setTextSelection(pos)
}

function marksOf(editor: Editor): string[] {
  const names = new Set<string>()
  editor.state.doc.descendants((node) => {
    if (node.isText) node.marks.forEach((m) => names.add(m.type.name))
  })
  return [...names].sort()
}

function tableShape(editor: Editor): number[] {
  const rows: number[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow') rows.push(node.childCount)
  })
  return rows
}

/** save the live document, then reopen and re-save three times: the bytes must not move */
function reopenThrice(editor: Editor) {
  const first = editor.getMarkdown()
  let current = first
  let reopened = open(current).editor
  for (let i = 1; i <= 3; i++) {
    reopened = open(current).editor
    const next = reopened.getMarkdown()
    expect(next, `cycle ${i}`).toBe(first)
    current = next
  }
  return { saved: first, reopened }
}

const TABLE = '| a | b |\n| - | - |\n| c | d |'

function inCell(how: 'type' | 'paste', text: string) {
  const { editor } = open(TABLE)
  caretAfter(editor, 'c')
  if (how === 'type') type(editor, ' ' + text)
  else paste(editor, ' ' + text)
  return editor
}

describe('an even run of backslashes before a pipe in a table cell', () => {
  for (const how of ['type', 'paste'] as const) {
    it(`${how}d [[x\\\\|y]] keeps the row, the bytes and the key`, () => {
      const editor = inCell(how, '[[x\\\\|y]]')
      expect(markedTexts(editor)).toEqual(['[[x\\\\|y]]'])
      const live = collectWikiTargets(editor.state.doc)
      const { saved, reopened } = reopenThrice(editor)
      expect(tableShape(reopened)).toEqual([2, 2])
      expect(saved.split('\n')[2]).toMatch(/^\| c \[\[x\\\\\\\|y\]\] +\| d +\|$/)
      expect(collectWikiTargets(reopened.state.doc)).toEqual(live)
    })
  }

  it('a file cell [[p\\\\\\|q]] keeps the row, the bytes and the key', () => {
    const { editor } = open('| a | b |\n| - | - |\n| [[p\\\\\\|q]] | d |')
    const live = collectWikiTargets(editor.state.doc)
    const { reopened } = reopenThrice(editor)
    expect(tableShape(reopened)).toEqual([2, 2])
    expect(collectWikiTargets(reopened.state.doc)).toEqual(live)
  })
})

describe('text inside a link is not source', () => {
  const inside = (extra: (editor: Editor) => void) => {
    const { editor } = open('a  b')
    editor.commands.setTextSelection(3)
    type(editor, '[[ab]]')
    caretAfter(editor, '[[a')
    extra(editor)
    return editor
  }
  const dangling = (extra: (editor: Editor) => void) => {
    const { editor } = open('a [[ab]] b')
    caretAfter(editor, '[[ab')
    editor.view.dispatch(
      editor.state.tr.delete(editor.state.selection.from, editor.state.selection.from + 2),
    )
    caretAfter(editor, '[[a')
    extra(editor)
    return editor
  }
  const cases: Array<[string, () => Editor]> = [
    ['typed ](x) inside a link', () => inside((e) => type(e, '](x)'))],
    ['pasted markdown inside a link', () => inside((e) => paste(e, '*x* [l](http://z)'))],
    ['](q) typed after deleting the closing brackets', () => dangling((e) => type(e, '](q)'))],
    ['*x* z* typed into a dangling [[ab', () => dangling((e) => type(e, '*x* z*'))],
  ]
  for (const [name, make] of cases) {
    it(`${name}: stable bytes, no new link or italic on reopen`, () => {
      const editor = make()
      const live = marksOf(editor).filter((m) => m !== 'wikiLink')
      const { reopened } = reopenThrice(editor)
      // the paste case already holds the marks its markdown made; the save must add none
      expect(marksOf(reopened)).toEqual(live)
    })
  }
})

describe('entity-looking text in a literal', () => {
  for (const literal of [
    '[[a&amp;b]]',
    '[[a&lt;b]]',
    '[[a&nbsp;b]]',
    '[[a&#65;b]]',
    '[[a&copy;b]]',
  ]) {
    for (const how of ['type', 'paste'] as const) {
      it(`${how}d ${literal} keeps its bytes and its key`, () => {
        const { editor } = open('a  b')
        editor.commands.setTextSelection(3)
        if (how === 'type') type(editor, literal)
        else paste(editor, literal)
        expect(markedTexts(editor)).toEqual([literal])
        const live = collectWikiTargets(editor.state.doc)
        const { reopened } = reopenThrice(editor)
        expect(markedTexts(reopened)).toEqual([literal])
        expect(collectWikiTargets(reopened.state.doc)).toEqual(live)
      })
    }
  }

  it('a plain & inside a literal is written as it is', () => {
    for (const source of ['a [[a&b]] b', 'a [[R&D|r&d]] b']) {
      expect(open(source).editor.getMarkdown()).toBe(source)
    }
  })
})

describe('a literal with an inline code run inside', () => {
  it('saves the code fence and keeps the bytes stable', () => {
    const { editor } = open('a  b')
    editor.commands.setTextSelection(3)
    type(editor, '[[acb]]')
    caretAfter(editor, '[[a')
    const from = editor.state.selection.from
    // the code mark is added over `c`, which keeps the wiki mark on the same text node
    editor.commands.setTextSelection({ from, to: from + 1 })
    editor.commands.setMark('code')
    expect(marksOf(editor)).toContain('code')
    const { saved, reopened } = reopenThrice(editor)
    // the fence is written (a wiki-first check would save [[acb]]); the reader takes the whole
    // `[[a`c`b]]` back as one literal, so the code mark itself does not come back
    expect(saved).toBe('a [[a`c`b]] b')
    expect(markedTexts(reopened)).toEqual(['[[a`c`b]]'])
  })
})

/** the wiki mark put over a text range, as an edit inside a link or a wide paste leaves it */
function markRange(editor: Editor, needle: string) {
  let from = -1
  editor.state.doc.descendants((node, p) => {
    if (from < 0 && node.isTextblock) {
      const at = node.textContent.indexOf(needle)
      if (at >= 0) from = p + 1 + at
    }
  })
  expect(from, `no text ${needle}`).toBeGreaterThan(-1)
  editor
    .chain()
    .setTextSelection({ from, to: from + needle.length })
    .setMark('wikiLink')
    .run()
}

/** insert plain text at the caret without any input rule or paste parsing */
function insertPlain(editor: Editor, text: string) {
  const { from, to } = editor.state.selection
  editor.view.dispatch(editor.state.tr.insertText(text, from, to))
}

function openPlainInParagraph(text: string) {
  const { editor } = open('a  b')
  editor.commands.setTextSelection(3)
  insertPlain(editor, text)
  markRange(editor, text)
  return editor
}

function openPlainInCell(text: string) {
  const { editor } = open(TABLE)
  caretAfter(editor, 'c')
  insertPlain(editor, ' ' + text)
  markRange(editor, text)
  return editor
}

describe('a wiki mark that covers more than one literal', () => {
  // The mark is wider than one literal: the literals stay source, the prose between
  // them is still text and is encoded, and nothing the reader could take as markup
  // (italic, a link, a table cell edge) appears on any later save.
  const PROSE = '[[a_1]] _x_ | [[b|c_2]]'

  it('a paragraph keeps its text, its bytes and its marks for three cycles', () => {
    const editor = openPlainInParagraph(PROSE)
    const text = editor.state.doc.textContent
    const live = marksOf(editor)
    const { saved, reopened } = reopenThrice(editor)
    // literals raw, prose between them encoded
    expect(saved).toBe('a [[a_1]] \\_x\\_ | [[b|c_2]] b')
    expect(reopened.state.doc.textContent).toBe(text)
    expect(marksOf(reopened)).toEqual(live)
    expect(marksOf(reopened)).not.toContain('italic')
    expect(marksOf(reopened)).not.toContain('link')
  })

  it('a table cell keeps its row, its text and its bytes, the prose pipe is escaped', () => {
    const editor = openPlainInCell(PROSE)
    const text = editor.state.doc.textContent
    const live = marksOf(editor)
    const { saved, reopened } = reopenThrice(editor)
    expect(saved.split('\n')[2]).toMatch(
      /^\| c \[\[a_1\]\] \\_x\\_ \\\| \[\[b\\\|c_2\]\] +\| d +\|$/,
    )
    expect(tableShape(reopened)).toEqual([2, 2])
    expect(reopened.state.doc.textContent).toBe(text)
    expect(marksOf(reopened)).toEqual(live)
    expect(marksOf(reopened)).not.toContain('italic')
    expect(marksOf(reopened)).not.toContain('link')
  })
})

describe('prose around the literals of a marked run', () => {
  it('the head before a literal is encoded and the text between two literals is kept', () => {
    const head = openPlainInParagraph('head_x* [[a_1]] and [[b_2]]')
    const { saved: headSaved, reopened } = reopenThrice(head)
    expect(headSaved).toBe('a head\\_x\\* [[a_1]] and [[b_2]] b')
    expect(reopened.state.doc.textContent).toBe(head.state.doc.textContent)
    expect(marksOf(reopened)).not.toContain('italic')
  })

  it('a soft break inside a marked run does not turn `_` into italic on reopen', () => {
    const { editor } = open('a [[a_b\nc_d]] y')
    markRange(editor, '[[a_b\nc_d]]')
    const text = editor.state.doc.textContent
    const { saved, reopened } = reopenThrice(editor)
    expect(saved).toBe('a [[a\\_b\nc\\_d]] y')
    expect(reopened.state.doc.textContent).toBe(text)
    expect(marksOf(reopened)).not.toContain('italic')
    expect(marksOf(reopened)).not.toContain('link')
  })

  it('an entity literal typed in a table cell keeps the row, the bytes and the key', () => {
    const { editor } = open(TABLE)
    caretAfter(editor, 'c')
    type(editor, ' [[a&amp;|b]]')
    expect(markedTexts(editor)).toEqual(['[[a&amp;|b]]'])
    const live = collectWikiTargets(editor.state.doc)
    expect(live).toEqual(['a&amp;'])
    const { saved, reopened } = reopenThrice(editor)
    expect(saved.split('\n')[2]).toMatch(/^\| c \[\[a&amp;amp;\\\|b\]\] +\| d +\|$/)
    expect(tableShape(reopened)).toEqual([2, 2])
    expect(markedTexts(reopened)).toEqual(['[[a&amp;|b]]'])
    expect(collectWikiTargets(reopened.state.doc)).toEqual(live)
  })
})
