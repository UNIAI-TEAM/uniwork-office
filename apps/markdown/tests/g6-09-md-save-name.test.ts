// The name the ask-before-saving card offers (G6-09 visual r1 F6): taken from the document's first
// heading or line, never from the prompt, and never ends in punctuation, so "name" + ".md" cannot
// become "name..md".
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { deriveAutoFileName } from '../src/renderer/App'
import { cleanDraftName } from '../src/shared/draft-name'

vi.mock('katex/dist/katex.min.css?inline', () => ({ default: '' }))

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})
function editorWith(markdown: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '',
  })
  editor
    .chain()
    .setMeta('addToHistory', false)
    .setContent(markdown, { contentType: 'markdown' })
    .run()
  editors.push(editor)
  return editor
}

describe('cleanDraftName', () => {
  it('drops trailing sentence punctuation and dots, keeps inner ones', () => {
    expect(cleanDraftName('First AI block.')).toBe('First AI block')
    expect(cleanDraftName('Hello world!?  ')).toBe('Hello world')
    expect(cleanDraftName('v1.2 notes…')).toBe('v1.2 notes')
    expect(cleanDraftName('阿里巴巴集团介绍。')).toBe('阿里巴巴集团介绍')
    expect(cleanDraftName('Meeting: notes;')).toBe('Meeting: notes')
  })
  it('nothing left means no name', () => {
    expect(cleanDraftName('...')).toBe('')
    expect(cleanDraftName('')).toBe('')
  })
})

describe('deriveAutoFileName', () => {
  it('a first paragraph ending in a full stop gives a name without it', () => {
    expect(deriveAutoFileName(editorWith('First AI block.\n\nSecond AI block.'))).toBe(
      'First AI block',
    )
  })
  it('a heading with trailing punctuation too', () => {
    expect(deriveAutoFileName(editorWith('# Plan for May!\n\nbody'))).toBe('Plan for May')
  })
  it('a cut at the length limit does not end in a space or dot', () => {
    const name = deriveAutoFileName(editorWith(`${'word '.repeat(11)}end.\n\nmore`))
    expect(name).not.toMatch(/[\s.]$/)
  })
})

describe('save dialog default name', () => {
  it('the main process uses the same cleaning before it adds the extension', () => {
    const main = readFileSync(join(__dirname, '..', 'src/main/markdown-main.ts'), 'utf8')
    expect(main).toContain("from '../shared/draft-name'")
    expect(main).toMatch(/cleanDraftName\(/)
  })
})
