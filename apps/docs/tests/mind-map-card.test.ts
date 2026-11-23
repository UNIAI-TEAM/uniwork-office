import { afterEach, describe, expect, it, vi } from 'vitest'
<<<<<<< ours
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
=======
>>>>>>> theirs
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

<<<<<<< ours
function renderCard(): { viewport: HTMLDivElement; canvas: HTMLDivElement } {
=======
function renderCard(
  onInsert?: (svg: string, size: { width: number; height: number }) => void,
): void {
>>>>>>> theirs
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
<<<<<<< ours
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
=======
    root.render(
      createElement(MindMapCard, { tree, onAsk: () => {}, onJumpBlock: () => {}, onInsert }),
    )
  })
}

describe('MindMapCard exports', () => {
  it('the SVG button downloads the baked standalone SVG', () => {
    renderCard(() => {})
    const serializer = vi.spyOn(XMLSerializer.prototype, 'serializeToString')
    const created: Blob[] = []
    const downloads: string[] = []
    const URLRecord = URL as unknown as Record<string, unknown>
    const hadCreate = typeof URLRecord.createObjectURL === 'function'
    const hadRevoke = typeof URLRecord.revokeObjectURL === 'function'
    if (!hadCreate) URLRecord.createObjectURL = () => ''
    if (!hadRevoke) URLRecord.revokeObjectURL = () => {}
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((blob: Blob | MediaSource) => {
        created.push(blob as Blob)
        return 'blob:export'
      })
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download)
    })
    try {
      const buttons = document.querySelectorAll('.ai-mindmap-actions button')
      expect(buttons.length).toBe(5)
      act(() => {
        ;(buttons[3] as HTMLButtonElement).click()
      })

      expect(downloads).toEqual(['mindmap.svg'])
      expect(created.length).toBe(1)
      expect(created[0].type).toBe('image/svg+xml;charset=utf-8')
      expect(created[0].size).toBeGreaterThan(0)
      // the file is the palette-baked standalone SVG the PNG rasterizes from
      expect(serializer).toHaveBeenCalledTimes(1)
      const raw = String(serializer.mock.results[0].value)
      expect(raw).toContain('<svg')
      expect(raw).toContain('fill="#ffffff"')
      expect(raw).toContain('stroke="#d0d3d8"')
    } finally {
      createObjectURL.mockRestore()
      revokeObjectURL.mockRestore()
      anchorClick.mockRestore()
      serializer.mockRestore()
      if (!hadCreate) delete URLRecord.createObjectURL
      if (!hadRevoke) delete URLRecord.revokeObjectURL
    }
  })

  it('the insert button hands over the baked SVG and its layout size', () => {
    const onInsert = vi.fn()
    renderCard(onInsert)
    const buttons = document.querySelectorAll('.ai-mindmap-actions button')
    expect(buttons.length).toBe(5)
    act(() => {
      ;(buttons[4] as HTMLButtonElement).click()
    })

    expect(onInsert).toHaveBeenCalledTimes(1)
    const [svg, size] = onInsert.mock.calls[0]
    // the receiver gets the same palette-baked file the exports build from
    expect(String(svg)).toContain('<svg')
    expect(String(svg)).toContain('fill="#ffffff"')
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
  })
})

describe('MindMapCard layout', () => {
  it('the layout button switches the card between the two orientations', () => {
    renderCard(() => {})
    const widthOf = () =>
      Number(
        (document.querySelector('.ai-mindmap-canvas svg') as SVGSVGElement).getAttribute('width'),
      )
    const before = widthOf()

    const button = document.querySelector('.ai-mindmap-layout-btn') as HTMLButtonElement
    expect(button).toBeTruthy()
    act(() => {
      button.click()
    })
    const after = widthOf()
    expect(after).not.toBe(before)

    // and back again: the switch is a two-way toggle
    act(() => {
      button.click()
    })
    expect(widthOf()).toBe(before)
>>>>>>> theirs
  })
})
