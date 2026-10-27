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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
import {
  TREE_PAD,
  TREE_STEP,
  UniworkFolderTree,
} from '../src/renderer/src/uniwork-folders/UniworkFolderTree'
import { UniworkFolderPicker } from '../src/renderer/src/uniwork-folders/UniworkFolderPicker'
import { ROOT_KEY } from '../src/renderer/src/uniwork-folders/uniwork-folders-model'
import { pickType } from './doclist-type-filter-fixture'

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

async function mount(
  subView: DocumentsHomeSubViewId = 'workspace',
  lang: 'vi' | 'en' = 'vi',
  extra: Record<string, unknown> = {},
) {
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
          ...extra,
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
    await pickType(host, 'pdf')
    expect(lastCall('uniworkListSources')).toEqual({
      workspaceId: 'ws-1',
      source: 'chat',
      types: ['pdf'],
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

// ---- fix3 (sidebar review r4): RV-13 .. RV-17 ----

const readSrc = (rel: string) =>
  readFileSync(resolve(__dirname, '../src/renderer/src', rel), 'utf8').replace(/\r\n/g, '\n')
const homeCss = readSrc('home.css')
const sidebarCss = readSrc('uniwork-home/doclist-sidebar.css')

type CssRule = { selectors: string[]; body: string }
/** the flat rules of a stylesheet (no @media nesting needed here): selector list + declaration text */
function cssRules(css: string): CssRule[] {
  const out: CssRule[] = []
  const re = /([^{}]+)\{([^}]*)\}/g
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) {
    out.push({
      selectors: m[1]!
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      body: m[2]!,
    })
  }
  return out
}
/** specificity as a comparable number: ids, then classes / attributes / pseudo-classes, then elements */
function specificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length
  const cls =
    (selector.match(/\.[\w-]+/g) ?? []).length +
    (selector.match(/\[[^\]]*\]/g) ?? []).length +
    (selector.match(/(?<!:):[a-z-]+/g) ?? []).length
  const els = (selector.replace(/[.#:[][^\s.#:[>+~]*/g, '').match(/[a-z][\w-]*/gi) ?? []).length
  return ids * 10000 + cls * 100 + els
}
/** a selector as jsdom can match it: the dynamic pseudo-classes dropped */
const staticOf = (selector: string) =>
  selector.replace(/:(hover|active|focus-visible|focus)\b/g, '')

describe('RV-13: the tile glyph keeps its tone at rest, on hover and on the current row', () => {
  // home.css paints every svg inside a .nav-item row (grey, --text on hover, --accent on the
  // current row). The source rows are .nav-item rows and the glyph is an svg inside one, so the
  // tile's inherited `color: var(--surface)` loses to a rule on the svg element itself.
  it('the glyph sits under .nav-item, so home.css recolours it unless a more specific rule wins', async () => {
    await mount('workspace')
    await click(sourceRows().find((r) => r.dataset.source === 'chat'))
    const row = sourceRows().find((r) => r.dataset.source === 'chat')!
    const glyph = row.querySelector<SVGElement>('.dl-side-tile svg')!
    expect(row.classList.contains('active')).toBe(true)
    // the glyph itself carries no class; the recolouring reaches it through its .nav-item ancestor
    expect(glyph.closest('.nav-item')).toBe(row)

    const recolours = cssRules(homeCss).flatMap((r) =>
      /(^|[;\s])color:/.test(r.body)
        ? r.selectors.filter((s) => /^\.nav-item\S* svg$/.test(s))
        : [],
    )
    // rest, hover, current: the three states the web keeps white-on-tile
    expect(recolours.sort()).toEqual([
      '.nav-item svg',
      '.nav-item.active svg',
      '.nav-item:hover svg',
    ])
    const overrides = cssRules(sidebarCss).flatMap((r) =>
      /color:\s*var\(--surface\)/.test(r.body)
        ? r.selectors.filter((s) => glyph.matches(staticOf(s)))
        : [],
    )
    for (const recolour of recolours) {
      expect(glyph.matches(staticOf(recolour)), `${recolour} reaches the glyph`).toBe(true)
      const winner = overrides.filter((o) => specificity(o) > specificity(recolour))
      expect(winner.length, `a sidebar rule beating ${recolour}`).toBeGreaterThan(0)
    }
  })
})

describe('RV-14 / VS-9: the whole Documents sidebar is one scrolling column (nav + tree + sources)', () => {
  // the web's documents-sidebar.tsx is one `<nav class="flex min-h-0 flex-col overflow-y-auto">` around the
  // nav rows, the folder tree and the sources section: a short window scrolls the nav away, the tree and
  // the sources keep a normal-height viewport. A scroller only around the tree + sources left them 16px.
  it('the sub-nav, the folders and the sources section all sit inside .dh-sidebar-wrap, with no scroller between', async () => {
    await mount('workspace')
    const wrap = sourceSection()!.closest<HTMLElement>('.dh-sidebar-wrap')
    expect(wrap, 'the sidebar wrap around the section').not.toBeNull()
    expect(wrap!.contains(sidebarSlot.querySelector('.dh-subnav'))).toBe(true)
    expect(wrap!.contains(sidebarSlot.querySelector('.dh-sidebar-folders'))).toBe(true)
    expect(wrap!.contains(sideTree())).toBe(true)
    // the old inner column is gone: nothing between the wrap and its blocks is a scroller of its own
    expect(sidebarSlot.querySelector('.dl-side-scroll')).toBeNull()
    expect(sourceSection()!.parentElement).toBe(wrap)
    expect(sidebarSlot.querySelector('.dh-sidebar-folders')!.parentElement).toBe(wrap)
    expect(sidebarSlot.querySelector('.dh-subnav')!.parentElement).toBe(wrap)
  })

  it('the sources section comes after the folder tree, which comes after the nav', async () => {
    await mount('workspace')
    const nav = sidebarSlot.querySelector('.dh-subnav')!
    const folders = sidebarSlot.querySelector('.dh-sidebar-folders')!
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(nav, folders)).toBe(true)
    expect(follows(folders, sourceSection()!)).toBe(true)
  })

  it('the css makes the wrap the only scroller; the blocks keep their natural height', () => {
    const rules = cssRules(sidebarCss)
    const body = (selector: string) => rules.find((r) => r.selectors.includes(selector))?.body ?? ''
    expect(body('.dh-sidebar-wrap')).toMatch(/overflow-y:\s*auto/)
    expect(body('.dh-sidebar-wrap')).toMatch(/min-height:\s*0/)
    // the sub-nav, the folders block and the tree no longer squeeze or clip themselves inside it
    expect(body('.dh-sidebar-wrap > .dh-subnav')).toMatch(/flex:\s*none/)
    expect(body('.dh-sidebar-wrap > .dh-sidebar-folders')).toMatch(/flex:\s*none/)
    expect(body('.dh-sidebar-wrap .dh-sidebar-tree')).toMatch(/flex:\s*none/)
    expect(body('.dh-sidebar-wrap .dh-sidebar-tree')).toMatch(/overflow(-y)?:\s*visible/)
    // exactly one overflow scroller declared for the sidebar by this sheet
    const scrollers = rules.filter((r) => /overflow(-y)?:\s*(auto|scroll)/.test(r.body))
    expect(scrollers.flatMap((r) => r.selectors)).toEqual(['.dh-sidebar-wrap'])
  })
})

describe('RV-15: a transient probe error does not hide the section for the whole mount', () => {
  const later = () => ok({ items: [], nextCursor: null })
  const transient = { ok: false, error: 'network_error' } as never

  it('a non-404 error leaves it hidden, then the next pass (sidebar visible again) probes once more and shows it', async () => {
    let n = 0
    sources = async () => (++n === 1 ? transient : later())
    await mount('workspace')
    expect(sourceSection()).toBeNull()
    expect(api.uniworkListSources).toHaveBeenCalledTimes(1)
    // no retry loop: more passes without a trigger never call again
    await flush()
    expect(api.uniworkListSources).toHaveBeenCalledTimes(1)

    await mount('workspace', 'vi', { sidebarIdle: true })
    await mount('workspace', 'vi', { sidebarIdle: false })
    expect(api.uniworkListSources).toHaveBeenCalledTimes(2)
    expect(sourceSection()).not.toBeNull()
  })

  it('a rejected probe retries the same way', async () => {
    let n = 0
    sources = async () => {
      if (++n === 1) throw new Error('offline')
      return later()
    }
    await mount('workspace')
    expect(sourceSection()).toBeNull()
    await mount('workspace', 'vi', { sidebarIdle: true })
    await mount('workspace', 'vi', { sidebarIdle: false })
    expect(sourceSection()).not.toBeNull()
  })

  it('a 404 is final: it is not probed again on the next pass', async () => {
    sources = async () => ({ ok: false, error: 'not_found' })
    await mount('workspace')
    await mount('workspace', 'vi', { sidebarIdle: true })
    await mount('workspace', 'vi', { sidebarIdle: false })
    expect(api.uniworkListSources).toHaveBeenCalledTimes(1)
    expect(sourceSection()).toBeNull()
  })

  it('an OK answer is not probed again either', async () => {
    await mount('workspace')
    await mount('workspace', 'vi', { sidebarIdle: true })
    await mount('workspace', 'vi', { sidebarIdle: false })
    expect(api.uniworkListSources).toHaveBeenCalledTimes(1)
  })

  it('a failed first page read on Từ nơi khác does not block the probe once the page is left', async () => {
    let n = 0
    sources = async () => (++n === 1 ? transient : later())
    await mount('elsewhere')
    expect(sourceSection()).toBeNull()
    await click(workspaceNav())
    expect(sourceSection()).not.toBeNull()
  })
})

describe('RV-16: the picked source is kept with the sub-view by the host', () => {
  it('mounts on the kept source: the page is filtered and its row is current', async () => {
    await mount('elsewhere', 'vi', { initialElsewhereSource: 'meeting' })
    expect(lastCall('uniworkListSources')).toEqual({ workspaceId: 'ws-1', source: 'meeting' })
    expect(sourceRows().map((r) => r.getAttribute('aria-current'))).toEqual([
      null,
      'page',
      null,
      null,
    ])
  })

  it('a kept source is ignored when the kept sub-view is not Từ nơi khác', async () => {
    await mount('workspace', 'vi', { initialElsewhereSource: 'meeting' })
    expect(sourceRows().every((r) => r.getAttribute('aria-current') === null)).toBe(true)
  })

  it('reports each pick to the host', async () => {
    const seen: Array<string | null> = []
    await mount('workspace', 'vi', {
      onElsewhereSourceChange: (s: string | null) => seen.push(s),
    })
    await click(sourceRows().find((r) => r.dataset.source === 'email'))
    expect(seen[seen.length - 1]).toBe('email')
    await click(sourceRows().find((r) => r.dataset.source === 'chat'))
    expect(seen[seen.length - 1]).toBe('chat')
  })
})

describe('RV-17: with no root row, the sidebar "+" creates at the workspace root (as the web)', () => {
  it('inside an open folder, "+" still creates a top-level folder', async () => {
    const createFolder = vi.fn(async (i: { parentId: string | null; title: string }) =>
      ok(folder('f-new', i.title)),
    )
    api.uniworkCreateFolder = createFolder
    await mount('workspace')
    await click(rowOf('Alpha'))
    expect(workspaceNav()?.getAttribute('aria-current')).toBeNull()

    await click(sidebarSlot.querySelector('.dh-sidebar-add'))
    const input = document.querySelector<HTMLInputElement>('.modal input')!
    expect(input).toBeTruthy()
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'Hợp đồng')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(document.querySelector('.modal button[type="submit"]'))
    expect(createFolder).toHaveBeenLastCalledWith({
      workspaceId: 'ws-1',
      parentId: null,
      title: 'Hợp đồng',
    })
  })
})

// ---- VS-8: My Folder stand-in lines up with the top-level folder rows ----

describe('VS-8: the My Folder stand-in lines up with the top-level rows when the root row is hidden', () => {
  const standIn = () => sidebarSlot.querySelector<HTMLElement>('[data-my-folder-standin]')
  const standInRules = () =>
    cssRules(sidebarCss).filter((r) => r.selectors.some((s) => s.includes('.dh-my-folder-standin')))
  const FIRST_LEVEL_INDENT = '4px'

  it('the hideRoot tree carries a rootless class; the default tree (picker, Save dialog) does not', async () => {
    await mount('workspace')
    expect(sideTree()?.classList.contains('uwf-tree-rootless')).toBe(true)

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
          }),
        ),
      )
    })
    await flush()
    expect(host.querySelector('[role="tree"]')?.classList.contains('uwf-tree-rootless')).toBe(false)
  })

  it('the stand-in keeps its twisty slot and sits inside the sidebar tree container', async () => {
    api.uniworkFolderTree.mockImplementation(async () => ok(NODES.filter((n) => !n.systemKind)))
    await mount('workspace')
    const row = standIn()
    expect(row).not.toBeNull()
    expect(row!.querySelector('.uwf-twisty')).not.toBeNull()
    expect(row!.closest('.dh-sidebar-tree')).not.toBeNull()
  })

  it('the sidebar css gives the stand-in the first-level indent of a tree row, scoped to the sidebar tree', async () => {
    const rule = standInRules().find((r) => /padding-inline-start/.test(r.body))
    expect(rule).toBeDefined()
    expect(rule!.selectors).toEqual(['.dh-sidebar-tree .dh-my-folder-standin'])
    expect(rule!.body).toContain(`padding-inline-start: ${FIRST_LEVEL_INDENT};`)
    // that is exactly the inline indent the tree draws on a level-1 row
    await mount('workspace')
    expect(rowOf('Alpha')?.style.paddingInlineStart).toBe(FIRST_LEVEL_INDENT)
    // it must out-rank documents-home.css's own (reserved) 18px rule
    const base = cssRules(readSrc('uniwork-home/documents-home.css')).find((r) =>
      r.selectors.includes('.dh-my-folder-standin'),
    )
    expect(base?.body).toMatch(/padding-inline-start:\s*18px/)
    expect(specificity(rule!.selectors[0]!)).toBeGreaterThan(specificity('.dh-my-folder-standin'))
  })
})

describe('tree grid numbers: TS and CSS cannot drift (D4BF-R3-3)', () => {
  const homeVars = readSrc('uniwork-home/documents-home.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const px = (name: string) => {
    const m = homeVars.match(new RegExp(`${name}:\\s*(\\d+)px;`))
    expect(m, `${name} is a px custom property`).not.toBeNull()
    return Number(m![1])
  }

  it('TREE_PAD is --dh-tree-pad and TREE_STEP is --dh-tree-slot + --dh-tree-gap', () => {
    expect(TREE_PAD).toBe(px('--dh-tree-pad'))
    expect(TREE_STEP).toBe(px('--dh-tree-slot') + px('--dh-tree-gap'))
  })

  it('a lost account row shows the icon with sr-only words, and the node keeps the row hover', () => {
    const css = sidebarCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(
      /\.dh-drive-node:hover > \.dh-drive-nav-root:not\(\.active\)\s*\{\s*background:\s*var\(--hover\)/,
    )
    expect(css).not.toMatch(/\.dh-drive-nav-lost\s*\{[^}]*background/)
  })

  it('an account chevron sits under the Drive icon and a folder icon starts under the account email (UNI-2223)', () => {
    const css = sidebarCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(
      /\.dh-drive-twisty-account\s*\{\s*inset-inline-start:\s*calc\(var\(--dh-tree-pad\) \+ var\(--dh-tree-slot\) \+ var\(--dh-tree-gap\)\);/,
    )
    expect(css).toMatch(
      /\.dh-sidebar-tree \.dh-drive-nav-folder\s*\{\s*padding-inline-start:\s*calc\(\s*var\(--dh-tree-pad\) \+ var\(--dh-tree-slot\) \+ var\(--dh-tree-gap\) \+ var\(--dh-tree-icon\) \+\s*var\(--dh-tree-gap\)\s*\);/,
    )
    // a folder of an account has no raw colour of its own: the row reuses the nav-item states
    expect(css).not.toMatch(/\.dh-drive-nav-folder[^{]*\{[^}]*#[0-9a-f]{3,8}/i)
  })
})
