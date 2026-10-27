// Pure helpers of the "share the documents inside a folder" dialog (UNI-2244): the items the
// server is sent, the summary lines of a dry run, the warnings it names and the toast of a
// finished run. No React here.
import type {
  FolderContentsAccessCounts,
  FolderContentsAccessItem,
  FolderContentsAccessMode,
  FolderContentsAccessPreview,
  ShareLevel,
} from '../../../shared/share-api'
import type { StringKey } from '../locale'
import { plural, type ShareT } from './share-model'

/** the home-workspace choice of the replace mode: a level, or `none` (the folder's documents go private) */
export type HomeWorkspaceChoice = ShareLevel | 'none'

/** the levels the home workspace row offers (the organization and the home workspace stop at edit) */
export const HOME_WORKSPACE_LEVELS: readonly ShareLevel[] = ['view', 'comment', 'edit']

export interface FolderItemsInput {
  mode: FolderContentsAccessMode
  /** the people / groups picked in the picker, each with its effective level */
  picked: readonly FolderContentsAccessItem[]
  /** the home workspace id of the folder; its row is the replace mode's own */
  homeWorkspaceId: string
  homeChoice: HomeWorkspaceChoice
}

/**
 * The items of the request. Merge sends what was picked. Replace sends the picked principals
 * plus the home-workspace row: the row is the person's explicit answer, so a picked copy of the
 * same workspace never doubles it, and `none` sends no row (the server turns the documents private).
 */
export function buildFolderItems({
  mode,
  picked,
  homeWorkspaceId,
  homeChoice,
}: FolderItemsInput): FolderContentsAccessItem[] {
  if (mode === 'merge') return [...picked]
  const rest = picked.filter(
    (item) => !(item.principalType === 'workspace' && item.principalId === homeWorkspaceId),
  )
  if (homeChoice === 'none' || !homeWorkspaceId) return rest
  return [...rest, { principalType: 'workspace', principalId: homeWorkspaceId, level: homeChoice }]
}

/** merge needs someone to add; replace may be empty (it removes every share) */
export function canSubmitFolderItems(
  mode: FolderContentsAccessMode,
  items: readonly FolderContentsAccessItem[],
): boolean {
  return mode === 'replace' || items.length > 0
}

/** the copy key of one server warning; a warning this client does not know is not shown */
export function warningKey(code: string): StringKey | null {
  switch (code) {
    case 'wide_scope':
      return 'shrFcWarnWide'
    case 'to_private':
      return 'shrFcWarnPrivate'
    case 'downgrade':
      return 'shrFcWarnDowngrade'
    default:
      return null
  }
}

/** the skipped documents of a result or a preview, both kinds together */
export const skippedTotal = (counts: FolderContentsAccessCounts): number =>
  counts.skippedNotManageable + counts.skippedLocked

/**
 * The summary lines of a dry run, in the order the spec words them: what changes (with the
 * documents the person cannot manage left out), then who loses access (replace) or is lowered.
 */
export function previewLines(
  t: ShareT,
  preview: FolderContentsAccessPreview,
  mode: FolderContentsAccessMode,
): string[] {
  const lines: string[] = []
  const head = [plural(t, 'shrFcWillChange', preview.changed)]
  if (preview.skippedNotManageable > 0) {
    head.push(t('shrFcSkippedNotManageable', { count: preview.skippedNotManageable }))
  }
  if (preview.skippedLocked > 0)
    head.push(t('shrFcSkippedLocked', { count: preview.skippedLocked }))
  lines.push(head.join(' · '))
  if (preview.unchanged > 0) lines.push(t('shrFcUnchanged', { count: preview.unchanged }))
  if (mode === 'replace' && preview.losingUsers > 0) {
    lines.push(plural(t, 'shrFcLosing', preview.losingUsers))
  }
  if (preview.downgradedUsers > 0) lines.push(plural(t, 'shrFcDowngraded', preview.downgradedUsers))
  return lines
}

/** the warnings of a dry run that have a sentence here, each once */
export function warningKeys(preview: FolderContentsAccessPreview): StringKey[] {
  const keys: StringKey[] = []
  for (const code of preview.warnings) {
    const key = warningKey(code)
    if (key && !keys.includes(key)) keys.push(key)
  }
  return keys
}

/** the toast of a run that finished: the changed count, and what was left out when something was */
export function doneMessage(t: ShareT, counts: FolderContentsAccessCounts): string {
  const base = plural(t, 'shrFcDone', counts.changed)
  const skipped = skippedTotal(counts)
  return skipped > 0 ? `${base} · ${t('shrFcSkippedTotal', { count: skipped })}` : base
}

/** the copy of a refusal the folder call can answer, as the dialog words it */
export function folderErrorKey(error: string): StringKey {
  switch (error) {
    case 'not_a_folder':
      return 'shrFcNotAFolder'
    case 'forbidden':
      return 'shrFcForbidden'
    case 'not_found':
      return 'shrFcNotFound'
    default:
      return 'shrSubmitFailed'
  }
}
