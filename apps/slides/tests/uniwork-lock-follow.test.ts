/**
 * EL-1(b) fix6 / VEL-1+VEL-2 (slides): the real App follows the shell's
 * `uniwork:doc-state-changed` ping (re-queries uniworkState, leaves Reading
 * view when the deck becomes editable again, re-enters it when the lock is
 * lost) and an explicit Save on a read-only bound deck calls
 * `uniworkReadOnlySave` once instead of doing nothing.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

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
vi.mock('../src/renderer/ai/AiPanel', () => ({
  AiPanel: () => null,
}))

import { App } from '../src/renderer/App'
import {
  slidesExplainReadOnlySave,
  useSlidesUniworkState,
  type SlidesUniworkState,
} from '../src/renderer/uniwork-state'

const PATH = 'C:/u/uniwork-documents/dep/user/doc1/deck.pptx'
const OTHER = 'C:/u/uniwork-documents/dep/user/doc2/other.pptx'

interface Answer {
  bound: boolean
  readOnly: boolean
}

const BLANK_SLIDE = {
  widthPx: 1280,
  heightPx: 720,
  scale: 1,
  nodes: [],
  background: { kind: 'color' as const, color: '#ffffff' },
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }
}

let root: Root | null = null
let container: HTMLElement | null = null
let answer: Answer
let stateCalls: number
let saveCalls: number
let explainCalls: number
let unsubscribes: number
let ping: ((path: string) => void) | null
let menuCmd: ((cmd: string) => void) | null

function installApi(): void {
  const explicit: Record<string, unknown> = {
    consumePendingOpen: () =>
      Promise.resolve({ ok: true, path: PATH, slides: [BLANK_SLIDE], defaultFont: 'Arial' }),
    newBlank: () => Promise.resolve({ path: '', slides: [BLANK_SLIDE], defaultFont: 'Arial' }),
    isDirty: () => Promise.resolve(true),
    getRecentFiles: () => Promise.resolve([]),
    getAiSettings: () => Promise.resolve({ provider: 'anthropic', providers: {} }),
    getSections: () => Promise.resolve([]),
    getComments: () => Promise.resolve([]),
    getNotes: () => Promise.resolve(''),
    getAnimations: () => Promise.resolve([]),
    getTransition: () => Promise.resolve(null),
    listFonts: () => Promise.resolve([]),
    uniworkState: () => {
      stateCalls += 1
      return Promise.resolve(answer)
    },
    onUniworkStateChanged: (cb: (path: string) => void) => {
      ping = cb
      return () => {
        unsubscribes += 1
      }
    },
    uniworkReadOnlySave: () => {
      explainCalls += 1
      return Promise.resolve()
    },
    save: () => {
      saveCalls += 1
      return Promise.resolve({ ok: true, path: PATH })
    },
    onMenuCommand: (cb: (cmd: string) => void) => {
      menuCmd = cb
      return () => {}
    },
  }
  const fallbacks: Record<string, unknown> = {}
  const api = new Proxy(explicit, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      fallbacks[prop] ??= prop.startsWith('on') ? () => () => {} : () => Promise.resolve(null)
      return fallbacks[prop]
    },
  })
  Object.assign(window, { slidesApi: api })
}

beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
})

beforeEach(() => {
  localStorage.clear()
  answer = { bound: true, readOnly: true }
  stateCalls = 0
  saveCalls = 0
  explainCalls = 0
  unsubscribes = 0
  ping = null
  menuCmd = null
  installApi()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  localStorage.clear()
})

async function bootApp(): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(App)))
  await settle()
  return container
}

describe('useSlidesUniworkState hook', () => {
  let latest: SlidesUniworkState = { bound: false, readOnly: false }
  function Probe({ p }: { p: string | null }) {
    latest = useSlidesUniworkState(window.slidesApi, p)
    return null
  }

  it('re-queries on a ping for the open path and ignores other paths; unsubscribes on unmount', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(createElement(Probe, { p: PATH })))
    await settle()
    expect(latest).toEqual({ bound: true, readOnly: true })
    expect(stateCalls).toBe(1)

    answer = { bound: true, readOnly: false }
    ping?.(OTHER)
    await settle()
    expect(stateCalls).toBe(1)
    expect(latest.readOnly).toBe(true)

    ping?.(PATH)
    await settle()
    expect(stateCalls).toBe(2)
    expect(latest).toEqual({ bound: true, readOnly: false })

    answer = { bound: true, readOnly: true }
    ping?.(PATH)
    await settle()
    expect(stateCalls).toBe(3)
    expect(latest).toEqual({ bound: true, readOnly: true })

    act(() => root?.unmount())
    root = null
    expect(unsubscribes).toBe(1)
  })
})

describe('slides App: lock ping + read-only Save explain', () => {
  it('flips read-only -> editable -> read-only on the ping and gates Save / explain accordingly', async () => {
    const host = await bootApp()
    expect(stateCalls).toBe(1)
    expect(host.querySelector('.reading-view')).not.toBeNull()

    // Read-only + bound: Save command calls uniworkReadOnlySave once and never writes
    menuCmd?.('save')
    await settle()
    expect(explainCalls).toBe(1)
    expect(saveCalls).toBe(0)

    // Ping -> editable: leaves Reading view, Save runs the normal save and never calls explain
    answer = { bound: true, readOnly: false }
    ping?.(PATH)
    await settle()
    expect(stateCalls).toBe(2)
    expect(host.querySelector('.reading-view')).toBeNull()
    menuCmd?.('save')
    await settle()
    expect(saveCalls).toBe(1)
    expect(explainCalls).toBe(1)

    // Ping -> read-only again (lock lost): back in Reading view, Save explains again
    answer = { bound: true, readOnly: true }
    ping?.(PATH)
    await settle()
    expect(stateCalls).toBe(3)
    expect(host.querySelector('.reading-view')).not.toBeNull()
    menuCmd?.('save')
    await settle()
    expect(explainCalls).toBe(2)
    expect(saveCalls).toBe(1)
  })

  it('unbound read-only deck: Save neither writes nor calls uniworkReadOnlySave', async () => {
    answer = { bound: false, readOnly: true }
    await bootApp()
    menuCmd?.('save')
    await settle()
    expect(saveCalls).toBe(0)
    expect(explainCalls).toBe(0)
  })
})

describe('slidesExplainReadOnlySave', () => {
  it('ignores auto-save even when bound and read-only', () => {
    const fn = vi.fn(async () => undefined)
    slidesExplainReadOnlySave({ uniworkReadOnlySave: fn }, { bound: true, readOnly: true }, 'auto')
    expect(fn).not.toHaveBeenCalled()
  })
})
