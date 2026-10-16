import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PILL_STRIP_TABS,
  barLayoutOf,
  miniSlackOf,
  nextPillVariantOf,
  pillFitStepOf,
  pillBudgetOf,
  pillRoomOf,
  shortLabelOf,
  stripFloorOf,
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
