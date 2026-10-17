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
          items: [rootItems[2]!, rootItems[3]!],
          nextCursor: null,
        }),
      ),
      uniworkListSharedWithMe: vi.fn(async () =>
        ok({
          items: [
            {
              id: 'doc-shared-in',
              workspaceId: 'ws-1',
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
          items: [
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
          items: [
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
      'my-folder',
      'recent',
      'shared-with-me',
      'shared-by-me',
      'trash',
    ])
    expect(navButtons.map((b) => b.textContent?.trim())).toEqual([
      'Tài liệu của workspace',
      'Thư mục của tôi',
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

    // 3. Quick-create row ("Tạo nhanh"): Văn bản, Bảng tính, Trình chiếu + lock hint with clickable "Thư mục của tôi"
    const quickBar = host.querySelector<HTMLElement>('.dh-quick-row')
    expect(quickBar).not.toBeNull()
    expect(quickBar!.textContent).toContain('Tạo nhanh')
    expect(quickBar!.textContent).toContain('Văn bản')
    expect(quickBar!.textContent).toContain('Bảng tính')
    expect(quickBar!.textContent).toContain('Trình chiếu')
    const hintLink = quickBar!.querySelector<HTMLButtonElement>('.dh-quick-hint-link')
    expect(hintLink?.textContent).toBe('Thư mục của tôi')

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

    // Clicking "Thư mục của tôi" link in the quick-create hint switches to the my-folder sub-view
    await act(async () => {
      hintLink!.click()
    })
    await flush()
    expect(api.uniworkListChildren).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', parentId: 'f-mine' }),
    )
    expect(host.querySelector('h1.dh-title')?.textContent).toBe('Thư mục của tôi')
    expect(host.textContent).toContain('Ghi chú cá nhân.docx')
  })

  it('switches across all 6 available sub-views, forwards Loại/Người sửa/Cập nhật filters, and restores documents from Thùng rác', async () => {
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

    // Recent -> uniworkListDocuments
    await clickNav('recent')
    expect(api.uniworkListDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
    )

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

    // Shared with me -> uniworkListSharedWithMe
    await clickNav('shared-with-me')
    expect(api.uniworkListSharedWithMe).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', format: 'xlsx', updatedBy: 'u-minh' }),
    )
    expect(host.textContent).toContain('Đề xuất đối tác.docx')
    expect(host.querySelector('.dh-vis-badge')?.textContent?.trim()).toBe('Hạn chế')
    expect(host.querySelector('.dh-level-sub')?.textContent?.trim()).toBe('Bạn: Chỉnh sửa')

    // Shared by me -> uniworkListSharedByMe
    await clickNav('shared-by-me')
    expect(api.uniworkListSharedByMe).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', format: 'xlsx', updatedBy: 'u-minh' }),
    )
    expect(host.textContent).toContain('Bản thảo hợp đồng.docx')
    expect(host.querySelector('.dh-vis-badge')?.textContent?.trim()).toBe('Hạn chế')
    expect(host.querySelector('.dh-level-sub')?.textContent?.trim()).toBe('Bạn: Nhận xét')

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
})
