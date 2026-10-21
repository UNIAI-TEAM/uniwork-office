/**
 * @vitest-environment jsdom
 *
 * UNI-2047 A2c: the screen columns of Recent / Shared with me / Shared by me, the collapsible
 * day and week groups under them, and the Recent segment (Tất cả / Đã mở / Đã sửa).
 */
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocList, type DocListProps } from '../src/renderer/src/doclist/DocList'
import { useDocListSort } from '../src/renderer/src/doclist/use-doc-list-sort'
import type { DocListScreen } from '../src/renderer/src/doclist/columns'
import {
  DOCLIST_SEGMENT_KEY,
  readCollapsedGroups,
  readRecentSegment,
  writeCollapsedGroups,
  writeRecentSegment,
  writeSort,
} from '../src/renderer/src/doclist/persist'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type {
  DocumentsHomeDoc,
  DocumentsHomeSubViewId,
  DocumentsHomeTableRow,
} from '../src/renderer/src/uniwork-home/documents-home-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

// Wednesday 2026-10-21 12:00 local: yesterday is Tue 20th, this week starts Mon 19th
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const iso = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0).toISOString()
const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

const doc = (partial: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
  workspaceId: 'ws-1',
  title: partial.id,
  format: 'docx',
  updatedAt: iso(2026, 10, 21, 9, 5),
  kind: 'file',
  parentId: null,
  updatedByName: 'Minh Trần',
  sizeBytes: 2_969,
  ...partial,
})
const rowOf = (d: DocumentsHomeDoc): DocumentsHomeTableRow => ({ type: 'doc', id: d.id, doc: d })

const touched = (
  id: string,
  kind: 'opened' | 'edited' | 'commented',
  at: string,
): DocumentsHomeDoc => doc({ id, title: `${id}.docx`, lastActivity: { kind, at } })

// one row per Recent group, newest first (the screen default)
const RECENT = [
  touched('r-today', 'edited', iso(2026, 10, 21, 8, 0)),
  touched('r-yest', 'opened', iso(2026, 10, 20, 16, 30)),
  touched('r-week', 'commented', iso(2026, 10, 19, 9, 0)),
  touched('r-old', 'opened', iso(2026, 10, 10, 9, 0)),
]

const shared = (id: string, at: string, byName: string | null = 'Lan Nguyễn') =>
  doc({
    id,
    title: `${id}.docx`,
    shared: { byName: byName ?? undefined, at },
  })

describe('DocList: the special cells and groups (UNI-2047 A2c)', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
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

  function Harness(props: { screen: DocListScreen; rows: readonly DocumentsHomeTableRow[] }) {
    const [sort, setSort] = useDocListSort(props.screen)
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
    const [menu, setMenu] = useState<string | null>(null)
    const listProps: DocListProps = {
      screen: props.screen,
      rows: props.rows,
      sort,
      onSortChange: setSort,
      selected,
      onSelectedChange: setSelected,
      label: 'Tài liệu',
      openMenuId: menu,
      onOpenMenuChange: setMenu,
      menuFor: () => [],
      onOpen: () => {},
    }
    return createElement(DocList, listProps)
  }

  async function mount(
    screen: DocListScreen,
    docs: readonly DocumentsHomeDoc[],
    lang: 'vi' | 'en' = 'vi',
  ) {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(Harness, { screen, rows: docs.map(rowOf) }),
        ),
      )
    })
  }
  const remount = async (...args: Parameters<typeof mount>) => {
    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    await mount(...args)
  }

  const cell = (id: string, col: string) =>
    host.querySelector<HTMLElement>(`[data-doc-id="${id}"] [data-col="${col}"]`)
  const rowIds = () =>
    Array.from(host.querySelectorAll('[role="row"][data-doc-id]')).map((el) =>
      el.getAttribute('data-doc-id'),
    )
  const groupHeaders = () => Array.from(host.querySelectorAll<HTMLElement>('.dh-group-row'))
  const groupToggle = (label: string) =>
    groupHeaders()
      .map((row) => row.querySelector<HTMLButtonElement>('button'))
      .find((button) => button?.textContent?.includes(label)) ?? null
  const click = async (el: Element | null | undefined) => {
    expect(el).toBeTruthy()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
  }

  describe('the screen cell', () => {
    it('Recent: a coloured dot and "Bạn đã mở|sửa|bình luận" over the time, one dot colour per kind', async () => {
      await mount('recent', RECENT)
      const edited = cell('r-today', 'activity')!
      expect(edited.textContent).toContain('Bạn đã sửa')
      expect(edited.textContent).toContain('08:00')
      expect(edited.querySelector('.dh-act-dot')?.getAttribute('data-kind')).toBe('edited')
      expect(cell('r-yest', 'activity')!.textContent).toContain('Bạn đã mở')
      expect(cell('r-yest', 'activity')!.textContent).toContain('Hôm qua, 16:30')
      expect(
        cell('r-yest', 'activity')?.querySelector('.dh-act-dot')?.getAttribute('data-kind'),
      ).toBe('opened')
      expect(cell('r-week', 'activity')!.textContent).toContain('Bạn đã bình luận')
      expect(
        cell('r-week', 'activity')?.querySelector('.dh-act-dot')?.getAttribute('data-kind'),
      ).toBe('commented')
      // the dot is decoration: the words carry the meaning
      expect(edited.querySelector('.dh-act-dot')?.getAttribute('aria-hidden')).toBe('true')
    })

    it('Recent in English', async () => {
      await mount('recent', RECENT, 'en')
      expect(cell('r-today', 'activity')!.textContent).toContain('You edited')
      expect(cell('r-yest', 'activity')!.textContent).toContain('You opened')
      expect(cell('r-week', 'activity')!.textContent).toContain('You commented')
      expect(cell('r-yest', 'activity')!.textContent).toContain('Yesterday, 16:30')
    })

    it('Recent: a row without last_activity reads "—" and no dot, while other rows keep theirs', async () => {
      await mount('recent', [RECENT[0]!, doc({ id: 'bare' })])
      expect(cell('bare', 'activity')?.textContent).toBe('—')
      expect(cell('bare', 'activity')?.querySelector('.dh-act-dot')).toBeNull()
      expect(cell('r-today', 'activity')?.querySelector('.dh-act-dot')).not.toBeNull()
    })

    it('Shared with me: avatar + sharer name over the date shared; no name reads "—" over the date', async () => {
      await mount('shared', [
        shared('s-lan', iso(2026, 10, 21, 7, 0)),
        shared('s-anon', iso(2026, 10, 20, 7, 30), null),
      ])
      const lan = cell('s-lan', 'shared')!
      expect(lan.querySelector('.dh-avatar')?.textContent).toBe('LN')
      expect(lan.querySelector('.dh-person-name')?.textContent).toBe('Lan Nguyễn')
      expect(lan.querySelector('.dh-special-sub')?.textContent).toBe('07:00')
      const anon = cell('s-anon', 'shared')!
      expect(anon.querySelector('.dh-avatar')).toBeNull()
      expect(anon.querySelector('.dh-special-main')?.textContent).toBe('—')
      expect(anon.querySelector('.dh-special-sub')?.textContent).toBe('Hôm qua, 07:30')
    })

    it('Shared by me: "3 người · 1 workspace · 1 link" over the latest share, parts at zero dropped', async () => {
      await mount('shared-by-me', [
        doc({
          id: 'all-three',
          shareSummary: {
            people: 3,
            workspaces: 1,
            links: 1,
            latestAt: iso(2026, 10, 21, 7, 0),
          },
        }),
        doc({
          id: 'one-link',
          shareSummary: { people: 0, workspaces: 0, links: 1 },
        }),
      ])
      const full = cell('all-three', 'shared_with')!
      expect(full.querySelector('.dh-special-main')?.textContent).toBe(
        '3 người · 1 workspace · 1 link',
      )
      expect(full.querySelector('.dh-special-sub')?.textContent).toBe('07:00')
      const link = cell('one-link', 'shared_with')!
      expect(link.querySelector('.dh-special-main')?.textContent).toBe('1 link')
      // no latest_at: no second line, never an invented date
      expect(link.querySelector('.dh-special-sub')).toBeNull()
    })

    it('Shared by me in English', async () => {
      await mount(
        'shared-by-me',
        [
          doc({
            id: 'x',
            shareSummary: { people: 1, workspaces: 2, links: 0, latestAt: iso(2026, 10, 18, 7, 0) },
          }),
        ],
        'en',
      )
      expect(cell('x', 'shared_with')!.querySelector('.dh-special-main')?.textContent).toBe(
        '1 person · 2 workspaces',
      )
      expect(cell('x', 'shared_with')!.querySelector('.dh-special-sub')?.textContent).toBe('Oct 18')
    })

    it('hides the column when no loaded row has the field (never a guessed value)', async () => {
      for (const [screen, col] of [
        ['recent', 'activity'],
        ['shared', 'shared'],
        ['shared-by-me', 'shared_with'],
      ] as const) {
        await mount(screen, [doc({ id: 'a' }), doc({ id: 'b' })])
        expect(host.querySelector(`[role="columnheader"][data-col="${col}"]`)).toBeNull()
        expect(host.querySelector(`[data-col="${col}"]`)).toBeNull()
        expect(host.querySelector('.dh-group-row')).toBeNull()
        expect(host.textContent).not.toMatch(/undefined|NaN/)
      }
    })
  })

  describe('groups', () => {
    it('Recent: Hôm nay / Hôm qua / Tuần này / Trước đó, rows under their header in order', async () => {
      await mount('recent', RECENT)
      expect(groupHeaders().map((row) => row.textContent?.trim())).toEqual([
        'Hôm nay',
        'Hôm qua',
        'Tuần này',
        'Trước đó',
      ])
      // headers sit between the rows of their group, in the one flat row order
      const order = Array.from(
        host.querySelectorAll('.dh-group-row, [role="row"][data-doc-id]'),
      ).map((el) => el.getAttribute('data-doc-id') ?? el.textContent?.trim())
      expect(order).toEqual([
        'Hôm nay',
        'r-today',
        'Hôm qua',
        'r-yest',
        'Tuần này',
        'r-week',
        'Trước đó',
        'r-old',
      ])
    })

    it('Recent in English', async () => {
      await mount('recent', RECENT, 'en')
      expect(groupHeaders().map((row) => row.textContent?.trim())).toEqual([
        'Today',
        'Yesterday',
        'This week',
        'Earlier',
      ])
    })

    it('Shared with me: Tuần này / Trước đó by the date shared', async () => {
      await mount('shared', [
        shared('s-new', iso(2026, 10, 20, 9, 0)),
        shared('s-old', iso(2026, 10, 12, 9, 0)),
      ])
      expect(groupHeaders().map((row) => row.textContent?.trim())).toEqual(['Tuần này', 'Trước đó'])
    })

    it('Shared by me and Starred do not group', async () => {
      await mount('shared-by-me', [
        doc({
          id: 'a',
          shareSummary: { people: 1, workspaces: 0, links: 0, latestAt: iso(2026, 10, 21, 7, 0) },
        }),
      ])
      expect(host.querySelector('.dh-group-row')).toBeNull()
      await mount('starred', [doc({ id: 'a', favoritedAt: iso(2026, 10, 21, 7, 0) })])
      expect(host.querySelector('.dh-group-row')).toBeNull()
    })

    it('a group header is a toggle with aria-expanded, a name that says which group, and its rows are indented', async () => {
      await mount('recent', RECENT)
      const button = groupToggle('Hôm qua')!
      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(button.getAttribute('aria-label')).toBe('Thu gọn hoặc mở “Hôm qua”')
      expect(host.querySelector('[data-doc-id="r-yest"]')?.classList.contains('grouped')).toBe(true)
      // the header row itself is a row of the table, not a loose element
      expect(groupHeaders()[0]?.getAttribute('role')).toBe('row')
    })

    it('collapses a group (its rows leave the table) and expands it again', async () => {
      await mount('recent', RECENT)
      await click(groupToggle('Hôm qua'))
      expect(rowIds()).toEqual(['r-today', 'r-week', 'r-old'])
      expect(groupToggle('Hôm qua')?.getAttribute('aria-expanded')).toBe('false')
      // the other groups stay as they were
      expect(groupToggle('Hôm nay')?.getAttribute('aria-expanded')).toBe('true')
      await click(groupToggle('Hôm qua'))
      expect(rowIds()).toEqual(['r-today', 'r-yest', 'r-week', 'r-old'])
    })

    it('remembers the collapsed groups per screen, across a restart', async () => {
      await mount('recent', RECENT)
      await click(groupToggle('Trước đó'))
      await click(groupToggle('Hôm nay'))
      expect(readCollapsedGroups('recent').sort()).toEqual(['earlier', 'today'])
      expect(readCollapsedGroups('shared')).toEqual([])
      await remount('recent', RECENT)
      expect(rowIds()).toEqual(['r-yest', 'r-week'])
      expect(groupToggle('Trước đó')?.getAttribute('aria-expanded')).toBe('false')
      await click(groupToggle('Trước đó'))
      expect(readCollapsedGroups('recent')).toEqual(['today'])
    })

    it('Shared with me keeps its own collapsed state (same group id, other screen)', async () => {
      writeCollapsedGroups('recent', ['earlier'])
      await mount('shared', [
        shared('s-new', iso(2026, 10, 20, 9, 0)),
        shared('s-old', iso(2026, 10, 12, 9, 0)),
      ])
      expect(rowIds()).toEqual(['s-new', 's-old'])
    })

    it('are hidden when the person sorts by anything but the screen column: a flat list, no headers', async () => {
      await mount('recent', RECENT)
      expect(groupHeaders()).toHaveLength(4)
      await click(host.querySelector('[role="columnheader"][data-col="name"] button'))
      expect(groupHeaders()).toHaveLength(0)
      expect(rowIds()).toEqual(['r-old', 'r-today', 'r-week', 'r-yest'])
      expect(host.querySelector('[data-doc-id="r-old"]')?.classList.contains('grouped')).toBe(false)
    })

    it('are hidden for a remembered sort on another column, and come back with the screen column sort', async () => {
      writeSort('recent', { column: 'updated', dir: 'desc' })
      await mount('recent', RECENT)
      expect(groupHeaders()).toHaveLength(0)
      await click(host.querySelector('[role="columnheader"][data-col="activity"] button'))
      expect(groupHeaders().length).toBeGreaterThan(0)
    })

    it('still group when the screen column is sorted oldest first (the runs run the other way)', async () => {
      writeSort('recent', { column: 'activity', dir: 'asc' })
      await mount('recent', RECENT)
      expect(groupHeaders().map((row) => row.textContent?.trim())).toEqual([
        'Trước đó',
        'Tuần này',
        'Hôm qua',
        'Hôm nay',
      ])
    })

    it('a store that cannot be read or written still renders every group open, and toggling works in the session', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
        if (key.includes('uniwork.wb.')) throw new Error('blocked')
        return null
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
        if (key.includes('uniwork.wb.')) throw new Error('quota')
      })
      await mount('recent', RECENT)
      expect(rowIds()).toEqual(['r-today', 'r-yest', 'r-week', 'r-old'])
      expect(groupHeaders()).toHaveLength(4)
      await click(groupToggle('Hôm qua'))
      expect(rowIds()).toEqual(['r-today', 'r-week', 'r-old'])
    })

    it('a stored value that is not the web shape renders everything open', async () => {
      localStorage.setItem('uniwork.wb.doclist.groups', 'not json')
      await mount('recent', RECENT)
      expect(rowIds()).toEqual(['r-today', 'r-yest', 'r-week', 'r-old'])
      localStorage.setItem('uniwork.wb.doclist.groups', JSON.stringify({ recent: ['nope', 7] }))
      await remount('recent', RECENT)
      expect(rowIds()).toEqual(['r-today', 'r-yest', 'r-week', 'r-old'])
    })

    it('a row with no usable date falls in the last group, not off the list', async () => {
      await mount('recent', [
        ...RECENT,
        doc({ id: 'r-bad', lastActivity: { kind: 'opened', at: 'not a date' } }),
      ])
      expect(rowIds()).toContain('r-bad')
      expect(host.textContent).not.toMatch(/undefined|NaN/)
    })
  })
})

describe('the Recent segment: stored choice', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('stores under uniwork.wb.doclist.segment and reads it back; nothing stored = All', () => {
    expect(DOCLIST_SEGMENT_KEY).toBe('uniwork.wb.doclist.segment')
    expect(readRecentSegment()).toBe('all')
    writeRecentSegment('opened')
    expect(readRecentSegment()).toBe('opened')
    writeRecentSegment('edited')
    expect(JSON.parse(localStorage.getItem(DOCLIST_SEGMENT_KEY)!)).toEqual({ recent: 'edited' })
    writeRecentSegment('all')
    expect(readRecentSegment()).toBe('all')
  })

  it.each(['not json', '[]', '7', '{"recent":"commented"}', '{"recent":3}', '{"shared":"opened"}'])(
    'a stored value the app does not know (%s) reads as All',
    (raw) => {
      localStorage.setItem(DOCLIST_SEGMENT_KEY, raw)
      expect(readRecentSegment()).toBe('all')
    },
  )

  it('an unreadable or unwritable store reads All and never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(readRecentSegment()).toBe('all')
    expect(() => writeRecentSegment('opened')).not.toThrow()
  })
})

describe('DocumentsHome: the Recent segment sends activity (UNI-2047 A2c)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let recentItems: DocumentsHomeDoc[]
  const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]

  async function flush(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    recentItems = RECENT
    const empty = () => ok({ documents: [], nextCursor: null })
    api = {
      uniworkFolderTree: vi.fn(async () => ok([])),
      uniworkEnsureMyFolder: vi.fn(async () =>
        ok({
          id: 'f-mine',
          parentId: null,
          title: 'My Folder',
          position: 0,
          kind: 'my_folder' as const,
          isSystem: true,
          children: [],
        }),
      ),
      uniworkListChildren: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkListDocuments: vi.fn(async () => ok({ documents: recentItems, nextCursor: null })),
      uniworkListSharedWithMe: vi.fn(async () => empty()),
      uniworkListSharedByMe: vi.fn(async () => empty()),
      uniworkListTrash: vi.fn(async () => empty()),
      uniworkListShelved: vi.fn(async () => empty()),
      uniworkListSources: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
    }
    ;(window as unknown as { aiOffice: unknown; home: unknown }).aiOffice = api
    ;(window as unknown as { aiOffice: unknown; home: unknown }).home = api
    host = document.createElement('div')
    sidebarSlot = document.createElement('div')
    document.body.appendChild(sidebarSlot)
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    sidebarSlot.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function mount(subView: DocumentsHomeSubViewId = 'recent') {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument: vi.fn(),
            sidebarHost: sidebarSlot,
            initialSubView: subView,
          }),
        ),
      )
    })
    await flush()
  }
  async function remount(subView: DocumentsHomeSubViewId = 'recent') {
    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    await mount(subView)
  }
  const segment = () => host.querySelector<HTMLElement>('.dh-segment')
  const seg = (value: 'all' | 'opened' | 'edited') =>
    host.querySelector<HTMLButtonElement>(`.dh-segment [data-seg="${value}"]`)
  const click = async (el: Element | null | undefined) => {
    expect(el).toBeTruthy()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
    await flush()
  }
  const lastCall = (fn: string) => {
    const calls = api[fn]!.mock.calls
    return calls[calls.length - 1]?.[0] as Record<string, unknown>
  }

  it('draws Tất cả · Đã mở · Đã sửa on Recent, All selected, and sends no activity', async () => {
    await mount('recent')
    expect(segment()?.getAttribute('role')).toBe('group')
    expect(Array.from(segment()!.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Tất cả',
      'Đã mở',
      'Đã sửa',
    ])
    expect(seg('all')?.getAttribute('aria-pressed')).toBe('true')
    expect(seg('opened')?.getAttribute('aria-pressed')).toBe('false')
    expect(lastCall('uniworkListDocuments')).not.toHaveProperty('activity')
  })

  it('sends activity=opened / edited from the first page, and nothing again for Tất cả', async () => {
    await mount('recent')
    await click(seg('opened'))
    expect(lastCall('uniworkListDocuments')).toMatchObject({ activity: 'opened' })
    expect(lastCall('uniworkListDocuments')).not.toHaveProperty('cursor')
    expect(seg('opened')?.getAttribute('aria-pressed')).toBe('true')
    expect(seg('all')?.getAttribute('aria-pressed')).toBe('false')
    await click(seg('edited'))
    expect(lastCall('uniworkListDocuments')).toMatchObject({ activity: 'edited' })
    await click(seg('all'))
    expect(lastCall('uniworkListDocuments')).not.toHaveProperty('activity')
  })

  it('keeps the other filters when the segment changes', async () => {
    await mount('recent')
    await click(host.querySelector('[data-chip="xlsx"]'))
    await click(seg('edited'))
    expect(lastCall('uniworkListDocuments')).toMatchObject({ activity: 'edited', format: 'xlsx' })
  })

  it('remembers the choice: a restart opens Recent on it and the first request already carries it', async () => {
    await mount('recent')
    await click(seg('edited'))
    expect(readRecentSegment()).toBe('edited')
    api.uniworkListDocuments!.mockClear()
    await remount('recent')
    expect(seg('edited')?.getAttribute('aria-pressed')).toBe('true')
    expect(api.uniworkListDocuments!.mock.calls[0]?.[0]).toMatchObject({ activity: 'edited' })
  })

  it('stays on screen when the chosen segment has no rows, so the person can get back to Tất cả', async () => {
    writeRecentSegment('opened')
    recentItems = []
    await mount('recent')
    expect(segment()).not.toBeNull()
    expect(seg('opened')?.getAttribute('aria-pressed')).toBe('true')
    recentItems = RECENT
    await click(seg('all'))
    expect(rowCount()).toBe(4)
  })

  it('is not drawn when the loaded rows have no last_activity (server field missing)', async () => {
    recentItems = RECENT.map((d) => ({ ...d, lastActivity: undefined }))
    await mount('recent')
    expect(segment()).toBeNull()
    expect(host.querySelector('.dh-group-row')).toBeNull()
    expect(lastCall('uniworkListDocuments')).not.toHaveProperty('activity')
  })

  it('is on Recent only: no segment and no activity on the other screens', async () => {
    for (const subView of [
      'workspace',
      'shared-with-me',
      'shared-by-me',
      'trash',
      'archive',
    ] as const) {
      writeRecentSegment('opened')
      await remount(subView)
      expect(segment()).toBeNull()
    }
    for (const fn of [
      'uniworkListChildren',
      'uniworkListSharedWithMe',
      'uniworkListSharedByMe',
      'uniworkListTrash',
      'uniworkListShelved',
    ]) {
      for (const call of api[fn]!.mock.calls) expect(call[0]).not.toHaveProperty('activity')
    }
  })

  it('Recent shows its groups with the rows of the loaded page', async () => {
    await mount('recent')
    expect(
      Array.from(host.querySelectorAll('.dh-group-row')).map((row) => row.textContent?.trim()),
    ).toEqual(['Hôm nay', 'Hôm qua', 'Tuần này', 'Trước đó'])
  })

  function rowCount(): number {
    return host.querySelectorAll('[role="row"][data-doc-id]').length
  }
})

describe('the group indent is 28px (CSS)', () => {
  it('documents-home.css indents a grouped row by 28px with theme tokens only', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(
      new URL('../src/renderer/src/uniwork-home/documents-home.css', import.meta.url),
      'utf8',
    )
    expect(css).toMatch(/\.dh-doc-row\.grouped\s*\{[^}]*28px/)
    expect(css).toMatch(/\.dh-group-row\b/)
    expect(css).toMatch(/\.dh-act-dot\b/)
    expect(css).toMatch(/\.dh-segment\b/)
  })
})
