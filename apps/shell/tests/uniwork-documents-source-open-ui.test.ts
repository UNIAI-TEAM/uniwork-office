/**
 * @vitest-environment jsdom
 */
import { Fragment, act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UniworkFolderNode,
  UniworkLaunchEvent,
  UniworkResult,
  UniworkSourceFile,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import { onUniworkNotice } from '../src/renderer/src/uniwork-notice-bus'

/**
 * UNI-1993 (UW-SOURCE-RO) contract 3.1 / 3.4 / test 7: a source row's primary action (click on the
 * name, double-click on the row) is Open (view only) when the server and an editor module allow it,
 * else Download; the ··· menu lists "Mở (chỉ xem)" first and only for those rows; every failure of
 * the open ends in the toast / notice the contract names, and a vanished file reloads the list.
 */

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

const source = (over: Partial<UniworkSourceFile> & { id: string }): UniworkSourceFile => ({
  source: 'task',
  parent: { kind: 'task', id: 'task-secret-id', title: 'Chuẩn bị họp HĐQT' },
  name: `${over.id}.docx`,
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  extension: 'docx',
  sizeBytes: 325632,
  updatedAt: '2026-10-18T08:00:00.000Z',
  owner: { id: 'u-minh', name: 'Minh Trần' },
  canOpenInApp: true,
  canSave: false,
  ...over,
})

const OPEN_INPUT = {
  workspaceId: 'ws-1',
  sourceId: 'src-docx',
  name: 'Biên bản họp.docx',
  extension: 'docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sizeBytes: 325632,
  updatedAt: '2026-10-19T08:00:00.000Z',
  origin: 'task',
  parent: { kind: 'task', title: 'Chuẩn bị họp HĐQT' },
}

describe('UNI-1993 Documents home: open a source file view only', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let sources: UniworkSourceFile[]
  const workspaces: UniworkWorkspaceRef[] = [
    { id: 'ws-1', name: 'Công ty UniWork', slug: 'uniwork' },
  ]
  const tree: UniworkFolderNode[] = []
  let notices: UniworkLaunchEvent[]
  let offNotice: () => void

  beforeEach(() => {
    resetLiveForTests()
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    sources = [
      source({
        id: 'src-docx',
        name: 'Biên bản họp.docx',
        updatedAt: '2026-10-19T08:00:00.000Z',
      }),
      source({
        id: 'src-doc',
        name: 'Hợp đồng cũ.doc',
        extension: 'doc',
        mimeType: 'application/msword',
        updatedAt: '2026-10-18T08:00:00.000Z',
        canOpenInApp: false,
      }),
      source({
        id: 'src-pdf',
        name: 'Báo giá.pdf',
        extension: 'pdf',
        mimeType: 'application/pdf',
        source: 'email',
        parent: { kind: 'email', id: 'mail-1', title: 'Re: Báo giá Q4' },
        updatedAt: '2026-10-17T08:00:00.000Z',
      }),
    ]
    api = {
      accountStatus: vi.fn(async () => ({ state: 'signed-in' as const, loggedIn: true })),
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async () => ok(tree)),
      uniworkEnsureMyFolder: vi.fn(async () =>
        ok({ id: 'f-mine', parentId: null, title: 'My Folder', position: 0, children: [] }),
      ),
      uniworkListChildren: vi.fn(async () => ok({ items: [] as DocumentsHomeDoc[], nextCursor: null })),
      uniworkListSources: vi.fn(async () => ok({ items: sources, nextCursor: null })),
      uniworkOpenSource: vi.fn(async () => ok({ path: '/tmp/x/Biên bản họp.docx', reused: false })),
      uniworkDownloadSource: vi.fn(async () => ok({ path: '/home/me/Downloads/x' })),
      revealPath: vi.fn(async () => undefined),
      uniworkListDocuments: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListSharedWithMe: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListSharedByMe: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListTrash: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
    }
    ;(window as unknown as { aiOffice: unknown; home: unknown }).aiOffice = api
    ;(window as unknown as { aiOffice: unknown; home: unknown }).home = api
    notices = []
    offNotice = onUniworkNotice((event) => notices.push(event))
    host = document.createElement('div')
    sidebarSlot = document.createElement('div')
    document.body.appendChild(sidebarSlot)
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    offNotice()
    await act(async () => {
      root.unmount()
    })
    host.remove()
    sidebarSlot.remove()
  })

  async function renderHome(lang: 'vi' | 'en' = 'vi') {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(
            Fragment,
            null,
            createElement(UniworkLiveHost),
            createElement(DocumentsHome, {
              workspaceId: 'ws-1',
              workspaces,
              onWorkspaceChange: vi.fn(),
              onOpenDocument: vi.fn(),
              sidebarHost: sidebarSlot,
            }),
          ),
        ),
      )
    })
    await flush()
  }

  const rowOf = (id: string) =>
    host.querySelector<HTMLElement>(`.dh-doc-row[data-source-id="${id}"]`)!
  const nameButton = (id: string) => rowOf(id).querySelector<HTMLButtonElement>('.dh-doc-open')!
  const toastText = () => document.querySelector('.uw-act-toast')?.textContent ?? ''

  async function openMenuOf(id: string): Promise<string[]> {
    await act(async () => {
      rowOf(id).querySelector<HTMLButtonElement>('.dh-cell-actions button')!.click()
    })
    return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (el) => el.textContent?.trim() ?? '',
    )
  }
  async function pickMenuItem(label: string): Promise<void> {
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === label,
    )
    expect(item, `menu item ${label}`).toBeDefined()
    await act(async () => {
      item!.click()
    })
    await flush()
  }

  async function failOpenWith(
    error: string,
    id = 'src-docx',
  ): Promise<void> {
    api.uniworkOpenSource.mockResolvedValueOnce({ ok: false, error })
    await act(async () => {
      nameButton(id).click()
    })
    await flush()
  }

  it('click on the name opens an openable row view only, with the row facts and a title-only parent', async () => {
    await renderHome()
    await act(async () => {
      nameButton('src-docx').click()
    })
    await flush()
    expect(api.uniworkOpenSource).toHaveBeenCalledTimes(1)
    expect(api.uniworkOpenSource).toHaveBeenCalledWith(OPEN_INPUT)
    // never the id of the parent, never a download
    expect(JSON.stringify(api.uniworkOpenSource.mock.calls[0])).not.toContain('task-secret-id')
    expect(api.uniworkDownloadSource).not.toHaveBeenCalled()
    // a successful open says nothing: the tab is the answer
    expect(toastText()).toBe('')
  })

  it('the name is a real button, so Enter and Space open it (the keyboard path of the primary action)', async () => {
    await renderHome()
    const button = nameButton('src-docx')
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
  })

  it('a double click on the row opens it; the menu cell does not', async () => {
    await renderHome()
    await act(async () => {
      rowOf('src-docx').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkOpenSource).toHaveBeenCalledTimes(1)
    expect(api.uniworkDownloadSource).not.toHaveBeenCalled()

    api.uniworkOpenSource.mockClear()
    await act(async () => {
      rowOf('src-docx')
        .querySelector('.dh-cell-actions')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkOpenSource).not.toHaveBeenCalled()
  })

  it('a row the app cannot open (.doc, canOpenInApp false) downloads on click and on double click', async () => {
    await renderHome()
    await act(async () => {
      nameButton('src-doc').click()
    })
    await flush()
    expect(api.uniworkDownloadSource).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      sourceId: 'src-doc',
      name: 'Hợp đồng cũ.doc',
    })
    expect(api.uniworkOpenSource).not.toHaveBeenCalled()

    api.uniworkDownloadSource.mockClear()
    await act(async () => {
      rowOf('src-doc').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkDownloadSource).toHaveBeenCalledTimes(1)
    expect(api.uniworkOpenSource).not.toHaveBeenCalled()
  })

  it('a click burst (click, click, double click) opens once; the next click is a new open', async () => {
    let release: (value: unknown) => void = () => {}
    api.uniworkOpenSource.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    )
    await renderHome()
    const button = nameButton('src-docx')
    await act(async () => {
      button.click()
      button.click()
      rowOf('src-docx').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkOpenSource).toHaveBeenCalledTimes(1)
    await act(async () => {
      release(ok({ path: '/tmp/x', reused: false }))
    })
    await flush()
    await act(async () => {
      button.click()
    })
    await flush()
    expect(api.uniworkOpenSource).toHaveBeenCalledTimes(2)
  })

  it('the menu lists "Mở (chỉ xem)" first and then "Tải xuống" for an openable row, Download alone otherwise', async () => {
    await renderHome()
    expect(await openMenuOf('src-docx')).toEqual(['Mở (chỉ xem)', 'Tải xuống'])
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(await openMenuOf('src-doc')).toEqual(['Tải xuống'])
  })

  it('the menu entries run Open and Download', async () => {
    await renderHome()
    await openMenuOf('src-pdf')
    await pickMenuItem('Mở (chỉ xem)')
    expect(api.uniworkOpenSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'src-pdf',
        extension: 'pdf',
        origin: 'email',
        parent: { kind: 'email', title: 'Re: Báo giá Q4' },
      }),
    )
    expect(api.uniworkDownloadSource).not.toHaveBeenCalled()

    await openMenuOf('src-pdf')
    await pickMenuItem('Tải xuống')
    expect(api.uniworkDownloadSource).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src-pdf' }),
    )
  })

  it('English copy: "Open (view only)" first in the menu', async () => {
    await renderHome('en')
    expect(await openMenuOf('src-docx')).toEqual(['Open (view only)', 'Download'])
  })

  it.each(['not_found', 'deleted'])(
    'a file that is gone (%s) says so and reloads the list',
    async (error) => {
      await renderHome()
      api.uniworkListSources.mockClear()
      await failOpenWith(error)
      expect(toastText()).toContain(
        'Không mở được tệp: tệp đã bị xoá hoặc bạn không còn quyền xem.',
      )
      expect(api.uniworkListSources).toHaveBeenCalled()
      expect(notices).toEqual([])
    },
  )

  it.each(['network', 'timeout'])(
    'offline (%s): a toast with Thử lại that runs the open again',
    async (error) => {
      await renderHome()
      await failOpenWith(error)
      expect(toastText()).toContain(
        'Không mở được tệp vì không kết nối được UniWork. Kiểm tra kết nối rồi thử lại.',
      )
      const retry = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.uw-act-toast button'),
      ).find((b) => b.textContent === 'Thử lại')
      expect(retry, 'Try again button').toBeDefined()
      api.uniworkListSources.mockClear()
      await act(async () => {
        retry!.click()
      })
      await flush()
      expect(api.uniworkOpenSource).toHaveBeenCalledTimes(2)
      expect(api.uniworkOpenSource).toHaveBeenLastCalledWith(OPEN_INPUT)
      // offline is not a reason to reload the list
      expect(api.uniworkListSources).not.toHaveBeenCalled()
    },
  )

  it('too large: a toast with a Tải xuống action that downloads that file', async () => {
    await renderHome()
    await failOpenWith('too_large')
    expect(toastText()).toContain('Tệp quá lớn để mở trong ứng dụng. Hãy tải xuống.')
    const download = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.uw-act-toast button'),
    ).find((b) => b.textContent === 'Tải xuống')
    expect(download, 'Download action').toBeDefined()
    await act(async () => {
      download!.click()
    })
    await flush()
    expect(api.uniworkDownloadSource).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      sourceId: 'src-docx',
      name: 'Biên bản họp.docx',
    })
  })

  it.each([
    'forbidden',
    'session_expired',
    'not_signed_in',
    'wrong_deployment',
    'keystore_locked',
  ])('%s goes to the notice bus (uwErr*), not to a toast, and keeps the list', async (error) => {
    await renderHome()
    api.uniworkListSources.mockClear()
    await failOpenWith(error)
    expect(notices).toEqual([{ phase: 'failed', error }])
    expect(toastText()).toBe('')
    expect(api.uniworkListSources).not.toHaveBeenCalled()
  })

  it.each(['server_error', 'open_failed', 'unsupported_format', 'something_new'])(
    'any other failure (%s) is the generic "Không mở được tệp. Thử lại."',
    async (error) => {
      await renderHome()
      api.uniworkListSources.mockClear()
      await failOpenWith(error)
      expect(toastText()).toContain('Không mở được tệp. Thử lại.')
      expect(notices).toEqual([])
      expect(api.uniworkListSources).not.toHaveBeenCalled()
    },
  )

  it('a bridge that throws is read as offline, and a missing bridge as a generic failure', async () => {
    await renderHome()
    api.uniworkOpenSource.mockRejectedValueOnce(new Error('ipc'))
    await act(async () => {
      nameButton('src-docx').click()
    })
    await flush()
    expect(toastText()).toContain('không kết nối được UniWork')

    delete (api as Record<string, unknown>).uniworkOpenSource
    await act(async () => {
      nameButton('src-docx').click()
    })
    await flush()
    expect(toastText()).toContain('Không mở được tệp. Thử lại.')
  })

  it('announces the opening to a screen reader', async () => {
    let release: (value: unknown) => void = () => {}
    api.uniworkOpenSource.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    )
    await renderHome()
    await act(async () => {
      nameButton('src-docx').click()
    })
    await flush()
    expect(document.querySelector('[data-uw-live] [role="status"]')?.textContent).toBe(
      'Đang mở Biên bản họp.docx…',
    )
    await act(async () => {
      release(ok({ path: '/tmp/x', reused: false }))
    })
    await flush()
  })
})
