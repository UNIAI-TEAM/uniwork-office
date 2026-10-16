import { uiScaleOf } from './uniwork-top-inset'

/**
 * How much of the tab bar the Save pill may take (U-1). The pill sits in the strip's flex row, in
 * the holder `.uw-chrome` right of the scrolling tab strip, so it can never be drawn over a tab;
 * what it could do (a 310px label) was starve the strip down to one tab. The pill therefore
 * degrades by the room it has, in four steps: the full label, the label's short form, the
 * dot (or spinner) with the action button, then the dot alone, which is the button itself. The
 * dot alone is the last step and has a looser floor than the others: it is only taken when the strip
 * cannot show the last tab's label either (`miniSlackOf`). The full sentence stays in the title, the
 * visually hidden description and the label's hidden text, whatever is drawn.
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
/** a document tab's title starts this far into the tab (padding, icon, gap) when it is not measured */
const TAB_LABEL_START_FALLBACK_PX = 36
/** a document tab's title is this wide at the tab's minimum width when it is not measured */
const TAB_LABEL_MIN_FALLBACK_PX = 36

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
  /** the Home tab's width (it does not shrink; the compact strip draws it as its icon) */
  home: number
  /** a document tab's minimum width */
  tabMin: number
  /**
   * each counted document tab's own minimum, in strip order (the compact strip gives the inactive
   * tabs a narrower one, G5-06u-TS); a tab missing here has `tabMin`
   */
  tabMins?: readonly number[]
  docTabs: number
  /** the strip's horizontal padding */
  padding: number
  /** the "+" button with its margin */
  newButton: number
}

function countedTabsOf(input: StripFloorInput): number {
  return Math.min(Math.max(0, input.docTabs), PILL_STRIP_TABS)
}

/** the minimum of the counted document tab at `index` */
function tabMinAt(input: StripFloorInput, index: number): number {
  return input.tabMins?.[index] ?? input.tabMin
}

/** the room the tab strip keeps for its tabs: Home, up to three document tabs at their minimum, "+" */
export function stripFloorOf(input: StripFloorInput): number {
  let tabs = 0
  for (let i = 0; i < countedTabsOf(input); i++) tabs += tabMinAt(input, i)
  return input.home + tabs + input.padding + input.newButton
}

/** where the last counted document tab's title starts and how wide it is at that tab's minimum width */
export interface TabLabelInput {
  /** from the tab's leading edge to the title's start (padding, icon, gap) */
  labelStart: number
  /** the title's width at the tab's minimum width: the smallest label the tab shows */
  labelMin: number
}

/**
 * How much of the strip's floor the dot-only step does not need. The floor keeps three whole tabs
 * and the "+" so that a pill beside a strip never costs a tab; the dot alone is the step that
 * gives up on part of that. The last tab only needs its label start and a minimum readable label
 * (not the close button and the padding after it), and the "+" and the end padding may scroll out
 * of the strip. So the mini step is taken only when the strip is shorter than the floor by more
 * than this. The other steps keep the full floor. No tab, nothing to loosen.
 */
export function miniSlackOf(input: StripFloorInput & TabLabelInput): number {
  if (!(input.docTabs > 0)) return 0
  const last = tabMinAt(input, countedTabsOf(input) - 1)
  const pastLabel = Math.max(0, last - input.labelStart - input.labelMin)
  return pastLabel + input.newButton + input.padding / 2
}

/**
 * What the strip and the holder share, less the floor of the strip, less the rest of the holder
 * (the Discussion toggle, the launch notice and the gaps): the room the pill has, negative by how
 * far the strip is below its floor without any pill at all. The steps are decided on this, not on
 * the clamped budget: the dot-only step has a slack, and a clamp would hide how much of it is used.
 */
export function pillRoomOf(input: { shared: number; floor: number; others: number }): number {
  const room = input.shared - input.floor - input.others
  return Number.isFinite(room) ? room : 0
}

/**
 * The room the pill's steps hold back for the tabs at UI scale > 1 (VTS1-01, tabs win over pill
 * text). Before the caption spacer fix (G5-06u-TS) the spacer reserved the caption x scale, caption
 * x (scale - 1) window px too much; the fix gave that room back to the bar, and the fit spent it on a
 * wider pill or toggle form, so the last tab lost width. The pill now takes the step it took with
 * the old reservation and the room goes to the strip. The caption is the spacer's own width, which
 * the steps do not move. Scale 1 (or no caption): nothing.
 */
export function captionReserveOf(caption: number, scale: number): number {
  if (!(caption > 0) || !(scale > 1)) return 0
  return caption * (scale - 1)
}

/** The width the pill may take: the room, never negative. */
export function pillBudgetOf(input: { shared: number; floor: number; others: number }): number {
  return Math.max(0, pillRoomOf(input))
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
  /** the pill's room (`pillRoomOf`, may be negative) as measured with the toggle drawn the way it is now */
  budget: number
  /** the toggle as drawn now; null when the holder has none (nothing to give up, no icon form) */
  toggle: { width: number; iconOnly: boolean } | null
  /** both forms measured so far, this measure included */
  toggleWidths: ToggleWidths
  widths: PillWidths
  hasShort: boolean
  /** room the dot-only step may count on beyond the budget (`miniSlackOf`); absent: none */
  miniSlack?: number
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
 * toggle to give), even with the slack the last tab can do without (`miniSlack`), the pill itself
 * becomes the dot alone (`mini`), the last step. Only that step has the slack; the toggle and the
 * wider steps keep the full floor. Every threshold is read off the room the holder would have with
 * the toggle drawn FULL (an icon-only toggle is measured, then its saving is taken back out)
 * against the compact pill's own width: the same
 * inputs give the same answer whichever form is drawn, so a boundary cannot flip back and forth.
 * With the full width of the toggle not known yet (it is drawn icon-only from the start) the toggle
 * is first drawn full and measured; with its icon width not known yet it is first drawn icon-only.
 */
export function pillFitStepOf(input: PillFitStepInput): PillFitStep {
  const { toggle, toggleWidths, widths, hasShort } = input
  const slack = Math.max(0, input.miniSlack ?? 0)
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
  if (toggle === null) {
    return budget + slack < compact
      ? { variant: 'mini', iconToggle: false }
      : { variant: 'compact', iconToggle: false }
  }
  const { full, icon } = toggleWidths
  if (full === undefined) return { variant: 'compact', iconToggle: false }
  if (icon === undefined) return { variant: 'compact', iconToggle: true }
  return budget + slack + (full - icon) < compact
    ? { variant: 'mini', iconToggle: true }
    : { variant: 'compact', iconToggle: true }
}

/** the warn chip's cap in CSS px: a wide bar never gives the non-urgent size heads-up more than this */
export const WARN_CHIP_MAX_PX = 240
/** the warn chip shrinks and ellipsizes down to this minimum (CSS px) before the save pill steps down */
export const WARN_CHIP_MIN_PX = 88

/**
 * The width (in unscaled CSS px) the `.uw-size-warn` chip may take beside the save pill:
 * capped at `WARN_CHIP_MAX_PX` (240px), shrinking down to `WARN_CHIP_MIN_PX` (88px) to leave
 * the save pill its chosen variant before the save pill ever steps down.
 */
export function warnChipMaxOf(input: {
  /** room in window px shared by the save pill and the warn chip (excluding the gap between them) */
  room: number
  /** the save pill's width in window px for its chosen variant */
  pillWidth: number
  /** interface scale (`uiScaleOf`) */
  scale?: number
}): number {
  const s = Number.isFinite(input.scale) && input.scale! > 0 ? input.scale! : 1
  const spare = (input.room - input.pillWidth) / s
  if (!Number.isFinite(spare)) return WARN_CHIP_MAX_PX
  return Math.max(WARN_CHIP_MIN_PX, Math.min(WARN_CHIP_MAX_PX, Math.floor(spare)))
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
  /** each counted tab's own minimum (`StripFloorInput.tabMins`); absent: `tabMin` each */
  tabMins?: readonly number[]
  docTabs: number
  padding: number
  newButton: number
  /** the rest of the holder besides the pill (the Discussion toggle and the gap) */
  toggle: number
  /** the toggle's width without its label; absent: the holder has no toggle to shrink */
  toggleIcon?: number
  /** the last counted tab's title start and minimum width; absent: the stylesheet's 36 and 36 */
  labelStart?: number
  labelMin?: number
  pill: PillWidths
  hasShort: boolean
  /** room the steps hold back for the tabs (`captionReserveOf`); absent: none */
  captionReserve?: number
  /** natural width of `.uw-size-warn` (window px) when present; shrinks before the save pill steps down */
  warnChip?: number
  /** gap before `.uw-size-warn` (window px); defaults to `6 * scale` */
  warnGap?: number
  /** interface scale for `warnChip` bounds; defaults to 1 */
  scale?: number
}

export interface BarLayout {
  variant: PillVariant
  /** the Discussion toggle is drawn icon-only */
  iconToggle: boolean
  /** drawn width of `.uw-size-warn` (window px) when `warnChip` was given */
  warnWidth?: number
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
  const scale = input.scale ?? 1
  const hasWarn = typeof input.warnChip === 'number' && input.warnChip > 0
  const warnCap = hasWarn ? Math.min(input.warnChip!, WARN_CHIP_MAX_PX * scale) : 0
  const warnMin = hasWarn ? Math.min(warnCap, WARN_CHIP_MIN_PX * scale) : 0
  const warnGap = hasWarn ? (input.warnGap ?? 6 * scale) : 0
  const budget =
    pillRoomOf({ shared, floor, others: input.toggle + warnGap + warnMin }) -
    (input.captionReserve ?? 0)
  const hasToggle = input.toggleIcon !== undefined && input.toggle > 0
  const step = pillFitStepOf({
    budget,
    toggle: hasToggle ? { width: input.toggle, iconOnly: false } : null,
    toggleWidths: { full: input.toggle, icon: input.toggleIcon },
    widths: input.pill,
    hasShort: input.hasShort,
    miniSlack: miniSlackOf({
      ...input,
      labelStart: input.labelStart ?? TAB_LABEL_START_FALLBACK_PX,
      labelMin: input.labelMin ?? TAB_LABEL_MIN_FALLBACK_PX,
    }),
  })
  const { variant, iconToggle } = step
  const toggleDrawn = iconToggle ? (input.toggleIcon ?? 0) : input.toggle
  const pillDrawn = input.pill[variant] ?? 0
  const warnRoom = hasWarn
    ? pillRoomOf({ shared, floor, others: toggleDrawn + warnGap }) - (input.captionReserve ?? 0)
    : 0
  const warnWidth = hasWarn
    ? Math.max(
        warnMin,
        Math.min(warnCap, warnChipMaxOf({ room: warnRoom, pillWidth: pillDrawn, scale }) * scale),
      )
    : 0
  const chromeWidth = toggleDrawn + (hasWarn ? warnGap + warnWidth : 0) + pillDrawn
  const stripWidth = Math.max(0, shared - chromeWidth)
  const stripRight = input.left + stripWidth
  // the holder's left margin is 6 of the margins
  const chromeLeft = stripRight + 6
  return {
    variant,
    iconToggle,
    ...(hasWarn ? { warnWidth } : {}),
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
  miniSlack: number
  warnRoom: number | null
  scale: number
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
  // each counted tab's own minimum (the compact strip's inactive tabs have a narrower one); the
  // stylesheet is the one source, the fallback only stands in where it is not computed
  const counted = Array.from(docTabs).slice(0, PILL_STRIP_TABS)
  const tabMins = counted.map((tab) => {
    const min = px(getComputedStyle(tab).minWidth)
    return (Number.isFinite(min) ? min : TAB_MIN_FALLBACK_PX) * scale
  })
  const lastCounted = counted[counted.length - 1] ?? null
  const stripStyle = getComputedStyle(strip)
  const padding = px(stripStyle.paddingLeft) + px(stripStyle.paddingRight)
  const newButton = strip.querySelector('.tab-new-btn')
  const newStyle = newButton ? getComputedStyle(newButton) : undefined
  const floorInput: StripFloorInput = {
    home,
    tabMin: tabMins[0] ?? TAB_MIN_FALLBACK_PX * scale,
    tabMins,
    docTabs: docTabs.length,
    padding: (Number.isFinite(padding) ? padding : STRIP_PADDING_FALLBACK_PX) * scale,
    newButton:
      (newButton?.getBoundingClientRect().width ?? 0) +
      (Number.isFinite(px(newStyle?.marginLeft))
        ? px(newStyle?.marginLeft)
        : NEW_BUTTON_GAP_FALLBACK_PX) *
        scale,
  }
  const floor = stripFloorOf(floorInput)
  const miniSlack = miniSlackOf({
    ...floorInput,
    ...labelOf(lastCounted, tabMins[tabMins.length - 1] ?? floorInput.tabMin, scale),
  })
  // TabBar's caption spacer (G5-06u-TS): its width is the caption's, whatever the pill does
  const spacer = Array.from(bar.children).find((child) =>
    child.classList.contains('tab-bar-caption-spacer'),
  )
  const caption = spacer?.getBoundingClientRect().width ?? 0
  // `.uw-size-warn` yields to the save pill (SIZE-v1-4): reserve only its minimum (`WARN_CHIP_MIN_PX`)
  // before stepping the save pill down, and give the warn chip whatever room the save pill leaves
  const warnEl = Array.from(chrome.children).find((child) =>
    child.classList.contains('uw-size-warn'),
  ) as HTMLElement | undefined
  const warnWidth = warnEl?.getBoundingClientRect().width ?? 0
  const hasWarn = Boolean(warnEl && warnWidth > 0)
  const warnLabel = warnEl?.querySelector<HTMLElement>('.uw-pill-label')
  const warnClipped = warnLabel ? Math.max(0, warnLabel.scrollWidth - warnLabel.clientWidth) : 0
  const warnNatural = warnWidth + warnClipped
  const warnMin = hasWarn
    ? Math.min(
        WARN_CHIP_MAX_PX * scale,
        warnNatural > 0
          ? Math.min(warnNatural, WARN_CHIP_MIN_PX * scale)
          : WARN_CHIP_MIN_PX * scale,
      )
    : 0
  const othersWithoutWarn = Math.max(0, chromeWidth - pillWidth - (hasWarn ? warnWidth : 0))
  const combinedRoom =
    pillRoomOf({
      shared: stripWidth + chromeWidth,
      floor,
      others: othersWithoutWarn,
    }) - captionReserveOf(caption, scale)
  const budget = combinedRoom - warnMin
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
  return {
    budget,
    natural: pillWidth + clipped,
    toggle,
    miniSlack,
    warnRoom: hasWarn ? combinedRoom : null,
    scale,
  }
}

/**
 * Where the last counted document tab's title starts and how wide it is at its own minimum width, read
 * off the DOM by the page's direction (the title starts on the right in right-to-left). The width at
 * the minimum is what the tab leaves after the start and after the title (the close button and the
 * padding), since the title is the part that flexes. A tab with no title yet (the rename input) or
 * no layout has the stylesheet's constants.
 */
function labelOf(tab: Element | null, tabMin: number, scale: number): TabLabelInput {
  const fallback = {
    labelStart: TAB_LABEL_START_FALLBACK_PX * scale,
    labelMin: TAB_LABEL_MIN_FALLBACK_PX * scale,
  }
  const title = tab?.querySelector('.tab-title')
  if (!tab || !title) return fallback
  const tabRect = tab.getBoundingClientRect()
  const titleRect = title.getBoundingClientRect()
  if (!(tabRect.width > 0) || !(titleRect.width > 0)) return fallback
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'
  const start = rtl ? tabRect.right - titleRect.right : titleRect.left - tabRect.left
  const tail = rtl ? titleRect.left - tabRect.left : tabRect.right - titleRect.right
  if (!(start >= 0) || !(tail >= 0)) return fallback
  return { labelStart: start, labelMin: Math.max(0, tabMin - start - tail) }
}
