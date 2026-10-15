// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkStatusChip } from '../src/renderer/src/UniworkChrome'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import { en } from '../src/renderer/src/i18n/sync/en'
import { en as enDocs } from '../src/renderer/src/i18n/uniwork-documents/en'
import { stripFloorOf } from '../src/renderer/src/uniwork-pill-fit'
import { setTopInsetPart } from '../src/renderer/src/uniwork-top-inset'
import type { AccountState, HomeApi, UniworkDocStatus } from '../src/shared/home-api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * U-1 (the pill leaves the tabs their room) and U-2 (the popover sits under the pill), against the
 * real chip inside a hand-built tab bar. jsdom has no layout: the rects below model what Chromium
 * measured for tabbar.css (see the notes in uniwork-pill-fit.test.ts), the chip's behaviour on top
 * of them is what is under test.
 */

const PATH = '/work/uniwork-documents/d1/Plan.docx'

function status(over: Partial<UniworkDocStatus> = {}): UniworkDocStatus {
  return {
    path: PATH,
    documentId: 'd1',
    workspaceId: 'w1',
    title: 'Plan',
    format: 'docx',
    access: 'edit',
    state: 'queued',
    ...over,
  }
}

const PILL = { full: 309, short: 190, compact: 111 }
const TOGGLE = 108
const FIXED_LEFT = 40
const FIXED_RIGHT = 176
const MARGINS = 22
const HOME = 109
const NEW_BUTTON = 28

/** the window (bar) width the stubbed layout is at, and the number of document tabs in the strip */
let barWidth = 1280
let pillRightOverride: number | null = null
let rectCalls = 0

let bar: HTMLDivElement
let strip: HTMLDivElement
let chrome: HTMLDivElement
let root: Root
let account: AccountState
let rectSpy: ReturnType<typeof vi.spyOn>

function variantOf(el: Element | null): keyof typeof PILL {
  const v = el?.closest('.uw-pill')?.getAttribute('data-variant') ?? 'full'
  return (v in PILL ? v : 'full') as keyof typeof PILL
}

function currentPillWidth(): number {
  const group = chrome.querySelector('.uw-pill')
  return group ? PILL[variantOf(group)] : 0
}

function chromeWidth(): number {
  return currentPillWidth() + TOGGLE
}

function docTabCount(): number {
  return strip.querySelectorAll('.tab-item:not(.tab-home)').length
}

function rectOf(left: number, width: number, height = 28): DOMRect {
  return {
    x: left,
    y: 6,
    top: 6,
    left,
    right: left + width,
    bottom: 6 + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

/** the flex layout of tabbar.css as Chromium measured it: the strip takes what the holder leaves */
function stubLayout(): void {
  rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    rectCalls++
    const shared = barWidth - FIXED_LEFT - FIXED_RIGHT - MARGINS
    const stripWidth = Math.max(0, shared - chromeWidth())
    if (this.classList.contains('tab-bar')) return rectOf(0, barWidth, 40)
    if (this.classList.contains('tab-strip')) return rectOf(FIXED_LEFT, stripWidth, 40)
    if (this.classList.contains('uw-chrome')) {
      return rectOf(FIXED_LEFT + stripWidth + 6, chromeWidth())
    }
    if (this.classList.contains('uw-pill')) {
      const width = currentPillWidth()
      const right = pillRightOverride ?? FIXED_LEFT + stripWidth + 6 + TOGGLE + width
      return rectOf(right - width, width)
    }
    if (this.classList.contains('tab-home')) return rectOf(FIXED_LEFT + 10, HOME)
    if (this.classList.contains('tab-new-btn')) return rectOf(0, NEW_BUTTON)
    if (this.hasAttribute('data-uw-queue-band')) return rectOf(0, barWidth, 120)
    if (this.classList.contains('uw-queue-pop')) return rectOf(0, 360, 100)
    return rectOf(0, 0, 0)
  })
}

function buildBar(docTabs: number): void {
  bar = document.createElement('div')
  bar.className = 'tab-bar'
  strip = document.createElement('div')
  strip.className = 'tab-strip'
  strip.innerHTML =
    '<div class="tab-item tab-home"></div>' +
    Array.from({ length: docTabs }, () => '<div class="tab-item"></div>').join('') +
    '<button class="tab-new-btn"></button>'
  chrome = document.createElement('div')
  chrome.className = 'uw-chrome'
  bar.append(strip, chrome)
  document.body.append(bar)
  root = createRoot(chrome)
}

function makeApi() {
  const fns = {
    accountStatus: vi.fn(async () => ({ loggedIn: account === 'signed-in', state: account })),
    onAccountStatus: vi.fn(() => () => undefined),
    onAccountLogin: vi.fn(() => () => undefined),
    accountLogin: vi.fn(async () => true),
    uniworkSave: vi.fn(async (): Promise<UniworkDocStatus | null> => null),
    uniworkResolveConflict: vi.fn(async (): Promise<UniworkDocStatus | null> => null),
    uniworkRemoteAction: vi.fn(async (): Promise<UniworkDocStatus | null> => null),
    uniworkSetBarInset: vi.fn(async () => undefined),
    onUniworkQueuePopover: vi.fn(() => () => undefined),
  }
  window.aiOffice = fns as unknown as HomeApi
  return fns
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function mount(s: UniworkDocStatus): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(UniworkLiveHost),
        createElement(UniworkStatusChip, { key: s.path, status: s, onStatus: () => undefined }),
      ),
    )
  })
  await flush()
}

async function resizeTo(width: number): Promise<void> {
  barWidth = width
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
  })
  await flush()
}

const pill = () => chrome.querySelector<HTMLElement>('.uw-pill')!
const variant = () => pill().getAttribute('data-variant')
const action = () => pill().querySelector<HTMLButtonElement>('.uw-pill-action')
const label = () => pill().querySelector<HTMLElement>('.uw-pill-label')!
/** what a sighted user reads in the label: everything that is not visually hidden */
const visibleLabel = () =>
  Array.from(label().childNodes)
    .map((node) =>
      node.nodeType === 3
        ? (node.textContent ?? '')
        : (node as HTMLElement).classList.contains('uw-sr-only')
          ? ''
          : (node.textContent ?? ''),
    )
    .join('')
const polite = () => document.querySelector('#uw-live-host [role=status]')?.textContent ?? ''

beforeEach(() => {
  localStorage.setItem('uniwork-ui-lang', 'en')
  resetLiveForTests()
  account = 'signed-in'
  barWidth = 1280
  pillRightOverride = null
  rectCalls = 0
  makeApi()
  ;(window as unknown as { aiOfficeTabs?: unknown }).aiOfficeTabs = { focusActive: vi.fn() }
  delete (window as unknown as { uniworkSyncCenter?: unknown }).uniworkSyncCenter
  document.documentElement.style.removeProperty('--ui-scale')
})

afterEach(() => {
  act(() => root.unmount())
  rectSpy?.mockRestore()
  setTopInsetPart('bar', 0)
  setTopInsetPart('popover', 0)
  resetLiveForTests()
  document.body.innerHTML = ''
})

describe('U-1: the pill degrades so the tabs keep their room', () => {
  it('without a layout to measure (no strip, zero rects) the pill is the full one', async () => {
    buildBar(2)
    await mount(status())
    expect(variant()).toBe('full')
    expect(label().textContent).toBe(en.uwChipQueued)
    expect(action()!.textContent).toBe(en.uwActViewQueue)
  })

  it('wide window: the full label, nothing hidden', async () => {
    buildBar(2)
    stubLayout()
    barWidth = 1280
    await mount(status())
    expect(variant()).toBe('full')
    expect(visibleLabel()).toBe(en.uwChipQueued)
  })

  it('narrower: the short label shows, the full sentence stays for assistive tech', async () => {
    buildBar(1)
    stubLayout()
    barWidth = 890
    await mount(status())
    expect(variant()).toBe('short')
    expect(visibleLabel()).toBe('Save queued')
    // read once, in full: the visually hidden text is the whole label, the short one is aria-hidden
    expect(label().querySelector('.uw-sr-only')!.textContent).toBe(en.uwChipQueued)
    expect(label().querySelector('[aria-hidden="true"]')!.textContent).toBe('Save queued')
    expect(action()!.textContent).toBe(en.uwActViewQueue)
  })

  it('narrowest: icon + action, no visible label; the title, description and name keep the full sentence', async () => {
    buildBar(2)
    stubLayout()
    barWidth = 890
    await mount(status())
    expect(variant()).toBe('compact')
    expect(visibleLabel()).toBe('')
    expect(action()!.textContent).toBe(en.uwActViewQueue)
    expect(label().querySelector('.uw-sr-only')!.textContent).toBe(en.uwChipQueued)
    expect(action()!.getAttribute('title')!.startsWith(`${en.uwChipQueued}\n`)).toBe(true)
    const tip = document.getElementById(action()!.getAttribute('aria-describedby')!)!
    expect(tip.textContent).toContain(en.uwTipQueued.split('{')[0])
    expect(pill().getAttribute('role')).toBe('group')
    expect(pill().getAttribute('aria-label')).toBe(enDocs.uwChipAria)
  })

  it('a pill without a button degrades to the icon, still described and focusable', async () => {
    buildBar(2)
    stubLayout()
    barWidth = 890
    await mount(status({ state: 'saved' }))
    expect(variant()).toBe('compact')
    expect(action()).toBeNull()
    expect(visibleLabel()).toBe('')
    expect(pill().getAttribute('tabindex')).toBe('0')
    expect(pill().getAttribute('aria-describedby')).toBeTruthy()
    expect(pill().getAttribute('title')).toContain('Saved')
  })

  it('a resize measures again: narrower window, narrower pill; wider again, the full one', async () => {
    buildBar(2)
    stubLayout()
    await mount(status())
    expect(variant()).toBe('full')
    await resizeTo(890)
    expect(variant()).toBe('compact')
    await resizeTo(1280)
    expect(variant()).toBe('full')
    await resizeTo(1024)
    // 1024 with two tabs: the full pill still leaves the strip its floor
    expect(variant()).toBe('full')
    await resizeTo(960)
    expect(variant()).not.toBe('full')
  })

  it('a tab opening takes the pill one step down, closing it gives the step back', async () => {
    buildBar(1)
    stubLayout()
    barWidth = 890
    await mount(status())
    expect(variant()).toBe('short')
    await act(async () => {
      const tab = document.createElement('div')
      tab.className = 'tab-item'
      strip.insertBefore(tab, strip.querySelector('.tab-new-btn'))
    })
    await flush()
    expect(docTabCount()).toBe(2)
    expect(variant()).toBe('compact')
    await act(async () => {
      strip.querySelectorAll('.tab-item:not(.tab-home)')[1].remove()
    })
    await flush()
    expect(variant()).toBe('short')
  })

  it('the strip keeps the floor of its tabs at every width of the matrix', async () => {
    for (const w of [800, 890, 1024, 1280]) {
      for (const n of [1, 2, 3]) {
        document.body.innerHTML = ''
        rectSpy?.mockRestore()
        buildBar(n)
        stubLayout()
        barWidth = w
        await mount(status())
        const stripW = strip.getBoundingClientRect().width
        const chromeRect = chrome.getBoundingClientRect()
        const stripRect = strip.getBoundingClientRect()
        // not one pixel of the holder over the strip
        expect(stripRect.right, `${w}px ${n} tabs`).toBeLessThanOrEqual(chromeRect.left)
        const floor = stripFloorOf({
          home: HOME,
          tabMin: 104,
          docTabs: n,
          padding: 20,
          newButton: NEW_BUTTON + 4,
        })
        // the strip has the floor, unless even the icon + action pill leaves it less
        const shared = w - FIXED_LEFT - FIXED_RIGHT - MARGINS
        expect(stripW, `${w}px ${n} tabs`).toBeGreaterThanOrEqual(
          Math.min(floor, shared - TOGGLE - PILL.compact),
        )
        act(() => root.unmount())
      }
    }
  })

  it('a change of state while compact is still said in full', async () => {
    buildBar(2)
    stubLayout()
    barWidth = 890
    await mount(status({ state: 'saved' }))
    expect(variant()).toBe('compact')
    await mount(status({ state: 'queued' }))
    expect(polite()).toBe(`Plan: ${en.uwChipQueued}`)
  })

  it('does not keep measuring when nothing changed (settles in a few passes)', async () => {
    buildBar(2)
    stubLayout()
    barWidth = 890
    await mount(status())
    const settled = rectCalls
    await flush()
    await flush()
    expect(rectCalls).toBe(settled)
  })
})

describe('U-2: the queue popover is anchored under the pill', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const leftOf = () => Number.parseFloat(dialog()!.style.marginLeft)

  async function open(width: number): Promise<void> {
    buildBar(2)
    stubLayout()
    barWidth = width
    await mount(status())
    await act(async () => action()!.click())
    await flush()
    expect(dialog()).not.toBeNull()
  }

  it('its right edge is the pill right edge', async () => {
    await open(1280)
    const pillRight = pill().getBoundingClientRect().right
    expect(leftOf() + 360).toBe(pillRight)
  })

  it('at 800, 890, 1024 and 1280 (compact or not) the dialog ends where the pill ends', async () => {
    for (const w of [800, 890, 1024, 1280]) {
      document.body.innerHTML = ''
      rectSpy?.mockRestore()
      await open(w)
      const pillRight = pill().getBoundingClientRect().right
      expect(leftOf() + 360, `${w}px`).toBe(Math.min(pillRight, w - 8))
      act(() => root.unmount())
    }
  })

  it('it is no longer pushed to the window edge (the old right-aligned band)', async () => {
    await open(1280)
    const pillRight = pill().getBoundingClientRect().right
    expect(pillRight).toBeLessThan(1280 - 8 - 100)
    expect(leftOf() + 360).toBeLessThan(1280 - 8 - 100)
  })

  it('a pill near the left edge keeps the dialog in the 8px gutter', async () => {
    buildBar(2)
    stubLayout()
    barWidth = 890
    pillRightOverride = 200
    await mount(status())
    await act(async () => action()!.click())
    await flush()
    expect(leftOf()).toBe(8)
  })

  it('a pill at the window edge keeps the dialog in the right gutter', async () => {
    buildBar(2)
    stubLayout()
    barWidth = 890
    pillRightOverride = 890
    await mount(status())
    await act(async () => action()!.click())
    await flush()
    expect(leftOf() + 360).toBe(890 - 8)
  })

  it('a Ctrl/Cmd+S opening is anchored the same way', async () => {
    buildBar(2)
    stubLayout()
    barWidth = 1280
    let push: ((request: { path: string }) => void) | null = null
    window.aiOffice.onUniworkQueuePopover = vi.fn((cb: (request: { path: string }) => void) => {
      push = cb
      return () => undefined
    }) as unknown as HomeApi['onUniworkQueuePopover']
    await mount(status())
    await act(async () => push!({ path: PATH }))
    await flush()
    expect(leftOf() + 360).toBe(pill().getBoundingClientRect().right)
  })

  it('a window resize while it is open moves it with the pill', async () => {
    await open(1280)
    const before = leftOf()
    await resizeTo(1100)
    const pillRight = pill().getBoundingClientRect().right
    expect(leftOf() + 360).toBe(Math.min(pillRight, 1100 - 8))
    expect(leftOf()).not.toBe(before)
  })

  it('the pill changing width while it is open re-anchors it (the observer on the pill)', async () => {
    const observers: Array<{ callback: () => void; observed: Element[] }> = []
    const had = 'ResizeObserver' in window
    const previous = (window as unknown as { ResizeObserver?: unknown }).ResizeObserver
    ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      private readonly record: { callback: () => void; observed: Element[] }
      constructor(callback: () => void) {
        this.record = { callback, observed: [] }
        observers.push(this.record)
      }
      observe(target: Element): void {
        this.record.observed.push(target)
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    try {
      await open(1280)
      const group = pill()
      expect(observers.some((o) => o.observed.includes(group))).toBe(true)
      // the right edge of the pill moves (its holder grew or shrank); the browser reports the pill
      pillRightOverride = 640
      await act(async () => {
        for (const o of observers) if (o.observed.includes(group)) o.callback()
      })
      expect(leftOf() + 360).toBe(640)
    } finally {
      if (had) (window as unknown as { ResizeObserver: unknown }).ResizeObserver = previous
      else delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver
    }
  })

  it('the interface scale is taken out: rects are window px, the band lays out in unscaled px', async () => {
    document.documentElement.style.setProperty('--ui-scale', '1.25')
    buildBar(2)
    stubLayout()
    barWidth = 1600
    await mount(status())
    await act(async () => action()!.click())
    await flush()
    const pillRight = pill().getBoundingClientRect().right
    // the dialog is 360 window px wide in the stub = 288 unscaled
    expect(leftOf() + 288).toBeCloseTo(pillRight / 1.25, 0)
  })

  it('stays inside the window when the pill measure is unusable', async () => {
    buildBar(2)
    stubLayout()
    barWidth = 890
    pillRightOverride = Number.NaN
    await mount(status())
    await act(async () => action()!.click())
    await flush()
    expect(leftOf() + 360).toBe(890 - 8)
  })
})
