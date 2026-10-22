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
        ).toEqual(['updatedBy', 'updatedFrom'])
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

    it('keeps Lưu trữ bởi on the shelf next to the shared bar', async () => {
      await mount('archive')
      expect(host.querySelector('.dh-shelved-head select[data-filter="shelvedBy"]')).not.toBeNull()
      // one type control only
      expect(host.querySelectorAll('.dh-filter-bar button[data-filter="type"]')).toHaveLength(1)
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
