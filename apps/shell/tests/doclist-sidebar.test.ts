/**
 * @vitest-environment jsdom
 *
 * UNI-2047 sidebar (USER order 2026-10-21): the Documents sidebar draws what the web's
 * documents-sidebar.tsx draws.
 * 1. The Thư mục tree has no root row: the top-level folders sit at the first level, My Folder
 *    first (the web DocumentTree folders mode); the "Tài liệu của workspace" nav item is the root.
 *    The folder picker keeps its root row (it needs a root target).
 * 2. "Từ nơi khác" is a section of four rows, Chat · Họp · Email · Công việc, each with its module
 *    tile and tint, each opening the Từ nơi khác page filtered to that source. The section shows
 *    once the sources route has answered for the workspace and is hidden when it is not deployed.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UniworkFolderNode,
  UniworkResult,
  UniworkSourceFile,
  UniworkSourceListPage,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type { DocumentsHomeSubViewId } from '../src/renderer/src/uniwork-home/documents-home-model'
import { UniworkFolderTree } from '../src/renderer/src/uniwork-folders/UniworkFolderTree'
import { UniworkFolderPicker } from '../src/renderer/src/uniwork-folders/UniworkFolderPicker'
import { ROOT_KEY } from '../src/renderer/src/uniwork-folders/uniwork-folders-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

const folder = (
  id: string,
  title: string,
  children: UniworkFolderNode[] = [],
  extra: Partial<UniworkFolderNode> = {},
): UniworkFolderNode => ({ id, parentId: null, title, position: 0, children, ...extra })

// the server order puts My Folder last: the tree still draws it first
const NODES: UniworkFolderNode[] = [
  folder('f-alpha', 'Alpha', [folder('f-beta', 'Beta')]),
  folder('f-gamma', 'Gamma'),
  folder('f-mine', 'My Folder', [], { systemKind: 'my_folder' }),
]

// My Folder shows its localized label, never the stored title
const MY_FOLDER = 'Thư mục của tôi'

const SOURCE: UniworkSourceFile = {
  id: 's-1',
  source: 'meeting',
  parent: { kind: 'meeting', id: 'm-1', title: 'Giao ban' },
  name: 'bien-ban.pdf',
  mimeType: 'application/pdf',
  extension: 'pdf',
  sizeBytes: 1_000,
  updatedAt: new Date(2026, 9, 21, 9, 0).toISOString(),
  owner: { id: 'u-1', name: 'Minh Trần' },
  canOpenInApp: false,
  canSave: true,
}

let host: HTMLDivElement
let sidebarSlot: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>
let sources: (q: Record<string, unknown>) => Promise<UniworkResult<UniworkSourceListPage>>
const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const baseApi = (): Record<string, ReturnType<typeof vi.fn>> => {
  const empty = () => ok({ documents: [], nextCursor: null })
  return {
    uniworkFolderTree: vi.fn(async () => ok(NODES)),
    uniworkListChildren: vi.fn(async () => ok({ items: [], nextCursor: null })),
    uniworkListDocuments: vi.fn(async () => empty()),
    uniworkListFavorites: vi.fn(async () => empty()),
    uniworkListSharedWithMe: vi.fn(async () => empty()),
    uniworkListSharedByMe: vi.fn(async () => empty()),
    uniworkListTrash: vi.fn(async () => empty()),
    uniworkListShelved: vi.fn(async () => empty()),
    uniworkListSources: vi.fn((q: Record<string, unknown>) => sources(q)),
    uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
    onUniworkTreeChanged: vi.fn(() => () => {}),
    onUniworkDocRenamed: vi.fn(() => () => {}),
    onUniworkUploadProgress: vi.fn(() => () => {}),
  }
}

const install = (next: Record<string, ReturnType<typeof vi.fn>>) => {
  api = next
  ;(window as unknown as { aiOffice: unknown; home: unknown }).aiOffice = api
  ;(window as unknown as { aiOffice: unknown; home: unknown }).home = api
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('genoffice.lang', 'vi')
  document.documentElement.lang = 'vi'
  sources = async () => ok({ items: [SOURCE], nextCursor: null })
  install(baseApi())
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
  vi.restoreAllMocks()
})

async function mount(subView: DocumentsHomeSubViewId = 'workspace', lang: 'vi' | 'en' = 'vi') {
  localStorage.setItem('genoffice.lang', lang)
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(DocumentsHome, {
          workspaceId: 'ws-1',
          workspaces,
          onWorkspaceChange: vi.fn(),
          onOpenDocument: vi.fn(),
          sidebarHost: sidebarSlot,
          initialSubView: subView,
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
const key = async (el: Element | null | undefined, k: string) => {
  expect(el).toBeTruthy()
  await act(async () => {
    el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
  await flush()
}
const calls = (fn: string) => api[fn]!.mock.calls.map((c) => c[0] as Record<string, unknown>)
const lastCall = (fn: string) => calls(fn)[calls(fn).length - 1]

const sideTree = () => sidebarSlot.querySelector<HTMLElement>('[role="tree"]')
const treeRows = () =>
  Array.from(sideTree()?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])
const rowTitles = () => treeRows().map((r) => r.querySelector('.uwf-tree-title')?.textContent)
const rowOf = (title: string) =>
  treeRows().find((r) => r.querySelector('.uwf-tree-title')?.textContent === title)
const workspaceNav = () => sidebarSlot.querySelector<HTMLElement>('[data-nav="workspace"]')
const sourceSection = () => sidebarSlot.querySelector<HTMLElement>('.dl-side-sources')
const sourceRows = () =>
  Array.from(sidebarSlot.querySelectorAll<HTMLElement>('.dl-side-sources [data-source]'))

describe('the Thư mục tree in the sidebar has no root row (web DocumentTree folders mode)', () => {
  it('draws the top-level folders at the first level, My Folder first, and no root row', async () => {
    await mount('workspace')
    expect(sideTree()).not.toBeNull()
    expect(sideTree()!.querySelector(`[role="treeitem"][data-key="${ROOT_KEY}"]`)).toBeNull()
    expect(rowTitles()).toEqual([MY_FOLDER, 'Alpha', 'Gamma'])
    expect(treeRows().map((r) => r.getAttribute('aria-level'))).toEqual(['1', '1', '1'])
    expect(treeRows().map((r) => r.getAttribute('aria-posinset'))).toEqual(['1', '2', '3'])
    expect(treeRows().every((r) => r.getAttribute('aria-setsize') === '3')).toBe(true)
    expect(sidebarSlot.textContent).not.toContain('Tài liệu (gốc)')
  })

  it('no folder open: the workspace nav item is current and no tree row is selected', async () => {
    await mount('workspace')
    expect(workspaceNav()?.getAttribute('aria-current')).toBe('page')
    expect(treeRows().filter((r) => r.getAttribute('aria-selected') === 'true')).toEqual([])
    // the tab stop is on a drawn row, never on the hidden root
    const tabStops = treeRows().filter((r) => r.tabIndex === 0)
    expect(tabStops.map((r) => r.dataset.key)).toEqual(['f-mine'])
  })

  it('keys walk the first level: arrows move, ArrowRight expands, ArrowLeft collapses then stays, Enter opens', async () => {
    await mount('workspace')
    const first = rowOf(MY_FOLDER)!
    await act(async () => first.focus())
    await key(first, 'ArrowUp')
    // nothing above the first row: focus stays on it, never on a hidden root
    expect(document.activeElement).toBe(rowOf(MY_FOLDER))
    await key(document.activeElement, 'ArrowDown')
    expect(document.activeElement).toBe(rowOf('Alpha'))
    await key(document.activeElement, 'ArrowRight')
    expect(rowOf('Alpha')!.getAttribute('aria-expanded')).toBe('true')
    expect(rowOf('Beta')!.getAttribute('aria-level')).toBe('2')
    await key(document.activeElement, 'ArrowRight')
    expect(document.activeElement).toBe(rowOf('Beta'))
    await key(document.activeElement, 'ArrowLeft')
    expect(document.activeElement).toBe(rowOf('Alpha'))
    await key(document.activeElement, 'ArrowLeft')
    expect(rowOf('Alpha')!.getAttribute('aria-expanded')).toBe('false')
    expect(rowOf('Beta')).toBeUndefined()
    // a first-level row has no parent row to go to
    await key(document.activeElement, 'ArrowLeft')
    expect(document.activeElement).toBe(rowOf('Alpha'))
    await key(document.activeElement, 'End')
    expect(document.activeElement).toBe(rowOf('Gamma'))
    await key(document.activeElement, 'Home')
    expect(document.activeElement).toBe(rowOf(MY_FOLDER))
    await key(rowOf('Gamma'), 'Enter')
    expect(lastCall('uniworkListChildren')).toMatchObject({ parentId: 'f-gamma' })
    expect(rowOf('Gamma')!.getAttribute('aria-selected')).toBe('true')
    expect(workspaceNav()?.getAttribute('aria-current')).toBeNull()
    // the workspace nav item is the root again
    await click(workspaceNav())
    expect(workspaceNav()?.getAttribute('aria-current')).toBe('page')
    expect(treeRows().filter((r) => r.getAttribute('aria-selected') === 'true')).toEqual([])
  })
})

describe('UniworkFolderTree: the root row is opt-out', () => {
  const render = async (props: Record<string, unknown>) => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(UniworkFolderTree, {
            nodes: NODES,
            label: 'Cây thư mục',
            expanded: new Set([ROOT_KEY]),
            onExpandedChange: vi.fn(),
            selectedKey: ROOT_KEY,
            onOpen: vi.fn(),
            ...props,
          }),
        ),
      )
    })
    await flush()
  }
  const keys = () =>
    Array.from(host.querySelectorAll<HTMLElement>('[role="treeitem"]')).map((r) => r.dataset.key)

  it('keeps the root row by default (the picker and the dialogs need a root target)', async () => {
    await render({})
    expect(keys()).toEqual([ROOT_KEY, 'f-mine', 'f-alpha', 'f-gamma'])
    expect(host.querySelector('[role="treeitem"]')?.getAttribute('aria-level')).toBe('1')
  })

  it('hideRoot draws the folders from the first level even when the root is collapsed', async () => {
    await render({ hideRoot: true, expanded: new Set() })
    expect(keys()).toEqual(['f-mine', 'f-alpha', 'f-gamma'])
    expect(host.querySelector(`[data-key="${ROOT_KEY}"]`)).toBeNull()
  })

  it('the folder picker still offers the root', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(UniworkFolderPicker, {
            title: 'Di chuyển',
            confirmLabel: 'Di chuyển',
            workspaceId: 'ws-1',
            loadTree: vi.fn(async () => ok(NODES)),
            nodes: NODES,
            initialFolderId: null,
            onPick: vi.fn(),
            onCancel: vi.fn(),
          }),
        ),
      )
    })
    await flush()
    const rootRow = document.querySelector(`[role="treeitem"][data-key="${ROOT_KEY}"]`)
    expect(rootRow).not.toBeNull()
    expect(rootRow!.textContent).toContain('Tài liệu (gốc)')
  })
})

describe('the Từ nơi khác section: four source rows (web SOURCE_KINDS)', () => {
  it.each([
    ['vi', 'Từ nơi khác', ['Chat', 'Họp', 'Email', 'Công việc']],
    ['en', 'From elsewhere', ['Chat', 'Meetings', 'Email', 'Tasks']],
  ] as const)(
    '%s: a section labelled %s holding the rows in the web order',
    async (lang, title, labels) => {
      await mount('workspace', lang)
      const section = sourceSection()
      expect(section, 'the sources section').not.toBeNull()
      expect(section!.querySelector('.dh-sidebar-label')?.textContent).toBe(title)
      expect(sourceRows().map((r) => r.dataset.source)).toEqual([
        'chat',
        'meeting',
        'email',
        'task',
      ])
      expect(sourceRows().map((r) => r.querySelector('.dl-side-label')?.textContent)).toEqual(
        labels,
      )
      // the single nav item is gone: the section replaces it
      expect(sidebarSlot.querySelector('[data-nav="elsewhere"]')).toBeNull()
      expect(
        Array.from(sidebarSlot.querySelectorAll('.dh-nav-label')).map((el) => el.textContent),
      ).not.toContain(title)
    },
  )

  it('draws each row with its module tile and tint, as the web app sidebar draws the module', async () => {
    await mount('workspace')
    const tiles = sourceRows().map((r) => r.querySelector<HTMLElement>('.dl-side-tile'))
    expect(tiles.every(Boolean)).toBe(true)
    expect(tiles.map((t) => t!.dataset.tone)).toEqual(['blue', 'violet', 'orange', 'green'])
    expect(tiles.map((t) => t!.classList.contains(`tone-${t!.dataset.tone}`))).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(tiles.map((t) => t!.querySelector('svg')?.dataset.icon)).toEqual([
      'message-square',
      'video',
      'mail',
      'square-check-big',
    ])
    expect(tiles.every((t) => t!.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('a row opens Từ nơi khác filtered to that source and is the current row', async () => {
    await mount('workspace')
    const meeting = sourceRows().find((r) => r.dataset.source === 'meeting')
    await click(meeting)
    expect(lastCall('uniworkListSources')).toEqual({ workspaceId: 'ws-1', source: 'meeting' })
    expect(host.querySelector('.dh-title')?.textContent).toBe('Từ nơi khác')
    expect(host.textContent).toContain('bien-ban.pdf')
    expect(sourceRows().map((r) => r.getAttribute('aria-current'))).toEqual([
      null,
      'page',
      null,
      null,
    ])
    expect(workspaceNav()?.getAttribute('aria-current')).toBeNull()

    await click(sourceRows().find((r) => r.dataset.source === 'chat'))
    expect(lastCall('uniworkListSources')).toEqual({ workspaceId: 'ws-1', source: 'chat' })
    expect(sourceRows().map((r) => r.getAttribute('aria-current'))).toEqual([
      'page',
      null,
      null,
      null,
    ])

    // the page's type chip and the source travel together
    await click(host.querySelector('[data-chip="pdf"]'))
    expect(lastCall('uniworkListSources')).toEqual({
      workspaceId: 'ws-1',
      source: 'chat',
      type: 'pdf',
    })

    // another nav item: no source row is current
    await click(workspaceNav())
    expect(sourceRows().every((r) => r.getAttribute('aria-current') === null)).toBe(true)
  })

  it('probes the sources route once (limit 1) off the page; the page itself reads it without a probe', async () => {
    await mount('workspace')
    expect(calls('uniworkListSources')).toEqual([{ workspaceId: 'ws-1', limit: 1 }])
    // the root never lists what the probe read (F-14, Q2=A)
    expect(host.querySelector('[data-source-id]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    install(baseApi())
    await mount('elsewhere')
    expect(calls('uniworkListSources')).toEqual([{ workspaceId: 'ws-1' }])
    expect(sourceSection()).not.toBeNull()
  })
})

describe('the Từ nơi khác section is hidden when the sources route is not there', () => {
  it('sources 404 (not deployed): no section', async () => {
    sources = async () => ({ ok: false, error: 'not_found' })
    await mount('workspace')
    expect(api.uniworkListSources).toHaveBeenCalledTimes(1)
    expect(sourceSection()).toBeNull()
    expect(sidebarSlot.querySelector('[data-nav="elsewhere"]')).toBeNull()
  })

  it('a bridge without the sources call: no section', async () => {
    const next = baseApi()
    delete next.uniworkListSources
    install(next)
    await mount('workspace')
    expect(sourceSection()).toBeNull()
  })

  it('before the route has answered: no section', async () => {
    sources = () => new Promise(() => {})
    await mount('workspace')
    expect(sourceSection()).toBeNull()
  })

  it('a 404 on the page itself hides the section beside the "not available" state (RV-1)', async () => {
    sources = async () => ({ ok: false, error: 'not_found' })
    await mount('elsewhere')
    expect(host.querySelector('.dl-state-title')?.textContent).toBe(
      'Từ nơi khác chưa dùng được trên máy chủ này',
    )
    expect(sourceSection()).toBeNull()
  })
})
