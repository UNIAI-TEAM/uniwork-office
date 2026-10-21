/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import {
  DOCUMENTS_HOME_NAV_ENTRIES,
  visibleDocumentsHomeNavEntries,
  type DocumentsHomeDoc,
} from '../src/renderer/src/uniwork-home/documents-home-model'

/**
 * UNI-2047 B0: the subfolders of a workspace root / folder page. The doclist-canvas Rules board names
 * the page's header block "Thư mục" (it does not draw folders as table rows), so the cards stay a block
 * above the shared table; their menu starts with Mở like every other row menu (Rules §3), and "Thư mục
 * của tôi" is reached the way the web sidebar lists it: a tree row (a stand-in until it exists), never a
 * second sub-nav entry.
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

const folder = (
  id: string,
  title: string,
  extra: Partial<DocumentsHomeDoc> = {},
): DocumentsHomeDoc => ({
  id,
  workspaceId: 'ws-1',
  title,
  format: null,
  updatedAt: '2026-10-10T09:00:00.000Z',
  kind: 'folder',
  parentId: null,
  myLevel: 'manage',
  canManage: true,
  canEdit: true,
  ...extra,
})

const rows: DocumentsHomeDoc[] = [
  folder('fold-m', 'Dự án'),
  folder('fold-mine', 'my-folder-raw', { systemKind: 'my_folder' }),
  folder('fold-ro', 'Chỉ đọc', { myLevel: 'view', canManage: false, canEdit: false }),
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
]

describe('UNI-2047 B0 subfolders on workspace and folder pages', () => {
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

  const ids = (items: HTMLButtonElement[]) => items.map((i) => i.getAttribute('data-folder-action'))

  it('keeps the subfolders as the "Thư mục" block above the table, never as table rows', async () => {
    await mount()
    const block = host.querySelector('.dh-folders-section')
    expect(block?.querySelector('.dh-section-title')?.textContent).toBe('Thư mục')
    expect(Array.from(block!.querySelectorAll('.dh-folder-card')).length).toBe(3)
    // the shared table lists documents only
    expect(host.querySelector('.dh-doc-row[data-doc-id="fold-m"]')).toBeNull()
    expect(host.querySelector('.dh-doc-row[data-doc-id="doc-m"]')).not.toBeNull()
  })

  it('opens a folder card on click through its name button', async () => {
    await mount()
    api.uniworkListChildren.mockClear()
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '.dh-folder-card[data-folder-id="fold-m"] .dh-folder-open',
        )!
        .click()
    })
    await flush()
    expect(JSON.stringify(api.uniworkListChildren.mock.calls)).toContain('fold-m')
  })

  it('starts the card menu with Mở, then the folder commands in the shared order', async () => {
    await mount()
    const items = await menuOf('.dh-folder-card[data-folder-id="fold-m"]')
    // the trash closes the list for a manageable folder, as the web's card menu does (UNI-2066 WS-V4)
    expect(ids(items)).toEqual(['open', 'new', 'rename', 'move', 'trash'])
    expect(items[0]!.textContent?.trim()).toBe('Mở')
    api.uniworkListChildren.mockClear()
    await act(async () => {
      items[0]!.click()
    })
    await flush()
    expect(JSON.stringify(api.uniworkListChildren.mock.calls)).toContain('fold-m')
  })

  it('offers My Folder only Mở and the new subfolder (no rename, move)', async () => {
    await mount()
    const items = await menuOf('.dh-folder-card[data-folder-id="fold-mine"]')
    expect(ids(items)).toEqual(['open', 'new'])
  })

  it('draws no menu on a folder the viewer cannot edit (the card itself opens it)', async () => {
    await mount()
    const card = host.querySelector('.dh-folder-card[data-folder-id="fold-ro"]')
    expect(card).not.toBeNull()
    expect(card!.querySelector('.uw-row-menu-btn')).toBeNull()
  })

  it('reaches Thư mục của tôi through the sidebar tree row, not a second sub-nav entry', async () => {
    expect(DOCUMENTS_HOME_NAV_ENTRIES.find((e) => e.id === 'my-folder')?.available).toBe(false)
    expect(visibleDocumentsHomeNavEntries().map((e) => e.id)).not.toContain('my-folder')
    await mount()
    expect(sidebarSlot.querySelector('.dh-subnav [data-nav="my-folder"]')).toBeNull()
    // no My Folder node in the fixture tree: the stand-in row is the way in, and it opens the page
    const standIn = sidebarSlot.querySelector<HTMLButtonElement>('[data-my-folder-standin]')
    expect(standIn?.textContent).toContain('Thư mục của tôi')
    await act(async () => {
      standIn!.click()
    })
    await flush()
    expect(host.querySelector('.dh-title')?.textContent).toBe('Thư mục của tôi')
  })
})
