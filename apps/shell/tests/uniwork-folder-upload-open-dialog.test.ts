/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, UniworkDocListPage, UniworkFolderChildren } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkOpenDialog } from '../src/renderer/src/UniworkOpenDialog'
import {
  createFakeFolderUploadBridge,
  preflightOf,
  progressOf,
  type FakeFolderUploadBridge,
} from './folder-upload-fake-bridge'

/**
 * UNI-2052: the Open dialog's Upload button is the same small menu as the
 * Documents toolbar's ("Upload files" / "Upload folder"), only shown when the
 * folder-upload bridge is there and the server takes folders; "Choose a file"
 * in the upload form takes several files.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T) => ({ ok: true as const, value })

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>
let bridge: FakeFolderUploadBridge

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

const headButton = () =>
  document.querySelector<HTMLButtonElement>('.uw-pick-actions button.btn-secondary')!
const menuItem = (kind: 'files' | 'folder') =>
  document.querySelector<HTMLElement>(`[role="menuitem"][data-upload-kind="${kind}"]`)
const click = async (el: Element | null | undefined) => {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => (el as HTMLElement).click())
  await flush()
}

async function mount() {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(UniworkOpenDialog, {
          onClose: vi.fn(),
          accountView: 'signed-in',
          onSignIn: () => undefined,
        }),
      ),
    )
  })
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  bridge = createFakeFolderUploadBridge()
  api = {
    uniworkListWorkspaces: vi.fn(async () =>
      ok([
        { id: 'w1', name: 'Sales', orgId: 'o1', myRole: 'admin', slug: 'sales', orgSlug: 'acme' },
      ]),
    ),
    uniworkListDocuments: vi.fn(async () =>
      ok<UniworkDocListPage>({ documents: [], nextCursor: null }),
    ),
    uniworkListSharedWithMe: vi.fn(async () =>
      ok<UniworkDocListPage>({ documents: [], nextCursor: null }),
    ),
    uniworkFolderTree: vi.fn(async () => ok([])),
    uniworkListChildren: vi.fn(async () =>
      ok<UniworkFolderChildren>({ items: [], nextCursor: null }),
    ),
    uniworkSearchDocuments: vi.fn(async () =>
      ok<UniworkFolderChildren>({ items: [], nextCursor: null }),
    ),
    uniworkPickUploadFile: vi.fn(async () => null),
    onUniworkDocRenamed: vi.fn(() => () => undefined),
    onUniworkUploadProgress: vi.fn(() => () => undefined),
    onUniworkTreeChanged: vi.fn(() => () => undefined),
  }
  window.aiOffice = api as unknown as HomeApi as Window['aiOffice']
  ;(window as unknown as { uniworkWork: unknown }).uniworkWork = {
    openWeb: vi.fn(async () => true),
  }
  ;(window as unknown as Record<string, unknown>).uniworkFolderUpload = bridge
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
  delete (window as unknown as Record<string, unknown>).uniworkFolderUpload
})

describe('Upload in the Open dialog (UNI-2052)', () => {
  it('is a menu with "Upload files" and "Upload folder"', async () => {
    await mount()
    expect(headButton().textContent).toBe('Upload')
    expect(headButton().getAttribute('aria-haspopup')).toBe('menu')
    await click(headButton())
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]')).map((i) => i.textContent),
    ).toEqual(['Upload files', 'Upload folder'])
  })

  it('"Upload folder" opens the folder picker for the workspace and stages the pre-flight', async () => {
    bridge.pick.mockResolvedValueOnce(preflightOf({ rootName: 'Contracts' }))
    await mount()
    await click(headButton())
    await click(menuItem('folder'))
    expect(bridge.pick).toHaveBeenCalledWith({ workspaceId: 'w1', folderId: null, mode: 'folder' })
    expect(document.querySelector('[data-testid="folder-upload-root"]')?.textContent).toBe(
      'Contracts',
    )
  })

  it('"Upload files" opens the upload form, whose picker takes several files', async () => {
    bridge.pick.mockResolvedValueOnce(
      preflightOf({ mode: 'files', rootName: undefined, totals: { files: 4, bytes: 4096 } }),
    )
    await mount()
    await click(headButton())
    await click(menuItem('files'))
    await click(document.querySelector('.uw-act-file button'))
    expect(bridge.pick).toHaveBeenCalledWith({ workspaceId: 'w1', folderId: null, mode: 'files' })
    expect(api.uniworkPickUploadFile).not.toHaveBeenCalled()
    expect(
      document.querySelector('[data-testid="folder-upload-dialog"]')?.getAttribute('data-mode'),
    ).toBe('files')
  })

  it('is the plain Upload button when the server takes no folders', async () => {
    ;(window as unknown as Record<string, unknown>).uniworkFolderUpload =
      createFakeFolderUploadBridge({ folders: false })
    await mount()
    expect(headButton().getAttribute('aria-haspopup')).toBeNull()
    await click(headButton())
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.querySelector('.uw-act-file button')).not.toBeNull()
  })

  it('is the plain Upload button with no bridge, and the single-file picker as before', async () => {
    delete (window as unknown as Record<string, unknown>).uniworkFolderUpload
    await mount()
    expect(headButton().getAttribute('aria-haspopup')).toBeNull()
    await click(headButton())
    await click(document.querySelector('.uw-act-file button'))
    expect(api.uniworkPickUploadFile).toHaveBeenCalledTimes(1)
  })

  it('a finished run refreshes the picker list, which the run itself never touched', async () => {
    bridge.pick.mockResolvedValueOnce(preflightOf({ rootName: 'Contracts' }))
    await mount()
    const listedBefore = api.uniworkListDocuments.mock.calls.length
    await click(headButton())
    await click(menuItem('folder'))
    const confirm = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="folder-upload-dialog"] button'),
    ).find((b) => b.textContent?.trim() === 'Upload')
    await click(confirm)
    expect(bridge.start).toHaveBeenCalledTimes(1)
    // nothing is listed again while the run is still going
    expect(api.uniworkListDocuments.mock.calls.length).toBe(listedBefore)
    await act(async () => bridge.emit(progressOf({ phase: 'done', done: 40, total: 40 })))
    await flush()
    expect(api.uniworkListDocuments.mock.calls.length).toBe(listedBefore + 1)
  })
})
