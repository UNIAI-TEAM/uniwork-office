import type {
  UniworkDocFormat,
  UniworkDocShareScope,
  UniworkDocListPage,
  UniworkDocListQuery,
  UniworkDocSummary,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkFolderQuery,
  UniworkResult,
} from '../../../shared/home-api'
import type { Lang } from '@genoffice/i18n'
import type { StringKey, TFunc } from '../locale'

export type UniworkDocVisibility = 'private' | 'workspace' | 'restricted'
export type UniworkDocAccessLevel = 'view' | 'comment' | 'edit' | 'manage'

export interface UniworkListFilters {
  format?: UniworkDocFormat
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

export type DocumentsHomeDataSource =
  | 'children-root'
  | 'my-folder-children'
  | 'documents'
  | 'shared-with-me'
  | 'shared-by-me'
  | 'trash'
  | 'none'

export interface DocumentsHomeNavEntry {
  readonly id: DocumentsHomeSubViewId
  readonly labelKey: StringKey
  readonly available: boolean
  readonly source: DocumentsHomeDataSource
}

/**
 * DESKTOP-HOME DH-1 sub-navigation entry table in exact board order (Desktop.dc.html:20-27).
 * Entries with `available: false` (Starred / Gắn sao, Archive / Lưu trữ, My Folder: a tree row) are hidden and not rendered.
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
    available: false,
    source: 'none',
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
    available: false,
    source: 'none',
  },
  {
    id: 'trash',
    labelKey: 'uhNavTrash',
    available: true,
    source: 'trash',
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

export type DocumentsHomeTypeFilter = 'all' | UniworkDocFormat
export type DocumentsHomeUpdatedPreset = 'any' | '24h' | '7d' | '30d'
export type DocumentsHomeSort = 'recent' | 'name'
export type DocumentsHomeViewMode = 'list' | 'grid'

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

export const DOCUMENTS_HOME_FORMAT_OPTIONS: readonly {
  value: DocumentsHomeTypeFilter
  labelKey?: StringKey
  literal?: string
}[] = [
  { value: 'all', labelKey: 'uhFilterTypeAll' },
  { value: 'docx', literal: 'DOCX (.docx)' },
  { value: 'xlsx', literal: 'XLSX (.xlsx)' },
  { value: 'pptx', literal: 'PPTX (.pptx)' },
  { value: 'pdf', literal: 'PDF (.pdf)' },
  { value: 'md', literal: 'Markdown (.md)' },
  { value: 'html', literal: 'HTML (.html)' },
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
  if (state.format !== 'all') {
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

export interface FormattedAccessCell {
  visibilityLabel: string | null
  levelLabel: string | null
  isEmpty: boolean
  tone: ShareScopeKind | 'none'
}

const LEVEL_KEYS: Record<UniworkDocAccessLevel, StringKey> = {
  manage: 'uhLevelManage',
  edit: 'uhLevelEdit',
  comment: 'uhLevelComment',
  view: 'uhLevelView',
}

export type ShareScopeKind =
  'private' | 'people' | 'workspace' | 'workspaces' | 'organization' | 'multiple' | 'link'

/** `one` form for a count, the shared plural otherwise (same split as `fileCountLabel`) */
function isSingular(count: number, lang: Lang): boolean {
  return new Intl.PluralRules(lang).select(count) === 'one'
}

/**
 * Port of the web's `shareScopeView` (packages/views/documents/document-share-scope-badge.tsx):
 * a live public link alone is "link"; no axis at all is "private"; two or more
 * of people / home workspace / other workspaces / organization is "multiple";
 * otherwise the single axis in the order people > home workspace > other
 * workspaces > organization. The public link never joins the axis count.
 */
export function shareScopeView(
  scope: UniworkDocShareScope,
  t: TFunc,
  lang: Lang,
): { kind: ShareScopeKind; label: string } {
  const hasUsers = scope.users > 0
  const hasOtherWorkspaces = scope.workspaces > 0
  const active = [hasUsers, scope.homeWorkspace, hasOtherWorkspaces, scope.organization].filter(
    Boolean,
  ).length
  if (active === 0 && scope.publicLink) return { kind: 'link', label: t('uhScopePublicLink') }
  if (active === 0) return { kind: 'private', label: t('uhVisPrivate') }
  if (active >= 2) return { kind: 'multiple', label: t('uhScopeMultiple') }
  if (hasUsers) {
    const key = isSingular(scope.users, lang) ? 'uhScopePeopleOne' : 'uhScopePeople'
    return { kind: 'people', label: t(key, { n: scope.users }) }
  }
  if (scope.homeWorkspace) return { kind: 'workspace', label: t('uhVisWorkspace') }
  if (hasOtherWorkspaces) {
    const key = isSingular(scope.workspaces, lang) ? 'uhScopeWorkspacesOne' : 'uhScopeWorkspaces'
    return { kind: 'workspaces', label: t(key, { n: scope.workspaces }) }
  }
  return { kind: 'organization', label: t('uhScopeOrganization') }
}

/**
 * Formats the `Truy cập` column like the web row: the scope label comes only
 * from `doc.shareScope` (a row without it has no scope label, never one guessed
 * from `visibility`) and the level from `doc.myLevel` (omits `"Bạn: ..."` when
 * absent). `isEmpty` (`"—"`) when both are absent.
 */
export function formatAccessCell(doc: DocumentsHomeDoc, t: TFunc, lang: Lang): FormattedAccessCell {
  const scope = doc.shareScope ? shareScopeView(doc.shareScope, t, lang) : null
  const lvlKey = doc.myLevel ? LEVEL_KEYS[doc.myLevel] : undefined
  const levelLabel = lvlKey ? t('uhLevelPrefix', { level: t(lvlKey) }) : null
  return {
    visibilityLabel: scope?.label ?? null,
    levelLabel,
    isEmpty: scope === null && levelLabel === null,
    tone: scope?.kind ?? 'none',
  }
}

export interface FormattedUpdatedByCell {
  name: string | null
  initial: string | null
}

/**
 * Formats the `Người sửa gần nhất` column strictly from `doc.updatedByName`.
 * When `updatedByName` is absent or blank, returns `{ name: null, initial: null }` so UI prints `"—"`.
 */
export function formatUpdatedByCell(doc: DocumentsHomeDoc): FormattedUpdatedByCell {
  const name = doc.updatedByName?.trim()
  if (!name) {
    return { name: null, initial: null }
  }
  const firstChar = Array.from(name)[0] ?? ''
  return {
    name,
    initial: firstChar ? firstChar.toUpperCase() : null,
  }
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

/** Structural adapter for W1 HomeApi list endpoints (compatible before and after W1 merges). */
export interface DocumentsHomeApiAdapter {
  uniworkListChildren?: (
    q: UniworkFolderQuery & UniworkListFilters,
  ) => Promise<UniworkResult<UniworkFolderChildren>>
  uniworkEnsureMyFolder?: (workspaceId: string) => Promise<UniworkResult<UniworkFolderNode>>
  uniworkListDocuments?: (
    q: UniworkDocListQuery & UniworkListFilters,
  ) => Promise<UniworkResult<UniworkDocListPage>>
  uniworkListSharedWithMe?: (q?: {
    cursor?: string
    limit?: number
    includePages?: boolean
  }) => Promise<UniworkResult<UniworkDocListPage>>
  uniworkListSharedByMe?: (
    q: { workspaceId: string; cursor?: string; limit?: number } & UniworkListFilters,
  ) => Promise<UniworkResult<UniworkDocListPage>>
  uniworkListTrash?: (
    q: { workspaceId: string; cursor?: string; limit?: number } & UniworkListFilters,
  ) => Promise<UniworkResult<UniworkDocListPage>>
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
  },
): Promise<{
  result: UniworkResult<{ items: DocumentsHomeDoc[]; nextCursor: string | null }>
  ensuredMyFolder?: UniworkFolderNode
}> {
  const { workspaceId, subView, folderId, myFolderId, cursor, filters } = params

  if (subView === 'workspace') {
    if (typeof api.uniworkListChildren !== 'function') {
      return { result: { ok: true, value: { items: [], nextCursor: null } } }
    }
    const res = await api.uniworkListChildren({
      workspaceId,
      parentId: folderId,
      cursor,
      ...filters,
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
    const res = await api.uniworkListSharedWithMe(
      cursor ? { cursor, includePages: true } : { includePages: true },
    )
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
    })
    return {
      result: mapDocListPageResult(res),
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
    })
    return {
      result: mapDocListPageResult(res),
    }
  }

  return { result: { ok: true, value: { items: [], nextCursor: null } } }
}
