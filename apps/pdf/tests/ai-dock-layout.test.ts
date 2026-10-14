/**
 * G8-15 FX15d (V15c-01): the AI dock folds away while the comments panel is open in a narrow window,
 * without touching the stored AI dock choice. jsdom has no layout, so the viewer width is the
 * estimate from the same numbers as the CSS (`estimatedViewerWidth`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_DOCK_COLLAPSE_BELOW_PX,
  aiDockAutoCollapsed,
  estimatedViewerWidth,
  useAiDockLayout,
  type AiDockLayout,
} from '../src/renderer/ai-dock-layout'
import { scrollLeftToReveal } from '../src/renderer/server-comments/reveal-view'

/** the smallest viewer a width-fit page needs: A4 at the 0.6 narrow-pane floor (357 px) + scroll padding */
const USABLE_VIEWER_PX = 405

describe('viewer width at 900 and 1440, dock as the user left it (expanded)', () => {
  it('900 with the panel open and the dock expanded leaves the 144 px sliver V15c-01 measured', () => {
    const w = estimatedViewerWidth({ windowWidth: 900, dockCollapsed: false, panelOpen: true })
    expect(Math.round(w)).toBeGreaterThanOrEqual(140)
    expect(Math.round(w)).toBeLessThanOrEqual(150)
  })

  it('1440 stays usable with the dock expanded, panel open or closed', () => {
    for (const panelOpen of [true, false]) {
      expect(
        estimatedViewerWidth({ windowWidth: 1440, dockCollapsed: false, panelOpen }),
      ).toBeGreaterThanOrEqual(USABLE_VIEWER_PX)
    }
  })

  it('900 with the panel closed is the unchanged baseline (the rule only acts when the panel opens)', () => {
    expect(estimatedViewerWidth({ windowWidth: 900, dockCollapsed: false, panelOpen: false })).toBe(
      390,
    )
  })
})

describe('aiDockAutoCollapsed', () => {
  it('collapses only while the panel is open and the window is below the threshold', () => {
    expect(aiDockAutoCollapsed({ panelOpen: true, windowWidth: 900 })).toBe(true)
    expect(aiDockAutoCollapsed({ panelOpen: false, windowWidth: 900 })).toBe(false)
    expect(aiDockAutoCollapsed({ panelOpen: true, windowWidth: 1440 })).toBe(false)
    expect(aiDockAutoCollapsed({ panelOpen: false, windowWidth: 1440 })).toBe(false)
    expect(aiDockAutoCollapsed({ panelOpen: true, windowWidth: AI_DOCK_COLLAPSE_BELOW_PX })).toBe(
      false,
    )
    expect(
      aiDockAutoCollapsed({ panelOpen: true, windowWidth: AI_DOCK_COLLAPSE_BELOW_PX - 1 }),
    ).toBe(true)
  })

  it('the threshold is where the expanded viewer drops under a usable size, and collapsing fixes 900', () => {
    // just under the threshold the expanded viewer is the small one, the collapsed one is not
    const below = AI_DOCK_COLLAPSE_BELOW_PX - 1
    expect(
      estimatedViewerWidth({ windowWidth: below, dockCollapsed: false, panelOpen: true }),
    ).toBeLessThan(USABLE_VIEWER_PX)
    expect(
      estimatedViewerWidth({ windowWidth: 900, dockCollapsed: true, panelOpen: true }),
    ).toBeGreaterThanOrEqual(USABLE_VIEWER_PX - 40)
    // collapsed at 900 is at least 2.5x what the expanded dock left
    expect(
      estimatedViewerWidth({ windowWidth: 900, dockCollapsed: true, panelOpen: true }),
    ).toBeGreaterThan(
      2.5 * estimatedViewerWidth({ windowWidth: 900, dockCollapsed: false, panelOpen: true }),
    )
  })
})

describe('FX15b reveal frame stays in view once the dock folds (900, panel opened by the reveal)', () => {
  const FRAME = { left: 117, width: 288 } // the V15c-01 first-reveal frame, wider than the 144 px viewer

  const inView = (scrollLeft: number, viewWidth: number) =>
    FRAME.left >= scrollLeft && FRAME.left + FRAME.width <= scrollLeft + viewWidth

  it('with the dock expanded the 288 px frame cannot fit the viewer (the bug)', () => {
    const viewWidth = estimatedViewerWidth({
      windowWidth: 900,
      dockCollapsed: false,
      panelOpen: true,
    })
    const next = scrollLeftToReveal({ scrollLeft: 0, viewWidth, ...FRAME })
    expect(inView(next, viewWidth)).toBe(false)
  })

  it('with the dock folded the reveal scroll brings the whole frame in view', () => {
    const viewWidth = estimatedViewerWidth({
      windowWidth: 900,
      dockCollapsed: true,
      panelOpen: true,
    })
    const next = scrollLeftToReveal({ scrollLeft: 0, viewWidth, ...FRAME })
    expect(inView(next, viewWidth)).toBe(true)
  })
})

describe('useAiDockLayout', () => {
  let el: HTMLDivElement
  let root: Root
  let layout: AiDockLayout
  let stored: boolean

  function Harness(p: { panelOpen: boolean }) {
    layout = useAiDockLayout(
      stored,
      (v) => {
        stored = v
        rerender(p.panelOpen)
      },
      p.panelOpen,
    )
    return null
  }
  const rerender = (panelOpen: boolean) =>
    act(() => root.render(createElement(Harness, { panelOpen })))
  const setWidth = (w: number) => {
    vi.stubGlobal('innerWidth', w)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    stored = false
    el = document.createElement('div')
    document.body.append(el)
    root = createRoot(el)
  })

  afterEach(() => {
    act(() => root.unmount())
    el.remove()
    vi.unstubAllGlobals()
  })

  it('900: the dock folds when the panel opens and returns when it closes, stored choice untouched', () => {
    vi.stubGlobal('innerWidth', 900)
    rerender(false)
    expect(layout.collapsed).toBe(false)
    rerender(true)
    expect(layout.collapsed).toBe(true)
    expect(stored).toBe(false)
    rerender(false)
    expect(layout.collapsed).toBe(false)
    expect(stored).toBe(false)
  })

  it('1440: the dock stays as the user left it with the panel open or closed', () => {
    vi.stubGlobal('innerWidth', 1440)
    rerender(true)
    expect(layout.collapsed).toBe(false)
    rerender(false)
    expect(layout.collapsed).toBe(false)
  })

  it('a dock the user collapsed stays collapsed after the panel closes or the window widens', () => {
    vi.stubGlobal('innerWidth', 900)
    stored = true
    rerender(true)
    expect(layout.collapsed).toBe(true)
    rerender(false)
    expect(layout.collapsed).toBe(true)
    setWidth(1440)
    expect(layout.collapsed).toBe(true)
  })

  it('widening the window past the threshold brings the dock back while the panel stays open', () => {
    vi.stubGlobal('innerWidth', 900)
    rerender(true)
    expect(layout.collapsed).toBe(true)
    setWidth(1440)
    expect(layout.collapsed).toBe(false)
    setWidth(900)
    expect(layout.collapsed).toBe(true)
  })

  it('opening the dock by hand while it is folded keeps it open until the panel closes', () => {
    vi.stubGlobal('innerWidth', 900)
    rerender(true)
    act(() => layout.open())
    expect(layout.collapsed).toBe(false)
    // collapsing again goes back to the folded state without writing the stored choice
    act(() => layout.collapse())
    expect(layout.collapsed).toBe(true)
    expect(stored).toBe(false)
    act(() => layout.open())
    rerender(false)
    expect(layout.collapsed).toBe(false)
    // the next time the panel opens the rule folds it again
    rerender(true)
    expect(layout.collapsed).toBe(true)
  })

  it('collapsing with the panel closed is the user choice and is stored', () => {
    vi.stubGlobal('innerWidth', 900)
    rerender(false)
    act(() => layout.collapse())
    expect(stored).toBe(true)
    expect(layout.collapsed).toBe(true)
    act(() => layout.open())
    expect(stored).toBe(false)
    expect(layout.collapsed).toBe(false)
  })
})

describe('App wiring', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

  it('draws the dock from the derived state and persists only the stored choice', () => {
    expect(app).toContain('useAiDockLayout(aiCollapsed, setAiCollapsed, serverPanelOpen)')
    expect(app).toContain("`ai-dock${aiDock.collapsed ? ' collapsed' : ''}${")
    expect(app).toContain("!aiSidebarEnabled && aiDock.collapsed ? ' ai-dock-off' : ''")
    expect(app).toContain('{aiDock.collapsed && aiSidebarEnabled && (')
    expect(app).toContain("rememberAiPanelOpen('genoffice-pdf-show-ai', !aiCollapsed)")
  })
})
