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

function makeEntry(path: string, name: string, uniwork?: RecentEntry['uniwork']): RecentEntry {
  return {
    path,
    name,
    ext: 'docx',
    mtimeMs: 1_700_000_000_000,
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

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.lang = 'en'
    if (!('IntersectionObserver' in globalThis)) {
      ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    }

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
      onAccountStatus: vi.fn(() => () => {}),
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
      root.render(createElement(LocaleProvider, null, createElement(Home)))
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

  it('renders a neutral loading skeleton in the UniWork area while accountStatus is loading and does not reset workspace state (FE13-R1-4)', async () => {
    wbStoreSetRaw('uniwork.wb.homeArea', 'uniwork')
    wbStoreSetRaw('uniwork.wb.activeWorkspace', 'ws-2')
    let resolveStatus!: (s: AccountStatus) => void
    const deferredStatus = new Promise<AccountStatus>((r) => {
      resolveStatus = r
    })
    api.accountStatus = vi.fn(() => deferredStatus)
    api.accountGetStatus = vi.fn(() => deferredStatus)

    await mountHome()

    const main = host.querySelector('main.content')
    expect(main).not.toBeNull()
    expect(main!.querySelector('.wb-work-skeleton')).not.toBeNull()
    expect(main!.textContent).not.toContain('Sign in to UniWork')
    expect(wbStoreGetRaw('uniwork.wb.activeWorkspace')).toBe('ws-2')

    await act(async () => {
      resolveStatus(accountStatus)
    })
    await flush()

    expect(main!.querySelector('.wb-work-skeleton')).toBeNull()
    expect(host.textContent).toContain('Marketing Plan.docx')
  })

  it('isolates sources per area (no mixing), shows accurate per-area counts, and keeps the open UniWork folder across area switches (FE13-R1-1, FE13-R1-6)', async () => {
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

    await mountHome()

    // In UniWork area: UniworkBrowser variant="pane" is mounted at root by default
    expect(host.querySelector('.uwf-browser.uwf-pane')).not.toBeNull()
    const uwTree = host.querySelector<HTMLElement>('.uwf-tree[role="tree"]')
    expect(uwTree).not.toBeNull()
    expect(host.querySelector('.folder-panel')).toBeNull()
    expect(host.textContent).toContain('Root Cloud Doc.docx')

    // Per-area nav counts in UniWork area: 2 recent, 1 starred
    const uwNavItems = Array.from(host.querySelectorAll<HTMLElement>('.home-area-nav .nav-item'))
    expect(uwNavItems[0]?.querySelector('.nav-count')?.textContent).toBe('2')
    expect(uwNavItems[1]?.querySelector('.nav-count')?.textContent).toBe('1')

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

    // Click Recent in UniWork area -> shows only UniWork recent rows and count 2
    const recentBtnUw = host.querySelector<HTMLButtonElement>('.nav-item[data-nav="recent"]')!
    await act(async () => {
      recentBtnUw.click()
    })
    await flush()
    expect(host.textContent).toContain('Cloud Spec.docx')
    expect(host.textContent).toContain('Cloud Roadmap.docx')
    expect(host.textContent).not.toContain('Local Report.docx')
    expect(host.querySelector('.recents-heading .file-count')?.textContent).toContain('2')

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

    // Switch back to "UniWork" area -> still on "Alpha Folder"
    const uwTab = tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0]!
    await act(async () => {
      uwTab.click()
    })
    await flush()
    expect(host.textContent).toContain('Alpha Spec.docx')

    // Switch back to "On this device" area -> previously open local folder "/Users/linh/Documents" is still open
    await act(async () => {
      deviceTab.click()
    })
    await flush()
    const localFolderRowAfter = host.querySelector<HTMLElement>('.folder-panel [role="treeitem"]')
    expect(localFolderRowAfter?.getAttribute('aria-selected')).toBe('true')
  })

  it('keeps paging when page 1 has only UniWork rows so the device area shows page-2 device rows and Load more, never the empty state (FE13-R1-1)', async () => {
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
    ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      constructor(cb: (records: Array<{ isIntersecting: boolean }>) => void) {
        intersectCb = cb
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }

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
  })

  it('keys the UniWork pane by workspaceId so switching workspaces resets folder and drops pending ws-1 replies at the Home boundary (FE13-R1-6)', async () => {
    let resolveAlpha!: (res: UniworkResult<UniworkFolderChildren>) => void
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

    await mountHome()

    // Click Alpha Folder in ws-1 -> request is now in flight (pending)
    const uwTree = host.querySelector<HTMLElement>('.uwf-tree[role="tree"]')!
    const alphaNode = Array.from(uwTree.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
      (el) => el.textContent?.includes('Alpha Folder'),
    )!
    await act(async () => {
      alphaNode.click()
    })
    await flush()

    // Switch workspace to ws-2 while ws-1 f-alpha request is still pending
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

    // Now resolve the stale ws-1 f-alpha reply -> must be dropped and never overwrite ws-2
    await act(async () => {
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
    })
    await flush()

    expect(host.textContent).toContain('Marketing Plan.docx')
    expect(host.textContent).not.toContain('Alpha Spec.docx')
  })

  it('renders exactly ONE device empty state with btn-secondary add-folder CTA in the main pane when device has no files and roots are empty or missing (FE13-R1-9, V13-4)', async () => {
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

    // Case 2: roots = [] and no device recents -> also renders exactly ONE empty state in main pane
    await act(async () => {
      root.unmount()
    })
    folderRoots = []
    root = createRoot(host)
    await mountHome()
    expect(host.querySelectorAll('.folder-empty-state')).toHaveLength(1)
    expect(host.querySelector('main.content .folder-empty-state')).not.toBeNull()
    expect(host.querySelector('.sidebar .folder-empty-state')).toBeNull()
  })

  it('catches openUniworkDocFromPane rejections, publishes open-failure feedback, and resets openingDocId (FE13-R1-11)', async () => {
    const spy = vi
      .spyOn(uniworkOpen, 'openUniworkDocument')
      .mockRejectedValueOnce(new Error('unexpected rejection'))
    const notices: unknown[] = []
    const unsub = onUniworkNotice((ev) => notices.push(ev))

    try {
      await mountHome()
      const fileRow = Array.from(host.querySelectorAll<HTMLElement>('.uwf-list .uw-pick-row')).find(
        (el) => el.textContent?.includes('Root Cloud Doc.docx'),
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
})
