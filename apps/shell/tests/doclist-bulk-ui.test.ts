/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { resetZipDownloadStore } from '../src/renderer/src/uniwork-zip-download/zip-download-store'
import { fakeZipBridge, type FakeZipBridge } from './uniwork-zip-fake-bridge'
import { BulkBar, BulkTrashConfirm } from '../src/renderer/src/doclist/BulkBar'
import { BulkPurgeConfirm } from '../src/renderer/src/doclist/BulkPurgeConfirm'
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
    await act(async () => document.body.querySelector<HTMLElement>('[data-bulk-confirm]')!.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('BulkPurgeConfirm (UNI-2078)', () => {
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
  const render = (props: { count: number; onConfirm: () => void; onCancel: () => void }) =>
    act(async () => {
      root.render(
        createElement(LocaleProvider, { initial: 'vi' }, createElement(BulkPurgeConfirm, props)),
      )
    })

  it('names the count and asks once', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    await render({ count: 3, onConfirm, onCancel })
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain(
      'Xóa vĩnh viễn 3 tài liệu?',
    )
    await act(async () => document.body.querySelector<HTMLElement>('[data-bulk-confirm]')!.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('the confirm fires once even on two clicks before a re-render', async () => {
    const onConfirm = vi.fn()
    await render({ count: 2, onConfirm, onCancel: vi.fn() })
    const confirm = document.body.querySelector<HTMLElement>('[data-bulk-confirm]')!
    await act(async () => {
      confirm.click()
      confirm.click()
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('is a labelled, described dialog with the focus on cancel', async () => {
    await render({ count: 2, onConfirm: vi.fn(), onCancel: vi.fn() })
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.activeElement).toBe(document.body.querySelector('[data-bulk-cancel]'))
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
          documents: items.map((d) =>
            mine(d, { archived: true, archivedAt: '2026-10-19T08:00:00Z' }),
          ),
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
      uniworkArchiveImpact: vi.fn(async () =>
        ok({ tooLarge: false, folders: 0, documents: 1, relocatedCount: 1 }),
      ),
      uniworkRestoreDocument: vi.fn(async () => ({ ok: true, value: {} })),
      uniworkPurgeDocument: vi.fn(async (id: string) => ({ ok: true, value: { id } })),
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
    resetZipDownloadStore()
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
    host.querySelector<HTMLInputElement>(
      `.dh-doc-table [data-doc-id="${id}"] input[type="checkbox"]`,
    )
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

  it('trash of documents only has no relocated clause (UNI-2066 A8; the folder clause is pinned in uniwork-ws-move-trash.test.ts)', async () => {
    await mount()
    await click(box('doc-a'))
    await click(bulk('trash'))
    expect(document.body.querySelector('[role="dialog"]')!.textContent).not.toContain(
      'trả về cho chủ sở hữu',
    )
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

  // A-FIX4 M1: the bar, the confirm and the batch act on the rows the person sees
  it('shelf: select-all, then a "Lưu trữ bởi" filter, leaves only the visible rows selected', async () => {
    const byLan = { shelvedById: 'u-lan', shelvedByName: 'Lan Nguyễn' }
    const byHai = { shelvedById: 'u-hai', shelvedByName: 'Hải Lê' }
    items = [
      row({ id: 'doc-a', ...byLan }),
      row({ id: 'doc-b', ...byHai }),
      row({ id: 'doc-c', ...byHai }),
    ].map((d) => ({ ...d, shelvedAt: '2026-10-19T08:00:00Z' }))
    api.uniworkListShelved!.mockImplementation(async () =>
      ok({ documents: items, nextCursor: null }),
    )
    await mount('archive')
    await click(host.querySelector('.dh-doc-head [data-col="select"] input[type="checkbox"]'))
    expect(bar()!.querySelector('[data-bulk-count]')?.textContent).toBe('3 đã chọn')

    const select = host.querySelector<HTMLSelectElement>('select[data-filter="shelvedBy"]')!
    await act(async () => {
      select.value = 'u-lan'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(
      Array.from(host.querySelectorAll('.dh-doc-table [data-doc-id]')).map((el) =>
        el.getAttribute('data-doc-id'),
      ),
    ).toEqual(['doc-a'])
    expect(bar()!.querySelector('[data-bulk-count]')?.textContent).toBe('1 đã chọn')

    await click(bulk('trash'))
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain(
      'Chuyển 1 tài liệu vào thùng rác?',
    )
    await click(document.body.querySelector('[data-bulk-confirm]'))
    expect(api.uniworkTrashShelvedDocument!.mock.calls.map((c) => c[0])).toEqual(['doc-a'])
  })

  it('trash screen: Khôi phục, then Xóa vĩnh viễn', async () => {
    await mount('trash')
    await click(box('doc-a'))
    await click(box('doc-b'))
    expect(
      Array.from(host.querySelectorAll('[data-bulk-action]')).map((e) =>
        e.getAttribute('data-bulk-action'),
      ),
    ).toEqual(['restore', 'purge'])
    await click(bulk('restore'))
    expect(api.uniworkRestoreDocument).toHaveBeenCalledTimes(2)
    expect(api.uniworkPurgeDocument).not.toHaveBeenCalled()
    expect(toast()).toContain('Đã khôi phục 2/2 tài liệu')
  })

  describe('Xóa vĩnh viễn (UNI-2078)', () => {
    const confirmDialog = () => document.body.querySelector('[role="dialog"]')
    const pick = async (...ids: string[]) => {
      for (const id of ids) await click(box(id))
    }

    it('is a danger button labelled Xóa vĩnh viễn, after Khôi phục', async () => {
      await mount('trash')
      await pick('doc-a')
      expect(bulk('purge')!.textContent).toBe('Xóa vĩnh viễn')
      expect(bulk('purge')!.classList.contains('danger')).toBe(true)
      expect(bulk('restore')!.classList.contains('danger')).toBe(false)
    })

    it('is absent from a shell without the purge call, Khôi phục stays', async () => {
      delete api.uniworkPurgeDocument
      await mount('trash')
      await pick('doc-a')
      expect(bulk('purge')).toBeNull()
      expect(bulk('restore')).not.toBeNull()
    })

    it('is absent on the live list and on the shelf', async () => {
      await mount()
      await pick('doc-a')
      expect(bulk('purge')).toBeNull()
      await act(async () => root.unmount())
      root = createRoot(host)
      await mount('archive')
      await pick('doc-a')
      expect(bulk('purge')).toBeNull()
    })

    it('a mixed selection hides it: one row the person cannot manage takes it away', async () => {
      items = [
        row({ id: 'doc-a' }),
        row({ id: 'doc-b', canManage: false, canEdit: true, myLevel: 'edit' }),
      ]
      await mount('trash')
      await pick('doc-a', 'doc-b')
      expect(bulk('purge')).toBeNull()
      expect(host.querySelectorAll('[data-bulk-action]')).toHaveLength(0)
    })

    it('an admin_scope row below manage offers purge but not restore', async () => {
      items = [
        row({ id: 'doc-a', canManage: false, canEdit: false, myLevel: 'view', adminScope: true }),
      ]
      await mount('trash')
      await pick('doc-a')
      expect(bulk('purge')).not.toBeNull()
      expect(bulk('restore')).toBeNull()
    })

    it('one confirm with the count and the web wording, nothing runs before it', async () => {
      await mount('trash')
      await pick('doc-a', 'doc-b')
      await click(bulk('purge'))
      expect(api.uniworkPurgeDocument).not.toHaveBeenCalled()
      expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1)
      const text = confirmDialog()!.textContent!
      expect(text).toContain('Xóa vĩnh viễn 2 tài liệu?')
      expect(text).toContain('Không thể hoàn tác. Mục bạn không có quyền sẽ được bỏ qua.')
      const confirm = document.body.querySelector('[data-bulk-confirm]')!
      expect(confirm.textContent).toBe('Xóa vĩnh viễn')
      expect(confirm.classList.contains('btn-danger')).toBe(true)
    })

    it('the focus starts on Hủy (a destructive dialog)', async () => {
      await mount('trash')
      await pick('doc-a')
      await click(bulk('purge'))
      expect(document.activeElement).toBe(document.body.querySelector('[data-bulk-cancel]'))
    })

    it('confirm: one call per row, "2/2" toast, one refresh, selection cleared', async () => {
      await mount('trash')
      await pick('doc-a', 'doc-b')
      const lists = api.uniworkListTrash!.mock.calls.length
      await click(bulk('purge'))
      await click(document.body.querySelector('[data-bulk-confirm]'))
      expect(api.uniworkPurgeDocument!.mock.calls.map((c) => c[0]).sort()).toEqual([
        'doc-a',
        'doc-b',
      ])
      expect(toast()).toContain('Đã xóa vĩnh viễn 2/2 tài liệu')
      expect(api.uniworkListTrash!.mock.calls.length - lists).toBe(1)
      expect(confirmDialog()).toBeNull()
      expect(bar()).toBeNull()
    })

    it('a double click on the confirm sends each row once', async () => {
      await mount('trash')
      await pick('doc-a', 'doc-b')
      await click(bulk('purge'))
      const confirm = document.body.querySelector<HTMLElement>('[data-bulk-confirm]')!
      await act(async () => {
        confirm.click()
        confirm.click()
      })
      await flush()
      expect(api.uniworkPurgeDocument).toHaveBeenCalledTimes(2)
    })

    it('cancel runs nothing and keeps the selection', async () => {
      await mount('trash')
      await pick('doc-a')
      await click(bulk('purge'))
      await click(document.body.querySelector('[data-bulk-cancel]'))
      expect(api.uniworkPurgeDocument).not.toHaveBeenCalled()
      expect(confirmDialog()).toBeNull()
      expect(bar()).not.toBeNull()
    })

    it('a refused row does not stop the batch: 2/3 and the commonest reason', async () => {
      api.uniworkPurgeDocument!.mockImplementation(async (id: string) =>
        id === 'doc-b'
          ? { ok: false, error: 'document_not_in_trash' }
          : { ok: true, value: { id } },
      )
      await mount('trash')
      await pick('doc-a', 'doc-b', 'doc-c')
      await click(bulk('purge'))
      await click(document.body.querySelector('[data-bulk-confirm]'))
      expect(api.uniworkPurgeDocument).toHaveBeenCalledTimes(3)
      expect(toast()).toContain('Đã xóa vĩnh viễn 2/3 tài liệu')
      expect(toast()).toContain('Mục này không còn trong thùng rác.')
    })
  })

  it('a viewer’s selection shows the bar without any action', async () => {
    items = items.map((d) => ({ ...d, canManage: false, canEdit: false, myLevel: 'view' }))
    await mount()
    await click(box('doc-a'))
    expect(bar()).not.toBeNull()
    expect(host.querySelectorAll('[data-bulk-action]')).toHaveLength(0)
  })

  describe('Tải xuống (UNI-2068 ZB)', () => {
    let zip: FakeZipBridge
    const zipBar = () => host.querySelector('[data-testid="zip-download-bar"]')
    beforeEach(() => {
      zip = fakeZipBridge()
      api.zipDownload = zip as unknown as ReturnType<typeof vi.fn>
      api.revealPath = vi.fn(async () => undefined)
    })

    it('is absent while this main has no zip bridge', async () => {
      delete api.zipDownload
      await mount()
      await click(box('doc-a'))
      expect(bulk('download')).toBeNull()
      expect(bulk('shelve')).not.toBeNull()
    })

    it('is a button between Lưu trữ and the rest once the bridge is there', async () => {
      await mount()
      await click(box('doc-a'))
      expect(
        Array.from(host.querySelectorAll('[data-bulk-action]')).map((e) =>
          e.getAttribute('data-bulk-action'),
        ),
      ).toEqual(['download', 'shelve', 'trash'])
      expect(bulk('download')!.textContent).toBe('Tải xuống')
    })

    it('shows for a page next to a file, not for a page alone', async () => {
      items = [...items, row({ id: 'page-1', kind: 'page', format: null, title: 'Ghi chú' })]
      await mount()
      await click(box('page-1'))
      expect(bulk('download')).toBeNull()
      await click(box('doc-a'))
      expect(bulk('download')).not.toBeNull()
    })

    it('the shelf lists folders as rows: a folder alone has no Download', async () => {
      items = [...items, row({ id: 'fold', kind: 'folder', title: 'Hồ sơ' })]
      await mount('archive')
      await click(box('fold'))
      expect(bulk('download')).toBeNull()
    })

    it('one file: a plain download named after it, no zip job, one result bar, selection cleared', async () => {
      await mount()
      await click(box('doc-b'))
      await click(bulk('download'))
      expect(zip.starts).toEqual([])
      expect(zip.files).toEqual([
        { workspaceId: 'ws-1', documentId: 'doc-b', suggestedName: 'doc-b.docx' },
      ])
      expect(zipBar()!.textContent).toContain('Đã tải xuống doc-b.docx')
      expect(bar()).toBeNull()
      // Hiện trong thư mục reveals the saved file
      const reveal = Array.from(zipBar()!.querySelectorAll('button')).find(
        (b) => b.textContent === 'Hiện trong thư mục',
      )
      await click(reveal)
      expect(api.revealPath).toHaveBeenCalledWith('/tmp/doc-b.docx')
      expect(zipBar()).toBeNull()
    })

    it('many files: one zip job with their ids, a bar that follows the run, then the result with the lines', async () => {
      items = [...items, row({ id: 'page-1', kind: 'page', format: null, title: 'Ghi chú' })]
      await mount()
      await click(box('doc-a'))
      await click(box('doc-b'))
      await click(box('page-1'))
      await click(bulk('download'))
      expect(zip.starts).toEqual([{ workspaceId: 'ws-1', documentIds: ['doc-a', 'doc-b'] }])
      expect(zipBar()!.getAttribute('data-phase')).toBe('building')
      expect(zipBar()!.textContent).toContain('Đang chuẩn bị tệp nén…')
      // the selection is released as soon as the run is accepted
      expect(bar()).toBeNull()

      await act(async () => {
        zip.push({ runId: 'run-1', phase: 'downloading', bytes: 25, totalBytes: 100 })
      })
      expect(zipBar()!.textContent).toContain('Đang tải xuống… 25%')
      expect(zipBar()!.querySelector('progress')!.value).toBe(25)

      await act(async () => {
        zip.push({
          runId: 'run-1',
          phase: 'done',
          bytes: 100,
          totalBytes: 100,
          fileCount: 2,
          path: '/home/u/documents.zip',
        })
      })
      const text = zipBar()!.textContent ?? ''
      expect(text).toContain('Đã tải xuống 2/3 tài liệu')
      expect(text).toContain('Ghi chú: không tải được (không phải tệp)')
      expect(text).toContain('Hiện trong thư mục')
    })

    it('Hủy on the bar cancels that run', async () => {
      await mount()
      await click(box('doc-a'))
      await click(box('doc-b'))
      await click(bulk('download'))
      const cancel = Array.from(zipBar()!.querySelectorAll('button')).find(
        (b) => b.textContent === 'Hủy',
      )
      await click(cancel)
      expect(zip.canceled).toEqual(['run-1'])
      await act(async () => {
        zip.push({ runId: 'run-1', phase: 'canceled' })
      })
      expect(zipBar()!.textContent).toContain('Đã hủy tải xuống')
    })

    it('a cancelled save dialog keeps the selection and shows nothing', async () => {
      zip.nextStart = { ok: false, code: 'dialog_canceled' }
      await mount()
      await click(box('doc-a'))
      await click(box('doc-b'))
      await click(bulk('download'))
      expect(zipBar()).toBeNull()
      expect(bar()!.querySelector('[data-bulk-count]')?.textContent).toBe('2 đã chọn')
    })

    it('the buttons wait while a download is under way, and the second press runs once', async () => {
      await mount()
      await click(box('doc-a'))
      await click(box('doc-b'))
      await click(bulk('download'))
      await click(box('doc-c'))
      await click(box('doc-a'))
      for (const el of host.querySelectorAll<HTMLButtonElement>('[data-bulk-action]')) {
        expect(el.disabled).toBe(true)
      }
      expect(zip.starts).toHaveLength(1)
    })

    it('the shelf downloads too', async () => {
      await mount('archive')
      await click(box('doc-a'))
      await click(box('doc-b'))
      await click(bulk('download'))
      expect(zip.starts[0]!.documentIds).toEqual(['doc-a', 'doc-b'])
    })
  })
})
