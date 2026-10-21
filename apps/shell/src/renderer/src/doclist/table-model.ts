// Pure rules of the Documents table: which screen a Documents-home view is,
// which columns its loaded rows can fill, which sort is in force and how the
// rows read for it. DocList draws; this decides.
import type { UniworkListSort } from '../../../shared/home-api'
import { initials } from '../desk-model'
import type {
  DocumentsHomeDoc,
  DocumentsHomeSubViewId,
  DocumentsHomeTableRow,
} from '../uniwork-home/documents-home-model'
import { rowSizeBytes } from '../uniwork-home/documents-home-model'
import {
  columnsFor,
  defaultSort,
  isSortable,
  sortRows,
  specialColumn,
  type ColumnId,
  type DocListScreen,
  type SortSpec,
  type SpecialColumnId,
} from './columns'

/** the shared-rules screen of a Documents-home view (a folder and My Folder are the workspace list) */
export function screenOfSubView(subView: DocumentsHomeSubViewId): DocListScreen {
  switch (subView) {
    case 'recent':
      return 'recent'
    case 'starred':
      return 'starred'
    case 'shared-with-me':
      return 'shared'
    case 'shared-by-me':
      return 'shared-by-me'
    case 'archive':
      return 'shelved'
    case 'trash':
      return 'trash'
    case 'elsewhere':
      return 'elsewhere'
    case 'workspace':
    case 'my-folder':
    default:
      return 'workspace'
  }
}

/** the timestamp a screen column of a row is built on; undefined when the server sent none */
function specialStamp(column: SpecialColumnId, doc: DocumentsHomeDoc): string | undefined {
  switch (column) {
    case 'activity':
      return doc.lastActivity?.at
    case 'starred':
      return doc.favoritedAt
    case 'shared':
      return doc.shared?.at
    case 'shared_with':
      // counts without a date still say how widely it is shared
      return doc.shareSummary ? (doc.shareSummary.latestAt ?? '') : undefined
    case 'shelved':
      return doc.shelvedAt
    case 'deleted':
      return doc.archivedAt
  }
}

/**
 * The screen's own column shows only when a loaded row carries its field
 * (the desktop never guesses what the server did not send); a screen without
 * one has none.
 */
export function specialPresent(screen: DocListScreen, docs: readonly DocumentsHomeDoc[]): boolean {
  const column = specialColumn(screen)
  return column !== null && docs.some((doc) => specialStamp(column, doc) !== undefined)
}

/** the columns the loaded rows can fill at a table width (px; none = the whole table) */
export function visibleColumns(
  screen: DocListScreen,
  docs: readonly DocumentsHomeDoc[],
  width?: number,
): ColumnId[] {
  const ladder =
    specialPresent(screen, docs) || specialColumn(screen) === null ? screen : 'workspace'
  const columns = columnsFor(ladder, width)
  // a source file of another module has no access level: its page has no Truy cập column (V-STATES
  // F-04), rather than "—" on every row
  return screen === 'elsewhere' ? columns.filter((column) => column !== 'access') : columns
}

/**
 * The sort in force: the user's, when it names a column this screen can fill,
 * else the screen default; a screen column that is not there reads as Cập nhật
 * newest first.
 */
export function effectiveSort(
  screen: DocListScreen,
  explicit: SortSpec | null,
  present: boolean,
): SortSpec {
  const special = specialColumn(screen)
  if (explicit && isSortable(screen, explicit.column)) {
    if (explicit.column !== special || present) return explicit
  }
  return special && !present ? { column: 'updated', dir: 'desc' } : defaultSort(screen)
}

const WIRE_SORT: Partial<Record<ColumnId, UniworkListSort>> = {
  name: 'name',
  editor: 'editor',
  updated: 'updated',
  size: 'size',
  activity: 'activity',
  starred: 'starred',
  shared: 'shared',
  shared_with: 'shared',
  shelved: 'shelved',
  deleted: 'deleted',
}

/** the `sort` / `order` a header sort sends to the server; nothing for no sort (the server's own order) */
export function wireSortOf(
  sort: SortSpec | null,
): { sort: UniworkListSort; order: 'asc' | 'desc' } | null {
  const key = sort ? WIRE_SORT[sort.column] : undefined
  return sort && key ? { sort: key, order: sort.dir } : null
}

/** the editor a row shows: the server's person first, the name the row already carries after it */
export function editorNameOf(doc: DocumentsHomeDoc): string | null {
  const name = doc.updatedByUser?.name?.trim() || doc.updatedByName?.trim()
  return name || null
}

/** up to two letters for the avatar: the app's one avatar helper */
export function editorInitials(name: string): string {
  return initials(name)
}

const epoch = (iso: string | undefined): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** what a row holds for a column, for the sort: text, an epoch, a size, or nothing */
export function readColumn(row: DocumentsHomeTableRow, column: ColumnId): string | number | null {
  if (row.type === 'source') {
    switch (column) {
      case 'name':
        return row.source.name
      case 'editor':
        return row.source.owner?.name.trim() || null
      case 'updated':
        return epoch(row.source.updatedAt)
      case 'size':
        return row.source.sizeBytes ?? 0
      default:
        return null
    }
  }
  const doc = row.doc
  switch (column) {
    case 'name':
      return doc.title
    case 'editor':
      return editorNameOf(doc)
    case 'updated':
      return epoch(doc.updatedAt)
    case 'size':
      // no file reads as 0 on a size sort
      return rowSizeBytes(row) ?? 0
    case 'activity':
    case 'starred':
    case 'shared':
    case 'shared_with':
    case 'shelved':
    case 'deleted':
      return epoch(specialStamp(column, doc) || undefined)
    default:
      return null
  }
}

/** the rows in the order of a sort (a copy) */
export function sortTableRows(
  rows: readonly DocumentsHomeTableRow[],
  sort: SortSpec,
): DocumentsHomeTableRow[] {
  return sortRows(rows, sort, readColumn)
}
