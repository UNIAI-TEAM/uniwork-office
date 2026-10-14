/**
 * G8-14 (V14b-01): with the comments pane open in a narrow window the AI dock yields to the slide
 * stage, and gives the room back when the pane closes or the window widens. Pure rule first, then
 * the real App at 900 and 1440 px (jsdom has no layout, so the stage width is the layout formula
 * the rule is built on; the real width is measured in the browser visual stage).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  aiDockShouldYield,
  AI_DOCK_PX,
  COMMENTS_PANE_PX,
  MIN_STAGE_PX,
  stageWidthWithDock,
} from '../src/renderer/narrow-dock'

// react-konva's node entry requires the native 'canvas' package; nothing here draws
vi.mock('react-konva', () => {
  const stub = () => null
  return {
    Stage: stub,
    Layer: stub,
    Rect: stub,
    Group: stub,
    Transformer: stub,
    Line: stub,
    Arrow: stub,
    Text: stub,
    Ellipse: stub,
    Image: stub,
    Path: stub,
    Circle: stub,
    Arc: stub,
  }
})
// the panel itself is not under test: a rail when closed, a body when open, like the real one
vi.mock('../src/renderer/ai/AiPanel', async () => {
  const { createElement: h } = await import('react')
  return {
    AiPanel: (p: { open: boolean; onExpand: () => void; onCollapse: () => void }) =>
      p.open
        ? h('button', { className: 'ai-body', onClick: p.onCollapse })
        : h('button', { className: 'ai-rail', onClick: p.onExpand }),
  }
})

import { App } from '../src/renderer/App'

describe('aiDockShouldYield', () => {
  const base = { thumbsWidth: 120 }

  it('the stage the layout leaves is window - thumbnails - dock - pane', () => {
    expect(stageWidthWithDock({ paneOpen: true, windowWidth: 900, ...base })).toBe(
      900 - 120 - AI_DOCK_PX - COMMENTS_PANE_PX,
    )
    // the figure the visual stage measured at 900 px (~117 px, with the divider)
    expect(stageWidthWithDock({ paneOpen: true, windowWidth: 900, ...base })).toBeLessThan(150)
  })

  it('900 px: the pane open yields the dock, closed keeps it', () => {
    expect(aiDockShouldYield({ paneOpen: true, windowWidth: 900, ...base })).toBe(true)
    expect(aiDockShouldYield({ paneOpen: false, windowWidth: 900, ...base })).toBe(false)
  })

  it('1440 px: the dock stays with the pane open', () => {
    expect(aiDockShouldYield({ paneOpen: true, windowWidth: 1440, ...base })).toBe(false)
  })

  it('switches exactly where the stage would fall under the usable size (1180 px at 120 px thumbs)', () => {
    const threshold = MIN_STAGE_PX + 120 + AI_DOCK_PX + COMMENTS_PANE_PX
    expect(threshold).toBe(1180)
    expect(aiDockShouldYield({ paneOpen: true, windowWidth: threshold - 1, ...base })).toBe(true)
    expect(aiDockShouldYield({ paneOpen: true, windowWidth: threshold, ...base })).toBe(false)
  })

  it('hidden thumbnails give their width back: the switch moves down by that much', () => {
    expect(aiDockShouldYield({ paneOpen: true, windowWidth: 1100, thumbsWidth: 0 })).toBe(false)
    expect(aiDockShouldYield({ paneOpen: true, windowWidth: 1100, thumbsWidth: 120 })).toBe(true)
  })
})

/* ---------- the real App ---------- */

const blankSlide = () => ({
  widthPx: 1280,
  heightPx: 720,
  scale: 1,
  nodes: [],
  background: { kind: 'color', color: '#ffffff' },
})

function makeSlidesApi() {
  const explicit: Record<string, unknown> = {
    consumePendingOpen: () => Promise.resolve(null),
    newBlank: () => Promise.resolve({ path: '', slides: [blankSlide()], defaultFont: 'Arial' }),
    isDirty: () => Promise.resolve(false),
    getRecentFiles: () => Promise.resolve([]),
    getAiSettings: () => Promise.resolve({ provider: 'anthropic', providers: {} }),
    getSections: () => Promise.resolve([]),
    getComments: () => Promise.resolve([]),
    getNotes: () => Promise.resolve(''),
    getAnimations: () => Promise.resolve([]),
    getTransition: () => Promise.resolve(null),
    listFonts: () => Promise.resolve([]),
  }
  const fallbacks = new Map<string, unknown>()
  return new Proxy(explicit, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      if (!fallbacks.has(prop)) {
        fallbacks.set(prop, prop.startsWith('on') ? () => () => {} : () => Promise.resolve(null))
      }
      return fallbacks.get(prop)
    },
  })
}

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList
  Element.prototype.scrollTo ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  ;(window as unknown as { slidesApi: unknown }).slidesApi = makeSlidesApi()
})

beforeEach(() => {
  // the user's stored preference: the AI dock is open
  localStorage.setItem('ai-slides-show-ai', '1')
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  localStorage.clear()
})

async function resizeWindow(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width, writable: true })
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
  })
}

async function bootApp(width: number): Promise<HTMLElement> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width, writable: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(App)))
  await settle()
  expect(
    container.querySelector('.stage-wrap'),
    'editor should boot into a blank deck',
  ).not.toBeNull()
  return container
}

const dock = () => container!.querySelector('.ai-dock')!
const dockOpen = () => !dock().classList.contains('collapsed')
const pane = () => container!.querySelector('.comments-pane')

function toggleCommentsPane() {
  const tab = [...container!.querySelectorAll<HTMLButtonElement>('button.ribbon-tab')].find((b) =>
    /^(Review|审阅)$/.test(b.textContent ?? ''),
  )
  if (tab) act(() => tab.click())
  const btn = [...container!.querySelectorAll<HTMLButtonElement>('button.rb-big')].find((b) =>
    /^(Comments Pane|批注窗格)/.test(b.textContent ?? ''),
  )
  expect(btn, 'the Comments Pane button').toBeTruthy()
  act(() => btn!.click())
}

describe('V14b-01: the AI dock yields to the stage while the comments pane is open', () => {
  it('900 px: opening the pane collapses the dock, closing it brings the dock back', async () => {
    await bootApp(900)
    expect(dockOpen()).toBe(true)
    toggleCommentsPane()
    expect(pane()).not.toBeNull()
    expect(dockOpen()).toBe(false)
    // the stored preference is untouched: the dock was open before and comes back
    expect(localStorage.getItem('ai-slides-show-ai')).toBe('1')
    toggleCommentsPane()
    expect(pane()).toBeNull()
    expect(dockOpen()).toBe(true)
    expect(localStorage.getItem('ai-slides-show-ai')).toBe('1')
  })

  it('1440 px: the dock stays open next to the pane', async () => {
    await bootApp(1440)
    toggleCommentsPane()
    expect(pane()).not.toBeNull()
    expect(dockOpen()).toBe(true)
  })

  it('widening the window with the pane open restores the dock, narrowing again yields it', async () => {
    await bootApp(900)
    toggleCommentsPane()
    expect(dockOpen()).toBe(false)
    await resizeWindow(1440)
    expect(dockOpen()).toBe(true)
    await resizeWindow(900)
    expect(dockOpen()).toBe(false)
    expect(localStorage.getItem('ai-slides-show-ai')).toBe('1')
  })

  it('a dock the user collapsed stays collapsed after the pane closes', async () => {
    await bootApp(900)
    // collapse through the panel (the user's own toggle), then open and close the pane
    act(() => container!.querySelector<HTMLButtonElement>('.ai-body')!.click())
    expect(dockOpen()).toBe(false)
    expect(localStorage.getItem('ai-slides-show-ai')).toBe('0')
    toggleCommentsPane()
    expect(dockOpen()).toBe(false)
    toggleCommentsPane()
    expect(dockOpen()).toBe(false)
  })

  it('the user can still expand the dock while the pane is open; it re-yields with the next pane', async () => {
    await bootApp(900)
    toggleCommentsPane()
    expect(dockOpen()).toBe(false)
    act(() => container!.querySelector<HTMLButtonElement>('.ai-rail')!.click())
    expect(dockOpen()).toBe(true)
    // an explicit expand is this pane session's choice, not a stored change
    expect(localStorage.getItem('ai-slides-show-ai')).toBe('1')
    toggleCommentsPane()
    expect(dockOpen()).toBe(true)
    toggleCommentsPane()
    expect(dockOpen()).toBe(false)
  })
})
