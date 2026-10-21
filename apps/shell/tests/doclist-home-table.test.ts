/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkSourceFile, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type {
  DocumentsHomeDoc,
  DocumentsHomeSubViewId,
} from '../src/renderer/src/uniwork-home/documents-home-model'
import { readSort } from '../src/renderer/src/doclist/persist'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

// 2026-10-21 12:00 local; the rows' dates are relative to it
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const iso = (y: number, m: number, d: number, h: number, min: number) =>
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
  updatedAt: iso(2026, 10, 21, 9, 5),
  kind: 'file',
  parentId: null,
  visibility: 'workspace',
  myLevel: 'edit',
  canEdit: true,
  updatedByName: 'Minh Trần',
  sizeBytes: 2_969,
  ...partial,
})

const SOURCE: UniworkSourceFile = {
  id: 'src-1',
  workspaceId: 'ws-1',
  name: 'Bảng giá.pdf',
  extension: 'pdf',
  mimeType: 'application/pdf',
  sizeBytes: 5_033_165,
  updatedAt: iso(2026, 10, 20, 16, 30),
  source: 'chat',
  owner: { id: 'u-lan', name: 'Lan Nguyễn' },
  parent: { kind: 'chat', title: 'Kế toán' },
} as unknown as UniworkSourceFile

describe('DocumentsHome renders its screens through the shared table (UNI-2047 A2a)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let items: DocumentsHomeDoc[]
  let recentItems: DocumentsHomeDoc[]
  let sources: UniworkSourceFile[]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    items = [
      row({
        id: 'doc-b',
        title: 'Bảng chấm công.xlsx',
        format: 'xlsx',
        updatedAt: iso(2026, 10, 20, 16, 30),
      }),
      row({ id: 'doc-a', title: 'Ân hạn nợ.docx', updatedAt: iso(2026, 10, 21, 9, 5) }),
      row({
        id: 'doc-c',
        title: 'Chiến lược.pptx',
        format: 'pptx',
        updatedAt: iso(2025, 3, 2, 8, 0),
        sizeBytes: 5_033_165,
      }),
    ]
    recentItems = items
    sources = []
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
      uniworkListChildren: vi.fn(async () => ok({ items, nextCursor: null })),
      uniworkListDocuments: vi.fn(async () => ok({ documents: recentItems, nextCursor: null })),
      uniworkListSharedWithMe: vi.fn(async () => ok({ documents: items, nextCursor: null })),
      uniworkListSharedByMe: vi.fn(async () => ok({ documents: items, nextCursor: null })),
      uniworkListTrash: vi.fn(async () =>
        ok({
          documents: items.map((d) => ({
            ...d,
            archived: true,
            archivedAt: iso(2026, 10, 19, 8, 0),
            canManage: true,
          })),
          nextCursor: null,
        }),
      ),
      uniworkListShelved: vi.fn(async () =>
        ok({
          documents: items.map((d) => ({
            ...d,
            canManage: true,
            shelvedAt: iso(2026, 10, 19, 8, 0),
            shelvedById: 'u-lan',
            shelvedByName: 'Lan Nguyễn',
          })),
          nextCursor: null,
        }),
      ),
      uniworkListSources: vi.fn(async () => ok({ items: sources, nextCursor: null })),
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
  })

  async function mount(subView: DocumentsHomeSubViewId = 'workspace') {
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
  async function remount(subView: DocumentsHomeSubViewId = 'workspace') {
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

  it('has no grid view, no Group by and no sort button: one table, sorted from its headers', async () => {
    for (const subView of ['workspace', 'recent', 'shared-with-me', 'shared-by-me'] as const) {
      await remount(subView)
      expect(host.querySelector('.dh-doc-table')).not.toBeNull()
      expect(host.querySelector('[data-view]')).toBeNull()
      expect(host.querySelector('.dh-view-toggle')).toBeNull()
      expect(host.querySelector('.dh-doc-table.grid-mode')).toBeNull()
      expect(host.querySelector('select[data-filter="groupBy"]')).toBeNull()
      expect(host.querySelector('.dh-sort-btn')).toBeNull()
      expect(host.textContent).not.toContain('Nhóm theo')
      expect(host.querySelector('.dh-group-row')).toBeNull()
    }
  })

  it('draws the workspace table on the shared columns, dates and sizes', async () => {
    await mount()
    expect(columnIds()).toEqual([
      'select',
      'name',
      'access',
      'editor',
      'updated',
      'size',
      'actions',
    ])
    const text = (id: string, col: string) =>
      host.querySelector(`[data-doc-id="${id}"] [data-col="${col}"]`)?.textContent
    expect(text('doc-a', 'updated')).toBe('09:05')
    expect(text('doc-b', 'updated')).toBe('Hôm qua, 16:30')
    expect(text('doc-c', 'updated')).toBe('02/03/2025')
    expect(text('doc-c', 'size')).toBe('4,8 MB')
    // the newest first, as the screen default says
    expect(rowIds()).toEqual(['doc-a', 'doc-b', 'doc-c'])
    expect(header('updated')?.getAttribute('aria-sort')).toBe('descending')
  })

  it('sends the header sort to the server, flips it on a second click and remembers it per screen', async () => {
    await mount()
    // an untouched list asks for what it always asked for
    expect(lastCall('uniworkListChildren')).not.toHaveProperty('sort')

    await click(header('name')!.querySelector('button'))
    expect(lastCall('uniworkListChildren')).toMatchObject({ sort: 'name', order: 'asc' })
    expect(header('name')?.getAttribute('aria-sort')).toBe('ascending')
    // vi collator: Ân hạn < Bảng < Chiến
    expect(rowIds()).toEqual(['doc-a', 'doc-b', 'doc-c'])

    await click(header('name')!.querySelector('button'))
    expect(lastCall('uniworkListChildren')).toMatchObject({ sort: 'name', order: 'desc' })
    expect(rowIds()).toEqual(['doc-c', 'doc-b', 'doc-a'])
    expect(readSort('workspace')).toEqual({ column: 'name', dir: 'desc' })

    // the next launch opens on it, and the first read already carries it
    await remount()
    expect(header('name')?.getAttribute('aria-sort')).toBe('descending')
    expect(api.uniworkListChildren!.mock.calls.at(-1)?.[0]).toMatchObject({
      sort: 'name',
      order: 'desc',
    })
    expect(rowIds()).toEqual(['doc-c', 'doc-b', 'doc-a'])

    // another screen has its own sort
    await remount('recent')
    expect(header('updated')?.getAttribute('aria-sort')).toBe('descending')
    expect(lastCall('uniworkListDocuments')).not.toHaveProperty('sort')
  })

  it('sends the sort on Recent, Shared with me, Shared by me and Trash too', async () => {
    const cases = [
      ['recent', 'uniworkListDocuments'],
      ['shared-with-me', 'uniworkListSharedWithMe'],
      ['shared-by-me', 'uniworkListSharedByMe'],
      ['trash', 'uniworkListTrash'],
    ] as const
    for (const [subView, fn] of cases) {
      await remount(subView)
      await click(header('size')!.querySelector('button'))
      expect(lastCall(fn), subView).toMatchObject({ sort: 'size', order: 'desc' })
    }
  })

  it('hides the Recent column until the server sends last_activity, then shows and sorts it', async () => {
    await mount('recent')
    expect(columnIds()).toEqual([
      'select',
      'name',
      'access',
      'editor',
      'updated',
      'size',
      'actions',
    ])
    expect(host.textContent).not.toMatch(/undefined|NaN/)

    recentItems = items.map((d, i) => ({
      ...d,
      lastActivity: {
        kind: i === 0 ? ('edited' as const) : ('opened' as const),
        at: iso(2026, 10, 20 + (i % 2), 9, 0),
      },
    }))
    await remount('recent')
    expect(columnIds()).toEqual([
      'select',
      'name',
      'activity',
      'access',
      'editor',
      'updated',
      'size',
      'actions',
    ])
    expect(
      host.querySelector('[data-doc-id="doc-b"] [data-col="activity"]')?.textContent,
    ).toContain('Bạn đã sửa')
    expect(header('activity')?.getAttribute('aria-sort')).toBe('descending')
    await click(header('activity')!.querySelector('button'))
    expect(lastCall('uniworkListDocuments')).toMatchObject({ sort: 'activity', order: 'asc' })
  })

  it('sends shared_with as the shared sort key on Shared by me', async () => {
    items = items.map((d) => ({
      ...d,
      shareSummary: { people: 2, workspaces: 0, links: 1, latestAt: iso(2026, 10, 20, 9, 0) },
    }))
    await mount('shared-by-me')
    expect(columnIds()).toContain('shared_with')
    expect(
      host.querySelector('[data-doc-id="doc-a"] [data-col="shared_with"]')?.textContent,
    ).toContain('2 người · 1 link')
    await click(header('shared_with')!.querySelector('button'))
    expect(lastCall('uniworkListSharedByMe')).toMatchObject({ sort: 'shared', order: 'asc' })
  })

  it('draws Trash and the shelf on the same table, with their screen column and row actions', async () => {
    await mount('trash')
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

    await remount('archive')
    expect(columnIds()).toEqual([
      'select',
      'name',
      'shelved',
      'access',
      'editor',
      'updated',
      'size',
      'actions',
    ])
    const shelved =
      host.querySelector('[data-doc-id="doc-a"] [data-col="shelved"]')?.textContent ?? ''
    expect(shelved).toContain('Lan Nguyễn')
    expect(shelved).toContain('19/10')
    // the shelf keeps its own toolbar and its Bỏ lưu trữ button
    expect(host.querySelector('.dh-shelved-intro')).not.toBeNull()
    expect(host.querySelector('[data-doc-id="doc-a"] button.dh-shelved-unshelve')).not.toBeNull()
  })

  it('lays "other sources" rows on the same columns as the header', async () => {
    sources = [SOURCE]
    await mount('elsewhere')
    const head = host.querySelectorAll('.dh-doc-table [role="columnheader"]').length
    const source = host.querySelector<HTMLElement>('[data-source-id="src-1"]')!
    expect(source).not.toBeNull()
    expect(source.querySelectorAll('[role="cell"]')).toHaveLength(head)
    expect(source.style.gridTemplateColumns).toBe(
      host.querySelector<HTMLElement>('.dh-doc-head')!.style.gridTemplateColumns,
    )
    expect(source.querySelector('[data-col="updated"]')?.textContent).toBe('Hôm qua, 16:30')
    expect(source.querySelector('[data-col="size"]')?.textContent).toBe('4,8 MB')
    // no checkbox: a source file cannot be selected
    expect(source.querySelector('input[type="checkbox"]')).toBeNull()
  })

  it('keeps a row checkbox per document and does not open the document from it', async () => {
    await mount()
    const boxes = host.querySelectorAll<HTMLInputElement>(
      '.dh-doc-table [data-doc-id] input[type="checkbox"]',
    )
    expect(boxes).toHaveLength(3)
    await click(boxes[0])
    expect(boxes[0]!.checked).toBe(true)
    // changing screen clears the selection
    await click(sidebarSlot.querySelector('[data-nav="recent"]'))
    expect(
      Array.from(
        host.querySelectorAll<HTMLInputElement>(
          '.dh-doc-table [data-doc-id] input[type="checkbox"]',
        ),
      ).some((b) => b.checked),
    ).toBe(false)
  })
})
