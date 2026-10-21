/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkResult,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DropToOpenOverlay } from '../src/renderer/src/Home'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'
import {
  createFakeFolderUploadBridge,
  preflightOf,
  type FakeFolderUploadBridge,
} from './folder-upload-fake-bridge'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

interface FakeItem {
  kind: 'file'
  file: { name: string }
  isDirectory: boolean | undefined
}

/** a dropped file or folder the way the DataTransfer lists it */
const droppedFile = (name: string): FakeItem => ({
  kind: 'file',
  file: { name },
  isDirectory: false,
})
const droppedFolder = (name: string): FakeItem => ({
  kind: 'file',
  file: { name },
  isDirectory: true,
})

/** a drag event with the parts of a DataTransfer the library list reads */
function dragEvent(type: string, items: FakeItem[], types: string[] = ['Files']): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types,
      dropEffect: 'none',
      items: items.map((item) => ({
        kind: item.kind,
        getAsFile: () => item.file,
        webkitGetAsEntry: () =>
          item.isDirectory === undefined ? null : { isDirectory: item.isDirectory },
      })),
      files: items.map((item) => item.file),
    },
  })
  return event
}

describe('folder / multi-file upload in the Documents home', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let bridge: FakeFolderUploadBridge
  let workspaces: UniworkWorkspaceRef[]
  let onOpenDocument: ReturnType<typeof vi.fn>

  const rootItems: DocumentsHomeDoc[] = [
    {
      id: 'doc-1',
      workspaceId: 'ws-1',
      title: 'Báo cáo Q3.docx',
      format: 'docx',
      updatedAt: '2026-10-17T08:00:00.000Z',
      kind: 'file',
      parentId: null,
      visibility: 'private',
      myLevel: 'manage',
    },
  ]
  const tree: UniworkFolderNode[] = [
    {
      id: 'f-mine',
      parentId: null,
      title: 'My Folder',
      position: 0,
      systemKind: 'my_folder',
      children: [],
    } as UniworkFolderNode,
  ]

  async function mount(): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument,
            sidebarHost: sidebarSlot,
          }),
          createElement(UniworkLiveHost),
        ),
      )
    })
    await flush()
  }

  const library = () => host.querySelector<HTMLElement>('.dh-main')!
  const uploadButton = () => host.querySelector<HTMLButtonElement>('button.dh-btn-upload')!
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const click = async (el: Element | null | undefined) => {
    expect(el, 'element to click').toBeTruthy()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
    await flush()
  }
  const drop = async (items: FakeItem[]): Promise<Event> => {
    const event = dragEvent('drop', items)
    await act(async () => {
      library().dispatchEvent(event)
    })
    await flush()
    return event
  }
  const menuItem = (kind: 'files' | 'folder') =>
    document.querySelector<HTMLElement>(`[role="menuitem"][data-upload-kind="${kind}"]`)

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    resetLiveForTests()
    workspaces = [{ id: 'ws-1', name: 'Công ty UniWork', slug: 'uniwork' }]
    onOpenDocument = vi.fn()
    bridge = createFakeFolderUploadBridge()
    api = {
      accountStatus: vi.fn(async () => ({
        state: 'signed-in' as const,
        loggedIn: true,
        email: 'minh@uniwork.vn',
        profile: {
          accountId: 'acc-1',
          email: 'minh@uniwork.vn',
          name: 'Minh Trần',
          orgId: 'org-1',
          orgName: 'Công ty UniWork',
          workspaces,
        },
      })),
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async () => ok(tree)),
      uniworkEnsureMyFolder: vi.fn(async () => ok({ ...tree[0]!, kind: 'my_folder' })),
      uniworkListChildren: vi.fn(async (): Promise<UniworkResult<UniworkFolderChildren>> =>
        ok({ items: rootItems, nextCursor: null }),
      ),
      uniworkListDocuments: vi.fn(async () => ok({ documents: rootItems, nextCursor: null })),
      uniworkListSharedWithMe: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListSharedByMe: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListTrash: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
      // the preload's webUtils helper: the dropped File here is a plain object with a name
      getPathForFile: vi.fn((file: { name: string }) => `/disk/${file.name}`),
      uniworkPickUploadFile: vi.fn(async () => ({ path: '/disk/one.docx', name: 'one.docx' })),
      uniworkUploadDocument: vi.fn(async () =>
        ok({
          id: 'doc-up',
          workspaceId: 'ws-1',
          title: 'one.docx',
          format: 'docx',
          updatedAt: '2026-10-18T10:00:00.000Z',
          kind: 'file',
          parentId: 'f-mine',
        }),
      ),
    }
    const w = window as unknown as Record<string, unknown>
    w.aiOffice = api
    w.home = api
    w.uniworkFolderUpload = bridge
    host = document.createElement('div')
    sidebarSlot = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(sidebarSlot)
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    delete (window as unknown as Record<string, unknown>).uniworkFolderUpload
    host.remove()
    sidebarSlot.remove()
  })

  describe('the Upload entry point', () => {
    it('opens a small menu with "Tải lên tệp" and "Tải lên thư mục"', async () => {
      await mount()
      const button = uploadButton()
      expect(button.textContent).toContain('Tải lên')
      expect(button.getAttribute('aria-haspopup')).toBe('menu')
      expect(button.getAttribute('aria-expanded')).toBe('false')
      await click(button)
      expect(button.getAttribute('aria-expanded')).toBe('true')
      const menu = document.querySelector('[role="menu"]')!
      expect(menu.getAttribute('aria-label')).toBe('Tải lên')
      expect(
        Array.from(menu.querySelectorAll('[role="menuitem"]')).map((i) => i.textContent),
      ).toEqual(['Tải lên tệp', 'Tải lên thư mục'])
    })

    it('"Tải lên tệp" opens the upload dialog', async () => {
      await mount()
      await click(uploadButton())
      await click(menuItem('files'))
      expect(dialog()?.querySelector('h3')?.textContent).toBe('Tải lên')
      expect(dialog()?.querySelector('.uw-act-file button')?.textContent).toBe('Chọn tệp')
      expect(document.querySelector('[role="menu"]')).toBeNull()
    })

    it('"Tải lên thư mục" opens the folder picker for the folder on screen and stages the pre-flight', async () => {
      bridge.pick.mockResolvedValueOnce(preflightOf({ rootName: 'Hồ sơ 2052' }))
      await mount()
      await click(uploadButton())
      await click(menuItem('folder'))
      expect(bridge.pick).toHaveBeenCalledTimes(1)
      expect(bridge.pick.mock.calls[0]![0]).toMatchObject({ workspaceId: 'ws-1', mode: 'folder' })
      expect(dialog()?.querySelector('[data-testid="folder-upload-root"]')?.textContent).toBe(
        'Hồ sơ 2052',
      )
    })

    it('the menu is a menu button: arrows move, Esc closes and hands the focus back', async () => {
      await mount()
      await click(uploadButton())
      expect(document.activeElement).toBe(menuItem('files'))
      await act(async () => {
        document
          .querySelector('[role="menu"]')!
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      expect(document.activeElement).toBe(menuItem('folder'))
      await act(async () => {
        document
          .querySelector('[role="menu"]')!
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(document.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(uploadButton())
    })

    it('with no folder support on the server the button opens the upload dialog straight away', async () => {
      ;(window as unknown as Record<string, unknown>).uniworkFolderUpload =
        createFakeFolderUploadBridge({ folders: false })
      await mount()
      expect(uploadButton().getAttribute('aria-haspopup')).toBeNull()
      await click(uploadButton())
      expect(document.querySelector('[role="menu"]')).toBeNull()
      expect(dialog()?.querySelector('h3')?.textContent).toBe('Tải lên')
    })

    it('with no bridge at all (an older main) nothing changes', async () => {
      delete (window as unknown as Record<string, unknown>).uniworkFolderUpload
      await mount()
      expect(uploadButton().getAttribute('aria-haspopup')).toBeNull()
      await click(uploadButton())
      expect(dialog()?.querySelector('h3')?.textContent).toBe('Tải lên')
    })
  })

  describe('"Chọn tệp" takes several files', () => {
    const openDialog = async () => {
      await mount()
      await click(uploadButton())
      // without the bridge the button opens the dialog by itself
      if (menuItem('files')) await click(menuItem('files'))
    }

    it('asks the bridge for the files picker with the location the dialog holds', async () => {
      bridge.pick.mockResolvedValueOnce(
        preflightOf({
          mode: 'files',
          rootName: undefined,
          totals: { files: 3, bytes: 3 * 1024 * 1024 },
        }),
      )
      await openDialog()
      await click(dialog()!.querySelector('.uw-act-file button'))
      // exactly the contract's three fields, whatever else the dialog's target carries
      expect(bridge.pick).toHaveBeenCalledTimes(1)
      expect(Object.keys(bridge.pick.mock.calls[0]![0]).sort()).toEqual([
        'folderId',
        'mode',
        'workspaceId',
      ])
      expect(bridge.pick.mock.calls[0]![0]).toMatchObject({ workspaceId: 'ws-1', mode: 'files' })
      // the single-file picker is not used any more
      expect(api.uniworkPickUploadFile).not.toHaveBeenCalled()
    })

    it('two or more files: the upload dialog hands over to the files pre-flight', async () => {
      bridge.pick.mockResolvedValueOnce(
        preflightOf({
          mode: 'files',
          rootName: undefined,
          totals: { files: 3, bytes: 3 * 1024 * 1024 },
        }),
      )
      await openDialog()
      await click(dialog()!.querySelector('.uw-act-file button'))
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
      const preflight = dialog()!
      expect(
        preflight.querySelector('[data-testid="folder-upload-dialog"]')?.getAttribute('data-mode'),
      ).toBe('files')
      expect(preflight.querySelector('[data-testid="folder-upload-summary"]')?.textContent).toBe(
        '3 tệp · 3 MB',
      )
    })

    it('a canceled picker leaves the upload dialog as it was', async () => {
      await openDialog()
      await click(dialog()!.querySelector('.uw-act-file button'))
      expect(dialog()?.querySelector('h3')?.textContent).toBe('Tải lên')
      expect(dialog()?.querySelector('[data-testid="folder-upload-dialog"]')).toBeNull()
    })

    it('with no bridge the single-file picker and flow stay as they were', async () => {
      delete (window as unknown as Record<string, unknown>).uniworkFolderUpload
      await openDialog()
      await click(dialog()!.querySelector('.uw-act-file button'))
      expect(api.uniworkPickUploadFile).toHaveBeenCalledTimes(1)
      expect(dialog()?.querySelector('.uw-act-file-name')?.textContent).toBe('one.docx')
    })
  })

  describe('dropping on the library list', () => {
    it('shows the drop overlay with the destination while files hover, and takes it away on drop', async () => {
      await mount()
      expect(host.querySelector('[data-testid="folder-upload-drop"]')).toBeNull()
      await act(async () => {
        library().dispatchEvent(dragEvent('dragenter', [droppedFile('a.docx')]))
      })
      const overlay = host.querySelector('[data-testid="folder-upload-drop"]')!
      expect(overlay.textContent).toContain('Thả để tải lên')
      expect(overlay.textContent).toContain('Thư mục của tôi')
      await drop([droppedFile('a.docx')])
      expect(host.querySelector('[data-testid="folder-upload-drop"]')).toBeNull()
    })

    it('a text drag shows nothing and is left alone', async () => {
      await mount()
      const event = dragEvent('dragenter', [], ['text/plain'])
      await act(async () => {
        library().dispatchEvent(event)
      })
      expect(host.querySelector('[data-testid="folder-upload-drop"]')).toBeNull()
      expect(dragEvent('drop', [], ['text/plain']).defaultPrevented).toBe(false)
    })

    it('the overlay stays while the drag moves over children and goes when it leaves the list', async () => {
      await mount()
      const files = [droppedFile('a.docx')]
      await act(async () => {
        library().dispatchEvent(dragEvent('dragenter', files))
        library().dispatchEvent(dragEvent('dragenter', files))
        library().dispatchEvent(dragEvent('dragleave', files))
      })
      expect(host.querySelector('[data-testid="folder-upload-drop"]')).not.toBeNull()
      await act(async () => {
        library().dispatchEvent(dragEvent('dragleave', files))
      })
      expect(host.querySelector('[data-testid="folder-upload-drop"]')).toBeNull()
    })

    it('one file goes through the bridge like every other drop and starts at once', async () => {
      bridge.preflight.mockResolvedValueOnce([
        preflightOf({
          mode: 'files',
          rootName: undefined,
          totals: { files: 1, bytes: 1024 },
        }),
      ])
      await mount()
      const event = await drop([droppedFile('one.docx')])
      // cancelled here so the window-level drop-to-open bridge stays out of the way
      expect(event.defaultPrevented).toBe(true)
      expect(bridge.preflight).toHaveBeenCalledTimes(1)
      expect(bridge.preflight.mock.calls[0]![0]).toMatchObject({
        workspaceId: 'ws-1',
        paths: ['/disk/one.docx'],
      })
      // a clean single file needs no pre-flight dialog: the overall bar (with its cancel) is up
      expect(bridge.start).toHaveBeenCalledTimes(1)
      expect(host.ownerDocument.querySelector('[data-testid="folder-upload-bar"]')).not.toBeNull()
      expect(api.uniworkUploadDocument).not.toHaveBeenCalled()
    })

    it("with no bridge one file keeps today's single-file upload into the open place", async () => {
      delete (window as unknown as Record<string, unknown>).uniworkFolderUpload
      await mount()
      const event = await drop([droppedFile('one.docx')])
      expect(event.defaultPrevented).toBe(true)
      expect(api.uniworkUploadDocument).toHaveBeenCalledTimes(1)
      expect(api.uniworkUploadDocument.mock.calls[0]![0]).toMatchObject({
        workspaceId: 'ws-1',
        folderId: 'f-mine',
        path: '/disk/one.docx',
      })
      expect(onOpenDocument).toHaveBeenCalledTimes(1)
    })

    it('with no bridge a refused single file is said in a toast', async () => {
      delete (window as unknown as Record<string, unknown>).uniworkFolderUpload
      api.uniworkUploadDocument.mockResolvedValueOnce({ ok: false, error: 'unsupported_format' })
      await mount()
      await drop([droppedFile('one.zip')])
      expect(document.querySelector('.uw-act-toast[role="alert"]')).not.toBeNull()
      expect(onOpenDocument).not.toHaveBeenCalled()
    })

    it('two or more files go to ONE files pre-flight', async () => {
      bridge.preflight.mockResolvedValueOnce([
        preflightOf({
          mode: 'files',
          rootName: undefined,
          totals: { files: 2, bytes: 2 * 1024 * 1024 },
        }),
      ])
      await mount()
      await drop([droppedFile('a.docx'), droppedFile('b.xlsx')])
      expect(bridge.preflight).toHaveBeenCalledTimes(1)
      expect(bridge.preflight.mock.calls[0]![0]).toMatchObject({
        workspaceId: 'ws-1',
        paths: ['/disk/a.docx', '/disk/b.xlsx'],
      })
      expect(api.uniworkUploadDocument).not.toHaveBeenCalled()
      expect(
        dialog()?.querySelector('[data-testid="folder-upload-dialog"]')?.getAttribute('data-mode'),
      ).toBe('files')
    })

    it('each folder gets its own pre-flight, in the order dropped', async () => {
      bridge.preflight.mockResolvedValueOnce([
        preflightOf({ preflightId: 'pf-b', rootName: 'B' }),
        preflightOf({ preflightId: 'pf-a', rootName: 'A' }),
      ])
      await mount()
      await drop([droppedFolder('B'), droppedFolder('A')])
      expect(bridge.preflight.mock.calls[0]![0]).toMatchObject({ paths: ['/disk/B', '/disk/A'] })
      expect(dialog()?.querySelector('[data-testid="folder-upload-root"]')?.textContent).toBe('B')
      expect(dialog()?.textContent).toContain('Còn 1 lượt tải lên đang chờ.')
      await click(
        Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent === 'Hủy'),
      )
      expect(dialog()?.querySelector('[data-testid="folder-upload-root"]')?.textContent).toBe('A')
    })

    it('a mixed drop sends the loose files first, then each folder', async () => {
      bridge.preflight.mockResolvedValueOnce([
        preflightOf({ preflightId: 'pf-f', mode: 'files', rootName: undefined }),
        preflightOf({ preflightId: 'pf-1', rootName: 'B' }),
        preflightOf({ preflightId: 'pf-2', rootName: 'A' }),
      ])
      await mount()
      await drop([
        droppedFolder('B'),
        droppedFile('a.docx'),
        droppedFolder('A'),
        droppedFile('b.md'),
      ])
      expect(bridge.preflight.mock.calls[0]![0]).toMatchObject({
        paths: ['/disk/a.docx', '/disk/b.md', '/disk/B', '/disk/A'],
      })
      expect(
        dialog()?.querySelector('[data-testid="folder-upload-dialog"]')?.getAttribute('data-mode'),
      ).toBe('files')
      expect(dialog()?.textContent).toContain('Còn 2 lượt tải lên đang chờ.')
    })

    it('a file and a folder together are not the single-file flow', async () => {
      bridge.preflight.mockResolvedValueOnce([preflightOf()])
      await mount()
      await drop([droppedFile('a.docx'), droppedFolder('A')])
      expect(bridge.preflight).toHaveBeenCalledTimes(1)
      expect(api.uniworkUploadDocument).not.toHaveBeenCalled()
    })

    it('a dropped folder is told apart from a file even when the host cannot say', async () => {
      bridge.preflight.mockResolvedValueOnce([preflightOf()])
      await mount()
      await drop([{ kind: 'file', file: { name: 'mystery' }, isDirectory: undefined }])
      // not taken for a file: main checks the path on disk
      expect(bridge.preflight.mock.calls[0]![0]).toMatchObject({ paths: ['/disk/mystery'] })
      expect(api.uniworkUploadDocument).not.toHaveBeenCalled()
    })

    it('when the server has no folder support a dropped folder is said not to be possible, the files still go', async () => {
      ;(window as unknown as Record<string, unknown>).uniworkFolderUpload = bridge =
        createFakeFolderUploadBridge({ folders: false })
      bridge.preflight.mockResolvedValueOnce([
        preflightOf({ mode: 'files', rootName: undefined, totals: { files: 2, bytes: 100 } }),
      ])
      await mount()
      await drop([droppedFile('a.docx'), droppedFile('b.docx'), droppedFolder('A')])
      expect(document.querySelector('.uw-act-toast[role="alert"]')?.textContent).toContain(
        'Hãy kéo thả từng tệp.',
      )
      expect(bridge.preflight.mock.calls[0]![0]).toMatchObject({
        paths: ['/disk/a.docx', '/disk/b.docx'],
      })
    })

    it('when only a folder is dropped and folders are not possible nothing goes to main', async () => {
      ;(window as unknown as Record<string, unknown>).uniworkFolderUpload = bridge =
        createFakeFolderUploadBridge({ folders: false })
      await mount()
      await drop([droppedFolder('A')])
      expect(bridge.preflight).not.toHaveBeenCalled()
      expect(document.querySelector('.uw-act-toast[role="alert"]')).not.toBeNull()
    })

    it('with no bridge several files cannot be taken, and a toast says so', async () => {
      delete (window as unknown as Record<string, unknown>).uniworkFolderUpload
      await mount()
      await drop([droppedFile('a.docx'), droppedFile('b.docx')])
      expect(api.uniworkUploadDocument).not.toHaveBeenCalled()
      expect(document.querySelector('.uw-act-toast[role="alert"]')).not.toBeNull()
    })

    it('where Upload does not apply the zone is not a zone: nothing is taken and drop-to-open keeps working', async () => {
      await mount()
      await click(sidebarSlot.querySelector('[data-nav="trash"]'))
      const event = await drop([droppedFile('a.docx'), droppedFile('b.docx')])
      expect(event.defaultPrevented).toBe(false)
      expect(bridge.preflight).not.toHaveBeenCalled()
      expect(host.querySelector('[data-testid="folder-upload-drop"]')).toBeNull()
    })

    it('does not take a drop while the upload dialog is open', async () => {
      await mount()
      await click(uploadButton())
      await click(menuItem('files'))
      const event = await drop([droppedFile('a.docx'), droppedFile('b.docx')])
      expect(event.defaultPrevented).toBe(false)
      expect(bridge.preflight).not.toHaveBeenCalled()
    })
  })

  describe('Home\'s "Drop to open" overlay next to the zone', () => {
    // the overlay listens on window like in Home; mounted beside the host so a real library drag reaches both
    async function mountWithOverlay(): Promise<void> {
      await mount()
      const overlayHost = document.createElement('div')
      document.body.appendChild(overlayHost)
      overlayRoot = createRoot(overlayHost)
      await act(async () => {
        overlayRoot!.render(
          createElement(LocaleProvider, { initial: 'vi' }, createElement(DropToOpenOverlay)),
        )
      })
    }
    let overlayRoot: Root | null = null
    const homeOverlay = () => document.querySelector('.home-drop-overlay')
    afterEach(async () => {
      if (overlayRoot) {
        const r = overlayRoot
        await act(async () => r.unmount())
        overlayRoot = null
      }
    })

    it('stays hidden while the library zone owns the drag, and the zone card shows', async () => {
      await mountWithOverlay()
      await act(async () => {
        library().dispatchEvent(dragEvent('dragenter', [droppedFile('a.docx')]))
      })
      expect(host.querySelector('[data-testid="folder-upload-drop"]')).not.toBeNull()
      expect(homeOverlay()).toBeNull()
      await act(async () => {
        library().dispatchEvent(dragEvent('dragleave', [droppedFile('a.docx')]))
      })
      expect(homeOverlay()).toBeNull()
    })

    it('still shows for a file drag outside the zone', async () => {
      await mountWithOverlay()
      await act(async () => {
        sidebarSlot.dispatchEvent(dragEvent('dragenter', [droppedFile('a.docx')]))
      })
      expect(homeOverlay()).not.toBeNull()
    })

    it('shows again when the drag leaves the zone for the rest of the window', async () => {
      await mountWithOverlay()
      const files = [droppedFile('a.docx')]
      await act(async () => {
        sidebarSlot.dispatchEvent(dragEvent('dragenter', files))
        // moving into the zone: the new element is entered first, then the old one is left
        library().dispatchEvent(dragEvent('dragenter', files))
        sidebarSlot.dispatchEvent(dragEvent('dragleave', files))
      })
      expect(homeOverlay()).toBeNull()
      await act(async () => {
        // and out again
        sidebarSlot.dispatchEvent(dragEvent('dragenter', files))
        library().dispatchEvent(dragEvent('dragleave', files))
      })
      expect(homeOverlay()).not.toBeNull()
    })

    it('still shows over the list where the zone is not a zone', async () => {
      await mountWithOverlay()
      await click(sidebarSlot.querySelector('[data-nav="trash"]'))
      await act(async () => {
        library().dispatchEvent(dragEvent('dragenter', [droppedFile('a.docx')]))
      })
      expect(homeOverlay()).not.toBeNull()
    })
  })

  describe('a folder the user may not edit', () => {
    const folderItems: DocumentsHomeDoc[] = [
      {
        id: 'f-ro',
        workspaceId: 'ws-1',
        title: 'Chỉ xem',
        kind: 'folder',
        parentId: null,
        updatedAt: '2026-10-17T08:00:00.000Z',
        canEdit: false,
      } as DocumentsHomeDoc,
      {
        id: 'f-rw',
        workspaceId: 'ws-1',
        title: 'Được sửa',
        kind: 'folder',
        parentId: null,
        updatedAt: '2026-10-17T08:00:00.000Z',
        canEdit: true,
      } as DocumentsHomeDoc,
    ]
    const openCard = async (id: string) => {
      api.uniworkListChildren.mockResolvedValue(ok({ items: folderItems, nextCursor: null }))
      await mount()
      await click(sidebarSlot.querySelector('[data-nav="workspace"]'))
      await click(host.querySelector(`.dh-folder-card[data-folder-id="${id}"] .dh-folder-open`))
      api.uniworkListChildren.mockResolvedValue(ok({ items: [], nextCursor: null }))
    }

    it('is not a drop zone: nothing is taken and drop-to-open keeps working', async () => {
      await openCard('f-ro')
      const event = await drop([droppedFile('a.docx'), droppedFile('b.docx')])
      expect(event.defaultPrevented).toBe(false)
      expect(bridge.preflight).not.toHaveBeenCalled()
      await act(async () => {
        library().dispatchEvent(dragEvent('dragenter', [droppedFile('a.docx')]))
      })
      expect(host.querySelector('[data-testid="folder-upload-drop"]')).toBeNull()
    })

    it('a folder the user may edit takes the drop', async () => {
      bridge.preflight.mockResolvedValueOnce([preflightOf({ mode: 'files', rootName: undefined })])
      await openCard('f-rw')
      const event = await drop([droppedFile('a.docx'), droppedFile('b.docx')])
      expect(event.defaultPrevented).toBe(true)
      expect(bridge.preflight).toHaveBeenCalledTimes(1)
    })
  })
})
