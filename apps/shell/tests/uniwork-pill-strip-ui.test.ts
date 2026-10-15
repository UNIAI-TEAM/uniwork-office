// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  DiscussionToggle,
  PillFitScope,
  UniworkStatusChip,
} from '../src/renderer/src/UniworkChrome'
import { DISCUSSION_BRIDGE_KEY } from '@genoffice/electron-utils/comments-ipc'
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
/** the Discussion toggle without its label (FXT6u): 8px padding, the 14px glyph, the 1px borders */
const TOGGLE_ICON = 32
const FIXED_LEFT = 40
const FIXED_RIGHT = 176
const MARGINS = 22
const HOME = 109
const NEW_BUTTON = 28

/** the window (bar) width the stubbed layout is at, and the number of document tabs in the strip */
let barWidth = 1280
let pillRightOverride: number | null = null
let pillLeftOverride: number | null = null
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

/** the toggle's width as drawn now: full, or icon-only; a holder with no toggle models the full one */
function currentToggleWidth(): number {
  const toggle = chrome.querySelector('.uw-discussion-toggle')
  return toggle?.getAttribute('data-icon-only') === 'true' ? TOGGLE_ICON : TOGGLE
}

function chromeWidth(): number {
  return currentPillWidth() + currentToggleWidth()
}

function docTabCount(): number {
  return strip.querySelectorAll('.tab-item:not(.tab-home)').length
}

/** right-to-left (ar, he) mirrors the bar: the holder on the left, the tab strip right of it */
const isRtl = () => document.documentElement.dir === 'rtl'

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
    // the same flex row mirrored: a left edge in the left-to-right row is `bar - left - width`
    const at = (left: number, width: number, height?: number): DOMRect =>
      rectOf(isRtl() ? barWidth - left - width : left, width, height)
    if (this.classList.contains('tab-bar')) return rectOf(0, barWidth, 40)
    if (this.classList.contains('tab-strip')) return at(FIXED_LEFT, stripWidth, 40)
    if (this.classList.contains('uw-chrome')) {
      return at(FIXED_LEFT + stripWidth + 6, chromeWidth())
    }
    if (this.classList.contains('uw-pill')) {
      const width = currentPillWidth()
      if (pillLeftOverride !== null) return rectOf(pillLeftOverride, width)
      if (pillRightOverride !== null) return rectOf(pillRightOverride - width, width)
      return at(FIXED_LEFT + stripWidth + 6 + currentToggleWidth(), width)
    }
    if (this.classList.contains('uw-discussion-toggle')) {
      return at(FIXED_LEFT + stripWidth + 6, currentToggleWidth())
    }
    if (this.classList.contains('tab-home')) return at(FIXED_LEFT + 10, HOME)
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
  pillLeftOverride = null
  rectCalls = 0
  document.documentElement.removeAttribute('dir')
  makeApi()
  ;(window as unknown as { aiOfficeTabs?: unknown }).aiOfficeTabs = { focusActive: vi.fn() }
  delete (window as unknown as { uniworkSyncCenter?: unknown }).uniworkSyncCenter
  delete (window as unknown as Record<string, unknown>)[DISCUSSION_BRIDGE_KEY]
  document.documentElement.style.removeProperty('--ui-scale')
})

afterEach(() => {
  act(() => root.unmount())
  rectSpy?.mockRestore()
  setTopInsetPart('bar', 0)
  setTopInsetPart('popover', 0)
  resetLiveForTests()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('dir')
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

  it('RFE6u6-02: right-to-left (ar, he) picks the same variant at every width of the matrix, strip and holder never intersect', async () => {
    const picked: Record<string, string[]> = { ltr: [], rtl: [] }
    for (const dir of ['ltr', 'rtl']) {
      document.documentElement.dir = dir
      for (const w of [800, 890, 1024, 1280]) {
        for (const n of [1, 2, 3]) {
          document.body.innerHTML = ''
          rectSpy?.mockRestore()
          buildBar(n)
          stubLayout()
          barWidth = w
          await mount(status())
          const stripRect = strip.getBoundingClientRect()
          const chromeRect = chrome.getBoundingClientRect()
          const tag = `${dir} ${w}px ${n} tabs`
          picked[dir].push(`${w}/${n}:${variant()}`)
          if (dir === 'rtl') {
            // mirrored: the holder is on the left, the strip starts where it ends
            expect(chromeRect.right, tag).toBeLessThanOrEqual(stripRect.left)
          } else {
            expect(stripRect.right, tag).toBeLessThanOrEqual(chromeRect.left)
          }
          act(() => root.unmount())
        }
      }
    }
    expect(picked.rtl).toEqual(picked.ltr)
    // the narrow windows did step down, so the comparison is not full == full
    expect(picked.rtl).toContain('890/2:compact')
  })

  it('RFE6u6-02: right-to-left, the reported 890px / 2 tabs case is compact and a resize restores the full pill', async () => {
    document.documentElement.dir = 'rtl'
    buildBar(2)
    stubLayout()
    barWidth = 890
    await mount(status())
    expect(variant()).toBe('compact')
    expect(visibleLabel()).toBe('')
    expect(label().querySelector('.uw-sr-only')!.textContent).toBe(en.uwChipQueued)
    await resizeTo(1280)
    expect(variant()).toBe('full')
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

/**
 * FXT6u (V6u5-01): at the narrowest windows the compact pill still leaves the tab strip below its
 * floor, so the Discussion toggle beside it gives up its label (icon only) and the room goes back to
 * the strip. The real toggle and the real chip in the stubbed bar: the toggle is a sibling in the
 * holder, the pill's fit decides.
 */
describe('FXT6u: the Discussion toggle goes icon-only when the compact pill still leaves the strip below its floor', () => {
  const DISCUSSION = 'Discussion'

  async function mountBoth(s: UniworkDocStatus): Promise<void> {
    ;(window as unknown as Record<string, unknown>)[DISCUSSION_BRIDGE_KEY] = {}
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(UniworkLiveHost),
          createElement(
            PillFitScope,
            null,
            createElement(DiscussionToggle, { status: s }),
            createElement(UniworkStatusChip, { key: s.path, status: s, onStatus: () => undefined }),
          ),
        ),
      )
    })
    await flush()
  }

  const toggle = () => chrome.querySelector<HTMLButtonElement>('.uw-discussion-toggle')
  const iconOnly = () => toggle()?.getAttribute('data-icon-only') === 'true'

  /**
   * A document tab's visible px in the strip: Home, then tabs at their 104px minimum, 10px of padding
   * on the side the tabs start from (the strip's width is the same in both directions).
   */
  function visibleTabPx(n: number): number {
    const room = strip.getBoundingClientRect().width - 10 - HOME - (n - 1) * 104
    return Math.max(0, Math.min(104, room))
  }
  /** the title starts 36px into a tab (icon and padding) and is 36px wide at the minimum (real shell: 104 / 36) */
  const visibleLabelPx = (n: number) => Math.max(0, Math.min(36, visibleTabPx(n) - 36))

  function assertHolderApart(tag: string): void {
    const stripRect = strip.getBoundingClientRect()
    const chromeRect = chrome.getBoundingClientRect()
    if (isRtl()) expect(chromeRect.right, tag).toBeLessThanOrEqual(stripRect.left)
    else expect(stripRect.right, tag).toBeLessThanOrEqual(chromeRect.left)
  }

  for (const dir of ['ltr', 'rtl'] as const) {
    describe(`${dir}`, () => {
      beforeEach(() => {
        document.documentElement.dir = dir
      })

      it('722px, 3 document tabs: the pill is compact, the toggle is icon-only, the strip and the holder never meet', async () => {
        buildBar(3)
        stubLayout()
        barWidth = 722
        await mountBoth(status())
        expect(toggle()).not.toBeNull()
        expect(variant()).toBe('compact')
        expect(iconOnly()).toBe(true)
        assertHolderApart(`${dir} 722/3`)
        // the room it gave up went back to the strip
        const shared = 722 - FIXED_LEFT - FIXED_RIGHT - MARGINS
        expect(strip.getBoundingClientRect().width).toBe(shared - TOGGLE_ICON - PILL.compact)
      })

      it('722px, 3 tabs: the strip gains the whole difference of the two toggle forms, and the first two tabs show their labels', async () => {
        buildBar(3)
        stubLayout()
        barWidth = 722
        await mountBoth(status())
        const iconStrip = strip.getBoundingClientRect().width
        expect(visibleLabelPx(1)).toBe(36)
        expect(visibleLabelPx(2)).toBe(36)
        // with the toggle full the same window would leave the strip this much less
        const shared = 722 - FIXED_LEFT - FIXED_RIGHT - MARGINS
        const fullStrip = shared - TOGGLE - PILL.compact
        expect(iconStrip - fullStrip).toBe(TOGGLE - TOGGLE_ICON)
      })

      it('icon-only keeps the toggle named and titled "Discussion", a button with the same state', async () => {
        buildBar(3)
        stubLayout()
        barWidth = 1280
        await mountBoth(status())
        expect(iconOnly()).toBe(false)
        const nameFull = toggle()!.textContent
        const titleFull = toggle()!.getAttribute('title')
        const expandedFull = toggle()!.getAttribute('aria-expanded')
        await resizeTo(722)
        expect(iconOnly()).toBe(true)
        expect(toggle()!.textContent).toBe(nameFull)
        expect(toggle()!.textContent).toBe(DISCUSSION)
        expect(toggle()!.getAttribute('title')).toBe(titleFull)
        expect(toggle()!.getAttribute('title')).toBe(DISCUSSION)
        expect(toggle()!.getAttribute('aria-expanded')).toBe(expandedFull)
        expect(toggle()!.tagName).toBe('BUTTON')
        // the label is still in the button (hidden by CSS), not removed
        expect(toggle()!.querySelector('.uw-discussion-toggle-label')!.textContent).toBe(DISCUSSION)
      })

      it('the toggle comes back when room returns: 722 -> 1024 and -> 1280', async () => {
        buildBar(3)
        stubLayout()
        barWidth = 722
        await mountBoth(status())
        expect(iconOnly()).toBe(true)
        await resizeTo(1024)
        expect(iconOnly()).toBe(false)
        await resizeTo(1280)
        expect(iconOnly()).toBe(false)
        expect(variant()).toBe('full')
        await resizeTo(722)
        expect(iconOnly()).toBe(true)
      })

      it('closing a tab brings the full toggle back, opening one takes it away again', async () => {
        buildBar(3)
        stubLayout()
        barWidth = 800
        await mountBoth(status())
        // 800px with three tabs: the compact pill still leaves the strip below its floor
        expect(variant()).toBe('compact')
        expect(iconOnly()).toBe(true)
        await act(async () => {
          strip.querySelectorAll('.tab-item:not(.tab-home)')[2].remove()
          strip.querySelectorAll('.tab-item:not(.tab-home)')[1].remove()
        })
        await flush()
        expect(docTabCount()).toBe(1)
        expect(iconOnly()).toBe(false)
        await act(async () => {
          for (let i = 0; i < 2; i++) {
            const tab = document.createElement('div')
            tab.className = 'tab-item'
            strip.insertBefore(tab, strip.querySelector('.tab-new-btn'))
          }
        })
        await flush()
        expect(docTabCount()).toBe(3)
        expect(iconOnly()).toBe(true)
      })

      it('800, 890, 1024 and 1280 x 1-3 tabs: icon-only exactly where even the compact pill leaves the strip below its floor', async () => {
        const iconCases: string[] = []
        for (const w of [800, 890, 1024, 1280]) {
          for (const n of [1, 2, 3]) {
            document.body.innerHTML = ''
            rectSpy?.mockRestore()
            buildBar(n)
            stubLayout()
            barWidth = w
            await mountBoth(status())
            const tag = `${dir} ${w}/${n}`
            const floor = stripFloorOf({
              home: HOME,
              tabMin: 104,
              docTabs: n,
              padding: 20,
              newButton: NEW_BUTTON + 4,
            })
            const shared = w - FIXED_LEFT - FIXED_RIGHT - MARGINS
            // the strip the full toggle and the compact pill would leave
            const compactStrip = shared - TOGGLE - PILL.compact
            expect(iconOnly(), tag).toBe(compactStrip < floor)
            if (iconOnly()) {
              iconCases.push(`${w}/${n}`)
              expect(variant(), tag).toBe('compact')
            }
            assertHolderApart(tag)
            act(() => root.unmount())
          }
        }
        // the wide windows keep the full toggle
        expect(iconCases).toEqual(['800/2', '800/3', '890/3'])
      })

      it('the repeated measures at the boundary never flip the toggle back and forth', async () => {
        // the window width one pixel at a time: icon-only once, the full toggle once the room is there
        buildBar(3)
        stubLayout()
        barWidth = 700
        await mountBoth(status())
        const forms: boolean[] = []
        for (let w = 700; w <= 1100; w += 1) {
          await resizeTo(w)
          forms.push(iconOnly())
          // measuring again at the same width changes nothing
          await act(async () => {
            window.dispatchEvent(new Event('resize'))
          })
          await flush()
          expect(iconOnly(), `${w}px again`).toBe(forms[forms.length - 1])
        }
        const flips = forms.filter((v, i) => i > 0 && v !== forms[i - 1]).length
        expect(forms[0]).toBe(true)
        expect(forms[forms.length - 1]).toBe(false)
        expect(flips).toBe(1)
      })

      it('does not keep measuring once the toggle form has settled', async () => {
        buildBar(3)
        stubLayout()
        barWidth = 722
        await mountBoth(status())
        const settled = rectCalls
        await flush()
        await flush()
        expect(rectCalls).toBe(settled)
      })

      it('a holder without a Discussion toggle keeps the pill steps and nothing else', async () => {
        buildBar(3)
        stubLayout()
        barWidth = 722
        await mount(status())
        expect(toggle()).toBeNull()
        expect(variant()).toBe('compact')
      })
    })
  }
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

  describe('RFE6u6-01: right-to-left (ar, he), the dialog is placed by the physical box', () => {
    const dialogEl = () => document.querySelector<HTMLElement>('[role="dialog"]')!
    const placedFor = (pillLeft: number, width: number) =>
      Math.min(width - 8 - 360, Math.max(8, pillLeft))

    async function openRtl(width: number, pillLeft: number | null = null): Promise<void> {
      document.documentElement.dir = 'rtl'
      buildBar(2)
      stubLayout()
      barWidth = width
      pillLeftOverride = pillLeft
      await mount(status())
      await act(async () => action()!.click())
      await flush()
      expect(dialog()).not.toBeNull()
    }

    it('its left edge is the pill left edge, so it opens toward the window centre (890 and 1280)', async () => {
      for (const w of [890, 1280]) {
        document.body.innerHTML = ''
        rectSpy?.mockRestore()
        await openRtl(w)
        const pillLeft = pill().getBoundingClientRect().left
        expect(Math.abs(leftOf() - placedFor(pillLeft, w)), `${w}px`).toBeLessThan(1)
        act(() => root.unmount())
      }
    })

    it('left == pill left within 1px for several pill positions', async () => {
      for (const pillLeft of [20, 120, 300, 450, 520]) {
        document.body.innerHTML = ''
        rectSpy?.mockRestore()
        await openRtl(890, pillLeft)
        expect(Math.abs(leftOf() - pillLeft), `pill at ${pillLeft}`).toBeLessThan(1)
        act(() => root.unmount())
      }
    })

    it('a pill at the left window edge keeps the dialog inside the left 8px gutter', async () => {
      await openRtl(890, 2)
      expect(leftOf()).toBe(8)
    })

    it('a pill near the right window edge keeps the dialog inside the right gutter', async () => {
      await openRtl(890, 800)
      expect(leftOf() + 360).toBe(890 - 8)
    })

    it('an unusable pill measure stays inside the window', async () => {
      await openRtl(890, Number.NaN)
      expect(leftOf()).toBeGreaterThanOrEqual(8)
      expect(leftOf() + 360).toBeLessThanOrEqual(890 - 8)
    })

    it('the dialog keeps the document direction for its own text', async () => {
      await openRtl(890)
      expect(dialogEl().getAttribute('dir')).toBe('rtl')
    })

    it('switching the document direction while it is open places it again, both ways', async () => {
      await open(890)
      expect(dialogEl().getAttribute('dir')).toBe('ltr')
      expect(leftOf() + 360).toBe(Math.min(pill().getBoundingClientRect().right, 890 - 8))
      document.documentElement.dir = 'rtl'
      await flush()
      expect(dialogEl().getAttribute('dir')).toBe('rtl')
      expect(Math.abs(leftOf() - placedFor(pill().getBoundingClientRect().left, 890))).toBeLessThan(
        1,
      )
      document.documentElement.dir = 'ltr'
      await flush()
      expect(dialogEl().getAttribute('dir')).toBe('ltr')
      expect(leftOf() + 360).toBe(Math.min(pill().getBoundingClientRect().right, 890 - 8))
    })
  })
})
