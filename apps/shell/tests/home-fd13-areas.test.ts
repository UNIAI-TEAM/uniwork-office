/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountStatus,
  FolderRoot,
  HomeApi,
  RecentEntry,
  UniworkDocSummary,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkFolderQuery,
  UniworkResult,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LocaleProvider } from '../src/renderer/src/locale'
import { Home } from '../src/renderer/src/Home'
import * as docsModel from '../src/renderer/src/uniwork-docs-model'
import * as uniworkOpen from '../src/renderer/src/uniwork-open'
import { onUniworkNotice } from '../src/renderer/src/uniwork-notice-bus'
import { wbStoreGetRaw, wbStoreSetRaw } from '../src/renderer/src/workbench-store-client'
import { en as wbEn } from '../src/renderer/src/i18n/workbench/en'
import { vi as wbVi } from '../src/renderer/src/i18n/workbench/vi'
import { zh as wbZh } from '../src/renderer/src/i18n/workbench/zh'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function makeEntry(
  path: string,
  name: string,
  uniwork?: RecentEntry['uniwork'],
  mtimeMs = 1_700_000_000_000,
): RecentEntry {
  return {
    path,
    name,
    ext: 'docx',
    mtimeMs,
    sizeBytes: 2048,
    starred: true,
    ...(uniwork ? { uniwork } : {}),
  }
}

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

describe('FD-13 pure split function (splitEntriesByArea)', () => {
  it('partitions entries into uniwork vs device buckets on entry.uniwork with no row in both', () => {
    const splitFn = (
      docsModel as unknown as {
        splitEntriesByArea?: (entries: readonly RecentEntry[]) => {
          uniwork: RecentEntry[]
          device: RecentEntry[]
        }
      }
    ).splitEntriesByArea
    expect(typeof splitFn).toBe('function')

    const uw1 = makeEntry('/cache/uw-1.docx', 'Q4 Plan.docx', {
      documentId: 'doc-1',
      workspaceId: 'ws-1',
      title: 'Q4 Plan.docx',
    })
    const local1 = makeEntry('/Users/me/Notes.docx', 'Notes.docx')
    const uw2 = makeEntry('/cache/uw-2.docx', 'Budget.docx', {
      documentId: 'doc-2',
      workspaceId: 'ws-1',
      title: 'Budget.docx',
    })
    const local2 = makeEntry('/Users/me/Draft.docx', 'Draft.docx')

    const res = splitFn!([uw1, local1, uw2, local2])
    expect(res.uniwork).toEqual([uw1, uw2])
    expect(res.device).toEqual([local1, local2])
    const overlap = res.uniwork.filter((r) => res.device.includes(r))
    expect(overlap).toHaveLength(0)
    expect(res.uniwork.length + res.device.length).toBe(4)
  })
})

describe('FD-13 Home two-area frame (UniWork / On this device)', () => {
  let host: HTMLDivElement
  let root: Root
  let accountStatus: AccountStatus
  let folderRoots: FolderRoot[]
  let recentEntries: RecentEntry[]
  let workspaces: UniworkWorkspaceRef[]
  let treeByWs: Record<string, UniworkFolderNode[]>
  let childrenByWs: Record<string, Record<string, UniworkDocSummary[]>>
  let api: Record<string, ReturnType<typeof vi.fn>>
  /** broadcasts an account status change to every active onAccountStatus subscriber */
  let accountStatusListeners: Array<(s: AccountStatus) => void> = []
  const pushAccountStatus = (s: AccountStatus) => {
    accountStatus = s
    for (const cb of [...accountStatusListeners]) cb(s)
  }

  beforeEach(() => {
    accountStatusListeners = []
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

    accountStatus = {
      state: 'signed-in',
      loggedIn: true,
      email: 'linh@example.com',
      profile: {
        accountId: 'acc-1',
        email: 'linh@example.com',
        displayName: 'Linh',
      },
      org: { id: 'org-1', name: 'UniWork Corp' },
    }

    folderRoots = [
      {
        path: '/Users/linh/Documents',
        name: 'Documents',
        readable: true,
        usable: true,
        removable: false,
      },
    ]

    recentEntries = [
      makeEntry('/cache/cloud-spec.docx', 'Cloud Spec.docx', {
        documentId: 'uw-doc-1',
        workspaceId: 'ws-1',
        title: 'Cloud Spec.docx',
      }),
      makeEntry('/Users/linh/Documents/Local Report.docx', 'Local Report.docx'),
    ]

    workspaces = [
      { id: 'ws-1', name: 'Engineering' },
      { id: 'ws-2', name: 'Marketing' },
    ]

    treeByWs = {
      'ws-1': [
        {
          id: 'f-alpha',
          parentId: null,
          title: 'Alpha Folder',
          position: 0,
          children: [],
        },
      ],
      'ws-2': [
        {
          id: 'f-beta',
          parentId: null,
          title: 'Beta Folder',
          position: 0,
          children: [],
        },
      ],
    }

    childrenByWs = {
      'ws-1': {
        '': [
          {
            id: 'f-alpha',
            workspaceId: 'ws-1',
            title: 'Alpha Folder',
            format: null,
            updatedAt: '2026-10-01T10:00:00Z',
            kind: 'folder',
            parentId: null,
          },
          {
            id: 'doc-root-1',
            workspaceId: 'ws-1',
            title: 'Root Cloud Doc.docx',
            format: 'docx',
            updatedAt: '2026-10-01T10:00:00Z',
            kind: 'file',
            parentId: null,
          },
        ],
        'f-alpha': [
          {
            id: 'doc-alpha-1',
            workspaceId: 'ws-1',
            title: 'Alpha Spec.docx',
            format: 'docx',
            updatedAt: '2026-10-01T10:00:00Z',
            kind: 'file',
            parentId: 'f-alpha',
          },
        ],
      },
      'ws-2': {
        '': [
          {
            id: 'doc-ws2-1',
            workspaceId: 'ws-2',
            title: 'Marketing Plan.docx',
            format: 'docx',
            updatedAt: '2026-10-01T10:00:00Z',
            kind: 'file',
            parentId: null,
          },
        ],
      },
    }

    api = {
      folderRoots: vi.fn(async () => folderRoots),
      listFolder: vi.fn(async () => ({ folders: [], files: [] })),
      onFolderChanged: vi.fn(() => () => {}),
      recents: vi.fn(async () => ({ entries: recentEntries, total: recentEntries.length })),
      starred: vi.fn(async () => ({ entries: recentEntries, total: recentEntries.length })),
      starredGroups: vi.fn(async () => []),
      searchFiles: vi.fn(async () => ({
        hits: [],
        total: 0,
        index: { pending: 0, scanning: false },
      })),
      rerankSearch: vi.fn(async () => null),
      addFolderRoot: vi.fn(async () => null),
      removeFolderRoot: vi.fn(async () => {}),
      pickDefaultSaveDir: vi.fn(async () => null),
      accountStatus: vi.fn(async () => accountStatus),
      accountGetStatus: vi.fn(async () => accountStatus),
      onAccountStatus: vi.fn((cb: (s: AccountStatus) => void) => {
        accountStatusListeners.push(cb)
        return () => {
          accountStatusListeners = accountStatusListeners.filter((fn) => fn !== cb)
        }
      }),
      onAccountChanged: vi.fn(() => () => {}),
      onAccountLogin: vi.fn(() => () => {}),
      onAccountLoginEvent: vi.fn(() => () => {}),
      accountLogin: vi.fn(async () => true),
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async (ws: string) => ok(treeByWs[ws] ?? [])),
      uniworkListChildren: vi.fn(
        async (q: UniworkFolderQuery): Promise<UniworkResult<UniworkFolderChildren>> => {
          const wsMap = childrenByWs[q.workspaceId] ?? {}
          const items = wsMap[q.parentId ?? '']
          return items ? ok({ items, nextCursor: null }) : { ok: false, error: 'not_found' }
        },
      ),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onDocRenamed: vi.fn(() => () => {}),
      onUniworkLaunch: vi.fn(() => () => {}),
      onOpenSettings: vi.fn(() => () => {}),
      onOpenSettingsEvent: vi.fn(() => () => {}),
      openPath: vi.fn(async () => {}),
      uniworkOpenDocument: vi.fn(async () => ok({ path: '/cache/opened.docx' })),
    }

    ;(window as unknown as { aiOffice: HomeApi }).aiOffice = api as unknown as HomeApi
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  async function flush(ticks = 4) {
    for (let i = 0; i < ticks; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  async function mountHome() {
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(Home)))
    })
    await flush()
  }

  it('renders accessible tablist "Area" ("Khu vực") with arrow/Home/End/Up/Down navigation, roving tabIndex, title attributes, and restores persisted selection across remounts (FE13-R1-6, FE13-R1-8, FE13-R1-10)', async () => {
    await mountHome()

    const tablist = host.querySelector<HTMLElement>('[role="tablist"][aria-label="Area"]')
    expect(tablist).not.toBeNull()
    const tabs = Array.from(tablist!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs.map((t) => t.textContent)).toEqual(['UniWork', 'On this device'])
    expect(tabs[0]!.getAttribute('title')).toBe('UniWork')
    expect(tabs[1]!.getAttribute('title')).toBe('On this device')

    // Signed in by default -> UniWork tab is selected with roving tabIndex 0 / -1
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('false')
    expect(tabs[0]!.tabIndex).toBe(0)
    expect(tabs[1]!.tabIndex).toBe(-1)
    const panelId = tabs[0]!.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(host.querySelector(`#${panelId}[role="tabpanel"]`)).not.toBeNull()

    // ArrowRight moves to "On this device", moves focus, updates roving tabIndex, and persists choice
    await act(async () => {
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()

    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]!.tabIndex).toBe(-1)
    expect(tabs[1]!.tabIndex).toBe(0)
    expect(document.activeElement).toBe(tabs[1])
    expect(wbStoreGetRaw('uniwork.wb.homeArea')).toBe('device')

    // ArrowLeft moves back to "UniWork" and moves focus
    await act(async () => {
      tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    await flush()

    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]!.tabIndex).toBe(0)
    expect(tabs[1]!.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(tabs[0])
    expect(wbStoreGetRaw('uniwork.wb.homeArea')).toBe('uniwork')

    // ArrowDown moves to "On this device" and moves focus
    await act(async () => {
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    await flush()
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1])

    // ArrowUp moves to "UniWork" and moves focus
    await act(async () => {
      tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })
    await flush()
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[0])

    // End moves to "On this device" and moves focus
    await act(async () => {
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    await flush()
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1])

    // Home moves to "UniWork" and moves focus
    await act(async () => {
      tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    await flush()
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[0])

    // Select "On this device", unmount, and remount while still signed in -> restored from persisted store
    await act(async () => {
      tabs[1]!.click()
    })
    await flush()
    expect(wbStoreGetRaw('uniwork.wb.homeArea')).toBe('device')

    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    await mountHome()

    const remountedTabs = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]'),
    )
    expect(remountedTabs[0]!.getAttribute('aria-selected')).toBe('false')
    expect(remountedTabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(remountedTabs[0]!.tabIndex).toBe(-1)
    expect(remountedTabs[1]!.tabIndex).toBe(0)
    expect(host.querySelector('.folder-panel')).not.toBeNull()

    // FE13-R1-8: shared wbDeskSubCloud values remain intact while tab uses ufAreaUniwork
    expect(wbEn.wbDeskSubCloud).toBe('On UniWork')
    expect(wbVi.wbDeskSubCloud).toBe('Trên UniWork')
    expect(wbZh.wbDeskSubCloud).toBe('在 UniWork 上')
  })

  it('defaults to "On this device" when signed out and shows the sign-in gate when selecting "UniWork"', async () => {
    accountStatus = { state: 'signed-out', loggedIn: false }
    await mountHome()

    const tablist = host.querySelector<HTMLElement>('[role="tablist"][aria-label="Area"]')!
    const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false')
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')

    // Clicking UniWork tab while signed out shows the sign-in gate, never an empty pane
    await act(async () => {
      tabs[0]!.click()
    })
    await flush()

    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    const main = host.querySelector('main.content')
    expect(main).not.toBeNull()
    expect(main!.textContent).toContain('Sign in to UniWork')
  })

  it('renders a neutral loading skeleton in the UniWork area while accountStatus is loading, does not call uniworkListWorkspaces, and does not reset workspace state (FE13-R1-4, FE13-R2-4, FE13-R3-5)', async () => {
    wbStoreSetRaw('uniwork.wb.homeArea', 'uniwork')
    wbStoreSetRaw('uniwork.wb.activeWorkspace', 'ws-2')
    let resolveStatus!: (s: AccountStatus) => void
    const deferredStatus = new Promise<AccountStatus>((r) => {
      resolveStatus = r
    })
    api.accountStatus = vi.fn(() => deferredStatus)
    api.accountGetStatus = vi.fn(() => deferredStatus)

    const activeWsMod = await import('../src/renderer/src/active-workspace')
    const afterSpy = vi.spyOn(activeWsMod, 'afterWorkspaceList')
    const accountMod = await import('../src/renderer/src/account-model')

    try {
      await mountHome()

      const main = host.querySelector('main.content')
      expect(main).not.toBeNull()
      expect(main!.querySelector('.wb-work-skeleton')).not.toBeNull()
      expect(main!.textContent).not.toContain('Sign in to UniWork')
      expect(api.uniworkListWorkspaces).not.toHaveBeenCalled()
      expect(wbStoreGetRaw('uniwork.wb.activeWorkspace')).toBe('ws-2')

      // Even if showsProfile returned true while acctView === 'loading', the acctView === 'loading' guard prevents calling uniworkListWorkspaces
      const showsProfileSpy = vi
        .spyOn(accountMod, 'showsProfile')
        .mockImplementation(
          (view, s) => view === 'loading' || view === 'signed-in' || !!s?.loggedIn,
        )
      try {
        const docsPill = Array.from(host.querySelectorAll<HTMLButtonElement>('.filter-pill'))[0]
        docsPill?.click()
        await flush()
        expect(api.uniworkListWorkspaces).not.toHaveBeenCalled()
      } finally {
        showsProfileSpy.mockRestore()
      }

      await act(async () => {
        resolveStatus(accountStatus)
      })
      await flush()

      expect(api.uniworkListWorkspaces).toHaveBeenCalledTimes(1)
      // Verify uwWsState (passed as prev to afterWorkspaceList) was NOT reset to { workspaceId: null } while acctView === 'loading'
      expect(afterSpy).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-2' }),
        expect.anything(),
        'ws-2',
      )
      // the documents pane is its own element now (not the skeleton's <main> reused), so re-query
      expect(host.querySelector('main.content .wb-work-skeleton')).toBeNull()
      expect(host.textContent).toContain('Marketing Plan.docx')
    } finally {
      afterSpy.mockRestore()
    }
  })

  it('isolates sources per area (no mixing), shows accurate per-area counts, and keeps the UniWork sub-view across area switches (FE13-R1-1, FE13-R1-6, VDH-7)', async () => {
    const uwRec1 = makeEntry('/cache/cloud-spec.docx', 'Cloud Spec.docx', {
      documentId: 'uw-doc-1',
      workspaceId: 'ws-1',
      title: 'Cloud Spec.docx',
    })
    const uwRec2 = makeEntry('/cache/cloud-roadmap.docx', 'Cloud Roadmap.docx', {
      documentId: 'uw-doc-2',
      workspaceId: 'ws-1',
      title: 'Cloud Roadmap.docx',
    })
    const devRec1 = makeEntry('/Users/linh/Documents/Local Report.docx', 'Local Report.docx')
    const devRec2 = makeEntry('/Users/linh/Documents/Local Budget.docx', 'Local Budget.docx')
    const devRec3 = makeEntry('/Users/linh/Documents/Local Notes.docx', 'Local Notes.docx')
    recentEntries = [uwRec1, uwRec2, devRec1, devRec2, devRec3]
    const starredEntries = [uwRec1, devRec1, devRec2]
    api.recents = vi.fn(async () => ({ entries: recentEntries, total: recentEntries.length }))
    api.starred = vi.fn(async () => ({ entries: starredEntries, total: starredEntries.length }))
    api.uniworkListDocuments = vi.fn(async () =>
      ok({
        documents: [
          {
            id: 'uw-doc-1',
            workspaceId: 'ws-1',
            title: 'Cloud Spec.docx',
            format: 'docx',
            updatedAt: '2026-10-01T10:00:00Z',
            kind: 'file',
            parentId: null,
          },
          {
            id: 'uw-doc-2',
            workspaceId: 'ws-1',
            title: 'Cloud Roadmap.docx',
            format: 'docx',
            updatedAt: '2026-10-01T09:00:00Z',
            kind: 'file',
            parentId: null,
          },
        ],
        nextCursor: null,
      }),
    )

    await mountHome()

    // In UniWork area: DocumentsHome is mounted at root by default
    expect(host.querySelector('.uwf-browser.uwf-pane')).not.toBeNull()
    const uwTree = host.querySelector<HTMLElement>('.uwf-tree[role="tree"]')
    expect(uwTree).not.toBeNull()
    expect(host.querySelector('.folder-panel')).toBeNull()
    expect(host.textContent).toContain('Root Cloud Doc.docx')

    // DocumentsHome sub-nav in UniWork area renders the 7 available entries (My Folder is a tree row; Lưu trữ since UNI-1961; Gắn sao since UNI-2047 B6)
    const uwNavIds = Array.from(host.querySelectorAll<HTMLElement>('.home-area-nav .nav-item')).map(
      (el) => el.getAttribute('data-nav'),
    )
    expect(uwNavIds).toEqual([
      'workspace',
      'recent',
      'starred',
      'shared-with-me',
      'shared-by-me',
      'archive',
      'trash',
    ])

    // Open "Alpha Folder" in the UniWork tree
    const alphaNode = Array.from(uwTree!.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
      (el) => el.textContent?.includes('Alpha Folder'),
    )
    expect(alphaNode).toBeDefined()
    await act(async () => {
      alphaNode!.click()
    })
    await flush()
    expect(host.textContent).toContain('Alpha Spec.docx')

    // Click Recent in UniWork area -> shows only UniWork recent rows via uniworkListDocuments
    const recentBtnUw = host.querySelector<HTMLButtonElement>('.nav-item[data-nav="recent"]')!
    await act(async () => {
      recentBtnUw.click()
    })
    await flush()
    expect(api.uniworkListDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
    )
    expect(host.textContent).toContain('Cloud Spec.docx')
    expect(host.textContent).toContain('Cloud Roadmap.docx')
    expect(host.textContent).not.toContain('Local Report.docx')

    // Switch to "On this device" area -> shows local folder tree, only local recent rows, and per-area counts (3 recent, 2 starred)
    const tablist = host.querySelector<HTMLElement>('[role="tablist"][aria-label="Area"]')!
    const deviceTab = tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!
    await act(async () => {
      deviceTab.click()
    })
    await flush()

    expect(host.querySelector('.folder-panel')).not.toBeNull()
    expect(host.textContent).toContain('Local Report.docx')
    expect(host.textContent).toContain('Local Budget.docx')
    expect(host.textContent).toContain('Local Notes.docx')
    expect(host.textContent).not.toContain('Cloud Spec.docx')
    expect(host.querySelector('.uw-recent-badge')).toBeNull()
    expect(host.textContent).toContain('Open file on this device')
    const devNavItems = Array.from(host.querySelectorAll<HTMLElement>('.home-area-nav .nav-item'))
    expect(devNavItems[0]?.querySelector('.nav-count')?.textContent).toBe('3')
    expect(devNavItems[1]?.querySelector('.nav-count')?.textContent).toBe('2')
    expect(host.querySelector('.recents-heading .file-count')?.textContent).toContain('3')

    // Open the local folder "/Users/linh/Documents" in device area
    const localFolderRow = host.querySelector<HTMLElement>('.folder-panel [role="treeitem"]')
    expect(localFolderRow).not.toBeNull()
    await act(async () => {
      localFolderRow!.click()
    })
    await flush()
    expect(localFolderRow!.getAttribute('aria-selected')).toBe('true')
    // Switch back to "UniWork" area -> the kept sub-view is Recent (VDH-7): its rows, not the folder's
    const uwTab = tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0]!
    await act(async () => {
      uwTab.click()
    })
    await flush()
    expect(host.textContent).toContain('Cloud Spec.docx')
    expect(host.textContent).not.toContain('Local Report.docx')

    // Switch back to "On this device" area -> previously open local folder "/Users/linh/Documents" is still open
    await act(async () => {
      deviceTab.click()
    })
    await flush()
    const localFolderRowAfter = host.querySelector<HTMLElement>('.folder-panel [role="treeitem"]')
    expect(localFolderRowAfter?.getAttribute('aria-selected')).toBe('true')
  })

  it('keeps paging when page 1 has only UniWork rows so the device area shows page-2 device rows and Load more, never the empty state, stops auto-paging on a short/empty page, drains remaining pages when fileSort === "oldest", and passes group on starred Load more (FE13-R1-1, FE13-R2-3, FE13-R3-5, FE13-R3-8)', async () => {
    const page1Uw = [
      makeEntry('/cache/uw-1.docx', 'UW Page1 A.docx', {
        documentId: 'uw-1',
        workspaceId: 'ws-1',
        title: 'UW Page1 A.docx',
      }),
      makeEntry('/cache/uw-2.docx', 'UW Page1 B.docx', {
        documentId: 'uw-2',
        workspaceId: 'ws-1',
        title: 'UW Page1 B.docx',
      }),
    ]
    const page2Dev = [
      makeEntry('/Users/linh/Documents/Device Page2 A.docx', 'Device Page2 A.docx'),
      makeEntry('/Users/linh/Documents/Device Page2 B.docx', 'Device Page2 B.docx'),
    ]
    const page3Dev = [makeEntry('/Users/linh/Documents/Device Page3 C.docx', 'Device Page3 C.docx')]

    let intersectCb: ((records: Array<{ isIntersecting: boolean }>) => void) | null = null
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (records: Array<{ isIntersecting: boolean }>) => void) {
          intersectCb = cb
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    )

    api.recents = vi.fn(async ({ offset = 0 }: { offset?: number }) => {
      if (offset === 0) return { entries: page1Uw, total: 5 }
      if (offset === 2) return { entries: page2Dev, total: 5 }
      return { entries: page3Dev, total: 5 }
    })
    wbStoreSetRaw('uniwork.wb.homeArea', 'device')

    await mountHome()

    // Page 1 had only UniWork rows, so Home auto-paged to Page 2 and shows the device rows, never empty state
    expect(api.recents).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }))
    expect(api.recents).toHaveBeenCalledWith(expect.objectContaining({ offset: 2 }))
    expect(host.textContent).toContain('Device Page2 A.docx')
    expect(host.textContent).toContain('Device Page2 B.docx')
    expect(host.textContent).not.toContain('UW Page1 A.docx')
    expect(host.querySelector('.empty')).toBeNull()

    // More pages remain (4 < 5), so the Load more sentinel is rendered and unexhausted count is hidden
    expect(host.querySelector('.load-more')).not.toBeNull()
    expect(host.querySelector('.home-area-nav [data-nav="recent"] .nav-count')).toBeNull()

    // Triggering Load more loads Page 3 and reveals the exact per-area total (3 device rows)
    expect(intersectCb).not.toBeNull()
    await act(async () => {
      intersectCb!([{ isIntersecting: true }])
    })
    await flush()

    expect(host.textContent).toContain('Device Page3 C.docx')
    expect(host.querySelector('.load-more')).toBeNull()
    expect(host.querySelector('.home-area-nav [data-nav="recent"] .nav-count')?.textContent).toBe(
      '3',
    )
    expect(host.querySelector('.recents-heading .file-count')?.textContent).toContain('3')

    // FE13-R2-3:
    // (a) when a full PAGE_SIZE (200) page has fewer than PAGE_SIZE device rows, auto-paging fetches page 2,
    //     and when page 2 returns a short page (lastPageLen < PAGE_SIZE) while total > entries.length, auto-paging stops.
    const fullPage1: RecentEntry[] = [
      ...Array.from({ length: 199 }, (_, i) =>
        makeEntry(`/cache/uw-full-${i}.docx`, `UW Full ${i}.docx`, {
          documentId: `uw-full-${i}`,
          workspaceId: 'ws-1',
          title: `UW Full ${i}.docx`,
        }),
      ),
      makeEntry(
        '/Users/linh/Documents/Device Full 1.docx',
        'Device Full 1.docx',
        undefined,
        1_700_000_300_000,
      ),
    ]
    const shortPage2: RecentEntry[] = [
      makeEntry(
        '/Users/linh/Documents/Device Short 2.docx',
        'Device Short 2.docx',
        undefined,
        1_700_000_200_000,
      ),
    ]
    const tailPage3: RecentEntry[] = [
      makeEntry(
        '/Users/linh/Documents/Device Oldest Tail 3.docx',
        'Device Oldest Tail 3.docx',
        undefined,
        1_700_000_100_000,
      ),
    ]
    api.recents = vi.fn(async ({ offset = 0 }: { offset?: number }) => {
      if (offset === 0) return { entries: fullPage1, total: 202 }
      if (offset === 200) return { entries: shortPage2, total: 202 }
      return { entries: tailPage3, total: 202 }
    })
    const docsPill = Array.from(host.querySelectorAll<HTMLButtonElement>('.filter-pill')).find(
      (btn) => btn.textContent === 'Docs',
    )!
    await act(async () => {
      docsPill.click()
    })
    await flush()

    expect(api.recents).toHaveBeenCalledTimes(2)
    expect(api.recents).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 0 }))
    expect(api.recents).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 200 }))
    expect(host.textContent).toContain('Device Full 1.docx')
    expect(host.textContent).toContain('Device Short 2.docx')
    expect(host.textContent).not.toContain('Device Oldest Tail 3.docx')

    // (c) FE13-R3-5: sorting Cập nhật oldest-first (second click on the sorted header) over a partially loaded
    //     list (201 < 202) drains the remaining page(s)
    const updatedSort = () =>
      Array.from(
        host.querySelectorAll<HTMLButtonElement>('.recent-columns button.cloud-col-sort-btn'),
      ).find((h) => h.textContent === 'Updated')!
    expect(updatedSort().textContent).toContain('Updated')
    await act(async () => {
      updatedSort().click()
    })
    await flush()

    expect(api.recents).toHaveBeenCalledTimes(3)
    expect(api.recents).toHaveBeenNthCalledWith(3, expect.objectContaining({ offset: 201 }))
    const rowNames = Array.from(host.querySelectorAll('.recent-list .recent-name')).map(
      (el) => el.textContent,
    )
    expect(rowNames).toEqual([
      'Device Oldest Tail 3.docx',
      'Device Short 2.docx',
      'Device Full 1.docx',
    ])

    // Flip the sort once more (newest first, a real date sort) before testing empty-page stop
    await act(async () => {
      updatedSort().click()
    })
    await flush()

    // (b) when the backend returns an empty page (entries: []) while total > entries.length,
    //     loadMore clamps listTotal to entries.length and auto-paging stops without looping endlessly.
    api.recents = vi.fn(async ({ offset = 0 }: { offset?: number }) => {
      if (offset === 0) return { entries: page1Uw, total: 5 }
      return { entries: [], total: 5 }
    })
    const allPill = Array.from(host.querySelectorAll<HTMLButtonElement>('.filter-pill')).find(
      (btn) => btn.textContent === 'All',
    )!
    await act(async () => {
      allPill.click()
    })
    await flush()

    expect(api.recents).toHaveBeenCalledTimes(2)
    expect(api.recents).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 0 }))
    expect(api.recents).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 2 }))
    expect(host.querySelector('.load-more')).toBeNull()
    expect(host.textContent).toContain('No recent files — create or open a file to get started.')

    // (d) FE13-R3-5: in Starred view with an active groupFilter, Load more passes the group param to api.starred
    api.starredGroups = vi.fn(async () => ['Finance'])
    api.starred = vi.fn(async ({ offset = 0 }: { offset?: number; group?: string }) => {
      if (offset === 0) {
        return {
          entries: [makeEntry('/Users/linh/Documents/Starred Page1.docx', 'Starred Page1.docx')],
          total: 2,
        }
      }
      return {
        entries: [makeEntry('/Users/linh/Documents/Starred Page2.docx', 'Starred Page2.docx')],
        total: 2,
      }
    })
    const starredNavBtn = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.home-area-nav .nav-item'),
    )[1]!
    await act(async () => {
      starredNavBtn.click()
    })
    await flush()

    const financePill = Array.from(host.querySelectorAll<HTMLButtonElement>('.filter-pill')).find(
      (btn) => btn.textContent === 'Finance',
    )
    expect(financePill).toBeDefined()
    api.starred.mockClear()
    await act(async () => {
      financePill!.click()
    })
    await flush()

    // the header sort set in (c) is still active, and a sorted list drains its remaining pages:
    // the second page is requested with the same group without waiting for Load more
    expect(api.starred).toHaveBeenCalledTimes(2)
    expect(api.starred).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ offset: 0, group: 'Finance' }),
    )
    expect(api.starred).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offset: 1, group: 'Finance' }),
    )
    expect(host.textContent).toContain('Starred Page2.docx')
  })

  it('keys the UniWork pane by workspaceId so switching workspaces resets folder and drops pending ws-1 tree, children, and search replies at the Home boundary (FE13-R1-6, FE13-R2-4)', async () => {
    let resolveAlpha!: (res: UniworkResult<UniworkFolderChildren>) => void
    let resolveWs1Tree!: (res: UniworkResult<UniworkFolderNode[]>) => void
    let resolveWs1Search!: (res: UniworkResult<UniworkFolderChildren>) => void
    let treeChangedCb: ((ev: { workspaceId: string }) => void) | null = null
    api.onUniworkTreeChanged = vi.fn((cb: (ev: { workspaceId: string }) => void) => {
      treeChangedCb = cb
      return () => {
        treeChangedCb = null
      }
    })
    api.uniworkListChildren = vi.fn(
      (q: UniworkFolderQuery): Promise<UniworkResult<UniworkFolderChildren>> => {
        if (q.workspaceId === 'ws-1' && q.parentId === 'f-alpha') {
          return new Promise((r) => {
            resolveAlpha = r
          })
        }
        const wsMap = childrenByWs[q.workspaceId] ?? {}
        const items = wsMap[q.parentId ?? '']
        return Promise.resolve(
          items ? ok({ items, nextCursor: null }) : { ok: false, error: 'not_found' },
        )
      },
    )
    api.uniworkSearchDocuments = vi.fn(
      (q: {
        workspaceId: string
        query: string
      }): Promise<UniworkResult<UniworkFolderChildren>> => {
        if (q.workspaceId === 'ws-1') {
          return new Promise((r) => {
            resolveWs1Search = r
          })
        }
        return Promise.resolve(ok({ items: [], nextCursor: null }))
      },
    )

    await mountHome()

    // Click Alpha Folder in ws-1 -> switches to folder subview and leaves f-alpha children request in flight
    const uwTree = host.querySelector<HTMLElement>('.uwf-tree[role="tree"]')!
    const alphaNode = Array.from(uwTree.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
      (el) => el.textContent?.includes('Alpha Folder'),
    )!
    await act(async () => {
      alphaNode.click()
    })
    await flush()

    // Trigger a ws-1 tree refresh and a ws-1 document search so both are also in flight before switching workspace
    api.uniworkFolderTree = vi.fn((ws: string): Promise<UniworkResult<UniworkFolderNode[]>> => {
      if (ws === 'ws-1') {
        return new Promise((r) => {
          resolveWs1Tree = r
        })
      }
      return Promise.resolve(ok(treeByWs[ws] ?? []))
    })
    expect(treeChangedCb).not.toBeNull()
    await act(async () => {
      treeChangedCb!({ workspaceId: 'ws-1' })
    })
    await flush()

    const uwSearchInput = host.querySelector<HTMLInputElement>('.uwf-own-search')
    expect(uwSearchInput).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(uwSearchInput!, 'spec')
      uwSearchInput!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkSearchDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', query: 'spec' }),
    )

    // Switch workspace to ws-2 while ws-1 tree, children, and search requests are all still pending
    const wsSelect = host.querySelector<HTMLSelectElement>('select.home-uw-ws')
    expect(wsSelect).not.toBeNull()
    await act(async () => {
      wsSelect!.value = 'ws-2'
      wsSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    expect(api.uniworkListChildren).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-2',
        parentId: null,
      }),
    )
    expect(host.textContent).toContain('Marketing Plan.docx')
    expect(host.textContent).toContain('Beta Folder')

    // Now resolve the stale ws-1 tree, f-alpha children, and search replies -> all must be dropped
    await act(async () => {
      resolveWs1Tree(
        ok([
          {
            id: 'f-stale-ws1',
            parentId: null,
            title: 'Stale WS1 Tree Folder',
            position: 0,
            children: [],
          },
        ]),
      )
      resolveAlpha(
        ok({
          items: [
            {
              id: 'doc-alpha-1',
              workspaceId: 'ws-1',
              title: 'Alpha Spec.docx',
              format: 'docx',
              updatedAt: '2026-10-01T10:00:00Z',
              kind: 'file',
              parentId: 'f-alpha',
            },
          ],
          nextCursor: null,
        }),
      )
      resolveWs1Search(
        ok({
          items: [
            {
              id: 'doc-search-ws1',
              workspaceId: 'ws-1',
              title: 'Stale WS1 Search Hit.docx',
              format: 'docx',
              updatedAt: '2026-10-01T10:00:00Z',
              kind: 'file',
              parentId: null,
            },
          ],
          nextCursor: null,
        }),
      )
    })
    await flush()

    expect(host.textContent).toContain('Marketing Plan.docx')
    expect(host.textContent).toContain('Beta Folder')
    expect(host.textContent).not.toContain('Stale WS1 Tree Folder')
    expect(host.textContent).not.toContain('Alpha Spec.docx')
    expect(host.textContent).not.toContain('Stale WS1 Search Hit.docx')
  })

  it('renders the device add-folder CTA only when filter === "all" and all device roots are unreadable or missing, without flashing emptyRecent while folderRoots or root listings load (FE13-R1-9, V13-4, FE13-R2-1, FE13-R3-4)', async () => {
    // Case 1: roots = [default folder missing on disk] and no device recents (only a UniWork recent)
    recentEntries = [
      makeEntry('/cache/cloud-spec.docx', 'Cloud Spec.docx', {
        documentId: 'uw-doc-1',
        workspaceId: 'ws-1',
        title: 'Cloud Spec.docx',
      }),
    ]
    folderRoots = [
      {
        path: '/Users/linh/Documents',
        name: 'Documents',
        readable: true,
        usable: true,
        removable: false,
      },
    ]
    api.listFolder = vi.fn(async (dir: string) => ({
      dir,
      folders: [],
      files: [],
      missing: true,
    }))
    wbStoreSetRaw('uniwork.wb.homeArea', 'device')
    await mountHome()

    const emptyStates = host.querySelectorAll('.folder-empty-state')
    expect(emptyStates).toHaveLength(1)
    expect(host.querySelector('main.content .folder-empty-state')).not.toBeNull()
    expect(host.querySelector('.sidebar .folder-empty-state')).toBeNull()
    expect(host.textContent).toContain('No folders on this device yet.')

    const cta = host.querySelector<HTMLButtonElement>('main.content .folder-empty-cta')
    expect(cta).not.toBeNull()
    expect(cta!.classList.contains('btn')).toBe(true)
    expect(cta!.classList.contains('btn-secondary')).toBe(true)
    await act(async () => {
      cta!.click()
    })
    expect(api.addFolderRoot).toHaveBeenCalledTimes(1)

    // Case 2 (FE13-R2-1): selecting a non-"all" filter pill with unusable roots renders emptyFiltered, NOT .folder-empty-state
    const docsPill = Array.from(host.querySelectorAll<HTMLButtonElement>('.filter-pill')).find(
      (btn) => btn.textContent === 'Docs',
    )
    expect(docsPill).toBeDefined()
    await act(async () => {
      docsPill!.click()
    })
    await flush()
    expect(host.querySelector('.folder-empty-state')).toBeNull()
    expect(host.textContent).toContain('No files of this type.')
    expect(host.textContent).not.toContain(
      'No recent files — create or open a file to get started.',
    )

    // Case 3: roots = [] and filter === 'all' -> renders .folder-empty-state in main pane
    await act(async () => {
      root.unmount()
    })
    folderRoots = []
    root = createRoot(host)
    await mountHome()
    expect(host.querySelectorAll('.folder-empty-state')).toHaveLength(1)
    expect(host.querySelector('main.content .folder-empty-state')).not.toBeNull()
    expect(host.querySelector('.sidebar .folder-empty-state')).toBeNull()

    // Case 4 (FE13-R2-1): readable + unwritable root (readable: true, usable: false) with no device recents
    // renders generic emptyRecent, NOT .folder-empty-state
    await act(async () => {
      root.unmount()
    })
    folderRoots = [
      {
        path: '/Users/linh/ReadOnlyDocs',
        name: 'ReadOnlyDocs',
        readable: true,
        usable: false,
        removable: true,
      },
    ]
    api.listFolder = vi.fn(async (dir: string) => ({
      dir,
      folders: [],
      files: [],
    }))
    root = createRoot(host)
    await mountHome()
    expect(host.querySelector('.folder-empty-state')).toBeNull()
    expect(host.textContent).toContain('No recent files — create or open a file to get started.')

    // Case 5 (FE13-R2-1): initial mount while root listing is still in flight does NOT flash emptyRecent
    // before listFolder settles with missing: true
    await act(async () => {
      root.unmount()
    })
    folderRoots = [
      {
        path: '/Users/linh/Documents',
        name: 'Documents',
        readable: true,
        usable: true,
        removable: false,
      },
    ]
    let resolveListFolder!: (listing: {
      dir: string
      folders: never[]
      files: never[]
      missing: boolean
    }) => void
    api.listFolder = vi.fn(
      () =>
        new Promise((r) => {
          resolveListFolder = r
        }),
    )
    root = createRoot(host)
    await mountHome()

    // While listFolder is still pending, neither emptyRecent nor .folder-empty-state flashes
    expect(host.textContent).not.toContain(
      'No recent files — create or open a file to get started.',
    )
    expect(host.querySelector('.folder-empty-state')).toBeNull()
    expect(host.querySelector('.load-more-spinner')).not.toBeNull()

    await act(async () => {
      resolveListFolder({
        dir: '/Users/linh/Documents',
        folders: [],
        files: [],
        missing: true,
      })
    })
    await flush()
    expect(host.querySelector('main.content .folder-empty-state')).not.toBeNull()
    expect(host.textContent).toContain('No folders on this device yet.')

    // Case 6 (FE13-R3-4): !rootsLoaded spinner branch (deferred folderRoots -> spinner, never emptyRecent or CTA)
    await act(async () => {
      root.unmount()
    })
    let resolveFolderRoots!: (roots: FolderRoot[]) => void
    api.folderRoots = vi.fn(
      () =>
        new Promise((r) => {
          resolveFolderRoots = r
        }),
    )
    api.listFolder = vi.fn(async (dir: string) => ({
      dir,
      folders: [],
      files: [],
    }))
    root = createRoot(host)
    await mountHome()

    expect(host.querySelector('.load-more-spinner')).not.toBeNull()
    expect(host.querySelector('.folder-empty-state')).toBeNull()
    expect(host.textContent).not.toContain(
      'No recent files — create or open a file to get started.',
    )

    await act(async () => {
      resolveFolderRoots([
        {
          path: '/Users/linh/Documents',
          name: 'Documents',
          readable: true,
          usable: true,
          removable: false,
        },
      ])
    })
    await flush()
    expect(host.querySelector('.load-more-spinner')).toBeNull()
    expect(host.querySelector('.folder-empty-state')).toBeNull()
    expect(host.textContent).toContain('No recent files — create or open a file to get started.')

    // Case 7 (FE13-R3-4): listFolder reject -> marks root listing missing and renders .folder-empty-state CTA
    await act(async () => {
      root.unmount()
    })
    api.folderRoots = vi.fn(async () => folderRoots)
    api.listFolder = vi.fn(async () => {
      throw new Error('fs read failed')
    })
    root = createRoot(host)
    await mountHome()

    expect(host.querySelector('.load-more-spinner')).toBeNull()
    expect(host.querySelector('main.content .folder-empty-state')).not.toBeNull()
    expect(host.textContent).toContain('No folders on this device yet.')
  })

  it('recovers from rejected recents/starred promises in reload and loadMore with seq guards, preserves visible entries on a rejected soft (keepCount) reload while showing empty state on a rejected page-one reload, and keeps the other view count on stale secondary rejection (FE13-R2-2, FE13-R3-2, FE13-R3-6, FE13-R3-8)', async () => {
    wbStoreSetRaw('uniwork.wb.homeArea', 'device')
    await mountHome()

    // Sub-case 1: stale reload rejection is ignored when a newer reload succeeds (both primary and secondary),
    // and a fresh page-one reload rejection transitions listLoaded/otherLoaded to true and shows the empty state
    let rejectStaleRecents!: (err: Error) => void
    let rejectStaleStarred!: (err: Error) => void
    let callIdx = 0
    api.recents = vi.fn(() => {
      callIdx++
      if (callIdx === 1) {
        return new Promise((_, reject) => {
          rejectStaleRecents = reject
        })
      }
      if (callIdx === 2) {
        return Promise.resolve({
          entries: [makeEntry('/Users/linh/Documents/Recovered.docx', 'Recovered.docx')],
          total: 1,
        })
      }
      return Promise.reject(new Error('recents ipc failed'))
    })
    let starredCallIdx = 0
    api.starred = vi.fn(() => {
      starredCallIdx++
      if (starredCallIdx === 1) {
        return new Promise((_, reject) => {
          rejectStaleStarred = reject
        })
      }
      if (starredCallIdx === 2) {
        return Promise.resolve({
          entries: [
            makeEntry('/Users/linh/Documents/Starred1.docx', 'Starred1.docx'),
            makeEntry('/Users/linh/Documents/Starred2.docx', 'Starred2.docx'),
          ],
          total: 2,
        })
      }
      return Promise.reject(new Error('starred ipc failed'))
    })

    const docsPill = Array.from(host.querySelectorAll<HTMLButtonElement>('.filter-pill')).find(
      (btn) => btn.textContent === 'Docs',
    )!
    const sheetsPill = Array.from(host.querySelectorAll<HTMLButtonElement>('.filter-pill')).find(
      (btn) => btn.textContent === 'Sheets',
    )!
    const allPill = Array.from(host.querySelectorAll<HTMLButtonElement>('.filter-pill')).find(
      (btn) => btn.textContent === 'All',
    )!

    // Reload #1 (Docs): stays in-flight
    await act(async () => {
      docsPill.click()
    })
    await flush()

    // Reload #2 (Sheets): succeeds with Recovered.docx and 2 starred device entries
    await act(async () => {
      sheetsPill.click()
    })
    await flush()
    expect(host.textContent).toContain('Recovered.docx')
    const starredNavCountBefore = Array.from(
      host.querySelectorAll<HTMLElement>('.home-area-nav .nav-item'),
    )[1]?.querySelector('.nav-count')?.textContent
    expect(starredNavCountBefore).toBe('2')

    // Reject stale Reload #1 -> must NOT clobber Reload #2's primary entries OR secondary starred count (FE13-R3-6)
    await act(async () => {
      rejectStaleRecents(new Error('stale recents rejection'))
      rejectStaleStarred(new Error('stale starred rejection'))
    })
    await flush()
    expect(host.textContent).toContain('Recovered.docx')
    const starredNavCountAfter = Array.from(
      host.querySelectorAll<HTMLElement>('.home-area-nav .nav-item'),
    )[1]?.querySelector('.nav-count')?.textContent
    expect(starredNavCountAfter).toBe('2')

    // FE13-R3-2: a soft (keepCount) reload (e.g. window focus / refresh) that rejects keeps the visible entries (only marks loaded)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(host.textContent).toContain('Recovered.docx')
    expect(host.querySelector('.load-more-spinner')).toBeNull()
    expect(host.querySelector('.empty')).toBeNull()

    // FE13-R3-2: a page-one reload (e.g. filter change to All) that rejects clears the entries and shows the empty state
    await act(async () => {
      allPill.click()
    })
    await flush()
    expect(host.querySelector('.load-more-spinner')).toBeNull()
    expect(host.textContent).not.toContain('Recovered.docx')
    expect(host.textContent).toContain('No recent files — create or open a file to get started.')

    // Sub-case 2: loadMore rejection resets loadingMore and clamps listTotal so the sentinel stops spinning
    await act(async () => {
      root.unmount()
    })
    let intersectCb: ((records: Array<{ isIntersecting: boolean }>) => void) | null = null
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (records: Array<{ isIntersecting: boolean }>) => void) {
          intersectCb = cb
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    )
    api.recents = vi.fn(async ({ offset = 0 }: { offset?: number }) => {
      if (offset === 0) {
        return {
          entries: [makeEntry('/Users/linh/Documents/Page1.docx', 'Page1.docx')],
          total: 3,
        }
      }
      throw new Error('loadMore failed')
    })
    api.starred = vi.fn(async () => ({ entries: [], total: 0 }))
    root = createRoot(host)
    await mountHome()

    expect(host.textContent).toContain('Page1.docx')
    expect(host.querySelector('.load-more')).not.toBeNull()
    expect(intersectCb).not.toBeNull()

    await act(async () => {
      intersectCb!([{ isIntersecting: true }])
    })
    await flush()

    // After loadMore rejects, the sentinel spinner clears and Page 1 stays intact
    expect(host.textContent).toContain('Page1.docx')
    expect(host.querySelector('.load-more')).toBeNull()
  })

  it('does not re-list already-cached folder roots when roots refreshes without invalidation, but re-lists roots whose listing rejected or resolved with missing: true (FE13-R2-7, FE13-R3-1, FE13-R4-1)', async () => {
    wbStoreSetRaw('uniwork.wb.homeArea', 'device')
    recentEntries = []
    folderRoots = [
      {
        path: '/Users/linh/Documents',
        name: 'Documents',
        readable: true,
        usable: false,
        removable: false,
      },
    ]
    let docsShouldReject = true
    let desktopMissing = false
    api.listFolder = vi.fn(async (dir: string) => {
      if (dir === '/Users/linh/Documents' && docsShouldReject) {
        throw new Error('transient listFolder error')
      }
      if (dir === '/Users/linh/Desktop' && desktopMissing) {
        return {
          dir,
          folders: [],
          files: [],
          missing: true,
        }
      }
      return {
        dir,
        folders: [
          { path: `${dir}/Sub`, name: 'Sub', mtimeMs: 1_700_000_000_000, hasSubfolders: false },
        ],
        files: [],
      }
    })
    api.addFolderRoot = vi.fn(async () => {
      desktopMissing = true
      folderRoots = [
        ...folderRoots,
        {
          path: '/Users/linh/Desktop',
          name: 'Desktop',
          readable: true,
          usable: true,
          removable: true,
        },
      ]
      return folderRoots[1]!
    })

    await mountHome()

    // Step 1 (FE13-R3-1): listFolder rejects once -> CTA shows
    expect(api.listFolder.mock.calls.filter((c) => c[0] === '/Users/linh/Documents').length).toBe(1)
    expect(host.querySelector('main.content .folder-empty-state')).not.toBeNull()

    // Step 2 (FE13-R3-1): next listFolder succeeds; re-picking the same default folder via pickDefaultSaveDir
    // calls loadRoot() (a roots refresh without refresh()'s invalidateFolders) and re-lists the missing/errored root
    docsShouldReject = false
    folderRoots = [
      {
        path: '/Users/linh/Documents',
        name: 'Documents',
        readable: true,
        usable: true,
        removable: false,
      },
    ]
    const pickBtn = host.querySelector<HTMLButtonElement>('.folder-unusable button')
    expect(pickBtn).not.toBeNull()
    await act(async () => {
      pickBtn!.click()
    })
    await flush()

    expect(api.listFolder.mock.calls.filter((c) => c[0] === '/Users/linh/Documents').length).toBe(2)
    expect(host.querySelector('main.content .folder-empty-state')).toBeNull()
    expect(host.querySelector('.folder-panel [role="tree"]')?.textContent).toContain('Sub')
    expect(host.textContent).toContain('No recent files — create or open a file to get started.')

    // Step 3 (FE13-R2-7): now that /Users/linh/Documents is cached and not missing, adding a second root refreshes roots
    // without re-listing /Users/linh/Documents; /Users/linh/Desktop resolves with { missing: true } (so cached.current has it)
    const docsCallsBeforeAdd = api.listFolder.mock.calls.filter(
      (c) => c[0] === '/Users/linh/Documents',
    ).length
    const addRootBtn = host.querySelector<HTMLButtonElement>('.folder-panel .folder-add-root-btn')
    expect(addRootBtn).not.toBeNull()
    await act(async () => {
      addRootBtn!.click()
    })
    await flush()

    const docsCallsAfterAdd = api.listFolder.mock.calls.filter(
      (c) => c[0] === '/Users/linh/Documents',
    ).length
    const desktopCallsAfterAdd = api.listFolder.mock.calls.filter(
      (c) => c[0] === '/Users/linh/Desktop',
    ).length
    expect(docsCallsAfterAdd).toBe(docsCallsBeforeAdd)
    expect(desktopCallsAfterAdd).toBe(1)

    // Step 4 (FE13-R4-1): /Users/linh/Desktop resolved with { missing: true } (cached in cached.current).
    // When roots refreshes via loadRoot() (e.g. adding a third root), cur.missing triggers loadFolder(r.path, true)
    // to force re-listing /Users/linh/Desktop while keeping non-missing /Users/linh/Documents untouched.
    desktopMissing = false
    api.addFolderRoot = vi.fn(async () => {
      folderRoots = [
        ...folderRoots,
        {
          path: '/Users/linh/Downloads',
          name: 'Downloads',
          readable: true,
          usable: true,
          removable: true,
        },
      ]
      return folderRoots[2]!
    })
    await act(async () => {
      addRootBtn!.click()
    })
    await flush()

    const docsCallsAfterRecovery = api.listFolder.mock.calls.filter(
      (c) => c[0] === '/Users/linh/Documents',
    ).length
    const desktopCallsAfterRecovery = api.listFolder.mock.calls.filter(
      (c) => c[0] === '/Users/linh/Desktop',
    ).length
    expect(docsCallsAfterRecovery).toBe(docsCallsAfterAdd)
    expect(desktopCallsAfterRecovery).toBe(2)
  })

  it('catches folderRoots rejections in loadRoot, keeps previous roots without unhandled rejection, and settles rootsLoaded (FE13-R3-3)', async () => {
    wbStoreSetRaw('uniwork.wb.homeArea', 'device')
    recentEntries = []
    folderRoots = [
      {
        path: '/Users/linh/Documents',
        name: 'Documents',
        readable: true,
        usable: true,
        removable: false,
      },
    ]
    api.listFolder = vi.fn(async (dir: string) => ({
      dir,
      folders: [],
      files: [],
    }))

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      await mountHome()
      expect(host.querySelector('.folder-panel [role="treeitem"]')?.textContent).toContain(
        'Documents',
      )
      expect(host.querySelector('.folder-empty-state')).toBeNull()

      // Now make folderRoots reject on a subsequent loadRoot (triggered by window focus) -> previous roots stay intact, no CTA, no unhandledRejection
      api.folderRoots = vi.fn(() => Promise.reject(new Error('folderRoots ipc failed')))
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })
      await flush()

      expect(host.querySelector('.folder-panel [role="treeitem"]')?.textContent).toContain(
        'Documents',
      )
      expect(host.querySelector('.folder-empty-state')).toBeNull()

      // Also verify initial mount when folderRoots rejects -> rootsLoaded still settles (spinner clears) and no unhandledRejection fires
      await act(async () => {
        root.unmount()
      })
      root = createRoot(host)
      await mountHome()

      expect(host.querySelector('.load-more-spinner')).toBeNull()
      expect(host.querySelector('main.content .folder-empty-state')).not.toBeNull()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('catches openUniworkDocFromPane rejections, publishes open-failure feedback, and resets openingDocId (FE13-R1-11)', async () => {
    const spy = vi
      .spyOn(uniworkOpen, 'openUniworkDocument')
      .mockRejectedValueOnce(new Error('unexpected rejection'))
    const notices: unknown[] = []
    const unsub = onUniworkNotice((ev) => notices.push(ev))

    try {
      await mountHome()
      const fileRow = Array.from(host.querySelectorAll<HTMLElement>('.dh-doc-row')).find((el) =>
        el.textContent?.includes('Root Cloud Doc.docx'),
      )
      expect(fileRow).toBeDefined()

      await act(async () => {
        fileRow!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      })
      await flush()

      expect(spy).toHaveBeenCalledTimes(1)
      expect(notices).toContainEqual({ phase: 'failed', error: 'network' })
      expect(fileRow!.getAttribute('aria-busy')).not.toBe('true')
    } finally {
      unsub()
      spy.mockRestore()
    }
  })

  it('defines every var(--x) used in home.css and uniwork-folders.css and enforces board tab metrics, coarse-pointer target size, and >= 4.5:1 .recent-path contrast (FE13-R1-3, FE13-R1-10, V13-2, V13-3)', async () => {
    const tokensCss = readFileSync(
      resolve(__dirname, '../../../packages/ui/src/tokens.css'),
      'utf8',
    )
    const homeCss = readFileSync(resolve(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const uwfCss = readFileSync(
      resolve(__dirname, '../src/renderer/src/uniwork-folders/uniwork-folders.css'),
      'utf8',
    )
    const tabbarCss = readFileSync(resolve(__dirname, '../src/renderer/src/tabbar.css'), 'utf8')

    // FE13-R1-3: every var(--x) in home.css and uniwork-folders.css is defined in tokens.css or shell CSS
    const definedVars = new Set<string>()
    for (const css of [tokensCss, homeCss, uwfCss, tabbarCss]) {
      for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
        definedVars.add(m[1]!)
      }
    }
    const undefinedInHome = new Set<string>()
    for (const m of homeCss.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
      if (!definedVars.has(m[1]!)) undefinedInHome.add(m[1]!)
    }
    const undefinedInUwf = new Set<string>()
    for (const m of uwfCss.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
      if (!definedVars.has(m[1]!)) undefinedInUwf.add(m[1]!)
    }
    expect([...undefinedInHome]).toEqual([])
    expect([...undefinedInUwf]).toEqual([])

    // V13-2 + FE13-R1-10 + V13-3: mount styles in bundle order and verify computed styles & contrast
    const style = document.createElement('style')
    const cleanedHomeCss = homeCss
      .replace(/@keyframes\s+[\w-]+\s*\{(?:\{[^{}]*\}|[^{}])*\}/g, '')
      .replace(/@position-try\s+[\w-]+\s*\{[^{}]*\}/g, '')
    style.textContent = `${tokensCss}\n${cleanedHomeCss}`
    document.head.appendChild(style)

    try {
      wbStoreSetRaw('uniwork.wb.homeArea', 'device')
      await mountHome()

      const tablist = host.querySelector<HTMLElement>('.home-area-tabs')!
      const tab = host.querySelector<HTMLElement>('.home-area-tab.active')!
      const recentPath = host.querySelector<HTMLElement>('.recent-item .recent-path')!

      expect(window.getComputedStyle(tablist).padding).toBe('4px')
      expect(window.getComputedStyle(tab).minHeight).toBe('34px')
      expect(window.getComputedStyle(tab).fontSize).toBe('13px')
      expect(homeCss).toMatch(
        /@media\s*\(\s*pointer\s*:\s*coarse\s*\)[\s\S]*?\.home-area-tab\s*\{[^}]*min-height\s*:\s*44px/,
      )

      // V13-3: measure .recent-path contrast against --surface and --surface-subtle in light & dark
      const parseHex = (hex: string): [number, number, number] => {
        const clean = hex.trim().replace('#', '')
        const full =
          clean.length === 3
            ? clean
                .split('')
                .map((c) => c + c)
                .join('')
            : clean
        return [
          Number.parseInt(full.slice(0, 2), 16),
          Number.parseInt(full.slice(2, 4), 16),
          Number.parseInt(full.slice(4, 6), 16),
        ]
      }
      const luminance = ([r, g, b]: [number, number, number]): number => {
        const chan = (c: number) => {
          const s = c / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
      }
      const contrast = (fgHex: string, bgHex: string): number => {
        const l1 = luminance(parseHex(fgHex))
        const l2 = luminance(parseHex(bgHex))
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      }

      // Check computed property on .recent-path uses var(--text-secondary)
      expect(window.getComputedStyle(recentPath).color).toBe('var(--text-secondary)')
      const lightSec = tokensCss.match(
        /:root\s*\{[\s\S]*?--text-secondary:\s*(#[0-9a-fA-F]{6})/,
      )?.[1]
      const darkSec = tokensCss.match(
        /\[data-theme='dark'\]\s*\{[\s\S]*?--text-secondary:\s*(#[0-9a-fA-F]{6})/,
      )?.[1]
      expect(lightSec).toBe('#606366')
      expect(darkSec).toBe('#a0a0a0')
      expect(contrast(lightSec!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(lightSec!, '#f6f7f9')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(darkSec!, '#1e1e1e')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(darkSec!, '#2a2a2a')).toBeGreaterThanOrEqual(4.5)
    } finally {
      style.remove()
    }
  })
  it('keeps the UniWork sub-view (and its open folder) across an area switch within the session (VDH-7)', async () => {
    await mountHome()

    // UniWork pane is up; open Alpha Folder from its card
    expect(host.querySelector('.uwf-browser.uwf-pane')).not.toBeNull()
    const alphaCard = host.querySelector<HTMLButtonElement>(
      '.dh-folder-card[data-folder-id="f-alpha"] button.dh-folder-open',
    )!
    expect(alphaCard).not.toBeNull()
    await act(async () => {
      alphaCard.click()
    })
    await flush()
    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Alpha Folder')

    const tabs = host.querySelectorAll<HTMLButtonElement>(
      '[role="tablist"][aria-label="Area"] [role="tab"]',
    )

    // area switch away and back keeps the open folder
    await act(async () => {
      tabs[1]!.click() // On this device
    })
    await flush()
    expect(host.querySelector('.uwf-browser.uwf-pane')).toBeNull()
    await act(async () => {
      tabs[0]!.click() // back to UniWork
    })
    await flush()
    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Alpha Folder')

    // a non-workspace sub-view survives the same round trip
    const trashNav = host.querySelector<HTMLButtonElement>('.nav-item[data-nav="trash"]')!
    await act(async () => {
      trashNav.click()
    })
    await flush()
    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Trash')

    await act(async () => {
      tabs[1]!.click()
    })
    await flush()
    await act(async () => {
      tabs[0]!.click()
    })
    await flush()
    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Trash')
  })
  it('resets the UniWork sub-view and open folder to the workspace root on a workspace switch (VDH-7)', async () => {
    await mountHome()

    // Open Alpha Folder in ws-1, then switch to the Trash sub-view
    const alphaCard = host.querySelector<HTMLButtonElement>(
      '.dh-folder-card[data-folder-id="f-alpha"] button.dh-folder-open',
    )!
    await act(async () => {
      alphaCard.click()
    })
    await flush()
    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Alpha Folder')

    await act(async () => {
      host.querySelector<HTMLButtonElement>('.nav-item[data-nav="trash"]')!.click()
    })
    await flush()
    expect(
      host.querySelector<HTMLElement>('.nav-item[aria-current="page"]')?.getAttribute('data-nav'),
    ).toBe('trash')

    // Switching workspace never keeps the previous workspace's sub-view or folder
    const wsSelect = host.querySelector<HTMLSelectElement>('select.home-uw-ws')!
    await act(async () => {
      wsSelect.value = 'ws-2'
      wsSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    expect(
      host.querySelector<HTMLElement>('.nav-item[aria-current="page"]')?.getAttribute('data-nav'),
    ).toBe('workspace')
    expect(host.querySelector('.dh-main h1')?.textContent).not.toBe('Alpha Folder')
    expect(host.textContent).toContain('Marketing Plan.docx')
    expect(api.uniworkListChildren).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'ws-2', parentId: null }),
    )
  })

  it('clears the kept UniWork sub-view and folder when the account signs out or switches, so the next account opens on the default workspace root (DH1-R4-1)', async () => {
    await mountHome()
    expect(accountStatusListeners.length).toBeGreaterThan(0)

    // acc-1: open Alpha Folder and move to Trash so both kept maps hold ws-1 state
    const alphaCard = host.querySelector<HTMLButtonElement>(
      '.dh-folder-card[data-folder-id="f-alpha"] button.dh-folder-open',
    )!
    await act(async () => {
      alphaCard.click()
    })
    await flush()
    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Alpha Folder')

    await act(async () => {
      host.querySelector<HTMLButtonElement>('.nav-item[data-nav="trash"]')!.click()
    })
    await flush()
    expect(
      host.querySelector<HTMLElement>('.nav-item[aria-current="page"]')?.getAttribute('data-nav'),
    ).toBe('trash')

    // Sign out -> UniWork pane unmounts; sign in as a different account in the same workspace list
    await act(async () => {
      pushAccountStatus({ state: 'signed-out', loggedIn: false })
    })
    await flush()
    expect(host.querySelector('.uwf-browser.uwf-pane')).toBeNull()

    const account2: AccountStatus = {
      state: 'signed-in',
      loggedIn: true,
      email: 'mai@example.com',
      profile: { accountId: 'acc-2', email: 'mai@example.com', displayName: 'Mai' },
      org: { id: 'org-1', name: 'UniWork Corp' },
    }
    await act(async () => {
      pushAccountStatus(account2)
    })
    await flush()

    // The new account must not inherit acc-1's Trash sub-view or open folder
    expect(host.querySelector('.uwf-browser.uwf-pane')).not.toBeNull()
    expect(
      host.querySelector<HTMLElement>('.nav-item[aria-current="page"]')?.getAttribute('data-nav'),
    ).toBe('workspace')
    expect(host.querySelector('.dh-main h1')?.textContent).not.toBe('Alpha Folder')
    expect(host.textContent).toContain('Root Cloud Doc.docx')

    // A signed-in -> signed-in account switch clears them the same way
    const alphaCard2 = host.querySelector<HTMLButtonElement>(
      '.dh-folder-card[data-folder-id="f-alpha"] button.dh-folder-open',
    )!
    await act(async () => {
      alphaCard2.click()
    })
    await flush()
    expect(host.querySelector('.dh-main h1')?.textContent).toBe('Alpha Folder')

    const account3: AccountStatus = {
      ...account2,
      email: 'nam@example.com',
      profile: { accountId: 'acc-3', email: 'nam@example.com', displayName: 'Nam' },
    }
    await act(async () => {
      pushAccountStatus(account3)
    })
    await flush()
    expect(
      host.querySelector<HTMLElement>('.nav-item[aria-current="page"]')?.getAttribute('data-nav'),
    ).toBe('workspace')
    expect(host.querySelector('.dh-main h1')?.textContent).not.toBe('Alpha Folder')
    expect(host.textContent).toContain('Root Cloud Doc.docx')
  })
})
