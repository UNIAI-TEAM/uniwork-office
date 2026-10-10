import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { AiPanel, type HtmlAiDeps } from '../src/renderer/ai/AiPanel'
import { createDocumentSkill } from '../src/renderer/ai/html-skill'
import { AGENT_TOOLS, READ_ONLY_TOOLS, type HtmlDocAccess } from '../src/renderer/ai/tools'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { strings } from '../src/renderer/i18n/strings'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

/** the renderer bridge: every `on…` subscribes to nothing, every call resolves to undefined */
function stubHtmlApi(): void {
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
  vi.stubGlobal(
    'htmlApi',
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
}

const DOC = '<!doctype html>\n<html><body><h1>Quarterly</h1><p>Revenue</p></body></html>'

function fakeAccess() {
  let text = DOC
  const map = buildParseMap(text, 1, null)
  const access: HtmlDocAccess = {
    getText: () => text,
    getVersion: () => 1,
    getMap: () => map,
    getLastManualVersion: () => 0,
    getFilePath: () => '/tmp/page.html',
    getSelectedSid: () => null,
    applyOps: () => {
      text = 'changed'
      return { ok: true, ranges: [] }
    },
    replaceAll: (html) => {
      text = html
    },
  }
  return { access, text: () => text }
}

const call = (name: string, input: Record<string, unknown> = {}) => ({ id: 't1', name, input })

describe('view-only skill (UniWork copy the user may only read)', () => {
  const EDIT_TOOLS = AGENT_TOOLS.map((t) => t.name).filter((n) => !READ_ONLY_TOOLS.has(n))

  it('exposes only the reading tools', () => {
    const skill = createDocumentSkill(fakeAccess().access, () => true)
    expect(skill.tools.map((t) => t.name).sort()).toEqual([...READ_ONLY_TOOLS].sort())
    expect(EDIT_TOOLS).toEqual(
      expect.arrayContaining(['apply_ops', 'plan_page', 'write_document', 'ask_clarification']),
    )
  })

  it('tells the model the document is view-only', () => {
    expect(createDocumentSkill(fakeAccess().access, () => true).systemPrompt).toContain('view-only')
  })

  it('keeps the full catalogue on an editable document', () => {
    const skill = createDocumentSkill(fakeAccess().access, () => false)
    expect(skill.tools.map((t) => t.name)).toEqual(AGENT_TOOLS.map((t) => t.name))
    expect(skill.systemPrompt).not.toContain('view-only')
    expect(createDocumentSkill(fakeAccess().access).tools.length).toBe(AGENT_TOOLS.length)
  })

  it('refuses every editing tool and leaves the document untouched', async () => {
    const { access, text } = fakeAccess()
    const skill = createDocumentSkill(access, () => true)
    for (const name of EDIT_TOOLS) {
      const result = await skill.executeTool(
        call(name, { ops: [{ op: 'remove', sid: 1 }], html: '<p>x</p>', questions: [] }),
      )
      expect(result.isError, name).toBe(true)
      expect(result.output, name).toContain('view-only')
    }
    expect(text()).toBe(DOC)
  })

  it('still runs the reading tools', async () => {
    const skill = createDocumentSkill(fakeAccess().access, () => true)
    const result = await skill.executeTool(call('get_outline'))
    expect(result.isError).toBeFalsy()
  })

  it('reads the predicate live: lifting view-only restores editing', () => {
    let readOnly = true
    const skill = createDocumentSkill(fakeAccess().access, () => readOnly)
    expect(skill.tools.length).toBe(READ_ONLY_TOOLS.size)
    readOnly = false
    expect(skill.tools.length).toBe(AGENT_TOOLS.length)
  })
})

function renderRibbon(extra: { uniworkBound?: boolean; readOnly?: boolean; autoSave?: boolean }) {
  stubHtmlApi()
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
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    view: 'preview' as const,
    onView: vi.fn(),
    canInsert: true,
    onInsert: vi.fn(),
    canvasMode: 'edit' as const,
    onPresent: vi.fn(),
    ...extra,
  }
  act(() =>
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(Ribbon, props))),
  )
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
  const label = (b: HTMLButtonElement) => b.textContent?.trim()

  it('keeps summarize and turns the editing presets off with the reason as tooltip', () => {
    const buttons = aiButtons(renderRibbon({ uniworkBound: true, readOnly: true }))
    const summarize = buttons.find((b) => label(b) === strings.en.aiSummarizeBtn)!
    expect(summarize.disabled).toBe(false)
    const editing = buttons.filter((b) => b !== summarize)
    expect(editing.length).toBe(2)
    for (const b of editing) {
      expect(b.disabled).toBe(true)
      expect(b.getAttribute('data-tip')).toBe(strings.en.aiViewOnlyNotice)
    }
  })

  it('leaves every preset on for an editable copy', () => {
    for (const b of aiButtons(renderRibbon({ uniworkBound: true }))) expect(b.disabled).toBe(false)
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
    stubHtmlApi()
    const deps = {
      access: fakeAccess().access,
      getSnapshot: () => ({}),
      restoreSnapshot: () => {},
      onPrompt: () => {},
      onRunDone: () => {},
      clearHighlights: () => {},
      navigateTo: () => {},
      onBriefConfirmed: () => {},
      previewDraft: () => {},
    } as unknown as HtmlAiDeps
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const item = { qid: 'q1', sid: 1, tag: 'h1', capturedText: 'Quarterly', instruction: 'shorten' }
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
            editQueue: queued ? [item] : [],
            onQueueEditInstruction: () => {},
            onQueueRemove: () => {},
            onQueueClear: () => {},
            onQueueFocus: () => {},
            onQueueConsume: () => {},
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
