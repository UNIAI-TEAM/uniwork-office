import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { AiPanel, type MarkdownAiDeps } from '../src/renderer/ai/AiPanel'
import { createMarkdownSkill, READ_ONLY_TOOLS } from '../src/renderer/ai/markdown-skill'
import { AGENT_TOOLS } from '../src/renderer/ai/tools'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { strings } from '../src/renderer/i18n/strings'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
const editors: Editor[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  for (const e of editors.splice(0)) e.destroy()
  vi.unstubAllGlobals()
})

function createEditor(md = 'Saved document'): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: `<p>${md}</p>`,
  })
  editors.push(editor)
  return editor
}

const call = (name: string, input: Record<string, unknown> = {}) => ({ id: 't1', name, input })

describe('view-only skill (UniWork copy the user may only read)', () => {
  const EDIT_TOOLS = AGENT_TOOLS.map((t) => t.name).filter((n) => !READ_ONLY_TOOLS.has(n))

  it('exposes only the reading tools', () => {
    const skill = createMarkdownSkill(
      () => null,
      undefined,
      undefined,
      undefined,
      () => true,
    )
    const names = skill.tools.map((t) => t.name)
    expect([...names].sort()).toEqual([...READ_ONLY_TOOLS].sort())
    // every writing tool of the catalogue is gone
    for (const name of ['apply_ops', 'write_document', 'insert_image', 'generate_image']) {
      expect(names).not.toContain(name)
    }
    expect(EDIT_TOOLS).toContain('apply_ops')
  })

  it('tells the model the document is view-only', () => {
    const skill = createMarkdownSkill(
      () => null,
      undefined,
      undefined,
      undefined,
      () => true,
    )
    expect(skill.systemPrompt).toContain('view-only')
  })

  it('keeps the full catalogue on an editable document', () => {
    const skill = createMarkdownSkill(
      () => null,
      undefined,
      undefined,
      undefined,
      () => false,
    )
    expect(skill.tools.map((t) => t.name)).toEqual(AGENT_TOOLS.map((t) => t.name))
    expect(skill.systemPrompt).not.toContain('view-only')
  })

  it('refuses every editing tool and leaves the document untouched', async () => {
    const editor = createEditor()
    const skill = createMarkdownSkill(
      () => editor,
      undefined,
      undefined,
      undefined,
      () => true,
    )
    const before = editor.getHTML()
    for (const name of EDIT_TOOLS) {
      const result = await skill.executeTool(call(name, { ops: [], markdown: 'x' }))
      expect(result.isError, name).toBe(true)
      expect(result.output, name).toContain('view-only')
    }
    expect(editor.getHTML()).toBe(before)
  })

  it('still runs the reading tools', async () => {
    const editor = createEditor()
    const skill = createMarkdownSkill(
      () => editor,
      undefined,
      undefined,
      undefined,
      () => true,
    )
    const result = await skill.executeTool(call('get_document_context'))
    expect(result.isError).toBeFalsy()
  })

  it('reads the predicate live: lifting view-only restores editing', () => {
    let readOnly = true
    const skill = createMarkdownSkill(
      () => null,
      undefined,
      undefined,
      undefined,
      () => readOnly,
    )
    expect(skill.tools.length).toBe(READ_ONLY_TOOLS.size)
    readOnly = false
    expect(skill.tools.length).toBeGreaterThan(READ_ONLY_TOOLS.size)
  })
})

function renderRibbon(extra: { uniworkBound?: boolean; readOnly?: boolean; autoSave?: boolean }) {
  const editor = createEditor()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const props = {
    disabled: false,
    dirty: false,
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onFind: vi.fn(),
    autoSave: extra.autoSave ?? false,
    onToggleAutoSave: vi.fn(),
    aiOpen: false,
    onToggleAi: vi.fn(),
    onAiPreset: vi.fn(),
    editor,
    imageEnabled: true,
    onInsertImage: vi.fn(),
    frontmatterOpen: false,
    onToggleFrontmatter: vi.fn(),
    outlineOpen: false,
    onToggleOutline: vi.fn(),
    hasOutline: false,
    ...extra,
  }
  act(() => root.render(createElement(Ribbon, props)))
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container
}

describe('Ribbon AutoSave switch', () => {
  it('shows it for a local file', () => {
    expect(renderRibbon({ autoSave: true }).querySelector('.autosave-toggle')).not.toBeNull()
  })
  it('hides it for a UniWork copy, editable or view-only', () => {
    expect(renderRibbon({ uniworkBound: true }).querySelector('.autosave-toggle')).toBeNull()
    expect(
      renderRibbon({ uniworkBound: true, readOnly: true }).querySelector('.autosave-toggle'),
    ).toBeNull()
  })
})

describe('Ribbon AI buttons on a view-only copy', () => {
  const aiButtons = (c: HTMLElement) =>
    [...c.querySelectorAll<HTMLButtonElement>('button.ai-entry')].slice(1)

  it('keeps summarize and turns the editing presets off with the reason as tooltip', () => {
    const c = renderRibbon({ uniworkBound: true, readOnly: true })
    const [summarize, polish, tidy] = aiButtons(c)
    expect(summarize!.disabled).toBe(false)
    expect(polish!.disabled).toBe(true)
    expect(tidy!.disabled).toBe(true)
    // the ribbon renders in zh by default
    expect(polish!.getAttribute('data-tip')).toBe(strings.zh.aiViewOnlyNotice)
    expect(tidy!.getAttribute('data-tip')).toBe(strings.zh.aiViewOnlyNotice)
  })

  it('leaves every preset on for an editable copy', () => {
    const c = renderRibbon({ uniworkBound: true })
    for (const b of aiButtons(c)) expect(b.disabled).toBe(false)
  })
})

describe('view-only notice copy', () => {
  it('is real text in English and Vietnamese', () => {
    expect(strings.en.aiViewOnlyNotice).toBe(
      'View-only document: AI can read it and answer questions, but editing is turned off.',
    )
    expect(strings.vi.aiViewOnlyNotice).toContain('chỉ xem')
  })
  it('exists in every locale and is translated outside English', () => {
    for (const [lang, dict] of Object.entries(strings)) {
      const value = (dict as Record<string, string>).aiViewOnlyNotice
      expect(value, lang).toBeTruthy()
      if (lang !== 'en') expect(value, lang).not.toBe(strings.en.aiViewOnlyNotice)
    }
  })
})

describe('AiPanel on a view-only copy', () => {
  async function mountPanel(readOnly: boolean, queued: boolean) {
    // jsdom has no scrollTo on elements; the test environment's localStorage has no methods
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
    const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
    vi.stubGlobal(
      'markdownApi',
      new Proxy(stubs, {
        get(target, prop: string) {
          if (!(prop in target)) {
            target[prop] = /^on[A-Z]/.test(prop)
              ? vi.fn(() => () => {})
              : vi.fn(async () => undefined)
          }
          return target[prop]
        },
      }),
    )
    const editor = createEditor()
    const deps = {
      getEditor: () => editor,
      getFrontmatter: () => '',
      setFrontmatter: () => {},
      getSnapshot: () => ({}),
      restoreSnapshot: () => {},
      onRunDone: () => {},
    } as unknown as MarkdownAiDeps
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const item = { qid: 'q1', instruction: 'shorten', anchor: { from: 1, to: 5 } }
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(AiPanel, {
            deps,
            filePath: null,
            onCollapse: () => {},
            readOnly,
            editQueue: queued ? [item as never] : [],
          }),
        ),
      )
    })
    cleanups.push(() => {
      act(() => root.unmount())
      container.remove()
    })
    return container
  }

  it('shows the notice and no edit queue', async () => {
    const c = await mountPanel(true, true)
    expect(c.querySelector('.ai-readonly-notice')?.textContent).toBe(strings.en.aiViewOnlyNotice)
    expect(c.querySelector('.ai-queue')).toBeNull()
  })

  it('shows no notice and keeps the edit queue on an editable copy', async () => {
    const c = await mountPanel(false, true)
    expect(c.querySelector('.ai-readonly-notice')).toBeNull()
    expect(c.querySelector('.ai-queue')).not.toBeNull()
  })
})
