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
  try {
    window.localStorage.clear()
  } catch {
    // storage may be unavailable; the browser copes
  }
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
    expect($('.uwf-hidden')?.textContent).toBe(docEn.uwPickHiddenFormats.replace('{count}', '2'))
  })

  it('opens a folder from the tree, shows its breadcrumb and goes back by it', async () => {
    await render()
    await click(treeItem('Alpha'))
    expect(api.uniworkListChildren).toHaveBeenLastCalledWith(
      expect.objectContaining({ parentId: 'a' }),
    )
    expect(optionTitles()).toEqual(['Contracts', 'Plan.docx'])
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
})
