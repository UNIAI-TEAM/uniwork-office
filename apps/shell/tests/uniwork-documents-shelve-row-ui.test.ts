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
 * UNI-1961 slice B, step 5: the web's live-row "Lưu trữ" (D
 * documents-library-row.tsx + use-shelved-actions.tsx) for FILES and PAGES
 * the viewer manages: shelve at once, then a toast with Hoàn tác that
 * unshelves it. Folders (the archive-impact confirm) stay out of this slice.
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

const rows: DocumentsHomeDoc[] = [
  {
    id: 'fold-m',
    workspaceId: 'ws-1',
    title: 'Dự án',
    format: null,
    updatedAt: '2026-10-10T09:00:00.000Z',
    kind: 'folder',
    parentId: null,
    myLevel: 'manage',
    canManage: true,
    canEdit: true,
  },
  {
    id: 'doc-m',
    workspaceId: 'ws-1',
    title: 'Hợp đồng.docx',
    format: 'docx',
    updatedAt: '2026-10-12T09:00:00.000Z',
    kind: 'file',
    parentId: null,
    myLevel: 'manage',
    canManage: true,
    canEdit: true,
  },
  {
    id: 'page-m',
    workspaceId: 'ws-1',
    title: 'Ghi chú họp',
    format: null,
    updatedAt: '2026-10-11T09:00:00.000Z',
    kind: 'page',
    parentId: null,
    myLevel: 'manage',
    canManage: true,
    canEdit: true,
  },
  {
    id: 'doc-e',
    workspaceId: 'ws-1',
    title: 'Bảng giá.xlsx',
    format: 'xlsx',
    updatedAt: '2026-10-09T09:00:00.000Z',
    kind: 'file',
    parentId: null,
    myLevel: 'edit',
    canManage: false,
    canEdit: true,
  },
]

describe('UNI-1961 live-row Lưu trữ (shelve) in the Documents home', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    api = {
      uniworkFolderTree: vi.fn(async () => ok([])),
      uniworkListChildren: vi.fn(async () => ok({ items: rows, nextCursor: null })),
      uniworkShelveDocument: vi.fn(async (id: string) =>
        ok({
          document: { ...rows.find((d) => d.id === id)!, shelvedAt: '2026-10-20T09:00:00Z' },
          affected: [id],
        }),
      ),
      uniworkUnshelveDocument: vi.fn(async (id: string) =>
        ok({ document: rows.find((d) => d.id === id)!, affected: [id] }),
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

  async function mount(lang: 'vi' | 'en' = 'vi') {
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
          }),
        ),
      )
    })
    await flush()
  }

  async function menuOf(selector: string): Promise<HTMLButtonElement[]> {
    const kebab = host.querySelector<HTMLButtonElement>(`${selector} .uw-row-menu-btn`)
    expect(kebab, `⋯ of ${selector}`).not.toBeNull()
    await act(async () => {
      kebab!.click()
    })
    await flush()
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>('.uw-row-menu-list [role="menuitem"]'),
    )
  }

  const action = (items: HTMLButtonElement[], id: string) =>
    items.find((i) => i.getAttribute('data-folder-action') === id)

  it('offers Lưu trữ on file and page rows the viewer manages, before the trash item', async () => {
    await mount()
    const fileItems = await menuOf('.dh-doc-row[data-doc-id="doc-m"]')
    const shelve = action(fileItems, 'shelve')
    expect(shelve?.textContent?.trim()).toBe('Lưu trữ')
    // F2: the trash command beside it is a different command with its own words
    expect(action(fileItems, 'trash')?.textContent?.trim()).toBe('Chuyển vào thùng rác')
    expect(fileItems.map((i) => i.textContent?.trim()).filter((l) => l === 'Lưu trữ')).toHaveLength(
      1,
    )
    const ids = fileItems.map((i) => i.getAttribute('data-folder-action'))
    expect(ids.indexOf('shelve')).toBeGreaterThan(-1)
    expect(ids.indexOf('shelve')).toBeLessThan(ids.indexOf('trash'))
    await act(async () => {
      document.body.click()
    })

    const pageItems = await menuOf('.dh-doc-row[data-doc-id="page-m"]')
    expect(action(pageItems, 'shelve')).toBeDefined()
  })

  it('never offers it below manage, nor on a folder card (folder shelve is out of this slice)', async () => {
    await mount()
    const editItems = await menuOf('.dh-doc-row[data-doc-id="doc-e"]')
    expect(action(editItems, 'shelve')).toBeUndefined()
    const folderItems = await menuOf('.dh-folder-card[data-folder-id="fold-m"]')
    expect(action(folderItems, 'shelve')).toBeUndefined()
  })

  it('shelves at once, toasts with Hoàn tác, rereads the list, and Hoàn tác unshelves it', async () => {
    await mount()
    expect(api.uniworkListChildren).toHaveBeenCalledTimes(1)
    const items = await menuOf('.dh-doc-row[data-doc-id="doc-m"]')
    await act(async () => {
      action(items, 'shelve')!.click()
    })
    await flush()
    expect(api.uniworkShelveDocument).toHaveBeenCalledTimes(1)
    expect(api.uniworkShelveDocument).toHaveBeenCalledWith('doc-m')
    // no confirm for a file: nothing archived to the trash
    expect(api.uniworkArchiveDocument).not.toHaveBeenCalled()
    const toast = host.querySelector('.uw-act-toast')
    expect(toast?.textContent).toContain('Đã lưu trữ Hợp đồng.docx')
    expect(api.uniworkListChildren).toHaveBeenCalledTimes(2)

    const undo = toast!.querySelector<HTMLButtonElement>('.uw-act-toast-action')
    expect(undo?.textContent?.trim()).toBe('Hoàn tác')
    await act(async () => {
      undo!.click()
    })
    await flush()
    expect(api.uniworkUnshelveDocument).toHaveBeenCalledWith('doc-m')
    expect(host.querySelector('.uw-act-toast')?.textContent).toContain(
      'Đã bỏ lưu trữ Hợp đồng.docx',
    )
    expect(api.uniworkListChildren).toHaveBeenCalledTimes(3)
  })

  it('shows the web error lines for a refused shelve', async () => {
    api.uniworkShelveDocument!.mockResolvedValueOnce({ ok: false, error: 'forbidden' })
    await mount()
    let items = await menuOf('.dh-doc-row[data-doc-id="page-m"]')
    await act(async () => {
      action(items, 'shelve')!.click()
    })
    await flush()
    expect(host.querySelector('.uw-act-toast')?.textContent).toContain('Bạn không quản lý mục này.')

    api.uniworkShelveDocument!.mockResolvedValueOnce({ ok: false, error: 'conflict' })
    items = await menuOf('.dh-doc-row[data-doc-id="page-m"]')
    await act(async () => {
      action(items, 'shelve')!.click()
    })
    await flush()
    expect(host.querySelector('.uw-act-toast')?.textContent).toContain(
      'Không lưu trữ được. Chưa có gì thay đổi.',
    )
  })

  it('a shelved search hit offers no Rename or Move (the server answers 409 document_shelved)', async () => {
    const hit = (over: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
      workspaceId: 'ws-1',
      title: `${over.id}.docx`,
      format: 'docx',
      updatedAt: '2026-10-12T09:00:00.000Z',
      kind: 'file',
      parentId: null,
      myLevel: 'manage',
      canManage: true,
      canEdit: true,
      ...over,
    })
    api.uniworkSearchDocuments!.mockResolvedValue(
      ok({
        items: [
          hit({ id: 'hit-shelved', title: 'Hợp đồng cũ.docx', shelvedAt: '2026-10-01T09:00:00Z' }),
          hit({ id: 'hit-live', title: 'Hợp đồng mới.docx' }),
        ],
        nextCursor: null,
      }),
    )
    await mount()
    const input = host.querySelector<HTMLInputElement>('input.uwf-own-search')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'Hợp đồng',
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    const ids = (items: HTMLButtonElement[]) =>
      items.map((i) => i.getAttribute('data-folder-action'))

    const shelved = ids(await menuOf('.dh-doc-row[data-doc-id="hit-shelved"]'))
    expect(shelved).toContain('open')
    expect(shelved).not.toContain('rename')
    expect(shelved).not.toContain('move')
    expect(shelved).not.toContain('offline')
    expect(shelved).not.toContain('shelve')
    await act(async () => {
      document.body.click()
    })

    const live = ids(await menuOf('.dh-doc-row[data-doc-id="hit-live"]'))
    expect(live).toEqual(expect.arrayContaining(['open', 'rename', 'move', 'shelve']))
  })

  it('speaks the web English copy', async () => {
    localStorage.setItem('genoffice.lang', 'en')
    await mount('en')
    const items = await menuOf('.dh-doc-row[data-doc-id="doc-m"]')
    expect(action(items, 'shelve')?.textContent?.trim()).toBe('Archive')
    await act(async () => {
      action(items, 'shelve')!.click()
    })
    await flush()
    const toast = host.querySelector('.uw-act-toast')
    expect(toast?.textContent).toContain('Archived Hợp đồng.docx')
    expect(toast?.querySelector('.uw-act-toast-action')?.textContent?.trim()).toBe('Undo')
  })
})
