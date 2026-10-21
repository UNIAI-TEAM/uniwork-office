/**
 * @vitest-environment jsdom
 *
 * UNI-2047 B6: Gắn sao (Starred) on the shared DocList. The nav entry is there, the screen reads
 * `uniworkListFavorites` (the server's SV-2 route), draws the screen column "Ngày gắn sao", sends
 * only what the route reads, shows the list error state on an older server's 404 and has the row
 * menu entries Gắn sao / Bỏ gắn sao only when the host has the star IPC.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import {
  fetchDocumentsHomePage,
  getDocumentsHomeNavEntry,
  visibleDocumentsHomeNavEntries,
  type DocumentsHomeApiAdapter,
  type DocumentsHomeDoc,
  type DocumentsHomeSubViewId,
} from '../src/renderer/src/uniwork-home/documents-home-model'
import { buildRowMenu, type RowMenuActionId } from '../src/renderer/src/doclist/row-menu'
import type { StringKey } from '../src/renderer/src/locale'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

// Wednesday 2026-10-21 12:00 local
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const iso = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0).toISOString()
const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

const doc = (partial: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
  workspaceId: 'ws-1',
  title: `${partial.id}.docx`,
  format: 'docx',
  updatedAt: iso(2026, 10, 21, 9, 5),
  kind: 'file',
  parentId: null,
  updatedByName: 'Minh Trần',
  updatedById: 'u-minh',
  sizeBytes: 2_969,
  canEdit: true,
  canManage: true,
  myLevel: 'manage',
  ...partial,
})

const STARRED = [
  doc({ id: 'a', favoritedAt: iso(2026, 10, 21, 8, 0) }),
  doc({ id: 'b', favoritedAt: iso(2026, 10, 20, 16, 30), updatedById: 'u-lan' }),
]

describe('the nav entry', () => {
  it('Gắn sao is available and listed between Gần đây and Được chia sẻ với tôi', () => {
    const entry = getDocumentsHomeNavEntry('starred')
    expect(entry.available).toBe(true)
    expect(entry.source).toBe('favorites')
    expect(visibleDocumentsHomeNavEntries().map((e) => e.id)).toEqual([
      'workspace',
      'recent',
      'starred',
      'shared-with-me',
      'shared-by-me',
      'archive',
      'trash',
    ])
  })
})

describe('fetchDocumentsHomePage: starred', () => {
  const filters = { format: 'docx' as const, updatedBy: 'u-1', updatedFrom: '2026-10-01T00:00:00Z' }

  it('reads the favorites route with the type and the sort, and with no editor / date filter', async () => {
    const uniworkListFavorites = vi.fn(async () => ok({ documents: STARRED, nextCursor: 'next-1' }))
    const res = await fetchDocumentsHomePage({ uniworkListFavorites } as DocumentsHomeApiAdapter, {
      workspaceId: 'ws-1',
      subView: 'starred',
      folderId: null,
      cursor: 'c0',
      filters,
      sort: { sort: 'starred', order: 'desc' },
    })
    expect(uniworkListFavorites).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      cursor: 'c0',
      format: 'docx',
      sort: 'starred',
      order: 'desc',
    })
    expect(res.result).toEqual({ ok: true, value: { items: STARRED, nextCursor: 'next-1' } })
  })

  it('sends nothing extra for an unset query', async () => {
    const uniworkListFavorites = vi.fn(async () => ok({ documents: [], nextCursor: null }))
    await fetchDocumentsHomePage({ uniworkListFavorites } as DocumentsHomeApiAdapter, {
      workspaceId: 'ws-1',
      subView: 'starred',
      folderId: null,
      filters: {},
    })
    expect(uniworkListFavorites).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
  })

  it('an error answer comes back as the error (the list error state), a bridge without the call as an empty page', async () => {
    const failing = vi.fn(async () => ({ ok: false as const, error: 'not_found' as const }))
    const res = await fetchDocumentsHomePage({ uniworkListFavorites: failing } as never, {
      workspaceId: 'ws-1',
      subView: 'starred',
      folderId: null,
      filters: {},
    })
    expect(res.result).toEqual({ ok: false, error: 'not_found' })
    const none = await fetchDocumentsHomePage({} as DocumentsHomeApiAdapter, {
      workspaceId: 'ws-1',
      subView: 'starred',
      folderId: null,
      filters: {},
    })
    expect(none.result).toEqual({ ok: true, value: { items: [], nextCursor: null } })
  })
})

describe('row menu: Gắn sao / Bỏ gắn sao', () => {
  const items = (
    d: DocumentsHomeDoc,
    run: RowMenuActionId[],
    screen: Parameters<typeof buildRowMenu>[0]['screen'] = 'workspace',
  ) =>
    buildRowMenu({
      screen,
      doc: d,
      run: Object.fromEntries(run.map((id) => [id, vi.fn()])),
      offlineLabel: null,
      label: (key: StringKey) => key,
    })

  it('a row with no star time gets Gắn sao, a starred row gets Bỏ gắn sao, never both', () => {
    const plain = items(doc({ id: 'p' }), ['open', 'star', 'unstar', 'rename'])
    expect(plain.map((i) => i.id)).toEqual(['open', 'star', 'rename'])
    expect(plain[1]!.label).toBe('dlActStar')
    const starred = items(
      doc({ id: 's', favoritedAt: iso(2026, 10, 20, 9, 0) }),
      ['open', 'star', 'unstar', 'rename'],
      'starred',
    )
    expect(starred.map((i) => i.id)).toEqual(['open', 'unstar', 'rename'])
    expect(starred[1]!.label).toBe('dlActUnstar')
  })

  it('sits in the edit group before Đổi tên (the board: Gắn sao · Đổi tên · Di chuyển)', () => {
    const list = items(doc({ id: 'p' }), ['open', 'copy-link', 'star', 'rename', 'move'])
    expect(list.map((i) => i.id)).toEqual(['open', 'copy-link', 'star', 'rename', 'move'])
    expect(list[2]!.group).toBe(list[3]!.group)
  })

  it('has no entry when the host cannot run it (no dead item)', () => {
    expect(items(doc({ id: 'p' }), ['open', 'rename']).map((i) => i.id)).toEqual(['open', 'rename'])
    expect(
      items(doc({ id: 's', favoritedAt: iso(2026, 10, 20, 9, 0) }), ['open'], 'starred').map(
        (i) => i.id,
      ),
    ).toEqual(['open'])
  })

  it('a trashed or shelved row has neither', () => {
    const run: RowMenuActionId[] = ['open', 'star', 'unstar', 'restore', 'details', 'unshelve']
    expect(
      items(doc({ id: 't', archived: true, canManage: true }), run, 'trash').map((i) => i.id),
    ).toEqual(['restore', 'details'])
    expect(items(doc({ id: 'h', shelvedAt: iso(2026, 10, 1, 1, 1) }), run, 'shelved')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'star' })]),
    )
  })

  it('a folder has no star entry (the list never holds one)', () => {
    expect(items(doc({ id: 'f', kind: 'folder' }), ['open', 'star']).map((i) => i.id)).toEqual([
      'open',
    ])
  })
})

describe('DocumentsHome: the Starred screen', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let favorites: () => Promise<UniworkResult<unknown>>
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
      uniworkListDocuments: vi.fn(async () =>
        ok({ documents: [doc({ id: 'r1' })], nextCursor: null }),
      ),
      uniworkListFavorites: vi.fn(() => favorites()),
      uniworkListSharedWithMe: vi.fn(async () => empty()),
      uniworkListSharedByMe: vi.fn(async () => empty()),
      uniworkListTrash: vi.fn(async () => empty()),
      uniworkListShelved: vi.fn(async () => empty()),
      uniworkListSources: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkFavoriteDocument: vi.fn(async () => ok({ favoritedAt: iso(2026, 10, 21, 11, 0) })),
      uniworkUnfavoriteDocument: vi.fn(async () => ok(undefined)),
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
    favorites = async () => ok({ documents: STARRED, nextCursor: null })
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

  async function mount(subView: DocumentsHomeSubViewId = 'starred', lang: 'vi' | 'en' = 'vi') {
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
  const rowIds = () =>
    Array.from(host.querySelectorAll('[role="row"][data-doc-id]')).map((el) =>
      el.getAttribute('data-doc-id'),
    )
  const navLabels = () =>
    Array.from(sidebarSlot.querySelectorAll('.dh-nav-label')).map((el) => el.textContent)
  const menuLabels = () =>
    Array.from(document.querySelectorAll('.uw-row-menu-list [role="menuitem"]')).map((el) =>
      el.textContent?.trim(),
    )
  const pick = async (name: string, value: string) => {
    const el = host.querySelector<HTMLSelectElement>(`select[data-filter="${name}"]`)!
    await act(async () => {
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
  }

  it('lists Gắn sao in the sub-nav and opens it from there', async () => {
    await mount('workspace')
    expect(navLabels()).toContain('Gắn sao')
    const entry = Array.from(sidebarSlot.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Gắn sao'),
    )
    await click(entry)
    expect(api.uniworkListFavorites).toHaveBeenCalled()
    expect(rowIds()).toEqual(['a', 'b'])
  })

  it('reads the favorites route, not the Recent list, and sends nothing but the workspace at first', async () => {
    await mount('starred')
    expect(api.uniworkListFavorites).toHaveBeenCalledTimes(1)
    expect(lastCall('uniworkListFavorites')).toEqual({ workspaceId: 'ws-1' })
    expect(api.uniworkListDocuments).not.toHaveBeenCalled()
    expect(rowIds()).toEqual(['a', 'b'])
  })

  it('draws the screen column with the date and "Bạn gắn sao" (English: "Starred on", "You starred")', async () => {
    await mount('starred')
    expect(host.textContent).toContain('Ngày gắn sao')
    const cell = host.querySelector('[data-doc-id="a"] [data-col="starred"]')!
    expect(cell.textContent).toContain('08:00')
    expect(cell.textContent).toContain('Bạn gắn sao')
    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    localStorage.setItem('genoffice.lang', 'en')
    await mount('starred', 'en')
    expect(host.textContent).toContain('Starred on')
    expect(host.querySelector('[data-doc-id="b"] [data-col="starred"]')!.textContent).toContain(
      'You starred',
    )
  })

  it('a type chip goes to the server; Người sửa / Cập nhật narrow the loaded rows and are not sent', async () => {
    await mount('starred')
    await click(host.querySelector('[data-chip="docx"]'))
    expect(lastCall('uniworkListFavorites')).toMatchObject({ format: 'docx' })
    await pick('updatedBy', 'u-lan')
    const call = lastCall('uniworkListFavorites')
    expect(call).not.toHaveProperty('updatedBy')
    expect(call).not.toHaveProperty('updatedFrom')
    expect(rowIds()).toEqual(['b'])
    await pick('updatedBy', '')
    await pick('updatedFrom', '24h')
    expect(lastCall('uniworkListFavorites')).not.toHaveProperty('updatedFrom')
    expect(rowIds()).toEqual(['a', 'b'])
  })

  it('sorts by the screen column on the server: Ngày gắn sao', async () => {
    await mount('starred')
    const header = host.querySelector<HTMLElement>('[role="columnheader"][data-col="starred"]')
    await click(header?.querySelector('button') ?? header)
    expect(lastCall('uniworkListFavorites')).toMatchObject({ sort: 'starred' })
  })

  it('an older server (404) shows the list error state, keeps the nav entry and never crashes', async () => {
    favorites = async () => ({ ok: false, error: 'not_found' })
    await mount('starred')
    const alert = host.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toMatch(/\S/)
    expect(rowIds()).toEqual([])
    expect(navLabels()).toContain('Gắn sao')
  })

  it('a call that throws is the network error state, not a crash', async () => {
    favorites = async () => {
      throw new Error('boom')
    }
    await mount('starred')
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(rowIds()).toEqual([])
  })

  it('an empty list says so in words', async () => {
    favorites = async () => ok({ documents: [], nextCursor: null })
    await mount('starred')
    expect(host.textContent).toContain('Chưa có tài liệu nào được gắn sao.')
    expect(host.textContent).not.toMatch(/undefined|NaN/)
  })

  it('Bỏ gắn sao on a starred row unstars it, says so and rereads the list', async () => {
    await mount('starred')
    await click(host.querySelector('[data-doc-id="a"] .uw-row-menu-btn'))
    expect(menuLabels()).toContain('Bỏ gắn sao')
    expect(menuLabels()).not.toContain('Gắn sao')
    favorites = async () => ok({ documents: [STARRED[1]!], nextCursor: null })
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('.uw-row-menu-list [role="menuitem"]'),
    ).find((el) => el.textContent?.trim() === 'Bỏ gắn sao')
    await click(item)
    expect(api.uniworkUnfavoriteDocument).toHaveBeenCalledTimes(1)
    expect(api.uniworkUnfavoriteDocument!.mock.calls[0]![0]).toBe('a')
    expect(api.uniworkListFavorites).toHaveBeenCalledTimes(2)
    expect(rowIds()).toEqual(['b'])
    expect(document.body.textContent).toContain('Đã bỏ gắn sao')
  })

  it('Gắn sao on a row of another screen stars it and says so', async () => {
    await mount('recent')
    await click(host.querySelector('[data-doc-id="r1"] .uw-row-menu-btn'))
    expect(menuLabels()).toContain('Gắn sao')
    expect(menuLabels()).not.toContain('Bỏ gắn sao')
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('.uw-row-menu-list [role="menuitem"]'),
    ).find((el) => el.textContent?.trim() === 'Gắn sao')
    await click(item)
    expect(api.uniworkFavoriteDocument).toHaveBeenCalledTimes(1)
    expect(api.uniworkFavoriteDocument!.mock.calls[0]![0]).toBe('r1')
    expect(document.body.textContent).toContain('Đã gắn sao')
  })

  it('a refused star says so and leaves the list as it was', async () => {
    api.uniworkFavoriteDocument!.mockImplementation(async () => ({
      ok: false,
      error: 'forbidden',
    }))
    await mount('recent')
    await click(host.querySelector('[data-doc-id="r1"] .uw-row-menu-btn'))
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('.uw-row-menu-list [role="menuitem"]'),
    ).find((el) => el.textContent?.trim() === 'Gắn sao')
    await click(item)
    expect(document.body.textContent).toContain('Không đổi được trạng thái gắn sao')
    expect(rowIds()).toEqual(['r1'])
  })

  it('a host without the star IPC has no Gắn sao / Bỏ gắn sao entry at all', async () => {
    const bare = baseApi()
    delete bare.uniworkFavoriteDocument
    delete bare.uniworkUnfavoriteDocument
    install(bare)
    await mount('starred')
    await click(host.querySelector('[data-doc-id="a"] .uw-row-menu-btn'))
    expect(menuLabels().length).toBeGreaterThan(0)
    expect(menuLabels()).not.toContain('Bỏ gắn sao')
    expect(menuLabels()).not.toContain('Gắn sao')
  })
})
