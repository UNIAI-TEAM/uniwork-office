import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PILL_STRIP_TABS,
  barLayoutOf,
  nextPillVariantOf,
  pillFitStepOf,
  pillBudgetOf,
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
const PILL = { full: 309, short: 190, compact: 111 }

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
    const old = layout(890, 2, { pill: { full: 309, short: 309, compact: 309 }, hasShort: false })
    expect(old.strip.right - old.strip.left).toBeLessThan(floor)
  })

  it('a wider window never picks a narrower variant', () => {
    const rank = { full: 0, short: 1, compact: 2 } as const
    for (const n of tabCounts) {
      let previous = 2
      for (let w = 720; w <= 1400; w += 10) {
        const r = rank[layout(w, n).variant]
        expect(r, `${w}px ${n} tabs`).toBeLessThanOrEqual(previous)
        previous = r
      }
    }
  })

  it('more document tabs never give the pill more room', () => {
    const rank = { full: 0, short: 1, compact: 2 } as const
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

  it('720px (the window minimum) degrades to icon + action and still leaves the strip all the rest', () => {
    const l = layout(720, 3)
    expect(l.variant).toBe('compact')
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
  const REAL_PILL = { full: 314, short: 187, compact: 113 }

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
      pill: { full: 314, short: 314, compact: 314 },
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
      pill: { full: 134, short: 134, compact: 30 },
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

  it("722px with three tabs: compact pill, icon-only toggle, the strip gains the toggle's label width", () => {
    const l = withIcon(722, 3)
    expect(l.variant).toBe('compact')
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
          expect(l.variant, `${w}px ${n} tabs`).toBe('compact')
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
    const has = { short: true }

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
      ).toEqual({ variant: 'compact', iconToggle: false })
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
