/**
 * UNI-1919 (w2) / UNI-2309: the deck tools a UniWork AI turn sees in the web frame
 * and on the desktop. Renders the real AiPanel and reads the access it hands to the
 * real skill.
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

import type { AiSettings } from '../src/shared/ipc'
import { resetForTest } from '../src/renderer/capabilities'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { createSlidesSkill } from '../src/renderer/ai/slides-skill'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'
import type { AgentToolCall } from '../src/shared/ipc'

const settings: AiSettings = {
  provider: 'uniwork',
  providers: {},
}

const props = (extra: Record<string, unknown>) => ({
  slides: [],
  current: 0,
  selectedIds: [],
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

/** the UniWork AI selection; every turn runs on UniWork AI, whatever a legacy file names (UNI-2309) */
const uniworkSettings: AiSettings = { ...settings, provider: 'uniwork' }

/** tools a UniWork AI turn never sees (signed policy; slides-skill UNIWORK_AI_HIDDEN_TOOLS) */
const UNIWORK_AI_HIDDEN = ['insert_web_image', 'replace_image', 'save_style_template']

/** deck generation runs under UniWork AI, its pages via the writer route (UNI-2276, UNI-2326) */
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
  }
  return { run, getPages: () => pages }
}

describe('the deck tools of a UniWork AI turn, web frame and desktop', () => {
  it('feeds uniworkAi so a UniWork AI turn loses the three hidden tools', async () => {
    installSlidesApi({ platform: 'web' })
    render({ settings: uniworkSettings })
    // RPB-1: the whole shape the skill reads — uniworkAi() must answer true, or the hidden
    // tools are offered to a UniWork AI turn (the G7-08 failure class)
    expect(access().uniworkAi?.()).toBe(true)
    const names = createSlidesSkill(access()).tools.map((t) => t.name)
    for (const n of UNIWORK_AI_HIDDEN) expect(names, n).not.toContain(n)
    for (const n of UNIWORK_AI_DECK_TOOLS) expect(names, n).toContain(n)
    expect(names).toContain('apply_ops')
    expect(createSlidesSkill(access()).systemPrompt).not.toContain('generate_deck is unavailable')

    // a legacy settings file naming another provider still runs on UniWork AI, the one provider
    render({})
    expect(access().uniworkAi?.()).toBe(true)
    const legacy = createSlidesSkill(access()).tools.map((t) => t.name)
    for (const n of UNIWORK_AI_HIDDEN) expect(legacy, n).not.toContain(n)
  })

  it('a desktop UniWork AI turn is offered the deck tools too (UNI-2326)', async () => {
    installSlidesApi(undefined)
    render({ settings: uniworkSettings })
    expect(access().uniworkAi?.()).toBe(true)
    const skill = createSlidesSkill(access())
    const names = skill.tools.map((t) => t.name)
    for (const n of UNIWORK_AI_HIDDEN) expect(names, n).not.toContain(n)
    for (const n of UNIWORK_AI_DECK_TOOLS) expect(names, n).toContain(n)
    expect(skill.systemPrompt).not.toContain('generate_deck is unavailable')
  })

  it('a web deck runs a forced generate_deck and lands its pages', async () => {
    installSlidesApi({ platform: 'web' })
    render({})
    const { run, getPages } = deckRun(access())
    const res = (await createSlidesSkill(run).executeTool(deckCall)) as { isError?: boolean }
    expect(res.isError).toBeFalsy()
    expect(getPages()).toBe(2)
  })

  it('a desktop deck runs a forced generate_deck and lands its pages (UNI-2326)', async () => {
    installSlidesApi(undefined)
    render({})
    const { run, getPages } = deckRun(access())
    const res = (await createSlidesSkill(run).executeTool(deckCall)) as { isError?: boolean }
    expect(res.isError).toBeFalsy()
    expect(getPages()).toBe(2)
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
    render({ settings: uniworkSettings })
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
