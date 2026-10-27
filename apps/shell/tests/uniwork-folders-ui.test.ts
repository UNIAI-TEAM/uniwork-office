/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { formatListDate } from '../src/renderer/src/doclist/format'
import { UniworkBrowser } from '../src/renderer/src/uniwork-folders/UniworkBrowser'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'
import { createFakeShareApi } from '../src/renderer/src/uniwork-share/fake-share-api'
import {
  resetFolderBatchesForTest,
  trackFolderBatch,
} from '../src/renderer/src/uniwork-share/folder-contents-access-store'

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
    // UNI-2080: a tree menu reads the folder's level when it opens; these rows are all manageable
    uniworkDocumentProperties: vi.fn(async (id: string) =>
      ok({ documentId: id, workspaceId: 'w1', title: id, myLevel: 'manage' }),
    ),
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
    ).toEqual(['Documents (root)', 'Alpha', 'Beta'])
    expect(treeItem('Documents (root)').getAttribute('aria-selected')).toBe('true')
    expect(treeItem('Alpha').getAttribute('aria-level')).toBe('2')
    expect(treeItem('Alpha').getAttribute('aria-expanded')).toBe('false')
    expect(api.uniworkListChildren).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', parentId: null }),
    )
    expect(optionTitles()).toEqual(['Alpha', 'Beta', 'Meeting notes', 'Report.docx'])
    // the zip is hidden with one count line (F11-L2: shared uwPickHiddenFormats); the page (UniNote) is listed (UNI-1953)
    const hiddenLine = $('.uwf-hidden')!
    expect(hiddenLine.textContent).toBe(docEn.uwPickHiddenFormats.replace('{count}', '1'))
    // R2-3: hidden-formats count line has an id referenced by aria-describedby on the contents listbox and search box
    expect(hiddenLine.id).toBeTruthy()
    expect($('[role="listbox"]')?.getAttribute('aria-describedby')).toBe(hiddenLine.id)
    expect($('.uwf-own-search')?.getAttribute('aria-describedby')).toBe(hiddenLine.id)
  })

  it('lists the contents on the compact picker columns (UNI-2047 B2)', async () => {
    children[''] = [
      entry('d1', 'Report.docx', { updatedByName: 'Linh Tran', updatedAt: '2026-10-01T10:00:00Z' }),
      asFolder('b', 'Beta'),
    ]
    await render()
    expect($('.dh-picker-head')?.textContent).toBe('NameLast edited byUpdated')
    const row = $$('[role="option"]').find((el) => el.textContent?.includes('Report.docx'))!
    expect(row.querySelector('[data-col="editor"] .dh-person-name')?.textContent).toBe('Linh Tran')
    expect(row.querySelector('[data-col="updated"]')?.textContent).toBe(
      formatListDate('2026-10-01T10:00:00Z', new Date(), 'en-US'),
    )
    // the old "Updated … by Linh" second line is gone: the columns say it
    expect(row.querySelector('.uw-pick-row-meta')).toBeNull()
    // a folder is a row of the same list, Tên first
    const beta = $$('[role="option"]').find((el) => el.textContent?.includes('Beta'))!
    expect(beta.querySelector('[data-col="name"] .uwf-row-icon')).not.toBeNull()
    // nothing to tick or sort in a picker
    expect($('.uwf-contents input[type="checkbox"], .uwf-contents .dh-sort-head')).toBeNull()
    expect($('[role="listbox"]')?.getAttribute('aria-label')).toBe(en.ufContentsLabel)
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
    expect($$('.uwf-crumb-btn').map((b) => b.textContent)).toEqual(['Documents (root)', 'Alpha'])
    expect($('.uwf-crumb-current')?.textContent).toBe('Contracts')
    await click($$('.uwf-crumb-btn')[0])
    expect(optionTitles()).toEqual(['Alpha', 'Beta', 'Meeting notes', 'Report.docx'])
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
    expect($$('.uwf-crumb-btn').map((b) => b.textContent)).toEqual(['Documents (root)', 'L3'])
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
    expect($('.uwf-crumb-current')?.textContent).toBe('Documents (root)')
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
    expect(hit.getAttribute('title')).toBe('Documents (root) › Alpha › Contracts')
    expect(hit.querySelector('.uwf-path [aria-hidden="true"]')?.textContent).toBe('… › Contracts ›')
    expect(hit.querySelector('.uwf-path .uw-sr-only')?.textContent).toBe(
      en.ufPathLabel.replace('{path}', 'Documents (root) › Alpha › Contracts'),
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
    expect(optionTitles()).toEqual(['Alpha', 'Beta', 'Meeting notes', 'Report.docx'])
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
    expect(reasonOf('Documents (root)')).toBe(en.ufDisabledCurrent)
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
    // the row takes focus first: that is when its level is read (UNI-2080)
    await act(async () => treeItem('Beta').focus())
    await flush()
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
    expect(pickerTitles()).toEqual(['Documents (root)', 'Alpha', 'Beta'])

    tree = [...tree, folder('g', 'Gamma')]
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    expect(pickerTitles()).toEqual(['Documents (root)', 'Alpha', 'Beta', 'Gamma'])
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
    // the row takes focus first: that is when its level is read (UNI-2080)
    await act(async () => treeItem('Beta').focus())
    await flush()
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

  it('V1-2, V1-2b, R5-FE-2: picker disabled-reason (.uwf-reason) and search path (.uwf-path) use semantic tokens with >= 4.5:1 contrast in light, dark, and system-dark', () => {
    const foldersCss = readFileSync(
      join(__dirname, '../src/renderer/src/uniwork-folders/uniwork-folders.css'),
      'utf8',
    )
    const tokensCss = readFileSync(join(__dirname, '../../../packages/ui/src/tokens.css'), 'utf8')
    const homeCss = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const rule = (css: string, sel: string) =>
      css.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

    expect(rule(foldersCss, '.uwf-reason')).toMatch(/color:\s*var\(--text-secondary\)/)

    const tokenValue = (block: string, name: string) =>
      block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`))?.[1] ?? ''
    const expandHex = (h: string) =>
      h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h
    const lum = (hex: string) => {
      const full = expandHex(hex)
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
      const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
    }
    const ratio = (fg: string, bg: string) => {
      const l1 = lum(fg)
      const l2 = lum(bg)
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    }

    const lightTokens = tokensCss.slice(
      tokensCss.indexOf('\n:root {'),
      tokensCss.indexOf("\n[data-theme='dark']"),
    )
    const darkTokens = tokensCss.slice(
      tokensCss.indexOf("\n[data-theme='dark']"),
      tokensCss.indexOf('\n@media (prefers-color-scheme: dark)'),
    )
    const systemDarkTokens = tokensCss.slice(
      tokensCss.indexOf('\n@media (prefers-color-scheme: dark)'),
    )
    const lightHome = homeCss.slice(
      homeCss.indexOf('\n:root {'),
      homeCss.indexOf("\n[data-theme='dark']"),
    )
    const darkHome = homeCss.slice(
      homeCss.indexOf("\n[data-theme='dark']"),
      homeCss.indexOf('\n@media (prefers-color-scheme: dark)'),
    )
    const systemDarkHome = homeCss.slice(
      homeCss.indexOf('\n@media (prefers-color-scheme: dark)'),
      homeCss.indexOf('\n* {'),
    )

    // Light theme: --text-secondary on --accent-soft (selected row), --hover (active search row), --surface
    const lightFg = tokenValue(lightTokens, '--text-secondary')
    expect(ratio(lightFg, tokenValue(lightHome, '--accent-soft'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(lightFg, tokenValue(lightTokens, '--hover'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(lightFg, tokenValue(lightTokens, '--surface'))).toBeGreaterThanOrEqual(4.5)

    // Dark theme: --text-secondary on --accent-soft (selected row), --hover (active search row), --surface
    const darkFg = tokenValue(darkTokens, '--text-secondary')
    expect(ratio(darkFg, tokenValue(darkHome, '--accent-soft'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(darkFg, tokenValue(darkTokens, '--hover'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(darkFg, tokenValue(darkTokens, '--surface'))).toBeGreaterThanOrEqual(4.5)

    // System-dark fallback (@media (prefers-color-scheme: dark) :root:not([data-theme='light'])) (R5-FE-2)
    expect(systemDarkTokens).toContain(":root:not([data-theme='light'])")
    const systemDarkFg = tokenValue(systemDarkTokens, '--text-secondary')
    expect(ratio(systemDarkFg, tokenValue(systemDarkHome, '--accent-soft'))).toBeGreaterThanOrEqual(
      4.5,
    )
    expect(ratio(systemDarkFg, tokenValue(systemDarkTokens, '--hover'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(systemDarkFg, tokenValue(systemDarkTokens, '--surface'))).toBeGreaterThanOrEqual(
      4.5,
    )
  })

  it('V2-1: search hit path (.uwf-path) wins the CSS cascade over .uw-pick-row-meta in real bundle order', async () => {
    const mainTsx = readFileSync(join(__dirname, '../src/renderer/src/main.tsx'), 'utf8')
    const foldersCss = readFileSync(
      join(__dirname, '../src/renderer/src/uniwork-folders/uniwork-folders.css'),
      'utf8',
    )
    const homeCss = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')

    // In main.tsx, ./AppFrame (which imports UniworkBrowser -> uniwork-folders.css) is imported
    // before ./home.css, so uniwork-folders.css precedes home.css in the bundled stylesheet.
    expect(mainTsx.indexOf("from './AppFrame'")).toBeLessThan(
      mainTsx.indexOf("import './home.css'"),
    )
    // Strip @position-try at-rule (CSS Anchor Positioning) which jsdom's cssom parser does not recognize
    const bundleCss = `${foldersCss}\n${homeCss.replace(/@position-try[^{]*\{[^}]*\}/g, '')}`

    await render()
    // UNI-2047 B2: the rows carry their editor and date as columns, so a plain second line (the
    // Open dialog's workspace name) is probed with a stand-in inside the same list
    const regularMeta = document.createElement('span')
    regularMeta.className = 'uw-pick-row-meta'
    $('.uwf-contents .uw-pick-row')!.append(regularMeta)

    // Trigger search so BrowserContents renders <span class="uw-pick-row-meta uwf-path">
    await type($<HTMLInputElement>('.uwf-own-search')!, 'bud')
    const pathEl = $<HTMLElement>('.uwf-path')!
    expect(pathEl).toBeTruthy()
    expect(pathEl.classList.contains('uw-pick-row-meta')).toBe(true)

    const styleEl = document.createElement('style')
    styleEl.textContent = bundleCss
    document.head.appendChild(styleEl)
    try {
      expect(window.getComputedStyle(pathEl).getPropertyValue('color').trim()).toBe(
        'var(--text-secondary)',
      )
      expect(window.getComputedStyle(regularMeta).getPropertyValue('color').trim()).toBe(
        'var(--text-muted)',
      )
    } finally {
      styleEl.remove()
    }
  })

  it('V1-3: own create-folder expands the parent tree row (open folder and row-menu target alike), while web-side tree-changed does not force-expand', async () => {
    tree = [folder('a', 'Alpha'), folder('b', 'Beta')]
    await render()
    // 1. Web-side change adds a child under collapsed Beta -> Beta stays collapsed
    tree = [folder('a', 'Alpha'), folder('b', 'Beta', [folder('b1', 'WebChild')])]
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    expect(treeItem('Beta').getAttribute('aria-expanded')).toBe('false')
    expect(treeItem('WebChild')).toBeUndefined()

    // 2. Open Alpha (currently a leaf, not in expanded set) and create a folder via header "New folder"
    await click(treeItem('Alpha'))
    api.uniworkCreateFolder.mockImplementationOnce(
      async (i: { parentId: string | null; title: string }) => {
        tree = [
          folder('a', 'Alpha', [folder('a-new', i.title)]),
          folder('b', 'Beta', [folder('b1', 'WebChild')]),
        ]
        children.a = [asFolder('a-new', i.title, 'a'), ...children.a!]
        return ok(asFolder('a-new', i.title, i.parentId))
      },
    )
    await click($('.uwf-new-folder'))
    await type($<HTMLInputElement>('.modal.uw-act input')!, 'Q4 Specs')
    await click($('.modal.uw-act button[type="submit"]'))
    expect(treeItem('Alpha').getAttribute('aria-expanded')).toBe('true')
    expect(treeItem('Q4 Specs')).toBeTruthy()
    // Beta (untouched by own create) is still collapsed
    expect(treeItem('Beta').getAttribute('aria-expanded')).toBe('false')

    // 3. Tree row menu "New subfolder" on collapsed Beta -> expands Beta so the new subfolder is visible
    await key(treeItem('Beta'), 'F10', { shiftKey: true })
    await click($('[data-folder-action="new"]'))
    api.uniworkCreateFolder.mockImplementationOnce(
      async (i: { parentId: string | null; title: string }) => {
        tree = [
          folder('a', 'Alpha', [folder('a-new', 'Q4 Specs')]),
          folder('b', 'Beta', [folder('b1', 'WebChild'), folder('b-sub', i.title)]),
        ]
        return ok(asFolder('b-sub', i.title, i.parentId))
      },
    )
    await type($<HTMLInputElement>('.modal.uw-act input')!, 'Sub One')
    await click($('.modal.uw-act button[type="submit"]'))
    expect(treeItem('Beta').getAttribute('aria-expanded')).toBe('true')
    expect(treeItem('Sub One')).toBeTruthy()
  })

  it('V1-5: prevents text selection on folder contents rows and empty state after double-clicking into an empty folder', () => {
    const foldersCss = readFileSync(
      join(__dirname, '../src/renderer/src/uniwork-folders/uniwork-folders.css'),
      'utf8',
    )
    const rule = (sel: string) =>
      foldersCss.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    expect(rule('.uwf-row')).toMatch(/user-select:\s*none/)
    expect(rule('.uwf-list .uw-pick-state')).toMatch(/user-select:\s*none/)
  })

  it('FE-R3-1: keeps a Load more page that finishes while a soft re-read is still running (folder contents and search)', async () => {
    let releaseSoftPage2: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    let holdNextPage2 = false
    api.uniworkListChildren.mockImplementation(async (q: UniworkFolderQuery) => {
      if (q.cursor === 'c2') {
        if (holdNextPage2) {
          holdNextPage2 = false
          return new Promise((resolve) => {
            releaseSoftPage2 = resolve
          })
        }
        return ok({ items: [entry('d2', 'Second.docx')], nextCursor: 'c3' })
      }
      return ok({ items: [entry('d1', 'First.docx')], nextCursor: 'c2' })
    })
    await render()
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect(optionTitles()).toEqual(['First.docx', 'Second.docx'])

    // Start an in-flight Load more for page 3 ('c3') mocked once, and start a soft refresh whose page-2 re-read stays in flight
    let releaseLoadMore3: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    api.uniworkListChildren.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseLoadMore3 = resolve
        }),
    )
    await click($<HTMLButtonElement>('.uw-pick-more'))
    holdNextPage2 = true
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()

    // Load more finishes WHILE the soft re-read is still running on page 2
    await act(async () =>
      releaseLoadMore3(ok({ items: [entry('d3', 'Third.docx')], nextCursor: null })),
    )
    await flush()
    expect(optionTitles()).toEqual(['First.docx', 'Second.docx', 'Third.docx'])

    // Now the soft re-read's page 2 finishes; page 3 from Load more must be kept
    await act(async () =>
      releaseSoftPage2(ok({ items: [entry('d2', 'Second.docx')], nextCursor: 'c3' })),
    )
    await flush()
    expect(optionTitles()).toEqual(['First.docx', 'Second.docx', 'Third.docx'])
    expect($('.uw-pick-more')).toBeNull()

    // Same for search: Load more results finishing during a soft search re-read is kept
    let releaseSoftSearchPage2: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    let holdNextSearchPage2 = false
    api.uniworkSearchDocuments.mockImplementation(async (q: UniworkSearchQuery) => {
      if (q.cursor === 'sc2') {
        if (holdNextSearchPage2) {
          holdNextSearchPage2 = false
          return new Promise((resolve) => {
            releaseSoftSearchPage2 = resolve
          })
        }
        return ok({ items: [entry('s2', 'HitTwo.docx')], nextCursor: 'sc3' })
      }
      return ok({ items: [entry('s1', 'HitOne.docx')], nextCursor: 'sc2' })
    })
    await type($<HTMLInputElement>('.uwf-own-search')!, 'Hit')
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect(optionTitles()).toEqual(['HitOne.docx', 'HitTwo.docx'])

    let releaseSearchMore3: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    api.uniworkSearchDocuments.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSearchMore3 = resolve
        }),
    )
    await click($<HTMLButtonElement>('.uw-pick-more'))
    holdNextSearchPage2 = true
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()

    await act(async () =>
      releaseSearchMore3(ok({ items: [entry('s3', 'HitThree.docx')], nextCursor: null })),
    )
    await flush()
    expect(optionTitles()).toEqual(['HitOne.docx', 'HitTwo.docx', 'HitThree.docx'])

    await act(async () =>
      releaseSoftSearchPage2(ok({ items: [entry('s2', 'HitTwo.docx')], nextCursor: 'sc3' })),
    )
    await flush()
    expect(optionTitles()).toEqual(['HitOne.docx', 'HitTwo.docx', 'HitThree.docx'])
    expect($('.uw-pick-more')).toBeNull()
  })

  it('FE-R3-2: generates unique hidden-formats hint ids via useId() when multiple browsers mount', async () => {
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
          }),
          createElement(UniworkBrowser, {
            workspaceId: 'w1',
            variant: 'dialog',
            onOpenDocument: onOpen,
          }),
        ),
      )
    })
    await flush()
    const hints = $$('.uwf-hidden')
    expect(hints.length).toBe(2)
    expect(hints[0]!.id).toBeTruthy()
    expect(hints[1]!.id).toBeTruthy()
    expect(hints[0]!.id).not.toBe(hints[1]!.id)
    const listboxes = $$('[role="listbox"]')
    expect(listboxes[0]!.getAttribute('aria-describedby')).toBe(hints[0]!.id)
    expect(listboxes[1]!.getAttribute('aria-describedby')).toBe(hints[1]!.id)
  })

  it('V2-2, FE13-R1-2, FE13-R2-6, V13-6: row menu is opacity 0 on fine pointer without hover/focus and on mouse-focused rows, and opacity 1 on keyboard focus (:focus-visible) and @media (pointer: coarse) in real bundle order', async () => {
    const foldersCss = readFileSync(
      join(__dirname, '../src/renderer/src/uniwork-folders/uniwork-folders.css'),
      'utf8',
    )
    const homeCss = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const bundleCss = `${foldersCss}\n${homeCss.replace(/@position-try[^{]*\{[^}]*\}/g, '')}`

    await render()
    // Ensure nothing is hovered or focused while an active contents row is selected
    const alphaRow = treeItem('Alpha')
    await act(async () => (document.activeElement as HTMLElement | null)?.blur())
    const activeOption = $<HTMLElement>('.uwf-contents .uw-pick-row.active')!
    const activeItem = activeOption.closest<HTMLElement>('.uw-pick-item')!
    expect(activeOption).toBeTruthy()
    expect(activeItem).toBeTruthy()

    const treeMenuWrap = alphaRow.querySelector<HTMLElement>('.uw-row-menu.uwf-menu')!
    const treeMenuBtn = alphaRow.querySelector<HTMLElement>('.uw-row-menu-btn')!
    const rowMenuWrap = $<HTMLElement>('.uwf-contents .uw-pick-item .uw-row-menu.uwf-menu')!
    const rowMenuBtn = $<HTMLElement>('.uwf-contents .uw-pick-item .uw-row-menu-btn')!

    const docSym = Object.getOwnPropertySymbols(document)[0]
    expect(docSym).toBeDefined()
    const docImpl = (
      document as unknown as Record<
        symbol,
        {
          _domSelector: {
            clear: () => void
            check: (sel: string, el: unknown, opt?: unknown) => { match: boolean; ast: unknown }
          }
          _styleCache: WeakMap<object, unknown>
        }
      >
    )[docSym!]
    expect(typeof docImpl?._domSelector?.check).toBe('function')
    const origCheck = docImpl._domSelector.check
    const astBySel = new Map<string, unknown>()
    let patchInvocations = 0
    docImpl._domSelector.check = (sel, el, opt) => {
      patchInvocations++
      const res = origCheck(sel, el, opt)
      if (res.match) {
        if (!astBySel.has(sel)) {
          astBySel.set(sel, origCheck(`${sel} `, el, opt).ast)
        }
        return { ...res, ast: astBySel.get(sel) }
      }
      return res
    }
    const computedOpacity = (el: HTMLElement) => {
      docImpl._domSelector.clear()
      docImpl._styleCache = new WeakMap()
      return window.getComputedStyle(el).getPropertyValue('opacity').trim()
    }

    const focusWithKeyboard = async (el: HTMLElement) => {
      await act(async () => {
        ;(document.activeElement as HTMLElement | null)?.blur()
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        el.focus()
      })
    }

    const focusWithMouseAndLeave = async (el: HTMLElement) => {
      await act(async () => {
        ;(document.activeElement as HTMLElement | null)?.blur()
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, buttons: 1 }))
        el.focus()
        el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
      })
    }

    const styleEl = document.createElement('style')
    styleEl.textContent = bundleCss
    document.head.appendChild(styleEl)
    try {
      // (a) Fine pointer + no hover/focus -> opacity 0 and transform none (even on .uw-pick-row.active)
      expect(window.getComputedStyle(treeMenuWrap).getPropertyValue('transform').trim()).toBe(
        'none',
      )
      expect(window.getComputedStyle(rowMenuWrap).getPropertyValue('transform').trim()).toBe('none')
      expect(computedOpacity(treeMenuBtn)).toBe('0')
      expect(computedOpacity(rowMenuBtn)).toBe('0')

      // FE13-R2-6 sanity check: patched selector matcher actually ran and populated specificity ASTs
      expect(patchInvocations).toBeGreaterThan(0)
      expect(astBySel.size).toBeGreaterThan(0)

      // (b) V13-6: keyboard-focused row (:focus-visible) -> opacity 1 on tree row and contents row
      await focusWithKeyboard(alphaRow)
      expect(alphaRow.matches(':focus-visible')).toBe(true)
      expect(computedOpacity(treeMenuBtn)).toBe('1')
      expect(computedOpacity(rowMenuBtn)).toBe('0')

      await focusWithKeyboard(activeOption)
      expect(activeOption.matches(':focus-visible')).toBe(true)
      expect(activeItem.matches(':has(:focus-visible)')).toBe(true)
      expect(computedOpacity(treeMenuBtn)).toBe('0')
      expect(computedOpacity(rowMenuBtn)).toBe('1')

      // (c) V13-6: mouse-focused row with nothing hovered (:focus / :focus-within true, :focus-visible false) -> opacity 0
      await focusWithMouseAndLeave(alphaRow)
      expect(alphaRow.matches(':focus')).toBe(true)
      expect(alphaRow.matches(':focus-within')).toBe(true)
      expect(alphaRow.matches(':focus-visible')).toBe(false)
      expect(alphaRow.matches(':hover')).toBe(false)
      expect(computedOpacity(treeMenuBtn)).toBe('0')
      expect(computedOpacity(rowMenuBtn)).toBe('0')

      await focusWithMouseAndLeave(activeOption)
      expect(activeOption.matches(':focus')).toBe(true)
      expect(activeItem.matches(':focus-within')).toBe(true)
      expect(activeOption.matches(':focus-visible')).toBe(false)
      expect(activeItem.matches(':has(:focus-visible)')).toBe(false)
      expect(activeItem.matches(':hover')).toBe(false)
      expect(computedOpacity(treeMenuBtn)).toBe('0')
      expect(computedOpacity(rowMenuBtn)).toBe('0')

      // (d) @media (pointer: coarse) in real bundle order -> opacity 1 even without hover/focus
      await act(async () => (document.activeElement as HTMLElement | null)?.blur())
      const coarseBundleCss = bundleCss.replace(
        /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/g,
        '$1',
      )
      // FE13-R2-6 sanity check: coarse media query regex actually stripped @media (pointer: coarse)
      expect(coarseBundleCss).not.toBe(bundleCss)
      expect(coarseBundleCss).not.toContain('@media (pointer: coarse)')
      styleEl.textContent = coarseBundleCss
      expect(computedOpacity(treeMenuBtn)).toBe('1')
      expect(computedOpacity(rowMenuBtn)).toBe('1')
    } finally {
      docImpl._domSelector.check = origCheck
      styleEl.remove()
    }
  })

  it('FE R1-9: switching workspaceId resets open folder to initialFolderId and drops in-flight replies from the previous workspace', async () => {
    await render({ workspaceId: 'w1' })
    await click(treeItem('Alpha'))
    expect($('.uwf-crumb-current')?.textContent).toBe('Alpha')

    // Start a slow folder read in w1 before switching to w2
    let releaseStaleW1: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    api.uniworkListChildren.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseStaleW1 = resolve
        }),
    )
    await click(treeItem('Beta'))

    // Switch workspace to w2
    children[''] = [entry('w2-doc', 'WorkspaceTwo.docx', { workspaceId: 'w2' })]
    await render({ workspaceId: 'w2' })
    expect($('.uwf-crumb-current')?.textContent).toBe('Documents (root)')
    expect(optionTitles()).toEqual(['WorkspaceTwo.docx'])

    // Late w1 reply resolves and must be ignored
    await act(async () =>
      releaseStaleW1(ok({ items: [entry('stale', 'StaleW1.docx')], nextCursor: null })),
    )
    await flush()
    expect($('.uwf-crumb-current')?.textContent).toBe('Documents (root)')
    expect(optionTitles()).toEqual(['WorkspaceTwo.docx'])
  })

  it('FE13-R1-7: Load more from C1 overlapping a soft re-read that reaches C1-prime (or errors / ends early) neither duplicates, skips, nor loses rows and keeps the newest cursor', async () => {
    // 1. Folder contents: page 1 initially returns [d1, d2] with nextCursor 'c1'
    let serverShifted = false
    let releaseLoadMoreC1: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    let releaseSoftC1Prime: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined

    api.uniworkListChildren.mockImplementation(async (q: UniworkFolderQuery) => {
      if (!q.cursor) {
        if (!serverShifted) {
          return ok({
            items: [entry('d1', 'Doc1.docx'), entry('d2', 'Doc2.docx')],
            nextCursor: 'c1',
          })
        }
        return ok({
          items: [entry('d0', 'Doc0.docx'), entry('d1', 'Doc1.docx')],
          nextCursor: 'c1-prime',
        })
      }
      if (q.cursor === 'c1') {
        return new Promise((resolve) => {
          releaseLoadMoreC1 = resolve
        })
      }
      if (q.cursor === 'c1-prime') {
        return new Promise((resolve) => {
          releaseSoftC1Prime = resolve
        })
      }
      if (q.cursor === 'c2-prime') {
        return ok({ items: [entry('d4', 'Doc4.docx')], nextCursor: null })
      }
      return ok({ items: [], nextCursor: null })
    })

    await render()
    expect(optionTitles()).toEqual(['Doc1.docx', 'Doc2.docx'])

    // Start Load more from cursor 'c1', then trigger a soft re-read where page 1 shifts to 'c1-prime'
    await click($<HTMLButtonElement>('.uw-pick-more'))
    serverShifted = true
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()

    // Stale 'c1' resolves (would have skipped d2 and used stale cursor 'c2-stale')
    await act(async () =>
      releaseLoadMoreC1(ok({ items: [entry('d3', 'Doc3.docx')], nextCursor: 'c2-stale' })),
    )
    await flush()

    // Soft re-read continues from 'c1-prime' and resolves with [d2, d3] and newest cursor 'c2-prime'
    await act(async () =>
      releaseSoftC1Prime(
        ok({
          items: [entry('d2', 'Doc2.docx'), entry('d3', 'Doc3.docx')],
          nextCursor: 'c2-prime',
        }),
      ),
    )
    await flush()

    expect(optionTitles()).toEqual(['Doc0.docx', 'Doc1.docx', 'Doc2.docx', 'Doc3.docx'])
    // Clicking Load more must use newest cursor 'c2-prime', not 'c2-stale'
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect(api.uniworkListChildren).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'c2-prime' }),
    )
    expect(optionTitles()).toEqual([
      'Doc0.docx',
      'Doc1.docx',
      'Doc2.docx',
      'Doc3.docx',
      'Doc4.docx',
    ])

    // 2. Soft chain errors on page 2: keeps fresh page 1 + nextCursor + moreError without re-merging stale rows (FE13-R2-8)
    api.uniworkListChildren.mockImplementation(async (q: UniworkFolderQuery) => {
      if (!q.cursor) {
        return ok({
          items: [entry('d0', 'Doc0.docx'), entry('d1', 'Doc1.docx')],
          nextCursor: 'c1-prime',
        })
      }
      return { ok: false, error: 'network' }
    })
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    expect(optionTitles()).toEqual(['Doc0.docx', 'Doc1.docx'])
    expect($('.uw-pick-more-error')).not.toBeNull()
    expect($('.uw-pick-more')).not.toBeNull()

    // 3. Soft chain ends early (nextCursor: null) while Load more from C1 is still in flight:
    // late C1 resolution must not append stale items or resurrect Load more
    let releaseLateC1: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    let shrinkToOnePage = false
    api.uniworkListChildren.mockImplementation(async (q: UniworkFolderQuery) => {
      if (!q.cursor) {
        if (shrinkToOnePage) {
          return ok({ items: [entry('d1', 'Doc1.docx')], nextCursor: null })
        }
        return ok({ items: [entry('d1', 'Doc1.docx')], nextCursor: 'c-early' })
      }
      if (q.cursor === 'c-early') {
        return new Promise((resolve) => {
          releaseLateC1 = resolve
        })
      }
      return ok({ items: [], nextCursor: null })
    })
    await click(treeItem('Alpha'))
    expect(optionTitles()).toEqual(['Doc1.docx'])
    await click($<HTMLButtonElement>('.uw-pick-more'))
    shrinkToOnePage = true
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    expect($('.uw-pick-more')).toBeNull()

    await act(async () =>
      releaseLateC1(ok({ items: [entry('d-stale', 'Doc9.docx')], nextCursor: 'c-stale' })),
    )
    await flush()
    expect(optionTitles()).toEqual(['Doc1.docx'])
    expect($('.uw-pick-more')).toBeNull()

    // 4. Search results: Load more from 'sc1' overlapping a soft search re-read reaching 'sc1-prime'
    let searchShifted = false
    let releaseSearchC1: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    api.uniworkSearchDocuments.mockImplementation(async (q: UniworkSearchQuery) => {
      if (!q.cursor) {
        if (!searchShifted) {
          return ok({
            items: [entry('s1', 'Hit1.docx'), entry('s2', 'Hit2.docx')],
            nextCursor: 'sc1',
          })
        }
        return ok({
          items: [entry('s0', 'Hit0.docx'), entry('s1', 'Hit1.docx')],
          nextCursor: 'sc1-prime',
        })
      }
      if (q.cursor === 'sc1') {
        return new Promise((resolve) => {
          releaseSearchC1 = resolve
        })
      }
      if (q.cursor === 'sc1-prime') {
        return ok({
          items: [entry('s2', 'Hit2.docx'), entry('s3', 'Hit3.docx')],
          nextCursor: 'sc2-prime',
        })
      }
      if (q.cursor === 'sc2-prime') {
        return ok({ items: [entry('s4', 'Hit4.docx')], nextCursor: null })
      }
      return ok({ items: [], nextCursor: null })
    })

    await type($<HTMLInputElement>('.uwf-own-search')!, 'Hit')
    expect(optionTitles()).toEqual(['Hit1.docx', 'Hit2.docx'])
    await click($<HTMLButtonElement>('.uw-pick-more'))
    searchShifted = true
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()

    await act(async () =>
      releaseSearchC1(ok({ items: [entry('s3', 'Hit3.docx')], nextCursor: 'sc2-stale' })),
    )
    await flush()

    expect(optionTitles()).toEqual(['Hit0.docx', 'Hit1.docx', 'Hit2.docx', 'Hit3.docx'])
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect(api.uniworkSearchDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'sc2-prime' }),
    )
    expect(optionTitles()).toEqual([
      'Hit0.docx',
      'Hit1.docx',
      'Hit2.docx',
      'Hit3.docx',
      'Hit4.docx',
    ])
  })

  it('FE13-R2-8: deferred-promise cases for (1) moreError mid soft chain, (2) rejected loadMore promise, and (3) clearing search query while results Load more is in flight', async () => {
    // (1a) Contents moreError mid soft chain: deleted page-1 row and stale page-2 row are NOT re-merged
    let deletedD1 = false
    let releaseSoftPage2Err: (v: UniworkResult<UniworkFolderChildren>) => void = () => undefined
    api.uniworkListChildren.mockImplementation(async (q: UniworkFolderQuery) => {
      if (!q.cursor) {
        if (!deletedD1) {
          return ok({
            items: [entry('d1', 'DeletedOnServer.docx'), entry('d2', 'KeptOnServer.docx')],
            nextCursor: 'c2',
          })
        }
        return ok({
          items: [entry('d2', 'KeptOnServer.docx')],
          nextCursor: 'c2',
        })
      }
      if (q.cursor === 'c2') {
        if (!deletedD1) {
          return ok({ items: [entry('d3', 'Page2Row.docx')], nextCursor: null })
        }
        return new Promise((resolve) => {
          releaseSoftPage2Err = resolve
        })
      }
      return ok({ items: [], nextCursor: null })
    })

    await render()
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect(optionTitles()).toEqual(['DeletedOnServer.docx', 'KeptOnServer.docx', 'Page2Row.docx'])

    deletedD1 = true
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    await act(async () => releaseSoftPage2Err({ ok: false, error: 'network' }))
    await flush()

    expect(optionTitles()).toEqual(['KeptOnServer.docx'])
    expect($('.uw-pick-more-error')).not.toBeNull()
    expect($('.uw-pick-more')).not.toBeNull()

    // (2a) Rejected readContents promise in loadMore resets loadingMore
    let rejectContentsMore: (err: Error) => void = () => undefined
    api.uniworkListChildren.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectContentsMore = reject
        }),
    )
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect($<HTMLButtonElement>('.uw-pick-more')?.disabled).toBe(true)

    await act(async () => rejectContentsMore(new Error('ipc rejected')))
    await flush()
    expect($<HTMLButtonElement>('.uw-pick-more')?.disabled).toBe(false)
    expect($('.uw-pick-more-error')).not.toBeNull()

    // (1b) Search results moreError mid soft chain: deleted page-1 hit and stale page-2 hit are NOT re-merged
    let deletedS1 = false
    let releaseSoftSearchPage2Err: (v: UniworkResult<UniworkFolderChildren>) => void = () =>
      undefined
    api.uniworkSearchDocuments.mockImplementation(async (q: UniworkSearchQuery) => {
      if (!q.cursor) {
        if (!deletedS1) {
          return ok({
            items: [entry('s1', 'DeletedHit.docx'), entry('s2', 'KeptHit.docx')],
            nextCursor: 'sc2',
          })
        }
        return ok({
          items: [entry('s2', 'KeptHit.docx')],
          nextCursor: 'sc2',
        })
      }
      if (q.cursor === 'sc2') {
        if (!deletedS1) {
          return ok({ items: [entry('s3', 'Page2Hit.docx')], nextCursor: null })
        }
        return new Promise((resolve) => {
          releaseSoftSearchPage2Err = resolve
        })
      }
      return ok({ items: [], nextCursor: null })
    })

    const searchInput = $<HTMLInputElement>('.uwf-own-search')!
    await type(searchInput, 'Hit')
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect(optionTitles()).toEqual(['DeletedHit.docx', 'KeptHit.docx', 'Page2Hit.docx'])

    deletedS1 = true
    await act(async () => api.pushTreeChanged({ workspaceId: 'w1' }))
    await flush()
    await act(async () => releaseSoftSearchPage2Err({ ok: false, error: 'network' }))
    await flush()

    expect(optionTitles()).toEqual(['KeptHit.docx'])
    expect($('.uw-pick-more-error')).not.toBeNull()
    expect($('.uw-pick-more')).not.toBeNull()

    // (2b) Rejected searchDocuments promise in loadMoreResults resets loadingMore
    let rejectSearchMore: (err: Error) => void = () => undefined
    api.uniworkSearchDocuments.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSearchMore = reject
        }),
    )
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect($<HTMLButtonElement>('.uw-pick-more')?.disabled).toBe(true)

    await act(async () => rejectSearchMore(new Error('search ipc rejected')))
    await flush()
    expect($<HTMLButtonElement>('.uw-pick-more')?.disabled).toBe(false)
    expect($('.uw-pick-more-error')).not.toBeNull()

    // (3) Clearing the search query while a results Load more is in flight does not append the old page
    let releaseInFlightSearchMore: (v: UniworkResult<UniworkFolderChildren>) => void = () =>
      undefined
    api.uniworkSearchDocuments.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseInFlightSearchMore = resolve
        }),
    )
    await click($<HTMLButtonElement>('.uw-pick-more'))
    expect($<HTMLButtonElement>('.uw-pick-more')?.disabled).toBe(true)

    // Clear search query while Load more is in flight
    await type(searchInput, '')
    expect(optionTitles()).toEqual(['KeptOnServer.docx'])

    // Late search Load more resolves -> must be dropped and never appended
    await act(async () =>
      releaseInFlightSearchMore(
        ok({ items: [entry('s-late', 'LateSearchMore.docx')], nextCursor: null }),
      ),
    )
    await flush()
    expect(optionTitles()).toEqual(['KeptOnServer.docx'])
    expect(host.textContent).not.toContain('LateSearchMore.docx')
  })
})

describe('UniworkBrowser: Share documents inside… (UNI-2244)', () => {
  const entryLabel = (uniworkShareStrings.en as Record<string, string>).shrFcMenu!
  const titleOf = (title: string) =>
    (uniworkShareStrings.en as Record<string, string>).shrFcTitle!.replace('{title}', title)
  const menuLabels = () => $$('[role="menuitem"]').map((el) => el.textContent)

  afterEach(() => {
    delete (window as unknown as { uniworkShare?: unknown }).uniworkShare
  })

  it('a folder row and a tree row offer it, and it opens the dialog for that folder', async () => {
    ;(window as unknown as { uniworkShare: unknown }).uniworkShare = createFakeShareApi()
    await render()
    const row = $$('.uw-pick-item').find((el) => el.textContent?.includes('Beta'))!
    await click(row.querySelector('[data-folder-menu-for]'))
    expect(menuLabels()).toContain(entryLabel)
    await click($$('[role="menuitem"]').find((el) => el.textContent === entryLabel))
    expect($('[role="dialog"]')?.textContent).toContain(titleOf('Beta'))
    // closing leaves the browser as it was
    await key($('[role="dialog"]')!, 'Escape')
    expect($('[role="dialog"]')).toBeNull()

    await click(treeItem('Alpha').querySelector('[data-folder-menu-for]'))
    expect(menuLabels()).toContain(entryLabel)
  })

  it('a file row has no such entry, and without the share bridge no folder has it', async () => {
    ;(window as unknown as { uniworkShare: unknown }).uniworkShare = createFakeShareApi()
    await render()
    const file = $$('.uw-pick-item').find((el) => el.textContent?.includes('Report.docx'))!
    await click(file.querySelector('[data-folder-menu-for]'))
    expect(menuLabels()).not.toContain(entryLabel)
    await key($('[role="menu"]')!, 'Escape')

    delete (window as unknown as { uniworkShare?: unknown }).uniworkShare
    const row = $$('.uw-pick-item').find((el) => el.textContent?.includes('Beta'))!
    await click(row.querySelector('[data-folder-menu-for]'))
    expect(menuLabels()).not.toContain(entryLabel)
  })

  it('the browser wires a background run end to a list refetch and one toast (R2-5)', async () => {
    resetFolderBatchesForTest()
    const shareApi = createFakeShareApi()
    ;(window as unknown as { uniworkShare: unknown }).uniworkShare = shareApi
    await render()
    const before = api.uniworkListChildren.mock.calls.length
    // a batch the server does not know ends as failed at its first read
    trackFolderBatch({
      api: shareApi,
      batchId: 'fb_unknown',
      folderId: 'a',
      folderTitle: 'Alpha',
      total: 0,
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await flush()
    expect(api.uniworkListChildren.mock.calls.length).toBeGreaterThan(before)
    expect(document.body.textContent).toContain(
      (uniworkShareStrings.en as Record<string, string>).shrFcBatchFailed,
    )
    resetFolderBatchesForTest()
    delete (window as unknown as { uniworkShare?: unknown }).uniworkShare
  })
})
