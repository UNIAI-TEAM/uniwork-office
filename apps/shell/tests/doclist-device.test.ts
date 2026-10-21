/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderEntry, RecentEntry } from '../src/shared/home-api'
import { LocaleProvider, type TFunc } from '../src/renderer/src/locale'
import { DocList, type DocListProps } from '../src/renderer/src/doclist/DocList'
import {
  deviceFileDoc,
  deviceFolderDoc,
  deviceRows,
} from '../src/renderer/src/doclist/device-model'
import {
  deviceFileMenu,
  deviceFolderMenu,
  type DeviceFileMenuInput,
  type DeviceMenuHandlers,
} from '../src/renderer/src/doclist/device-menu'
import type { SortSpec } from '../src/renderer/src/doclist/columns'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

// 2026-10-21 12:00 local; every date below is relative to it
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const at = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0).getTime()

const file = (name: string, mtimeMs: number, sizeBytes: number, extra: Partial<RecentEntry> = {}) =>
  ({
    path: `/Users/linh/Documents/${name}`,
    name,
    ext: name.split('.').pop() ?? '',
    mtimeMs,
    sizeBytes,
    starred: false,
    ...extra,
  }) satisfies RecentEntry

const folder = (name: string, mtimeMs: number): FolderEntry => ({
  path: `/Users/linh/Documents/${name}`,
  name,
  mtimeMs,
  hasSubfolders: false,
})

describe('the device list rows (UNI-2047 B1)', () => {
  it('maps a local file onto the shared row: path as id, name as title, mtime and size', () => {
    const doc = deviceFileDoc(file('Budget.xlsx', at(2026, 10, 21, 9, 5), 5_033_165))
    expect(doc).toMatchObject({
      id: '/Users/linh/Documents/Budget.xlsx',
      title: 'Budget.xlsx',
      format: 'xlsx',
      kind: 'file',
      sizeBytes: 5_033_165,
    })
    expect(new Date(doc.updatedAt).getTime()).toBe(at(2026, 10, 21, 9, 5))
  })

  it('keeps an extension the app has no format for as the title extension (neutral badge)', () => {
    const doc = deviceFileDoc(file('data.json', at(2026, 10, 21, 9, 5), 12))
    expect(doc.format).toBeNull()
    expect(doc.title).toBe('data.json')
  })

  it('gives a missing file no time and no size, and a UniWork working copy no time', () => {
    const gone = deviceFileDoc(file('Gone.docx', 0, 0, { missing: true }))
    expect(gone.updatedAt).toBe('')
    expect(gone.sizeBytes).toBeUndefined()
    const uw = deviceFileDoc(
      file('Contract.docx', at(2026, 10, 21, 9, 5), 3_000, {
        uniwork: { documentId: 'doc-1', workspaceId: 'ws-1', title: 'Contract', access: 'edit' },
      }),
    )
    // its file time is the download time, not the document's
    expect(uw.updatedAt).toBe('')
  })

  it('maps a sub-folder to a folder row with its mtime and no size', () => {
    const doc = deviceFolderDoc(folder('Finance', at(2026, 10, 1, 8, 0)))
    expect(doc).toMatchObject({
      id: '/Users/linh/Documents/Finance',
      title: 'Finance',
      kind: 'folder',
    })
    expect(doc.sizeBytes).toBeUndefined()
    expect(new Date(doc.updatedAt).getTime()).toBe(at(2026, 10, 1, 8, 0))
  })

  it('lists sub-folders before files as table rows of type doc', () => {
    const rows = deviceRows(
      [folder('Finance', at(2026, 10, 1, 8, 0))],
      [file('Budget.xlsx', at(2026, 10, 21, 9, 5), 100)],
    )
    expect(rows.map((r) => [r.type, r.id])).toEqual([
      ['doc', '/Users/linh/Documents/Finance'],
      ['doc', '/Users/linh/Documents/Budget.xlsx'],
    ])
  })
})

describe('the device row menus (UNI-2047 B1)', () => {
  const t = ((key: string, params?: Record<string, string>) =>
    params?.name ? `${key}:${params.name}` : key) as unknown as TFunc
  const noop = () => {}
  const handlers: DeviceMenuHandlers = {
    open: noop,
    toggleOffline: noop,
    reveal: noop,
    copyPath: noop,
    move: noop,
    moveToProject: noop,
    rename: noop,
    duplicate: noop,
    group: noop,
    removeFromList: noop,
    unstar: noop,
    deleteFiles: noop,
    openFolder: noop,
    renameFolder: noop,
    moveFolder: noop,
    revealFolder: noop,
    deleteFolder: noop,
  }
  const base: DeviceFileMenuInput = {
    context: 'global',
    view: 'recent',
    starred: false,
    offlineLabel: null,
    showLocation: true,
    fileActions: true,
    canMove: true,
    editable: true,
    missing: false,
    otherProjects: [],
    canDelete: true,
  }
  const ids = (input: Partial<DeviceFileMenuInput>) =>
    deviceFileMenu({ ...base, ...input }, handlers, t).map((item) => item.id)

  it('orders a local file: Open, machine items | Move | Rename, Copy | Remove from list, Delete files', () => {
    const items = deviceFileMenu(base, handlers, t)
    expect(items.map((i) => i.id)).toEqual([
      'open',
      'reveal',
      'copy-path',
      'move',
      'rename',
      'duplicate',
      'remove',
      'delete',
    ])
    expect(items.map((i) => i.label)).toEqual([
      'dlActOpen',
      'revealInFolder',
      'copyPath',
      'moveToFolder',
      'dlActRename',
      'dlActDuplicate',
      'removeFromList',
      'deleteFiles',
    ])
    // dividers sit where the group changes: [open reveal copy] | move | [rename copy] | [remove delete]
    expect(items.map((i) => i.group)).toEqual([0, 0, 0, 1, 3, 3, 5, 5])
  })

  it('draws the delete entry last and in the danger colour', () => {
    const items = deviceFileMenu(base, handlers, t)
    expect(items[items.length - 1]).toMatchObject({ id: 'delete', danger: true })
    expect(items.filter((i) => i.danger)).toHaveLength(1)
  })

  it('puts the offline toggle right after Open when the row is a UniWork copy', () => {
    expect(
      ids({
        offlineLabel: 'Use offline',
        showLocation: false,
        fileActions: false,
        editable: false,
      }),
    ).toEqual(['open', 'offline', 'remove'])
  })

  it('offers Move to group only for a starred row, between the copy items and Remove', () => {
    expect(ids({ starred: true })).toEqual([
      'open',
      'reveal',
      'copy-path',
      'move',
      'rename',
      'duplicate',
      'group',
      'remove',
      'delete',
    ])
  })

  it('says Unstar instead of Remove from list in the Starred view', () => {
    expect(ids({ view: 'starred', starred: true })).toContain('unstar')
    expect(ids({ view: 'starred', starred: true })).not.toContain('remove')
  })

  it('hides what the row cannot do: no Move, Rename, Copy or Delete when not editable', () => {
    expect(ids({ editable: false })).toEqual(['open', 'reveal', 'copy-path', 'remove'])
  })

  it('hides Move for a missing file and the removal group while a selection is open', () => {
    expect(ids({ missing: true })).not.toContain('move')
    expect(ids({ canDelete: false })).toEqual([
      'open',
      'reveal',
      'copy-path',
      'move',
      'rename',
      'duplicate',
    ])
  })

  it('offers only Delete files (no Remove from list) inside a folder view', () => {
    expect(ids({ context: 'folder' })).toEqual([
      'open',
      'reveal',
      'copy-path',
      'move',
      'rename',
      'duplicate',
      'delete',
    ])
  })

  it('lists one Move to project entry per other project, after Move', () => {
    const items = deviceFileMenu(
      {
        ...base,
        otherProjects: [
          { id: 'p-1', label: 'Alpha' },
          { id: 'p-2', label: 'Beta' },
        ],
      },
      handlers,
      t,
    )
    expect(items.map((i) => i.id)).toEqual([
      'open',
      'reveal',
      'copy-path',
      'move',
      'project:p-1',
      'project:p-2',
      'rename',
      'duplicate',
      'remove',
      'delete',
    ])
    expect(items.find((i) => i.id === 'project:p-1')!.label).toContain('moveToProject')
    expect(items.find((i) => i.id === 'project:p-1')!.label).toContain('Alpha')
  })

  it('runs the handler of the entry that is selected', () => {
    const open = vi.fn()
    const items = deviceFileMenu(base, { ...handlers, open }, t)
    items.find((i) => i.id === 'open')!.onSelect()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('orders a folder: Open, Rename, Move, Reveal | Delete folder', () => {
    const items = deviceFolderMenu({ editable: true }, handlers, t)
    expect(items.map((i) => i.id)).toEqual(['open', 'rename', 'move', 'reveal', 'delete'])
    expect(items[items.length - 1]).toMatchObject({ danger: true })
    expect(deviceFolderMenu({ editable: false }, handlers, t).map((i) => i.id)).toEqual([
      'open',
      'reveal',
    ])
  })
})

describe('DocList on the device screen (UNI-2047 B1)', () => {
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
    vi.restoreAllMocks()
  })

  const rows = deviceRows(
    [folder('Finance', at(2026, 10, 1, 8, 0))],
    [
      file('Budget.xlsx', at(2026, 10, 21, 9, 5), 5_033_165),
      file('Alpha notes.docx', at(2026, 10, 18, 10, 0), 48_000),
      file('Zeta plan.docx', at(2026, 10, 20, 16, 30), 2_969),
    ],
  )

  async function mount(props: Partial<DocListProps> = {}, lang: 'en' | 'vi' = 'en') {
    const onSortChange = vi.fn()
    const onOpen = vi.fn()
    const onSelectedChange = vi.fn()
    const full: DocListProps = {
      screen: 'device',
      rows,
      sort: null,
      onSortChange,
      selected: new Set(),
      onSelectedChange,
      label: 'Files',
      openMenuId: null,
      onOpenMenuChange: vi.fn(),
      menuFor: () => [],
      onOpen,
      ...props,
    }
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: lang }, createElement(DocList, full)))
    })
    return { onSortChange, onOpen, onSelectedChange }
  }

  const headers = () =>
    Array.from(host.querySelectorAll<HTMLElement>('[role="columnheader"]')).map(
      (h) => h.textContent?.trim() ?? '',
    )
  const names = () =>
    Array.from(host.querySelectorAll('.dh-doc-row')).map(
      (r) => r.querySelector('.dh-doc-open, .dh-doc-title')?.textContent,
    )

  it('has the device columns: Chọn · Tên · Cập nhật · Dung lượng · Thao tác', async () => {
    await mount()
    const cols = Array.from(host.querySelectorAll<HTMLElement>('[role="columnheader"]')).map(
      (h) => h.dataset.col,
    )
    expect(cols).toEqual(['select', 'name', 'updated', 'size', 'actions'])
    expect(headers().filter(Boolean)).toEqual(['Name', 'Updated', 'Size'])
  })

  it('keeps the rows in the order given until a header is clicked (no sort state shown)', async () => {
    await mount({ unsortedDefault: true })
    expect(names()).toEqual(['Finance', 'Budget.xlsx', 'Alpha notes.docx', 'Zeta plan.docx'])
    expect(
      Array.from(host.querySelectorAll('[aria-sort]')).map((el) => el.getAttribute('aria-sort')),
    ).toEqual(['none', 'none', 'none'])
  })

  it('applies a chosen sort and says it with aria-sort', async () => {
    const sort: SortSpec = { column: 'name', dir: 'asc' }
    await mount({ unsortedDefault: true, sort })
    expect(names().slice(1)).toEqual(['Alpha notes.docx', 'Budget.xlsx', 'Zeta plan.docx'])
    expect(host.querySelector('[data-col="name"]')!.getAttribute('aria-sort')).toBe('ascending')
  })

  it('without unsortedDefault the screen default (Cập nhật, newest first) applies', async () => {
    await mount()
    expect(names()).toEqual(['Budget.xlsx', 'Zeta plan.docx', 'Alpha notes.docx', 'Finance'])
  })

  it('keeps folder rows first under any sort when foldersFirst is set', async () => {
    await mount({
      unsortedDefault: true,
      foldersFirst: true,
      sort: { column: 'size', dir: 'desc' },
    })
    expect(names()).toEqual(['Finance', 'Budget.xlsx', 'Alpha notes.docx', 'Zeta plan.docx'])
    await mount({
      unsortedDefault: true,
      foldersFirst: true,
      sort: { column: 'name', dir: 'desc' },
    })
    expect(names()).toEqual(['Finance', 'Zeta plan.docx', 'Budget.xlsx', 'Alpha notes.docx'])
  })

  it('opens a folder row from its name, like a file (the caller enters the folder)', async () => {
    const { onOpen } = await mount()
    const open = host.querySelector<HTMLButtonElement>(
      '[data-doc-id="/Users/linh/Documents/Finance"] .dh-doc-open',
    )
    expect(open).not.toBeNull()
    await act(async () => {
      open!.click()
    })
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'folder', title: 'Finance' }),
    )
  })

  it('shows a Chọn box only on the rows the caller lets be selected', async () => {
    await mount({ selectableFor: (doc) => doc.kind !== 'folder' })
    const boxes = (id: string) =>
      host.querySelectorAll(`[data-doc-id="${id}"] input[type="checkbox"]`).length
    expect(boxes('/Users/linh/Documents/Finance')).toBe(0)
    expect(boxes('/Users/linh/Documents/Budget.xlsx')).toBe(1)
    // the header box stands for the selectable rows only
    const { onSelectedChange } = await mount({ selectableFor: (doc) => doc.kind !== 'folder' })
    await act(async () => {
      host.querySelector<HTMLInputElement>('[role="columnheader"] input')!.click()
    })
    expect([...(onSelectedChange.mock.calls[0]![0] as Set<string>)].sort()).toEqual([
      '/Users/linh/Documents/Alpha notes.docx',
      '/Users/linh/Documents/Budget.xlsx',
      '/Users/linh/Documents/Zeta plan.docx',
    ])
  })

  it('drops the Chọn column altogether when no row can be selected (search results)', async () => {
    await mount({ selectableFor: () => false })
    const cols = Array.from(host.querySelectorAll<HTMLElement>('[role="columnheader"]')).map(
      (h) => h.dataset.col,
    )
    expect(cols).toEqual(['name', 'updated', 'size', 'actions'])
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
  })

  it('lets the caller dress a row: class, drag source and drop target', async () => {
    const onDragStart = vi.fn()
    const onDrop = vi.fn()
    await mount({
      rowPropsFor: (doc) =>
        doc.kind === 'folder'
          ? { className: 'drop-target', onDrop }
          : { className: 'missing', draggable: true, onDragStart },
    })
    const folderRow = host.querySelector<HTMLElement>(
      '[data-doc-id="/Users/linh/Documents/Finance"]',
    )!
    expect(folderRow.classList.contains('drop-target')).toBe(true)
    const fileRow = host.querySelector<HTMLElement>(
      '[data-doc-id="/Users/linh/Documents/Budget.xlsx"]',
    )!
    expect(fileRow.classList.contains('missing')).toBe(true)
    expect(fileRow.getAttribute('draggable')).toBe('true')
    await act(async () => {
      fileRow.dispatchEvent(new Event('dragstart', { bubbles: true }))
      folderRow.dispatchEvent(new Event('drop', { bubbles: true }))
    })
    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(onDrop).toHaveBeenCalledTimes(1)
  })

  it('writes the second line of the name from the caller and a detail line under it', async () => {
    await mount({
      sublineFor: (doc) =>
        doc.kind === 'file'
          ? {
              short: 'Documents',
              full: '/Users/linh/Documents',
              detail: createElement('em', { className: 'snip' }, 'a snippet'),
            }
          : { short: 'Folder', full: 'Folder' },
    })
    const row = host.querySelector('[data-doc-id="/Users/linh/Documents/Budget.xlsx"]')!
    expect(row.querySelector('.dh-doc-subpath')?.textContent).toBe('Documents')
    expect(row.querySelector('.snip')?.textContent).toBe('a snippet')
    expect(
      host.querySelector('[data-doc-id="/Users/linh/Documents/Finance"] .dh-doc-subpath')
        ?.textContent,
    ).toBe('Folder')
  })

  it('lets the caller set the title node (search hits highlight the name)', async () => {
    await mount({
      titleFor: (doc) => createElement('mark', { className: 'hit' }, doc.title),
    })
    expect(host.querySelectorAll('.dh-doc-open .hit').length).toBeGreaterThan(0)
  })

  it('starts a rename from the name without its extension (the caller passes it)', async () => {
    await mount({
      rename: {
        docId: '/Users/linh/Documents/Budget.xlsx',
        initial: 'Budget',
        error: null,
        busy: false,
        onSave: vi.fn(),
        onCancel: vi.fn(),
        onEdit: vi.fn(),
      },
    })
    const input = host.querySelector<HTMLInputElement>(
      '[data-doc-id="/Users/linh/Documents/Budget.xlsx"] input[type="text"]',
    )
    expect(input?.value).toBe('Budget')
  })

  it('hides Dung lượng by the width of the table (640 px)', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = this.classList.contains('dh-doc-table') ? 639 : 0
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0 } as DOMRect
    })
    await mount()
    expect(headers().filter(Boolean)).toEqual(['Name', 'Updated'])
  })
})
