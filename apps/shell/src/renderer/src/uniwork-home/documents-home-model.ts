import type {
  UniworkDocFormat,
  UniworkDocShareScope,
  UniworkDocListPage,
  UniworkDocListQuery,
  UniworkDocSummary,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkFolderQuery,
  UniworkListSort,
  UniworkResult,
  UniworkSourceFile,
  UniworkSourceListPage,
  UniworkSourceListQuery,
} from '../../../shared/home-api'
import type { StringKey, TFunc } from '../locale'

export type UniworkDocVisibility = 'private' | 'workspace' | 'restricted'
export type UniworkDocAccessLevel = 'view' | 'comment' | 'edit' | 'manage'

export interface UniworkListFilters {
  format?: UniworkDocFormat | 'txt'
  /** UniNote chip: the server's `kind=page` (never together with `format`) */
  kind?: 'page'
  updatedBy?: string
  updatedFrom?: string
}

export type DocumentsHomeDoc = UniworkDocSummary & {
  position?: number
  visibility?: UniworkDocVisibility
  /** web Access cell source: the server's `share_scope` (absent = no scope label) */
  shareScope?: UniworkDocShareScope
  myLevel?: UniworkDocAccessLevel
  updatedById?: string
  updatedByName?: string
}

export type DocumentsHomeSubViewId =
  | 'workspace'
  | 'my-folder'
  | 'recent'
  | 'starred'
  | 'shared-with-me'
  | 'shared-by-me'
  | 'archive'
  | 'trash'
  | 'elsewhere'

export type DocumentsHomeDataSource =
  | 'children-root'
  | 'my-folder-children'
  | 'documents'
  | 'shared-with-me'
  | 'shared-by-me'
  | 'trash'
  | 'shelved'
  | 'favorites'
  | 'sources'
  | 'none'

export interface DocumentsHomeNavEntry {
  readonly id: DocumentsHomeSubViewId
  readonly labelKey: StringKey
  readonly available: boolean
  readonly source: DocumentsHomeDataSource
}

/**
 * DESKTOP-HOME DH-1 sub-navigation entry table in exact board order (Desktop.dc.html:20-27).
 * Entries with `available: false` (My Folder: a tree row) are hidden and not rendered.
 */
export const DOCUMENTS_HOME_NAV_ENTRIES: readonly DocumentsHomeNavEntry[] = [
  {
    id: 'workspace',
    labelKey: 'uhNavWorkspace',
    available: true,
    source: 'children-root',
  },
  {
    id: 'my-folder',
    labelKey: 'uhNavMyFolder',
    // UNI-1957: My Folder is listed once, as the tree row under Folders (a stand-in row
    // until the server has created it); the view itself is still reachable by id.
    available: false,
    source: 'my-folder-children',
  },
  {
    id: 'recent',
    labelKey: 'uhNavRecent',
    available: true,
    source: 'documents',
  },
  {
    id: 'starred',
    labelKey: 'uhNavStarred',
    // UNI-2047 B6: the server's SV-2 favorites route; an older server's 404 is the list error state
    available: true,
    source: 'favorites',
  },
  {
    id: 'shared-with-me',
    labelKey: 'uhNavSharedWithMe',
    available: true,
    source: 'shared-with-me',
  },
  {
    id: 'shared-by-me',
    labelKey: 'uhNavSharedByMe',
    available: true,
    source: 'shared-by-me',
  },
  {
    id: 'archive',
    labelKey: 'uhNavArchive',
    // UNI-1961: the Lưu trữ shelf (ARCHIVE-01), as the web's sidebar lists it
    available: true,
    source: 'shelved',
  },
  {
    id: 'trash',
    labelKey: 'uhNavTrash',
    available: true,
    source: 'trash',
  },
  {
    id: 'elsewhere',
    labelKey: 'dlNavElsewhere',
    // UNI-2047 B4: the web's "From elsewhere": the files of Chat, Meetings, Email and Tasks, a page of
    // their own (the workspace root lists documents only)
    available: true,
    source: 'sources',
  },
] as const

export function visibleDocumentsHomeNavEntries(): readonly DocumentsHomeNavEntry[] {
  return DOCUMENTS_HOME_NAV_ENTRIES.filter((entry) => entry.available)
}

export function getDocumentsHomeNavEntry(id: DocumentsHomeSubViewId): DocumentsHomeNavEntry {
  return (
    DOCUMENTS_HOME_NAV_ENTRIES.find((entry) => entry.id === id) ?? DOCUMENTS_HOME_NAV_ENTRIES[0]!
  )
}

/**
 * The type chips of the shared list rules. `page` (UniNote) is no server format: the server only
 * knows the file formats (and `txt`), so a UniNote pick sends no type and narrows the loaded rows.
 */
export type DocumentsHomeTypeFilter = 'all' | 'page' | UniworkDocFormat | 'txt'
export type DocumentsHomeUpdatedPreset = 'any' | '24h' | '7d' | '30d'
export type DocumentsHomeSort = 'recent' | 'name'

export interface DocumentsHomeFilterState {
  format: DocumentsHomeTypeFilter
  updatedBy: string
  updatedPreset: DocumentsHomeUpdatedPreset
}

export const DEFAULT_DOCUMENTS_HOME_FILTERS: DocumentsHomeFilterState = {
  format: 'all',
  updatedBy: '',
  updatedPreset: 'any',
}

/** the type chips, in the shared order of every screen (Rules board: Mọi loại · UniNote · .docx … .txt) */
export const DOCUMENTS_HOME_TYPE_CHIPS: readonly {
  value: DocumentsHomeTypeFilter
  labelKey?: StringKey
  literal?: string
}[] = [
  { value: 'all', labelKey: 'dlFilterAllTypes' },
  { value: 'page', labelKey: 'dlFilterUniNote' },
  { value: 'docx', literal: '.docx' },
  { value: 'xlsx', literal: '.xlsx' },
  { value: 'pptx', literal: '.pptx' },
  { value: 'pdf', literal: '.pdf' },
  { value: 'md', literal: '.md' },
  { value: 'html', literal: '.html' },
  { value: 'txt', literal: '.txt' },
]

export const DOCUMENTS_HOME_UPDATED_OPTIONS: readonly {
  value: DocumentsHomeUpdatedPreset
  labelKey: StringKey
}[] = [
  { value: 'any', labelKey: 'uhFilterAnyTime' },
  { value: '24h', labelKey: 'uhFilterToday' },
  { value: '7d', labelKey: 'uhFilterLast7Days' },
  { value: '30d', labelKey: 'uhFilterLast30Days' },
]

const DAY_MS = 86_400_000

/** Converts a relative updated preset into an RFC3339 timestamp string (`updatedFrom`). */
export function updatedFromIsoOf(
  preset: DocumentsHomeUpdatedPreset,
  nowMs: number = Date.now(),
): string | undefined {
  switch (preset) {
    case '24h':
      return new Date(nowMs - DAY_MS).toISOString()
    case '7d':
      return new Date(nowMs - 7 * DAY_MS).toISOString()
    case '30d':
      return new Date(nowMs - 30 * DAY_MS).toISOString()
    case 'any':
    default:
      return undefined
  }
}

/** Maps UI filter state to wire `UniworkListFilters`. */
export function toUniworkListFilters(
  state: DocumentsHomeFilterState,
  nowMs: number = Date.now(),
): UniworkListFilters {
  const filters: UniworkListFilters = {}
  if (state.format === 'page') {
    filters.kind = 'page'
  } else if (state.format !== 'all') {
    filters.format = state.format
  }
  const updatedBy = state.updatedBy.trim()
  if (updatedBy) {
    filters.updatedBy = updatedBy
  }
  const updatedFrom = updatedFromIsoOf(state.updatedPreset, nowMs)
  if (updatedFrom) {
    filters.updatedFrom = updatedFrom
  }
  return filters
}

export function hasActiveFilters(state: DocumentsHomeFilterState): boolean {
  return state.format !== 'all' || state.updatedBy.trim() !== '' || state.updatedPreset !== 'any'
}

export interface UpdatedByOption {
  id: string
  name: string
}

/**
 * Extracts distinct `(updatedById, updatedByName)` pairs seen on loaded document rows.
 * Skips rows without `updatedById` so option values are always user IDs, never display names.
 * An id is only emitted when at least one loaded row resolves its name: a raw user
 * id is never shown as a filter label (DH1-BE-10). Order follows each id's first
 * row occurrence; a later named row fills in the name for an earlier unnamed id.
 */
export function collectUpdatedByOptions(
  docs: readonly DocumentsHomeDoc[],
): readonly UpdatedByOption[] {
  const seen = new Map<string, string>()
  for (const doc of docs) {
    if (doc.kind === 'folder') continue
    const id = doc.updatedById?.trim()
    if (!id) continue
    const name = doc.updatedByName?.trim() ?? ''
    if (!seen.has(id) || (name !== '' && seen.get(id) === '')) {
      seen.set(id, name)
    }
  }
  return Array.from(seen.entries())
    .filter(([, name]) => name !== '')
    .map(([id, name]) => ({ id, name }))
}

/**
 * Keeps the active `updatedBy` filter id in the `<select>` options with a generic
 * label when no loaded row resolves its name (DH1-R4-9), while unselected unnamed
 * ids stay omitted (DH1-BE-10).
 */
export function updatedByOptionsForSelect(
  options: readonly UpdatedByOption[],
  selectedId: string,
  fallbackName: string,
): readonly UpdatedByOption[] {
  const selected = selectedId.trim()
  if (!selected || options.some((opt) => opt.id === selected)) return options
  return [...options, { id: selected, name: fallbackName }]
}

/** Splits items into folders and files and sorts them according to the active sort order. */
export function splitAndSortItems(
  items: readonly DocumentsHomeDoc[],
  sort: DocumentsHomeSort,
  locale = 'vi',
): {
  folders: DocumentsHomeDoc[]
  files: DocumentsHomeDoc[]
} {
  const folders: DocumentsHomeDoc[] = []
  const files: DocumentsHomeDoc[] = []
  for (const item of items) {
    if (item.kind === 'folder') {
      folders.push(item)
    } else {
      files.push(item)
    }
  }
  folders.sort((a, b) => {
    if (sort === 'name') {
      return a.title.localeCompare(b.title, locale, { numeric: true, sensitivity: 'base' })
    }
    const posA = typeof a.position === 'number' ? a.position : Number.MAX_SAFE_INTEGER
    const posB = typeof b.position === 'number' ? b.position : Number.MAX_SAFE_INTEGER
    if (posA !== posB) return posA - posB
    return a.title.localeCompare(b.title, locale, { numeric: true, sensitivity: 'base' })
  })
  files.sort((a, b) => {
    if (sort === 'name') {
      return a.title.localeCompare(b.title, locale, { numeric: true, sensitivity: 'base' })
    }
    const timeA = Date.parse(a.updatedAt)
    const timeB = Date.parse(b.updatedAt)
    if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
      return timeB - timeA
    }
    if (b.updatedAt !== a.updatedAt) {
      return b.updatedAt.localeCompare(a.updatedAt)
    }
    return a.title.localeCompare(b.title, locale, { numeric: true, sensitivity: 'base' })
  })
  return { folders, files }
}

/** UNI-2047: the sort a header click sends to the server (nothing sent = the server's own order) */
export interface DocumentsHomeWireSort {
  sort?: UniworkListSort
  order?: 'asc' | 'desc'
}

/** Structural adapter for W1 HomeApi list endpoints (compatible before and after W1 merges). */
export interface DocumentsHomeApiAdapter {
  uniworkListChildren?: (
    q: UniworkFolderQuery & UniworkListFilters,
  ) => Promise<UniworkResult<UniworkFolderChildren>>
  uniworkEnsureMyFolder?: (workspaceId: string) => Promise<UniworkResult<UniworkFolderNode>>
  uniworkListDocuments?: (
    q: UniworkDocListQuery & UniworkListFilters,
  ) => Promise<UniworkResult<UniworkDocListPage>>
  uniworkListSharedWithMe?: (
    q?: {
      cursor?: string
      limit?: number
      includePages?: boolean
    } & UniworkListFilters &
      DocumentsHomeWireSort,
  ) => Promise<UniworkResult<UniworkDocListPage>>
  uniworkListSharedByMe?: (
    q: {
      workspaceId: string
      cursor?: string
      limit?: number
    } & UniworkListFilters &
      DocumentsHomeWireSort,
  ) => Promise<UniworkResult<UniworkDocListPage>>
  uniworkListTrash?: (
    q: {
      workspaceId: string
      cursor?: string
      limit?: number
    } & UniworkListFilters &
      DocumentsHomeWireSort,
  ) => Promise<UniworkResult<UniworkDocListPage>>
  /** UNI-2047 B6: Gắn sao - the SV-2 route reads the type, the kind and the sort only */
  uniworkListFavorites?: (
    q: {
      workspaceId: string
      cursor?: string
      limit?: number
      format?: UniworkListFilters['format']
      kind?: UniworkListFilters['kind']
    } & DocumentsHomeWireSort,
  ) => Promise<UniworkResult<UniworkDocListPage>>
  /** UNI-1961: the Lưu trữ shelf (only the type filter applies there, and the sort) */
  uniworkListShelved?: (
    q: {
      workspaceId: string
      cursor?: string
      limit?: number
      format?: UniworkListFilters['format']
      kind?: UniworkListFilters['kind']
    } & DocumentsHomeWireSort,
  ) => Promise<UniworkResult<UniworkDocListPage>>
  uniworkListSources?: (q: UniworkSourceListQuery) => Promise<UniworkResult<UniworkSourceListPage>>
}

function mapDocListPageResult(
  res: UniworkResult<UniworkDocListPage>,
): UniworkResult<{ items: DocumentsHomeDoc[]; nextCursor: string | null }> {
  if (!res.ok) return res
  return {
    ok: true,
    value: {
      items: res.value.documents,
      nextCursor: res.value.nextCursor,
    },
  }
}

/**
 * Fetches a page for the given DocumentsHome sub-view (or open folder inside `workspace`).
 */
export async function fetchDocumentsHomePage(
  api: DocumentsHomeApiAdapter,
  params: {
    workspaceId: string
    subView: DocumentsHomeSubViewId
    folderId: string | null
    myFolderId?: string | null
    cursor?: string
    filters: UniworkListFilters
    /** UNI-2047: the header sort; unset sends nothing */
    sort?: DocumentsHomeWireSort | null
  },
): Promise<{
  result: UniworkResult<{ items: DocumentsHomeDoc[]; nextCursor: string | null }>
  ensuredMyFolder?: UniworkFolderNode
}> {
  const { workspaceId, subView, folderId, myFolderId, cursor, filters } = params
  const sortArgs: DocumentsHomeWireSort = params.sort
    ? { sort: params.sort.sort, order: params.sort.order }
    : {}

  if (subView === 'workspace') {
    if (typeof api.uniworkListChildren !== 'function') {
      return { result: { ok: true, value: { items: [], nextCursor: null } } }
    }
    const res = await api.uniworkListChildren({
      workspaceId,
      parentId: folderId,
      cursor,
      ...filters,
      ...sortArgs,
    })
    return {
      result: res,
    }
  }

  if (subView === 'my-folder') {
    let targetFolderId = myFolderId ?? null
    let ensuredNode: UniworkFolderNode | undefined
    if (!targetFolderId && typeof api.uniworkEnsureMyFolder === 'function') {
      const ensured = await api.uniworkEnsureMyFolder(workspaceId)
      if (!ensured.ok) {
        return { result: ensured }
      }
      ensuredNode = ensured.value
      targetFolderId = ensured.value.id
    }
    if (!targetFolderId || typeof api.uniworkListChildren !== 'function') {
      return {
        result: { ok: true, value: { items: [], nextCursor: null } },
        ensuredMyFolder: ensuredNode,
      }
    }
    const res = await api.uniworkListChildren({
      workspaceId,
      parentId: targetFolderId,
      cursor,
      ...filters,
      ...sortArgs,
    })
    return {
      result: res,
      ensuredMyFolder: ensuredNode,
    }
  }

  if (subView === 'recent') {
    if (typeof api.uniworkListDocuments !== 'function') {
      return { result: { ok: true, value: { items: [], nextCursor: null } } }
    }
    // UNI-1953: the Documents home Recent also lists UniNote pages
    const res = await api.uniworkListDocuments({
      workspaceId,
      cursor,
      ...filters,
      ...sortArgs,
      includePages: true,
    })
    return {
      result: mapDocListPageResult(res),
    }
  }

  if (subView === 'shared-with-me') {
    if (typeof api.uniworkListSharedWithMe !== 'function') {
      return { result: { ok: true, value: { items: [], nextCursor: null } } }
    }
    // UNI-1953: a shared UniNote is listed too
    // UNI-2047: the type / editor / date filters go to every workspace's route
    const res = await api.uniworkListSharedWithMe({
      ...(cursor ? { cursor } : {}),
      includePages: true,
      ...filters,
      ...sortArgs,
    })
    return {
      result: mapDocListPageResult(res),
    }
  }

  if (subView === 'shared-by-me') {
    if (typeof api.uniworkListSharedByMe !== 'function') {
      return { result: { ok: true, value: { items: [], nextCursor: null } } }
    }
    const res = await api.uniworkListSharedByMe({
      workspaceId,
      cursor,
      ...filters,
      ...sortArgs,
    })
    const page = mapDocListPageResult(res)
    // UNI-1974: folders are not shareable; an older share the server still returns is no row here
    return {
      result: page.ok
        ? {
            ok: true,
            value: {
              ...page.value,
              items: page.value.items.filter((doc) => doc.kind !== 'folder'),
            },
          }
        : page,
    }
  }

  if (subView === 'trash') {
    if (typeof api.uniworkListTrash !== 'function') {
      return { result: { ok: true, value: { items: [], nextCursor: null } } }
    }
    const res = await api.uniworkListTrash({
      workspaceId,
      cursor,
      ...filters,
      ...sortArgs,
    })
    return {
      result: mapDocListPageResult(res),
    }
  }

  if (subView === 'starred') {
    if (typeof api.uniworkListFavorites !== 'function') {
      return { result: { ok: true, value: { items: [], nextCursor: null } } }
    }
    // UNI-2047 B6: the favorites route takes the type and the sort, nothing else (Người sửa /
    // Cập nhật narrow the loaded rows in the screen); a 404 from an older server is the error state
    const res = await api.uniworkListFavorites({
      workspaceId,
      ...(cursor ? { cursor } : {}),
      ...(filters.format ? { format: filters.format } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...sortArgs,
    })
    return {
      result: mapDocListPageResult(res),
    }
  }

  if (subView === 'archive') {
    if (typeof api.uniworkListShelved !== 'function') {
      return { result: { ok: true, value: { items: [], nextCursor: null } } }
    }
    // UNI-1961: the shelf takes the type filter only (the web sends `format`
    // alone; the live views' updater/date filters never reach it)
    const res = await api.uniworkListShelved({
      workspaceId,
      ...(cursor ? { cursor } : {}),
      ...(filters.format ? { format: filters.format } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...sortArgs,
    })
    return {
      result: mapDocListPageResult(res),
    }
  }

  return { result: { ok: true, value: { items: [], nextCursor: null } } }
}

// ── UNI-1961: the Lưu trữ (Archive) shelf ──────────────────────────────

/** the "Lưu trữ bởi" value of rows shelved by nobody (`shelved_by` null) */
export const SHELVED_BY_SYSTEM = ' system'
/** the "Lưu trữ bởi" value of rows whose shelver left the workspace */
export const SHELVED_BY_FORMER = ' former'

/** the "Lưu trữ bởi" key of one row: a member id, former or system; null = unknown (no member list) */
export function shelverKeyOf(doc: DocumentsHomeDoc): string | null {
  if (!doc.shelvedById) return SHELVED_BY_SYSTEM
  if (doc.shelvedByName?.trim()) return doc.shelvedById
  if (doc.shelvedByFormer) return SHELVED_BY_FORMER
  return null
}

/** the "Lưu trữ bởi" cell: the member's name, the former-member / system line, or null ("—") */
export function shelverLabelOf(doc: DocumentsHomeDoc, t: TFunc): string | null {
  const key = shelverKeyOf(doc)
  if (key === SHELVED_BY_SYSTEM) return t('uhShelvedBySystem')
  if (key === SHELVED_BY_FORMER) return t('uhShelvedByFormer')
  return key ? (doc.shelvedByName?.trim() ?? null) : null
}

/**
 * The "Lưu trữ bởi" options the loaded rows name, in first-seen order: the
 * members, then one former-member entry, then the system (the web lists the
 * same three groups; the shelf has no `shelved_by` parameter, so the filter
 * narrows the loaded pages only).
 */
export function shelvedByOptionsOf(
  docs: readonly DocumentsHomeDoc[],
  t: TFunc,
): readonly UpdatedByOption[] {
  const members = new Map<string, string>()
  let former = false
  let system = false
  for (const doc of docs) {
    const key = shelverKeyOf(doc)
    if (key === SHELVED_BY_SYSTEM) system = true
    else if (key === SHELVED_BY_FORMER) former = true
    else if (key && !members.has(key)) members.set(key, doc.shelvedByName!.trim())
  }
  return [
    ...Array.from(members.entries()).map(([id, name]) => ({ id, name })),
    ...(former ? [{ id: SHELVED_BY_FORMER, name: t('uhShelvedByFormer') }] : []),
    ...(system ? [{ id: SHELVED_BY_SYSTEM, name: t('uhShelvedBySystem') }] : []),
  ]
}

/** the web's canManageTrashed: `my_level` manage, or the admin_scope of a restricted row */
export function canManageShelved(doc: DocumentsHomeDoc): boolean {
  return doc.canManage === true || doc.myLevel === 'manage' || doc.adminScope === true
}

/**
 * UNI-1961: one row of the documents table: a workspace document or a file
 * that lives in another module (chat, task, meeting, email), as the web's
 * library rows (D library-rows.ts `LibraryRow`).
 */
export type DocumentsHomeTableRow =
  | { type: 'doc'; id: string; doc: DocumentsHomeDoc }
  | { type: 'source'; id: string; source: UniworkSourceFile }

/**
 * UNI-1961: the home filters a source row cannot get from the server (the web
 * runs them on merged source rows, use-documents-library.ts): the editor is the
 * file's owner, the date its `updated_at`. The type went to the server as `type`.
 */
export function sourceMatchesFilters(
  source: UniworkSourceFile,
  filters: UniworkListFilters,
): boolean {
  if (filters.updatedBy && source.owner?.id !== filters.updatedBy) return false
  if (filters.updatedFrom) {
    const since = Date.parse(filters.updatedFrom)
    const at = Date.parse(source.updatedAt)
    if (!Number.isNaN(since) && (Number.isNaN(at) || at < since)) return false
  }
  return true
}

/**
 * UNI-2047: the type chips the server cannot apply. UniNote is no file format, so the loaded rows
 * are narrowed here and no source file (always a file) stays; `.txt` is applied to the source files
 * here as well, whatever the sources route does with it.
 */
export function rowMatchesType(
  row: DocumentsHomeTableRow,
  format: DocumentsHomeTypeFilter,
): boolean {
  if (format === 'page') return row.type === 'doc' && row.doc.kind === 'page'
  if (format === 'txt' && row.type === 'source') {
    return row.source.extension.toLowerCase().replace(/^\./, '') === 'txt'
  }
  return true
}

/**
 * UNI-2047: Người sửa / Cập nhật on rows the server could not filter (the shelf takes the type only,
 * so those two narrow the loaded pages, like Lưu trữ bởi). A row without the field does not match.
 */
export function docMatchesUpdated(doc: DocumentsHomeDoc, filters: UniworkListFilters): boolean {
  if (filters.updatedBy && doc.updatedById !== filters.updatedBy) return false
  if (filters.updatedFrom) {
    const since = Date.parse(filters.updatedFrom)
    const at = Date.parse(doc.updatedAt)
    if (!Number.isNaN(since) && (Number.isNaN(at) || at < since)) return false
  }
  return true
}

/**
 * UNI-1961: one page of the root's source files, with the home's format filter
 * as the sources `type`. Null when the bridge has no sources call.
 */
export async function fetchDocumentsHomeSources(
  api: DocumentsHomeApiAdapter,
  params: { workspaceId: string; filters: UniworkListFilters; cursor?: string },
): Promise<UniworkResult<UniworkSourceListPage> | null> {
  if (typeof api.uniworkListSources !== 'function') return null
  return api.uniworkListSources({
    workspaceId: params.workspaceId,
    ...(params.filters.format ? { type: params.filters.format } : {}),
    ...(params.cursor ? { cursor: params.cursor } : {}),
  })
}

/**
 * UNI-2047 B4: the Người sửa options of the Từ nơi khác page: the owners of the loaded source files
 * (a source file's editor is its owner), once each; an owner with no name is left out, never an id.
 */
export function sourceAuthorsOf(sources: readonly UniworkSourceFile[]): readonly UpdatedByOption[] {
  const seen = new Map<string, string>()
  for (const source of sources) {
    const id = source.owner?.id.trim()
    const name = source.owner?.name.trim()
    if (id && name && !seen.has(id)) seen.set(id, name)
  }
  return Array.from(seen, ([id, name]) => ({ id, name }))
}

/**
 * UNI-1961: the web's Size cell (D library-rows.ts `rowSizeBytes`): a file
 * document's bytes when it has any, every source file's; pages and folders
 * say nothing.
 */
export function rowSizeBytes(row: DocumentsHomeTableRow): number | null {
  if (row.type === 'source') return row.source.sizeBytes
  return row.doc.kind === 'file' && (row.doc.sizeBytes ?? 0) > 0
    ? (row.doc.sizeBytes ?? null)
    : null
}
