// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriveFile } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DriveList } from '../src/renderer/src/uniwork-home/DriveList'
import { DRIVE_GROUP_BY_FOLDER_KEY } from '../src/renderer/src/uniwork-home/drive-folder-prefs'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const conn = {
  id: 'dc-active',
  provider: 'google',
  googleEmail: 'minh@company.vn',
  status: 'active' as const,
  needsReconnect: false,
  linkedFileCount: 5,
  connectedAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-10T00:00:00Z',
}

// the fake list of the folder contract: named, unnamed (name not readable) and unknown parents
function row(id: string, name: string, driveFolder?: DriveFile['driveFolder']): DriveFile {
  return {
    id,
    organizationId: 'org-1',
    workspaceId: 'ws-1',
    externalFileId: `ext-${id}`,
    name,
    mimeType: 'application/vnd.google-apps.document',
    iconKind: 'google_doc',
    webViewLink: `https://docs.google.com/document/d/ext-${id}/edit`,
    openUrl: `https://docs.google.com/document/d/ext-${id}/edit`,
    ownerDisplay: 'Hùng',
    sharingState: 'private',
    connectionId: 'dc-active',
    boundAccountEmail: 'minh@company.vn',
    boundConnectionLost: false,
    boundById: 'u-1',
    boundByName: 'Minh',
    createdBy: 'u-1',
    createdByKind: 'user',
    createdByName: 'Minh',
    createdAt: '2026-10-10T00:00:00Z',
    updatedAt: '2026-10-15T00:00:00Z',
    viewerAccess: 'granted',
    viewerConnectionId: 'dc-active',
    viewerAccountEmail: 'minh@company.vn',
    canUnlink: true,
    canRebind: false,
    canPropose: true,
    canAsk: true,
    usedInCount: 0,
    usedInTasks: [],
    tasksCreated: { count: 0 },
    driveFolder,
  }
}

const MIX: DriveFile[] = [
  row('1', 'Hợp đồng A', { id: 'f_contracts', name: 'Hợp đồng' }),
  row('2', 'Không rõ 1'),
  row('3', 'Báo giá', { id: 'f_quotes', name: 'Báo giá' }),
  row('4', 'Ẩn tên', { id: 'abcdef123456', name: null }),
  row('5', 'Hợp đồng B', { id: 'f_contracts', name: 'Hợp đồng' }),
  row('6', 'Không rõ 2', null),
]

let host: HTMLDivElement
let root: Root

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function render(files: DriveFile[], lang: 'vi' | 'en' = 'en') {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(DriveList, {
          workspaceId: 'ws-1',
          connections: [conn],
          selectedAccountId: null,
          files,
          status: 'ready',
          offline: false,
          nextCursor: null,
          loadingMore: false,
          onRetry: vi.fn(),
          onLoadMore: vi.fn(),
          onOpenOnGoogle: vi.fn(),
        }),
      ),
    )
  })
  await flush()
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const headers = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.dh-drive-group-row button')].map(
    (b) => b.textContent,
  )
const rowNames = (scope: ParentNode = document) =>
  [...scope.querySelectorAll('.dh-drive-row .dh-drive-file-name')].map((n) => n.textContent)

beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  localStorage.clear()
})

describe('DriveList group by folder (UNI-2172)', () => {
  it('is on by default: named A-Z, then unnamed by short id, then "Folder unknown", with counts', async () => {
    await render(MIX)
    expect(headers()).toEqual([
      'Báo giá · 1 file',
      'Hợp đồng · 2 files',
      'Drive folder · abcdef · 1 file',
      'Folder unknown · 2 files',
    ])
    const groups = [...document.querySelectorAll('tbody.dh-drive-group')]
    expect(groups.map((g) => rowNames(g))).toEqual([
      ['Báo giá'],
      ['Hợp đồng A', 'Hợp đồng B'],
      ['Ẩn tên'],
      ['Không rõ 1', 'Không rõ 2'],
    ])
    const toggle = document.querySelector<HTMLInputElement>('[data-drive-group-by-folder]')!
    expect(toggle.checked).toBe(true)
  })

  it('writes the vi copy: "Thư mục trên Drive · abcdef" and "Chưa rõ thư mục"', async () => {
    await render(MIX, 'vi')
    expect(headers().slice(2)).toEqual([
      'Thư mục trên Drive · abcdef · 1 tệp',
      'Chưa rõ thư mục · 2 tệp',
    ])
    expect(document.querySelector('.dh-drive-group-switch')?.textContent).toBe('Nhóm theo thư mục')
  })

  it('a group header is a button with aria-expanded whose name carries the count; it collapses its rows', async () => {
    await render(MIX)
    const button = document.querySelector<HTMLButtonElement>(
      '[data-drive-group="f_contracts"] .dh-group-toggle',
    )!
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.textContent).toContain('2 files')
    await click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(rowNames(document.querySelector('[data-drive-group="f_contracts"]')!)).toEqual([])
    // the other groups keep their rows
    expect(rowNames()).toHaveLength(4)
    await click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(rowNames()).toHaveLength(6)
  })

  it('turning it off shows the flat list in the incoming order and remembers the choice', async () => {
    await render(MIX)
    await click(document.querySelector('[data-drive-group-by-folder]')!)
    expect(document.querySelectorAll('.dh-drive-group-row')).toHaveLength(0)
    expect(rowNames()).toEqual(MIX.map((f) => f.name))
    expect(localStorage.getItem(DRIVE_GROUP_BY_FOLDER_KEY)).toBe('false')

    // a later mount reads the stored choice
    await act(async () => root.unmount())
    root = createRoot(host)
    await render(MIX)
    expect(document.querySelector<HTMLInputElement>('[data-drive-group-by-folder]')!.checked).toBe(
      false,
    )
    expect(document.querySelectorAll('.dh-drive-group-row')).toHaveLength(0)
  })

  it('shows the flat list when every file is unknown (old server), toggle still on', async () => {
    await render([row('1', 'Một'), row('2', 'Hai', null)])
    expect(document.querySelectorAll('.dh-drive-group-row')).toHaveLength(0)
    expect(rowNames()).toEqual(['Một', 'Hai'])
    expect(document.querySelector<HTMLInputElement>('[data-drive-group-by-folder]')!.checked).toBe(
      true,
    )
  })

  it('counts follow a filtered list: a folder with no match disappears', async () => {
    await render(MIX)
    await render(MIX.filter((f) => f.id !== '3'))
    expect(headers()).toEqual([
      'Hợp đồng · 2 files',
      'Drive folder · abcdef · 1 file',
      'Folder unknown · 2 files',
    ])
  })

  it('row selection and open hand-offs are unchanged inside a group', async () => {
    const onSelect = vi.fn()
    const onOpenOnGoogle = vi.fn()
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(DriveList, {
            workspaceId: 'ws-1',
            connections: [conn],
            selectedAccountId: null,
            files: MIX,
            status: 'ready',
            offline: false,
            nextCursor: null,
            loadingMore: false,
            onRetry: vi.fn(),
            onLoadMore: vi.fn(),
            onOpenOnGoogle,
            onSelect,
          }),
        ),
      )
    })
    await flush()
    const target = document.querySelector('[data-drive-file-id="5"]')!
    await click(target)
    expect(onSelect).toHaveBeenCalledWith('5', 'pointer')
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onOpenOnGoogle).toHaveBeenCalledWith('5')
  })
})
