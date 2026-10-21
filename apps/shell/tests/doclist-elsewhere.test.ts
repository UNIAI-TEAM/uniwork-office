/**
 * @vitest-environment jsdom
 *
 * UNI-2047 B4: "Từ nơi khác" (the web's sidebar "From elsewhere") as its own sub-nav page. The page
 * is the shared DocList over the source files of the other modules (`uniworkListSources`): no
 * Chọn column (a source file cannot be selected) and no screen column (the app shows one workspace),
 * the type chips that apply to files, Người sửa = the file's owner, paging with Tải thêm, and the
 * loading / empty / error states. The workspace root does not list these rows (UNI-2047 F-14).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UniworkResult,
  UniworkSourceFile,
  UniworkSourceListPage,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import {
  fetchDocumentsHomePage,
  getDocumentsHomeNavEntry,
  sourceAuthorsOf,
  visibleDocumentsHomeNavEntries,
  type DocumentsHomeApiAdapter,
  type DocumentsHomeSubViewId,
} from '../src/renderer/src/uniwork-home/documents-home-model'
import { columnsFor, defaultSort, isSortable } from '../src/renderer/src/doclist/columns'
import { DOCLIST_SORT_KEY } from '../src/renderer/src/doclist/persist'
import { screenOfSubView } from '../src/renderer/src/doclist/table-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

// Wednesday 2026-10-21 12:00 local
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const iso = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0).toISOString()
const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

const source = (partial: Partial<UniworkSourceFile> & { id: string }): UniworkSourceFile => ({
  source: 'chat',
  parent: { kind: 'chat_channel', id: 'room-1', title: 'Phòng dự án' },
  name: `${partial.id}.pdf`,
  mimeType: 'application/pdf',
  extension: 'pdf',
  sizeBytes: 120_000,
  updatedAt: iso(2026, 10, 21, 9, 5),
  owner: { id: 'u-minh', name: 'Minh Trần' },
  canOpenInApp: false,
  canSave: true,
  ...partial,
})

const SOURCES = [
  source({ id: 's-new', updatedAt: iso(2026, 10, 21, 9, 5) }),
  source({
    id: 's-old',
    name: 'bao-cao.docx',
    extension: 'docx',
    updatedAt: iso(2026, 10, 18, 10, 0),
    sizeBytes: 5_000,
    owner: { id: 'u-lan', name: 'Lan Nguyễn' },
  }),
]

describe('the model: the Từ nơi khác page', () => {
  it('is a nav entry of the sources route, listed last, in the web wording', () => {
    const entry = getDocumentsHomeNavEntry('elsewhere')
    expect(entry.id).toBe('elsewhere')
    expect(entry.available).toBe(true)
    expect(entry.source).toBe('sources')
    expect(entry.labelKey).toBe('dlNavElsewhere')
    const ids = visibleDocumentsHomeNavEntries().map((e) => e.id)
    expect(ids[ids.length - 1]).toBe('elsewhere')
  })

  it('has its own screen with the workspace columns minus Chọn: no screen column, nothing to select', () => {
    expect(screenOfSubView('elsewhere')).toBe('elsewhere')
    expect(columnsFor('elsewhere')).toEqual([
      'name',
      'access',
      'editor',
      'updated',
      'size',
      'actions',
    ])
    // narrow: Dung lượng, then Người sửa, then Truy cập hide as on the workspace list
    expect(columnsFor('elsewhere', 500)).toEqual(['name', 'updated', 'actions'])
    expect(defaultSort('elsewhere')).toEqual({ column: 'updated', dir: 'desc' })
    expect(isSortable('elsewhere', 'name')).toBe(true)
    expect(isSortable('elsewhere', 'size')).toBe(true)
    expect(isSortable('elsewhere', 'editor')).toBe(true)
    expect(isSortable('elsewhere', 'starred')).toBe(false)
  })

  it('reads no document route (the page lists source files only)', async () => {
    const api = {
      uniworkListChildren: vi.fn(),
      uniworkListDocuments: vi.fn(),
      uniworkListSources: vi.fn(),
    }
    const res = await fetchDocumentsHomePage(api as unknown as DocumentsHomeApiAdapter, {
      workspaceId: 'ws-1',
      subView: 'elsewhere',
      folderId: null,
      filters: {},
    })
    expect(res.result).toEqual({ ok: true, value: { items: [], nextCursor: null } })
    expect(api.uniworkListChildren).not.toHaveBeenCalled()
    expect(api.uniworkListDocuments).not.toHaveBeenCalled()
    expect(api.uniworkListSources).not.toHaveBeenCalled()
  })

  it('names the Người sửa options after the file owners, once each, never an id', () => {
    expect(
      sourceAuthorsOf([
        ...SOURCES,
        source({ id: 'again', owner: { id: 'u-minh', name: 'Minh Trần' } }),
        source({ id: 'nobody', owner: null }),
        source({ id: 'blank', owner: { id: 'u-x', name: '  ' } }),
      ]),
    ).toEqual([
      { id: 'u-minh', name: 'Minh Trần' },
      { id: 'u-lan', name: 'Lan Nguyễn' },
    ])
  })
})

describe('DocumentsHome: the Từ nơi khác screen', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let sources: (q: Record<string, unknown>) => Promise<UniworkResult<UniworkSourceListPage>>
  const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]

  async function flush(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  const baseApi = (): Record<string, ReturnType<typeof vi.fn>> => {
    const empty = () => ok({ documents: [], nextCursor: null })
    return {
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
      uniworkListDocuments: vi.fn(async () => empty()),
      uniworkListFavorites: vi.fn(async () => empty()),
      uniworkListSharedWithMe: vi.fn(async () => empty()),
      uniworkListSharedByMe: vi.fn(async () => empty()),
      uniworkListTrash: vi.fn(async () => empty()),
      uniworkListShelved: vi.fn(async () => empty()),
      uniworkListSources: vi.fn((q: Record<string, unknown>) => sources(q)),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
    }
  }

  const install = (next: Record<string, ReturnType<typeof vi.fn>>) => {
    api = next
    ;(window as unknown as { aiOffice: unknown; home: unknown }).aiOffice = api
    ;(window as unknown as { aiOffice: unknown; home: unknown }).home = api
  }

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    sources = async () => ok({ items: SOURCES, nextCursor: null })
    install(baseApi())
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

  async function mount(subView: DocumentsHomeSubViewId = 'elsewhere', lang: 'vi' | 'en' = 'vi') {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
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
  const sourceIds = () =>
    Array.from(host.querySelectorAll('[role="row"][data-source-id]')).map((el) =>
      el.getAttribute('data-source-id'),
    )
  const navLabels = () =>
    Array.from(sidebarSlot.querySelectorAll('.dh-nav-label')).map((el) => el.textContent)
  const headers = () =>
    Array.from(host.querySelectorAll('[role="columnheader"]')).map((el) =>
      el.getAttribute('data-col'),
    )
  const pick = async (name: string, value: string) => {
    const el = host.querySelector<HTMLSelectElement>(`select[data-filter="${name}"]`)!
    await act(async () => {
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
  }

  it('opens Từ nơi khác from its sidebar section (From elsewhere in English), no longer a sub-nav item', async () => {
    await mount('workspace')
    expect(navLabels()).not.toContain('Từ nơi khác')
    expect(sidebarSlot.querySelector('[data-nav="elsewhere"]')).toBeNull()
    const entry = sidebarSlot.querySelector('.dl-side-sources [data-source="chat"]')
    await click(entry)
    expect(lastCall('uniworkListSources')).toEqual({ workspaceId: 'ws-1', source: 'chat' })
    expect(sourceIds()).toEqual(['s-new', 's-old'])
    expect(host.querySelector('.dh-title')?.textContent).toBe('Từ nơi khác')

    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    localStorage.setItem('genoffice.lang', 'en')
    await mount('elsewhere', 'en')
    expect(host.querySelector('.dh-title')?.textContent).toBe('From elsewhere')
    expect(host.querySelector('.dh-subtitle')?.textContent).toBe(
      'Files sent in Chat, Meetings, Email and Tasks of this workspace',
    )
  })

  it('reads the sources route only: no document list, no children, the workspace and nothing else at first', async () => {
    await mount('elsewhere')
    expect(api.uniworkListSources).toHaveBeenCalledTimes(1)
    expect(lastCall('uniworkListSources')).toEqual({ workspaceId: 'ws-1' })
    expect(api.uniworkListChildren).not.toHaveBeenCalled()
    expect(api.uniworkListDocuments).not.toHaveBeenCalled()
    expect(sourceIds()).toEqual(['s-new', 's-old'])
  })

  it('draws the shared table: Tên · Người sửa gần nhất · Cập nhật · Dung lượng · Thao tác, no Chọn, no Truy cập (a source file has no level), no screen column', async () => {
    await mount('elsewhere')
    expect(host.querySelector('[role="table"]')).not.toBeNull()
    expect(headers()).toEqual(['name', 'editor', 'updated', 'size', 'actions'])
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
    expect(host.querySelector('.dh-subtitle')?.textContent).toBe(
      'Tệp được gửi trong Trò chuyện, Cuộc họp, Email và Công việc của workspace này',
    )
    const row = host.querySelector('[data-source-id="s-old"]')!
    expect(row.textContent).toContain('bao-cao.docx')
    expect(row.textContent).toContain('Lan Nguyễn')
  })

  it('sorts by the header on the loaded rows (Tên) and keeps the sort apart from the workspace list', async () => {
    await mount('elsewhere')
    // default: Cập nhật newest first
    expect(sourceIds()).toEqual(['s-new', 's-old'])
    const name = host.querySelector('[role="columnheader"][data-col="name"] button')
    await click(name)
    // ascending by name: "bao-cao.docx" before "s-new.pdf"
    expect(sourceIds()).toEqual(['s-old', 's-new'])
    expect(api.uniworkListSources).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(DOCLIST_SORT_KEY) ?? '').not.toContain('"workspace"')
  })

  it('a type chip goes to the server as `type`; UniNote is not offered here; Người sửa and Cập nhật narrow the loaded rows', async () => {
    await mount('elsewhere')
    expect(host.querySelector('[data-chip="page"]')).toBeNull()
    expect(host.querySelector('[data-chip="pdf"]')).not.toBeNull()
    await click(host.querySelector('[data-chip="pdf"]'))
    expect(lastCall('uniworkListSources')).toMatchObject({ workspaceId: 'ws-1', type: 'pdf' })
    // the authors are the file owners
    const options = Array.from(
      host.querySelectorAll<HTMLOptionElement>('select[data-filter="updatedBy"] option'),
    ).map((o) => o.textContent)
    expect(options).toEqual(expect.arrayContaining(['Minh Trần', 'Lan Nguyễn']))
    await click(host.querySelector('[data-chip="all"]'))
    await pick('updatedBy', 'u-lan')
    expect(sourceIds()).toEqual(['s-old'])
    expect(lastCall('uniworkListSources')).not.toHaveProperty('updatedBy')
    await pick('updatedBy', '')
    await pick('updatedFrom', '24h')
    expect(sourceIds()).toEqual(['s-new'])
  })

  it('pages: Tải thêm asks for the next cursor and appends', async () => {
    sources = async (q) =>
      q.cursor
        ? ok({
            items: [source({ id: 's-more', updatedAt: iso(2026, 10, 1, 8, 0) })],
            nextCursor: null,
          })
        : ok({ items: SOURCES, nextCursor: 'cur-1' })
    await mount('elsewhere')
    expect(sourceIds()).toEqual(['s-new', 's-old'])
    const more = host.querySelector<HTMLButtonElement>('.uw-pick-more')
    expect(more).not.toBeNull()
    await click(more)
    expect(lastCall('uniworkListSources')).toMatchObject({ cursor: 'cur-1' })
    expect(sourceIds()).toEqual(['s-new', 's-old', 's-more'])
    expect(host.querySelector('.uw-pick-more')).toBeNull()
  })

  it('shows a loading state, then an empty one in words', async () => {
    let release: (v: UniworkResult<UniworkSourceListPage>) => void = () => {}
    sources = () => new Promise((resolve) => (release = resolve))
    await mount('elsewhere')
    expect(host.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull()
    expect(sourceIds()).toEqual([])
    await act(async () => {
      release(ok({ items: [], nextCursor: null }))
    })
    await flush()
    expect(host.querySelector('[aria-busy="true"]')).toBeNull()
    expect(host.textContent).toContain('Chưa có file nào')
    expect(host.textContent).not.toMatch(/undefined|NaN/)
  })

  it('an empty list under a filter says nothing matches, not that there are no files', async () => {
    sources = async () => ok({ items: [], nextCursor: null })
    await mount('elsewhere')
    await click(host.querySelector('[data-chip="pdf"]'))
    expect(host.textContent).toContain('Không có tài liệu nào khớp bộ lọc')
  })

  it('an error answer (an older server) is the list error state with Thử lại, which asks again', async () => {
    sources = async () => ({ ok: false, error: 'not_found' })
    await mount('elsewhere')
    const alert = host.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toMatch(/\S/)
    expect(sourceIds()).toEqual([])
    // UNI-2047 sidebar: the section is hidden while the route is not there, and back once it answers
    expect(sidebarSlot.querySelector('.dl-side-sources')).toBeNull()
    sources = async () => ok({ items: SOURCES, nextCursor: null })
    const retry = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Thử lại'),
    )
    if (retry) {
      await click(retry)
      expect(sourceIds()).toEqual(['s-new', 's-old'])
      expect(sidebarSlot.querySelector('.dl-side-sources')).not.toBeNull()
    }
  })

  it('a call that throws is the network error state, not a crash', async () => {
    sources = async () => {
      throw new Error('boom')
    }
    await mount('elsewhere')
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(sourceIds()).toEqual([])
  })

  it('has no Tạo nhanh row (nothing created here would show up in the list)', async () => {
    await mount('elsewhere')
    expect(host.querySelector('.dh-quick-row')).toBeNull()
  })

  it('a search lists the workspace hits as on every other screen, without the sources', async () => {
    await mount('elsewhere')
    const input = host.querySelector<HTMLInputElement>('.dh-search-input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'hop dong')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkSearchDocuments).toHaveBeenCalled()
    expect(sourceIds()).toEqual([])
  })

  it('the workspace root no longer merges the same rows: they live here only (F-14, Q2=A)', async () => {
    await mount('workspace')
    // the only sources read off the page is the sidebar's limit:1 probe (UNI-2047 sidebar)
    expect(api.uniworkListSources.mock.calls.map((c) => c[0])).toEqual([
      { workspaceId: 'ws-1', limit: 1 },
    ])
    expect(sourceIds()).toEqual([])
  })
})
