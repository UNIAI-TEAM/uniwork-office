import { describe, expect, it, vi } from 'vitest'
import {
  collectUpdatedByOptions,
  DEFAULT_DOCUMENTS_HOME_FILTERS,
  DOCUMENTS_HOME_NAV_ENTRIES,
  DOCUMENTS_HOME_TYPE_CHIPS,
  docMatchesUpdated,
  fetchDocumentsHomePage,
  getDocumentsHomeNavEntry,
  hasActiveFilters,
  rowMatchesType,
  splitAndSortItems,
  toUniworkListFilters,
  updatedByOptionsForSelect,
  updatedFromIsoOf,
  visibleDocumentsHomeNavEntries,
  type DocumentsHomeApiAdapter,
  type DocumentsHomeDoc,
} from '../src/renderer/src/uniwork-home/documents-home-model'
import { zh } from '../src/renderer/src/i18n/uniwork-home/zh'
import { zhTW } from '../src/renderer/src/i18n/uniwork-home/zh-TW'
import { vi as viLocale } from '../src/renderer/src/i18n/uniwork-home/vi'
import { en } from '../src/renderer/src/i18n/uniwork-home/en'
import { ja } from '../src/renderer/src/i18n/uniwork-home/ja'
import { ko } from '../src/renderer/src/i18n/uniwork-home/ko'
import { fr } from '../src/renderer/src/i18n/uniwork-home/fr'
import { de } from '../src/renderer/src/i18n/uniwork-home/de'
import { es } from '../src/renderer/src/i18n/uniwork-home/es'
import { pt } from '../src/renderer/src/i18n/uniwork-home/pt'
import { cs } from '../src/renderer/src/i18n/uniwork-home/cs'
import { it as itLocale } from '../src/renderer/src/i18n/uniwork-home/it'
import { ru } from '../src/renderer/src/i18n/uniwork-home/ru'
import { ar } from '../src/renderer/src/i18n/uniwork-home/ar'
import { hi } from '../src/renderer/src/i18n/uniwork-home/hi'
import { th } from '../src/renderer/src/i18n/uniwork-home/th'
import { id as idLocale } from '../src/renderer/src/i18n/uniwork-home/id'
import { ms } from '../src/renderer/src/i18n/uniwork-home/ms'
import { pl } from '../src/renderer/src/i18n/uniwork-home/pl'
import { nl } from '../src/renderer/src/i18n/uniwork-home/nl'
import { he } from '../src/renderer/src/i18n/uniwork-home/he'

function makeDoc(overrides: Partial<DocumentsHomeDoc> = {}): DocumentsHomeDoc {
  return {
    id: 'doc-1',
    workspaceId: 'ws-1',
    title: 'Quarterly Plan.docx',
    format: 'docx',
    updatedAt: '2026-10-15T10:00:00.000Z',
    kind: 'file',
    parentId: null,
    ...overrides,
  }
}

describe('DH1-W2 documents-home-model', () => {
  it('defines the 9 sub-nav entries in exact order (UNI-1961: archive shown; UNI-2047 B6: starred shown)', () => {
    expect(DOCUMENTS_HOME_NAV_ENTRIES.map((e) => e.id)).toEqual([
      'workspace',
      'my-folder',
      'recent',
      'starred',
      'shared-with-me',
      'shared-by-me',
      'archive',
      'trash',
      'elsewhere',
    ])

    const starred = getDocumentsHomeNavEntry('starred')
    const archive = getDocumentsHomeNavEntry('archive')
    expect(starred.available).toBe(true)
    expect(starred.source).toBe('favorites')
    expect(archive.available).toBe(true)
    expect(archive.source).toBe('shelved')

    // UNI-1957: My Folder is the tree row (or its stand-in), not a sub-nav entry
    expect(getDocumentsHomeNavEntry('my-folder').available).toBe(false)
    const visibleIds = visibleDocumentsHomeNavEntries().map((e) => e.id)
    expect(visibleIds).toEqual([
      'workspace',
      'recent',
      'starred',
      'shared-with-me',
      'shared-by-me',
      'archive',
      'trash',
      'elsewhere',
    ])
  })

  it('converts UI filter state (format, updatedBy, updatedPreset) to UniworkListFilters', () => {
    const fixedNow = Date.parse('2026-10-17T12:00:00.000Z')
    expect(hasActiveFilters(DEFAULT_DOCUMENTS_HOME_FILTERS)).toBe(false)
    expect(toUniworkListFilters(DEFAULT_DOCUMENTS_HOME_FILTERS, fixedNow)).toEqual({})

    expect(updatedFromIsoOf('any', fixedNow)).toBeUndefined()
    expect(updatedFromIsoOf('24h', fixedNow)).toBe('2026-10-16T12:00:00.000Z')
    expect(updatedFromIsoOf('7d', fixedNow)).toBe('2026-10-10T12:00:00.000Z')
    expect(updatedFromIsoOf('30d', fixedNow)).toBe('2026-09-17T12:00:00.000Z')

    const active = {
      format: 'xlsx' as const,
      updatedBy: 'user-42',
      updatedPreset: '7d' as const,
    }
    expect(hasActiveFilters(active)).toBe(true)
    expect(toUniworkListFilters(active, fixedNow)).toEqual({
      format: 'xlsx',
      updatedBy: 'user-42',
      updatedFrom: '2026-10-10T12:00:00.000Z',
    })
  })

  it('collects deduplicated Modified-by options only from rows with an updatedById AND a resolved name (DH1-R1-4, DH1-BE-10)', () => {
    const docs: DocumentsHomeDoc[] = [
      makeDoc({ id: 'd1', updatedById: 'u-1', updatedByName: 'Minh Trần' }),
      makeDoc({ id: 'd2', updatedById: 'u-2', updatedByName: 'Lan Nguyễn' }),
      makeDoc({ id: 'd3', updatedById: 'u-1', updatedByName: 'Minh Trần' }),
      makeDoc({ id: 'd4', updatedByName: 'Hải Lê' }),
      makeDoc({ id: 'd5', updatedById: '   ', updatedByName: 'Blank Id' }),
      makeDoc({ id: 'd6', updatedById: 'u-3' }),
      makeDoc({ id: 'd7' }),
    ]
    // u-3 carries an updater id but no resolved name on any row: the raw id must
    // never reach the "Người sửa" dropdown as a label, so the option is omitted.
    expect(collectUpdatedByOptions(docs)).toEqual([
      { id: 'u-1', name: 'Minh Trần' },
      { id: 'u-2', name: 'Lan Nguyễn' },
    ])
  })

  it('lets a later named row win over an earlier unnamed row for the same updater id (DH1-BE-10)', () => {
    const docs: DocumentsHomeDoc[] = [
      makeDoc({ id: 'd1', updatedById: 'u-1', updatedByName: 'Minh Trần' }),
      makeDoc({ id: 'd2', updatedById: 'u-late' }),
      makeDoc({ id: 'd3', updatedById: 'u-2', updatedByName: 'Lan Nguyễn' }),
      makeDoc({ id: 'd4', updatedById: 'u-late', updatedByName: 'Hải Lê' }),
      makeDoc({ id: 'd5', updatedById: 'u-ghost' }),
      makeDoc({ id: 'd6', updatedById: 'u-ghost', updatedByName: '   ' }),
    ]
    // u-late's slot keeps its first id occurrence (d2) while d4 supplies the
    // name; u-ghost never resolves a name anywhere -> no option at all.
    expect(collectUpdatedByOptions(docs)).toEqual([
      { id: 'u-1', name: 'Minh Trần' },
      { id: 'u-late', name: 'Hải Lê' },
      { id: 'u-2', name: 'Lan Nguyễn' },
    ])
  })

  it('keeps the selected Updated-by id in the options with the generic label when no loaded row names it, while other unnamed ids stay omitted (DH1-R4-9)', () => {
    const docs: DocumentsHomeDoc[] = [
      makeDoc({ id: 'd1', updatedById: 'u-1', updatedByName: 'Minh Trần' }),
      makeDoc({ id: 'd2', updatedById: 'u-ghost' }),
      makeDoc({ id: 'd3', updatedById: 'u-other' }),
    ]
    const named = collectUpdatedByOptions(docs)
    expect(named).toEqual([{ id: 'u-1', name: 'Minh Trần' }])

    // the selected id is always a valid option (the select never blanks while
    // the filter is active); an unselected unnamed id is still omitted (DH1-BE-10)
    expect(updatedByOptionsForSelect(named, 'u-ghost', 'Someone')).toEqual([
      { id: 'u-1', name: 'Minh Trần' },
      { id: 'u-ghost', name: 'Someone' },
    ])
    expect(updatedByOptionsForSelect(named, 'u-1', 'Someone')).toEqual([
      { id: 'u-1', name: 'Minh Trần' },
    ])
    expect(updatedByOptionsForSelect(named, '', 'Someone')).toEqual([
      { id: 'u-1', name: 'Minh Trần' },
    ])
    expect(updatedByOptionsForSelect(named, '   ', 'Someone')).toEqual([
      { id: 'u-1', name: 'Minh Trần' },
    ])
  })

  it('lists Shared with me / Shared by me rows as given: a row without parentId stays a root row and no folder is added', async () => {
    const rootRow = makeDoc({ id: 'recipient-doc', parentId: null })
    const page = { ok: true as const, value: { documents: [rootRow], nextCursor: null } }
    const api: DocumentsHomeApiAdapter = {
      uniworkListChildren: vi.fn(),
      uniworkEnsureMyFolder: vi.fn(),
      uniworkListDocuments: vi.fn(),
      uniworkListSharedWithMe: vi.fn(async () => page),
      uniworkListSharedByMe: vi.fn(async () => page),
    } as unknown as DocumentsHomeApiAdapter
    for (const subView of ['shared-with-me', 'shared-by-me'] as const) {
      const res = await fetchDocumentsHomePage(api, {
        subView,
        workspaceId: 'ws-1',
        folderId: null,
        myFolderId: null,
        filters: DEFAULT_DOCUMENTS_HOME_FILTERS,
      })
      expect(res.result).toEqual({ ok: true, value: { items: [rootRow], nextCursor: null } })
    }
  })

  it('forwards the header sort to every list call and sends nothing without one (UNI-2047)', async () => {
    const docs = { ok: true as const, value: { documents: [], nextCursor: null } }
    const children = { ok: true as const, value: { items: [], nextCursor: null } }
    const fn = (page: unknown) => vi.fn(async (..._args: unknown[]) => page)
    const api = {
      uniworkListChildren: fn(children),
      uniworkListDocuments: fn(docs),
      uniworkListSharedWithMe: fn(docs),
      uniworkListSharedByMe: fn(docs),
      uniworkListTrash: fn(docs),
      uniworkListShelved: fn(docs),
    }
    const calls = [
      ['workspace', 'uniworkListChildren'],
      ['recent', 'uniworkListDocuments'],
      ['shared-with-me', 'uniworkListSharedWithMe'],
      ['shared-by-me', 'uniworkListSharedByMe'],
      ['trash', 'uniworkListTrash'],
      ['archive', 'uniworkListShelved'],
    ] as const
    for (const [subView, name] of calls) {
      const base = {
        subView,
        workspaceId: 'ws-1',
        folderId: null,
        myFolderId: null,
        filters: DEFAULT_DOCUMENTS_HOME_FILTERS,
      }
      await fetchDocumentsHomePage(api as unknown as DocumentsHomeApiAdapter, base)
      expect(api[name].mock.calls.at(-1)?.[0], `${subView} unsorted`).not.toHaveProperty('sort')
      expect(api[name].mock.calls.at(-1)?.[0], `${subView} unsorted`).not.toHaveProperty('order')

      await fetchDocumentsHomePage(api as unknown as DocumentsHomeApiAdapter, {
        ...base,
        sort: { sort: 'name', order: 'desc' },
      })
      expect(api[name].mock.calls.at(-1)?.[0], `${subView} sorted`).toMatchObject({
        sort: 'name',
        order: 'desc',
      })
    }
  })

  it('splits folders and files and sorts by recent or name', () => {
    const items: DocumentsHomeDoc[] = [
      makeDoc({
        id: 'f-b',
        title: 'Beta Folder',
        kind: 'folder',
        position: 2,
        updatedAt: '2026-10-10T00:00:00.000Z',
      }),
      makeDoc({
        id: 'f-a',
        title: 'Alpha Folder',
        kind: 'folder',
        position: 1,
        updatedAt: '2026-10-12T00:00:00.000Z',
      }),
      makeDoc({
        id: 'd-b',
        title: 'Zeta.docx',
        kind: 'file',
        updatedAt: '2026-10-16T00:00:00.000Z',
      }),
      makeDoc({
        id: 'd-a',
        title: 'Alpha.docx',
        kind: 'file',
        updatedAt: '2026-10-11T00:00:00.000Z',
      }),
    ]

    const byRecent = splitAndSortItems(items, 'recent', 'en')
    expect(byRecent.folders.map((f) => f.id)).toEqual(['f-a', 'f-b'])
    expect(byRecent.files.map((f) => f.id)).toEqual(['d-b', 'd-a'])

    const byName = splitAndSortItems(items, 'name', 'en')
    expect(byName.folders.map((f) => f.id)).toEqual(['f-a', 'f-b'])
    expect(byName.files.map((f) => f.id)).toEqual(['d-a', 'd-b'])
  })

  it('routes fetchDocumentsHomePage to the right IPC method, maps UniworkDocListPage.documents -> items, and keeps shared-with-me org-wide (DH1-R1-1, DH1-R1-2)', async () => {
    const childDoc = makeDoc({ id: 'child-doc' })
    const listDoc = makeDoc({ id: 'list-doc' })
    const childrenOk = {
      ok: true as const,
      value: { items: [childDoc], nextCursor: 'child-next' },
    }
    const listPageOk = {
      ok: true as const,
      value: { documents: [listDoc], nextCursor: 'list-next' },
    }
    const api: DocumentsHomeApiAdapter = {
      uniworkListChildren: vi.fn(async () => childrenOk),
      uniworkEnsureMyFolder: vi.fn(async () => ({
        ok: true as const,
        value: {
          id: 'f-mine-ensured',
          parentId: null,
          title: 'My Folder',
          position: 0,
          kind: 'my_folder' as const,
          isSystem: true,
          children: [],
        },
      })),
      uniworkListDocuments: vi.fn(async () => listPageOk),
      uniworkListSharedWithMe: vi.fn(async () => listPageOk),
      uniworkListSharedByMe: vi.fn(async () => listPageOk),
      uniworkListTrash: vi.fn(async () => listPageOk),
    }
    const filters = { format: 'docx' as const, updatedBy: 'u-1' }

    const wsRes = await fetchDocumentsHomePage(api, {
      subView: 'workspace',
      workspaceId: 'ws-1',
      folderId: 'f-10',
      myFolderId: 'f-mine',
      filters,
    })
    expect(api.uniworkListChildren).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      parentId: 'f-10',
      cursor: undefined,
      format: 'docx',
      updatedBy: 'u-1',
    })
    expect(wsRes.result).toEqual({
      ok: true,
      value: { items: [childDoc], nextCursor: 'child-next' },
    })

    await fetchDocumentsHomePage(api, {
      subView: 'my-folder',
      workspaceId: 'ws-1',
      folderId: null,
      myFolderId: 'f-mine',
      filters,
    })
    expect(api.uniworkListChildren).toHaveBeenLastCalledWith({
      workspaceId: 'ws-1',
      parentId: 'f-mine',
      cursor: undefined,
      format: 'docx',
      updatedBy: 'u-1',
    })

    // When myFolderId is null in my-folder sub-view, calls uniworkEnsureMyFolder then lists its children
    const ensuredRes = await fetchDocumentsHomePage(api, {
      subView: 'my-folder',
      workspaceId: 'ws-1',
      folderId: null,
      myFolderId: null,
      filters,
    })
    expect(api.uniworkEnsureMyFolder).toHaveBeenCalledWith('ws-1')
    expect(ensuredRes.ensuredMyFolder?.id).toBe('f-mine-ensured')
    expect(api.uniworkListChildren).toHaveBeenLastCalledWith({
      workspaceId: 'ws-1',
      parentId: 'f-mine-ensured',
      cursor: undefined,
      format: 'docx',
      updatedBy: 'u-1',
    })

    const recentRes = await fetchDocumentsHomePage(api, {
      subView: 'recent',
      workspaceId: 'ws-1',
      folderId: null,
      myFolderId: null,
      filters,
    })
    // UNI-1953 CT1-1: the Documents-home Recent also lists UniNote pages
    expect(api.uniworkListDocuments).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      cursor: undefined,
      format: 'docx',
      updatedBy: 'u-1',
      includePages: true,
    })
    expect(recentRes.result).toEqual({
      ok: true,
      value: { items: [listDoc], nextCursor: 'list-next' },
    })

    // shared-with-me is org-wide: no workspaceId; the type / editor / date filters ride along (UNI-2047 A3) with { includePages }, and { cursor } when paging
    const swmRes = await fetchDocumentsHomePage(api, {
      subView: 'shared-with-me',
      workspaceId: 'ws-1',
      folderId: null,
      myFolderId: null,
      filters,
    })
    expect(api.uniworkListSharedWithMe).toHaveBeenCalledWith({
      includePages: true,
      format: 'docx',
      updatedBy: 'u-1',
    })
    expect(swmRes.result).toEqual({
      ok: true,
      value: { items: [listDoc], nextCursor: 'list-next' },
    })

    await fetchDocumentsHomePage(api, {
      subView: 'shared-with-me',
      workspaceId: 'ws-1',
      folderId: null,
      myFolderId: null,
      cursor: 'swm-cur-2',
      filters,
    })
    expect(api.uniworkListSharedWithMe).toHaveBeenLastCalledWith({
      cursor: 'swm-cur-2',
      includePages: true,
      format: 'docx',
      updatedBy: 'u-1',
    })

    const sbmRes = await fetchDocumentsHomePage(api, {
      subView: 'shared-by-me',
      workspaceId: 'ws-1',
      folderId: null,
      myFolderId: null,
      filters,
    })
    expect(api.uniworkListSharedByMe).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      cursor: undefined,
      format: 'docx',
      updatedBy: 'u-1',
    })
    expect(sbmRes.result).toEqual({
      ok: true,
      value: { items: [listDoc], nextCursor: 'list-next' },
    })

    const trashRes = await fetchDocumentsHomePage(api, {
      subView: 'trash',
      workspaceId: 'ws-1',
      folderId: null,
      myFolderId: null,
      filters,
    })
    expect(api.uniworkListTrash).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      cursor: undefined,
      format: 'docx',
      updatedBy: 'u-1',
    })
    expect(trashRes.result).toEqual({
      ok: true,
      value: { items: [listDoc], nextCursor: 'list-next' },
    })
  })

  it('keeps Vietnamese strings verbatim with board copy and zero "cục bộ" occurrences', () => {
    expect(Object.keys(viLocale).sort()).toEqual(Object.keys(zh).sort())
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(viLocale.uhNavWorkspace).toBe('Tài liệu của workspace')
    expect(viLocale.uhNavMyFolder).toBe('Thư mục của tôi')
    expect(viLocale.uhNavRecent).toBe('Gần đây')
    expect(viLocale.uhNavSharedWithMe).toBe('Được chia sẻ với tôi')
    expect(viLocale.uhNavSharedByMe).toBe('Tôi đã chia sẻ')
    expect(viLocale.uhNavTrash).toBe('Thùng rác')
    expect(viLocale.uhQuickCreate).toBe('Tạo nhanh')
    expect(viLocale.uhQuickDocx).toBe('Văn bản')
    expect(viLocale.uhQuickXlsx).toBe('Bảng tính')
    expect(viLocale.uhQuickPptx).toBe('Trình chiếu')
    expect(viLocale.uhColName).toBe('Tên')
    expect(viLocale.uhColAccess).toBe('Truy cập')
    expect(viLocale.uhColUpdatedBy).toBe('Người sửa gần nhất')
    expect(viLocale.uhColUpdatedAt).toBe('Cập nhật')
    expect(viLocale.uhColActions).toBe('Thao tác')

    for (const [key, val] of Object.entries(viLocale)) {
      expect(val.toLowerCase(), `vi.${key} must not contain "cục bộ"`).not.toContain('cục bộ')
    }
  })

  it('fixes Hebrew mixed Arabic script, Hindi workspace nav, and translates uhVisWorkspace in all 19 non-en/non-vi shards (DH1-R1-10)', () => {
    expect(he.uhFilterTypeAll).toBe('הכל')
    for (const [key, val] of Object.entries(he)) {
      expect(val, `he.${key} must not contain Arabic script`).not.toMatch(/[\u0600-\u06FF]/)
    }

    expect(hi.uhNavWorkspace).toBe('कार्यस्थान दस्तावेज़')

    // en and vi deliberately keep "Workspace" (board copy); the other 19 shards translate uhVisWorkspace
    expect(en.uhVisWorkspace).toBe('Workspace')
    expect(viLocale.uhVisWorkspace).toBe('Workspace')

    const nonEnViShards: Array<[string, Record<string, string>]> = [
      ['zh', zh],
      ['zh-TW', zhTW],
      ['ja', ja],
      ['ko', ko],
      ['fr', fr],
      ['de', de],
      ['es', es],
      ['pt', pt],
      ['cs', cs],
      ['it', itLocale],
      ['ru', ru],
      ['ar', ar],
      ['hi', hi],
      ['th', th],
      ['id', idLocale],
      ['ms', ms],
      ['pl', pl],
      ['nl', nl],
      ['he', he],
    ]
    for (const [code, shard] of nonEnViShards) {
      expect(Object.keys(shard).sort(), `${code} keys`).toEqual(Object.keys(zh).sort())
      expect(
        shard.uhVisWorkspace,
        `${code}.uhVisWorkspace should be translated, not raw English "Workspace"`,
      ).not.toBe('Workspace')
      expect(
        shard.uhVisWorkspace.trim().length,
        `${code}.uhVisWorkspace non-empty`,
      ).toBeGreaterThan(0)
    }
  })
})

describe('UNI-1961 documents-home-model: the Lưu trữ (Archive) shelf', () => {
  it('routes the archive sub-view to uniworkListShelved with the cursor and the type filter only', async () => {
    const shelvedDoc = makeDoc({ id: 'shelved-doc', shelvedAt: '2026-10-18T09:00:00Z' })
    const api: DocumentsHomeApiAdapter = {
      uniworkListShelved: vi.fn(async () => ({
        ok: true as const,
        value: { documents: [shelvedDoc], nextCursor: 'shelf-next' },
      })),
      uniworkListTrash: vi.fn(),
    }
    const res = await fetchDocumentsHomePage(api, {
      workspaceId: 'ws-1',
      subView: 'archive',
      folderId: null,
      cursor: 'c-1',
      filters: { format: 'pdf', updatedBy: 'u-1', updatedFrom: '2026-10-01T00:00:00Z' },
    })
    expect(api.uniworkListShelved).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      cursor: 'c-1',
      format: 'pdf',
    })
    expect(api.uniworkListTrash).not.toHaveBeenCalled()
    expect(res.result).toEqual({
      ok: true,
      value: { items: [shelvedDoc], nextCursor: 'shelf-next' },
    })
  })
})

describe('the shared type chips (UNI-2047 A3)', () => {
  const doc = (partial: Partial<DocumentsHomeDoc>): DocumentsHomeDoc => ({
    id: 'd',
    workspaceId: 'ws-1',
    title: 'd',
    format: 'docx',
    updatedAt: '2026-10-20T08:00:00.000Z',
    kind: 'file',
    parentId: null,
    ...partial,
  })
  const asRow = (d: DocumentsHomeDoc) => ({ type: 'doc' as const, id: d.id, doc: d })
  const source = (extension: string) =>
    ({ type: 'source' as const, id: 's', source: { extension } }) as never

  it('lists the chips in the one shared order', () => {
    expect(DOCUMENTS_HOME_TYPE_CHIPS.map((c) => c.value)).toEqual([
      'all',
      'page',
      'docx',
      'xlsx',
      'pptx',
      'pdf',
      'md',
      'html',
      'txt',
    ])
  })

  it('sends a file format and .txt as format, and UniNote as kind', () => {
    const at = Date.UTC(2026, 9, 21)
    expect(toUniworkListFilters({ ...DEFAULT_DOCUMENTS_HOME_FILTERS, format: 'txt' }, at)).toEqual({
      format: 'txt',
    })
    // UniNote is a kind, not a format: the server takes `kind=page` (and 400s on format + page)
    expect(toUniworkListFilters({ ...DEFAULT_DOCUMENTS_HOME_FILTERS, format: 'page' }, at)).toEqual(
      { kind: 'page' },
    )
    // UniNote still counts as an active filter (the Xóa bộ lọc button and the no-match state)
    expect(hasActiveFilters({ ...DEFAULT_DOCUMENTS_HOME_FILTERS, format: 'page' })).toBe(true)
  })

  it('narrows UniNote on the loaded rows and drops every source file under it', () => {
    expect(rowMatchesType(asRow(doc({ kind: 'page', format: null })), 'page')).toBe(true)
    expect(rowMatchesType(asRow(doc({})), 'page')).toBe(false)
    expect(rowMatchesType(asRow(doc({ kind: 'folder', format: null })), 'page')).toBe(false)
    expect(rowMatchesType(source('pdf'), 'page')).toBe(false)
    expect(rowMatchesType(asRow(doc({})), 'all')).toBe(true)
  })

  it('keeps only .txt source files under .txt (the sources route may not apply it)', () => {
    expect(rowMatchesType(source('txt'), 'txt')).toBe(true)
    expect(rowMatchesType(source('.TXT'), 'txt')).toBe(true)
    expect(rowMatchesType(source('md'), 'txt')).toBe(false)
    expect(rowMatchesType(source('md'), 'md')).toBe(true)
  })

  it('matches Người sửa and Cập nhật on a loaded row, a row without the field does not match', () => {
    const d = doc({ updatedById: 'u-1' })
    expect(docMatchesUpdated(d, {})).toBe(true)
    expect(docMatchesUpdated(d, { updatedBy: 'u-1' })).toBe(true)
    expect(docMatchesUpdated(d, { updatedBy: 'u-2' })).toBe(false)
    expect(docMatchesUpdated(doc({}), { updatedBy: 'u-1' })).toBe(false)
    expect(docMatchesUpdated(d, { updatedFrom: '2026-10-19T00:00:00.000Z' })).toBe(true)
    expect(docMatchesUpdated(d, { updatedFrom: '2026-10-21T00:00:00.000Z' })).toBe(false)
    expect(
      docMatchesUpdated(doc({ updatedAt: 'garbage' }), { updatedFrom: '2026-10-19T00:00:00.000Z' }),
    ).toBe(false)
  })
})
