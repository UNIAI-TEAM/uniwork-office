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
import { buildRowMenu, type RowMenuActionId } from '../src/renderer/src/doclist/row-menu'
import { createFakeShareApi } from '../src/renderer/src/uniwork-share/fake-share-api'
import { uniworkVersionStrings } from '../src/renderer/src/i18n/strings-uniwork-versions'
import {
  createFakeDocHistoryBridge,
  versionOf,
  type FakeDocHistoryBridge,
} from './doc-history-fake-bridge'

/**
 * UNI-2077 UI-V: the Version history entry of the Documents row menu. Every reader of a file
 * or page has it; a folder and a trashed row do not; without the bridge (an older main) it is
 * hidden; the entry opens ONE sheet that writes only for edit / manage.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const viText = uniworkVersionStrings.vi as Record<string, string>
const ENTRY = viText.vhsMenuEntry!

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

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

describe('row menu: Lịch sử phiên bản (model)', () => {
  const entries = (
    screen: 'workspace' | 'trash' | 'shelved',
    doc: DocumentsHomeDoc,
    run: RowMenuActionId[] = ['versions', 'open'],
  ) =>
    buildRowMenu({
      screen,
      doc,
      offlineLabel: null,
      label: (key) => key,
      run: Object.fromEntries(run.map((id) => [id, () => {}])),
    }).map((item) => item.id)

  it('every reader of a file or a page has it, a viewer included', () => {
    expect(
      entries('workspace', row({ id: 'a', myLevel: 'view', canEdit: false, canManage: false })),
    ).toContain('versions')
    expect(entries('workspace', row({ id: 'p', kind: 'page' }))).toContain('versions')
  })

  it('sits with Open, before the link entries', () => {
    const ids = entries('workspace', row({ id: 'a' }), ['open', 'versions', 'copy-link'])
    expect(ids.indexOf('versions')).toBeLessThan(ids.indexOf('copy-link'))
  })

  it('a folder, a trashed row and a host with no handler have none', () => {
    expect(entries('workspace', row({ id: 'f', kind: 'folder' }))).not.toContain('versions')
    expect(entries('workspace', row({ id: 'a', archived: true }))).not.toContain('versions')
    expect(entries('trash', row({ id: 'a' }))).not.toContain('versions')
    expect(entries('workspace', row({ id: 'a' }), ['open'])).not.toContain('versions')
  })

  it('a shelved row keeps its history readable', () => {
    expect(
      entries('shelved', row({ id: 'a', shelvedAt: '2026-10-01T00:00:00Z' }), ['versions']),
    ).toContain('versions')
    expect(entries('workspace', row({ id: 'a', shelvedAt: '2026-10-01T00:00:00Z' }))).toContain(
      'versions',
    )
  })
})

describe('DocumentsHome mounts the Version history sheet (UNI-2077 UI-V)', () => {
  const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let history: FakeDocHistoryBridge
  let items: DocumentsHomeDoc[]
  let onOpenDocument: ReturnType<typeof vi.fn>

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
      row({ id: 'fld', title: 'Thư mục', kind: 'folder' }),
    ]
    history = createFakeDocHistoryBridge({
      versions: [versionOf({ id: 'v2', version: 2 }), versionOf({ id: 'v1', version: 1 })],
    })
    ;(window as unknown as { uniworkDocHistory?: unknown }).uniworkDocHistory = history
    ;(window as unknown as { uniworkShare: unknown }).uniworkShare = createFakeShareApi()
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
  const menuLabels = () =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (e) => e.textContent,
    )
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
  const openMenu = (id: string) => click(host.querySelector(`button[data-folder-menu-for="${id}"]`))

  it('a row menu offers the entry and opens the sheet for that row, never the document', async () => {
    await mount()
    await openMenu('doc-a')
    expect(menuLabels()).toContain(ENTRY)
    await click(
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (e) => e.textContent === ENTRY,
      ),
    )
    expect(onOpenDocument).not.toHaveBeenCalled()
    expect(history.versions).toHaveBeenCalledWith({ documentId: 'doc-a' })
    expect(dialog()!.textContent).toContain(viText.vhsTitle)
    expect(dialog()!.querySelectorAll('[data-version-row]')).toHaveLength(2)
    // a manager may restore
    expect(dialog()!.querySelector('form')).not.toBeNull()
    // Escape closes it again
    await act(async () => {
      dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(dialog()).toBeNull()
  })

  it('a viewer row has the entry and its sheet is read-only', async () => {
    await mount()
    await openMenu('doc-v')
    await click(
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (e) => e.textContent === ENTRY,
      ),
    )
    expect(dialog()!.querySelectorAll('[data-version-row]')).toHaveLength(2)
    expect(dialog()!.querySelector('form')).toBeNull()
    expect(dialog()!.textContent).toContain(viText.vhsManageOnly)
  })

  it('a folder row menu has no entry', async () => {
    await mount()
    await openMenu('fld')
    expect(menuLabels()).not.toContain(ENTRY)
  })

  it('without the bridge (an older main) no row has the entry', async () => {
    delete (window as unknown as { uniworkDocHistory?: unknown }).uniworkDocHistory
    await mount()
    await openMenu('doc-a')
    expect(menuLabels().length).toBeGreaterThan(0)
    expect(menuLabels()).not.toContain(ENTRY)
  })

  it('a checkpoint made in the sheet refetches the list once', async () => {
    await mount()
    const before = api.uniworkListChildren!.mock.calls.length
    await openMenu('doc-a')
    await click(
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (e) => e.textContent === ENTRY,
      ),
    )
    await act(async () => {
      dialog()!
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
    expect(history.createVersion).toHaveBeenCalledTimes(1)
    expect(api.uniworkListChildren!.mock.calls.length - before).toBe(1)
  })
})
