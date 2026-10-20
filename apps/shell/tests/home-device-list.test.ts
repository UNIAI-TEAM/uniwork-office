/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStatus, HomeApi, RecentEntry } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { Home } from '../src/renderer/src/Home'
import { readSort } from '../src/renderer/src/doclist/persist'
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

// server order (last opened first); deliberately not sorted by name, date or size
const ENTRIES: RecentEntry[] = [
  entry('Budget.xlsx', at(2026, 10, 21, 9, 5), 5_033_165, '/Users/linh/Documents/Finance'),
  entry('Zeta plan.docx', at(2026, 10, 20, 16, 30), 2_969),
  entry('Alpha notes.docx', at(2026, 10, 18, 10, 0), 48_000),
  entry('Old deck.pptx', at(2025, 3, 2, 8, 0), 12_582_912),
]

describe('Home local file list shares the list formats, sort and columns (UNI-2047 A6)', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
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
      folderRoots: vi.fn(async () => []),
      listFolder: vi.fn(async () => ({ folders: [], files: [] })),
      onFolderChanged: vi.fn(() => () => {}),
      recents: vi.fn(async () => ({ entries: ENTRIES, total: ENTRIES.length })),
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
  const headers = () => Array.from(host.querySelectorAll<HTMLElement>('[role="columnheader"]'))
  const header = (label: string) => headers().find((h) => h.textContent?.trim() === label)
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
      ['Yesterday, 16:30', '2.9 KB'],
      ['Oct 18', '47 KB'],
      ['Mar 2, 2025', '12 MB'],
    ])
  })

  it('writes dates and sizes with the Vietnamese marks in Vietnamese', async () => {
    await mountHome('vi')
    expect(rowCells().map((r) => [r.time, r.size])).toEqual([
      ['09:05', '4,8 MB'],
      ['Hôm qua, 16:30', '2,9 KB'],
      ['18/10', '47 KB'],
      ['02/03/2025', '12 MB'],
    ])
  })

  it('folds the location into the second line of the name and drops the Location column', async () => {
    await mountHome('en')
    expect(rowCells().map((r) => r.sub)).toEqual(['Finance', 'Documents', 'Documents', 'Documents'])
    expect(host.querySelector('.recent-columns .col-path')).toBeNull()
    expect(headers().map((h) => h.textContent?.trim())).toEqual(['Name', 'Updated', 'Size'])
  })

  it('sorts by a clicked header, flips on a second click and tells aria-sort', async () => {
    await mountHome('en')
    const sortOf = () => headers().map((h) => h.getAttribute('aria-sort'))
    // Cập nhật newest first is the default
    expect(sortOf()).toEqual(['none', 'descending', 'none'])
    expect(rowNames()).toEqual([
      'Budget.xlsx',
      'Zeta plan.docx',
      'Alpha notes.docx',
      'Old deck.pptx',
    ])

    await click(header('Name')!.querySelector('button'))
    expect(sortOf()).toEqual(['ascending', 'none', 'none'])
    expect(rowNames()).toEqual([
      'Alpha notes.docx',
      'Budget.xlsx',
      'Old deck.pptx',
      'Zeta plan.docx',
    ])
    await click(header('Name')!.querySelector('button'))
    expect(sortOf()).toEqual(['descending', 'none', 'none'])
    expect(rowNames()).toEqual([
      'Zeta plan.docx',
      'Old deck.pptx',
      'Budget.xlsx',
      'Alpha notes.docx',
    ])

    await click(header('Size')!.querySelector('button'))
    expect(sortOf()).toEqual(['none', 'none', 'descending'])
    expect(rowNames()).toEqual([
      'Old deck.pptx',
      'Budget.xlsx',
      'Alpha notes.docx',
      'Zeta plan.docx',
    ])

    await click(header('Updated')!.querySelector('button'))
    expect(sortOf()).toEqual(['none', 'descending', 'none'])
    await click(header('Updated')!.querySelector('button'))
    expect(sortOf()).toEqual(['none', 'ascending', 'none'])
    expect(rowNames()).toEqual([
      'Old deck.pptx',
      'Alpha notes.docx',
      'Zeta plan.docx',
      'Budget.xlsx',
    ])
  })

  it('remembers the sort of the device list and restores it on the next mount', async () => {
    await mountHome('en')
    await click(header('Name')!.querySelector('button'))
    expect(readSort('device')).toEqual({ column: 'name', dir: 'asc' })

    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    await mountHome('en')
    expect(header('Name')!.getAttribute('aria-sort')).toBe('ascending')
    expect(rowNames()[0]).toBe('Alpha notes.docx')
  })

  it('hides Dung lượng by the width of the table, not of the window', async () => {
    await mountHome('en', 500)
    expect(headers().map((h) => h.textContent?.trim())).toEqual(['Name', 'Updated'])
    expect(host.querySelector('.recent-size')).toBeNull()
    expect(rowCells().every((r) => r.time)).toBe(true)
  })

  it('keeps Dung lượng on a wide table', async () => {
    await mountHome('en', 1000)
    expect(headers().map((h) => h.textContent?.trim())).toEqual(['Name', 'Updated', 'Size'])
    expect(host.querySelectorAll('.recent-size')).toHaveLength(ENTRIES.length)
  })
})
