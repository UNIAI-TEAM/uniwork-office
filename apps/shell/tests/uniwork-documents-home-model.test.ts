import { describe, expect, it, vi } from 'vitest'
import * as homeModel from '../src/renderer/src/uniwork-home/documents-home-model'
import {
  collectUpdatedByOptions,
  DEFAULT_DOCUMENTS_HOME_FILTERS,
  DOCUMENTS_HOME_NAV_ENTRIES,
  DOCUMENTS_HOME_TYPE_OPTIONS,
  docMatchesUpdated,
  fetchDocumentsHomePage,
  fetchDocumentsHomeSources,
  folderCardsUnderTypePick,
  getDocumentsHomeNavEntry,
  hasActiveFilters,
  rowsUnderTypePick,
  splitAndSortItems,
  typePickHidesFolders,
  toggleTypePick,
  TYPE_PICK_HIDES_FOLDERS,
  toUniworkListFilters,
  updatedByOptionsForSelect,
  updatedFromIsoOf,
  visibleDocumentsHomeNavEntries,
  type DocumentsHomeApiAdapter,
  type DocumentsHomeDoc,
} from '../src/renderer/src/uniwork-home/documents-home-model'
import { uniworkHomeStrings } from '../src/renderer/src/i18n/strings-uniwork-home'
import { zh } from '../src/renderer/src/i18n/uniwork-home/zh'
import { zhTW } from '../src/renderer/src/i18n/uniwork-home/zh-TW'
import { vi as viLocale } from '../src/renderer/src/i18n/uniwork-home/vi'
import { en } from '../src/renderer/src/i18n/uniwork-home/en'
import {
  driveActivityRows,
  driveCreationRows,
  driveErrorKey,
  driveTypeLabel,
  reboundByName,
  showRebind,
  viewerLocksUni,
  viewerNeedsWeb,
} from '../src/renderer/src/uniwork-home/drive-panel-model'
import type { DriveFile, DriveHistoryEvent } from '../src/shared/home-api'
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
  it('defines the 10 sub-nav entries in exact order (UNI-1961: archive shown; UNI-2047 B6: starred shown; UNI-2195: google-drive registered)', () => {
    expect(DOCUMENTS_HOME_NAV_ENTRIES.map((e) => e.id)).toEqual([
      'workspace',
      'my-folder',
      'google-drive',
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
    const drive = getDocumentsHomeNavEntry('google-drive')
    expect(starred.available).toBe(true)
    expect(starred.source).toBe('favorites')
    expect(archive.available).toBe(true)
    expect(archive.source).toBe('shelved')
    expect(drive.available).toBe(false)
    expect(drive.source).toBe('drive')
    expect(drive.labelKey).toBe('uhNavGoogleDrive')

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

  it('converts UI filter state (types, updatedBy, updatedPreset) to UniworkListFilters', () => {
    const fixedNow = Date.parse('2026-10-17T12:00:00.000Z')
    expect(hasActiveFilters(DEFAULT_DOCUMENTS_HOME_FILTERS)).toBe(false)
    expect(toUniworkListFilters(DEFAULT_DOCUMENTS_HOME_FILTERS, fixedNow)).toEqual({})

    expect(updatedFromIsoOf('any', fixedNow)).toBeUndefined()
    expect(updatedFromIsoOf('24h', fixedNow)).toBe('2026-10-16T12:00:00.000Z')
    expect(updatedFromIsoOf('7d', fixedNow)).toBe('2026-10-10T12:00:00.000Z')
    expect(updatedFromIsoOf('30d', fixedNow)).toBe('2026-09-17T12:00:00.000Z')

    const active = {
      types: ['xlsx' as const],
      updatedBy: 'user-42',
      updatedPreset: '7d' as const,
    }
    expect(hasActiveFilters(active)).toBe(true)
    expect(toUniworkListFilters(active, fixedNow)).toEqual({
      types: ['xlsx'],
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
      filters: { types: ['pdf', 'txt'], updatedBy: 'u-1', updatedFrom: '2026-10-01T00:00:00Z' },
    })
    expect(api.uniworkListShelved).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      cursor: 'c-1',
      types: ['pdf', 'txt'],
    })
    expect(api.uniworkListTrash).not.toHaveBeenCalled()
    expect(res.result).toEqual({
      ok: true,
      value: { items: [shelvedDoc], nextCursor: 'shelf-next' },
    })
  })
})

describe('the Type multi-select model (UNI-2113)', () => {
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

  it('lists the menu options in the one shared order, All types is no option', () => {
    expect(DOCUMENTS_HOME_TYPE_OPTIONS.map((c) => c.value)).toEqual([
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

  it('starts with no pick (= all types)', () => {
    expect(DEFAULT_DOCUMENTS_HOME_FILTERS.types).toEqual([])
    expect(DEFAULT_DOCUMENTS_HOME_FILTERS).not.toHaveProperty('format')
  })

  it('sends the picks as `types` in menu order, and no format / kind', () => {
    const at = Date.UTC(2026, 9, 21)
    expect(
      toUniworkListFilters({ ...DEFAULT_DOCUMENTS_HOME_FILTERS, types: ['page', 'docx'] }, at),
    ).toEqual({ types: ['page', 'docx'] })
    expect(toUniworkListFilters({ ...DEFAULT_DOCUMENTS_HOME_FILTERS, types: ['txt'] }, at)).toEqual(
      {
        types: ['txt'],
      },
    )
    expect(toUniworkListFilters(DEFAULT_DOCUMENTS_HOME_FILTERS, at)).toEqual({})
  })

  it('counts a pick as an active filter (the clear button and the no-match state)', () => {
    expect(hasActiveFilters({ ...DEFAULT_DOCUMENTS_HOME_FILTERS, types: ['page'] })).toBe(true)
    expect(hasActiveFilters({ ...DEFAULT_DOCUMENTS_HOME_FILTERS, types: [] })).toBe(false)
  })

  it('toggles a pick on and off and keeps menu order, never click order', () => {
    expect(toggleTypePick([], 'pdf')).toEqual(['pdf'])
    expect(toggleTypePick(['pdf'], 'docx')).toEqual(['docx', 'pdf'])
    expect(toggleTypePick(['docx', 'pdf'], 'page')).toEqual(['page', 'docx', 'pdf'])
    expect(toggleTypePick(['docx', 'pdf'], 'docx')).toEqual(['pdf'])
    expect(toggleTypePick(['pdf'], 'pdf')).toEqual([])
  })

  it('narrows no row on the client any more: every row is the server answer', () => {
    expect(homeModel).not.toHaveProperty('rowMatchesType')
  })

  it('forwards the picks as types to every list route, never as format or kind', async () => {
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
      uniworkListFavorites: fn(docs),
    }
    const calls = [
      ['workspace', 'uniworkListChildren'],
      ['recent', 'uniworkListDocuments'],
      ['starred', 'uniworkListFavorites'],
      ['shared-with-me', 'uniworkListSharedWithMe'],
      ['shared-by-me', 'uniworkListSharedByMe'],
      ['trash', 'uniworkListTrash'],
      ['archive', 'uniworkListShelved'],
    ] as const
    for (const [subView, name] of calls) {
      await fetchDocumentsHomePage(api as unknown as DocumentsHomeApiAdapter, {
        subView,
        workspaceId: 'ws-1',
        folderId: null,
        myFolderId: null,
        filters: { types: ['page', 'docx', 'txt'] },
      })
      const sent = api[name].mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(sent.types, subView).toEqual(['page', 'docx', 'txt'])
      expect(sent, subView).not.toHaveProperty('format')
      expect(sent, subView).not.toHaveProperty('kind')
    }
  })

  it('sends the picks to the sources route as types', async () => {
    const uniworkListSources = vi.fn(async () => ({
      ok: true as const,
      value: { items: [], nextCursor: null },
    }))
    await fetchDocumentsHomeSources({ uniworkListSources } as unknown as DocumentsHomeApiAdapter, {
      workspaceId: 'ws-1',
      filters: { types: ['pdf', 'txt'] },
    })
    expect(uniworkListSources).toHaveBeenCalledWith({ workspaceId: 'ws-1', types: ['pdf', 'txt'] })
    await fetchDocumentsHomeSources({ uniworkListSources } as unknown as DocumentsHomeApiAdapter, {
      workspaceId: 'ws-1',
      filters: {},
    })
    expect(uniworkListSources).toHaveBeenLastCalledWith({ workspaceId: 'ws-1' })
  })

  describe('Q0: folders under a Type pick, one switch', () => {
    const rows = [
      asRow(doc({ id: 'f', kind: 'folder', format: null })),
      asRow(doc({ id: 'a' })),
      asRow(doc({ id: 'p', kind: 'page', format: null })),
    ]
    it('ships with folders kept (the server behaviour)', () => {
      expect(TYPE_PICK_HIDES_FOLDERS).toBe(false)
    })
    it('keeps every row with the switch off', () => {
      expect(rowsUnderTypePick(rows, ['docx'], false).map((r) => r.id)).toEqual(['f', 'a', 'p'])
      expect(rowsUnderTypePick(rows, ['docx']).map((r) => r.id)).toEqual(['f', 'a', 'p'])
    })
    it('drops folder rows of a flat list under a pick with the switch on', () => {
      expect(rowsUnderTypePick(rows, ['docx'], true).map((r) => r.id)).toEqual(['a', 'p'])
      // no pick = nothing is dropped
      expect(rowsUnderTypePick(rows, [], true).map((r) => r.id)).toEqual(['f', 'a', 'p'])
    })

    // UNI-2113 fix1 (T-R1-2): the same rule decides the folder cards, so one switch moves both
    it('names the rule once: hidden only with the switch on and a pick set', () => {
      expect(typePickHidesFolders(['docx'], true)).toBe(true)
      expect(typePickHidesFolders(['docx'], false)).toBe(false)
      expect(typePickHidesFolders([], true)).toBe(false)
      expect(typePickHidesFolders(['docx'])).toBe(TYPE_PICK_HIDES_FOLDERS)
    })
    const cards = [doc({ id: 'c1', kind: 'folder' }), doc({ id: 'c2', kind: 'folder' })]
    it('drops the folder cards of a flat list under a pick with the switch on', () => {
      expect(folderCardsUnderTypePick(cards, ['docx'], false, true)).toEqual([])
      expect(folderCardsUnderTypePick(cards, [], false, true)).toEqual(cards)
      expect(folderCardsUnderTypePick(cards, ['docx'], false, false)).toEqual(cards)
      expect(folderCardsUnderTypePick(cards, ['docx'], false)).toEqual(cards)
    })
    it('keeps the folder cards of the tree level whatever the switch says', () => {
      expect(folderCardsUnderTypePick(cards, ['docx'], true, true)).toEqual(cards)
      expect(folderCardsUnderTypePick(cards, ['docx'], true, false)).toEqual(cards)
    })
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

describe('the Type filter strings (UNI-2113)', () => {
  const langs = Object.keys(uniworkHomeStrings) as (keyof typeof uniworkHomeStrings)[]

  it('says the web vi/en words verbatim', () => {
    expect(viLocale.uhFilterType).toBe('Loại:')
    expect(en.uhFilterType).toBe('Type:')
    expect(viLocale.uhFilterTypeAll).toBe('Tất cả')
    expect(en.uhFilterTypeAll).toBe('All types')
    expect(viLocale.uhFilterTypeCount).toBe('{count} loại')
    expect(en.uhFilterTypeCount).toBe('{count} types')
    expect(viLocale.uhFilterTypeRemove).toBe('Bỏ lọc {type}')
    expect(en.uhFilterTypeRemove).toBe('Remove {type} filter')
  })

  it.each(langs)('locale %s carries the count and remove keys with their placeholders', (lang) => {
    const table = uniworkHomeStrings[lang] as Record<string, string>
    expect(table.uhFilterTypeCount, lang).toContain('{count}')
    expect(table.uhFilterTypeRemove, lang).toContain('{type}')
  })

  it('translates the remove key outside en and vi (not the English copy)', () => {
    for (const lang of langs.filter((l) => !['en', 'vi'].includes(l))) {
      const table = uniworkHomeStrings[lang] as Record<string, string>
      expect(table.uhFilterTypeRemove, lang).not.toBe(en.uhFilterTypeRemove)
    }
  })
})

describe('UNI-2195 (D2) Google Drive sidebar visibility, loader, and i18n keys', () => {
  const activeConn = {
    id: 'dc-active',
    provider: 'google',
    googleEmail: 'minh@company.vn',
    status: 'active' as const,
    needsReconnect: false,
    linkedFileCount: 1,
    connectedAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-10T00:00:00Z',
  }
  const brokenConn = {
    id: 'dc-broken',
    provider: 'google',
    googleEmail: 'lan@company.vn',
    status: 'needs_reconnect' as const,
    needsReconnect: true,
    authFailedAt: '2026-10-12T00:00:00Z',
    authFailedReason: 'invalid_grant',
    linkedFileCount: 2,
    connectedAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-12T00:00:00Z',
  }

  it('computes Google Drive sidebar visibility and sub-rows per spec §17.2, §7.6, and Q6', () => {
    // Hidden when drive_connector capability is off even if connections exist
    expect(
      homeModel.buildDriveSidebarState({
        capability: false,
        connections: [activeConn],
      }),
    ).toEqual({
      visible: false,
      totalCount: 0,
      accounts: [],
    })

    // Hidden when capability is on, 0 connections (Q6: no "Người khác liên kết" row)
    expect(
      homeModel.buildDriveSidebarState({
        capability: true,
        connections: [],
      }),
    ).toEqual({
      visible: false,
      totalCount: 0,
      accounts: [],
    })

    // Shown with account sub-rows and aggregate linked count when caller has >= 1 connection (including broken)
    expect(
      homeModel.buildDriveSidebarState({
        capability: true,
        connections: [activeConn, brokenConn],
      }),
    ).toEqual({
      visible: true,
      totalCount: 3,
      accounts: [
        {
          id: 'dc-active',
          email: 'minh@company.vn',
          linkedFileCount: 1,
          needsReconnect: false,
        },
        {
          id: 'dc-broken',
          email: 'lan@company.vn',
          linkedFileCount: 2,
          needsReconnect: true,
        },
      ],
    })

    // Keeps row visible when going offline after seen in session; hidden on cold start offline
    expect(
      homeModel.isDriveSidebarVisible({
        capability: false,
        connections: [activeConn],
        offline: true,
        seenInSession: true,
      }),
    ).toBe(true)
    expect(
      homeModel.isDriveSidebarVisible({
        capability: false,
        connections: [activeConn],
        offline: true,
        seenInSession: false,
      }),
    ).toBe(false)

    // R1-5: Once seen in session, keeps row visible even when capability cache expires and offline is false (e.g. non-network refresh error), as long as connections > 0
    expect(
      homeModel.isDriveSidebarVisible({
        capability: false,
        connections: [activeConn],
        offline: false,
        seenInSession: true,
      }),
    ).toBe(true)
    expect(
      homeModel.isDriveSidebarVisible({
        capability: false,
        connections: [],
        offline: false,
        seenInSession: true,
      }),
    ).toBe(false)
  })

  it('resolveDriveAccountFilter returns connection id only when it belongs to the viewer connections', () => {
    expect(homeModel.resolveDriveAccountFilter(null, [activeConn, brokenConn])).toBeNull()
    expect(homeModel.resolveDriveAccountFilter('dc-unknown', [activeConn, brokenConn])).toBeNull()
    expect(homeModel.resolveDriveAccountFilter('dc-broken', [activeConn, brokenConn])).toBe(
      'dc-broken',
    )
  })

  it('fetchDocumentsHomeDriveFiles forwards connectionId, cursor, and limit to the Drive bridge', async () => {
    const listFiles = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        files: [
          {
            id: 'df-1',
            organizationId: 'org-1',
            workspaceId: 'ws-1',
            externalFileId: 'ext-1',
            name: 'Kế hoạch Q4',
            mimeType: 'application/vnd.google-apps.document',
            iconKind: 'google_doc',
            webViewLink: 'https://docs.google.com/document/d/ext-1/edit',
            openUrl: 'https://docs.google.com/document/d/ext-1/edit',
            ownerDisplay: 'Minh',
            sharingState: 'shared',
            sharedUserCount: 4,
            connectionId: 'dc-active',
            boundAccountEmail: 'minh@company.vn',
            boundConnectionLost: false,
            boundById: 'u-1',
            boundByName: 'Minh',
            createdBy: 'u-1',
            createdByKind: 'user',
            createdByName: 'Minh',
            createdAt: '2026-10-10T00:00:00Z',
            updatedAt: '2026-10-10T00:00:00Z',
            viewerAccess: 'granted',
            viewerConnectionId: 'dc-active',
            viewerAccountEmail: 'minh@company.vn',
            canUnlink: true,
            canRebind: false,
            canPropose: true,
            canAsk: true,
            usedInCount: 0,
            usedInTasks: [],
            tasksCreated: { count: 0 },
          },
        ],
        totalCount: 1,
        nextCursor: 'next-tok',
      },
    })

    const res = await homeModel.fetchDocumentsHomeDriveFiles(
      { listFiles },
      {
        workspaceId: 'ws-1',
        connectionId: 'dc-active',
        cursor: 'cur-1',
        limit: 25,
      },
    )
    expect(listFiles).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      connectionId: 'dc-active',
      cursor: 'cur-1',
      limit: 25,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.files).toHaveLength(1)
      expect(res.value.totalCount).toBe(1)
      expect(res.value.nextCursor).toBe('next-tok')
    }
  })

  it('ships all D2 Google Drive i18n keys across all 21 locales with required placeholders', () => {
    const langs = Object.keys(uniworkHomeStrings) as (keyof typeof uniworkHomeStrings)[]
    expect(langs).toHaveLength(21)
    expect(viLocale.uhNavGoogleDrive).toBe('Google Drive')
    expect(en.uhNavGoogleDrive).toBe('Google Drive')
    expect(viLocale.uhNavDriveAccount).toBe('Drive: {email}')
    expect(en.uhNavDriveAccount).toBe('Drive: {email}')
    expect(viLocale.uhDriveLost).toBe('Mất kết nối')
    expect(en.uhDriveLost).toBe('Disconnected')
    expect(viLocale.uhDriveReconnect).toBe('Mất kết nối · kết nối lại')
    expect(en.uhDriveReconnect).toBe('Disconnected · Reconnect')
    expect(viLocale.uhDriveSharedDrive).toBe('Bộ nhớ dùng chung')
    expect(en.uhDriveSharedDrive).toBe('Shared drive')

    for (const lang of langs) {
      const table = uniworkHomeStrings[lang] as Record<string, string>
      expect(table.uhNavDriveAccount, lang).toContain('{email}')
      expect(table.uhDriveAddFromAccount, lang).toContain('{email}')
      expect(table.uhDriveSharedCountOne, lang).toContain('{count}')
      expect(table.uhDriveSharedCount, lang).toContain('{count}')
      expect(table.uhDriveUsedInSingle, lang).toContain('{identifier}')
      expect(table.uhDriveUsedInMoreOne, lang).toContain('{identifier}')
      expect(table.uhDriveUsedInMoreOne, lang).toContain('{count}')
      expect(table.uhDriveUsedInMore, lang).toContain('{identifier}')
      expect(table.uhDriveUsedInMore, lang).toContain('{count}')
      expect(table.uhDriveTasksCreatedLineOne, lang).toContain('{count}')
      expect(table.uhDriveTasksCreatedLine, lang).toContain('{count}')
    }
  })
})

describe('UNI-2196 (D3): Drive panel model', () => {
  // keys and params as plain text, so the mapping is what is asserted
  const t = (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key
  const file = (over: Partial<DriveFile>): DriveFile => ({ ...({} as DriveFile), ...over })

  it('maps every Drive error to the app message (spec §7.10)', () => {
    expect(driveErrorKey('network')).toBe('uhDriveOffline')
    expect(driveErrorKey('not_signed_in')).toBe('uwErrNotSignedIn')
    expect(driveErrorKey('session_expired')).toBe('uwErrSessionExpired')
    expect(driveErrorKey('forbidden')).toBe('uwErrForbidden')
    expect(driveErrorKey('feature_disabled')).toBe('uhDriveFeatureOff')
    expect(driveErrorKey('auth_failed')).toBe('uhDriveErrAuthFailed')
    expect(driveErrorKey('not_found')).toBe('uhDriveNotFound')
    expect(driveErrorKey('server_error')).toBe('uhDriveLoadError')
  })

  it('names the file type; plain text and unknown kinds read through the dictionary', () => {
    expect(driveTypeLabel('google_doc', t as never)).toBe('Google Docs')
    expect(driveTypeLabel('xlsx', t as never)).toBe('Excel')
    expect(driveTypeLabel('text', t as never)).toBe('uhDriveTypeText')
    expect(driveTypeLabel('something-new', t as never)).toBe('uhDriveTypeFile')
  })

  it('a file bound by someone other than the linker was rebound', () => {
    expect(
      reboundByName(file({ boundById: 'u-1', createdBy: 'u-1', boundByName: 'Minh' })),
    ).toBeNull()
    expect(reboundByName(file({ boundById: 'u-2', createdBy: 'u-1', boundByName: ' Hùng ' }))).toBe(
      'Hùng',
    )
    expect(reboundByName(file({ boundById: 'u-2', createdBy: 'u-1', boundByName: '' }))).toBeNull()
  })

  it('locks Create / Ask until the viewer reads the file; web steps for unknown, lost, connection_lost', () => {
    expect(viewerLocksUni('granted')).toBe(false)
    for (const access of ['unknown', 'lost', 'connection_lost']) {
      expect(viewerLocksUni(access)).toBe(true)
      expect(viewerNeedsWeb(access)).toBe(true)
    }
    expect(viewerNeedsWeb('granted')).toBe(false)
  })

  it('offers a rebind only when allowed and the bound connection is lost', () => {
    expect(showRebind(file({ canRebind: true, boundConnectionLost: true }))).toBe(true)
    expect(
      showRebind(file({ canRebind: true, boundConnectionLost: false, accessLostAt: 'x' })),
    ).toBe(true)
    expect(showRebind(file({ canRebind: true, boundConnectionLost: false }))).toBe(false)
    expect(showRebind(file({ canRebind: false, boundConnectionLost: true }))).toBe(false)
  })

  it('groups the created tasks per creation and drops a creation without visible tasks', () => {
    const rows = driveCreationRows(
      [
        {
          proposalId: 'p-1',
          createdAt: '2026-10-15T10:00:00Z',
          createdById: 'u-1',
          createdByName: 'Minh',
          tasks: [{ taskId: 't-1', identifier: 'UNI-1', title: 'A', status: 'todo' }],
        },
        {
          proposalId: 'p-2',
          createdAt: '2026-10-16T10:00:00Z',
          createdById: 'u-1',
          createdByName: 'Minh',
          tasks: [],
        },
      ],
      t as never,
      'en',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.label.startsWith('uhDriveTasksCreatedGroupOne:')).toBe(true)
    expect(driveCreationRows(undefined, t as never, 'en')).toEqual([])
  })

  it('lists history newest first and leaves out reads and opens', () => {
    const event = (id: string, action: string, at: string): DriveHistoryEvent =>
      ({
        id,
        action,
        occurredAt: at,
        metadata: id === 'a' ? { actor_name: 'Minh' } : {},
      }) as unknown as DriveHistoryEvent
    const rows = driveActivityRows(
      [
        event('a', 'drive_file.linked', '2026-10-10T09:00:00Z'),
        event('b', 'drive_file.opened', '2026-10-11T09:00:00Z'),
        event('c', 'drive_file.read', '2026-10-11T10:00:00Z'),
        event('d', 'drive_file.made_up', '2026-10-12T09:00:00Z'),
      ],
      t as never,
      'en',
    )
    expect(rows.map((r) => r.id)).toEqual(['d', 'a'])
    expect(rows[0]!.text).toBe('uhDriveActOther')
    expect(rows[1]!.text).toBe('Minh · uhDriveActLinked')
  })
})
