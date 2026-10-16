import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PILL_STRIP_TABS,
  WARN_CHIP_MAX_PX,
  WARN_CHIP_MIN_PX,
  barLayoutOf,
  captionReserveOf,
  miniSlackOf,
  nextPillVariantOf,
  pillFitStepOf,
  pillBudgetOf,
  pillRoomOf,
  shortLabelOf,
  stripFloorOf,
  warnChipMaxOf,
  type BarLayoutInput,
} from '../src/renderer/src/uniwork-pill-fit'
import { en } from '../src/renderer/src/i18n/sync/en'

/**
 * U-1: the Save pill never takes the room the tabs need. The strip is a flex item next to the
 * pill's holder and already scrolls, so the two never intersect; what the defect showed was the
 * strip squeezed to one tab by a 310px pill. The pill now degrades (full label, short label,
 * icon + action) until the strip keeps the room of its tabs, and these are the pure rules.
 */

describe('U-1: the short label is the state without its qualifier', () => {
  it('cuts at the separator the catalogue puts between the state and what follows', () => {
    expect(shortLabelOf('Save queued — not on UniWork yet')).toBe('Save queued')
    expect(shortLabelOf('Save queued · newer edits')).toBe('Save queued')
    expect(shortLabelOf('Save queued · sending paused')).toBe('Save queued')
    expect(shortLabelOf('Speichern eingereiht – noch nicht in UniWork')).toBe(
      'Speichern eingereiht',
    )
    expect(shortLabelOf('Guardado en cola: aún no está en UniWork')).toBe('Guardado en cola')
    expect(shortLabelOf('未保存：离线')).toBe('未保存')
    expect(shortLabelOf("Can't reach UniWork · not saved")).toBe("Can't reach UniWork")
  })

  it('a label without a separator is its own short label', () => {
    expect(shortLabelOf('Saved to UniWork')).toBe('Saved to UniWork')
    expect(shortLabelOf('Saving…')).toBe('Saving…')
    expect(shortLabelOf('')).toBe('')
  })

  it('a separator at the very start leaves the whole label (never an empty one)', () => {
    expect(shortLabelOf('— odd')).toBe('— odd')
    expect(shortLabelOf(': odd')).toBe(': odd')
  })

  it('every language of the queued labels gets a shorter, non-empty short label', () => {
    const dir = resolve(__dirname, '../src/renderer/src/i18n/sync')
    const langs = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    expect(langs.length).toBeGreaterThanOrEqual(20)
    let shortened = 0
    for (const file of langs) {
      const source = readFileSync(resolve(dir, file), 'utf8')
      for (const key of ['uwChipQueued', 'uwChipQueuedNewer', 'uwChipPausedAdmin']) {
        const match = new RegExp(`${key}: '((?:[^'\\\\]|\\\\.)*)'`).exec(source)
        if (!match) continue
        const full = match[1]
        const short = shortLabelOf(full)
        expect(short.length, `${file} ${key}`).toBeGreaterThan(0)
        expect(short.length, `${file} ${key}`).toBeLessThanOrEqual(full.length)
        if (short !== full) shortened++
      }
    }
    // nearly every shard writes the qualifier after a separator
    expect(shortened).toBeGreaterThan(langs.length * 2)
  })
})

describe('U-1: the room the tabs keep', () => {
  it('is Home, up to three document tabs at their minimum, the strip padding and the new-tab button', () => {
    expect(PILL_STRIP_TABS).toBe(3)
    const base = { home: 121, tabMin: 104, padding: 20, newButton: 32 }
    expect(stripFloorOf({ ...base, docTabs: 0 })).toBe(121 + 20 + 32)
    expect(stripFloorOf({ ...base, docTabs: 1 })).toBe(121 + 104 + 52)
    expect(stripFloorOf({ ...base, docTabs: 2 })).toBe(121 + 208 + 52)
    expect(stripFloorOf({ ...base, docTabs: 3 })).toBe(121 + 312 + 52)
    // more tabs than that scroll: the pill does not give up more room for them
    expect(stripFloorOf({ ...base, docTabs: 9 })).toBe(stripFloorOf({ ...base, docTabs: 3 }))
  })

  it('the pill budget is what both share, minus the floor, minus the rest of the holder; never negative', () => {
    expect(pillBudgetOf({ shared: 654, floor: 381, others: 106 })).toBe(167)
    expect(pillBudgetOf({ shared: 300, floor: 485, others: 106 })).toBe(0)
    expect(pillBudgetOf({ shared: Number.NaN, floor: 100, others: 0 })).toBe(0)
  })
})

describe('U-1: the variant is the widest one that fits the budget', () => {
  const widths = { full: 309, short: 190, compact: 111 }
  const has = { short: true }

  it('picks full, short, then icon + action as the budget shrinks', () => {
    expect(nextPillVariantOf(400, widths, has)).toBe('full')
    expect(nextPillVariantOf(309, widths, has)).toBe('full')
    expect(nextPillVariantOf(308, widths, has)).toBe('short')
    expect(nextPillVariantOf(190, widths, has)).toBe('short')
    expect(nextPillVariantOf(189, widths, has)).toBe('compact')
    expect(nextPillVariantOf(0, widths, has)).toBe('compact')
  })

  it('a variant that was never measured is tried (widest unknown first), never guessed', () => {
    expect(nextPillVariantOf(150, {}, has)).toBe('full')
    expect(nextPillVariantOf(150, { full: 309 }, has)).toBe('short')
    expect(nextPillVariantOf(150, { full: 309, short: 190 }, has)).toBe('compact')
  })

  it('a label with no short form skips that step', () => {
    expect(nextPillVariantOf(200, { full: 150, compact: 30 }, { short: false })).toBe('full')
    expect(nextPillVariantOf(100, { full: 150 }, { short: false })).toBe('compact')
  })

  it('the narrowest variant is the last resort even when it does not fit either', () => {
    expect(nextPillVariantOf(20, widths, has)).toBe('compact')
  })

  it('an unusable budget keeps the full pill (a host that cannot measure)', () => {
    expect(nextPillVariantOf(Number.NaN, widths, has)).toBe('full')
  })
})

/**
 * What the real tab bar measured in Chromium (Windows chrome, en): 8px drag spacer + the 28px menu
 * button (+2) on the left, the 3 caption buttons (138px) + the overflow button (38) on the right,
 * and the holder's own margins (6 + 16). The Home tab is 109px, a document tab 104px at its minimum.
 */
const BAR = {
  left: 40,
  right: 176,
  margins: 22,
  home: 109,
  tabMin: 104,
  padding: 20,
  newButton: 32,
}
/** `mini` is the dot alone: a 28px circle (the pill's height) */
const PILL = { full: 309, short: 190, compact: 111, mini: 28 }

function layout(barWidth: number, docTabs: number, extra: Partial<BarLayoutInput> = {}) {
  return barLayoutOf({
    barWidth,
    left: BAR.left,
    right: BAR.right,
    margins: BAR.margins,
    home: BAR.home,
    tabMin: BAR.tabMin,
    docTabs,
    padding: BAR.padding,
    newButton: BAR.newButton,
    toggle: 108,
    pill: PILL,
    hasShort: true,
    ...extra,
  })
}

describe('U-1: the tab bar at 800, 890, 1024 and 1280 with one to three document tabs', () => {
  const widths = [720, 800, 890, 1024, 1280]
  const tabCounts = [1, 2, 3]

  it('the strip and the pill holder never intersect (the pill is a flex item next to the strip)', () => {
    for (const w of widths) {
      for (const n of tabCounts) {
        const l = layout(w, n)
        expect(l.strip.right, `${w}px ${n} tabs`).toBeLessThanOrEqual(l.chrome.left)
        expect(l.strip.left, `${w}px ${n} tabs`).toBeLessThan(l.strip.right)
        expect(l.chrome.right, `${w}px ${n} tabs`).toBeLessThanOrEqual(w - BAR.right)
      }
    }
  })

  it('the strip keeps the room of its tabs whenever the narrowest pill leaves it', () => {
    for (const w of widths) {
      for (const n of tabCounts) {
        const l = layout(w, n)
        const floor = stripFloorOf({ ...BAR, docTabs: n })
        const stripW = l.strip.right - l.strip.left
        const compactStripW = layout(w, n, { pill: { ...PILL, full: 9999, short: 9999 } }).strip
        const compactRoom = compactStripW.right - compactStripW.left
        // either it has the floor, or even the icon + action pill leaves it no more than it has
        expect(stripW, `${w}px ${n} tabs`).toBeGreaterThanOrEqual(Math.min(floor, compactRoom))
      }
    }
  })

  it('890px with two document tabs (the reported case): the long pill gave the strip 212px, now Home and both tabs show', () => {
    const l = layout(890, 2)
    expect(l.variant).not.toBe('full')
    const floor = stripFloorOf({ ...BAR, docTabs: 2 })
    expect(l.strip.right - l.strip.left).toBeGreaterThanOrEqual(floor)
    // the old layout: full pill, strip left with what the holder did not take
    const old = layout(890, 2, {
      pill: { full: 309, short: 309, compact: 309, mini: 309 },
      hasShort: false,
    })
    expect(old.strip.right - old.strip.left).toBeLessThan(floor)
  })

  it('a wider window never picks a narrower variant', () => {
    const rank = { full: 0, short: 1, compact: 2, mini: 3 } as const
    for (const n of tabCounts) {
      let previous = 3
      for (let w = 720; w <= 1400; w += 10) {
        const r = rank[layout(w, n).variant]
        expect(r, `${w}px ${n} tabs`).toBeLessThanOrEqual(previous)
        previous = r
      }
    }
  })

  it('more document tabs never give the pill more room', () => {
    const rank = { full: 0, short: 1, compact: 2, mini: 3 } as const
    for (const w of widths) {
      let previous = 0
      for (const n of tabCounts) {
        const r = rank[layout(w, n).variant]
        expect(r, `${w}px ${n} tabs`).toBeGreaterThanOrEqual(previous)
        previous = r
      }
    }
  })

  it('1280px has room for the full label with any number of tabs the floor covers', () => {
    for (const n of tabCounts) expect(layout(1280, n).variant, `${n} tabs`).toBe('full')
  })

  it('720px (the window minimum) with three tabs degrades to the dot alone and leaves the strip all the rest', () => {
    const l = layout(720, 3)
    expect(l.variant).toBe('mini')
    expect(l.strip.right - l.strip.left).toBeGreaterThan(0)
  })

  it('English pill widths: the full label needs the room only the wide windows have', () => {
    // sanity of the fixture: the label of the report is the long one
    expect(en.uwChipQueued).toBe('Save queued — not on UniWork yet')
    expect(layout(890, 1).variant).toBe('short')
    expect(layout(890, 2).variant).toBe('compact')
    expect(layout(1024, 3).variant).toBe('short')
    expect(layout(800, 1).variant).toBe('compact')
  })
})

/**
 * The numbers the visual tester measured in the real shell (r4, 2 document tabs, queued pill): the
 * pill is 314px wide and ends 176px before the window's right edge (caption buttons, overflow
 * button, holder margin), so at 800px it sat at x 310..624 over the second tab x 297..401. Tab
 * rects here are the unclipped layout rects (what the tester reads), laid out like the strip does:
 * Home at its width, document tabs sharing the rest between their 104px minimum and 240px.
 */
describe('U-1: at the numbers measured in the real shell, no tab rect reaches the pill', () => {
  const REAL = {
    left: 40,
    right: 160,
    margins: 22,
    home: 109,
    tabMin: 104,
    padding: 20,
    newButton: 32,
  }
  const REAL_PILL = { full: 314, short: 187, compact: 113, mini: 28 }

  function tabRects(stripLeft: number, stripWidth: number, docTabs: number) {
    const inner = stripWidth - REAL.padding - REAL.newButton
    const docWidth = Math.min(240, Math.max(REAL.tabMin, (inner - REAL.home) / docTabs))
    const rects = [{ left: stripLeft + 10, right: stripLeft + 10 + REAL.home }]
    let x = rects[0].right
    for (let i = 0; i < docTabs; i++) {
      rects.push({ left: x, right: x + docWidth })
      x += docWidth
    }
    return rects
  }

  function real(barWidth: number, docTabs: number, toggle: number) {
    const l = barLayoutOf({
      barWidth,
      ...REAL,
      docTabs,
      toggle,
      pill: REAL_PILL,
      hasShort: true,
    })
    const pill = { left: l.chrome.right - REAL_PILL[l.variant], right: l.chrome.right }
    return { l, pill, tabs: tabRects(l.strip.left, l.strip.right - l.strip.left, docTabs) }
  }

  it('the old layout (full pill always): at 800px the pill starts at 310 over the tab ending at 401', () => {
    const old = barLayoutOf({
      barWidth: 800,
      ...REAL,
      docTabs: 2,
      toggle: 0,
      pill: { full: 314, short: 314, compact: 314, mini: 314 },
      hasShort: false,
    })
    expect(old.chrome.right).toBe(800 - 160 - 16)
    const pillLeft = old.chrome.right - 314
    expect(pillLeft).toBe(310)
    // the tab rects of the old strip (its width was what the 314px holder left it)
    const tabs = tabRects(old.strip.left, old.strip.right - old.strip.left, 2)
    expect(tabs[2].right).toBeGreaterThan(pillLeft)
  })

  it('800, 890, 1024, 1280 (and the 722 minimum) x 1-3 document tabs, with and without the Discussion toggle', () => {
    for (const w of [722, 800, 890, 1024, 1280]) {
      for (const n of [1, 2, 3]) {
        for (const toggle of [0, 108]) {
          const { pill, tabs, l } = real(w, n, toggle)
          const beyondWindow = w === 722 && n === 3
          for (const [i, tab] of tabs.entries()) {
            // Home and three tabs at their 104px minimum need 471px: the 722px window has 433 left of
            // the pill, so the third tab scrolls (clipped by the strip) and only its visible part is checked
            const reach = beyondWindow ? Math.min(tab.right, l.strip.right) : tab.right
            expect(reach, `${w}px ${n} tabs toggle ${toggle}: tab ${i}`).toBeLessThanOrEqual(
              pill.left,
            )
          }
          expect(pill.right, `${w}px`).toBeLessThanOrEqual(w - 160 - 16)
          expect(l.strip.right, `${w}px`).toBeLessThanOrEqual(l.chrome.left)
        }
      }
    }
  })

  it('the reported 800px / 2 tabs case gets the short label, the whole strip back and every tab inside it', () => {
    const { l, tabs } = real(800, 2, 0)
    expect(l.variant).toBe('short')
    expect(tabs[2].right).toBeLessThanOrEqual(l.strip.right)
  })

  it('a 134px pill (a state with a short label, such as Saved) never needs a step down at 800 with two tabs', () => {
    const l = barLayoutOf({
      barWidth: 800,
      ...REAL,
      docTabs: 2,
      toggle: 0,
      pill: { full: 134, short: 134, compact: 30, mini: 28 },
      hasShort: false,
    })
    expect(l.variant).toBe('full')
    const tabs = tabRects(l.strip.left, l.strip.right - l.strip.left, 2)
    expect(tabs[2].right).toBeLessThanOrEqual(l.chrome.right - 134)
  })
})

/**
 * FXT6u (V6u5-01): the narrowest step is the Discussion toggle. When even the icon + action pill
 * leaves the strip below its floor, the toggle in the holder goes icon-only and the room goes back
 * to the strip. The decision is taken on the budget the holder would have with the toggle FULL, so
 * the same window gives the same answer whichever form is drawn.
 */
describe('FXT6u: the Discussion toggle gives up its label before the strip gives up its tabs', () => {
  const TOGGLE_ICON = 32
  const withIcon = (w: number, n: number, extra: Partial<BarLayoutInput> = {}) =>
    layout(w, n, { toggleIcon: TOGGLE_ICON, ...extra })

  it("722px with three tabs: icon-only toggle, the strip gains the toggle's label width", () => {
    const l = withIcon(722, 3)
    expect(['compact', 'mini']).toContain(l.variant)
    expect(l.iconToggle).toBe(true)
    const before = layout(722, 3)
    expect(before.iconToggle).toBe(false)
    expect(l.strip.right - before.strip.right).toBe(108 - TOGGLE_ICON)
    expect(l.strip.right).toBeLessThanOrEqual(l.chrome.left)
  })

  it('800, 890, 1024, 1280 x 1-3 tabs: icon-only exactly where the compact pill with the full toggle leaves the strip below its floor', () => {
    const iconCases: string[] = []
    for (const w of [722, 800, 890, 1024, 1280]) {
      for (const n of [1, 2, 3]) {
        const l = withIcon(w, n)
        const floor = stripFloorOf({ ...BAR, docTabs: n })
        const compactStrip = w - BAR.left - BAR.right - BAR.margins - 108 - PILL.compact
        expect(l.iconToggle, `${w}px ${n} tabs`).toBe(compactStrip < floor)
        if (l.iconToggle) {
          iconCases.push(`${w}/${n}`)
          // the pill is already in one of its two narrowest forms
          expect(['compact', 'mini'], `${w}px ${n} tabs`).toContain(l.variant)
        }
        expect(l.strip.right, `${w}px ${n} tabs`).toBeLessThanOrEqual(l.chrome.left)
      }
    }
    expect(iconCases).toEqual(['722/2', '722/3', '800/2', '800/3', '890/3'])
  })

  it('where the toggle stays full the layout is the one it was (same variant, same strip)', () => {
    for (const w of [800, 890, 1024, 1280]) {
      for (const n of [1, 2, 3]) {
        const l = withIcon(w, n)
        if (l.iconToggle) continue
        const was = layout(w, n)
        expect(l.variant, `${w}px ${n} tabs`).toBe(was.variant)
        expect(l.strip, `${w}px ${n} tabs`).toEqual(was.strip)
        expect(l.chrome, `${w}px ${n} tabs`).toEqual(was.chrome)
      }
    }
  })

  it('a holder without a toggle (no icon width) never goes icon-only', () => {
    for (const w of [722, 800, 890]) {
      for (const n of [1, 2, 3]) {
        expect(layout(w, n).iconToggle, `${w}px ${n} tabs`).toBe(false)
        expect(layout(w, n, { toggle: 0, toggleIcon: TOGGLE_ICON }).iconToggle).toBe(false)
      }
    }
  })

  it('a wider window never goes back to icon-only, and the step happens once (no flip-flop at the boundary)', () => {
    for (const n of [1, 2, 3]) {
      const forms: boolean[] = []
      for (let w = 600; w <= 1400; w++) forms.push(withIcon(w, n).iconToggle)
      const flips = forms.filter((v, i) => i > 0 && v !== forms[i - 1]).length
      expect(flips, `${n} tabs`).toBeLessThanOrEqual(1)
      if (flips === 1) expect(forms[0]).toBe(true)
    }
  })

  describe('pillFitStepOf', () => {
    const widths = { full: 309, short: 190, compact: 111 }

    it("the boundary is the compact pill's own width: budget == compact keeps the full toggle, one less gives it up", () => {
      const toggle = { width: 108, iconOnly: false }
      const toggleWidths = { full: 108 }
      expect(pillFitStepOf({ budget: 111, toggle, toggleWidths, widths, hasShort: true })).toEqual({
        variant: 'compact',
        iconToggle: false,
      })
      expect(pillFitStepOf({ budget: 110, toggle, toggleWidths, widths, hasShort: true })).toEqual({
        variant: 'compact',
        iconToggle: true,
      })
    })

    it('measured with the toggle drawn icon-only, the answer is the one with it drawn full (hysteresis: the same inputs, the same step)', () => {
      for (let budgetFull = -40; budgetFull <= 400; budgetFull++) {
        const full = pillFitStepOf({
          budget: budgetFull,
          toggle: { width: 108, iconOnly: false },
          toggleWidths: { full: 108, icon: 32 },
          widths,
          hasShort: true,
        })
        // the same window with the toggle drawn icon-only has 76px more budget
        const icon = pillFitStepOf({
          budget: budgetFull + 76,
          toggle: { width: 32, iconOnly: true },
          toggleWidths: { full: 108, icon: 32 },
          widths,
          hasShort: true,
        })
        expect(icon, `budget ${budgetFull}`).toEqual(full)
      }
    })

    it('with no toggle in the holder there is nothing to give up', () => {
      expect(
        pillFitStepOf({ budget: -50, toggle: null, toggleWidths: {}, widths, hasShort: true }),
      ).toEqual({ variant: 'mini', iconToggle: false })
    })

    it('a toggle drawn icon-only before its full width was ever measured is drawn full first', () => {
      expect(
        pillFitStepOf({
          budget: 10,
          toggle: { width: 32, iconOnly: true },
          toggleWidths: { icon: 32 },
          widths,
          hasShort: true,
        }),
      ).toEqual({ variant: 'compact', iconToggle: false })
    })

    it('the compact pill is not measured yet: the toggle is not touched (no guessed width)', () => {
      expect(
        pillFitStepOf({
          budget: 5,
          toggle: { width: 108, iconOnly: false },
          toggleWidths: { full: 108 },
          widths: { full: 309 },
          hasShort: true,
        }).iconToggle,
      ).toBe(false)
    })

    it('a room that fits a wider variant never touches the toggle', () => {
      const step = pillFitStepOf({
        budget: 200,
        toggle: { width: 108, iconOnly: false },
        toggleWidths: { full: 108 },
        widths,
        hasShort: true,
      })
      expect(step).toEqual({ variant: 'short', iconToggle: false })
    })
  })
})

/**
 * FXT6u part 2: the MINI step. When even the compact pill, with the Discussion toggle already
 * icon-only, still leaves the strip below its floor, the pill is the dot alone (28px). Order: full,
 * short, compact, mini. Every threshold is read off the budget the holder has with the toggle drawn
 * FULL, so a window gives the same step whichever form is on screen.
 */
describe('FXT6u: the dot-only mini pill is the last step', () => {
  const TOGGLE_ICON = 32
  const DELTA = 108 - TOGGLE_ICON
  const widths = { full: 309, short: 190, compact: 111, mini: 28 }
  const step = (budget: number, over: Partial<Parameters<typeof pillFitStepOf>[0]> = {}) =>
    pillFitStepOf({
      budget,
      toggle: { width: 108, iconOnly: false },
      toggleWidths: { full: 108, icon: TOGGLE_ICON },
      widths,
      hasShort: true,
      ...over,
    })
  const withIcon = (w: number, n: number, extra: Partial<BarLayoutInput> = {}) =>
    layout(w, n, { toggleIcon: TOGGLE_ICON, ...extra })

  it('mini only when compact still leaves the strip below its floor with the toggle icon-only', () => {
    // compact + icon toggle fits: budget (full toggle) + delta >= compact
    expect(step(111 - DELTA)).toEqual({ variant: 'compact', iconToggle: true })
    expect(step(111 - DELTA - 1)).toEqual({ variant: 'mini', iconToggle: true })
    // compact fits with the full toggle: no icon, no mini
    expect(step(111)).toEqual({ variant: 'compact', iconToggle: false })
    // a wider variant fits: nothing narrower
    expect(step(200)).toEqual({ variant: 'short', iconToggle: false })
    expect(step(400)).toEqual({ variant: 'full', iconToggle: false })
  })

  it('a holder without a toggle goes mini when compact alone leaves the strip below its floor', () => {
    const none = { toggle: null, toggleWidths: {} }
    expect(step(111, none)).toEqual({ variant: 'compact', iconToggle: false })
    expect(step(110, none)).toEqual({ variant: 'mini', iconToggle: false })
  })

  it('the toggle drawn full, its icon width not measured yet: it goes icon-only first, mini after the measure', () => {
    expect(step(-50, { toggleWidths: { full: 108 } })).toEqual({
      variant: 'compact',
      iconToggle: true,
    })
    expect(step(-50)).toEqual({ variant: 'mini', iconToggle: true })
  })

  it('the compact pill never measured: no mini (nothing is guessed)', () => {
    const sofar = { full: 309, short: 190 }
    expect(step(-50, { widths: sofar }).variant).not.toBe('mini')
  })

  it('the same window gives the same step whichever form of the toggle is on screen (no flip-flop)', () => {
    for (let budgetFull = -200; budgetFull <= 450; budgetFull++) {
      const fullDrawn = step(budgetFull)
      const iconDrawn = step(budgetFull + DELTA, {
        toggle: { width: TOGGLE_ICON, iconOnly: true },
      })
      expect(iconDrawn, `budget ${budgetFull}`).toEqual(fullDrawn)
    }
  })

  it('a wider budget never takes a narrower step; icon-only and mini each switch exactly once', () => {
    const rank = { full: 0, short: 1, compact: 2, mini: 3 } as const
    let previous = 3
    const forms: string[] = []
    for (let budget = -200; budget <= 450; budget++) {
      const s = step(budget)
      expect(rank[s.variant], `budget ${budget}`).toBeLessThanOrEqual(previous)
      previous = rank[s.variant]
      forms.push(`${s.variant}${s.iconToggle ? '+icon' : ''}`)
    }
    const flips = forms.filter((v, i) => i > 0 && v !== forms[i - 1])
    // mini+icon, compact+icon, compact, short, full
    expect(flips).toEqual(['compact+icon', 'compact', 'short', 'full'])
  })

  it("722px with three tabs: the strip ends after the third tab's label (toggle shown and toggle absent)", () => {
    // Home 109 + 10 padding on the start side, three tabs at 104, the label 36px in and 36px wide
    const labelOfThird = 10 + 109 + 2 * 104 + 36 + 36
    for (const toggleIcon of [TOGGLE_ICON, undefined]) {
      const l = withIcon(722, 3, toggleIcon === undefined ? { toggle: 0, toggleIcon } : {})
      expect(l.variant).toBe('mini')
      const stripWidth = l.strip.right - l.strip.left
      expect(stripWidth, `toggle ${toggleIcon}`).toBeGreaterThanOrEqual(labelOfThird)
      expect(l.strip.right).toBeLessThanOrEqual(l.chrome.left)
      expect(l.chrome.right - l.chrome.left).toBe((toggleIcon ?? 0) + 28)
    }
  })

  it('722px / 3 tabs: the widths the report states (toggle shown)', () => {
    const l = withIcon(722, 3)
    const shared = 722 - BAR.left - BAR.right - BAR.margins
    expect(l.iconToggle).toBe(true)
    expect(l.strip.right - l.strip.left).toBe(shared - TOGGLE_ICON - 28)
    // before: compact pill and the full toggle
    const before = shared - 108 - PILL.compact
    expect(l.strip.right - l.strip.left - before).toBe(108 - TOGGLE_ICON + PILL.compact - 28)
  })

  it('which cells of 722/800/890/1024/1280 x 1-3 tabs are mini: with the toggle shown, and with none', () => {
    const shown: string[] = []
    const none: string[] = []
    for (const w of [722, 800, 890, 1024, 1280]) {
      for (const n of [1, 2, 3]) {
        if (withIcon(w, n).variant === 'mini') shown.push(`${w}/${n}`)
        if (withIcon(w, n, { toggle: 0, toggleIcon: undefined }).variant === 'mini') {
          none.push(`${w}/${n}`)
        }
      }
    }
    // FXT6u2 (RFE6u8-01): the last tab only needs its label, so 722/2 and 800/3 stay compact
    expect(shown).toEqual(['722/3'])
    expect(none).toEqual(['722/3'])
  })

  it('800 to 1280 with one or two tabs, and 890 and wider with three: no mini, the layout is the one of the icon-only step', () => {
    for (const [w, n] of [
      [800, 1],
      [800, 2],
      [890, 1],
      [890, 2],
      [890, 3],
      [1024, 1],
      [1024, 2],
      [1024, 3],
      [1280, 1],
      [1280, 2],
      [1280, 3],
    ]) {
      expect(withIcon(w, n).variant, `${w}px ${n} tabs`).not.toBe('mini')
    }
  })

  it('a wider window never goes back to a narrower step, with the toggle shown or not', () => {
    const rank = { full: 0, short: 1, compact: 2, mini: 3 } as const
    for (const n of [1, 2, 3]) {
      for (const none of [false, true]) {
        let previous = 3
        for (let w = 600; w <= 1400; w++) {
          const l = withIcon(w, n, none ? { toggle: 0, toggleIcon: undefined } : {})
          expect(rank[l.variant], `${w}px ${n} tabs`).toBeLessThanOrEqual(previous)
          previous = rank[l.variant]
          expect(l.strip.right, `${w}px ${n} tabs`).toBeLessThanOrEqual(l.chrome.left)
        }
      }
    }
  })
})

/**
 * FXT6u2 (RFE6u8-01): the mini step uses a looser floor than the other steps. Full, short, compact and
 * the icon-only toggle keep the floor of Home + three tabs at their minimum + padding + "+"; the dot
 * alone is only taken when the strip cannot even show the LAST tab's label start and a minimum readable
 * label (the "+" and the end padding may scroll out, as they did before the mini step existed).
 */
describe('FXT6u2: the mini step needs the last tab only up to its readable label', () => {
  const TOGGLE_ICON = 32
  const DELTA = 108 - TOGGLE_ICON
  const widths = { full: 309, short: 190, compact: 111, mini: 28 }
  /** the stub tab: the title starts 36px in and is 36px wide at the 104px minimum */
  const LABEL = { labelStart: 36, labelMin: 36 }
  const SLACK = 104 - 72 + 32 + 10
  const step = (budget: number, over: Partial<Parameters<typeof pillFitStepOf>[0]> = {}) =>
    pillFitStepOf({
      budget,
      toggle: { width: 108, iconOnly: false },
      toggleWidths: { full: 108, icon: TOGGLE_ICON },
      widths,
      hasShort: true,
      miniSlack: SLACK,
      ...over,
    })
  const withIcon = (w: number, n: number, extra: Partial<BarLayoutInput> = {}) =>
    layout(w, n, { toggleIcon: TOGGLE_ICON, ...LABEL, ...extra })
  const noToggle = { toggle: 0, toggleIcon: undefined }
  /** the last document tab's visible px (the strip starts with 10px of padding, then Home, then the tabs at 104) */
  function lastTabPx(w: number, n: number, extra: Partial<BarLayoutInput> = {}): number {
    const l = withIcon(w, n, extra)
    return Math.max(0, Math.min(104, l.strip.right - l.strip.left - 10 - 109 - (n - 1) * 104))
  }
  const lastLabelPx = (px: number) => Math.max(0, Math.min(36, px - 36))

  describe('pillRoomOf: the budget before it is clamped', () => {
    it('is the budget where it is positive and keeps how far below the floor the strip would be where it is not', () => {
      expect(pillRoomOf({ shared: 654, floor: 381, others: 106 })).toBe(167)
      expect(pillRoomOf({ shared: 300, floor: 485, others: 106 })).toBe(-291)
      expect(pillRoomOf({ shared: Number.NaN, floor: 100, others: 0 })).toBe(0)
      // the clamped budget is the room, never negative
      expect(pillBudgetOf({ shared: 300, floor: 485, others: 106 })).toBe(0)
    })

    it('the step reads the unclamped room: the toggle drawn full or icon-only gives the same step at 722 x 3 (the first pass is the last)', () => {
      // 722 x 3, toggle drawn full: room -97 (budgetOf says 0); drawn icon-only: -21, the saving of 76 taken back is -97 again
      const full = pillRoomOf({ shared: 484, floor: 473, others: 108 })
      const icon = pillRoomOf({ shared: 484, floor: 473, others: 32 })
      expect(full).toBe(-97)
      expect(icon).toBe(-21)
      const base = {
        toggleWidths: { full: 108, icon: 32 },
        widths: { full: 309, short: 190, compact: 111, mini: 28 },
        hasShort: true,
        miniSlack: 74,
      }
      expect(
        pillFitStepOf({ ...base, budget: full, toggle: { width: 108, iconOnly: false } }),
      ).toEqual({
        variant: 'mini',
        iconToggle: true,
      })
      expect(
        pillFitStepOf({ ...base, budget: icon, toggle: { width: 32, iconOnly: true } }),
      ).toEqual({
        variant: 'mini',
        iconToggle: true,
      })
    })
  })

  describe('miniSlackOf: what the mini step may take off the floor', () => {
    const base = { ...BAR, docTabs: 3, ...LABEL }

    it('the tab beyond its label (tabMin - label start - minimum label), the "+" and the end padding', () => {
      expect(miniSlackOf(base)).toBe(104 - 36 - 36 + BAR.newButton + BAR.padding / 2)
      // derived from the same constants as the floor: the floor less this is what the strip must reach
      const reach = stripFloorOf(base) - miniSlackOf(base)
      expect(reach).toBe(10 + 109 + 2 * 104 + 36 + 36)
    })

    it('a tab whose label runs to its end needs the whole tab (no slack from the tab itself)', () => {
      expect(miniSlackOf({ ...base, labelStart: 36, labelMin: 68 })).toBe(
        BAR.newButton + BAR.padding / 2,
      )
      // a label measure larger than the tab never makes the slack negative
      expect(miniSlackOf({ ...base, labelStart: 90, labelMin: 90 })).toBe(
        BAR.newButton + BAR.padding / 2,
      )
    })

    it('no document tab: nothing is loosened', () => {
      expect(miniSlackOf({ ...base, docTabs: 0 })).toBe(0)
    })

    it('more tabs than the floor counts: the same slack (the floor counts three)', () => {
      expect(miniSlackOf({ ...base, docTabs: 7 })).toBe(miniSlackOf(base))
    })
  })

  describe('pillFitStepOf with the slack', () => {
    it('toggle shown: mini only when compact + icon-only toggle + slack still leaves the strip below its floor', () => {
      const edge = 111 - DELTA - SLACK
      expect(step(edge)).toEqual({ variant: 'compact', iconToggle: true })
      expect(step(edge - 1)).toEqual({ variant: 'mini', iconToggle: true })
    })

    it('no toggle: mini only when compact + slack still leaves the strip below its floor', () => {
      const none = { toggle: null, toggleWidths: {} }
      expect(step(111 - SLACK, none)).toEqual({ variant: 'compact', iconToggle: false })
      expect(step(111 - SLACK - 1, none)).toEqual({ variant: 'mini', iconToggle: false })
    })

    it('the slack never moves the icon-only toggle or the wider steps (they keep the current floor)', () => {
      for (let budget = 111 - DELTA; budget <= 450; budget++) {
        // above the mini range the answer is the one without any slack
        expect(step(budget), `budget ${budget}`).toEqual(step(budget, { miniSlack: 0 }))
      }
      expect(step(110)).toEqual({ variant: 'compact', iconToggle: true })
      expect(step(111)).toEqual({ variant: 'compact', iconToggle: false })
    })

    it('mini with the slack is always mini without it (the loosened step is a subset)', () => {
      for (let budget = -300; budget <= 450; budget++) {
        if (step(budget).variant === 'mini') {
          expect(step(budget, { miniSlack: 0 }).variant, `budget ${budget}`).toBe('mini')
        }
      }
    })

    it('the same window gives the same step whichever form of the toggle is on screen (no flip-flop)', () => {
      for (let budgetFull = -300; budgetFull <= 450; budgetFull++) {
        const fullDrawn = step(budgetFull)
        const iconDrawn = step(budgetFull + DELTA, {
          toggle: { width: TOGGLE_ICON, iconOnly: true },
        })
        expect(iconDrawn, `budget ${budgetFull}`).toEqual(fullDrawn)
      }
    })

    it('a wider budget never takes a narrower step; icon-only and mini each switch once', () => {
      const forms: string[] = []
      for (let budget = -300; budget <= 450; budget++) {
        const s = step(budget)
        forms.push(`${s.variant}${s.iconToggle ? '+icon' : ''}`)
      }
      const flips = forms.filter((v, i) => i > 0 && v !== forms[i - 1])
      expect(forms[0]).toBe('mini+icon')
      expect(flips).toEqual(['compact+icon', 'compact', 'short', 'full'])
    })

    it('no slack given: the step is the one of FXT6u (the floor of the other steps)', () => {
      expect(step(111 - DELTA - 1, { miniSlack: undefined })).toEqual({
        variant: 'mini',
        iconToggle: true,
      })
    })
  })

  describe('the bar at 722 / 800 / 890 / 1024 / 1280 with one to three tabs', () => {
    it('722 x 3 stays the dot alone (toggle shown and none): the last tab shows its label', () => {
      for (const extra of [{}, noToggle]) {
        const l = withIcon(722, 3, extra)
        expect(l.variant).toBe('mini')
        const px = lastTabPx(722, 3, extra)
        expect(lastLabelPx(px)).toBe(36)
        expect(l.strip.right).toBeLessThanOrEqual(l.chrome.left)
      }
      expect(lastTabPx(722, 3)).toBe(97)
    })

    it('800 x 3 and 722 x 2 stay compact (every label readable), the toggle behaves as before', () => {
      for (const [w, n] of [
        [800, 3],
        [722, 2],
      ]) {
        for (const extra of [{}, noToggle]) {
          const tag = `${w}/${n} ${extra === noToggle ? 'no toggle' : 'toggle'}`
          const l = withIcon(w, n, extra)
          expect(l.variant, tag).toBe('compact')
          expect(l.iconToggle, tag).toBe(extra !== noToggle)
          expect(lastLabelPx(lastTabPx(w, n, extra)), tag).toBe(36)
        }
      }
      expect(lastTabPx(800, 3)).toBe(92)
    })

    it('every cell: the last tab shows at least its label start and minimum label, whatever the step', () => {
      for (const w of [722, 800, 890, 1024, 1280]) {
        for (const n of [1, 2, 3]) {
          for (const extra of [{}, noToggle]) {
            expect(lastTabPx(w, n, extra), `${w}/${n}`).toBeGreaterThanOrEqual(36 + 36)
          }
        }
      }
    })

    it('the mini cells with the toggle shown, and with none', () => {
      const cells = (extra: Partial<BarLayoutInput>) =>
        [722, 800, 890, 1024, 1280].flatMap((w) =>
          [1, 2, 3].filter((n) => withIcon(w, n, extra).variant === 'mini').map((n) => `${w}/${n}`),
        )
      expect(cells({})).toEqual(['722/3'])
      expect(cells(noToggle)).toEqual(['722/3'])
    })

    it('the icon-only toggle cells are the ones of FXT6u (the toggle rule is untouched)', () => {
      const cells: string[] = []
      for (const w of [722, 800, 890, 1024, 1280]) {
        for (const n of [1, 2, 3]) if (withIcon(w, n).iconToggle) cells.push(`${w}/${n}`)
      }
      expect(cells).toEqual(['722/2', '722/3', '800/2', '800/3', '890/3'])
    })

    it('the whole table: variant, toggle form and the last tab px / label px per cell', () => {
      const rows = (extra: Partial<BarLayoutInput>) =>
        [722, 800, 890, 1024, 1280].map((w) =>
          [1, 2, 3]
            .map((n) => {
              const l = withIcon(w, n, extra)
              const px = lastTabPx(w, n, extra)
              return `${l.variant}${l.iconToggle ? '+icon' : ''} ${px}/${lastLabelPx(px)}`
            })
            .join(' | '),
        )
      expect(rows({})).toEqual([
        'compact 104/36 | compact+icon 104/36 | mini+icon 97/36',
        'compact 104/36 | compact+icon 104/36 | compact+icon 92/36',
        'short 104/36 | compact 104/36 | compact+icon 104/36',
        'full 104/36 | full 104/36 | short 104/36',
        'full 104/36 | full 104/36 | full 104/36',
      ])
      expect(rows(noToggle)).toEqual([
        'short 104/36 | compact 104/36 | mini 104/36',
        'short 104/36 | short 104/36 | compact 104/36',
        'full 104/36 | short 104/36 | compact 104/36',
        'full 104/36 | full 104/36 | full 104/36',
        'full 104/36 | full 104/36 | full 104/36',
      ])
    })

    it('a tab whose label runs to its end (no close button) needs the whole tab: 800 x 3 with the toggle is the dot again', () => {
      expect(withIcon(800, 3, { labelStart: 36, labelMin: 68 }).variant).toBe('mini')
      expect(withIcon(800, 3).variant).toBe('compact')
    })

    it('1px sweeps, toggle shown or not, with a repeated measure: once each, in order, no flip-flop', () => {
      const rank = ['mini', 'compact', 'short', 'full']
      for (const n of [1, 2, 3]) {
        for (const extra of [{}, noToggle]) {
          const forms: string[] = []
          for (let w = 600; w <= 1400; w++) {
            const l = withIcon(w, n, extra)
            const again = withIcon(w, n, extra)
            expect(again.variant).toBe(l.variant)
            expect(again.iconToggle).toBe(l.iconToggle)
            expect(l.strip.right, `${w}px ${n} tabs`).toBeLessThanOrEqual(l.chrome.left)
            forms.push(`${l.variant}${l.iconToggle ? '+icon' : ''}`)
          }
          const steps = forms.filter((f, i) => i === 0 || f !== forms[i - 1])
          const ranks = steps.map((f) => rank.indexOf(f.replace('+icon', '')))
          expect(ranks, `${n} tabs ${JSON.stringify(extra)}`).toEqual(
            [...ranks].sort((a, b) => a - b),
          )
          expect(new Set(steps).size, `${n} tabs`).toBe(steps.length)
        }
      }
    })
  })
})

/**
 * G5-06u-TS (V6u8-02): the compact strip at UI scale 1.25. Home is icon-only (12 + 16 + 12 = 40) and
 * the inactive document tabs drop their close button (104 - 16 - 8 = 80), so the floor and the
 * mini slack are read per tab: the floor sums the counted tabs' own minimums, the slack is what
 * the LAST counted tab has after its label. The bar below is section 0 of the contract in CSS px x
 * 1.25 (window px): drag spacer + menu 40, overflow 38 + the 138 win px caption (divided by the
 * scale since the caption spacer fix), the holder's 22 of margins.
 */
describe('G5-06u-TS: the floor and the slack read each counted tab', () => {
  const COMPACT = { home: 40, tabMin: 104, tabMins: [104, 80, 80], padding: 20, newButton: 32 }

  it('stripFloorOf sums the per-tab minimums: Home 40 + 104 + 80 + 80 + 20 + 32 = 356', () => {
    expect(stripFloorOf({ ...COMPACT, docTabs: 3 })).toBe(356)
    expect(stripFloorOf({ ...COMPACT, docTabs: 2 })).toBe(40 + 184 + 52)
    // the floor counts three tabs; a fourth one scrolls
    expect(stripFloorOf({ ...COMPACT, tabMins: [104, 80, 80, 80], docTabs: 4 })).toBe(356)
    expect(stripFloorOf({ ...COMPACT, docTabs: 0 })).toBe(40 + 52)
  })

  it('equal per-tab minimums are the floor of tabMin x n (the scale-1 strip is unchanged)', () => {
    for (const n of [0, 1, 2, 3, 4]) {
      const base = { home: 109, tabMin: 104, padding: 20, newButton: 32, docTabs: n }
      expect(stripFloorOf({ ...base, tabMins: Array(n).fill(104) })).toBe(stripFloorOf(base))
      expect(
        miniSlackOf({ ...base, tabMins: Array(n).fill(104), labelStart: 36, labelMin: 36 }),
      ).toBe(miniSlackOf({ ...base, labelStart: 36, labelMin: 36 }))
    }
  })

  it('miniSlackOf reads the last counted tab: an inactive compact tab has 8 after its label (50), 12 in RTL (54)', () => {
    expect(miniSlackOf({ ...COMPACT, docTabs: 3, labelStart: 36, labelMin: 36 })).toBe(8 + 32 + 10)
    expect(miniSlackOf({ ...COMPACT, docTabs: 3, labelStart: 32, labelMin: 36 })).toBe(12 + 32 + 10)
    // two tabs: the last counted one is the second
    expect(
      miniSlackOf({ ...COMPACT, tabMins: [104, 80], docTabs: 2, labelStart: 36, labelMin: 36 }),
    ).toBe(50)
  })

  describe('barLayoutOf at UI scale 1.25, 722 / 800 x 3 tabs, toggle shown and none', () => {
    const S = 1.25
    const TS_PILL = { full: 309 * S, short: 190 * S, compact: 111 * S, mini: 28 * S }
    const compactBar = (w: number, extra: Partial<BarLayoutInput> = {}) =>
      barLayoutOf({
        barWidth: w,
        left: 40 * S,
        right: 38 * S + 138,
        margins: 22 * S,
        home: 40 * S,
        tabMin: 104 * S,
        tabMins: [104 * S, 80 * S, 80 * S],
        docTabs: 3,
        padding: 20 * S,
        newButton: 32 * S,
        toggle: 108 * S,
        toggleIcon: 32 * S,
        labelStart: 36 * S,
        labelMin: 36 * S,
        pill: TS_PILL,
        hasShort: true,
        ...extra,
      })
    const none = { toggle: 0, toggleIcon: undefined }
    /** the third tab's visible window px: the strip starts with 10 of padding, then Home 40, 104, 80 */
    const lastPx = (l: ReturnType<typeof barLayoutOf>) =>
      Math.max(0, Math.min(80 * S, l.strip.right - l.strip.left - (10 + 40 + 104 + 80) * S))

    it('the cells: the step, the toggle form and the last tab px / label px (LTR needs 90 / 45)', () => {
      const cells = [722, 800].flatMap((w) =>
        [{}, none].map((extra) => {
          const l = compactBar(w, extra)
          const px = lastPx(l)
          expect(l.strip.right, `${w}`).toBeLessThanOrEqual(l.chrome.left)
          return `${w}${extra === none ? '' : '+t'} ${l.variant}${l.iconToggle ? '+icon' : ''} ${px}/${Math.min(36 * S, px - 36 * S)}`
        }),
      )
      expect(cells).toEqual([
        '722+t mini+icon 91.5/45',
        '722 mini 100/45',
        '800+t mini+icon 100/45',
        '800 compact 100/45',
      ])
    })

    it('RTL (label start 32, 12 after the label): the same steps, the last tab past 85 / 45', () => {
      for (const w of [722, 800]) {
        for (const extra of [{}, none]) {
          const ltr = compactBar(w, extra)
          const rtl = compactBar(w, { ...extra, labelStart: 32 * S, labelMin: 36 * S })
          expect(rtl.variant, `${w}`).toBe(ltr.variant)
          expect(rtl.iconToggle, `${w}`).toBe(ltr.iconToggle)
          expect(lastPx(rtl) - 32 * S, `${w}`).toBeGreaterThanOrEqual(36 * S)
        }
      }
    })

    it('without the compact form (Home 144.8, three 104px tabs) the third tab is out of the strip', () => {
      const full = compactBar(722, { home: 144.8 * S, tabMins: undefined })
      const third = full.strip.right - full.strip.left - (10 + 144.8 + 208) * S
      expect(third).toBeLessThan((36 + 36) * S)
    })
  })
})

/**
 * VTS1-01 (Advisor option B, "tabs win over pill text"): at UI scale > 1 the caption spacer fix gave
 * the bar back the caption x (scale - 1) window px the spacer used to over-reserve, and the pill-fit
 * spent it on a wider pill or toggle form, so the last tab got narrower than on d8af19b01. The pill
 * now takes its steps as if that over-reservation still stood (`captionReserve`), so the room goes to
 * the strip. The pre-fix bar below is the d8af19b01 equivalent: the 138 win px caption reserved
 * x 1.25 and no reserve; the fixed bar reserves the caption once and holds back the difference.
 * Widths are window px: the stub's pill and the queued / failed / saved labels the visual run
 * measured at 1.25 (en, ar), with the Discussion toggle's two forms.
 */
describe('VTS1-01: the pill steps hold back the old caption over-reservation at UI scale > 1', () => {
  it('captionReserveOf is caption x (scale - 1) above scale 1, and nothing else', () => {
    expect(captionReserveOf(138, 1.25)).toBe(34.5)
    expect(captionReserveOf(137.2, 1.25)).toBeCloseTo(34.3, 5)
    expect(captionReserveOf(138, 1)).toBe(0)
    expect(captionReserveOf(138, 0.9)).toBe(0)
    expect(captionReserveOf(0, 1.25)).toBe(0)
    expect(captionReserveOf(Number.NaN, 1.25)).toBe(0)
    expect(captionReserveOf(138, Number.NaN)).toBe(0)
  })

  const S = 1.25
  const CAPTION = 138
  const TOGGLE_EN = { toggle: 126.2, toggleIcon: 39.1 }
  const TOGGLE_AR = { toggle: 110.5, toggleIcon: 39.1 }
  const LABELS = {
    stub: {
      pill: { full: 309 * S, short: 190 * S, compact: 111 * S, mini: 28 * S },
      hasShort: true,
      toggle: 108 * S,
      toggleIcon: 32 * S,
    },
    'en queued': {
      pill: { full: 392.6, short: 239.9, compact: 147.3, mini: 35 },
      hasShort: true,
      ...TOGGLE_EN,
    },
    'en failed': { pill: { full: 210.8, compact: 114.1, mini: 35 }, hasShort: false, ...TOGGLE_EN },
    'en saved': { pill: { full: 166.7, compact: 40.4, mini: 35 }, hasShort: false, ...TOGGLE_EN },
    'ar queued': {
      pill: { full: 510.7, short: 342.7, compact: 187.6, mini: 35 },
      hasShort: true,
      ...TOGGLE_AR,
    },
    'ar failed': { pill: { full: 199.7, compact: 123, mini: 35 }, hasShort: false, ...TOGGLE_AR },
    'ar saved': { pill: { full: 188.9, compact: 40.4, mini: 35 }, hasShort: false, ...TOGGLE_AR },
  }
  type Label = (typeof LABELS)[keyof typeof LABELS]
  type Caption = { right: number; reserve?: number }

  /** the full (not compact) strip at 1.25: Home 144.8 (181 win px), every document tab 104 */
  const fullBar = (w: number, n: number, label: Label, withToggle: boolean, caption: Caption) =>
    barLayoutOf({
      barWidth: w,
      left: 40 * S,
      right: 38 * S + caption.right,
      margins: 22 * S,
      home: 144.8 * S,
      tabMin: 104 * S,
      docTabs: n,
      padding: 20 * S,
      newButton: 32 * S,
      toggle: withToggle ? label.toggle : 0,
      toggleIcon: withToggle ? label.toggleIcon : undefined,
      labelStart: 36 * S,
      labelMin: 36 * S,
      pill: label.pill,
      hasShort: label.hasShort,
      ...(caption.reserve === undefined ? {} : { captionReserve: caption.reserve }),
    })
  const preFix: Caption = { right: CAPTION * S }
  const fixed = (): Caption => ({ right: CAPTION, reserve: captionReserveOf(CAPTION, S) })
  const uncapped: Caption = { right: CAPTION }
  const stripOf = (l: ReturnType<typeof barLayoutOf>) => l.strip.right - l.strip.left
  /** what the strip leaves the last tab past its padding, Home and the tabs before it at their minimum */
  const lastRoom = (l: ReturnType<typeof barLayoutOf>, n: number) =>
    stripOf(l) - (10 + 144.8 + 104 * (n - 1)) * S

  function eachCell(fn: (tag: string, w: number, n: number, label: Label, t: boolean) => void) {
    for (const [name, label] of Object.entries(LABELS)) {
      for (const w of [1024, 1280]) {
        for (const n of [1, 2, 3]) {
          for (const t of [false, true]) fn(`${name} ${w} x ${n}${t ? ' +t' : ''}`, w, n, label, t)
        }
      }
    }
  }

  it('1.25 x 1024 / 1280 x 1-3 tabs x toggle none / shown, en + ar: the pre-fix step, a strip 34.5 wider, the last tab no narrower, 0 overlap', () => {
    eachCell((tag, w, n, label, t) => {
      const before = fullBar(w, n, label, t, preFix)
      const after = fullBar(w, n, label, t, fixed())
      expect(after.variant, tag).toBe(before.variant)
      expect(after.iconToggle, tag).toBe(before.iconToggle)
      expect(stripOf(after) - stripOf(before), tag).toBeCloseTo(CAPTION * (S - 1), 6)
      expect(lastRoom(after, n), tag).toBeGreaterThanOrEqual(lastRoom(before, n))
      expect(after.strip.right, tag).toBeLessThanOrEqual(after.chrome.left)
    })
  })

  it('without the reserve the returned room goes to a wider pill and the last tab loses width (the VTS1-01 shape)', () => {
    const lost: string[] = []
    eachCell((tag, w, n, label, t) => {
      const before = fullBar(w, n, label, t, preFix)
      const after = fullBar(w, n, label, t, uncapped)
      if (lastRoom(after, n) < lastRoom(before, n) - 0.01) lost.push(tag)
    })
    expect(lost.length).toBeGreaterThan(0)
  })

  it('at scale 1 the reserve is a no-op: the same layout with and without it, at every width', () => {
    for (const label of Object.values(LABELS)) {
      for (let w = 600; w <= 1600; w += 7) {
        for (const n of [0, 1, 2, 3, 4]) {
          const base: BarLayoutInput = {
            barWidth: w,
            left: 40,
            right: 38 + CAPTION,
            margins: 22,
            home: 109,
            tabMin: 104,
            docTabs: n,
            padding: 20,
            newButton: 32,
            toggle: label.toggle,
            toggleIcon: label.toggleIcon,
            pill: label.pill,
            hasShort: label.hasShort,
          }
          expect(barLayoutOf({ ...base, captionReserve: captionReserveOf(CAPTION, 1) })).toEqual(
            barLayoutOf(base),
          )
        }
      }
    }
  })

  it('the compact strip at 1.25 x 722 / 800 / 890 x 3 with the reserve: a pill no wider, the last tab past 90 (LTR) / 85 (RTL), label 45', () => {
    const rank = ['mini', 'compact', 'short', 'full']
    const compactBar = (w: number, label: Label, t: boolean, rtl: boolean, reserve?: number) =>
      barLayoutOf({
        barWidth: w,
        left: 40 * S,
        right: 38 * S + CAPTION,
        margins: 22 * S,
        home: 40 * S,
        tabMin: 104 * S,
        tabMins: [104 * S, 80 * S, 80 * S],
        docTabs: 3,
        padding: 20 * S,
        newButton: 32 * S,
        toggle: t ? label.toggle : 0,
        toggleIcon: t ? label.toggleIcon : undefined,
        labelStart: (rtl ? 32 : 36) * S,
        labelMin: 36 * S,
        pill: label.pill,
        hasShort: label.hasShort,
        ...(reserve === undefined ? {} : { captionReserve: reserve }),
      })
    const lastPx = (l: ReturnType<typeof barLayoutOf>) =>
      Math.max(0, Math.min(80 * S, stripOf(l) - (10 + 40 + 104 + 80) * S))
    for (const [name, label] of Object.entries(LABELS)) {
      for (const w of [722, 800, 890]) {
        for (const t of [false, true]) {
          for (const rtl of [false, true]) {
            const tag = `${name} ${w}${t ? ' +t' : ''}${rtl ? ' rtl' : ''}`
            const was = compactBar(w, label, t, rtl)
            const now = compactBar(w, label, t, rtl, captionReserveOf(CAPTION, S))
            expect(rank.indexOf(now.variant), tag).toBeLessThanOrEqual(rank.indexOf(was.variant))
            expect(Number(now.iconToggle), tag).toBeGreaterThanOrEqual(Number(was.iconToggle))
            expect(stripOf(now), tag).toBeGreaterThanOrEqual(stripOf(was))
            expect(lastPx(now), tag).toBeGreaterThanOrEqual(rtl ? 85 : 90)
            expect(Math.min(36 * S, lastPx(now) - (rtl ? 32 : 36) * S), tag).toBe(45)
            expect(now.strip.right, tag).toBeLessThanOrEqual(now.chrome.left)
          }
        }
      }
    }
  })
})

describe('SIZE-v1-4: the warn chip shrinks/caps in the pill-fit budget before the save pill degrades', () => {
  it('warnChipMaxOf caps at 340px and shrinks down to WARN_CHIP_MIN_PX before the save pill steps down', () => {
    expect(WARN_CHIP_MAX_PX).toBe(340)
    expect(WARN_CHIP_MIN_PX).toBe(88)
    expect(warnChipMaxOf({ room: 600, pillWidth: 150, scale: 1 })).toBe(340)
    // vi-dark-s125 at 1280px: 402.5 win px shared by the 189 win px full pill and the warn chip -> 170 CSS px
    expect(warnChipMaxOf({ room: 402.5, pillWidth: 189, scale: 1.25 })).toBe(170)
    // tight room floors at WARN_CHIP_MIN_PX
    expect(warnChipMaxOf({ room: 200, pillWidth: 180, scale: 1 })).toBe(WARN_CHIP_MIN_PX)
    expect(warnChipMaxOf({ room: Number.NaN, pillWidth: 150, scale: 1 })).toBe(WARN_CHIP_MAX_PX)
  })

  it('1280px at 1.25 UI scale (vi-dark-s125): a 344px warn chip shrinks to fit and keeps the save pill in its full label', () => {
    const S = 1.25
    const CAPTION = 138
    const base: BarLayoutInput = {
      barWidth: 1280,
      left: 40 * S,
      right: 38 * S + CAPTION,
      margins: 22 * S,
      home: 144.8 * S,
      tabMin: 104 * S,
      docTabs: 1,
      padding: 20 * S,
      newButton: 32 * S,
      toggle: 123,
      toggleIcon: 39.1,
      pill: { full: 189, compact: 41, mini: 35 },
      hasShort: false,
      captionReserve: captionReserveOf(CAPTION, S),
      scale: S,
    }
    const withWarn = barLayoutOf({ ...base, warnChip: 344 })
    expect(withWarn.variant).toBe('full')
    expect(withWarn.warnWidth).toBeLessThanOrEqual(WARN_CHIP_MAX_PX * S)
    expect(withWarn.warnWidth).toBeGreaterThanOrEqual(WARN_CHIP_MIN_PX * S)
    const floor = stripFloorOf(base)
    expect(withWarn.strip.right - withWarn.strip.left).toBeGreaterThanOrEqual(
      floor + captionReserveOf(CAPTION, S),
    )
    expect(withWarn.strip.right).toBeLessThanOrEqual(withWarn.chrome.left)
  })

  it('tabbar.css caps .uw-size-warn at var(--uw-warn-max, 340px)', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/src/tabbar.css'), 'utf8')
    const match = /\.uw-size-warn\s*\{([^}]*)\}/.exec(css)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(/max-width:\s*var\(--uw-warn-max,\s*340px\)/)
  })
})
