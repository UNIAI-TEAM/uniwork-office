/**
 * UNI-1919 (w2): a deck open in the web frame IS the UniWork document, so the
 * AI must see it as bound even though the web adapter keeps answering
 * `uniworkState.bound: false` (working-copy semantics: web save, autosave and
 * the ribbon Save button are keyed off that answer and must not change). The
 * seam is the shared rule `uniworkBoundForAi(bound, platform())`, applied where
 * AiPanel builds `DeckAccess.uniworkBound`; the `.styleskill.json` sidecar next
 * to the file is the bound-only write it gates (slides-skill.ts).
 * Renders the real AiPanel and reads the access it hands to the real skill.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeckAccess } from '../src/renderer/ai/slides-skill'

const seen = vi.hoisted(() => ({
  accesses: [] as DeckAccess[],
}))

vi.mock('../src/renderer/ai/slides-skill', async () => {
  const actual = await vi.importActual<typeof import('../src/renderer/ai/slides-skill')>(
    '../src/renderer/ai/slides-skill',
  )
  return {
    ...actual,
    createSlidesSkill: (access: DeckAccess) => {
      seen.accesses.push(access)
      return actual.createSlidesSkill(access)
    },
  }
})

vi.mock('react-konva', () => {
  const stub = () => null
  return { Stage: stub, Layer: stub, Rect: stub, Group: stub, Line: stub, Text: stub, Image: stub }
})

import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'
import { resetForTest } from '../src/renderer/capabilities'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { createSlidesSkill } from '../src/renderer/ai/slides-skill'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'
import type { AgentToolCall } from '../src/shared/ipc'

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

let root: Root | null = null
let container: HTMLElement | null = null

function render(extra: Record<string, unknown>): void {
  act(() =>
    root!.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(AiPanel as never, props(extra) as never),
      }),
    ),
  )
}

/** the access the skill of the most recently built loop reads */
const access = () => seen.accesses.at(-1)!

/**
 * `window.slidesApi` like the harness installs it; `caps === undefined` is the
 * desktop (the web bridge assigns { platform: 'web' } before the renderer runs).
 */
function installSlidesApi(
  caps: Record<string, unknown> | undefined,
  members: Record<string, unknown> = {},
) {
  ;(window as unknown as { slidesApi?: unknown }).slidesApi = new Proxy(
    {},
    {
      get: (_obj, key: string) =>
        key in members
          ? members[key]
          : key === 'capabilities'
            ? caps
            : key === 'uniworkState'
              ? async () => ({ bound: false, readOnly: false })
              : key === 'getAiSettings'
                ? async () => settings
                : key.startsWith('on')
                  ? () => () => {}
                  : () => Promise.resolve(undefined),
    },
  )
  resetForTest()
}

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  localStorage.clear()
  seen.accesses.length = 0
  installSlidesApi(undefined)
  setModuleLang('en')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
})

/** the web adapter's answer for an editable frame — must reach save consumers verbatim */
const WEB_EDITABLE = { bound: false, readOnly: false }

/** the UniWork AI selection: the provider switch is the whole signal DeckAccess.uniworkAi reads */
const uniworkSettings: AiSettings = { ...settings, provider: 'uniwork' }

/** tools a web-frame UniWork AI turn never sees (signed policy; slides-skill UNIWORK_AI_HIDDEN_TOOLS) */
const UNIWORK_AI_HIDDEN = ['insert_web_image', 'replace_image', 'save_style_template']

/**
 * deck generation runs under UniWork AI in the web frame (UNI-2276: pages via the writer route);
 * the desktop refuses writer calls and keeps it hidden
 */
const UNIWORK_AI_DECK_TOOLS = ['generate_deck', 'regenerate_slide']

const deckCall: AgentToolCall = {
  id: 'c-deck',
  name: 'generate_deck',
  input: {
    core_hook: 'Doubled in a decade',
    style: 'Deep navy + gold',
    pages: [
      { title: 'One', brief: 'b1', layout: 'data' },
      { title: 'Two', brief: 'b2', layout: 'data' },
    ],
  },
}

/** the wired access with the page-writer seams stubbed, so generate_deck lands pages */
function deckRun(base: DeckAccess) {
  const sidecars: unknown[] = []
  let pages = 0
  const run: DeckAccess = {
    ...base,
    landGeneratedPages: async (markers, mode = 'replace') => {
      if (mode === 'append') {
        const from = pages
        pages += markers.length
        return { ok: true, pages, appendedFrom: from }
      }
      pages = markers.length
      return { ok: true, pages }
    },
    isCloudPageGenEnabled: async () => false,
    generatePageLocal: async (args) => ({ ok: true, marker: `localpptx:PAGE${args.pageIndex}` }),
    generateStyleSkill: async (a) => ({ ok: true, styleSkill: 'STYLE_FOR:' + a.topic }),
    saveSidecar: async (data) => {
      sidecars.push(data)
    },
  }
  return { run, sidecars, getPages: () => pages }
}

describe('the web slides frame is UniWork-bound for the AI', () => {
  it('the skill predicate reads bound with the adapter still answering bound: false', async () => {
    installSlidesApi({ platform: 'web' })
    render({ uniworkBound: WEB_EDITABLE.bound })
    expect(seen.accesses.length).toBeGreaterThan(0)
    expect(access().uniworkBound?.()).toBe(true)
  })

  it('feeds the provider through uniworkAi so a UniWork AI turn loses the three hidden tools', async () => {
    installSlidesApi({ platform: 'web' })
    render({ uniworkBound: WEB_EDITABLE.bound, settings: uniworkSettings })
    // RPB-1: the whole shape the skill reads — provider 'uniwork' must reach uniworkAi(),
    // or the hidden tools are offered to a UniWork AI turn (the G7-08 failure class)
    expect(access().uniworkAi?.()).toBe(true)
    let names = createSlidesSkill(access()).tools.map((t) => t.name)
    for (const n of UNIWORK_AI_HIDDEN) expect(names, n).not.toContain(n)
    for (const n of UNIWORK_AI_DECK_TOOLS) expect(names, n).toContain(n)
    expect(names).toContain('apply_ops')
    expect(createSlidesSkill(access()).systemPrompt).not.toContain('generate_deck is unavailable')

    render({ uniworkBound: WEB_EDITABLE.bound })
    expect(access().uniworkAi?.()).toBe(false)
    names = createSlidesSkill(access()).tools.map((t) => t.name)
    for (const n of UNIWORK_AI_HIDDEN) expect(names, n).toContain(n)
  })

  it('a desktop UniWork AI turn keeps the deck tools hidden and the "unavailable" sentence', async () => {
    installSlidesApi(undefined)
    render({ uniworkBound: true, settings: uniworkSettings })
    expect(access().uniworkAi?.()).toBe(true)
    const skill = createSlidesSkill(access())
    const names = skill.tools.map((t) => t.name)
    for (const n of [...UNIWORK_AI_HIDDEN, ...UNIWORK_AI_DECK_TOOLS])
      expect(names, n).not.toContain(n)
    expect(skill.systemPrompt).toContain('generate_deck is unavailable')
  })

  it('a bound-web deck writes no .styleskill.json sidecar even on a forced generate_deck', async () => {
    installSlidesApi({ platform: 'web' })
    render({ uniworkBound: WEB_EDITABLE.bound })
    const { run, sidecars } = deckRun(access())
    const res = (await createSlidesSkill(run).executeTool(deckCall)) as { isError?: boolean }
    expect(res.isError).toBeFalsy()
    expect(sidecars).toEqual([])
  })

  it('desktop keeps the adapter answer verbatim (unbound writes the sidecar, bound does not)', async () => {
    installSlidesApi(undefined)
    render({ uniworkBound: false })
    const local = deckRun(access())
    await createSlidesSkill(local.run).executeTool(deckCall)
    expect(local.sidecars).toHaveLength(1)

    render({ uniworkBound: true })
    const bound = deckRun(access())
    await createSlidesSkill(bound.run).executeTool(deckCall)
    expect(bound.sidecars).toEqual([])
  })
})

describe('the web save path is untouched', () => {
  it('the adapter’s bound answer still reaches its consumers unmodified', async () => {
    installSlidesApi({ platform: 'web' })
    render({ uniworkBound: WEB_EDITABLE.bound })
    // save()/autosave/the ribbon Save button keep seeing the unbound working copy…
    const api = window.slidesApi as { uniworkState: () => Promise<typeof WEB_EDITABLE> }
    expect(await api.uniworkState()).toEqual(WEB_EDITABLE)
    // …while the AI filter reads the same frame as bound
    expect(access().uniworkBound?.()).toBe(true)
  })
})

// R3 (UNI-2276): the panel's page generator hands generate_deck the writer refusal's code, so a
// used-up run ends the deck's page loop instead of being retried
describe('the panel page generator under UniWork AI', () => {
  it('turns a run_limit_reached writer refusal into code run_limit_reached, with no repair round', async () => {
    const handlers = new Set<(chunk: Record<string, unknown>) => void>()
    const aiStream = vi.fn(async (req: { requestId: string }) => {
      for (const h of [...handlers])
        h({
          requestId: req.requestId,
          type: 'error',
          error: 'the run is used up',
          uniworkCode: 'run_limit_reached',
        })
    })
    installSlidesApi(
      { platform: 'web' },
      {
        aiStream,
        onAiStream: (h: (chunk: Record<string, unknown>) => void) => {
          handlers.add(h)
          return () => handlers.delete(h)
        },
      },
    )
    render({ uniworkBound: WEB_EDITABLE.bound, settings: uniworkSettings })
    const r = await access().generatePageLocal!({
      pageIndex: 3,
      totalPages: 5,
      coreHook: 'Hook',
      style: 'Style',
      title: 'Revenue',
      brief: 'KPIs',
      layout: '',
      images: [],
      canvasW: 1280,
      canvasH: 720,
    })
    expect(r).toMatchObject({ ok: false, code: 'run_limit_reached', error: 'the run is used up' })
    expect(aiStream).toHaveBeenCalledTimes(1)
  })
})
