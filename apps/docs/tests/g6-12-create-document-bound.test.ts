// G6-12 #2 (C-BOUND): create_document writes a new file outside the open
// document, so a UniWork-bound document never offers it and refuses a call.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { createDocsSkill } from '../src/renderer/ai/docs-skill'

const NUM_IDS = { bullet: null, ordered: null }
const editors = new Set<Editor>()
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.clear()
})

function createEditor(): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        { type: 'docParagraph', attrs: { docxIndex: 0 }, content: [{ type: 'text', text: 'x' }] },
      ],
    },
  })
  editors.add(editor)
  return editor
}

function skillFor(editor: Editor, bound: boolean) {
  return createDocsSkill(
    () => editor,
    () => NUM_IDS,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => false,
    () => bound,
  )
}

type DesktopStub = { desktop?: unknown }

describe('create_document on a UniWork-bound document', () => {
  it('is not offered to the model', () => {
    const skill = skillFor(createEditor(), true)
    const names = skill.tools.map((t) => t.name)
    expect(names).not.toContain('create_document')
    expect(names).toContain('insert_content')
  })

  it('refuses a call without touching the bridge', async () => {
    const createDocument = vi.fn(async () => ({ ok: true, path: '/tmp/x.docx' }))
    const w = window as unknown as DesktopStub
    const saved = w.desktop
    w.desktop = { createDocument }
    try {
      const exec = await skillFor(createEditor(), true).executeTool({
        id: 't1',
        name: 'create_document',
        input: { type: 'docx', title: 'Leak', content: '<p>secret</p>' },
      })
      expect(exec.isError).toBe(true)
      expect(exec.mutated).toBe(false)
      expect(exec.output).toMatch(/UniWork/)
      expect(createDocument).not.toHaveBeenCalled()
    } finally {
      w.desktop = saved
    }
  })

  it('keeps create_document for a local document', () => {
    const skill = skillFor(createEditor(), false)
    expect(skill.tools.map((t) => t.name)).toContain('create_document')
  })
})
