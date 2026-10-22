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
import {
  openDocumentShare,
  resetDocumentsIntentBusForTests,
  revealInTrash,
} from '../src/renderer/src/documents-intent-bus'
import { onUniworkNotice } from '../src/renderer/src/uniwork-notice-bus'

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
      // UNI-2080: a tree menu reads the folder's level when it opens; these folders are manageable
      uniworkDocumentProperties: vi.fn(async (id: string) =>
        ok({ documentId: id, workspaceId: 'ws-1', title: id, myLevel: 'manage' }),
      ),
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
    expect(uwPane()!.querySelector('.dh-main h1')!.textContent).toBe('Recent')
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
    expect(uwPane()!.querySelector('.dh-main h1')!.textContent).toBe('Alpha Folder')
  })

  // UNI-1932 SB1-1: a dialog opened from the sidebar must not render inside the hidden pane
  const visibleDialog = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(
      (el) => el.closest('[hidden]') === null,
    )
  const alphaRow = () =>
    Array.from(host.querySelectorAll<HTMLElement>('.home-uw-side-slot [role="treeitem"]')).find(
      (el) => el.textContent?.includes('Alpha Folder'),
    )

  it.each([
    ['My AI', enterMyAi],
    ['Workbench', enterWorkbench],
  ])('the + New folder button in %s leaves the mode and shows its dialog', async (_l, enter) => {
    await mountHome()
    await enter()

    await click(host.querySelector('.home-uw-side-slot .dh-sidebar-add'))

    expect(myAiNav()!.getAttribute('aria-current')).toBeNull()
    expect(workbenchNav()!.getAttribute('aria-current')).toBeNull()
    expect(uwPaneShown()).toBe(true)
    expect(visibleDialog()).toBeTruthy()
  })

  it.each([
    ['new', 'My AI', enterMyAi],
    ['new', 'Workbench', enterWorkbench],
    ['move', 'My AI', enterMyAi],
  ])('tree row menu "%s" in %s leaves the mode and shows its dialog', async (action, _l, enter) => {
    await mountHome()
    await enter()

    await click(alphaRow()!.querySelector('[data-folder-menu-for]'))
    await click(document.querySelector(`[role="menuitem"][data-folder-action="${action}"]`))

    expect(myAiNav()!.getAttribute('aria-current')).toBeNull()
    expect(workbenchNav()!.getAttribute('aria-current')).toBeNull()
    expect(uwPaneShown()).toBe(true)
    expect(visibleDialog()).toBeTruthy()
  })

  it('inline tree rename in My AI stays in the mode', async () => {
    await mountHome()
    await enterMyAi()

    await click(alphaRow()!.querySelector('[data-folder-menu-for]'))
    await click(document.querySelector('[role="menuitem"][data-folder-action="rename"]'))

    expect(myAiNav()!.getAttribute('aria-current')).toBe('page')
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

  // UNI-2079: a notice names a document's Share section or its Trash row; Home brings the
  // Documents home on screen (the Documents home itself does the rest, see doclist-trash tests)
  describe('documents intents (UNI-2079)', () => {
    let notices: unknown[]
    let offNotice: () => void
    const trashNavCurrent = () => uwNavItem('trash')?.getAttribute('aria-current') === 'page'

    beforeEach(() => {
      resetDocumentsIntentBusForTests()
      notices = []
      Element.prototype.scrollIntoView = () => {}
      offNotice = onUniworkNotice((event) => notices.push(event))
      api.uniworkListTrash = vi.fn(async () =>
        ok({
          documents: [
            {
              id: 'doc-trashed',
              workspaceId: 'ws-1',
              title: 'Gone.docx',
              format: 'docx' as const,
              updatedAt: '2026-10-10T06:00:00.000Z',
              kind: 'file' as const,
              parentId: null,
              archived: true,
            },
          ],
          nextCursor: null,
        }),
      )
    })
    afterEach(() => {
      offNotice()
      resetDocumentsIntentBusForTests()
    })

    it.each([
      ['My AI', enterMyAi],
      ['Workbench', enterWorkbench],
    ])(
      'a Trash intent in %s leaves the mode, opens the Trash and selects the row',
      async (_l, enter) => {
        await mountHome()
        await enter()
        await act(async () => revealInTrash({ documentId: 'doc-trashed', workspaceId: 'ws-1' }))
        await flush(8)

        expect(myAiNav()!.getAttribute('aria-current')).toBeNull()
        expect(workbenchNav()!.getAttribute('aria-current')).toBeNull()
        expect(uwPaneShown()).toBe(true)
        expect(trashNavCurrent()).toBe(true)
        expect(
          uwPane()!.querySelector('[data-doc-id="doc-trashed"]')!.getAttribute('aria-selected'),
        ).toBe('true')
      },
    )

    it('a Share intent leaves the Workbench and shows the Documents home', async () => {
      await mountHome()
      await enterWorkbench()
      await act(async () =>
        openDocumentShare({ documentId: 'doc-root-1', workspaceId: 'ws-1', section: 'requests' }),
      )
      await flush(8)
      expect(workbenchNav()!.getAttribute('aria-current')).toBeNull()
      expect(uwPaneShown()).toBe(true)
    })

    it('from the device area it switches to the UniWork area', async () => {
      wbStoreSetRaw('uniwork.wb.homeArea', 'device')
      await mountHome()
      expect(uwNav()).toBeNull()
      await act(async () => revealInTrash({ documentId: 'doc-trashed', workspaceId: 'ws-1' }))
      await flush(8)
      expect(uwPaneShown()).toBe(true)
      expect(trashNavCurrent()).toBe(true)
    })

    it('an intent published before Home mounted is applied once the workspaces are in', async () => {
      revealInTrash({ documentId: 'doc-trashed', workspaceId: 'ws-1' })
      await mountHome()
      await flush(8)
      expect(uwPaneShown()).toBe(true)
      expect(trashNavCurrent()).toBe(true)
    })

    it("switches to the intent's workspace", async () => {
      workspaces.push({ id: 'ws-2', name: 'Finance' })
      try {
        await mountHome()
        await act(async () => revealInTrash({ documentId: 'doc-trashed', workspaceId: 'ws-2' }))
        await flush(8)
        expect(api.uniworkListTrash!.mock.calls.some((c) => c[0].workspaceId === 'ws-2')).toBe(true)
        expect(trashNavCurrent()).toBe(true)
      } finally {
        workspaces.pop()
      }
    })

    it('a workspace the person is not in is not opened: the notice says no access', async () => {
      await mountHome()
      await enterWorkbench()
      await act(async () => revealInTrash({ documentId: 'doc-trashed', workspaceId: 'ws-9' }))
      await flush(8)
      expect(workbenchNav()!.getAttribute('aria-current')).toBe('page')
      expect(notices).toEqual([{ phase: 'failed', error: 'forbidden' }])
    })
  })
})
