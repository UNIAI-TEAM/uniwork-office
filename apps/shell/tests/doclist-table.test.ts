/**
 * @vitest-environment jsdom
 */
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocList, type DocListProps } from '../src/renderer/src/doclist/DocList'
import { useDocListSort } from '../src/renderer/src/doclist/use-doc-list-sort'
import type { DocListScreen } from '../src/renderer/src/doclist/columns'
import { readSort, writeSort } from '../src/renderer/src/doclist/persist'
import type {
  DocumentsHomeDoc,
  DocumentsHomeTableRow,
} from '../src/renderer/src/uniwork-home/documents-home-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

// 2026-10-21 12:00 local; every date below is relative to it
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const iso = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0).toISOString()

const NO_SHARES = {
  homeWorkspace: false,
  users: 0,
  workspaces: 0,
  organization: false,
  publicLink: false,
}

const doc = (partial: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
  workspaceId: 'ws-1',
  title: partial.id,
  format: 'docx',
  updatedAt: iso(2026, 10, 21, 9, 5),
  kind: 'file',
  parentId: null,
  ...partial,
})
const rowOf = (d: DocumentsHomeDoc): DocumentsHomeTableRow => ({ type: 'doc', id: d.id, doc: d })

// three rows with different shapes; deliberately not in name, date or size order
const BUDGET = doc({
  id: 'budget',
  title: 'Kế hoạch ngân sách.xlsx',
  format: 'xlsx',
  updatedAt: iso(2026, 10, 21, 9, 5),
  sizeBytes: 2_969,
  visibility: 'workspace',
  shareScope: { ...NO_SHARES, homeWorkspace: true },
  myLevel: 'edit',
  updatedByUser: { name: 'Minh Trần', avatarUrl: 'https://cdn.example.com/minh.png' },
  updatedByName: 'Minh Trần',
})
const NOTE = doc({
  id: 'note',
  title: 'Ghi chú họp',
  format: null,
  kind: 'page',
  updatedAt: iso(2026, 10, 20, 16, 30),
  visibility: 'restricted',
  shareScope: { ...NO_SHARES, users: 2 },
  isOwner: true,
  myLevel: 'manage',
  updatedByName: 'Lan Nguyễn',
})
const REPORT = doc({
  id: 'report',
  title: 'Báo cáo Q3.docx',
  updatedAt: iso(2025, 3, 2, 8, 0),
  sizeBytes: 5_033_165,
})
const ROWS = [BUDGET, NOTE, REPORT].map(rowOf)

describe('DocList: the shared Documents table (UNI-2047 A2a)', () => {
  let host: HTMLDivElement
  let root: Root
  let width = 0
  let sortSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    width = 0
    sortSpy = vi.fn()
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const w = this.classList.contains('dh-doc-table') ? width : 0
      return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: 0, width: w, height: 0 } as DOMRect
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function Harness(props: {
    screen: DocListScreen
    rows: readonly DocumentsHomeTableRow[]
    extra?: Partial<DocListProps>
  }) {
    const [sort, setSort] = useDocListSort(props.screen)
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
    const [menu, setMenu] = useState<string | null>(null)
    return createElement(DocList, {
      screen: props.screen,
      rows: props.rows,
      sort,
      onSortChange: (next) => {
        sortSpy(next)
        setSort(next)
      },
      selected,
      onSelectedChange: setSelected,
      label: 'Tài liệu',
      openMenuId: menu,
      onOpenMenuChange: setMenu,
      menuFor: () => [],
      onOpen: () => {},
      ...props.extra,
    })
  }

  async function mount(
    screen: DocListScreen,
    rows: readonly DocumentsHomeTableRow[] = ROWS,
    lang: 'vi' | 'en' = 'vi',
    extra?: Partial<DocListProps>,
  ) {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(Harness, { screen, rows, extra }),
        ),
      )
    })
  }

  const columnIds = () =>
    Array.from(host.querySelectorAll<HTMLElement>('[role="columnheader"]')).map((el) =>
      el.getAttribute('data-col'),
    )
  const rowIds = () =>
    Array.from(host.querySelectorAll<HTMLElement>('[role="row"][data-doc-id]')).map((el) =>
      el.getAttribute('data-doc-id'),
    )
  const cell = (id: string, col: string) =>
    host.querySelector<HTMLElement>(
      `[role="row"][data-doc-id="${id}"] [role="cell"][data-col="${col}"]`,
    )
  const header = (col: string) =>
    host.querySelector<HTMLElement>(`[role="columnheader"][data-col="${col}"]`)
  const sortState = () =>
    Object.fromEntries(
      Array.from(host.querySelectorAll<HTMLElement>('[role="columnheader"]')).map((el) => [
        el.getAttribute('data-col'),
        el.getAttribute('aria-sort'),
      ]),
    )
  const click = async (el: Element | null | undefined) => {
    expect(el).toBeTruthy()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
  }
  // the language is the provider's first value: a new language is a fresh mount
  const remountIn = async (
    lang: 'vi' | 'en',
    screen: DocListScreen,
    rows: readonly DocumentsHomeTableRow[] = ROWS,
    extra?: Partial<DocListProps>,
  ) => {
    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    await mount(screen, rows, lang, extra)
  }
  // the table measures itself when it mounts: a width is a fresh mount at that width
  const mountAtWidth = async (
    w: number,
    screen: DocListScreen = 'workspace',
    rows: readonly DocumentsHomeTableRow[] = ROWS,
  ) => {
    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    width = w
    await mount(screen, rows)
  }

  it('is one table with no grid mode', async () => {
    await mount('workspace')
    const table = host.querySelector('.dh-doc-table')
    expect(table?.getAttribute('role')).toBe('table')
    expect(table?.getAttribute('aria-label')).toBe('Tài liệu')
    expect(table?.classList.contains('grid-mode')).toBe(false)
  })

  describe('columns', () => {
    const withSpecial = (screen: DocListScreen): DocumentsHomeTableRow[] => {
      const extra: Partial<DocumentsHomeDoc> =
        screen === 'recent'
          ? { lastActivity: { kind: 'edited', at: iso(2026, 10, 21, 8, 0) } }
          : screen === 'shared'
            ? { shared: { byName: 'Hải Lê', at: iso(2026, 10, 19, 8, 0) } }
            : screen === 'shared-by-me'
              ? { shareSummary: { people: 3, workspaces: 1, links: 0 } }
              : screen === 'shelved'
                ? { shelvedAt: iso(2026, 10, 19, 8, 0), shelvedByName: 'Hải Lê' }
                : screen === 'trash'
                  ? { archivedAt: iso(2026, 10, 19, 8, 0), archived: true }
                  : screen === 'starred'
                    ? { favoritedAt: iso(2026, 10, 19, 8, 0) }
                    : {}
      return [rowOf({ ...BUDGET, ...extra })]
    }

    it.each([
      ['workspace', []],
      ['recent', ['activity']],
      ['shared', ['shared']],
      ['shared-by-me', ['shared_with']],
      ['shelved', ['shelved']],
      ['trash', ['deleted']],
      ['starred', ['starred']],
    ] as const)('puts the %s columns in the shared order', async (screen, special) => {
      await mount(screen, withSpecial(screen))
      expect(columnIds()).toEqual([
        'select',
        'name',
        ...special,
        'access',
        'editor',
        'updated',
        'size',
        'actions',
      ])
    })

    it('words the headers in Vietnamese and English', async () => {
      await mount('workspace')
      const words = () =>
        Array.from(host.querySelectorAll('[role="columnheader"]')).map((el) =>
          el.textContent?.trim(),
        )
      // Chọn and Thao tác are icon/checkbox columns: they carry an aria-label, no visible word
      expect(words()).toEqual([
        '',
        'Tên',
        'Truy cập',
        'Người sửa gần nhất',
        'Cập nhật',
        'Dung lượng',
        '',
      ])
      expect(header('select')?.getAttribute('aria-label')).toBe('Chọn')
      expect(header('actions')?.getAttribute('aria-label')).toBe('Thao tác')
      await remountIn('en', 'workspace')
      expect(words()).toEqual(['', 'Name', 'Access', 'Last edited by', 'Updated', 'Size', ''])
    })

    it('hides a screen column whose field is on no loaded row, and shows it once one row has it', async () => {
      await mount('recent', ROWS)
      expect(columnIds()).toEqual([
        'select',
        'name',
        'access',
        'editor',
        'updated',
        'size',
        'actions',
      ])
      await mount('recent', [
        ...ROWS,
        rowOf({
          ...BUDGET,
          id: 'with-activity',
          lastActivity: { kind: 'opened', at: iso(2026, 10, 21, 8, 0) },
        }),
      ])
      expect(columnIds()).toContain('activity')
      // a row without the field reads "—", never "undefined"
      expect(cell('note', 'activity')?.textContent).toBe('—')
      expect(host.textContent).not.toMatch(/undefined|NaN/)
    })

    it.each([
      ['shared', 'shared'],
      ['shared-by-me', 'shared_with'],
      ['shelved', 'shelved'],
      ['trash', 'deleted'],
      ['starred', 'starred'],
    ] as const)('hides the %s screen column on rows without its field', async (screen, col) => {
      await mount(screen, ROWS)
      expect(columnIds()).not.toContain(col)
    })

    it('hides Dung lượng, then Người sửa, then Truy cập as the table narrows (no screen column)', async () => {
      await mountAtWidth(900)
      expect(columnIds()).toEqual([
        'select',
        'name',
        'access',
        'editor',
        'updated',
        'size',
        'actions',
      ])
      await mountAtWidth(700)
      expect(columnIds()).toEqual(['select', 'name', 'access', 'editor', 'updated', 'actions'])
      await mountAtWidth(600)
      expect(columnIds()).toEqual(['select', 'name', 'access', 'updated', 'actions'])
      await mountAtWidth(500)
      expect(columnIds()).toEqual(['select', 'name', 'updated', 'actions'])
    })

    it('measures the table, not the window: a resize of the table changes the columns', async () => {
      let notify: ((entries: unknown[]) => void) | null = null
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: (entries: unknown[]) => void) {
            notify = cb
          }
          observe() {}
          disconnect() {}
          unobserve() {}
        },
      )
      try {
        await mountAtWidth(900)
        expect(columnIds()).toContain('size')
        await act(async () => {
          notify?.([{ contentRect: { width: 500 } }])
        })
        expect(columnIds()).toEqual(['select', 'name', 'updated', 'actions'])
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('keeps the screen column and drops Người sửa sooner when it has one', async () => {
      await mountAtWidth(710, 'recent', [
        rowOf({ ...BUDGET, lastActivity: { kind: 'edited', at: iso(2026, 10, 21, 8, 0) } }),
      ])
      expect(columnIds()).toEqual(['select', 'name', 'activity', 'access', 'updated', 'actions'])
    })

    it('shows the whole table when it cannot be measured', async () => {
      await mount('workspace')
      expect(columnIds()).toContain('size')
      expect(columnIds()).toContain('access')
    })

    it('lays the row out on the same columns as the header', async () => {
      await mount('workspace')
      const head = host.querySelector<HTMLElement>('.dh-doc-head')!
      const row = host.querySelector<HTMLElement>('[role="row"][data-doc-id]')!
      expect(head.style.gridTemplateColumns).not.toBe('')
      expect(row.style.gridTemplateColumns).toBe(head.style.gridTemplateColumns)
      expect(row.querySelectorAll('[role="cell"]')).toHaveLength(
        head.querySelectorAll('[role="columnheader"]').length,
      )
    })
  })

  describe('cells', () => {
    it('writes dates and sizes with the shared formats in Vietnamese', async () => {
      await mount('workspace')
      expect(ROWS.map((r) => cell(r.id, 'updated')?.textContent)).toEqual([
        '09:05',
        'Hôm qua, 16:30',
        '02/03/2025',
      ])
      expect(ROWS.map((r) => cell(r.id, 'size')?.textContent)).toEqual(['2,9 KB', '—', '4,8 MB'])
    })

    it('writes dates and sizes with the shared formats in English', async () => {
      await mount('workspace', ROWS, 'en')
      expect(ROWS.map((r) => cell(r.id, 'updated')?.textContent)).toEqual([
        '09:05',
        'Yesterday, 16:30',
        'Mar 2, 2025',
      ])
      expect(ROWS.map((r) => cell(r.id, 'size')?.textContent)).toEqual(['2.9 KB', '—', '4.8 MB'])
    })

    it('draws the Truy cập pill with its scope icon and the level line from the shared rules', async () => {
      await mount('workspace')
      const pill = (id: string) => cell(id, 'access')?.querySelector('.dh-vis-badge')?.textContent
      const icon = (id: string) =>
        cell(id, 'access')?.querySelector('.dh-vis-badge svg[data-icon="inline-start"]')
      const kind = (id: string) =>
        cell(id, 'access')?.querySelector('.dh-vis-badge')?.getAttribute('data-access-kind')
      const line = (id: string) => cell(id, 'access')?.querySelector('.dh-level-sub')?.textContent
      expect([pill('budget'), kind('budget'), line('budget')]).toEqual([
        'Workspace',
        'workspace',
        'Bạn: Sửa',
      ])
      expect(icon('budget')).not.toBeNull()
      expect([pill('note'), kind('note'), line('note')]).toEqual([
        'Được chia sẻ',
        'shared',
        'Chủ sở hữu',
      ])
      expect(icon('note')).not.toBeNull()
      // no share scope is never guessed: a private row, and no level line without a level
      expect([pill('report'), kind('report'), line('report')]).toEqual([
        'Riêng tư',
        'restricted',
        undefined,
      ])
      expect(icon('report')).not.toBeNull()
    })

    it('says Private for a restricted row with nobody else, in English', async () => {
      await mount(
        'workspace',
        [rowOf(doc({ id: 'solo', visibility: 'restricted', shareScope: NO_SHARES }))],
        'en',
      )
      expect(cell('solo', 'access')?.querySelector('.dh-vis-badge')?.textContent).toBe('Private')
    })

    it('shows the editor with avatar photo when avatarUrl is present and falls back to initials on error or when absent', async () => {
      await mount('workspace')
      const person = cell('budget', 'editor')!
      expect(person.querySelector('.dh-avatar')?.textContent).toBe('MT')
      expect(person.querySelector('.dh-person-name')?.textContent).toBe('Minh Trần')
      const img = person.querySelector<HTMLImageElement>('img.dh-avatar-img')
      expect(img).not.toBeNull()
      expect(img?.getAttribute('src')).toBe('https://cdn.example.com/minh.png')
      // on image error, falls back cleanly to initials
      await act(async () => {
        img!.dispatchEvent(new Event('error'))
      })
      expect(person.querySelector('img.dh-avatar-img')).toBeNull()
      expect(person.querySelector('.dh-avatar')?.textContent).toBe('MT')
      // the name the row already carries is the fallback; no name at all reads "—"
      const notePerson = cell('note', 'editor')!
      expect(notePerson.querySelector('.dh-person-name')?.textContent).toBe('Lan Nguyễn')
      expect(notePerson.querySelector('img.dh-avatar-img')).toBeNull()
      expect(notePerson.querySelector('.dh-avatar')?.textContent).toBe('LN')
      expect(cell('report', 'editor')?.textContent).toBe('—')
    })

    it('puts the location on a second line under the name when the row has one', async () => {
      await mount('workspace', ROWS, 'vi', {
        sublineFor: (d) =>
          d.id === 'budget'
            ? { short: 'Tài chính', full: 'Công ty / Tài chính', path: false }
            : null,
      })
      expect(cell('budget', 'name')?.querySelector('.dh-doc-subpath')?.textContent).toBe(
        'Tài chính',
      )
      expect(cell('note', 'name')?.querySelector('.dh-doc-subpath')).toBeNull()
    })

    it('writes the screen column of each screen', async () => {
      await mount('recent', [
        rowOf({ ...BUDGET, lastActivity: { kind: 'edited', at: iso(2026, 10, 20, 16, 30) } }),
      ])
      expect(cell('budget', 'activity')?.textContent).toContain('Bạn đã sửa')
      expect(cell('budget', 'activity')?.textContent).toContain('Hôm qua, 16:30')

      await mount('shared-by-me', [
        rowOf({
          ...BUDGET,
          shareSummary: { people: 3, workspaces: 1, links: 0, latestAt: iso(2026, 10, 21, 7, 0) },
        }),
      ])
      expect(cell('budget', 'shared_with')?.textContent).toContain('3 người · 1 workspace')
      expect(cell('budget', 'shared_with')?.textContent).toContain('07:00')

      await mount('trash', [
        rowOf({
          ...BUDGET,
          archived: true,
          archivedAt: iso(2026, 10, 19, 8, 0),
          archivedByName: 'Hải Lê',
          purgeAfter: new Date(2026, 9, 24, 8, 0, 0).toISOString(),
        }),
      ])
      const deleted = cell('budget', 'deleted')?.textContent ?? ''
      expect(deleted).toContain('Hải Lê')
      expect(deleted).toContain('19/10')
      expect(deleted).toContain('Còn 3 ngày')
    })
  })

  describe('sort', () => {
    it('shows the screen default as the sorted header: Cập nhật newest first', async () => {
      await mount('workspace')
      expect(sortState()).toMatchObject({ name: 'none', updated: 'descending', size: 'none' })
      // newest first; the one from 2025 last
      expect(rowIds()).toEqual(['budget', 'note', 'report'])
    })

    it('makes only sortable headers buttons; Chọn, Truy cập and Thao tác have none and no aria-sort', async () => {
      await mount('workspace')
      for (const col of ['name', 'editor', 'updated', 'size']) {
        expect(header(col)?.querySelector('button')).not.toBeNull()
      }
      for (const col of ['select', 'access', 'actions']) {
        expect(header(col)?.querySelector('button')).toBeNull()
        expect(header(col)?.hasAttribute('aria-sort')).toBe(false)
      }
    })

    it('cycles aria-sort and the row order on header clicks, and tells the parent', async () => {
      await mount('workspace')
      await click(header('name')!.querySelector('button'))
      expect(sortState()).toMatchObject({ name: 'ascending', updated: 'none' })
      expect(sortSpy).toHaveBeenLastCalledWith({ column: 'name', dir: 'asc' })
      // vi collator: Báo cáo < Ghi chú < Kế hoạch
      expect(rowIds()).toEqual(['report', 'note', 'budget'])

      await click(header('name')!.querySelector('button'))
      expect(sortState()).toMatchObject({ name: 'descending' })
      expect(sortSpy).toHaveBeenLastCalledWith({ column: 'name', dir: 'desc' })
      expect(rowIds()).toEqual(['budget', 'note', 'report'])

      // a new column starts descending, except Tên and Người sửa
      await click(header('size')!.querySelector('button'))
      expect(sortState()).toMatchObject({ name: 'none', size: 'descending' })
      expect(rowIds()).toEqual(['report', 'budget', 'note'])
      await click(header('size')!.querySelector('button'))
      expect(sortState()).toMatchObject({ size: 'ascending' })
      // a page has no size: it counts as 0 and leads the ascending order
      expect(rowIds()).toEqual(['note', 'budget', 'report'])

      await click(header('editor')!.querySelector('button'))
      expect(sortState()).toMatchObject({ editor: 'ascending' })
      // Lan Nguyễn < Minh Trần; a row with no editor name sorts last in both directions
      expect(rowIds()).toEqual(['note', 'budget', 'report'])
      await click(header('editor')!.querySelector('button'))
      expect(rowIds()).toEqual(['budget', 'note', 'report'])
    })

    it('remembers the sort per screen and reads it back on the next mount', async () => {
      await mount('workspace')
      await click(header('name')!.querySelector('button'))
      await click(header('name')!.querySelector('button'))
      expect(readSort('workspace')).toEqual({ column: 'name', dir: 'desc' })
      expect(readSort('recent')).toBeNull()

      await act(async () => {
        root.unmount()
      })
      root = createRoot(host)
      await mount('workspace')
      expect(sortState()).toMatchObject({ name: 'descending' })
      expect(rowIds()).toEqual(['budget', 'note', 'report'])

      // another screen keeps its own default
      await mount('trash', [
        rowOf({ ...BUDGET, archived: true, archivedAt: iso(2026, 10, 19, 8, 0) }),
      ])
      expect(sortState()).toMatchObject({ deleted: 'ascending', name: 'none' })
    })

    it('sorts the screen column, newest first, and falls back to Cập nhật when it is hidden', async () => {
      const rows = [
        rowOf({
          ...BUDGET,
          id: 'old',
          lastActivity: { kind: 'opened', at: iso(2026, 10, 1, 8, 0) },
        }),
        rowOf({
          ...BUDGET,
          id: 'new',
          lastActivity: { kind: 'edited', at: iso(2026, 10, 20, 8, 0) },
        }),
      ]
      await mount('recent', rows)
      expect(sortState()).toMatchObject({ activity: 'descending' })
      expect(rowIds()).toEqual(['new', 'old'])

      await mount('recent', ROWS)
      expect(columnIds()).not.toContain('activity')
      expect(sortState()).toMatchObject({ updated: 'descending' })
    })

    it('does not apply a stored sort on a column the screen does not show', async () => {
      writeSort('recent', { column: 'activity', dir: 'asc' })
      await mount('recent', ROWS)
      // no row has last_activity, so the column is hidden and the sort reads Cập nhật newest first
      expect(columnIds()).not.toContain('activity')
      expect(sortState()).toMatchObject({ updated: 'descending' })
      expect(rowIds()).toEqual(['budget', 'note', 'report'])
    })
  })

  describe('selection', () => {
    it('has a checkbox per row and a select-all in the header, with names a screen reader can use', async () => {
      await mount('workspace')
      const boxes = host.querySelectorAll<HTMLInputElement>(
        '[role="row"][data-doc-id] input[type="checkbox"]',
      )
      expect(boxes).toHaveLength(3)
      expect(boxes[0]!.getAttribute('aria-label')).toBe('Chọn Kế hoạch ngân sách.xlsx')
      const all = header('select')!.querySelector<HTMLInputElement>('input[type="checkbox"]')!
      expect(all.getAttribute('aria-label')).toBe('Chọn')
      expect(all.checked).toBe(false)

      await click(boxes[1])
      expect(boxes[1]!.checked).toBe(true)
      expect(host.querySelector('[data-doc-id="note"]')?.getAttribute('aria-selected')).toBe('true')
      expect(all.indeterminate).toBe(true)

      await click(all)
      expect(Array.from(boxes).every((b) => b.checked)).toBe(true)
      await click(all)
      expect(Array.from(boxes).every((b) => !b.checked)).toBe(true)
    })

    it('does not open the document when the box is clicked', async () => {
      const onOpen = vi.fn()
      await mount('workspace', ROWS, 'vi', { onOpen })
      await click(host.querySelector('[data-doc-id="budget"] input[type="checkbox"]'))
      expect(onOpen).not.toHaveBeenCalled()
      await click(host.querySelector('[data-doc-id="budget"] .dh-doc-open'))
      expect(onOpen).toHaveBeenCalledTimes(1)
    })
  })
})
