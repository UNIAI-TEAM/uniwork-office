/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'

/**
 * UNI-1959 UW-NEW-MENU: the Documents home "New" button opens the web's menu
 * (UniNote, Docs/Sheets/Slides, Markdown, HTML, PDF, then the "Share with
 * workspace" toggle; Folder first inside an open folder). Picking a row creates
 * at once with the web's default name in the open place and opens it; no
 * name / type / location dialog. The Quick create strip creates the same way.
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

const KINDS = ['page', 'docx', 'xlsx', 'pptx', 'md', 'html', 'pdf']
const LABELS_VI = [
  'UniNote',
  'Tài liệu Docs',
  'Bảng tính Sheets',
  'Trình chiếu Slides',
  'Tệp Markdown',
  'HTML',
  'PDF',
]
const LABELS_EN = [
  'UniNote',
  'Docs document',
  'Sheets spreadsheet',
  'Slides presentation',
  'Markdown file',
  'HTML',
  'PDF',
]
const EXTS = ['UniWork', '.docx', '.xlsx', '.pptx', '.md', '.html', '.pdf']
const NAMES_VI: Record<string, string> = {
  docx: 'Tài liệu chưa đặt tên.docx',
  xlsx: 'Bảng tính chưa đặt tên.xlsx',
  pptx: 'Bản trình chiếu chưa đặt tên.pptx',
  md: 'Markdown chưa đặt tên.md',
  html: 'Trang HTML chưa đặt tên.html',
  pdf: 'PDF chưa đặt tên.pdf',
  page: 'UniNote mới',
  folder: 'Thư mục mới',
}
const NAMES_EN: Record<string, string> = {
  docx: 'Untitled document.docx',
  xlsx: 'Untitled spreadsheet.xlsx',
  pptx: 'Untitled presentation.pptx',
  md: 'Untitled markdown.md',
  html: 'Untitled HTML page.html',
  pdf: 'Untitled PDF.pdf',
  page: 'New UniNote',
  folder: 'New folder',
}

describe('UW-NEW-MENU (UNI-1959) DocumentsHome', () => {
  let host: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let openWeb: ReturnType<typeof vi.fn>
  let onOpenDocument: ReturnType<typeof vi.fn>
  let workspaces: UniworkWorkspaceRef[]
  let rootItems: DocumentsHomeDoc[]
  let folderItems: Record<string, DocumentsHomeDoc[]>

  const mount = async (lang: 'vi' | 'en' = 'vi') => {
    localStorage.setItem('genoffice.lang', lang)
    document.documentElement.lang = lang
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument,
          }),
        ),
      )
    })
    await flush()
  }

  const click = async (el: Element | null | undefined) => {
    expect(el).toBeTruthy()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
    await flush()
  }

  const key = async (el: Element | null, k: string) => {
    expect(el).toBeTruthy()
    await act(async () => {
      el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    })
    await flush()
  }

  const menu = () => document.querySelector<HTMLElement>('[role="menu"].dh-new-menu')
  const rows = () => Array.from(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
  const toggle = () =>
    menu()?.querySelector<HTMLElement>('[role="menuitemcheckbox"]') as HTMLElement | null
  const row = (kind: string) =>
    menu()?.querySelector<HTMLElement>(`[role="menuitem"][data-new-kind="${kind}"]`) ?? null
  const openMenu = async () => {
    await click(host.querySelector('.dh-btn-create'))
    expect(menu()).not.toBeNull()
  }
  const noDialog = () => expect(document.querySelector('.modal.uw-act')).toBeNull()

  const openFolder = async (id: string) => {
    await click(host.querySelector(`.dh-folder-card[data-folder-id="${id}"] button.dh-folder-open`))
  }

  beforeEach(() => {
    // jsdom's localStorage is not always a full Storage here (Node's own experimental one wins)
    const map = new Map<string, string>()
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() {
        return map.size
      },
    }
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
    workspaces = [
      { id: 'ws-1', name: 'UniWork', slug: 'uniwork', orgSlug: 'acme' } as UniworkWorkspaceRef,
    ]
    const tree: UniworkFolderNode[] = [
      {
        id: 'f-mine',
        parentId: null,
        title: 'My Folder',
        position: 0,
        kind: 'my_folder',
        isSystem: true,
        children: [],
      } as UniworkFolderNode,
      {
        id: 'f-plain',
        parentId: null,
        title: 'Riêng',
        position: 1,
        children: [],
      } as UniworkFolderNode,
      {
        id: 'f-shared',
        parentId: null,
        title: 'Chung',
        position: 2,
        children: [],
      } as UniworkFolderNode,
    ]
    const folder = (id: string, title: string, extra: Partial<DocumentsHomeDoc> = {}) =>
      ({
        id,
        workspaceId: 'ws-1',
        title,
        format: null,
        updatedAt: '2026-10-17T08:00:00.000Z',
        kind: 'folder',
        parentId: null,
        myLevel: 'manage',
        ...extra,
      }) as DocumentsHomeDoc
    rootItems = [
      folder('f-plain', 'Riêng', { visibility: 'private' }),
      folder('f-shared', 'Chung', { visibility: 'workspace' }),
    ]
    folderItems = {}
    const created = (id: string, title: string, format: string | null, kind: string) => ({
      id,
      workspaceId: 'ws-1',
      title,
      format,
      updatedAt: '',
      kind,
      parentId: 'f-mine',
    })
    api = {
      accountStatus: vi.fn(async () => ({ state: 'signed-in' as const, loggedIn: true })),
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async () => ok(tree)),
      uniworkEnsureMyFolder: vi.fn(async () => ok(tree[0]!)),
      uniworkListChildren: vi.fn(
        async (q: { parentId: string | null }): Promise<UniworkResult<UniworkFolderChildren>> =>
          ok({ items: q.parentId ? (folderItems[q.parentId] ?? []) : rootItems, nextCursor: null }),
      ),
      uniworkListDocuments: vi.fn(async () => ok({ documents: rootItems, nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkCreateDocument: vi.fn(async (input: { name: string; format: string }) =>
        ok(created('new-file', input.name, input.format, 'file')),
      ),
      uniworkCreatePage: vi.fn(async (input: { name: string }) =>
        ok(created('new-page', input.name, null, 'page')),
      ),
      uniworkCreateFolder: vi.fn(async (input: { title: string; parentId: string | null }) =>
        ok(created('new-folder', input.title, null, 'folder')),
      ),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
    }
    openWeb = vi.fn(async () => true)
    onOpenDocument = vi.fn()
    ;(window as unknown as { aiOffice: unknown; home: unknown }).aiOffice = api
    ;(window as unknown as { aiOffice: unknown; home: unknown }).home = api
    ;(window as unknown as { uniworkWork: unknown }).uniworkWork = { openWeb }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    document.querySelectorAll('.modal-backdrop, .uw-act, .dh-new-menu').forEach((n) => n.remove())
  })

  describe('the menu', () => {
    it('opens from the New button with the web rows in order, each with its icon and extension (vi)', async () => {
      await mount('vi')
      const button = host.querySelector<HTMLElement>('.dh-btn-create')!
      expect(button.getAttribute('aria-haspopup')).toBe('menu')
      expect(button.getAttribute('aria-expanded')).toBe('false')
      await openMenu()
      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(rows().map((r) => r.getAttribute('data-new-kind'))).toEqual(KINDS)
      expect(rows().map((r) => r.querySelector('.dh-new-label')?.textContent?.trim())).toEqual(
        LABELS_VI,
      )
      expect(rows().map((r) => r.querySelector('.dh-new-ext')?.textContent?.trim())).toEqual(EXTS)
      // every row carries its type icon (FileBadge for files, the UniNote mark for the page)
      for (const r of rows()) expect(r.querySelector('img, svg')).not.toBeNull()
      noDialog()
    })

    it('is localized (en)', async () => {
      await mount('en')
      await openMenu()
      expect(rows().map((r) => r.querySelector('.dh-new-label')?.textContent?.trim())).toEqual(
        LABELS_EN,
      )
    })

    it('has a divider after UniNote and one before the share toggle, and the toggle is last', async () => {
      await mount('vi')
      await openMenu()
      const children = Array.from(menu()!.children)
      const roles = children.map((c) => c.getAttribute('role'))
      expect(roles).toEqual([
        'menuitem', // UniNote
        'separator',
        'menuitem',
        'menuitem',
        'menuitem',
        'menuitem',
        'menuitem',
        'menuitem', // PDF
        'separator',
        'menuitemcheckbox',
      ])
    })

    it('has no Folder row at the root level', async () => {
      await mount('vi')
      await openMenu()
      expect(row('folder')).toBeNull()
    })

    it('moves with the arrow keys, picks with Enter, and Esc closes it handing focus back', async () => {
      await mount('vi')
      const button = host.querySelector<HTMLElement>('.dh-btn-create')!
      await openMenu()
      // focus starts on the first row
      expect(document.activeElement).toBe(rows()[0])
      await key(menu(), 'ArrowDown')
      expect(document.activeElement).toBe(rows()[1])
      await key(menu(), 'ArrowUp')
      expect(document.activeElement).toBe(rows()[0])
      await key(menu(), 'End')
      expect(document.activeElement).toBe(toggle())
      await key(menu(), 'Home')
      expect(document.activeElement).toBe(rows()[0])
      await key(menu(), 'Escape')
      expect(menu()).toBeNull()
      expect(document.activeElement).toBe(button)
      expect(api.uniworkCreateDocument).not.toHaveBeenCalled()

      await openMenu()
      await key(menu(), 'ArrowDown')
      await key(menu(), 'ArrowDown')
      await key(menu(), 'ArrowDown')
      await key(menu(), 'ArrowDown')
      // docx, xlsx, pptx, md
      expect(document.activeElement).toBe(row('md'))
      await key(document.activeElement, 'Enter')
      expect(api.uniworkCreateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'md' }),
      )
      expect(menu()).toBeNull()
    })

    it('closes on an outside click', async () => {
      await mount('vi')
      await openMenu()
      await click(document.body)
      expect(menu()).toBeNull()
    })
  })

  describe('picking a row creates at once', () => {
    it('Markdown creates md with the default name in My Folder and opens it, with no dialog', async () => {
      await mount('vi')
      await openMenu()
      await click(row('md'))
      expect(api.uniworkCreateDocument).toHaveBeenCalledTimes(1)
      const sent = api.uniworkCreateDocument.mock.calls[0]![0]
      expect(sent).toEqual({
        workspaceId: 'ws-1',
        folderId: 'f-mine',
        name: 'Markdown chưa đặt tên.md',
        format: 'md',
      })
      expect(sent).not.toHaveProperty('visibility')
      expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-file' }))
      expect(openWeb).not.toHaveBeenCalled()
      expect(menu()).toBeNull()
      noDialog()
    })

    it.each(['docx', 'xlsx', 'pptx', 'html', 'pdf'])(
      '%s uses its own web default name',
      async (kind) => {
        await mount('vi')
        await openMenu()
        await click(row(kind))
        expect(api.uniworkCreateDocument.mock.calls[0]![0]).toMatchObject({
          format: kind,
          name: NAMES_VI[kind],
        })
      },
    )

    it('uses the English default names in English', async () => {
      await mount('en')
      await openMenu()
      await click(row('xlsx'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0].name).toBe(NAMES_EN.xlsx)
    })

    it('UniNote creates a page with its default name and opens it on the web', async () => {
      await mount('vi')
      await openMenu()
      await click(row('page'))
      expect(api.uniworkCreatePage).toHaveBeenCalledTimes(1)
      const sent = api.uniworkCreatePage.mock.calls[0]![0]
      expect(sent).toEqual({ workspaceId: 'ws-1', folderId: 'f-mine', name: NAMES_VI.page })
      expect(api.uniworkCreateDocument).not.toHaveBeenCalled()
      expect(openWeb).toHaveBeenCalledWith({
        kind: 'document',
        orgSlug: 'acme',
        wsSlug: 'uniwork',
        id: 'new-page',
      })
      expect(onOpenDocument).not.toHaveBeenCalled()
      noDialog()
    })

    it('creates in the open folder, not My Folder', async () => {
      await mount('vi')
      await openFolder('f-plain')
      await openMenu()
      await click(row('docx'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).toMatchObject({ folderId: 'f-plain' })
    })

    it('a failure shows the generic create_failed toast and creates nothing else', async () => {
      api.uniworkCreateDocument.mockResolvedValue({ ok: false, error: 'server_error' })
      await mount('vi')
      await openMenu()
      await click(row('docx'))
      expect(document.body.textContent).toContain('Không thể tạo tài liệu. Thử lại.')
      expect(onOpenDocument).not.toHaveBeenCalled()
      // the row stays usable
      await openMenu()
      expect(row('docx')?.getAttribute('aria-disabled')).toBeNull()
    })

    it('a kind the server cannot create (404 / 501) is disabled for the session with its own toast', async () => {
      api.uniworkCreateDocument.mockResolvedValueOnce({
        ok: false,
        error: 'server_error',
        endpointMissing: true,
      })
      await mount('en')
      await openMenu()
      await click(row('pdf'))
      expect(document.body.textContent).toContain("This server can't create this file type yet.")
      await openMenu()
      expect(row('pdf')?.getAttribute('aria-disabled')).toBe('true')
      expect(row('docx')?.getAttribute('aria-disabled')).toBeNull()
      // a click on the disabled row creates nothing
      await click(row('pdf'))
      expect(api.uniworkCreateDocument).toHaveBeenCalledTimes(1)
    })
  })

  describe('Share with workspace', () => {
    it('is off by default and a pick sends no visibility', async () => {
      await mount('vi')
      await openMenu()
      expect(toggle()?.getAttribute('aria-checked')).toBe('false')
      expect(toggle()?.textContent).toContain('Chia sẻ với workspace')
      await click(row('docx'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).not.toHaveProperty('visibility')
    })

    it('on: the request carries visibility workspace, with the hint (vi)', async () => {
      await mount('vi')
      await openMenu()
      await click(toggle())
      // the menu stays open on a toggle
      expect(menu()).not.toBeNull()
      expect(toggle()?.getAttribute('aria-checked')).toBe('true')
      expect(menu()!.querySelector('[role="status"]')?.textContent).toBe(
        'Mọi thành viên của workspace này sẽ chỉ xem tài liệu mới',
      )
      await click(row('xlsx'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).toMatchObject({
        visibility: 'workspace',
      })
    })

    it('on: the hint reads in English', async () => {
      await mount('en')
      await openMenu()
      await click(toggle())
      expect(menu()!.querySelector('[role="status"]')?.textContent).toBe(
        'Everyone in this workspace can view new documents',
      )
    })

    it('on: a UniNote carries visibility workspace too', async () => {
      await mount('vi')
      await openMenu()
      await click(toggle())
      await click(row('page'))
      expect(api.uniworkCreatePage.mock.calls[0]![0]).toMatchObject({ visibility: 'workspace' })
    })

    it('is kept while the home view is open', async () => {
      await mount('vi')
      await openMenu()
      await click(toggle())
      await click(row('docx'))
      await openMenu()
      expect(toggle()?.getAttribute('aria-checked')).toBe('true')
      await click(row('md'))
      expect(api.uniworkCreateDocument.mock.calls[1]![0]).toMatchObject({
        visibility: 'workspace',
      })
    })

    it('inside a workspace-shared folder it is free and off by default: nothing is inherited', async () => {
      await mount('vi')
      await openFolder('f-shared')
      await openMenu()
      expect(toggle()?.getAttribute('aria-checked')).toBe('false')
      expect(toggle()?.getAttribute('aria-disabled')).toBeNull()
      expect(menu()!.querySelector('[role="status"]')?.textContent).toBe('')
      await click(row('docx'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).toMatchObject({ folderId: 'f-shared' })
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).not.toHaveProperty('visibility')
    })

    it('inside a folder a ticked toggle sends visibility workspace and shows the hint, in any folder', async () => {
      await mount('en')
      await openFolder('f-shared')
      await openMenu()
      await click(toggle())
      expect(toggle()?.getAttribute('aria-checked')).toBe('true')
      expect(menu()!.querySelector('[role="status"]')?.textContent).toBe(
        'Everyone in this workspace can view new documents',
      )
      await click(row('md'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).toMatchObject({
        folderId: 'f-shared',
        visibility: 'workspace',
      })
    })

    it('has no inherited hint in any folder (the string is gone)', async () => {
      await mount('en')
      await openFolder('f-shared')
      await openMenu()
      expect(document.body.textContent).not.toContain('This folder is shared with the workspace')
    })

    it('a folder that is not shared leaves the toggle free', async () => {
      await mount('vi')
      await openFolder('f-plain')
      await openMenu()
      expect(toggle()?.getAttribute('aria-disabled')).toBeNull()
      await click(toggle())
      await click(row('docx'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).toMatchObject({
        folderId: 'f-plain',
        visibility: 'workspace',
      })
    })
  })

  describe('Folder inside an open folder', () => {
    it('is the first row, followed by a divider', async () => {
      await mount('vi')
      await openFolder('f-plain')
      await openMenu()
      const children = Array.from(menu()!.children)
      expect(children[0]?.getAttribute('data-new-kind')).toBe('folder')
      expect(children[0]?.querySelector('.dh-new-label')?.textContent?.trim()).toBe('Thư mục')
      expect(children[1]?.getAttribute('role')).toBe('separator')
      expect(children[2]?.getAttribute('data-new-kind')).toBe('page')
    })

    it('asks the folder name in the existing prompt (default name filled) and creates it in the open folder', async () => {
      await mount('vi')
      await openFolder('f-plain')
      await openMenu()
      await click(row('folder'))
      const input = document.querySelector<HTMLInputElement>('.uw-act input[type="text"]')!
      expect(input.value).toBe(NAMES_VI.folder)
      await click(document.querySelector('.uw-act button[type="submit"]'))
      expect(api.uniworkCreateFolder).toHaveBeenCalledTimes(1)
      const sent = api.uniworkCreateFolder.mock.calls[0]![0]
      expect(sent).toEqual({ workspaceId: 'ws-1', parentId: 'f-plain', title: NAMES_VI.folder })
      expect(sent).not.toHaveProperty('visibility')
    })

    it('a Folder pick with the toggle on still sends no visibility (folders are never shared)', async () => {
      await mount('en')
      await openFolder('f-plain')
      await openMenu()
      await click(toggle())
      expect(toggle()?.getAttribute('aria-checked')).toBe('true')
      await click(row('folder'))
      expect(document.querySelector<HTMLInputElement>('.uw-act input[type="text"]')!.value).toBe(
        NAMES_EN.folder,
      )
      await click(document.querySelector('.uw-act button[type="submit"]'))
      expect(api.uniworkCreateFolder).toHaveBeenCalledTimes(1)
      const sent = api.uniworkCreateFolder.mock.calls[0]![0]
      expect(sent).toEqual({ workspaceId: 'ws-1', parentId: 'f-plain', title: NAMES_EN.folder })
      expect(sent).not.toHaveProperty('visibility')
    })

    it('the toggle stays on after a Folder create and still shares the next document', async () => {
      await mount('en')
      await openFolder('f-plain')
      await openMenu()
      await click(toggle())
      await click(row('folder'))
      await click(document.querySelector('.uw-act button[type="submit"]'))
      await openMenu()
      expect(toggle()?.getAttribute('aria-checked')).toBe('true')
      await click(row('docx'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).toMatchObject({ visibility: 'workspace' })
    })
  })

  describe('the Quick create strip', () => {
    it('a pill creates at once, with the default name, no dialog', async () => {
      await mount('vi')
      await click(host.querySelector('.dh-quick-pill[data-quick-format="md"]'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).toEqual({
        workspaceId: 'ws-1',
        folderId: 'f-mine',
        name: 'Markdown chưa đặt tên.md',
        format: 'md',
      })
      expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-file' }))
      noDialog()
    })

    it('shows the extension on each pill', async () => {
      await mount('vi')
      const pills = Array.from(host.querySelectorAll<HTMLElement>('.dh-quick-pill'))
      expect(pills.map((p) => p.getAttribute('data-quick-format'))).toEqual(KINDS)
      expect(pills.map((p) => p.querySelector('.dh-quick-ext')?.textContent?.trim())).toEqual(EXTS)
    })

    it('a UniNote pill creates the page at once and opens it on the web', async () => {
      await mount('vi')
      await click(host.querySelector('.dh-quick-pill[data-quick-format="page"]'))
      expect(api.uniworkCreatePage).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        folderId: 'f-mine',
        name: NAMES_VI.page,
      })
      expect(openWeb).toHaveBeenCalledTimes(1)
      noDialog()
    })

    it('uses the menu share state, then resets it after the create', async () => {
      await mount('vi')
      await openMenu()
      await click(toggle())
      await key(menu(), 'Escape')
      await click(host.querySelector('.dh-quick-pill[data-quick-format="docx"]'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).toMatchObject({
        visibility: 'workspace',
      })
      // reset after a create from the strip: the next one is private again
      await click(host.querySelector('.dh-quick-pill[data-quick-format="xlsx"]'))
      expect(api.uniworkCreateDocument.mock.calls[1]![0]).not.toHaveProperty('visibility')
      await openMenu()
      expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    })

    it('a kind the server cannot create is disabled on its pill too', async () => {
      api.uniworkCreateDocument.mockResolvedValueOnce({
        ok: false,
        error: 'server_error',
        endpointMissing: true,
      })
      await mount('vi')
      await click(host.querySelector('.dh-quick-pill[data-quick-format="pdf"]'))
      expect(
        host
          .querySelector('.dh-quick-pill[data-quick-format="pdf"]')
          ?.getAttribute('aria-disabled'),
      ).toBe('true')
      await openMenu()
      expect(row('pdf')?.getAttribute('aria-disabled')).toBe('true')
    })
  })

  describe('r2: the strip shows the share state it sends (FE-2)', () => {
    const stripToggle = () =>
      host.querySelector<HTMLElement>(
        '.dh-quick-row [role="checkbox"], .dh-quick-row [role="switch"]',
      )
    const stripHint = () => host.querySelector<HTMLElement>('.dh-quick-row [role="status"]')

    it('renders the Share toggle (off) and an empty live hint next to the pills', async () => {
      await mount('vi')
      expect(stripToggle()).not.toBeNull()
      expect(stripToggle()?.getAttribute('aria-checked')).toBe('false')
      expect(stripHint()?.textContent).toBe('')
      expect(host.querySelector('.dh-quick-row')?.textContent).toContain('Chia sẻ với workspace')
    })

    it('toggle on: the hint says it, and a pill sends visibility workspace', async () => {
      await mount('vi')
      await click(stripToggle())
      expect(stripToggle()?.getAttribute('aria-checked')).toBe('true')
      expect(stripHint()?.textContent).toBe(
        'Mọi thành viên của workspace này sẽ chỉ xem tài liệu mới',
      )
      await click(host.querySelector('.dh-quick-pill[data-quick-format="docx"]'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).toMatchObject({ visibility: 'workspace' })
      // reset after the create, with the hint following
      expect(stripToggle()?.getAttribute('aria-checked')).toBe('false')
      expect(stripHint()?.textContent).toBe('')
    })

    it('shares one state with the menu: ticked in the menu shows ticked on the strip', async () => {
      await mount('en')
      await openMenu()
      await click(toggle())
      await key(menu(), 'Escape')
      expect(stripToggle()?.getAttribute('aria-checked')).toBe('true')
      expect(stripHint()?.textContent).toBe('Everyone in this workspace can view new documents')
    })

    it('a strip toggle off again sends no visibility', async () => {
      await mount('vi')
      await click(stripToggle())
      await click(stripToggle())
      await click(host.querySelector('.dh-quick-pill[data-quick-format="md"]'))
      expect(api.uniworkCreateDocument.mock.calls[0]![0]).not.toHaveProperty('visibility')
    })
  })

  describe('r2: a UniNote the server cannot create disables its row and pill (FE-3)', () => {
    it.each([['menu'], ['strip']])('a 404 / 501 from the %s pick', async (from) => {
      api.uniworkCreatePage.mockResolvedValueOnce({
        ok: false,
        error: 'server_error',
        endpointMissing: true,
      })
      await mount('en')
      if (from === 'menu') {
        await openMenu()
        await click(row('page'))
      } else {
        await click(host.querySelector('.dh-quick-pill[data-quick-format="page"]'))
      }
      expect(document.body.textContent).toContain("This server can't create this file type yet.")
      await openMenu()
      expect(row('page')?.getAttribute('aria-disabled')).toBe('true')
      expect(
        host
          .querySelector('.dh-quick-pill[data-quick-format="page"]')
          ?.getAttribute('aria-disabled'),
      ).toBe('true')
      await click(row('page'))
      expect(api.uniworkCreatePage).toHaveBeenCalledTimes(1)
    })

    it('an ordinary failure (no flag, a 500) leaves the UniNote row usable', async () => {
      api.uniworkCreatePage.mockResolvedValueOnce({ ok: false, error: 'server_error' })
      await mount('en')
      await openMenu()
      await click(row('page'))
      await openMenu()
      expect(row('page')?.getAttribute('aria-disabled')).toBeNull()
    })

    it('a disabled kind never disables the Folder row inside an open folder', async () => {
      api.uniworkCreatePage.mockResolvedValueOnce({
        ok: false,
        error: 'server_error',
        endpointMissing: true,
      })
      await mount('en')
      await openFolder('f-plain')
      await openMenu()
      await click(row('page'))
      await openMenu()
      expect(row('folder')).not.toBeNull()
      expect(row('folder')?.getAttribute('aria-disabled')).toBeNull()
    })
  })

  describe('r2: keyboard order and the trigger (FE-6, FE-8)', () => {
    it('skips a disabled row: initial focus and the arrows never land on it', async () => {
      api.uniworkCreatePage.mockResolvedValueOnce({
        ok: false,
        error: 'server_error',
        endpointMissing: true,
      })
      await mount('en')
      await openMenu()
      await click(row('page'))
      await openMenu()
      expect(row('page')?.getAttribute('aria-disabled')).toBe('true')
      // focus starts on the first usable row
      expect(document.activeElement).toBe(row('docx'))
      await key(menu(), 'Home')
      expect(document.activeElement).toBe(row('docx'))
      await key(menu(), 'End')
      await key(menu(), 'ArrowDown')
      // wraps past the disabled UniNote
      expect(document.activeElement).toBe(row('docx'))
      await key(menu(), 'ArrowUp')
      expect(document.activeElement).toBe(toggle())
    })

    it('the New button does not open the menu while a create is in flight', async () => {
      let release: () => void = () => undefined
      api.uniworkCreateDocument.mockImplementationOnce(
        (input: { name: string; format: string }) =>
          new Promise((resolve) => {
            release = () =>
              resolve(
                ok({
                  id: 'new-file',
                  workspaceId: 'ws-1',
                  title: input.name,
                  format: input.format,
                  updatedAt: '',
                  kind: 'file',
                  parentId: 'f-mine',
                }),
              )
          }),
      )
      await mount('vi')
      await openMenu()
      await click(row('docx'))
      expect(menu()).toBeNull()
      await click(host.querySelector('.dh-btn-create'))
      expect(menu()).toBeNull()
      await act(async () => release())
      await flush()
      await click(host.querySelector('.dh-btn-create'))
      expect(menu()).not.toBeNull()
    })
  })
})

/**
 * VNM-1 / VNM-2 (the visual pass): rules of the menu stylesheet, read as data.
 * jsdom does not lay out the imported CSS, so the declarations themselves are
 * what a contrast / focus-ring regression would change.
 */
describe('UW-NEW-MENU r2: row hover and keyboard focus (VNM-1, VNM-2)', () => {
  const css = readFileSync(
    join(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
    'utf8',
  )
  /** the declarations of every rule whose selector list names `selector` exactly */
  const rulesFor = (selector: string): Array<{ selectors: string[]; body: string }> => {
    const found: Array<{ selectors: string[]; body: string }> = []
    for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = match[1]!.split(',').map((x) => x.trim())
      if (selectors.includes(selector)) found.push({ selectors, body: match[2]! })
    }
    return found
  }

  it('a keyboard-focused row gets its own accent ring, not only the hover fill', () => {
    const rules = rulesFor('.dh-new-item:focus-visible')
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      // not shared with :hover (a mouse over a row must not draw the ring)
      expect(rule.selectors.some((x) => x.includes(':hover'))).toBe(false)
    }
    const body = rules.map((r) => r.body).join(';')
    expect(body).toMatch(/outline:\s*2px solid var\(--accent\)/)
    expect(body).not.toMatch(/outline:\s*none/)
  })

  it('the hint and the extension of a hovered or focused row use the primary text token', () => {
    for (const state of [':hover', ':focus-visible']) {
      for (const part of ['.dh-new-hint', '.dh-new-ext']) {
        const rules = rulesFor(`.dh-new-item${state} ${part}`)
        expect(rules.length, `${state} ${part}`).toBeGreaterThan(0)
        expect(rules.map((r) => r.body).join(';')).toMatch(/color:\s*var\(--text\)/)
      }
    }
  })
})
