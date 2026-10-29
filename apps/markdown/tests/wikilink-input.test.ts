/**
 * Typing or pasting `[[target]]` gives the text the wiki mark right away.
 * Before this, only the markdown parser made the mark, so a link written in the
 * editor stayed plain text (no style, no click) until the file was reopened.
 * The mark never changes the text: the saved bytes are what was typed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { resetForTest } from '../src/renderer/capabilities'
import { parseDocText } from '../src/renderer/markdown/docText'
import { buildSourceMap, spliceMarkdown } from '../src/renderer/markdown/sourceSplice'
import type { WikiLinkResolved } from '../src/shared/ipc'

;(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v }

// jsdom has no ClipboardEvent; the view still runs its real clipboard parser.
beforeAll(() => vi.stubGlobal('ClipboardEvent', Event))
afterAll(() => vi.unstubAllGlobals())
afterEach(() => resetForTest())

const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy())
  vi.useRealTimers()
})

const found = (target: string): WikiLinkResolved => ({
  path: `/notes/${target}.md`,
  fragment: '',
  found: true,
})

function open(
  source: string,
  resolve: (from: string, targets: string[]) => Promise<Record<string, WikiLinkResolved>> = async (
    _from,
    targets,
  ) =>
    Object.fromEntries(
      targets.map((t) => [t, t === 'nope' ? { path: '', fragment: '', found: false } : found(t)]),
    ),
) {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
      wikiLink: { getDocumentPath: () => '/notes/Index.md', resolve },
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

/** the bytes a save writes, through the real source-map splice */
function saver(source: string) {
  const { editor, envelope } = open(source)
  const map = buildSourceMap(editor, editor.state.doc, envelope.body)
  expect(map, 'the splice save path needs a source map').not.toBeNull()
  return { editor, save: () => spliceMarkdown(editor, editor.state.doc, map!) }
}

/** type one character at a time through the same hook a keystroke takes */
function type(editor: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = editor.state.selection
    const handled = editor.view.someProp('handleTextInput', (f) => f(editor.view, from, to, ch))
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to))
  }
}

function paste(editor: Editor, text: string, html = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : ''),
      files: [],
      items: [],
      types: html ? ['text/plain', 'text/html'] : ['text/plain'],
    },
  })
  editor.view.dom.dispatchEvent(event)
}

/** put the caret just after `needle` inside its text node */
function caretAfter(editor: Editor, needle: string): void {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isText && node.text!.includes(needle)) {
      pos = p + node.text!.indexOf(needle) + needle.length
    }
  })
  expect(pos, `no text node holds ${needle}`).toBeGreaterThan(-1)
  editor.commands.setTextSelection(pos)
}

/** text of every text node, with the names of its marks */
function runs(editor: Editor): string[] {
  const out: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.isText) out.push(`${node.text}[${node.marks.map((m) => m.type.name).join(',')}]`)
  })
  return out
}

/** text carrying the wiki mark, one entry per text node */
function wikiTexts(editor: Editor): string[] {
  const out: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === 'wikiLink')) out.push(node.text!)
  })
  return out
}

const settled = () => new Promise((r) => setTimeout(r, 250))

describe('typed link', () => {
  it('marks the literal when the closing bracket is typed, text unchanged', () => {
    const { editor } = open('hello world')
    editor.commands.setTextSelection(6)
    type(editor, ' [[b|Bee]]')
    expect(editor.state.doc.textContent).toBe('hello [[b|Bee]] world')
    expect(wikiTexts(editor)).toEqual(['[[b|Bee]]'])
    expect(runs(editor)).toEqual(['hello []', '[[b|Bee]][wikiLink]', ' world[]'])
    expect(editor.state.selection.from).toBe(editor.state.doc.textContent.indexOf(' world') + 1)
  })

  it('does not extend the mark to what is typed next', () => {
    const { editor } = open('hello')
    editor.commands.setTextSelection(6)
    type(editor, '[[b]]')
    expect(wikiTexts(editor)).toEqual(['[[b]]'])
    expect(editor.state.storedMarks ?? []).toEqual([])
    type(editor, 'X')
    expect(editor.state.doc.textContent).toBe('hello[[b]]X')
    expect(wikiTexts(editor)).toEqual(['[[b]]'])
  })

  it('does not mark an unfinished link', () => {
    const { editor } = open('x')
    editor.commands.setTextSelection(2)
    type(editor, '[[a]')
    expect(wikiTexts(editor)).toEqual([])
    type(editor, 'bc')
    expect(wikiTexts(editor)).toEqual([])
  })

  it('marks only the first closing pair, a third bracket stays plain', () => {
    const { editor } = open('x')
    editor.commands.setTextSelection(2)
    type(editor, '[[a]')
    type(editor, ']')
    type(editor, ']')
    expect(editor.state.doc.textContent).toBe('x[[a]]]')
    expect(wikiTexts(editor)).toEqual(['[[a]]'])
  })

  it('does not mark an empty or a single-bracket literal', () => {
    const { editor } = open('x')
    editor.commands.setTextSelection(2)
    type(editor, '[[]]')
    expect(wikiTexts(editor)).toEqual([])
    type(editor, ' [a]')
    expect(wikiTexts(editor)).toEqual([])
    expect(editor.state.doc.textContent).toBe('x[[]] [a]')
  })

  it.each([
    ['a paragraph', 'hello', 'hello'],
    ['a heading', '# Title', 'Title'],
    ['a list item', '- item', 'item'],
    ['a quote', '> quoted', 'quoted'],
    ['a table cell', '| a | b |\n| - | - |\n| c | d |', 'c'],
  ])('marks a link typed in %s', (_name, source, anchor) => {
    const { editor } = open(source)
    caretAfter(editor, anchor)
    type(editor, ' [[b]]')
    expect(wikiTexts(editor)).toEqual(['[[b]]'])
  })

  it('keeps the other marks of the surrounding text', () => {
    const { editor } = open('**bold** z')
    caretAfter(editor, 'bold')
    type(editor, ' [[b]]')
    expect(runs(editor)).toContain('[[b]][wikiLink,bold]')
  })

  it('never marks inside inline code', () => {
    const { editor } = open('a `code` b')
    caretAfter(editor, 'code')
    type(editor, '[[z]]')
    expect(wikiTexts(editor)).toEqual([])
    expect(editor.state.doc.textContent).toBe('a code[[z]] b')
  })

  it('never marks inside a code block', () => {
    const { editor } = open('```\nblock\n```')
    caretAfter(editor, 'bl')
    type(editor, '[[r]]')
    expect(wikiTexts(editor)).toEqual([])
    expect(editor.state.doc.textContent).toBe('bl[[r]]ock')
  })

  it('marks a literal with a backslash (the serializer writes it verbatim)', () => {
    const { editor } = open('x')
    editor.commands.setTextSelection(2)
    type(editor, '[[a\\b]]')
    expect(editor.state.doc.textContent).toBe('x[[a\\b]]')
    expect(wikiTexts(editor)).toEqual(['[[a\\b]]'])
  })

  it('leaves a link plain when the closing bracket replaces a selection', () => {
    const { editor } = open('[[a] zz')
    editor.commands.setTextSelection({ from: 5, to: 8 })
    type(editor, ']')
    expect(editor.state.doc.textContent).toBe('[[a]]')
    expect(wikiTexts(editor)).toEqual([])
  })
})

describe('links and code are not wiki links', () => {
  const LINKED = '[foo bar](https://x.test/p)'

  it('does not mark a literal typed inside hyperlink text', () => {
    const { editor } = open(LINKED)
    caretAfter(editor, 'foo')
    type(editor, ' [[a]]')
    expect(editor.state.doc.textContent).toBe('foo [[a]] bar')
    expect(wikiTexts(editor)).toEqual([])
  })

  it('does not mark a literal pasted inside hyperlink text', () => {
    const { editor } = open(LINKED)
    caretAfter(editor, 'foo')
    paste(editor, ' [[a]]')
    expect(editor.state.doc.textContent).toBe('foo [[a]] bar')
    expect(wikiTexts(editor)).toEqual([])
  })

  it('does not mark a literal whose brackets are split by a code run', () => {
    const { editor } = open('a `code` b')
    caretAfter(editor, 'code')
    type(editor, '[[x')
    // leave the code run, as the Right arrow does
    editor.view.dispatch(editor.state.tr.setStoredMarks([]))
    type(editor, ']]')
    expect(editor.state.doc.textContent).toBe('a code[[x]] b')
    expect(wikiTexts(editor)).toEqual([])
  })
})

describe('what a paste or drop may mark', () => {
  it('leaves a plain literal the user kept (Backspace) alone when a paste lands next to it', () => {
    const { editor } = open('hello')
    editor.commands.setTextSelection(6)
    type(editor, '[[z]]')
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    )
    expect(wikiTexts(editor)).toEqual([])
    paste(editor, ' and more')
    expect(editor.state.doc.textContent).toBe('hello[[z]] and more')
    expect(wikiTexts(editor)).toEqual([])
  })

  it('marks the link of a drop', () => {
    const { editor } = open('hello')
    editor.view.dispatch(editor.state.tr.insertText(' [[a]]', 6).setMeta('uiEvent', 'drop'))
    expect(editor.state.doc.textContent).toBe('hello [[a]]')
    expect(wikiTexts(editor)).toEqual(['[[a]]'])
  })

  it('never marks an insert that is neither a paste nor a drop', () => {
    const { editor } = open('hello')
    editor.view.dispatch(editor.state.tr.insertText(' [[a]]', 6))
    expect(editor.state.doc.textContent).toBe('hello [[a]]')
    expect(wikiTexts(editor)).toEqual([])
  })
})

describe('the mark stops at its literal', () => {
  const caretAtEnd = (editor: Editor) =>
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)

  it('a pasted link at a block end does not take the text typed after it', () => {
    const { editor } = open('hello')
    editor.commands.setTextSelection(6)
    paste(editor, ' [[b]]')
    type(editor, ' after')
    expect(editor.state.doc.textContent).toBe('hello [[b]] after')
    expect(wikiTexts(editor)).toEqual(['[[b]]'])
  })

  it('a pasted link at a block end does not mark the next line', () => {
    const { editor } = open('hello')
    editor.commands.setTextSelection(6)
    paste(editor, ' [[b]]')
    editor.commands.splitBlock()
    type(editor, 'next')
    expect(editor.state.doc.textContent).toBe('hello [[b]]next')
    expect(wikiTexts(editor)).toEqual(['[[b]]'])
  })

  it('a link loaded from a file does not take the text typed after it', () => {
    const { editor } = open('see [[Việt]]')
    caretAtEnd(editor)
    type(editor, ' after')
    editor.commands.splitBlock()
    type(editor, 'next')
    expect(editor.state.doc.textContent).toBe('see [[Việt]] afternext')
    expect(wikiTexts(editor)).toEqual(['[[Việt]]'])
  })

  it('an edit inside a link (before the closing brackets, in the alias) keeps the mark', () => {
    const { editor, save } = saver('see [[b|Bee]] end')
    caretAfter(editor, 'Be')
    type(editor, 'XY')
    expect(wikiTexts(editor)).toEqual(['[[b|BeXYe]]'])
    caretAfter(editor, 'BeXYe')
    type(editor, 'Z')
    expect(wikiTexts(editor)).toEqual(['[[b|BeXYeZ]]'])
    expect(save()).toBe('see [[b|BeXYeZ]] end')
  })
})

describe('typed link in a table cell', () => {
  const TABLE = '| a | b |\n| - | - |\n| c | d |'

  it('marks it and saves the pipe escaped, as a reopen would read it', () => {
    const { editor, save } = saver(TABLE)
    caretAfter(editor, 'c')
    type(editor, ' [[x|y]]')
    expect(wikiTexts(editor)).toEqual(['[[x|y]]'])
    expect(editor.getMarkdown()).toContain('[[x\\|y]]')
    expect(save()).toContain('c [[x\\|y]]')
  })

  it('marks a pasted source-escaped literal (backslash)', () => {
    const { editor } = open(TABLE)
    caretAfter(editor, 'c')
    paste(editor, ' [[x\\|y]]')
    expect(editor.state.doc.textContent).toContain('[[x\\|y]]')
    expect(wikiTexts(editor)).toEqual(['[[x\\|y]]'])
  })
})

describe('pasted link', () => {
  it('marks one link in the middle of a paragraph', () => {
    const { editor } = open('hello world')
    editor.commands.setTextSelection(6)
    paste(editor, ' [[b|Bee]]')
    expect(editor.state.doc.textContent).toBe('hello [[b|Bee]] world')
    expect(wikiTexts(editor)).toEqual(['[[b|Bee]]'])
  })

  it('marks every link of a paste and leaves the prose between them alone', () => {
    const { editor } = open('hello world')
    editor.commands.setTextSelection(6)
    paste(editor, ' [[b|Bee]] and [[c]] and [[#Top]] x')
    expect(editor.state.doc.textContent).toBe('hello [[b|Bee]] and [[c]] and [[#Top]] x world')
    expect(wikiTexts(editor)).toEqual(['[[b|Bee]]', '[[c]]', '[[#Top]]'])
  })

  it('marks links across paragraphs', () => {
    const { editor } = open('hello')
    editor.commands.setTextSelection(6)
    paste(editor, ' [[b]]\n\nsecond [[c]] para')
    expect(wikiTexts(editor)).toEqual(['[[b]]', '[[c]]'])
  })

  it('marks a link pasted into a list item, a quote and a heading', () => {
    const { editor } = open('# H\n\n- item\n\n> quote')
    caretAfter(editor, 'item')
    paste(editor, ' [[li]]')
    caretAfter(editor, 'quote')
    paste(editor, ' [[qu]]')
    caretAfter(editor, 'H')
    paste(editor, ' [[he]]')
    expect(wikiTexts(editor).sort()).toEqual(['[[he]]', '[[li]]', '[[qu]]'])
  })

  it('marks a link pasted into a table cell, saved with the pipe escaped', () => {
    const { editor } = open('| a | b |\n| - | - |\n| c | d |')
    caretAfter(editor, 'c')
    paste(editor, ' [[x|y]] [[z]]')
    expect(wikiTexts(editor)).toEqual(['[[x|y]]', '[[z]]'])
    expect(editor.getMarkdown()).toContain('c [[x\\|y]] [[z]]')
  })

  it('marks the link of an in-app copy (html anchor), with and without a slice marker', () => {
    for (const html of [
      '<p>x <a class="wiki-link">[[b]]</a> y</p>',
      '<p data-pm-slice="1 1 []">x <a class="wiki-link">[[b]]</a> y</p>',
    ]) {
      const { editor } = open('hello')
      editor.commands.setTextSelection(6)
      paste(editor, 'x [[b]] y', html)
      expect(wikiTexts(editor)).toEqual(['[[b]]'])
      expect(editor.state.doc.textContent).toContain('[[b]]')
    }
  })

  it('marks a link completed by a second paste (`[[b`, then `]]`)', () => {
    const { editor } = open('hello')
    editor.commands.setTextSelection(6)
    paste(editor, '[[b')
    expect(wikiTexts(editor)).toEqual([])
    paste(editor, ']]')
    expect(editor.state.doc.textContent).toBe('hello[[b]]')
    expect(wikiTexts(editor)).toEqual(['[[b]]'])
  })

  it('marks a pasted literal with a backslash', () => {
    const { editor } = open('hello')
    editor.commands.setTextSelection(6)
    paste(editor, ' [[a\\b]] and [[c]]')
    expect(wikiTexts(editor)).toEqual(['[[a\\b]]', '[[c]]'])
  })

  it('does not mark an empty or single-bracket literal', () => {
    const { editor } = open('hello')
    editor.commands.setTextSelection(6)
    paste(editor, ' [[]] [a] [[b] c')
    expect(wikiTexts(editor)).toEqual([])
  })

  it('never marks inside inline code', () => {
    const { editor } = open('a `code` b')
    caretAfter(editor, 'code')
    paste(editor, '[[z]]')
    expect(editor.state.doc.textContent).toBe('a code[[z]] b')
    expect(wikiTexts(editor)).toEqual([])
  })

  it('never marks inside a code block', () => {
    const { editor } = open('```\nblock\n```')
    caretAfter(editor, 'bl')
    paste(editor, '[[r]]')
    expect(editor.state.doc.textContent).toBe('bl[[r]]ock')
    expect(wikiTexts(editor)).toEqual([])
  })

  it('leaves an existing link and the rest of the document alone', () => {
    const { editor } = open('[[a]] first\n\nsecond [[c]] para')
    caretAfter(editor, 'first')
    paste(editor, ' [[b]]')
    expect(wikiTexts(editor)).toEqual(['[[a]]', '[[b]]', '[[c]]'])
  })
})

describe('undo', () => {
  it('one undo removes the closing bracket and the mark together', () => {
    // one key per second so every keystroke is its own history event
    vi.useFakeTimers({ toFake: ['Date'] })
    const { editor } = open('hello')
    editor.commands.setTextSelection(6)
    const t0 = Date.now()
    ;[...' [[b]]'].forEach((ch, i) => {
      vi.setSystemTime(t0 + i * 1000)
      type(editor, ch)
    })
    expect(wikiTexts(editor)).toEqual(['[[b]]'])
    editor.commands.undo()
    expect(editor.state.doc.textContent).toBe('hello [[b]')
    expect(wikiTexts(editor)).toEqual([])
    editor.commands.redo()
    expect(editor.state.doc.textContent).toBe('hello [[b]]')
    expect(wikiTexts(editor)).toEqual(['[[b]]'])
  })

  it('Backspace right after the closing bracket drops only the mark', () => {
    const { editor } = open('hello')
    editor.commands.setTextSelection(6)
    type(editor, '[[b]]')
    expect(wikiTexts(editor)).toEqual(['[[b]]'])
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    )
    expect(editor.state.doc.textContent).toBe('hello[[b]]')
    expect(wikiTexts(editor)).toEqual([])
  })

  it('one undo removes a whole paste with its marks', () => {
    const { editor } = open('hello world')
    editor.commands.setTextSelection(6)
    paste(editor, ' [[b|Bee]] and [[c]]')
    expect(wikiTexts(editor)).toHaveLength(2)
    editor.commands.undo()
    expect(editor.state.doc.textContent).toBe('hello world')
    expect(wikiTexts(editor)).toEqual([])
  })
})

describe('composition', () => {
  it('marks a link an IME finished writing', async () => {
    const { editor } = open('hello')
    editor.commands.setTextSelection(6)
    // the composed text lands without a keystroke the rule could see
    editor.view.dispatch(editor.state.tr.insertText('[[Việt]]', 6))
    expect(wikiTexts(editor)).toEqual([])
    editor.view.dom.dispatchEvent(new Event('compositionend'))
    await new Promise((r) => setTimeout(r, 20))
    expect(editor.state.doc.textContent).toBe('hello[[Việt]]')
    expect(wikiTexts(editor)).toEqual(['[[Việt]]'])
  })
})

describe('decoration and save', () => {
  it('paints a typed link without a reopen, asking the resolver only for new targets', async () => {
    const resolve = vi.fn(async (_from: string, targets: string[]) =>
      Object.fromEntries(
        targets.map((t) => [t, t === 'nope' ? { path: '', fragment: '', found: false } : found(t)]),
      ),
    )
    const { editor } = open('[[b]] end\n\nsecond para\n', resolve)
    await settled()
    expect(resolve).toHaveBeenCalledTimes(1)
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    type(editor, ' then [[b|Bee]]')
    await settled()
    const typed = editor.view.dom.querySelector('[data-wiki-target="[[b|Bee]]"]')
    expect(typed?.className).toContain('wiki-link-resolved')
    // `b` was already answered: no extra question
    expect(resolve).toHaveBeenCalledTimes(1)
    paste(editor, ' and [[b#H]] [[nope]]')
    await settled()
    expect(editor.view.dom.querySelector('[data-wiki-target="[[b#H]]"]')?.className).toContain(
      'wiki-link-resolved',
    )
    expect(editor.view.dom.querySelector('[data-wiki-target="[[nope]]"]')?.className).toContain(
      'wiki-link-unresolved',
    )
    expect(resolve.mock.calls.at(-1)?.[1]).toEqual(['b', 'b#H', 'nope'])
  })

  it('saves exactly the typed and pasted bytes, and a reopen gives the same marks', () => {
    const { editor, save } = saver('[[b]] end\n\nsecond para\n')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    type(editor, ' then [[b|Bee]]')
    paste(editor, ' and [[b#H]] [[nope]]')
    const saved = save()
    expect(saved).toBe('[[b]] end\n\nsecond para then [[b|Bee]] and [[b#H]] [[nope]]\n')

    const again = saver(saved)
    expect(runs(again.editor)).toEqual(runs(editor))
    expect(again.save()).toBe(saved)

    // the source view re-parses the text: same marks again
    editor
      .chain()
      .setMeta('addToHistory', false)
      .setContent(parseDocText(saved).body, { contentType: 'markdown' })
      .run()
    expect(runs(editor)).toEqual(runs(again.editor))
  })
})

describe('a literal with a backslash, typed or pasted, saves stable', () => {
  /**
   * Edit + save through the splice, reopen from what was saved, three cycles:
   * the bytes never change and the reopen keeps the same marks.
   */
  function threeCycles(first: string, literal: string, firstEditor: Editor) {
    expect(wikiTexts(firstEditor)).toEqual([literal])
    expect(firstEditor.getMarkdown()).toBe(first)
    let current = first
    for (let i = 1; i <= 3; i++) {
      const { editor, save } = saver(current)
      expect(wikiTexts(editor), `reopen ${i}`).toEqual([literal])
      editor.view.dispatch(editor.state.tr.insertText(' z', editor.state.doc.content.size - 1))
      expect(save(), `save ${i}`).toBe(first.replace(/ b$/, ' b z'))
      editor.view.dispatch(
        editor.state.tr.delete(
          editor.state.doc.content.size - 3,
          editor.state.doc.content.size - 1,
        ),
      )
      expect(save(), `save back ${i}`).toBe(first)
      current = save()
    }
  }

  for (const literal of ['[[x\\y]]', '[[x\\\\y]]', '[[my_note]]', '[[a\\_b]]']) {
    it(`typed ${literal}`, () => {
      const { editor } = open('a  b')
      editor.commands.setTextSelection(3)
      type(editor, literal)
      threeCycles(`a ${literal} b`, literal, editor)
    })
    it(`pasted ${literal}`, () => {
      const { editor } = open('a  b')
      editor.commands.setTextSelection(3)
      paste(editor, literal)
      threeCycles(`a ${literal} b`, literal, editor)
    })
  }

  it('a source-escaped literal pasted into a table cell saves stable', () => {
    const TABLE = '| a | b |\n| - | - |\n| c | d |'
    const { editor } = open(TABLE)
    caretAfter(editor, 'c')
    paste(editor, ' [[b\\|Bee]]')
    expect(wikiTexts(editor)).toEqual(['[[b\\|Bee]]'])
    const first = editor.getMarkdown()
    expect(first).toContain('c [[b\\|Bee]]')
    let current = first
    for (let i = 1; i <= 3; i++) {
      const again = saver(current)
      // in a cell the file's `\|` is the escaped pipe, so a reopen reads `[[b|Bee]]`
      expect(wikiTexts(again.editor), `reopen ${i}`).toEqual(['[[b|Bee]]'])
      expect(again.save(), `save ${i}`).toBe(current)
      expect(again.editor.getMarkdown(), `full ${i}`).toBe(first)
      current = again.save()
    }
  })
})

/** every inline atom of the document: `<wikiEmbed ![[x]]>` */
function atoms(editor: Editor): string[] {
  const out: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.isAtom && node.isInline && !node.isText)
      out.push(`<${node.type.name} ${String(node.attrs.raw ?? '')}>`)
  })
  return out
}

describe('wiki embeds typed and pasted', () => {
  it('turns a pasted ![[embed]] into the embed node, not into a link on its inner [[x]]', () => {
    const { editor } = open('Start')
    caretAfter(editor, 'Start')
    paste(editor, ' ![[Pic.png|200]] tail')
    expect(atoms(editor)).toEqual(['<wikiEmbed ![[Pic.png|200]]>'])
    expect(wikiTexts(editor)).toEqual([])
    // the file reads exactly as pasted
    expect(editor.getMarkdown()).toBe('Start ![[Pic.png|200]] tail')
  })

  it('handles an embed next to links in one paste, in one undo step', () => {
    const { editor } = open('Start')
    caretAfter(editor, 'Start')
    paste(editor, ' [[A]] and ![[B.png]] and [[C|c]]')
    expect(wikiTexts(editor)).toEqual(['[[A]]', '[[C|c]]'])
    expect(atoms(editor)).toEqual(['<wikiEmbed ![[B.png]]>'])
    expect(editor.getMarkdown()).toBe('Start [[A]] and ![[B.png]] and [[C|c]]')
  })

  it('an escaped bang is a link, not an embed', () => {
    const { editor } = open('Start')
    caretAfter(editor, 'Start')
    paste(editor, ' \\![[x]]')
    expect(atoms(editor)).toEqual([])
    expect(wikiTexts(editor)).toEqual(['[[x]]'])
  })

  it('typing ![[x]] does not mark its inner [[x]] as a link; typing [[x]] still does', () => {
    const embed = open('a  b').editor
    embed.commands.setTextSelection(3)
    type(embed, '![[x]]')
    expect(wikiTexts(embed)).toEqual([])
    expect(embed.state.doc.textContent).toBe('a ![[x]] b')

    const link = open('a  b').editor
    link.commands.setTextSelection(3)
    type(link, '[[x]]')
    expect(wikiTexts(link)).toEqual(['[[x]]'])
  })

  it('without the vault (cap wikiVault off) a pasted embed stays text and its [[x]] keeps the link mark', () => {
    ;(window as unknown as { markdownApi: unknown }).markdownApi = {
      capabilities: { wikiVault: false },
    }
    resetForTest()
    try {
      const { editor } = open('Start')
      caretAfter(editor, 'Start')
      paste(editor, ' ![[Pic.png]]')
      expect(atoms(editor)).toEqual([])
      expect(wikiTexts(editor)).toEqual(['[[Pic.png]]'])
      expect(editor.getMarkdown()).toBe('Start ![[Pic.png]]')
    } finally {
      delete (window as unknown as { markdownApi?: unknown }).markdownApi
    }
  })
})
