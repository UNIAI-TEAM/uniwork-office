import { uiScaleOf } from './uniwork-top-inset'

/**
 * How much of the tab bar the Save pill may take (U-1). The pill sits in the strip's flex row, in
 * the holder `.uw-chrome` right of the scrolling tab strip, so it can never be drawn over a tab;
 * what it could do (a 310px label) was starve the strip down to one tab. The pill therefore
 * degrades by the room it has, in four steps: the full label, the label's short form, the
 * dot (or spinner) with the action button, then (only when even that leaves the strip below its
 * floor) the dot alone, which is the button itself. The full sentence stays in the title, the visually
 * hidden description and the label's hidden text, whatever is drawn.
 */

export type PillVariant = 'full' | 'short' | 'compact' | 'mini'

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

/** the Discussion toggle's width in each of its two forms, as measured (a form not drawn yet is absent) */
export interface ToggleWidths {
  full?: number
  icon?: number
}

export interface PillFitStepInput {
  /** the pill's budget as measured with the toggle drawn the way it is now */
  budget: number
  /** the toggle as drawn now; null when the holder has none (nothing to give up, no icon form) */
  toggle: { width: number; iconOnly: boolean } | null
  /** both forms measured so far, this measure included */
  toggleWidths: ToggleWidths
  widths: PillWidths
  hasShort: boolean
}

export interface PillFitStep {
  variant: PillVariant
  /** the Discussion toggle gives up its label (icon only) */
  iconToggle: boolean
}

/**
 * The next step of the holder: which pill variant, and whether the Discussion toggle goes icon-only.
 * When even the icon + action pill does not fit the strip's floor, the toggle is the next thing to
 * give: its label is hidden (name and tooltip stay) and the room goes back to the strip, the pill
 * staying compact. When the compact pill still does not fit with the toggle icon-only (or with no
 * toggle to give), the pill itself becomes the dot alone (`mini`), the last step. Every threshold
 * is read off the budget the holder would have with the toggle drawn FULL (an icon-only toggle is
 * measured, then its saving is taken back out) against the compact pill's own width: the same
 * inputs give the same answer whichever form is drawn, so a boundary cannot flip back and forth.
 * With the full width of the toggle not known yet (it is drawn icon-only from the start) the toggle
 * is first drawn full and measured; with its icon width not known yet it is first drawn icon-only.
 */
export function pillFitStepOf(input: PillFitStepInput): PillFitStep {
  const { toggle, toggleWidths, widths, hasShort } = input
  let budget = input.budget
  if (toggle?.iconOnly) {
    const full = toggleWidths.full
    if (full === undefined) return { variant: 'compact', iconToggle: false }
    budget -= full - toggle.width
  }
  const variant = nextPillVariantOf(budget, widths, { short: hasShort })
  const compact = widths.compact
  if (variant !== 'compact' || compact === undefined || budget >= compact) {
    return { variant, iconToggle: false }
  }
  // the compact pill is the narrowest it can be and the strip is still below its floor
  if (toggle === null) return { variant: 'mini', iconToggle: false }
  const { full, icon } = toggleWidths
  if (full === undefined) return { variant: 'compact', iconToggle: false }
  if (icon === undefined) return { variant: 'compact', iconToggle: true }
  return budget + (full - icon) < compact
    ? { variant: 'mini', iconToggle: true }
    : { variant: 'compact', iconToggle: true }
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
  /** the toggle's width without its label; absent: the holder has no toggle to shrink */
  toggleIcon?: number
  pill: PillWidths
  hasShort: boolean
}

export interface BarLayout {
  variant: PillVariant
  /** the Discussion toggle is drawn icon-only */
  iconToggle: boolean
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
  const hasToggle = input.toggleIcon !== undefined && input.toggle > 0
  const step = pillFitStepOf({
    budget,
    toggle: hasToggle ? { width: input.toggle, iconOnly: false } : null,
    toggleWidths: { full: input.toggle, icon: input.toggleIcon },
    widths: input.pill,
    hasShort: input.hasShort,
  })
  const { variant, iconToggle } = step
  const chromeWidth =
    (iconToggle ? (input.toggleIcon ?? 0) : input.toggle) + (input.pill[variant] ?? 0)
  const stripWidth = Math.max(0, shared - chromeWidth)
  const stripRight = input.left + stripWidth
  // the holder's left margin is 6 of the margins
  const chromeLeft = stripRight + 6
  return {
    variant,
    iconToggle,
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
export function measurePillFit(group: HTMLElement): {
  budget: number
  natural: number
  toggle: { width: number; iconOnly: boolean } | null
} | null {
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
  // the Discussion toggle sits beside the pill in the holder: its drawn width and form
  const toggleEl = Array.from(chrome.children).find((child) =>
    child.classList.contains('uw-discussion-toggle'),
  )
  const toggleWidth = toggleEl?.getBoundingClientRect().width ?? 0
  const toggle =
    toggleEl && toggleWidth > 0
      ? { width: toggleWidth, iconOnly: toggleEl.getAttribute('data-icon-only') === 'true' }
      : null
  return { budget, natural: pillWidth + clipped, toggle }
}
