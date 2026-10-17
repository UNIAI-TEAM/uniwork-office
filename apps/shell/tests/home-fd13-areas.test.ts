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
import { LocaleProvider } from '../src/renderer/src/locale'
import { Home } from '../src/renderer/src/Home'
import * as docsModel from '../src/renderer/src/uniwork-docs-model'
import { wbStoreGetRaw, wbStoreSetRaw } from '../src/renderer/src/workbench-store-client'

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

  it('renders accessible tablist "Area" ("Khu vực") with arrow-key navigation and persists selection per user', async () => {
    await mountHome()

    const tablist = host.querySelector<HTMLElement>('[role="tablist"][aria-label="Area"]')
    expect(tablist).not.toBeNull()
    const tabs = Array.from(tablist!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs.map((t) => t.textContent)).toEqual(['UniWork', 'On this device'])

    // Signed in by default -> UniWork tab is selected
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('false')
    const panelId = tabs[0]!.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(host.querySelector(`#${panelId}[role="tabpanel"]`)).not.toBeNull()

    // ArrowRight moves to "On this device" and persists choice
    await act(async () => {
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()

    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1])
    expect(wbStoreGetRaw('uniwork.wb.homeArea')).toBe('device')

    // ArrowLeft moves back to "UniWork"
    await act(async () => {
      tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    await flush()

    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    expect(wbStoreGetRaw('uniwork.wb.homeArea')).toBe('uniwork')
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

  it('isolates sources per area (no mixing) and keeps the open UniWork folder across area switches', async () => {
    await mountHome()

    // In UniWork area: UniworkBrowser variant="pane" is mounted at root by default
    expect(host.querySelector('.uwf-browser.uwf-pane')).not.toBeNull()
    const uwTree = host.querySelector<HTMLElement>('.uwf-tree[role="tree"]')
    expect(uwTree).not.toBeNull()
    expect(host.querySelector('.folder-panel')).toBeNull()
    expect(host.textContent).toContain('Root Cloud Doc.docx')

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

    // Click Recent in UniWork area -> shows only UniWork recent row, never local row
    const recentBtnUw = host.querySelector<HTMLButtonElement>('.nav-item[data-nav="recent"]')!
    await act(async () => {
      recentBtnUw.click()
    })
    await flush()
    expect(host.textContent).toContain('Cloud Spec.docx')
    expect(host.textContent).not.toContain('Local Report.docx')

    // Switch to "On this device" area -> shows local folder tree and only local recent row without UniWork badge
    const tablist = host.querySelector<HTMLElement>('[role="tablist"][aria-label="Area"]')!
    const deviceTab = tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!
    await act(async () => {
      deviceTab.click()
    })
    await flush()

    expect(host.querySelector('.folder-panel')).not.toBeNull()
    expect(host.textContent).toContain('Local Report.docx')
    expect(host.textContent).not.toContain('Cloud Spec.docx')
    expect(host.querySelector('.uw-recent-badge')).toBeNull()
    expect(host.textContent).toContain('Open file on this device')

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

  it('keys the UniWork pane by workspaceId so switching workspaces resets folder and drops stale replies', async () => {
    await mountHome()

    // Open Alpha Folder in ws-1
    const uwTree = host.querySelector<HTMLElement>('.uwf-tree[role="tree"]')!
    const alphaNode = Array.from(uwTree.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
      (el) => el.textContent?.includes('Alpha Folder'),
    )!
    await act(async () => {
      alphaNode.click()
    })
    await flush()
    expect(host.textContent).toContain('Alpha Spec.docx')

    // Switch workspace to ws-2 via the workspace selector (or active workspace store)
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
    expect(host.textContent).not.toContain('Alpha Spec.docx')
  })

  it('renders an empty state with add-folder CTA in the device area when there are no local roots', async () => {
    folderRoots = []
    wbStoreSetRaw('uniwork.wb.homeArea', 'device')
    await mountHome()

    expect(host.textContent).toContain('No folders on this device yet.')
    const cta = host.querySelector<HTMLButtonElement>('.folder-empty-cta')
    expect(cta).not.toBeNull()
    await act(async () => {
      cta!.click()
    })
    expect(api.addFolderRoot).toHaveBeenCalledTimes(1)
  })
})
