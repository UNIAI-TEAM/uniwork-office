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
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import {
  fetchDocumentsHomeSources,
  mergeNewestFirst,
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
