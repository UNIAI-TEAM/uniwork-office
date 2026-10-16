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

/** `mini` (the dot alone) is a 28px circle: the pill's height */
const PILL = { full: 309, short: 190, compact: 111, mini: 28 }
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
/** a holder with no Discussion toggle models none (the older tests model one that is not rendered) */
let noToggleModel = false
let rectCalls = 0
/** a document tab at its minimum: the title starts this far into the tab and this much of the tab follows it (the close button) */
const TAB_MIN = 104
let tabLabelStart = 36
let tabTail = 32
/**
 * G5-06u-TS: the interface scale the stub lays out at (every CSS length x scale, the caption buttons
 * are window px) and whether the bar is in its compact form (Home icon-only, inactive tabs 80px
 * without the close button and the gap before it, the first document tab active).
 */
let uiScale = 1
let compactModel = false
/**
 * VTS1-01: the bar carries TabBar's `.tab-bar-caption-spacer` (the caption's width, window px), which
 * the fit reads; `preFixCaption` models d8af19b01 instead: the caption reserved x scale and no spacer
 * to read. `pillSet` / `toggleSet` / `homeCss` swap in the widths the visual run measured (CSS px).
 */
let captionSpacer = false
let preFixCaption = false
let pillSet: Record<keyof typeof PILL, number> = PILL
let toggleSet = { full: 108, icon: 32 }
let homeCss = 109
const CAPTION = 138
const COMPACT_HOME = 40
const CLOSE_AND_GAP = 16 + 8

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
  return group ? pillSet[variantOf(group)] : 0
}

/** the toggle's width as drawn now: full, or icon-only; a holder with no toggle models the full one */
function currentToggleWidth(): number {
  const toggle = chrome.querySelector('.uw-discussion-toggle')
  if (!toggle) return noToggleModel ? 0 : toggleSet.full
  return toggle.getAttribute('data-icon-only') === 'true' ? toggleSet.icon : toggleSet.full
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
/** a document tab's width at its minimum in the model, and what follows its title (CSS px) */
function tabMinOf(tab: Element): number {
  return compactModel && !tab.classList.contains('active') ? TAB_MIN - CLOSE_AND_GAP : TAB_MIN
}
function tabTailOf(tab: Element): number {
  return compactModel && !tab.classList.contains('active') ? tabTail - CLOSE_AND_GAP : tabTail
}

function stubLayout(): void {
  rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    rectCalls++
    const k = uiScale
    const FIXED_LEFT_K = FIXED_LEFT * k
    const home = (compactModel ? COMPACT_HOME : homeCss) * k
    const caption = preFixCaption ? CAPTION * k : CAPTION
    const shared = barWidth - FIXED_LEFT_K - (caption + (FIXED_RIGHT - CAPTION) * k) - MARGINS * k
    const stripWidth = Math.max(0, shared - chromeWidth() * k)
    const docLeft = (tab: Element): number => {
      const tabs = Array.from(strip.querySelectorAll('.tab-item:not(.tab-home)'))
      const before = tabs.slice(0, Math.max(0, tabs.indexOf(tab)))
      return FIXED_LEFT_K + 10 * k + home + before.reduce((sum, t) => sum + tabMinOf(t) * k, 0)
    }
    // the same flex row mirrored: a left edge in the left-to-right row is `bar - left - width`
    const at = (left: number, width: number, height?: number): DOMRect =>
      rectOf(isRtl() ? barWidth - left - width : left, width, height)
    if (this.classList.contains('tab-bar')) return rectOf(0, barWidth, 40)
    if (this.classList.contains('tab-strip')) return at(FIXED_LEFT_K, stripWidth, 40)
    if (this.classList.contains('uw-chrome')) {
      return at(FIXED_LEFT_K + stripWidth + 6, chromeWidth() * k)
    }
    if (this.classList.contains('uw-pill')) {
      const width = currentPillWidth() * k
      if (pillLeftOverride !== null) return rectOf(pillLeftOverride, width)
      if (pillRightOverride !== null) return rectOf(pillRightOverride - width, width)
      return at(FIXED_LEFT_K + stripWidth + 6 + currentToggleWidth() * k, width)
    }
    if (this.classList.contains('uw-discussion-toggle')) {
      return at(FIXED_LEFT_K + stripWidth + 6, currentToggleWidth() * k)
    }
    if (this.classList.contains('tab-home')) return at(FIXED_LEFT_K + 10 * k, home)
    // a document tab at its minimum width, and its title inside it (what the fit reads of the last counted tab)
    if (this.classList.contains('tab-title') && this.parentElement) {
      const tab = this.parentElement
      return at(
        docLeft(tab) + tabLabelStart * k,
        (tabMinOf(tab) - tabLabelStart - tabTailOf(tab)) * k,
      )
    }
    if (this.classList.contains('tab-item')) return at(docLeft(this), tabMinOf(this) * k)
    if (this.classList.contains('tab-new-btn')) return rectOf(0, NEW_BUTTON * k)
    if (this.classList.contains('tab-bar-caption-spacer')) return at(barWidth - CAPTION, CAPTION)
    if (this.hasAttribute('data-uw-queue-band')) return rectOf(0, barWidth, 120)
    if (this.classList.contains('uw-queue-pop')) return rectOf(0, 360, 100)
    return rectOf(0, 0, 0)
  })
}

function buildBar(docTabs: number): void {
  bar = document.createElement('div')
  bar.className = 'tab-bar'
  if (compactModel) bar.setAttribute('data-strip', 'compact')
  strip = document.createElement('div')
  strip.className = 'tab-strip'
  // the compact form: the first document tab is the active one, the others take tabbar.css's
  // calc(var(--tab-min) - var(--tab-close-size) - var(--tab-gap)) (jsdom computes no var(): inline px)
  strip.innerHTML =
    '<div class="tab-item tab-home"></div>' +
    Array.from({ length: docTabs }, (_, i) =>
      !compactModel
        ? '<div class="tab-item"><span class="tab-title"></span></div>'
        : i === 0
          ? '<div class="tab-item active"><span class="tab-title"></span></div>'
          : `<div class="tab-item" style="min-width: ${TAB_MIN - CLOSE_AND_GAP}px"><span class="tab-title"></span></div>`,
    ).join('') +
    '<button class="tab-new-btn"></button>'
  chrome = document.createElement('div')
  chrome.className = 'uw-chrome'
  bar.append(strip, chrome)
  if (captionSpacer) {
    const spacer = document.createElement('div')
    spacer.className = 'tab-bar-caption-spacer'
    bar.append(spacer)
  }
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
/** the button that opens the queue popover: the action button, or the dot itself in the mini pill */
const opener = () => pill().querySelector<HTMLButtonElement>('.uw-pill-action, .uw-pill-mini')
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

/** the text a screen reader gets from an element's content: aria-hidden subtrees are left out */
function contentOf(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1) return ''
  if ((node as Element).getAttribute('aria-hidden') === 'true') return ''
  return Array.from(node.childNodes).map(contentOf).join('')
}
/**
 * The accessible name as the accname algorithm gives it for the controls here: the elements an
 * aria-labelledby points to (their content, even when they are visually hidden, joined by a space),
 * else aria-label, else the control's own content.
 */
function accessibleNameOf(el: Element): string {
  const ids = el.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? []
  if (ids.length > 0) {
    return ids
      .map((id) => {
        const target = el.ownerDocument.getElementById(id)
        return target ? Array.from(target.childNodes).map(contentOf).join('') : ''
      })
      .join(' ')
      .trim()
  }
  return (el.getAttribute('aria-label') ?? contentOf(el)).trim()
}

beforeEach(() => {
  localStorage.setItem('uniwork-ui-lang', 'en')
  resetLiveForTests()
  account = 'signed-in'
  barWidth = 1280
  pillRightOverride = null
  pillLeftOverride = null
  noToggleModel = false
  rectCalls = 0
  tabLabelStart = 36
  tabTail = 32
  uiScale = 1
  compactModel = false
  captionSpacer = false
  preFixCaption = false
  pillSet = PILL
  toggleSet = { full: TOGGLE, icon: TOGGLE_ICON }
  homeCss = HOME
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

      it('722px, 3 document tabs: the toggle is icon-only (and the pill the dot alone), the strip and the holder never meet', async () => {
        buildBar(3)
        stubLayout()
        barWidth = 722
        await mountBoth(status())
        expect(toggle()).not.toBeNull()
        expect(variant()).toBe('mini')
        expect(iconOnly()).toBe(true)
        assertHolderApart(`${dir} 722/3`)
        // the room it gave up went back to the strip
        const shared = 722 - FIXED_LEFT - FIXED_RIGHT - MARGINS
        expect(strip.getBoundingClientRect().width).toBe(shared - TOGGLE_ICON - PILL.mini)
      })

      it('722px, 3 tabs: the strip gains what the toggle and the pill gave up, and every tab shows its label', async () => {
        buildBar(3)
        stubLayout()
        barWidth = 722
        await mountBoth(status())
        const miniStrip = strip.getBoundingClientRect().width
        for (const n of [1, 2, 3]) {
          expect(visibleLabelPx(n), `${dir} tab ${n}`).toBe(36)
        }
        // with the full toggle and the compact pill the same window leaves the strip this much less
        const shared = 722 - FIXED_LEFT - FIXED_RIGHT - MARGINS
        const before = shared - TOGGLE - PILL.compact
        expect(miniStrip - before).toBe(TOGGLE - TOGGLE_ICON + PILL.compact - PILL.mini)
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
        // 800px with three tabs: the compact pill leaves the strip below its floor, the last tab keeps its label
        expect(variant()).toBe('compact')
        expect(iconOnly()).toBe(true)
        await act(async () => {
          strip.querySelectorAll('.tab-item:not(.tab-home)')[2].remove()
          strip.querySelectorAll('.tab-item:not(.tab-home)')[1].remove()
        })
        await flush()
        expect(docTabCount()).toBe(1)
        expect(iconOnly()).toBe(false)
        expect(variant()).toBe('compact')
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
        expect(variant()).toBe('compact')
      })

      it('800, 890, 1024 and 1280 x 1-3 tabs: icon-only exactly where even the compact pill leaves the strip below its floor', async () => {
        const iconCases: string[] = []
        const miniCases: string[] = []
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
              expect(['compact', 'mini'], tag).toContain(variant())
            }
            if (variant() === 'mini') miniCases.push(`${w}/${n}`)
            assertHolderApart(tag)
            act(() => root.unmount())
          }
        }
        // the wide windows keep the full toggle
        expect(iconCases).toEqual(['800/2', '800/3', '890/3'])
        // FXT6u2: the dot alone only where the last tab cannot show its label, none of these cells
        expect(miniCases).toEqual([])
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

      it('FXT6u2 (RFE6u8-01): 722/800/890/1024/1280 x 1-3 tabs: the step, the toggle form and the last tab px / label px, toggle shown and none', async () => {
        const table = async (withToggle: boolean): Promise<string[]> => {
          const rows: string[] = []
          for (const w of [722, 800, 890, 1024, 1280]) {
            const cells: string[] = []
            for (const n of [1, 2, 3]) {
              document.body.innerHTML = ''
              rectSpy?.mockRestore()
              buildBar(n)
              stubLayout()
              barWidth = w
              noToggleModel = !withToggle
              if (withToggle) await mountBoth(status())
              else await mount(status())
              assertHolderApart(`${dir} ${w}/${n}`)
              cells.push(
                `${variant()}${iconOnly() ? '+icon' : ''} ${visibleTabPx(n)}/${visibleLabelPx(n)}`,
              )
              act(() => root.unmount())
            }
            rows.push(cells.join(' | '))
          }
          return rows
        }
        expect(await table(true)).toEqual([
          'compact 104/36 | compact+icon 104/36 | mini+icon 97/36',
          'compact 104/36 | compact+icon 104/36 | compact+icon 92/36',
          'short 104/36 | compact 104/36 | compact+icon 104/36',
          'full 104/36 | full 104/36 | short 104/36',
          'full 104/36 | full 104/36 | full 104/36',
        ])
        expect(await table(false)).toEqual([
          'short 104/36 | compact 104/36 | mini 104/36',
          'short 104/36 | short 104/36 | compact 104/36',
          'full 104/36 | short 104/36 | compact 104/36',
          'full 104/36 | full 104/36 | full 104/36',
          'full 104/36 | full 104/36 | full 104/36',
        ])
      })

      it('FXT6u2: 800 x 3 and 722 x 2 keep the compact pill, the last tab reads its label, the toggle is icon-only as before', async () => {
        for (const [w, n] of [
          [800, 3],
          [722, 2],
        ]) {
          document.body.innerHTML = ''
          rectSpy?.mockRestore()
          buildBar(n)
          stubLayout()
          barWidth = w
          await mountBoth(status())
          const tag = `${dir} ${w}/${n}`
          expect(variant(), tag).toBe('compact')
          expect(iconOnly(), tag).toBe(true)
          expect(visibleLabelPx(n), tag).toBe(36)
          expect(visibleTabPx(n), tag).toBeGreaterThanOrEqual(36 + 36)
          act(() => root.unmount())
        }
      })

      it('FXT6u2: what the last tab needs is read off the first tab (its title and what follows it), by the direction of the page', async () => {
        // a title with only 8px after it (no close button): the label runs to the tab's end, 96px are needed
        tabTail = 8
        buildBar(3)
        stubLayout()
        barWidth = 800
        await mountBoth(status())
        // the strip leaves the third tab 92px: its label would be cut, so the dot alone
        expect(variant()).toBe('mini')
        tabTail = 32
        await resizeTo(800)
        expect(variant()).toBe('compact')
        // the same tab with a bigger gap after the title needs less
        tabTail = 60
        await resizeTo(722)
        expect(variant()).toBe('mini')
        await resizeTo(760)
        expect(variant()).toBe('compact')
      })

      it('FXT6u2: a bar whose first tab has no title yet (the rename input) uses the constants of the stylesheet', async () => {
        buildBar(3)
        stubLayout()
        barWidth = 800
        strip.querySelectorAll('.tab-title').forEach((node) => node.remove())
        await mountBoth(status())
        expect(variant()).toBe('compact')
        await resizeTo(722)
        expect(variant()).toBe('mini')
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
        // no toggle to give up: the pill goes from compact to the dot at once, strip below its floor
        expect(variant()).toBe('mini')
      })

      describe('the mini pill: the dot alone', () => {
        const dialogEl = () => document.querySelector<HTMLElement>('[role="dialog"]')
        const marginLeft = () => Number.parseFloat(dialogEl()!.style.marginLeft)
        const miniDot = () => pill().querySelector<HTMLButtonElement>('.uw-pill-mini')
        const glyph = () => pill().querySelector('[data-glyph]')?.getAttribute('data-glyph')
        /** where the dialog's left edge goes: its right edge on the pill's (left-to-right), its left edge on the pill's (right-to-left), clamped */
        function expectedMargin(width: number): number {
          const rect = pill().getBoundingClientRect()
          return dir === 'rtl'
            ? Math.min(width - 8 - 360, Math.max(8, rect.left))
            : Math.min(width - 8 - 360, Math.max(8, rect.right - 360))
        }

        async function mountMini(s: UniworkDocStatus = status(), width = 722): Promise<void> {
          buildBar(3)
          stubLayout()
          noToggleModel = true
          barWidth = width
          await mount(s)
        }

        it('722px / 3 tabs without a Discussion toggle: the dot alone, every document tab label shows, the strip and holder never meet', async () => {
          await mountMini()
          expect(variant()).toBe('mini')
          for (const n of [1, 2, 3]) expect(visibleLabelPx(n), `${dir} tab ${n}`).toBe(36)
          assertHolderApart(`${dir} 722/3 no toggle`)
          expect(strip.getBoundingClientRect().width).toBe(
            722 - FIXED_LEFT - FIXED_RIGHT - MARGINS - PILL.mini,
          )
        })

        it('722px / 3 tabs with the toggle: icon-only toggle and the dot, every document tab label shows', async () => {
          buildBar(3)
          stubLayout()
          barWidth = 722
          await mountBoth(status())
          expect(variant()).toBe('mini')
          expect(iconOnly()).toBe(true)
          for (const n of [1, 2, 3]) expect(visibleLabelPx(n), `${dir} tab ${n}`).toBe(36)
          assertHolderApart(`${dir} 722/3`)
        })

        it('the dot is a button named by the full label and the action, titled and described, with no visible text', async () => {
          await mountMini()
          const dot = miniDot()!
          expect(dot.tagName).toBe('BUTTON')
          expect(dot.getAttribute('type')).toBe('button')
          // RFE6u8-03: the name is the hidden full label and the action text, read from the DOM (aria-labelledby),
          // joined by the accessible-name algorithm's space: no separator of ours in the product copy
          expect(dot.hasAttribute('aria-label')).toBe(false)
          expect(accessibleNameOf(dot)).toBe(`${en.uwChipQueued} ${en.uwActViewQueue}`)
          expect(accessibleNameOf(dot)).not.toContain('. ')
          const named = dot.getAttribute('aria-labelledby')!.split(' ')
          expect(named).toHaveLength(2)
          expect(document.getElementById(named[0])!.textContent).toBe(en.uwChipQueued)
          expect(document.getElementById(named[1])!.textContent).toBe(en.uwActViewQueue)
          expect(named.every((id) => dot.contains(document.getElementById(id)))).toBe(true)
          // both are visually hidden text: nothing but the glyph is drawn
          expect(document.getElementById(named[0])!.classList.contains('uw-sr-only')).toBe(true)
          expect(document.getElementById(named[1])!.classList.contains('uw-sr-only')).toBe(true)
          expect(dot.getAttribute('title')!.startsWith(`${en.uwChipQueued}\n`)).toBe(true)
          const tip = document.getElementById(dot.getAttribute('aria-describedby')!)!
          expect(tip.textContent).toContain(en.uwTipQueued.split('{')[0])
          const drawn = dot.cloneNode(true) as HTMLElement
          drawn.querySelectorAll('.uw-sr-only').forEach((node) => node.remove())
          expect(drawn.textContent).toBe('')
          expect(dot.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
          // one control: no second button, and the group still names the pill
          expect(pill().querySelectorAll('button')).toHaveLength(1)
          expect(pill().getAttribute('role')).toBe('group')
          expect(pill().getAttribute('aria-label')).toBe(enDocs.uwChipAria)
          expect(dot.getAttribute('tabindex')).toBeNull()
          expect(dot.getAttribute('aria-expanded')).toBe('false')
        })

        it("the focused dot is the keyboard stop (Enter and Space are the button's own)", async () => {
          await mountMini()
          const dot = miniDot()!
          dot.focus()
          expect(document.activeElement).toBe(dot)
          expect(dot.matches('button:not([disabled])')).toBe(true)
        })

        describe('RFE6u8-02: focus follows the button that replaces the focused one', () => {
          const actionButton = () => pill().querySelector<HTMLButtonElement>('.uw-pill-action')
          let outside: HTMLInputElement

          beforeEach(() => {
            outside = document.createElement('input')
            document.body.append(outside)
          })

          it('compact -> dot while the action button has focus: the dot has focus, not the group', async () => {
            await mountMini(status(), 800)
            expect(variant()).toBe('compact')
            actionButton()!.focus()
            expect(document.activeElement).toBe(actionButton())
            await resizeTo(722)
            expect(variant()).toBe('mini')
            expect(miniDot()).not.toBeNull()
            expect(document.activeElement).toBe(miniDot())
            expect(document.activeElement).not.toBe(pill())
          })

          it('dot -> compact while the dot has focus: the action button has focus', async () => {
            await mountMini(status(), 722)
            expect(variant()).toBe('mini')
            miniDot()!.focus()
            await resizeTo(800)
            expect(variant()).toBe('compact')
            expect(document.activeElement).toBe(actionButton())
          })

          it('dot, compact, dot, compact: the focus stays on the button of the pill each time', async () => {
            await mountMini(status(), 722)
            miniDot()!.focus()
            for (const w of [800, 722, 890, 722]) {
              await resizeTo(w)
              expect(document.activeElement, `${w}px`).toBe(opener())
              expect(document.activeElement?.closest('.uw-pill'), `${w}px`).toBe(pill())
            }
          })

          it('focus on something else is left where it is when the variant flips', async () => {
            await mountMini(status(), 800)
            outside.focus()
            await resizeTo(722)
            expect(variant()).toBe('mini')
            expect(document.activeElement).toBe(outside)
            await resizeTo(800)
            expect(variant()).toBe('compact')
            expect(document.activeElement).toBe(outside)
          })

          it('a focus taken by the group (a button-less step) is not turned into a later focus steal', async () => {
            await mountMini(status(), 722)
            miniDot()!.focus()
            // the save settles: the pill has no button any more, the group keeps the focus
            await mount(status({ state: 'saved' }))
            expect(miniDot()).toBeNull()
            outside.focus()
            // a waiting save again: a new button is drawn, the user is not moved to it
            await mount(status({ state: 'queued' }))
            expect(opener()).not.toBeNull()
            expect(document.activeElement).toBe(outside)
            await resizeTo(800)
            expect(document.activeElement).toBe(outside)
          })

          it('the queue popover opener follows the new button: Esc after the flip returns focus to it', async () => {
            await mountMini(status(), 800)
            await act(async () => actionButton()!.click())
            await flush()
            expect(dialogEl()).not.toBeNull()
            await resizeTo(722)
            expect(variant()).toBe('mini')
            expect(dialogEl()).not.toBeNull()
            await act(async () => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            })
            await flush()
            expect(dialogEl()).toBeNull()
            expect(document.activeElement).toBe(miniDot())
            expect(document.activeElement).not.toBe(pill())
          })

          it('and the other way: dot -> compact with the popover open, Esc returns to the action button', async () => {
            await mountMini(status(), 722)
            await act(async () => miniDot()!.click())
            await flush()
            await resizeTo(800)
            expect(variant()).toBe('compact')
            await act(async () => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            })
            await flush()
            expect(dialogEl()).toBeNull()
            expect(document.activeElement).toBe(actionButton())
          })

          it('a click on the new button after the flip still toggles the popover (the opener is not a stale node)', async () => {
            await mountMini(status(), 800)
            await act(async () => actionButton()!.click())
            await flush()
            await resizeTo(722)
            await act(async () => miniDot()!.click())
            await flush()
            expect(dialogEl()).toBeNull()
          })
        })

        it('a click opens the queue popover and the dialog anchors to the mini pill; a second click closes it', async () => {
          await mountMini()
          await act(async () => miniDot()!.click())
          await flush()
          expect(dialogEl()).not.toBeNull()
          expect(miniDot()!.getAttribute('aria-expanded')).toBe('true')
          expect(marginLeft()).toBe(expectedMargin(722))
          if (dir === 'ltr') expect(marginLeft() + 360).toBe(pill().getBoundingClientRect().right)
          else expect(marginLeft()).toBe(pill().getBoundingClientRect().left)
          await act(async () => miniDot()!.click())
          await flush()
          expect(dialogEl()).toBeNull()
        })

        it('the dialog keeps the gutters when the mini pill is near an edge', async () => {
          await mountMini()
          // the pill's box near the left edge, then near the right edge
          pillLeftOverride = 2
          await resizeTo(722)
          await act(async () => miniDot()!.click())
          await flush()
          expect(marginLeft()).toBe(8)
          await act(async () => miniDot()!.click())
          await flush()
          pillLeftOverride = 700
          await resizeTo(722)
          await act(async () => miniDot()!.click())
          await flush()
          expect(marginLeft()).toBe(722 - 8 - 360)
        })

        it('a Ctrl/Cmd+S opening anchors to the mini pill the same way', async () => {
          buildBar(3)
          stubLayout()
          noToggleModel = true
          barWidth = 722
          let push: ((request: { path: string }) => void) | null = null
          window.aiOffice.onUniworkQueuePopover = vi.fn(
            (cb: (request: { path: string }) => void) => {
              push = cb
              return () => undefined
            },
          ) as unknown as HomeApi['onUniworkQueuePopover']
          await mount(status())
          expect(variant()).toBe('mini')
          await act(async () => push!({ path: PATH }))
          await flush()
          expect(dialogEl()).not.toBeNull()
          expect(marginLeft()).toBe(expectedMargin(722))
        })

        it('a button-less pill (saved) stays a non-interactive dot with its shape, still named, described and focusable as a group', async () => {
          await mountMini(status({ state: 'saved' }))
          expect(variant()).toBe('mini')
          expect(miniDot()).toBeNull()
          expect(pill().querySelectorAll('button')).toHaveLength(0)
          expect(glyph()).toBe('check')
          expect(visibleLabel()).toBe('')
          expect(label().querySelector('.uw-sr-only')!.textContent).toBe('Saved to UniWork')
          expect(pill().getAttribute('tabindex')).toBe('0')
          expect(pill().getAttribute('aria-describedby')).toBeTruthy()
          expect(pill().getAttribute('title')).toContain('Saved')
        })

        it('colour is never the only cue: each tone has its own shape', async () => {
          await mountMini()
          const shapes: Record<string, string | null | undefined> = {}
          for (const [name, state] of [
            ['ok', 'saved'],
            ['info', 'queued'],
            ['warn', 'conflict'],
            ['error', 'failed'],
            ['busy', 'saving'],
            ['neutral', 'dirty'],
          ] as const) {
            await mount(status({ state }))
            expect(variant(), name).toBe('mini')
            shapes[name] = glyph()
            expect(shapes[name], name).toBeTruthy()
          }
          expect(new Set(Object.values(shapes)).size).toBe(6)
          expect(shapes.ok).toBe('check')
          expect(shapes.info).toBe('clock')
          expect(shapes.error).toBe('alert')
          expect(shapes.busy).toBe('busy')
        })

        it('a change of state while mini is still said in full, once', async () => {
          await mountMini(status({ state: 'saved' }))
          expect(variant()).toBe('mini')
          await mount(status({ state: 'queued' }))
          expect(polite()).toBe(`Plan: ${en.uwChipQueued}`)
        })

        it('room returning restores upward: the dot, the compact pill, the short and the full one', async () => {
          await mountMini()
          expect(variant()).toBe('mini')
          const seen = [variant()]
          for (const w of [800, 890, 1024, 1280]) {
            await resizeTo(w)
            seen.push(variant())
          }
          const rank = { mini: 3, compact: 2, short: 1, full: 0 } as const
          const ranks = seen.map((v) => rank[v as keyof typeof rank])
          expect([...ranks].sort((a, b) => b - a)).toEqual(ranks)
          expect(seen[seen.length - 1]).toBe('full')
          await resizeTo(722)
          expect(variant()).toBe('mini')
        })

        it('closing a tab gives the dot back its compact pill', async () => {
          await mountMini(status(), 722)
          expect(variant()).toBe('mini')
          await act(async () => {
            strip.querySelectorAll('.tab-item:not(.tab-home)')[2].remove()
          })
          await flush()
          expect(variant()).not.toBe('mini')
        })

        it('no flip-flop across the whole sweep of widths: the steps come once each, in order', async () => {
          buildBar(3)
          stubLayout()
          barWidth = 700
          await mountBoth(status())
          const forms: string[] = []
          for (let w = 700; w <= 1150; w++) {
            await resizeTo(w)
            const form = `${variant()}${iconOnly() ? '+icon' : ''}`
            forms.push(form)
            await act(async () => {
              window.dispatchEvent(new Event('resize'))
            })
            await flush()
            expect(`${variant()}${iconOnly() ? '+icon' : ''}`, `${w}px again`).toBe(form)
          }
          const steps = forms.filter((f, i) => i === 0 || f !== forms[i - 1])
          expect(steps).toEqual(['mini+icon', 'compact+icon', 'compact', 'short', 'full'])
        })

        it('does not keep measuring once the dot has settled', async () => {
          await mountMini()
          const settled = rectCalls
          await flush()
          await flush()
          expect(rectCalls).toBe(settled)
        })
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
    await act(async () => opener()!.click())
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
    await act(async () => opener()!.click())
    await flush()
    expect(leftOf()).toBe(8)
  })

  it('a pill at the window edge keeps the dialog in the right gutter', async () => {
    buildBar(2)
    stubLayout()
    barWidth = 890
    pillRightOverride = 890
    await mount(status())
    await act(async () => opener()!.click())
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
    await act(async () => opener()!.click())
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
    await act(async () => opener()!.click())
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
      await act(async () => opener()!.click())
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

describe('G5-06u-TS: the compact strip at UI scale 1.25 (V6u8-02)', () => {
  async function mountWith(s: UniworkDocStatus, withToggle: boolean): Promise<void> {
    noToggleModel = !withToggle
    if (withToggle) (window as unknown as Record<string, unknown>)[DISCUSSION_BRIDGE_KEY] = {}
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(UniworkLiveHost),
          createElement(
            PillFitScope,
            null,
            withToggle ? createElement(DiscussionToggle, { status: s }) : null,
            createElement(UniworkStatusChip, { key: s.path, status: s, onStatus: () => undefined }),
          ),
        ),
      )
    })
    await flush()
  }

  const iconOnly = () =>
    chrome.querySelector('.uw-discussion-toggle')?.getAttribute('data-icon-only') === 'true'

  /** the third tab's visible window px: the strip's padding, Home 40, the active 104 and an inactive 80 before it */
  function lastTabPx(): number {
    const room = strip.getBoundingClientRect().width - (10 + COMPACT_HOME + TAB_MIN + 80) * uiScale
    return Math.max(0, Math.min(80 * uiScale, room))
  }

  function assertApart(tag: string): void {
    const s = strip.getBoundingClientRect()
    const c = chrome.getBoundingClientRect()
    if (isRtl()) expect(c.right, tag).toBeLessThanOrEqual(s.left)
    else expect(s.right, tag).toBeLessThanOrEqual(c.left)
  }

  for (const dir of ['ltr', 'rtl'] as const) {
    it(`${dir}: 722 / 800 x 3 tabs, toggle shown and none: the step, the toggle form, the last tab px / label px`, async () => {
      document.documentElement.dir = dir
      // RTL: the title starts 32 in (physical padding) and 12 + the close follow it
      if (dir === 'rtl') {
        tabLabelStart = 32
        tabTail = 36
      }
      const cells: string[] = []
      for (const w of [722, 800]) {
        for (const withToggle of [true, false]) {
          document.body.innerHTML = ''
          rectSpy?.mockRestore()
          uiScale = 1.25
          compactModel = true
          document.documentElement.style.setProperty('--ui-scale', '1.25')
          buildBar(3)
          stubLayout()
          barWidth = w
          await mountWith(status(), withToggle)
          const tag = `${dir} ${w}${withToggle ? '+t' : ''}`
          assertApart(tag)
          const px = lastTabPx()
          const labelPx = Math.min(36 * uiScale, px - tabLabelStart * uiScale)
          expect(px, tag).toBeGreaterThanOrEqual((tabLabelStart + 36) * uiScale)
          expect(labelPx, tag).toBe(45)
          cells.push(`${w}${withToggle ? '+t' : ''} ${variant()}${iconOnly() ? '+icon' : ''} ${px}`)
          act(() => root.unmount())
        }
      }
      expect(cells).toEqual([
        '722+t mini+icon 91.5',
        '722 mini 100',
        '800+t mini+icon 100',
        '800 compact 100',
      ])
    })
  }

  it('the strip changing form (data-strip on the bar) measures the pill again', async () => {
    buildBar(3)
    stubLayout()
    barWidth = 800
    await mountWith(status(), true)
    const settled = rectCalls
    await flush()
    expect(rectCalls).toBe(settled)
    await act(async () => {
      bar.setAttribute('data-strip', 'compact')
    })
    await flush()
    expect(rectCalls).toBeGreaterThan(settled)
  })
})

/**
 * VTS1-01 (Advisor option B, "tabs win over pill text"): at UI scale 1.25 the caption spacer fix
 * returned caption x 0.25 = 34.5 win px to the bar and the pill-fit spent it on a wider pill or toggle
 * form. With the spacer on the bar, the fit holds that room back from the pill's steps: every cell
 * takes the step d8af19b01 took (the caption reserved x 1.25, no spacer to read), so the strip is
 * 34.5 wider and the last tab never narrower. Widths: the stub's pill, and the queued label as the
 * visual run measured it at 1.25 (en, ar), in CSS px.
 */
describe('VTS1-01: at UI scale 1.25 the returned caption room goes to the tabs', () => {
  const S = 1.25
  const SETS = [
    { name: 'stub', dir: 'ltr', pill: PILL, toggle: { full: TOGGLE, icon: TOGGLE_ICON } },
    {
      name: 'en',
      dir: 'ltr',
      pill: { full: 392.6 / S, short: 239.9 / S, compact: 147.3 / S, mini: 28 },
      toggle: { full: 126.2 / S, icon: 39.1 / S },
    },
    {
      name: 'ar',
      dir: 'rtl',
      pill: { full: 510.7 / S, short: 342.7 / S, compact: 187.6 / S, mini: 28 },
      toggle: { full: 110.5 / S, icon: 39.1 / S },
    },
  ] as const

  async function mountWith(s: UniworkDocStatus, withToggle: boolean): Promise<void> {
    noToggleModel = !withToggle
    if (withToggle) (window as unknown as Record<string, unknown>)[DISCUSSION_BRIDGE_KEY] = {}
    else delete (window as unknown as Record<string, unknown>)[DISCUSSION_BRIDGE_KEY]
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(UniworkLiveHost),
          createElement(
            PillFitScope,
            null,
            withToggle ? createElement(DiscussionToggle, { status: s }) : null,
            createElement(UniworkStatusChip, { key: s.path, status: s, onStatus: () => undefined }),
          ),
        ),
      )
    })
    await flush()
  }

  const iconOnly = () =>
    chrome.querySelector('.uw-discussion-toggle')?.getAttribute('data-icon-only') === 'true'

  function apart(tag: string): void {
    const s = strip.getBoundingClientRect()
    const c = chrome.getBoundingClientRect()
    if (isRtl()) expect(c.right, tag).toBeLessThanOrEqual(s.left)
    else expect(s.right, tag).toBeLessThanOrEqual(c.left)
  }

  /** lay the bar out afresh at this scale and width and mount the queued pill */
  async function cell(opts: {
    set: (typeof SETS)[number]
    w: number
    n: number
    withToggle: boolean
    preFix: boolean
    compact?: boolean
  }): Promise<{ step: string; strip: number }> {
    document.body.innerHTML = ''
    rectSpy?.mockRestore()
    document.documentElement.dir = opts.set.dir
    uiScale = S
    document.documentElement.style.setProperty('--ui-scale', String(S))
    compactModel = opts.compact ?? false
    homeCss = 144.8
    pillSet = opts.set.pill
    toggleSet = opts.set.toggle
    preFixCaption = opts.preFix
    captionSpacer = !opts.preFix
    buildBar(opts.n)
    stubLayout()
    barWidth = opts.w
    await mountWith(status(), opts.withToggle)
    const out = {
      step: `${variant()}${iconOnly() ? '+icon' : ''}`,
      strip: strip.getBoundingClientRect().width,
    }
    return out
  }

  it('1.25 x 1024 / 1280 x 1-3 tabs x toggle none / shown, en + ar: the d8af19b01 step, a strip 34.5 wider, the last tab no narrower, 0 overlap', async () => {
    const changed: string[] = []
    for (const set of SETS) {
      for (const w of [1024, 1280]) {
        for (const n of [1, 2, 3]) {
          for (const withToggle of [false, true]) {
            const tag = `${set.name} ${w} x ${n}${withToggle ? ' +t' : ''}`
            const before = await cell({ set, w, n, withToggle, preFix: true })
            act(() => root.unmount())
            const after = await cell({ set, w, n, withToggle, preFix: false })
            apart(tag)
            // the room the last tab has past the strip's padding, Home and the tabs before it
            const lastRoom = (stripPx: number) => stripPx - (10 + 144.8 + TAB_MIN * (n - 1)) * S
            expect(lastRoom(after.strip), tag).toBeGreaterThanOrEqual(lastRoom(before.strip))
            if (after.step !== before.step) changed.push(`${tag}: ${before.step} -> ${after.step}`)
            else expect(after.strip - before.strip, tag).toBeCloseTo(CAPTION * (S - 1), 6)
            act(() => root.unmount())
          }
        }
      }
    }
    expect(changed).toEqual([])
  })

  it('the compact strip at 1.25 x 722 / 800 / 890 x 3 with the spacer read: a pill no wider, the last tab past 90 (LTR) / 85 (RTL), label 45', async () => {
    const rank = ['mini', 'compact', 'short', 'full']
    const cells: string[] = []
    for (const set of SETS) {
      if (set.dir === 'rtl') {
        tabLabelStart = 32
        tabTail = 36
      } else {
        tabLabelStart = 36
        tabTail = 32
      }
      for (const w of [722, 800, 890]) {
        for (const withToggle of [true, false]) {
          const tag = `${set.name} ${w}${withToggle ? '+t' : ''}`
          // the same compact bar without the spacer to read: the step the fit took before VTS1-01
          captionSpacer = false
          document.body.innerHTML = ''
          rectSpy?.mockRestore()
          document.documentElement.dir = set.dir
          uiScale = S
          document.documentElement.style.setProperty('--ui-scale', String(S))
          compactModel = true
          pillSet = set.pill
          toggleSet = set.toggle
          preFixCaption = false
          buildBar(3)
          stubLayout()
          barWidth = w
          await mountWith(status(), withToggle)
          const was = { variant: variant()!, icon: iconOnly() }
          act(() => root.unmount())
          await cell({ set, w, n: 3, withToggle, preFix: false, compact: true })
          apart(tag)
          expect(rank.indexOf(variant()!), tag).toBeLessThanOrEqual(rank.indexOf(was.variant))
          expect(Number(iconOnly()), tag).toBeGreaterThanOrEqual(Number(was.icon))
          const room = strip.getBoundingClientRect().width - (10 + COMPACT_HOME + TAB_MIN + 80) * S
          const px = Math.max(0, Math.min(80 * S, room))
          expect(px, tag).toBeGreaterThanOrEqual(set.dir === 'rtl' ? 85 : 90)
          expect(Math.min(36 * S, px - tabLabelStart * S), tag).toBe(45)
          cells.push(`${tag} ${variant()}${iconOnly() ? '+icon' : ''} ${px}`)
          act(() => root.unmount())
        }
      }
    }
    expect(cells.length).toBe(18)
  })

  it('at scale 1 the spacer changes nothing: the same step and strip with and without it', async () => {
    for (const w of [722, 800, 890, 1024, 1280]) {
      for (const n of [1, 2, 3]) {
        for (const withToggle of [true, false]) {
          const tag = `${w} x ${n}${withToggle ? ' +t' : ''}`
          const read = async (spacer: boolean) => {
            document.body.innerHTML = ''
            rectSpy?.mockRestore()
            captionSpacer = spacer
            buildBar(n)
            stubLayout()
            barWidth = w
            await mountWith(status(), withToggle)
            const out = `${variant()}${iconOnly() ? '+icon' : ''} ${strip.getBoundingClientRect().width}`
            act(() => root.unmount())
            return out
          }
          expect(await read(true), tag).toBe(await read(false))
        }
      }
    }
  })
})
