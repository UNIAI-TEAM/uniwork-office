/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HomeApi,
  UniworkDocSummary,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkFolderQuery,
  UniworkResult,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkBrowser } from '../src/renderer/src/uniwork-folders/UniworkBrowser'
import { UniworkFolderPicker } from '../src/renderer/src/uniwork-folders/UniworkFolderPicker'
import { LocationFields } from '../src/renderer/src/UniworkDocActions'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import { uniworkSaveStrings } from '../src/renderer/src/i18n/strings-uniwork-save'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'

/**
 * MYFOLDER-01 / SAVE-01 §4 (AC-5): My Folder in the FD-11 browser, tree,
 * picker and the Location field - the localized label from `systemKind` (a
 * different stored title is never shown), sorted first, no rename / move on
 * it, still a valid create / move target.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const us = uniworkSaveStrings.en
const uf = uniworkFolderStrings.en
const STORED = 'Stored title the server keeps'

function node(
  id: string,
  title: string,
  children: UniworkFolderNode[] = [],
  extra: Partial<UniworkFolderNode> = {},
): UniworkFolderNode {
  return {
    id,
    parentId: null,
    title,
    position: 0,
    children: children.map((c) => ({ ...c, parentId: id })),
    ...extra,
  }
}

function entry(
  id: string,
  title: string,
  extra: Partial<UniworkDocSummary> = {},
): UniworkDocSummary {
  return {
    id,
    workspaceId: 'w1',
    title,
    format: null,
    updatedAt: '2026-10-01T10:00:00Z',
    kind: 'folder',
    parentId: null,
    ...extra,
  }
}

const ok = <T>(value: T) => ({ ok: true as const, value })

let tree: UniworkFolderNode[]
let children: Record<string, UniworkDocSummary[]>
let host: HTMLDivElement
let root: Root
let api: ReturnType<typeof makeApi>

function makeApi() {
  const fns = {
    uniworkFolderTree: vi.fn(async (_ws: string) => ok(tree)),
    uniworkListChildren: vi.fn(
      async (q: UniworkFolderQuery): Promise<UniworkResult<UniworkFolderChildren>> => {
        const items = children[q.parentId ?? '']
        return items ? ok({ items, nextCursor: null }) : { ok: false, error: 'not_found' }
      },
    ),
    uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
    uniworkCreateFolder: vi.fn(async (i: { parentId: string | null; title: string }) =>
      ok(entry('new', i.title, { parentId: i.parentId })),
    ),
    uniworkMoveDocument: vi.fn(async (i: { documentId: string; parentId: string | null }) =>
      ok({ summary: entry(i.documentId, 'Beta', { parentId: i.parentId }), renamedTo: null }),
    ),
    uniworkRenameDocument: vi.fn(),
    // the tree row menu reads the folder's level when it opens (UNI-2080)
    uniworkDocumentProperties: vi.fn(async (id: string) =>
      ok({ documentId: id, workspaceId: 'w1', title: id, myLevel: 'edit' }),
    ),
    onUniworkTreeChanged: vi.fn(() => () => undefined),
  }
  window.aiOffice = fns as unknown as HomeApi
  return fns
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function mount(el: ReturnType<typeof createElement>, lang: 'en' | 'vi' = 'en') {
  await act(async () => {
    root.render(
      createElement(LocaleProvider, { initial: lang }, createElement(UniworkLiveHost), el),
    )
  })
  await flush()
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel))
const treeItem = (title: string) =>
  $$('[role="treeitem"]').find((el) => el.querySelector('.uwf-tree-title')?.textContent === title)!
const treeTitles = () => $$('[role="treeitem"] .uwf-tree-title').map((el) => el.textContent)
const optionTitles = () => $$('[role="option"] .uw-pick-row-title').map((el) => el.textContent)

async function click(el: Element | null | undefined) {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

async function contextMenu(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  })
  await flush()
}

const menuActions = () =>
  $$('[role="menuitem"]').map((el) => (el as HTMLElement).dataset.folderAction)

beforeEach(() => {
  tree = [
    node('a', 'Alpha'),
    node('mf', STORED, [node('mf1', 'Drafts')], { systemKind: 'my_folder' }),
    node('b', 'Beta'),
  ]
  children = {
    '': [
      entry('a', 'Alpha'),
      entry('b', 'Beta'),
      entry('mf', STORED, { systemKind: 'my_folder' }),
      entry('d1', 'Report.docx', { kind: 'file', format: 'docx' }),
    ],
    mf: [entry('mf1', 'Drafts', { parentId: 'mf' })],
  }
  api = makeApi()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
  Object.defineProperty(window, 'localStorage', { value: ls, configurable: true })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  resetLiveForTests()
})

describe('My Folder in the browser (tree + contents + breadcrumb)', () => {
  const browser = (props: Partial<Parameters<typeof UniworkBrowser>[0]> = {}) =>
    createElement(UniworkBrowser, {
      workspaceId: 'w1',
      variant: 'pane',
      onOpenDocument: vi.fn(),
      ...props,
    })

  it('the tree shows the label from systemKind (not the stored title), sorted first', async () => {
    await mount(browser())
    expect(treeTitles()).toEqual([uf.ufRoot, us.usMyFolder, 'Alpha', 'Beta'])
    expect(document.body.textContent).not.toContain(STORED)
  })

  it('the vi label is "Thư mục của tôi"', async () => {
    await mount(browser(), 'vi')
    expect(treeTitles()[1]).toBe('Thư mục của tôi')
  })

  it('the contents list shows the label and puts My Folder first, folders before files', async () => {
    await mount(browser())
    expect(optionTitles()).toEqual([us.usMyFolder, 'Alpha', 'Beta', 'Report.docx'])
  })

  it('the tree row menu of My Folder offers New subfolder only (no rename / move)', async () => {
    await mount(browser())
    await contextMenu(treeItem(us.usMyFolder))
    expect(menuActions()).toEqual(['open', 'new'])
    await click($('[data-folder-action="new"]'))
    // still a valid create target
    expect($('.uw-act-heading')?.textContent).toBe(uf.ufNewSubfolder)
  })

  it('F2 on My Folder does not start a rename', async () => {
    await mount(browser())
    const row = treeItem(us.usMyFolder)
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
    })
    await flush()
    expect(row.querySelector('input')).toBeNull()
  })

  it('other folders keep rename and move', async () => {
    await mount(browser())
    await contextMenu(treeItem('Alpha'))
    expect(menuActions()).toEqual(['open', 'new', 'rename', 'move'])
  })

  it('the contents row menu of My Folder hides rename / move', async () => {
    await mount(browser())
    const option = $$('[role="option"]').find(
      (el) => el.querySelector('.uw-pick-row-title')?.textContent === us.usMyFolder,
    )!
    await contextMenu(option)
    expect(menuActions()).toEqual(['new'])
  })

  it('My Folder is still a move target for a document, listed first under its label', async () => {
    await mount(browser())
    const option = $$('[role="option"]').find(
      (el) => el.querySelector('.uw-pick-row-title')?.textContent === 'Report.docx',
    )!
    await contextMenu(option)
    await click($('[data-folder-action="move"]'))
    const picker = $('.uwf-picker')!
    const titles = Array.from(picker.querySelectorAll('.uwf-tree-title')).map(
      (el) => el.textContent,
    )
    expect(titles.slice(0, 2)).toEqual([uf.ufRoot, us.usMyFolder])
    const mine = Array.from(picker.querySelectorAll('[role="treeitem"]')).find(
      (el) => el.querySelector('.uwf-tree-title')?.textContent === us.usMyFolder,
    )!
    expect(mine.getAttribute('aria-disabled')).toBeNull()
    await click(mine)
    await click(
      Array.from(picker.querySelectorAll('button')).find((b) => b.textContent === uf.ufMove),
    )
    expect(api.uniworkMoveDocument).toHaveBeenCalledWith({ documentId: 'd1', parentId: 'mf' })
  })

  it('a workspace folder cannot be moved into My Folder: the row is locked with the reason (UNI-2066)', async () => {
    await mount(browser())
    await contextMenu(treeItem('Beta'))
    await click($('[data-folder-action="move"]'))
    const mine = Array.from($('.uwf-picker')!.querySelectorAll('[role="treeitem"]')).find(
      (el) => el.querySelector('.uwf-tree-title')?.textContent === us.usMyFolder,
    )!
    expect(mine.getAttribute('aria-disabled')).toBe('true')
    expect(mine.querySelector('.uwf-reason')?.textContent).toBe(uf.ufDisabledWsFolder)
  })

  it('the breadcrumb and the folder-change path name My Folder by its label', async () => {
    const onFolderChange = vi.fn()
    await mount(browser({ onFolderChange }))
    await click(treeItem(us.usMyFolder))
    expect($('.uwf-crumb-current')?.textContent).toBe(us.usMyFolder)
    expect(onFolderChange).toHaveBeenLastCalledWith('mf', [{ id: 'mf', title: us.usMyFolder }])
  })
})

describe('UniworkFolderPicker rootBlocked (optional, default false)', () => {
  const picker = (extra: Partial<Parameters<typeof UniworkFolderPicker>[0]> = {}) =>
    createElement(UniworkFolderPicker, {
      title: 'Pick',
      confirmLabel: uf.ufChoose,
      workspaceId: 'w1',
      loadTree: async () => ok(tree),
      initialFolderId: 'a',
      onPick: vi.fn(),
      onCancel: vi.fn(),
      ...extra,
    })

  it('without rootBlocked the root stays pickable (move, conflict copy keep today’s behaviour)', async () => {
    const onPick = vi.fn()
    await mount(picker({ onPick }))
    const rootRow = treeItem(uf.ufRoot)
    expect(rootRow.getAttribute('aria-disabled')).toBeNull()
    await click(rootRow)
    await click($$('button').find((b) => b.textContent === uf.ufChoose))
    expect(onPick).toHaveBeenCalledWith({ folderId: null, path: [] })
  })

  it('with rootBlocked the root is disabled with its reason and cannot be confirmed', async () => {
    const onPick = vi.fn()
    await mount(picker({ onPick, rootBlocked: true, initialFolderId: null }))
    const rootRow = treeItem(uf.ufRoot)
    expect(rootRow.getAttribute('aria-disabled')).toBe('true')
    expect(rootRow.querySelector('.uwf-reason')?.textContent).toBe(us.usRootBlocked)
    const confirm = $$('button').find((b) => b.textContent === uf.ufChoose)!
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    await click(confirm)
    expect(onPick).not.toHaveBeenCalled()
    await click(treeItem(us.usMyFolder))
    await click(confirm)
    expect(onPick).toHaveBeenCalledWith({
      folderId: 'mf',
      path: [{ id: 'mf', title: us.usMyFolder }],
    })
  })
})

describe('LocationFields (New / Upload) with no folder = My Folder (Q1)', () => {
  const fields = (folderId: string | null) =>
    createElement(LocationFields, {
      workspaces: [],
      target: { workspaceId: 'w1', folderId },
      loadTree: async () => ok(tree),
      onChange: vi.fn(),
    })

  it('labels the no-folder target with the My Folder label, never "UniWork (root)"', async () => {
    await mount(fields(null))
    const button = $('.uwf-location-btn')!
    expect(button.getAttribute('aria-label')).toBe(`${uf.ufLocation}: ${us.usMyFolder}`)
    expect(button.textContent).not.toContain(uf.ufLocationRoot)
  })

  it('its picker blocks the root (it would land in My Folder anyway)', async () => {
    await mount(fields(null))
    await click($('.uwf-location-btn'))
    expect(treeItem(uf.ufRoot).getAttribute('aria-disabled')).toBe('true')
  })
})
