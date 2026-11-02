// UNI-2309 (Q-B8): the one-shot writer behind write_document runs only where the host reaches the
// UniWork AI writer route (the web frame). The desktop runner refuses one-shot requests, so there
// the skill neither offers write_document nor runs a forced call, and the prompt says so.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { createDocsSkill } from '../src/renderer/ai/docs-skill'
import type { AiDocWriter } from '../src/renderer/ai/doc-writer'

const NOTE =
  'Note: write_document is not available here. Edit the open document with the editing tools; do not offer to write a new document in one go.'

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

function skillFor(route: (() => boolean) | undefined, writer: AiDocWriter) {
  const editor = createEditor()
  return createDocsSkill(
    () => editor,
    () => NUM_IDS,
    undefined,
    undefined,
    undefined,
    undefined,
    () => writer,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    route,
  )
}

describe('write_document follows the UniWork AI writer route', () => {
  it('without the route: not offered, refused, and the prompt says so', async () => {
    const write = vi.fn()
    const skill = skillFor(() => false, { write })
    expect(skill.tools.map((t) => t.name)).not.toContain('write_document')
    expect(skill.systemPrompt).toContain(NOTE)
    const exec = await skill.executeTool({
      id: 't1',
      name: 'write_document',
      input: { plan: '# Title\n## Part' },
    })
    expect(exec.isError).toBe(true)
    expect(exec.output).toContain('document writing is not available here')
    expect(write).not.toHaveBeenCalled()
  })

  it('with the route, or none set: offered, and no note', () => {
    for (const route of [() => true, undefined]) {
      const skill = skillFor(route, { write: vi.fn() })
      expect(skill.tools.map((t) => t.name)).toContain('write_document')
      expect(skill.systemPrompt).not.toContain(NOTE)
    }
  })
})
