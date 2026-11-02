// UNI-2309 (Q-B8): the one-shot writer behind write_document runs only where the host reaches the
// UniWork AI writer route (the web frame). The desktop runner refuses one-shot requests, so there
// the skill neither offers write_document nor runs a forced call, and the prompt says so.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { createMarkdownSkill } from '../src/renderer/ai/markdown-skill'
import type { AiDocWriter } from '../src/renderer/ai/doc-writer'

const NOTE =
  'Note: write_document is not available here. Edit the open document with the editing tools; do not offer to write a new document in one go.'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})

function createEditor(): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '<p>Saved document</p>',
  })
  editors.push(editor)
  return editor
}

function skillFor(route: (() => boolean) | undefined, writer: AiDocWriter) {
  const editor = createEditor()
  return createMarkdownSkill(
    () => editor,
    undefined,
    undefined,
    () => writer,
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
    const skill = skillFor(() => false, { write } as unknown as AiDocWriter)
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
      const skill = skillFor(route, { write: vi.fn() } as unknown as AiDocWriter)
      expect(skill.tools.map((t) => t.name)).toContain('write_document')
      expect(skill.systemPrompt).not.toContain(NOTE)
    }
  })
})
