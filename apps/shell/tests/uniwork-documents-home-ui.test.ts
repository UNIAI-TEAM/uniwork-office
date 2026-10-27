/**
 * @vitest-environment jsdom
 */
import { Fragment, act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  UniworkDocShareScope,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkResult,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import { DriveList } from '../src/renderer/src/uniwork-home/DriveList'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import {
  openDocumentShare,
  resetDocumentsIntentBusForTests,
} from '../src/renderer/src/documents-intent-bus'
import { createFakeShareApi } from '../src/renderer/src/uniwork-share/fake-share-api'
import { onUniworkNotice } from '../src/renderer/src/uniwork-notice-bus'
import { SaveDialog } from '../src/renderer/src/uniwork-folders/SaveDialog'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'
import { pickType } from './doclist-type-filter-fixture'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

/** the server's `share_scope` with every axis empty (the web's "Riêng tư") */
const NO_SHARES: UniworkDocShareScope = {
  homeWorkspace: false,
  users: 0,
  workspaces: 0,
  organization: false,
  publicLink: false,
}

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
        shareScope: NO_SHARES,
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
        shareScope: { ...NO_SHARES, homeWorkspace: true },
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
              shareScope: { ...NO_SHARES, users: 2 },
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
              shareScope: { ...NO_SHARES, users: 3 },
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

  it('renders the board sub-nav in sidebarHost (omitting Gắn sao; UNI-1961: Lưu trữ shown), toolbar controls, Tạo nhanh pills + My Folder link, 3-col folder grid, and 5-column Tài liệu table with zero Đồng bộ / Kích thước columns', async () => {
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

    // 1. Sidebar sub-nav order & omitted unavailable entries (UNI-2047 B6: Gắn sao is listed)
    const navButtons = Array.from(
      sidebarSlot.querySelectorAll<HTMLButtonElement>('.home-area-nav .nav-item'),
    )
    expect(navButtons.map((b) => b.getAttribute('data-nav'))).toEqual([
      'workspace',
      'recent',
      'starred',
      'shared-with-me',
      'shared-by-me',
      'archive',
      'trash',
    ])
    // UNI-2047 sidebar: Từ nơi khác is a section of source rows below the folders, not a nav item
    expect(navButtons.map((b) => b.textContent?.trim())).toEqual([
      'Tài liệu của workspace',
      'Gần đây',
      'Gắn sao',
      'Được chia sẻ với tôi',
      'Tôi đã chia sẻ',
      'Lưu trữ',
      'Thùng rác',
    ])

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

    // 5. the shared Tài liệu table (UNI-2047): Chọn | Tên | Truy cập | Người sửa gần nhất | Cập nhật | Dung lượng | Thao tác
    const colHeaders = Array.from(
      host.querySelectorAll('.dh-doc-head > [role="columnheader"]'),
    ).map((el) => el.textContent?.trim())
    expect(colHeaders.slice(1, 5)).toEqual(['Tên', 'Truy cập', 'Người sửa gần nhất', 'Cập nhật'])
    expect(host.querySelector('.dh-doc-head .dh-col-actions')?.getAttribute('aria-label')).toBe(
      'Thao tác',
    )
    expect(host.textContent).not.toContain('Đồng bộ')
    expect(host.textContent).not.toContain('Kích thước')

    // Access badges and unknown ("—") fallback
    const visBadges = Array.from(host.querySelectorAll('.dh-vis-badge')).map((el) =>
      el.textContent?.trim(),
    )
    // a row with neither visibility nor share scope is never guessed shared: it reads Riêng tư
    expect(visBadges).toEqual(['Riêng tư', 'Workspace', 'Riêng tư'])
    const levelSubs = Array.from(host.querySelectorAll('.dh-level-sub')).map((el) =>
      el.textContent?.trim(),
    )
    expect(levelSubs).toEqual(['Bạn: Quản lý', 'Bạn: Sửa'])

    const rows = Array.from(host.querySelectorAll('.dh-doc-row'))
    expect(rows).toHaveLength(3)
    // Third document has neither visibility/myLevel nor updatedByName -> no level line, "—" for the editor
    expect(rows[2]?.querySelector('.dh-level-sub')).toBeNull()
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
    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Thư mục của tôi')
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
      expect.objectContaining({ workspaceId: 'ws-1', includePages: true }),
    )
    expect(host.textContent).toContain('Báo cáo kết quả kinh doanh Q3-2026.docx')
    expect(host.textContent).toContain('Kế hoạch ngân sách 2027.xlsx')

    // Filter by type = .xlsx -> forwards types: ['xlsx'] to uniworkListDocuments
    const filterSelects = host.querySelectorAll<HTMLSelectElement>('.dh-filter-select')
    expect(filterSelects).toHaveLength(2)
    await pickType(host, 'xlsx')
    expect(api.uniworkListDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', types: ['xlsx'] }),
    )

    // Filter by Người sửa = u-minh -> forwards updatedBy: 'u-minh'
    await act(async () => {
      filterSelects[0]!.value = 'u-minh'
      filterSelects[0]!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkListDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', types: ['xlsx'], updatedBy: 'u-minh' }),
    )

    // Filter by Cập nhật = 7d -> forwards updatedFrom ISO timestamp
    await act(async () => {
      filterSelects[1]!.value = '7d'
      filterSelects[1]!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkListDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        types: ['xlsx'],
        updatedBy: 'u-minh',
        updatedFrom: expect.any(String),
      }),
    )

    // Shared with me -> org-wide: its own, clean filter bar (filters are per screen), sends no workspaceId and no filters, and shows workspaceName in .dh-doc-subpath
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
            shareScope: { ...NO_SHARES, users: 2 },
            myLevel: 'edit',
            updatedById: 'u-hai',
            updatedByName: 'Hải Lê',
          } satisfies DocumentsHomeDoc,
        ],
        nextCursor: 'swm-cur-2',
      }),
    )
    await clickNav('shared-with-me')
    expect(api.uniworkListSharedWithMe).toHaveBeenLastCalledWith({ includePages: true })
    expect(host.querySelectorAll('.dh-filter-select')).toHaveLength(2)
    expect(host.querySelector('.dh-filter-clear')).toBeNull()
    expect(host.textContent).toContain('Đề xuất đối tác.docx')
    expect(host.querySelector('.dh-cell-name .dh-doc-subpath')?.textContent?.trim()).toBe(
      'Phòng Tài chính',
    )
    expect(host.querySelector('.dh-vis-badge')?.textContent?.trim()).toBe('Được chia sẻ')
    expect(host.querySelector('.dh-level-sub')?.textContent?.trim()).toBe('Bạn: Sửa')

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
    expect(api.uniworkListSharedWithMe).toHaveBeenLastCalledWith({
      cursor: 'swm-cur-2',
      includePages: true,
    })
    expect(host.textContent).toContain('Biên bản họp.docx')

    // Shared by me -> uniworkListSharedByMe (its own filter bar: the Recent filters stay on Recent)
    await clickNav('shared-by-me')
    expect(host.querySelectorAll('.dh-filter-select')).toHaveLength(2)
    expect(api.uniworkListSharedByMe).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
    )
    expect(api.uniworkListSharedByMe.mock.calls.at(-1)![0]).not.toHaveProperty('types')
    expect(api.uniworkListSharedByMe.mock.calls.at(-1)![0]).not.toHaveProperty('updatedBy')
    expect(host.textContent).toContain('Bản thảo hợp đồng.docx')
    expect(host.querySelector('.dh-vis-badge')?.textContent?.trim()).toBe('Được chia sẻ')
    expect(host.querySelector('.dh-level-sub')?.textContent?.trim()).toBe('Bạn: Bình luận')

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

    // Row with canManage: false has no Khôi phục: its menu is Xem chi tiết only (A4)
    const readerKebab = noManageRow!.querySelector<HTMLButtonElement>('.uw-row-menu-btn')
    expect(readerKebab).not.toBeNull()
    await act(async () => {
      readerKebab!.click()
    })
    await flush()
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>('.uw-row-menu-list [role="menuitem"]'),
      ).map((el) => el.textContent?.trim()),
    ).toEqual(['Xem chi tiết'])
    await act(async () => {
      document.body.click()
    })
    await flush()

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

  it('does not include t in any hook dependency array in DocumentsHome.tsx, DriveList.tsx or DrivePanel.tsx (DH1-R1-8, UNI-2195, UNI-2196)', async () => {
    // Lazy-loaded AST parser only for this static-analysis test
    const ts = await import('typescript')
    const hooks: Record<string, true> = {
      useMemo: true,
      useCallback: true,
      useEffect: true,
      useLayoutEffect: true,
    }
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

    for (const rel of [
      '../src/renderer/src/uniwork-home/DocumentsHome.tsx',
      '../src/renderer/src/uniwork-home/DriveList.tsx',
      '../src/renderer/src/uniwork-home/DrivePanel.tsx',
    ]) {
      const file = resolve(__dirname, rel)
      const src = readFileSync(file, 'utf8')
      const sourceFile = ts.createSourceFile(
        file,
        src,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      )
      const walk = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const name = hookNameOf(node)
          if (name && hooks[name] && node.arguments.length >= 2) {
            const deps = node.arguments[1]!
            if (identifierTIn(deps)) {
              const { line } = sourceFile.getLineAndCharacterOfPosition(deps.getStart(sourceFile))
              hits.push(`${rel}:${name}:${line + 1}`)
            }
          }
        }
        ts.forEachChild(node, walk)
      }
      walk(sourceFile)
    }
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
    const doclistSideCss = readFileSync(
      resolve(__dirname, '../src/renderer/src/uniwork-home/doclist-sidebar.css'),
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
      ['doclist-sidebar.css', doclistSideCss],
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

    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Vanishing Leaf')
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
    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Source Hub')
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

    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Tài liệu của workspace')
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

      expect(host.querySelector('.dh-main h1')?.textContent).toBe('Source Hub')
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
    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Tài liệu của workspace')
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
    expect(docSubpath.getAttribute('title')).toBe(
      'Tài liệu (gốc) › Division › Region › Country › Branch',
    )
    expect(docSubpath.querySelector('[aria-hidden="true"]')?.textContent).toBe('… › Branch ›')
    expect(docSubpath.querySelector('.uw-sr-only')?.textContent).toBe(
      'Đường dẫn: Tài liệu (gốc) › Division › Region › Country › Branch',
    )

    // Folder search card also has aria-hidden short path + .uw-sr-only full path + title attribute
    const folderCard = host.querySelector<HTMLElement>(
      '.dh-folder-card[data-folder-id="f-budget-ledger"]',
    )!
    expect(folderCard).not.toBeNull()
    const folderSubpath = folderCard.querySelector<HTMLElement>('.dh-doc-subpath')!
    expect(folderSubpath).not.toBeNull()
    expect(folderSubpath.getAttribute('title')).toBe('Tài liệu (gốc) › Finance › FY2026')
    expect(folderSubpath.querySelector('[aria-hidden="true"]')?.textContent).toBe('… › FY2026 ›')
    expect(folderSubpath.querySelector('.uw-sr-only')?.textContent).toBe(
      'Đường dẫn: Tài liệu (gốc) › Finance › FY2026',
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

  const restrictedDoc = (): DocumentsHomeDoc => ({
    id: 'doc-restricted',
    workspaceId: 'ws-1',
    title: 'Hợp đồng riêng.docx',
    format: 'docx',
    updatedAt: '2026-10-17T08:00:00.000Z',
    kind: 'file',
    parentId: null,
    visibility: 'restricted',
    shareScope: { ...NO_SHARES, users: 2 },
    myLevel: 'edit',
    canManage: true,
  })

  // UNI-1958 row 1 (CS1-1) -> UNI-2047: the Access cell is one of the shared rules' three pills
  // (Riêng tư / Workspace / Được chia sẻ), never guessed from a missing `share_scope`.
  const scopedDoc = (
    id: string,
    shareScope: UniworkDocShareScope | undefined,
    extra: Partial<DocumentsHomeDoc> = {},
  ): DocumentsHomeDoc => ({
    id,
    workspaceId: 'ws-1',
    title: `${id}.docx`,
    format: 'docx',
    updatedAt: '2026-10-17T08:00:00.000Z',
    kind: 'file',
    parentId: null,
    visibility: 'restricted',
    ...(shareScope ? { shareScope } : {}),
    myLevel: 'edit',
    ...extra,
  })
  const badgeOf = (id: string) =>
    host.querySelector(`.dh-doc-row[data-doc-id="${id}"] .dh-vis-badge`)?.textContent?.trim()
  const SCOPE_CASES: [string, UniworkDocShareScope, Partial<DocumentsHomeDoc>][] = [
    ['users-1', { ...NO_SHARES, users: 1 }, {}],
    ['users-2', { ...NO_SHARES, users: 2 }, {}],
    ['home', { ...NO_SHARES, homeWorkspace: true }, { visibility: 'workspace' }],
    ['workspaces-1', { ...NO_SHARES, workspaces: 1 }, {}],
    ['workspaces-3', { ...NO_SHARES, workspaces: 3 }, {}],
    ['org', { ...NO_SHARES, organization: true }, {}],
    ['link', { ...NO_SHARES, publicLink: true }, {}],
    ['none', NO_SHARES, {}],
    ['two-axes', { ...NO_SHARES, users: 2, organization: true }, {}],
    ['home-users', { ...NO_SHARES, homeWorkspace: true, users: 1 }, { visibility: 'workspace' }],
    ['users-link', { ...NO_SHARES, users: 2, publicLink: true }, {}],
  ]

  it('UNI-2047: each share_scope shape reads as one of the three Access pills (vi)', async () => {
    rootItems = SCOPE_CASES.map(([id, scope, extra]) => scopedDoc(id, scope, extra))
    await mountHome('vi')
    expect(Object.fromEntries(SCOPE_CASES.map(([id]) => [id, badgeOf(id)]))).toEqual({
      'users-1': 'Được chia sẻ',
      'users-2': 'Được chia sẻ',
      home: 'Workspace',
      'workspaces-1': 'Được chia sẻ',
      'workspaces-3': 'Được chia sẻ',
      org: 'Được chia sẻ',
      // a live public link alone counts as shared (Advisor 2026-10-21)
      link: 'Được chia sẻ',
      none: 'Riêng tư',
      'two-axes': 'Được chia sẻ',
      'home-users': 'Workspace',
      'users-link': 'Được chia sẻ',
    })
  })

  it('UNI-2047: each share_scope shape reads as one of the three Access pills (en)', async () => {
    rootItems = SCOPE_CASES.map(([id, scope, extra]) => scopedDoc(id, scope, extra))
    await mountHome('en')
    expect(Object.fromEntries(SCOPE_CASES.map(([id]) => [id, badgeOf(id)]))).toEqual({
      'users-1': 'Shared',
      'users-2': 'Shared',
      home: 'Workspace',
      'workspaces-1': 'Shared',
      'workspaces-3': 'Shared',
      org: 'Shared',
      link: 'Shared',
      none: 'Private',
      'two-axes': 'Shared',
      'home-users': 'Workspace',
      'users-link': 'Shared',
    })
  })

  it('UNI-2047: a row without share_scope reads Riêng tư (never guessed shared) and keeps the level (vi)', async () => {
    rootItems = [scopedDoc('no-scope', undefined)]
    await mountHome('vi')
    const cell = host.querySelector('.dh-doc-row[data-doc-id="no-scope"] .dh-cell-access')!
    expect(cell.querySelector('.dh-vis-badge')?.textContent?.trim()).toBe('Riêng tư')
    expect(cell.querySelector('.dh-level-sub')?.textContent?.trim()).toBe('Bạn: Sửa')
  })

  it('UNI-2047: a restricted document shared with two people reads "Được chia sẻ" (vi) / "Shared" (en)', async () => {
    rootItems = [restrictedDoc()]
    await mountHome('vi')
    expect(badgeOf('doc-restricted')).toBe('Được chia sẻ')
    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    await mountHome('en')
    expect(badgeOf('doc-restricted')).toBe('Shared')
  })

  it('UNI-1958 row 5: the doc-row archive action is the web "Chuyển vào thùng rác" (menu, confirm, announce)', async () => {
    rootItems = [restrictedDoc()]
    api.uniworkArchiveDocument = vi.fn(async () => ok({}))
    resetLiveForTests()
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(
            Fragment,
            null,
            createElement(UniworkLiveHost),
            createElement(DocumentsHome, {
              workspaceId: 'ws-1',
              workspaces,
              onWorkspaceChange: vi.fn(),
              onOpenDocument: vi.fn(),
              sidebarHost: sidebarSlot,
            }),
          ),
        ),
      )
    })
    await flush()
    const kebab = host.querySelector<HTMLButtonElement>(
      '.dh-doc-row[data-doc-id="doc-restricted"] .uw-row-menu-btn',
    )!
    await act(async () => {
      kebab.click()
    })
    await flush()
    const items = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.uw-row-menu-list [role="menuitem"]'),
    ).map((el) => el.textContent?.trim())
    expect(items).toContain('Chuyển vào thùng rác')
    // UNI-1961: a managed row also offers the web's Lưu trữ (shelve), a different command
    expect(items.filter((label) => label === 'Lưu trữ')).toHaveLength(1)
    const item = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.uw-row-menu-list [role="menuitem"]'),
    ).find((el) => el.textContent?.trim() === 'Chuyển vào thùng rác')!
    await act(async () => {
      item.click()
    })
    await flush()
    const dialog = document.querySelector<HTMLElement>('.modal.uw-act')!
    expect(dialog.textContent).toContain('Chuyển vào thùng rác · Hợp đồng riêng.docx')
    expect(dialog.textContent).toContain(
      '“Hợp đồng riêng.docx” và toàn bộ cây con sẽ được chuyển vào thùng rác trong 30 ngày trước khi bị xóa vĩnh viễn.',
    )
    expect(dialog.textContent).not.toContain('Lưu trữ')
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.btn-primary')!.click()
    })
    await flush()
    expect(api.uniworkArchiveDocument).toHaveBeenCalledWith('doc-restricted')
    expect(document.querySelector('[data-uw-live] [role="status"]')?.textContent).toBe(
      'Đã chuyển vào thùng rác',
    )
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

  it('CSS keeps the scrolling column children unshrinkable; the columns hide by the table width, not a media query (VDH-4 -> UNI-2047)', () => {
    const css = docsHomeCss()
    // wrapped toolbar/quick-row content must never shrink below content size inside the scrolling column
    expect(cssBlock(css, '.dh-main > *')).toMatch(/flex:\s*none/)
    // the columns come from DocList (container width, inline grid tracks): no viewport rule hides them
    expect(css).not.toMatch(/@media \(max-width: 1100px\) \{\s*\.dh-doc-table/)
    expect(css).not.toMatch(/grid-mode/)
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

  async function clickNavItem(id: string) {
    const btn = sidebarSlot.querySelector<HTMLButtonElement>(`.nav-item[data-nav="${id}"]`)
    expect(btn).not.toBeNull()
    await act(async () => {
      btn!.click()
    })
    await flush()
  }

  /** opens the row "..." menu of `docId` and presses the Move item, then reads the picker's path line */
  async function openMovePickerFor(docId: string): Promise<string> {
    const trigger = host.querySelector<HTMLButtonElement>(`[data-folder-menu-for="${docId}"]`)
    expect(trigger).not.toBeNull()
    await act(async () => {
      trigger!.click()
    })
    await flush()
    const move = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.uw-row-menu-list [role="menuitem"]'),
    ).find((el) => ['Di chuyển', 'Di chuyển tới…'].includes(el.textContent?.trim() ?? ''))
    expect(move).toBeDefined()
    await act(async () => {
      move!.click()
    })
    await flush()
    return document.querySelector('.uwf-picker-path')?.textContent ?? ''
  }

  it('never renders the Access cell or a scope badge for a folder, even when the server row still carries a scope (UNI-1975 FS1-2)', async () => {
    // a folder row that still carries a scope from the server, next to a file row that carries one too
    rootItems = rootItems.map((item) =>
      item.kind === 'folder'
        ? { ...item, visibility: 'workspace' as const, myLevel: 'manage' as const }
        : item,
    )
    await mountHome()

    const cards = Array.from(host.querySelectorAll<HTMLElement>('.dh-folder-card'))
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card.querySelector('.dh-cell-access, .dh-vis-badge, .dh-level-sub')).toBeNull()
      expect(card.textContent).not.toContain('Workspace')
      expect(card.textContent).not.toContain('Bạn: Quản lý')
    }
    // the folder rows are only cards: no table row is a folder row
    const rowIds = Array.from(host.querySelectorAll('.dh-doc-row')).map((r) =>
      r.getAttribute('data-doc-id'),
    )
    expect(rowIds).not.toContain('f-board')
    expect(rowIds).not.toContain('f-legal')

    // the file rows still show their access
    const fileRow = host.querySelector<HTMLElement>('.dh-doc-row[data-doc-id="doc-2"]')
    expect(fileRow!.querySelector('.dh-cell-access .dh-vis-badge')?.textContent?.trim()).toBe(
      'Workspace',
    )
    expect(fileRow!.querySelector('.dh-level-sub')?.textContent?.trim()).toBe('Bạn: Sửa')
  })

  it('keeps a recipient row without parentId at the open folder: Move starts at the open folder in the workspace subView, at the root otherwise (UNI-1975 FS1-3)', async () => {
    const orphan = {
      id: 'doc-orphan',
      workspaceId: 'ws-1',
      title: 'Không rõ thư mục cha.docx',
      format: 'docx',
      updatedAt: '2026-10-18T08:00:00.000Z',
      kind: 'file',
      visibility: 'workspace',
      myLevel: 'edit',
    } satisfies DocumentsHomeDoc
    const orphanFolder = {
      id: 'f-orphan',
      workspaceId: 'ws-1',
      title: 'Thư mục không cha',
      format: 'docx',
      updatedAt: '2026-10-18T07:00:00.000Z',
      kind: 'folder',
      canEdit: true,
    } satisfies DocumentsHomeDoc
    folderTree = [
      ...folderTree,
      { id: 'f-orphan', parentId: null, title: 'Thư mục không cha', position: 3, children: [] },
    ]
    rootItems = [...rootItems, orphan, orphanFolder]
    api.uniworkListChildren!.mockImplementation(async (q: { parentId: string | null }) => {
      if (q.parentId === 'f-board') return ok({ items: [orphan], nextCursor: null })
      return ok({ items: rootItems, nextCursor: null })
    })
    api.uniworkListSharedWithMe!.mockImplementation(async () =>
      ok({ documents: [orphan], nextCursor: null }),
    )
    await mountHome()

    // root: no parentId -> picker opens at the (null) open folder, i.e. the root
    expect(await openMovePickerFor('doc-orphan')).toBe('Đường dẫn: Tài liệu (gốc)')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.uwf-picker .btn-secondary')!.click()
    })
    await flush()

    // folder card without parentId -> falls back to the open folder (root) too
    expect(await openMovePickerFor('f-orphan')).toBe('Đường dẫn: Tài liệu (gốc)')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.uwf-picker .btn-secondary')!.click()
    })
    await flush()

    // Shared with me (entered from the root): the row lists, and Move does not crash or invent a parent
    await clickNavItem('shared-with-me')
    expect(host.querySelector('.dh-doc-row[data-doc-id="doc-orphan"]')).not.toBeNull()
    expect(await openMovePickerFor('doc-orphan')).toBe('Đường dẫn: Tài liệu (gốc)')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.uwf-picker .btn-secondary')!.click()
    })
    await flush()
    await clickNavItem('workspace')

    // inside a folder: the orphan lists there and Move starts at that folder, not an invented parent
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '.dh-folder-card[data-folder-id="f-board"] .dh-folder-open',
        )!
        .click()
    })
    await flush()
    expect(host.querySelector('.dh-doc-row[data-doc-id="doc-orphan"]')).not.toBeNull()
    expect(await openMovePickerFor('doc-orphan')).toBe(
      'Đường dẫn: Tài liệu (gốc) › Báo cáo HĐQT Q4',
    )
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.uwf-picker .btn-secondary')!.click()
    })
    await flush()
  })

  it("Shared with me: Move never starts at the folder browsed before it, nor at the owner's folder (UNI-1961 FS2-1)", async () => {
    const shared = {
      id: 'doc-shared',
      workspaceId: 'ws-1',
      title: 'Được chia sẻ.docx',
      format: 'docx',
      updatedAt: '2026-10-18T08:00:00.000Z',
      kind: 'file',
      visibility: 'restricted',
      myLevel: 'edit',
    } satisfies DocumentsHomeDoc
    // the same row once with no parent, once carrying the owner's folder id (not the recipient's place)
    const sharedUnder = { ...shared, id: 'doc-shared-under', parentId: 'f-legal' }
    api.uniworkListChildren!.mockImplementation(async (q: { parentId: string | null }) =>
      ok({ items: q.parentId === 'f-board' ? [] : rootItems, nextCursor: null }),
    )
    api.uniworkListSharedWithMe!.mockImplementation(async () =>
      ok({ documents: [shared, sharedUnder], nextCursor: null }),
    )
    await mountHome()

    // browse a folder first, then switch to Shared with me: the open folder id stays in state
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '.dh-folder-card[data-folder-id="f-board"] .dh-folder-open',
        )!
        .click()
    })
    await flush()
    await clickNavItem('shared-with-me')
    expect(host.querySelector('.dh-doc-row[data-doc-id="doc-shared"]')).not.toBeNull()

    expect(await openMovePickerFor('doc-shared')).toBe('Đường dẫn: Tài liệu (gốc)')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.uwf-picker .btn-secondary')!.click()
    })
    await flush()
    expect(await openMovePickerFor('doc-shared-under')).toBe('Đường dẫn: Tài liệu (gốc)')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.uwf-picker .btn-secondary')!.click()
    })
    await flush()
  })

  it('Recent and Shared by me: Move never starts at the folder browsed before them (UNI-1961 FS2-1)', async () => {
    const orphan = {
      id: 'doc-flat',
      workspaceId: 'ws-1',
      title: 'Không thư mục cha.docx',
      format: 'docx',
      updatedAt: '2026-10-18T08:00:00.000Z',
      kind: 'file',
      visibility: 'restricted',
      myLevel: 'manage',
      canManage: true,
    } satisfies DocumentsHomeDoc
    api.uniworkListChildren!.mockImplementation(async (q: { parentId: string | null }) =>
      ok({ items: q.parentId === 'f-board' ? [] : rootItems, nextCursor: null }),
    )
    api.uniworkListDocuments!.mockImplementation(async () =>
      ok({ documents: [orphan], nextCursor: null }),
    )
    api.uniworkListSharedByMe!.mockImplementation(async () =>
      ok({ documents: [orphan], nextCursor: null }),
    )
    await mountHome()

    // browse a folder first: its id stays in state while the other views show
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '.dh-folder-card[data-folder-id="f-board"] .dh-folder-open',
        )!
        .click()
    })
    await flush()

    for (const view of ['recent', 'shared-by-me']) {
      await clickNavItem(view)
      expect(host.querySelector('.dh-doc-row[data-doc-id="doc-flat"]')).not.toBeNull()
      expect(await openMovePickerFor('doc-flat')).toBe('Đường dẫn: Tài liệu (gốc)')
      await act(async () => {
        document.querySelector<HTMLButtonElement>('.uwf-picker .btn-secondary')!.click()
      })
      await flush()
    }
  })

  it('Shared by me lists no folder row, even when the server still sends one from an older share (UNI-1974)', async () => {
    const file = {
      id: 'doc-out',
      workspaceId: 'ws-1',
      title: 'Đã chia sẻ đi.docx',
      format: 'docx',
      updatedAt: '2026-10-18T08:00:00.000Z',
      kind: 'file',
      visibility: 'restricted',
      myLevel: 'manage',
    } satisfies DocumentsHomeDoc
    const folder = {
      id: 'f-shared-old',
      workspaceId: 'ws-1',
      title: 'Thư mục chia sẻ cũ',
      format: null,
      updatedAt: '2026-10-18T09:00:00.000Z',
      kind: 'folder',
      visibility: 'restricted',
    } satisfies DocumentsHomeDoc
    api.uniworkListSharedByMe!.mockImplementation(async () =>
      ok({ documents: [folder, file], nextCursor: null }),
    )
    await mountHome()
    await clickNavItem('shared-by-me')

    expect(host.querySelector('.dh-doc-row[data-doc-id="doc-out"]')).not.toBeNull()
    expect(
      host.querySelector('[data-doc-id="f-shared-old"], [data-folder-id="f-shared-old"]'),
    ).toBeNull()
    expect(host.querySelector('.dh-folders-section')).toBeNull()
    // the count says what the table shows
    expect(host.querySelector('.dh-docs-section .dh-section-count')?.textContent).toBe('1')
  })

  it('judges the create note from the open folder row when the tree failed to load (UNI-2066 ws-fix1 #2)', async () => {
    api.uniworkFolderTree.mockResolvedValue({ ok: false, error: 'server_error' })
    rootItems = [
      {
        id: 'f-pub',
        workspaceId: 'ws-1',
        title: 'Kế hoạch chung',
        format: null,
        updatedAt: '2026-10-15T10:00:00.000Z',
        kind: 'folder',
        parentId: null,
        visibility: 'workspace',
        canEdit: true,
      } as DocumentsHomeDoc,
    ]
    await mountHome('en')
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '.dh-folder-card[data-folder-id="f-pub"] .dh-folder-open',
        )!
        .click()
    })
    await flush()
    // the tree has not loaded, so the header crumbs are absent: the New menu's Folder row
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.dh-btn-create')!.click()
    })
    await flush()
    await act(async () => {
      document.querySelector<HTMLElement>('[data-new-kind="folder"]')!.click()
    })
    await flush()
    expect(document.querySelector('.uw-act-note')).not.toBeNull()
  })

  describe("openDocumentShare (UNI-2079: a notice names a document's Share section)", () => {
    let notices: unknown[]
    let offNotice: () => void
    let scrolled: Element[]

    const mountHome = async (workspaceId = 'ws-1') => {
      await act(async () => {
        root.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(DocumentsHome, {
              workspaceId,
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
    // the fake share bridge knows one document id: the one the test names
    const useShareFor = (documentId: string) => {
      ;(window as unknown as { uniworkShare: unknown }).uniworkShare = createFakeShareApi({
        documentId,
      })
    }
    const dialogTitle = () => document.querySelector('.uw-share .uw-share-title')?.textContent ?? ''

    beforeEach(() => {
      resetDocumentsIntentBusForTests()
      notices = []
      scrolled = []
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this)
      }
      offNotice = onUniworkNotice((event) => notices.push(event))
      useShareFor('doc-1')
      api.uniworkDocumentProperties = vi.fn(async (id: string) =>
        id === 'doc-far'
          ? ok({
              documentId: 'doc-far',
              workspaceId: 'ws-1',
              title: 'Far away.docx',
              myLevel: 'manage',
            })
          : { ok: false, error: 'not_found' },
      )
    })
    afterEach(async () => {
      offNotice()
      resetDocumentsIntentBusForTests()
      delete (window as unknown as { uniworkShare?: unknown }).uniworkShare
    })

    it('opens the Share dialog of a listed document on its Requests section, without a fetch', async () => {
      await mountHome()
      await act(async () =>
        openDocumentShare({ documentId: 'doc-1', workspaceId: 'ws-1', section: 'requests' }),
      )
      await flush()
      await flush()
      expect(dialogTitle()).toContain('Báo cáo kết quả kinh doanh Q3-2026.docx')
      expect(document.activeElement).toBe(
        document.querySelector('[data-share-section="requests"] h3'),
      )
      expect(api.uniworkDocumentProperties).not.toHaveBeenCalled()
    })

    it('fetches the document when its row is not in the loaded list', async () => {
      useShareFor('doc-far')
      await mountHome()
      await act(async () =>
        openDocumentShare({ documentId: 'doc-far', workspaceId: 'ws-1', section: 'requests' }),
      )
      await flush()
      expect(api.uniworkDocumentProperties).toHaveBeenCalledWith('doc-far')
      expect(dialogTitle()).toContain('Far away.docx')
      expect(document.activeElement).toBe(
        document.querySelector('[data-share-section="requests"] h3'),
      )
    })

    describe('UNI-2105: the fetched target carries owner_kind and shelved_at like a listed row', () => {
      const unlisted = (extra: Record<string, unknown>) => {
        api.uniworkDocumentProperties = vi.fn(async () =>
          ok({
            documentId: 'doc-far',
            workspaceId: 'ws-1',
            title: 'Far away.docx',
            myLevel: 'manage',
            ownerKind: null,
            shelvedAt: null,
            ...extra,
          }),
        )
      }
      const open = async (documentOptions: { ownerKind?: string; shelved?: boolean }) => {
        ;(window as unknown as { uniworkShare: unknown }).uniworkShare = createFakeShareApi({
          documentId: 'doc-far',
          ...documentOptions,
        })
        await mountHome()
        await act(async () =>
          openDocumentShare({ documentId: 'doc-far', workspaceId: 'ws-1', section: 'requests' }),
        )
        await flush()
        await flush()
      }
      const transferButton = () =>
        document.querySelector<HTMLButtonElement>('.uw-share [data-owner-transfer]')

      it('an ordinary unlisted document still offers Transfer ownership', async () => {
        unlisted({})
        await open({})
        expect(dialogTitle()).toContain('Far away.docx')
        expect(transferButton()).not.toBeNull()
        expect(transferButton()!.getAttribute('aria-disabled')).toBeNull()
      })

      it('an unlisted work-product document shows no Transfer ownership', async () => {
        unlisted({ ownerKind: 'work_product' })
        await open({ ownerKind: 'work_product' })
        expect(dialogTitle()).toContain('Far away.docx')
        expect(transferButton()).toBeNull()
      })

      it('an unlisted shelved document: the button is aria-disabled and the shelved note shows', async () => {
        unlisted({ shelvedAt: '2026-10-01T09:00:00Z' })
        await open({ shelved: true })
        expect(transferButton()).not.toBeNull()
        expect(transferButton()!.getAttribute('aria-disabled')).toBe('true')
        const note = document.querySelector('.uw-share .uw-share-note')
        expect(note?.textContent).toContain('Archived document')
        expect(transferButton()!.getAttribute('aria-describedby')).toBe(note?.id)
      })
    })

    it('UNI-2105: an unlisted trashed document opened from a notice shows no access requests', async () => {
      api.uniworkDocumentProperties = vi.fn(async () =>
        ok({
          documentId: 'doc-far',
          workspaceId: 'ws-1',
          title: 'Far away.docx',
          myLevel: 'manage',
          ownerKind: null,
          shelvedAt: null,
          adminScope: false,
          archivedAt: '2026-10-02T09:00:00Z',
        }),
      )
      ;(window as unknown as { uniworkShare: unknown }).uniworkShare = createFakeShareApi({
        documentId: 'doc-far',
      })
      await mountHome()
      await act(async () =>
        openDocumentShare({ documentId: 'doc-far', workspaceId: 'ws-1', section: 'requests' }),
      )
      await flush()
      await flush()
      expect(dialogTitle()).toContain('Far away.docx')
      expect(document.querySelector('.uw-share [data-share-section="requests"]')).toBeNull()
    })

    it('a cold Documents home still gets an intent published before it mounted', async () => {
      useShareFor('doc-far')
      openDocumentShare({ documentId: 'doc-far', workspaceId: 'ws-1', section: 'requests' })
      await mountHome()
      expect(dialogTitle()).toContain('Far away.docx')
    })

    it('a document that cannot be read says so on the launch notice and opens no dialog', async () => {
      await mountHome()
      await act(async () =>
        openDocumentShare({ documentId: 'doc-gone', workspaceId: 'ws-1', section: 'requests' }),
      )
      await flush()
      expect(document.querySelector('.uw-share')).toBeNull()
      expect(notices).toEqual([{ phase: 'failed', error: 'not_found' }])
    })

    it("leaves another workspace's intent for that workspace's Documents home", async () => {
      await mountHome()
      await act(async () =>
        openDocumentShare({ documentId: 'doc-1', workspaceId: 'ws-9', section: 'requests' }),
      )
      await flush()
      expect(document.querySelector('.uw-share')).toBeNull()
    })
  })

  describe('UNI-2195 (D2): Google Drive sidebar and list view (4.1 on the app)', () => {
    const activeConn = {
      id: 'dc-active',
      provider: 'google',
      googleEmail: 'minh@company.vn',
      status: 'active' as const,
      needsReconnect: false,
      linkedFileCount: 2,
      connectedAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-10T00:00:00Z',
    }
    const brokenConn = {
      id: 'dc-broken',
      provider: 'google',
      googleEmail: 'lan@company.vn',
      status: 'needs_reconnect' as const,
      needsReconnect: true,
      authFailedAt: '2026-10-12T00:00:00Z',
      authFailedReason: 'invalid_grant',
      linkedFileCount: 1,
      connectedAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-12T00:00:00Z',
    }

    const fileActive = {
      id: 'df-1',
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      externalFileId: 'ext-1',
      name: 'Kế hoạch ra mắt sản phẩm Q4',
      mimeType: 'application/vnd.google-apps.document',
      iconKind: 'google_doc' as const,
      webViewLink: 'https://docs.google.com/document/d/ext-1/edit',
      openUrl: 'https://docs.google.com/document/d/ext-1/edit',
      ownerDisplay: 'Minh',
      sharingState: 'shared' as const,
      sharedUserCount: 4,
      connectionId: 'dc-active',
      boundAccountEmail: 'minh@company.vn',
      boundConnectionLost: false,
      boundById: 'u-1',
      boundByName: 'Minh',
      createdBy: 'u-1',
      createdByKind: 'user',
      createdByName: 'Minh',
      createdAt: '2026-10-10T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
      viewerAccess: 'granted' as const,
      viewerConnectionId: 'dc-active',
      viewerAccountEmail: 'minh@company.vn',
      canUnlink: true,
      canRebind: false,
      canPropose: true,
      canAsk: true,
      usedInCount: 3,
      usedInTasks: [
        { taskId: 't-1', identifier: 'UNI-1042', title: 'Task 1', status: 'in_progress' },
        { taskId: 't-2', identifier: 'UNI-1048', title: 'Task 2', status: 'todo' },
        { taskId: 't-3', identifier: 'UNI-1051', title: 'Task 3', status: 'done' },
      ],
      tasksCreated: {
        count: 3,
        lastCreatedAt: '2026-10-15T10:00:00Z',
        lastCreatedByName: 'Minh',
      },
    }

    const fileBroken = {
      id: 'df-2',
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      externalFileId: 'ext-2',
      name: 'Ngân sách marketing 2026.xlsx',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      iconKind: 'google_sheet' as const,
      webViewLink: 'https://docs.google.com/spreadsheets/d/ext-2/edit',
      openUrl: 'https://docs.google.com/spreadsheets/d/ext-2/edit',
      ownerDisplay: 'Lan',
      sharingState: 'private' as const,
      connectionId: 'dc-broken',
      boundAccountEmail: 'lan@company.vn',
      boundConnectionLost: true,
      boundById: 'u-1',
      boundByName: 'Minh',
      createdBy: 'u-1',
      createdByKind: 'user',
      createdByName: 'Minh',
      createdAt: '2026-10-11T00:00:00Z',
      updatedAt: '2026-10-12T00:00:00Z',
      viewerAccess: 'connection_lost' as const,
      viewerConnectionId: 'dc-broken',
      viewerAccountEmail: 'lan@company.vn',
      canUnlink: true,
      canRebind: true,
      canPropose: false,
      canAsk: false,
      usedInCount: 0,
      usedInTasks: [],
      tasksCreated: { count: 0 },
    }

    const fileSharedDrive = {
      id: 'df-3',
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      externalFileId: 'ext-3',
      driveId: 'shared-drive-1',
      name: 'Hợp đồng khung đối tác.pdf',
      mimeType: 'application/pdf',
      iconKind: 'pdf' as const,
      webViewLink: 'https://drive.google.com/file/d/ext-3/view',
      openUrl: 'https://drive.google.com/file/d/ext-3/view',
      ownerDisplay: 'Minh',
      sharingState: 'shared' as const,
      connectionId: 'dc-active',
      boundAccountEmail: 'minh@company.vn',
      boundConnectionLost: false,
      boundById: 'u-1',
      boundByName: 'Minh',
      createdBy: 'u-1',
      createdByKind: 'user',
      createdByName: 'Minh',
      createdAt: '2026-10-12T00:00:00Z',
      updatedAt: '2026-10-13T00:00:00Z',
      viewerAccess: 'granted' as const,
      viewerConnectionId: 'dc-active',
      viewerAccountEmail: 'minh@company.vn',
      canUnlink: true,
      canRebind: false,
      canPropose: true,
      canAsk: true,
      usedInCount: 1,
      usedInTasks: [
        { taskId: 't-9', identifier: 'UNI-1039', title: 'Task 9', status: 'in_progress' },
      ],
      tasksCreated: { count: 1 },
    }

    const installDriveBridge = (overrides?: Partial<Record<string, unknown>>) => {
      const driveBridge = {
        isAvailable: vi.fn(async () => true),
        listConnections: vi.fn(async () => ({
          ok: true as const,
          value: [activeConn, brokenConn],
        })),
        listFiles: vi.fn(async (q: { workspaceId: string; connectionId?: string }) => {
          const files =
            q.connectionId === 'dc-active'
              ? [fileActive, fileSharedDrive]
              : q.connectionId === 'dc-broken'
                ? [fileBroken]
                : [fileActive, fileBroken, fileSharedDrive]
          return {
            ok: true as const,
            value: {
              files,
              totalCount: files.length,
              nextCursor: null,
            },
          }
        }),
        openOnGoogle: vi.fn(async () => ({ ok: true as const, value: null })),
        ...overrides,
      }
      Reflect.set(window, 'uniworkDrive', driveBridge)
      return driveBridge
    }

    afterEach(() => {
      Reflect.deleteProperty(window, 'uniworkDrive')
      Reflect.deleteProperty(window, 'uniworkSyncCenter')
    })

    it('hides Google Drive in the sidebar when drive_connector is false or when the user has 0 connections (spec §17.2, Q6)', async () => {
      installDriveBridge({
        isAvailable: vi.fn(async () => false),
      })
      await mountHome()
      expect(document.querySelector('[data-nav="google-drive"]')).toBeNull()

      installDriveBridge({
        isAvailable: vi.fn(async () => true),
        listConnections: vi.fn(async () => ({ ok: true as const, value: [] })),
        listFiles: vi.fn(async () => ({
          ok: true as const,
          value: { files: [], totalCount: 0, nextCursor: null },
        })),
      })
      await mountHome()
      expect(document.querySelector('[data-nav="google-drive"]')).toBeNull()
    })

    it('keeps Google Drive in the sidebar for a linked file whose connection is gone, with the reconnect hand-off (Q-D4R-2)', async () => {
      const lostFile = {
        ...fileBroken,
        boundConnectionLost: true,
        viewerAccess: 'connection_lost' as const,
      }
      installDriveBridge({
        listConnections: vi.fn(async () => ({ ok: true as const, value: [] })),
        listFiles: vi.fn(async () => ({
          ok: true as const,
          value: { files: [lostFile], totalCount: 1, nextCursor: null },
        })),
      })
      await mountHome()
      await flush()
      const driveRow = document.querySelector<HTMLButtonElement>('[data-nav="google-drive"]')
      expect(driveRow).not.toBeNull()
      expect(driveRow!.querySelector('[data-drive-total]')?.textContent).toBe('1')
      expect(document.querySelectorAll('.dh-drive-nav-account')).toHaveLength(0)

      await act(async () => {
        driveRow!.click()
      })
      await flush()
      await flush()
      expect(document.querySelectorAll('[data-drive-file-id]')).toHaveLength(1)
      expect(document.querySelector('[data-drive-reconnect]')).not.toBeNull()
    })

    it('renders Google Drive under My Folder with account sub-rows, Mất kết nối badge, 5-column table, and double-click / Enter open-on-google', async () => {
      folderTree[0] = { ...folderTree[0]!, systemKind: 'my_folder' }
      const driveBridge = installDriveBridge()
      await mountHome()
      await flush()

      const driveRow = document.querySelector<HTMLButtonElement>('[data-nav="google-drive"]')
      expect(driveRow).not.toBeNull()
      expect(driveRow!.textContent).toContain('Google Drive')
      expect(driveRow!.querySelector('[data-drive-total]')?.textContent).toBe('3')

      const accountRows = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.dh-drive-nav-account'),
      )
      expect(accountRows.map((el) => el.getAttribute('data-drive-account'))).toEqual([
        'dc-active',
        'dc-broken',
      ])
      expect(accountRows[0]!.textContent).toContain('Drive: minh@company.vn')
      expect(accountRows[0]!.querySelector('[data-drive-lost]')).toBeNull()
      expect(accountRows[1]!.textContent).toContain('Drive: lan@company.vn')
      expect(accountRows[1]!.querySelector('[data-drive-lost]')?.textContent).toContain(
        'Mất kết nối',
      )

      // Click parent Google Drive row -> all accounts view
      await act(async () => {
        driveRow!.click()
      })
      await flush()
      await flush()

      expect(driveRow!.getAttribute('aria-current')).toBe('page')
      expect(document.querySelector('.dh-title')?.textContent).toBe('Google Drive')
      expect(document.querySelector('.dh-subtitle')?.textContent).toContain(
        'Tệp Google Drive bạn đã liên kết hoặc cho UniWork đọc.',
      )
      expect(driveBridge.listFiles).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
      })

      // 5 columns per prototype Docs-List.dc.html / spec §7.6
      const headers = Array.from(document.querySelectorAll('.dh-drive-table .dh-drive-th')).map(
        (el) => el.textContent?.trim(),
      )
      expect(headers).toEqual([
        'Tên',
        'Mở bằng tài khoản',
        'Quyền trên Google Drive',
        'Đang dùng ở',
        'Đã tạo việc',
      ])

      // Web-only CTA buttons are disabled in D2
      const addBtn = document.querySelector<HTMLButtonElement>('[data-drive-add]')!
      const manageBtn = document.querySelector<HTMLButtonElement>('[data-drive-manage]')!
      expect(addBtn.disabled).toBe(true)
      expect(addBtn.textContent).toContain('Thêm từ Google Drive')
      expect(manageBtn.disabled).toBe(true)
      expect(manageBtn.textContent).toContain('Quản lý kết nối')

      // Rows render icon kinds, access badges, used-in text, tasks-created text, and reconnect line
      const row1 = document.querySelector<HTMLElement>('[data-drive-file-id="df-1"]')!
      expect(row1).not.toBeNull()
      expect(row1.querySelector('[data-icon-kind="google_doc"]')).not.toBeNull()
      expect(row1.textContent).toContain('Kế hoạch ra mắt sản phẩm Q4')
      expect(row1.textContent).toContain('minh@company.vn')
      expect(row1.textContent).toContain('Chia sẻ với 4 người')
      expect(row1.textContent).toContain('UNI-1042 và 2 việc khác')
      expect(row1.textContent).toContain('3 việc')
      // D2-V1: Name cell carries the truncation class and full name in title; account email also carries title
      const row1Name = row1.querySelector<HTMLElement>('.dh-drive-cell-name .dh-drive-file-name')
      expect(row1Name).not.toBeNull()
      expect(row1Name?.getAttribute('title')).toBe('Kế hoạch ra mắt sản phẩm Q4')
      const row1Email = row1.querySelector<HTMLElement>(
        '.dh-drive-cell-account .dh-drive-account-email',
      )
      expect(row1Email?.getAttribute('title')).toBe('minh@company.vn')
      const row2 = document.querySelector<HTMLElement>('[data-drive-file-id="df-2"]')!
      expect(row2.querySelector('[data-icon-kind="google_sheet"]')).not.toBeNull()
      expect(row2.textContent).toContain('lan@company.vn')
      expect(row2.textContent).toContain('Mất kết nối · kết nối lại')
      expect(row2.textContent).toContain('Riêng tư')
      expect(row2.textContent).toContain('Chưa gắn vào việc nào')

      const row3 = document.querySelector<HTMLElement>('[data-drive-file-id="df-3"]')!
      expect(row3.querySelector('[data-icon-kind="pdf"]')).not.toBeNull()
      expect(row3.textContent).toContain('Bộ nhớ dùng chung')
      expect(row3.textContent).toContain('UNI-1039')
      expect(row3.textContent).toContain('1 việc')

      // Footnote rendered at bottom of list
      expect(document.querySelector('.dh-drive-footnote')?.textContent).toContain(
        'Mỗi tệp gắn với tài khoản Google Drive đã chọn nó.',
      )

      // R1-8 / R1-3 #7: When tree is ready with My Folder, Drive rows sit inside the tree's afterFirstRootRow slot
      expect(document.querySelector('.uwf-tree-slot [data-drive-sidebar]')).not.toBeNull()

      // R1-4: While onReconnect is absent in D2, the broken-row marker renders as a non-interactive span (no button)
      expect(row2.querySelector('button[data-drive-reconnect]')).toBeNull()
      expect(row2.querySelector('span[data-drive-reconnect]')?.textContent).toContain(
        'Mất kết nối · kết nối lại',
      )

      // R1-2: Double-clicking a row invokes openOnGoogle without triggering an extra listFiles refetch
      const listFilesBeforeOpen = driveBridge.listFiles.mock.calls.length
      // Double-clicking a row invokes window.uniworkDrive.openOnGoogle({ workspaceId, driveFileId })
      await act(async () => {
        row1.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      })
      await flush()
      expect(driveBridge.openOnGoogle).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        driveFileId: 'df-1',
      })
      expect(driveBridge.listFiles.mock.calls.length).toBe(listFilesBeforeOpen)

      // Pressing Enter on a row also invokes openOnGoogle({ workspaceId, driveFileId }), while repeat is ignored (R1-9)
      const liveRow2 = document.querySelector<HTMLElement>('[data-drive-file-id="df-2"]')!
      await act(async () => {
        liveRow2.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }),
        )
      })
      await flush()
      expect(driveBridge.openOnGoogle).toHaveBeenCalledTimes(1)
      await act(async () => {
        liveRow2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      await flush()
      expect(driveBridge.openOnGoogle).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        driveFileId: 'df-2',
      })

      // Clicking active account sub-row -> filters by connectionId, updates title/subtitle/button
      await act(async () => {
        accountRows[0]!.click()
      })
      await flush()
      await flush()

      expect(accountRows[0]!.getAttribute('aria-current')).toBe('page')
      expect(driveRow!.getAttribute('aria-current')).toBeNull()
      expect(document.querySelector('.dh-title')?.textContent).toBe('Drive: minh@company.vn')
      expect(document.querySelector('.dh-subtitle')?.textContent).toContain(
        'Tệp bạn đã thêm từ tài khoản này · luôn mở bằng chính tài khoản này',
      )
      expect(document.querySelector('[data-drive-add]')?.textContent).toContain(
        'Thêm từ minh@company.vn',
      )
      expect(driveBridge.listFiles).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        connectionId: 'dc-active',
      })

      // Clicking broken account sub-row -> shows broken subtitle and hides "+ Thêm từ …" button
      await act(async () => {
        accountRows[1]!.click()
      })
      await flush()
      await flush()

      expect(accountRows[1]!.getAttribute('aria-current')).toBe('page')
      expect(document.querySelector('.dh-title')?.textContent).toBe('Drive: lan@company.vn')
      expect(document.querySelector('.dh-subtitle')?.textContent).toContain(
        'Kết nối hết hạn · kết nối lại để mở các tệp này',
      )
      expect(document.querySelector('[data-drive-add]')).toBeNull()
      expect(driveBridge.listFiles).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        connectionId: 'dc-broken',
      })
    })

    it('shows the offline state when syncCenter reports offline or listFiles fails with network, and retries on Retry click', async () => {
      let syncSubscriber: ((snap: { header: { online: boolean } }) => void) | null = null
      Reflect.set(window, 'uniworkSyncCenter', {
        getSnapshot: vi.fn(async () => ({ header: { online: false } })),
        subscribe: vi.fn((cb: (snap: { header: { online: boolean } }) => void) => {
          syncSubscriber = cb
          return () => {
            syncSubscriber = null
          }
        }),
      })
      let shouldFailNetwork = false
      const driveBridge = installDriveBridge({
        listFiles: vi.fn(async () => {
          if (shouldFailNetwork) {
            return { ok: false as const, error: 'network' as const }
          }
          return {
            ok: true as const,
            value: { files: [fileActive], totalCount: 1, nextCursor: null },
          }
        }),
      })
      await mountHome()
      await flush()
      const driveRow = document.querySelector<HTMLButtonElement>('[data-nav="google-drive"]')!
      await act(async () => {
        driveRow.click()
      })
      await flush()
      await flush()
      // SyncCenter offline path shows offline state without calling listFiles
      expect(document.querySelector('.dl-state-title')?.textContent).toContain(
        'Cần kết nối mạng để xem tệp Google Drive.',
      )
      expect(driveBridge.listFiles).not.toHaveBeenCalled()

      // When syncCenter comes back online, but listFiles fails with network -> still offline state, and Retry reloads
      shouldFailNetwork = true
      await act(async () => {
        syncSubscriber?.({ header: { online: true } })
      })
      await flush()
      await flush()
      expect(document.querySelector('.dl-state-title')?.textContent).toContain(
        'Cần kết nối mạng để xem tệp Google Drive.',
      )

      shouldFailNetwork = false
      const retryBtn = document.querySelector<HTMLButtonElement>('.dl-state .btn')!
      await act(async () => {
        retryBtn.click()
      })
      await flush()
      await flush()
      expect(document.querySelector('[data-drive-file-id="df-1"]')).not.toBeNull()
    })

    it('keeps Drive rows visible when the folder tree has loaded My Folder and then fails on refresh, or when seen-then-offline (R1-1, R1-3 #2, #7)', async () => {
      let treeChangeCb: ((ev: { workspaceId: string }) => void) | null = null
      api.onUniworkTreeChanged = vi.fn((cb: (ev: { workspaceId: string }) => void) => {
        treeChangeCb = cb
        return () => {
          treeChangeCb = null
        }
      })
      api.uniworkFolderTree.mockResolvedValue(
        ok([
          {
            id: 'f-mine',
            parentId: null,
            title: 'My Folder',
            position: 0,
            systemKind: 'my_folder' as const,
            children: [],
          },
          {
            id: 'f-board',
            parentId: null,
            title: 'Báo cáo HĐQT Q4',
            position: 1,
            children: [],
          },
        ]),
      )
      let avail = true
      let netOffline = false
      installDriveBridge({
        isAvailable: vi.fn(async () => avail),
        listConnections: vi.fn(async () =>
          netOffline
            ? ({ ok: false as const, error: 'network' as const } as const)
            : ({ ok: true as const, value: [activeConn, brokenConn] } as const),
        ),
        listFiles: vi.fn(async () =>
          netOffline
            ? ({ ok: false as const, error: 'network' as const } as const)
            : ({
                ok: true as const,
                value: { files: [fileActive], totalCount: 1, nextCursor: null },
              } as const),
        ),
      })
      await mountHome()
      await flush()

      // Initially rendered inside the tree slot
      expect(document.querySelector('.uwf-tree-slot [data-nav="google-drive"]')).not.toBeNull()

      // Now both tree and Drive go offline; tree refresh keeps prev.nodes (with My Folder) and sets tree.status = 'error'
      avail = false
      netOffline = true
      api.uniworkFolderTree.mockResolvedValue({ ok: false, error: 'network' })
      await act(async () => {
        treeChangeCb?.({ workspaceId: 'ws-1' })
      })
      await flush()
      await flush()

      // Tree error banner is shown, and Drive row is still rendered outside the unmounted tree
      expect(document.querySelector('.uwf-side-state[role="alert"]')).not.toBeNull()
      const driveRow = document.querySelector<HTMLButtonElement>('[data-nav="google-drive"]')
      expect(driveRow).not.toBeNull()

      // Clicking the Drive row shows the offline state with Retry
      await act(async () => {
        driveRow!.click()
      })
      await flush()
      await flush()
      expect(document.querySelector('.dl-state-title')?.textContent).toContain(
        'Cần kết nối mạng để xem tệp Google Drive.',
      )
    })

    it('hides Drive row on cold-start offline and renders Drive row under stand-in when My Folder node is absent (R1-3 #2, #7)', async () => {
      // Cold-start offline: capability unread (false) + listConnections network -> hidden
      installDriveBridge({
        isAvailable: vi.fn(async () => false),
        listConnections: vi.fn(async () => ({ ok: false as const, error: 'network' as const })),
      })
      await mountHome()
      await flush()
      expect(document.querySelector('[data-nav="google-drive"]')).toBeNull()

      // Remount cleanly for stand-in path: folderTree has no my_folder node
      await act(async () => {
        root.unmount()
      })
      root = createRoot(host)
      folderTree = [
        {
          id: 'f-board',
          parentId: null,
          title: 'Báo cáo HĐQT Q4',
          position: 1,
          children: [],
        },
      ]
      api.uniworkFolderTree.mockResolvedValue(ok(folderTree))
      installDriveBridge()
      await mountHome()
      await flush()
      expect(document.querySelector('[data-my-folder-standin]')).not.toBeNull()
      expect(document.querySelector('.uwf-tree-slot')).toBeNull()
      expect(document.querySelector('[data-nav="google-drive"]')).not.toBeNull()
    })

    it('renders empty state and load-error state with Retry button (R1-3 #3)', async () => {
      let mode: 'empty' | 'error' | 'ready' = 'empty'
      installDriveBridge({
        listFiles: vi.fn(async () => {
          if (mode === 'error') {
            return { ok: false as const, error: 'server_error' as const }
          }
          if (mode === 'empty') {
            return { ok: true as const, value: { files: [], totalCount: 0, nextCursor: null } }
          }
          return {
            ok: true as const,
            value: { files: [fileActive], totalCount: 1, nextCursor: null },
          }
        }),
      })
      await mountHome()
      await flush()

      const driveRow = document.querySelector<HTMLButtonElement>('[data-nav="google-drive"]')!
      await act(async () => {
        driveRow.click()
      })
      await flush()
      await flush()
      expect(document.querySelector('[data-drive-empty]')?.textContent).toContain(
        'Chưa có tệp Google Drive nào được liên kết.',
      )

      // Switch to account row with error mode -> shows load-error state and Retry recovers
      mode = 'error'
      const acctRow = document.querySelector<HTMLButtonElement>('[data-drive-account="dc-active"]')!
      await act(async () => {
        acctRow.click()
      })
      await flush()
      await flush()
      expect(document.querySelector('.dl-state-title')?.textContent).toContain(
        'Không tải được danh sách tệp Google Drive.',
      )

      mode = 'ready'
      const retryBtn = document.querySelector<HTMLButtonElement>('.dl-state .btn')!
      await act(async () => {
        retryBtn.click()
      })
      await flush()
      await flush()
      expect(document.querySelector('[data-drive-file-id="df-1"]')).not.toBeNull()
    })

    it('supports paging via next_cursor, surfaces moreError, and keeps loaded rows when a focus refresh fails (R1-2, R1-3 #4, #6)', async () => {
      let failRefresh = false
      let failCursor = false
      const listFilesSpy = vi.fn(async (q: { workspaceId: string; cursor?: string }) => {
        if (q.cursor === 'cur-2') {
          if (failCursor) {
            return { ok: false as const, error: 'server_error' as const }
          }
          return {
            ok: true as const,
            value: { files: [fileSharedDrive], totalCount: 2, nextCursor: null },
          }
        }
        if (failRefresh) {
          return { ok: false as const, error: 'server_error' as const }
        }
        return {
          ok: true as const,
          value: { files: [fileActive], totalCount: 2, nextCursor: 'cur-2' },
        }
      })
      installDriveBridge({
        listFiles: listFilesSpy,
      })
      await mountHome()
      await flush()

      const driveRow = document.querySelector<HTMLButtonElement>('[data-nav="google-drive"]')!
      await act(async () => {
        driveRow.click()
      })
      await flush()
      await flush()

      expect(document.querySelectorAll('.dh-drive-row')).toHaveLength(1)
      const loadMoreBtn = document.querySelector<HTMLButtonElement>('[data-drive-load-more]')!
      expect(loadMoreBtn).not.toBeNull()

      // Failing loadMore surfaces moreError inline while keeping page 1
      failCursor = true
      await act(async () => {
        loadMoreBtn.click()
      })
      await flush()
      await flush()
      expect(document.querySelector('.uw-pick-more-error')?.textContent).toContain(
        'Không tải được danh sách tệp Google Drive.',
      )
      expect(document.querySelectorAll('.dh-drive-row')).toHaveLength(1)

      // Succeeding loadMore appends page 2
      failCursor = false
      await act(async () => {
        loadMoreBtn.click()
      })
      await flush()
      await flush()
      expect(document.querySelectorAll('.dh-drive-row')).toHaveLength(2)
      expect(document.querySelector('[data-drive-load-more]')).toBeNull()

      // R1-2: Opening a file on page 2 does not trigger a listFiles refetch from finally, and keeps page 2 rows
      const callsBeforeOpen = listFilesSpy.mock.calls.length
      await act(async () => {
        document
          .querySelector<HTMLElement>('[data-drive-file-id="df-3"]')!
          .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      })
      await flush()
      expect(listFilesSpy.mock.calls.length).toBe(callsBeforeOpen)
      expect(document.querySelectorAll('.dh-drive-row')).toHaveLength(2)
      // Window focus triggers refresh; if refresh fails, loaded rows stay visible + non-blocking error + Retry (D2-V4)
      failRefresh = true
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })
      await flush()
      await flush()
      expect(document.querySelectorAll('.dh-drive-row')).toHaveLength(2)
      expect(document.querySelector('.uw-pick-more-error')?.textContent).toContain(
        'Không tải được danh sách tệp Google Drive.',
      )
      const retryAfterRefreshBtn = document.querySelector<HTMLButtonElement>('[data-drive-retry]')!
      expect(retryAfterRefreshBtn).not.toBeNull()
      expect(retryAfterRefreshBtn.textContent).toContain('Thử lại')

      // Clicking Retry next to the kept-rows message re-requests listFiles and clears moreError
      failRefresh = false
      const callsBeforeRetry = listFilesSpy.mock.calls.length
      await act(async () => {
        retryAfterRefreshBtn.click()
      })
      await flush()
      await flush()
      expect(listFilesSpy.mock.calls.length).toBeGreaterThan(callsBeforeRetry)
      expect(document.querySelector('.uw-pick-more-error')).toBeNull()
      expect(document.querySelector('[data-drive-retry]')).toBeNull()
    })

    it('ignores stale listFiles responses after switching account and avoids refetching connections on non-Drive navigations (R1-3 #5, R1-5, R1-6)', async () => {
      const slowActive = Promise.withResolvers<{
        ok: true
        value: { files: (typeof fileActive)[]; totalCount: number; nextCursor: null }
      }>()
      let avail = true
      let connResult:
        { ok: true; value: (typeof activeConn)[] } | { ok: false; error: 'server_error' } = {
        ok: true,
        value: [activeConn, brokenConn],
      }
      const driveBridge = installDriveBridge({
        isAvailable: vi.fn(async () => avail),
        listConnections: vi.fn(async () => connResult),
        listFiles: vi.fn((q: { workspaceId: string; connectionId?: string }) => {
          if (q.connectionId === 'dc-active') {
            return slowActive.promise
          }
          return Promise.resolve({
            ok: true as const,
            value: {
              files: q.connectionId === 'dc-broken' ? [fileBroken] : [fileActive, fileBroken],
              totalCount: q.connectionId === 'dc-broken' ? 1 : 2,
              nextCursor: null,
            },
          })
        }),
      })
      await mountHome()
      await flush()
      await flush()

      // R1-6: Initial load calls listConnections once (seenInSession flip does not trigger a duplicate round),
      // and navigating between non-Drive views (Recent, Starred) does not re-call listConnections.
      expect(driveBridge.listConnections).toHaveBeenCalledTimes(1)
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-nav="recent"]')!.click()
      })
      await flush()
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-nav="starred"]')!.click()
      })
      await flush()
      expect(driveBridge.listConnections).toHaveBeenCalledTimes(1)

      // R1-3 #5: Select dc-active (slow request), then immediately switch to dc-broken (fast request);
      // when dc-active resolves late, its rows must be ignored.
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-drive-account="dc-active"]')!.click()
      })
      await flush()
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-drive-account="dc-broken"]')!.click()
      })
      await flush()
      await flush()
      expect(document.querySelector('[data-drive-file-id="df-2"]')).not.toBeNull()

      await act(async () => {
        slowActive.resolve({
          ok: true,
          value: { files: [fileActive], totalCount: 1, nextCursor: null },
        })
      })
      await flush()
      expect(document.querySelector('[data-drive-file-id="df-2"]')).not.toBeNull()
      expect(document.querySelector('[data-drive-file-id="df-1"]')).toBeNull()

      // R1-5: When capability cache expires (isAvailable -> false) and listConnections returns server_error,
      // the Drive row stays visible because it was already seen in this session.
      avail = false
      connResult = { ok: false, error: 'server_error' }
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })
      await flush()
      await flush()
      expect(document.querySelector('[data-nav="google-drive"]')).not.toBeNull()
    })

    it('rendered DriveList with onReconnect callback turns the reconnect marker into a live button and Enter on it does not open the file (R1-3 #8, R1-4)', async () => {
      const onOpenOnGoogle = vi.fn()
      const onReconnect = vi.fn()
      // DriveList statically imported at top of file
      await act(async () => {
        root.render(
          createElement(
            LocaleProvider,
            { initial: 'vi' },
            createElement(DriveList, {
              workspaceId: 'ws-1',
              connections: [activeConn, brokenConn],
              selectedAccountId: null,
              files: [fileBroken],
              status: 'ready',
              offline: false,
              nextCursor: null,
              loadingMore: false,
              onRetry: vi.fn(),
              onLoadMore: vi.fn(),
              onOpenOnGoogle,
              onReconnect,
            }),
          ),
        )
      })
      await flush()
      const reconnectBtn = document.querySelector<HTMLButtonElement>(
        'button[data-drive-reconnect="dc-broken"]',
      )
      expect(reconnectBtn).not.toBeNull()
      await act(async () => {
        reconnectBtn!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        reconnectBtn!.click()
      })
      expect(onOpenOnGoogle).not.toHaveBeenCalled()
      expect(onReconnect).toHaveBeenCalledWith('dc-broken')
    })
  })
})
