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
 * UNI-1953 UW-CREATE-TYPES: the New document dialog's Type row and the Quick
 * create strip offer the web's seven kinds in the web's order (UniNote first,
 * then Văn bản, Bảng tính, Trình chiếu, Tệp Markdown, HTML, PDF). A file kind
 * goes to createDocument with its own format; UniNote is a page create, and a
 * page (created or listed) opens on the web through openWeb, never the file
 * open flow.
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
const LABELS_EN = [
  'UniNote',
  'Document',
  'Spreadsheet',
  'Presentation',
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

  const openDialog = async () => {
    await click(host.querySelector('.dh-btn-create'))
    const dialog = document.querySelector<HTMLElement>('.modal.uw-act')
    expect(dialog).not.toBeNull()
    return dialog!
  }

  const typeName = async (dialog: HTMLElement, value: string) => {
    const input = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const submit = async (dialog: HTMLElement) => {
    await click(dialog.querySelector('button[type="submit"]'))
  }

  beforeEach(() => {
    localStorage.clear()
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
      uniworkListChildren: vi.fn(
        async (): Promise<UniworkResult<UniworkFolderChildren>> =>
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

  it('the Quick create strip lists the seven kinds in web order, UniNote first', async () => {
    await mount('vi')
    const pills = Array.from(host.querySelectorAll<HTMLElement>('.dh-quick-pill'))
    expect(pills.map((p) => p.getAttribute('data-quick-format'))).toEqual(KINDS)
    expect(pills.map((p) => p.textContent?.trim())).toEqual(LABELS_VI)
    // every pill carries its type icon (the same marks the rows use)
    for (const pill of pills) expect(pill.querySelector('img, svg')).not.toBeNull()
  })

  it('the New document dialog Type row lists the same seven kinds, localized', async () => {
    await mount('en')
    const dialog = await openDialog()
    const radios = Array.from(dialog.querySelectorAll<HTMLInputElement>('.uw-act-types input'))
    expect(radios.map((r) => r.value)).toEqual(KINDS)
    const labels = Array.from(dialog.querySelectorAll('.uw-act-type')).map((l) =>
      l.textContent?.trim(),
    )
    expect(labels).toEqual(LABELS_EN)
  })

  it('creating a Markdown file sends format md to createDocument and opens it like a docx', async () => {
    await mount('vi')
    const dialog = await openDialog()
    await click(dialog.querySelector('.uw-act-types input[value="md"]'))
    await typeName(dialog, 'Ghi chú')
    await submit(dialog)
    expect(api.uniworkCreateDocument).toHaveBeenCalledTimes(1)
    expect(api.uniworkCreateDocument).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', folderId: 'f-mine', format: 'md' }),
    )
    expect(api.uniworkCreateDocument.mock.calls[0]![0].name).toBe('Ghi chú.md')
    expect(api.uniworkCreatePage).not.toHaveBeenCalled()
    expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-file' }))
    expect(openWeb).not.toHaveBeenCalled()
  })

  it.each(['html', 'pdf'])('creating a %s file sends that format', async (format) => {
    await mount('vi')
    const dialog = await openDialog()
    await click(dialog.querySelector(`.uw-act-types input[value="${format}"]`))
    await typeName(dialog, 'Tệp')
    await submit(dialog)
    expect(api.uniworkCreateDocument).toHaveBeenCalledWith(expect.objectContaining({ format }))
    expect(api.uniworkCreateDocument.mock.calls[0]![0].name).toBe(`Tệp.${format}`)
  })

  it('creating a UniNote sends the page create (same parent) and opens the web page, not the file flow', async () => {
    await mount('vi')
    const dialog = await openDialog()
    await click(dialog.querySelector('.uw-act-types input[value="page"]'))
    await typeName(dialog, 'Biên bản')
    await submit(dialog)
    expect(api.uniworkCreatePage).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      folderId: 'f-mine',
      name: 'Biên bản',
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

  it('a quick-create UniNote pill opens the dialog with UniNote selected', async () => {
    await mount('vi')
    await click(host.querySelector('.dh-quick-pill[data-quick-format="page"]'))
    const checked = document.querySelector<HTMLInputElement>('.uw-act-types input:checked')
    expect(checked?.value).toBe('page')
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

  it('an openWeb that answers false shows the failure toast', async () => {
    openWeb.mockResolvedValue(false)
    await mount('en')
    await click(host.querySelector('[data-doc-id="page-1"] .dh-doc-open'))
    expect(document.body.textContent).toContain('That didn’t work. Try again.')
    expect(onOpenDocument).not.toHaveBeenCalled()
  })
})
