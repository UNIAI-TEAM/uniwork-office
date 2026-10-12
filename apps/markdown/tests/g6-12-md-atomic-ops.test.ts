import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { executeTool, type FrontmatterAccess } from '../src/renderer/ai/tools'

// G6-12 #8: markdown apply_ops is atomic like docs/html — one failing op leaves the
// document (body, frontmatter, undo history) exactly as it was before the call.

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})

function createEditor(md = ''): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '',
  })
  if (md) editor.commands.setContent(md, { contentType: 'markdown' })
  editors.push(editor)
  return editor
}

const ops = (...list: Record<string, unknown>[]) => ({
  id: 't1',
  name: 'apply_ops',
  input: { ops: list },
})

function memoryFrontmatter(initial: string): FrontmatterAccess & { value: string } {
  return {
    value: initial,
    read() {
      return this.value
    },
    write(inner: string) {
      this.value = inner
    },
  }
}

describe('markdown apply_ops is atomic', () => {
  it('a failing op rolls back every op that ran before it', () => {
    const editor = createEditor('# Title\n\none\n\ntwo\n\nthree')
    const before = editor.state.doc
    const result = executeTool(
      editor,
      ops(
        { op: 'replaceText', target: { start: 1 }, find: 'one', replace: '1' },
        { op: 'insertContent', after: -1, markdown: 'intro' },
        { op: 'setStyle', target: { start: 3 }, style: 'bold' },
        { op: 'deleteBlocks', target: { start: 2 } },
        { op: 'replaceText', target: { start: 3 }, find: 'missing', replace: 'x' },
      ),
    )
    if (result instanceof Promise) throw new Error('apply_ops must be synchronous')
    expect(result.isError).toBe(true)
    expect(result.mutated).toBeFalsy()
    expect(result.output).toContain('ops[4] replaceText FAILED')
    expect(result.output).toMatch(/nothing was applied/i)
    expect(editor.state.doc.eq(before)).toBe(true)
  })

  it('a rolled-back batch leaves no undo step that re-applies part of it', () => {
    const editor = createEditor('one\n\ntwo')
    const before = editor.state.doc
    executeTool(
      editor,
      ops(
        { op: 'replaceText', target: { start: 0 }, find: 'one', replace: '1' },
        { op: 'insertContent', after: 1, markdown: 'added' },
        { op: 'replaceText', target: { start: 1 }, find: 'missing', replace: 'x' },
      ),
    )
    expect(editor.state.doc.eq(before)).toBe(true)
    // the batch's own history event undoes to nothing; further undos only reach the
    // test's setContent, never a partial state of the batch
    editor.commands.undo()
    expect(editor.state.doc.eq(before)).toBe(true)
    for (let i = 0; i < 2; i++) {
      editor.commands.undo()
      expect(editor.getMarkdown()).not.toContain('added')
      expect(editor.getMarkdown()).not.toContain('1')
    }
  })

  it('a failing batch restores the frontmatter an earlier op rewrote', () => {
    const editor = createEditor('body')
    const fm = memoryFrontmatter('title: Old')
    const result = executeTool(
      editor,
      ops(
        { op: 'setFrontmatter', yaml: 'title: New' },
        { op: 'replaceText', target: { start: 0 }, find: 'missing', replace: 'x' },
      ),
      undefined,
      fm,
    )
    if (result instanceof Promise) throw new Error('apply_ops must be synchronous')
    expect(result.isError).toBe(true)
    expect(fm.value).toBe('title: Old')
  })

  it('a fully valid batch still applies every op', () => {
    const editor = createEditor('one\n\ntwo')
    const result = executeTool(
      editor,
      ops(
        { op: 'replaceText', target: { start: 0 }, find: 'one', replace: '1' },
        { op: 'replaceText', target: { start: 1 }, find: 'two', replace: '2' },
      ),
    )
    if (result instanceof Promise) throw new Error('apply_ops must be synchronous')
    expect(result.isError).toBeUndefined()
    expect(result.mutated).toBe(true)
    expect(editor.getMarkdown()).toContain('1')
    expect(editor.getMarkdown()).toContain('2')
  })
})
