// G8-14 fix r2 (visual findings V14-03, V14-12): the Review > New Comment tooltip tells the truth
// for a bound document (a server thread, not written to the pptx), and the Ask AI chip of a
// selected object stays inside the slide stage instead of covering the comments pane.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LANGS } from '@genoffice/i18n'

vi.mock('react-konva', () => {
  const stub = () => null
  return { Stage: stub, Layer: stub, Rect: stub, Group: stub, Line: stub, Text: stub, Image: stub }
})

import { Ribbon } from '../src/renderer/components/Ribbon'
import { AiAskTrigger } from '../src/renderer/components/AiAskPopover'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'
import { resetForTest } from '../src/renderer/capabilities'
import { ribbonStrings } from '../src/renderer/i18n/strings-ribbon'

const here = dirname(fileURLToPath(import.meta.url))

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

function mount(child: unknown): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  setModuleLang('en')
  act(() =>
    root!.render(createElement(LocaleProvider, { initial: 'en', children: child as never })),
  )
  return container
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
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
  vi.unstubAllGlobals()
})

function newCommentTip(el: HTMLElement): string {
  const tab = [...el.querySelectorAll('button.ribbon-tab')].find((b) => b.textContent === 'Review')
  if (!tab) throw new Error('no Review tab')
  act(() => (tab as HTMLButtonElement).click())
  const btn = [...el.querySelectorAll<HTMLButtonElement>('button.rb-big')].find(
    (b) => b.textContent === 'New Comment',
  )
  if (!btn) throw new Error('no New Comment button')
  return btn.getAttribute('data-tip') ?? ''
}

describe('V14-03: the New Comment tooltip', () => {
  it('a local file keeps the old tip (saved to the pptx)', () => {
    const el = mount(createElement(Ribbon as never, ribbonProps({}) as never))
    expect(newCommentTip(el)).toBe(ribbonStrings.en.ribbonNewCommentTip)
  })

  it('a bound document never promises the pptx or PowerPoint', () => {
    const el = mount(createElement(Ribbon as never, ribbonProps({ serverComments: true }) as never))
    const tip = newCommentTip(el)
    expect(tip).toBe(ribbonStrings.en.ribbonNewCommentServerTip)
    expect(tip).not.toMatch(/pptx|PowerPoint/i)
  })

  it('the server tip exists in all 21 locales, translated, without internal codes or the old promise', () => {
    expect(LANGS).toHaveLength(21)
    const en = ribbonStrings.en.ribbonNewCommentServerTip
    for (const lang of LANGS) {
      const tip = ribbonStrings[lang].ribbonNewCommentServerTip
      expect(tip, lang).toBeTruthy()
      if (lang !== 'en') expect(tip, lang).not.toBe(en)
      expect(tip, lang).not.toBe(ribbonStrings[lang].ribbonNewCommentTip)
      expect(tip, lang).not.toMatch(/G8|UNI-\d|git|pptx|PowerPoint/i)
    }
  })
})

describe('V14-12: the Ask AI chip stays inside the slide stage', () => {
  const rectAt = (right: number) => ({
    left: 100,
    top: 100,
    right,
    bottom: 200,
    viewTop: 50,
    viewBottom: 600,
    viewLeft: 0,
    viewRight: 800,
  })

  it('an object at the stage edge keeps the chip left of the comments pane', () => {
    // jsdom has no layout: the stage ends at x = 800, the comments pane starts there
    const el = mount(
      createElement(AiAskTrigger, { getAnchorRect: () => rectAt(790), onOpen: () => {} }),
    )
    const chip = el.querySelector<HTMLElement>('.ai-ask-trigger')!
    expect(chip).not.toBeNull()
    expect(parseFloat(chip.style.left)).toBeLessThanOrEqual(800 - chip.offsetWidth - 8)
  })

  it('V14-12: the stage shrinking under a placed chip (a reveal opens the pane) moves the chip back inside it', () => {
    // a recording ResizeObserver: the test fires the size change of the stage itself
    const observers: Array<{ cb: () => void; targets: Element[] }> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        entry = { cb: () => {}, targets: [] as Element[] }
        constructor(cb: () => void) {
          this.entry.cb = cb
          observers.push(this.entry)
        }
        observe(el: Element) {
          this.entry.targets.push(el)
        }
        disconnect() {
          this.entry.targets.length = 0
        }
      },
    )
    const stage = document.createElement('div')
    stage.className = 'stage-wrap'
    document.body.appendChild(stage)
    try {
      // the stage ends at x = 1000 when the chip is placed; the pane then opens and it ends at 700
      let viewRight = 1000
      const getAnchorRect = () => ({ ...rectAt(690), viewRight })
      const el = mount(createElement(AiAskTrigger, { getAnchorRect, onOpen: () => {} }))
      const chip = () => el.querySelector<HTMLElement>('.ai-ask-trigger')!
      expect(parseFloat(chip().style.left)).toBe(696)
      viewRight = 700
      act(() => {
        for (const o of observers) if (o.targets.includes(stage)) o.cb()
      })
      expect(parseFloat(chip().style.left)).toBeLessThanOrEqual(700 - chip().offsetWidth - 8)
    } finally {
      stage.remove()
    }
  })

  it('an object well inside the stage keeps the chip beside it', () => {
    const el = mount(
      createElement(AiAskTrigger, { getAnchorRect: () => rectAt(300), onOpen: () => {} }),
    )
    expect(parseFloat(el.querySelector<HTMLElement>('.ai-ask-trigger')!.style.left)).toBe(306)
  })
})
