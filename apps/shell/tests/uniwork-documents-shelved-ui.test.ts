/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'

/**
 * UNI-1961 slice B: the Lưu trữ / Archive view of the Documents home, as the
 * web's DocumentsShelvedView draws it (D packages/views/documents
 * documents-shelved-*.tsx): heading + intro, the type filter, the client-side
 * "Lưu trữ bởi" filter with its loaded-only note, the fixed "Lưu trữ gần
 * nhất" sort, the Tên / Truy cập / Lưu trữ bởi / Lưu trữ lúc / actions table
 * in the server's order, Bỏ lưu trữ (manage or admin_scope) and the ⋯ menu
 * (Mở, Bỏ lưu trữ, Chuyển vào thùng rác), the web's empty states and toasts.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]

function shelvedRows(): DocumentsHomeDoc[] {
  return [
    {
      id: 'doc-a',
      workspaceId: 'ws-1',
      title: 'Báo cáo năm.docx',
      format: 'docx',
      updatedAt: '2025-03-01T09:00:00.000Z',
      kind: 'file',
      parentId: null,
      visibility: 'workspace',
      myLevel: 'manage',
      canManage: true,
      shelvedAt: '2025-03-05T09:00:00.000Z',
      shelvedById: 'u-lan',
      shelvedByName: 'Lan Nguyễn',
    },
    {
      id: 'fold-b',
      workspaceId: 'ws-1',
      title: 'Hồ sơ 2024',
      format: null,
      updatedAt: '2025-02-01T09:00:00.000Z',
      kind: 'folder',
      parentId: null,
      visibility: 'restricted',
      myLevel: 'manage',
      canManage: true,
      shelvedAt: '2025-02-04T09:00:00.000Z',
      shelvedById: 'u-gone',
      shelvedByFormer: true,
    },
    {
      id: 'doc-child',
      workspaceId: 'ws-1',
      title: 'Phụ lục.xlsx',
      format: 'xlsx',
      updatedAt: '2025-02-01T08:00:00.000Z',
      kind: 'file',
      parentId: 'fold-b',
      myLevel: 'view',
      canManage: false,
      shelvedAt: '2025-02-04T09:00:00.000Z',
      shelvedById: 'u-gone',
      shelvedByFormer: true,
      path: [{ id: 'fold-b', title: 'Hồ sơ 2024' }],
    },
    {
      id: 'page-c',
      workspaceId: 'ws-1',
      title: 'Biên bản họp',
      format: null,
      updatedAt: '2025-01-01T09:00:00.000Z',
      kind: 'page',
      parentId: null,
      adminScope: true,
      shelvedAt: '2025-01-02T09:00:00.000Z',
    },
  ]
}

describe('UNI-1961 Documents home Lưu trữ (Archive) view', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let onOpenDocument: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    onOpenDocument = vi.fn()
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
      uniworkListDocuments: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListSharedWithMe: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListSharedByMe: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListTrash: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListShelved: vi.fn(async () => ok({ documents: shelvedRows(), nextCursor: null })),
      uniworkUnshelveDocument: vi.fn(async (id: string) =>
        ok({
          document: { ...shelvedRows().find((d) => d.id === id)!, shelvedAt: undefined },
          affected: [id],
        }),
      ),
      uniworkTrashShelvedDocument: vi.fn(async (id: string) =>
        ok({ ...shelvedRows().find((d) => d.id === id)!, archived: true }),
      ),
      uniworkArchiveDocument: vi.fn(async () => ok({})),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
    }
    ;(window as unknown as { aiOffice: unknown }).aiOffice = api
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
  })

  async function mount(lang: 'vi' | 'en' = 'vi', initialSubView?: 'archive') {
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
            ...(initialSubView ? { initialSubView } : {}),
          }),
        ),
      )
    })
    await flush()
  }

  async function openArchive() {
    const nav = sidebarSlot.querySelector<HTMLButtonElement>('.nav-item[data-nav="archive"]')
    expect(nav, 'Archive nav entry').not.toBeNull()
    await act(async () => {
      nav!.click()
    })
    await flush()
  }

  const row = (id: string) => host.querySelector<HTMLElement>(`.dh-doc-row[data-doc-id="${id}"]`)
  const cells = (id: string) =>
    Array.from(row(id)?.querySelectorAll<HTMLElement>('[role="cell"]') ?? [])

  async function openMenu(id: string): Promise<HTMLButtonElement[]> {
    const kebab = row(id)!.querySelector<HTMLButtonElement>('.uw-row-menu-btn')
    expect(kebab, `⋯ of ${id}`).not.toBeNull()
    await act(async () => {
      kebab!.click()
    })
    await flush()
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>('.uw-row-menu-list [role="menuitem"]'),
    )
  }

  it('lists Lưu trữ in the sub-nav between Tôi đã chia sẻ and Thùng rác', async () => {
    await mount()
    const nav = Array.from(
      sidebarSlot.querySelectorAll<HTMLButtonElement>('.home-area-nav .nav-item'),
    )
    expect(nav.map((b) => b.getAttribute('data-nav'))).toEqual([
      'workspace',
      'recent',
      'shared-with-me',
      'shared-by-me',
      'archive',
      'trash',
    ])
    expect(nav[4]!.textContent?.trim()).toBe('Lưu trữ')
  })

  it('loads the shelf and draws the web heading, intro, toolbar and columns, in the server order', async () => {
    await mount()
    await openArchive()
    expect(api.uniworkListShelved).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
    )
    expect(host.querySelector('h1.dh-title')?.textContent).toBe('Lưu trữ')
    expect(host.querySelector('.dh-shelved-intro')?.textContent).toBe(
      'Tài liệu đã xong việc được cất ở đây: giữ mãi, chỉ đọc, không bình luận. Bỏ lưu trữ đưa mục về như cũ. Ai xem được vẫn mở và tìm thấy (nhãn “Đã lưu trữ”). Lưu trữ một thư mục là lưu cả cây; cần quyền Quản lý.',
    )
    // the live views' quick-create row, filter bar and folder cards are not on the shelf
    expect(host.querySelector('.dh-quick-row')).toBeNull()
    // not rendered at all: an author display:flex beats the hidden attribute, so `hidden` would still paint it
    expect(host.querySelector('.dh-filter-bar')).toBeNull()
    expect(host.querySelector('.dh-folders-section')).toBeNull()
    expect(host.querySelector('.dh-shelved-sort')?.textContent?.trim()).toBe('Lưu trữ gần nhất')

    const heads = Array.from(
      host.querySelectorAll<HTMLElement>('.dh-shelved-table [role="columnheader"]'),
    )
    expect(heads.map((h) => h.textContent?.trim())).toEqual([
      'Tên',
      'Truy cập',
      'Lưu trữ bởi',
      'Lưu trữ lúc',
      '',
    ])
    expect(heads[4]!.getAttribute('aria-label')).toBe('Thao tác')
    // server order (shelved_at DESC), folders as rows, no client re-sort
    expect(
      Array.from(host.querySelectorAll('.dh-doc-row')).map((r) => r.getAttribute('data-doc-id')),
    ).toEqual(['doc-a', 'fold-b', 'doc-child', 'page-c'])
  })

  it('draws each cell as the web does: path line, audience, shelver (member / former / system), short date', async () => {
    await mount()
    await openArchive()
    const [nameA, accessA, byA, atA] = cells('doc-a')
    expect(nameA!.textContent).toContain('Báo cáo năm.docx')
    expect(nameA!.querySelector('.dh-shelved-path')?.textContent).toBe('Tài liệu (gốc)')
    expect(accessA!.textContent?.trim()).toBe('Workspace')
    expect(byA!.textContent?.trim()).toBe('Lan Nguyễn')
    expect(atA!.textContent?.trim()).toBe('05/03/2025')

    const [, accessB, byB] = cells('fold-b')
    // restricted is the web's "Riêng tư" with a lock
    expect(accessB!.textContent?.trim()).toBe('Riêng tư')
    expect(accessB!.querySelector('.dh-shelved-lock')).not.toBeNull()
    expect(byB!.textContent?.trim()).toBe('Cựu thành viên')

    const [nameChild, accessChild] = cells('doc-child')
    expect(nameChild!.querySelector('.dh-shelved-path')?.textContent).toBe('Hồ sơ 2024')
    expect(accessChild!.textContent?.trim()).toBe('—')

    const [, , byC] = cells('page-c')
    expect(byC!.textContent?.trim()).toBe('Hệ thống')
  })

  it('offers Bỏ lưu trữ only to rows the viewer manages (my_level manage or admin_scope)', async () => {
    await mount()
    await openArchive()
    const unshelve = (id: string) =>
      row(id)!.querySelector<HTMLButtonElement>('button.dh-shelved-unshelve')
    expect(unshelve('doc-a')?.textContent?.trim()).toBe('Bỏ lưu trữ')
    expect(unshelve('doc-a')?.getAttribute('aria-label')).toBe('Bỏ lưu trữ Báo cáo năm.docx')
    expect(unshelve('fold-b')).not.toBeNull()
    expect(unshelve('page-c')).not.toBeNull()
    expect(unshelve('doc-child')).toBeNull()

    // a view-only row keeps only Mở in its menu
    const items = await openMenu('doc-child')
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Mở'])
  })

  it('Bỏ lưu trữ calls unshelve once, toasts the web line and rereads the shelf', async () => {
    await mount()
    await openArchive()
    expect(api.uniworkListShelved).toHaveBeenCalledTimes(1)
    const button = row('doc-a')!.querySelector<HTMLButtonElement>('button.dh-shelved-unshelve')!
    await act(async () => {
      button.click()
      button.click()
    })
    await flush()
    expect(api.uniworkUnshelveDocument).toHaveBeenCalledTimes(1)
    expect(api.uniworkUnshelveDocument).toHaveBeenCalledWith('doc-a')
    expect(host.querySelector('.uw-act-toast')?.textContent).toContain(
      'Đã bỏ lưu trữ Báo cáo năm.docx',
    )
    expect(api.uniworkListShelved).toHaveBeenCalledTimes(2)
  })

  it('says some children stay shelved when a folder unshelve leaves loaded descendants behind', async () => {
    await mount()
    await openArchive()
    const button = row('fold-b')!.querySelector<HTMLButtonElement>('button.dh-shelved-unshelve')!
    await act(async () => {
      button.click()
    })
    await flush()
    expect(api.uniworkUnshelveDocument).toHaveBeenCalledWith('fold-b')
    const toast = host.querySelector('.uw-act-toast')?.textContent ?? ''
    expect(toast).toContain('Đã bỏ lưu trữ Hồ sơ 2024')
    expect(toast).toContain('Một số mục con vẫn ở trong Lưu trữ.')
  })

  it('shows the web error lines for a refused unshelve', async () => {
    api.uniworkUnshelveDocument!.mockResolvedValueOnce({ ok: false, error: 'forbidden' })
    await mount()
    await openArchive()
    await act(async () => {
      row('doc-a')!.querySelector<HTMLButtonElement>('button.dh-shelved-unshelve')!.click()
    })
    await flush()
    expect(host.querySelector('.uw-act-toast')?.textContent).toContain('Bạn không quản lý mục này.')

    api.uniworkUnshelveDocument!.mockResolvedValueOnce({ ok: false, error: 'server_error' })
    await act(async () => {
      row('doc-a')!.querySelector<HTMLButtonElement>('button.dh-shelved-unshelve')!.click()
    })
    await flush()
    expect(host.querySelector('.uw-act-toast')?.textContent).toContain(
      'Không bỏ lưu trữ được. Chưa có gì thay đổi.',
    )
  })

  it('the ⋯ menu offers Mở, Bỏ lưu trữ and Chuyển vào thùng rác; trash confirms first, then moves it and rereads', async () => {
    await mount()
    await openArchive()
    const items = await openMenu('doc-a')
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Mở',
      'Bỏ lưu trữ',
      'Chuyển vào thùng rác',
    ])
    await act(async () => {
      items[2]!.click()
    })
    await flush()
    // the confirm dialog comes first: nothing moved yet
    expect(api.uniworkTrashShelvedDocument).not.toHaveBeenCalled()
    // F2: the confirm names the trash, not "Lưu trữ" (the item is already archived)
    const dialogText = document.querySelector('.modal.uw-act')?.textContent ?? ''
    expect(dialogText).toContain('Chuyển vào thùng rác · Báo cáo năm.docx')
    expect(dialogText).toContain('thùng rác trong 30 ngày')
    expect(dialogText).not.toContain('Lưu trữ')
    const confirm = document.querySelector<HTMLButtonElement>('.modal-buttons .btn-primary')
    expect(confirm).not.toBeNull()
    await act(async () => {
      confirm!.click()
    })
    await flush()
    expect(api.uniworkTrashShelvedDocument).toHaveBeenCalledWith('doc-a')
    // the live-row archive path is not used for a shelved row
    expect(api.uniworkArchiveDocument).not.toHaveBeenCalled()
    expect(host.querySelector('.uw-act-toast')?.textContent).toContain(
      'Đã chuyển Báo cáo năm.docx vào thùng rác',
    )
    expect(api.uniworkListShelved).toHaveBeenCalledTimes(2)
  })

  it('opens a file through the file flow, never browses a shelved folder', async () => {
    await mount()
    await openArchive()
    const open = row('doc-a')!.querySelector<HTMLButtonElement>('.dh-doc-open')
    expect(open).not.toBeNull()
    await act(async () => {
      open!.click()
    })
    await flush()
    expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-a' }))
    // a folder row has no open control and no Mở item
    expect(row('fold-b')!.querySelector('.dh-doc-open')).toBeNull()
    const items = await openMenu('fold-b')
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Bỏ lưu trữ', 'Chuyển vào thùng rác'])
    expect(api.uniworkListChildren).not.toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'fold-b' }),
    )
  })

  it('filters by who archived it on the loaded rows only, says so, and shows the web no-match state', async () => {
    await mount()
    await openArchive()
    const select = host.querySelector<HTMLSelectElement>('select[data-filter="shelvedBy"]')
    expect(select).not.toBeNull()
    expect(Array.from(select!.options).map((o) => o.textContent)).toEqual([
      'Bất kỳ ai',
      'Lan Nguyễn',
      'Cựu thành viên',
      'Hệ thống',
    ])
    expect(host.querySelector('.dh-shelved-loaded-only')).toBeNull()
    const pick = async (index: number) => {
      await act(async () => {
        select!.value = select!.options[index]!.value
        select!.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await flush()
    }
    await pick(3)
    expect(
      Array.from(host.querySelectorAll('.dh-doc-row')).map((r) => r.getAttribute('data-doc-id')),
    ).toEqual(['page-c'])
    expect(host.querySelector('.dh-shelved-loaded-only')?.textContent).toBe(
      'Chỉ lọc trong phần đã tải — tải thêm để lọc rộng hơn.',
    )
    // client-side only: no new request
    expect(api.uniworkListShelved).toHaveBeenCalledTimes(1)
    await pick(2)
    expect(
      Array.from(host.querySelectorAll('.dh-doc-row')).map((r) => r.getAttribute('data-doc-id')),
    ).toEqual(['fold-b', 'doc-child'])

    api.uniworkListShelved!.mockResolvedValueOnce(
      ok({ documents: shelvedRows().slice(0, 1), nextCursor: null }),
    )
    // the type filter goes to the server
    const type = host.querySelector<HTMLSelectElement>('select[data-filter="format"]')!
    await act(async () => {
      type.value = 'xlsx'
      type.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkListShelved).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', format: 'xlsx' }),
    )
    const empty = host.querySelector('.dh-empty')
    expect(empty?.textContent).toContain('Không có mục nào khớp')
    expect(empty?.textContent).toContain('Không mục nào khớp bộ lọc trong phần đã tải.')
  })

  it('sends only the type filter to the shelf, not the live views updater/date filters', async () => {
    await mount()
    const updated = host.querySelector<HTMLSelectElement>('select[data-filter="updatedFrom"]')!
    await act(async () => {
      updated.value = '7d'
      updated.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    await openArchive()
    const q = api.uniworkListShelved!.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(q.workspaceId).toBe('ws-1')
    expect(q.updatedFrom).toBeUndefined()
    expect(q.updatedBy).toBeUndefined()
  })

  it('pages with the server cursor', async () => {
    api.uniworkListShelved!.mockResolvedValueOnce(
      ok({ documents: shelvedRows().slice(0, 2), nextCursor: 'c-2' }),
    )
    await mount()
    await openArchive()
    api.uniworkListShelved!.mockResolvedValueOnce(
      ok({ documents: shelvedRows().slice(2), nextCursor: null }),
    )
    const more = host.querySelector<HTMLButtonElement>('.dh-load-more-row button')
    expect(more?.textContent).toBe('Tải thêm')
    await act(async () => {
      more!.click()
    })
    await flush()
    expect(api.uniworkListShelved).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', cursor: 'c-2' }),
    )
    expect(host.querySelectorAll('.dh-doc-row')).toHaveLength(4)
  })

  it('shows the web empty state on an empty shelf', async () => {
    api.uniworkListShelved!.mockResolvedValueOnce(ok({ documents: [], nextCursor: null }))
    await mount()
    await openArchive()
    const empty = host.querySelector('.dh-empty')
    expect(empty?.textContent).toContain('Chưa có tài liệu nào được lưu trữ')
    expect(empty?.textContent).toContain('Mục mà người quản lý đưa vào Lưu trữ sẽ hiện ở đây.')
  })

  it('speaks the web English copy', async () => {
    localStorage.setItem('genoffice.lang', 'en')
    await mount('en')
    await openArchive()
    expect(host.querySelector('h1.dh-title')?.textContent).toBe('Archive')
    expect(host.querySelector('.dh-shelved-intro')?.textContent).toBe(
      'Finished documents are put away here: kept forever, read-only, no comments. Unarchiving an item restores it as before. Anyone who can see an item still opens and finds it (labelled “Archived”). Archiving a folder archives the whole tree; it needs Manage access.',
    )
    const heads = Array.from(
      host.querySelectorAll<HTMLElement>('.dh-shelved-table [role="columnheader"]'),
    )
    expect(heads.map((h) => h.textContent?.trim())).toEqual([
      'Name',
      'Access',
      'Archived by',
      'Archived at',
      '',
    ])
    expect(host.querySelector('.dh-shelved-sort')?.textContent?.trim()).toBe(
      'Archived most recently',
    )
    expect(row('doc-a')!.querySelector('button.dh-shelved-unshelve')?.textContent?.trim()).toBe(
      'Unarchive',
    )
    expect(cells('doc-a')[0]!.querySelector('.dh-shelved-path')?.textContent).toBe(
      'Documents (root)',
    )
    expect(cells('fold-b')[2]!.textContent?.trim()).toBe('Former member')
    expect(cells('page-c')[2]!.textContent?.trim()).toBe('System')
    const items = await openMenu('doc-a')
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Open', 'Unarchive', 'Move to trash'])
  })
})
