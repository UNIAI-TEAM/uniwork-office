/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UniworkFolderNode,
  UniworkResult,
  UniworkSourceFile,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { formatListDate } from '../src/renderer/src/doclist/format'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import {
  fetchDocumentsHomeSources,
  rowSizeBytes,
  sourceMatchesFilters,
  type DocumentsHomeApiAdapter,
  type DocumentsHomeDoc,
} from '../src/renderer/src/uniwork-home/documents-home-model'
import { pickType } from './doclist-type-filter-fixture'

/**
 * UNI-1961 UW-LIST-PARITY: the app's Workspace documents list follows the web
 * (D G5-G7 root @5975d8f9e, packages/views/documents). The web is canonical.
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

const doc = (over: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
  workspaceId: 'ws-1',
  title: `${over.id}.docx`,
  format: 'docx',
  updatedAt: '2026-10-15T10:00:00.000Z',
  kind: 'file',
  parentId: null,
  ...over,
})

const source = (over: Partial<UniworkSourceFile> & { id: string }): UniworkSourceFile => ({
  source: 'task',
  parent: { kind: 'task', id: 'task-1', title: 'Chuẩn bị họp HĐQT' },
  name: `${over.id}.docx`,
  mimeType: '',
  extension: 'docx',
  sizeBytes: 325632,
  updatedAt: '2026-10-18T08:00:00.000Z',
  owner: { id: 'u-minh', name: 'Minh Trần' },
  canOpenInApp: true,
  canSave: false,
  ...over,
})

describe('fetchDocumentsHomeSources (UNI-1961 item 1)', () => {
  it('sends the Type picks as the source types, and the cursor', async () => {
    const uniworkListSources = vi.fn(async () =>
      ok({ items: [source({ id: 's1' })], nextCursor: 'n' }),
    )
    const api = { uniworkListSources } as DocumentsHomeApiAdapter
    const res = await fetchDocumentsHomeSources(api, {
      workspaceId: 'ws-1',
      filters: { types: ['pdf'], updatedBy: 'u-1' },
      cursor: 'c-1',
    })
    expect(uniworkListSources).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      types: ['pdf'],
      cursor: 'c-1',
    })
    expect(res).toEqual(ok({ items: [source({ id: 's1' })], nextCursor: 'n' }))
  })

  it('answers null when the bridge has no sources call', async () => {
    expect(await fetchDocumentsHomeSources({}, { workspaceId: 'ws-1', filters: {} })).toBeNull()
  })

  it('narrows source rows by editor (the owner) and date here, as the web does', () => {
    const row = source({ id: 's1', updatedAt: '2026-10-18T08:00:00.000Z' })
    expect(sourceMatchesFilters(row, {})).toBe(true)
    expect(sourceMatchesFilters(row, { updatedBy: 'u-minh' })).toBe(true)
    expect(sourceMatchesFilters(row, { updatedBy: 'u-lan' })).toBe(false)
    expect(sourceMatchesFilters({ ...row, owner: null }, { updatedBy: 'u-minh' })).toBe(false)
    expect(sourceMatchesFilters(row, { updatedFrom: '2026-10-18T00:00:00.000Z' })).toBe(true)
    expect(sourceMatchesFilters(row, { updatedFrom: '2026-10-19T00:00:00.000Z' })).toBe(false)
    // the type went to the server already
    expect(sourceMatchesFilters(row, { types: ['pdf'] })).toBe(true)
  })
})

describe('DocumentsHome source rows at the workspace root (UNI-1961 item 1)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  const workspaces: UniworkWorkspaceRef[] = [
    { id: 'ws-1', name: 'Công ty UniWork', slug: 'uniwork' },
  ]
  const tree: UniworkFolderNode[] = [
    { id: 'f-board', parentId: null, title: 'Báo cáo HĐQT', position: 1, children: [] },
  ]
  let rootItems: DocumentsHomeDoc[]
  let sources: UniworkSourceFile[]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    rootItems = [
      doc({ id: 'f-board', title: 'Báo cáo HĐQT', kind: 'folder', format: null }),
      doc({
        id: 'doc-1',
        title: 'Kế hoạch.docx',
        updatedAt: '2026-10-17T08:00:00.000Z',
        visibility: 'workspace',
        myLevel: 'edit',
        updatedById: 'u-lan',
        updatedByName: 'Lan Nguyễn',
      }),
      doc({
        id: 'doc-2',
        title: 'Ngân sách.xlsx',
        format: 'xlsx',
        updatedAt: '2026-10-12T08:00:00.000Z',
      }),
    ]
    sources = [
      // UNI-1993: a row the server does not let the app open view-only keeps the web's
      // fallback (Download); the openable rows are pinned in uniwork-documents-source-open-ui.test.ts
      source({
        id: 'src-1',
        name: 'Biên bản họp.docx',
        updatedAt: '2026-10-19T08:00:00.000Z',
        canOpenInApp: false,
      }),
      source({
        id: 'src-2',
        name: 'Hợp đồng.pdf',
        extension: 'pdf',
        updatedAt: '2026-10-14T08:00:00.000Z',
        owner: null,
      }),
    ]
    api = {
      accountStatus: vi.fn(async () => ({ state: 'signed-in' as const, loggedIn: true })),
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async () => ok(tree)),
      uniworkEnsureMyFolder: vi.fn(async () =>
        ok({ id: 'f-mine', parentId: null, title: 'My Folder', position: 0, children: [] }),
      ),
      uniworkListChildren: vi.fn(async (q: { parentId: string | null }) =>
        ok({ items: q.parentId === null ? rootItems : [], nextCursor: null }),
      ),
      uniworkListSources: vi.fn(async () => ok({ items: sources, nextCursor: null })),
      uniworkDownloadSource: vi.fn(async () =>
        ok({ path: 'C:\\Users\\me\\Downloads\\Biên bản họp.docx' }),
      ),
      revealPath: vi.fn(async () => undefined),
      uniworkShelveDocument: vi.fn(async () => ok({})),
      uniworkListDocuments: vi.fn(async () => ok({ documents: [rootItems[1]!], nextCursor: null })),
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
    host = document.createElement('div')
    sidebarSlot = document.createElement('div')
    document.body.appendChild(sidebarSlot)
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    sidebarSlot.remove()
  })

  async function renderHome(lang: 'vi' | 'en' = 'vi', initialSubView?: 'elsewhere') {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument: vi.fn(),
            sidebarHost: sidebarSlot,
            initialSubView,
          }),
        ),
      )
    })
    await flush()
  }

  const rowKeys = () =>
    Array.from(host.querySelectorAll<HTMLElement>('.dh-doc-row')).map(
      (row) => row.dataset.docId ?? `source:${row.dataset.sourceId}`,
    )

  it('the workspace root lists documents only: the source files live on the From elsewhere page (UNI-2047 F-14)', async () => {
    await renderHome()
    // the only sources read is the sidebar's limit:1 probe (UNI-2047 sidebar); nothing is merged
    expect(api.uniworkListSources.mock.calls.map((c) => c[0])).toEqual([
      { workspaceId: 'ws-1', limit: 1 },
    ])
    expect(rowKeys()).toEqual(['doc-1', 'doc-2'])
    // folders stay cards above the table
    expect(host.querySelectorAll('.dh-folder-card')).toHaveLength(1)
    // the documents count says what the table shows: no source row is counted
    expect(host.querySelector('.dh-docs-section .dh-section-count')?.textContent).toBe('2')
  })

  it('From elsewhere lists the source files newest first: no Access column, editor = owner', async () => {
    await renderHome('vi', 'elsewhere')
    expect(api.uniworkListSources).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(rowKeys()).toEqual(['source:src-1', 'source:src-2'])
    const row = host.querySelector<HTMLElement>('.dh-doc-row[data-source-id="src-1"]')!
    expect(row.querySelector('.dh-doc-open')?.textContent).toBe('Biên bản họp.docx')
    expect(row.querySelector('.dh-cell-access')).toBeNull()
    expect(row.querySelector('.dh-cell-person')?.textContent).toContain('Minh Trần')
    const ownerless = host.querySelector<HTMLElement>('.dh-doc-row[data-source-id="src-2"]')!
    expect(ownerless.querySelector('.dh-cell-person')?.textContent?.trim()).toBe('—')
  })

  it('a source row downloads on its primary click and offers Show in folder', async () => {
    await renderHome('vi', 'elsewhere')
    const row = host.querySelector<HTMLElement>('.dh-doc-row[data-source-id="src-1"]')!
    await act(async () => {
      row.querySelector<HTMLButtonElement>('.dh-doc-open')!.click()
    })
    await flush()
    expect(api.uniworkDownloadSource).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      sourceId: 'src-1',
      name: 'Biên bản họp.docx',
    })
    const toast = document.querySelector<HTMLElement>('.uw-act-toast')
    expect(toast?.textContent).toContain('Đã tải xuống Biên bản họp.docx')
    const show = Array.from(toast?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (button) => button.textContent === 'Hiện trong thư mục',
    )
    expect(show).toBeDefined()
    await act(async () => {
      show!.click()
    })
    expect(api.revealPath).toHaveBeenCalledWith('C:\\Users\\me\\Downloads\\Biên bản họp.docx')
  })

  it('a source row downloads once per click burst: two clicks or a click plus a double click (UNI-1961)', async () => {
    // hold the first download open, as the native save dialog does
    let release: (value: unknown) => void = () => {}
    api.uniworkDownloadSource.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    )
    await renderHome('vi', 'elsewhere')
    const row = host.querySelector<HTMLElement>('.dh-doc-row[data-source-id="src-1"]')!
    const open = row.querySelector<HTMLButtonElement>('.dh-doc-open')!
    await act(async () => {
      open.click()
      open.click()
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkDownloadSource).toHaveBeenCalledTimes(1)
    await act(async () => {
      release(ok({ path: 'C:\\Users\\me\\Downloads\\Biên bản họp.docx' }))
    })
    await flush()
    // the burst is over: the next click is a new download
    await act(async () => {
      open.click()
    })
    await flush()
    expect(api.uniworkDownloadSource).toHaveBeenCalledTimes(2)
  })

  it('the row menu offers Download; a failed download says so', async () => {
    await renderHome('vi', 'elsewhere')
    api.uniworkDownloadSource.mockResolvedValueOnce({ ok: false, error: 'network' })
    const row = host.querySelector<HTMLElement>('.dh-doc-row[data-source-id="src-2"]')!
    await act(async () => {
      row.querySelector<HTMLButtonElement>('.dh-cell-actions button')!.click()
    })
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === 'Tải xuống',
    )
    expect(item).toBeDefined()
    await act(async () => {
      item!.click()
    })
    await flush()
    expect(api.uniworkDownloadSource).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src-2', name: 'Hợp đồng.pdf' }),
    )
    expect(document.querySelector('.uw-act-toast')?.textContent).toContain(
      'Không thể tải file xuống. Thử lại.',
    )
  })

  it('a source row never offers Lưu trữ (no manage level), while a managed document row does (UNI-1961)', async () => {
    rootItems[1] = { ...rootItems[1]!, canManage: true, myLevel: 'manage' }
    const menuLabels = async (selector: string): Promise<(string | undefined)[]> => {
      await act(async () => {
        host.querySelector<HTMLButtonElement>(`${selector} .dh-cell-actions button`)!.click()
      })
      const labels = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
        (el) => el.textContent?.trim(),
      )
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      return labels
    }
    await renderHome('vi', 'elsewhere')
    expect(await menuLabels('.dh-doc-row[data-source-id="src-1"]')).toEqual(['Tải xuống'])
    await act(async () => {
      root.unmount()
    })
    root = createRoot(host)
    await renderHome()
    expect(await menuLabels('.dh-doc-row[data-doc-id="doc-1"]')).toContain('Lưu trữ')
    expect(api.uniworkShelveDocument).not.toHaveBeenCalled()
  })

  it('reads no sources at the root, inside a folder or in Recent (UNI-2047 F-14)', async () => {
    api.uniworkListSources.mockResolvedValue({ ok: false, error: 'not_found' })
    await renderHome()
    expect(rowKeys()).toEqual(['doc-1', 'doc-2'])
    expect(host.querySelector('[role="alert"]')).toBeNull()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.dh-folder-open')!.click()
    })
    await flush()
    await act(async () => {
      sidebarSlot.querySelector<HTMLButtonElement>('.nav-item[data-nav="recent"]')!.click()
    })
    await flush()
    // the sidebar's limit:1 probe is the only read (UNI-2047 sidebar), once for the workspace
    expect(api.uniworkListSources.mock.calls.map((c) => c[0])).toEqual([
      { workspaceId: 'ws-1', limit: 1 },
    ])
  })

  it('applies the home filters to source rows: type on the server, editor and date here', async () => {
    await renderHome('vi', 'elsewhere')
    await pickType(host, 'pdf')
    expect(api.uniworkListSources).toHaveBeenLastCalledWith({ workspaceId: 'ws-1', types: ['pdf'] })
  })

  it('Load more on From elsewhere pages the source list only', async () => {
    api.uniworkListSources.mockImplementation(async (q: { cursor?: string }) =>
      q.cursor
        ? ok({
            items: [source({ id: 'src-old', updatedAt: '2026-10-02T08:00:00.000Z' })],
            nextCursor: null,
          })
        : ok({ items: sources, nextCursor: 'src-2' }),
    )
    await renderHome('vi', 'elsewhere')
    expect(rowKeys()).toEqual(['source:src-1', 'source:src-2'])
    const more = host.querySelector<HTMLButtonElement>('.dh-load-more-row button')!
    await act(async () => {
      more.click()
    })
    await flush()
    expect(api.uniworkListSources).toHaveBeenLastCalledWith({
      workspaceId: 'ws-1',
      cursor: 'src-2',
    })
    expect(api.uniworkListChildren).not.toHaveBeenCalledWith(
      expect.objectContaining({ cursor: expect.anything() }),
    )
    expect(rowKeys()).toEqual(['source:src-1', 'source:src-2', 'source:src-old'])
    expect(host.querySelector('.dh-load-more-row')).toBeNull()
  })
})

describe('Size of a row (UNI-1961 item 2)', () => {
  it('a size shows for a file document with bytes and for every source; pages and folders say nothing', () => {
    const at = { type: 'doc' as const }
    expect(rowSizeBytes({ ...at, id: 'a', doc: doc({ id: 'a', sizeBytes: 100 }) })).toBe(100)
    expect(rowSizeBytes({ ...at, id: 'b', doc: doc({ id: 'b' }) })).toBeNull()
    expect(rowSizeBytes({ ...at, id: 'c', doc: doc({ id: 'c', sizeBytes: 0 }) })).toBeNull()
    expect(
      rowSizeBytes({ ...at, id: 'd', doc: doc({ id: 'd', kind: 'page', sizeBytes: 9 }) }),
    ).toBeNull()
    expect(
      rowSizeBytes({ type: 'source', id: 'source:s', source: source({ id: 's', sizeBytes: 0 }) }),
    ).toBe(0)
  })
})

describe('DocumentsHome Size column and short dates (UNI-1961 item 2)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  const workspaces: UniworkWorkspaceRef[] = [
    { id: 'ws-1', name: 'Công ty UniWork', slug: 'uniwork' },
  ]
  const items: DocumentsHomeDoc[] = [
    doc({
      id: 'doc-1',
      title: 'Kế hoạch.docx',
      updatedAt: '2026-10-17T08:00:00.000Z',
      sizeBytes: 325632,
    }),
    doc({
      id: 'page-1',
      title: 'Ghi chú',
      kind: 'page',
      format: null,
      updatedAt: '2026-10-16T08:00:00.000Z',
    }),
  ]
  const sourceFile = source({
    id: 'src-1',
    updatedAt: '2026-10-19T08:00:00.000Z',
    sizeBytes: 1258291,
  })

  beforeEach(() => {
    localStorage.clear()
    const api = {
      accountStatus: vi.fn(async () => ({ state: 'signed-in' as const, loggedIn: true })),
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async () => ok([])),
      uniworkListChildren: vi.fn(async () => ok({ items, nextCursor: null })),
      uniworkListSources: vi.fn(async () => ok({ items: [sourceFile], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
    }
    ;(window as unknown as { aiOffice: unknown; home: unknown }).aiOffice = api
    ;(window as unknown as { aiOffice: unknown; home: unknown }).home = api
    host = document.createElement('div')
    sidebarSlot = document.createElement('div')
    document.body.appendChild(sidebarSlot)
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    sidebarSlot.remove()
  })

  async function renderHome(lang: 'vi' | 'en', initialSubView?: 'elsewhere') {
    localStorage.setItem('genoffice.lang', lang)
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument: vi.fn(),
            sidebarHost: sidebarSlot,
            initialSubView,
          }),
        ),
      )
    })
    await flush()
  }

  const cell = (selector: string, name: string) =>
    host.querySelector<HTMLElement>(`${selector} .${name}`)?.textContent?.trim()

  it.each([
    ['vi', 'vi-VN', 'Dung lượng', '318 KB'],
    ['en', 'en-US', 'Size', '318 KB'],
  ] as const)(
    '%s: Chọn, Name, Access, editor, Updated, Size, then the actions (UNI-2047 shared rules)',
    async (lang, locale, size, docSize) => {
      await renderHome(lang)
      const heads = Array.from(
        host.querySelectorAll<HTMLElement>('.dh-doc-head > [role="columnheader"]'),
      )
      expect(heads.map((el) => el.className)).toEqual([
        'dh-col-select',
        'dh-col-name',
        'dh-col-access',
        'dh-col-person',
        'dh-col-time',
        'dh-col-size',
        'dh-col-actions',
      ])
      expect(heads[5]?.textContent).toBe(size)

      // the dates are the shared list dates (clock today, "Hôm qua", dd/MM, dd/MM/yyyy), not Intl short
      const now = new Date()
      const when = (iso: string) => formatListDate(iso, now, locale)
      expect(cell('[data-doc-id="doc-1"]', 'dh-cell-size')).toBe(docSize)
      expect(cell('[data-doc-id="doc-1"]', 'dh-cell-time')).toBe(when('2026-10-17T08:00:00.000Z'))
      // a page has no size: "—" (UNI-2047), like a folder or a missing file
      expect(cell('[data-doc-id="page-1"]', 'dh-cell-size')).toBe('—')
      expect(cell('[data-doc-id="page-1"]', 'dh-cell-time')).toBe(when('2026-10-16T08:00:00.000Z'))
    },
  )

  it.each([
    ['vi', 'vi-VN', 'Dung lượng', '1,2 MB'],
    ['en', 'en-US', 'Size', '1.2 MB'],
  ] as const)(
    '%s: a source row on From elsewhere has the same size and date formats (UNI-2047 F-14)',
    async (lang, locale, size, srcSize) => {
      await renderHome(lang, 'elsewhere')
      const heads = Array.from(
        host.querySelectorAll<HTMLElement>('.dh-doc-head > [role="columnheader"]'),
      )
      expect(heads.map((el) => el.className)).toEqual([
        'dh-col-name',
        'dh-col-person',
        'dh-col-time',
        'dh-col-size',
        'dh-col-actions',
      ])
      expect(heads[3]?.textContent).toBe(size)
      expect(cell('[data-source-id="src-1"]', 'dh-cell-size')).toBe(srcSize)
      expect(cell('[data-source-id="src-1"]', 'dh-cell-time')).toBe(
        formatListDate('2026-10-19T08:00:00.000Z', new Date(), locale),
      )
    },
  )
})
