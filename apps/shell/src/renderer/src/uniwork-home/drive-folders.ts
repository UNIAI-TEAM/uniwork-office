import type { DriveFile, DriveFolderSummary } from '../../../shared/home-api'
import type { TFunc } from '../locale'

/**
 * The folders of one Google Drive account (UNI-2223 v2/v3). The server folder list is the source
 * (`serverDriveFolders`); an old server has none, so they are derived on the client from the
 * `drive_folder` each fetched file carries (`deriveDriveFolders`). Pure (no React, no window) so the
 * rules are unit-tested, and both paths share one order.
 *
 * - named folders first, A-Z by the viewer's locale (numeric collation: "Q2" before "Q10");
 * - then folders whose name is not readable, by id;
 * - files with no known parent are `looseFiles`: the account view lists them after the folder rows;
 * - inside a folder the files keep the order they arrived in.
 */

export interface DriveFolder {
  /** the Drive folder id */
  key: string
  /** the folder name; null when it is not readable under drive.file */
  name: string | null
  /** first 6 characters of the id, for the unnamed label */
  shortId: string
  /** the count drawn beside the folder: the server's `file_count`, or the derived files' length */
  count: number
  /** the folder's files; empty for a server folder until the account's pages are in */
  files: DriveFile[]
}

export interface DriveFolderIndex {
  folders: DriveFolder[]
  looseFiles: DriveFile[]
}

const SHORT_ID_LENGTH = 6

export function shortFolderId(id: string): string {
  return id.slice(0, SHORT_ID_LENGTH)
}

/** the label of a folder; its count is drawn separately */
export function driveFolderLabel(folder: Pick<DriveFolder, 'name' | 'shortId'>, t: TFunc): string {
  return folder.name ?? t('uhDriveFolderUnnamed', { id: folder.shortId })
}

/** the sidebar label: an unnamed folder drops the long prefix so the short id (what tells two apart) fits */
export function driveFolderShortLabel(
  folder: Pick<DriveFolder, 'name' | 'shortId'>,
  t: TFunc,
): string {
  return folder.name ?? t('uhDriveFolderUnnamedShort', { id: folder.shortId })
}

/** the count beside a label: "3 files" */
export function driveFolderFileCount(count: number, t: TFunc): string {
  return t(count === 1 ? 'uhDriveFolderFilesOne' : 'uhDriveFolderFilesOther', { n: count })
}

function makeCollator(locale: string): Intl.Collator {
  try {
    return new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
  } catch {
    return new Intl.Collator()
  }
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareFolders(collator: Intl.Collator) {
  return (a: DriveFolder, b: DriveFolder): number => {
    if (Boolean(a.name) !== Boolean(b.name)) return a.name ? -1 : 1
    if (a.name && b.name) return collator.compare(a.name, b.name) || compareCodeUnits(a.key, b.key)
    return compareCodeUnits(a.key, b.key)
  }
}

/**
 * The folder nodes of the server list. The no-folder group (id null) is not a node: its files show
 * in the account view. A repeated id keeps its first entry (readable name wins). Order is ours, not
 * the server's, so both hosts stay deterministic.
 */
export function serverDriveFolders(
  list: readonly DriveFolderSummary[],
  locale: string,
): DriveFolder[] {
  const byKey = new Map<string, DriveFolder>()
  for (const entry of list) {
    if (!entry.id) continue
    const name = entry.name?.trim() || null
    const known = byKey.get(entry.id)
    if (known) {
      if (!known.name && name) known.name = name
      continue
    }
    byKey.set(entry.id, {
      key: entry.id,
      name,
      shortId: shortFolderId(entry.id),
      count: entry.fileCount,
      files: [],
    })
  }
  return [...byKey.values()].sort(compareFolders(makeCollator(locale)))
}

/**
 * Puts each folder's files (matched by `drive_folder.id`) next to the folder, and returns the files
 * that sit in no listed folder: no parent, or a parent the folder list does not know (a file must
 * never vanish because the two reads disagree for a moment).
 */
export function attachFolderFiles(
  folders: readonly DriveFolder[],
  files: readonly DriveFile[],
): { folders: DriveFolder[]; looseFiles: DriveFile[] } {
  const byKey = new Map<string, DriveFile[]>()
  for (const folder of folders) byKey.set(folder.key, [])
  const looseFiles: DriveFile[] = []
  for (const file of files) {
    const id = file.driveFolder?.id
    const bucket = id ? byKey.get(id) : undefined
    if (bucket) bucket.push(file)
    else looseFiles.push(file)
  }
  return {
    folders: folders.map((folder) => ({ ...folder, files: byKey.get(folder.key) ?? [] })),
    looseFiles,
  }
}

/** the folders of `files` (an account's files, every page) and the files without a folder */
export function deriveDriveFolders(files: readonly DriveFile[], locale: string): DriveFolderIndex {
  const byKey = new Map<string, DriveFolder>()
  const looseFiles: DriveFile[] = []
  for (const file of files) {
    const ref = file.driveFolder
    const id = ref && typeof ref.id === 'string' ? ref.id : ''
    if (!id) {
      looseFiles.push(file)
      continue
    }
    const name = ref?.name?.trim() || null
    let folder = byKey.get(id)
    if (!folder) {
      folder = { key: id, name, shortId: shortFolderId(id), count: 0, files: [] }
      byKey.set(id, folder)
    } else if (!folder.name && name) {
      // rows of one folder can disagree while the backfill runs: the readable name wins
      folder.name = name
    }
    folder.files.push(file)
    folder.count = folder.files.length
  }

  const folders = [...byKey.values()].sort(compareFolders(makeCollator(locale)))
  return { folders, looseFiles }
}

/** case and accents ignored, so "du an" finds "Dự án" (same fold as the web search) */
const foldText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase()

/** the files whose name contains `query` (case and accents ignored); an empty query keeps every file */
export function filterDriveFilesByName(files: readonly DriveFile[], query: string): DriveFile[] {
  const needle = foldText(query.trim())
  if (!needle) return [...files]
  return files.filter((file) => foldText(file.name).includes(needle))
}
