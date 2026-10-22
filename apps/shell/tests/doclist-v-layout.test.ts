/**
 * @vitest-environment jsdom
 *
 * UNI-2047 V-LAYOUT: the layout findings of visual r1. jsdom cannot measure layout, so the rules are
 * pinned as the ladder's numbers (columns.ts / cells.tsx), the rendered markup and the CSS rule text.
 *   F-01 every list fits its box at 768 / 720 (the column ladder has a rung below Access / Người sửa / Dung lượng)
 *   F-05 the Trash "Deleted" cell never truncates its countdown
 *   F-02 the local Home type segment wraps instead of scrolling the page
 *   F-06 / V7-1 the column headers fit their label
 *   F-07 type chips + Người sửa + Cập nhật flow as one wrapping row
 *   F-11 the search field keeps room for its placeholder
 *   V7-2 the pressed type chip reads >= 4.5:1 in dark
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { trackOf } from '../src/renderer/src/doclist/cells'
import {
  COARSE_STAR_ACTIONS_EXTRA,
  DOC_LIST_SCREENS,
  columnsFor,
  fitColumns,
  isCompact,
  specialColumn,
  type ColumnId,
  type DocListScreen,
} from '../src/renderer/src/doclist/columns'
import { SpecialContent } from '../src/renderer/src/doclist/cells'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const src = (path: string): string =>
  readFileSync(resolve(__dirname, '../src/renderer/src', path), 'utf8')

function ruleOf(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[{}]|\\*/)\\s*${escaped} \\{([^}]*)\\}`).exec(css)
  expect(match, selector).not.toBeNull()
  return match![1]!
}

/** the px of a grid track: the fixed width, or the floor of a minmax(...) */
const floorOf = (track: string): number => Number(/^(?:minmax\()?(\d+)px/.exec(track)![1])
/** the grid tracks of a template (a space inside minmax(...) does not split) */
const tracksOf = (template: string): string[] =>
  template.match(/(?:minmax|var)\([^)]*\)|\S+/g) ?? []
/** the least width (px) a row of these columns needs inside the table: the sum of the track floors */
const rowFloor = (screen: DocListScreen, columns: readonly ColumnId[], width: number): number =>
  tracksOf(trackOf(columns, screen, false, isCompact(screen, width)))
    .map(floorOf)
    .reduce((a, b) => a + b, 0)

const BOX_768 = 374
const BOX_720 = 326
const BOX_768_BUTTONS = 389
const BOX_720_BUTTONS = 341
const LISTS = DOC_LIST_SCREENS

describe('F-01: every list fits the box it is in', () => {
  // Trash and Lưu trữ lists sit in a slightly wider box (a 389 / 341 px one: no Archive-count badge)
  const isButtons = (screen: DocListScreen): boolean => screen === 'trash' || screen === 'shelved'
  it.each(
    LISTS.flatMap((screen) =>
      (isButtons(screen) ? [BOX_768_BUTTONS, BOX_720_BUTTONS] : [BOX_768, BOX_720]).map(
        (w) => [screen, w] as const,
      ),
    ),
  )(
    '%s at %i px: the row needs no more than the box and keeps Cập nhật + Thao tác',
    (screen, w) => {
      const columns = fitColumns(screen, columnsFor(screen, w), w)
      // the table border takes 2px of the box
      expect(rowFloor(screen, columns, w)).toBeLessThanOrEqual(w - 2)
      expect(columns).toContain('name')
      expect(columns).toContain('updated')
      expect(columns).toContain('actions')
    },
  )

  it('drops Truy cập, Người sửa gần nhất, Dung lượng and the screen column in a 374 px box', () => {
    for (const screen of LISTS) {
      const columns = fitColumns(screen, columnsFor(screen, BOX_768), BOX_768)
      for (const gone of ['access', 'editor', 'size'] as const) expect(columns).not.toContain(gone)
      const special = screen === 'device' ? null : specialColumn(screen)
      if (special) expect(columns).not.toContain(special)
    }
  })

  it('Tên keeps >= 180 px in a 374 px box and >= 110 px in a 326 px one (Trash / Lưu trữ: 389 / 341 px boxes, 160 / 110 px)', () => {
    for (const screen of LISTS) {
      const buttons = screen === 'trash' || screen === 'shelved'
      for (const [w, floor] of (buttons
        ? [
            [BOX_768_BUTTONS, 160],
            [BOX_720_BUTTONS, 110],
          ]
        : [
            [BOX_768, 180],
            [BOX_720, 110],
          ]) as [number, number][]) {
        const columns = fitColumns(screen, columnsFor(screen, w), w)
        const fixed = tracksOf(trackOf(columns, screen, false, true))
          .filter((_, i) => columns[i] !== 'name')
          .map(floorOf)
          .reduce((a, b) => a + b, 0)
        expect(w - 2 - fixed, `${screen} at ${w}`).toBeGreaterThanOrEqual(floor)
      }
    }
  })

  it('a table wide enough for the ladder is not touched', () => {
    for (const screen of LISTS) {
      expect(fitColumns(screen, columnsFor(screen, 2000), 2000)).toEqual(columnsFor(screen, 2000))
      expect(isCompact(screen, 2000)).toBe(false)
      expect(isCompact(screen, undefined)).toBe(false)
    }
  })

  it('keeps the screen column down to the width where Tên still has its floor', () => {
    expect(fitColumns('recent', columnsFor('recent', 544), 544)).toContain('activity')
    expect(fitColumns('recent', columnsFor('recent', 543), 543)).not.toContain('activity')
  })

  it('compact: Cập nhật is a narrow wrapping track, Tên a flexible one', () => {
    const columns = fitColumns('workspace', columnsFor('workspace', BOX_768), BOX_768)
    const tracks = tracksOf(trackOf(columns, 'workspace', false, true))
    expect(tracks[columns.indexOf('updated')]).toBe('84px')
    expect(tracks[columns.indexOf('name')]).toMatch(/^minmax\(110px, 1fr\)$/)
    expect(src('uniwork-home/documents-home.css')).toMatch(
      /\.dh-doc-table\.is-compact \.dh-doc-row \[data-col='updated'\]\s*\{[^}]*white-space:\s*normal;/,
    )
  })
})

describe('F-06 / V7-1: the headers fit their label', () => {
  it('Người sửa gần nhất has 148px (Tên gives 18px back), and an idle sort arrow takes no room', () => {
    const tracks = tracksOf(trackOf(columnsFor('recent', 2000), 'recent'))
    const columns = columnsFor('recent', 2000)
    expect(floorOf(tracks[columns.indexOf('editor')]!)).toBeGreaterThanOrEqual(148)
    const css = src('uniwork-home/documents-home.css')
    expect(ruleOf(css, '.dh-sort-head:not(.sorted) .dh-sort-arrow')).toMatch(/display:\s*none;/)
    expect(css).toMatch(
      /\.dh-sort-head:not\(\.sorted\):hover \.dh-sort-arrow[^{]*\{[^}]*display:\s*block;/,
    )
  })

  it('Dung lượng has 92px (Tên gives 8px back), wider than its 72px label plus the 16px padding', () => {
    const columns = columnsFor('recent', 2000)
    const tracks = tracksOf(trackOf(columns, 'recent'))
    expect(tracks[columns.indexOf('size')]).toBe('92px')
    expect(floorOf(tracks[columns.indexOf('name')]!)).toBe(158)
  })

  it('still shows every column of a 1280 window (886 px box) on the screens that did', () => {
    for (const screen of ['workspace', 'recent', 'starred', 'shared', 'shared-by-me'] as const) {
      expect(columnsFor(screen, 886)).toEqual(columnsFor(screen, 2000))
      expect(rowFloor(screen, columnsFor(screen, 886), 886)).toBeLessThanOrEqual(884)
    }
  })
})

describe('no rung of the ladder draws a row wider than its table', () => {
  it.each(LISTS)('%s: the sum of the track floors fits at the width a column joins', (screen) => {
    // a Trash / Lưu trữ list is never narrower than 341 px (a 720 window)
    const least = screen === 'trash' || screen === 'shelved' ? 341 : 326
    for (const w of [
      326, 341, 400, 500, 544, 560, 600, 640, 700, 760, 800, 880, 960, 1024, 1100, 2000,
    ].filter((w) => w >= least)) {
      const columns = fitColumns(screen, columnsFor(screen, w), w)
      expect(rowFloor(screen, columns, w), `${screen} at ${w}`).toBeLessThanOrEqual(w - 2)
    }
  })
})

describe('F-05: the Trash Deleted cell', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  const now = new Date('2026-10-21T05:00:00Z')
  const trashed = {
    id: 'd1',
    workspaceId: 'ws-1',
    title: 'a.docx',
    format: 'docx',
    updatedAt: '2026-10-01T00:00:00Z',
    kind: 'file',
    parentId: null,
    archivedAt: '2026-10-08T05:00:00Z',
    archivedByName: 'Nguyễn Thị Lan Anh',
    purgeAfter: '2026-11-03T05:00:00Z',
  } as unknown as DocumentsHomeDoc

  it('keeps the date in its own ellipsising span and the countdown in one that never shrinks', () => {
    act(() =>
      root.render(
        createElement(
          LocaleProvider,
          null,
          createElement(SpecialContent, { column: 'deleted', doc: trashed, now }),
        ),
      ),
    )
    const sub = host.querySelector('.dh-special-sub')!
    const date = sub.querySelector('.dh-deleted-date')
    const left = sub.querySelector('.dh-days-left')
    expect(date?.textContent).toBeTruthy()
    expect(left?.textContent).toMatch(/\d/)
    expect(sub.textContent).toContain(' · ')
    const css = src('uniwork-home/documents-home.css')
    expect(ruleOf(css, '.dh-deleted-sub')).toMatch(/display:\s*flex;/)
    expect(ruleOf(css, '.dh-deleted-date')).toMatch(/text-overflow:\s*ellipsis;/)
    expect(ruleOf(css, '.dh-deleted-countdown')).toMatch(/flex:\s*none;/)
  })

  it('gives the column the room for "20 thg 10 · Còn 13 ngày" (160px)', () => {
    const columns = columnsFor('trash', 2000)
    const tracks = tracksOf(trackOf(columns, 'trash'))
    expect(floorOf(tracks[columns.indexOf('deleted')]!)).toBeGreaterThanOrEqual(160)
  })
})

describe('F-02: the local Home type segment wraps', () => {
  it('lets the pills wrap inside the box instead of scrolling the page', () => {
    const rule = ruleOf(src('home.css'), '.filter-pills')
    expect(rule).toMatch(/flex-wrap:\s*wrap;/)
    expect(rule).toMatch(/max-width:\s*100%;/)
    expect(rule).toMatch(/min-height:\s*40px;/)
    expect(rule).not.toMatch(/[^-]height:\s*40px;/)
    expect(rule).not.toMatch(/flex-shrink:\s*0;/)
  })
})

describe('F-07: one wrapping filter row', () => {
  it('the chip group dissolves into the bar, so the selects follow the chips on the same line', () => {
    expect(ruleOf(src('uniwork-home/documents-home.css'), '.dh-filter-chips')).toMatch(
      /display:\s*contents;/,
    )
  })
})

describe('N-04: the two filter selects are one equal-width pair', () => {
  const css = src('uniwork-home/documents-home.css')
  it('never splits: one nowrap group of two equal tracks, never wider than the row', () => {
    const rule = ruleOf(css, '.dh-filter-selects')
    expect(rule).toMatch(/display:\s*inline-grid;/)
    expect(rule).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/)
    expect(rule).toMatch(/gap:\s*8px;/)
    expect(rule).toMatch(/max-width:\s*100%;/)
  })
  it('lets a long member name ellipsise inside its select instead of widening the pair', () => {
    expect(ruleOf(css, '.dh-filter-selects .dh-filter-chip')).toMatch(/min-width:\s*0;/)
    const select = ruleOf(css, '.dh-filter-selects .dh-filter-select')
    expect(select).toMatch(/min-width:\s*0;/)
    expect(select).toMatch(/flex:\s*1 1 auto;/)
    expect(select).toMatch(/text-overflow:\s*ellipsis;/)
  })
  it('uses tokens only', () => {
    const block = css.slice(css.indexOf('.dh-filter-selects {'), css.indexOf('.dh-filter-clear {'))
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })
})

describe('F-11: the search field keeps room for its placeholder', () => {
  it('has a 15rem floor (never wider than its row) in the title row and inline in a folder header', () => {
    const css = src('uniwork-home/documents-home.css')
    expect(ruleOf(css, '.dh-search-box')).toMatch(/min-width:\s*min\(15rem, 100%\);/)
    expect(css).toMatch(
      /@container \(min-width: 60rem\) \{\s*\.dh-toolbar-folder \.dh-search-box \{[^}]*min-width:\s*15rem;/,
    )
  })
})

describe('UNI-2113: the Type control and its chips use semantic tokens only', () => {
  const css = src('uniwork-home/documents-home.css')
  it('paints the trigger, the menu and the chips with tokens, in light and dark', () => {
    expect(ruleOf(css, '.dh-type-trigger')).toMatch(/background:\s*var\(--surface\);/)
    expect(ruleOf(css, '.dh-type-menu')).toMatch(/box-shadow:\s*var\(--shadow-menu\);/)
    expect(ruleOf(css, '.dh-type-menu')).toMatch(/background:\s*var\(--surface\);/)
    expect(ruleOf(css, '.dh-type-chip')).toMatch(/background:\s*var\(--surface-subtle\);/)
    expect(ruleOf(css, '.dh-type-check')).toMatch(/color:\s*var\(--accent\);/)
    const block = css.slice(css.indexOf('.dh-type-filter {'), css.indexOf('/* Sections */'))
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })
  it('opens the menu below the trigger and lets the bar wrap (no sideways scroll)', () => {
    expect(ruleOf(css, '.dh-type-menu')).toMatch(/inset-block-start:\s*calc\(100% \+ 4px\);/)
    expect(ruleOf(css, '.dh-filter-bar')).toMatch(/flex-wrap:\s*wrap;/)
  })
})

describe('RV7-9: the coarse Starred actions track reaches the ladder', () => {
  // two 44px buttons: 108px against the 76px the ladder counts
  const EXTRA = COARSE_STAR_ACTIONS_EXTRA
  const rungs = (screen: DocListScreen, extra: number): number[] =>
    ['access', 'editor', 'size'].map((column) => {
      let w = 300
      while (!columnsFor(screen, w, extra).includes(column as ColumnId)) w += 1
      return w
    })

  it('is the 32px the coarse track adds to the fine one', () => {
    expect(EXTRA).toBe(108 - 76)
  })

  it('moves every rung of Starred out so Cập nhật + Sao + ⋯ fit (the web ladder is untouched at 0)', () => {
    const fine = rungs('starred', 0)
    const coarse = rungs('starred', EXTRA)
    expect(fine).toEqual([656, 784, 864])
    expect(coarse).toEqual([688, 816, 896])
  })

  it('never draws a row wider than the table just above a rung', () => {
    for (const w of [656, 688, 784, 816, 864, 896, 1000]) {
      const columns = fitColumns('starred', columnsFor('starred', w, EXTRA), w, EXTRA)
      const floors = tracksOf(trackOf(columns, 'starred', true, isCompact('starred', w, EXTRA)))
        .map((track, i) => (columns[i] === 'actions' ? 108 : floorOf(track)))
        .reduce((a, b) => a + b, 0)
      expect(floors, `starred at ${w}`).toBeLessThanOrEqual(w - 2)
    }
  })

  it('the compact threshold counts the wider track too', () => {
    expect(isCompact('starred', 417, 0)).toBe(false)
    expect(isCompact('starred', 417, EXTRA)).toBe(true)
  })

  it('only DocList decides: a fine pointer or a screen without the Sao adds nothing', () => {
    const docList = src('doclist/DocList.tsx')
    expect(docList).toMatch(/screen === 'starred' && onUnstar && isCoarsePointer\(\)/)
    expect(docList).toMatch(/matchMedia\('\(pointer: coarse\)'\)/)
  })
})
