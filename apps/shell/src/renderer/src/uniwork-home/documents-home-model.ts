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
  UniworkSourceFile,
  UniworkSourceListPage,
  UniworkSourceListQuery,
} from '../../../shared/home-api'
import type { Lang } from '@genoffice/i18n'
import type { StringKey, TFunc } from '../locale'
import { folderPath, type FolderIndex } from '../uniwork-folders/uniwork-folders-model'

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
  | 'shelved'
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
  /** UNI-1961: the Lưu trữ shelf (only the type filter applies there) */
  uniworkListShelved?: (q: {
    workspaceId: string
    cursor?: string
    limit?: number
    format?: UniworkDocFormat
  }) => Promise<UniworkResult<UniworkDocListPage>>
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
 * The web's `formatShortWhen` (D documents/document-format.ts): the time for
 * today, else a short day (+ year when not this year); vi is written out
 * dd/MM[/yyyy] because ICU versions disagree on its separator.
 */
export function formatShortWhen(
  at: string | null | undefined,
  locale: string,
  now: Date = new Date(),
): string {
  if (!at) return ''
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  const sameYear = date.getFullYear() === now.getFullYear()
  if (sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  if (locale.toLowerCase().startsWith('vi')) {
    const pad = (n: number) => String(n).padStart(2, '0')
    const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
    return sameYear ? day : `${day}/${date.getFullYear()}`
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

/**
 * UNI-1961: one row of the documents table: a workspace document or a file
 * that lives in another module (chat, task, meeting, email), as the web's
 * library rows (D library-rows.ts `LibraryRow`).
 */
export type DocumentsHomeTableRow =
  | { type: 'doc'; id: string; doc: DocumentsHomeDoc }
  | { type: 'source'; id: string; source: UniworkSourceFile }

function rowTime(row: DocumentsHomeTableRow): number {
  const time = Date.parse(row.type === 'doc' ? row.doc.updatedAt : row.source.updatedAt)
  return Number.isNaN(time) ? 0 : time
}

/**
 * UNI-1961: the web home root's merge (D library-rows.ts `mergeNewestFirst`):
 * two independently paged lists as one newest-first table. A row shows only
 * when it is at least as new as the oldest loaded row of every list that still
 * has pages, so "Load more" never slots a row above what is on screen; a list
 * that is exhausted (or empty) sets no bound. A row with no date sinks.
 */
export function mergeNewestFirst(
  docs: readonly DocumentsHomeDoc[],
  sources: readonly UniworkSourceFile[],
  more: { docs: boolean; sources: boolean },
): DocumentsHomeTableRow[] {
  const rows: DocumentsHomeTableRow[] = [
    ...docs.map((doc) => ({ type: 'doc' as const, id: doc.id, doc })),
    ...sources.map((source) => ({ type: 'source' as const, id: `source:${source.id}`, source })),
  ]
  const oldest = (list: DocumentsHomeTableRow[], paged: boolean): number =>
    paged && list.length > 0 ? Math.min(...list.map(rowTime)) : Number.NEGATIVE_INFINITY
  const cutoff = Math.max(
    oldest(
      rows.filter((row) => row.type === 'doc'),
      more.docs,
    ),
    oldest(
      rows.filter((row) => row.type === 'source'),
      more.sources,
    ),
  )
  return rows.filter((row) => rowTime(row) >= cutoff).sort((a, b) => rowTime(b) - rowTime(a))
}

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

/** UNI-1961: the web's byte formatter (D library-rows.ts `formatBytes`): "318 KB", "1.2 MB" */
export function formatBytes(bytes: number | null | undefined, locale: string): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`
}

/** UNI-1961: the web's library date (documents-library-row.tsx): Intl dateStyle short */
export function formatShortDate(iso: string, locale: string): string {
  const date = new Date(iso)
  if (!iso || Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'short' }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/** UNI-1961: the web's "Group by" options, in its order (D library-rows.ts `GROUP_BY`) */
export const DOCUMENTS_HOME_GROUP_BY = ['folder', 'source', 'type', 'none'] as const
export type DocumentsHomeGroupBy = (typeof DOCUMENTS_HOME_GROUP_BY)[number]

/** the web's default (documents-page-view.tsx) */
export const DEFAULT_DOCUMENTS_HOME_GROUP_BY: DocumentsHomeGroupBy = 'folder'

export const DOCUMENTS_HOME_GROUP_BY_KEYS: Record<DocumentsHomeGroupBy, StringKey> = {
  folder: 'uhGroupByFolder',
  source: 'uhGroupBySource',
  type: 'uhGroupByType',
  none: 'uhGroupByNone',
}

/**
 * UNI-1961: where the web offers "Group by" - its list views (Recent, Shared
 * with me, Shared by me). The home root and a folder never group, and the
 * trash has its own table.
 */
export function documentsHomeGroupable(subView: DocumentsHomeSubViewId): boolean {
  return subView === 'recent' || subView === 'shared-with-me' || subView === 'shared-by-me'
}

export interface DocumentsHomeRowGroup {
  /** stable id; also what the built-in groups are translated from */
  key: string
  /** a folder path (the only user-visible title); empty for the built-in groups */
  title: string
  rows: DocumentsHomeDoc[]
}

/** the format a row groups by: page, the file format, else its title's extension, else "file" */
function groupFormatOf(doc: DocumentsHomeDoc): string {
  if (doc.kind === 'page' || doc.kind === 'folder') return doc.kind
  if (doc.format) return doc.format
  const dot = doc.title.lastIndexOf('.')
  return (dot > 0 ? doc.title.slice(dot + 1).toLowerCase() : '') || 'file'
}

/**
 * UNI-1961: the web's `groupRows` (D library-rows.ts) over the table's rows,
 * in first-seen order of the (already sorted) rows. Folder: the deepest folder
 * above the row, titled by its path (My Folder takes its label), else
 * `unfiled`; source: `origin:upload|created`, else `origin:documents`; type:
 * `type:<format>`; none: one group, which draws no header.
 */
export function groupDocumentsHomeRows(
  rows: readonly DocumentsHomeDoc[],
  groupBy: DocumentsHomeGroupBy,
  index: FolderIndex,
  myFolder?: { id: string | null; label: string },
): DocumentsHomeRowGroup[] {
  if (groupBy === 'none') return [{ key: 'all', title: '', rows: [...rows] }]
  const groups = new Map<string, DocumentsHomeRowGroup>()
  const add = (key: string, title: string, row: DocumentsHomeDoc) => {
    const group = groups.get(key) ?? { key, title, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  for (const row of rows) {
    if (groupBy === 'source') add(`origin:${row.origin ?? 'documents'}`, '', row)
    else if (groupBy === 'type') add(`type:${groupFormatOf(row)}`, '', row)
    else {
      const path = folderPath(index, row.parentId ?? null)
      const last = path.at(-1)
      if (last) {
        const title = path
          .map((part) => (myFolder && part.id === myFolder.id ? myFolder.label : part.title))
          .join(' / ')
        add(`folder:${last.id}`, title, row)
      } else add('unfiled', '', row)
    }
  }
  return [...groups.values()]
}

/** the product names the web's type groups use in every language */
const GROUP_TYPE_NAMES: Record<string, string> = {
  page: 'UniNote',
  docx: 'Docs',
  xlsx: 'Sheets',
  pptx: 'Slides',
  pdf: 'PDF',
  md: 'Markdown',
  html: 'HTML',
}

/** UNI-1961: a group header's words (D documents-library-list.tsx `groupTitle`) */
export function documentsHomeGroupLabel(group: DocumentsHomeRowGroup, t: TFunc): string {
  if (group.title) return group.title
  if (group.key === 'unfiled') return t('uhGroupUnfiled')
  if (group.key === 'origin:upload') return t('uhOriginUpload')
  if (group.key === 'origin:created') return t('uhOriginCreated')
  if (group.key === 'origin:documents') return t('uhSectionDocuments')
  if (group.key.startsWith('type:')) {
    const format = group.key.slice(5)
    if (format === 'folder') return t('uhSectionFolders')
    return GROUP_TYPE_NAMES[format] ?? t('uhGroupTypeOther')
  }
  return ''
}
