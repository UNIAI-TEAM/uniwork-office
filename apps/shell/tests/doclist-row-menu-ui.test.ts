/**
 * @vitest-environment jsdom
 */
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider, useI18n } from '../src/renderer/src/locale'
import { DocList } from '../src/renderer/src/doclist/DocList'
import { DocumentsSourceRow } from '../src/renderer/src/uniwork-home/DocumentsSourceRow'
import { copyDocLink } from '../src/renderer/src/doclist/copy-link'
import {
  buildRowMenu,
  type RowMenuActionId,
  type RowMenuItem,
} from '../src/renderer/src/doclist/row-menu'
import type { DocListScreen } from '../src/renderer/src/doclist/columns'
import type {
  DocumentsHomeDoc,
  DocumentsHomeTableRow,
} from '../src/renderer/src/uniwork-home/documents-home-model'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const DOC: DocumentsHomeDoc = {
  id: 'd1',
  workspaceId: 'ws-1',
  title: 'Kế hoạch.docx',
  format: 'docx',
  updatedAt: '2026-10-21T02:00:00.000Z',
  kind: 'file',
  parentId: null,
  canEdit: true,
  canManage: true,
  myLevel: 'manage',
}
const rowOf = (d: DocumentsHomeDoc): DocumentsHomeTableRow => ({ type: 'doc', id: d.id, doc: d })

describe('row menu in the shared table (UNI-2047 A4)', () => {
  let host: HTMLDivElement
  let root: Root
  let run: Partial<Record<RowMenuActionId, ReturnType<typeof vi.fn>>>

  beforeEach(() => {
    localStorage.clear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    run = {}
    for (const id of ['open', 'copy-link', 'rename', 'move', 'shelve', 'trash'] as const) {
      run[id] = vi.fn()
    }
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function Harness({ screen, doc }: { screen: DocListScreen; doc: DocumentsHomeDoc }) {
    const { t } = useI18n()
    const [menu, setMenu] = useState<string | null>(null)
    return createElement(DocList, {
      screen,
      rows: [rowOf(doc)],
      sort: null,
      onSortChange: () => {},
      selected: new Set<string>(),
      onSelectedChange: () => {},
      label: 'Tài liệu',
      openMenuId: menu,
      onOpenMenuChange: setMenu,
      menuFor: (d: DocumentsHomeDoc): RowMenuItem[] =>
        buildRowMenu({
          screen,
          doc: d,
          run: run as Partial<Record<RowMenuActionId, () => void>>,
          offlineLabel: null,
          label: t,
        }),
      onOpen: () => {},
    })
  }

  async function mount(screen: DocListScreen = 'workspace', doc: DocumentsHomeDoc = DOC) {
    await act(async () => {
      root.render(
        createElement(LocaleProvider, { initial: 'vi' }, createElement(Harness, { screen, doc })),
      )
    })
  }
  const button = () => host.querySelector<HTMLButtonElement>('button[data-folder-menu-for="d1"]')
  const openMenu = async () => {
    await act(async () => {
      button()!.click()
    })
  }
  const menuEl = () => document.body.querySelector<HTMLElement>('[role="menu"]')
  const entries = () =>
    Array.from(menuEl()?.children ?? []).map((el) => ({
      role: el.getAttribute('role'),
      text: el.textContent,
      danger: el.classList.contains('danger'),
    }))

  // A-FIX4 m5: the … button is a tab stop, so the menu can be opened from the keyboard
  it('puts the row … button in the tab order', async () => {
    await mount()
    expect(button()!.tabIndex).toBe(0)
  })

  it('puts the … button of an other-sources row in the tab order too', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsSourceRow, {
            source: {
              id: 's1',
              source: 'chat',
              parent: { kind: 'channel', id: 'c1', title: 'General' },
              name: 'ghi-chu.pdf',
              mimeType: 'application/pdf',
              extension: 'pdf',
              sizeBytes: 1024,
              updatedAt: '2026-10-21T02:00:00.000Z',
              owner: { id: 'u1', name: 'Lan' },
              canOpenInApp: false,
              canSave: true,
            },
            columns: ['select', 'name', 'updated', 'actions'],
            menuOpen: false,
            onMenuOpenChange: () => {},
            onOpen: () => {},
            onDownload: () => {},
          }),
        ),
      )
    })
    const menuButton = host.querySelector<HTMLButtonElement>(
      'button[data-folder-menu-for="source:s1"]',
    )
    expect(menuButton).not.toBeNull()
    expect(menuButton!.tabIndex).toBe(0)
  })

  it('draws the rules order with a divider between groups and the delete entry red, last', async () => {
    await mount()
    await openMenu()
    expect(entries()).toEqual([
      { role: 'menuitem', text: 'Mở', danger: false },
      { role: 'separator', text: '', danger: false },
      { role: 'menuitem', text: 'Sao chép link', danger: false },
      { role: 'separator', text: '', danger: false },
      { role: 'menuitem', text: 'Đổi tên', danger: false },
      { role: 'menuitem', text: 'Di chuyển', danger: false },
      { role: 'separator', text: '', danger: false },
      { role: 'menuitem', text: 'Lưu trữ', danger: false },
      { role: 'menuitem', text: 'Chuyển vào thùng rác', danger: true },
    ])
  })

  it('a viewer sees no divider dangling at an end and no edit entry', async () => {
    await mount('workspace', { ...DOC, canEdit: false, canManage: false, myLevel: 'view' })
    await openMenu()
    const list = entries()
    expect(list.map((e) => e.text)).toEqual(['Mở', '', 'Sao chép link'])
    expect(list[0]!.role).toBe('menuitem')
    expect(list[list.length - 1]!.role).toBe('menuitem')
  })

  it('the trash row menu is Khôi phục · Xem chi tiết without a permanent delete', async () => {
    run.restore = vi.fn()
    run.details = vi.fn()
    await mount('trash', { ...DOC, archived: true })
    await openMenu()
    expect(entries().map((e) => e.text)).toEqual(['Khôi phục', 'Xem chi tiết'])
  })

  it('selecting an entry runs it once and closes the menu', async () => {
    await mount()
    await openMenu()
    const item = menuEl()!.querySelector<HTMLElement>('[data-folder-action="rename"]')!
    await act(async () => {
      item.click()
    })
    expect(run.rename).toHaveBeenCalledTimes(1)
    expect(menuEl()).toBeNull()
  })

  it('selecting the delete entry only asks (the host owns the confirm dialog)', async () => {
    await mount()
    await openMenu()
    const item = menuEl()!.querySelector<HTMLElement>('[data-folder-action="trash"]')!
    expect(item.className).toContain('danger')
    await act(async () => {
      item.click()
    })
    expect(run.trash).toHaveBeenCalledTimes(1)
  })

  it('keyboard: opens focused on the first entry, arrows skip dividers and wrap, Esc returns focus', async () => {
    await mount()
    await act(async () => {
      button()!.focus()
      button()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    const items = () => Array.from(menuEl()!.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(document.activeElement).toBe(items()[0])
    const key = async (k: string) =>
      act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', { key: k, bubbles: true }),
        )
      })
    await key('ArrowDown')
    expect(document.activeElement).toBe(items()[1])
    await key('End')
    expect(document.activeElement).toBe(items()[items().length - 1])
    await key('ArrowDown')
    expect(document.activeElement).toBe(items()[0])
    await key('Escape')
    expect(menuEl()).toBeNull()
    expect(document.activeElement).toBe(button())
  })
})

describe('copy link (UNI-2047 A4)', () => {
  const workspaces = [
    { id: 'ws-1', slug: 'ws', orgSlug: 'org', name: 'WS' },
  ] as unknown as UniworkWorkspaceRef[]
  const write = vi.fn()

  beforeEach(() => {
    write.mockReset()
    write.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    })
    ;(window as unknown as { uniworkWork: unknown }).uniworkWork = {
      webUrl: vi.fn().mockResolvedValue('https://app.example.com/org/ws/documents/d1'),
    }
  })
  afterEach(() => {
    delete (window as unknown as { uniworkWork?: unknown }).uniworkWork
  })

  it('writes the web link of the document to the clipboard', async () => {
    await expect(copyDocLink(workspaces, 'ws-1', 'd1')).resolves.toBe(true)
    expect(write).toHaveBeenCalledWith('https://app.example.com/org/ws/documents/d1')
    const api = (window as unknown as { uniworkWork: { webUrl: ReturnType<typeof vi.fn> } })
      .uniworkWork
    expect(api.webUrl).toHaveBeenCalledWith({
      kind: 'document',
      orgSlug: 'org',
      wsSlug: 'ws',
      id: 'd1',
    })
  })

  it('fails (false, nothing copied) when the workspace slugs are unknown, the URL is missing or the clipboard refuses', async () => {
    await expect(copyDocLink(workspaces, 'other', 'd1')).resolves.toBe(false)
    const api = (window as unknown as { uniworkWork: { webUrl: ReturnType<typeof vi.fn> } })
      .uniworkWork
    api.webUrl.mockResolvedValueOnce(null)
    await expect(copyDocLink(workspaces, 'ws-1', 'd1')).resolves.toBe(false)
    api.webUrl.mockRejectedValueOnce(new Error('ipc'))
    await expect(copyDocLink(workspaces, 'ws-1', 'd1')).resolves.toBe(false)
    write.mockRejectedValueOnce(new Error('denied'))
    await expect(copyDocLink(workspaces, 'ws-1', 'd1')).resolves.toBe(false)
    expect(write).toHaveBeenCalledTimes(1)
  })
})
