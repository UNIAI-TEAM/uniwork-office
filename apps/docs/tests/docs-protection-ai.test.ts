// Word document protection is document data: the docs AI skill hides and
// refuses exactly the tools the protection forbids, live, for every provider.
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import {
  READ_ONLY_TOOLS,
  aiProtectionOf,
  createDocsSkill,
  type AiDocProtection,
} from '../src/renderer/ai/docs-skill'
import { AGENT_TOOLS } from '../src/renderer/ai/tools'

const NUM_IDS = { bullet: null, ordered: null }
const EDIT_TOOLS = ['insert_content', 'replace_blocks', 'replace_selection', 'apply_ops']
const COMMENT_TOOLS = ['add_comment', 'reply_comment']
const REVIEW_TOOLS = ['accept_changes', 'reject_changes']

function createEditor(): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: 0 },
          content: [{ type: 'text', text: 'Quarterly report' }],
        },
      ],
    },
  })
}

function skillFor(editor: Editor, getProtection: () => AiDocProtection, readOnly = false) {
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
    () => readOnly,
    () => false,
    undefined,
    getProtection,
  )
}

const names = (skill: ReturnType<typeof skillFor>) => skill.tools.map((t) => t.name)

describe('AI agent on a protected Word document', () => {
  for (const kind of ['readOnly', 'forms'] as const) {
    it(`${kind}: only read tools, edits and comments refused`, async () => {
      const editor = createEditor()
      const before = JSON.stringify(editor.getJSON())
      const skill = skillFor(editor, () => kind)
      expect(names(skill).every((n) => READ_ONLY_TOOLS.has(n))).toBe(true)
      for (const n of [...EDIT_TOOLS, ...COMMENT_TOOLS, ...REVIEW_TOOLS]) {
        expect(names(skill)).not.toContain(n)
      }
      expect(skill.systemPrompt).toContain('protected')
      const exec = await skill.executeTool({
        id: 't1',
        name: 'insert_content',
        input: { html: '<p>injected</p>', position: 'end' },
      })
      expect(exec.isError).toBe(true)
      expect(exec.mutated).toBe(false)
      expect(exec.output).toContain('protect')
      expect(JSON.stringify(editor.getJSON())).toBe(before)
      editor.destroy()
    })
  }

  it('comments: read tools plus add/reply comment, body edits refused', async () => {
    const editor = createEditor()
    const before = JSON.stringify(editor.getJSON())
    const skill = skillFor(editor, () => 'comments')
    const got = names(skill)
    for (const n of COMMENT_TOOLS) expect(got).toContain(n)
    for (const n of [...EDIT_TOOLS, ...REVIEW_TOOLS, 'resolve_comment', 'delete_comment']) {
      expect(got).not.toContain(n)
    }
    const exec = await skill.executeTool({
      id: 't1',
      name: 'replace_blocks',
      input: { from: 0, to: 0, html: '<p>x</p>' },
    })
    expect(exec.isError).toBe(true)
    expect(exec.mutated).toBe(false)
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    editor.destroy()
  })

  it('trackedChanges: editing stays, accept/reject are hidden and refused', async () => {
    const editor = createEditor()
    const skill = skillFor(editor, () => 'trackedChanges')
    const got = names(skill)
    for (const n of EDIT_TOOLS) expect(got).toContain(n)
    for (const n of REVIEW_TOOLS) expect(got).not.toContain(n)
    const exec = await skill.executeTool({ id: 't1', name: 'accept_changes', input: {} })
    expect(exec.isError).toBe(true)
    expect(exec.mutated).toBe(false)
    expect(skill.systemPrompt).toContain('tracked')
    editor.destroy()
  })

  it('is live: removing the protection brings every tool back on the next read', () => {
    const editor = createEditor()
    let kind: AiDocProtection = 'readOnly'
    const skill = skillFor(editor, () => kind)
    expect(names(skill)).not.toContain('insert_content')
    kind = 'none'
    expect(names(skill)).toEqual(
      AGENT_TOOLS.map((t) => t.name).filter((n) => names(skill).includes(n)),
    )
    expect(names(skill)).toContain('insert_content')
    expect(names(skill)).toContain('accept_changes')
    expect(skill.systemPrompt).not.toContain('protected')
    kind = 'comments'
    expect(names(skill)).not.toContain('insert_content')
    editor.destroy()
  })

  it('an unprotected document keeps the full tool set and prompt', () => {
    const editor = createEditor()
    const plain = createDocsSkill(
      () => editor,
      () => NUM_IDS,
    )
    const none = skillFor(editor, () => 'none')
    expect(names(none)).toEqual(plain.tools.map((t) => t.name))
    expect(none.systemPrompt).toBe(plain.systemPrompt)
    editor.destroy()
  })

  it('view-only UniWork still wins over a lighter protection', () => {
    const editor = createEditor()
    const skill = skillFor(editor, () => 'comments', true)
    expect(names(skill).every((n) => READ_ONLY_TOOLS.has(n))).toBe(true)
    editor.destroy()
  })
})

describe('aiProtectionOf', () => {
  const on = (edit: string, hash?: string) => ({ edit, enforced: true, hash })
  it('maps the document state to one AI protection kind', () => {
    expect(aiProtectionOf(null, false)).toBe('none')
    expect(aiProtectionOf({ edit: 'readOnly', enforced: false }, false)).toBe('none')
    expect(aiProtectionOf(on('readOnly'), false)).toBe('readOnly')
    expect(aiProtectionOf(on('comments'), false)).toBe('comments')
    expect(aiProtectionOf(on('forms'), false)).toBe('forms')
    expect(aiProtectionOf(on('trackedChanges'), false)).toBe('trackedChanges')
  })

  it('a password-to-modify lock beats every restriction', () => {
    expect(aiProtectionOf(null, true)).toBe('readOnly')
    expect(aiProtectionOf(on('trackedChanges'), true)).toBe('readOnly')
  })

  it('an enforced restriction of an unknown kind is treated as read only', () => {
    expect(aiProtectionOf(on('somethingNew'), false)).toBe('readOnly')
  })
})
