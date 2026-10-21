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
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'
import { isShownEntry } from '../src/renderer/src/uniwork-folders/uniwork-folders-model'

/**
 * UNI-1953 UW-CREATE-TYPES: the New menu and the Quick create strip offer the
 * web's seven kinds in the web's order (UniNote first, then Văn bản, Bảng tính,
 * Trình chiếu, Tệp Markdown, HTML, PDF). A file kind goes to createDocument
 * with its own format; UniNote is a page create, and a page (created or
 * listed) opens on the web through openWeb, never the file open flow.
 * UNI-1959: a pick creates at once under the web's default name (no name
 * dialog), so the type, the name and the open all happen on the click.
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
const LABELS_VI = ['UniNote', 'Văn bản', 'Bảng tính', 'Trình chiếu', 'Tệp Markdown', 'HTML', 'PDF']
// the strip's pills: label, then the extension the pill shows
const EXTS = ['UniWork', '.docx', '.xlsx', '.pptx', '.md', '.html', '.pdf']
// the New menu's rows (the web's `documents.home.create.<type>.menu` names)
const MENU_LABELS_EN = [
  'UniNote',
  'Docs document',
  'Sheets spreadsheet',
  'Slides presentation',
  'Markdown file',
  'HTML',
  'PDF',
]

describe('UW-CREATE-TYPES (UNI-1953) DocumentsHome', () => {
  let host: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let openWeb: ReturnType<typeof vi.fn>
  let onOpenDocument: ReturnType<typeof vi.fn>
  let workspaces: UniworkWorkspaceRef[]
  let rootItems: DocumentsHomeDoc[]

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

  const openMenu = async () => {
    await click(host.querySelector('.dh-btn-create'))
    const menu = document.querySelector<HTMLElement>('[role="menu"].dh-new-menu')
    expect(menu).not.toBeNull()
    return menu!
  }

  /** a pick in the New menu: it creates at once, there is no name dialog */
  const pick = async (kind: string) => {
    const menu = await openMenu()
    await click(menu.querySelector(`[role="menuitem"][data-new-kind="${kind}"]`))
    expect(document.querySelector('.modal.uw-act')).toBeNull()
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
    ]
    rootItems = [
      {
        id: 'doc-1',
        workspaceId: 'ws-1',
        title: 'Báo cáo.docx',
        format: 'docx',
        updatedAt: '2026-10-17T08:00:00.000Z',
        kind: 'file',
        parentId: null,
        myLevel: 'manage',
      },
      {
        id: 'page-1',
        workspaceId: 'ws-1',
        title: 'Ghi chú họp',
        format: null,
        updatedAt: '2026-10-18T08:00:00.000Z',
        kind: 'page',
        parentId: null,
        myLevel: 'manage',
      },
    ]
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
      uniworkListChildren: vi.fn(async (): Promise<UniworkResult<UniworkFolderChildren>> =>
        ok({ items: rootItems, nextCursor: null }),
      ),
      uniworkListDocuments: vi.fn(async () => ok({ documents: rootItems, nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkCreateDocument: vi.fn(async (input: { name: string; format: string }) =>
        ok(created('new-file', input.name, input.format, 'file')),
      ),
      uniworkCreatePage: vi.fn(async (input: { name: string }) =>
        ok(created('new-page', input.name, null, 'page')),
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
    document.querySelectorAll('.modal-backdrop, .uw-act').forEach((n) => n.remove())
  })

  it('the Quick create strip lists the seven kinds in web order, UniNote first, with their extensions', async () => {
    await mount('vi')
    const pills = Array.from(host.querySelectorAll<HTMLElement>('.dh-quick-pill'))
    expect(pills.map((p) => p.getAttribute('data-quick-format'))).toEqual(KINDS)
    expect(pills.map((p) => p.textContent?.trim())).toEqual(
      LABELS_VI.map((label, i) => `${label}${EXTS[i]}`),
    )
    expect(pills.map((p) => p.querySelector('.dh-quick-ext')?.textContent)).toEqual(EXTS)
    // every pill carries its type icon (the same marks the rows use)
    for (const pill of pills) expect(pill.querySelector('img, svg')).not.toBeNull()
  })

  it('the New menu lists the strip kinds plus Plain text right under Markdown, localized', async () => {
    await mount('en')
    const menu = await openMenu()
    const rows = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitem"][data-new-kind]'),
    ).filter((row) => row.getAttribute('data-new-kind') !== 'folder')
    // UNI-2046: Plain text is in the menu only, the strip leaves it out
    const withTxt = <T>(items: readonly T[], txt: T): T[] => [
      ...items.slice(0, 5),
      txt,
      ...items.slice(5),
    ]
    expect(rows.map((r) => r.getAttribute('data-new-kind'))).toEqual(withTxt(KINDS, 'txt'))
    expect(rows.map((r) => r.querySelector('.dh-new-label')?.textContent)).toEqual(
      withTxt(MENU_LABELS_EN, 'Plain text'),
    )
    expect(rows.map((r) => r.querySelector('.dh-new-ext')?.textContent)).toEqual(
      withTxt(EXTS, '.txt'),
    )
  })

  it('picking Markdown creates at once: format md under the default name, in the same parent, opened like a docx', async () => {
    await mount('vi')
    await pick('md')
    expect(api.uniworkCreateDocument).toHaveBeenCalledTimes(1)
    expect(api.uniworkCreateDocument).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      folderId: 'f-mine',
      name: 'Markdown chưa đặt tên.md',
      format: 'md',
    })
    expect(api.uniworkCreatePage).not.toHaveBeenCalled()
    expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-file' }))
    expect(openWeb).not.toHaveBeenCalled()
  })

  it.each([
    ['html', 'Trang HTML chưa đặt tên.html'],
    ['pdf', 'PDF chưa đặt tên.pdf'],
  ])('picking %s creates that format under its default name', async (format, name) => {
    await mount('vi')
    await pick(format)
    expect(api.uniworkCreateDocument).toHaveBeenCalledWith(expect.objectContaining({ format }))
    expect(api.uniworkCreateDocument.mock.calls[0]![0].name).toBe(name)
  })

  it('picking UniNote sends the page create (same parent) and opens the web page, not the file flow', async () => {
    await mount('vi')
    await pick('page')
    expect(api.uniworkCreatePage).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      folderId: 'f-mine',
      name: 'UniNote mới',
    })
    expect(api.uniworkCreateDocument).not.toHaveBeenCalled()
    expect(openWeb).toHaveBeenCalledWith({
      kind: 'document',
      orgSlug: 'acme',
      wsSlug: 'uniwork',
      id: 'new-page',
    })
    expect(onOpenDocument).not.toHaveBeenCalled()
  })

  it('a quick-create UniNote pill creates the page at once too', async () => {
    await mount('vi')
    await click(host.querySelector('.dh-quick-pill[data-quick-format="page"]'))
    expect(document.querySelector('.modal.uw-act')).toBeNull()
    expect(api.uniworkCreatePage).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      folderId: 'f-mine',
      name: 'UniNote mới',
    })
    expect(openWeb).toHaveBeenCalledTimes(1)
  })

  it('lists a page row (UniNote) next to the files', async () => {
    await mount('vi')
    expect(host.querySelector('[data-doc-id="page-1"]')).not.toBeNull()
    expect(host.querySelector('[data-doc-id="doc-1"]')).not.toBeNull()
    expect(isShownEntry(rootItems[1]!)).toBe(true)
  })

  it('opening a page row calls openWeb with the document target and never the file open flow', async () => {
    await mount('vi')
    await click(host.querySelector('[data-doc-id="page-1"] .dh-doc-open'))
    expect(openWeb).toHaveBeenCalledWith({
      kind: 'document',
      orgSlug: 'acme',
      wsSlug: 'uniwork',
      id: 'page-1',
    })
    expect(onOpenDocument).not.toHaveBeenCalled()
    // a file row still goes through the file flow
    await click(host.querySelector('[data-doc-id="doc-1"] .dh-doc-open'))
    expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }))
    expect(openWeb).toHaveBeenCalledTimes(1)
  })

  // CT1-4: the page exists, only the opening failed: say so, not the generic failure
  it('a UniNote created but not opened (openWeb false) says so in its own toast', async () => {
    openWeb.mockResolvedValue(false)
    await mount('en')
    await pick('page')
    expect(api.uniworkCreatePage).toHaveBeenCalledTimes(1)
    const text = document.body.textContent ?? ''
    expect(text).toContain('The UniNote was created but couldn’t be opened.')
    expect(text).not.toContain('That didn’t work. Try again.')
  })

  it('the same toast reads in Vietnamese', async () => {
    openWeb.mockResolvedValue(false)
    await mount('vi')
    await pick('page')
    const text = document.body.textContent ?? ''
    expect(text).toContain('Đã tạo UniNote nhưng chưa mở được.')
    expect(text).not.toContain('Không thực hiện được. Hãy thử lại.')
  })

  // CT1-5: a page keeps its title as typed, never a file extension
  it('renaming a page titled like a file keeps the typed title, no extension re-added', async () => {
    rootItems = [
      {
        id: 'page-md',
        workspaceId: 'ws-1',
        title: 'Notes.md',
        // the parser derives a format from a non-file title
        format: 'md',
        updatedAt: '2026-10-18T08:00:00.000Z',
        kind: 'page',
        parentId: null,
        myLevel: 'manage',
        canEdit: true,
      },
    ]
    api.uniworkRenameDocument = vi.fn(async (id: string, title: string) =>
      ok({ id, workspaceId: 'ws-1', title, format: null, updatedAt: '', kind: 'page' }),
    )
    await mount('en')
    await click(host.querySelector('[data-folder-menu-for="page-md"]'))
    await click(document.querySelector('[data-folder-action="rename"]'))
    const input = host.querySelector<HTMLInputElement>('.uw-rename-input')!
    // the field starts with the whole title
    expect(input.value).toBe('Notes.md')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Ideas')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    expect(api.uniworkRenameDocument).toHaveBeenCalledWith('page-md', 'Ideas')
  })

  it('an openWeb that answers false shows the failure toast', async () => {
    openWeb.mockResolvedValue(false)
    await mount('en')
    await click(host.querySelector('[data-doc-id="page-1"] .dh-doc-open'))
    expect(document.body.textContent).toContain('That didn’t work. Try again.')
    expect(onOpenDocument).not.toHaveBeenCalled()
  })
})
