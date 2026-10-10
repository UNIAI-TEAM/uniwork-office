// UniWork product rules for a slides document: a bound deck has no AutoSave toggle at all,
// and a view-only deck exposes no AI action that edits it (read-only AI stays available).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { RenderSlide } from '@genoffice/pptx-render'
import type { AgentToolCall } from '../src/shared/ipc'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'
import { resetForTest } from '../src/renderer/capabilities'

vi.mock('react-konva', () => {
  const stub = () => null
  return { Stage: stub, Layer: stub, Rect: stub, Group: stub, Line: stub, Text: stub, Image: stub }
})

import { Ribbon } from '../src/renderer/components/Ribbon'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import {
  READ_ONLY_TOOLS,
  createSlidesSkill,
  type DeckAccess,
} from '../src/renderer/ai/slides-skill'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'
import { strings } from '../src/renderer/i18n/strings'

const here = dirname(fileURLToPath(import.meta.url))
const NOTICE_EN =
  'View-only document: AI can read it and answer questions, but editing is turned off.'

/** every prop name Ribbon destructures, so the test renders it like App does */
function ribbonProps(overrides: Record<string, unknown>): Record<string, unknown> {
  const src = readFileSync(join(here, '../src/renderer/components/Ribbon.tsx'), 'utf8')
  const head = src.slice(src.indexOf('export function Ribbon({'), src.indexOf('}: Props) {'))
  const names = [...head.matchAll(/^ {2}([A-Za-z0-9]+),?$/gm)].map((m) => m[1]!)
  const props: Record<string, unknown> = {}
  for (const n of names) props[n] = /^on[A-Z]/.test(n) ? vi.fn() : undefined
  return {
    ...props,
    hasDoc: true,
    deckEmpty: false,
    dirty: false,
    zoom: 1,
    selectedIds: [],
    collapsedGroups: [],
    autoSave: false,
    showThumbs: true,
    canUndo: true,
    canRedo: true,
    ...overrides,
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

function mountRibbon(overrides: Record<string, unknown>): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  setModuleLang('en')
  act(() =>
    root!.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(Ribbon as never, ribbonProps(overrides) as never),
      }),
    ),
  )
  return container
}

function clickTab(el: HTMLElement, label: string): void {
  const tab = [...el.querySelectorAll('button.ribbon-tab')].find((b) => b.textContent === label)
  if (!tab) throw new Error(`no ${label} tab`)
  act(() => (tab as HTMLButtonElement).click())
}

beforeEach(() => {
  localStorage.clear()
  // a preload stand-in: on* -> disposer, every other member a promise-returning no-op
  ;(window as unknown as { slidesApi?: unknown }).slidesApi = new Proxy(
    {},
    {
      get: (_obj, key: string) =>
        key === 'capabilities'
          ? undefined
          : key.startsWith('on')
            ? () => () => {}
            : () => Promise.resolve(undefined),
    },
  )
  resetForTest()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
})

describe('AutoSave toggle (slides)', () => {
  it('a plain local deck shows it', () => {
    const el = mountRibbon({})
    expect(el.querySelector('.autosave-toggle')).not.toBeNull()
  })

  it('a UniWork-bound deck shows no AutoSave toggle at all', () => {
    const el = mountRibbon({ uniworkBound: true })
    expect(el.querySelector('.autosave-toggle')).toBeNull()
  })

  it('a view-only UniWork deck shows no AutoSave toggle either', () => {
    const el = mountRibbon({ uniworkBound: true, uniworkReadOnly: true })
    expect(el.querySelector('.autosave-toggle')).toBeNull()
  })
})

describe('Ribbon AI actions of a view-only deck', () => {
  const editEntries = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLButtonElement>('button.ai-entry')].filter(
      (b) => !b.getAttribute('data-tip')?.startsWith('Open AI'),
    )

  it('an editable deck has the AI edit entries enabled', () => {
    const el = mountRibbon({})
    const entries = editEntries(el)
    expect(entries.length).toBeGreaterThanOrEqual(3)
    expect(entries.every((b) => !b.disabled)).toBe(true)
  })

  it('a view-only deck turns every AI edit entry off and gives the reason', () => {
    const el = mountRibbon({ uniworkBound: true, uniworkReadOnly: true })
    const entries = editEntries(el)
    expect(entries.length).toBeGreaterThanOrEqual(3)
    for (const b of entries) {
      expect(b.disabled).toBe(true)
      expect(b.getAttribute('data-tip')).toBe(NOTICE_EN)
    }
    // opening the assistant (ask / summarize) stays available
    const open = el.querySelector<HTMLButtonElement>(
      'button.ai-entry[data-tip="Open AI assistant"]',
    )
    expect(open).not.toBeNull()
    expect(open!.disabled).toBe(false)
  })

  it('Review > spell check and translate are off for a view-only deck', () => {
    const el = mountRibbon({ uniworkBound: true, uniworkReadOnly: true })
    clickTab(el, 'Review')
    const aiButtons = [...el.querySelectorAll<HTMLButtonElement>('button.rb-big')].filter((b) =>
      b.querySelector('.ai-feature-icon'),
    )
    expect(aiButtons.length).toBeGreaterThanOrEqual(2)
    for (const b of aiButtons) {
      expect(b.disabled).toBe(true)
      expect(b.getAttribute('data-tip')).toBe(NOTICE_EN)
    }
  })
})

const page = { widthPx: 1280, heightPx: 720, nodes: [] } as unknown as RenderSlide

function mkAccess(overrides: Partial<DeckAccess> = {}): DeckAccess & {
  applyDeck: ReturnType<typeof vi.fn>
  applySlide: ReturnType<typeof vi.fn>
} {
  return {
    getSlides: () => [page],
    getCurrent: () => 0,
    getSelectedIds: () => [],
    applySlide: vi.fn(),
    applyDeck: vi.fn(),
    fitWidthPx: 1280,
    ...overrides,
  } as unknown as DeckAccess & {
    applyDeck: ReturnType<typeof vi.fn>
    applySlide: ReturnType<typeof vi.fn>
  }
}

const call = (name: string, input: Record<string, unknown> = {}): AgentToolCall => ({
  id: 't',
  name,
  input,
})

describe('AI skill of a view-only deck', () => {
  it('an editable deck keeps the editing tools', () => {
    const names = createSlidesSkill(mkAccess()).tools.map((t) => t.name)
    expect(names).toContain('execute_slide_script')
    expect(names).toContain('generate_deck')
    expect(names).toContain('regenerate_slide')
  })

  it('a view-only deck offers read-only tools only', () => {
    const skill = createSlidesSkill(mkAccess({ readOnly: () => true }))
    const names = skill.tools.map((t) => t.name)
    expect(names).toContain('read_slide')
    expect(names.every((n) => READ_ONLY_TOOLS.has(n))).toBe(true)
    for (const editing of [
      'execute_slide_script',
      'apply_ops',
      'generate_deck',
      'plan_deck',
      'regenerate_slide',
      'edit_chart',
      'insert_web_image',
      'replace_image',
      'generate_image',
      'save_style_template',
    ]) {
      expect(names).not.toContain(editing)
    }
    expect(skill.systemPrompt).toContain('view-only')
  })

  it('the tool list follows the live predicate', () => {
    let readOnly = false
    const skill = createSlidesSkill(mkAccess({ readOnly: () => readOnly }))
    expect(skill.tools.map((t) => t.name)).toContain('execute_slide_script')
    readOnly = true
    expect(skill.tools.map((t) => t.name)).not.toContain('execute_slide_script')
  })

  it('the executor refuses an editing tool a model still asks for, and changes nothing', async () => {
    const access = mkAccess({ readOnly: () => true })
    const skill = createSlidesSkill(access)
    for (const name of ['execute_slide_script', 'apply_ops', 'generate_deck', 'regenerate_slide']) {
      const r = await skill.executeTool!(call(name, { slideIndex: 0 }))
      expect(r.isError, name).toBe(true)
      expect(r.mutated, name).toBe(false)
    }
    expect(access.applyDeck).not.toHaveBeenCalled()
    expect(access.applySlide).not.toHaveBeenCalled()
  })

  it('read_slide still runs on a view-only deck', async () => {
    const skill = createSlidesSkill(mkAccess({ readOnly: () => true }))
    const r = await skill.executeTool!(call('read_slide', { slideIndex: 0 }))
    expect(r.isError).not.toBe(true)
  })
})

describe('AI panel of a view-only deck', () => {
  const settings: AiSettings = {
    provider: 'anthropic',
    providers: Object.fromEntries(
      AI_PROVIDERS.map((p) => [p.id, { apiKey: '', model: p.defaultModel }]),
    ) as AiSettings['providers'],
  }
  const props = (extra: Record<string, unknown>) => ({
    slides: [],
    current: 0,
    selectedIds: [],
    images: new Map<string, HTMLImageElement>(),
    applySlide: () => {},
    applyDeck: () => {},
    fitWidthPx: 960,
    settings,
    open: true,
    onExpand: () => {},
    onCollapse: () => {},
    ...extra,
  })

  beforeAll(() => {
    Element.prototype.scrollTo ??= () => {}
  })

  it('shows the reason and no edit starters; an editable deck shows starters and no reason', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root!.render(createElement(AiPanel as never, props({ readOnly: true }) as never)))
    expect(container.querySelector('.ai-attach-notice')?.textContent).toBeTruthy()
    expect(container.querySelectorAll('.ai-starter').length).toBe(0)
    expect(container.querySelector('.ai-tpl-gallery')).toBeNull()

    act(() => root!.render(createElement(AiPanel as never, props({}) as never)))
    expect(container.querySelector('.ai-attach-notice')).toBeNull()
    expect(container.querySelectorAll('.ai-starter').length).toBeGreaterThan(0)
  })
})

describe('view-only notice copy', () => {
  type Dict = Record<string, string>
  const dicts = strings as unknown as Record<string, Dict>

  it('is English in en and Vietnamese in vi', () => {
    expect(dicts.en!.aiViewOnlyNotice).toBe(NOTICE_EN)
    expect(dicts.vi!.aiViewOnlyNotice).toBe(
      'Tài liệu chỉ xem: AI có thể đọc và trả lời câu hỏi, nhưng không thể chỉnh sửa.',
    )
  })

  it('is translated in every shipped locale, not the English fallback', () => {
    const untranslated = Object.entries(dicts)
      .filter(([lang]) => lang !== 'en')
      .filter(([, dict]) => !dict.aiViewOnlyNotice || dict.aiViewOnlyNotice === NOTICE_EN)
      .map(([lang]) => lang)
    expect(untranslated).toEqual([])
  })
})
