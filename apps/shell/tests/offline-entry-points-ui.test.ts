/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountStatus,
  HomeApi,
  RecentEntry,
  UniworkDocSummary,
  UniworkResult,
} from '../src/shared/home-api'
import type { OfflineLibrarySnapshot, OfflineRowView } from '../src/shared/offline-library'
import type { SyncCenterSnapshot } from '../src/shared/sync-center'
import type { WorkRecentDocument } from '../src/shared/uniwork-work-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { Home } from '../src/renderer/src/Home'
import { DeskInProgress } from '../src/renderer/src/DeskInProgress'
import { UniworkOpenCard } from '../src/renderer/src/UniworkOpenCard'
import { takeRequestedSyncTab } from '../src/renderer/src/offline-library-model'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'

/**
 * G5-05u F5/F6 (UNI-1360): "Dùng khi không có mạng" / "Bỏ dùng khi không có
 * mạng" in the Home recents "…" menu (UniWork rows, after Open) and the In
 * progress UniWork rows; the label follows main's library and the pin is hidden
 * while the capability is off. The Open card offline opens the sync center on
 * the S3 tab.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const EN = syncStrings.en as Record<string, string>
const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

const pinnedRow = (documentId: string): OfflineRowView => ({
  documentId,
  workspaceId: 'ws-1',
  name: `${documentId}.docx`,
  state: 'ready',
  progress: null,
  version: 1,
  headVersion: null,
  sizeBytes: 10,
  leaseUntil: null,
  leaseLevel: 'edit',
  updateKeptReason: null,
  open: false,
})

const library = (over: Partial<OfflineLibrarySnapshot> = {}): OfflineLibrarySnapshot => ({
  visible: true,
  capabilityOn: true,
  quota: { usedBytes: 0, maxBytes: 2 * 1024 ** 3, pins: 0, maxPins: 200 },
  rows: [],
  ...over,
})

function syncCenter(offline: OfflineLibrarySnapshot) {
  const snap = { offline } as unknown as SyncCenterSnapshot
  const api = {
    getSnapshot: vi.fn(async () => snap),
    subscribe: vi.fn(() => () => undefined),
    offlinePin: vi.fn(async () => ({ ok: true as const })),
    offlineUnpin: vi.fn(async () => ({ ok: true as const, deferred: false })),
  }
  ;(window as unknown as { uniworkSyncCenter: unknown }).uniworkSyncCenter = api
  return api
}

let host: HTMLDivElement
let root: Root

async function flush(ticks = 6) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function click(el: Element) {
  await act(async () => (el as HTMLElement).click())
  await flush()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  delete (window as unknown as { uniworkSyncCenter?: unknown }).uniworkSyncCenter
  takeRequestedSyncTab()
})

describe('Home recents "…" menu (UniWork rows)', () => {
  const signedIn: AccountStatus = {
    state: 'signed-in',
    loggedIn: true,
    email: 'linh@example.com',
    profile: { accountId: 'acc-1', email: 'linh@example.com', displayName: 'Linh' },
    org: { id: 'org-1', name: 'UniWork Corp' },
  }
  const entry: RecentEntry = {
    path: '/cache/cloud-spec.docx',
    name: 'Cloud Spec.docx',
    ext: 'docx',
    mtimeMs: 1_700_000_000_000,
    sizeBytes: 2048,
    starred: false,
    uniwork: {
      documentId: 'uw-doc-1',
      workspaceId: 'ws-1',
      title: 'Cloud Spec.docx',
      access: 'edit',
    },
  }
  let homeApi: Record<string, unknown> = {}

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.lang = 'en'
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    )
    const api = {
      folderRoots: vi.fn(async () => []),
      listFolder: vi.fn(async () => ({ folders: [], files: [] })),
      onFolderChanged: vi.fn(() => () => {}),
      recents: vi.fn(async () => ({ entries: [entry], total: 1 })),
      starred: vi.fn(async () => ({ entries: [], total: 0 })),
      starredGroups: vi.fn(async () => []),
      searchFiles: vi.fn(async () => ({
        hits: [],
        total: 0,
        index: { pending: 0, scanning: false },
      })),
      uniworkListDocuments: vi.fn(async () =>
        ok({
          documents: [
            {
              id: 'uw-doc-1',
              workspaceId: 'ws-1',
              title: 'Cloud Spec.docx',
              format: 'docx',
              updatedAt: '2026-10-17T10:00:00.000Z',
              kind: 'file',
              parentId: null,
            },
          ],
          nextCursor: null,
        }),
      ),
      rerankSearch: vi.fn(async () => null),
      addFolderRoot: vi.fn(async () => null),
      removeFolderRoot: vi.fn(async () => {}),
      pickDefaultSaveDir: vi.fn(async () => null),
      accountStatus: vi.fn(async () => signedIn),
      accountGetStatus: vi.fn(async () => signedIn),
      onAccountStatus: vi.fn(() => () => {}),
      onAccountChanged: vi.fn(() => () => {}),
      onAccountLogin: vi.fn(() => () => {}),
      onAccountLoginEvent: vi.fn(() => () => {}),
      accountLogin: vi.fn(async () => true),
      uniworkListWorkspaces: vi.fn(async () => ok([{ id: 'ws-1', name: 'Engineering' }])),
      uniworkFolderTree: vi.fn(async () => ok([])),
      uniworkListChildren: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onDocRenamed: vi.fn(() => () => {}),
      onUniworkLaunch: vi.fn(() => () => {}),
      onOpenSettings: vi.fn(() => () => {}),
      onOpenSettingsEvent: vi.fn(() => () => {}),
      openPath: vi.fn(async () => {}),
      uniworkOpenDocument: vi.fn(async () => ok({ path: '/cache/opened.docx' })),
    }
    homeApi = api
    ;(window as unknown as { aiOffice: HomeApi }).aiOffice = api as unknown as HomeApi
  })

  async function openMenuFor(selector: string, match?: string) {
    const row = match
      ? Array.from(host.querySelectorAll<HTMLElement>(selector)).find((r) =>
          r.textContent?.includes(match),
        )!
      : host.querySelector<HTMLElement>(selector)!
    expect(row).toBeDefined()
    await click(row.querySelector('.uw-row-menu-btn')!)
    // the row menu is portalled to document.body
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
  }

  async function openRowMenu() {
    await act(async () => {
      root.render(createElement(LocaleProvider, null, createElement(Home)))
    })
    await flush()
    // the UniWork area now renders DocumentsHome; open its Recent sub-view
    await click(host.querySelector('.nav-item[data-nav="recent"]')!)
    return openMenuFor('.dh-doc-row', 'Cloud Spec.docx')
  }

  it('offers "Make available offline" right after Open, and pins the document', async () => {
    const api = syncCenter(library())
    const items = await openRowMenu()
    expect(items[0]!.textContent).toBe('Open')
    expect(items[1]!.textContent).toBe(EN.uwOfflinePin)
    await click(items[1]!)
    expect(api.offlinePin).toHaveBeenCalledWith({ documentId: 'uw-doc-1', workspaceId: 'ws-1' })
  })

  it('a pinned document offers "Remove offline copy" and unpins it', async () => {
    const api = syncCenter(library({ rows: [pinnedRow('uw-doc-1')] }))
    const items = await openRowMenu()
    expect(items[1]!.textContent).toBe(EN.uwOfflineUnpin)
    await click(items[1]!)
    expect(api.offlineUnpin).toHaveBeenCalledWith('uw-doc-1', undefined)
  })

  it('the pin is hidden while the capability is off', async () => {
    syncCenter(library({ capabilityOn: false }))
    const items = await openRowMenu()
    expect(items.map((b) => b.textContent)).not.toContain(EN.uwOfflinePin)
  })

  it('an unpin that needs_confirm asks first on the DocumentsHome row menu, then unpins confirmed (DH1-R4-4)', async () => {
    const api = syncCenter(library({ rows: [pinnedRow('uw-doc-1')] }))
    api.offlineUnpin.mockResolvedValueOnce({ ok: false, code: 'needs_confirm' } as never)
    const items = await openRowMenu()
    await click(items[1]!)
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(dialog.textContent).toContain(EN.uwOfflineUnpinConfirm)
    const go = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === EN.uwOfflineUnpinShort,
    )!
    await click(go)
    expect(api.offlineUnpin).toHaveBeenLastCalledWith('uw-doc-1', { confirmed: true })
  })

  it('a cap refusal on pin shows uwOfflineCapReached from the DocumentsHome menu and pins nothing (DH1-R4-4)', async () => {
    const api = syncCenter(library())
    api.offlinePin.mockResolvedValueOnce({
      ok: false,
      code: 'offline_cap_reached',
      cap: 2 * 1024 ** 3,
      maxDocs: 200,
    } as never)
    const items = await openRowMenu()
    await click(items[1]!)
    expect(document.querySelector('.uw-act-toast')!.textContent).toContain(
      EN.uwOfflineCapReached!.replace('{cap}', '2 GB').replace('{maxDocs}', '200'),
    )
  })

  it('a second pin click while the pin is in flight is a no-op on the DocumentsHome menu (DH1-R4-4)', async () => {
    const api = syncCenter(library())
    const pin = Promise.withResolvers<{ ok: true }>()
    api.offlinePin.mockImplementationOnce(() => pin.promise)
    const items = await openRowMenu()
    await act(async () => items[1]!.click())
    await flush()
    // menu closed but the pin is still in flight: reopening and clicking again must not re-issue it
    const itemsAgain = await openMenuFor('.dh-doc-row', 'Cloud Spec.docx')
    await act(async () => itemsAgain[1]!.click())
    await flush()
    expect(api.offlinePin).toHaveBeenCalledTimes(1)
    await act(async () => pin.resolve({ ok: true }))
    await flush()
  })

  it('the pin item is absent on the workspace folder card and on trash rows even when it is pinned (DH1-R4-4)', async () => {
    homeApi.uniworkListChildren = vi.fn(async () =>
      ok({
        items: [
          {
            id: 'f-board',
            workspaceId: 'ws-1',
            title: 'Board Folder',
            format: null,
            updatedAt: '2026-10-15T10:00:00.000Z',
            kind: 'folder',
            parentId: null,
          },
          {
            id: 'uw-doc-1',
            workspaceId: 'ws-1',
            title: 'Cloud Spec.docx',
            format: 'docx',
            updatedAt: '2026-10-17T10:00:00.000Z',
            kind: 'file',
            parentId: null,
          },
        ],
        nextCursor: null,
      }),
    )
    homeApi.uniworkListTrash = vi.fn(async () =>
      ok({
        documents: [
          {
            id: 'doc-trashed',
            workspaceId: 'ws-1',
            title: 'Trashed Spec.docx',
            format: 'docx',
            updatedAt: '2026-10-10T06:00:00.000Z',
            kind: 'file',
            parentId: null,
            canManage: true,
          },
        ],
        nextCursor: null,
      }),
    )
    syncCenter(library({ rows: [pinnedRow('uw-doc-1'), pinnedRow('doc-trashed')] }))

    await act(async () => {
      root.render(createElement(LocaleProvider, null, createElement(Home)))
    })
    await flush()

    // folder card menu: no offline entry (pin or unpin) even though uw-doc-1 is pinned
    const folderItems = await openMenuFor('.dh-folder-card', 'Board Folder')
    expect(folderItems.length).toBeGreaterThan(0)
    const folderLabels = folderItems.map((b) => b.textContent)
    expect(folderLabels).not.toContain(EN.uwOfflinePin)
    expect(folderLabels).not.toContain(EN.uwOfflineUnpin)

    // trash row menu: only restore-class actions, never the pin item
    await click(host.querySelector('.nav-item[data-nav="trash"]')!)
    const trashItems = await openMenuFor('.dh-doc-row', 'Trashed Spec.docx')
    expect(trashItems.length).toBeGreaterThan(0)
    const trashLabels = trashItems.map((b) => b.textContent)
    expect(trashLabels).not.toContain(EN.uwOfflinePin)
    expect(trashLabels).not.toContain(EN.uwOfflineUnpin)
  })
})

describe('In progress UniWork rows', () => {
  const doc: UniworkDocSummary = {
    id: 'd-1',
    workspaceId: 'ws-9',
    title: 'Plan.docx',
    format: 'docx',
    updatedAt: '2026-10-01T10:00:00Z',
  }
  const recent = [{ source: 'uniwork', doc } as unknown as WorkRecentDocument]

  async function mount() {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(DeskInProgress, { drafts: [], recent, local: [] }),
        ),
      )
    })
    await flush()
    return host.querySelector<HTMLButtonElement>('.wb-desk-row .wb-icon-btn')
  }

  it('an offline icon button named by the pin label (tooltip = label) pins the row', async () => {
    const api = syncCenter(library())
    const btn = (await mount())!
    expect(btn.getAttribute('aria-label')).toBe(EN.uwOfflinePin)
    expect(btn.getAttribute('title')).toBe(EN.uwOfflinePin)
    expect(btn.querySelector('svg')).not.toBeNull()
    await click(btn)
    expect(api.offlinePin).toHaveBeenCalledWith({ documentId: 'd-1', workspaceId: 'ws-9' })
  })

  it('a pinned row reads the unpin label; capability off hides the pin', async () => {
    syncCenter(library({ rows: [pinnedRow('d-1')] }))
    expect((await mount())!.getAttribute('aria-label')).toBe(EN.uwOfflineUnpin)
    await act(async () => root.unmount())
    root = createRoot(host)
    syncCenter(library({ capabilityOn: false }))
    expect(await mount()).toBeNull()
  })

  it('needs_confirm asks first (uwOfflineUnpinConfirm), then unpins confirmed', async () => {
    const api = syncCenter(library({ rows: [pinnedRow('d-1')] }))
    api.offlineUnpin.mockResolvedValueOnce({ ok: false, code: 'needs_confirm' } as never)
    await click((await mount())!)
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(dialog.textContent).toContain(EN.uwOfflineUnpinConfirm)
    const go = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === EN.uwOfflineUnpinShort,
    )!
    await click(go)
    expect(api.offlineUnpin).toHaveBeenLastCalledWith('d-1', { confirmed: true })
  })

  it('a cap refusal shows uwOfflineCapReached and pins nothing', async () => {
    const api = syncCenter(library())
    api.offlinePin.mockResolvedValueOnce({
      ok: false,
      code: 'offline_cap_reached',
      cap: 2 * 1024 ** 3,
      maxDocs: 200,
    } as never)
    const btn = (await mount())!
    await click(btn)
    expect(document.querySelector('.uw-act-toast')!.textContent).toContain(
      EN.uwOfflineCapReached!.replace('{cap}', '2 GB').replace('{maxDocs}', '200'),
    )
    expect(btn.getAttribute('aria-label')).toBe(EN.uwOfflinePin)
  })

  it('a rejected or undefined pin/unpin result shows uwSyncActionFailed', async () => {
    const api = syncCenter(library())
    api.offlinePin.mockRejectedValueOnce(new Error('ipc'))
    const btn = (await mount())!
    await click(btn)
    expect(document.querySelector('.uw-act-toast')!.textContent).toContain(EN.uwSyncActionFailed)
    await act(async () => root.unmount())
    root = createRoot(host)
    const api2 = syncCenter(library({ rows: [pinnedRow('d-1')] }))
    api2.offlineUnpin.mockResolvedValueOnce(undefined as never)
    await click((await mount())!)
    expect(document.querySelector('.uw-act-toast')!.textContent).toContain(EN.uwSyncActionFailed)
  })

  it('ignores a second click while a pin or unpin is in flight', async () => {
    const api = syncCenter(library())
    let resolvePin!: (v: { ok: true }) => void
    api.offlinePin.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolvePin = r
        }),
    )
    const btn = (await mount())!
    await act(async () => {
      btn.click()
      btn.click()
    })
    expect(api.offlinePin).toHaveBeenCalledTimes(1)
    await act(async () => resolvePin({ ok: true }))
    await flush()
    await click(btn)
    expect(api.offlinePin).toHaveBeenCalledTimes(2)
  })
})

describe('UniworkOpenCard offline', () => {
  function account(state: AccountStatus['state']) {
    const status = {
      state,
      loggedIn: true,
      email: 'linh@example.com',
      profile: { accountId: 'acc-1', email: 'linh@example.com', displayName: 'Linh' },
    } as AccountStatus
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {
      accountStatus: vi.fn(async () => status),
      onAccountStatus: vi.fn(() => () => undefined),
      onAccountLogin: vi.fn(() => () => undefined),
      onSignOutProgress: vi.fn(() => () => undefined),
      onSignOutPrompt: vi.fn(() => () => undefined),
      uniworkListWorkspaces: vi.fn(() => new Promise(() => undefined)),
    }
  }

  async function mountCard() {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(UniworkOpenCard, { onOpenSettings: () => undefined }),
        ),
      )
    })
    await flush()
    return host.querySelector<HTMLButtonElement>('.uw-open-card')!
  }

  it('offline with library rows: opens the sync center on the S3 tab', async () => {
    account('server-unreachable')
    syncCenter(library({ rows: [pinnedRow('d-1')] }))
    const onOpen = vi.fn()
    window.addEventListener('uniwork:open-settings', onOpen)
    await click(await mountCard())
    window.removeEventListener('uniwork:open-settings', onOpen)
    expect((onOpen.mock.calls[0]![0] as CustomEvent).detail).toEqual({ section: 'sync' })
    expect(takeRequestedSyncTab()).toBe('offline')
    expect(document.querySelector('.modal.uw-pick')).toBeNull()
  })

  it('signed-in online with library rows: opens the picker', async () => {
    account('signed-in')
    syncCenter(library({ rows: [pinnedRow('d-1')] }))
    const onOpen = vi.fn()
    window.addEventListener('uniwork:open-settings', onOpen)
    const card = await mountCard()
    expect(card.getAttribute('aria-haspopup')).toBe('dialog')
    await click(card)
    window.removeEventListener('uniwork:open-settings', onOpen)
    expect(onOpen).not.toHaveBeenCalled()
    expect(takeRequestedSyncTab()).toBeNull()
    expect(document.querySelector('.modal.uw-pick')).not.toBeNull()
  })

  it('offline with an empty library: the picker as before', async () => {
    account('server-unreachable')
    syncCenter(library())
    const onOpen = vi.fn()
    window.addEventListener('uniwork:open-settings', onOpen)
    const card = await mountCard()
    expect(card.getAttribute('aria-haspopup')).toBe('dialog')
    await click(card)
    window.removeEventListener('uniwork:open-settings', onOpen)
    expect(onOpen).not.toHaveBeenCalled()
    expect(takeRequestedSyncTab()).toBeNull()
  })
})
