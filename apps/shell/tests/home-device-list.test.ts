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
        const width = this.classList.contains('recent-table') ? tableWidth : 0
        return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0 } as DOMRect
      })
    }
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: lang }, createElement(Home)))
    })
    await flush()
  }

  const rowCells = () =>
    Array.from(host.querySelectorAll<HTMLElement>('.recent-list .recent-row')).map((row) => ({
      name: row.querySelector('.recent-name')?.textContent,
      sub: row.querySelector('.recent-name-cell .recent-path')?.textContent,
      time: row.querySelector('.recent-time')?.textContent,
      size: row.querySelector('.recent-size')?.textContent,
    }))
  // the header strip is plain buttons (no table roles): the sort state is in each button's label
  const headers = () =>
    Array.from(host.querySelectorAll<HTMLElement>('.recent-columns button.cloud-col-sort-btn'))
  const header = (label: string) => headers().find((h) => h.textContent?.trim() === label)
  const sortStateOf = (button: Element) => {
    // the old strip put aria-sort on a columnheader around the button: count it so the default state is pinned
    const legacy = button.closest('[aria-sort]')?.getAttribute('aria-sort')
    if (legacy && legacy !== 'none') return legacy
    const label = button.getAttribute('aria-label') ?? ''
    return /sorted ascending$/.test(label)
      ? 'ascending'
      : /sorted descending$/.test(label)
        ? 'descending'
        : 'none'
  }
  const rowNames = () =>
    Array.from(host.querySelectorAll('.recent-list .recent-name')).map((el) => el.textContent)
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
    expect(host.querySelector('.recent-columns .col-path')).toBeNull()
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
    expect(header('Name')!.getAttribute('aria-label')).toBe('Name, sorted ascending')
    expect(rowNames()).toEqual([
      'Alpha notes.docx',
      'Budget.xlsx',
      'Old deck.pptx',
      'Zeta plan.docx',
    ])
    await click(header('Name')!)
    expect(sortOf()).toEqual(['descending', 'none', 'none'])
    expect(header('Name')!.getAttribute('aria-label')).toBe('Name, sorted descending')
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

  it('has no table roles on the header strip (the sort state lives on the buttons)', async () => {
    await mountHome('en')
    expect(host.querySelector('.recent-columns[role]')).toBeNull()
    expect(host.querySelector('[role="columnheader"], [role="row"], [aria-sort]')).toBeNull()
  })

  it('says the sort state in the active language', async () => {
    await mountHome('vi')
    await click(header('Tên')!)
    expect(header('Tên')!.getAttribute('aria-label')).toBe('Tên, đang sắp xếp tăng dần')
    await click(header('Tên')!)
    expect(header('Tên')!.getAttribute('aria-label')).toBe('Tên, đang sắp xếp giảm dần')
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
    expect(host.querySelector('.recent-size')).toBeNull()
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
    expect(host.querySelectorAll('.recent-size')).toHaveLength(ENTRIES.length)
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
    expect(Array.from(host.querySelectorAll('.search-time')).map((el) => el.textContent)).toEqual([
      '09:05',
      'Yesterday, 16:30',
      'Mar 2, 2025',
    ])
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
    const rows = Array.from(host.querySelectorAll<HTMLElement>('.recent-list .recent-row')).map(
      (row) => [
        row.querySelector('.recent-name')?.textContent,
        row.querySelector('.recent-name-cell .recent-path')?.textContent,
      ],
    )
    expect(rows).toEqual([
      ['Sub', 'Folder'],
      ['Alpha notes.docx', 'Documents'],
    ])
    // the sub-folder row has no time or size of its own, so the grid keeps its cells
    expect(host.querySelectorAll('.recent-list .recent-row')).toHaveLength(2)
  })

  it('orders the row menu: Open first, the machine items in the old order, Delete files last', async () => {
    const dir = '/Users/linh/Documents'
    folderRoots = [{ path: dir, name: 'Documents', usable: true, readable: true, removable: false }]
    recentEntries = [entry('Alpha notes.docx', at(2026, 10, 18, 10, 0), 48_000)]
    await mountHome('en')
    await click(host.querySelector('.recent-list .more-btn'))
    const items = Array.from(host.querySelectorAll('.row-menu [role="menuitem"]')).map((el) =>
      el.textContent?.trim(),
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
})
