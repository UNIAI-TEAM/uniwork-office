/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import type { TabSummary } from '../src/shared/tabs-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { TabBar } from '../src/renderer/src/TabBar'
import { TAB_STRIP_COMPACT_BELOW_PX, compactStripOf } from '../src/renderer/src/tab-strip-compact'

/**
 * G5-06u-TS (V6u8-02): at UI scale 1.25 a 722 / 800 px window holds 578 / 640 CSS px of tab bar,
 * and Home plus three document tabs at their 104px minimum leave the third tab's label out of the
 * strip. Below a 720 CSS px bar with two document tabs or more, the strip takes a compact form
 * (Home icon-only, inactive tabs without their close button). The form reads the window width, the
 * scale and the tab count only, never a rect of the strip, the holder or the pill.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const barCssOf = (windowPx: number, scale: number) => windowPx / scale

describe('compactStripOf: the trigger', () => {
  it('scale 1 never takes the compact form, at any window width the shell allows and any tab count', () => {
    for (const w of [720, 722, 800, 890, 1024, 1280]) {
      for (const n of [0, 1, 2, 3]) {
        expect(compactStripOf({ barCss: barCssOf(w, 1), docTabs: n }), `1 x ${w} x ${n}`).toBe(
          false,
        )
      }
    }
  })

  it('scale 1.25 at 1024 and 1280 keeps the full strip', () => {
    for (const w of [1024, 1280]) {
      for (const n of [1, 2, 3]) {
        expect(
          compactStripOf({ barCss: barCssOf(w, 1.25), docTabs: n }),
          `1.25 x ${w} x ${n}`,
        ).toBe(false)
      }
    }
  })

  it('one document tab (or none) never needs it, at any scale', () => {
    for (const scale of [1, 1.1, 1.25, 1.5]) {
      for (const w of [720, 722, 800, 890, 1024]) {
        for (const n of [0, 1]) {
          expect(
            compactStripOf({ barCss: barCssOf(w, scale), docTabs: n }),
            `${scale} x ${w} x ${n}`,
          ).toBe(false)
        }
      }
    }
  })

  it('compact with two or three tabs: 1.1 x 722, 1.25 x 722 / 800 / 890, 1.5 x 722 to 1024', () => {
    const cells: Array<[number, number]> = [
      [1.1, 722],
      [1.25, 722],
      [1.25, 800],
      [1.25, 890],
      [1.5, 722],
      [1.5, 800],
      [1.5, 890],
      [1.5, 1024],
    ]
    for (const [scale, w] of cells) {
      for (const n of [2, 3]) {
        expect(
          compactStripOf({ barCss: barCssOf(w, scale), docTabs: n }),
          `${scale} x ${w} x ${n}`,
        ).toBe(true)
      }
    }
  })

  it('an unusable width keeps the full strip', () => {
    expect(compactStripOf({ barCss: Number.NaN, docTabs: 3 })).toBe(false)
    expect(compactStripOf({ barCss: Number.POSITIVE_INFINITY, docTabs: 3 })).toBe(false)
  })

  it('the threshold is the window minWidth (main/index.ts), so scale 1 can never be below it', () => {
    const main = readFileSync(resolve(__dirname, '../src/main/index.ts'), 'utf8')
    const minWidth = /minWidth:\s*(\d+)/.exec(main)
    expect(minWidth, 'main window minWidth').not.toBeNull()
    expect(Number(minWidth![1])).toBe(TAB_STRIP_COMPACT_BELOW_PX)
  })
})

describe('TabBar: the data-strip attribute and the active tab in view', () => {
  let host: HTMLDivElement
  let root: Root
  let tabs: TabSummary[]
  let tabListeners: Set<(next: TabSummary[]) => void>
  let scrollSpy: ReturnType<typeof vi.fn>
  let observers: Array<{ callback: ResizeObserverCallback; targets: Element[] }>
  const hadResizeObserver = 'ResizeObserver' in window
  const previousResizeObserver = (window as unknown as { ResizeObserver?: unknown }).ResizeObserver

  const tab = (id: string, active = false): TabSummary =>
    ({
      id,
      kind: id === 'home' ? 'home' : 'docs',
      title: id === 'home' ? 'UniWork Office' : `${id}.docx`,
      filePath: id === 'home' ? undefined : `/home/u/notes/${id}.docx`,
      active,
      closable: id !== 'home',
    }) as TabSummary

  function setWindowWidth(px: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: px })
  }

  function installWindow(): void {
    const win = window as unknown as Record<string, unknown>
    win.aiOfficeTabs = {
      list: vi.fn(async () => tabs),
      onChanged: vi.fn((cb: (next: TabSummary[]) => void) => {
        tabListeners.add(cb)
        return () => {
          tabListeners.delete(cb)
        }
      }),
      activate: vi.fn(async () => undefined),
    }
    win.aiOffice = {
      uniworkDocStatus: vi.fn(async () => null),
      uniworkActiveDocStatus: vi.fn(async () => null),
      onUniworkDocStatus: vi.fn(() => () => undefined),
      onUniworkQueuePopover: vi.fn(() => () => undefined),
      onUniworkLaunch: vi.fn(() => () => undefined),
      accountStatus: vi.fn(async () => ({ loggedIn: false, state: 'signed-out' })),
      onAccountStatus: vi.fn(() => () => undefined),
      onAccountLogin: vi.fn(() => () => undefined),
      setLanguage: vi.fn(async () => undefined),
    } as unknown as HomeApi
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
  }

  async function mount(): Promise<void> {
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(TabBar)))
    })
    await flush()
  }

  async function setTabs(next: TabSummary[]): Promise<void> {
    tabs = next
    await act(async () => {
      for (const listener of [...tabListeners]) listener(tabs)
    })
    await flush()
  }

  async function setScale(scale: number | null): Promise<void> {
    await act(async () => {
      if (scale === null) document.documentElement.style.removeProperty('--ui-scale')
      else document.documentElement.style.setProperty('--ui-scale', String(scale))
    })
    await flush()
  }

  async function resizeWindow(px: number): Promise<void> {
    setWindowWidth(px)
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    await flush()
  }

  /** what a ResizeObserver on the strip reports when the strip changes size */
  async function resizeStrip(): Promise<void> {
    const strip = host.querySelector('.tab-strip')!
    await act(async () => {
      for (const o of observers) {
        if (o.targets.includes(strip)) o.callback([], {} as ResizeObserver)
      }
    })
    await flush()
  }

  const bar = () => host.querySelector<HTMLElement>('.tab-bar')!
  const strip = () => bar().getAttribute('data-strip')
  const three = () => [tab('home'), tab('a', true), tab('b'), tab('c')]

  beforeEach(() => {
    tabs = three()
    tabListeners = new Set()
    observers = []
    scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy as unknown as Element['scrollIntoView']
    HTMLElement.prototype.setPointerCapture = vi.fn()
    ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      targets: Element[] = []
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, targets: this.targets })
      }
      observe(target: Element): void {
        this.targets.push(target)
      }
      unobserve(): void {}
      disconnect(): void {
        this.targets.length = 0
      }
    }
    setWindowWidth(722)
    document.documentElement.style.setProperty('--ui-scale', '1.25')
    installWindow()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.documentElement.style.removeProperty('--ui-scale')
    if (hadResizeObserver) {
      ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = previousResizeObserver
    } else delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver
  })

  it('722 px at 1.25 with three document tabs: compact; scale 1, a 1024 window or one tab: not', async () => {
    await mount()
    expect(strip()).toBe('compact')
    // the scale is an inline style main writes on <html>
    await setScale(1)
    expect(strip()).toBeNull()
    await setScale(1.25)
    expect(strip()).toBe('compact')
    await resizeWindow(1024)
    expect(strip()).toBeNull()
    await resizeWindow(722)
    expect(strip()).toBe('compact')
    await setTabs([tab('home'), tab('a', true)])
    expect(strip()).toBeNull()
    await setTabs(three())
    expect(strip()).toBe('compact')
  })

  it('no flip-flop: pill variants, the toggle form and strip / holder rects never change the form', async () => {
    await mount()
    const chrome = host.querySelector<HTMLElement>('.uw-chrome')!
    const fake = document.createElement('div')
    fake.className = 'uw-pill'
    const toggle = document.createElement('button')
    toggle.className = 'uw-discussion-toggle'
    await act(async () => {
      chrome.append(toggle, fake)
    })
    const rects = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(
        () => ({ left: 0, right: 9, width: 9, top: 0, bottom: 9, height: 9 }) as DOMRect,
      )
    try {
      for (const [scale, expected] of [
        [1.25, 'compact'],
        [1, null],
      ] as const) {
        await setScale(scale)
        for (const variant of ['mini', 'compact', 'short', 'full']) {
          for (const iconOnly of ['true', 'false']) {
            await act(async () => {
              fake.setAttribute('data-variant', variant)
              toggle.setAttribute('data-icon-only', iconOnly)
            })
            await resizeStrip()
            await act(async () => {
              window.dispatchEvent(new Event('resize'))
            })
            await flush()
            expect(strip(), `${scale} ${variant} ${iconOnly}`).toBe(expected)
          }
        }
      }
    } finally {
      rects.mockRestore()
    }
  })

  it('the active tab is scrolled into view on a strip resize and on a form change, never mid-drag', async () => {
    await mount()
    const active = () => host.querySelector('.tab-item.active')
    const callsOnActive = () => scrollSpy.mock.contexts.filter((el) => el === active()).length

    let before = callsOnActive()
    await resizeStrip()
    expect(callsOnActive(), 'strip resize').toBeGreaterThan(before)

    before = callsOnActive()
    await setScale(1)
    expect(strip()).toBeNull()
    expect(callsOnActive(), 'form change to full').toBeGreaterThan(before)

    before = callsOnActive()
    await setScale(1.25)
    expect(strip()).toBe('compact')
    expect(callsOnActive(), 'form change to compact').toBeGreaterThan(before)

    // a press on a document tab holds the drag geometry: no scroll until it is released
    const pressed = host.querySelectorAll<HTMLElement>('.tab-item:not(.tab-home)')[1]
    await act(async () => {
      pressed.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    before = scrollSpy.mock.calls.length
    await resizeStrip()
    await setScale(1)
    await setScale(1.25)
    expect(scrollSpy.mock.calls.length, 'mid-drag').toBe(before)
  })
})
