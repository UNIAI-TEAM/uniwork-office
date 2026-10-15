import { uiScaleOf } from './uniwork-top-inset'

/**
 * How much of the tab bar the Save pill may take (U-1). The pill sits in the strip's flex row, in
 * the holder `.uw-chrome` right of the scrolling tab strip, so it can never be drawn over a tab;
 * what it could do (a 310px label) was starve the strip down to one tab. The pill therefore
 * degrades by the room it has, in three steps: the full label, the label's short form, then the
 * dot (or spinner) with the action button. The full sentence stays in the title, the visually
 * hidden description and the label's hidden text, whatever is drawn.
 */

export type PillVariant = 'full' | 'short' | 'compact'

/** the natural width of each variant of one label, as measured (a variant not tried yet is absent) */
export type PillWidths = Partial<Record<PillVariant, number>>

/** the strip keeps the room of Home and this many document tabs; more of them scroll */
export const PILL_STRIP_TABS = 3

/** a document tab's width at its minimum (`.tab-item { min-width }` in tabbar.css) when it is not computed */
const TAB_MIN_FALLBACK_PX = 104
/** `.tab-strip` horizontal padding, both sides, when it is not computed */
const STRIP_PADDING_FALLBACK_PX = 20
/** `.tab-new-btn` margin-left when it is not computed */
const NEW_BUTTON_GAP_FALLBACK_PX = 4

/**
 * The text before the first separator the catalogue puts between a state and what follows it
 * ("Save queued — not on UniWork yet", "Blocked: {reason}", "Can't reach UniWork · not saved"), or
 * the whole label when it has none, or would be left empty.
 */
export function shortLabelOf(label: string): string {
  const at = label.search(/\s[—–·]\s|[:：]\s?/)
  if (at <= 0) return label
  const head = label.slice(0, at).trim()
  return head || label
}

export interface StripFloorInput {
  /** the Home tab's width (it never shrinks) */
  home: number
  /** a document tab's minimum width */
  tabMin: number
  docTabs: number
  /** the strip's horizontal padding */
  padding: number
  /** the "+" button with its margin */
  newButton: number
}

/** the room the tab strip keeps for its tabs: Home, up to three document tabs at their minimum, "+" */
export function stripFloorOf(input: StripFloorInput): number {
  const tabs = Math.min(Math.max(0, input.docTabs), PILL_STRIP_TABS)
  return input.home + tabs * input.tabMin + input.padding + input.newButton
}

/**
 * The width the pill may take: what the strip and the holder share, less the floor of the strip,
 * less the rest of the holder (the Discussion toggle, the launch notice and the gaps). Never negative.
 */
export function pillBudgetOf(input: { shared: number; floor: number; others: number }): number {
  const room = input.shared - input.floor - input.others
  return Number.isFinite(room) && room > 0 ? room : 0
}

/**
 * The variant to draw next: the widest one whose measured width fits the budget. A variant that was
 * never drawn has no width yet and is tried before a narrower one is taken (the caller draws it,
 * measures it and asks again), so no width is ever guessed. The icon + action variant is the last
 * resort and stays even when it does not fit either. An unusable budget (a host that cannot
 * measure) keeps the full pill.
 */
export function nextPillVariantOf(
  budget: number,
  widths: PillWidths,
  has: { short: boolean },
): PillVariant {
  if (!Number.isFinite(budget)) return 'full'
  const wide: PillVariant[] = has.short ? ['full', 'short'] : ['full']
  for (const variant of wide) {
    const width = widths[variant]
    if (width === undefined || width <= budget) return variant
  }
  return 'compact'
}

export interface BarLayoutInput {
  barWidth: number
  /** fixed items left of the strip (drag spacer, menu button) */
  left: number
  /** fixed items right of the holder (overflow button, caption buttons), without the holder's margins */
  right: number
  /** the holder's own margins (left and right) */
  margins: number
  home: number
  tabMin: number
  docTabs: number
  padding: number
  newButton: number
  /** the rest of the holder besides the pill (the Discussion toggle and the gap) */
  toggle: number
  pill: PillWidths
  hasShort: boolean
}

export interface BarLayout {
  variant: PillVariant
  strip: { left: number; right: number }
  chrome: { left: number; right: number }
}

/**
 * The tab bar's flex row as tabbar.css lays it out: the strip takes what the holder leaves, the
 * holder is as wide as its content. Used to state, and test, where the strip and the pill end up
 * at a window width; the component measures the real elements and applies the same rules.
 */
export function barLayoutOf(input: BarLayoutInput): BarLayout {
  const shared = input.barWidth - input.left - input.right - input.margins
  const floor = stripFloorOf(input)
  const budget = pillBudgetOf({ shared, floor, others: input.toggle })
  const variant = nextPillVariantOf(budget, input.pill, { short: input.hasShort })
  const chromeWidth = input.toggle + (input.pill[variant] ?? 0)
  const stripWidth = Math.max(0, shared - chromeWidth)
  const stripRight = input.left + stripWidth
  // the holder's left margin is 6 of the margins
  const chromeLeft = stripRight + 6
  return {
    variant,
    strip: { left: input.left, right: stripRight },
    chrome: { left: chromeLeft, right: chromeLeft + chromeWidth },
  }
}

function px(value: string | undefined): number {
  const n = Number.parseFloat(value ?? '')
  return Number.isFinite(n) ? n : Number.NaN
}

/**
 * Read the pill's room off the real bar: the budget it may take and its own natural width in
 * window px. Null when there is nothing to measure (no strip, or no layout at all).
 */
export function measurePillFit(group: HTMLElement): { budget: number; natural: number } | null {
  const chrome = group.parentElement
  const bar = chrome?.parentElement
  if (!chrome || !bar) return null
  const strip = Array.from(bar.children).find((child) => child.classList.contains('tab-strip')) as
    HTMLElement | undefined
  if (!strip) return null
  const scale = uiScaleOf(group)
  const pillWidth = group.getBoundingClientRect().width
  const chromeWidth = chrome.getBoundingClientRect().width
  const stripWidth = strip.getBoundingClientRect().width
  if (!(pillWidth > 0) || !(chromeWidth > 0) || !(stripWidth >= 0)) return null

  const home = strip.querySelector('.tab-home')?.getBoundingClientRect().width ?? 0
  const docTabs = strip.querySelectorAll('.tab-item:not(.tab-home)')
  const firstDoc = docTabs.item(0)
  const stripStyle = getComputedStyle(strip)
  const padding = px(stripStyle.paddingLeft) + px(stripStyle.paddingRight)
  const newButton = strip.querySelector('.tab-new-btn')
  const newStyle = newButton ? getComputedStyle(newButton) : undefined
  const tabMin = firstDoc ? px(getComputedStyle(firstDoc).minWidth) : Number.NaN
  const floor = stripFloorOf({
    home,
    tabMin: (Number.isFinite(tabMin) ? tabMin : TAB_MIN_FALLBACK_PX) * scale,
    docTabs: docTabs.length,
    padding: (Number.isFinite(padding) ? padding : STRIP_PADDING_FALLBACK_PX) * scale,
    newButton:
      (newButton?.getBoundingClientRect().width ?? 0) +
      (Number.isFinite(px(newStyle?.marginLeft))
        ? px(newStyle?.marginLeft)
        : NEW_BUTTON_GAP_FALLBACK_PX) *
        scale,
  })
  const budget = pillBudgetOf({
    shared: stripWidth + chromeWidth,
    floor,
    others: chromeWidth - pillWidth,
  })
  // the label is the part that gives way (it ellipsizes): its hidden overflow is width the pill wants
  const label = group.querySelector<HTMLElement>('.uw-pill-label')
  const clipped = label ? Math.max(0, label.scrollWidth - label.clientWidth) : 0
  return { budget, natural: pillWidth + clipped }
}
