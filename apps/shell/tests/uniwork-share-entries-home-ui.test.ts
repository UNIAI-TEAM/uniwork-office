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
import {
  createFakeShareApi,
  type FakeShareApi,
} from '../src/renderer/src/uniwork-share/fake-share-api'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'
import { DOC_SHARE_CHANGED_EVENT } from '../src/renderer/src/uniwork-folders/first-save-share'
import type { ShareBulkPlan } from '../src/shared/share-api'

/**
 * UNI-2047 SD-C: the Share entries wired into the Documents page: the Access cell button, the
 * row menu's "Chia sẻ" and the bulk bar open ONE ShareDialog / BulkShareDialog mounted by
 * DocumentsHome; a change refetches the list once, and so does the first-save share event.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })
const vi_ = uniworkShareStrings.vi as Record<string, string>
const t = (key: string, params?: Record<string, string | number>) =>
  (vi_[key] ?? key).replace(/\{(\w+)\}/g, (w, n: string) =>
    params && n in params ? String(params[n]) : w,
  )

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
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

describe('DocumentsHome mounts the Share dialogs (UNI-2047 SD-C)', () => {
  const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let share: FakeShareApi
  let items: DocumentsHomeDoc[]
  let onOpenDocument: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    items = [
      row({ id: 'doc-a', title: 'Hợp đồng.docx' }),
      row({ id: 'doc-b', title: 'Báo giá.docx' }),
      row({
        id: 'doc-v',
        title: 'Chỉ xem.docx',
        myLevel: 'view',
        canManage: false,
        canEdit: false,
      }),
      row({ id: 'fld', title: 'Thư mục', kind: 'folder' }),
    ]
    share = createFakeShareApi({ documentId: 'doc-a' })
    ;(window as unknown as { uniworkShare: unknown }).uniworkShare = share
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
      uniworkListChildren: vi.fn(async () => ok({ items, nextCursor: null })),
      uniworkListDocuments: vi.fn(async () => ok({ documents: items, nextCursor: null })),
      uniworkListTrash: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListShelved: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListSources: vi.fn(async () => ok({ items: [], nextCursor: null })),
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
    await act(async () => root.unmount())
    host.remove()
    sidebarSlot.remove()
    delete (window as unknown as { uniworkShare?: unknown }).uniworkShare
    document.body.innerHTML = ''
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
            onOpenDocument,
            sidebarHost: sidebarSlot,
            initialSubView: 'workspace',
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
  const cellButton = (id: string) =>
    host.querySelector<HTMLButtonElement>(`[data-doc-id="${id}"] [data-col="access"] button`)
  const box = (id: string) =>
    host.querySelector<HTMLInputElement>(`[data-doc-id="${id}"] input[type="checkbox"]`)
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
  const listCalls = () => api.uniworkListChildren!.mock.calls.length
  const bulkPlans = () =>
    share.calls.filter((c) => c.method === 'bulk').map((c) => c.args[0] as ShareBulkPlan)

  it('the cell button names the action; gated rows stay text', async () => {
    await mount()
    const nameOf = (id: string) =>
      (cellButton(id)!.getAttribute('aria-labelledby') ?? '')
        .split(' ')
        .map((x) => document.getElementById(x)?.textContent ?? '')
        .join(' ')
    expect(nameOf('doc-a')).toContain('Quản lý quyền truy cập của Hợp đồng.docx')
    expect(nameOf('doc-v')).toContain('Xem quyền truy cập của Chỉ xem.docx')
    expect(cellButton('fld')).toBeNull()
  })

  it('a cell click opens the Share dialog for that row and never the document', async () => {
    await mount()
    await click(cellButton('doc-a'))
    expect(onOpenDocument).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('Hợp đồng.docx')
    expect(share.calls.some((c) => c.method === 'get' && c.args[0] === 'doc-a')).toBe(true)
    // Esc closes it again
    await act(async () => {
      dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(dialog()).toBeNull()
  })

  it('a viewer row opens the same dialog, read-only', async () => {
    share = createFakeShareApi({ documentId: 'doc-v', myLevel: 'view' })
    ;(window as unknown as { uniworkShare: unknown }).uniworkShare = share
    await mount()
    await click(cellButton('doc-v'))
    expect(dialog()).not.toBeNull()
    expect(dialog()!.querySelector('[data-share-section="add"]')).toBeNull()
  })

  it('the row menu offers Chia sẻ (gated) and opens the same dialog', async () => {
    await mount()
    await click(host.querySelector('button[data-folder-menu-for="doc-a"]'))
    const entries = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    const labels = entries.map((e) => e.textContent)
    expect(labels).toContain('Chia sẻ')
    expect(labels.indexOf('Chia sẻ')).toBeLessThan(labels.indexOf('Sao chép link'))
    await click(entries.find((e) => e.textContent === 'Chia sẻ'))
    expect(dialog()!.textContent).toContain('Hợp đồng.docx')
    expect(onOpenDocument).not.toHaveBeenCalled()
  })

  it('a folder row menu has no Chia sẻ', async () => {
    await mount()
    await click(host.querySelector('button[data-folder-menu-for="fld"]'))
    const labels = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(
      (e) => e.textContent,
    )
    expect(labels).not.toContain('Chia sẻ')
  })

  it('without the share bridge there is no button, no menu item and no bulk action', async () => {
    delete (window as unknown as { uniworkShare?: unknown }).uniworkShare
    await mount()
    expect(cellButton('doc-a')).toBeNull()
    await click(box('doc-a'))
    expect(host.querySelector('[data-bulk-action="share"]')).toBeNull()
  })

  it('a change inside the dialog refetches the list once', async () => {
    await mount()
    await click(cellButton('doc-a'))
    const before = listCalls()
    const create = Array.from(
      dialog()!.querySelectorAll<HTMLElement>('[data-share-section="links"] button'),
    ).find((b) => b.textContent?.trim() === t('shrLinkCreate'))
    await click(create)
    expect(listCalls() - before).toBe(1)
  })

  it('the first-save share event refetches the list once', async () => {
    await mount()
    const before = listCalls()
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DOC_SHARE_CHANGED_EVENT, {
          detail: { documentId: 'doc-a', workspaceId: 'ws-1' },
        }),
      )
    })
    await flush()
    expect(listCalls() - before).toBe(1)
  })

  it('the listener is gone after unmount', async () => {
    await mount()
    await act(async () => root.unmount())
    const before = listCalls()
    window.dispatchEvent(new CustomEvent(DOC_SHARE_CHANGED_EVENT, { detail: {} }))
    await flush()
    expect(listCalls()).toBe(before)
    root = createRoot(host)
  })

  it('bulk: Chia sẻ shows for manageable rows, opens the bulk dialog, runs the plan, refetches once', async () => {
    await mount()
    await click(box('doc-a'))
    await click(box('doc-b'))
    const action = host.querySelector('[data-bulk-action="share"]')
    expect(action?.textContent).toBe('Chia sẻ')
    await click(action)
    const d = dialog()!
    expect(d.textContent).toContain('Chia sẻ 2 tài liệu')

    const before = listCalls()
    const workspace = d.querySelector<HTMLSelectElement>('[data-bulk-workspace]')!
    await act(async () => {
      workspace.value = 'view'
      workspace.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(d.querySelector('[data-bulk-submit]'))
    // the rows go in the order of the table (sorted by name), each with its own workspace
    expect(bulkPlans()).toHaveLength(1)
    const plan = bulkPlans()[0]!
    expect(plan.docs.map((d) => d.id).sort()).toEqual(['doc-a', 'doc-b'])
    expect(plan.docs.every((d) => d.workspaceId === 'ws-1')).toBe(true)
    expect(plan).toMatchObject({
      people: [],
      onExisting: 'keep',
      workspace: 'view',
      link: 'keep',
    })
    expect(listCalls() - before).toBe(1)
    // the summary toast of the page and the dialog gone
    expect(document.body.querySelector('.uw-act-toast')?.textContent).toContain(
      'Đã chia sẻ 2/2 tài liệu',
    )
    expect(dialog()).toBeNull()
    // the selection is cleared
    expect(host.querySelector('[data-bulk-bar]')).toBeNull()
  })

  it('bulk: a viewer row or a folder in the selection hides Chia sẻ', async () => {
    await mount()
    await click(box('doc-a'))
    await click(box('doc-v'))
    expect(host.querySelector('[data-bulk-action="share"]')).toBeNull()
  })
})
