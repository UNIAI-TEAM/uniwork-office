// A UniWork document has no AutoSave switch, and a view-only one gives the AI
// no way to edit it: read-only tools only, no edit composer affordances.
import { beforeAll, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { READ_ONLY_TOOLS, createDocsSkill } from '../src/renderer/ai/docs-skill'
import { AGENT_TOOLS } from '../src/renderer/ai/tools'
import { autoSaveToggleVisible } from '../src/renderer/uniwork-doc-state'
import { strings } from '../src/renderer/i18n/strings'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'

const settings: AiSettings = {
  provider: 'anthropic',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: '', model: p.defaultModel }]),
  ) as AiSettings['providers'],
}

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

function renderPanel(editor: Editor, readOnly: boolean) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(AiPanel, {
        editor,
        blocks: [],
        settings,
        open: true,
        onExpand: () => {},
        onCollapse: () => {},
        readOnly,
      }),
    ),
  )
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
})

describe('AutoSave switch', () => {
  it('is hidden for a UniWork document, shown for a local file', () => {
    expect(autoSaveToggleVisible(true, true)).toBe(false)
    expect(autoSaveToggleVisible(true, false)).toBe(true)
  })

  it('stays hidden where the platform has no local path to autosave to', () => {
    expect(autoSaveToggleVisible(false, false)).toBe(false)
    expect(autoSaveToggleVisible(false, true)).toBe(false)
  })
})

describe('AI agent on a view-only document', () => {
  const NUM_IDS = { bullet: null, ordered: null }

  it('keeps only read-only tools', () => {
    const editor = createEditor()
    const skill = createDocsSkill(
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
      () => true,
    )
    const names = skill.tools.map((tool) => tool.name)
    expect(names).toContain('get_document_context')
    expect(names).toContain('read_blocks')
    expect(names.every((name) => READ_ONLY_TOOLS.has(name))).toBe(true)
    for (const editing of ['insert_content', 'replace_blocks', 'apply_ops', 'write_document']) {
      expect(names).not.toContain(editing)
    }
    expect(skill.systemPrompt).toContain('view-only')
    editor.destroy()
  })

  it('refuses an edit tool call and leaves the document untouched', async () => {
    const editor = createEditor()
    const before = JSON.stringify(editor.getJSON())
    const skill = createDocsSkill(
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
      () => true,
    )
    const exec = await skill.executeTool({
      id: 't1',
      name: 'insert_content',
      input: { html: '<p>injected</p>', position: 'end' },
    })
    expect(exec.isError).toBe(true)
    expect(exec.mutated).toBe(false)
    expect(exec.output).toContain('view-only')
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    editor.destroy()
  })

  it('keeps the full tool set on an editable document', () => {
    const editor = createEditor()
    const skill = createDocsSkill(
      () => editor,
      () => NUM_IDS,
    )
    expect(skill.tools.map((tool) => tool.name)).toContain('insert_content')
    expect(skill.systemPrompt).not.toContain('view-only')
    editor.destroy()
  })

  it('only allowlists tools that exist', () => {
    const all = new Set(AGENT_TOOLS.map((tool) => tool.name))
    for (const name of READ_ONLY_TOOLS) expect(all.has(name), name).toBe(true)
  })
})

describe('AI panel on a view-only document', () => {
  it('shows the reason, drops the track-changes toggle and the edit starters', () => {
    const editor = createEditor()
    const { container, cleanup } = renderPanel(editor, true)
    expect(container.querySelector('.ai-viewonly-notice')).not.toBeNull()
    expect(container.querySelector('.ai-track-btn')).toBeNull()
    expect(container.querySelectorAll('.ai-starter').length).toBe(1)
    cleanup()
    editor.destroy()
  })

  it('keeps the edit affordances on an editable document', () => {
    const editor = createEditor()
    const { container, cleanup } = renderPanel(editor, false)
    expect(container.querySelector('.ai-viewonly-notice')).toBeNull()
    expect(container.querySelector('.ai-track-btn')).not.toBeNull()
    expect(container.querySelectorAll('.ai-starter').length).toBeGreaterThan(1)
    cleanup()
    editor.destroy()
  })
})

describe('view-only AI notice strings', () => {
  const dicts = strings as unknown as Record<string, Record<string, string>>

  it('is English in en and Vietnamese in vi', () => {
    expect(dicts.en!.aiViewOnlyNotice).toContain('View-only')
    expect(dicts.vi!.aiViewOnlyNotice).toContain('chỉ xem')
  })

  it('is translated in every shipped locale', () => {
    const en = dicts.en!.aiViewOnlyNotice
    const missing = Object.entries(dicts)
      .filter(([lang]) => lang !== 'en')
      .filter(([, dict]) => !dict.aiViewOnlyNotice || dict.aiViewOnlyNotice === en)
      .map(([lang]) => lang)
    expect(missing).toEqual([])
  })
})
