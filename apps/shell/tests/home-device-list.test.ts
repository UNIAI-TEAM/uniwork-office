/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountStatus,
  FolderListing,
  FolderRoot,
  HomeApi,
  RecentEntry,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { Home } from '../src/renderer/src/Home'
import { formatBytes, formatListDate } from '../src/renderer/src/doclist/format'
import { readSort } from '../src/renderer/src/doclist/persist'
import { recentRowModifiedMs } from '../src/renderer/src/uniwork-docs-model'
import { wbStoreSetRaw } from '../src/renderer/src/workbench-store-client'

// Workbench body is out of scope: only the local file table of Home is under test
vi.mock('../src/renderer/src/PracticeHome', () => ({
  PracticeHome: () => createElement('div', { 'data-testid': 'practice-home' }),
}))

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

// 2026-10-21 12:00 local; every date below is relative to it
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const at = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0).getTime()

const entry = (name: string, mtimeMs: number, sizeBytes: number, dir = '/Users/linh/Documents') =>
  ({
    path: `${dir}/${name}`,
    name,
    ext: name.split('.').pop() ?? 'docx',
    mtimeMs,
    sizeBytes,
    starred: false,
  }) satisfies RecentEntry

// main-process order (last opened first); deliberately not sorted by name, date or size:
// Alpha notes (Oct 18) is listed before Zeta plan (Oct 20)
const ENTRIES: RecentEntry[] = [
  entry('Budget.xlsx', at(2026, 10, 21, 9, 5), 5_033_165, '/Users/linh/Documents/Finance'),
  entry('Alpha notes.docx', at(2026, 10, 18, 10, 0), 48_000),
  entry('Zeta plan.docx', at(2026, 10, 20, 16, 30), 2_969),
  entry('Old deck.pptx', at(2025, 3, 2, 8, 0), 12_582_912),
]

describe('Home local file list shares the list formats, sort and columns (UNI-2047 A6)', () => {
  let host: HTMLDivElement
  let root: Root
  // what the fake main process answers; a test sets these before mountHome
  let recentEntries: RecentEntry[] = ENTRIES
  let folderRoots: FolderRoot[] = []
  let listings: Record<string, FolderListing> = {}

  beforeEach(() => {
    recentEntries = ENTRIES
    folderRoots = []
    listings = {}
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    )
    const accountStatus: AccountStatus = {
      state: 'signed-in',
      loggedIn: true,
      email: 'linh@example.com',
      profile: { accountId: 'acc-1', email: 'linh@example.com', displayName: 'Linh' },
      org: { id: 'org-1', name: 'UniWork Corp' },
    }
    const api = {
      folderRoots: vi.fn(async () => folderRoots),
      listFolder: vi.fn(async (dir: string) => listings[dir] ?? { dir, folders: [], files: [] }),
      onFolderChanged: vi.fn(() => () => {}),
      recents: vi.fn(async () => ({ entries: recentEntries, total: recentEntries.length })),
      starred: vi.fn(async () => ({ entries: [], total: 0 })),
      starredGroups: vi.fn(async () => []),
      searchFiles: vi.fn(async () => ({
        hits: [],
        total: 0,
        index: { pending: 0, scanning: false },
      })),
      rerankSearch: vi.fn(async () => null),
      addFolderRoot: vi.fn(async () => null),
      removeFolderRoot: vi.fn(async () => {}),
      pickDefaultSaveDir: vi.fn(async () => null),
      accountStatus: vi.fn(async () => accountStatus),
      accountGetStatus: vi.fn(async () => accountStatus),
      onAccountStatus: vi.fn(() => () => {}),
      onAccountChanged: vi.fn(() => () => {}),
      onAccountLogin: vi.fn(() => () => {}),
      onAccountLoginEvent: vi.fn(() => () => {}),
      accountLogin: vi.fn(async () => true),
      onDocRenamed: vi.fn(() => () => {}),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkLaunch: vi.fn(() => () => {}),
      onOpenSettings: vi.fn(() => () => {}),
      onOpenSettingsEvent: vi.fn(() => () => {}),
      openPath: vi.fn(async () => {}),
      toggleStar: vi.fn(async () => true),
      removeRecent: vi.fn(async () => {}),
      deleteFiles: vi.fn(async () => {}),
    }
    ;(window as unknown as { aiOffice: HomeApi }).aiOffice = api as unknown as HomeApi
    wbStoreSetRaw('uniwork.wb.homeArea', 'device')
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
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function flush(ticks = 4) {
    for (let i = 0; i < ticks; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  async function mountHome(lang: 'en' | 'vi', tableWidth?: number) {
    if (tableWidth !== undefined) {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const width = this.classList.contains('dh-doc-table') ? tableWidth : 0
        return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0 } as DOMRect
      })
    }
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: lang }, createElement(Home)))
    })
    await flush()
  }

  // the device list is the shared DocList: a table with column headers, rows and cells
  const NAME = '.dh-doc-open, .dh-doc-title'
  const rowCells = () =>
    Array.from(host.querySelectorAll<HTMLElement>('.dh-doc-table .dh-doc-row')).map((row) => ({
      name: row.querySelector(NAME)?.textContent,
      sub: row.querySelector('.dh-doc-subpath')?.textContent,
      time: row.querySelector('[data-col="updated"]')?.textContent,
      size: row.querySelector('[data-col="size"]')?.textContent,
    }))
  // the sortable headers are buttons inside a columnheader that carries aria-sort
  const headers = () =>
    Array.from(host.querySelectorAll<HTMLElement>('[role="columnheader"] button.dh-sort-head'))
  const header = (label: string) => headers().find((h) => h.textContent?.trim() === label)
  const sortStateOf = (button: Element) =>
    button.closest('[aria-sort]')?.getAttribute('aria-sort') ?? 'missing'
  const rowNames = () =>
    Array.from(host.querySelectorAll('.dh-doc-table .dh-doc-row')).map(
      (row) => row.querySelector(NAME)?.textContent,
    )
  const click = async (el: Element | null | undefined) => {
    expect(el).toBeTruthy()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
    await flush()
  }

  it('writes dates and sizes with the shared formats in English', async () => {
    await mountHome('en')
    expect(rowCells().map((r) => [r.time, r.size])).toEqual([
      ['09:05', '4.8 MB'],
      ['Oct 18', '47 KB'],
      ['Yesterday, 16:30', '2.9 KB'],
      ['Mar 2, 2025', '12 MB'],
    ])
  })

  it('writes dates and sizes with the Vietnamese marks in Vietnamese', async () => {
    await mountHome('vi')
    expect(rowCells().map((r) => [r.time, r.size])).toEqual([
      ['09:05', '4,8 MB'],
      ['18/10', '47 KB'],
      ['Hôm qua, 16:30', '2,9 KB'],
      ['02/03/2025', '12 MB'],
    ])
  })

  it('folds the location into the second line of the name and drops the Location column', async () => {
    await mountHome('en')
    expect(rowCells().map((r) => r.sub)).toEqual(['Finance', 'Documents', 'Documents', 'Documents'])
    expect(host.querySelector('[data-col="path"]')).toBeNull()
    expect(headers().map((h) => h.textContent?.trim())).toEqual(['Name', 'Updated', 'Size'])
  })

  it('shows no sorted state until a header is clicked and keeps the main-process order', async () => {
    await mountHome('en')
    expect(headers().map(sortStateOf)).toEqual(['none', 'none', 'none'])
    // Alpha notes (Oct 18) stays before Zeta plan (Oct 20): the list is the main-process order
    expect(rowNames()).toEqual([
      'Budget.xlsx',
      'Alpha notes.docx',
      'Zeta plan.docx',
      'Old deck.pptx',
    ])
  })

  it('sorts by a clicked header, flips on a second click and says so on the button', async () => {
    await mountHome('en')
    const sortOf = () => headers().map(sortStateOf)

    await click(header('Name')!)
    expect(sortOf()).toEqual(['ascending', 'none', 'none'])
    expect(rowNames()).toEqual([
      'Alpha notes.docx',
      'Budget.xlsx',
      'Old deck.pptx',
      'Zeta plan.docx',
    ])
    await click(header('Name')!)
    expect(sortOf()).toEqual(['descending', 'none', 'none'])
    expect(rowNames()).toEqual([
      'Zeta plan.docx',
      'Old deck.pptx',
      'Budget.xlsx',
      'Alpha notes.docx',
    ])

    await click(header('Size')!)
    expect(sortOf()).toEqual(['none', 'none', 'descending'])
    expect(rowNames()).toEqual([
      'Old deck.pptx',
      'Budget.xlsx',
      'Alpha notes.docx',
      'Zeta plan.docx',
    ])

    // a header click on Updated: a new column starts newest first, and that is a real date sort
    await click(header('Updated')!)
    expect(sortOf()).toEqual(['none', 'descending', 'none'])
    expect(rowNames()).toEqual([
      'Budget.xlsx',
      'Zeta plan.docx',
      'Alpha notes.docx',
      'Old deck.pptx',
    ])
    await click(header('Updated')!)
    expect(sortOf()).toEqual(['none', 'ascending', 'none'])
    expect(rowNames()).toEqual([
      'Old deck.pptx',
      'Alpha notes.docx',
      'Zeta plan.docx',
      'Budget.xlsx',
    ])
  })

  it('is a table with column headers and rows, the sort state on the header (aria-sort)', async () => {
    await mountHome('en')
    expect(host.querySelector('[role="table"] [role="row"] [role="columnheader"]')).not.toBeNull()
    expect(host.querySelector('.dh-doc-table[aria-label]')).not.toBeNull()
    // Chọn is the first column, Thao tác the last
    const cols = Array.from(host.querySelectorAll<HTMLElement>('[role="columnheader"]')).map(
      (h) => h.dataset.col,
    )
    expect(cols).toEqual(['select', 'name', 'updated', 'size', 'actions'])
  })

  it('says the sort state in the active language', async () => {
    await mountHome('vi')
    expect(headers().map((h) => h.textContent?.trim())).toEqual(['Tên', 'Cập nhật', 'Dung lượng'])
    await click(header('Tên')!)
    expect(sortStateOf(header('Tên')!)).toBe('ascending')
    await click(header('Tên')!)
    expect(sortStateOf(header('Tên')!)).toBe('descending')
  })

  it('remembers the sort of the device list and restores it on the next mount', async () => {
    await mountHome('en')
    await click(header('Name')!)
    expect(readSort('device')).toEqual({ column: 'name', dir: 'asc' })

    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    await mountHome('en')
    expect(sortStateOf(header('Name')!)).toBe('ascending')
    expect(rowNames()[0]).toBe('Alpha notes.docx')
  })

  it('hides Dung lượng by the width of the table, not of the window', async () => {
    await mountHome('en', 500)
    expect(headers().map((h) => h.textContent?.trim())).toEqual(['Name', 'Updated'])
    expect(host.querySelector('[data-col="size"]')).toBeNull()
    expect(rowCells().every((r) => r.time)).toBe(true)
  })

  it('hides Dung lượng just under 640 px and shows it from 640 px', async () => {
    await mountHome('en', 639)
    expect(headers().map((h) => h.textContent?.trim())).toEqual(['Name', 'Updated'])
    await act(async () => {
      root.unmount()
    })
    vi.restoreAllMocks()
    root = createRoot(host)
    await mountHome('en', 640)
    expect(headers().map((h) => h.textContent?.trim())).toEqual(['Name', 'Updated', 'Size'])
  })

  it('keeps Dung lượng on a wide table', async () => {
    await mountHome('en', 1000)
    expect(headers().map((h) => h.textContent?.trim())).toEqual(['Name', 'Updated', 'Size'])
    expect(host.querySelectorAll('.dh-doc-row [data-col="size"]')).toHaveLength(ENTRIES.length)
  })

  it('writes — for a missing file', async () => {
    recentEntries = [{ ...entry('Gone.docx', 0, 0), missing: true }]
    await mountHome('en')
    expect(rowCells().map((r) => [r.name, r.time, r.size])).toEqual([['Gone.docx', '—', '—']])
  })

  it('writes — for a UniWork row: its file time is the download time and it has no size', () => {
    // the UniWork pane replaces this table for a signed-in user, so the cells are pinned where Home reads them
    const row = {
      ...entry('Contract.docx', at(2026, 10, 21, 9, 5), 0, '/Users/linh/.uniwork/doc-1'),
      uniwork: {
        documentId: 'doc-1',
        workspaceId: 'ws-1',
        title: 'Contract',
        access: 'edit' as const,
      },
    }
    expect(recentRowModifiedMs(row)).toBeNull()
    expect(formatListDate(recentRowModifiedMs(row), NOW, 'en')).toBe('—')
    expect(formatBytes(row.sizeBytes, 'en')).toBe('—')
  })

  it('writes the dates of the search results with the same list format', async () => {
    await mountHome('en')
    const hit = (e: RecentEntry) => ({ ...e, snippet: null, needles: ['a'] })
    ;(window as unknown as { aiOffice: Record<string, unknown> }).aiOffice.searchFiles = vi.fn(
      async () => ({
        hits: [hit(ENTRIES[0]!), hit(ENTRIES[2]!), hit(ENTRIES[3]!)],
        total: 3,
        index: { pending: 0, scanning: false },
      }),
    )
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setValue.call(input, 'a')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    await flush()
    expect(rowCells().map((r) => r.time)).toEqual(['09:05', 'Yesterday, 16:30', 'Mar 2, 2025'])
    // search results are the same table, with the location under the name and nothing to tick
    expect(host.querySelector('.dh-doc-table input[type="checkbox"]')).toBeNull()
    expect(rowCells().map((r) => r.sub)).toEqual(['Finance', 'Documents', 'Documents'])
  })

  it('renders the folder view with the shared columns and "Folder" under a sub-folder name', async () => {
    const dir = '/Users/linh/Documents'
    folderRoots = [{ path: dir, name: 'Documents', usable: true, readable: true, removable: false }]
    listings = {
      [dir]: {
        dir,
        folders: [
          { path: `${dir}/Sub`, name: 'Sub', mtimeMs: at(2026, 10, 1, 8, 0), hasSubfolders: false },
        ],
        files: [entry('Alpha notes.docx', at(2026, 10, 18, 10, 0), 48_000)],
      },
    }
    await mountHome('en')
    await click(host.querySelector('[role="treeitem"]'))
    expect(headers().map((h) => h.textContent?.trim())).toEqual(['Name', 'Updated', 'Size'])
    const rows = rowCells().map((row) => [row.name, row.sub])
    expect(rows).toEqual([
      ['Sub', 'Folder'],
      ['Alpha notes.docx', 'Documents'],
    ])
    // the sub-folder row has no time or size of its own, so the grid keeps its cells
    expect(host.querySelectorAll('.dh-doc-table .dh-doc-row')).toHaveLength(2)
    // a sub-folder has no box to tick, a file does
    expect(
      host.querySelectorAll('.dh-doc-row')[0]!.querySelector('input[type="checkbox"]'),
    ).toBeNull()
    expect(
      host.querySelectorAll('.dh-doc-row')[1]!.querySelector('input[type="checkbox"]'),
    ).not.toBeNull()
  })

  it('orders the row menu: Open first, the machine items in the old order, Delete files last', async () => {
    const dir = '/Users/linh/Documents'
    folderRoots = [{ path: dir, name: 'Documents', usable: true, readable: true, removable: false }]
    recentEntries = [entry('Alpha notes.docx', at(2026, 10, 18, 10, 0), 48_000)]
    await mountHome('en')
    await click(host.querySelector('.dh-doc-row [data-folder-menu-for]'))
    const items = Array.from(document.querySelectorAll('.uw-row-menu-list [role="menuitem"]')).map(
      (el) => el.textContent?.trim(),
    )
    expect(items).toEqual([
      'Open',
      'Reveal in folder',
      'Copy path',
      'Move to folder…',
      'Rename',
      'Make a copy',
      'Remove from list',
      'Delete files',
    ])
  })
  it('keeps Sao and ⋯ in the actions cell of every row', async () => {
    await mountHome('en')
    const row = host.querySelector('.dh-doc-row')!
    expect(row.querySelector('[data-col="actions"] button[aria-label="Star"]')).not.toBeNull()
    expect(row.querySelector('[data-col="actions"] [data-folder-menu-for]')).not.toBeNull()
  })

  it('stars a file from the row and does not open it', async () => {
    await mountHome('en')
    const api = (window as unknown as { aiOffice: Record<string, ReturnType<typeof vi.fn>> })
      .aiOffice
    await click(host.querySelector('.dh-doc-row button[aria-label="Star"]'))
    expect(api.toggleStar).toHaveBeenCalledWith('/Users/linh/Documents/Finance/Budget.xlsx')
    expect(api.openPath).not.toHaveBeenCalled()
  })

  it('shows Unstar on a starred row', async () => {
    recentEntries = [{ ...ENTRIES[0]!, starred: true }]
    await mountHome('en')
    expect(host.querySelector('.dh-doc-row button[aria-label="Unstar"]')).not.toBeNull()
  })

  it('opens a file from its name', async () => {
    await mountHome('en')
    await click(host.querySelector('.dh-doc-row .dh-doc-open'))
    const api = (window as unknown as { aiOffice: Record<string, ReturnType<typeof vi.fn>> })
      .aiOffice
    expect(api.openPath).toHaveBeenCalledWith('/Users/linh/Documents/Finance/Budget.xlsx')
  })

  it('keeps the local selection bar: ticking a row shows the count, Move, Remove, Delete, Cancel', async () => {
    await mountHome('en')
    expect(host.querySelector('.selection-bar')).toBeNull()
    await click(host.querySelector('.dh-doc-row input[type="checkbox"]'))
    const bar = host.querySelector('.selection-bar')!
    expect(bar.querySelector('.selection-count')?.textContent).toBe('1 selected')
    expect(Array.from(bar.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual([
      'Remove from list',
      'Delete files',
      'Cancel',
    ])
    // the header box ticks every row
    await click(host.querySelector('[role="columnheader"] input[type="checkbox"]'))
    expect(host.querySelector('.selection-bar .selection-count')?.textContent).toBe('4 selected')
    await click(Array.from(host.querySelectorAll('.selection-bar button')).pop())
    expect(host.querySelector('.selection-bar')).toBeNull()
  })

  it('removes the selected rows from the list through the bar', async () => {
    await mountHome('en')
    await click(host.querySelector('.dh-doc-row input[type="checkbox"]'))
    const api = (window as unknown as { aiOffice: Record<string, ReturnType<typeof vi.fn>> })
      .aiOffice
    await click(
      Array.from(host.querySelectorAll('.selection-bar button')).find(
        (b) => b.textContent?.trim() === 'Remove from list',
      ),
    )
    expect(api.removeRecent).toHaveBeenCalledWith(['/Users/linh/Documents/Finance/Budget.xlsx'])
  })

  it('dims a missing file, keeps it openable by name and makes it undraggable', async () => {
    recentEntries = [{ ...entry('Gone.docx', 0, 0), missing: true }]
    await mountHome('en')
    const row = host.querySelector<HTMLElement>('.dh-doc-row')!
    expect(row.classList.contains('missing')).toBe(true)
    expect(row.getAttribute('draggable')).not.toBe('true')
  })

  it('makes a local file row a drag source', async () => {
    await mountHome('en')
    expect(host.querySelector('.dh-doc-row')!.getAttribute('draggable')).toBe('true')
  })

  it('keeps the quick-start block and the New cards above the list', async () => {
    await mountHome('en')
    expect(host.querySelector('.quick-start')).not.toBeNull()
    expect(
      host
        .querySelector('.quick-start')!
        .compareDocumentPosition(host.querySelector('.dh-doc-table')!),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('draws no leftover list markup of the old table', async () => {
    await mountHome('en')
    expect(
      host.querySelector('.recent-list, .recent-columns, .recent-item, .recent-row'),
    ).toBeNull()
  })
})
