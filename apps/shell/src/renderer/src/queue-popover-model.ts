import type { UniworkDocStatus } from '../../shared/home-api'
import type {
  SyncCenterBlockedReason,
  SyncCenterRow,
  SyncCenterSnapshot,
} from '../../shared/sync-center'
import type { StringKey } from './locale'
import { blockedCopy } from './sync-center-model'
import { blockedReasonKey, formatSaveTime } from './uniwork-docs-model'

/**
 * Pure model of the queue popover (S4, EXPERIENCE "Queue popover"): which lines it reads, which
 * actions it offers. The rows come from the sync center (G5-10), there is no second row model.
 */

/** What opened the popover: the pill's button, or Ctrl/Cmd+S while a save is already waiting. */
export type QueuePopoverOpener = 'pill' | 'ctrl-s'

export type PopoverActionId =
  'sign-in' | 'sign-in-again' | 'recheck' | 'save-again' | 'cancel' | 'open-center'

export interface PopoverAction {
  id: PopoverActionId
  labelKey: StringKey
}

/** One sentence: the key and what fills its placeholders (the component translates them). */
export interface PopoverLine {
  key: StringKey
  /** `{time}` of the waiting save, an ISO timestamp (formatted by the component) */
  time?: string
  /** `{base}` of the waiting save */
  base?: number | string
  /** `{reason}`: the key of the short reason fragment (translated by the component) */
  reasonKey?: StringKey
}

export interface QueuePopoverModel {
  line1: PopoverLine
  line2?: PopoverLine
  line3?: PopoverLine
  actions: PopoverAction[]
}

/** States whose save may still be cancelled: nothing of it is committed (EXPERIENCE "Cancel intent"). */
const CANCELLABLE: ReadonlySet<string> = new Set([
  'queued',
  'paused_offline',
  'paused_user',
  'paused_admin',
  'failed',
  'conflict',
])

/** States in which the popover has something to say (a save waits, is blocked, failed or was refused). */
const POPOVER_STATES: ReadonlySet<string> = new Set([
  'queued',
  'paused_offline',
  'paused_user',
  'paused_admin',
  'saving',
  'reconciling',
  'reconciling-stuck',
  'blocked',
  'failed',
])

function isStoreRefusal(status: UniworkDocStatus): boolean {
  return (
    status.state === 'error' &&
    (status.error === 'keystore_locked' || status.error === 'store_full')
  )
}

export function isQueuePopoverState(status: UniworkDocStatus): boolean {
  return POPOVER_STATES.has(status.state) || isStoreRefusal(status)
}

/** the sync-center row of this document: pending first, then attention */
export function findQueueRow(
  snapshot: SyncCenterSnapshot | null | undefined,
  documentId: string,
): SyncCenterRow | undefined {
  if (!snapshot) return undefined
  return (
    snapshot.tabs.pending.find((row) => row.documentId === documentId) ??
    snapshot.tabs.attention.find((row) => row.documentId === documentId)
  )
}

/**
 * The reason's own next step inside the popover. Sign-in reasons sign in; the access reasons and a
 * locked keychain re-check (needs the row). The rest ("reconnect", "switch account", nothing) is
 * reached through "Open sync center", which always stays. Not derived from
 * `blockedCopy(reason).actions`: those are the sync center row's buttons (retry for a locked
 * keychain, discard draft, ...), the popover offers fewer and with the pill's own labels.
 */
const REASON_ACTION: Partial<Record<SyncCenterBlockedReason, PopoverAction>> = {
  session_expired: { id: 'sign-in-again', labelKey: 'uwActSignInAgain' },
  signed_out: { id: 'sign-in', labelKey: 'acctSignIn' },
  permission_revoked: { id: 'recheck', labelKey: 'uwActRecheck' },
  document_deleted: { id: 'recheck', labelKey: 'uwActRecheck' },
  document_archived: { id: 'recheck', labelKey: 'uwActRecheck' },
  organization_suspended: { id: 'recheck', labelKey: 'uwActRecheck' },
  member_deactivated: { id: 'recheck', labelKey: 'uwActRecheck' },
  keystore_locked: { id: 'recheck', labelKey: 'uwActRecheck' },
}

const FAILED_REASON_KEY: Record<string, StringKey> = {
  quota: 'uwReasonQuota',
  too_large: 'uwReasonTooLarge',
  other: 'uwReasonOther',
}

/**
 * `{reason}` of a failed save, the one source for the pill tooltip and the popover: the row's
 * failed reason when the sync center has the row, else what the status' error code says.
 */
export function failedReasonKeyOf(
  status: UniworkDocStatus,
  row: SyncCenterRow | undefined,
): StringKey {
  if (row?.failedReason) return FAILED_REASON_KEY[row.failedReason] ?? 'uwReasonOther'
  return blockedReasonKey(status.error)
}

/** the blocked reason of this save: the row's, else what the status' error code says */
function blockedReasonOf(
  status: UniworkDocStatus,
  row: SyncCenterRow | undefined,
): SyncCenterBlockedReason | undefined {
  if (row?.blockedReason) return row.blockedReason
  switch (status.error) {
    case 'keystore_locked':
    case 'store_full':
    case 'session_expired':
      return status.error
    case 'not_signed_in':
      return 'signed_out'
    default:
      return undefined
  }
}

function reasonKeyOf(reason: SyncCenterBlockedReason | undefined, status: UniworkDocStatus) {
  return reason ? blockedCopy(reason).reasonKey : blockedReasonKey(status.error)
}

export function queuePopoverModelOf(
  status: UniworkDocStatus,
  row: SyncCenterRow | undefined,
  opener: QueuePopoverOpener,
): QueuePopoverModel {
  const openCenter: PopoverAction = { id: 'open-center', labelKey: 'uwQueueOpenCenter' }

  // refused before anything was queued: the reason is the whole message
  if (isStoreRefusal(status)) {
    const reason = blockedReasonOf(status, row)
    return {
      line1:
        reason === 'store_full'
          ? { key: 'uwQueueFull' }
          : { key: 'uwRowBlocked', reasonKey: reasonKeyOf(reason, status) },
      actions: [openCenter],
    }
  }

  const failed = status.state === 'failed'
  const blocked = status.state === 'blocked'
  let line1: PopoverLine
  if (failed) {
    line1 = { key: 'uwTipFailed', reasonKey: failedReasonKeyOf(status, row) }
  } else if (opener === 'ctrl-s' || !row) {
    line1 = { key: 'uwQueueBlockedSave' }
  } else {
    line1 = { key: 'uwQueuePopWaiting', time: row.savedAt, base: row.base ?? '—' }
  }

  const reason = blocked ? blockedReasonOf(status, row) : undefined
  const actions: PopoverAction[] = []
  const reasonAction = reason ? REASON_ACTION[reason] : undefined
  // a re-check needs the row id
  if (reasonAction && (reasonAction.id !== 'recheck' || row)) actions.push(reasonAction)
  if (failed && row) actions.push({ id: 'save-again', labelKey: 'uwActSaveAgain' })
  if (row && CANCELLABLE.has(status.state)) {
    actions.push({ id: 'cancel', labelKey: 'uwQueueCancel' })
  }
  actions.push(openCenter)

  return {
    line1,
    ...(status.pendingNext ? { line2: { key: 'uwQueuePopNewer' as const } } : {}),
    ...(blocked
      ? { line3: { key: 'uwRowBlocked' as const, reasonKey: reasonKeyOf(reason, status) } }
      : {}),
    actions,
  }
}

// seam G5-10: same as formatTime of sync-center-model.ts; the second lander imports that one.
/**
 * a timestamp as the user reads it: time today, else date + time; a non-date label stays as given.
 * The save pill's tooltip reads the same `formatSaveTime`, so one saved-at time reads the same in
 * the pill and in the popover.
 */
export function formatQueueTime(value: string, locale: string, now = new Date()): string {
  return formatSaveTime(value, locale, now)
}

/**
 * how long the popover waits for the sync-center row before its band joins the top inset: the row
 * changes line 1 (and so the band height), and the editor view should move once, not twice
 */
export const QUEUE_BAND_SETTLE_MS = 300

/** kept drafts per document (OQ-UX2, U-15): the `{cap}` of `uwConflictDraftCapReached` */
export const QUEUE_DRAFT_CAP = 3

/** the dialog keeps this far from the window's left and right edges (contract §3) */
export const POPOVER_GUTTER_PX = 8

/** the dialog's width when it cannot be measured (`.uw-queue-pop` in queue-popover.css) */
const POPOVER_WIDTH_PX = 360

/** the document's direction right now (`<html dir>` follows the UI language: rtl for ar and he) */
export function docDirOf(): 'ltr' | 'rtl' {
  return typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'
}

/**
 * Where the dialog's left edge goes, in the unscaled CSS px it lays out in, by the physical box
 * whatever the document direction: left-to-right it is right-aligned to the pill's right edge; right-to-left
 * (ar, he) the pill sits at the window's left and the dialog's LEFT edge is the pill's left edge, so it
 * opens toward the window centre either way. Then it is kept inside the window by the gutter on both
 * sides. A measure that is not a number takes the side the pill is on (right gutter left-to-right,
 * left gutter right-to-left): inside the window, never NaN.
 */
export function popoverLeftOf(input: {
  pillRight: number
  pillLeft?: number
  dir?: 'ltr' | 'rtl'
  width: number
  windowWidth: number
}): number {
  const gutter = POPOVER_GUTTER_PX
  const windowWidth = Number.isFinite(input.windowWidth) ? input.windowWidth : 0
  const width =
    Number.isFinite(input.width) && input.width > 0
      ? input.width
      : Math.min(POPOVER_WIDTH_PX, Math.max(0, windowWidth - 2 * gutter))
  const max = Math.max(gutter, windowWidth - gutter - width)
  const rtl = input.dir === 'rtl'
  const edge = rtl ? input.pillLeft : input.pillRight
  const wanted =
    typeof edge === 'number' && Number.isFinite(edge)
      ? rtl
        ? edge
        : edge - width
      : rtl
        ? gutter
        : max
  return Math.min(max, Math.max(gutter, wanted))
}
