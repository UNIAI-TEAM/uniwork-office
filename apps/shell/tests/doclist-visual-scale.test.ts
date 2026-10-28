/**
 * @vitest-environment jsdom
 *
 * UNI-2047 B7: every DocList screen on the doclist-canvas scale (Main + Rules boards). The
 * measurable parts are pinned here: the 32px file icon (one constant), the Sao button of the
 * "Sao · ⋯" actions only where a row knows its star state (the Starred screen, where it is
 * Bỏ gắn sao), the star colour as a theme token, and the board's numbers as CSS rule text
 * (jsdom cannot measure layout): page padding 24/32, title 24px, head 12px, cell padding 9/12,
 * group header 40px, the filled segment track with its thumb, and the chips.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DOC_ICON_SIZE, trackOf } from '../src/renderer/src/doclist/cells'
import { DocList, type DocListProps } from '../src/renderer/src/doclist/DocList'
import { FilterBar } from '../src/renderer/src/doclist/FilterBar'
import type { DocListScreen } from '../src/renderer/src/doclist/columns'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import {
  DEFAULT_DOCUMENTS_HOME_FILTERS,
  type DocumentsHomeDoc,
  type DocumentsHomeSubViewId,
  type DocumentsHomeTableRow,
} from '../src/renderer/src/uniwork-home/documents-home-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

// Wednesday 2026-10-21 12:00 local
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const iso = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0).toISOString()
const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

const doc = (partial: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
  workspaceId: 'ws-1',
  title: `${partial.id}.docx`,
  format: 'docx',
  updatedAt: iso(2026, 10, 21, 9, 5),
  kind: 'file',
  parentId: null,
  updatedByName: 'Minh Trần',
  updatedById: 'u-minh',
  sizeBytes: 2_969,
  canEdit: true,
  canManage: true,
  myLevel: 'manage',
  ...partial,
})
const rowOf = (d: DocumentsHomeDoc): DocumentsHomeTableRow => ({ type: 'doc', id: d.id, doc: d })

const src = (path: string) =>
  readFileSync(resolve(__dirname, '../src/renderer/src', path), 'utf8').replace(/\r\n/g, '\n')

/** the body of the rule whose selector list is exactly `selector` (not `selector:hover` etc.) */
function ruleOf(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[{}]|\\*/)\\s*${escaped} \\{([^}]*)\\}`).exec(css)
  expect(match, selector).not.toBeNull()
  return match![1]!
}

describe('the file icon is one 32px constant (A-REC row 16)', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.useRealTimers()
  })

  function Harness(props: {
    screen: DocListScreen
    rows: readonly DocumentsHomeTableRow[]
    extra?: Partial<DocListProps>
  }) {
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
    const [menu, setMenu] = useState<string | null>(null)
    return createElement(DocList, {
      screen: props.screen,
      rows: props.rows,
      sort: null,
      onSortChange: () => {},
      selected,
      onSelectedChange: setSelected,
      label: 'Tài liệu',
      openMenuId: menu,
      onOpenMenuChange: setMenu,
      menuFor: () => [],
      onOpen: () => {},
      ...props.extra,
    })
  }

  async function mount(
    screen: DocListScreen,
    rows: readonly DocumentsHomeTableRow[],
    extra?: Partial<DocListProps>,
  ) {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(Harness, { screen, rows, extra }),
        ),
      )
    })
  }

  it('DOC_ICON_SIZE is 32', () => {
    expect(DOC_ICON_SIZE).toBe(32)
  })

  it('a file row and a UniNote row draw their badge at that size on every screen', async () => {
    for (const screen of ['workspace', 'recent', 'starred', 'shared', 'trash', 'device'] as const) {
      await mount(screen, [
        rowOf(doc({ id: 'f' })),
        rowOf(doc({ id: 'p', kind: 'page', format: null })),
      ])
      const file = host.querySelector('[data-doc-id="f"] [data-col="name"] img')
      expect(file?.getAttribute('width'), screen).toBe(String(DOC_ICON_SIZE))
      expect(file?.getAttribute('height'), screen).toBe(String(DOC_ICON_SIZE))
      const page = host.querySelector('[data-doc-id="p"] [data-col="name"] svg')
      expect(page?.getAttribute('width'), screen).toBe(String(DOC_ICON_SIZE))
    }
  })

  it('the Sao button is drawn only on a row that knows it is starred, with onUnstar given', async () => {
    const onUnstar = vi.fn()
    const starred = doc({ id: 's', title: 'Kế hoạch.docx', favoritedAt: iso(2026, 10, 20, 9, 0) })
    const plain = doc({ id: 'p' })
    await mount('starred', [rowOf(starred), rowOf(plain)], { onUnstar })
    const button = host.querySelector<HTMLButtonElement>('[data-doc-id="s"] .dh-star-btn')
    expect(button).not.toBeNull()
    expect(button!.closest('[data-col]')?.getAttribute('data-col')).toBe('actions')
    expect(button!.getAttribute('aria-label')).toBe('Bỏ gắn sao Kế hoạch.docx')
    expect(button!.getAttribute('title')).toBe('Bỏ gắn sao')
    // the name already states the action: no toggle state on top of it (RV7-6)
    expect(button!.hasAttribute('aria-pressed')).toBe(false)
    // a row without a star time cannot tell: no button, never a dead one
    expect(host.querySelector('[data-doc-id="p"] .dh-star-btn')).toBeNull()
    await act(async () => {
      button!.click()
    })
    expect(onUnstar).toHaveBeenCalledTimes(1)
    expect(onUnstar.mock.calls[0]![0]).toMatchObject({ id: 's' })
  })

  it('a double-click on the Sao button never opens the document (RV7-1)', async () => {
    const onOpen = vi.fn()
    const onUnstar = vi.fn()
    await mount('starred', [rowOf(doc({ id: 's', favoritedAt: iso(2026, 10, 20, 9, 0) }))], {
      onOpen,
      onUnstar,
    })
    const dbl = () => new MouseEvent('dblclick', { bubbles: true, cancelable: true })
    const star = host.querySelector<HTMLButtonElement>('[data-doc-id="s"] .dh-star-btn')!
    await act(async () => {
      star.dispatchEvent(dbl())
    })
    // the actions cell around the buttons is not a way into the document either
    await act(async () => {
      host.querySelector('[data-doc-id="s"] [data-col="actions"]')!.dispatchEvent(dbl())
    })
    expect(onOpen).not.toHaveBeenCalled()
    // the row itself still opens on a double-click
    await act(async () => {
      host.querySelector('[data-doc-id="s"] [data-col="name"]')!.dispatchEvent(dbl())
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('the actions track grows for the two 44px coarse-pointer buttons only where the star is drawn (RV7-3)', async () => {
    const columns = ['select', 'name', 'starred', 'updated', 'size', 'actions'] as const
    const plain = trackOf(columns, 'starred')
    expect(plain.endsWith(' 76px')).toBe(true)
    expect(trackOf(columns, 'starred', true)).toBe(
      plain.replace(/76px$/, 'var(--dh-star-actions-track, 76px)'),
    )
    // the shelf / trash track is its own wide one, star or not
    expect(trackOf(columns, 'trash', true)).toBe(trackOf(columns, 'trash'))

    const rows = [rowOf(doc({ id: 's', favoritedAt: iso(2026, 10, 20, 9, 0) }))]
    const tracks = () => ({
      head: host.querySelector<HTMLElement>('.dh-doc-head')!.style.gridTemplateColumns,
      row: host.querySelector<HTMLElement>('.dh-doc-row')!.style.gridTemplateColumns,
    })
    await mount('starred', rows, { onUnstar: () => {} })
    expect(tracks().head).toContain('var(--dh-star-actions-track')
    expect(tracks().row).toBe(tracks().head)
    // no star call from the host, or another screen: the track is the plain one
    await mount('starred', rows)
    expect(tracks().head).not.toContain('--dh-star-actions-track')
    await mount('recent', rows, { onUnstar: () => {} })
    expect(tracks().head).not.toContain('--dh-star-actions-track')
  })

  it('no onUnstar (the host has no star call) draws no Sao button even on a starred row', async () => {
    await mount('starred', [rowOf(doc({ id: 's', favoritedAt: iso(2026, 10, 20, 9, 0) }))])
    expect(host.querySelector('.dh-star-btn')).toBeNull()
  })
})

describe('the chips carry the type icon (doclist-canvas chip)', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
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

  it('every Type menu item but All types has a 16px badge before its label, the chips too', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(FilterBar, {
            filters: { ...DEFAULT_DOCUMENTS_HOME_FILTERS, types: ['docx'] },
            onChange: () => {},
            authors: [],
          }),
        ),
      )
    })
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[data-filter="type"]')!.click()
    })
    const all = host.querySelector('[role="menuitemcheckbox"][data-type="all"]')!
    expect(all.querySelector('img, svg:not(.dh-type-check)')).toBeNull()
    expect(all.querySelector('.dh-type-spacer')).not.toBeNull()
    for (const type of ['page', 'docx', 'xlsx', 'pptx', 'pdf', 'md', 'html', 'txt']) {
      const el = host.querySelector(`[role="menuitemcheckbox"][data-type="${type}"]`)!
      const badge = el.querySelector('img, svg:not(.dh-type-check)')
      expect(badge, type).not.toBeNull()
      expect(badge!.getAttribute('width'), type).toBe('16')
    }
    // the badge adds no text: an item reads its label only
    expect(host.querySelector('[data-type="docx"]')!.textContent).toBe('.docx')
    const chipBadge = host.querySelector('.dh-type-chip[data-chip="docx"] img, .dh-type-chip svg')
    expect(chipBadge!.getAttribute('width')).toBe('16')
  })
})

describe('DocumentsHome: the Sao button of "Sao · ⋯" (A-REC row 12)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let favorites: () => Promise<UniworkResult<unknown>>
  const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]
  const STARRED = [
    doc({ id: 'a', favoritedAt: iso(2026, 10, 21, 8, 0) }),
    doc({ id: 'b', favoritedAt: iso(2026, 10, 20, 16, 30) }),
  ]

  async function flush(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  const baseApi = (): Record<string, ReturnType<typeof vi.fn>> => {
    const listed = () => ok({ documents: [doc({ id: 'r1' })], nextCursor: null })
    return {
      uniworkFolderTree: vi.fn(async () => ok([])),
      uniworkEnsureMyFolder: vi.fn(async () =>
        ok({
          id: 'f-mine',
          parentId: null,
          title: 'My Folder',
          position: 0,
          kind: 'my_folder' as const,
          isSystem: true,
          children: [],
        }),
      ),
      // the workspace root lists the root's children
      uniworkListChildren: vi.fn(async () => ok({ items: [doc({ id: 'w1' })], nextCursor: null })),
      uniworkListDocuments: vi.fn(async () => listed()),
      uniworkListFavorites: vi.fn(() => favorites()),
      uniworkListSharedWithMe: vi.fn(async () => listed()),
      uniworkListSharedByMe: vi.fn(async () => listed()),
      uniworkListTrash: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListShelved: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListSources: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkFavoriteDocument: vi.fn(async () => ok({ favoritedAt: iso(2026, 10, 21, 11, 0) })),
      uniworkUnfavoriteDocument: vi.fn(async () => ok(undefined)),
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
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    favorites = async () => ok({ documents: STARRED, nextCursor: null })
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
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function mount(
    subView: DocumentsHomeSubViewId,
    lang: 'vi' | 'en' = 'vi',
    onOpenDocument: () => void = vi.fn(),
  ) {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument,
            sidebarHost: sidebarSlot,
            initialSubView: subView,
          }),
        ),
      )
    })
    await flush()
  }
  const rowIds = () =>
    Array.from(host.querySelectorAll('[role="row"][data-doc-id]')).map((el) =>
      el.getAttribute('data-doc-id'),
    )

  it('the Starred screen draws a filled Sao button before the "…" of every row', async () => {
    await mount('starred')
    expect(rowIds()).toEqual(['a', 'b'])
    for (const id of ['a', 'b']) {
      const actions = host.querySelector(`[data-doc-id="${id}"] [data-col="actions"]`)!
      const star = actions.querySelector<HTMLButtonElement>('.dh-star-btn')
      expect(star, id).not.toBeNull()
      expect(star!.getAttribute('aria-label')).toBe(`Bỏ gắn sao ${id}.docx`)
      expect(star!.hasAttribute('aria-pressed')).toBe(false)
      // Sao first, then the "…"
      const buttons = Array.from(actions.querySelectorAll('button'))
      expect(buttons.indexOf(star!)).toBeLessThan(
        buttons.indexOf(actions.querySelector<HTMLButtonElement>('.uw-row-menu-btn')!),
      )
    }
  })

  it('clicking it unstars the row (the same call as the menu entry) and rereads the list', async () => {
    await mount('starred')
    favorites = async () => ok({ documents: [STARRED[1]!], nextCursor: null })
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-doc-id="a"] .dh-star-btn')!.click()
    })
    await flush()
    expect(api.uniworkUnfavoriteDocument).toHaveBeenCalledTimes(1)
    expect(api.uniworkUnfavoriteDocument!.mock.calls[0]![0]).toBe('a')
    expect(api.uniworkListFavorites).toHaveBeenCalledTimes(2)
    expect(rowIds()).toEqual(['b'])
    expect(document.body.textContent).toContain('Đã bỏ gắn sao')
  })

  it('English reads "Unstar <name>"', async () => {
    localStorage.setItem('genoffice.lang', 'en')
    await mount('starred', 'en')
    expect(host.querySelector('[data-doc-id="a"] .dh-star-btn')!.getAttribute('aria-label')).toBe(
      'Unstar a.docx',
    )
  })

  it('a double-click on the Sao button opens nothing and asks for one unstar (RV7-1)', async () => {
    const onOpenDocument = vi.fn()
    const release = new Map<string, (value: UniworkResult<undefined>) => void>()
    api.uniworkUnfavoriteDocument!.mockImplementation(
      (id: string) =>
        new Promise<UniworkResult<undefined>>((resolve) => {
          release.set(id, resolve)
        }),
    )
    await mount('starred', 'vi', onOpenDocument)
    const star = host.querySelector<HTMLButtonElement>('[data-doc-id="a"] .dh-star-btn')!
    // what a browser sends for a double-click: click, click, dblclick
    await act(async () => {
      star.click()
    })
    await act(async () => {
      star.click()
      star.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    })
    expect(onOpenDocument).not.toHaveBeenCalled()
    expect(api.uniworkUnfavoriteDocument).toHaveBeenCalledTimes(1)
    // another row is not held up by the first one's call
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-doc-id="b"] .dh-star-btn')!.click()
    })
    expect(api.uniworkUnfavoriteDocument).toHaveBeenCalledTimes(2)
    expect(api.uniworkUnfavoriteDocument!.mock.calls.map((call) => call[0])).toEqual(['a', 'b'])
    // once the call is answered the document can be unstarred again (after a failed unstar, say)
    await act(async () => {
      release.get('a')!({ ok: false, error: 'server_error' })
    })
    await flush()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-doc-id="a"] .dh-star-btn')!.click()
    })
    expect(api.uniworkUnfavoriteDocument).toHaveBeenCalledTimes(3)
  })

  it('every other screen draws no Sao button even when its rows carry a star time (RV7-7)', async () => {
    const withStar = (id: string) => doc({ id, favoritedAt: iso(2026, 10, 20, 9, 0) })
    const next = baseApi()
    next.uniworkListChildren = vi.fn(async () => ok({ items: [withStar('w1')], nextCursor: null }))
    next.uniworkListDocuments = vi.fn(async () =>
      ok({ documents: [withStar('r1')], nextCursor: null }),
    )
    next.uniworkListSharedWithMe = vi.fn(async () =>
      ok({ documents: [withStar('sw1')], nextCursor: null }),
    )
    next.uniworkListSharedByMe = vi.fn(async () =>
      ok({ documents: [withStar('sb1')], nextCursor: null }),
    )
    install(next)
    for (const [view, id] of [
      ['workspace', 'w1'],
      ['recent', 'r1'],
      ['shared-with-me', 'sw1'],
      ['shared-by-me', 'sb1'],
    ] as const) {
      await act(async () => {
        root.unmount()
      })
      root = createRoot(host)
      await mount(view)
      // the row is on screen, has the data the Starred screen draws a Sao for, and has none
      expect(rowIds(), view).toContain(id)
      expect(host.querySelector('.dh-star-btn'), view).toBeNull()
    }
  })

  it('a shell with no star call draws none on the Starred screen either', async () => {
    const next = baseApi()
    delete (next as Record<string, unknown>).uniworkUnfavoriteDocument
    delete (next as Record<string, unknown>).uniworkFavoriteDocument
    install(next)
    await mount('starred')
    expect(rowIds()).toEqual(['a', 'b'])
    expect(host.querySelector('.dh-star-btn')).toBeNull()
  })
})

describe('the star colour is a theme token (CLAUDE.md rule 1)', () => {
  const tokens = src('../../../../../packages/ui/src/tokens.css')

  it('tokens.css defines --star in the light, dark and system-dark blocks', () => {
    const dark = tokens.indexOf("[data-theme='dark'] {")
    const system = tokens.indexOf('@media (prefers-color-scheme: dark)')
    expect(dark).toBeGreaterThan(0)
    expect(system).toBeGreaterThan(dark)
    expect(tokens.slice(0, dark)).toMatch(/\n\s*--star:\s*#[0-9a-f]{3,8};/i)
    expect(tokens.slice(dark, system)).toMatch(/\n\s*--star:\s*#[0-9a-f]{3,8};/i)
    expect(tokens.slice(system)).toMatch(/\n\s*--star:\s*#[0-9a-f]{3,8};/i)
  })

  it('the board amber #f59e0b in light, the lighter amber on dark (RV7-5)', () => {
    const dark = tokens.indexOf("[data-theme='dark'] {")
    const system = tokens.indexOf('@media (prefers-color-scheme: dark)')
    expect(tokens.slice(0, dark)).toMatch(/\n\s*--star:\s*#f59e0b;/i)
    expect(tokens.slice(dark, system)).toMatch(/\n\s*--star:\s*#fbbf24;/i)
    expect(tokens.slice(system)).toMatch(/\n\s*--star:\s*#fbbf24;/i)
  })

  it('the local list star (Home) has no raw #f5a623 left and reads the token', () => {
    const home = src('Home.tsx')
    const homeCss = src('home.css')
    expect(home).not.toMatch(/#f5a623/i)
    expect(homeCss).not.toMatch(/#f5a623/i)
    expect(homeCss).toMatch(/\.star-btn\.starred[^{]*\{[^}]*color:\s*var\(--star\)/)
    expect(homeCss).toMatch(/\.star-btn:hover[^{]*\{[^}]*color:\s*var\(--star\)/)
  })

  it('the DocList Sao button reads the same token', () => {
    expect(ruleOf(src('uniwork-home/documents-home.css'), '.dh-star-btn')).toMatch(
      /color:\s*var\(--star\)/,
    )
  })
})

describe('the doclist-canvas scale (CSS rule text)', () => {
  const css = src('uniwork-home/documents-home.css')
  const picker = src('doclist/doclist-picker.css')

  it('page padding 24 / 32 (40 at the foot), title 24px', () => {
    expect(ruleOf(css, '.dh-main')).toMatch(/padding:\s*24px 32px 40px;/)
    expect(ruleOf(css, '.dh-title')).toMatch(/font-size:\s*24px;/)
  })

  it('table head 12px, 38px high, cells 9px / 12px', () => {
    const head = ruleOf(css, '.dh-doc-head')
    expect(head).toMatch(/font-size:\s*12px;/)
    expect(head).toMatch(/height:\s*38px;/)
    expect(
      ruleOf(css, ".dh-doc-head > [role='columnheader'],\n.dh-doc-row > [role='cell']"),
    ).toMatch(/padding:\s*0 12px;/)
    expect(ruleOf(css, ".dh-doc-row > [role='cell']")).toMatch(/padding-block:\s*9px;/)
    // the board's row is 9px + the 32px icon + 9px = 50px (+ its 1px rule): no min-height may
    // hold a row above that, and the pieces that make it up are the ones pinned here
    const cellPad = Number(
      /padding-block:\s*(\d+)px;/.exec(ruleOf(css, ".dh-doc-row > [role='cell']"))![1],
    )
    expect(2 * cellPad + DOC_ICON_SIZE).toBe(50)
    for (const selector of ['.dh-doc-row', ".dh-doc-row > [role='cell']"]) {
      const floor = /min-height:\s*(\d+)px/.exec(ruleOf(css, selector))
      expect(Number(floor?.[1] ?? 0), selector).toBeLessThanOrEqual(50)
    }
  })

  it('the four fixed tracks keep 8px at the sides, in the head and in the rows', () => {
    const fixed =
      ":is([data-col='select'], [data-col='updated'], [data-col='size'], [data-col='actions'])"
    const rule = ruleOf(css, `.dh-doc-head\n  > ${fixed},\n.dh-doc-row\n  > ${fixed}`)
    expect(rule).toMatch(/padding-inline:\s*8px;/)
    // the two buttons of "Sao · ⋯" (28 + 4 + 28) fill the 76px track's 60px of room exactly
    expect(76 - 2 * 8).toBe(28 + 4 + 28)
  })

  it('on a coarse pointer the Starred actions track holds Sao 44 + gap 4 + "…" 44 (RV7-3)', () => {
    const coarse = css.slice(css.indexOf('@media (pointer: coarse) {'))
    const media = coarse.slice(0, coarse.indexOf('\n}\n'))
    expect(media).toMatch(/\.dh-row-btn[^{]*\{[^}]*min-width:\s*44px;/)
    const track = /--dh-star-actions-track:\s*(\d+)px;/.exec(media)
    expect(track, 'the coarse track variable').not.toBeNull()
    // 44 + 4 + 44 of buttons and the cell's 8px on each side
    expect(Number(track![1])).toBeGreaterThanOrEqual(44 + 4 + 44 + 2 * 8)
    // fine pointers keep the plain track: the variable is only set inside the media query
    expect(css.replace(media, '')).not.toMatch(/--dh-star-actions-track:/)
  })

  it('a grouped row is 28px in from the 12px cell edge (40px, the board)', () => {
    expect(ruleOf(css, '.dh-doc-row.grouped .dh-cell-name')).toMatch(
      /padding-inline-start:\s*calc\(12px \+ var\(--dh-group-indent\)\)/,
    )
  })

  it('the group header is 40px, 13px / 600 in the text colour', () => {
    const toggle = ruleOf(css, '.dh-group-toggle')
    expect(toggle).toMatch(/min-height:\s*40px;/)
    expect(toggle).toMatch(/font-size:\s*13px;/)
    expect(toggle).toMatch(/font-weight:\s*600;/)
    expect(toggle).toMatch(/color:\s*var\(--text\);/)
  })

  it('the segment is a filled track (no border) with a raised thumb', () => {
    const track = ruleOf(css, '.dh-segment')
    expect(track).toMatch(/padding:\s*3px;/)
    expect(track).toMatch(/border-radius:\s*9px;/)
    expect(track).not.toMatch(/border:\s*1px/)
    expect(track).toMatch(/background:\s*var\(--/)
    const btn = ruleOf(css, '.dh-segment-btn')
    expect(btn).toMatch(/height:\s*30px;/)
    expect(btn).toMatch(/border-radius:\s*7px;/)
    expect(btn).toMatch(/font-size:\s*13px;/)
    const on = ruleOf(css, ".dh-segment-btn[aria-pressed='true']")
    expect(on).toMatch(/background:\s*var\(--surface\);/)
    expect(on).toMatch(/box-shadow:\s*var\(--/)
  })

  it('the Type trigger 34px / 13px, its chips 28px / 12.5px; the selects 34px / 13px', () => {
    const trigger = ruleOf(css, '.dh-type-trigger')
    expect(trigger).toMatch(/height:\s*34px;/)
    expect(trigger).toMatch(/font-size:\s*13px;/)
    // the label is the quieter text token, the value returns to --text
    expect(trigger).toMatch(/color:\s*var\(--text-secondary\);/)
    expect(ruleOf(css, '.dh-type-value')).toMatch(/color:\s*var\(--text\);/)
    const chip = ruleOf(css, '.dh-type-chip')
    expect(chip).toMatch(/height:\s*28px;/)
    expect(chip).toMatch(/border-radius:\s*14px;/)
    expect(chip).toMatch(/font-size:\s*12\.5px;/)
    const select = ruleOf(css, '.dh-filter-chip')
    expect(select).toMatch(/height:\s*34px;/)
    expect(select).toMatch(/padding:\s*0 12px;/)
    expect(select).toMatch(/font-size:\s*13px;/)
  })

  it('the picker variant heads its columns at the same 12px', () => {
    expect(ruleOf(picker, '.dh-picker-head')).toMatch(/font-size:\s*12px;/)
  })

  it('access badge is rounded-4px with inline-start icon, updated date uses tabular-nums, and checkbox uses drawn border/accent', () => {
    const badge = ruleOf(css, '.dh-vis-badge')
    expect(badge).toMatch(/border-radius:\s*4px;/)
    expect(badge).toMatch(/gap:\s*4px;/)
    expect(ruleOf(css, '.dh-cell-time')).toMatch(/font-variant-numeric:\s*tabular-nums;/)
    const check = ruleOf(css, '.dh-check')
    expect(check).toMatch(/appearance:\s*none;/)
    expect(check).toMatch(/border:\s*1\.5px solid var\(--wb-check-border\);/)
    expect(check).toMatch(/border-radius:\s*4px;/)
    expect(ruleOf(css, '.dh-check:checked')).toMatch(/background:\s*var\(--accent\);/)
    const bulkAction = ruleOf(css, '.dl-bulk-action')
    expect(bulkAction).toMatch(/background:\s*transparent;/)
    expect(ruleOf(css, '.dl-bulk-action.danger')).toMatch(/background:\s*var\(--danger-bg\);/)
    expect(ruleOf(css, '.dl-bulk-action.danger')).toMatch(/color:\s*var\(--danger-text\);/)
  })
})
