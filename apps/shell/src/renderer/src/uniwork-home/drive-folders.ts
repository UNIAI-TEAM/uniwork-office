import type { DriveFile } from '../../../shared/home-api'
import type { TFunc } from '../locale'

/**
 * The folders of one Google Drive account (UNI-2223 v2): derived on the client from the
 * `drive_folder` each fetched file carries. Pure (no React, no window) so the rules are unit-tested,
 * and the one place to swap for a server folder list later.
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
      folder = { key: id, name, shortId: shortFolderId(id), files: [] }
      byKey.set(id, folder)
    } else if (!folder.name && name) {
      // rows of one folder can disagree while the backfill runs: the readable name wins
      folder.name = name
    }
    folder.files.push(file)
  }

  const collator = makeCollator(locale)
  const folders = [...byKey.values()].sort((a, b) => {
    if (Boolean(a.name) !== Boolean(b.name)) return a.name ? -1 : 1
    if (a.name && b.name) return collator.compare(a.name, b.name) || compareCodeUnits(a.key, b.key)
    return compareCodeUnits(a.key, b.key)
  })
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
