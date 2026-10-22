/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import { resetDocCopyAvailability } from '../src/renderer/src/uniwork-home/use-doc-copy'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'

/**
 * UNI-2078 slice 1: the Documents screen hosts Make a copy. The row menu offers it on live
 * files the person edits (after Move), the dialog copies, the list is re-read and a toast names the
 * copy - the screen does not navigate. A deployment without the route hides the entry for the
 * rest of the session.
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

const base = {
  workspaceId: 'ws-1',
  updatedAt: '2026-10-12T09:00:00.000Z',
  parentId: null,
} as const

const rows: DocumentsHomeDoc[] = [
  {
    ...base,
    id: 'doc-e',
    title: 'Bảng giá.xlsx',
    format: 'xlsx',
    kind: 'file',
    myLevel: 'edit',
    canEdit: true,
    canManage: false,
  },
  {
    ...base,
    id: 'doc-v',
    title: 'Chỉ xem.docx',
    format: 'docx',
    kind: 'file',
    myLevel: 'view',
    canEdit: false,
    canManage: false,
  },
  {
    ...base,
    id: 'doc-o',
    title: 'Kết quả.docx',
    format: 'docx',
    kind: 'file',
    myLevel: 'manage',
    canEdit: true,
    canManage: true,
    ownerKind: 'work_product',
  },
  {
    ...base,
    id: 'page-m',
    title: 'Ghi chú',
    format: null,
    kind: 'page',
    myLevel: 'manage',
    canEdit: true,
    canManage: true,
  },
  {
    ...base,
    id: 'fold-m',
    title: 'Dự án',
    format: null,
    kind: 'folder',
    myLevel: 'manage',
    canEdit: true,
    canManage: true,
  },
]

describe('Make a copy in the Documents home (UNI-2078)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let onOpenDocument: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    resetDocCopyAvailability()
    onOpenDocument = vi.fn()
    api = {
      uniworkFolderTree: vi.fn(async () => ok([])),
      uniworkListChildren: vi.fn(async () => ok({ items: rows, nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkCopyDocument: vi.fn(async () => ({
        ok: true,
        value: { id: 'copy-1', title: 'Bảng giá (bản sao).xlsx' },
      })),
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
  const ids = (items: HTMLButtonElement[]) => items.map((i) => i.getAttribute('data-folder-action'))
  const closeMenu = async () => {
    await act(async () => {
      document.body.click()
    })
  }

  async function openDialog() {
    const items = await menuOf('.dh-doc-row[data-doc-id="doc-e"]')
    await act(async () => {
      action(items, 'duplicate')!.click()
    })
    await flush()
  }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const consent = () => dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  const submit = () => dialog()!.querySelector<HTMLButtonElement>('button.btn-primary')!
  async function copyNow() {
    await act(async () => consent().click())
    await act(async () => submit().click())
    await flush()
  }

  it('offers Tạo bản sao right after Move on a file the person edits', async () => {
    await mount()
    const items = await menuOf('.dh-doc-row[data-doc-id="doc-e"]')
    expect(action(items, 'duplicate')?.textContent?.trim()).toBe('Tạo bản sao')
    const order = ids(items)
    expect(order.indexOf('duplicate')).toBe(order.indexOf('move') + 1)
  })

  it('offers it on no view-level, work-product, page or folder row', async () => {
    await mount()
    for (const selector of [
      '.dh-doc-row[data-doc-id="doc-v"]',
      '.dh-doc-row[data-doc-id="doc-o"]',
      '.dh-doc-row[data-doc-id="page-m"]',
      '.dh-folder-card[data-folder-id="fold-m"]',
    ]) {
      expect(ids(await menuOf(selector)), selector).not.toContain('duplicate')
      await closeMenu()
    }
  })

  it('offers no entry when this shell has no copy bridge (a stale preload)', async () => {
    delete api.uniworkCopyDocument
    await mount()
    expect(ids(await menuOf('.dh-doc-row[data-doc-id="doc-e"]'))).not.toContain('duplicate')
  })

  it('opens the dialog for that row; nothing is sent until the consent is checked', async () => {
    await mount()
    await openDialog()
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('Tạo bản sao')
    await act(async () => submit().click())
    await flush()
    expect(api.uniworkCopyDocument).not.toHaveBeenCalled()
  })

  it('copies, closes, re-reads the list and toasts the copy; it does not navigate', async () => {
    await mount()
    const reads = api.uniworkListChildren!.mock.calls.length
    await openDialog()
    await copyNow()
    expect(api.uniworkCopyDocument).toHaveBeenCalledTimes(1)
    const sent = api.uniworkCopyDocument!.mock.calls[0]![0] as Record<string, unknown>
    expect(sent.documentId).toBe('doc-e')
    expect('title' in sent).toBe(false)
    expect(dialog()).toBeNull()
    expect(api.uniworkListChildren!.mock.calls.length).toBeGreaterThan(reads)
    const toast = host.querySelector('.uw-act-toast')
    expect(toast?.textContent).toContain('Đã tạo bản sao "Bảng giá (bản sao).xlsx"')
    expect(onOpenDocument).not.toHaveBeenCalled()
  })

  it('a refusal stays in the dialog and the list is not re-read', async () => {
    api.uniworkCopyDocument!.mockResolvedValueOnce({ ok: false, error: 'owner_requires_copy' })
    await mount()
    const reads = api.uniworkListChildren!.mock.calls.length
    await openDialog()
    await copyNow()
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toContain('Kết quả công việc')
    expect(api.uniworkListChildren!.mock.calls.length).toBe(reads)
    expect(host.querySelector('.uw-act-toast')).toBeNull()
  })

  it('a deployment without the route hides the entry for the rest of the session', async () => {
    api.uniworkCopyDocument!.mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      endpointMissing: true,
    })
    await mount()
    await openDialog()
    await copyNow()
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe(
      'Bản triển khai này chưa có chức năng tạo bản sao.',
    )
    await act(async () => {
      dialog()!.querySelector<HTMLButtonElement>('button.btn-secondary')!.click()
    })
    await flush()
    expect(dialog()).toBeNull()
    expect(ids(await menuOf('.dh-doc-row[data-doc-id="doc-e"]'))).not.toContain('duplicate')
  })
})
