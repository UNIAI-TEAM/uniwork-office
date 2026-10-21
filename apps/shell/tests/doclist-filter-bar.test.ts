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
  parent: { kind: 'chat', title: 'Kế toán' },
} as unknown as UniworkSourceFile

const CHIPS = [
  ['all', 'Mọi loại'],
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

  async function mount(subView: DocumentsHomeSubViewId = 'workspace') {
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
  const goTo = (id: string) =>
    click(sidebarSlot.querySelector(`.nav-item[data-nav="${id}"]`))
  const chip = (key: string) =>
    host.querySelector<HTMLButtonElement>(`.dh-filter-bar [data-chip="${key}"]`)
  const pressed = () =>
    Array.from(host.querySelectorAll('.dh-filter-bar [data-chip][aria-pressed="true"]')).map((el) =>
      el.getAttribute('data-chip'),
    )
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

  describe('chips per screen', () => {
    it.each(SCREENS)('%s shows the same chips in the same order, then Người sửa and Cập nhật', async (subView) => {
      await remount(subView)
      const bar = host.querySelector('.dh-filter-bar')
      expect(bar, 'filter bar').not.toBeNull()
      const chips = Array.from(bar!.querySelectorAll('[data-chip]'))
      expect(chips.map((el) => [el.getAttribute('data-chip'), el.textContent?.trim()])).toEqual(
        CHIPS.map(([key, label]) => [key, label]),
      )
      expect(chips.every((el) => el.tagName === 'BUTTON')).toBe(true)
      // Mọi loại is on until a type is picked
      expect(pressed()).toEqual(['all'])
      expect(
        Array.from(bar!.querySelectorAll('select')).map((el) => el.getAttribute('data-filter')),
      ).toEqual(['updatedBy', 'updatedFrom'])
      // the old inline type select, Truy cập and Nhóm theo are not part of the bar
      expect(bar!.querySelector('select[data-filter="format"]')).toBeNull()
      expect(bar!.querySelector('select[data-filter="groupBy"]')).toBeNull()
      expect(bar!.querySelector('select[data-filter="access"]')).toBeNull()
    })

    it('has Người sửa and Cập nhật labelled in Vietnamese', async () => {
      await mount('workspace')
      const labels = Array.from(host.querySelectorAll('.dh-filter-bar .dh-filter-k')).map((el) =>
        el.textContent?.trim(),
      )
      expect(labels).toEqual(['Người sửa:', 'Cập nhật:'])
    })

    it('keeps Lưu trữ bởi on the shelf next to the shared bar', async () => {
      await mount('archive')
      expect(host.querySelector('.dh-shelved-head select[data-filter="shelvedBy"]')).not.toBeNull()
      // one type control only
      expect(host.querySelectorAll('[data-chip="docx"]')).toHaveLength(1)
    })
  })

  describe('parameters sent', () => {
    it.each(SCREENS)('%s sends the picked type through the list call', async (subView, fn) => {
      await remount(subView)
      await click(chip('xlsx'))
      expect(lastCall(fn).format).toBe('xlsx')
      expect(pressed()).toEqual(['xlsx'])
      await click(chip('txt'))
      expect(lastCall(fn).format).toBe('txt')
      expect(pressed()).toEqual(['txt'])
      await click(chip('all'))
      expect(lastCall(fn).format).toBeUndefined()
      expect(pressed()).toEqual(['all'])
    })

    it('forwards the type, editor and date filters to Shared with me (they were dropped before)', async () => {
      await mount('shared-with-me')
      await click(chip('pdf'))
      await pick(select('updatedBy'), 'u-minh')
      await pick(select('updatedFrom'), '7d')
      expect(lastCall('uniworkListSharedWithMe')).toEqual(
        expect.objectContaining({
          includePages: true,
          format: 'pdf',
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

    it('does not send a type for UniNote: the pages are picked from what is loaded', async () => {
      await mount('workspace')
      await click(chip('page'))
      expect(lastCall('uniworkListChildren').format).toBeUndefined()
      expect(pressed()).toEqual(['page'])
      expect(rowIds()).toEqual(['page-c'])
      await click(chip('all'))
      expect(rowIds()).toEqual(expect.arrayContaining(['doc-a', 'doc-b', 'page-c']))
    })

    it('hides the other-source files under UniNote and keeps them under .pdf', async () => {
      sources = [SOURCE]
      await mount('workspace')
      expect(host.textContent).toContain('Bảng giá.pdf')
      await click(chip('page'))
      expect(host.textContent).not.toContain('Bảng giá.pdf')
      await click(chip('pdf'))
      expect(lastCall('uniworkListSources')).toEqual({ workspaceId: 'ws-1', type: 'pdf' })
      expect(host.textContent).toContain('Bảng giá.pdf')
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
      await click(chip('docx'))
      const q = lastCall('uniworkListDocuments')
      expect(q.cursor).toBeUndefined()
      expect(q.format).toBe('docx')
      // the page of the old filter is gone with it
      expect(rowIds()).not.toContain('doc-late')
    })

    it('remembers a screen filter on that screen only', async () => {
      await mount('workspace')
      await click(chip('xlsx'))
      await pick(select('updatedBy'), 'u-lan')
      await goTo('recent')
      expect(pressed()).toEqual(['all'])
      expect(select('updatedBy')!.value).toBe('')
      expect(lastCall('uniworkListDocuments').format).toBeUndefined()
      await click(chip('pdf'))
      await goTo('workspace')
      expect(pressed()).toEqual(['xlsx'])
      expect(select('updatedBy')!.value).toBe('u-lan')
      expect(lastCall('uniworkListChildren')).toEqual(
        expect.objectContaining({ format: 'xlsx', updatedBy: 'u-lan' }),
      )
      await goTo('recent')
      expect(pressed()).toEqual(['pdf'])
    })

    it('clears a screen filters with the clear button', async () => {
      await mount('workspace')
      await click(chip('docx'))
      await click(host.querySelector('.dh-filter-clear'))
      expect(pressed()).toEqual(['all'])
      expect(lastCall('uniworkListChildren').format).toBeUndefined()
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
