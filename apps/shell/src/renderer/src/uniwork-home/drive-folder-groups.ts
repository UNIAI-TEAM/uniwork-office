import type { DriveFile } from '../../../shared/home-api'
import type { TFunc } from '../locale'

/**
 * "Group by folder" for the Google Drive list (UNI-2172 follow-up): one group per Drive parent
 * folder, in the order the contract fixes. Pure (no React, no window) so the rules are unit-tested.
 *
 * - named groups first, A-Z by the viewer's locale;
 * - then groups whose folder name is not readable, by the short id (first 6 characters);
 * - then one last "Folder unknown" group for files with no known parent;
 * - inside a group the files keep the order they arrived in (the list's own sort is untouched);
 * - when EVERY file is unknown (an older server, or before the backfill) there is nothing worth
 *   grouping: the result is null and the caller shows the flat list.
 */

export type DriveFolderGroupKind = 'named' | 'unnamed' | 'unknown'

export interface DriveFolderGroup {
  /** stable id of the group: the Drive folder id, or `UNKNOWN_FOLDER_KEY` */
  key: string
  kind: DriveFolderGroupKind
  /** the folder name; only for `named` */
  name: string | null
  /** first 6 characters of the folder id; empty for `unknown` */
  shortId: string
  files: DriveFile[]
}

export const UNKNOWN_FOLDER_KEY = '__unknown_folder__'

const SHORT_ID_LENGTH = 6

export function shortFolderId(id: string): string {
  return id.slice(0, SHORT_ID_LENGTH)
}

/** the label of a group; its count is drawn separately */
export function driveFolderGroupLabel(group: DriveFolderGroup, t: TFunc): string {
  if (group.kind === 'named') return group.name ?? ''
  if (group.kind === 'unnamed') return t('uhDriveGroupUnnamed', { id: group.shortId })
  return t('uhDriveGroupUnknown')
}

/** the count beside a label: "3 files" */
export function driveFolderGroupCount(count: number, t: TFunc): string {
  return t(count === 1 ? 'uhDriveGroupCountOne' : 'uhDriveGroupCountOther', { n: count })
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

/**
 * The groups of `files` (the filtered set: a group with no file never exists, and each count is
 * its files' length), or null when the flat list should show.
 */
export function groupDriveFilesByFolder(
  files: readonly DriveFile[],
  locale: string,
): DriveFolderGroup[] | null {
  const byKey = new Map<string, DriveFolderGroup>()
  let known = 0
  for (const file of files) {
    const folder = file.driveFolder
    const id = folder && typeof folder.id === 'string' ? folder.id : ''
    const name = folder?.name?.trim() ? folder.name : null
    let group = byKey.get(id || UNKNOWN_FOLDER_KEY)
    if (!group) {
      group = id
        ? {
            key: id,
            kind: name ? 'named' : 'unnamed',
            name,
            shortId: shortFolderId(id),
            files: [],
          }
        : { key: UNKNOWN_FOLDER_KEY, kind: 'unknown', name: null, shortId: '', files: [] }
      byKey.set(group.key, group)
    } else if (group.kind === 'unnamed' && name) {
      // rows of one folder can disagree while the backfill runs: the readable name wins
      group.kind = 'named'
      group.name = name
    }
    if (id) known += 1
    group.files.push(file)
  }
  if (known === 0) return null

  const collator = makeCollator(locale)
  const rank: Record<DriveFolderGroupKind, number> = { named: 0, unnamed: 1, unknown: 2 }
  return [...byKey.values()].sort((a, b) => {
    if (a.kind !== b.kind) return rank[a.kind] - rank[b.kind]
    const first =
      a.kind === 'named'
        ? collator.compare(a.name ?? '', b.name ?? '') || compareCodeUnits(a.key, b.key)
        : compareCodeUnits(a.key, b.key)
    return first
  })
}
