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
import { buildFolderIndex } from '../src/renderer/src/uniwork-folders/uniwork-folders-model'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import {
  DOCUMENTS_HOME_GROUP_BY,
  fetchDocumentsHomeSources,
  formatBytes,
  groupDocumentsHomeRows,
  formatShortDate,
  mergeNewestFirst,
  rowSizeBytes,
  sourceMatchesFilters,
  type DocumentsHomeApiAdapter,
  type DocumentsHomeDoc,
} from '../src/renderer/src/uniwork-home/documents-home-model'

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

describe('mergeNewestFirst - the web root merge of documents and sources (UNI-1961 item 1)', () => {
  const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`

  it('sorts both lists newest first when neither has more pages', () => {
    const rows = mergeNewestFirst(
      [doc({ id: 'd17', updatedAt: at(17) }), doc({ id: 'd12', updatedAt: at(12) })],
      [source({ id: 's19', updatedAt: at(19) }), source({ id: 's14', updatedAt: at(14) })],
      { docs: false, sources: false },
    )
    expect(rows.map((row) => row.id)).toEqual(['source:s19', 'd17', 'source:s14', 'd12'])
    expect(rows[0]).toMatchObject({ type: 'source', source: { id: 's19' } })
    expect(rows[1]).toMatchObject({ type: 'doc', doc: { id: 'd17' } })
  })

  it('hides rows older than the oldest loaded row of a list that still has pages', () => {
    const docs = [doc({ id: 'd17', updatedAt: at(17) }), doc({ id: 'd15', updatedAt: at(15) })]
    const sources = [
      source({ id: 's19', updatedAt: at(19) }),
      source({ id: 's10', updatedAt: at(10) }),
    ]
    // docs has more: nothing older than its oldest loaded row (the 15th) shows yet
    expect(
      mergeNewestFirst(docs, sources, { docs: true, sources: false }).map((r) => r.id),
    ).toEqual(['source:s19', 'd17', 'd15'])
    // both page: the later cutoff wins
    expect(
      mergeNewestFirst(docs, [source({ id: 's16', updatedAt: at(16) })], {
        docs: true,
        sources: true,
      }).map((r) => r.id),
    ).toEqual(['d17', 'source:s16'])
    // an empty list that still pages sets no bound
    expect(mergeNewestFirst(docs, [], { docs: false, sources: true }).map((r) => r.id)).toEqual([
      'd17',
      'd15',
    ])
  })

  it('sinks a row with no usable date to the end', () => {
    const rows = mergeNewestFirst(
      [doc({ id: 'dx', updatedAt: '' })],
      [source({ id: 's1', updatedAt: at(1) })],
      { docs: false, sources: false },
    )
    expect(rows.map((row) => row.id)).toEqual(['source:s1', 'dx'])
  })
})

describe('fetchDocumentsHomeSources (UNI-1961 item 1)', () => {
  it('sends the format filter as the source type, and the cursor', async () => {
    const uniworkListSources = vi.fn(async () =>
      ok({ items: [source({ id: 's1' })], nextCursor: 'n' }),
    )
    const api = { uniworkListSources } as DocumentsHomeApiAdapter
    const res = await fetchDocumentsHomeSources(api, {
      workspaceId: 'ws-1',
      filters: { format: 'pdf', updatedBy: 'u-1' },
      cursor: 'c-1',
    })
    expect(uniworkListSources).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      type: 'pdf',
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
    expect(sourceMatchesFilters(row, { format: 'pdf' })).toBe(true)
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
      source({ id: 'src-1', name: 'Biên bản họp.docx', updatedAt: '2026-10-19T08:00:00.000Z' }),
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

  async function renderHome(lang: 'vi' | 'en' = 'vi') {
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

  it('merges the source files into the root table newest first: Access "—", editor = owner', async () => {
    await renderHome()
    expect(api.uniworkListSources).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(rowKeys()).toEqual(['source:src-1', 'doc-1', 'source:src-2', 'doc-2'])
    // folders stay cards above the table (finding 6: the web root shows them too)
    expect(host.querySelectorAll('.dh-folder-card')).toHaveLength(1)

    const row = host.querySelector<HTMLElement>('.dh-doc-row[data-source-id="src-1"]')!
    expect(row.querySelector('.dh-doc-open')?.textContent).toBe('Biên bản họp.docx')
    expect(row.querySelector('.dh-cell-access')?.textContent?.trim()).toBe('—')
    expect(row.querySelector('.dh-cell-person')?.textContent).toContain('Minh Trần')
    const ownerless = host.querySelector<HTMLElement>('.dh-doc-row[data-source-id="src-2"]')!
    expect(ownerless.querySelector('.dh-cell-person')?.textContent?.trim()).toBe('—')
    // the documents count says what the table shows
    expect(host.querySelector('.dh-docs-section .dh-section-count')?.textContent).toBe('4')
  })

  it('a source row downloads on its primary click and offers Show in folder', async () => {
    await renderHome()
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

  it('the row menu offers Download; a failed download says so', async () => {
    await renderHome()
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
    await renderHome()
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
    expect(await menuLabels('.dh-doc-row[data-source-id="src-1"]')).toEqual(['Tải xuống'])
    expect(await menuLabels('.dh-doc-row[data-doc-id="doc-1"]')).toContain('Lưu trữ')
    expect(api.uniworkShelveDocument).not.toHaveBeenCalled()
  })

  it('lists no sources inside a folder or in Recent, and a failing sources call leaves the documents', async () => {
    api.uniworkListSources.mockResolvedValue({ ok: false, error: 'not_found' })
    await renderHome()
    expect(rowKeys()).toEqual(['doc-1', 'doc-2'])
    expect(host.querySelector('[role="alert"]')).toBeNull()

    api.uniworkListSources.mockClear()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.dh-folder-open')!.click()
    })
    await flush()
    await act(async () => {
      sidebarSlot.querySelector<HTMLButtonElement>('.nav-item[data-nav="recent"]')!.click()
    })
    await flush()
    expect(api.uniworkListSources).not.toHaveBeenCalled()
  })

  it('applies the home filters to source rows: type on the server, editor and date here', async () => {
    await renderHome()
    const typeSelect = host.querySelector<HTMLSelectElement>('select[data-filter="format"]')!
    await act(async () => {
      typeSelect.value = 'pdf'
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(api.uniworkListSources).toHaveBeenLastCalledWith({ workspaceId: 'ws-1', type: 'pdf' })
  })

  it('Load more pages both lists and keeps rows below what is on screen', async () => {
    api.uniworkListChildren.mockImplementation(
      async (q: { parentId: string | null; cursor?: string }) =>
        q.cursor
          ? ok({
              items: [doc({ id: 'doc-old', updatedAt: '2026-10-01T08:00:00.000Z' })],
              nextCursor: null,
            })
          : ok({ items: rootItems, nextCursor: 'docs-2' }),
    )
    api.uniworkListSources.mockImplementation(async (q: { cursor?: string }) =>
      q.cursor
        ? ok({
            items: [source({ id: 'src-old', updatedAt: '2026-10-02T08:00:00.000Z' })],
            nextCursor: null,
          })
        : ok({ items: sources, nextCursor: 'src-2' }),
    )
    await renderHome()
    // cutoff = the later of the two oldest loaded rows (doc-2 on the 12th, src-2 on the 14th)
    expect(rowKeys()).toEqual(['source:src-1', 'doc-1', 'source:src-2'])
    const more = host.querySelector<HTMLButtonElement>('.dh-load-more-row button')!
    await act(async () => {
      more.click()
    })
    await flush()
    expect(api.uniworkListChildren).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'docs-2' }),
    )
    expect(api.uniworkListSources).toHaveBeenLastCalledWith({
      workspaceId: 'ws-1',
      cursor: 'src-2',
    })
    expect(rowKeys()).toEqual([
      'source:src-1',
      'doc-1',
      'source:src-2',
      'doc-2',
      'source:src-old',
      'doc-old',
    ])
    expect(host.querySelector('.dh-load-more-row')).toBeNull()
  })
})

describe('Size and dates as the web shows them (UNI-1961 item 2)', () => {
  it('formatBytes is the web byte formatter (1024 steps, 0 or 1 decimal, locale mark)', () => {
    expect(formatBytes(null, 'en-US')).toBe('')
    expect(formatBytes(-1, 'en-US')).toBe('')
    expect(formatBytes(0, 'en-US')).toBe('0 B')
    expect(formatBytes(512, 'en-US')).toBe('512 B')
    expect(formatBytes(325632, 'en-US')).toBe('318 KB')
    expect(formatBytes(1258291, 'en-US')).toBe('1.2 MB')
    expect(formatBytes(1258291, 'vi-VN')).toBe('1,2 MB')
    expect(formatBytes(15 * 1024 * 1024, 'en-US')).toBe('15 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024, 'en-US')).toBe('3 GB')
  })

  it('formatShortDate is Intl dateStyle short; no date says nothing', () => {
    const iso = '2026-10-19T08:00:00.000Z'
    for (const locale of ['vi-VN', 'en-US']) {
      expect(formatShortDate(iso, locale)).toBe(
        new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(iso)),
      )
    }
    expect(formatShortDate('', 'en-US')).toBe('')
    expect(formatShortDate('not a date', 'en-US')).toBe('')
  })

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

  async function renderHome(lang: 'vi' | 'en') {
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
          }),
        ),
      )
    })
    await flush()
  }

  const cell = (selector: string, name: string) =>
    host.querySelector<HTMLElement>(`${selector} .${name}`)?.textContent?.trim()

  it.each([
    ['vi', 'vi-VN', 'Dung lượng', '318 KB', '1,2 MB'],
    ['en', 'en-US', 'Size', '318 KB', '1.2 MB'],
  ] as const)(
    '%s: Name, Access, editor, Updated, Size, then the actions',
    async (lang, locale, size, docSize, srcSize) => {
      await renderHome(lang)
      const heads = Array.from(
        host.querySelectorAll<HTMLElement>('.dh-doc-head > [role="columnheader"]'),
      )
      expect(heads.map((el) => el.className)).toEqual([
        'dh-col-name',
        'dh-col-access',
        'dh-col-person',
        'dh-col-time',
        'dh-col-size',
        'dh-col-actions',
      ])
      expect(heads[4]?.textContent).toBe(size)

      const short = (iso: string) =>
        new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(iso))
      expect(cell('[data-doc-id="doc-1"]', 'dh-cell-size')).toBe(docSize)
      expect(cell('[data-doc-id="doc-1"]', 'dh-cell-time')).toBe(short('2026-10-17T08:00:00.000Z'))
      expect(cell('[data-doc-id="page-1"]', 'dh-cell-size')).toBe('')
      expect(cell('[data-doc-id="page-1"]', 'dh-cell-time')).toBe(short('2026-10-16T08:00:00.000Z'))
      expect(cell('[data-source-id="src-1"]', 'dh-cell-size')).toBe(srcSize)
      expect(cell('[data-source-id="src-1"]', 'dh-cell-time')).toBe(
        short('2026-10-19T08:00:00.000Z'),
      )
    },
  )
})

describe('groupDocumentsHomeRows - the web groupRows (UNI-1961 item 3)', () => {
  const tree: UniworkFolderNode[] = [
    {
      id: 'f-mine',
      parentId: null,
      title: 'My Folder',
      position: 0,
      systemKind: 'my_folder',
      children: [],
    },
    {
      id: 'f-board',
      parentId: null,
      title: 'Báo cáo HĐQT',
      position: 1,
      children: [{ id: 'f-q4', parentId: 'f-board', title: 'Q4', position: 0, children: [] }],
    },
  ]
  const index = buildFolderIndex(tree)
  const rows = [
    doc({ id: 'a', parentId: 'f-q4', origin: 'upload' }),
    doc({ id: 'b', parentId: null, format: 'xlsx', origin: 'created' }),
    doc({ id: 'c', parentId: 'f-mine', kind: 'page', format: null }),
    doc({ id: 'd', parentId: 'f-gone', format: null, title: 'notes.txt' }),
    doc({ id: 'e', parentId: 'f-q4', format: 'pptx' }),
  ]
  const shape = (groups: ReturnType<typeof groupDocumentsHomeRows>) =>
    groups.map((group) => [group.key, group.title, group.rows.map((row) => row.id)])

  it('offers Folder, Source, Type and None, in the web order', () => {
    expect(DOCUMENTS_HOME_GROUP_BY).toEqual(['folder', 'source', 'type', 'none'])
  })

  it('folder: the deepest folder titled by its path (My Folder relabelled), else unfiled', () => {
    expect(
      shape(
        groupDocumentsHomeRows(rows, 'folder', index, { id: 'f-mine', label: 'Thư mục của tôi' }),
      ),
    ).toEqual([
      ['folder:f-q4', 'Báo cáo HĐQT / Q4', ['a', 'e']],
      ['unfiled', '', ['b', 'd']],
      ['folder:f-mine', 'Thư mục của tôi', ['c']],
    ])
  })

  it('source: uploaded / created / documents (a server that does not say)', () => {
    expect(shape(groupDocumentsHomeRows(rows, 'source', index))).toEqual([
      ['origin:upload', '', ['a']],
      ['origin:created', '', ['b']],
      ['origin:documents', '', ['c', 'd', 'e']],
    ])
  })

  it('type: the row format (page, the file format, else the title extension)', () => {
    expect(shape(groupDocumentsHomeRows(rows, 'type', index))).toEqual([
      ['type:docx', '', ['a']],
      ['type:xlsx', '', ['b']],
      ['type:page', '', ['c']],
      ['type:txt', '', ['d']],
      ['type:pptx', '', ['e']],
    ])
  })

  it('none: one group, no header', () => {
    expect(shape(groupDocumentsHomeRows(rows, 'none', index))).toEqual([
      ['all', '', ['a', 'b', 'c', 'd', 'e']],
    ])
  })
})

describe('DocumentsHome Group by on the list views (UNI-1961 item 3)', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  const workspaces: UniworkWorkspaceRef[] = [
    { id: 'ws-1', name: 'Công ty UniWork', slug: 'uniwork' },
  ]
  const tree: UniworkFolderNode[] = [
    { id: 'f-board', parentId: null, title: 'Báo cáo HĐQT', position: 1, children: [] },
  ]
  const recent: DocumentsHomeDoc[] = [
    doc({
      id: 'r1',
      title: 'Kế hoạch.docx',
      parentId: 'f-board',
      origin: 'upload',
      updatedAt: '2026-10-19T08:00:00.000Z',
    }),
    doc({
      id: 'r2',
      title: 'Ngân sách.xlsx',
      format: 'xlsx',
      origin: 'created',
      updatedAt: '2026-10-18T08:00:00.000Z',
    }),
    doc({
      id: 'r3',
      title: 'Hợp đồng.docx',
      parentId: 'f-board',
      updatedAt: '2026-10-17T08:00:00.000Z',
    }),
  ]

  beforeEach(() => {
    localStorage.clear()
    const api = {
      accountStatus: vi.fn(async () => ({ state: 'signed-in' as const, loggedIn: true })),
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async () => ok(tree)),
      uniworkListChildren: vi.fn(async () => ok({ items: recent, nextCursor: null })),
      uniworkListSources: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkListDocuments: vi.fn(async () => ok({ documents: recent, nextCursor: null })),
      uniworkListSharedWithMe: vi.fn(async () => ok({ documents: [recent[1]!], nextCursor: null })),
      uniworkListSharedByMe: vi.fn(async () => ok({ documents: [recent[0]!], nextCursor: null })),
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

  async function renderHome(lang: 'vi' | 'en') {
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
          }),
        ),
      )
    })
    await flush()
  }

  const nav = async (id: string) => {
    await act(async () => {
      sidebarSlot.querySelector<HTMLButtonElement>(`.nav-item[data-nav="${id}"]`)!.click()
    })
    await flush()
  }
  const groupSelect = () => host.querySelector<HTMLSelectElement>('select[data-filter="groupBy"]')
  const pick = async (value: string) => {
    await act(async () => {
      const select = groupSelect()!
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
  }
  /** the table in DOM order: a group header as "# title count", a row as its id */
  const table = () =>
    Array.from(
      host.querySelectorAll<HTMLElement>(
        '.dh-doc-table > .dh-group-row, .dh-doc-table > .dh-doc-row',
      ),
    ).map((el) =>
      el.classList.contains('dh-group-row')
        ? `# ${el.querySelector('.dh-group-title')?.textContent} ${el.querySelector('.dh-group-count')?.textContent}`
        : (el.dataset.docId ?? ''),
    )

  it('vi: the root has no Group by (the web home does not group); Recent groups by Folder by default', async () => {
    await renderHome('vi')
    expect(groupSelect()).toBeNull()
    expect(host.querySelector('.dh-group-row')).toBeNull()

    await nav('recent')
    const select = groupSelect()!
    expect(select).not.toBeNull()
    expect(select.value).toBe('folder')
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ['folder', 'Thư mục'],
      ['source', 'Nguồn'],
      ['type', 'Loại file'],
      ['none', 'Không nhóm'],
    ])
    expect(host.textContent).toContain('Nhóm theo')
    expect(table()).toEqual(['# Báo cáo HĐQT 2', 'r1', 'r3', '# Chưa xếp thư mục 1', 'r2'])

    await pick('source')
    expect(table()).toEqual(['# Tải lên 1', 'r1', '# Tạo mới 1', 'r2', '# Tài liệu 1', 'r3'])

    await pick('type')
    expect(table()).toEqual(['# Docs 2', 'r1', 'r3', '# Sheets 1', 'r2'])

    await pick('none')
    expect(table()).toEqual(['r1', 'r2', 'r3'])
    // the documents count says the rows, not the headers
    expect(host.querySelector('.dh-docs-section .dh-section-count')?.textContent).toBe('3')
  })

  it('en: Shared with me and Shared by me offer it too, with the web words', async () => {
    await renderHome('en')
    await nav('shared-with-me')
    expect(Array.from(groupSelect()!.options).map((o) => o.textContent)).toEqual([
      'Folder',
      'Source',
      'File type',
      'No grouping',
    ])
    expect(host.textContent).toContain('Group by')
    expect(table()).toEqual(['# Not in a folder 1', 'r2'])
    await pick('source')
    expect(table()).toEqual(['# Created 1', 'r2'])

    await nav('shared-by-me')
    expect(groupSelect()?.value).toBe('source')
    expect(table()).toEqual(['# Uploaded 1', 'r1'])
    await pick('folder')
    expect(table()).toEqual(['# Báo cáo HĐQT 1', 'r1'])

    await nav('trash')
    expect(groupSelect()).toBeNull()
  })
})
