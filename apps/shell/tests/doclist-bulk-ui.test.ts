/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { BulkBar, BulkTrashConfirm } from '../src/renderer/src/doclist/BulkBar'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type {
  DocumentsHomeDoc,
  DocumentsHomeSubViewId,
} from '../src/renderer/src/uniwork-home/documents-home-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const row = (partial: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
  workspaceId: 'ws-1',
  title: partial.id,
  format: 'docx',
  updatedAt: '2026-10-21T02:05:00.000Z',
  kind: 'file',
  parentId: null,
  visibility: 'workspace',
  myLevel: 'manage',
  canEdit: true,
  canManage: true,
  ...partial,
})

describe('BulkBar: visible from one selected row, actions = what every row allows (UNI-2047 A5)', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    localStorage.setItem('genoffice.lang', 'vi')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  async function render(node: ReturnType<typeof createElement>) {
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'vi' }, node))
    })
  }
  const actionIds = () =>
    Array.from(host.querySelectorAll('[data-bulk-action]')).map((el) =>
      el.getAttribute('data-bulk-action'),
    )

  it('renders nothing while no row is selected', async () => {
    await render(
      createElement(BulkBar, {
        screen: 'workspace',
        docs: [],
        busy: false,
        onAction: vi.fn(),
        onClear: vi.fn(),
      }),
    )
    expect(host.querySelector('[data-bulk-bar]')).toBeNull()
  })

  it('shows the count, a clear button and the shared actions for one row', async () => {
    const onClear = vi.fn()
    const onAction = vi.fn()
    await render(
      createElement(BulkBar, {
        screen: 'workspace',
        docs: [row({ id: 'a' })],
        busy: false,
        onAction,
        onClear,
      }),
    )
    const bar = host.querySelector('[data-bulk-bar]')
    expect(bar).not.toBeNull()
    expect(bar!.getAttribute('role')).toBe('toolbar')
    expect(bar!.querySelector('[data-bulk-count]')?.textContent).toBe('1 đã chọn')
    expect(actionIds()).toEqual(['shelve', 'trash'])
    expect(host.querySelector('[data-bulk-action="trash"]')?.textContent).toBe(
      'Chuyển vào thùng rác',
    )
    await act(async () => host.querySelector<HTMLElement>('[data-bulk-action="shelve"]')!.click())
    expect(onAction).toHaveBeenCalledWith('shelve')
    await act(async () => host.querySelector<HTMLElement>('[data-bulk-clear]')!.click())
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('keeps only the actions every selected row has; none when a row lacks the right', async () => {
    await render(
      createElement(BulkBar, {
        screen: 'workspace',
        docs: [row({ id: 'a' }), row({ id: 'f', kind: 'folder' })],
        busy: false,
        onAction: vi.fn(),
        onClear: vi.fn(),
      }),
    )
    expect(actionIds()).toEqual(['trash'])
    expect(host.querySelector('[data-bulk-count]')?.textContent).toBe('2 đã chọn')

    await render(
      createElement(BulkBar, {
        screen: 'workspace',
        docs: [row({ id: 'a' }), row({ id: 'v', canManage: false, canEdit: false })],
        busy: false,
        onAction: vi.fn(),
        onClear: vi.fn(),
      }),
    )
    // the bar stays (count + clear), but offers nothing the viewer may not do
    expect(host.querySelector('[data-bulk-bar]')).not.toBeNull()
    expect(actionIds()).toEqual([])
    expect(host.querySelector('[data-bulk-clear]')).not.toBeNull()
  })

  it('disables every action while a batch runs', async () => {
    await render(
      createElement(BulkBar, {
        screen: 'workspace',
        docs: [row({ id: 'a' })],
        busy: true,
        onAction: vi.fn(),
        onClear: vi.fn(),
      }),
    )
    for (const el of host.querySelectorAll<HTMLButtonElement>('[data-bulk-action]')) {
      expect(el.disabled).toBe(true)
    }
  })

  it('trash confirm asks once for the whole batch', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    await render(createElement(BulkTrashConfirm, { count: 3, onConfirm, onCancel }))
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('Chuyển 3 tài liệu vào thùng rác?')
    await act(async () =>
      document.body.querySelector<HTMLElement>('[data-bulk-confirm]')!.click(),
    )
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('DocumentsHome wires the bulk bar (UNI-2047 A5)', () => {
  const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let items: DocumentsHomeDoc[]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    items = ['doc-a', 'doc-b', 'doc-c'].map((id) => row({ id, title: `${id}.docx` }))
    const mine = (d: DocumentsHomeDoc, extra: Partial<DocumentsHomeDoc>) => ({ ...d, ...extra })
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
      uniworkListDocuments: vi.fn(async () => ok({ documents: items, nextCursor: null })),
      uniworkListTrash: vi.fn(async () =>
        ok({
          documents: items.map((d) => mine(d, { archived: true, archivedAt: '2026-10-19T08:00:00Z' })),
          nextCursor: null,
        }),
      ),
      uniworkListShelved: vi.fn(async () =>
        ok({
          documents: items.map((d) =>
            mine(d, { shelvedAt: '2026-10-19T08:00:00Z', shelvedByName: 'Lan' }),
          ),
          nextCursor: null,
        }),
      ),
      uniworkListSources: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkArchiveDocument: vi.fn(async () => ({ ok: true, value: {} })),
      uniworkRestoreDocument: vi.fn(async () => ({ ok: true, value: {} })),
      uniworkShelveDocument: vi.fn(async (id: string) => ({
        ok: true,
        value: { document: { id, title: id }, affected: [id] },
      })),
      uniworkUnshelveDocument: vi.fn(async (id: string) => ({
        ok: true,
        value: { document: { id, title: id }, affected: [id] },
      })),
      uniworkTrashShelvedDocument: vi.fn(async (id: string) => ({
        ok: true,
        value: { id, title: id },
      })),
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
    await act(async () => root.unmount())
    host.remove()
    sidebarSlot.remove()
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
  const click = async (el: Element | null | undefined) => {
    expect(el).toBeTruthy()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
    await flush()
  }
  const box = (id: string) =>
    host.querySelector<HTMLInputElement>(`.dh-doc-table [data-doc-id="${id}"] input[type="checkbox"]`)
  const bar = () => host.querySelector('[data-bulk-bar]')
  const bulk = (id: string) => host.querySelector(`[data-bulk-action="${id}"]`)
  const toast = () => document.body.querySelector('.uw-act-toast')?.textContent ?? ''

  it('shows the bar once a row is ticked and hides it again when the selection is cleared', async () => {
    await mount()
    expect(bar()).toBeNull()
    await click(box('doc-a'))
    expect(bar()).not.toBeNull()
    expect(bar()!.querySelector('[data-bulk-count]')?.textContent).toBe('1 đã chọn')
    await click(box('doc-b'))
    expect(bar()!.querySelector('[data-bulk-count]')?.textContent).toBe('2 đã chọn')
    await click(host.querySelector('[data-bulk-clear]'))
    expect(bar()).toBeNull()
    expect(box('doc-a')!.checked).toBe(false)
  })

  it('trash: one confirm, one call per row, "2/2" toast, one refresh, selection cleared', async () => {
    await mount()
    await click(box('doc-a'))
    await click(box('doc-b'))
    const lists = api.uniworkListChildren!.mock.calls.length
    const trees = api.uniworkFolderTree!.mock.calls.length
    await click(bulk('trash'))
    // nothing runs before the confirm
    expect(api.uniworkArchiveDocument).not.toHaveBeenCalled()
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    await click(document.body.querySelector('[data-bulk-confirm]'))
    expect(api.uniworkArchiveDocument!.mock.calls.map((c) => c[0]).sort()).toEqual([
      'doc-a',
      'doc-b',
    ])
    expect(toast()).toContain('Đã chuyển 2/2 tài liệu vào thùng rác')
    expect(api.uniworkListChildren!.mock.calls.length - lists).toBe(1)
    expect(api.uniworkFolderTree!.mock.calls.length - trees).toBe(1)
    expect(bar()).toBeNull()
  })

  it('cancelling the confirm runs nothing and keeps the selection', async () => {
    await mount()
    await click(box('doc-a'))
    await click(bulk('trash'))
    await click(document.body.querySelector('[data-bulk-cancel]'))
    expect(api.uniworkArchiveDocument).not.toHaveBeenCalled()
    expect(bar()).not.toBeNull()
  })

  it('a refused row does not stop the batch: the toast counts 2/3 and says why', async () => {
    api.uniworkArchiveDocument!.mockImplementation(async (id: string) =>
      id === 'doc-b' ? { ok: false, error: 'forbidden' } : { ok: true, value: {} },
    )
    await mount()
    await click(box('doc-a'))
    await click(box('doc-b'))
    await click(box('doc-c'))
    await click(bulk('trash'))
    await click(document.body.querySelector('[data-bulk-confirm]'))
    expect(api.uniworkArchiveDocument).toHaveBeenCalledTimes(3)
    expect(toast()).toContain('Đã chuyển 2/3 tài liệu vào thùng rác')
    expect(toast()).toContain('Bạn không có quyền')
  })

  it('shelve needs no confirm and counts like the others', async () => {
    await mount()
    await click(box('doc-a'))
    await click(box('doc-c'))
    await click(bulk('shelve'))
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(api.uniworkShelveDocument).toHaveBeenCalledTimes(2)
    expect(toast()).toContain('Đã lưu trữ 2/2 tài liệu')
    expect(bar()).toBeNull()
  })

  it('shelved screen: unshelve, and the trash there goes through the shelf call after one confirm', async () => {
    await mount('archive')
    await click(box('doc-a'))
    await click(box('doc-b'))
    expect(
      Array.from(host.querySelectorAll('[data-bulk-action]')).map((e) =>
        e.getAttribute('data-bulk-action'),
      ),
    ).toEqual(['unshelve', 'trash'])
    await click(bulk('unshelve'))
    expect(api.uniworkUnshelveDocument).toHaveBeenCalledTimes(2)
    expect(toast()).toContain('Đã bỏ lưu trữ 2/2 tài liệu')

    await click(box('doc-a'))
    await click(bulk('trash'))
    await click(document.body.querySelector('[data-bulk-confirm]'))
    expect(api.uniworkTrashShelvedDocument!.mock.calls.map((c) => c[0])).toEqual(['doc-a'])
    expect(api.uniworkArchiveDocument).not.toHaveBeenCalled()
  })

  it('trash screen: Khôi phục only', async () => {
    await mount('trash')
    await click(box('doc-a'))
    await click(box('doc-b'))
    expect(
      Array.from(host.querySelectorAll('[data-bulk-action]')).map((e) =>
        e.getAttribute('data-bulk-action'),
      ),
    ).toEqual(['restore'])
    await click(bulk('restore'))
    expect(api.uniworkRestoreDocument).toHaveBeenCalledTimes(2)
    expect(toast()).toContain('Đã khôi phục 2/2 tài liệu')
  })

  it('a viewer’s selection shows the bar without any action', async () => {
    items = items.map((d) => ({ ...d, canManage: false, canEdit: false, myLevel: 'view' }))
    await mount()
    await click(box('doc-a'))
    expect(bar()).not.toBeNull()
    expect(host.querySelectorAll('[data-bulk-action]')).toHaveLength(0)
  })
})
