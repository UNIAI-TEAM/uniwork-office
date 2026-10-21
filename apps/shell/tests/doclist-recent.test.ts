/**
 * @vitest-environment jsdom
 *
 * UNI-2047 A-REC: the Recent screen on the recent-canvas layout (title + subtitle + search, the
 * "Mở tiếp" cards, the segment in the filter row, group counts, the row's folder line, the empty
 * message) with the table details of doclist-canvas.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { writeRecentSegment } from '../src/renderer/src/doclist/persist'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type {
  DocumentsHomeDoc,
  DocumentsHomeSubViewId,
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
const touched = (
  id: string,
  kind: 'opened' | 'edited' | 'commented',
  at: string,
  extra: Partial<DocumentsHomeDoc> = {},
): DocumentsHomeDoc => doc({ id, title: `${id}.docx`, lastActivity: { kind, at }, ...extra })

// newest first; the 5th is the oldest: the strip keeps four
const RECENT = [
  touched('r-today', 'edited', iso(2026, 10, 21, 8, 0)),
  touched('r-today2', 'opened', iso(2026, 10, 21, 7, 0)),
  touched('r-yest', 'opened', iso(2026, 10, 20, 16, 30)),
  touched('r-week', 'commented', iso(2026, 10, 19, 9, 0)),
  touched('r-old', 'opened', iso(2026, 10, 10, 9, 0)),
]

describe('DocumentsHome: the Recent screen on the recent-canvas layout (UNI-2047 A-REC)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let recentItems: DocumentsHomeDoc[]
  let treeNodes: unknown[]
  let onOpenDocument: ReturnType<typeof vi.fn>
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
    treeNodes = []
    onOpenDocument = vi.fn()
    const empty = () => ok({ documents: [], nextCursor: null })
    api = {
      uniworkFolderTree: vi.fn(async () => ok(treeNodes)),
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

  async function mount(subView: DocumentsHomeSubViewId = 'recent', lang: 'vi' | 'en' = 'vi') {
    if (lang === 'en') {
      localStorage.setItem('genoffice.lang', 'en')
      document.documentElement.lang = 'en'
    }
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument,
            sidebarHost: sidebarSlot,
            initialSubView: subView,
          }),
        ),
      )
    })
    await flush()
  }
  const click = async (el: Element | null | undefined) => {
    expect(el).toBeTruthy()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
    await flush()
  }
  const pick = async (name: string, value: string) => {
    const el = host.querySelector<HTMLSelectElement>(`select[data-filter="${name}"]`)!
    await act(async () => {
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
  }
  const cards = () => Array.from(host.querySelectorAll<HTMLElement>('.dh-continue-card'))
  const strip = () => host.querySelector<HTMLElement>('.dh-continue')

  describe('the header', () => {
    it('stacks the title over the subtitle and names the search after the screen', async () => {
      await mount('recent')
      const title = host.querySelector('.dh-title-group .dh-title')
      expect(title?.textContent).toBe('Gần đây')
      expect(host.querySelector('.dh-title-group .dh-subtitle')?.textContent).toBe(
        'Tài liệu bạn đã mở hoặc sửa trong 30 ngày qua',
      )
      const search = host.querySelector<HTMLInputElement>('.dh-search-input')!
      expect(search.getAttribute('aria-label')).toBe('Tìm trong Gần đây')
      expect(search.getAttribute('placeholder')).toBe('Tìm trong Gần đây')
    })

    it('reads in English', async () => {
      await mount('recent', 'en')
      expect(host.querySelector('.dh-subtitle')?.textContent).toBe(
        'Documents you opened or edited in the last 30 days',
      )
      expect(host.querySelector('.dh-search-input')?.getAttribute('aria-label')).toBe(
        'Search in Recent',
      )
    })

    it("keeps the app's own Tải lên / Tạo mới buttons and the quick-create row (the board draws none, UNI-1957 item 4 still holds)", async () => {
      await mount('recent')
      expect(host.querySelector('.dh-btn-upload')).not.toBeNull()
      expect(host.querySelector('.dh-toolbar-actions')).not.toBeNull()
      expect(host.querySelector('.dh-quick-row')).not.toBeNull()
      // the subtitle is Recent's alone
      await act(async () => {
        root.unmount()
      })
      root = createRoot(host)
      await mount('workspace')
      expect(host.querySelector('.dh-subtitle')).toBeNull()
    })

    it('draws no "Tài liệu · N" section head over the table on Recent (the group headers count)', async () => {
      await mount('recent')
      expect(host.querySelector('.dh-docs-section .dh-section-head')).toBeNull()
      expect(host.querySelectorAll('[role="row"][data-doc-id]').length).toBe(5)
    })
  })

  describe('Mở tiếp', () => {
    it('lists the four newest touches as cards under an h2, newest first, with the activity and time', async () => {
      await mount('recent')
      const heading = strip()?.querySelector('h2')
      expect(heading?.textContent).toBe('Mở tiếp')
      expect(strip()?.getAttribute('aria-labelledby')).toBe(heading?.id)
      expect(cards().map((c) => c.querySelector('.dh-continue-name')?.textContent)).toEqual([
        'r-today.docx',
        'r-today2.docx',
        'r-yest.docx',
        'r-week.docx',
      ])
      expect(cards()[0]!.querySelector('.dh-continue-when')?.textContent).toBe('Bạn đã sửa · 08:00')
      expect(cards()[2]!.querySelector('.dh-continue-when')?.textContent).toBe(
        'Bạn đã mở · Hôm qua, 16:30',
      )
      expect(cards()[3]!.querySelector('.dh-continue-when')?.textContent).toBe(
        'Bạn đã bình luận · 19/10',
      )
    })

    it('orders by last touch whatever the table sorts by, and skips folders and trashed rows', async () => {
      recentItems = [
        touched('a-old', 'opened', iso(2026, 10, 1, 9, 0), { updatedAt: iso(2026, 10, 21, 11, 0) }),
        touched('folder', 'opened', iso(2026, 10, 21, 11, 30), { kind: 'folder' }),
        touched('gone', 'edited', iso(2026, 10, 21, 11, 40), { archived: true }),
        touched('z-new', 'edited', iso(2026, 10, 21, 10, 0)),
      ]
      await mount('recent')
      await click(host.querySelector('[data-col="updated"] .dh-sort-head'))
      expect(cards().map((c) => c.querySelector('.dh-continue-name')?.textContent)).toEqual([
        'z-new.docx',
        'a-old.docx',
      ])
    })

    it('opens the document from a card (a real button, keyboard reachable)', async () => {
      await mount('recent')
      const first = cards()[0]!
      expect(first.tagName).toBe('BUTTON')
      expect(first.getAttribute('type')).toBe('button')
      await click(first)
      expect(onOpenDocument).toHaveBeenCalledTimes(1)
      expect(onOpenDocument.mock.calls[0]?.[0]).toMatchObject({ id: 'r-today' })
    })

    it('keeps the type preview decoration out of the accessible name', async () => {
      await mount('recent')
      const preview = cards()[0]!.querySelector('.dh-continue-preview')
      expect(preview?.getAttribute('aria-hidden')).toBe('true')
      expect(preview?.getAttribute('data-type')).toBe('docx')
    })

    it('is not there while a filter, a segment pick or a search narrows the list', async () => {
      await mount('recent')
      expect(strip()).not.toBeNull()
      await click(host.querySelector('[data-chip="docx"]'))
      expect(strip()).toBeNull()
      await click(host.querySelector('[data-chip="all"]'))
      expect(strip()).not.toBeNull()
      await pick('updatedFrom', '7d')
      expect(strip()).toBeNull()
      await pick('updatedFrom', 'any')
      await click(host.querySelector('[data-seg="edited"]'))
      expect(strip()).toBeNull()
    })

    it('is not there without last_activity from the server, or with nothing to list', async () => {
      recentItems = RECENT.map((d) => ({ ...d, lastActivity: undefined }))
      await mount('recent')
      expect(strip()).toBeNull()
      await act(async () => {
        root.unmount()
      })
      root = createRoot(host)
      recentItems = []
      await mount('recent')
      expect(strip()).toBeNull()
    })

    it('is a Recent block only', async () => {
      await mount('shared-with-me')
      expect(strip()).toBeNull()
    })
  })

  describe('the filter row', () => {
    it('puts the segment first in the same row as the type chips and the Người sửa / Cập nhật selects', async () => {
      await mount('recent')
      const bar = host.querySelector<HTMLElement>('.dh-filter-bar')!
      expect(bar.classList.contains('has-lead')).toBe(true)
      const kids = Array.from(bar.children).map((el) => el.className.split(' ')[0])
      expect(kids.slice(0, 4)).toEqual([
        'dh-segment',
        'dh-filter-chips',
        'dh-filter-chip',
        'dh-filter-chip',
      ])
      // no second row of its own for the segment
      expect(host.querySelectorAll('.dh-segment').length).toBe(1)
      expect(bar.contains(host.querySelector('.dh-segment'))).toBe(true)
    })

    it('other screens have no lead and no segment', async () => {
      await mount('shared-with-me')
      expect(host.querySelector('.dh-filter-bar')?.classList.contains('has-lead')).toBe(false)
      expect(host.querySelector('.dh-segment')).toBeNull()
    })
  })

  describe('the groups', () => {
    it('count their documents in the header: "· 2 tài liệu", "· 1 tài liệu"', async () => {
      await mount('recent')
      const header = (group: string) =>
        host.querySelector<HTMLElement>(`.dh-group-row[data-group="${group}"] button`)?.textContent
      expect(header('today')).toBe('Hôm nay· 2 tài liệu')
      expect(header('yesterday')).toBe('Hôm qua· 1 tài liệu')
      expect(header('this_week')).toBe('Tuần này· 1 tài liệu')
      expect(header('earlier')).toBe('Trước đó· 1 tài liệu')
    })

    it('count in English with the plural', async () => {
      await mount('recent', 'en')
      const header = (group: string) =>
        host.querySelector<HTMLElement>(`.dh-group-row[data-group="${group}"] button`)?.textContent
      expect(header('today')).toBe('Today· 2 documents')
      expect(header('yesterday')).toBe('Yesterday· 1 document')
    })
  })

  describe('the row', () => {
    it('shows the folder the document lives in under its name, from the folder tree', async () => {
      treeNodes = [
        {
          id: 'f-a',
          parentId: null,
          title: 'Hợp đồng',
          position: 0,
          kind: 'folder',
          isSystem: false,
          children: [],
        },
      ]
      recentItems = [
        touched('in-folder', 'edited', iso(2026, 10, 21, 8, 0), { parentId: 'f-a' }),
        touched('at-root', 'opened', iso(2026, 10, 21, 7, 0), { parentId: null }),
        touched('lost', 'opened', iso(2026, 10, 21, 6, 0), { parentId: 'f-unknown' }),
      ]
      await mount('recent')
      const where = (id: string) =>
        host.querySelector(`[data-doc-id="${id}"] .dh-doc-subpath`)?.textContent ?? null
      expect(where('in-folder')).toBe('Hợp đồng')
      expect(where('at-root')).toBe('Tài liệu (gốc)')
      // a folder the tree does not know is not guessed
      expect(where('lost')).toBeNull()
    })
  })

  describe('the empty message', () => {
    it('says no document matches when a segment pick is empty (the board: "khớp bộ lọc")', async () => {
      writeRecentSegment('edited')
      recentItems = []
      await mount('recent')
      expect(host.querySelector('.dh-empty')?.textContent).toBe(
        'Không có tài liệu nào khớp bộ lọc.',
      )
    })

    it('keeps the plain message when nothing narrows the list', async () => {
      recentItems = []
      await mount('recent')
      expect(host.querySelector('.dh-empty')?.textContent).toBe('Chưa có tài liệu gần đây.')
    })
  })
})

describe('documents-home.css: the Recent layout (UNI-2047 A-REC)', () => {
  const css = readFileSync(
    resolve(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
    'utf8',
  )
  it('styles the subtitle, the Mở tiếp cards and the filter row lead', () => {
    expect(css).toMatch(/\.dh-subtitle\b/)
    expect(css).toMatch(/\.dh-continue-grid\b/)
    expect(css).toMatch(/\.dh-continue-card\b/)
    expect(css).toMatch(/\.dh-continue-preview\b/)
    expect(css).toMatch(/\.dh-filter-bar\.has-lead\b/)
  })
  it('lays the cards out four across and two below 960px, like the folder grid', () => {
    expect(css).toMatch(/\.dh-continue-grid\s*\{[^}]*repeat\(4,/)
    expect(css).toMatch(/@media \(max-width: 960px\)\s*\{[^@]*\.dh-continue-grid/)
  })
  it('tints a card preview by file type through theme tokens, no raw colour', () => {
    expect(css).toMatch(/\.dh-continue-preview\[data-type='docx'\]/)
    expect(css).toMatch(/\.dh-continue-preview\[data-type='xlsx'\]/)
    const block = css.slice(
      css.indexOf('.dh-continue-grid'),
      css.indexOf('.dh-continue-grid') + 4000,
    )
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![^{]*\{)/)
  })
})
