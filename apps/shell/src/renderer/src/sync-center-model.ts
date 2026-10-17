/**
 * G5-10 (UNI-1357): pure mapping of the Sync center (S2) snapshot to string keys,
 * badge tones and ordered row actions. Source of every row: EXPERIENCE.md ›
 * State Patterns › Queue rows and Lý do bị chặn; header: Đầu trang S2.
 */
import {
  SYNC_CENTER_HEADER_PRIORITY,
  type SyncCenterActionErrorCode,
  type SyncCenterHeader,
  type SyncCenterHeaderStatus,
  type SyncCenterRow,
  type SyncCenterSignedOutSummary,
  type SyncCenterRowTabId,
  type SyncCenterTabId,
} from '../../shared/sync-center'
import type { StringKey } from './locale'

export type SyncTone = 'info' | 'warn' | 'error' | 'ok' | 'neutral'

export type SyncRowActionId =
  | 'sendNow'
  | 'cancelSave'
  | 'recheck'
  | 'guide'
  | 'copySupport'
  | 'downloadMine'
  | 'discardSave'
  | 'openToResolve'
  | 'details'
  | 'saveAgain'
  | 'open'
  | 'openDraft'
  | 'discardDraft'
  | 'signIn'
  | 'signInAgain'
  | 'switchAccount'
  | 'reconnect'
  | 'retry'

export interface SyncRowAction {
  id: SyncRowActionId
  labelKey: StringKey
  /** the in-row Discard confirm: sentence + danger button + "Quay lại" */
  confirm?: { sentenceKey: StringKey; goKey: StringKey }
  /** shown but does not run: aria-disabled, described by this reason */
  unavailableKey?: StringKey
  /** the row's one most urgent action, drawn as the accent (primary) button */
  primary?: boolean
}

/** a sub-line: `params` go in as they are, `keyParams` are translated, time/size params are formatted */
export interface SyncLine {
  key: StringKey
  params?: Record<string, string | number>
  keyParams?: Record<string, StringKey>
  /** ISO-8601 (or an already formatted label) */
  timeParams?: Record<string, string>
  /** bytes */
  sizeParams?: Record<string, number>
  /** `{max}` in bytes when `keyParams.reason` is `uwReasonTooLargeWithLimit` */
  reasonMaxBytes?: number
}

export interface SyncRowView {
  badge: { tone: SyncTone; key: StringKey }
  sub: SyncLine
  actions: SyncRowAction[]
  /** what the document-name button opens (null: the name is plain text) */
  opens: 'document' | 'draft' | null
  /** the row belongs to another account: its document name is never shown */
  hideTitle: boolean
  progress?: { done: number; total: number }
}

/**
 * The 13 reasons of EXPERIENCE.md › Lý do bị chặn (the corrected contract
 * `SyncCenterBlockedReason`). Keyed by string so a row from an older main with
 * another reason still renders (fallback below).
 */
export type SyncBlockedReason =
  | 'session_expired'
  | 'signed_out'
  | 'foreign_account'
  | 'permission_revoked'
  | 'document_deleted'
  | 'document_archived'
  | 'organization_suspended'
  | 'member_deactivated'
  | 'lease_expired'
  | 'keystore_locked'
  | 'clock_rollback'
  | 'store_full'
  | 'store_newer'

interface BlockedCopy {
  tone: SyncTone
  badgeKey: StringKey
  /** the pill label, reused as `{reason}` of `uwRowBlocked` */
  reasonKey: StringKey
  actions: SyncRowActionId[]
}

/**
 * `store_full` ("Mở trung tâm đồng bộ") and `store_newer` ("Đóng") have no row
 * action here, nor has `lease_expired` on a row with `libraryOff` (see `rowView`): the user is already in the sync center, and the store_newer header
 * replaces the whole center with the S11 panel.
 */
export const BLOCKED_REASONS: Record<SyncBlockedReason, BlockedCopy> = {
  session_expired: {
    tone: 'error',
    badgeKey: 'uwBadgeBlocked',
    reasonKey: 'uwReasonSession',
    actions: ['signInAgain'],
  },
  signed_out: {
    tone: 'error',
    badgeKey: 'uwBadgeLocked',
    reasonKey: 'uwReasonSignedOut',
    actions: ['signIn'],
  },
  foreign_account: {
    tone: 'error',
    badgeKey: 'uwBadgeLocked',
    reasonKey: 'uwReasonForeign',
    actions: ['switchAccount'],
  },
  permission_revoked: {
    tone: 'error',
    badgeKey: 'uwBadgeRevoked',
    reasonKey: 'uwReasonForbidden',
    actions: ['recheck', 'discardDraft'],
  },
  document_deleted: {
    tone: 'error',
    badgeKey: 'uwBadgeDeleted',
    reasonKey: 'uwReasonDeleted',
    actions: ['recheck', 'discardDraft'],
  },
  document_archived: {
    tone: 'info',
    badgeKey: 'uwBadgeArchived',
    reasonKey: 'uwReasonArchived',
    actions: ['recheck', 'discardDraft'],
  },
  organization_suspended: {
    tone: 'error',
    badgeKey: 'uwBadgeBlocked',
    reasonKey: 'uwReasonSuspended',
    actions: ['recheck'],
  },
  member_deactivated: {
    tone: 'error',
    badgeKey: 'uwBadgeBlocked',
    reasonKey: 'uwReasonDeactivated',
    actions: ['recheck', 'discardDraft'],
  },
  lease_expired: {
    tone: 'error',
    badgeKey: 'uwBadgeReconnect',
    reasonKey: 'uwReasonLease',
    actions: ['reconnect'],
  },
  keystore_locked: {
    tone: 'error',
    badgeKey: 'uwBadgeKeystore',
    reasonKey: 'uwReasonKeystore',
    actions: ['retry'],
  },
  clock_rollback: {
    tone: 'error',
    badgeKey: 'uwBadgeReconnect',
    reasonKey: 'uwReasonClock',
    actions: ['reconnect'],
  },
  store_full: {
    tone: 'error',
    badgeKey: 'uwBadgeBlocked',
    reasonKey: 'uwReasonStoreFull',
    actions: [],
  },
  store_newer: {
    tone: 'error',
    badgeKey: 'uwBadgeLocked',
    reasonKey: 'uwReasonStoreNewer',
    actions: [],
  },
}

const UNKNOWN_BLOCKED: BlockedCopy = {
  tone: 'error',
  badgeKey: 'uwBadgeBlocked',
  reasonKey: 'uwReasonOther',
  actions: ['recheck'],
}

/** reasons whose document cannot be opened from the row */
const NOT_OPENABLE: ReadonlySet<string> = new Set([
  'signed_out',
  'foreign_account',
  'keystore_locked',
  'store_newer',
])

const ACTIONS: Record<SyncRowActionId, Omit<SyncRowAction, 'id'>> = {
  sendNow: { labelKey: 'uwActSendNow' },
  cancelSave: {
    labelKey: 'uwQueueCancel',
    confirm: { sentenceKey: 'uwQueueCancelConfirm', goKey: 'uwQueueCancelGo' },
  },
  recheck: { labelKey: 'uwActRecheck' },
  guide: { labelKey: 'uwActGuide' },
  copySupport: { labelKey: 'uwActCopySupport' },
  downloadMine: { labelKey: 'uwActDownloadMine' },
  discardSave: {
    labelKey: 'uwActDiscardSave',
    confirm: { sentenceKey: 'uwStuckDiscardConfirm', goKey: 'uwActDiscard' },
  },
  openToResolve: { labelKey: 'uwActOpenToResolve', primary: true },
  details: { labelKey: 'uwActDetails' },
  saveAgain: { labelKey: 'uwActSaveAgain' },
  open: { labelKey: 'uwActOpen' },
  openDraft: { labelKey: 'uwActOpenDraft' },
  discardDraft: {
    labelKey: 'uwActDiscardDraft',
    confirm: { sentenceKey: 'uwDiscardDraftConfirm', goKey: 'uwActDiscard' },
  },
  signIn: { labelKey: 'uwActSignIn' },
  signInAgain: { labelKey: 'uwActSignInAgain' },
  switchAccount: { labelKey: 'uwActSwitchAccount' },
  reconnect: { labelKey: 'uwActReconnect' },
  retry: { labelKey: 'uwActRetry' },
}

const action = (id: SyncRowActionId, over: Partial<SyncRowAction> = {}): SyncRowAction => ({
  id,
  ...ACTIONS[id],
  ...over,
})

const FAILED_REASON: Record<string, StringKey> = {
  quota: 'uwReasonQuota',
  too_large: 'uwReasonTooLarge',
  other: 'uwReasonOther',
}

export function failedReasonKey(row: SyncCenterRow): StringKey {
  if (row.failedReason === 'too_large' && row.maxBytes !== undefined) {
    return 'uwReasonTooLargeWithLimit'
  }
  return FAILED_REASON[row.failedReason ?? 'other'] ?? 'uwReasonOther'
}

export function blockedCopy(reason: string | undefined): BlockedCopy {
  return (reason && BLOCKED_REASONS[reason as SyncBlockedReason]) || UNKNOWN_BLOCKED
}

/** badge, sub-line and ordered actions of one row (Queue rows table) */
export function rowView(row: SyncCenterRow, ctx: { online: boolean }): SyncRowView {
  const base = { opens: 'document' as const, hideTitle: false }
  const at = { time: row.savedAt }
  const cancel = action('cancelSave')
  switch (row.state) {
    case 'queued':
      return {
        ...base,
        badge: { tone: 'info', key: 'uwBadgeQueued' },
        sub: {
          key: 'uwRowQueued',
          params: { base: row.base ?? '—', ...(row.sizeBytes === undefined ? { size: '—' } : {}) },
          timeParams: at,
          ...(row.sizeBytes === undefined ? {} : { sizeParams: { size: row.sizeBytes } }),
        },
        actions: [
          action('sendNow', ctx.online ? {} : { unavailableKey: 'uwSyncNowOffline' }),
          cancel,
        ],
      }
    case 'paused_offline':
      return {
        ...base,
        badge: { tone: 'info', key: 'uwBadgeWaitNetwork' },
        sub: { key: 'uwRowWaitNetwork' },
        actions: [cancel],
      }
    case 'paused_user':
      return {
        ...base,
        badge: { tone: 'neutral', key: 'uwBadgePausedUser' },
        sub: { key: 'uwRowPausedUser' },
        actions: [cancel],
      }
    case 'paused_admin':
      return {
        ...base,
        badge: { tone: 'neutral', key: 'uwBadgePausedAdmin' },
        sub: { key: 'uwRowPausedAdmin' },
        actions: [cancel],
      }
    case 'uploading': {
      const progress = row.progress ?? { done: 0, total: 0 }
      return {
        ...base,
        badge: { tone: 'info', key: 'uwBadgeSending' },
        sub: { key: 'uwRowUploading', sizeParams: { done: progress.done, total: progress.total } },
        actions: [],
        progress,
      }
    }
    case 'committing':
      return {
        ...base,
        badge: { tone: 'info', key: 'uwBadgeSending' },
        sub: { key: 'uwRowCommitting' },
        actions: [],
      }
    case 'reconciling':
      return {
        ...base,
        badge: { tone: 'warn', key: 'uwBadgeReconciling' },
        sub: { key: 'uwRowReconciling', timeParams: at },
        actions: [action('recheck'), action('guide')],
      }
    case 'reconciling_stuck':
      return {
        ...base,
        badge: { tone: 'warn', key: 'uwBadgeReconcileStuck' },
        sub: { key: 'uwRowReconcileStuck', params: { count: row.reconcileAttempts ?? 0 } },
        // "Tải bản của tôi về máy" only while the last known can_edit holds; offline still works
        actions: [
          action('recheck'),
          action('copySupport'),
          ...(row.canEdit ? [action('downloadMine')] : []),
          action('discardSave'),
        ],
      }
    case 'conflict': {
      const c = row.conflict
      return {
        ...base,
        badge: { tone: 'warn', key: 'uwBadgeConflict' },
        sub: {
          key: 'uwRowConflict',
          params: { n: c?.version ?? '—', ...(c?.author ? { author: c.author } : {}) },
          ...(c?.author ? {} : { keyParams: { author: 'uwAuthorFallback' } }),
          timeParams: { time: c?.savedAt ?? row.savedAt },
        },
        actions: [action('openToResolve')],
      }
    }
    case 'blocked': {
      const copy = blockedCopy(row.blockedReason)
      const reason = row.blockedReason ?? ''
      const foreign = reason === 'foreign_account'
      // lease_expired with the offline library capability off cannot be renewed ("Kết nối lại"
      // would do nothing): like store_full the user is already in the sync center, no row action
      const libraryOff = reason === 'lease_expired' && row.libraryOff === true
      return {
        badge: { tone: copy.tone, key: copy.badgeKey },
        sub: { key: 'uwRowBlocked', keyParams: { reason: copy.reasonKey } },
        actions: libraryOff ? [] : copy.actions.map((id) => action(id)),
        opens: NOT_OPENABLE.has(reason) ? null : 'document',
        hideTitle: foreign,
      }
    }
    case 'failed':
      return {
        ...base,
        badge: { tone: 'error', key: 'uwBadgeFailed' },
        sub: {
          key: 'uwRowFailed',
          keyParams: { reason: failedReasonKey(row) },
          ...(row.failedReason === 'too_large' && row.maxBytes !== undefined
            ? { reasonMaxBytes: row.maxBytes }
            : {}),
        },
        actions: [action('details'), action('saveAgain'), cancel],
      }
    case 'committed':
      return {
        ...base,
        badge: { tone: 'ok', key: 'uwBadgeSaved' },
        sub: { key: 'uwRowCommitted', params: { n: row.committedVersion ?? '—' }, timeParams: at },
        actions: [action('open')],
      }
    case 'kept_draft':
      if (row.revoked) {
        // access lost: the draft stays locked, only "Bỏ nháp…" (no open, no copy)
        return {
          badge: { tone: 'error', key: 'uwBadgeRevoked' },
          sub: { key: 'uwRowKeptDraft', timeParams: at },
          actions: [action('discardDraft')],
          opens: null,
          hideTitle: false,
        }
      }
      return {
        badge: { tone: 'warn', key: 'uwBadgeKeptDraft' },
        sub: { key: 'uwRowKeptDraft', timeParams: at },
        actions: [action('openDraft'), action('discardDraft')],
        opens: 'draft',
        hideTitle: false,
      }
    case 'moved':
      return {
        ...base,
        badge: { tone: 'info', key: 'uwBadgeMoved' },
        sub: { key: 'uwRowMoved', params: { workspace: row.workspaceName ?? '—' } },
        actions: [action('open')],
      }
    case 'archived':
      return {
        ...base,
        badge: { tone: 'info', key: 'uwBadgeArchived' },
        sub: { key: 'uwRowArchived' },
        actions: [action('open')],
      }
  }
}

/** the highest of: what main resolved, and what the header flags say (a stale low status never hides a flag) */
export function resolveHeaderStatus(header: SyncCenterHeader): SyncCenterHeaderStatus {
  const flagged: SyncCenterHeaderStatus = header.adminPaused
    ? 'admin_paused'
    : !header.online
      ? 'offline'
      : header.paused
        ? 'paused'
        : header.resyncFailed
          ? 'resync_failed'
          : header.feedOff
            ? 'feed_off'
            : header.resynced
              ? 'resynced'
              : 'online'
  const rank = (s: SyncCenterHeaderStatus) => SYNC_CENTER_HEADER_PRIORITY.indexOf(s)
  return rank(header.status) >= 0 && rank(header.status) < rank(flagged) ? header.status : flagged
}

export interface SyncHeaderLine extends SyncLine {
  tone: SyncTone
  action?: 'signIn' | 'signInAgain'
}

/** the one Sync header status line; null = store_newer (the S11 panel replaces the center) */
export function headerLine(
  header: SyncCenterHeader,
  signedOut: SyncCenterSignedOutSummary | undefined,
): SyncHeaderLine | null {
  // no verdict yet (a pass that attempted nothing) has no sync time: never render an empty {time}
  const time = header.lastSyncAt ? { time: header.lastSyncAt } : undefined
  switch (resolveHeaderStatus(header)) {
    case 'store_newer':
      return null
    case 'signed_out': {
      const count = signedOut?.lockedCount ?? 0
      return count > 0
        ? { key: 'uwSyncSignedOut', params: { count }, tone: 'neutral', action: 'signIn' }
        : { key: 'uwSyncSignedOutEmpty', tone: 'neutral', action: 'signIn' }
    }
    case 'session_expired':
      return { key: 'uwSyncSessionExpired', tone: 'error', action: 'signInAgain' }
    case 'admin_paused':
      return { key: 'uwSyncAdminPaused', tone: 'warn' }
    case 'offline':
      return time
        ? { key: 'uwSyncOffline', timeParams: time, tone: 'neutral' }
        : { key: 'uwSyncOfflineNoTime', tone: 'neutral' }
    case 'paused':
      return { key: 'uwSyncPaused', tone: 'neutral' }
    case 'resync_failed':
      return { key: 'uwSyncResyncFailed', tone: 'warn' }
    case 'feed_off':
      return { key: 'uwSyncFeedOff', tone: 'neutral' }
    case 'resynced':
      return time
        ? { key: 'uwSyncResynced', timeParams: time, tone: 'ok' }
        : { key: 'uwSyncOnlineNoTime', tone: 'ok' }
    case 'online':
      return time
        ? { key: 'uwSyncOnline', timeParams: time, tone: 'ok' }
        : { key: 'uwSyncOnlineNoTime', tone: 'ok' }
  }
}

export interface SyncTabDef {
  /** G5-05u: the offline (S3) tab carries its own rows (`snapshot.offline`), not `snapshot.tabs` */
  id: SyncCenterTabId
  labelKey: StringKey
  emptyKey: StringKey
}

/** Sync tab order: attention, pending, the "Dùng khi không có mạng" (S3) tab (G5-05u), recent. */
export const SYNC_TABS: readonly SyncTabDef[] = [
  { id: 'attention', labelKey: 'uwSyncTabAttention', emptyKey: 'uwSyncEmptyAttention' },
  { id: 'pending', labelKey: 'uwSyncTabQueue', emptyKey: 'uwSyncEmptyQueue' },
  { id: 'offline', labelKey: 'uwSyncTabOffline', emptyKey: 'uwOfflineEmpty' },
  { id: 'recent', labelKey: 'uwSyncTabRecent', emptyKey: 'uwSyncEmptyRecent' },
]

/**
 * The tabs in the tablist. The S3 tab shows while `offline.visible` (the
 * capability is on, or copies are kept: OQ-UX11); signed out it is the only
 * one (its count is the number of kept items, never a name).
 */
export function syncTabsOf(offlineVisible: boolean, signedOut = false): readonly SyncTabDef[] {
  if (signedOut) return offlineVisible ? SYNC_TABS.filter((d) => d.id === 'offline') : []
  return offlineVisible ? SYNC_TABS : SYNC_TABS.filter((d) => d.id !== 'offline')
}

export function isRowTab(id: SyncCenterTabId): id is SyncCenterRowTabId {
  return id !== 'offline'
}

/** kept drafts per document (OQ-UX2, U-15): the `{cap}` of `uwConflictDraftCapReached` */
export const DRAFT_CAP = 3

export function actionErrorKey(code: SyncCenterActionErrorCode): StringKey {
  if (code === 'draft_cap') return 'uwConflictDraftCapReached'
  if (code === 'store_full') return 'uwQueueFull'
  if (code === 'offline') return 'uwSyncNowOffline'
  return 'uwSyncActionFailed'
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number, locale: string): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(
    value,
  )
  return `${n} ${UNITS[unit]}`
}

/** a timestamp as the user reads it: time today, else date + time; a non-date label stays as given */
export function formatTime(value: string, locale: string, now = new Date()): string {
  if (!value) return '—'
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return value
  const sameDay = at.toDateString() === now.toDateString()
  return new Intl.DateTimeFormat(
    locale,
    sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
  ).format(at)
}
