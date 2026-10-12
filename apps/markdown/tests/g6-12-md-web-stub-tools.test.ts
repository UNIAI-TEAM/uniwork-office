import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { resetForTest } from '../src/renderer/capabilities'
import { createMarkdownSkill } from '../src/renderer/ai/markdown-skill'
import { MARKDOWN_WEB_CAPABILITIES } from '../../../web/modules/markdown/webapi'

// G6-12 #11: on the web host insert_image is a stub that always fails (fetchImage has no
// route), so the model must not be offered it there; desktop keeps the tool unchanged.

const w = window as unknown as { markdownApi?: unknown }
const previousApi = w.markdownApi
const editors: Editor[] = []

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
  w.markdownApi = previousApi
  resetForTest()
})

function host(api: Record<string, unknown>): void {
  w.markdownApi = api
  resetForTest()
}

function createEditor(md: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '',
  })
  editor.commands.setContent(md, { contentType: 'markdown' })
  editors.push(editor)
  return editor
}

const names = (skill: { tools: readonly { name: string }[] }) => skill.tools.map((t) => t.name)

describe('markdown insert_image per host', () => {
  it('the web frame defaults turn the AI image download off', () => {
    expect((MARKDOWN_WEB_CAPABILITIES as Record<string, unknown>).aiImageFetch).toBe(false)
  })

  it('desktop: insert_image is offered', () => {
    host({})
    const skill = createMarkdownSkill(() => null)
    expect(names(skill)).toContain('insert_image')
  })

  it('web: insert_image is not offered and a stray call is refused without a download', async () => {
    const fetchImage = vi.fn(async () => null)
    host({ capabilities: { ...MARKDOWN_WEB_CAPABILITIES, platform: 'web' }, fetchImage })
    const editor = createEditor('para')
    const skill = createMarkdownSkill(() => editor)
    expect(names(skill)).not.toContain('insert_image')
    // the rest of the editing tools stay
    expect(names(skill)).toContain('apply_ops')
    expect(names(skill)).toContain('image_search')
    const result = await skill.executeTool(
      { id: 't1', name: 'insert_image', input: { url: 'https://example.com/a.png' } },
      undefined,
    )
    expect(result.isError).toBe(true)
    expect(fetchImage).not.toHaveBeenCalled()
    expect(editor.getMarkdown()).toBe('para')
  })
})
