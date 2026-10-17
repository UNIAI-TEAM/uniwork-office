/**
 * G5-05u (UNI-1360): pure mapping of the offline library (S3 tab "Dùng khi
 * không có mạng") to badge keys, sub-lines and ordered row actions. Source:
 * EXPERIENCE.md › Offline library rows (S3), Lý do bị chặn, Capability tắt.
 *
 * Main ranks the states (`OfflineRowView.state` is already the one a row
 * shows); this model never re-ranks. An offline copy is always read-only here:
 * nothing in this model offers or implies editing it (edit-lock, UNI-1645).
 */
import type {
  OfflineFailure,
  OfflineLibrarySnapshot,
  OfflineRowView,
} from '../../shared/offline-library'
import type { SyncCenterTabId } from '../../shared/sync-center'
import type { StringKey } from './locale'
import { blockedCopy, type SyncLine, type SyncTone } from './sync-center-model'

export type OfflineActionId =
  | 'open'
  | 'unpin'
  | 'cancelDownload'
  | 'downloadNow'
  | 'retry'
  | 'openFolder'
  | 'reconnect'
  | 'recheck'
  | 'retryKeystore'
  | 'signIn'
  | 'signInAgain'
  | 'switchAccount'

export interface OfflineAction {
  id: OfflineActionId
  labelKey: StringKey
}

export interface OfflineRowModel {
  badge: { tone: SyncTone; key: StringKey }
  sub: SyncLine
  actions: OfflineAction[]
  progress?: { done: number; total: number }
}

const LABELS: Record<OfflineActionId, StringKey> = {
  open: 'uwActOpen',
  unpin: 'uwOfflineUnpinShort',
  cancelDownload: 'uwOfflineCancelDownload',
  downloadNow: 'uwOfflineDownloadNow',
  retry: 'uwActRetry',
  openFolder: 'uwOfflineOpenFolder',
  reconnect: 'uwActReconnect',
  recheck: 'uwActRecheck',
  retryKeystore: 'uwActRetry',
  signIn: 'uwActSignIn',
  signInAgain: 'uwActSignInAgain',
  switchAccount: 'uwActSwitchAccount',
}

const act = (id: OfflineActionId): OfflineAction => ({ id, labelKey: LABELS[id] })

/** what stays while the org turned `offline_library` off: a read-only list (Mở while the lease holds · Bỏ ghim) */
const CAPABILITY_OFF_KEEPS: ReadonlySet<OfflineActionId> = new Set([
  'open',
  'unpin',
  'signIn',
  'signInAgain',
  'switchAccount',
])

/** the actions that call main for this row (one runs per row at a time) */
export const OFFLINE_CALLS: ReadonlySet<OfflineActionId> = new Set([
  'open',
  'unpin',
  'cancelDownload',
  'downloadNow',
  'retry',
  'openFolder',
  'reconnect',
  'recheck',
])

/** `{reason}` of `uwOfflineRowUpdateKept`: why an update was kept instead of applied */
function keptReasonKey(reason: string | null): StringKey {
  if (reason === 'too_large') return 'uwReasonTooLarge'
  if (reason === 'store_full' || reason === 'disk_full') return 'uwReasonQuota'
  return 'uwReasonOther'
}

/** a blocked reason's S2 action, as it applies to a pinned copy (drafts are discarded in S2, not here) */
function blockedActions(row: OfflineRowView): OfflineAction[] {
  // lease_expired with the capability off cannot be renewed: only the unpin is left (Capability tắt)
  if (row.lockReason === 'lease_expired' && row.libraryOff === true) return [act('unpin')]
  const out: OfflineAction[] = []
  for (const id of blockedCopy(row.lockReason).actions) {
    if (id === 'discardDraft') continue
    if (id === 'retry') out.push(act('retryKeystore'))
    else if (
      id === 'reconnect' ||
      id === 'recheck' ||
      id === 'signIn' ||
      id === 'signInAgain' ||
      id === 'switchAccount'
    )
      out.push(act(id))
  }
  return out
}

/** badge, sub-line and ordered actions of one S3 row (the "Offline library rows (S3)" table) */
export function offlineRowModel(
  row: OfflineRowView,
  ctx: { capabilityOn: boolean },
): OfflineRowModel {
  const model = baseModel(row)
  if (ctx.capabilityOn) return model
  return { ...model, actions: model.actions.filter((a) => CAPABILITY_OFF_KEEPS.has(a.id)) }
}

function baseModel(row: OfflineRowView): OfflineRowModel {
  const n = row.version ?? '—'
  const until = row.leaseUntil ? { datetime: row.leaseUntil } : undefined
  const noUntil: Record<string, string> = until ? {} : { datetime: '—' }
  switch (row.state) {
    case 'waiting-network':
      return {
        badge: { tone: 'info', key: 'uwOfflineBadgeWaiting' },
        sub: { key: 'uwOfflineRowWaiting' },
        actions: [act('unpin')],
      }
    case 'downloading': {
      const progress = row.progress ?? { done: 0, total: row.sizeBytes ?? 0 }
      return {
        badge: { tone: 'info', key: 'uwOfflineBadgeDownloading' },
        sub: {
          key: 'uwOfflineRowProgress',
          sizeParams: { done: progress.done, total: progress.total },
        },
        actions: [act('cancelDownload')],
        progress,
      }
    }
    case 'verifying':
      return {
        badge: { tone: 'info', key: 'uwOfflineBadgeVerifying' },
        sub: { key: 'uwOfflineRowVerifying' },
        actions: [],
      }
    case 'ready':
      return {
        badge: { tone: 'ok', key: 'uwOfflineReady' },
        sub: {
          key: 'uwOfflineRowReady',
          params: { n, ...(row.sizeBytes === null ? { size: '—' } : {}), ...noUntil },
          ...(row.sizeBytes === null ? {} : { sizeParams: { size: row.sizeBytes } }),
          ...(until ? { timeParams: until } : {}),
        },
        actions: [act('open'), act('unpin')],
      }
    case 'view-only':
      return {
        badge: { tone: 'ok', key: 'uwOfflineBadgeViewOnly' },
        sub: {
          key: 'uwOfflineRowViewOnly',
          params: { n, ...noUntil },
          ...(until ? { timeParams: until } : {}),
        },
        actions: [act('open'), act('unpin')],
      }
    case 'update-available':
      return {
        badge: { tone: 'info', key: 'uwOfflineBadgeUpdate' },
        sub: { key: 'uwOfflineRowUpdate', params: { n: row.headVersion ?? '—', old: n } },
        actions: [act('open'), act('downloadNow'), act('unpin')],
      }
    case 'update-kept':
      return {
        badge: { tone: 'ok', key: 'uwOfflineReady' },
        sub: {
          key: 'uwOfflineRowUpdateKept',
          params: { n: row.headVersion ?? '—', old: n },
          keyParams: { reason: keptReasonKey(row.updateKeptReason) },
        },
        actions: [act('open'), act('retry')],
      }
    case 'interrupted':
      return {
        badge: { tone: 'warn', key: 'uwOfflineBadgeInterrupted' },
        sub: { key: 'uwOfflineRowInterrupted' },
        actions: [act('retry'), act('unpin')],
      }
    case 'disk-full':
      return {
        badge: { tone: 'error', key: 'uwOfflineBadgeDiskFull' },
        sub:
          row.diskNeededBytes === undefined
            ? { key: 'uwOfflineRowDiskFull', params: { size: '—' } }
            : { key: 'uwOfflineRowDiskFull', sizeParams: { size: row.diskNeededBytes } },
        actions: [act('retry'), act('openFolder')],
      }
    case 'corrupt':
      return {
        badge: { tone: 'error', key: 'uwOfflineBadgeCorrupt' },
        sub: { key: 'uwOfflineRowCorrupt' },
        actions: [act('downloadNow')],
      }
    case 'lease-expiring':
      return {
        badge: { tone: 'warn', key: 'uwOfflineBadgeLeaseSoon' },
        sub: {
          key: 'uwOfflineRowLeaseSoon',
          ...(until ? { timeParams: until } : { params: noUntil }),
        },
        actions: [act('open'), act('unpin')],
      }
    case 'lease-expired':
    case 'locked': {
      // a lease-expired row without its reason (an older main) still names the lease
      const lockReason =
        row.lockReason ?? (row.state === 'lease-expired' ? 'lease_expired' : undefined)
      const copy = blockedCopy(lockReason)
      return {
        badge: { tone: copy.tone, key: copy.badgeKey },
        sub: { key: 'uwRowBlocked', keyParams: { reason: copy.reasonKey } },
        actions: blockedActions({ ...row, lockReason }),
      }
    }
    case 'revoked':
      return {
        badge: { tone: 'error', key: 'uwBadgeRevoked' },
        sub: { key: 'uwOfflineRowRevoked' },
        actions: [act('unpin')],
      }
    case 'deleted':
      return {
        badge: { tone: 'error', key: 'uwBadgeDeleted' },
        sub: { key: 'uwOfflineRowDeleted' },
        actions: [act('unpin')],
      }
    case 'archived':
      return {
        badge: { tone: 'info', key: 'uwBadgeArchived' },
        sub: { key: 'uwOfflineRowArchived' },
        actions: [act('open'), act('unpin')],
      }
    case 'moved':
      // the projection carries no target workspace name yet (no `moved` producer: D residual)
      return {
        badge: { tone: 'info', key: 'uwBadgeMoved' },
        sub: { key: 'uwOfflineRowMoved', params: { workspace: '—' } },
        actions: [act('open'), act('unpin')],
      }
  }
}

/** the states a row reads "Sẵn sàng offline" in: reaching one of them is announced once */
const READY_STATES: ReadonlySet<OfflineRowView['state']> = new Set(['ready', 'view-only'])

/**
 * The rows that just became ready (polite `uwOfflineReadyAnnounce`): a row
 * that was listed before in a state that is not ready. A first snapshot, a new
 * row or a row that was already ready is not a transition.
 */
export function readyTransitions(
  before: ReadonlyMap<string, OfflineRowView['state']> | null,
  rows: readonly OfflineRowView[],
): OfflineRowView[] {
  if (!before) return []
  return rows.filter((r) => {
    const was = before.get(r.documentId)
    return was !== undefined && !READY_STATES.has(was) && READY_STATES.has(r.state)
  })
}

const GIB = 1024 ** 3
const MIB = 1024 ** 2

/** a usage figure in MB below 1 GB, else GB (`uwOfflineUsage`, U-02 F10): 2 GiB -> "2 GB", vi "1,5 GB" */
export function formatUsageBytes(bytes: number, locale: string): string {
  const value = Math.max(0, bytes)
  const gb = value >= GIB
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    value / (gb ? GIB : MIB),
  )
  return `${n} ${gb ? 'GB' : 'MB'}`
}

/** the S3 tab's count: the rows, or signed out the number of kept items (never a name) */
export function offlineTabCount(offline: OfflineLibrarySnapshot, signedOut: boolean): number {
  return signedOut ? (offline.signedOutLockedCount ?? 0) : offline.rows.length
}

/** the copy of a refused offline action (`uwOfflineCapReached` with its two caps; anything else failed) */
export function offlineFailureCopy(
  failure: OfflineFailure,
  locale: string,
): { key: StringKey; params?: Record<string, string | number> } {
  if (failure.code === 'offline_cap_reached') {
    return {
      key: 'uwOfflineCapReached',
      params: {
        cap: failure.cap === undefined ? '—' : formatUsageBytes(failure.cap, locale),
        maxDocs: failure.maxDocs ?? '—',
      },
    }
  }
  if (failure.code === 'offline') return { key: 'uwSyncNowOffline' }
  return { key: 'uwSyncActionFailed' }
}

/** the document menu item of a document (`uwOfflinePin` / `uwOfflineUnpin`); null hides it */
export function offlineMenuOf(
  offline: Pick<OfflineLibrarySnapshot, 'capabilityOn' | 'rows'> | null | undefined,
  documentId: string,
): 'pin' | 'unpin' | null {
  if (!offline) return null
  if (offline.rows.some((r) => r.documentId === documentId)) return 'unpin'
  // taking a new pin is hidden while the org turned the offline library off; the unpin stays
  return offline.capabilityOn ? 'pin' : null
}

export const OFFLINE_MENU_LABEL: Record<'pin' | 'unpin', StringKey> = {
  pin: 'uwOfflinePin',
  unpin: 'uwOfflineUnpin',
}

// ── opening the sync center on a tab (F6, the S11 "Mở trung tâm đồng bộ") ──

let requestedTab: SyncCenterTabId | null = null
const TAB_EVENT = 'uniwork:sync-center-tab'

/**
 * Open Settings › Sync center on `tab`. A pane that mounts reads the tab once
 * (`takeRequestedSyncTab`); one already open hears the event.
 */
export function openSyncCenter(tab?: SyncCenterTabId): void {
  requestedTab = tab ?? null
  window.dispatchEvent(new CustomEvent('uniwork:open-settings', { detail: { section: 'sync' } }))
  if (tab) window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: { tab } }))
}

export function takeRequestedSyncTab(): SyncCenterTabId | null {
  const tab = requestedTab
  requestedTab = null
  return tab
}

export function onSyncTabRequest(cb: (tab: SyncCenterTabId) => void): () => void {
  const listener = (ev: Event) => {
    const tab = (ev as CustomEvent<{ tab?: SyncCenterTabId }>).detail?.tab
    if (tab) {
      requestedTab = null
      cb(tab)
    }
  }
  window.addEventListener(TAB_EVENT, listener)
  return () => window.removeEventListener(TAB_EVENT, listener)
}
