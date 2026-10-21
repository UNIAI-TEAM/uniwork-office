/**
 * @vitest-environment jsdom
 *
 * UNI-2047 V-FIX2: the findings of visual r2. jsdom cannot measure layout, so the rules are pinned
 * as the ladder's numbers (columns.ts / cells.tsx), the rendered markup and the CSS rule text.
 *   N-01 the Elsewhere page header never outgrows the content box (the subtitle gives way first)
 *   N-02 Trash below the Deleted column: the countdown moves under the Name; narrowest, Restore is the menu's
 *   N-03 the vi headers "Dung lượng" / "Người sửa gần nhất" keep their whole label
 *   N-05 a grouped row gives its 28px indent back where Tên has no room (compact)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CompactTableContext, trackOf } from '../src/renderer/src/doclist/cells'
import { columnsFor, fitColumns, isCompact } from '../src/renderer/src/doclist/columns'
import { DocRow, type DocRowProps } from '../src/renderer/src/doclist/DocRow'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const css = readFileSync(
  resolve(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
  'utf8',
)

function ruleOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[{}]|\\*/)\\s*${escaped} \\{([^}]*)\\}`).exec(css)
  expect(match, selector).not.toBeNull()
  return match![1]!
}

describe('N-01: the title row of a page with a subtitle shrinks its text, not its neighbours', () => {
  it('lets the title group yield first and the subtitle ellipsise', () => {
    const group = ruleOf('.dh-title-group.dh-title-stack')
    expect(group).toMatch(/flex:\s*0 100 auto;/)
    // N-08: the floor is the h1 "From elsewhere" (175px), never narrower
    expect(group).toMatch(/min-width:\s*11\.5rem;/)
    const sub = ruleOf('.dh-subtitle')
    expect(sub).toMatch(/overflow:\s*hidden;/)
    expect(sub).toMatch(/text-overflow:\s*ellipsis;/)
    expect(sub).toMatch(/white-space:\s*nowrap;/)
    expect(sub).toMatch(/max-width:\s*100%;/)
  })
})

describe('N-02: Trash below the Deleted column', () => {
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
    title: 'Launch review.pptx',
    format: 'pptx',
    updatedAt: '2026-10-01T00:00:00Z',
    kind: 'file',
    parentId: null,
    archived: true,
    archivedAt: '2026-10-08T05:00:00Z',
    archivedByName: 'Nguyễn Thị Lan Anh',
    purgeAfter: '2026-10-22T05:00:00Z',
  } as unknown as DocumentsHomeDoc

  const render = (columns: DocRowProps['columns'], compact: boolean, screen = 'trash' as const) =>
    act(() =>
      root.render(
        createElement(
          LocaleProvider,
          null,
          createElement(
            CompactTableContext.Provider,
            { value: compact },
            createElement(DocRow, {
              doc: trashed,
              screen,
              columns,
              now,
              selected: false,
              onSelectedChange: () => undefined,
              opening: false,
              subline: null,
              rename: null,
              actions: createElement('button', { className: 'dh-trash-restore' }, 'Restore'),
              menu: [],
              menuOpen: false,
              onMenuOpenChange: () => undefined,
              onOpen: () => undefined,
            }),
          ),
        ),
      ),
    )

  it('puts who · date · countdown under the Name once the Deleted column is gone', () => {
    render(['name', 'updated', 'actions'], false)
    const line = host.querySelector('[data-col="name"] .dh-deleted-line')
    expect(line).not.toBeNull()
    expect(line!.querySelector('.dh-deleted-who')?.textContent).toBe('Nguyễn Thị Lan Anh')
    expect(line!.querySelector('.dh-deleted-date')?.textContent).toBeTruthy()
    expect(line!.querySelector('.dh-days-left')?.textContent).toMatch(/1 day left/)
    // the last day is red, as in the column
    expect(line!.querySelector('.dh-days-soon')).not.toBeNull()
  })

  it('draws no second copy while the Deleted column is there', () => {
    render(['name', 'deleted', 'updated', 'actions'], false)
    expect(host.querySelector('.dh-deleted-line')).toBeNull()
    expect(host.querySelector('[data-col="deleted"] .dh-days-left')).not.toBeNull()
  })

  it('a trashed row without a purge date draws no countdown, and a row of another screen no line', () => {
    render(['name', 'updated', 'actions'], false, 'trash')
    act(() =>
      root.render(
        createElement(
          LocaleProvider,
          null,
          createElement(DocRow, {
            doc: { ...trashed, purgeAfter: undefined } as DocumentsHomeDoc,
            screen: 'trash',
            columns: ['name', 'updated', 'actions'],
            now,
            selected: false,
            onSelectedChange: () => undefined,
            opening: false,
            subline: null,
            rename: null,
            menu: [],
            menuOpen: false,
            onMenuOpenChange: () => undefined,
            onOpen: () => undefined,
          }),
        ),
      ),
    )
    expect(host.querySelector('.dh-deleted-line')).not.toBeNull()
    expect(host.querySelector('.dh-days-left')).toBeNull()
    render(['name', 'updated', 'actions'], false, 'workspace' as never)
    expect(host.querySelector('.dh-deleted-line')).toBeNull()
  })

  it('keeps the Restore button while the row has room, and hands it to the menu in a compact table', () => {
    render(['name', 'updated', 'actions'], false)
    expect(host.querySelector('.dh-trash-restore')).not.toBeNull()
    render(['name', 'updated', 'actions'], true)
    expect(host.querySelector('.dh-trash-restore')).toBeNull()
  })

  it('the compact Trash actions track is the 76px of "…" alone; the shelf keeps its 140px button track', () => {
    const columns = ['name', 'updated', 'actions'] as const
    expect(trackOf(columns, 'trash', false, true).split(' ').pop()).toBe('76px')
    expect(trackOf(columns, 'shelved', false, true).split(' ').pop()).toBe('140px')
    expect(trackOf(columns, 'trash', false, false).split(' ').pop()).toBe('176px')
  })

  it('gives Tên >= 160px in a 341px (a 720 window) and 389px (a 768 window) Trash box', () => {
    for (const w of [341, 389]) {
      const columns = fitColumns('trash', columnsFor('trash', w), w)
      expect(isCompact('trash', w)).toBe(true)
      const fixed = (trackOf(columns, 'trash', false, true).match(/minmax\([^)]*\)|\S+/g) ?? [])
        .filter((_, i) => columns[i] !== 'name')
        .map((track) => Number(/^(\d+)px$/.exec(track)![1]))
        .reduce((a, b) => a + b, 0)
      expect(w - 2 - fixed, `${w}`).toBeGreaterThanOrEqual(160)
    }
  })

  it('the line keeps the countdown whole: who gives way first, then the date', () => {
    expect(ruleOf('.dh-deleted-line')).toMatch(/display:\s*flex;/)
    expect(ruleOf('.dh-deleted-who')).toMatch(/flex:\s*0 100 auto;/)
    expect(ruleOf('.dh-deleted-who')).toMatch(/text-overflow:\s*ellipsis;/)
  })
})

describe('N-03: the headers keep their whole label', () => {
  it('lets the sort button use the 6px of the cell padding its negative margin gives back', () => {
    expect(ruleOf('.dh-sort-head')).toMatch(/max-width:\s*calc\(100% \+ 12px\);/)
  })
})

describe('N-05: a compact table gives the group indent back', () => {
  it('drops the 28px indent under the ladder, where Tên has the least room', () => {
    expect(css).toMatch(
      /\.dh-doc-table\.is-compact \.dh-doc-row\.grouped\s*\{[^}]*--dh-group-indent:\s*0px;/,
    )
  })
})
