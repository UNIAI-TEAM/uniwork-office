/**
 * G6-12 #27 (spec §6.3 (c)), renderer wiring: App `uniwork.bound` -> AiPanel `uniworkBound`
 * prop -> ref -> `DeckAccess.uniworkBound`, the predicate the skill reads before writing
 * the `.styleskill.json` sidecar. Renders the real AiPanel and reads the access it hands to
 * the real skill factory. Dropping the prop, or feeding it `readOnly`, turns these red.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({
  accesses: [] as Array<import('../src/renderer/ai/slides-skill').DeckAccess>,
}))

vi.mock('../src/renderer/ai/slides-skill', async () => {
  const actual = await vi.importActual<typeof import('../src/renderer/ai/slides-skill')>(
    '../src/renderer/ai/slides-skill',
  )
  return {
    ...actual,
    createSlidesSkill: (access: import('../src/renderer/ai/slides-skill').DeckAccess) => {
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
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'

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

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
})

beforeEach(() => {
  localStorage.clear()
  seen.accesses.length = 0
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

describe('AiPanel uniworkBound prop reaches the skill access', () => {
  it('a bound deck: the skill sees uniworkBound() === true', () => {
    render({ uniworkBound: true })
    expect(seen.accesses.length).toBeGreaterThan(0)
    expect(access().uniworkBound?.()).toBe(true)
  })

  it('a local deck: the skill sees uniworkBound() === false', () => {
    render({})
    expect(access().uniworkBound?.()).toBe(false)
  })

  it('bound and view-only are separate: readOnly alone does not mark the deck bound', () => {
    render({ readOnly: true })
    expect(access().uniworkBound?.()).toBe(false)
    expect(access().readOnly?.()).toBe(true)
  })

  it('bound but editable: readOnly stays false while uniworkBound is true', () => {
    render({ uniworkBound: true, readOnly: false })
    expect(access().uniworkBound?.()).toBe(true)
    expect(access().readOnly?.()).toBe(false)
  })

  it('follows the live prop (a deck opened or unbound while the panel stays mounted)', () => {
    render({ uniworkBound: false })
    const a = access()
    expect(a.uniworkBound?.()).toBe(false)
    render({ uniworkBound: true })
    expect(access().uniworkBound?.()).toBe(true)
    render({ uniworkBound: false })
    expect(access().uniworkBound?.()).toBe(false)
    expect(a.uniworkBound?.()).toBe(false)
  })
})

describe('App passes its UniWork binding to the AI panel', () => {
  // App is too heavy to mount here, so read the one JSX element like Ribbon's props are read
  it('<AiPanel> gets uniworkBound from uniwork.bound, not from readOnly', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/App.tsx'),
      'utf8',
    )
    const start = src.indexOf('<AiPanel')
    expect(start).toBeGreaterThan(-1)
    const element = src.slice(start, src.indexOf('/>', start))
    expect(element).toMatch(/uniworkBound=\{uniwork\.bound\}/)
    expect(element).toMatch(/readOnly=\{uniwork\.readOnly\}/)
  })
})
