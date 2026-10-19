/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountStatus,
  HomeApi,
  UniworkDocSummary,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkFolderQuery,
  UniworkResult,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { Home } from '../src/renderer/src/Home'
import { wbStoreSetRaw } from '../src/renderer/src/workbench-store-client'

// Workbench body (Desk / drafts / work APIs) is out of scope here: only Home's own mode switch is under test
vi.mock('../src/renderer/src/PracticeHome', () => ({
  PracticeHome: () => createElement('div', { 'data-testid': 'practice-home' }),
}))

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

// UNI-1932: the UniWork sidebar nav must survive My AI / Workbench on the UniWork tab.
describe('Home UniWork sidebar in My AI / Workbench mode (UNI-1932)', () => {
  let host: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>

  const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Engineering' }]
  const tree: UniworkFolderNode[] = [
    { id: 'f-alpha', parentId: null, title: 'Alpha Folder', position: 0, children: [] },
  ]
  const children: Record<string, UniworkDocSummary[]> = {
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
  }

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
    const accountStatus: AccountStatus = {
      state: 'signed-in',
      loggedIn: true,
      email: 'linh@example.com',
      profile: { accountId: 'acc-1', email: 'linh@example.com', displayName: 'Linh' },
      org: { id: 'org-1', name: 'UniWork Corp' },
    }
    api = {
      folderRoots: vi.fn(async () => []),
      listFolder: vi.fn(async () => ({ folders: [], files: [] })),
      onFolderChanged: vi.fn(() => () => {}),
      recents: vi.fn(async () => ({ entries: [], total: 0 })),
      starred: vi.fn(async () => ({ entries: [], total: 0 })),
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
      uniworkFolderTree: vi.fn(async () => ok(tree)),
      uniworkListChildren: vi.fn(
        async (q: UniworkFolderQuery): Promise<UniworkResult<UniworkFolderChildren>> => {
          const items = children[q.parentId ?? '']
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
    }
    ;(window as unknown as { aiOffice: HomeApi }).aiOffice = api as unknown as HomeApi
    // projectMode on: shows the Workbench entry in the top sidebar nav
    ;(window as unknown as { aiOfficeProject: unknown }).aiOfficeProject = {
      listProjects: vi.fn(async () => []),
    }
    wbStoreSetRaw('uniwork.wb.homeArea', 'uniwork')
    wbStoreSetRaw('uniwork.wb.activeWorkspace', 'ws-1')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    delete (window as unknown as { aiOfficeProject?: unknown }).aiOfficeProject
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
      root.render(createElement(LocaleProvider, null, createElement(Home)))
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

  const myAiNav = () => host.querySelector<HTMLButtonElement>('.sidebar-nav [data-nav="chat"]')
  const workbenchNav = () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('.sidebar-nav .nav-item')).find((b) =>
      b.textContent?.includes('Workbench'),
    )
  const uwNav = () => host.querySelector<HTMLElement>('.home-uw-side-slot nav.dh-subnav')
  const uwNavItem = (id: string) =>
    host.querySelector<HTMLButtonElement>(`.home-uw-side-slot [data-nav="${id}"]`)
  const uwPane = () => host.querySelector<HTMLElement>('main.home-uw-pane')
  const uwPaneShown = () => !!uwPane() && uwPane()!.hidden === false

  async function enterMyAi() {
    await click(myAiNav())
    expect(myAiNav()!.getAttribute('aria-current')).toBe('page')
  }
  async function enterWorkbench() {
    await click(workbenchNav())
    expect(workbenchNav()!.getAttribute('aria-current')).toBe('page')
  }

  it('baseline: UniWork tab shows the nav with the Workspace documents item current', async () => {
    await mountHome()
    expect(uwNav()).not.toBeNull()
    expect(uwNavItem('workspace')!.getAttribute('aria-current')).toBe('page')
    expect(uwPaneShown()).toBe(true)
  })

  it.each([
    ['My AI', enterMyAi],
    ['Workbench', enterWorkbench],
  ])('keeps the UniWork nav in %s with no item current', async (_label, enter) => {
    await mountHome()
    await enter()

    expect(uwNav()).not.toBeNull()
    expect(uwNav()!.querySelectorAll('[aria-current]')).toHaveLength(0)
    expect(uwNavItem('recent')).not.toBeNull()
    expect(host.querySelector('.home-uw-side-slot [role="tree"]')).not.toBeNull()
    // the folder tree must not mark a row as current either
    expect(host.querySelectorAll('.home-uw-side-slot [aria-current]')).toHaveLength(0)
    expect(host.querySelectorAll('.home-uw-side-slot [aria-selected="true"]')).toHaveLength(0)
  })

  it.each([
    ['My AI', enterMyAi],
    ['Workbench', enterWorkbench],
  ])('clicking a nav item in %s leaves the mode and shows that sub-view', async (_l, enter) => {
    await mountHome()
    await enter()

    await click(uwNavItem('recent'))

    expect(myAiNav()!.getAttribute('aria-current')).toBeNull()
    expect(workbenchNav()!.getAttribute('aria-current')).toBeNull()
    expect(uwPaneShown()).toBe(true)
    expect(uwNavItem('recent')!.getAttribute('aria-current')).toBe('page')
    expect(uwPane()!.querySelector('.dh-title')!.textContent).toBe('Recent')
  })

  it('clicking a folder in the tree from My AI leaves the mode and opens that folder', async () => {
    await mountHome()
    await enterMyAi()

    const row = Array.from(
      host.querySelectorAll<HTMLElement>('.home-uw-side-slot [role="treeitem"]'),
    ).find((el) => el.textContent?.includes('Alpha Folder'))
    expect(row).toBeTruthy()
    await click(row)

    expect(myAiNav()!.getAttribute('aria-current')).toBeNull()
    expect(uwPaneShown()).toBe(true)
    expect(uwPane()!.querySelector('.dh-title')!.textContent).toBe('Alpha Folder')
  })

  it('does not refetch the folder tree or the list when entering and leaving My AI', async () => {
    await mountHome()
    const treeCalls = api.uniworkFolderTree!.mock.calls.length
    const listCalls = api.uniworkListChildren!.mock.calls.length

    await enterMyAi()
    await click(uwNavItem('workspace'))

    expect(api.uniworkFolderTree!.mock.calls.length).toBe(treeCalls)
    expect(api.uniworkListChildren!.mock.calls.length).toBe(listCalls)
  })

  it('device tab is unchanged: no UniWork nav slot', async () => {
    wbStoreSetRaw('uniwork.wb.homeArea', 'device')
    await mountHome()
    expect(uwNav()).toBeNull()
    expect(host.querySelector('.folder-panel')).not.toBeNull()
  })
})
