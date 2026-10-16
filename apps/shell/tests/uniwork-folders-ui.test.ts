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
  UniworkSearchQuery,
  UniworkTreeChangedEvent,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkBrowser } from '../src/renderer/src/uniwork-folders/UniworkBrowser'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'

/**
 * FD-11 S1-S3: the UniWork browser against a typed fake of the folder IPC
 * (no main runs). Tree + contents + breadcrumb, search with paths, stale
 * answers, the tree-changed refresh with the vanished-folder fallback, and
 * the folder actions (create, move) with their field error / announce.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkFolderStrings.en
const docEn = uniworkDocumentStrings.en

function folder(id: string, title: string, children: UniworkFolderNode[] = []): UniworkFolderNode {
  return {
    id,
    parentId: null,
    title,
    position: 0,
    children: children.map((c) => ({ ...c, parentId: id })),
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
    format: 'docx',
    updatedAt: '2026-10-01T10:00:00Z',
    kind: 'file',
    parentId: null,
    ...extra,
  }
}

const asFolder = (id: string, title: string, parentId: string | null = null) =>
  entry(id, title, { kind: 'folder', format: null, parentId })

const ok = <T>(value: T) => ({ ok: true as const, value })

let tree: UniworkFolderNode[]
let children: Record<string, UniworkDocSummary[]>
let host: HTMLDivElement
let root: Root
let api: ReturnType<typeof makeApi>
let onOpen: ReturnType<typeof vi.fn>

function makeApi() {
  let treeChanged: ((e: UniworkTreeChangedEvent) => void) | null = null
  const fns = {
    uniworkFolderTree: vi.fn(async (_ws: string) => ok(tree)),
    uniworkListChildren: vi.fn(
      async (q: UniworkFolderQuery): Promise<UniworkResult<UniworkFolderChildren>> => {
        const items = children[q.parentId ?? '']
        return items ? ok({ items, nextCursor: null }) : { ok: false, error: 'not_found' }
      },
    ),
    uniworkSearchDocuments: vi.fn(async (_q: UniworkSearchQuery) =>
      ok<UniworkFolderChildren>({
        items: [
          asFolder('s1', 'Plans'),
          entry('s2', 'Budget.xlsx', {
            format: 'xlsx',
            path: [
              { id: 'a', title: 'Alpha' },
              { id: 'a1', title: 'Contracts' },
            ],
          }),
        ],
        nextCursor: null,
      }),
    ),
    uniworkCreateFolder: vi.fn(async (i: { parentId: string | null; title: string }) =>
      ok(asFolder('new', i.title, i.parentId)),
    ),
    uniworkMoveDocument: vi.fn(async (i: { documentId: string; parentId: string | null }) =>
      ok({
        summary: entry(i.documentId, 'Report.docx', { parentId: i.parentId }),
        renamedTo: null,
      }),
    ),
    uniworkRenameDocument: vi.fn(async (id: string, name: string) => ok(asFolder(id, name))),
    onUniworkTreeChanged: vi.fn((cb: (e: UniworkTreeChangedEvent) => void) => {
      treeChanged = cb
      return () => {
        treeChanged = null
      }
    }),
  }
  window.aiOffice = fns as unknown as HomeApi
  return Object.assign(fns, { pushTreeChanged: (e: UniworkTreeChangedEvent) => treeChanged?.(e) })
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function render(props: Partial<Parameters<typeof UniworkBrowser>[0]> = {}) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(UniworkLiveHost),
        createElement(UniworkBrowser, {
          workspaceId: 'w1',
          variant: 'pane',
          onOpenDocument: onOpen,
          ...props,
        }),
      ),
    )
  })
  await flush()
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel))
const treeItem = (title: string) =>
  $$('[role="treeitem"]').find((el) => el.querySelector('.uwf-tree-title')?.textContent === title)!
const optionTitles = () => $$('[role="option"] .uw-pick-row-title').map((el) => el.textContent)

async function click(el: Element | null | undefined) {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

async function key(el: Element, k: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }))
  })
  await flush()
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

beforeEach(() => {
  tree = [folder('a', 'Alpha', [folder('a1', 'Contracts')]), folder('b', 'Beta')]
  children = {
    '': [
      entry('d1', 'Report.docx'),
      asFolder('b', 'Beta'),
      entry('p1', 'Meeting notes', { kind: 'page', format: null }),
      asFolder('a', 'Alpha'),
      entry('z1', 'archive.zip', { format: null }),
    ],
    a: [asFolder('a1', 'Contracts', 'a'), entry('d2', 'Plan.docx', { parentId: 'a' })],
    a1: [entry('d3', 'Deal.docx', { parentId: 'a1' })],
    b: [],
  }
  api = makeApi()
  onOpen = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  // R1-7: Node 25's built-in localStorage shadows jsdom's without getItem/setItem
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

describe('UniworkBrowser: tree and contents (S1)', () => {
  it('shows the root and its folders as a tree and the root contents, folders first', async () => {
    await render()
    const treeEl = $('[role="tree"]')!
    expect(treeEl.getAttribute('aria-label')).toBe(en.ufTreeLabel)
    expect(
      $$('[role="treeitem"]').map((el) => el.querySelector('.uwf-tree-title')?.textContent),
    ).toEqual(['UniWork', 'Alpha', 'Beta'])
    expect(treeItem('UniWork').getAttribute('aria-selected')).toBe('true')
    expect(treeItem('Alpha').getAttribute('aria-level')).toBe('2')
    expect(treeItem('Alpha').getAttribute('aria-expanded')).toBe('false')
    expect(api.uniworkListChildren).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', parentId: null }),
    )
    expect(optionTitles()).toEqual(['Alpha', 'Beta', 'Report.docx'])
    // the page and the zip are hidden with one count line (F11-L2: shared uwPickHiddenFormats)
    const hiddenLine = $('.uwf-hidden')!
    expect(hiddenLine.textContent).toBe(docEn.uwPickHiddenFormats.replace('{count}', '2'))
    // R2-3: hidden-formats count line has an id referenced by aria-describedby on the contents listbox and search box
    expect(hiddenLine.id).toBeTruthy()
    expect($('[role="listbox"]')?.getAttribute('aria-describedby')).toBe(hiddenLine.id)
    expect($('.uwf-own-search')?.getAttribute('aria-describedby')).toBe(hiddenLine.id)
  })

  it('opens a folder from the tree, shows its breadcrumb and goes back by it', async () => {
    await render()
    await click(treeItem('Alpha'))
    expect(api.uniworkListChildren).toHaveBeenLastCalledWith(
      expect.objectContaining({ parentId: 'a' }),
    )
    expect(optionTitles()).toEqual(['Contracts', 'Plan.docx'])
    expect($('.uwf-hidden')).toBeNull()
    expect($('[role="listbox"]')?.hasAttribute('aria-describedby')).toBe(false)
    expect($('.uwf-own-search')?.hasAttribute('aria-describedby')).toBe(false)
    expect($('.uwf-crumb-current')?.textContent).toBe('Alpha')
    expect(treeItem('Alpha').getAttribute('aria-selected')).toBe('true')
    // double click on a folder row browses into it (3 levels)
    await act(async () => {
      $$('[role="option"]')[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await flush()
    expect(optionTitles()).toEqual(['Deal.docx'])
    expect($$('.uwf-crumb-btn').map((b) => b.textContent)).toEqual(['UniWork', 'Alpha'])
    expect($('.uwf-crumb-current')?.textContent).toBe('Contracts')
    await click($$('.uwf-crumb-btn')[0])
    expect(optionTitles()).toEqual(['Alpha', 'Beta', 'Report.docx'])
  })

  it('opens a file with Enter on its row (the host opens it)', async () => {
    await render()
    const row = $$('[role="option"]').find((el) => el.textContent?.includes('Report.docx'))!
    await key(row, 'Enter')
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }))
  })

  it('tree keys: ArrowRight expands, ArrowDown moves, Enter opens', async () => {
    await render()
    const alpha = treeItem('Alpha')
    await key(alpha, 'ArrowRight')
    expect(treeItem('Alpha').getAttribute('aria-expanded')).toBe('true')
    expect(treeItem('Contracts')).toBeTruthy()
    await key(treeItem('Alpha'), 'ArrowDown')
    expect(document.activeElement).toBe(treeItem('Contracts'))
    await key(treeItem('Contracts'), 'Enter')
    expect(api.uniworkListChildren).toHaveBeenLastCalledWith(
      expect.objectContaining({ parentId: 'a1' }),
    )
  })

  it('collapses a breadcrumb deeper than 4 levels behind "…"', async () => {
    tree = [folder('l1', 'L1', [folder('l2', 'L2', [folder('l3', 'L3', [folder('l4', 'L4')])])])]
    children.l4 = []
    await render({ initialFolderId: 'l4' })
    expect($$('.uwf-crumb-btn').map((b) => b.textContent)).toEqual(['UniWork', 'L3'])
    const more = $('[data-folder-menu-for="crumbs-more"]')!
    expect(more.getAttribute('aria-label')).toBe(en.ufMoreLevels)
    await click(more)
    const items = $$('[role="menuitem"]')
    expect(items.map((i) => i.textContent)).toEqual(['L1', 'L2'])
    children.l1 = []
    await click(items[0])
    expect(api.uniworkListChildren).toHaveBeenLastCalledWith(
      expect.objectContaining({ parentId: 'l1' }),
    )
  })

  it('remembers the sort choice per viewer', async () => {
    await render()
    const select = $<HTMLSelectElement>('.uwf-sort')!
    await act(async () => {
      select.value = 'updated'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(window.localStorage.getItem('uniwork.folders.sort')).toBe('updated')
  })

  it('loads more folder contents with cursor and drops a stale page after leaving the folder (R1-8)', async () => {
    api.uniworkListChildren.mockImplementationOnce(async () =>
      ok({ items: [entry('d1', 'Page1.docx')], nextCursor: 'cur-2' }),
    )
    await render()
    expect(optionTitles()).toEqual(['Page1.docx'])
    const more = $<HTMLButtonElement>('.uw-pick-more')!
    expect(more).toBeTruthy()
    api.uniworkListChildren.mockImplementationOnce(async (q: UniworkFolderQuery) => {
      expect(q.cursor).toBe('cur-2')
      return ok({ items: [entry('d2', 'Page2.docx')], nextCursor: 'cur-3' })
    })
    await click(more)
    expect(optionTitles()).toEqual(['Page1.docx', 'Page2.docx'])

    // start loading page 3, then switch folders before it arrives: the stale page is dropped
    let releasePage3: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    api.uniworkListChildren.mockImplementationOnce(
      () => new Promise((resolve) => (releasePage3 = resolve)),
    )
    await click($<HTMLButtonElement>('.uw-pick-more'))
    await click(treeItem('Beta'))
    expect($('.uwf-crumb-current')?.textContent).toBe('Beta')
    await act(async () =>
      releasePage3(ok({ items: [entry('d3', 'StalePage3.docx')], nextCursor: null })),
    )
    await flush()
    expect(optionTitles()).toEqual([])
  })
})

describe('UniworkBrowser: freshness', () => {
  it('drops the answer of a folder left before it came back', async () => {
    await render()
    let releaseA: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    api.uniworkListChildren.mockImplementationOnce(
      () => new Promise((resolve) => (releaseA = resolve)),
    )
    await click(treeItem('Alpha'))
    await click(treeItem('Beta'))
    expect($('.uw-pick-state-title')?.textContent).toBe(en.ufEmptyFolder)
    await act(async () => releaseA(ok({ items: children.a!, nextCursor: null })))
    await flush()
    expect($('.uwf-crumb-current')?.textContent).toBe('Beta')
    expect(optionTitles()).toEqual([])
  })

  it('re-reads tree and folder on a tree-changed push for its workspace only', async () => {
    await render()
    const reads = api.uniworkFolderTree.mock.calls.length
    await act(async () => api.pushTreeChanged({ workspaceId: 'other' }))
    await flush()
    expect(api.uniworkFolderTree.mock.calls.length).toBe(reads)
    tree = [...tree, folder('c', 'Gamma')]
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    expect(api.uniworkFolderTree.mock.calls.length).toBe(reads + 1)
    expect(treeItem('Gamma')).toBeTruthy()
  })

  it('falls back to the nearest live ancestor when the open folder vanished', async () => {
    await render({ initialFolderId: 'a1' })
    expect($('.uwf-crumb-current')?.textContent).toBe('Contracts')
    // moved away on the web: the feed push re-reads the tree
    tree = [folder('a', 'Alpha'), folder('b', 'Beta')]
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    expect($('.uwf-crumb-current')?.textContent).toBe('Alpha')
    expect($('.uwf-notice')?.textContent).toBe(en.ufFolderGone)
  })

  it('a folder read answering not_found falls back too (window focus refresh)', async () => {
    await render()
    await click(treeItem('Beta'))
    delete children.b
    tree = [folder('a', 'Alpha')]
    await act(async () => window.dispatchEvent(new Event('focus')))
    await flush()
    expect($('.uwf-crumb-current')?.textContent).toBe('UniWork')
    expect($('.uwf-notice')?.textContent).toBe(en.ufFolderGone)
  })

  it('settles on a live ancestor when two levels vanish and the tree index is stale (R1-6)', async () => {
    // tree read fails so index is empty; user browses r -> a -> b via folder rows
    api.uniworkFolderTree.mockResolvedValue({ ok: false, error: 'network' })
    children[''] = [asFolder('r', 'RootDir')]
    children.r = [asFolder('a', 'Alpha', 'r'), entry('dr', 'Kept.docx', { parentId: 'r' })]
    children.a = [asFolder('b', 'Beta', 'a')]
    children.b = [entry('db', 'Leaf.docx', { parentId: 'b' })]
    await render()
    await act(async () => {
      $$('[role="option"]')[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await flush()
    await act(async () => {
      $$('[role="option"]')[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await flush()
    await act(async () => {
      $$('[role="option"]')[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await flush()
    expect(optionTitles()).toEqual(['Leaf.docx'])

    // both b and a vanish on the server while the tree index still lacks them
    let calls = 0
    api.uniworkListChildren.mockImplementation(async (q: UniworkFolderQuery) => {
      if (++calls > 20) return { ok: false, error: 'server_error' }
      if (q.parentId === 'b' || q.parentId === 'a') return { ok: false, error: 'not_found' }
      return ok({ items: children[q.parentId ?? ''] ?? [], nextCursor: null })
    })
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    expect(optionTitles()).toEqual(['Alpha', 'Kept.docx'])
    expect($('.uwf-notice')?.textContent).toBe(en.ufFolderGone)
  })

  it('soft refresh keeps loaded pages and focus, and does not drop an in-flight loadMore (R1-1)', async () => {
    api.uniworkListChildren.mockImplementation(async (q: UniworkFolderQuery) => {
      if (q.cursor === 'c2') {
        return ok({ items: [entry('d2', 'Second.docx')], nextCursor: 'c3' })
      }
      return ok({ items: [entry('d1', 'First.docx')], nextCursor: 'c2' })
    })
    await render()
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect(optionTitles()).toEqual(['First.docx', 'Second.docx'])
    const secondOpt = $$('[role="option"]').find((el) => el.textContent?.includes('Second.docx'))!
    await click(secondOpt)
    await act(async () => secondOpt.focus())
    expect(document.activeElement).toBe(secondOpt)

    // start an in-flight page 3 loadMore, then trigger a soft refresh before page 3 resolves
    let releasePage3: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    api.uniworkListChildren.mockImplementationOnce(
      () => new Promise((resolve) => (releasePage3 = resolve)),
    )
    await click($<HTMLButtonElement>('.uw-pick-more'))
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    // page 2 is still there and focus is preserved on the option element
    expect(optionTitles()).toEqual(['First.docx', 'Second.docx'])
    expect(document.activeElement).toBe(secondOpt)

    // now the in-flight page 3 resolves: it was not dropped by the soft refresh
    await act(async () =>
      releasePage3(ok({ items: [entry('d3', 'Third.docx')], nextCursor: null })),
    )
    await flush()
    expect(optionTitles()).toEqual(['First.docx', 'Second.docx', 'Third.docx'])
  })

  it('re-reads loaded extra pages on soft refresh so moved, deleted, or renamed page-2 items update while keeping scroll and focus (R2-2)', async () => {
    let page2Items: UniworkDocSummary[] = [
      asFolder('f2', 'SubTwo'),
      entry('d2', 'Second.docx'),
      entry('d3', 'Third.docx'),
    ]
    api.uniworkListChildren.mockImplementation(async (q: UniworkFolderQuery) => {
      if (q.cursor === 'c2') {
        return ok({ items: page2Items, nextCursor: null })
      }
      return ok({ items: [asFolder('b', 'Beta'), entry('d1', 'First.docx')], nextCursor: 'c2' })
    })
    await render()
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect(optionTitles()).toEqual(['Beta', 'SubTwo', 'First.docx', 'Second.docx', 'Third.docx'])

    const listbox = $<HTMLElement>('[role="listbox"]')!
    listbox.scrollTop = 64
    const thirdOpt = $$('[role="option"]').find((el) => el.textContent?.includes('Third.docx'))!
    await click(thirdOpt)
    await act(async () => thirdOpt.focus())
    expect(document.activeElement).toBe(thirdOpt)

    // 1. Own action: move page-2 item Second.docx away to Beta
    api.uniworkMoveDocument.mockImplementationOnce(async () => {
      page2Items = page2Items.filter((i) => i.id !== 'd2')
      return ok({
        summary: entry('d2', 'Second.docx', { parentId: 'b' }),
        renamedTo: null,
      })
    })
    const secondRow = $$('.uw-pick-item').find((el) => el.textContent?.includes('Second.docx'))!
    await click(secondRow.querySelector('[data-folder-menu-for]'))
    await click($('[data-folder-action="move"]'))
    const picker = $('.uwf-picker')!
    const beta = Array.from(picker.querySelectorAll<HTMLElement>('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Beta'),
    )!
    await click(beta)
    await click(picker.querySelector('.btn-primary'))
    expect(optionTitles()).toEqual(['Beta', 'SubTwo', 'First.docx', 'Third.docx'])
    expect(listbox.scrollTop).toBe(64)

    // 2. Own action: rename page-2 folder SubTwo -> SubTwoRenamed
    api.uniworkRenameDocument.mockImplementationOnce(async (id: string, name: string) => {
      page2Items = page2Items.map((i) => (i.id === id ? { ...i, title: name } : i))
      return ok(asFolder(id, name))
    })
    const subTwoRow = $$('.uw-pick-item').find((el) => el.textContent?.includes('SubTwo'))!
    await click(subTwoRow.querySelector('[data-folder-menu-for]'))
    await click($('[data-folder-action="rename"]'))
    await type($<HTMLInputElement>('.modal.uw-act input')!, 'SubTwoRenamed')
    await click($('.modal.uw-act button[type="submit"]'))
    expect(optionTitles()).toEqual(['Beta', 'SubTwoRenamed', 'First.docx', 'Third.docx'])
    expect(listbox.scrollTop).toBe(64)

    // 3. Tree-changed push: page-2 folder SubTwoRenamed is deleted and page-2 file Third.docx is renamed while focused
    await click(thirdOpt)
    await act(async () => thirdOpt.focus())
    expect(document.activeElement).toBe(thirdOpt)
    page2Items = [entry('d3', 'ThirdRenamed.docx')]
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    expect(optionTitles()).toEqual(['Beta', 'First.docx', 'ThirdRenamed.docx'])
    expect(listbox.scrollTop).toBe(64)
    expect(document.activeElement).toBe(thirdOpt)
  })

  it('throttles rapid window focus refreshes (R1-1)', async () => {
    await render()
    const before = api.uniworkFolderTree.mock.calls.length
    await act(async () => window.dispatchEvent(new Event('focus')))
    await flush()
    expect(api.uniworkFolderTree.mock.calls.length).toBe(before + 1)
    // a second focus right away is throttled
    await act(async () => window.dispatchEvent(new Event('focus')))
    await flush()
    expect(api.uniworkFolderTree.mock.calls.length).toBe(before + 1)
  })
})

describe('UniworkBrowser: search (S2)', () => {
  it('searches by title, shows each hit with its path and filters by kind', async () => {
    await render()
    await type($<HTMLInputElement>('.uwf-own-search')!, 'bud')
    expect(api.uniworkSearchDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'w1', query: 'bud', kind: 'all' }),
    )
    const hit = $$('[role="option"]').find((el) => el.textContent?.includes('Budget.xlsx'))!
    expect(hit.getAttribute('title')).toBe('UniWork › Alpha › Contracts')
    expect(hit.querySelector('.uwf-path [aria-hidden="true"]')?.textContent).toBe('… › Contracts ›')
    expect(hit.querySelector('.uwf-path .uw-sr-only')?.textContent).toBe(
      en.ufPathLabel.replace('{path}', 'UniWork › Alpha › Contracts'),
    )
    const chips = $$('[role="radio"]')
    expect(chips.map((c) => c.textContent)).toEqual([
      en.ufSearchAll,
      en.ufSearchFolders,
      en.ufSearchDocs,
    ])
    expect($('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(en.ufSearchKind)
    await click(chips[1])
    expect(api.uniworkSearchDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'folder' }),
    )
    expect(chips[1]!.getAttribute('aria-checked')).toBe('true')
  })

  it('Escape in the search box returns to the open folder', async () => {
    await render()
    const input = $<HTMLInputElement>('.uwf-own-search')!
    await type(input, 'bud')
    await key(input, 'Escape')
    expect(input.value).toBe('')
    expect(optionTitles()).toEqual(['Alpha', 'Beta', 'Report.docx'])
  })

  it('ignores a stale search answer, paginates search hits, and keeps search off skeleton on soft refresh (R1-1, R1-8)', async () => {
    await render()
    const input = $<HTMLInputElement>('.uwf-own-search')!
    let releaseFirst: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    api.uniworkSearchDocuments.mockImplementationOnce(
      () => new Promise((resolve) => (releaseFirst = resolve)),
    )
    await type(input, 'old')
    api.uniworkSearchDocuments.mockImplementationOnce(async () =>
      ok({ items: [entry('s1', 'Hit1.docx')], nextCursor: 'sc-2' }),
    )
    await type(input, 'new')
    expect(optionTitles()).toEqual(['Hit1.docx'])

    // late answer for 'old' is dropped
    await act(async () =>
      releaseFirst(ok({ items: [entry('s0', 'StaleHit.docx')], nextCursor: null })),
    )
    await flush()
    expect(optionTitles()).toEqual(['Hit1.docx'])

    // search pagination appends with cursor
    api.uniworkSearchDocuments.mockImplementationOnce(async (q: UniworkSearchQuery) => {
      expect(q.cursor).toBe('sc-2')
      return ok({
        items: [entry('s2', 'Hit2.docx'), entry('s3', 'Hit3.docx')],
        nextCursor: 'sc-3',
      })
    })
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect(optionTitles()).toEqual(['Hit1.docx', 'Hit2.docx', 'Hit3.docx'])

    // soft refresh while searching does not reset to skeleton while waiting, and re-reads page 2 (R2-2)
    let releaseRefreshSearch: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    api.uniworkSearchDocuments
      .mockImplementationOnce(() => new Promise((resolve) => (releaseRefreshSearch = resolve)))
      .mockImplementationOnce(async (q: UniworkSearchQuery) => {
        expect(q.cursor).toBe('sc-2')
        return ok({ items: [entry('s2', 'Hit2Renamed.docx')], nextCursor: null })
      })
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    expect($('.uw-pick-skeleton')).toBeNull()
    expect(optionTitles()).toEqual(['Hit1.docx', 'Hit2.docx', 'Hit3.docx'])
    await act(async () =>
      releaseRefreshSearch(ok({ items: [entry('s1', 'Hit1.docx')], nextCursor: 'sc-2' })),
    )
    await flush()
    expect(optionTitles()).toEqual(['Hit1.docx', 'Hit2Renamed.docx'])
  })

  it('search chips radiogroup uses roving tabindex and arrow keys (R1-2)', async () => {
    await render()
    await type($<HTMLInputElement>('.uwf-own-search')!, 'bud')
    const chips = () => $$<HTMLButtonElement>('[role="radio"]')
    expect(chips().map((c) => c.tabIndex)).toEqual([0, -1, -1])

    await key(chips()[0]!, 'ArrowRight')
    expect(chips().map((c) => c.tabIndex)).toEqual([-1, 0, -1])
    expect(chips()[1]!.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(chips()[1])
    expect(api.uniworkSearchDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'folder' }),
    )

    await key(chips()[1]!, 'ArrowLeft')
    expect(chips().map((c) => c.tabIndex)).toEqual([0, -1, -1])
    expect(chips()[0]!.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(chips()[0])

    await key(chips()[0]!, 'ArrowUp')
    expect(chips().map((c) => c.tabIndex)).toEqual([-1, -1, 0])
    expect(chips()[2]!.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(chips()[2])
  })
})

describe('UniworkBrowser: folder actions (S3)', () => {
  it('creates a folder in the open folder; a taken name stays at the field', async () => {
    await render()
    await click(treeItem('Alpha'))
    api.uniworkCreateFolder.mockResolvedValueOnce({
      ok: false,
      error: 'folder_name_taken',
    } as never)
    await click($('.uwf-new-folder'))
    const input = $<HTMLInputElement>('.modal.uw-act input')!
    await type(input, '  Contracts ')
    await click($('.modal.uw-act button[type="submit"]'))
    expect(api.uniworkCreateFolder).toHaveBeenLastCalledWith({
      workspaceId: 'w1',
      parentId: 'a',
      title: 'Contracts',
    })
    expect($('.modal.uw-act .uw-act-error')?.textContent).toBe(en.ufNameTaken)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await type(input, 'Drafts')
    const reads = api.uniworkFolderTree.mock.calls.length
    await click($('.modal.uw-act button[type="submit"]'))
    expect($('.modal.uw-act')).toBeNull()
    expect(api.uniworkFolderTree.mock.calls.length).toBe(reads + 1)
    expect(document.getElementById('uw-live-host')?.textContent).toContain(
      en.ufFolderCreated.replace('{name}', 'Drafts'),
    )
  })

  it('a folder name over 255 characters never reaches the server', async () => {
    await render()
    await click($('.uwf-new-folder'))
    await type($<HTMLInputElement>('.modal.uw-act input')!, 'x'.repeat(256))
    await click($('.modal.uw-act button[type="submit"]'))
    expect(api.uniworkCreateFolder).not.toHaveBeenCalled()
    expect($('.modal.uw-act .uw-act-error')?.textContent).toBe(en.ufNameTooLong)
  })

  it('moves a file through the picker; its own folder is disabled with a reason', async () => {
    await render()
    const row = $$('.uw-pick-item').find((el) => el.textContent?.includes('Report.docx'))!
    await click(row.querySelector('[data-folder-menu-for]'))
    await click($('[data-folder-action="move"]'))
    const picker = $('.uwf-picker')!
    expect(picker.querySelector('h3')?.textContent).toBe(
      en.ufMoveTitle.replace('{name}', 'Report.docx'),
    )
    const rootRow = Array.from(picker.querySelectorAll('[role="treeitem"]'))[0]!
    expect(rootRow.getAttribute('aria-disabled')).toBe('true')
    expect(rootRow.querySelector('.uwf-reason')?.textContent).toBe(en.ufDisabledCurrent)
    const confirm = Array.from(picker.querySelectorAll<HTMLButtonElement>('.btn-primary'))[0]!
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    const beta = Array.from(picker.querySelectorAll<HTMLElement>('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Beta'),
    )!
    await click(beta)
    expect(confirm.getAttribute('aria-disabled')).toBeNull()
    api.uniworkMoveDocument.mockResolvedValueOnce(
      ok({
        summary: entry('d1', 'Report (2).docx', { parentId: 'b' }),
        renamedTo: 'Report (2).docx',
      }),
    )
    await click(confirm)
    expect(api.uniworkMoveDocument).toHaveBeenCalledWith({ documentId: 'd1', parentId: 'b' })
    const said = en.ufMovedRenamed.replace('{title}', 'Report (2).docx')
    expect($('.uw-act-toast')?.textContent).toContain(said)
    expect(document.getElementById('uw-live-host')?.textContent).toContain(said)
  })

  it('a folder cannot move into its own subtree; a 403 reads as no permission', async () => {
    await render()
    await key(treeItem('Alpha'), 'ArrowRight')
    await key(treeItem('Alpha'), 'F10', { shiftKey: true })
    await click($('[data-folder-action="move"]'))
    const picker = $('.uwf-picker')!
    const pickerRow = (title: string) =>
      Array.from(picker.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
        (el) => el.querySelector('.uwf-tree-title')?.textContent === title,
      )!
    // the subtree stays visible (disabled) once expanded
    await key(pickerRow('Alpha'), 'ArrowRight')
    const rows = Array.from(picker.querySelectorAll<HTMLElement>('[role="treeitem"]'))
    const reasonOf = (title: string) =>
      rows
        .find((el) => el.querySelector('.uwf-tree-title')?.textContent === title)
        ?.querySelector('.uwf-reason')?.textContent
    expect(reasonOf('UniWork')).toBe(en.ufDisabledCurrent)
    expect(reasonOf('Alpha')).toBe(en.ufDisabledInside)
    expect(reasonOf('Contracts')).toBe(en.ufDisabledInside)
    expect(reasonOf('Beta')).toBeUndefined()
    api.uniworkMoveDocument.mockResolvedValueOnce({ ok: false, error: 'forbidden' } as never)
    await click(rows.find((el) => el.textContent?.includes('Beta')))
    await click(picker.querySelector('.btn-primary'))
    expect($('.uw-act-toast')?.textContent).toContain(en.ufNoPermission)
  })

  it('renames a folder in place with F2; a taken name stays at the field', async () => {
    await render()
    await key(treeItem('Beta'), 'F2')
    const input = $<HTMLInputElement>('.uwf-tree .uw-rename-input')!
    expect(input.value).toBe('Beta')
    api.uniworkRenameDocument.mockResolvedValueOnce({
      ok: false,
      error: 'folder_name_taken',
    } as never)
    await type(input, 'Alpha')
    await key(input, 'Enter')
    expect(api.uniworkRenameDocument).toHaveBeenLastCalledWith('b', 'Alpha')
    expect($('.uwf-tree .uw-act-error')?.textContent).toBe(en.ufNameTaken)
    await type(input, 'Gamma')
    await key(input, 'Enter')
    expect(api.uniworkRenameDocument).toHaveBeenLastCalledWith('b', 'Gamma')
    expect($('.uwf-tree .uw-rename-input')).toBeNull()
  })

  it('updates the open folder picker when the workspace tree refreshes (R1-5)', async () => {
    await render()
    const row = $$('.uw-pick-item').find((el) => el.textContent?.includes('Report.docx'))!
    await click(row.querySelector('[data-folder-menu-for]'))
    await click($('[data-folder-action="move"]'))
    const picker = $('.uwf-picker')!
    const pickerTitles = () =>
      Array.from(picker.querySelectorAll('.uwf-tree-title')).map((el) => el.textContent)
    expect(pickerTitles()).toEqual(['UniWork', 'Alpha', 'Beta'])

    tree = [...tree, folder('g', 'Gamma')]
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    expect(pickerTitles()).toEqual(['UniWork', 'Alpha', 'Beta', 'Gamma'])
  })

  it('clicking the svg inside an open FolderMenu button closes the menu without reopening it (R1-13)', async () => {
    await render()
    const btn = $<HTMLButtonElement>('[data-folder-menu-for="a"]')!
    await click(btn)
    expect($('[role="menu"]')).toBeTruthy()
    const svg = btn.querySelector('svg')!
    await act(async () => {
      svg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    await act(async () => {
      svg.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      svg.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect($('[role="menu"]')).toBeNull()
  })

  it('shows a toast when move exhausts "(n)" auto-renames (move_name_taken / folder_name_taken) (B-R1-03)', async () => {
    await render()
    await key(treeItem('Beta'), 'F10', { shiftKey: true })
    await click($('[data-folder-action="move"]'))
    const picker = $('.uwf-picker')!
    const alpha = Array.from(picker.querySelectorAll<HTMLElement>('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Alpha'),
    )!
    await click(alpha)
    api.uniworkMoveDocument.mockResolvedValueOnce({
      ok: false,
      error: 'move_name_taken',
    } as never)
    await click(picker.querySelector('.btn-primary'))
    expect($('.uw-act-toast')?.textContent).toContain(en.ufMoveNameTaken)
  })

  it('recovers from rejected IPC promises in create, rename, and move without sticking busy (R1-4)', async () => {
    await render()
    // 1. Rejected createFolder closes the dialog and shows an error toast
    api.uniworkCreateFolder.mockImplementationOnce(() => Promise.reject(new Error('ipc crash')))
    await click($('.uwf-new-folder'))
    await type($<HTMLInputElement>('.modal.uw-act input')!, 'CrashFolder')
    await click($('.modal.uw-act button[type="submit"]'))
    expect($('.modal.uw-act')).toBeNull()
    expect($('.uw-act-toast')?.textContent).toBeTruthy()

    // 2. Rejected inline rename clears busy and shows an error toast
    api.uniworkRenameDocument.mockImplementationOnce(() => Promise.reject(new Error('ipc crash')))
    await key(treeItem('Beta'), 'F2')
    const input = $<HTMLInputElement>('.uwf-tree .uw-rename-input')!
    await type(input, 'BetaRenamed')
    await key(input, 'Enter')
    expect($('.uwf-tree .uw-rename-input')).toBeNull()

    // 3. Rejected move shows an error toast
    api.uniworkMoveDocument.mockImplementationOnce(() => Promise.reject(new Error('ipc crash')))
    const row = $$('.uw-pick-item').find((el) => el.textContent?.includes('Report.docx'))!
    await click(row.querySelector('[data-folder-menu-for]'))
    await click($('[data-folder-action="move"]'))
    const picker = $('.uwf-picker')!
    await click(
      Array.from(picker.querySelectorAll<HTMLElement>('[role="treeitem"]')).find((el) =>
        el.textContent?.includes('Beta'),
      ),
    )
    await click(picker.querySelector('.btn-primary'))
    expect($('.uw-act-toast')?.textContent).toBeTruthy()
  })
})
