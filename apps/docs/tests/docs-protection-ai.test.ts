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
import { aiTrackFor, aiTracksChanges } from '../src/renderer/ai/track-policy'

const NUM_IDS = { bullet: null, ordered: null }
const EDIT_TOOLS = ['insert_content', 'replace_blocks', 'replace_selection', 'apply_ops']
const COMMENT_TOOLS = ['add_comment', 'reply_comment']
const REVIEW_TOOLS = ['accept_changes', 'reject_changes']
// write tools that cannot record a tracked revision (side state, notes, charts, pictures, floating objects)
const UNTRACKABLE_TOOLS = [
  'set_header_footer',
  'set_page_setup',
  'insert_section_break',
  'define_style',
  'set_watermark',
  'insert_footnote',
  'insert_endnote',
  'edit_note',
  'delete_note',
  'insert_chart',
  'edit_chart',
  'insert_text_box',
  'insert_image',
  'insert_picture',
  'generate_image',
]
// write tools that take `track` and keep working under tracked-changes protection
const TRACKABLE_TOOLS = ['insert_content', 'replace_blocks', 'replace_selection', 'apply_ops']

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
      expect(skill.systemPrompt).toContain('this document is protected')
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

  it('trackedChanges: every write tool that cannot record a revision is hidden and refused', async () => {
    const editor = createEditor()
    const before = JSON.stringify(editor.getJSON())
    const skill = skillFor(editor, () => 'trackedChanges')
    const got = names(skill)
    for (const n of UNTRACKABLE_TOOLS) expect(got).not.toContain(n)
    for (const n of [...TRACKABLE_TOOLS, 'write_document', ...COMMENT_TOOLS]) {
      expect(got).toContain(n)
    }
    for (const n of UNTRACKABLE_TOOLS) {
      const exec = await skill.executeTool({ id: 't1', name: n, input: {} })
      expect(exec.isError).toBe(true)
      expect(exec.mutated).toBe(false)
    }
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    expect(skill.systemPrompt).toContain('tracked changes')
    editor.destroy()
  })

  it('refusal text uses plain words, not the camelCase kind', async () => {
    const editor = createEditor()
    const skill = skillFor(editor, () => 'trackedChanges')
    const exec = await skill.executeTool({ id: 't1', name: 'accept_changes', input: {} })
    expect(exec.output).toContain('tracked changes')
    expect(exec.output).not.toContain('trackedChanges')
    editor.destroy()
  })

  it('BYOK and UniWork AI settings see the same tools under every protection', () => {
    const editor = createEditor()
    const build = (imageGen: boolean, mediaAnalysis: boolean, protection: AiDocProtection) =>
      createDocsSkill(
        () => editor,
        () => NUM_IDS,
        undefined,
        undefined,
        undefined,
        () => imageGen,
        undefined,
        undefined,
        undefined,
        undefined,
        () => mediaAnalysis,
        () => false,
        () => false,
        undefined,
        () => protection,
      )
    for (const kind of ['none', 'readOnly', 'comments', 'forms', 'trackedChanges'] as const) {
      const byok = build(true, true, kind)
      const uniwork = build(true, true, kind)
      expect(names(uniwork)).toEqual(names(byok))
      expect(uniwork.systemPrompt).toBe(byok.systemPrompt)
    }
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
    expect(skill.systemPrompt).not.toContain('this document is protected')
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

  it('edit="none" enforced stays unrestricted, like the app own reading', () => {
    expect(aiProtectionOf(on('none'), false)).toBe('none')
  })

  it('an enforced restriction of an unknown kind is treated as read only', () => {
    expect(aiProtectionOf(on('somethingNew'), false)).toBe('readOnly')
  })
})

describe('forced AI tracking', () => {
  it('tracked-changes protection forces the AI author even with the toggle off', () => {
    expect(aiTracksChanges(false, 'trackedChanges')).toBe(true)
    expect(aiTrackFor(false, 'trackedChanges', 'AI Assistant')).toEqual({ author: 'AI Assistant' })
  })

  it('without protection the panel toggle decides', () => {
    expect(aiTracksChanges(true, 'none')).toBe(true)
    expect(aiTrackFor(true, 'none', 'AI Assistant')).toEqual({ author: 'AI Assistant' })
    expect(aiTracksChanges(false, 'none')).toBe(false)
    expect(aiTrackFor(false, 'none', 'AI Assistant')).toBeUndefined()
  })

  it('other protections never turn tracking on by themselves', () => {
    for (const kind of ['readOnly', 'comments', 'forms'] as const) {
      expect(aiTracksChanges(false, kind)).toBe(false)
    }
  })
})
