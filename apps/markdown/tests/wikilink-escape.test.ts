/**
 * A wiki link literal is source, not prose: the tokenizer keeps it raw, so the
 * serializer must write it back raw. Escaping it again grew `[[x\y]]` on every
 * save, rewrote `[[my_note]]` to a different target and split a table cell at
 * the pipe of `[[x\|y]]`.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { parseDocText } from '../src/renderer/markdown/docText'
import { buildSourceMap, spliceMarkdown } from '../src/renderer/markdown/sourceSplice'
import { collectWikiTargets } from '../src/renderer/editor/wikilink'

;(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v }

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
