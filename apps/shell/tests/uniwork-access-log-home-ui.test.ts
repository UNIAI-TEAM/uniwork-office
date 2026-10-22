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
import { uniworkAccessLogStrings } from '../src/renderer/src/i18n/strings-uniwork-access-log'
import { createFakeDocHistoryBridge, type FakeDocHistoryBridge } from './doc-history-fake-bridge'

/**
 * UNI-2077 UI-L: the Access log entry of the Documents row menu: who sees it (the web gate), and
 * that it opens ONE sheet for that row, mounted by DocumentsHome.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })
const vi_ = uniworkAccessLogStrings.vi as Record<string, string>
const ENTRY = vi_.algMenu!

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

describe('DocumentsHome mounts the Access log sheet (UNI-2077 UI-L)', () => {
  const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let history: FakeDocHistoryBridge
  let items: DocumentsHomeDoc[]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    items = [
      row({ id: 'doc-a', title: 'Hợp đồng.docx' }),
      row({
        id: 'doc-v',
        title: 'Chỉ xem.docx',
        myLevel: 'view',
        canManage: false,
        canEdit: false,
      }),
      row({ id: 'doc-e', title: 'Sửa được.docx', myLevel: 'edit', canManage: false }),
      row({ id: 'doc-s', title: 'Lưu trữ.docx', shelvedAt: '2026-10-01T00:00:00Z' }),
      row({ id: 'doc-o', title: 'Của task.docx', ownerKind: 'task' }),
      row({ id: 'doc-m', title: 'Chia sẻ lại.docx', myLevel: 'view', adminScope: true }),
    ]
    history = createFakeDocHistoryBridge({ logs: [] })
    ;(window as unknown as { uniworkDocHistory?: unknown }).uniworkDocHistory = history
    const api = {
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
    delete (window as unknown as { uniworkDocHistory?: unknown }).uniworkDocHistory
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
            onOpenDocument: vi.fn(),
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
  const menuLabels = async (id: string): Promise<string[]> => {
    await click(host.querySelector(`button[data-folder-menu-for="${id}"]`))
    return Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (e) => e.textContent ?? '',
    )
  }
  const entry = () =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (e) => e.textContent === ENTRY,
    )
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')

  it('a managed document offers the entry; opening it asks the bridge for that document', async () => {
    await mount()
    expect(await menuLabels('doc-a')).toContain(ENTRY)
    await click(entry())
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain(vi_.algDescription)
    expect(history.accessLogs).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-a' }),
    )
    // Esc closes it
    await act(async () => {
      dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(dialog()).toBeNull()
  })

  it('an admin scope row offers it too', async () => {
    await mount()
    expect(await menuLabels('doc-m')).toContain(ENTRY)
  })

  it('viewers, editors, other modules and shelved rows never see it', async () => {
    await mount()
    for (const id of ['doc-v', 'doc-e', 'doc-o', 'doc-s']) {
      const labels = await menuLabels(id)
      expect(labels.length).toBeGreaterThan(0)
      expect(labels, id).not.toContain(ENTRY)
      // close the menu before the next one
      await act(async () => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      await flush()
    }
  })

  it('an old main without the bridge leaves no dead entry', async () => {
    delete (window as unknown as { uniworkDocHistory?: unknown }).uniworkDocHistory
    await mount()
    const labels = await menuLabels('doc-a')
    expect(labels.length).toBeGreaterThan(0)
    expect(labels).not.toContain(ENTRY)
  })
})
