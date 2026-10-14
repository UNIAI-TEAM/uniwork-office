import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MindMapTreeNode } from '@genoffice/agent-core'
import { MindMapCard } from '../src/renderer/ai/MindMapCard'

const tree: MindMapTreeNode = {
  label: 'Doc',
  children: [{ label: 'A', children: [{ label: 'A1' }] }, { label: 'B' }],
}

const roots: Root[] = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

function renderCard(): { viewport: HTMLDivElement; canvas: HTMLDivElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(createElement(MindMapCard, { tree, onAsk: () => {}, onJumpBlock: () => {} }))
  })
  const viewport = container.querySelector('.ai-mindmap-viewport')
  const canvas = container.querySelector('.ai-mindmap-canvas')
  if (!(viewport instanceof HTMLDivElement) || !(canvas instanceof HTMLDivElement)) {
    throw new Error('mind map card did not render a viewport')
  }
  return { viewport, canvas }
}

/** Current zoom, read back off the canvas transform. */
function zoomOf(canvas: HTMLDivElement): number {
  const m = /scale\(([\d.]+)\)/.exec(canvas.style.transform)
  return m ? Number(m[1]) : 1
}

function wheel(el: HTMLElement, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  act(() => {
    el.dispatchEvent(event)
  })
  return event
}

describe('MindMapCard wheel gestures', () => {
  it('leaves a plain wheel to the chat panel: no zoom, no preventDefault', () => {
    const { viewport, canvas } = renderCard()

    const event = wheel(viewport, { deltaY: -240, clientX: 40, clientY: 40 })

    // Not preventDefault -> the conversation keeps scrolling past the card.
    expect(event.defaultPrevented).toBe(false)
    expect(zoomOf(canvas)).toBe(1)
  })

  it('zooms on a ctrl-wheel (trackpad pinch) gesture', () => {
    const { viewport, canvas } = renderCard()
    expect(zoomOf(canvas)).toBe(1)

    const event = wheel(viewport, { deltaY: -240, ctrlKey: true, clientX: 40, clientY: 40 })

    expect(event.defaultPrevented).toBe(true)
    expect(zoomOf(canvas)).toBeGreaterThan(1)
  })

  it('zooms on a meta-wheel gesture too, in both directions', () => {
    const { viewport, canvas } = renderCard()

    wheel(viewport, { deltaY: 240, metaKey: true })
    expect(zoomOf(canvas)).toBeLessThan(1)

    wheel(viewport, { deltaY: -240, metaKey: true })
    expect(zoomOf(canvas)).toBeCloseTo(1, 5)
  })
})

describe('MindMapCard first frame', () => {
  it('fits the map into a measured card on first render (V10)', () => {
    const size = (name: 'clientWidth' | 'clientHeight', value: number) =>
      vi.spyOn(HTMLElement.prototype, name, 'get').mockReturnValue(value)
    const w = size('clientWidth', 200)
    const h = size('clientHeight', 300)
    try {
      const { canvas } = renderCard()
      // the 3-leaf tree is ~560 px wide: it shrinks to fit 200 px instead of opening at 1:1
      expect(zoomOf(canvas)).toBeLessThan(1)
      const x = /translate\(([-\d.]+)px/.exec(canvas.style.transform)
      expect(Number(x?.[1])).toBeGreaterThanOrEqual(0)
    } finally {
      w.mockRestore()
      h.mockRestore()
    }
  })
})

describe('MindMapCard refit when first measured hidden (R3-4)', () => {
  type Observer = { cb: () => void; disconnected: boolean }
  const observers: Observer[] = []
  class FakeResizeObserver {
    private entry: Observer
    constructor(cb: () => void) {
      this.entry = { cb, disconnected: false }
      observers.push(this.entry)
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      this.entry.disconnected = true
    }
  }

  afterEach(() => {
    observers.length = 0
    vi.unstubAllGlobals()
  })

  it('stays at 1:1 while hidden, then fits once the card gets a size and stops observing', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    let width = 0
    let height = 0
    const w = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    const h = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(() => height)
    try {
      const { canvas } = renderCard()
      expect(zoomOf(canvas)).toBe(1)
      expect(observers).toHaveLength(1)

      // the panel is revealed: one resize notification with a real size
      width = 200
      height = 300
      act(() => observers[0]!.cb())

      expect(zoomOf(canvas)).toBeLessThan(1)
      expect(observers[0]!.disconnected).toBe(true)
    } finally {
      w.mockRestore()
      h.mockRestore()
    }
  })

  it('does not observe a card that was measured on first render', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const w = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200)
    const h = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
    try {
      renderCard()
      expect(observers.every((o) => o.disconnected)).toBe(true)
    } finally {
      w.mockRestore()
      h.mockRestore()
    }
  })

  it('runs the first fit before paint (layout effect, not a passive effect)', () => {
    const source = readFileSync(resolve(__dirname, '../src/renderer/ai/MindMapCard.tsx'), 'utf8')
    expect(source).toMatch(/useLayoutEffect\(/)
    expect(source).not.toMatch(/lastTreeRef[\s\S]{0,120}\n {2}useEffect\(/)
  })
})
