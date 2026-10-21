/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type {
  DocumentsHomeDoc,
  DocumentsHomeSubViewId,
} from '../src/renderer/src/uniwork-home/documents-home-model'
import { readCollapsedGroups } from '../src/renderer/src/doclist/persist'
import * as shelvedView from '../src/renderer/src/uniwork-home/ShelvedDocumentsView'
import { wbStoreWrite } from '../src/renderer/src/workbench-store-client'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

// 2026-10-21 12:00 local; every date below is relative to it
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const iso = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min, 0).toISOString()

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]

const row = (partial: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
  workspaceId: 'ws-1',
  title: partial.id,
  format: 'docx',
  updatedAt: iso(2026, 10, 10, 9, 5),
  kind: 'file',
  parentId: null,
  visibility: 'workspace',
  myLevel: 'manage',
  canEdit: true,
  canManage: true,
  updatedByName: 'Minh Trần',
  sizeBytes: 2_969,
  ...partial,
})

const trashed = (
  id: string,
  archivedAt: string,
  purgeAfter: string | undefined,
  extra: Partial<DocumentsHomeDoc> = {},
): DocumentsHomeDoc =>
  row({
    id,
    archived: true,
    archivedAt,
    archivedByName: 'Hải Lê',
    ...(purgeAfter ? { purgeAfter } : {}),
    ...extra,
  })

describe('Trash on the shared table (UNI-2047 A2b)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let trash: DocumentsHomeDoc[]
  let shelf: DocumentsHomeDoc[]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    // handed over in a scrambled order on purpose: the table owns the order
    trash = [
      // 25 days left
      trashed('t-d', iso(2026, 10, 16), iso(2026, 11, 15)),
      // 1 day left (the last day still reads 1)
      trashed('t-a', iso(2026, 9, 22), iso(2026, 10, 22)),
      // 8 days left
      trashed('t-c', iso(2026, 9, 29), iso(2026, 10, 29)),
      // 7 days left
      trashed('t-b', iso(2026, 9, 28), iso(2026, 10, 28)),
      // no purge date: no days-left text, never "Deleting soon"
      trashed('t-e', iso(2026, 10, 17), undefined),
    ]
    shelf = [
      row({
        id: 's-a',
        title: 'Hợp đồng.docx',
        shelvedAt: iso(2026, 10, 19, 8, 0),
        shelvedById: 'u-lan',
        shelvedByName: 'Lan Nguyễn',
      }),
      row({
        id: 's-b',
        title: 'Báo cáo.xlsx',
        format: 'xlsx',
        shelvedAt: iso(2026, 10, 18, 8, 0),
        shelvedById: 'u-lan',
        shelvedByName: 'Lan Nguyễn',
      }),
    ]
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
      uniworkListTrash: vi.fn(async () => ok({ documents: trash, nextCursor: null })),
      uniworkListShelved: vi.fn(async () => ok({ documents: shelf, nextCursor: null })),
      uniworkListSources: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkRestoreDocument: vi.fn(async (id: string) => ok({ id })),
      uniworkUnshelveDocument: vi.fn(async (id: string) =>
        ok({
          document: { ...shelf.find((d) => d.id === id)!, shelvedAt: undefined },
          affected: [id],
        }),
      ),
      uniworkDocumentProperties: vi.fn(async () => ({ ok: false, error: 'network' })),
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
  })

  async function mount(subView: DocumentsHomeSubViewId = 'trash') {
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
            initialSubView: subView,
          }),
        ),
      )
    })
    await flush()
  }
  async function remount(subView: DocumentsHomeSubViewId = 'trash') {
    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    await mount(subView)
  }

  const columnIds = () =>
    Array.from(host.querySelectorAll('.dh-doc-table [role="columnheader"]')).map((el) =>
      el.getAttribute('data-col'),
    )
  const rowIds = () =>
    Array.from(host.querySelectorAll('.dh-doc-table [role="row"][data-doc-id]')).map((el) =>
      el.getAttribute('data-doc-id'),
    )
  const header = (col: string) =>
    host.querySelector<HTMLElement>(`.dh-doc-table [role="columnheader"][data-col="${col}"]`)
  const cell = (id: string, col: string) =>
    host.querySelector<HTMLElement>(`[data-doc-id="${id}"] [data-col="${col}"]`)
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
  const groupRow = (id: string) => host.querySelector<HTMLElement>(`[data-group="${id}"]`)
  const groupIds = () =>
    Array.from(host.querySelectorAll('.dh-doc-table [data-group]')).map((el) =>
      el.getAttribute('data-group'),
    )
  /** the group a row sits in: the nearest group body above it */
  const groupOfRow = (id: string) =>
    host
      .querySelector(`[data-doc-id="${id}"]`)
      ?.closest('[data-group-body]')
      ?.getAttribute('data-group-body')

  it('lists the rules columns, with Đã xóa (who · date · days left) after Tên', async () => {
    await mount()
    expect(columnIds()).toEqual([
      'select',
      'name',
      'deleted',
      'access',
      'editor',
      'updated',
      'size',
      'actions',
    ])
    expect(host.querySelector('.dh-doc-table')?.getAttribute('role')).toBe('table')
    const deleted = cell('t-a', 'deleted')!
    expect(deleted.textContent).toContain('Hải Lê')
    expect(deleted.textContent).toContain('22/09')
    expect(deleted.textContent).toContain('Còn 1 ngày')
    expect(deleted.textContent).not.toMatch(/undefined|NaN/)
    // no date to count from: just who and when
    expect(cell('t-e', 'deleted')!.textContent).toContain('Hải Lê')
    expect(cell('t-e', 'deleted')!.textContent).not.toContain('Còn')
  })

  it('counts days left from purge_after and reddens them at 7 or fewer', async () => {
    await mount()
    const left = (id: string) => cell(id, 'deleted')!.querySelector('.dh-days-left')
    expect(left('t-a')?.textContent).toBe('Còn 1 ngày')
    expect(left('t-b')?.textContent).toBe('Còn 7 ngày')
    expect(left('t-c')?.textContent).toBe('Còn 8 ngày')
    expect(left('t-d')?.textContent).toBe('Còn 25 ngày')
    expect(left('t-a')!.classList.contains('dh-days-soon')).toBe(true)
    expect(left('t-b')!.classList.contains('dh-days-soon')).toBe(true)
    expect(left('t-c')!.classList.contains('dh-days-soon')).toBe(false)
    expect(left('t-d')!.classList.contains('dh-days-soon')).toBe(false)
    expect(left('t-e')).toBeNull()

    const css = readFileSync(
      resolve(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
      'utf8',
    )
    expect(css).toMatch(/\.dh-days-soon\s*\{[^}]*color:\s*var\(--danger-text\)/)
  })

  it('asks the server for Đã xóa oldest first from the first read, and groups the rows', async () => {
    await mount()
    // same as the web: the groups hold across pages only when the server pages in that order
    expect(api.uniworkListTrash!.mock.calls.length).toBeGreaterThan(0)
    for (const [args] of api.uniworkListTrash!.mock.calls) {
      expect(args).toMatchObject({ sort: 'deleted', order: 'asc' })
    }
    expect(header('deleted')?.getAttribute('aria-sort')).toBe('ascending')
    expect(rowIds()).toEqual(['t-a', 't-b', 't-c', 't-d', 't-e'])

    expect(groupIds()).toEqual(['deleting_soon', 'more_than_7_days'])
    expect(groupRow('deleting_soon')!.textContent).toContain('Sắp xóa vĩnh viễn')
    expect(groupRow('more_than_7_days')!.textContent).toContain('Còn trên 7 ngày')
    expect(groupOfRow('t-a')).toBe('deleting_soon')
    expect(groupOfRow('t-b')).toBe('deleting_soon')
    expect(groupOfRow('t-c')).toBe('more_than_7_days')
    expect(groupOfRow('t-d')).toBe('more_than_7_days')
    expect(groupOfRow('t-e')).toBe('more_than_7_days')
  })

  it('sends the chosen server sort when the person sorts, keeps the groups on Đã xóa and drops them on any other column', async () => {
    await mount()
    await click(header('deleted')!.querySelector('button'))
    expect(lastCall('uniworkListTrash')).toMatchObject({ sort: 'deleted', order: 'desc' })
    expect(header('deleted')?.getAttribute('aria-sort')).toBe('descending')
    // the groups are runs of the sorted list, so they swap places
    expect(groupIds()).toEqual(['more_than_7_days', 'deleting_soon'])
    expect(rowIds()).toEqual(['t-e', 't-d', 't-c', 't-b', 't-a'])

    await click(header('size')!.querySelector('button'))
    expect(lastCall('uniworkListTrash')).toMatchObject({ sort: 'size', order: 'desc' })
    expect(groupIds()).toEqual([])
    expect(host.querySelector('[data-group-body]')).toBeNull()
    expect(rowIds()).toHaveLength(5)
  })

  it('collapses a group from its header, remembers it per screen and keeps the other group', async () => {
    await mount()
    const button = groupRow('deleting_soon')!.querySelector<HTMLButtonElement>('button')!
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Thu gọn hoặc mở “Sắp xóa vĩnh viễn”')
    await click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(rowIds()).toEqual(['t-c', 't-d', 't-e'])
    expect(readCollapsedGroups('trash')).toEqual(['deleting_soon'])

    await remount()
    expect(groupRow('deleting_soon')!.querySelector('button')!.getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect(rowIds()).toEqual(['t-c', 't-d', 't-e'])

    await click(groupRow('deleting_soon')!.querySelector('button'))
    expect(rowIds()).toEqual(['t-a', 't-b', 't-c', 't-d', 't-e'])
    expect(readCollapsedGroups('trash')).toEqual([])
  })

  it('renders a list when the stored group state is garbage', async () => {
    wbStoreWrite('uniwork.wb.doclist.groups', { trash: 'nope', recent: 3 })
    await mount()
    expect(rowIds()).toEqual(['t-a', 't-b', 't-c', 't-d', 't-e'])
  })

  it('indents the rows of a group by 28px', () => {
    const css = readFileSync(
      resolve(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
      'utf8',
    )
    expect(css).toMatch(/\[data-group-body\][^{]*\{[^}]*28px/)
  })

  it('shows the 30-day notice instead of the old note, and not on another screen', async () => {
    await mount()
    const banners = host.querySelectorAll('.dh-subview-banner')
    expect(banners).toHaveLength(1)
    expect(banners[0]!.textContent).toBe(
      'Các mục sẽ nằm trong thùng rác 30 ngày rồi bị xóa vĩnh viễn.',
    )
    expect(host.textContent).not.toContain('có thể khôi phục nếu bạn có quyền Quản lý')

    await remount('archive')
    expect(host.querySelector('.dh-subview-banner')).toBeNull()
  })

  it('puts Khôi phục before the … on a row the person can manage, and runs it', async () => {
    trash = [
      ...trash.slice(0, 4),
      trashed('t-e', iso(2026, 10, 17), undefined, { canManage: false, myLevel: 'edit' }),
    ]
    await mount()
    const button = (id: string) =>
      host.querySelector<HTMLButtonElement>(`[data-doc-id="${id}"] button.dh-trash-restore`)
    expect(button('t-a')?.textContent?.trim()).toBe('Khôi phục')
    // a row without Quản lý has no restore at all (its menu is only Xem chi tiết)
    expect(button('t-e')).toBeNull()
    const actions = cell('t-a', 'actions')!
    const children = Array.from(actions.children)
    expect(children.indexOf(button('t-a')!)).toBeLessThan(
      children.findIndex((el) => el.classList.contains('uw-row-menu')),
    )

    const before = api.uniworkListTrash!.mock.calls.length
    await click(button('t-a'))
    expect(api.uniworkRestoreDocument).toHaveBeenCalledTimes(1)
    expect(api.uniworkRestoreDocument!.mock.calls[0]![0]).toBe('t-a')
    expect(api.uniworkListTrash!.mock.calls.length).toBeGreaterThan(before)
  })

  it('has the menu Khôi phục · Xem chi tiết and no permanent delete', async () => {
    await mount()
    await click(host.querySelector('[data-doc-id="t-a"] .uw-row-menu-btn'))
    const labels = Array.from(document.querySelectorAll('.uw-row-menu-list [role="menuitem"]')).map(
      (el) => el.textContent?.trim(),
    )
    expect(labels).toEqual(['Khôi phục', 'Xem chi tiết'])
  })

  it('keeps select-all and the row checkboxes working across the groups', async () => {
    await mount()
    const all = host.querySelector<HTMLInputElement>(
      '.dh-doc-head [data-col="select"] input[type="checkbox"]',
    )!
    await click(all)
    const boxes = Array.from(
      host.querySelectorAll<HTMLInputElement>('.dh-doc-table [data-doc-id] input[type="checkbox"]'),
    )
    expect(boxes).toHaveLength(5)
    expect(boxes.every((b) => b.checked)).toBe(true)
    await click(boxes[0])
    expect(boxes[0]!.checked).toBe(false)
    expect(all.indeterminate).toBe(true)
  })

  it('opens a trashed row in the details panel from the menu, not the document', async () => {
    await mount()
    await click(host.querySelector('[data-doc-id="t-b"] .uw-row-menu-btn'))
    const details = Array.from(
      document.querySelectorAll<HTMLElement>('.uw-row-menu-list [role="menuitem"]'),
    ).find((el) => el.textContent?.includes('Xem chi tiết'))
    await click(details)
    expect(api.uniworkDocumentProperties).toHaveBeenCalledTimes(1)
  })
})

describe('Lưu trữ on the shared table (UNI-2047 A2b)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let shelf: DocumentsHomeDoc[]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    shelf = [
      row({
        id: 's-a',
        title: 'Hợp đồng.docx',
        shelvedAt: iso(2026, 10, 19, 8, 0),
        shelvedById: 'u-lan',
        shelvedByName: 'Lan Nguyễn',
      }),
      row({
        id: 's-b',
        title: 'Báo cáo.xlsx',
        format: 'xlsx',
        canManage: false,
        myLevel: 'edit',
        shelvedAt: iso(2026, 10, 18, 8, 0),
        shelvedById: 'u-lan',
        shelvedByName: 'Lan Nguyễn',
      }),
    ]
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
      uniworkListShelved: vi.fn(async () => ok({ documents: shelf, nextCursor: null })),
      uniworkListSources: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkUnshelveDocument: vi.fn(async (id: string) =>
        ok({
          document: { ...shelf.find((d) => d.id === id)!, shelvedAt: undefined },
          affected: [id],
        }),
      ),
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
  })

  async function mount() {
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
            initialSubView: 'archive',
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

  it('is one table: no second table, no type select, only the intro and Lưu trữ bởi above it', async () => {
    await mount()
    expect(host.querySelectorAll('.dh-doc-table')).toHaveLength(1)
    expect(host.querySelector('table')).toBeNull()
    expect(host.querySelector('.dh-shelved-head select[data-filter="format"]')).toBeNull()
    expect(host.querySelectorAll('.dh-shelved-head select')).toHaveLength(1)
    expect(host.querySelector('.dh-shelved-intro')).not.toBeNull()
    expect(host.querySelector('[data-group]')).toBeNull()
    expect(Object.keys(shelvedView).sort()).toEqual([
      'ShelvedToolbar',
      'filterByShelver',
      'shelvedDescendantIds',
    ])
  })

  it('draws Lưu trữ (who · date), Bỏ lưu trữ before the … and the menu of the shelf', async () => {
    await mount()
    const shelvedCell = host.querySelector('[data-doc-id="s-a"] [data-col="shelved"]')!
    expect(shelvedCell.textContent).toContain('Lan Nguyễn')
    expect(shelvedCell.textContent).toContain('19/10')

    const button = host.querySelector<HTMLButtonElement>(
      '[data-doc-id="s-a"] button.dh-shelved-unshelve',
    )!
    expect(button.textContent?.trim()).toBe('Bỏ lưu trữ')
    const actions = host.querySelector('[data-doc-id="s-a"] [data-col="actions"]')!
    const children = Array.from(actions.children)
    expect(children.indexOf(button)).toBeLessThan(
      children.findIndex((el) => el.classList.contains('uw-row-menu')),
    )
    // a row the person cannot manage has no button
    expect(host.querySelector('[data-doc-id="s-b"] button.dh-shelved-unshelve')).toBeNull()

    await click(host.querySelector('[data-doc-id="s-a"] .uw-row-menu-btn'))
    expect(
      Array.from(document.querySelectorAll('.uw-row-menu-list [role="menuitem"]')).map((el) =>
        el.textContent?.trim(),
      ),
    ).toEqual(['Mở', 'Bỏ lưu trữ', 'Chuyển vào thùng rác'])
  })

  it('runs Bỏ lưu trữ from the row button', async () => {
    await mount()
    await click(host.querySelector('[data-doc-id="s-a"] button.dh-shelved-unshelve'))
    expect(api.uniworkUnshelveDocument).toHaveBeenCalledTimes(1)
    expect(api.uniworkUnshelveDocument!.mock.calls[0]![0]).toBe('s-a')
  })
})
