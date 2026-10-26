// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkResult, UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import { DriveList } from '../src/renderer/src/uniwork-home/DriveList'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const activeConn = {
  id: 'dc-active',
  provider: 'google',
  googleEmail: 'minh@company.vn',
  status: 'active' as const,
  needsReconnect: false,
  linkedFileCount: 2,
  connectedAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-10T00:00:00Z',
}
const brokenConn = {
  id: 'dc-broken',
  provider: 'google',
  googleEmail: 'lan@company.vn',
  status: 'needs_reconnect' as const,
  needsReconnect: true,
  authFailedAt: '2026-10-12T00:00:00Z',
  authFailedReason: 'invalid_grant',
  linkedFileCount: 1,
  connectedAt: '2026-10-02T00:00:00Z',
  updatedAt: '2026-10-12T00:00:00Z',
}

const baseFile = {
  organizationId: 'org-1',
  workspaceId: 'ws-1',
  mimeType: 'application/vnd.google-apps.document',
  iconKind: 'google_doc' as const,
  ownerDisplay: 'Hùng',
  sharingState: 'shared' as const,
  sharedUserCount: 4,
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
  driveModifiedAt: '2026-10-14T08:30:00Z',
  driveModifiedByDisplay: 'Lan',
  viewerAccess: 'granted' as const,
  viewerConnectionId: 'dc-active',
  viewerAccountEmail: 'minh@company.vn',
  canUnlink: true,
  canRebind: false,
  canPropose: true,
  canAsk: true,
  usedInCount: 0,
  usedInTasks: [] as Array<{ taskId: string; identifier: string; title: string; status: string }>,
  tasksCreated: { count: 0 } as {
    count: number
    lastCreatedAt?: string
    lastCreatedByName?: string
  },
}

const fileOne = {
  ...baseFile,
  id: 'df-1',
  externalFileId: 'ext-1',
  name: 'Kế hoạch ra mắt Q4',
  webViewLink: 'https://docs.google.com/document/d/ext-1/edit',
  openUrl: 'https://docs.google.com/document/d/ext-1/edit',
  usedInCount: 2,
  usedInTasks: [
    { taskId: 't-1', identifier: 'UNI-1042', title: 'Chuẩn bị kế hoạch', status: 'todo' },
    { taskId: 't-2', identifier: 'UNI-1048', title: 'Chốt phạm vi beta', status: 'done' },
  ],
  tasksCreated: { count: 0 },
}
const fileTwo = {
  ...baseFile,
  id: 'df-2',
  externalFileId: 'ext-2',
  name: 'Ngân sách marketing 2026',
  mimeType: 'application/vnd.google-apps.spreadsheet',
  iconKind: 'google_sheet' as const,
  webViewLink: 'https://docs.google.com/spreadsheets/d/ext-2/edit',
  openUrl: 'https://docs.google.com/spreadsheets/d/ext-2/edit',
  connectionId: 'dc-broken',
  boundAccountEmail: 'lan@company.vn',
  boundConnectionLost: true,
  viewerAccess: 'connection_lost' as const,
  viewerConnectionId: 'dc-broken',
  viewerAccountEmail: 'lan@company.vn',
  canRebind: true,
}

const historyEvents = [
  {
    id: 'h-1',
    organizationId: 'org-1',
    actorKind: 'user',
    actorId: 'u-1',
    action: 'drive_file.linked',
    resourceType: 'drive_file',
    resourceID: 'df-1',
    resourceId: 'df-1',
    changes: {},
    actorName: 'Minh',
    metadata: { actor_name: 'Not Used' },
    correlationId: 'c-1',
    occurredAt: '2026-10-10T09:00:00Z',
  },
  {
    id: 'h-2',
    organizationId: 'org-1',
    actorKind: 'user',
    actorId: 'u-2',
    action: 'drive_file.opened',
    resourceType: 'drive_file',
    resourceID: 'df-1',
    resourceId: 'df-1',
    changes: {},
    metadata: {},
    correlationId: 'c-2',
    occurredAt: '2026-10-11T09:00:00Z',
  },
  {
    id: 'h-3',
    organizationId: 'org-1',
    actorKind: 'user',
    actorId: 'u-1',
    action: 'drive_file.rebound',
    resourceType: 'drive_file',
    resourceID: 'df-1',
    resourceId: 'df-1',
    changes: {},
    metadata: {},
    correlationId: 'c-3',
    occurredAt: '2026-10-12T09:00:00Z',
  },
]

type DetailOverrides = Partial<typeof baseFile> & {
  taskCreations?: Array<{
    proposalId: string
    createdAt: string
    createdById: string
    createdByName: string
    tasks: Array<{ taskId: string; identifier: string; title: string; status: string }>
  }>
}

describe('UNI-2196 (D3): Google Drive detail panel, unlink and web hand-offs', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let workspaces: UniworkWorkspaceRef[]
  let details: Record<string, DetailOverrides & typeof fileOne>
  let listFiles: ReturnType<typeof vi.fn>
  let listConnections: ReturnType<typeof vi.fn>
  let getFile: ReturnType<typeof vi.fn>
  let getHistory: ReturnType<typeof vi.fn>
  let unlink: ReturnType<typeof vi.fn>
  let openOnGoogle: ReturnType<typeof vi.fn>
  let openWeb: ReturnType<typeof vi.fn>

  const detailOf = (over: Record<string, unknown>) =>
    ({ ...fileOne, ...over }) as unknown as DetailOverrides & typeof fileOne

  const installBridges = (): void => {
    const folderTree = [
      {
        id: 'f-mine',
        parentId: null,
        title: 'My Folder',
        position: 0,
        kind: 'my_folder' as const,
        isSystem: true,
        children: [],
      },
    ]
    const api = {
      accountStatus: vi.fn(async () => ({
        state: 'signed-in' as const,
        loggedIn: true,
        email: 'minh@company.vn',
        profile: {
          accountId: 'acc-1',
          email: 'minh@company.vn',
          name: 'Minh',
          orgId: 'org-1',
          orgName: 'UniWork',
          workspaces,
        },
      })),
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async () => ok(folderTree)),
      uniworkEnsureMyFolder: vi.fn(async () => ok(folderTree[0]!)),
      uniworkListChildren: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkListDocuments: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
    }
    ;(window as unknown as { aiOffice: unknown; home: unknown }).aiOffice = api
    ;(window as unknown as { aiOffice: unknown; home: unknown }).home = api
    Reflect.set(window, 'uniworkDrive', {
      isAvailable: vi.fn(async () => true),
      listConnections,
      listFiles,
      getFile,
      getHistory,
      unlink,
      openOnGoogle,
    })
    Reflect.set(window, 'uniworkWork', { openWeb })
  }

  const mountHome = async (): Promise<void> => {
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
          }),
        ),
      )
    })
    await flush()
  }

  const click = async (el: Element | null): Promise<void> => {
    expect(el).not.toBeNull()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
    await flush()
  }

  const openDriveView = async (): Promise<void> => {
    await mountHome()
    await click(document.querySelector('[data-nav="google-drive"]'))
  }

  const selectRow = async (id: string): Promise<void> => {
    await click(document.querySelector(`[data-drive-file-id="${id}"]`))
  }

  const panel = () => document.querySelector<HTMLElement>('[data-drive-panel]')

  // D3-V2-1: web hand-offs of the same target within 1 s collapse into one; a fake clock keeps tests apart
  let clock = 1_700_000_000_000
  const advance = (ms: number) => {
    clock += ms
  }

  beforeEach(() => {
    advance(10_000)
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    workspaces = [
      {
        id: 'ws-1',
        name: 'Công ty UniWork',
        slug: 'uniwork',
        orgSlug: 'uniwork-org',
        orgId: 'org-1',
        myRole: 'admin',
      },
    ]
    details = { 'df-1': detailOf({}), 'df-2': detailOf(fileTwo) }
    listConnections = vi.fn(async () => ({
      ok: true as const,
      value: [activeConn, brokenConn],
    }))
    listFiles = vi.fn(async (q: { connectionId?: string }) => {
      const files =
        q.connectionId === 'dc-active'
          ? [fileOne]
          : q.connectionId === 'dc-broken'
            ? [fileTwo]
            : [fileOne, fileTwo]
      return { ok: true as const, value: { files, totalCount: files.length, nextCursor: null } }
    })
    getFile = vi.fn(async (q: { driveFileId: string }) => {
      const found = details[q.driveFileId]
      return found
        ? { ok: true as const, value: found }
        : { ok: false as const, error: 'not_found' }
    })
    getHistory = vi.fn(async () => ({ ok: true as const, value: historyEvents }))
    unlink = vi.fn(async () => ({ ok: true as const, value: null }))
    openOnGoogle = vi.fn(async () => ({ ok: true as const, value: null }))
    openWeb = vi.fn(async () => true)
    installBridges()
    host = document.createElement('div')
    sidebarSlot = document.createElement('div')
    document.body.appendChild(sidebarSlot)
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    vi.mocked(Date.now).mockRestore()
    await act(async () => {
      root.unmount()
    })
    host.remove()
    sidebarSlot.remove()
    for (const key of ['uniworkDrive', 'uniworkWork', 'aiOffice', 'home']) {
      Reflect.deleteProperty(window, key)
    }
  })

  it('selecting a row opens the panel with every field; double click still opens on Google', async () => {
    details['df-1'] = detailOf({
      taskCreations: [
        {
          proposalId: 'p-1',
          createdAt: '2026-10-15T10:00:00Z',
          createdById: 'u-1',
          createdByName: 'Minh',
          tasks: [
            { taskId: 't-5', identifier: 'UNI-1051', title: 'Soạn FAQ', status: 'todo' },
            { taskId: 't-6', identifier: 'UNI-1052', title: 'Landing page', status: 'todo' },
          ],
        },
      ],
      tasksCreated: { count: 2, lastCreatedAt: '2026-10-15T10:00:00Z', lastCreatedByName: 'Minh' },
    })
    await openDriveView()
    expect(panel()).toBeNull()
    await selectRow('df-1')

    const p = panel()!
    expect(p).not.toBeNull()
    expect(getFile).toHaveBeenCalledWith({ workspaceId: 'ws-1', driveFileId: 'df-1' })
    expect(getHistory).toHaveBeenCalledWith({ workspaceId: 'ws-1', driveFileId: 'df-1' })
    expect(p.querySelector('[data-drive-panel-title]')?.textContent).toBe('Kế hoạch ra mắt Q4')
    expect(p.querySelector('[data-drive-panel-sub]')?.textContent).toContain('Google Docs')
    expect(p.querySelector('[data-drive-panel-sub]')?.textContent).toContain('Lan sửa')
    const text = p.textContent ?? ''
    expect(text).toContain('Nguồn')
    expect(text).toContain('Google Drive · Google Docs')
    expect(p.querySelector('[data-drive-bound] dd')?.textContent).toContain('minh@company.vn')
    // D3F-R1-11: the §7.7 explainer names the account
    expect(p.querySelector('[data-drive-viewer="granted"] dd')?.textContent).toBe(
      'Xem và sửa nội dung trên Google, bằng tài khoản minh@company.vn. UniWork chỉ lưu liên kết, các việc dùng tệp và lịch sử thao tác; nội dung vẫn nằm trên Google Drive.',
    )
    expect(text).toContain('Hùng')
    expect(text).toContain('Minh')
    expect(text).toContain('Theo chia sẻ trên Drive')
    expect(p.querySelector('[data-drive-used] h5')?.textContent).toBe('Đang dùng ở · 2')
    expect(
      Array.from(p.querySelectorAll('[data-drive-used] [data-drive-task]')).map(
        (b) => b.textContent,
      ),
    ).toEqual(['UNI-1042Chuẩn bị kế hoạch', 'UNI-1048Chốt phạm vi beta'])
    // §8.8 one group per creation, each task opens the web
    const group = p.querySelector('[data-drive-creation="p-1"]')!
    expect(group.querySelector('.dh-drive-panel-group-label')?.textContent).toMatch(
      /^.+ · Minh · 2 việc$/,
    )
    expect(group.querySelectorAll('[data-drive-task]')).toHaveLength(2)
    // history: linked + rebound rows, the "opened" row is dropped
    const rows = Array.from(p.querySelectorAll('[data-drive-activity-row]')).map(
      (r) => r.textContent ?? '',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Đã liên kết lại bằng tài khoản khác')
    expect(rows[1]).toContain('Minh · Đã liên kết tệp')

    // a click selects only; the file is not opened
    expect(openOnGoogle).not.toHaveBeenCalled()
    expect(
      document.querySelector('[data-drive-file-id="df-1"]')?.getAttribute('aria-current'),
    ).toBe('true')
    await act(async () => {
      document
        .querySelector('[data-drive-file-id="df-2"]')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(openOnGoogle).toHaveBeenCalledWith({ workspaceId: 'ws-1', driveFileId: 'df-2' })
  })

  it('Space selects a row, Enter opens it on Google and Escape closes the panel', async () => {
    await openDriveView()
    const row = document.querySelector<HTMLElement>('[data-drive-file-id="df-1"]')!
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    await flush()
    expect(panel()).not.toBeNull()
    expect(openOnGoogle).not.toHaveBeenCalled()
    // the keyboard moved focus to the panel title
    expect(document.activeElement).toBe(panel()!.querySelector('[data-drive-panel-title]'))
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(openOnGoogle).toHaveBeenCalledWith({ workspaceId: 'ws-1', driveFileId: 'df-1' })
    await act(async () => {
      panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(panel()).toBeNull()
    // focus goes back to the row the panel was opened from
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(document.activeElement).toBe(row)
  })

  it('shows the §7.4 block for a viewer who has not given access and hands off drive-file', async () => {
    details['df-1'] = detailOf({
      viewerAccess: 'unknown',
      viewerAccountEmail: undefined,
      boundByName: 'Minh',
    })
    await openDriveView()
    await selectRow('df-1')
    const viewer = panel()!.querySelector('[data-drive-viewer="unknown"]')!
    expect(viewer.textContent).toContain('Chưa cho UniWork đọc tệp')
    expect(viewer.textContent).toContain('Tệp do Minh liên kết từ Google Drive của Minh.')
    expect(viewer.textContent).toContain('UniWork không chia sẻ thay.')
    // create / ask stay locked until the viewer reads the file
    const create = panel()!.querySelector<HTMLButtonElement>('[data-drive-panel-create]')!
    expect(create.getAttribute('aria-disabled')).toBe('true')
    expect(create.getAttribute('aria-describedby')).toBe(viewer.querySelector('dd')!.id)
    await click(create)
    await click(panel()!.querySelector('[data-drive-panel-ask]'))
    expect(openWeb).not.toHaveBeenCalled()
    await click(viewer.querySelector('[data-drive-grant="grant"]'))
    expect(openWeb).toHaveBeenCalledTimes(1)
    expect(openWeb).toHaveBeenCalledWith({
      kind: 'drive-file',
      orgSlug: 'uniwork-org',
      wsSlug: 'uniwork',
      id: 'df-1',
    })
  })

  it('a lost connection offers Reconnect (drive-connect) and a rebind only when canRebind', async () => {
    await openDriveView()
    await selectRow('df-2')
    const viewer = panel()!.querySelector('[data-drive-viewer="connection_lost"]')!
    expect(viewer.textContent).toContain('Kết nối Google Drive lan@company.vn đã hết hạn.')
    await click(viewer.querySelector('[data-drive-grant="reconnect"]'))
    expect(openWeb).toHaveBeenLastCalledWith({
      kind: 'drive-connect',
      orgSlug: 'uniwork-org',
      wsSlug: 'uniwork',
    })
    await click(panel()!.querySelector('[data-drive-rebind]'))
    expect(openWeb).toHaveBeenLastCalledWith({
      kind: 'drive-file',
      orgSlug: 'uniwork-org',
      wsSlug: 'uniwork',
      id: 'df-2',
    })
    // no rebind for someone who may not, or while the bound connection is fine
    details['df-2'] = detailOf({ ...fileTwo, canRebind: false })
    await click(document.querySelector('[data-drive-panel-close]'))
    await selectRow('df-2')
    expect(panel()!.querySelector('[data-drive-rebind]')).toBeNull()
  })

  it('names who rebound the file', async () => {
    details['df-1'] = detailOf({
      boundById: 'u-9',
      boundByName: 'Hùng',
      boundAccountEmail: 'h@x.vn',
    })
    await openDriveView()
    await selectRow('df-1')
    const bound = panel()!.querySelector('[data-drive-bound] dd')!
    expect(bound.textContent).toContain('h@x.vn')
    expect(bound.querySelector('[data-drive-rebound]')?.textContent).toContain('(gắn lại bởi Hùng)')
    // the linker's own binding carries no such label
    details['df-1'] = detailOf({})
    await click(document.querySelector('[data-drive-panel-close]'))
    await selectRow('df-1')
    expect(panel()!.querySelector('[data-drive-rebound]')).toBeNull()
  })

  it('Open on Google Drive from the panel sends ids only', async () => {
    await openDriveView()
    await selectRow('df-1')
    await click(panel()!.querySelector('[data-drive-panel-open]'))
    expect(openOnGoogle).toHaveBeenCalledTimes(1)
    expect(openOnGoogle).toHaveBeenCalledWith({ workspaceId: 'ws-1', driveFileId: 'df-1' })
  })

  it('Create tasks with no earlier creation hands off drive-file + propose at once', async () => {
    await openDriveView()
    await selectRow('df-1')
    expect(panel()!.querySelector('[data-drive-recreate]')).toBeNull()
    await click(panel()!.querySelector('[data-drive-panel-create]'))
    expect(openWeb).toHaveBeenCalledTimes(1)
    expect(openWeb).toHaveBeenCalledWith({
      kind: 'drive-file',
      orgSlug: 'uniwork-org',
      wsSlug: 'uniwork',
      id: 'df-1',
      action: 'propose',
    })
  })

  it('Create tasks after an earlier creation warns first (role=status, aria-describedby), then hands off', async () => {
    details['df-1'] = detailOf({
      tasksCreated: { count: 3, lastCreatedAt: '2026-10-15T10:00:00Z', lastCreatedByName: 'Minh' },
      taskCreations: [
        {
          proposalId: 'p-1',
          createdAt: '2026-10-15T10:00:00Z',
          createdById: 'u-1',
          createdByName: 'Minh',
          tasks: [{ taskId: 't-5', identifier: 'UNI-1051', title: 'Soạn FAQ', status: 'todo' }],
        },
      ],
    })
    await openDriveView()
    await selectRow('df-1')
    const create = panel()!.querySelector<HTMLButtonElement>('[data-drive-panel-create]')!
    expect(create.textContent).toBe('Tạo việc từ tài liệu')
    await click(create)
    // the first press only shows the warning
    expect(openWeb).not.toHaveBeenCalled()
    const warning = panel()!.querySelector<HTMLElement>('[data-drive-recreate]')!
    expect(warning.getAttribute('role')).toBe('status')
    expect(warning.textContent).toContain('Tài liệu này đã được dùng để tạo 3 việc')
    expect(warning.textContent).toContain('bởi Minh')
    expect(warning.textContent).toContain('Tạo thêm có thể trùng.')
    expect(create.getAttribute('aria-describedby')).toBe(warning.id)
    expect(create.textContent).toBe('Vẫn gửi cho UNI')
    // "Xem các việc đã tạo" moves focus to the tasks-created block
    await click(warning.querySelector('[data-drive-recreate-view]'))
    expect(document.activeElement).toBe(panel()!.querySelector('[data-drive-created-title]'))
    expect(warning.textContent).toContain('Xem các việc đã tạo')
    await click(create)
    expect(openWeb).toHaveBeenCalledTimes(1)
    expect(openWeb).toHaveBeenCalledWith({
      kind: 'drive-file',
      orgSlug: 'uniwork-org',
      wsSlug: 'uniwork',
      id: 'df-1',
      action: 'propose',
    })
  })

  it('Ask UNI hands off drive-file + ask; a task in the panel opens the web task', async () => {
    await openDriveView()
    await selectRow('df-1')
    await click(panel()!.querySelector('[data-drive-panel-ask]'))
    expect(openWeb).toHaveBeenLastCalledWith({
      kind: 'drive-file',
      orgSlug: 'uniwork-org',
      wsSlug: 'uniwork',
      id: 'df-1',
      action: 'ask',
    })
    await click(panel()!.querySelector('[data-drive-task="t-2"]'))
    expect(openWeb).toHaveBeenLastCalledWith({
      kind: 'task',
      orgSlug: 'uniwork-org',
      wsSlug: 'uniwork',
      id: 't-2',
    })
  })

  it('hides Unlink when the server says canUnlink is false', async () => {
    details['df-1'] = detailOf({ canUnlink: false })
    await openDriveView()
    await selectRow('df-1')
    expect(panel()!.querySelector('[data-drive-panel-open]')).not.toBeNull()
    expect(panel()!.querySelector('[data-drive-unlink]')).toBeNull()
  })

  it('Unlink asks first with the exact copy, calls unlink once, closes the panel and refetches the list', async () => {
    await openDriveView()
    await selectRow('df-1')
    await click(panel()!.querySelector('[data-drive-unlink]'))
    const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]')!
    // D3F-R1-2: the overlay sits on document.body, outside the sticky panel's stacking context
    expect(dialog.closest('.uw-act-overlay')!.parentElement).toBe(document.body)
    expect(panel()!.contains(dialog)).toBe(false)
    expect(dialog.textContent).toContain('Bỏ liên kết khỏi 2 việc?')
    expect(dialog.textContent).toContain(
      'Chỉ xóa liên kết trong UniWork, tệp trên Google Drive giữ nguyên. Các việc đã tạo vẫn còn, chỉ mất liên kết về tài liệu.',
    )
    expect(unlink).not.toHaveBeenCalled()
    const listCallsBefore = listFiles.mock.calls.length
    const connectionsBefore = listConnections.mock.calls.length
    const confirmBtn = dialog.querySelector<HTMLButtonElement>('[data-drive-unlink-confirm]')!
    // a double press sends one request
    await act(async () => {
      confirmBtn.click()
      confirmBtn.click()
    })
    await flush()
    expect(unlink).toHaveBeenCalledTimes(1)
    expect(unlink).toHaveBeenCalledWith({ workspaceId: 'ws-1', driveFileId: 'df-1' })
    expect(panel()).toBeNull()
    expect(document.querySelector('[data-drive-unlink-confirm]')).toBeNull()
    expect(listFiles.mock.calls.length).toBeGreaterThan(listCallsBefore)
    // the sidebar counts come from listConnections: read again too
    expect(listConnections.mock.calls.length).toBeGreaterThan(connectionsBefore)
    // D3F-R1-5: focus lands in the Drive view, not on <body>
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(document.querySelector('[data-drive-view]')!.contains(document.activeElement)).toBe(true)
  })

  it('a double click on a hand-off button opens the web once; a later click opens it again (D3-V2-1)', async () => {
    await openDriveView()
    const reconnect = document.querySelector<HTMLButtonElement>(
      'button[data-drive-reconnect="dc-broken"]',
    )!
    await act(async () => {
      reconnect.click()
      reconnect.click()
    })
    await flush()
    expect(openWeb).toHaveBeenCalledTimes(1)
    advance(1_500)
    await click(reconnect)
    expect(openWeb).toHaveBeenCalledTimes(2)
  })

  it('unlinking the first row focuses another live row while the list is still refreshing (D3F-R2-1)', async () => {
    await openDriveView()
    await selectRow('df-1')
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    listFiles.mockImplementation(async () => {
      await gate
      return { ok: true as const, value: { files: [fileTwo], totalCount: 1, nextCursor: null } }
    })
    await click(panel()!.querySelector('[data-drive-unlink]'))
    await click(document.querySelector('[data-drive-unlink-confirm]'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    const view = document.querySelector('[data-drive-view]')!
    const active = document.activeElement as HTMLElement
    expect(view.contains(active)).toBe(true)
    expect(active.dataset.driveFileId).toBe('df-2')
    await act(async () => {
      release()
    })
    await flush()
    expect(document.querySelector('[data-drive-file-id="df-1"]')).toBeNull()
    expect(view.contains(document.activeElement)).toBe(true)
  })

  it('an unlink error stays in the dialog with the mapped sentence', async () => {
    unlink.mockResolvedValueOnce({ ok: false, error: 'forbidden' })
    await openDriveView()
    await selectRow('df-1')
    await click(panel()!.querySelector('[data-drive-unlink]'))
    await click(document.querySelector('[data-drive-unlink-confirm]'))
    expect(unlink).toHaveBeenCalledTimes(1)
    const error = document.querySelector('[data-drive-unlink-error]')!
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.textContent).toBe('Bạn không có quyền thực hiện thao tác này.')
    expect(panel()).not.toBeNull()
    // Keep closes the dialog and leaves the panel
    await click(document.querySelector('[data-drive-unlink-keep]'))
    expect(document.querySelector('[data-drive-unlink-confirm]')).toBeNull()
    expect(panel()).not.toBeNull()
  })

  it('an unlink server_error says the unlink failed, not that the list could not load (D3-V3)', async () => {
    unlink.mockResolvedValueOnce({ ok: false, error: 'server_error' })
    await openDriveView()
    await selectRow('df-1')
    await click(panel()!.querySelector('[data-drive-unlink]'))
    await click(document.querySelector('[data-drive-unlink-confirm]'))
    expect(document.querySelector('[data-drive-unlink-error]')?.textContent).toBe(
      'Không bỏ liên kết được. Thử lại.',
    )
    expect(panel()).not.toBeNull()
  })

  it('an unlink not_found means it is already gone: dialog and panel close, the list is read again', async () => {
    unlink.mockResolvedValueOnce({ ok: false, error: 'not_found' })
    await openDriveView()
    await selectRow('df-1')
    await click(panel()!.querySelector('[data-drive-unlink]'))
    const listCallsBefore = listFiles.mock.calls.length
    await click(document.querySelector('[data-drive-unlink-confirm]'))
    expect(unlink).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-drive-unlink-error]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(panel()).toBeNull()
    expect(listFiles.mock.calls.length).toBeGreaterThan(listCallsBefore)
  })

  it('Escape while the unlink dialog is open closes only the dialog', async () => {
    await openDriveView()
    await selectRow('df-1')
    await click(panel()!.querySelector('[data-drive-unlink]'))
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(panel()).not.toBeNull()
  })

  it('"Xem các việc đã tạo" is absent when the creations block is not rendered (D3F-R1-4)', async () => {
    details['df-1'] = detailOf({
      tasksCreated: { count: 2, lastCreatedAt: '2026-10-15T10:00:00Z', lastCreatedByName: 'Minh' },
    })
    await openDriveView()
    await selectRow('df-1')
    await click(panel()!.querySelector('[data-drive-panel-create]'))
    expect(panel()!.querySelector('[data-drive-recreate]')).not.toBeNull()
    expect(panel()!.querySelector('[data-drive-created]')).toBeNull()
    expect(panel()!.querySelector('[data-drive-recreate-view]')).toBeNull()
  })

  it('canPropose / canAsk false hide Create and Ask', async () => {
    details['df-1'] = detailOf({ canPropose: false, canAsk: false })
    await openDriveView()
    await selectRow('df-1')
    expect(panel()!.querySelector('[data-drive-panel-open]')).not.toBeNull()
    expect(panel()!.querySelector('[data-drive-panel-create]')).toBeNull()
    expect(panel()!.querySelector('[data-drive-panel-ask]')).toBeNull()
  })

  it('without workspace slugs the web controls are disabled or absent and nothing is handed off', async () => {
    workspaces = [{ ...workspaces[0]!, slug: '', orgSlug: '' }]
    details['df-1'] = detailOf({ viewerAccess: 'unknown', viewerAccountEmail: undefined })
    await openDriveView()
    expect(document.querySelector<HTMLButtonElement>('[data-drive-add]')?.disabled ?? true).toBe(
      true,
    )
    await selectRow('df-1')
    expect(panel()!.querySelector('[data-drive-panel-create]')).toBeNull()
    expect(panel()!.querySelector('[data-drive-panel-ask]')).toBeNull()
    const grant = panel()!.querySelector<HTMLButtonElement>('[data-drive-grant="grant"]')!
    expect(grant.disabled).toBe(true)
    await click(grant)
    await click(panel()!.querySelector('[data-drive-task="t-1"]'))
    expect(openWeb).not.toHaveBeenCalled()
  })

  it('a window focus reads the panel again', async () => {
    await openDriveView()
    await selectRow('df-1')
    const before = getFile.mock.calls.length
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(getFile.mock.calls.length).toBeGreaterThan(before)
    expect(getHistory.mock.calls.length).toBeGreaterThan(1)
  })

  it('out-of-order getFile responses keep the file selected last', async () => {
    let releaseFirst: (v: unknown) => void = () => {}
    getFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve
        }),
    )
    await openDriveView()
    await selectRow('df-1')
    // the first response is still pending when the second file is selected
    await selectRow('df-2')
    expect(panel()!.querySelector('[data-drive-panel-title]')?.textContent).toBe(
      'Ngân sách marketing 2026',
    )
    await act(async () => {
      releaseFirst({ ok: true as const, value: details['df-1'] })
    })
    await flush()
    expect(panel()!.querySelector('[data-drive-panel-title]')?.textContent).toBe(
      'Ngân sách marketing 2026',
    )
    expect(panel()!.querySelector('[data-drive-viewer="connection_lost"]')).not.toBeNull()
  })

  it('Escape on a selected row also closes the panel (D3F-R1-10)', async () => {
    await openDriveView()
    await selectRow('df-1')
    expect(panel()).not.toBeNull()
    const row = document.querySelector<HTMLElement>('[data-drive-file-id="df-1"]')!
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(panel()).toBeNull()
  })

  it('Add / Manage / Reconnect hand off to the web with the right targets', async () => {
    await openDriveView()
    await click(document.querySelector('[data-drive-add]'))
    expect(openWeb).toHaveBeenLastCalledWith({
      kind: 'drive-pick',
      orgSlug: 'uniwork-org',
      wsSlug: 'uniwork',
    })
    await click(document.querySelector('[data-drive-manage]'))
    expect(openWeb).toHaveBeenLastCalledWith({
      kind: 'drive-connect',
      orgSlug: 'uniwork-org',
      wsSlug: 'uniwork',
    })
    // the lost-account marker is a button; Enter on it never opens the file
    const reconnect = document.querySelector<HTMLButtonElement>(
      'button[data-drive-reconnect="dc-broken"]',
    )!
    expect(reconnect).not.toBeNull()
    await act(async () => {
      reconnect.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(openOnGoogle).not.toHaveBeenCalled()
    // D3F-R1-1: nor does a double click on it
    await act(async () => {
      reconnect.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(openOnGoogle).not.toHaveBeenCalled()
    advance(1_500)
    await click(reconnect)
    expect(openWeb).toHaveBeenLastCalledWith({
      kind: 'drive-connect',
      orgSlug: 'uniwork-org',
      wsSlug: 'uniwork',
    })
    // clicking the marker does not select the row
    expect(panel()).toBeNull()
    // an account view carries accountId
    await click(document.querySelector('[data-drive-account="dc-active"]'))
    await click(document.querySelector('[data-drive-add]'))
    expect(openWeb).toHaveBeenLastCalledWith({
      kind: 'drive-pick',
      orgSlug: 'uniwork-org',
      wsSlug: 'uniwork',
      accountId: 'dc-active',
    })
    expect(document.querySelector('[data-drive-add]')?.textContent).toContain(
      'Thêm từ minh@company.vn',
    )
  })

  it('shows an error with Retry in the panel, then the file', async () => {
    getFile.mockResolvedValueOnce({ ok: false, error: 'server_error' })
    await openDriveView()
    await selectRow('df-1')
    const err = panel()!.querySelector('[data-drive-panel-error]')!
    expect(err.getAttribute('role')).toBe('alert')
    await click(err.querySelector('button'))
    expect(panel()!.querySelector('[data-drive-panel-error]')).toBeNull()
    expect(panel()!.querySelector('[data-drive-panel-open]')).not.toBeNull()
    expect(getFile).toHaveBeenCalledTimes(2)
  })

  it('shows the not-found state and reads the list again', async () => {
    getFile.mockResolvedValueOnce({ ok: false, error: 'not_found' })
    await openDriveView()
    const listCallsBefore = listFiles.mock.calls.length
    await selectRow('df-1')
    expect(panel()!.querySelector('[data-drive-panel-notfound]')?.textContent).toContain(
      'Không tìm thấy tệp này hoặc bạn không có quyền xem.',
    )
    expect(listFiles.mock.calls.length).toBeGreaterThan(listCallsBefore)
  })

  it('a connector turned off mid-session closes the Drive view back to the default section', async () => {
    getFile.mockResolvedValueOnce({ ok: false, error: 'feature_disabled' })
    await openDriveView()
    expect(document.querySelector('[data-drive-view]')).not.toBeNull()
    await selectRow('df-1')
    expect(document.querySelector('[data-drive-view]')).toBeNull()
    expect(panel()).toBeNull()
    expect(document.body.textContent).toContain('Google Drive hiện không còn khả dụng')
  })

  it('maps list errors to the app messages instead of the generic load error', async () => {
    listFiles.mockResolvedValue({ ok: false, error: 'session_expired' })
    await openDriveView()
    const text = document.querySelector('[data-drive-view]')!.textContent ?? ''
    expect(text).toContain('Phiên đăng nhập UniWork đã hết hạn. Hãy đăng nhập lại.')
    expect(text).not.toContain('Không tải được danh sách tệp Google Drive.')
  })

  it('a refresh error that keeps the rows offers Retry when there is no next page (R2-1)', async () => {
    await openDriveView()
    const onRetry = vi.fn()
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DriveList, {
            workspaceId: 'ws-1',
            connections: [activeConn],
            selectedAccountId: null,
            files: [fileOne],
            status: 'ready',
            offline: false,
            nextCursor: null,
            loadingMore: false,
            moreError: 'server_error',
            onRetry,
            onLoadMore: vi.fn(),
            onOpenOnGoogle: vi.fn(),
          }),
        ),
      )
    })
    await flush()
    const retry = document.querySelector<HTMLButtonElement>('[data-drive-retry]')!
    expect(retry).not.toBeNull()
    await click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('the loading skeleton is a table with the header columns, and a missing viewer email says why', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DriveList, {
            workspaceId: 'ws-1',
            connections: [activeConn],
            selectedAccountId: null,
            files: [],
            status: 'loading',
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
    const skeleton = document.querySelector('[data-drive-loading]')!
    expect(skeleton.querySelectorAll('thead th')).toHaveLength(5)
    expect(skeleton.querySelectorAll('tbody tr:first-child td')).toHaveLength(5)
    expect(skeleton.querySelector('thead th:nth-child(1)')?.className).toContain(
      'dh-drive-col-name',
    )

    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DriveList, {
            workspaceId: 'ws-1',
            connections: [activeConn],
            selectedAccountId: null,
            files: [{ ...fileOne, viewerAccountEmail: undefined }],
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
    expect(document.querySelector('.dh-drive-account-email')?.textContent).toBe('Chưa rõ tài khoản')
  })
})
