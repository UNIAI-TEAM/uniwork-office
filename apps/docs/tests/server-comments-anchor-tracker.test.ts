/**
 * G819-A02a (UNI-2017): the anchor tracker keeps a comment range through the whole-document replace
 * that reloads the editor after a Save (TipTap `setContent`), and still drops one whose text is gone.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { encodeDocxAnchor } from '../src/renderer/server-comments/anchor-codec'
import { createServerAnchors } from '../src/renderer/server-comments/anchor-tracker'

interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
}

const para = (t: string): JsonNode => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  content: [{ type: 'text', text: t }],
})

const editors = new Set<Editor>()
afterEach(() => {
  for (const e of editors) e.destroy()
  editors.clear()
})

function setup() {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        para('Revenue report'),
        para('Revenue grew in the third quarter.'),
        para('Closing.'),
      ],
    },
  })
  editors.add(editor)
  const rangeOf = (needle: string) => {
    let out: { from: number; to: number } | null = null
    editor.state.doc.descendants((node, pos) => {
      const at = out || !node.isTextblock ? -1 : node.textContent.indexOf(needle)
      if (at !== -1) out = { from: pos + 1 + at, to: pos + 1 + at + needle.length }
    })
    if (!out) throw new Error(`no ${needle}`)
    return out as { from: number; to: number }
  }
  const anchors = createServerAnchors(editor)
  const anchor = encodeDocxAnchor(editor.state.doc, rangeOf('third quarter'))!
  anchors.syncThreads([{ id: 'c1', anchor, anchor_state: 'exact' }])
  const reload = () => editor.commands.setContent(editor.getJSON())
  const textOf = (id: string) => {
    const r = anchors.rangeOf(id)
    return r ? editor.state.doc.textBetween(r.from, r.to) : r
  }
  return { editor, anchors, rangeOf, reload, textOf }
}

describe('anchor tracker: whole-document replace (G819-A02a)', () => {
  it('keeps a range whose text still exists after the reload', () => {
    const { reload, textOf } = setup()
    expect(textOf('c1')).toBe('third quarter')
    reload()
    expect(textOf('c1')).toBe('third quarter')
  })

  it('keeps the place of an edit made before the reload', () => {
    const { editor, rangeOf, reload, textOf, anchors } = setup()
    editor.commands.insertContentAt(rangeOf('Revenue').from, 'Total ')
    const moved = anchors.rangeOf('c1')!
    reload()
    expect(textOf('c1')).toBe('third quarter')
    expect(anchors.rangeOf('c1')!.from).toBe(moved.from)
  })

  it('loses a range whose quote is gone after the reload', () => {
    const { editor, rangeOf, reload, anchors } = setup()
    const block = rangeOf('Revenue grew in the third quarter.')
    editor.commands.deleteRange({ from: block.from - 1, to: block.to + 1 })
    reload()
    expect(anchors.rangeOf('c1')).toBeNull()
  })

  it('a partial delete of the quote still collapses it and does not jump', () => {
    const { editor, rangeOf, anchors } = setup()
    editor.commands.deleteRange(rangeOf('third quarter'))
    expect(anchors.rangeOf('c1')).toBeNull()
    editor.commands.insertContentAt(1, 'X')
    expect(anchors.rangeOf('c1')).toBeNull()
  })
})
