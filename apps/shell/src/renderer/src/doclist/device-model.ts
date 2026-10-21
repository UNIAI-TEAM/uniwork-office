// The local files of Home as rows of the shared Documents table: a file or a
// sub-folder becomes a `DocumentsHomeDoc` keyed by its path, so DocList draws,
// sorts and measures it like every other list. Only the fields the device
// screen reads are filled (name, time, size, kind); everything else is absent.
import type { FolderEntry, RecentEntry, UniworkDocFormat } from '../../../shared/home-api'
import { recentRowModifiedMs } from '../uniwork-docs-model'
import type { DocumentsHomeDoc, DocumentsHomeTableRow } from '../uniwork-home/documents-home-model'

const FORMATS: readonly string[] = ['docx', 'xlsx', 'pptx', 'pdf', 'md', 'txt', 'html']

/** the app's format for an extension, or null (the badge then reads the title's extension) */
const formatOf = (ext: string): UniworkDocFormat | null =>
  FORMATS.includes(ext) ? (ext as UniworkDocFormat) : null

/** the epoch as an ISO time; none (a missing file, a UniWork working copy) is the empty string, which the date cell writes as — */
const isoOf = (ms: number | null): string =>
  ms !== null && Number.isFinite(ms) ? new Date(ms).toISOString() : ''

/**
 * `keepTime`: show the file's own time even for a UniWork working copy (a search hit is a file on
 * disk, so its time is the honest one; a Recent row of a copy shows — instead).
 */
export function deviceFileDoc(entry: RecentEntry, keepTime = false): DocumentsHomeDoc {
  return {
    id: entry.path,
    workspaceId: '',
    title: entry.name,
    format: formatOf(entry.ext),
    updatedAt: isoOf(keepTime && !entry.missing ? entry.mtimeMs : recentRowModifiedMs(entry)),
    kind: 'file',
    // a file that failed to stat has no size; a zero size reads as — too (rowSizeBytes)
    sizeBytes: entry.missing ? undefined : entry.sizeBytes,
  }
}

export function deviceFolderDoc(folder: FolderEntry): DocumentsHomeDoc {
  return {
    id: folder.path,
    workspaceId: '',
    title: folder.name,
    format: null,
    updatedAt: isoOf(folder.mtimeMs),
    kind: 'folder',
  }
}

const rowOf = (doc: DocumentsHomeDoc): DocumentsHomeTableRow => ({ type: 'doc', id: doc.id, doc })

/** the rows of a device list: sub-folders first, then files */
export function deviceRows(
  folders: readonly FolderEntry[],
  files: readonly RecentEntry[],
  keepTime = false,
): DocumentsHomeTableRow[] {
  return [
    ...folders.map(deviceFolderDoc).map(rowOf),
    ...files.map((file) => rowOf(deviceFileDoc(file, keepTime))),
  ]
}
