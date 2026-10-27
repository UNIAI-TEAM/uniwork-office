/**
 * @vitest-environment jsdom
 */
// UNI-2244: "Share documents inside…" wired into the Documents page: the open folder's header
// menu, the folder card and the sidebar tree row, each for every reader of the folder, and the
// one FolderContentsAccessDialog DocumentsHome mounts. The list row's own entry (the shared row
// menu model) is pinned in doclist-share-entries.test.ts.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkResult,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'
import { createFakeShareApi } from '../src/renderer/src/uniwork-share/fake-share-api'
import {
  resetFolderBatchesForTest,
  trackFolderBatch,
} from '../src/renderer/src/uniwork-share/folder-contents-access-store'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })
const en = uniworkShareStrings.en as Record<string, string>
const ENTRY = en.shrFcMenu!

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const folderRow = (partial: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
  workspaceId: 'ws-1',
  title: partial.id,
  format: null,
  updatedAt: '2026-10-21T02:05:00.000Z',
  kind: 'folder',
  parentId: null,
  visibility: 'workspace',
  myLevel: 'manage',
  canEdit: true,
  canManage: true,
  ...partial,
})

describe('Share documents inside… in the Documents page (UNI-2244)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let workspaces: UniworkWorkspaceRef[]
  let folderTree: UniworkFolderNode[]
  let cards: DocumentsHomeDoc[]

  beforeEach(() => {
    resetFolderBatchesForTest()
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'en')
    document.documentElement.lang = 'en'
    workspaces = [{ id: 'ws-1', name: 'UniWork', slug: 'uniwork' }]
    folderTree = [
      {
        id: 'f-mine',
        parentId: null,
        title: 'My Folder',
        position: 0,
        systemKind: 'my_folder',
        children: [],
      },
      {
        id: 'f-alpha',
        parentId: null,
        title: 'Alpha Folder',
        position: 1,
        children: [
          { id: 'f-beta', parentId: 'f-alpha', title: 'Beta Leaf', position: 0, children: [] },
        ],
      },
    ]
    cards = [
      folderRow({ id: 'f-card', title: 'Editable card' }),
      folderRow({
        id: 'f-view',
        title: 'Viewer card',
        myLevel: 'view',
        canEdit: false,
        canManage: false,
      }),
    ]
    const api: Record<string, ReturnType<typeof vi.fn>> = {
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async () => ok(folderTree)),
      uniworkEnsureMyFolder: vi.fn(async () => ok(folderTree[0]!)),
      uniworkListChildren: vi.fn(async (): Promise<UniworkResult<UniworkFolderChildren>> =>
        ok({ items: cards, nextCursor: null }),
      ),
      uniworkListDocuments: vi.fn(async () => ok({ documents: cards, nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
    }
    ;(window as unknown as { aiOffice: unknown; home: unknown }).aiOffice = api
    ;(window as unknown as { aiOffice: unknown; home: unknown }).home = api
    ;(window as unknown as { uniworkShare: unknown }).uniworkShare = createFakeShareApi({
      folderContents: { folderId: 'f-beta' },
    })
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
    resetFolderBatchesForTest()
    document.body.innerHTML = ''
  })

  async function mount(initialFolderId?: string): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument: vi.fn(),
            sidebarHost: sidebarSlot,
            initialSubView: 'workspace',
            ...(initialFolderId ? { initialFolderId } : {}),
          }),
        ),
      )
    })
    await flush()
  }
  const labels = () =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (i) => i.textContent,
    )
  const click = async (el: Element | null | undefined) => {
    expect(el).toBeTruthy()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
    await flush()
  }
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')

  it('the open folder header menu offers it first, and it opens the dialog for that folder', async () => {
    await mount('f-beta')
    const crumb = host.querySelector<HTMLElement>('.dh-main h1')!.closest('li.uwf-crumb')!
    await click(crumb.querySelector('button[data-folder-menu-for]'))
    expect(labels()).toEqual([ENTRY, 'New subfolder', 'Rename', 'Move to…'])
    await click(
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (i) => i.textContent === ENTRY,
      ),
    )
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain(en.shrFcScope!.replace('{title}', 'Beta Leaf'))
  })

  it('a folder card menu offers it right after Open', async () => {
    await mount()
    await click(host.querySelector('button[data-folder-menu-for="f-card"]'))
    const items = labels()
    expect(items).toContain(ENTRY)
    expect(items.indexOf(ENTRY)).toBe(items.indexOf('Open') + 1)
  })

  it('a viewer-only folder card still has a menu: Open and the entry', async () => {
    await mount()
    await click(host.querySelector('button[data-folder-menu-for="f-view"]'))
    expect(labels()).toEqual(['Open', ENTRY])
  })

  it('a sidebar tree row menu offers it right after Open and opens the dialog', async () => {
    await mount()
    const alpha = Array.from(sidebarSlot.querySelectorAll<HTMLElement>('li[role="treeitem"]')).find(
      (li) => li.textContent?.includes('Alpha Folder'),
    )
    await click(alpha!.querySelector('[data-folder-menu-for]'))
    const items = labels()
    expect(items).toContain(ENTRY)
    expect(items.indexOf(ENTRY)).toBe(items.indexOf('Open') + 1)
    await click(
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (i) => i.textContent === ENTRY,
      ),
    )
    expect(dialog()!.textContent).toContain(en.shrFcScope!.replace('{title}', 'Alpha Folder'))
  })

  it('no entry anywhere without the share bridge (a stale preload)', async () => {
    delete (window as unknown as { uniworkShare?: unknown }).uniworkShare
    await mount('f-beta')
    const crumb = host.querySelector<HTMLElement>('.dh-main h1')!.closest('li.uwf-crumb')!
    await click(crumb.querySelector('button[data-folder-menu-for]'))
    expect(labels()).not.toContain(ENTRY)
  })

  it('My Folder (own) offers it in its header menu too', async () => {
    await mount('f-mine')
    const crumb = host.querySelector<HTMLElement>('.dh-main h1')!.closest('li.uwf-crumb')!
    await click(crumb.querySelector('button[data-folder-menu-for]'))
    expect(labels()).toEqual([ENTRY, 'New subfolder'])
  })

  it('the page refetches its list when a background run ends and leaves the toast to the shell frame (R2-5)', async () => {
    await mount('f-beta')
    const list = (window as unknown as { home: { uniworkListChildren: ReturnType<typeof vi.fn> } })
      .home.uniworkListChildren
    const before = list.mock.calls.length
    // a batch the server does not know ends as failed at its first read
    trackFolderBatch({
      api: (window as unknown as { uniworkShare: Parameters<typeof trackFolderBatch>[0]['api'] })
        .uniworkShare,
      batchId: 'fb_unknown',
      folderId: 'f-beta',
      folderTitle: 'Beta Leaf',
      total: 0,
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await flush()
    expect(list.mock.calls.length).toBeGreaterThan(before)
    // the toast is the shell frame's FolderBatchEndHost (not mounted here): no second one from the page
    expect(document.body.textContent).not.toContain(en.shrFcBatchFailed)
  })
})
