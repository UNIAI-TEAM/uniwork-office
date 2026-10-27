// Pure helpers of the "share the documents inside a folder" dialog (UNI-2244): the items the
// server is sent, the summary lines of a dry run, the warnings it names and the toast of a
// finished run (sync or background). No React here.
import {
  FOLDER_CONTENTS_ACCESS_MAX_ITEMS,
  type FolderContentsAccessCounts,
  type FolderContentsAccessItem,
  type FolderContentsAccessMode,
  type FolderContentsAccessPreview,
  type ShareLevel,
} from '../../../shared/share-api'
import type { StringKey } from '../locale'
import { plural, type ShareT } from './share-model'

/** the home-workspace choice of the replace mode: a level, or `private` (the folder's documents go private) */
export type HomeWorkspaceChoice = ShareLevel | 'private'

/** the select's own state: `''` = nothing chosen yet, and the replace mode cannot be confirmed until it is */
export type HomeWorkspaceState = HomeWorkspaceChoice | ''

/** the levels the home workspace row offers (the organization and the home workspace stop at edit) */
export const HOME_WORKSPACE_LEVELS: readonly ShareLevel[] = ['view', 'comment', 'edit']

export interface FolderItemsInput {
  mode: FolderContentsAccessMode
  /** the people / groups picked in the picker, each with its effective level */
  picked: readonly FolderContentsAccessItem[]
  /** the home workspace id of the folder; its row is the replace mode's own */
  homeWorkspaceId: string
  homeChoice: HomeWorkspaceState
}

/**
 * The items of the request. Merge sends what was picked. Replace sends the picked principals
 * plus the home-workspace row: the row is the person's explicit answer, so a picked copy of the
 * same workspace never doubles it, and `private` sends no row (the server turns the documents private).
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
  if (homeChoice === 'private' || homeChoice === '' || !homeWorkspaceId) return rest
  return [...rest, { principalType: 'workspace', principalId: homeWorkspaceId, level: homeChoice }]
}

/** how many people / groups the picker may hold: the replace mode keeps one slot for the home row */
export function maxPickedItems(mode: FolderContentsAccessMode): number {
  return FOLDER_CONTENTS_ACCESS_MAX_ITEMS - (mode === 'replace' ? 1 : 0)
}

/**
 * The server takes at most 100 items. Merge needs someone to add; replace may be empty (it
 * removes every share) but needs the home-workspace answer first (no preselected level).
 */
export function canSubmitFolderItems(
  mode: FolderContentsAccessMode,
  items: readonly FolderContentsAccessItem[],
  homeChoice: HomeWorkspaceState,
): boolean {
  if (items.length > FOLDER_CONTENTS_ACCESS_MAX_ITEMS) return false
  return mode === 'replace' ? homeChoice !== '' : items.length > 0
}

/** the sentence of one server warning; a warning this client does not know is not shown */
function warningText(t: ShareT, code: string, preview: FolderContentsAccessPreview): string | null {
  switch (code) {
    case 'wide_scope':
      return t('shrFcWarnWide')
    case 'to_private':
      return t('shrFcWarnPrivate')
    case 'downgrade':
      return plural(t, 'shrFcWarnDowngrade', preview.downgradedUsers)
    default:
      return null
  }
}

/**
 * The summary lines of a dry run: what changes (with the documents left out joined to it), then
 * who loses access.
 */
export function previewLines(t: ShareT, preview: FolderContentsAccessPreview): string[] {
  const head = [plural(t, 'shrFcWillChange', preview.changed)]
  if (preview.skippedNotManageable > 0) {
    head.push(t('shrFcSkippedNotManageable', { count: preview.skippedNotManageable }))
  }
  if (preview.skippedLocked > 0) {
    head.push(t('shrFcSkippedLocked', { count: preview.skippedLocked }))
  }
  const lines = [head.join(' · ')]
  if (preview.losingUsers > 0) lines.push(plural(t, 'shrFcLosing', preview.losingUsers))
  return lines
}

/** the warnings of a dry run that have a sentence here, each once */
export function warningLines(t: ShareT, preview: FolderContentsAccessPreview): string[] {
  const lines: string[] = []
  for (const code of preview.warnings) {
    const text = warningText(t, code, preview)
    if (text && !lines.includes(text)) lines.push(text)
  }
  return lines
}

/** sentences read one after the other: all but the last close with a full stop */
function joinSentences(parts: string[]): string {
  return parts.map((part, i) => (i < parts.length - 1 ? `${part}.` : part)).join(' ')
}

/** the counted result and what was left out, as one toast */
function resultMessage(t: ShareT, base: string, counts: FolderContentsAccessCounts): string {
  const parts = [base]
  if (counts.skippedNotManageable > 0) {
    parts.push(plural(t, 'shrFcToastSkipped', counts.skippedNotManageable))
  }
  if (counts.skippedLocked > 0) parts.push(plural(t, 'shrFcToastLocked', counts.skippedLocked))
  return joinSentences(parts)
}

/** the toast of a run that finished at once (sync) */
export function doneMessage(t: ShareT, counts: FolderContentsAccessCounts): string {
  return resultMessage(t, plural(t, 'shrFcDone', counts.changed), counts)
}

/** the toast of a background run that ended */
export function batchEndMessage(
  t: ShareT,
  batch: FolderContentsAccessCounts & { phase: 'completed' | 'failed' },
): string {
  if (batch.phase === 'failed') return t('shrFcBatchFailed')
  return resultMessage(t, plural(t, 'shrFcBatchDone', batch.changed), batch)
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
      return 'shrFcErrorGeneric'
  }
}
