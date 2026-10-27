/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkSourceFile, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type {
  DocumentsHomeDoc,
  DocumentsHomeSubViewId,
} from '../src/renderer/src/uniwork-home/documents-home-model'
import { matchesExtFamily } from '../src/main/recent-files'

// UNI-2113 fix1 (T-R1-2): the Q0 switch is a constant of the model; a test flips what the screen reads
const q0 = vi.hoisted(() => ({ hidesFolders: false }))
vi.mock('../src/renderer/src/uniwork-home/documents-home-model', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/renderer/src/uniwork-home/documents-home-model')>()
  return {
    ...actual,
    get TYPE_PICK_HIDES_FOLDERS() {
      return q0.hidesFolders
    },
  }
})

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

const NOW = new Date(2026, 9, 21, 12, 0, 0)
const iso = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0).toISOString()

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'Công ty', slug: 'uniwork' }]

const row = (partial: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
  workspaceId: 'ws-1',
  title: partial.id,
  format: 'docx',
  updatedAt: iso(2026, 10, 21, 9, 5),
  kind: 'file',
  parentId: null,
  visibility: 'workspace',
  myLevel: 'edit',
  canEdit: true,
  updatedById: 'u-minh',
  updatedByName: 'Minh Trần',
  sizeBytes: 2_969,
  ...partial,
})

const SOURCE = {
  id: 'src-1',
  workspaceId: 'ws-1',
  name: 'Bảng giá.pdf',
  extension: 'pdf',
  mimeType: 'application/pdf',
  sizeBytes: 5_033_165,
  updatedAt: iso(2026, 10, 20, 16, 30),
  source: 'chat',
  owner: { id: 'u-lan', name: 'Lan Nguyễn' },
  parent: { kind: 'chat_channel', title: 'Kế toán' },
} as unknown as UniworkSourceFile

// the menu items, in the one fixed order (DESIGN r2): All types first, then UniNote and the formats
const OPTIONS = [
  ['all', 'Tất cả'],
  ['page', 'UniNote'],
  ['docx', '.docx'],
  ['xlsx', '.xlsx'],
  ['pptx', '.pptx'],
  ['pdf', '.pdf'],
  ['md', '.md'],
  ['html', '.html'],
  ['txt', '.txt'],
] as const

// every UniWork screen and the list call behind it
const SCREENS = [
  ['workspace', 'uniworkListChildren'],
  ['recent', 'uniworkListDocuments'],
  ['shared-with-me', 'uniworkListSharedWithMe'],
  ['shared-by-me', 'uniworkListSharedByMe'],
  ['trash', 'uniworkListTrash'],
  ['archive', 'uniworkListShelved'],
] as const satisfies readonly (readonly [DocumentsHomeSubViewId, string])[]

// the rules of the @media (max-width: 1280px) block that wraps the toolbar search box (the file
// has other blocks at that width: pick the one that names the box)
function searchWrapBlock(css: string): string {
  const blocks = [...css.matchAll(/@media \(max-width: 1280px\)\s*\{([^@]*?)\n\}/g)].map(
    (m) => m[1]!,
  )
  const block = blocks.find((b) => b.includes('.dh-search-box'))
  if (block === undefined) throw new Error('no max-width 1280px block names .dh-search-box')
  return block
}

describe('the filter bar on the shared list rules (UNI-2047 A3)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let items: DocumentsHomeDoc[]
  let sources: UniworkSourceFile[]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    items = [
      row({ id: 'doc-a', title: 'Ân hạn nợ.docx' }),
      row({
        id: 'doc-b',
        title: 'Bảng chấm công.xlsx',
        format: 'xlsx',
        updatedById: 'u-lan',
        updatedByName: 'Lan Nguyễn',
        updatedAt: iso(2026, 10, 1, 8, 0),
      }),
      row({ id: 'page-c', title: 'Ghi chú họp', kind: 'page', format: null }),
    ]
    sources = []
    const shelved = (): DocumentsHomeDoc[] =>
      items.map((d) => ({
        ...d,
        canManage: true,
        shelvedAt: iso(2026, 10, 19, 8, 0),
        shelvedById: 'u-lan',
        shelvedByName: 'Lan Nguyễn',
      }))
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
      uniworkListChildren: vi.fn(async () => ok({ items, nextCursor: null })),
      uniworkListDocuments: vi.fn(async () => ok({ documents: items, nextCursor: null })),
      uniworkListSharedWithMe: vi.fn(async () => ok({ documents: items, nextCursor: null })),
      uniworkListSharedByMe: vi.fn(async () => ok({ documents: items, nextCursor: null })),
      uniworkListTrash: vi.fn(async () =>
        ok({
          documents: items.map((d) => ({
            ...d,
            archived: true,
            archivedAt: iso(2026, 10, 19, 8, 0),
            canManage: true,
          })),
          nextCursor: null,
        }),
      ),
      uniworkListShelved: vi.fn(async () => ok({ documents: shelved(), nextCursor: null })),
      uniworkListSources: vi.fn(async () => ok({ items: sources, nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
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
  })

  async function mount(subView: DocumentsHomeSubViewId = 'workspace', lang: 'vi' | 'en' = 'vi') {
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
  async function remount(subView: DocumentsHomeSubViewId = 'workspace') {
    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    await mount(subView)
  }
  const click = async (el: Element | null | undefined) => {
    expect(el).toBeTruthy()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
    await flush()
  }
  const goTo = (id: string) => click(sidebarSlot.querySelector(`.nav-item[data-nav="${id}"]`))
  // the one Type control: a trigger button and, while open, its menu below it
  const trigger = () =>
    host.querySelector<HTMLButtonElement>('.dh-filter-bar button[data-filter="type"]')
  const menu = () => host.querySelector<HTMLElement>('.dh-filter-bar [role="menu"]')
  const menuItem = (key: string) =>
    host.querySelector<HTMLButtonElement>(
      `.dh-filter-bar [role="menuitemcheckbox"][data-type="${key}"]`,
    )
  const menuItems = () =>
    Array.from(host.querySelectorAll('.dh-filter-bar [role="menuitemcheckbox"]')) as HTMLElement[]
  const checked = () =>
    menuItems()
      .filter((el) => el.getAttribute('aria-checked') === 'true')
      .map((el) => el.getAttribute('data-type'))
  const squash = (el: Element | null | undefined) =>
    (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const openMenu = async () => {
    if (!menu()) await click(trigger())
    expect(menu(), 'menu open').not.toBeNull()
  }
  // choose one menu item (opens the menu first)
  const chip = async (key: string) => {
    await openMenu()
    await click(menuItem(key))
  }
  const chips = () =>
    Array.from(host.querySelectorAll<HTMLElement>('.dh-filter-bar .dh-filter-chips [data-chip]'))
  const chipKeys = () => chips().map((el) => el.getAttribute('data-chip'))
  const key = async (el: Element | null | undefined, k: string) => {
    expect(el).toBeTruthy()
    await act(async () => {
      el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    })
    await flush()
  }
  const select = (name: string) =>
    host.querySelector<HTMLSelectElement>(`.dh-filter-bar select[data-filter="${name}"]`)
  const pick = async (el: HTMLSelectElement | null, value: string) => {
    expect(el).toBeTruthy()
    await act(async () => {
      el!.value = value
      el!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
  }
  const lastCall = (fn: string) => {
    const calls = api[fn]!.mock.calls
    return calls[calls.length - 1]?.[0] as Record<string, unknown>
  }
  const rowIds = () =>
    Array.from(host.querySelectorAll('.dh-doc-table [role="row"][data-doc-id]')).map((el) =>
      el.getAttribute('data-doc-id'),
    )

  describe('the Type control per screen', () => {
    it.each(SCREENS)(
      '%s shows ONE Type control, then Người sửa and Cập nhật, no chip yet',
      async (subView) => {
        await remount(subView)
        const bar = host.querySelector('.dh-filter-bar')
        expect(bar, 'filter bar').not.toBeNull()
        const t = trigger()
        expect(t, 'type trigger').not.toBeNull()
        expect(t!.tagName).toBe('BUTTON')
        expect(squash(t)).toBe('Loại: Tất cả')
        // the old row of one-button-per-type chips is gone
        expect(bar!.querySelectorAll('[aria-pressed]')).toHaveLength(0)
        expect(bar!.querySelectorAll('.dh-filter-type')).toHaveLength(0)
        expect(chips()).toHaveLength(0)
        expect(menu(), 'closed until opened').toBeNull()
        expect(
          Array.from(bar!.querySelectorAll('select')).map((el) => el.getAttribute('data-filter')),
        ).toEqual(
          // the shelf's Lưu trữ bởi is one more chip of the same bar, after the pair
          subView === 'archive'
            ? ['updatedBy', 'updatedFrom', 'shelvedBy']
            : ['updatedBy', 'updatedFrom'],
        )
        // the old inline type select, Truy cập and Nhóm theo are not part of the bar
        expect(bar!.querySelector('select[data-filter="format"]')).toBeNull()
        expect(bar!.querySelector('select[data-filter="groupBy"]')).toBeNull()
        expect(bar!.querySelector('select[data-filter="access"]')).toBeNull()
      },
    )

    it.each(SCREENS)(
      '%s opens a menu with All types first, then UniNote and the formats',
      async (subView) => {
        await remount(subView)
        await openMenu()
        expect(menuItems().map((el) => [el.getAttribute('data-type'), squash(el)])).toEqual(
          OPTIONS.map(([k, label]) => [k, label]),
        )
        expect(checked()).toEqual(['all'])
      },
    )

    it('puts the trigger, the two selects and then the chips in the bar, in that order', async () => {
      await mount('workspace')
      await chip('docx')
      const bar = host.querySelector('.dh-filter-bar')!
      expect(Array.from(bar.children).map((el) => el.className.split(' ')[0])).toEqual([
        'dh-type-filter',
        'dh-filter-selects',
        'dh-filter-chips',
        'dh-filter-clear',
      ])
    })

    it('has Người sửa and Cập nhật labelled in Vietnamese', async () => {
      await mount('workspace')
      const labels = Array.from(host.querySelectorAll('.dh-filter-bar .dh-filter-k')).map((el) =>
        el.textContent?.trim(),
      )
      expect(labels).toEqual(['Loại:', 'Người sửa:', 'Cập nhật:'])
    })

    it('draws Lưu trữ bởi on the shelf as a chip of the shared bar, like Người sửa and Cập nhật', async () => {
      await mount('archive')
      const bar = host.querySelector('.dh-filter-bar')!
      const by = bar.querySelector<HTMLSelectElement>('select[data-filter="shelvedBy"]')
      expect(by).not.toBeNull()
      // no second row above the bar holds a select
      expect(host.querySelector('.dh-shelved-head, .dh-shelved-toolbar, .dh-shelved-by')).toBeNull()
      // the same markup as Người sửa: a .dh-filter-chip label (key + select), a direct child of the bar
      const chipOf = (name: string) =>
        bar.querySelector(`select[data-filter="${name}"]`)!.closest('label.dh-filter-chip')!
      const mine = chipOf('shelvedBy')
      const editor = chipOf('updatedBy')
      expect(mine.parentElement).toBe(bar)
      expect(mine.className).toBe(editor.className)
      expect(mine.firstElementChild!.className).toBe(editor.firstElementChild!.className)
      expect(by!.className).toBe(bar.querySelector('select[data-filter="updatedBy"]')!.className)
      expect(squash(mine)).toContain('Lưu trữ bởi:')
      expect(squash(mine)).toContain('Bất kỳ ai')
      // the chips after the Type control, in the bar's order: Loại, Người sửa + Cập nhật, Lưu trữ bởi
      expect(Array.from(bar.children).map((el) => el.className.split(' ')[0])).toEqual([
        'dh-type-filter',
        'dh-filter-selects',
        'dh-filter-chip',
      ])
      // one type control only
      expect(host.querySelectorAll('.dh-filter-bar button[data-filter="type"]')).toHaveLength(1)
    })

    it('keeps filtering the shelf by Lưu trữ bởi from the bar chip, on the loaded rows only', async () => {
      const by = (id: string, name: string) => ({ shelvedById: id, shelvedByName: name })
      const mixed = [
        row({
          id: 'doc-a',
          canManage: true,
          shelvedAt: iso(2026, 10, 19, 8, 0),
          ...by('u-lan', 'Lan Nguyễn'),
        }),
        row({
          id: 'doc-b',
          canManage: true,
          shelvedAt: iso(2026, 10, 18, 8, 0),
          ...by('u-hai', 'Hải Lê'),
        }),
      ]
      api.uniworkListShelved!.mockImplementation(async () =>
        ok({ documents: mixed, nextCursor: null }),
      )
      await mount('archive')
      expect(rowIds()).toEqual(['doc-a', 'doc-b'])
      expect(host.querySelector('.dh-shelved-loaded-only')).toBeNull()
      const calls = api.uniworkListShelved!.mock.calls.length
      await pick(select('shelvedBy'), 'u-hai')
      expect(rowIds()).toEqual(['doc-b'])
      expect(host.querySelector('.dh-shelved-loaded-only')).not.toBeNull()
      await pick(select('shelvedBy'), '')
      expect(rowIds()).toEqual(['doc-a', 'doc-b'])
      expect(host.querySelector('.dh-shelved-loaded-only')).toBeNull()
      // client-side only: no new request
      expect(api.uniworkListShelved!.mock.calls.length).toBe(calls)
    })

    it.each(['recent', 'shared-with-me', 'archive'] as const)(
      'puts the search box in the same slot of the same toolbar row on %s',
      async (subView) => {
        await remount(subView)
        const toolbar = host.querySelector('.dh-toolbar')!
        const box = toolbar.querySelector(':scope > .dh-search-box')
        expect(box, 'search box is a direct child of the toolbar row').not.toBeNull()
        expect(box!.getAttribute('role')).toBe('search')
        // title, then the spacer, then the search box: the order Recent and Shared with me draw
        expect(Array.from(toolbar.children).map((el) => el.className.split(' ')[0])).toEqual(
          expect.arrayContaining(['dh-title-group', 'dh-toolbar-spacer', 'dh-search-box']),
        )
        expect(box!.previousElementSibling!.className).toBe('dh-toolbar-spacer')
        // not inside the filter bar and not above the toolbar
        expect(host.querySelector('.dh-filter-bar .dh-search-box')).toBeNull()
        expect(host.querySelectorAll('.dh-search-box')).toHaveLength(1)
      },
    )

    describe('a query on the Archive keeps the shelf layout (UNI-2205 fix6)', () => {
      const typeIntoSearch = async (text: string) => {
        const input = host.querySelector<HTMLInputElement>('.dh-search-input')!
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
          setter.call(input, text)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await flush()
      }
      const hit = (id: string, shelvedById: string, shelvedByName: string) =>
        row({
          id,
          canManage: true,
          // hit-a is the newest shelved: the shelf sorts newest first
          shelvedAt: iso(2026, 10, id === 'hit-a' ? 19 : 18, 8, 0),
          shelvedById,
          shelvedByName,
        })
      const barLabels = () =>
        Array.from(host.querySelectorAll('.dh-filter-bar .dh-filter-k')).map((el) =>
          el.textContent?.trim(),
        )

      it('keeps the chips, the intro and the Archive columns, and asks the search for shelved=true', async () => {
        api.uniworkSearchDocuments!.mockResolvedValue(
          ok({ items: [hit('hit-a', 'u-lan', 'Lan Nguyễn')], nextCursor: null }),
        )
        await mount('archive')
        const labelsAtRest = barLabels()
        expect(labelsAtRest).toContain('Lưu trữ bởi:')
        await typeIntoSearch('plan')
        expect(lastCall('uniworkSearchDocuments')).toEqual(
          expect.objectContaining({ workspaceId: 'ws-1', query: 'plan', shelved: true }),
        )
        expect(barLabels()).toEqual(labelsAtRest)
        expect(select('shelvedBy')).not.toBeNull()
        expect(host.querySelector('.dh-shelved-intro')).not.toBeNull()
        expect(rowIds()).toEqual(['hit-a'])
        expect(
          Array.from(host.querySelectorAll('.dh-doc-table [role="columnheader"]')).map((h) =>
            h.getAttribute('data-col'),
          ),
        ).toContain('shelved')
      })

      it('narrows the hits by Lưu trữ bởi on the client, with the loaded-only note and no new request', async () => {
        api.uniworkSearchDocuments!.mockResolvedValue(
          ok({
            items: [hit('hit-a', 'u-lan', 'Lan Nguyễn'), hit('hit-b', 'u-hai', 'Hải Lê')],
            nextCursor: null,
          }),
        )
        await mount('archive')
        await typeIntoSearch('plan')
        expect(rowIds()).toEqual(['hit-a', 'hit-b'])
        expect(host.querySelector('.dh-shelved-loaded-only')).toBeNull()
        const calls = api.uniworkSearchDocuments!.mock.calls.length
        await pick(select('shelvedBy'), 'u-hai')
        expect(rowIds()).toEqual(['hit-b'])
        expect(host.querySelector('.dh-shelved-loaded-only')).not.toBeNull()
        expect(api.uniworkSearchDocuments!.mock.calls.length).toBe(calls)
      })

      it('a query with no archived hit shows the search empty state, not the empty shelf', async () => {
        await mount('archive')
        await typeIntoSearch('zzz')
        expect(rowIds()).toEqual([])
        expect(host.querySelector('.dh-shelved-empty')).toBeNull()
        expect(host.textContent).toContain('zzz')
        expect(host.querySelector('.dh-shelved-intro')).not.toBeNull()
      })

      it('keeps shelved=true on Load more and on a Type pick, and returns to the shelf list when cleared', async () => {
        api.uniworkSearchDocuments!.mockResolvedValueOnce(
          ok({ items: [hit('hit-a', 'u-lan', 'Lan Nguyễn')], nextCursor: 'c-2' }),
        )
        await mount('archive')
        await typeIntoSearch('plan')
        api.uniworkSearchDocuments!.mockResolvedValueOnce(
          ok({ items: [hit('hit-b', 'u-lan', 'Lan Nguyễn')], nextCursor: null }),
        )
        await click(host.querySelector('.dh-load-more-row button'))
        expect(lastCall('uniworkSearchDocuments')).toEqual(
          expect.objectContaining({ query: 'plan', cursor: 'c-2', shelved: true }),
        )
        expect(rowIds()).toEqual(['hit-a', 'hit-b'])
        await chip('docx')
        expect(lastCall('uniworkSearchDocuments')).toEqual(
          expect.objectContaining({ query: 'plan', shelved: true, types: ['docx'] }),
        )
        await click(host.querySelector('.dh-search-clear'))
        expect(lastCall('uniworkListShelved')).toEqual(
          expect.objectContaining({ workspaceId: 'ws-1' }),
        )
      })

      it('leaves the other screens as they were: no shelved flag, no Lưu trữ bởi chip', async () => {
        await mount('workspace')
        await typeIntoSearch('plan')
        const sent = lastCall('uniworkSearchDocuments')
        expect(sent).toEqual(expect.objectContaining({ query: 'plan' }))
        expect(sent).not.toHaveProperty('shelved')
        expect(select('shelvedBy')).toBeNull()
        for (const subView of ['recent', 'shared-with-me'] as const) {
          await remount(subView)
          const before = api.uniworkSearchDocuments!.mock.calls.length
          await typeIntoSearch('plan')
          // Recent and Shared with me filter their own loaded rows: no search request at all
          expect(api.uniworkSearchDocuments!.mock.calls.length).toBe(before)
          expect(select('shelvedBy')).toBeNull()
        }
      })

      it('every screen renders its search box under the toolbar selector the 1280px wrap rule keys on', async () => {
        const css = readFileSync(
          join(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
          'utf8',
        )
        const boxRule = searchWrapBlock(css).match(
          /([^{}]+>\s*\.dh-search-box)\s*\{[^}]*margin-inline-end:/,
        )
        expect(boxRule, 'search box wrap rule').not.toBeNull()
        const boxSelector = boxRule![1]!.trim()
        expect(boxSelector).toBe('.dh-toolbar:not(.dh-toolbar-folder) > .dh-search-box')
        for (const subView of [
          'archive',
          'recent',
          'shared-with-me',
          'shared-by-me',
          'trash',
          'workspace',
        ] as const) {
          await remount(subView)
          expect(
            host.querySelector(boxSelector),
            `${subView}: matched by the wrap rule`,
          ).not.toBeNull()
          expect(
            host.querySelector('.dh-toolbar-shelf'),
            `${subView}: no per-screen class`,
          ).toBeNull()
        }
        api.uniworkListFavorites = vi.fn(async () => ok({ documents: items, nextCursor: null }))
        await goTo('starred')
        expect(host.querySelector(boxSelector), 'starred: matched by the wrap rule').not.toBeNull()
      })

      it('the wrap rule skips an open folder header and still reaches a folder with a query (KLF-24)', async () => {
        const css = readFileSync(
          join(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
          'utf8',
        )
        const boxSelector = searchWrapBlock(css)
          .match(/([^{}]+>\s*\.dh-search-box)\s*\{[^}]*margin-inline-end:/)![1]!
          .trim()
        api.uniworkFolderTree = vi.fn(async () =>
          ok([
            { id: 'f-alpha', parentId: null, title: 'Alpha', position: 0, children: [] },
          ] as never),
        )
        await act(async () => {
          root.unmount()
        })
        root = createRoot(host)
        await act(async () => {
          root.render(
            createElement(
              LocaleProvider,
              { initial: 'vi' },
              createElement(DocumentsHome, {
                workspaceId: 'ws-1',
                workspaces,
                onWorkspaceChange: vi.fn(),
                onOpenDocument: vi.fn(),
                sidebarHost: sidebarSlot,
                initialFolderId: 'f-alpha',
              }),
            ),
          )
        })
        await flush()
        // an open folder, no query: the container-query header, not the box the rule wraps
        expect(host.querySelector('.dh-toolbar.dh-toolbar-folder')).not.toBeNull()
        expect(host.querySelector('.dh-search-box')).not.toBeNull()
        expect(host.querySelector(boxSelector), 'open folder: not matched').toBeNull()
        // the same folder with a query is the plain toolbar: matched like every other screen
        await typeIntoSearch('plan')
        expect(host.querySelector('.dh-toolbar-folder')).toBeNull()
        expect(host.querySelector(boxSelector), 'folder + query: matched').not.toBeNull()
      })
    })

    it('says Type: All types / Type: 3 types in English', async () => {
      await remount('workspace')
      await act(async () => {
        root.unmount()
      })
      root = createRoot(host)
      await mount('workspace', 'en')
      expect(squash(trigger())).toBe('Type: All types')
      await chip('docx')
      expect(squash(trigger())).toBe('Type: .docx')
      await chip('pdf')
      await chip('txt')
      expect(squash(trigger())).toBe('Type: 3 types')
      expect(chips()[0]!.querySelector('button')!.getAttribute('aria-label')).toBe(
        'Remove .docx filter',
      )
      expect(squash(menuItem('all'))).toBe('All types')
    })
  })

  describe('the trigger text', () => {
    it('reads Loại: Tất cả, Loại: .xlsx (with its badge), then Loại: N loại', async () => {
      await mount('workspace')
      expect(squash(trigger())).toBe('Loại: Tất cả')
      await chip('xlsx')
      expect(squash(trigger())).toBe('Loại: .xlsx')
      expect(trigger()!.querySelector('img, svg')).not.toBeNull()
      await chip('page')
      expect(squash(trigger())).toBe('Loại: 2 loại')
      await chip('txt')
      expect(squash(trigger())).toBe('Loại: 3 loại')
      // back to one pick: the badge and the label again
      await chip('page')
      await chip('txt')
      expect(squash(trigger())).toBe('Loại: .xlsx')
    })
  })

  describe('parameters sent', () => {
    it.each(SCREENS)(
      '%s sends the picks as types, in menu order, no format / kind',
      async (subView, fn) => {
        await remount(subView)
        await chip('xlsx')
        expect(lastCall(fn).types).toEqual(['xlsx'])
        expect(lastCall(fn)).not.toHaveProperty('format')
        expect(lastCall(fn)).not.toHaveProperty('kind')
        expect(checked()).toEqual(['xlsx'])
        // a second pick joins, kept in menu order whatever was clicked first
        await chip('page')
        expect(lastCall(fn).types).toEqual(['page', 'xlsx'])
        await chip('txt')
        expect(lastCall(fn).types).toEqual(['page', 'xlsx', 'txt'])
        expect(checked()).toEqual(['page', 'xlsx', 'txt'])
        // All types clears every pick
        await chip('all')
        expect(lastCall(fn).types).toBeUndefined()
        expect(checked()).toEqual(['all'])
      },
    )

    it('keeps the menu order when the second pick comes earlier in the menu', async () => {
      await mount('recent')
      await chip('pdf')
      await chip('docx')
      expect(lastCall('uniworkListDocuments').types).toEqual(['docx', 'pdf'])
    })

    it('unchecking the last pick falls back to All types', async () => {
      await mount('workspace')
      await chip('docx')
      await chip('docx')
      expect(checked()).toEqual(['all'])
      expect(lastCall('uniworkListChildren').types).toBeUndefined()
      expect(squash(trigger())).toBe('Loại: Tất cả')
    })

    it('forwards the types, editor and date filters to Shared with me', async () => {
      await mount('shared-with-me')
      await chip('pdf')
      await pick(select('updatedBy'), 'u-minh')
      await pick(select('updatedFrom'), '7d')
      expect(lastCall('uniworkListSharedWithMe')).toEqual(
        expect.objectContaining({
          includePages: true,
          types: ['pdf'],
          updatedBy: 'u-minh',
          updatedFrom: expect.any(String),
        }),
      )
    })

    it('sends Người sửa and Cập nhật as updatedBy / updatedFrom on the live screens', async () => {
      for (const [subView, fn] of SCREENS.filter(([s]) => s !== 'archive')) {
        await remount(subView)
        await pick(select('updatedBy'), 'u-minh')
        await pick(select('updatedFrom'), '30d')
        const q = lastCall(fn)
        expect(q.updatedBy, subView).toBe('u-minh')
        expect(typeof q.updatedFrom, subView).toBe('string')
      }
    })

    it('sends UniNote as a type (never kind or format) and shows every row the server answered', async () => {
      await mount('workspace')
      await chip('page')
      expect(lastCall('uniworkListChildren').types).toEqual(['page'])
      expect(lastCall('uniworkListChildren')).not.toHaveProperty('kind')
      expect(lastCall('uniworkListChildren')).not.toHaveProperty('format')
      expect(checked()).toEqual(['page'])
      // the server filters: the stub still answers all three, and none is narrowed on the client
      expect(rowIds()).toEqual(expect.arrayContaining(['doc-a', 'doc-b', 'page-c']))
    })

    it('lists no other-source file on the workspace root, whatever the pick (UNI-2047 F-14)', async () => {
      sources = [SOURCE]
      await mount('workspace')
      // the only sources read is the sidebar's limit:1 probe (UNI-2047 sidebar); nothing is merged
      const probe = [{ workspaceId: 'ws-1', limit: 1 }]
      expect(api.uniworkListSources.mock.calls.map((c) => c[0])).toEqual(probe)
      expect(host.textContent).not.toContain('Bảng giá.pdf')
      await chip('pdf')
      expect(api.uniworkListSources.mock.calls.map((c) => c[0])).toEqual(probe)
      expect(host.textContent).not.toContain('Bảng giá.pdf')
    })

    it('keeps the other-source files under .pdf on From elsewhere, which offers no UniNote item', async () => {
      sources = [SOURCE]
      await mount('elsewhere')
      expect(host.textContent).toContain('Bảng giá.pdf')
      await openMenu()
      expect(menuItem('page')).toBeNull()
      expect(menuItems().map((el) => el.getAttribute('data-type'))).toEqual([
        'all',
        'docx',
        'xlsx',
        'pptx',
        'pdf',
        'md',
        'html',
        'txt',
      ])
      await click(menuItem('pdf'))
      expect(lastCall('uniworkListSources')).toEqual({ workspaceId: 'ws-1', types: ['pdf'] })
      expect(host.textContent).toContain('Bảng giá.pdf')
      await click(menuItem('txt'))
      expect(lastCall('uniworkListSources')).toEqual({
        workspaceId: 'ws-1',
        types: ['pdf', 'txt'],
      })
    })

    it('narrows the shelf by editor and date here: the server takes only the type there', async () => {
      await mount('archive')
      await pick(select('updatedBy'), 'u-lan')
      expect(rowIds()).toEqual(['doc-b'])
      const q = lastCall('uniworkListShelved')
      expect(q.updatedBy).toBeUndefined()
      expect(q.updatedFrom).toBeUndefined()
      await pick(select('updatedBy'), '')
      await pick(select('updatedFrom'), '24h')
      // only the rows touched in the last 24 hours (doc-a, page-c)
      expect(rowIds()).toEqual(expect.arrayContaining(['doc-a', 'page-c']))
      expect(rowIds()).not.toContain('doc-b')
      expect(lastCall('uniworkListShelved').updatedFrom).toBeUndefined()
    })

    it('sends the picks to the shelf and the favorites as types', async () => {
      api.uniworkListFavorites = vi.fn(async () => ok({ documents: items, nextCursor: null }))
      await mount('archive')
      await chip('md')
      await chip('page')
      expect(lastCall('uniworkListShelved').types).toEqual(['page', 'md'])
      expect(lastCall('uniworkListShelved')).not.toHaveProperty('format')
      await goTo('starred')
      await chip('html')
      expect(lastCall('uniworkListFavorites').types).toEqual(['html'])
      expect(lastCall('uniworkListFavorites')).not.toHaveProperty('kind')
    })
  })

  describe('the menu behaviour (keyboard, focus, a11y)', () => {
    it('is a popover button with a menu of checkable items', async () => {
      await mount('workspace')
      const t = trigger()!
      expect(t.getAttribute('aria-haspopup')).toBe('menu')
      expect(t.getAttribute('aria-expanded')).toBe('false')
      await click(t)
      expect(t.getAttribute('aria-expanded')).toBe('true')
      const m = menu()!
      expect(m.getAttribute('role')).toBe('menu')
      expect(t.getAttribute('aria-controls')).toBe(m.id)
      expect(m.getAttribute('aria-label')).toBe('Loại')
      expect(menuItems().every((el) => el.getAttribute('aria-checked') !== null)).toBe(true)
      // one tab stop: the items are reached by the arrow keys
      expect(menuItems().every((el) => el.tabIndex === -1)).toBe(true)
      // the menu sits right after the trigger, inside the one control (below it, by CSS)
      expect(t.parentElement!.contains(m)).toBe(true)
    })

    it('shows a badge for every type but All, which has a same-size spacer', async () => {
      await mount('workspace')
      await openMenu()
      for (const [k] of OPTIONS) {
        const el = menuItem(k)!
        if (k === 'all') {
          expect(el.querySelector('.dh-type-spacer')).not.toBeNull()
          expect(el.querySelector('img, svg:not(.dh-type-check)')).toBeNull()
        } else {
          expect(el.querySelector('img, svg:not(.dh-type-check)'), k).not.toBeNull()
        }
      }
    })

    it('keeps the menu open while items toggle, and does not rebuild the item under the cursor', async () => {
      await mount('workspace')
      await chip('docx')
      expect(menu()).not.toBeNull()
      const pdf = menuItem('pdf')!
      pdf.focus()
      await click(pdf)
      expect(menu()).not.toBeNull()
      expect(checked()).toEqual(['docx', 'pdf'])
      expect(menuItem('pdf')).toBe(pdf)
      expect(document.activeElement).toBe(pdf)
    })

    it('opens on ArrowDown and puts focus on the first item', async () => {
      await mount('workspace')
      trigger()!.focus()
      await key(trigger(), 'ArrowDown')
      expect(menu()).not.toBeNull()
      expect(document.activeElement).toBe(menuItem('all'))
    })

    it('moves with ArrowDown / ArrowUp / Home / End and wraps', async () => {
      await mount('workspace')
      await openMenu()
      menuItem('all')!.focus()
      await key(document.activeElement, 'ArrowDown')
      expect(document.activeElement).toBe(menuItem('page'))
      await key(document.activeElement, 'ArrowDown')
      expect(document.activeElement).toBe(menuItem('docx'))
      await key(document.activeElement, 'ArrowUp')
      expect(document.activeElement).toBe(menuItem('page'))
      await key(document.activeElement, 'End')
      expect(document.activeElement).toBe(menuItem('txt'))
      await key(document.activeElement, 'ArrowDown')
      expect(document.activeElement).toBe(menuItem('all'))
      await key(document.activeElement, 'ArrowUp')
      expect(document.activeElement).toBe(menuItem('txt'))
      await key(document.activeElement, 'Home')
      expect(document.activeElement).toBe(menuItem('all'))
    })

    it('toggles an item through its button click (Enter and Space), keeping the menu open', async () => {
      await mount('workspace')
      await openMenu()
      menuItem('docx')!.focus()
      await act(async () => {
        menuItem('docx')!.click()
      })
      await flush()
      expect(checked()).toEqual(['docx'])
      expect(menu()).not.toBeNull()
      expect(lastCall('uniworkListChildren').types).toEqual(['docx'])
    })

    it('closes on Escape and returns focus to the trigger', async () => {
      await mount('workspace')
      await openMenu()
      menuItem('docx')!.focus()
      await key(document.activeElement, 'Escape')
      expect(menu()).toBeNull()
      expect(trigger()!.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(trigger())
    })

    it('closes on a press outside the control', async () => {
      await mount('workspace')
      await openMenu()
      await act(async () => {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      })
      await flush()
      expect(menu()).toBeNull()
    })

    it('closes when Tab leaves the menu', async () => {
      await mount('workspace')
      await openMenu()
      menuItem('docx')!.focus()
      await key(document.activeElement, 'Tab')
      expect(menu()).toBeNull()
    })
  })

  describe('the chips', () => {
    it('shows one chip per pick, after the other filters, in menu order', async () => {
      await mount('workspace')
      expect(chips()).toHaveLength(0)
      await chip('xlsx')
      await chip('docx')
      await chip('page')
      expect(chipKeys()).toEqual(['page', 'docx', 'xlsx'])
      expect(chips().map((el) => squash(el))).toEqual(['UniNote', '.docx', '.xlsx'])
      const bar = host.querySelector('.dh-filter-bar')!
      const group = bar.querySelector(':scope > .dh-filter-selects')!
      expect(group.nextElementSibling).toBe(bar.querySelector('.dh-filter-chips'))
    })

    it('gives each chip its badge and a real remove button named "Bỏ lọc .docx"', async () => {
      await mount('workspace')
      await chip('docx')
      const c = chips()[0]!
      expect(c.querySelector('img, svg')).not.toBeNull()
      const x = c.querySelector('button')!
      expect(x, 'remove button').not.toBeNull()
      expect(x.type).toBe('button')
      expect(x.getAttribute('aria-label')).toBe('Bỏ lọc .docx')
      // the x icon is decorative
      expect(x.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    })

    it('names the UniNote chip button "Bỏ lọc UniNote"', async () => {
      await mount('workspace')
      await chip('page')
      expect(chips()[0]!.querySelector('button')!.getAttribute('aria-label')).toBe('Bỏ lọc UniNote')
    })

    it('removes only its type and sends the rest', async () => {
      await mount('workspace')
      await chip('docx')
      await chip('xlsx')
      await chip('pdf')
      await click(chips()[1]!.querySelector('button'))
      expect(chipKeys()).toEqual(['docx', 'pdf'])
      expect(lastCall('uniworkListChildren').types).toEqual(['docx', 'pdf'])
      expect(checked()).toEqual(['docx', 'pdf'])
      expect(squash(trigger())).toBe('Loại: 2 loại')
    })

    it('puts focus on the Type trigger after a chip is removed', async () => {
      await mount('workspace')
      await chip('docx')
      await chip('xlsx')
      await key(trigger(), 'Escape')
      const x = chips()[0]!.querySelector('button')!
      x.focus()
      await click(x)
      expect(chipKeys()).toEqual(['xlsx'])
      expect(document.activeElement).toBe(trigger())
      // also for the last chip: the focus must not fall to the body
      const last = chips()[0]!.querySelector('button')!
      last.focus()
      await click(last)
      expect(chips()).toHaveLength(0)
      expect(document.activeElement).toBe(trigger())
    })
  })

  describe('the Type picks reach the title search (UNI-2113 fix1, T-R1-1)', () => {
    const typeIntoSearch = async (text: string) => {
      const input = host.querySelector<HTMLInputElement>('.dh-search-input')!
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await flush()
    }

    it('a pick set before the search is in the first search request', async () => {
      await mount('workspace')
      await chip('page')
      await typeIntoSearch('hop dong')
      expect(lastCall('uniworkSearchDocuments')).toEqual(
        expect.objectContaining({ workspaceId: 'ws-1', query: 'hop dong', types: ['page'] }),
      )
    })

    it('a pick made while a search is active searches again with it, in menu order', async () => {
      await mount('workspace')
      await typeIntoSearch('hop dong')
      expect(lastCall('uniworkSearchDocuments')).not.toHaveProperty('types')
      await chip('xlsx')
      await chip('page')
      expect(lastCall('uniworkSearchDocuments').types).toEqual(['page', 'xlsx'])
      // the search never carries the other filters (it is the title search)
      expect(lastCall('uniworkSearchDocuments')).not.toHaveProperty('updatedBy')
    })

    it('Load more of the search keeps the picks', async () => {
      api.uniworkSearchDocuments.mockResolvedValue(ok({ items, nextCursor: 'cur-2' }))
      await mount('workspace')
      await chip('docx')
      await typeIntoSearch('hop dong')
      await click(host.querySelector('.dh-load-more-row button'))
      expect(lastCall('uniworkSearchDocuments')).toEqual(
        expect.objectContaining({ cursor: 'cur-2', types: ['docx'] }),
      )
    })

    it('narrows search hits on documents and folders with Người sửa and Cập nhật, and keeps filters when clearing the query (UNI-2205)', async () => {
      const searchHits: DocumentsHomeDoc[] = [
        row({
          id: 'fold-minh',
          title: 'Hợp đồng Minh',
          kind: 'folder',
          format: null,
          updatedById: 'u-minh',
          updatedByName: 'Minh Trần',
          updatedAt: iso(2026, 10, 21, 9, 5),
        }),
        row({
          id: 'fold-lan-old',
          title: 'Hợp đồng Lan',
          kind: 'folder',
          format: null,
          updatedById: 'u-lan',
          updatedByName: 'Lan Nguyễn',
          updatedAt: iso(2026, 10, 1, 8, 0),
        }),
        row({
          id: 'hit-minh-today',
          title: 'Hợp đồng A.docx',
          updatedById: 'u-minh',
          updatedByName: 'Minh Trần',
          updatedAt: iso(2026, 10, 21, 9, 5),
        }),
        row({
          id: 'hit-lan-old',
          title: 'Hợp đồng B.xlsx',
          format: 'xlsx',
          updatedById: 'u-lan',
          updatedByName: 'Lan Nguyễn',
          updatedAt: iso(2026, 10, 1, 8, 0),
        }),
      ]
      api.uniworkSearchDocuments.mockResolvedValue(ok({ items: searchHits, nextCursor: null }))
      await mount('workspace')

      await typeIntoSearch('Hợp đồng')
      expect(
        Array.from(host.querySelectorAll('.dh-folder-card[data-folder-id]')).map((el) =>
          el.getAttribute('data-folder-id'),
        ),
      ).toEqual(['fold-lan-old', 'fold-minh'])
      expect(rowIds()).toEqual(expect.arrayContaining(['hit-minh-today', 'hit-lan-old']))

      // query + Người sửa narrows folders and documents
      await pick(select('updatedBy'), 'u-lan')
      expect(
        Array.from(host.querySelectorAll('.dh-folder-card[data-folder-id]')).map((el) =>
          el.getAttribute('data-folder-id'),
        ),
      ).toEqual(['fold-lan-old'])
      expect(rowIds()).toEqual(['hit-lan-old'])

      // query + Cập nhật narrows folders and documents (and shows search empty state when none match both)
      await pick(select('updatedFrom'), '24h')
      expect(host.querySelectorAll('.dh-folder-card[data-folder-id]')).toHaveLength(0)
      expect(rowIds()).toEqual([])
      expect(host.querySelector('.dl-state-title')?.textContent).toBe(
        'Không có kết quả cho “Hợp đồng”',
      )
      expect(host.querySelector('.dl-state-hint')?.textContent).toBe(
        'Không có tài liệu nào khớp bộ lọc.',
      )

      // relaxing Người sửa leaves only Cập nhật (24h) active on the search hits
      await pick(select('updatedBy'), 'u-minh')
      expect(
        Array.from(host.querySelectorAll('.dh-folder-card[data-folder-id]')).map((el) =>
          el.getAttribute('data-folder-id'),
        ),
      ).toEqual(['fold-minh'])
      expect(rowIds()).toEqual(['hit-minh-today'])
      // clearing the query keeps the filters on the normal list
      await click(host.querySelector('.dh-search-clear'))
      expect(host.querySelector<HTMLInputElement>('.dh-search-input')!.value).toBe('')
      expect(select('updatedBy')!.value).toBe('u-minh')
      expect(select('updatedFrom')!.value).toBe('24h')
      expect(lastCall('uniworkListChildren')).toEqual(
        expect.objectContaining({
          workspaceId: 'ws-1',
          updatedBy: 'u-minh',
          updatedFrom: expect.any(String),
        }),
      )
    })

    it('auto-loads the next search page when active filters hide page 1 hits, and merges authors from page 2 (KLF-1, KLF-4)', async () => {
      const { promise: page2Promise, resolve: resolvePage2 } =
        Promise.withResolvers<
          UniworkResult<{ items: DocumentsHomeDoc[]; nextCursor: string | null }>
        >()
      api.uniworkSearchDocuments.mockImplementation((q: { cursor?: string }) => {
        if (q.cursor === 'c2') {
          return page2Promise
        }
        return Promise.resolve(
          ok({
            items: [
              row({
                id: 'hit-minh-p1',
                title: 'Hợp đồng P1.docx',
                updatedById: 'u-minh',
                updatedByName: 'Minh Trần',
                updatedAt: iso(2026, 10, 21, 9, 5),
              }),
            ],
            nextCursor: 'c2',
          }),
        )
      })
      await mount('workspace')
      await pick(select('updatedBy'), 'u-lan')

      await typeIntoSearch('Hợp đồng')
      // Page 1 was filtered out while nextCursor is 'c2': auto-loads page 2 without showing the empty state
      expect(api.uniworkSearchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', query: 'Hợp đồng', cursor: 'c2' }),
      )
      expect(host.querySelector('.dl-state-title')).toBeNull()
      expect(host.querySelector('.uw-pick-skeleton')).not.toBeNull()

      await act(async () => {
        resolvePage2(
          ok({
            items: [
              row({
                id: 'hit-lan-p2',
                title: 'Hợp đồng P2.docx',
                updatedById: 'u-lan',
                updatedByName: 'Lan Nguyễn',
                updatedAt: iso(2026, 10, 21, 10, 0),
              }),
              row({
                id: 'hit-hoa-p2',
                title: 'Hợp đồng Hoa P2.docx',
                updatedById: 'u-hoa',
                updatedByName: 'Hoa Phạm',
                updatedAt: iso(2026, 10, 21, 10, 15),
              }),
            ],
            nextCursor: null,
          }),
        )
      })
      await flush()

      expect(host.querySelector('.dl-state-title')).toBeNull()
      expect(rowIds()).toEqual(['hit-lan-p2'])
      // Author seen only on search page 2 appears as a Người sửa option (KLF-4)
      const authorValues = Array.from(select('updatedBy')!.querySelectorAll('option')).map(
        (o) => o.value,
      )
      expect(authorValues).toContain('u-hoa')

      // Past the 10-page cap with more pages left: stops auto-loading and shows Tải thêm without the empty state
      let searchCalls = 0
      api.uniworkSearchDocuments.mockImplementation(async () => {
        searchCalls += 1
        return ok({
          items: [
            row({
              id: `hit-minh-cap-${searchCalls}`,
              title: `Hợp đồng Cap ${searchCalls}.docx`,
              updatedById: 'u-minh',
              updatedByName: 'Minh Trần',
              updatedAt: iso(2026, 10, 21, 9, 5),
            }),
          ],
          nextCursor: `cap-${searchCalls + 1}`,
        })
      })
      await typeIntoSearch('Hợp đồng Cap')
      for (let i = 0; i < 12; i++) {
        await flush()
      }
      expect(searchCalls).toBe(10)
      expect(host.querySelector('.dl-state-title')).toBeNull()
      expect(host.querySelector('.dh-load-more-row button')).not.toBeNull()

      // Clicking Tải thêm past the 10-page cap loads page 11 manually without restarting auto-load (KLF-9)
      api.uniworkSearchDocuments.mockImplementationOnce(async () => {
        searchCalls += 1
        return ok({
          items: [
            row({
              id: 'hit-lan-p11',
              title: 'Hợp đồng Cap 11.docx',
              updatedById: 'u-lan',
              updatedByName: 'Lan Nguyễn',
              updatedAt: iso(2026, 10, 21, 10, 30),
            }),
          ],
          nextCursor: 'cap-12',
        })
      })
      await click(host.querySelector('.dh-load-more-row button'))
      expect(searchCalls).toBe(11)
      expect(rowIds()).toEqual(['hit-lan-p11'])
    })

    it('scopes a query on Gần đây to the Recent list client-side without calling searchDocuments, auto-fetches page 2, and combines with Đã sửa (KLV-6)', async () => {
      api.uniworkFolderTree.mockResolvedValue(
        ok([
          {
            id: 'f-contracts',
            parentId: null,
            title: 'Thư mục Hợp đồng',
            position: 0,
            kind: 'folder' as const,
            isSystem: false,
            children: [],
          },
        ]),
      )
      api.uniworkSearchDocuments.mockResolvedValue(
        ok({
          items: [
            row({
              id: 'ws-only-hit',
              title: 'Đánh giá ngoài Gần đây.docx',
            }),
          ],
          nextCursor: null,
        }),
      )
      api.uniworkListDocuments.mockImplementation(
        async (q: { cursor?: string; activity?: string }) => {
          if (q.activity === 'edited') {
            return ok({
              documents: [
                row({
                  id: 'rec-edited',
                  title: 'Báo cáo Đánh giá Quý 4.docx',
                  parentId: 'f-contracts',
                  lastActivity: { kind: 'edited', at: iso(2026, 10, 21, 9, 0) },
                }),
              ],
              nextCursor: null,
            })
          }
          if (q.cursor === 'rec-c2') {
            return ok({
              documents: [
                row({
                  id: 'rec-p2-opened',
                  title: 'Đề xuất Đánh giá Nhân sự.docx',
                  parentId: null,
                  lastActivity: { kind: 'opened', at: iso(2026, 10, 20, 14, 0) },
                }),
                row({
                  id: 'rec-p2-edited',
                  title: 'Báo cáo Đánh giá Quý 4.docx',
                  parentId: 'f-contracts',
                  lastActivity: { kind: 'edited', at: iso(2026, 10, 21, 9, 0) },
                }),
              ],
              nextCursor: null,
            })
          }
          return ok({
            documents: [
              row({
                id: 'rec-p1-other',
                title: 'Ngân sách năm.xlsx',
                lastActivity: { kind: 'opened', at: iso(2026, 10, 21, 10, 0) },
              }),
            ],
            nextCursor: 'rec-c2',
          })
        },
      )

      await mount('recent')
      expect(api.uniworkSearchDocuments).not.toHaveBeenCalled()

      // Diacritic-, đ/Đ-, and case-insensitive query on Gần đây does not refetch page 1 (KLF-7, KLF-9)
      await typeIntoSearch('ĐÁNH GIÁ')
      expect(api.uniworkSearchDocuments).not.toHaveBeenCalled()
      expect(
        api.uniworkListDocuments.mock.calls.filter(([arg]: [{ cursor?: string }]) => !arg.cursor),
      ).toHaveLength(1)
      expect(api.uniworkListDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', cursor: 'rec-c2' }),
      )
      // Workspace-only search hit does not appear; page 2 Recent matches appear
      expect(rowIds()).toEqual(['rec-p2-edited', 'rec-p2-opened'])
      expect(rowIds()).not.toContain('ws-only-hit')
      // The "where" subline stays as on Recent today
      expect(host.querySelector('[data-doc-id="rec-p2-edited"] .dh-doc-subpath')?.textContent).toBe(
        'Thư mục Hợp đồng',
      )
      expect(host.querySelector('[data-doc-id="rec-p2-opened"] .dh-doc-subpath')?.textContent).toBe(
        'Tài liệu (gốc)',
      )

      // Đã sửa segment + query narrows to edited Recent matches
      await click(host.querySelector('[data-seg="edited"]'))
      expect(api.uniworkSearchDocuments).not.toHaveBeenCalled()
      expect(lastCall('uniworkListDocuments')).toEqual(
        expect.objectContaining({ workspaceId: 'ws-1', activity: 'edited' }),
      )
      expect(rowIds()).toEqual(['rec-edited'])
    })

    it('scopes a query on Được chia sẻ với tôi to the Shared-with-me list client-side without calling searchDocuments, omits own and workspace-only hits, auto-fetches page 2, and keeps the workspace subline (KLV-9)', async () => {
      api.uniworkSearchDocuments.mockResolvedValue(
        ok({
          items: [
            row({
              id: 'own-hit',
              title: 'Đánh giá cá nhân.docx',
            }),
            row({
              id: 'ws-only-hit',
              title: 'Đánh giá nội bộ workspace.docx',
            }),
          ],
          nextCursor: null,
        }),
      )
      api.uniworkListSharedWithMe.mockImplementation(async (q: { cursor?: string }) => {
        if (q.cursor === 'swm-c2') {
          return ok({
            documents: [
              row({
                id: 'swm-p2-hit',
                workspaceId: 'ws-2',
                workspaceName: 'Phòng Tài chính',
                title: 'Báo cáo Đánh giá Đối tác.docx',
                shared: { byName: 'Hải Lê', at: iso(2026, 10, 21, 9, 0) },
              }),
            ],
            nextCursor: null,
          })
        }
        return ok({
          documents: [
            row({
              id: 'swm-p1-other',
              workspaceId: 'ws-2',
              workspaceName: 'Phòng Tài chính',
              title: 'Biên bản họp.docx',
              shared: { byName: 'Lan Nguyễn', at: iso(2026, 10, 21, 10, 0) },
            }),
          ],
          nextCursor: 'swm-c2',
        })
      })

      await mount('shared-with-me')
      expect(api.uniworkSearchDocuments).not.toHaveBeenCalled()

      await typeIntoSearch('ĐÁNH GIÁ')
      expect(api.uniworkSearchDocuments).not.toHaveBeenCalled()
      expect(
        api.uniworkListSharedWithMe.mock.calls.filter(
          ([arg]: [{ cursor?: string }]) => !arg.cursor,
        ),
      ).toHaveLength(1)
      expect(api.uniworkListSharedWithMe).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: 'swm-c2', includePages: true }),
      )
      // Own and workspace-only search hits do not appear; page-2 shared row shows
      expect(rowIds()).toEqual(['swm-p2-hit'])
      expect(rowIds()).not.toContain('own-hit')
      expect(rowIds()).not.toContain('ws-only-hit')
      // Its "where" line (workspace name) stays
      expect(host.querySelector('[data-doc-id="swm-p2-hit"] .dh-doc-subpath')?.textContent).toBe(
        'Phòng Tài chính',
      )
    })

    it('does not duplicate-append page 2 when typing a query on Recent or changing a filter during a search, and hides empty state while refetching (KLF-5, KLF-6, KLF-7, KLF-9)', async () => {
      type RecentRes = UniworkResult<{ documents: DocumentsHomeDoc[]; nextCursor: string | null }>
      const pendingPage1: Array<(res: RecentRes) => void> = []
      const pendingPage2: Array<(res: RecentRes) => void> = []
      let initialMount = true
      api.uniworkListDocuments.mockImplementation((q: { cursor?: string }) => {
        if (q.cursor === 'rec-c2') {
          const { promise, resolve } = Promise.withResolvers<RecentRes>()
          pendingPage2.push(resolve)
          return promise
        }
        if (initialMount) {
          initialMount = false
          return Promise.resolve(
            ok({
              documents: [
                row({
                  id: 'rec-p1-other',
                  title: 'Ngân sách năm.xlsx',
                  lastActivity: { kind: 'opened', at: iso(2026, 10, 21, 10, 0) },
                }),
              ],
              nextCursor: 'rec-c2',
            }),
          )
        }
        const { promise, resolve } = Promise.withResolvers<RecentRes>()
        pendingPage1.push(resolve)
        return promise
      })

      await mount('recent')

      const input = host.querySelector<HTMLInputElement>('.dh-search-input')!
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, 'Đánh giá')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })

      // No page-1 refetch on Recent keystroke (KLF-7)
      expect(pendingPage1).toHaveLength(0)

      for (const resolveP2 of pendingPage2.splice(0)) {
        await act(async () => {
          resolveP2(
            ok({
              documents: [
                row({
                  id: 'rec-p2-hit',
                  title: 'Báo cáo Đánh giá Quý 4.docx',
                  lastActivity: { kind: 'edited', at: iso(2026, 10, 21, 9, 0) },
                }),
              ],
              nextCursor: null,
            }),
          )
        })
      }
      await flush()

      const page2Calls = api.uniworkListDocuments.mock.calls.filter(
        ([arg]: [{ cursor?: string }]) => arg.cursor === 'rec-c2',
      )
      expect(rowIds()).toEqual(['rec-p2-hit'])
      expect(page2Calls).toHaveLength(1)

      // Switching segment to Đã sửa while searching triggers a page-1 refetch (with kept non-matching rows):
      // must show skeleton instead of empty state while loading (KLF-6), and when page 1 lands with nextCursor,
      // a failed page-2 auto-load stops on moreError until Tải thêm retries (KLF-9)
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, 'Không khớp')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        host.querySelector<HTMLElement>('[data-seg="edited"]')!.click()
      })
      expect(pendingPage1).toHaveLength(1)
      expect(host.querySelector('.dl-state-title')).toBeNull()
      expect(host.querySelector('.uw-pick-skeleton')).not.toBeNull()

      let failEdPage2 = true
      api.uniworkListDocuments.mockImplementation(async (q: { cursor?: string }) => {
        if (q.cursor === 'rec-ed-c2') {
          if (failEdPage2) {
            failEdPage2 = false
            return { ok: false, error: 'server_error' as const }
          }
          return ok({
            documents: [
              row({
                id: 'rec-ed-p2',
                title: 'Không khớp nhưng có ở trang 2.docx',
                lastActivity: { kind: 'edited', at: iso(2026, 10, 21, 11, 0) },
              }),
            ],
            nextCursor: null,
          })
        }
        return ok({ documents: [], nextCursor: null })
      })
      await act(async () => {
        pendingPage1.shift()!(
          ok({
            documents: [
              row({
                id: 'rec-ed-p1-miss',
                title: 'Tài liệu khác.docx',
                lastActivity: { kind: 'edited', at: iso(2026, 10, 21, 8, 0) },
              }),
            ],
            nextCursor: 'rec-ed-c2',
          }),
        )
      })
      await flush()

      // Auto-load stopped on moreError; error alert and Tải thêm button are rendered
      expect(host.querySelector('.uw-pick-more-error')).not.toBeNull()
      const edPage2CallsAfterFail = api.uniworkListDocuments.mock.calls.filter(
        ([arg]: [{ cursor?: string }]) => arg.cursor === 'rec-ed-c2',
      )
      expect(edPage2CallsAfterFail).toHaveLength(1)

      // Clicking Tải thêm retries and renders the match
      await click(host.querySelector('.dh-load-more-row button'))
      expect(host.querySelector('.uw-pick-more-error')).toBeNull()
      expect(rowIds()).toEqual(['rec-ed-p2'])

      // On workspace search with nextCursor, changing query + filter in the same commit must not call loadMore with the old cursor (KLF-5)
      await remount('workspace')
      type SearchRes = UniworkResult<{ items: DocumentsHomeDoc[]; nextCursor: string | null }>
      const pendingSearchP1: Array<(res: SearchRes) => void> = []
      const pendingSearchP2: Array<(res: SearchRes) => void> = []
      let firstSearch = true
      api.uniworkSearchDocuments.mockImplementation((q: { cursor?: string }) => {
        if (q.cursor === 'ws-c2') {
          const { promise, resolve } = Promise.withResolvers<SearchRes>()
          pendingSearchP2.push(resolve)
          return promise
        }
        if (firstSearch) {
          firstSearch = false
          return Promise.resolve(
            ok({
              items: [
                row({
                  id: 'ws-p1-lan',
                  title: 'Hợp đồng 1.docx',
                  updatedById: 'u-lan',
                  updatedByName: 'Lan Nguyễn',
                }),
              ],
              nextCursor: 'ws-c2',
            }),
          )
        }
        const { promise, resolve } = Promise.withResolvers<SearchRes>()
        pendingSearchP1.push(resolve)
        return promise
      })
      await pick(select('updatedBy'), 'u-lan')
      await typeIntoSearch('Hợp đồng')
      expect(rowIds()).toEqual(['ws-p1-lan'])
      expect(pendingSearchP2).toHaveLength(0)

      // Pick u-minh while search is active: wireFilters changes (triggers search refetch) and visible rows drop to 0 in the same commit
      await act(async () => {
        const bySelect = select('updatedBy')!
        bySelect.value = 'u-minh'
        bySelect.dispatchEvent(new Event('change', { bubbles: true }))
      })
      // Must not have requested ws-c2 from the stale pre-reset page while refetch is pending, and must show skeleton instead of empty state (KLF-5, KLF-6)
      expect(pendingSearchP1).toHaveLength(1)
      expect(pendingSearchP2).toHaveLength(0)
      expect(host.querySelector('.dl-state-title')).toBeNull()
      expect(host.querySelector('.uw-pick-skeleton')).not.toBeNull()

      await act(async () => {
        pendingSearchP1.shift()!(
          ok({
            items: [
              row({
                id: 'ws-p1-lan-new',
                title: 'Hợp đồng mới 1.docx',
                updatedById: 'u-lan',
                updatedByName: 'Lan Nguyễn',
              }),
            ],
            nextCursor: 'ws-c2',
          }),
        )
      })
      await flush()
      expect(pendingSearchP2).toHaveLength(1)
      await act(async () => {
        pendingSearchP2.shift()!(
          ok({
            items: [
              row({
                id: 'ws-p2-minh-new',
                title: 'Hợp đồng mới 2.docx',
                updatedById: 'u-minh',
                updatedByName: 'Minh Trần',
              }),
            ],
            nextCursor: null,
          }),
        )
      })
      await flush()
      expect(
        api.uniworkSearchDocuments.mock.calls.filter(
          ([arg]: [{ cursor?: string }]) => arg.cursor === 'ws-c2',
        ),
      ).toHaveLength(1)
      expect(rowIds()).toEqual(['ws-p2-minh-new'])
    })
  })

  describe('the Q0 switch moves the folder cards too (UNI-2113 fix1, T-R1-2)', () => {
    const FOLDER_CARD = '.dh-folder-card[data-folder-id]'
    const cardIds = () =>
      Array.from(host.querySelectorAll(FOLDER_CARD)).map((el) => el.getAttribute('data-folder-id'))
    beforeEach(() => {
      items.push(row({ id: 'fold-x', title: 'Hồ sơ', kind: 'folder', format: null }))
    })
    afterEach(() => {
      q0.hidesFolders = false
    })

    it('ships with the switch off: a pick keeps the folder cards of every list', async () => {
      for (const subView of ['workspace', 'recent', 'trash'] as const) {
        await remount(subView)
        await chip('docx')
        expect(cardIds(), subView).toEqual(['fold-x'])
      }
    })

    it.each(['recent', 'shared-with-me', 'trash'] as const)(
      'with the switch on, %s drops the folder cards under a pick and brings them back',
      async (subView) => {
        q0.hidesFolders = true
        await remount(subView)
        expect(cardIds()).toEqual(['fold-x'])
        await chip('docx')
        expect(cardIds()).toEqual([])
        expect(host.querySelector('.dh-folders-section')).toBeNull()
        await chip('docx')
        expect(cardIds()).toEqual(['fold-x'])
      },
    )

    it('with the switch on, the tree level keeps its folder cards under a pick', async () => {
      q0.hidesFolders = true
      await remount('workspace')
      await chip('docx')
      expect(cardIds()).toEqual(['fold-x'])
    })
  })

  describe('the Type control details (UNI-2113 fix1, T-R1-3 / T-R1-4a)', () => {
    it('choosing All types while nothing is picked reads the list again nowhere', async () => {
      await mount('workspace')
      const before = api.uniworkListChildren.mock.calls.length
      await chip('all')
      expect(api.uniworkListChildren.mock.calls.length).toBe(before)
      expect(checked()).toEqual(['all'])
    })

    it('choosing All types after a pick still clears it and reads once', async () => {
      await mount('workspace')
      await chip('docx')
      const before = api.uniworkListChildren.mock.calls.length
      await chip('all')
      expect(api.uniworkListChildren.mock.calls.length).toBe(before + 1)
      expect(lastCall('uniworkListChildren').types).toBeUndefined()
    })

    it.each([
      ['vi', 'Loại'],
      ['en', 'Type'],
    ] as const)('the chip group is named from the Type label (%s)', async (lang, name) => {
      await act(async () => {
        root.unmount()
      })
      root = createRoot(host)
      await mount('workspace', lang)
      await chip('docx')
      const group = host.querySelector('.dh-filter-bar .dh-filter-chips')!
      expect(group.getAttribute('role')).toBe('group')
      expect(group.getAttribute('aria-label')).toBe(name)
      // the same name the menu carries
      expect(menu()!.getAttribute('aria-label')).toBe(name)
    })
  })

  describe('paging and per-screen state', () => {
    it('starts again from the first page when a filter changes', async () => {
      api.uniworkListDocuments!.mockImplementation(async (q: { cursor?: string }) =>
        q.cursor
          ? ok({ documents: [row({ id: 'doc-late' })], nextCursor: null })
          : ok({ documents: items.slice(0, 2), nextCursor: 'c-2' }),
      )
      await mount('recent')
      await click(host.querySelector('button.uw-pick-more'))
      expect(lastCall('uniworkListDocuments').cursor).toBe('c-2')
      expect(rowIds()).toContain('doc-late')
      await chip('docx')
      const q = lastCall('uniworkListDocuments')
      expect(q.cursor).toBeUndefined()
      expect(q.types).toEqual(['docx'])
      // the page of the old filter is gone with it
      expect(rowIds()).not.toContain('doc-late')
    })

    it('remembers a screen filter on that screen only', async () => {
      await mount('workspace')
      await chip('xlsx')
      await chip('docx')
      await pick(select('updatedBy'), 'u-lan')
      await goTo('recent')
      expect(squash(trigger())).toBe('Loại: Tất cả')
      expect(chips()).toHaveLength(0)
      expect(select('updatedBy')!.value).toBe('')
      expect(lastCall('uniworkListDocuments')).not.toHaveProperty('types')
      await chip('pdf')
      await goTo('workspace')
      expect(chipKeys()).toEqual(['docx', 'xlsx'])
      expect(select('updatedBy')!.value).toBe('u-lan')
      expect(lastCall('uniworkListChildren')).toEqual(
        expect.objectContaining({ types: ['docx', 'xlsx'], updatedBy: 'u-lan' }),
      )
      await goTo('recent')
      expect(chipKeys()).toEqual(['pdf'])
    })

    it('holds Người sửa and Cập nhật in one group right after the Type control (N-04)', async () => {
      await mount('workspace')
      const bar = host.querySelector('.dh-filter-bar')!
      const group = bar.querySelector(':scope > .dh-filter-selects')
      expect(group, 'select pair group').not.toBeNull()
      expect(Array.from(group!.children).map((el) => [el.tagName, el.className])).toEqual([
        ['LABEL', 'dh-filter-chip'],
        ['LABEL', 'dh-filter-chip'],
      ])
      expect(
        Array.from(group!.querySelectorAll('select')).map((el) => el.getAttribute('data-filter')),
      ).toEqual(['updatedBy', 'updatedFrom'])
      // the pair never splits across the row: nothing else in the bar is a select chip
      expect(bar.querySelectorAll(':scope > .dh-filter-chip')).toHaveLength(0)
      expect(group!.previousElementSibling!.className).toContain('dh-type-filter')
    })

    it('keeps the clear button after the chips (N-04)', async () => {
      await mount('workspace')
      await chip('docx')
      const bar = host.querySelector('.dh-filter-bar')!
      const kids = Array.from(bar.children).map((el) => el.className.split(' ')[0])
      expect(kids[kids.length - 1]).toBe('dh-filter-clear')
    })

    it('clears a screen filters with the clear button', async () => {
      await mount('workspace')
      await chip('docx')
      await click(host.querySelector('.dh-filter-clear'))
      expect(checked()).toEqual(['all'])
      expect(chips()).toHaveLength(0)
      expect(lastCall('uniworkListChildren')).not.toHaveProperty('types')
      expect(host.querySelector('.dh-filter-clear')).toBeNull()
    })
  })
})

// the local files (Thiết bị) filter: .txt is its own filter and md stops covering it
describe('the local Home filter splits .md from .txt (UNI-2047 A3)', () => {
  const home = readFileSync(join(__dirname, '../src/renderer/src/Home.tsx'), 'utf8')
  const main = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')

  it('lists the filters in the shared order, .txt last', () => {
    const block = /const FILTERS:[^=]*=\s*\[([\s\S]*?)\n\]/.exec(home)?.[1] ?? ''
    expect([...block.matchAll(/key: '([a-z]+)'/g)].map((m) => m[1])).toEqual([
      'all',
      'docx',
      'xlsx',
      'pptx',
      'pdf',
      'md',
      'html',
      'txt',
    ])
  })

  it('gives .md and .txt separate families in Home, the sidebar and the search', () => {
    const family = (src: string, name: string, key: string) => {
      const table = new RegExp(`${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1] ?? ''
      const line = new RegExp(`\\b${key}: \\[([^\\]]*)\\]`).exec(table)?.[1]
      return line === undefined ? null : [...line.matchAll(/'([a-z]+)'/g)].map((m) => m[1])
    }
    for (const [src, name] of [
      [home, 'FILTER_FAMILY'],
      [main, 'SEARCH_EXT_FAMILY'],
    ] as const) {
      expect(family(src, name, 'md'), `${name}.md`).toEqual(['md', 'markdown'])
      // a single extension needs no family entry at all, or exactly itself
      const txt = family(src, name, 'txt')
      expect(txt === null || (txt.length === 1 && txt[0] === 'txt'), `${name}.txt`).toBe(true)
    }
  })

  it('matches .txt under .txt and no longer under .md in the sidebar lists', () => {
    expect(matchesExtFamily('txt', 'txt')).toBe(true)
    expect(matchesExtFamily('txt', 'md')).toBe(false)
    expect(matchesExtFamily('md', 'md')).toBe(true)
    expect(matchesExtFamily('markdown', 'md')).toBe(true)
    expect(matchesExtFamily('md', 'txt')).toBe(false)
  })
})

describe('documents-home.css: the toolbar search wrap and the filter lists (UNI-2205 fix7)', () => {
  const css = readFileSync(
    join(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
    'utf8',
  )

  it('ends the single-row toolbar at 1281px and, at 1280px, keeps the actions on row one above the search box', () => {
    expect(css).toMatch(
      /@media \(min-width: 1281px\)\s*\{\s*\.dh-toolbar\s*\{\s*flex-wrap:\s*nowrap;/,
    )
    // the two rules meet without a gap or an overlap: max-width N and min-width N + 1
    const single =
      /@media \(min-width: (\d+)px\)\s*\{\s*\.dh-toolbar\s*\{\s*flex-wrap:\s*nowrap;/.exec(css)
    const wrap =
      /@media \(max-width: (\d+)px\)\s*\{\s*\.dh-toolbar:not\(\.dh-toolbar-folder\) > \.dh-toolbar-spacer/.exec(
        css,
      )
    expect(single, 'single-row rule').not.toBeNull()
    expect(wrap, 'wrap rule').not.toBeNull()
    expect(Number(single![1])).toBe(Number(wrap![1]) + 1)
    const block = searchWrapBlock(css)
    expect(block).toMatch(/> \.dh-toolbar-spacer\s*\{[^}]*display:\s*none;/)
    expect(block).toMatch(
      /> \.dh-search-box\s*\{[^}]*margin-inline-end:\s*max\(0px, calc\(100% - var\(--dh-search-box-width\)\)\);/,
    )
    // the box is ordered after every other toolbar item (all at the default order 0), so the
    // title, the select and the right-aligned actions come first in the visual order and the box
    // is last, on its own row
    expect(block).toMatch(/> \.dh-search-box\s*\{[^}]*\border:\s*1;/)
    expect(block.match(/\border:/g)).toHaveLength(1)
    const actions = css.match(/(?:^|\})\s*\.dh-toolbar-actions\s*\{([^}]*)\}/m)
    expect(actions, '.dh-toolbar-actions rule').not.toBeNull()
    expect(actions![1]).not.toMatch(/\border:/)
    expect(actions![1]).toMatch(/margin-inline-start:\s*auto;/)
    // no row-gap override: a select that wraps keeps the normal toolbar gap
    expect(block).not.toMatch(/row-gap/)
  })

  it('themes the options of a filter chip list with the surface and text tokens', () => {
    const rule = css.match(/\.dh-filter-select option\s*\{([^}]*)\}/)
    expect(rule, '.dh-filter-select option rule').not.toBeNull()
    expect(rule![1]).toMatch(/background-color:\s*var\(--surface\);/)
    expect(rule![1]).toMatch(/color:\s*var\(--text\);/)
  })
})
