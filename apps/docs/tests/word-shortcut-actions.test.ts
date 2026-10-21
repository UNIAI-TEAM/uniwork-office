/**
 * The commands behind the newly bound Word chords —
 * Shift+F3 case ring, Ctrl+T hanging indent, Ctrl+Q paragraph reset,
 * Alt+Shift+Up/Down paragraph moves, and the editor-keymap inserts.
 */
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { applyCase, nextCaseMode, selectionText } from '../src/renderer/editor/case-transform'
import { stepHangingIndent, stepParagraphIndent } from '../src/renderer/editor/indent'
import { moveBlocks } from '../src/renderer/editor/move-block'
import { clearParagraphFormatting } from '../src/renderer/components/ribbon-tabs'

function makeEditor(texts: string[] = ['first block', 'second block']): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: texts.map((text) => ({
        type: 'docParagraph',
        content: [{ type: 'text', text }],
      })),
    },
  })
}

const selectAll = (editor: Editor, from: number, to: number) =>
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  )

const press = (editor: Editor, init: KeyboardEventInit): boolean => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  editor.view.dom.dispatchEvent(event)
  return event.defaultPrevented
}

describe('Shift+F3 case ring', () => {
  it('walks lowercase → UPPERCASE → Capitalize Each Word', () => {
    expect(nextCaseMode('hello world')).toBe('upper')
    expect(nextCaseMode('HELLO WORLD')).toBe('title')
    expect(nextCaseMode('Hello World')).toBe('lower')
    // digits and punctuation alone never move the ring off its entry point
    expect(nextCaseMode('123')).toBe('lower')
  })

  it('rewrites the selection and keeps its marks', () => {
    const editor = makeEditor(['hello world'])
    selectAll(editor, 1, 12)
    applyCase(editor, nextCaseMode(selectionText(editor)))
    expect(editor.state.doc.textContent).toBe('HELLO WORLD')
    applyCase(editor, nextCaseMode(selectionText(editor)))
    expect(editor.state.doc.textContent).toBe('Hello World')
    editor.destroy()
  })

  it('rewrites every run when the selection spans several', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'docParagraph',
            content: [
              { type: 'text', text: 'hello ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'world' },
            ],
          },
        ],
      },
    })
    selectAll(editor, 1, 12)
    applyCase(editor, 'upper')
    expect(editor.state.doc.textContent).toBe('HELLO WORLD')
    // the selection has to survive intact, or the next press only re-cases the tail
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([1, 12])
    applyCase(editor, nextCaseMode(selectionText(editor)))
    expect(editor.state.doc.textContent).toBe('Hello World')
    editor.destroy()
  })

  it('keeps the whole phrase selected when uppercasing lengthens it', () => {
    // ß uppercases to SS, so the rewritten run is longer than the original
    const editor = makeEditor(['straße hell'])
    selectAll(editor, 1, 12)
    applyCase(editor, 'upper')
    expect(editor.state.doc.textContent).toBe('STRASSE HELL')
    expect(selectionText(editor)).toBe('STRASSE HELL')
    applyCase(editor, nextCaseMode(selectionText(editor)))
    expect(editor.state.doc.textContent).toBe('Strasse Hell')
    editor.destroy()
  })

  it('leaves a collapsed caret alone', () => {
    const editor = makeEditor(['hello world'])
    selectAll(editor, 3, 3)
    expect(applyCase(editor, 'upper')).toBe(false)
    expect(editor.state.doc.textContent).toBe('hello world')
    editor.destroy()
  })
})

describe('hanging indent (⌘T / ⇧⌘T)', () => {
  it('indents the block and pulls the first line back', () => {
    const editor = makeEditor(['paragraph'])
    selectAll(editor, 3, 3)
    stepHangingIndent(editor, 1)
    expect(editor.state.doc.child(0).attrs.indentLeft).toBe(720)
    expect(editor.state.doc.child(0).attrs.indentFirstLine).toBe(-720)
    editor.destroy()
  })

  it('reverses back to no indent', () => {
    const editor = makeEditor(['paragraph'])
    selectAll(editor, 3, 3)
    stepHangingIndent(editor, 1)
    stepHangingIndent(editor, 1)
    expect(editor.state.doc.child(0).attrs.indentLeft).toBe(1440)
    stepHangingIndent(editor, -1)
    stepHangingIndent(editor, -1)
    expect(editor.state.doc.child(0).attrs.indentLeft).toBeNull()
    expect(editor.state.doc.child(0).attrs.indentFirstLine).toBeNull()
    editor.destroy()
  })
})

describe('clear paragraph formatting (Ctrl+Q)', () => {
  it('drops direct paragraph attrs but keeps the text', () => {
    const editor = makeEditor(['paragraph'])
    selectAll(editor, 3, 3)
    stepParagraphIndent(editor, 1)
    editor.commands.updateAttributes('docParagraph', { align: 'center', lineSpacing: 2 })
    clearParagraphFormatting(editor)
    const block = editor.state.doc.child(0)
    expect(block.attrs.align).toBeNull()
    expect(block.attrs.lineSpacing).toBeNull()
    expect(block.attrs.indentLeft).toBeNull()
    expect(editor.state.doc.textContent).toBe('paragraph')
    editor.destroy()
  })
})

describe('move paragraph (⌥⇧↑ / ⌥⇧↓)', () => {
  it('swaps the block with its neighbor', () => {
    const editor = makeEditor(['one', 'two', 'three'])
    selectAll(editor, 7, 7) // inside "two"
    expect(moveBlocks(editor, -1)).toBe(true)
    expect(editor.state.doc.child(0).textContent).toBe('two')
    expect(editor.state.doc.child(1).textContent).toBe('one')
    expect(moveBlocks(editor, 1)).toBe(true)
    expect(editor.state.doc.child(1).textContent).toBe('two')
    editor.destroy()
  })

  it('declines at the document edges', () => {
    const editor = makeEditor(['one', 'two'])
    selectAll(editor, 2, 2)
    expect(moveBlocks(editor, -1)).toBe(false)
    expect(editor.state.doc.child(0).textContent).toBe('one')
    editor.destroy()
  })

  it('carries a multi-block selection', () => {
    const editor = makeEditor(['one', 'two', 'three'])
    selectAll(editor, 2, 7) // "one" through "two"
    expect(moveBlocks(editor, 1)).toBe(true)
    expect(editor.state.doc.child(0).textContent).toBe('three')
    expect(editor.state.doc.child(1).textContent).toBe('one')
    expect(editor.state.doc.child(2).textContent).toBe('two')
    editor.destroy()
  })
})

describe('editor keymap inserts', () => {
  it('Mod-Shift-Enter inserts a column break', () => {
    const editor = makeEditor(['paragraph'])
    selectAll(editor, 5, 5)
    expect(press(editor, { key: 'Enter', code: 'Enter', ctrlKey: true, shiftKey: true })).toBe(true)
    let colBreaks = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'hardBreak' && node.attrs.colBreak === true) colBreaks++
    })
    expect(colBreaks).toBe(1)
    editor.destroy()
  })

  // Word's Windows keys (jsdom reports a non-Mac platform): Ctrl+Shift+Space, Alt+Shift+Minus,
  // Ctrl+Alt+Minus. Ctrl+Shift+Minus is Word's subscript now, App's handler owns it.
  it('Ctrl+Shift+Space, Alt+Shift+Minus and Ctrl+Alt+Minus insert Word\u2019s characters', () => {
    const editor = makeEditor(['ab'])
    selectAll(editor, 2, 2)
    expect(press(editor, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(press(editor, { key: '_', code: 'Minus', altKey: true, shiftKey: true })).toBe(true)
    expect(press(editor, { key: '-', code: 'Minus', ctrlKey: true, altKey: true })).toBe(true)
    expect(editor.state.doc.textContent).toBe('a\u00a0\u2011\u00adb')
    editor.destroy()
  })

  it('the old Ctrl+Shift+Minus no longer inserts a non-breaking hyphen', () => {
    const editor = makeEditor(['ab'])
    selectAll(editor, 2, 2)
    expect(press(editor, { key: '_', code: 'Minus', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(editor.state.doc.textContent).toBe('ab')
    editor.destroy()
  })

  it('AltGr and IME composition do not insert', () => {
    const editor = makeEditor(['ab'])
    selectAll(editor, 2, 2)
    const altGr = new KeyboardEvent('keydown', {
      key: '-',
      code: 'Minus',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(altGr, 'getModifierState', { value: (k: string) => k === 'AltGraph' })
    editor.view.dom.dispatchEvent(altGr)
    expect(altGr.defaultPrevented).toBe(false)
    const composing = { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }
    expect(press(editor, { ...composing, isComposing: true })).toBe(false)
    expect(editor.state.doc.textContent).toBe('ab')
    editor.destroy()
  })

  it('Alt-Shift-ArrowUp moves the block', () => {
    const editor = makeEditor(['one', 'two'])
    selectAll(editor, 7, 7)
    expect(press(editor, { key: 'ArrowUp', code: 'ArrowUp', altKey: true, shiftKey: true })).toBe(
      true,
    )
    expect(editor.state.doc.child(0).textContent).toBe('two')
    editor.destroy()
  })
})
