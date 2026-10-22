/**
 * @vitest-environment jsdom
 *
 * UNI-2047 V-STATES (tester_visual r1): the states of the shared document lists.
 *  F-03 Starred on an older server (favorites 404) is a proper list error state, not the
 *       document-not-found line; any other error is the generic list error with Thử lại
 *  F-04 From elsewhere rows say where the file came from; the page has no Truy cập column
 *  F-08 the picker row meta text reaches 4.5:1 on the dark hover fill, through a token
 *  F-09 a search with no hit is the shared empty state; the search field has one clear button
 *  F-10 a file directly in the root has no dangling "›" in its location line
 * jsdom cannot measure layout: the rendered text, classes and tokens are what is pinned.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UniworkResult,
  UniworkSourceFile,
  UniworkSourceListPage,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type {
  DocumentsHomeDoc,
  DocumentsHomeSubViewId,
} from '../src/renderer/src/uniwork-home/documents-home-model'
import { visibleColumns } from '../src/renderer/src/doclist/table-model'
import { shortPath } from '../src/renderer/src/uniwork-folders/uniwork-folders-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

// Wednesday 2026-10-21 12:00 local
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const iso = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0).toISOString()
const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

const doc = (over: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
  workspaceId: 'ws-1',
  title: `${over.id}.docx`,
  format: 'docx',
  updatedAt: iso(2026, 10, 20, 9, 0),
  kind: 'file',
  parentId: null,
  ...over,
})

const source = (over: Partial<UniworkSourceFile> & { id: string }): UniworkSourceFile => ({
  source: 'chat',
  parent: { kind: 'chat_channel', id: 'room-1', title: 'phap-che' },
  name: `${over.id}.pdf`,
  mimeType: 'application/pdf',
  extension: 'pdf',
  sizeBytes: 120_000,
  updatedAt: iso(2026, 10, 21, 9, 5),
  owner: { id: 'u-minh', name: 'Minh Trần' },
  canOpenInApp: false,
  canSave: true,
  ...over,
})

describe('DocumentsHome: the states of the lists', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let favorites: () => Promise<UniworkResult<unknown>>
  let sources: () => Promise<UniworkResult<UniworkSourceListPage>>
  let search: () => Promise<UniworkResult<unknown>>
  const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]

  async function flush(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    favorites = async () => ok({ documents: [], nextCursor: null })
    sources = async () => ok({ items: [], nextCursor: null })
    search = async () => ok({ items: [], nextCursor: null })
    const empty = () => ok({ documents: [], nextCursor: null })
    api = {
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
      uniworkListChildren: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkListDocuments: vi.fn(async () => empty()),
      uniworkListFavorites: vi.fn(() => favorites()),
      uniworkListSharedWithMe: vi.fn(async () => empty()),
      uniworkListSharedByMe: vi.fn(async () => empty()),
      uniworkListTrash: vi.fn(async () => empty()),
      uniworkListShelved: vi.fn(async () => empty()),
      uniworkListSources: vi.fn(() => sources()),
      uniworkSearchDocuments: vi.fn(() => search()),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
    }
    ;(window as unknown as { aiOffice: unknown; home: unknown }).aiOffice = api
    ;(window as unknown as { aiOffice: unknown; home: unknown }).home = api
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

  async function mount(subView: DocumentsHomeSubViewId, lang: 'vi' | 'en' = 'en') {
    localStorage.setItem('genoffice.lang', lang)
    document.documentElement.lang = lang
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
  const type = async (text: string) => {
    const input = host.querySelector<HTMLInputElement>('.dh-search-input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
  }
  const navLabels = () =>
    Array.from(sidebarSlot.querySelectorAll('.dh-nav-label')).map((el) => el.textContent)
  const stateOf = (root: ParentNode = host) => root.querySelector<HTMLElement>('.dl-state')

  describe('F-03: Starred error states', () => {
    it.each([
      ['en', 'Starred is not available on this server yet', /server .*(update|upgrade)/i, 'Retry'],
      ['vi', 'Gắn sao chưa dùng được trên máy chủ này', /máy chủ .*cập nhật/i, 'Thử lại'],
    ] as const)(
      '%s: favorites 404 is "Starred is not available" with an icon, a reason and Retry, never the document-not-found line',
      async (lang, title, reason, retry) => {
        favorites = async () => ({ ok: false, error: 'not_found' })
        await mount('starred', lang)
        const state = stateOf()
        expect(state, 'the shared list state').not.toBeNull()
        expect(state!.getAttribute('role')).toBe('alert')
        expect(state!.querySelector('svg.dl-state-icon')).not.toBeNull()
        expect(state!.querySelector('.dl-state-title')?.textContent).toBe(title)
        expect(state!.querySelector('.dl-state-hint')?.textContent).toMatch(reason)
        expect(state!.textContent).not.toMatch(/no longer exists|không còn tồn tại/i)
        const button = Array.from(state!.querySelectorAll('button')).find(
          (b) => b.textContent === retry,
        )
        expect(button, 'Retry').toBeDefined()
        // the entry stays in the nav
        expect(navLabels()).toContain(lang === 'en' ? 'Starred' : 'Gắn sao')
      },
    )

    it('Retry reads the favorites route again and shows the rows once the server answers', async () => {
      favorites = async () => ({ ok: false, error: 'not_found' })
      await mount('starred')
      expect(api.uniworkListFavorites).toHaveBeenCalledTimes(1)
      favorites = async () =>
        ok({
          documents: [doc({ id: 'a', favoritedAt: iso(2026, 10, 20, 8, 0) })],
          nextCursor: null,
        })
      const button = Array.from(stateOf()!.querySelectorAll('button')).find(
        (b) => b.textContent === 'Retry',
      )
      await click(button)
      expect(api.uniworkListFavorites).toHaveBeenCalledTimes(2)
      expect(stateOf()).toBeNull()
      expect(host.querySelector('[data-doc-id="a"]')).not.toBeNull()
    })

    // UNI-2080 RV-7: the Retry button unmounts with the error, which used to drop focus to <body>
    it('Retry hands keyboard focus to the search box instead of dropping it to the body', async () => {
      favorites = async () => ({ ok: false, error: 'not_found' })
      await mount('starred')
      favorites = async () => ok({ documents: [], nextCursor: null })
      const button = Array.from(stateOf()!.querySelectorAll('button')).find(
        (b) => b.textContent === 'Retry',
      )!
      button.focus()
      expect(document.activeElement).toBe(button)
      await click(button)
      expect(document.activeElement).toBe(host.querySelector('.dh-search-input'))
    })

    it.each(['server_error', 'network'] as const)(
      'any other error (%s) is the generic list error with its own sentence and Retry',
      async (error) => {
        favorites = async () => ({ ok: false, error })
        await mount('starred')
        const state = stateOf()
        expect(state).not.toBeNull()
        expect(state!.querySelector('svg.dl-state-icon')).not.toBeNull()
        expect(state!.querySelector('.dl-state-title')?.textContent).not.toMatch(
          /Starred is not available/,
        )
        expect(state!.querySelector('.dl-state-title')?.textContent).toMatch(/\S/)
        expect(
          Array.from(state!.querySelectorAll('button')).some((b) => b.textContent === 'Retry'),
        ).toBe(true)
      },
    )

    it('a call that throws is the same list error state, not a crash', async () => {
      favorites = async () => {
        throw new Error('boom')
      }
      await mount('starred')
      expect(stateOf()).not.toBeNull()
      expect(navLabels()).toContain('Starred')
    })
  })

  describe('RV-1: From elsewhere on a server without the sources route', () => {
    const retryButton = () =>
      Array.from(stateOf()?.querySelectorAll('button') ?? []).find(
        (b) => b.textContent === 'Retry' || b.textContent === 'Thử lại',
      )

    it.each([
      [
        'en',
        'From elsewhere is not available on this server yet',
        /server .*(update|upgrade)/i,
        'Retry',
      ],
      ['vi', 'Từ nơi khác chưa dùng được trên máy chủ này', /máy chủ .*cập nhật/i, 'Thử lại'],
    ] as const)(
      '%s: sources 404 is "From elsewhere is not available" with an icon, a reason and Retry, never the document-not-found line',
      async (lang, title, reason, retry) => {
        sources = async () => ({ ok: false, error: 'not_found' })
        await mount('elsewhere', lang)
        const state = stateOf()
        expect(state, 'the shared list state').not.toBeNull()
        expect(state!.getAttribute('role')).toBe('alert')
        expect(state!.querySelector('svg.dl-state-icon')).not.toBeNull()
        expect(state!.querySelector('.dl-state-title')?.textContent).toBe(title)
        expect(state!.querySelector('.dl-state-hint')?.textContent).toMatch(reason)
        expect(state!.textContent).not.toMatch(/no longer exists|không còn tồn tại/i)
        expect(retryButton()?.textContent).toBe(retry)
        // UNI-2047 sidebar: the web hides the From elsewhere section while the route is not there
        expect(sidebarSlot.querySelector('.dl-side-sources')).toBeNull()
      },
    )

    it('Retry reads the sources route again and shows the rows once the server answers', async () => {
      sources = async () => ({ ok: false, error: 'not_found' })
      await mount('elsewhere')
      expect(api.uniworkListSources).toHaveBeenCalledTimes(1)
      sources = async () => ok({ items: [source({ id: 's-1' })], nextCursor: null })
      await click(retryButton())
      expect(api.uniworkListSources).toHaveBeenCalledTimes(2)
      expect(stateOf()).toBeNull()
      expect(host.textContent).toContain('s-1.pdf')
    })

    it.each(['server_error', 'network'] as const)(
      'any other error (%s) is the generic list error with its own sentence and Retry',
      async (error) => {
        sources = async () => ({ ok: false, error })
        await mount('elsewhere')
        const state = stateOf()
        expect(state).not.toBeNull()
        expect(state!.querySelector('.dl-state-title')?.textContent).not.toMatch(
          /not available on this server/,
        )
        expect(state!.querySelector('.dl-state-title')?.textContent).toMatch(/\S/)
        expect(retryButton()).toBeDefined()
      },
    )

    it('a 404 on Starred keeps its own wording, not the From elsewhere one', async () => {
      favorites = async () => ({ ok: false, error: 'not_found' })
      await mount('starred')
      expect(stateOf()!.querySelector('.dl-state-title')?.textContent).toBe(
        'Starred is not available on this server yet',
      )
    })
  })

  describe('RV-5: Retry only where asking again can help', () => {
    const retryButton = () =>
      Array.from(stateOf()?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Retry')

    it.each(['forbidden', 'not_signed_in', 'session_expired'] as const)(
      'Starred with %s has no Retry (a sign-in problem, as on the other lists)',
      async (error) => {
        favorites = async () => ({ ok: false, error })
        await mount('starred')
        expect(stateOf()).not.toBeNull()
        expect(retryButton()).toBeUndefined()
      },
    )

    it.each(['forbidden', 'not_signed_in', 'session_expired'] as const)(
      'From elsewhere with %s has no Retry',
      async (error) => {
        sources = async () => ({ ok: false, error })
        await mount('elsewhere')
        expect(stateOf()).not.toBeNull()
        expect(retryButton()).toBeUndefined()
      },
    )

    it.each([
      ['starred', 'not_found'],
      ['starred', 'server_error'],
      ['starred', 'timeout'],
      ['elsewhere', 'not_found'],
      ['elsewhere', 'server_error'],
      ['elsewhere', 'timeout'],
    ] as const)('%s keeps Retry for %s', async (view, error) => {
      favorites = async () => ({ ok: false, error })
      sources = async () => ({ ok: false, error })
      await mount(view)
      expect(retryButton()).toBeDefined()
    })
  })

  describe('F-04: From elsewhere rows', () => {
    const SOURCES = [
      source({ id: 's-chat', name: 'hop-dong.pdf' }),
      source({
        id: 's-task',
        source: 'task',
        parent: { kind: 'task', id: 't-1', title: 'Chuẩn bị họp HĐQT' },
        updatedAt: iso(2026, 10, 20, 9, 5),
      }),
      source({
        id: 's-meet',
        source: 'meeting',
        parent: { kind: 'meeting', id: 'm-1', title: 'Họp tuần' },
        updatedAt: iso(2026, 10, 19, 9, 5),
      }),
      source({
        id: 's-mail',
        source: 'email',
        parent: { kind: 'email_thread', id: 'e-1', title: 'Re: Báo giá Q4' },
        updatedAt: iso(2026, 10, 18, 9, 5),
      }),
      source({
        id: 's-bare',
        parent: { kind: 'chat_channel', id: 'room-2', title: '  ' },
        updatedAt: iso(2026, 10, 17, 9, 5),
      }),
      source({
        id: 's-hash',
        parent: { kind: 'chat_channel', id: 'room-3', title: '#general' },
        updatedAt: iso(2026, 10, 15, 9, 5),
      }),
      source({
        id: 's-dm',
        parent: { kind: 'chat_dm', id: 'dm-1', title: 'Minh Trần' },
        updatedAt: iso(2026, 10, 14, 9, 5),
      }),
      source({
        id: 's-group',
        parent: { kind: 'chat_dm', id: 'dm-2', title: 'Nhóm Kế toán' },
        updatedAt: iso(2026, 10, 13, 9, 5),
      }),
      source({
        id: 's-new',
        source: 'wiki',
        parent: { kind: 'wiki', id: 'w-1', title: 'Quy trình' },
        updatedAt: iso(2026, 10, 16, 9, 5),
      }),
    ]
    const subline = (id: string) =>
      host.querySelector(`[data-source-id="${id}"] .dh-doc-subpath`)?.textContent ?? null

    it('en: the Name sub-line is the origin, worded as the web module does (chat gets "#")', async () => {
      sources = async () => ok({ items: SOURCES, nextCursor: null })
      await mount('elsewhere', 'en')
      expect(subline('s-chat')).toBe('Sent in Chat · #phap-che')
      expect(subline('s-task')).toBe('From a task · Chuẩn bị họp HĐQT')
      expect(subline('s-meet')).toBe('From a meeting · Họp tuần')
      expect(subline('s-mail')).toBe('From an email · Re: Báo giá Q4')
    })

    it('en: a DM or group-room file is not a channel, so its parent title gets no "#" (RV-10)', async () => {
      sources = async () => ok({ items: SOURCES, nextCursor: null })
      await mount('elsewhere', 'en')
      expect(subline('s-dm')).toBe('Sent in Chat · Minh Trần')
      expect(subline('s-group')).toBe('Sent in Chat · Nhóm Kế toán')
    })

    it('vi: a DM or group-room file is not a channel, so its parent title gets no "#" (RV-10)', async () => {
      sources = async () => ok({ items: SOURCES, nextCursor: null })
      await mount('elsewhere', 'vi')
      expect(subline('s-dm')).toBe('Gửi trong Chat · Minh Trần')
      expect(subline('s-group')).toBe('Gửi trong Chat · Nhóm Kế toán')
    })

    it('vi: the Name sub-line is the origin, worded as the web module does (chat gets "#")', async () => {
      sources = async () => ok({ items: SOURCES, nextCursor: null })
      await mount('elsewhere', 'vi')
      expect(subline('s-chat')).toBe('Gửi trong Chat · #phap-che')
      expect(subline('s-task')).toBe('Từ công việc · Chuẩn bị họp HĐQT')
      expect(subline('s-meet')).toBe('Từ cuộc họp · Họp tuần')
      expect(subline('s-mail')).toBe('Từ email · Re: Báo giá Q4')
    })

    it('a blank parent title leaves the module alone; a module this build has no name for shows its parent only', async () => {
      sources = async () => ok({ items: SOURCES, nextCursor: null })
      await mount('elsewhere', 'en')
      expect(subline('s-bare')).toBe('Sent in Chat')
      expect(subline('s-new')).toBe('Quy trình')
      // only a chat_channel parent gets a "#": a title that already starts with "#" is not doubled
      expect(subline('s-hash')).toBe('Sent in Chat · #general')
      expect(host.textContent).not.toMatch(/undefined|NaN/)
    })

    it('the page has no Access column and no "—" Access cell (a source file has no level)', async () => {
      sources = async () => ok({ items: SOURCES, nextCursor: null })
      await mount('elsewhere', 'en')
      const heads = Array.from(host.querySelectorAll('[role="columnheader"]')).map((el) =>
        el.getAttribute('data-col'),
      )
      expect(heads).toEqual(['name', 'editor', 'updated', 'size', 'actions'])
      expect(host.querySelector('.dh-cell-access, [data-col="access"]')).toBeNull()
      // every cell of a row matches a header: the grid has no orphan track
      const row = host.querySelector<HTMLElement>('[data-source-id="s-chat"]')!
      expect(row.querySelectorAll('[role="cell"]')).toHaveLength(heads.length)
    })

    it('the model drops Truy cập on this page at every width and keeps it on the workspace list', () => {
      for (const width of [undefined, 1200, 900, 600, 400]) {
        expect(visibleColumns('elsewhere', [], width)).not.toContain('access')
        expect(visibleColumns('elsewhere', [], width)).toContain('name')
      }
      expect(visibleColumns('workspace', [], undefined)).toContain('access')
    })
  })

  describe('F-09: search with no hit', () => {
    it.each([
      ['en', 'No results for “zzzz”', 'Clear search'],
      ['vi', 'Không có kết quả cho “zzzz”', 'Xóa tìm kiếm'],
    ] as const)(
      '%s: the shared empty state (icon, "No results for X", Clear search) replaces the plain line',
      async (lang, title, clear) => {
        await mount('workspace', lang)
        await type('zzzz')
        expect(api.uniworkSearchDocuments).toHaveBeenCalled()
        const state = stateOf()
        expect(state, 'the shared list state').not.toBeNull()
        expect(state!.querySelector('svg.dl-state-icon')).not.toBeNull()
        expect(state!.querySelector('.dl-state-title')?.textContent).toBe(title)
        expect(state!.textContent).not.toMatch(/Nothing matches|Không có gì khớp/)
        const button = Array.from(state!.querySelectorAll('button')).find(
          (b) => b.textContent === clear,
        )
        expect(button, 'Clear search').toBeDefined()
        await click(button)
        expect(host.querySelector<HTMLInputElement>('.dh-search-input')!.value).toBe('')
        expect(stateOf()?.querySelector('.dl-state-title')?.textContent).not.toBe(title)
      },
    )

    // UNI-2080 RV-7: both clear controls unmount with the no-hit state / the typed text
    it('Clear search in the empty state returns focus to the search box', async () => {
      await mount('workspace', 'en')
      await type('zzzz')
      const button = Array.from(stateOf()!.querySelectorAll('button')).find(
        (b) => b.textContent === 'Clear search',
      )!
      button.focus()
      await click(button)
      expect(document.activeElement).toBe(host.querySelector('.dh-search-input'))
    })

    it('the × in the search box returns focus to the search box', async () => {
      await mount('workspace', 'en')
      await type('zzzz')
      const clear = host.querySelector<HTMLButtonElement>('.dh-search-box button')!
      clear.focus()
      await click(clear)
      expect(host.querySelector('.dh-search-box button')).toBeNull()
      expect(document.activeElement).toBe(host.querySelector('.dh-search-input'))
    })

    it('the search field has exactly one clear button, and the native one is hidden', async () => {
      await mount('workspace', 'en')
      expect(host.querySelectorAll('.dh-search-box button')).toHaveLength(0)
      await type('zzzz')
      const buttons = host.querySelectorAll('.dh-search-box button')
      expect(buttons).toHaveLength(1)
      expect(buttons[0]!.getAttribute('aria-label')).toBe('Clear search')
      const css = readFileSync(
        resolve(__dirname, '../src/renderer/src/doclist/doclist-state.css'),
        'utf8',
      )
      expect(css).toMatch(
        /\.dh-search-input::-webkit-search-cancel-button\s*\{[^}]*display:\s*none/,
      )
    })
  })

  describe('F-10: no dangling › for a file directly in the root', () => {
    it('shortPath of the root alone is the root name', () => {
      expect(shortPath([], 'UniWork')).toEqual({ short: 'UniWork', full: 'UniWork' })
      // a file below the root keeps the trail that leads to it
      expect(shortPath([{ id: 'a', title: 'Alpha' }], 'UniWork').short).toBe('UniWork › Alpha ›')
    })

    it('a starred root file shows "Documents (root)" with no ›', async () => {
      favorites = async () =>
        ok({
          documents: [
            doc({ id: 'a', path: [], favoritedAt: iso(2026, 10, 20, 8, 0) }),
            doc({
              id: 'b',
              path: [{ id: 'p1', title: 'Alpha' }],
              favoritedAt: iso(2026, 10, 19, 8, 0),
            }),
          ],
          nextCursor: null,
        })
      await mount('starred', 'en')
      const text = (id: string) =>
        host.querySelector(`[data-doc-id="${id}"] .dh-doc-subpath [aria-hidden="true"]`)
          ?.textContent
      expect(text('a')).toBe('Documents (root)')
      expect(text('b')).toBe('Documents (root) › Alpha ›')
    })
  })
})

describe('F-08: the picker row meta text on the dark hover fill', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')
  const luminance = (hex: string): number => {
    const h = hex.replace('#', '')
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
  }
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi! + 0.05) / (lo! + 0.05)
  }
  const darkBlock = (): string => {
    const css = read('../../../packages/ui/src/tokens.css')
    const start = css.indexOf("[data-theme='dark'] {")
    return css.slice(start, css.indexOf('}', start))
  }
  const token = (block: string, name: string): string =>
    new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(block)![1]!

  it('the meta colour of a picker row is a token that reaches 4.5:1 on the dark hover fill', () => {
    const css = read('../src/renderer/src/doclist/doclist-picker.css')
    const rule = /\.uw-pick-row-meta\s*\{([^}]*)\}/.exec(css)
    expect(rule, 'a .uw-pick-row-meta rule in doclist-picker.css').not.toBeNull()
    const color = /color:\s*var\((--[a-z-]+)\)/.exec(rule![1]!)
    expect(color, 'a token colour, never a raw value').not.toBeNull()
    const block = darkBlock()
    // the row under the cursor / keyboard highlight is filled with --hover
    const ratio = contrast(token(block, color![1]!), token(block, '--hover'))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})
