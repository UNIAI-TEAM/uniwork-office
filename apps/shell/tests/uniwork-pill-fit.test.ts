import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PILL_STRIP_TABS,
  barLayoutOf,
  nextPillVariantOf,
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
