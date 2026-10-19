/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkResult,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import { SaveDialog } from '../src/renderer/src/uniwork-folders/SaveDialog'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'

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

describe('DH1-W2 DocumentsHome UI + VS01 SaveDialog polish', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let workspaces: UniworkWorkspaceRef[]
  let folderTree: UniworkFolderNode[]
  let rootItems: DocumentsHomeDoc[]
  let myFolderItems: DocumentsHomeDoc[]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'

    workspaces = [
      { id: 'ws-1', name: 'Công ty Cổ phần UniWork', slug: 'uniwork' },
      { id: 'ws-2', name: 'Phòng Tài chính', slug: 'finance' },
    ]
    folderTree = [
      {
        id: 'f-mine',
        parentId: null,
        title: 'My Folder',
        position: 0,
        kind: 'my_folder',
        isSystem: true,
        children: [],
      },
      {
        id: 'f-board',
        parentId: null,
        title: 'Báo cáo HĐQT Q4',
        position: 1,
        children: [],
      },
      {
        id: 'f-legal',
        parentId: null,
        title: 'Hợp đồng & Pháp chế',
        position: 2,
        children: [],
      },
    ]
    rootItems = [
      {
        id: 'f-board',
        workspaceId: 'ws-1',
        title: 'Báo cáo HĐQT Q4',
        format: 'docx',
        updatedAt: '2026-10-15T10:00:00.000Z',
        kind: 'folder',
        parentId: null,
      },
      {
        id: 'f-legal',
        workspaceId: 'ws-1',
        title: 'Hợp đồng & Pháp chế',
        format: 'docx',
        updatedAt: '2026-10-14T10:00:00.000Z',
        kind: 'folder',
        parentId: null,
      },
      {
        id: 'doc-1',
        workspaceId: 'ws-1',
        title: 'Báo cáo kết quả kinh doanh Q3-2026.docx',
        format: 'docx',
        updatedAt: '2026-10-17T08:00:00.000Z',
        kind: 'file',
        parentId: null,
        visibility: 'private',
        myLevel: 'manage',
        updatedById: 'u-minh',
        updatedByName: 'Minh Trần',
      },
      {
        id: 'doc-2',
        workspaceId: 'ws-1',
        title: 'Kế hoạch ngân sách 2027.xlsx',
        format: 'xlsx',
        updatedAt: '2026-10-16T09:00:00.000Z',
        kind: 'file',
        parentId: null,
        visibility: 'workspace',
        myLevel: 'edit',
        updatedById: 'u-lan',
        updatedByName: 'Lan Nguyễn',
      },
      {
        id: 'doc-3',
        workspaceId: 'ws-1',
        title: 'Tài liệu chưa rõ quyền.pptx',
        format: 'pptx',
        updatedAt: '2026-10-12T09:00:00.000Z',
        kind: 'file',
        parentId: null,
      },
    ]
    myFolderItems = [
      {
        id: 'doc-mine-1',
        workspaceId: 'ws-1',
        title: 'Ghi chú cá nhân.docx',
        format: 'docx',
        updatedAt: '2026-10-17T09:30:00.000Z',
        kind: 'file',
        parentId: 'f-mine',
        visibility: 'private',
        myLevel: 'manage',
        updatedById: 'u-minh',
        updatedByName: 'Minh Trần',
      },
    ]

    api = {
      accountStatus: vi.fn(async () => ({
        state: 'signed-in' as const,
        loggedIn: true,
        email: 'minh@uniwork.vn',
        profile: {
          accountId: 'acc-1',
          email: 'minh@uniwork.vn',
          name: 'Minh Trần',
          orgId: 'org-1',
          orgName: 'Công ty Cổ phần UniWork',
          workspaces,
        },
      })),
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async () => ok(folderTree)),
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
      uniworkListChildren: vi.fn(
        async (q: {
          workspaceId: string
          parentId: string | null
        }): Promise<UniworkResult<UniworkFolderChildren>> => {
          if (q.parentId === 'f-mine') {
            return ok({ items: myFolderItems, nextCursor: null })
          }
          return ok({ items: rootItems, nextCursor: null })
        },
      ),
      uniworkListDocuments: vi.fn(async () =>
        ok({
          documents: [rootItems[2]!, rootItems[3]!],
          nextCursor: null,
        }),
      ),
      uniworkListSharedWithMe: vi.fn(async () =>
        ok({
          documents: [
            {
              id: 'doc-shared-in',
              workspaceId: 'ws-2',
              workspaceName: 'Phòng Tài chính',
              title: 'Đề xuất đối tác.docx',
              format: 'docx',
              updatedAt: '2026-10-17T07:00:00.000Z',
              kind: 'file',
              parentId: null,
              visibility: 'restricted',
              myLevel: 'edit',
              updatedById: 'u-hai',
              updatedByName: 'Hải Lê',
            } satisfies DocumentsHomeDoc,
          ],
          nextCursor: null,
        }),
      ),
      uniworkListSharedByMe: vi.fn(async () =>
        ok({
          documents: [
            {
              id: 'doc-shared-out',
              workspaceId: 'ws-1',
              title: 'Bản thảo hợp đồng.docx',
              format: 'docx',
              updatedAt: '2026-10-17T06:00:00.000Z',
              kind: 'file',
              parentId: null,
              visibility: 'restricted',
              myLevel: 'comment',
              updatedById: 'u-minh',
              updatedByName: 'Minh Trần',
            } satisfies DocumentsHomeDoc,
          ],
          nextCursor: null,
        }),
      ),
      uniworkListTrash: vi.fn(async () =>
        ok({
          documents: [
            {
              id: 'doc-trashed',
              workspaceId: 'ws-1',
              title: 'Tài liệu đã xóa.docx',
              format: 'docx',
              updatedAt: '2026-10-10T06:00:00.000Z',
              kind: 'file',
              parentId: null,
              canManage: true,
            } satisfies DocumentsHomeDoc,
          ],
          nextCursor: null,
        }),
      ),
      uniworkRestoreDocument: vi.fn(async () => ok({ id: 'doc-trashed' })),
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
  })

  it('renders the board sub-nav in sidebarHost (omitting Gắn sao & Lưu trữ), toolbar controls, Tạo nhanh pills + My Folder link, 3-col folder grid, and 5-column Tài liệu table with zero Đồng bộ / Kích thước columns', async () => {
    const onWorkspaceChange = vi.fn()
    const onOpenDocument = vi.fn()

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange,
            onOpenDocument,
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    // 1. Sidebar sub-nav order & omitted unavailable entries
    const navButtons = Array.from(
      sidebarSlot.querySelectorAll<HTMLButtonElement>('.home-area-nav .nav-item'),
    )
    expect(navButtons.map((b) => b.getAttribute('data-nav'))).toEqual([
      'workspace',
      'recent',
      'shared-with-me',
      'shared-by-me',
      'trash',
    ])
    expect(navButtons.map((b) => b.textContent?.trim())).toEqual([
      'Tài liệu của workspace',
      'Gần đây',
      'Được chia sẻ với tôi',
      'Tôi đã chia sẻ',
      'Thùng rác',
    ])
    expect(sidebarSlot.textContent).not.toContain('Gắn sao')
    expect(sidebarSlot.textContent).not.toContain('Lưu trữ')

    // 2. Top toolbar: h1 title, workspace switcher, search input, Tải lên, Tạo mới
    const h1 = host.querySelector<HTMLHeadingElement>('h1.dh-title')
    expect(h1?.textContent).toBe('Tài liệu của workspace')
    const wsSelect = host.querySelector<HTMLSelectElement>('select.home-uw-ws.dh-ws-select')
    expect(wsSelect).not.toBeNull()
    expect(host.querySelector<HTMLInputElement>('input.uwf-own-search')?.placeholder).toBe(
      'Tìm thư mục và tài liệu',
    )
    expect(host.textContent).toContain('Tải lên')
    expect(host.textContent).toContain('Tạo mới')

    // 3. Quick-create row ("Tạo nhanh"): Văn bản, Bảng tính, Trình chiếu; no My Folder notice (UNI-1957 item 4)
    const quickBar = host.querySelector<HTMLElement>('.dh-quick-row')
    expect(quickBar).not.toBeNull()
    expect(quickBar!.textContent).toContain('Tạo nhanh')
    expect(quickBar!.textContent).toContain('Văn bản')
    expect(quickBar!.textContent).toContain('Bảng tính')
    expect(quickBar!.textContent).toContain('Trình chiếu')
    expect(quickBar!.querySelector('.dh-quick-hint, .dh-quick-hint-link')).toBeNull()
    expect(quickBar!.textContent).not.toContain('chỉ bạn thấy')
    expect(quickBar!.textContent).not.toContain('Thư mục của tôi')

    // 4. Folder cards section ("Thư mục" + count badge)
    const folderCards = host.querySelectorAll('.dh-folder-card')
    expect(folderCards).toHaveLength(2)
    expect(host.textContent).toContain('Báo cáo HĐQT Q4')
    expect(host.textContent).toContain('Hợp đồng & Pháp chế')

    // 5. 5-column Tài liệu table: Tên | Truy cập | Người sửa gần nhất | Cập nhật | Thao tác (aria-label)
    const colHeaders = Array.from(
      host.querySelectorAll('.dh-doc-head > [role="columnheader"]'),
    ).map((el) => el.textContent?.trim())
    expect(colHeaders.slice(0, 4)).toEqual(['Tên', 'Truy cập', 'Người sửa gần nhất', 'Cập nhật'])
    expect(host.querySelector('.dh-doc-head .dh-col-actions')?.getAttribute('aria-label')).toBe(
      'Thao tác',
    )
    expect(host.textContent).not.toContain('Đồng bộ')
    expect(host.textContent).not.toContain('Kích thước')

    // Access badges and unknown ("—") fallback
    const visBadges = Array.from(host.querySelectorAll('.dh-vis-badge')).map((el) =>
      el.textContent?.trim(),
    )
    expect(visBadges).toEqual(['Riêng tư', 'Workspace'])
    const levelSubs = Array.from(host.querySelectorAll('.dh-level-sub')).map((el) =>
      el.textContent?.trim(),
    )
    expect(levelSubs).toEqual(['Bạn: Quản lý', 'Bạn: Chỉnh sửa'])

    const rows = Array.from(host.querySelectorAll('.dh-doc-row'))
    expect(rows).toHaveLength(3)
    // Third document has neither visibility/myLevel nor updatedByName -> renders "—" in both cells
    expect(rows[2]?.querySelector('.dh-cell-access')?.textContent?.trim()).toBe('—')
    expect(rows[2]?.querySelector('.dh-cell-person')?.textContent?.trim()).toBe('—')

    // Double-clicking a document row invokes onOpenDocument
    await act(async () => {
      rows[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(onOpenDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1', title: 'Báo cáo kết quả kinh doanh Q3-2026.docx' }),
    )

    // The sidebar's My Folder entry (a stand-in row here: the fixture tree has no My Folder node) opens the my-folder sub-view
    await act(async () => {
      sidebarSlot.querySelector<HTMLButtonElement>('[data-my-folder-standin]')!.click()
    })
    await flush()
    expect(api.uniworkListChildren).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', parentId: 'f-mine' }),
    )
    expect(host.querySelector('h1.dh-title')?.textContent).toBe('Thư mục của tôi')
    expect(host.textContent).toContain('Ghi chú cá nhân.docx')
  })

  it('switches across all 6 available sub-views, renders Recent & Trash rows from UniworkDocListPage.documents, keeps shared-with-me org-wide without filter bar, and restores documents from Thùng rác (DH1-R1-1, R1-2, R1-11e)', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    const clickNav = async (id: string) => {
      const btn = sidebarSlot.querySelector<HTMLButtonElement>(`.nav-item[data-nav="${id}"]`)
      expect(btn).not.toBeNull()
      await act(async () => {
        btn!.click()
      })
      await flush()
    }

    // Recent -> uniworkListDocuments (returns { documents, nextCursor }) and renders rows
    await clickNav('recent')
    expect(api.uniworkListDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
    )
    expect(host.textContent).toContain('Báo cáo kết quả kinh doanh Q3-2026.docx')
    expect(host.textContent).toContain('Kế hoạch ngân sách 2027.xlsx')

    // Filter by Loại = XLSX -> forwards format: 'xlsx' to uniworkListDocuments
    const filterSelects = host.querySelectorAll<HTMLSelectElement>('.dh-filter-select')
    expect(filterSelects).toHaveLength(3)
    await act(async () => {
      filterSelects[0]!.value = 'xlsx'
      filterSelects[0]!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkListDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', format: 'xlsx' }),
    )

    // Filter by Người sửa = u-minh -> forwards updatedBy: 'u-minh'
    await act(async () => {
      filterSelects[1]!.value = 'u-minh'
      filterSelects[1]!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkListDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', format: 'xlsx', updatedBy: 'u-minh' }),
    )

    // Filter by Cập nhật = 7d -> forwards updatedFrom ISO timestamp
    await act(async () => {
      filterSelects[2]!.value = '7d'
      filterSelects[2]!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkListDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        format: 'xlsx',
        updatedBy: 'u-minh',
        updatedFrom: expect.any(String),
      }),
    )

    // Shared with me -> org-wide: hides filter selects, sends {} (no workspaceId, no filters), and shows workspaceName in .dh-doc-subpath
    api.uniworkListSharedWithMe.mockResolvedValueOnce(
      ok({
        documents: [
          {
            id: 'doc-shared-in',
            workspaceId: 'ws-2',
            workspaceName: 'Phòng Tài chính',
            title: 'Đề xuất đối tác.docx',
            format: 'docx',
            updatedAt: '2026-10-17T07:00:00.000Z',
            kind: 'file',
            parentId: null,
            visibility: 'restricted',
            myLevel: 'edit',
            updatedById: 'u-hai',
            updatedByName: 'Hải Lê',
          } satisfies DocumentsHomeDoc,
        ],
        nextCursor: 'swm-cur-2',
      }),
    )
    await clickNav('shared-with-me')
    expect(api.uniworkListSharedWithMe).toHaveBeenLastCalledWith({})
    expect(host.querySelectorAll('.dh-filter-select')).toHaveLength(0)
    expect(host.querySelector('.dh-filter-clear')).toBeNull()
    expect(host.textContent).toContain('Đề xuất đối tác.docx')
    expect(host.querySelector('.dh-cell-name .dh-doc-subpath')?.textContent?.trim()).toBe(
      'Phòng Tài chính',
    )
    expect(host.querySelector('.dh-vis-badge')?.textContent?.trim()).toBe('Hạn chế')
    expect(host.querySelector('.dh-level-sub')?.textContent?.trim()).toBe('Bạn: Chỉnh sửa')

    // Paging on shared-with-me forwards only { cursor } and appends documents
    api.uniworkListSharedWithMe.mockResolvedValueOnce(
      ok({
        documents: [
          {
            id: 'doc-shared-in-2',
            workspaceId: 'ws-1',
            workspaceName: 'Công ty Cổ phần UniWork',
            title: 'Biên bản họp.docx',
            format: 'docx',
            updatedAt: '2026-10-16T07:00:00.000Z',
            kind: 'file',
            parentId: null,
          } satisfies DocumentsHomeDoc,
        ],
        nextCursor: null,
      }),
    )
    const loadMoreBtn = host.querySelector<HTMLButtonElement>('button.uw-pick-more')
    expect(loadMoreBtn).not.toBeNull()
    await act(async () => {
      loadMoreBtn!.click()
    })
    await flush()
    expect(api.uniworkListSharedWithMe).toHaveBeenLastCalledWith({ cursor: 'swm-cur-2' })
    expect(host.textContent).toContain('Biên bản họp.docx')

    // Shared by me -> uniworkListSharedByMe (filter bar visible again and forwards active filters)
    await clickNav('shared-by-me')
    expect(host.querySelectorAll('.dh-filter-select')).toHaveLength(3)
    expect(api.uniworkListSharedByMe).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', format: 'xlsx', updatedBy: 'u-minh' }),
    )
    expect(host.textContent).toContain('Bản thảo hợp đồng.docx')
    expect(host.querySelector('.dh-vis-badge')?.textContent?.trim()).toBe('Hạn chế')
    expect(host.querySelector('.dh-level-sub')?.textContent?.trim()).toBe('Bạn: Nhận xét')

    // If shared-with-me is empty while filters are active from another sub-view, it shows uhEmptySharedWithMe (not uhEmptyFiltered)
    api.uniworkListSharedWithMe.mockResolvedValueOnce(ok({ documents: [], nextCursor: null }))
    await clickNav('shared-with-me')
    expect(host.querySelector('.dh-empty')?.textContent?.trim()).toBe(
      'Chưa có tài liệu nào được chia sẻ với bạn.',
    )

    // Trash -> uniworkListTrash + restore action ("Khôi phục")
    await clickNav('trash')
    expect(api.uniworkListTrash).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
    )
    expect(host.textContent).toContain('Tài liệu đã xóa.docx')

    const kebab = host.querySelector<HTMLButtonElement>('.dh-doc-row .uw-row-menu-btn')
    expect(kebab).not.toBeNull()
    await act(async () => {
      kebab!.click()
    })
    await flush()
    const restoreMenuItem = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.uw-row-menu-list [role="menuitem"]'),
    ).find((el) => el.textContent?.includes('Khôi phục'))
    expect(restoreMenuItem).toBeDefined()
    await act(async () => {
      restoreMenuItem!.click()
    })
    await flush()
    expect(api.uniworkRestoreDocument).toHaveBeenCalledWith('doc-trashed')
  })

  it('offers Restore in Trash only when canManage is true and hides it when canManage is false (DH1-R1-11a)', async () => {
    api.uniworkListTrash.mockResolvedValueOnce(
      ok({
        documents: [
          {
            id: 'trash-no-manage',
            workspaceId: 'ws-1',
            title: 'Không có quyền khôi phục.docx',
            format: 'docx',
            updatedAt: '2026-10-10T07:00:00.000Z',
            kind: 'file',
            parentId: null,
            canManage: false,
          } satisfies DocumentsHomeDoc,
          {
            id: 'trash-can-manage',
            workspaceId: 'ws-1',
            title: 'Có quyền khôi phục.docx',
            format: 'docx',
            updatedAt: '2026-10-10T06:00:00.000Z',
            kind: 'file',
            parentId: null,
            canManage: true,
          } satisfies DocumentsHomeDoc,
        ],
        nextCursor: null,
      }),
    )

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    const trashBtn = sidebarSlot.querySelector<HTMLButtonElement>('.nav-item[data-nav="trash"]')!
    await act(async () => {
      trashBtn.click()
    })
    await flush()

    const noManageRow = host.querySelector<HTMLElement>(
      '.dh-doc-row[data-doc-id="trash-no-manage"]',
    )
    const canManageRow = host.querySelector<HTMLElement>(
      '.dh-doc-row[data-doc-id="trash-can-manage"]',
    )
    expect(noManageRow).not.toBeNull()
    expect(canManageRow).not.toBeNull()

    // Row with canManage: false has no action menu trigger at all
    expect(noManageRow!.querySelector('.uw-row-menu-btn')).toBeNull()

    // Row with canManage: true has the action menu trigger with "Khôi phục"
    const manageKebab = canManageRow!.querySelector<HTMLButtonElement>('.uw-row-menu-btn')
    expect(manageKebab).not.toBeNull()
    await act(async () => {
      manageKebab!.click()
    })
    await flush()
    const restoreItem = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.uw-row-menu-list [role="menuitem"]'),
    ).find((el) => el.textContent?.includes('Khôi phục'))
    expect(restoreItem).toBeDefined()
  })

  it('renders folder cards with a real <button class="dh-folder-open">, sibling FolderMenu, and pressing Enter/Space or clicking the menu trigger opens the menu without opening the folder (DH1-R1-9, DH1-R3-6)', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    const card = host.querySelector<HTMLElement>('.dh-folder-card[data-folder-id="f-board"]')
    expect(card).not.toBeNull()

    const openBtn = card!.querySelector<HTMLButtonElement>('button.dh-folder-open')
    expect(openBtn).not.toBeNull()
    expect(openBtn!.getAttribute('type')).toBe('button')
    expect(openBtn!.querySelector('.dh-folder-icon')).not.toBeNull()
    expect(openBtn!.querySelector('.dh-folder-name')?.textContent).toBe('Báo cáo HĐQT Q4')

    // FolderMenu must be a sibling of .dh-folder-open, not nested inside it
    expect(openBtn!.querySelector('.uw-row-menu')).toBeNull()
    const menuTrigger = card!.querySelector<HTMLButtonElement>('.uw-row-menu-btn')
    expect(menuTrigger).not.toBeNull()
    expect(menuTrigger!.getAttribute('aria-expanded')).toBe('false')

    api.uniworkListChildren.mockClear()

    // Pressing Enter on the menu trigger opens the menu and does NOT open the folder
    await act(async () => {
      menuTrigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    expect(api.uniworkListChildren).not.toHaveBeenCalled()
    expect(menuTrigger!.getAttribute('aria-expanded')).toBe('true')
    const openMenuAfterEnter = document.querySelector<HTMLElement>('.uw-row-menu-list[role="menu"]')
    expect(openMenuAfterEnter).not.toBeNull()

    // Close the menu with Escape, then press Space on the menu trigger: menu opens and folder does NOT open
    await act(async () => {
      openMenuAfterEnter!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    await flush()
    expect(menuTrigger!.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.uw-row-menu-list[role="menu"]')).toBeNull()

    await act(async () => {
      menuTrigger!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    await flush()
    expect(api.uniworkListChildren).not.toHaveBeenCalled()
    expect(menuTrigger!.getAttribute('aria-expanded')).toBe('true')
    const openMenuAfterSpace = document.querySelector<HTMLElement>('.uw-row-menu-list[role="menu"]')
    expect(openMenuAfterSpace).not.toBeNull()

    // Close the menu, then click the sibling menu button while the card is mounted: menu opens and folder does NOT open
    await act(async () => {
      openMenuAfterSpace!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    await flush()
    expect(menuTrigger!.getAttribute('aria-expanded')).toBe('false')

    await act(async () => {
      menuTrigger!.click()
    })
    await flush()
    expect(api.uniworkListChildren).not.toHaveBeenCalled()
    expect(menuTrigger!.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.uw-row-menu-list[role="menu"]')).not.toBeNull()

    // Clicking the card area outside the name (icon / open-button padding) opens the folder
    api.uniworkListChildren.mockClear()
    await act(async () => {
      openBtn!.querySelector<HTMLElement>('.dh-folder-icon')!.click()
    })
    await flush()
    expect(api.uniworkListChildren).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', parentId: 'f-board' }),
    )

    // Open button fills the card so padding / gap clicks hit .dh-folder-open, not the card chrome
    const docsHomeCss = readFileSync(
      resolve(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
      'utf8',
    )
    const cardBlock = docsHomeCss.match(/\.dh-folder-card\s*\{[^}]*\}/)?.[0] ?? ''
    const openBlock = docsHomeCss.match(/\.dh-folder-open\s*\{[^}]*\}/)?.[0] ?? ''
    expect(cardBlock).toMatch(/padding:\s*0;/)
    expect(openBlock).toMatch(/position:\s*absolute/)
    expect(openBlock).toMatch(/inset:\s*0/)
  })

  it('does not feed shared-with-me authors into Người sửa on workspace views (DH1-R2-4)', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    const clickNav = async (id: string) => {
      const btn = sidebarSlot.querySelector<HTMLButtonElement>(`.nav-item[data-nav="${id}"]`)
      expect(btn).not.toBeNull()
      await act(async () => {
        btn!.click()
      })
      await flush()
    }

    await clickNav('shared-with-me')
    expect(host.textContent).toContain('Đề xuất đối tác.docx')
    expect(host.textContent).toContain('Hải Lê')

    await clickNav('workspace')
    const authorSelect = host.querySelector<HTMLSelectElement>(
      'select.dh-filter-select[data-filter="updatedBy"]',
    )
    expect(authorSelect).not.toBeNull()
    const optionLabels = Array.from(authorSelect!.options).map((opt) => opt.textContent?.trim())
    expect(optionLabels).toContain('Minh Trần')
    expect(optionLabels).not.toContain('Hải Lê')
  })

  it('drops out-of-order responses when sub-view or workspace switches while a request is in flight (DH1-R1-11b)', async () => {
    let resolveStaleRecent!: (val: unknown) => void
    api.uniworkListDocuments.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleRecent = resolve
        }),
    )

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    // Switch to Recent (in-flight deferred)
    const recentBtn = sidebarSlot.querySelector<HTMLButtonElement>('.nav-item[data-nav="recent"]')!
    await act(async () => {
      recentBtn.click()
    })

    // Before Recent resolves, switch to Trash (resolves immediately with 'Tài liệu đã xóa.docx')
    const trashBtn = sidebarSlot.querySelector<HTMLButtonElement>('.nav-item[data-nav="trash"]')!
    await act(async () => {
      trashBtn.click()
    })
    await flush()
    expect(host.textContent).toContain('Tài liệu đã xóa.docx')

    // Now resolve the stale Recent promise -> must be ignored
    await act(async () => {
      resolveStaleRecent(
        ok({
          documents: [
            {
              id: 'stale-recent-doc',
              workspaceId: 'ws-1',
              title: 'Tài liệu cũ bị trễ.docx',
              format: 'docx',
              updatedAt: '2026-10-17T08:00:00.000Z',
              kind: 'file',
              parentId: null,
            } satisfies DocumentsHomeDoc,
          ],
          nextCursor: null,
        }),
      )
    })
    await flush()
    expect(host.textContent).toContain('Tài liệu đã xóa.docx')
    expect(host.textContent).not.toContain('Tài liệu cũ bị trễ.docx')

    // Also test out-of-order workspace switch while a ws-1 request is in flight
    let resolveStaleWs1Trash!: (val: unknown) => void
    api.uniworkListTrash.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleWs1Trash = resolve
        }),
    )
    api.uniworkListChildren.mockResolvedValueOnce(
      ok({
        items: [
          {
            id: 'ws2-root-doc',
            workspaceId: 'ws-2',
            title: 'Tài liệu của WS2.docx',
            format: 'docx',
            updatedAt: '2026-10-17T08:00:00.000Z',
            kind: 'file',
            parentId: null,
          } satisfies DocumentsHomeDoc,
        ],
        nextCursor: null,
      }),
    )

    // Trigger ws-1 Recent then ws-1 Trash (deferred), then switch workspaceId prop to ws-2
    await act(async () => {
      sidebarSlot.querySelector<HTMLButtonElement>('.nav-item[data-nav="recent"]')!.click()
    })
    await flush()
    await act(async () => {
      trashBtn.click()
    })
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-2',
            workspaces,
            onWorkspaceChange: vi.fn(),
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()
    expect(host.textContent).toContain('Tài liệu của WS2.docx')

    await act(async () => {
      resolveStaleWs1Trash(
        ok({
          documents: [
            {
              id: 'stale-ws1-trash',
              workspaceId: 'ws-1',
              title: 'Tài liệu WS1 trễ.docx',
              format: 'docx',
              updatedAt: '2026-10-17T08:00:00.000Z',
              kind: 'file',
              parentId: null,
            } satisfies DocumentsHomeDoc,
          ],
          nextCursor: null,
        }),
      )
    })
    await flush()
    expect(host.textContent).toContain('Tài liệu của WS2.docx')
    expect(host.textContent).not.toContain('Tài liệu WS1 trễ.docx')
  })

  it('renders loading, error, and empty states for workspace, recent, and trash, and catches rejected promises in load/search/loadMore chains (DH1-R1-3, DH1-R1-11c)', async () => {
    // 1. Workspace loading -> error -> empty
    let resolveWsLoad!: (val: unknown) => void
    api.uniworkListChildren.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWsLoad = resolve
        }),
    )

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    // Loading skeleton visible while in-flight
    expect(host.querySelector('.uw-pick-skeleton[aria-busy="true"]')).not.toBeNull()

    // Resolve with error -> error alert visible
    await act(async () => {
      resolveWsLoad({ ok: false, error: 'server_error' })
    })
    await flush()
    expect(host.querySelector('.uw-pick-state[role="alert"]')).not.toBeNull()

    // Click Retry -> resolve with empty items -> empty state visible
    api.uniworkListChildren.mockResolvedValueOnce(ok({ items: [], nextCursor: null }))
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.uw-pick-state button')!.click()
    })
    await flush()
    expect(host.querySelector('.dh-empty')?.textContent?.trim()).toBe(
      'Chưa có thư mục hoặc tài liệu nào trong workspace này.',
    )

    // 2. Recent loading -> rejected promise (DH1-R1-3) -> error -> empty
    let rejectRecent!: (err: Error) => void
    api.uniworkListDocuments.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRecent = reject
        }),
    )
    const recentBtn = sidebarSlot.querySelector<HTMLButtonElement>('.nav-item[data-nav="recent"]')!
    await act(async () => {
      recentBtn.click()
    })
    expect(host.querySelector('.uw-pick-skeleton[aria-busy="true"]')).not.toBeNull()

    await act(async () => {
      rejectRecent(new Error('IPC failed'))
    })
    await flush()
    expect(host.querySelector('.uw-pick-state[role="alert"]')).not.toBeNull()

    api.uniworkListDocuments.mockResolvedValueOnce(ok({ documents: [], nextCursor: null }))
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.uw-pick-state button')!.click()
    })
    await flush()
    expect(host.querySelector('.dh-empty')?.textContent?.trim()).toBe('Chưa có tài liệu gần đây.')

    // 3. Trash loading -> error -> empty
    let resolveTrash!: (val: unknown) => void
    api.uniworkListTrash.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTrash = resolve
        }),
    )
    const trashBtn = sidebarSlot.querySelector<HTMLButtonElement>('.nav-item[data-nav="trash"]')!
    await act(async () => {
      trashBtn.click()
    })
    expect(host.querySelector('.uw-pick-skeleton[aria-busy="true"]')).not.toBeNull()

    await act(async () => {
      resolveTrash({ ok: false, error: 'network' })
    })
    await flush()
    expect(host.querySelector('.uw-pick-state[role="alert"]')).not.toBeNull()

    api.uniworkListTrash.mockResolvedValueOnce(ok({ documents: [], nextCursor: null }))
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.uw-pick-state button')!.click()
    })
    await flush()
    expect(host.querySelector('.dh-empty')?.textContent?.trim()).toBe('Thùng rác trống.')

    // 4. loadMore rejection on sub-view resets loadingMore: false so "Tải thêm" is usable again (DH1-R1-3)
    api.uniworkListDocuments.mockResolvedValueOnce(
      ok({
        documents: [rootItems[2]!],
        nextCursor: 'page-2',
      }),
    )
    await act(async () => {
      recentBtn.click()
    })
    await flush()

    const moreBtn = host.querySelector<HTMLButtonElement>('button.uw-pick-more')!
    expect(moreBtn).not.toBeNull()
    expect(moreBtn.disabled).toBe(false)

    api.uniworkListDocuments.mockRejectedValueOnce(new Error('loadMore network boom'))
    await act(async () => {
      moreBtn.click()
    })
    await flush()
    expect(moreBtn.disabled).toBe(false)
    expect(host.querySelector('.uw-pick-more-error[role="alert"]')).not.toBeNull()

    // 5. Search initial-load rejection & search loadMore rejection (DH1-R1-3)
    const searchInput = host.querySelector<HTMLInputElement>('input.uwf-own-search')!
    api.uniworkSearchDocuments.mockRejectedValueOnce(new Error('search boom'))
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(searchInput, 'Kế hoạch')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      searchInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(host.querySelector('.uw-pick-state[role="alert"]')).not.toBeNull()

    // Retry search -> returns page 1 with cursor -> reject search loadMore -> resets loadingMore: false
    api.uniworkSearchDocuments.mockResolvedValueOnce(
      ok({ items: [rootItems[2]!], nextCursor: 'search-p2' }),
    )
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.uw-pick-state button')!.click()
    })
    await flush()
    const searchMoreBtn = host.querySelector<HTMLButtonElement>('button.uw-pick-more')!
    expect(searchMoreBtn.disabled).toBe(false)

    api.uniworkSearchDocuments.mockRejectedValueOnce(new Error('search loadMore boom'))
    await act(async () => {
      searchMoreBtn.click()
    })
    await flush()
    expect(searchMoreBtn.disabled).toBe(false)
    expect(host.querySelector('.uw-pick-more-error[role="alert"]')).not.toBeNull()
  })

  it('does not include t in any hook dependency array in DocumentsHome.tsx (DH1-R1-8)', async () => {
    const ts = await import('typescript')
    const file = resolve(__dirname, '../src/renderer/src/uniwork-home/DocumentsHome.tsx')
    const src = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      src,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const hooks = new Set(['useMemo', 'useCallback', 'useEffect', 'useLayoutEffect'])
    const hits: string[] = []

    const hookNameOf = (node: ts.CallExpression): string | null => {
      const expr = node.expression
      if (ts.isIdentifier(expr)) return expr.text
      if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text
      return null
    }

    const identifierTIn = (node: ts.Node): boolean => {
      if (ts.isIdentifier(node) && node.text === 't') {
        const parent = node.parent
        if (parent && ts.isPropertyAccessExpression(parent) && parent.name === node) return false
        return true
      }
      return ts.forEachChild(node, identifierTIn) === true
    }

    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = hookNameOf(node)
        if (name && hooks.has(name) && node.arguments.length >= 2) {
          const deps = node.arguments[1]!
          if (identifierTIn(deps)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(deps.getStart(sourceFile))
            hits.push(`${name}:${line + 1}`)
          }
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(sourceFile)
    expect(hits).toEqual([])
  })

  it('renders VS01-1 / VS01-2 / VS01-3 SaveDialog and UniworkFolderPicker glyph + search-icon + token rules', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(SaveDialog, {
            path: 'C:\\Users\\me\\Documents\\Báo cáo Q4.docx',
            onClose: vi.fn(),
          }),
        ),
      )
    })
    await flush()

    // State 1: MyFolderGlyph (folder + lock SVG) in .uws-loc-icon and right-chevron .uws-loc-chev after "Đổi"
    expect(document.querySelector('.uws-loc-icon svg')).not.toBeNull()
    expect(document.querySelector('.uws-loc-chev')).not.toBeNull()

    // Open State 2 (picker)
    const locBtn = document.querySelector<HTMLButtonElement>('.uws-loc')!
    await act(async () => {
      locBtn.click()
    })
    await flush()

    // State 2: search input wrapped in .uwf-picker-search-wrap with .uwf-picker-search-icon and MyFolderGlyph in tree
    expect(document.querySelector('.uwf-picker-search-wrap .uwf-picker-search-icon')).not.toBeNull()
    expect(document.querySelector('.uwf-picker-search-wrap input.uwf-picker-search')).not.toBeNull()
    expect(document.querySelector('.uwf-tree svg.uwf-glyph')).not.toBeNull()
  })

  it('defines every var(--x) used in documents-home.css and save-dialog.css and contains zero raw hex/rgb colors', () => {
    const tokensCss = readFileSync(
      resolve(__dirname, '../../../packages/ui/src/tokens.css'),
      'utf8',
    )
    const homeCss = readFileSync(resolve(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const uwfCss = readFileSync(
      resolve(__dirname, '../src/renderer/src/uniwork-folders/uniwork-folders.css'),
      'utf8',
    )
    const saveCss = readFileSync(
      resolve(__dirname, '../src/renderer/src/uniwork-folders/save-dialog.css'),
      'utf8',
    )
    const docsHomeCss = readFileSync(
      resolve(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
      'utf8',
    )

    const definedVars = new Set<string>()
    for (const css of [tokensCss, homeCss, uwfCss, saveCss, docsHomeCss]) {
      for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
        definedVars.add(m[1]!)
      }
    }

    for (const [label, css] of [
      ['documents-home.css', docsHomeCss],
      ['save-dialog.css', saveCss],
    ] as const) {
      const undefinedVars = new Set<string>()
      for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        if (!definedVars.has(m[1]!)) undefinedVars.add(m[1]!)
      }
      expect([...undefinedVars], `undefined vars in ${label}`).toEqual([])
      expect(css, `raw hex in ${label}`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css, `raw rgb/rgba in ${label}`).not.toMatch(/\brgba?\s*\(/)
    }
  })

  it('falls back to the nearest live parent (or workspace root) with the ufFolderGone status notice when an open folder disappears via tree change or not_found children read, never showing uwErrNotFound (DH1-E2E-2)', async () => {
    let treeChangedCb: ((ev: { workspaceId: string }) => void) | null = null
    api.onUniworkTreeChanged.mockImplementation((cb: (ev: { workspaceId: string }) => void) => {
      treeChangedCb = cb
      return () => {
        treeChangedCb = null
      }
    })

    let vanished = false
    let legalVanished = false
    api.uniworkFolderTree.mockImplementation(async () =>
      ok([
        folderTree[0]!,
        {
          id: 'f-hub',
          parentId: null,
          title: 'Source Hub',
          position: 1,
          children: vanished
            ? []
            : [
                {
                  id: 'f-leaf',
                  parentId: 'f-hub',
                  title: 'Vanishing Leaf',
                  position: 0,
                  children: [],
                },
              ],
        },
        ...(legalVanished ? [] : [folderTree[2]!]),
      ]),
    )

    const hubChildren: DocumentsHomeDoc[] = [
      {
        id: 'f-leaf',
        workspaceId: 'ws-1',
        title: 'Vanishing Leaf',
        format: 'docx',
        updatedAt: '2026-10-17T08:00:00.000Z',
        kind: 'folder',
        parentId: 'f-hub',
      },
      {
        id: 'doc-in-hub',
        workspaceId: 'ws-1',
        title: 'Tài liệu trong Source Hub.docx',
        format: 'docx',
        updatedAt: '2026-10-17T08:00:00.000Z',
        kind: 'file',
        parentId: 'f-hub',
      },
    ]

    api.uniworkListChildren.mockImplementation(
      async (q: {
        workspaceId: string
        parentId: string | null
      }): Promise<UniworkResult<UniworkFolderChildren>> => {
        if (q.parentId === 'f-hub') {
          return ok({
            items: vanished ? hubChildren.slice(1) : hubChildren,
            nextCursor: null,
          })
        }
        if (q.parentId === 'f-leaf') {
          if (vanished) {
            return { ok: false, error: 'not_found' }
          }
          return ok({ items: [], nextCursor: null })
        }
        if (q.parentId === 'f-legal') {
          if (legalVanished) {
            return { ok: false, error: 'not_found' }
          }
          return ok({ items: [], nextCursor: null })
        }
        return ok({
          items: [
            {
              id: 'f-hub',
              workspaceId: 'ws-1',
              title: 'Source Hub',
              format: 'docx',
              updatedAt: '2026-10-17T08:00:00.000Z',
              kind: 'folder',
              parentId: null,
            },
            ...(legalVanished ? [] : [rootItems[1]!]),
            rootItems[2]!,
          ],
          nextCursor: null,
        })
      },
    )

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
          }),
        ),
      )
    })
    await flush()

    // Navigate into Source Hub -> Vanishing Leaf
    const hubBtn = host.querySelector<HTMLButtonElement>(
      '.dh-folder-card[data-folder-id="f-hub"] button.dh-folder-open',
    )!
    expect(hubBtn).not.toBeNull()
    await act(async () => {
      hubBtn.click()
    })
    await flush()

    const leafBtn = host.querySelector<HTMLButtonElement>(
      '.dh-folder-card[data-folder-id="f-leaf"] button.dh-folder-open',
    )!
    expect(leafBtn).not.toBeNull()
    await act(async () => {
      leafBtn.click()
    })
    await flush()

    expect(host.querySelector('h1.dh-title')?.textContent).toBe('Vanishing Leaf')
    expect(host.querySelector('.uwf-crumbs [aria-current="page"]')?.textContent?.trim()).toBe(
      'Vanishing Leaf',
    )

    // 1. Archive Vanishing Leaf on the web and fire onUniworkTreeChanged
    vanished = true
    await act(async () => {
      treeChangedCb?.({ workspaceId: 'ws-1' })
    })
    await flush()

    // Falls back to nearest live parent (Source Hub) and shows role="status" ufFolderGone notice
    expect(host.querySelector('h1.dh-title')?.textContent).toBe('Source Hub')
    expect(host.querySelector('.uwf-crumbs [aria-current="page"]')?.textContent?.trim()).toBe(
      'Source Hub',
    )
    const notice = host.querySelector<HTMLElement>('.uwf-notice[role="status"]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent?.trim()).toBe('Thư mục này không còn ở đây.')
    expect(host.querySelector('.uw-pick-state[role="alert"]')).toBeNull()
    expect(host.textContent).not.toContain('Tài liệu này không còn tồn tại.')
    expect(host.textContent).toContain('Tài liệu trong Source Hub.docx')

    // 2. Navigating to another folder clears the ufFolderGone notice; if that root-level folder's
    // children read answers not_found directly, it falls back to workspace root with ufFolderGone
    const rootCrumb = host.querySelector<HTMLButtonElement>('.uwf-crumbs button.uwf-crumb-btn')!
    await act(async () => {
      rootCrumb.click()
    })
    await flush()
    expect(host.querySelector('.uwf-notice')).toBeNull()

    legalVanished = true
    const legalBtn = host.querySelector<HTMLButtonElement>(
      '.dh-folder-card[data-folder-id="f-legal"] button.dh-folder-open',
    )!
    expect(legalBtn).not.toBeNull()
    await act(async () => {
      legalBtn.click()
    })
    await flush()

    expect(host.querySelector('h1.dh-title')?.textContent).toBe('Tài liệu của workspace')
    expect(host.querySelector('.uwf-crumbs')).toBeNull()
    const rootNotice = host.querySelector<HTMLElement>('.uwf-notice[role="status"]')
    expect(rootNotice).not.toBeNull()
    expect(rootNotice?.textContent?.trim()).toBe('Thư mục này không còn ở đây.')
    expect(host.querySelector('.uw-pick-state[role="alert"]')).toBeNull()
    expect(host.textContent).not.toContain('Tài liệu này không còn tồn tại.')
  })

  it.each([
    ['forbidden', 'Bạn không còn quyền truy cập thư mục này.'],
    ['deleted', 'Thư mục này không còn ở đây.'],
  ] as const)(
    'falls back to the nearest live parent with the right status copy when a children read returns %s (DH1-R3-2, DH1-R3-3)',
    async (errorCode, expectedNotice) => {
      let leafFails = false
      api.uniworkFolderTree.mockImplementation(async () =>
        ok([
          folderTree[0]!,
          {
            id: 'f-hub',
            parentId: null,
            title: 'Source Hub',
            position: 1,
            children: leafFails
              ? []
              : [
                  {
                    id: 'f-leaf',
                    parentId: 'f-hub',
                    title: 'Restricted Leaf',
                    position: 0,
                    children: [],
                  },
                ],
          },
        ]),
      )

      api.uniworkListChildren.mockImplementation(
        async (q: {
          workspaceId: string
          parentId: string | null
        }): Promise<UniworkResult<UniworkFolderChildren>> => {
          if (q.parentId === 'f-hub') {
            return ok({
              items: [
                {
                  id: 'f-leaf',
                  workspaceId: 'ws-1',
                  title: 'Restricted Leaf',
                  format: 'docx',
                  updatedAt: '2026-10-17T08:00:00.000Z',
                  kind: 'folder',
                  parentId: 'f-hub',
                },
              ],
              nextCursor: null,
            })
          }
          if (q.parentId === 'f-leaf') {
            return { ok: false, error: errorCode }
          }
          return ok({
            items: [
              {
                id: 'f-hub',
                workspaceId: 'ws-1',
                title: 'Source Hub',
                format: 'docx',
                updatedAt: '2026-10-17T08:00:00.000Z',
                kind: 'folder',
                parentId: null,
              },
            ],
            nextCursor: null,
          })
        },
      )

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
            }),
          ),
        )
      })
      await flush()

      const hubBtn = host.querySelector<HTMLButtonElement>(
        '.dh-folder-card[data-folder-id="f-hub"] button.dh-folder-open',
      )!
      expect(hubBtn).not.toBeNull()
      await act(async () => {
        hubBtn.click()
      })
      await flush()

      leafFails = true
      const leafBtn = host.querySelector<HTMLButtonElement>(
        '.dh-folder-card[data-folder-id="f-leaf"] button.dh-folder-open',
      )!
      expect(leafBtn).not.toBeNull()
      await act(async () => {
        leafBtn.click()
      })
      await flush()

      expect(host.querySelector('h1.dh-title')?.textContent).toBe('Source Hub')
      expect(host.querySelector('.uwf-crumbs [aria-current="page"]')?.textContent?.trim()).toBe(
        'Source Hub',
      )
      const notice = host.querySelector<HTMLElement>('.uwf-notice[role="status"]')
      expect(notice).not.toBeNull()
      expect(notice?.textContent?.trim()).toBe(expectedNotice)
      expect(host.querySelector('.uw-pick-state[role="alert"]')).toBeNull()
    },
  )

  it('falls back to the workspace root when a folder children read fails while the folder tree failed to load (empty index, DH1-R3-3)', async () => {
    api.uniworkFolderTree.mockResolvedValue({ ok: false, error: 'server_error' })
    api.uniworkListChildren.mockImplementation(
      async (q: {
        workspaceId: string
        parentId: string | null
      }): Promise<UniworkResult<UniworkFolderChildren>> => {
        if (q.parentId === 'f-legal') {
          return { ok: false, error: 'not_found' }
        }
        return ok({ items: rootItems, nextCursor: null })
      },
    )

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
            initialFolderId: 'f-legal',
          }),
        ),
      )
    })
    await flush()

    // Tree failed (empty index) and initialFolderId 'f-legal' returned not_found -> falls back to workspace root
    expect(sidebarSlot.querySelector('.uwf-side-state[role="alert"]')).not.toBeNull()
    expect(host.querySelector('h1.dh-title')?.textContent).toBe('Tài liệu của workspace')
    expect(host.querySelector('.uwf-crumbs')).toBeNull()
    const notice = host.querySelector<HTMLElement>('.uwf-notice[role="status"]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent?.trim()).toBe('Thư mục này không còn ở đây.')
    expect(host.querySelector('.uw-pick-state[role="alert"]')).toBeNull()
    expect(host.textContent).toContain('Báo cáo kết quả kinh doanh Q3-2026.docx')
  })

  it('renders visually hidden screen-reader full ancestor paths (.uw-sr-only with ufPathLabel) alongside aria-hidden short paths on search result rows (DH1-E2E-4)', async () => {
    api.uniworkSearchDocuments.mockResolvedValueOnce(
      ok({
        items: [
          {
            id: 'f-budget-ledger',
            workspaceId: 'ws-1',
            title: 'Budget Ledger Folder',
            format: 'docx',
            updatedAt: '2026-10-17T08:00:00.000Z',
            kind: 'folder',
            parentId: 'f-fy26',
            path: [
              { id: 'f-fin', title: 'Finance' },
              { id: 'f-fy26', title: 'FY2026' },
            ],
          } satisfies DocumentsHomeDoc,
          {
            id: 'doc-budget-deep',
            workspaceId: 'ws-1',
            title: 'budget-deep-branch.docx',
            format: 'docx',
            updatedAt: '2026-10-17T08:00:00.000Z',
            kind: 'file',
            parentId: 'd4',
            path: [
              { id: 'd1', title: 'Division' },
              { id: 'd2', title: 'Region' },
              { id: 'd3', title: 'Country' },
              { id: 'd4', title: 'Branch' },
            ],
          } satisfies DocumentsHomeDoc,
        ],
        nextCursor: null,
      }),
    )

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
          }),
        ),
      )
    })
    await flush()

    const searchInput = host.querySelector<HTMLInputElement>('input.uwf-own-search')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(searchInput, 'budget')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      searchInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    // No All/Folders/Documents kind radiogroup in DocumentsHome
    expect(host.querySelector('[role="radiogroup"]')).toBeNull()

    // Document search row has aria-hidden short path + .uw-sr-only full path + title attribute
    const docRow = host.querySelector<HTMLElement>('.dh-doc-row[data-doc-id="doc-budget-deep"]')!
    expect(docRow).not.toBeNull()
    const docSubpath = docRow.querySelector<HTMLElement>('.dh-doc-subpath')!
    expect(docSubpath).not.toBeNull()
    expect(docSubpath.getAttribute('title')).toBe('UniWork › Division › Region › Country › Branch')
    expect(docSubpath.querySelector('[aria-hidden="true"]')?.textContent).toBe('… › Branch ›')
    expect(docSubpath.querySelector('.uw-sr-only')?.textContent).toBe(
      'Đường dẫn: UniWork › Division › Region › Country › Branch',
    )

    // Folder search card also has aria-hidden short path + .uw-sr-only full path + title attribute
    const folderCard = host.querySelector<HTMLElement>(
      '.dh-folder-card[data-folder-id="f-budget-ledger"]',
    )!
    expect(folderCard).not.toBeNull()
    const folderSubpath = folderCard.querySelector<HTMLElement>('.dh-doc-subpath')!
    expect(folderSubpath).not.toBeNull()
    expect(folderSubpath.getAttribute('title')).toBe('UniWork › Finance › FY2026')
    expect(folderSubpath.querySelector('[aria-hidden="true"]')?.textContent).toBe('… › FY2026 ›')
    expect(folderSubpath.querySelector('.uw-sr-only')?.textContent).toBe(
      'Đường dẫn: UniWork › Finance › FY2026',
    )
  })

  it('opens the uploaded document via onOpenDocument after a successful upload (DH1-E2E-6)', async () => {
    const uploadedSummary: DocumentsHomeDoc = {
      id: 'doc-uploaded-1',
      workspaceId: 'ws-1',
      title: 'uploaded-handbook.docx',
      format: 'docx',
      updatedAt: '2026-10-18T10:00:00.000Z',
      kind: 'file',
      parentId: 'f-mine',
    }
    api.uniworkPickUploadFile = vi.fn(async () => ({
      path: 'C:\\Users\\minh\\Documents\\uploaded-handbook.docx',
      name: 'uploaded-handbook.docx',
    }))
    api.uniworkUploadDocument = vi.fn(async () => ok(uploadedSummary))
    const onOpenDocument = vi.fn()

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument,
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    const uploadBtn = host.querySelector<HTMLButtonElement>('button.dh-btn-upload')!
    expect(uploadBtn).not.toBeNull()
    await act(async () => {
      uploadBtn.click()
    })
    await flush()

    const dialog = host.querySelector<HTMLElement>('.modal[role="dialog"]')!
    expect(dialog).not.toBeNull()
    const pickBtn = dialog.querySelector<HTMLButtonElement>('.uw-act-file button')!
    await act(async () => {
      pickBtn.click()
    })
    await flush()

    const submitBtn = dialog.querySelector<HTMLButtonElement>('.modal-buttons .btn-primary')!
    await act(async () => {
      submitBtn.click()
    })
    await flush()

    expect(api.uniworkUploadDocument).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.modal[role="dialog"]')).toBeNull()
    expect(onOpenDocument).toHaveBeenCalledTimes(1)
    expect(onOpenDocument).toHaveBeenCalledWith(uploadedSummary)
  })
  it('shows the checking state when the active upload reports phase "checking" (BIGUP-A1)', async () => {
    const uploadedSummary: DocumentsHomeDoc = {
      id: 'doc-uploaded-checking',
      workspaceId: 'ws-1',
      title: 'uploaded-handbook.docx',
      format: 'docx',
      updatedAt: '2026-10-18T10:00:00.000Z',
      kind: 'file',
      parentId: 'f-mine',
    }
    api.uniworkPickUploadFile = vi.fn(async () => ({
      path: 'C:\\Users\\minh\\Documents\\uploaded-handbook.docx',
      name: 'uploaded-handbook.docx',
    }))
    // the upload stays in flight while the checking event arrives
    let finishUpload: (res: UniworkResult<DocumentsHomeDoc>) => void = () => undefined
    api.uniworkUploadDocument = vi.fn(() => {
      const { promise, resolve } = Promise.withResolvers<UniworkResult<DocumentsHomeDoc>>()
      finishUpload = resolve
      return promise
    })
    let onProgress:
      | ((event: {
          uploadId: string
          path: string
          loaded: number
          total: number
          phase?: 'uploading' | 'checking'
        }) => void)
      | null = null
    api.onUniworkUploadProgress = vi.fn((cb: typeof onProgress) => {
      onProgress = cb
      return () => {}
    })

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
          }),
        ),
      )
    })
    await flush()

    const uploadBtn = host.querySelector<HTMLButtonElement>('button.dh-btn-upload')!
    await act(async () => {
      uploadBtn.click()
    })
    await flush()
    const dialog = host.querySelector<HTMLElement>('.modal[role="dialog"]')!
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.uw-act-file button')!.click()
    })
    await flush()
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.modal-buttons .btn-primary')!.click()
    })
    await flush()
    expect(api.uniworkUploadDocument).toHaveBeenCalledTimes(1)

    // the renderer minted this id for the in-flight upload (uploadIdRef)
    const uploadArg: unknown = api.uniworkUploadDocument.mock.calls[0]?.[0]
    if (
      !uploadArg ||
      typeof uploadArg !== 'object' ||
      !('uploadId' in uploadArg) ||
      typeof uploadArg.uploadId !== 'string'
    ) {
      throw new Error('upload input missing uploadId')
    }
    const uploadId: string = uploadArg.uploadId
    expect(onProgress).not.toBeNull()

    // an event for another upload is ignored
    await act(async () => {
      onProgress!({
        uploadId: 'uw-up-other',
        path: 'C:\\x\\other.docx',
        loaded: 10,
        total: 10,
        phase: 'checking',
      })
    })
    await flush()
    expect(dialog.textContent).not.toContain('Đang kiểm tra tệp…')

    // the active upload's checking phase reaches the dialog: label + indeterminate bar
    await act(async () => {
      onProgress!({
        uploadId,
        path: 'C:\\Users\\minh\\Documents\\uploaded-handbook.docx',
        loaded: 10,
        total: 10,
        phase: 'checking',
      })
    })
    await flush()
    expect(dialog.textContent).toContain('Đang kiểm tra tệp…')
    const bar = dialog.querySelector<HTMLProgressElement>('progress.uw-act-bar')!
    expect(bar).not.toBeNull()
    expect(bar.hasAttribute('value')).toBe(false)

    await act(async () => {
      finishUpload(ok(uploadedSummary))
    })
    await flush()
  })

  it('does not open or toast when an upload is cancelled or resolves late after cancel (DH1-E2E-6)', async () => {
    const uploadedSummary: DocumentsHomeDoc = {
      id: 'doc-uploaded-late',
      workspaceId: 'ws-1',
      title: 'uploaded-handbook.docx',
      format: 'docx',
      updatedAt: '2026-10-18T10:00:00.000Z',
      kind: 'file',
      parentId: 'f-mine',
    }
    api.uniworkPickUploadFile = vi.fn(async () => ({
      path: 'C:\\Users\\minh\\Documents\\uploaded-handbook.docx',
      name: 'uploaded-handbook.docx',
    }))
    api.uniworkCancelUploadDocument = vi.fn(async () => undefined)
    type UploadTestResult =
      | { ok: true; value: DocumentsHomeDoc }
      | { ok: false; error: 'upload_cancelled' | 'server_error' }
    let finishUpload: (res: UploadTestResult) => void = () => undefined
    api.uniworkUploadDocument = vi.fn(() => {
      const { promise, resolve } = Promise.withResolvers<UploadTestResult>()
      finishUpload = resolve
      return promise
    })
    const onOpenDocument = vi.fn()

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument,
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    const startAndCancelUpload = async () => {
      const uploadBtn = host.querySelector<HTMLButtonElement>('button.dh-btn-upload')!
      await act(async () => {
        uploadBtn.click()
      })
      await flush()

      const dialog = host.querySelector<HTMLElement>('.modal[role="dialog"]')!
      const pickBtn = dialog.querySelector<HTMLButtonElement>('.uw-act-file button')!
      await act(async () => {
        pickBtn.click()
      })
      await flush()

      const submitBtn = dialog.querySelector<HTMLButtonElement>('.modal-buttons .btn-primary')!
      await act(async () => {
        submitBtn.click()
      })
      await flush()

      const cancelBtn = dialog.querySelector<HTMLButtonElement>('.modal-buttons .btn-secondary')!
      await act(async () => {
        cancelBtn.click()
      })
      await flush()
    }

    // 1. Cancel -> upload_cancelled: not opened, no toast
    await startAndCancelUpload()
    expect(api.uniworkCancelUploadDocument).toHaveBeenCalledTimes(1)
    await act(async () => {
      finishUpload({ ok: false, error: 'upload_cancelled' })
    })
    await flush()
    expect(onOpenDocument).not.toHaveBeenCalled()
    expect(host.querySelector('.uw-act-toast')).toBeNull()

    // 2. Late success result after cancel -> neither opens nor toasts
    await startAndCancelUpload()
    expect(api.uniworkCancelUploadDocument).toHaveBeenCalledTimes(2)
    await act(async () => {
      finishUpload(ok(uploadedSummary))
    })
    await flush()
    expect(onOpenDocument).not.toHaveBeenCalled()
    expect(host.querySelector('.uw-act-toast')).toBeNull()

    // 3. Late error result after cancel -> neither opens nor toasts
    await startAndCancelUpload()
    expect(api.uniworkCancelUploadDocument).toHaveBeenCalledTimes(3)
    await act(async () => {
      finishUpload({ ok: false, error: 'server_error' })
    })
    await flush()
    expect(onOpenDocument).not.toHaveBeenCalled()
    expect(host.querySelector('.uw-act-toast')).toBeNull()
  })

  it('refreshes the list but never opens the doc when an upload superseded by cancel still resolves ok (DH1-R4-8)', async () => {
    const uploadedSummary: DocumentsHomeDoc = {
      id: 'doc-uploaded-late-refresh',
      workspaceId: 'ws-1',
      title: 'uploaded-handbook.docx',
      format: 'docx',
      updatedAt: '2026-10-18T10:00:00.000Z',
      kind: 'file',
      parentId: 'f-mine',
    }
    api.uniworkPickUploadFile = vi.fn(async () => ({
      path: 'C:\\Users\\minh\\Documents\\uploaded-handbook.docx',
      name: 'uploaded-handbook.docx',
    }))
    api.uniworkCancelUploadDocument = vi.fn(async () => undefined)
    let finishUpload: (res: UniworkResult<DocumentsHomeDoc>) => void = () => undefined
    api.uniworkUploadDocument = vi.fn(() => {
      const { promise, resolve } = Promise.withResolvers<UniworkResult<DocumentsHomeDoc>>()
      finishUpload = resolve
      return promise
    })
    const onOpenDocument = vi.fn()

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument,
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    const uploadBtn = host.querySelector<HTMLButtonElement>('button.dh-btn-upload')!
    await act(async () => {
      uploadBtn.click()
    })
    await flush()
    const dialog = host.querySelector<HTMLElement>('.modal[role="dialog"]')!
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.uw-act-file button')!.click()
    })
    await flush()
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.modal-buttons .btn-primary')!.click()
    })
    await flush()

    // Cancel while the upload is in flight, then let the server-finished result arrive
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.modal-buttons .btn-secondary')!.click()
    })
    await flush()
    const childrenCallsBefore = api.uniworkListChildren.mock.calls.length
    await act(async () => {
      finishUpload(ok(uploadedSummary))
    })
    await flush()

    // the server already created the doc: the list refreshes so it appears, but nothing opens it
    expect(api.uniworkListChildren.mock.calls.length).toBeGreaterThan(childrenCallsBefore)
    expect(onOpenDocument).not.toHaveBeenCalled()
  })

  it('never fires onOpenDocument for an upload that resolves after DocumentsHome unmounted (DH1-R4-8)', async () => {
    const uploadedSummary: DocumentsHomeDoc = {
      id: 'doc-uploaded-unmounted',
      workspaceId: 'ws-1',
      title: 'uploaded-handbook.docx',
      format: 'docx',
      updatedAt: '2026-10-18T10:00:00.000Z',
      kind: 'file',
      parentId: 'f-mine',
    }
    api.uniworkPickUploadFile = vi.fn(async () => ({
      path: 'C:\\Users\\minh\\Documents\\uploaded-handbook.docx',
      name: 'uploaded-handbook.docx',
    }))
    let finishUpload: (res: UniworkResult<DocumentsHomeDoc>) => void = () => undefined
    api.uniworkUploadDocument = vi.fn(() => {
      const { promise, resolve } = Promise.withResolvers<UniworkResult<DocumentsHomeDoc>>()
      finishUpload = resolve
      return promise
    })
    const onOpenDocument = vi.fn()

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument,
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    const uploadBtn = host.querySelector<HTMLButtonElement>('button.dh-btn-upload')!
    await act(async () => {
      uploadBtn.click()
    })
    await flush()
    const dialog = host.querySelector<HTMLElement>('.modal[role="dialog"]')!
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.uw-act-file button')!.click()
    })
    await flush()
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.modal-buttons .btn-primary')!.click()
    })
    await flush()
    expect(api.uniworkUploadDocument).toHaveBeenCalledTimes(1)

    // DocumentsHome unmounts mid-upload (e.g. the host remounts it on a workspace key change)
    await act(async () => {
      root.unmount()
    })
    await act(async () => {
      finishUpload(ok(uploadedSummary))
    })
    await flush()
    expect(onOpenDocument).not.toHaveBeenCalled()
    // restore the root so afterEach can unmount cleanly
    root = createRoot(host)
  })

  it('cancelling the upload while uniworkEnsureMyFolder is still pending never uploads or opens (DH1-R4-7)', async () => {
    // No my-folder node in the tree -> the upload targets an unresolved folder
    // and must await uniworkEnsureMyFolder before starting.
    api.uniworkFolderTree = vi.fn(async () => ok([]))
    const ensuredNode: UniworkFolderNode = {
      id: 'f-mine',
      parentId: null,
      title: 'My Folder',
      position: 0,
      kind: 'my_folder',
      isSystem: true,
      children: [],
    }
    let finishEnsure: (res: UniworkResult<UniworkFolderNode>) => void = () => undefined
    api.uniworkEnsureMyFolder = vi.fn(() => {
      const { promise, resolve } = Promise.withResolvers<UniworkResult<UniworkFolderNode>>()
      finishEnsure = resolve
      return promise
    })
    api.uniworkPickUploadFile = vi.fn(async () => ({
      path: 'C:\\Users\\minh\\Documents\\uploaded-handbook.docx',
      name: 'uploaded-handbook.docx',
    }))
    api.uniworkCancelUploadDocument = vi.fn(async () => undefined)
    api.uniworkUploadDocument = vi.fn(async () => ok({ id: 'doc-should-not-upload' }))
    const onOpenDocument = vi.fn()

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument,
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    const uploadBtn = host.querySelector<HTMLButtonElement>('button.dh-btn-upload')!
    await act(async () => {
      uploadBtn.click()
    })
    await flush()
    const dialog = host.querySelector<HTMLElement>('.modal[role="dialog"]')!
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.uw-act-file button')!.click()
    })
    await flush()
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.modal-buttons .btn-primary')!.click()
    })
    await flush()
    expect(api.uniworkEnsureMyFolder).toHaveBeenCalledTimes(1)
    expect(api.uniworkUploadDocument).not.toHaveBeenCalled()

    // cancel while the ensure call is still pending, then let it resolve
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.modal-buttons .btn-secondary')!.click()
    })
    await flush()
    await act(async () => {
      finishEnsure(ok(ensuredNode))
    })
    await flush()

    expect(api.uniworkUploadDocument).not.toHaveBeenCalled()
    expect(onOpenDocument).not.toHaveBeenCalled()
  })

  it('renders the My Folder card first when a children page returns [Alpha Folder, My Folder] (DH1-E2E-7)', async () => {
    rootItems = [
      {
        id: 'f-alpha',
        workspaceId: 'ws-1',
        title: 'Alpha Folder',
        format: 'docx',
        updatedAt: '2026-10-15T10:00:00.000Z',
        kind: 'folder',
        parentId: null,
      },
      {
        id: 'f-mine',
        workspaceId: 'ws-1',
        title: 'my-folder-raw',
        format: 'docx',
        updatedAt: '2026-10-14T10:00:00.000Z',
        kind: 'folder',
        parentId: null,
        systemKind: 'my_folder',
      },
    ]

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument: vi.fn(),
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()

    const cards = Array.from(host.querySelectorAll<HTMLElement>('.dh-folder-card'))
    expect(cards.map((c) => c.getAttribute('data-folder-id'))).toEqual(['f-mine', 'f-alpha'])
    expect(cards.map((c) => c.querySelector<HTMLElement>('.dh-folder-name')?.textContent)).toEqual([
      'My Folder',
      'Alpha Folder',
    ])
  })

  const docsHomeCss = () =>
    readFileSync(resolve(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'), 'utf8')
  const saveCss = () =>
    readFileSync(resolve(__dirname, '../src/renderer/src/uniwork-folders/save-dialog.css'), 'utf8')
  /** the {…} body of a rule whose selector contains `sel` */
  const cssBlock = (css: string, sel: string) =>
    css.match(new RegExp(`${sel.replace(/[.>:-]/g, '\\$&')}[^{}]*\\{([^}]*)\\}`))?.[1] ?? ''

  async function mountHome(vi_lang: 'vi' | 'en' = 'vi') {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: vi_lang },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument: vi.fn(),
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()
  }

  it('lays each document row on the table grid without the uw-pick-row flex class (VDH-1)', async () => {
    await mountHome()
    const rows = Array.from(host.querySelectorAll<HTMLElement>('.dh-doc-row'))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.classList.contains('uw-pick-row')).toBe(false)
    }
    // row actions live inside the actions cell, not floating at the row edge
    for (const row of rows) {
      const cell = row.querySelector<HTMLElement>('.dh-cell-actions')
      expect(cell).not.toBeNull()
      if (row.querySelector('.uw-row-menu')) {
        expect(cell!.contains(row.querySelector('.uw-row-menu')!)).toBe(true)
      }
    }
    // the documents-home stylesheet declares the row grid with no flex leak
    const css = docsHomeCss()
    expect(cssBlock(css, '.dh-doc-head,')).toMatch(/display:\s*grid/)
  })

  it('keeps the workspace select outside the title group so the h1 never shrinks to an ellipsis (VDH-2)', async () => {
    await mountHome()
    expect(host.querySelector('.dh-title-group .dh-ws-select')).toBeNull()
    expect(host.querySelector('.dh-title-group > h1.dh-title')).not.toBeNull()
    // the select is still in the toolbar, next to the title group
    expect(host.querySelector('.dh-toolbar .dh-ws-select')).not.toBeNull()
    const css = docsHomeCss()
    expect(cssBlock(css, '.dh-title-group')).toMatch(/flex:\s*none|flex-shrink:\s*0/)
  })

  it('renders folder breadcrumbs as a non-stretching child of the scrolling column (VDH-3)', async () => {
    await mountHome()
    // descend into a folder so the crumbs render
    const card = host.querySelector<HTMLButtonElement>(
      '.dh-folder-card[data-folder-id="f-board"] button.dh-folder-open',
    )!
    await act(async () => {
      card.click()
    })
    await flush()
    const crumbs = host.querySelector<HTMLElement>('nav.uwf-crumbs')
    expect(crumbs).not.toBeNull()
    // one-line nav that must not flex-grow inside .dh-main
    const css = docsHomeCss()
    const blanket = cssBlock(css, '.dh-main > *')
    const scoped = cssBlock(css, '.dh-main > .uwf-crumbs')
    expect(/flex:\s*none/.test(blanket) || /flex:\s*none|flex-grow:\s*0/.test(scoped)).toBe(true)
  })

  it('CSS keeps the scrolling column children unshrinkable and collapses the two lowest-priority columns below 1100px (VDH-4)', () => {
    const css = docsHomeCss()
    // wrapped toolbar/quick-row content must never shrink below content size inside the scrolling column
    expect(cssBlock(css, '.dh-main > *')).toMatch(/flex:\s*none/)
    // narrow width: hide Truy cập + Người sửa, keep Tên/Cập nhật/Thao tác
    const media = css.match(/@media \(max-width: 1100px\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(media).not.toBe('')
    for (const sel of ['.dh-col-access', '.dh-col-person', '.dh-cell-access', '.dh-cell-person']) {
      expect(cssBlock(media, sel), sel).toMatch(/display:\s*none/)
    }
    // grid template re-declared for the three remaining columns
    expect(cssBlock(media, '.dh-doc-row')).toMatch(/grid-template-columns/)
  })

  it('CSS raises flagged sub-4.5 texts to --text-secondary and tints the selected sub-nav item with --accent-text (VDH-5)', () => {
    const css = docsHomeCss()
    for (const sel of [
      '.dh-section-count',
      '.dh-doc-subpath',
      '.dh-level-sub',
      '.dh-cell-empty',
      '.dh-sidebar-label',
    ]) {
      expect(cssBlock(css, sel), sel).toMatch(/color:\s*var\(--text-secondary\)/)
    }
    expect(cssBlock(css, '.dh-nav-item.active')).toMatch(/color:\s*var\(--accent-text\)/)
    expect(cssBlock(css, '.dh-nav-item.active .dh-nav-icon')).toMatch(
      /color:\s*var\(--accent-text\)/,
    )
  })

  it('CSS gives the filter selects and the error Retry button a visible focus ring (VDH-6)', () => {
    const css = docsHomeCss()
    expect(cssBlock(css, '.dh-filter-select:focus-visible')).toMatch(/outline:\s*2px solid/)
    expect(cssBlock(css, '.dh-main .uw-pick-state .btn:focus-visible')).toMatch(
      /outline:\s*2px solid/,
    )
  })

  it('SaveDialog State 1 uses the accent primary at radius 8 like State 2, a 16px chevron, and the folder-plus glyph on "Thư mục mới" (VDH-8 / VS01-1)', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(SaveDialog, {
            path: 'C:\\Users\\me\\Documents\\Báo cáo Q4.docx',
            onClose: vi.fn(),
          }),
        ),
      )
    })
    await flush()

    // chevron on the location row is 16px
    const chev = document.querySelector('svg.uws-loc-chev')!
    expect(chev.getAttribute('width')).toBe('16')
    expect(chev.getAttribute('height')).toBe('16')

    // the .uws-save rule must carry enough specificity to beat the later .btn-primary in home.css
    const css = saveCss()
    const scopedRule = css.match(/\.modal\.uw-act \.uws-save[^{}]*\{([^}]*)\}/)
    expect(scopedRule).not.toBeNull()
    expect(scopedRule![1]).toMatch(/border-radius:\s*8px/)
    expect(scopedRule![1]).toMatch(/background:\s*var\(--color-dialog-primary\)/)

    // State 2: "Thư mục mới" carries the folder-plus svg
    const locBtn = document.querySelector<HTMLButtonElement>('.uws-loc')!
    await act(async () => {
      locBtn.click()
    })
    await flush()
    expect(document.querySelector('.uwf-picker-new svg')).not.toBeNull()
  })

  it('renders each document row "…" button in static flow inside its Thao tác cell, one per row, and opens the menu from a real click on that button while leaving Open-dialog rows untouched (VDH-11)', async () => {
    const tokensCss = readFileSync(
      resolve(__dirname, '../../../packages/ui/src/tokens.css'),
      'utf8',
    )
    const homeCss = readFileSync(resolve(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const uwfCss = readFileSync(
      resolve(__dirname, '../src/renderer/src/uniwork-folders/uniwork-folders.css'),
      'utf8',
    )
    const dhCss = docsHomeCss()

    const style = document.createElement('style')
    const cleanedHomeCss = homeCss
      .replace(/@keyframes\s+[\w-]+\s*\{(?:\{[^{}]*\}|[^{}])*\}/g, '')
      .replace(/@position-try\s+[\w-]+\s*\{[^{}]*\}/g, '')
    style.textContent = `${tokensCss}\n${cleanedHomeCss}\n${uwfCss}\n${dhCss}`
    document.head.appendChild(style)

    try {
      await mountHome()

      const rows = Array.from(host.querySelectorAll<HTMLElement>('.dh-doc-row'))
      expect(rows).toHaveLength(3)

      for (const row of rows) {
        const docId = row.getAttribute('data-doc-id')!
        const cell = row.querySelector<HTMLElement>('.dh-cell-actions')
        expect(cell).not.toBeNull()

        const rowBtns = row.querySelectorAll<HTMLButtonElement>('.uw-row-menu-btn')
        const cellBtns = cell!.querySelectorAll<HTMLButtonElement>('.uw-row-menu-btn')
        expect(rowBtns).toHaveLength(1)
        expect(cellBtns).toHaveLength(1)

        const btn = cellBtns[0]!
        expect(btn.getAttribute('data-folder-menu-for')).toBe(docId)
        const wrap = btn.closest<HTMLElement>('.uw-row-menu')!
        expect(cell!.contains(wrap)).toBe(true)

        expect(window.getComputedStyle(wrap).position).toBe('static')
        expect(window.getComputedStyle(btn).position).toBe('static')
        expect(window.getComputedStyle(btn).transform).toBe('none')
      }

      // Folder card "…" button is also static inside .dh-folder-actions
      const folderCardBtns = Array.from(
        host.querySelectorAll<HTMLButtonElement>(
          '.dh-folder-card .dh-folder-actions .uw-row-menu-btn',
        ),
      )
      expect(folderCardBtns).toHaveLength(2)
      for (const btn of folderCardBtns) {
        const wrap = btn.closest<HTMLElement>('.uw-row-menu')!
        expect(window.getComputedStyle(wrap).position).toBe('static')
        expect(window.getComputedStyle(btn).position).toBe('static')
        expect(window.getComputedStyle(btn).transform).toBe('none')
      }

      // Real click on the first row's button opens its menu anchored to that button;
      // clicking the second row's button moves the open menu to the second row
      const firstBtn = rows[0]!.querySelector<HTMLButtonElement>(
        '.dh-cell-actions .uw-row-menu-btn',
      )!
      const secondBtn = rows[1]!.querySelector<HTMLButtonElement>(
        '.dh-cell-actions .uw-row-menu-btn',
      )!
      expect(firstBtn.getAttribute('aria-expanded')).toBe('false')
      expect(document.querySelector('.uw-row-menu-list[role="menu"]')).toBeNull()

      await act(async () => {
        firstBtn.click()
      })
      await flush()
      expect(firstBtn.getAttribute('aria-expanded')).toBe('true')
      const menu1 = document.querySelector<HTMLElement>('.uw-row-menu-list[role="menu"]')
      expect(menu1).not.toBeNull()
      expect(menu1!.getAttribute('id')).toBe(firstBtn.getAttribute('aria-controls'))

      await act(async () => {
        secondBtn.click()
      })
      await flush()
      expect(firstBtn.getAttribute('aria-expanded')).toBe('false')
      expect(secondBtn.getAttribute('aria-expanded')).toBe('true')
      const menu2 = document.querySelector<HTMLElement>('.uw-row-menu-list[role="menu"]')
      expect(menu2).not.toBeNull()
      expect(menu2!.getAttribute('id')).toBe(secondBtn.getAttribute('aria-controls'))

      // Open dialog / browser rows (.uwf-contents .uw-pick-item) keep their absolute positioning
      const pickProbe = document.createElement('div')
      pickProbe.innerHTML =
        '<ul class="uw-pick-list uwf-contents"><li class="uw-pick-item"><span class="uw-row-menu uwf-menu"><button type="button" class="uw-pick-info-btn uw-row-menu-btn"></button></span></li></ul>'
      document.body.appendChild(pickProbe)
      try {
        const pickWrap = pickProbe.querySelector<HTMLElement>('.uw-row-menu.uwf-menu')!
        const pickBtn = pickProbe.querySelector<HTMLElement>('.uw-row-menu-btn')!
        expect(window.getComputedStyle(pickWrap).position).toBe('absolute')
        expect(window.getComputedStyle(pickBtn).position).toBe('absolute')
      } finally {
        pickProbe.remove()
      }
    } finally {
      style.remove()
    }
  })

  it('keeps "Tạo mới" on the first toolbar line at 1280px while preserving the 900px wrap (VDH-12)', () => {
    const css = docsHomeCss()
    // .dh-toolbar-spacer must not take minimum flex width or force wrapping;
    // .dh-search-box and .dh-toolbar-btn fit on one line at 1280px alongside the title and workspace select,
    // while .dh-toolbar keeps flex-wrap: wrap so narrow viewports (900px) still wrap cleanly
    expect(cssBlock(css, '.dh-toolbar')).toMatch(/flex-wrap:\s*wrap/)
    // both one-line guards must hold on their own — an OR regex would let either slip (DH1-R4-5)
    expect(cssBlock(css, '.dh-toolbar-btn')).toMatch(/flex-shrink:\s*0/)
    expect(cssBlock(css, '.dh-toolbar-btn')).toMatch(/white-space:\s*nowrap/)
    const wideMedia =
      css.match(/@media\s*\(\s*min-width:\s*1101px\s*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(
      /flex-wrap:\s*nowrap/.test(cssBlock(wideMedia, '.dh-toolbar')) ||
        /width:\s*2[0-6]\dpx/.test(cssBlock(css, '.dh-search-box')),
    ).toBe(true)
  })
})
