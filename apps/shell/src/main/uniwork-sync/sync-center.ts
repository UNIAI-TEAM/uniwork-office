import { randomUUID } from 'node:crypto'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { DRAFT_PREVIEW_DIR, isDraftPreviewPath } from '@genoffice/electron-utils/draft-preview'
import {
  SYNC_CENTER_ATTENTION_STATES,
  SYNC_CENTER_DISCARDABLE_BLOCKED_REASONS,
  SYNC_CENTER_PENDING_STATES,
  UNIWORK_SYNC_CENTER_CHANNELS,
  type SyncCenterAccountInfo,
  type SyncCenterActionResult,
  type SyncCenterBlockedReason,
  type SyncCenterConflictInfo,
  type SyncCenterDefaultTab,
  type SyncCenterFailedReason,
  type SyncCenterHeaderStatus,
  type SyncCenterOrgInfo,
  type SyncCenterRow,
  type SyncCenterRowProgress,
  type SyncCenterRowState,
  type SyncCenterSnapshot,
  type SyncCenterStoreBudget,
  type UniworkSyncCenterApi,
} from '../../shared/sync-center'
import type {
  AccountStatus,
  UniworkDocErrorCode,
  UniworkDocFormat,
  UniworkLockReason,
} from '../../shared/home-api'
import {
  bindingCanEdit,
  scopeWorkingCopyDirs,
  type BindingStore,
} from '../uniwork-docs/binding-store'
import type { QueueDispatcher, QueueDoc } from './queue/dispatcher'
import type { DraftStore, KeptDraftMeta } from './queue/drafts'
import { QUEUE_LIMITS } from './queue/limits'
import { CANCELLABLE } from './queue/machine'
import type { PauseStore } from './queue/pause'
import type { IntentStore } from './intent-store'
import type { StoreLayer } from './store'
import type { SyncStoreAccess } from './session-store'
import { isTerminalQueueState, type IntentRecordV2, type QueueState } from './queue/record'

/** 24-hour window for the `recent` ("Đã lưu gần đây") tab. */
export const RECENT_COMMITTED_WINDOW_MS = 24 * 60 * 60 * 1000

const ATTENTION_STATE_SET: ReadonlySet<string> = new Set(SYNC_CENTER_ATTENTION_STATES)
const PENDING_STATE_SET: ReadonlySet<string> = new Set(SYNC_CENTER_PENDING_STATES)

export interface SyncCenterIntentFact {
  id?: string
  documentKey: string
  documentId?: string
  orgId?: string
  workspaceId?: string
  workspaceName?: string
  title: string
  ext: string
  record: IntentRecordV2
  /** Optional explicit row state override (e.g. `'moved'` or `'archived'`). */
  stateOverride?: SyncCenterRowState
  blockedReason?: SyncCenterBlockedReason
  failedReason?: SyncCenterFailedReason
  /** Maximum allowed document size in bytes when `failedReason === 'too_large'`. */
  maxBytes?: number
  progress?: SyncCenterRowProgress
  conflict?: SyncCenterConflictInfo
  lockedBy?: string
  supportCode?: string
  canEdit: boolean
}

export interface SyncCenterDraftFact {
  id?: string
  documentKey: string
  documentId: string
  orgId: string
  title: string
  ext: string
  draft: KeptDraftMeta & { snapshot?: Uint8Array }
  canEdit: boolean
  revoked?: boolean
}

export interface SyncCenterRecentFact {
  id: string
  documentKey: string
  documentId: string
  orgId: string
  title: string
  ext: string
  savedAt: string
  base?: number
  committedVersion?: number
  canEdit: boolean
}

export interface SyncCenterFacts {
  nowMs?: number
  /** Condition 1: Store requires a newer app version (`uwLockNewerStore` replaces S2). */
  storeNewer?: boolean
  /** Conditions 2 & 3: `'signed_out'`, `'session_expired'`, or `'signed_in'`. */
  sessionState: 'signed_out' | 'session_expired' | 'signed_in'
  /** Condition 5 (`!online` -> `'offline'`) & Condition 10 (`'online'`). */
  online: boolean
  /** Condition 6: User-toggled pause (`'paused'`). */
  paused: boolean
  /** Condition 4: Admin capability `sync_write` off (`'admin_paused'`). */
  adminPaused: boolean
  /** Condition 7: Full resync failed past retry cap (`'resync_failed'`). */
  resyncFailed?: boolean
  /** Condition 8: Admin capability `sync_feed` off (`'feed_off'`). */
  feedOff?: boolean
  /** Condition 9: Just completed a full resync (`'resynced'`). */
  resynced?: boolean
  /**
   * The org capability `offline_library`; `false` marks a `lease_expired` row `libraryOff`.
   * Unknown (`undefined`) is treated as on.
   */
  offlineLibrary?: boolean
  lastSyncAt?: string
  account?: SyncCenterAccountInfo
  org?: SyncCenterOrgInfo
  activeOrgId?: string
  storeBudget?: SyncCenterStoreBudget
  storeError?: boolean
  signedOutLockedCount?: number
  intents?: readonly SyncCenterIntentFact[]
  drafts?: readonly SyncCenterDraftFact[]
  recentCommits?: readonly SyncCenterRecentFact[]
}

/**
 * Resolve the single status line discriminant from the 10-row priority table
 * in EXPERIENCE.md › "Đầu trang S2" (lines 253–271).
 */
export function resolveHeaderStatus(facts: SyncCenterFacts): SyncCenterHeaderStatus {
  if (facts.storeNewer === true) return 'store_newer'
  if (facts.sessionState === 'signed_out') return 'signed_out'
  if (facts.sessionState === 'session_expired') return 'session_expired'
  if (facts.adminPaused === true) return 'admin_paused'
  if (!facts.online) return 'offline'
  if (facts.paused === true) return 'paused'
  if (facts.resyncFailed === true) return 'resync_failed'
  if (facts.feedOff === true) return 'feed_off'
  if (facts.resynced === true) return 'resynced'
  return 'online'
}

function mapQueueStateToRowState(
  state: QueueState,
  override?: SyncCenterRowState,
): SyncCenterRowState | null {
  if (override) return override
  switch (state) {
    case 'cancelled':
      return null
    case 'validating':
    case 'uploading':
      return 'uploading'
    case 'reconciling-stuck':
      return 'reconciling_stuck'
    default:
      return state
  }
}

/**
 * The header account of a status: the profile's display name, else the local part of
 * the email (the same fallback as the account pane's `displayNameOf`); none without an identity.
 */
export function accountInfoOf(status: AccountStatus): SyncCenterAccountInfo | undefined {
  const email = status.profile?.email || status.email || ''
  const name = status.profile?.displayName?.trim() || (email.split('@')[0] ?? '')
  if (!name && !email) return undefined
  return { name: name || email, ...(email ? { email } : {}) }
}

/**
 * A blocked intent's reason in the spine's vocabulary. `explicit` (a fact the
 * caller derived: `lease_expired`, `foreign_account`, ...) wins; otherwise the
 * queue's `lastError` decides. Only the codes the queue machine files as lost
 * access (`forbidden`, `not_found`, `permission_revoked`) read
 * `permission_revoked`; an absent or unknown error has no reason at all
 * (undefined), which the row renders read-only ("Kiểm tra lại" only): a cause
 * nobody knows must never offer the destructive "Bỏ nháp…". A document in the
 * archive keeps its own reason (`document_archived`), never the deleted one:
 * archiving is reversible, and the row's way out is the unarchive.
 */
export function mapBlockedReason(
  error: UniworkDocErrorCode | undefined,
  explicit?: SyncCenterBlockedReason,
): SyncCenterBlockedReason | undefined {
  if (explicit) return explicit
  switch (error) {
    case 'forbidden':
    case 'not_found':
    case 'permission_revoked':
      return 'permission_revoked'
    case 'session_expired':
    case 'not_signed_in':
    case 'wrong_deployment':
      return 'session_expired'
    case 'document_deleted':
    case 'deleted':
      return 'document_deleted'
    case 'document_archived':
      return 'document_archived'
    case 'member_deactivated':
      return 'member_deactivated'
    case 'organization_suspended':
      return 'organization_suspended'
    case 'keystore_locked':
      return 'keystore_locked'
    case 'store_full':
      return 'store_full'
    default:
      return undefined
  }
}

/** whether a blocked reason offers "Bỏ nháp…"; an unknown reason never does */
export function isDiscardableBlockedReason(reason: SyncCenterBlockedReason | undefined): boolean {
  return reason !== undefined && SYNC_CENTER_DISCARDABLE_BLOCKED_REASONS.includes(reason)
}

function mapFailedReason(
  error: UniworkDocErrorCode | undefined,
  explicit?: SyncCenterFailedReason,
): SyncCenterFailedReason {
  if (explicit) return explicit
  if (error === 'quota_exceeded') return 'quota'
  if (error === 'too_large') return 'too_large'
  // EL-1(a) (UNI-1645c): the queue parked the intent with lastError edit_locked; the row must
  // say "someone else is editing", not the generic "unavailable"
  if (error === 'edit_locked') return 'edit_locked'
  return 'other'
}

function blockedFields(
  item: SyncCenterIntentFact,
  offlineLibrary: boolean | undefined,
): Pick<SyncCenterRow, 'blockedReason' | 'libraryOff'> {
  const blockedReason = mapBlockedReason(item.record.lastError, item.blockedReason)
  return {
    ...(blockedReason ? { blockedReason } : {}),
    ...(blockedReason === 'lease_expired' && offlineLibrary === false ? { libraryOff: true } : {}),
  }
}

export function formatSupportCode(record: IntentRecordV2): string {
  const docPart = (record.documentId || 'DOC').slice(0, 8)
  const keyPart = (record.idempotencyKey || record.intentId || 'KEY').slice(0, 8)
  return `UW-${docPart}-${keyPart}`
}

/**
 * The action code of a cancel the dispatcher refused: the reason its kept draft could not
 * be written (`drafts_full`, `store_full`, a locked/interrupted store), else the record was
 * simply not in a cancellable state.
 */
export function cancelRefusalCode(
  lastError: UniworkDocErrorCode | undefined,
): Exclude<SyncCenterActionResult, { ok: true }> {
  if (lastError === 'drafts_full') return { ok: false, code: 'draft_cap' }
  if (lastError === 'store_full') return { ok: false, code: 'store_full' }
  if (lastError === 'keystore_locked') return { ok: false, code: 'other' }
  return { ok: false, code: 'busy' }
}

function isWithinRecentWindow(savedAtIso: string, nowMs: number): boolean {
  const parsed = Date.parse(savedAtIso)
  if (!Number.isFinite(parsed)) return false
  return nowMs - parsed <= RECENT_COMMITTED_WINDOW_MS
}

/**
 * Pure snapshot builder (`buildSyncCenterSnapshot(facts)`).
 * Applies the 10-condition header priority table, active-org filtering,
 * other-org pending detection, 24h recent window, signed-out privacy guard
 * (lockedCount only, no document titles), and storeError empty-tabs guard.
 */
export function buildSyncCenterSnapshot(facts: SyncCenterFacts): SyncCenterSnapshot {
  const nowMs = facts.nowMs ?? Date.now()
  const status = resolveHeaderStatus(facts)
  const activeOrgId = facts.activeOrgId ?? facts.org?.id ?? ''
  const intents = facts.intents ?? []
  const drafts = facts.drafts ?? []
  const recentCommits = facts.recentCommits ?? []

  // Count non-terminal intents in other orgs
  let otherOrgCount = 0
  if (activeOrgId) {
    for (const item of intents) {
      const itemOrg = item.orgId ?? item.record.orgId
      if (itemOrg && itemOrg !== activeOrgId && !isTerminalQueueState(item.record.state)) {
        otherOrgCount += 1
      }
    }
    for (const draft of drafts) {
      if (draft.orgId && draft.orgId !== activeOrgId) {
        otherOrgCount += 1
      }
    }
  }

  const header = {
    status,
    online: facts.online,
    paused: facts.paused,
    adminPaused: facts.adminPaused,
    ...(facts.lastSyncAt ? { lastSyncAt: facts.lastSyncAt } : {}),
    ...(status !== 'signed_out' && facts.account ? { account: facts.account } : {}),
    ...(status !== 'signed_out' && facts.org ? { org: facts.org } : {}),
    ...(facts.storeBudget ? { storeBudget: facts.storeBudget } : {}),
    otherOrgHasIntents: otherOrgCount > 0,
    ...(otherOrgCount > 0 ? { otherOrgCount } : {}),
    resyncFailed: facts.resyncFailed === true,
    feedOff: facts.feedOff === true,
    resynced: facts.resynced === true,
  }

  // Signed-out guard: expose only lockedCount, never document names or rows
  if (status === 'signed_out') {
    const computedLocked =
      intents.filter((i) => !isTerminalQueueState(i.record.state)).length + drafts.length
    const lockedCount =
      facts.signedOutLockedCount !== undefined
        ? Math.max(0, facts.signedOutLockedCount)
        : computedLocked
    return {
      header,
      signedOut: { lockedCount },
      storeError: facts.storeError === true,
      tabs: { attention: [], pending: [], recent: [] },
      defaultTab: 'pending',
    }
  }

  // Store error guard: table replaced by uwSyncStoreError + Thử lại
  if (facts.storeError === true) {
    return {
      header,
      storeError: true,
      tabs: { attention: [], pending: [], recent: [] },
      defaultTab: 'pending',
    }
  }

  const attention: SyncCenterRow[] = []
  const pending: SyncCenterRow[] = []
  const recent: SyncCenterRow[] = []

  const matchesActiveOrg = (orgId: string | undefined): boolean =>
    !activeOrgId || !orgId || orgId === activeOrgId

  for (const item of intents) {
    const itemOrg = item.orgId ?? item.record.orgId
    if (!matchesActiveOrg(itemOrg)) continue
    const rowState = mapQueueStateToRowState(item.record.state, item.stateOverride)
    if (!rowState) continue

    const savedAt = item.record.updatedAt || item.record.createdAt
    if (rowState === 'committed' && !isWithinRecentWindow(savedAt, nowMs)) {
      continue
    }

    const maxBytes = item.maxBytes ?? item.record.maxBytes
    const row: SyncCenterRow = {
      id: item.id ?? item.record.intentId,
      documentId: item.documentId ?? item.record.documentId,
      documentKey: item.documentKey,
      title: item.title,
      ext: item.ext,
      state: rowState,
      savedAt,
      base: item.record.baseVersion,
      sizeBytes: item.record.length,
      ...(typeof maxBytes === 'number' && maxBytes > 0 ? { maxBytes } : {}),
      canEdit: item.canEdit,
      ...(item.workspaceName ? { workspaceName: item.workspaceName } : {}),
      ...(item.progress ? { progress: item.progress } : {}),
      ...(item.conflict ? { conflict: item.conflict } : {}),
      ...(item.lockedBy ? { lockedBy: item.lockedBy } : {}),
      ...(rowState === 'blocked' ? blockedFields(item, facts.offlineLibrary) : {}),
      ...(rowState === 'failed'
        ? { failedReason: mapFailedReason(item.record.lastError, item.failedReason) }
        : {}),
      ...(rowState === 'reconciling_stuck'
        ? {
            reconcileAttempts: item.record.attempt,
            supportCode: item.supportCode ?? formatSupportCode(item.record),
          }
        : {}),
      ...(rowState === 'committed' && item.record.receipt
        ? { committedVersion: item.record.receipt.version }
        : {}),
    }

    if (ATTENTION_STATE_SET.has(rowState)) {
      attention.push(row)
    } else if (PENDING_STATE_SET.has(rowState)) {
      pending.push(row)
    } else if (rowState === 'committed') {
      recent.push(row)
    }
  }

  for (const item of drafts) {
    if (!matchesActiveOrg(item.orgId)) continue
    const draftRowId = item.id ?? `draft:${item.documentKey}:${item.draft.id}`
    attention.push({
      id: draftRowId,
      documentId: item.documentId,
      documentKey: item.documentKey,
      title: item.draft.title ?? item.title,
      ext: item.ext,
      state: 'kept_draft',
      savedAt: item.draft.createdAt,
      ...(item.draft.snapshot ? { sizeBytes: item.draft.snapshot.byteLength } : {}),
      canEdit: item.canEdit,
      ...(item.revoked !== undefined ? { revoked: item.revoked } : {}),
      draftId: item.draft.id,
    })
  }

  for (const item of recentCommits) {
    if (!matchesActiveOrg(item.orgId)) continue
    if (!isWithinRecentWindow(item.savedAt, nowMs)) continue
    if (recent.some((r) => r.id === item.id)) continue
    recent.push({
      id: item.id,
      documentId: item.documentId,
      documentKey: item.documentKey,
      title: item.title,
      ext: item.ext,
      state: 'committed',
      savedAt: item.savedAt,
      ...(item.base !== undefined ? { base: item.base } : {}),
      ...(item.committedVersion !== undefined ? { committedVersion: item.committedVersion } : {}),
      canEdit: item.canEdit,
    })
  }

  const defaultTab: SyncCenterDefaultTab = attention.length > 0 ? 'attention' : 'pending'

  return {
    header,
    storeError: false,
    tabs: { attention, pending, recent },
    defaultTab,
  }
}

export interface ResolvedQueueDocEntry {
  doc: QueueDoc
  title: string
  ext: string
  canEdit: boolean
  supportCode?: string
  /** True only when an open editor window currently holds a newer copy than this intent's snapshot. */
  openWindowHasNewer?: boolean
}

export interface SyncCenterControllerDeps {
  now?(): number
  debounceMs?: number
  isOnline(): boolean
  getFacts(): Promise<SyncCenterFacts>
  findDoc(rowId: string): Promise<ResolvedQueueDocEntry | null>
  dispatcher(): Promise<QueueDispatcher | null>
  /**
   * "Kiểm tra lại" on a BLOCKED row: the access re-probe of that one intent,
   * right now (a document read, or a real capability read of the intent's own
   * org lane), so the row leaves `blocked` only for a condition that really
   * lifted. `false` = the re-probe could not run (no live session or store).
   */
  recheckBlocked(doc: QueueDoc): Promise<boolean>
  drafts(): Promise<DraftStore | null>
  /**
   * "Hủy lần lưu…" through the same service path the save pill uses. `documentClosed`
   * = no open window holds the document (its snapshot becomes a kept draft); an open
   * document keeps its work in the window and its chip goes back to unsaved.
   */
  cancelSave(entry: ResolvedQueueDocEntry, documentClosed: boolean): Promise<SyncCenterActionResult>
  /** a kept draft was discarded: drop anything derived from it (its read-only preview) */
  draftDiscarded(documentKey: string, draftId: string): Promise<void>
  listQueueDocs(): Promise<QueueDoc[]>
  /** a fresh unique id for the intent `saveAgain` mints (defaults to a random UUID) */
  newId?(): string
  syncNow(): Promise<void>
  /** the feed stopped on refused resyncs (header 7): "Đồng bộ ngay" must still try, even offline */
  isResyncFailed(): boolean
  /**
   * forget the feed's refused resyncs and backoff before that retry pass; it settles any pass
   * already in flight first, so the retry that follows is a fresh pass and not that one
   */
  resetFeedResync(): Promise<void>
  setSendingPaused?(paused: boolean): Promise<boolean>
  writeClipboard(text: string): void
  openDocument(documentId: string, path?: string): Promise<boolean>
  openDraft(input: {
    documentKey: string
    draftId: string
    title: string
    ext: string
    snapshot: Uint8Array
    readOnly: true
  }): Promise<boolean>
  pickSaveCopyPath(input: {
    defaultFilename: string
    title: string
    ext: string
  }): Promise<string | null>
  writeCopyFile(
    targetPath: string,
    bytes: Uint8Array,
    meta: { defaultFilename: string; title: string; ext: string },
  ): Promise<void>
  retryStore(): Promise<boolean>
}

export interface SyncCenterController extends UniworkSyncCenterApi {
  notifyChanged(): void
}

/**
 * Format the default filename for "Tải bản của tôi về máy" (`{title} (bản của tôi).{ext}`).
 */
export function buildMyCopyDefaultFilename(title: string, ext: string): string {
  const cleanExt = ext.replace(/^\.+/, '').trim() || 'docx'
  const rawTitle = title.trim() || 'document'
  const suffix = `.${cleanExt}`
  const stem =
    rawTitle.toLowerCase().endsWith(suffix.toLowerCase()) && rawTitle.length > suffix.length
      ? rawTitle.slice(0, -suffix.length)
      : rawTitle
  return `${stem} (bản của tôi).${cleanExt}`
}

function parseDraftRowId(rowId: string): { documentKey: string; draftId: string } | null {
  if (!rowId.startsWith('draft:')) return null
  const rest = rowId.slice('draft:'.length)
  const sepIdx = rest.lastIndexOf(':')
  if (sepIdx <= 0 || sepIdx >= rest.length - 1) return null
  return {
    documentKey: rest.slice(0, sepIdx),
    draftId: rest.slice(sepIdx + 1),
  }
}

export function createSyncCenterController(deps: SyncCenterControllerDeps): SyncCenterController {
  const listeners = new Set<(snapshot: SyncCenterSnapshot) => void>()
  const debounceMs = deps.debounceMs ?? 16
  let timer: ReturnType<typeof setTimeout> | null = null
  // one rebuild in flight, at most one queued behind it: a read during a build gets the
  // queued one (its facts may predate the change), and every further read shares it
  let building: Promise<SyncCenterSnapshot> | null = null
  let queued: Promise<SyncCenterSnapshot> | null = null

  const build = (): Promise<SyncCenterSnapshot> => {
    const run = deps
      .getFacts()
      .then(buildSyncCenterSnapshot)
      .finally(() => {
        if (building === run) building = null
      })
    building = run
    return run
  }

  const getSnapshot = (): Promise<SyncCenterSnapshot> => {
    if (!building) return build()
    if (!queued) {
      const next = building
        .catch(() => undefined)
        .then(() => {
          if (queued === next) queued = null
          return building ?? build()
        })
      queued = next
    }
    return queued
  }

  const flushListeners = async (): Promise<void> => {
    if (listeners.size === 0) return
    try {
      const snap = await getSnapshot()
      for (const listener of [...listeners]) {
        listener(snap)
      }
    } catch {
      // ignore background push errors
    }
  }

  const notifyChanged = (): void => {
    if (listeners.size === 0) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flushListeners()
    }, debounceMs)
  }

  const resolveDraftRow = async (
    rowId: string,
  ): Promise<{
    documentKey: string
    documentId: string
    draftId: string
    title: string
    ext: string
    canEdit: boolean
    revoked?: boolean
    snapshot: Uint8Array
  } | null> => {
    const parsed = parseDraftRowId(rowId)
    const facts = await deps.getFacts()
    const match = (facts.drafts ?? []).find(
      (d) =>
        (d.id ?? `draft:${d.documentKey}:${d.draft.id}`) === rowId ||
        d.draft.id === rowId ||
        (parsed && d.documentKey === parsed.documentKey && d.draft.id === parsed.draftId),
    )
    const documentKey = match?.documentKey ?? parsed?.documentKey
    const draftId = match?.draft.id ?? parsed?.draftId
    if (!documentKey || !draftId) return null

    const draftStore = await deps.drafts()
    if (!draftStore) return null
    const list = await draftStore.list(documentKey)
    const found = list.find((item) => item.id === draftId)
    if (!found) return null

    const extFromTitle = found.title ? extname(found.title).replace(/^\./, '') : ''
    return {
      documentKey,
      documentId: match?.documentId ?? documentKey,
      draftId: found.id,
      title: found.title ?? match?.title ?? documentKey,
      ext: match?.ext || extFromTitle || 'docx',
      canEdit: match?.canEdit ?? true,
      revoked: match?.revoked,
      snapshot: found.snapshot,
    }
  }

  /**
   * "Bỏ nháp…" on a blocked intent row (access or document lost): the intent is
   * cancelled and its snapshot dropped. Only the reasons the spine gives that
   * action to; a block never discards anything by itself.
   */
  const discardBlockedIntent = async (rowId: string): Promise<SyncCenterActionResult> => {
    const entry = await deps.findDoc(rowId)
    if (!entry) return { ok: false, code: 'not_found' }
    if (entry.doc.record.state !== 'blocked') return { ok: false, code: 'busy' }
    const facts = await deps.getFacts()
    const fact = (facts.intents ?? []).find(
      (item) => item.record.intentId === entry.doc.record.intentId,
    )
    const reason = mapBlockedReason(entry.doc.record.lastError, fact?.blockedReason)
    if (!isDiscardableBlockedReason(reason)) return { ok: false, code: 'busy' }
    const dispatcher = await deps.dispatcher()
    if (!dispatcher) return { ok: false, code: 'other' }
    const prevRecord: IntentRecordV2 = { ...entry.doc.record }
    const state = await dispatcher.abandonBlocked(entry.doc, deps.now?.() ?? Date.now())
    if (state !== 'cancelled') {
      entry.doc.record = prevRecord
      return { ok: false, code: 'busy' }
    }
    notifyChanged()
    return { ok: true }
  }

  return {
    getSnapshot,

    async syncNow(): Promise<SyncCenterActionResult> {
      // a feed stopped on refused resyncs is only restarted by this click, so it is never
      // refused as offline up front: the pass really tries, and a device that is truly
      // offline fails it and gets the normal offline answer below
      const retryingFeed = deps.isResyncFailed()
      if (!retryingFeed && !deps.isOnline()) return { ok: false, code: 'offline' }
      try {
        if (retryingFeed) await deps.resetFeedResync()
        await deps.syncNow()
        notifyChanged()
        if (retryingFeed && !deps.isOnline()) return { ok: false, code: 'offline' }
        return { ok: true }
      } catch {
        return { ok: false, code: 'other' }
      }
    },

    async setSendingPaused(paused: boolean): Promise<SyncCenterActionResult> {
      try {
        if (deps.setSendingPaused) {
          const ok = await deps.setSendingPaused(paused)
          if (!ok) return { ok: false, code: 'other' }
          notifyChanged()
          return { ok: true }
        }
        const dispatcher = await deps.dispatcher()
        if (!dispatcher) return { ok: false, code: 'other' }
        if (paused) {
          await dispatcher.pause()
        } else {
          const docs = await deps.listQueueDocs()
          await dispatcher.resume(docs, deps.now?.() ?? Date.now())
        }
        notifyChanged()
        return { ok: true }
      } catch {
        return { ok: false, code: 'other' }
      }
    },

    async sendNow(rowId: string): Promise<SyncCenterActionResult> {
      if (typeof rowId !== 'string' || !rowId) return { ok: false, code: 'not_found' }
      const entry = await deps.findDoc(rowId)
      if (!entry) return { ok: false, code: 'not_found' }
      if (!deps.isOnline()) return { ok: false, code: 'offline' }
      const dispatcher = await deps.dispatcher()
      if (!dispatcher) return { ok: false, code: 'other' }

      const now = deps.now?.() ?? Date.now()
      // Allow immediate send even if parked in paused_user or waiting for retryAt backoff
      if (entry.doc.record.state === 'paused_user') {
        entry.doc.record = {
          ...entry.doc.record,
          state: 'queued',
          updatedAt: new Date(now).toISOString(),
        }
      }
      if (entry.doc.record.retryAt !== undefined) {
        const next = { ...entry.doc.record }
        delete next.retryAt
        entry.doc.record = next
      }
      await dispatcher.dispatchAll([entry.doc], now)
      notifyChanged()
      return { ok: true }
    },

    async cancelSave(rowId: string): Promise<SyncCenterActionResult> {
      if (typeof rowId !== 'string' || !rowId) return { ok: false, code: 'not_found' }
      const entry = await deps.findDoc(rowId)
      if (!entry) return { ok: false, code: 'not_found' }
      // Safe cancel: an open window holds the work (the intent's snapshot or newer), so
      // nothing is kept and its chip goes back to unsaved; a closed document's snapshot
      // becomes a kept draft. Either way no typed work is lost.
      const documentClosed = entry.openWindowHasNewer !== true
      const result = await deps.cancelSave(entry, documentClosed)
      if (result.ok) notifyChanged()
      return result
    },

    async recheck(rowId: string): Promise<SyncCenterActionResult> {
      if (typeof rowId !== 'string' || !rowId) return { ok: false, code: 'not_found' }
      const entry = await deps.findDoc(rowId)
      if (!entry) return { ok: false, code: 'not_found' }
      if (!deps.isOnline()) return { ok: false, code: 'offline' }
      const dispatcher = await deps.dispatcher()
      if (!dispatcher) return { ok: false, code: 'other' }

      // a BLOCKED row is re-checked by the ACCESS re-probe, never by the commit
      // lookup: only the condition itself - the document, or the org lane's
      // capability - may lift the block, and a condition that still stands
      // leaves the record exactly where it was (no attempt, no new key). The
      // lookup stays the reconciling rows' action.
      if (entry.doc.record.state === 'blocked') {
        if (!(await deps.recheckBlocked(entry.doc))) return { ok: false, code: 'other' }
        notifyChanged()
        return { ok: true }
      }

      const now = deps.now?.() ?? Date.now()
      await dispatcher.recheck(entry.doc, now)
      notifyChanged()
      return { ok: true }
    },

    async copySupportCode(rowId: string): Promise<SyncCenterActionResult> {
      if (typeof rowId !== 'string' || !rowId) return { ok: false, code: 'not_found' }
      const entry = await deps.findDoc(rowId)
      if (!entry) return { ok: false, code: 'not_found' }
      // only the stuck row offers this action
      if (entry.doc.record.state !== 'reconciling-stuck') return { ok: false, code: 'busy' }
      const code = entry.supportCode ?? formatSupportCode(entry.doc.record)
      deps.writeClipboard(code)
      return { ok: true }
    },

    async discardSave(rowId: string): Promise<SyncCenterActionResult> {
      if (typeof rowId !== 'string' || !rowId) return { ok: false, code: 'not_found' }
      const entry = await deps.findDoc(rowId)
      if (!entry) return { ok: false, code: 'not_found' }
      if (entry.doc.record.state !== 'reconciling-stuck') {
        return { ok: false, code: 'busy' }
      }
      const dispatcher = await deps.dispatcher()
      if (!dispatcher) return { ok: false, code: 'other' }

      const now = deps.now?.() ?? Date.now()
      const prevRecord: IntentRecordV2 = { ...entry.doc.record }
      const nextState = await dispatcher.discard(entry.doc, {
        title: entry.title,
        now,
      })

      if (nextState === 'cancelled') {
        notifyChanged()
        return { ok: true }
      }

      const refusalError = entry.doc.record.lastError
      // Leave intent untouched in memory and on disk when draft_cap or store_full refuses
      entry.doc.record = prevRecord
      if (refusalError === 'drafts_full') return { ok: false, code: 'draft_cap' }
      if (refusalError === 'store_full') return { ok: false, code: 'store_full' }
      return { ok: false, code: 'other' }
    },

    async openDocument(rowId: string): Promise<SyncCenterActionResult> {
      if (typeof rowId !== 'string' || !rowId) return { ok: false, code: 'not_found' }
      const entry = await deps.findDoc(rowId)
      if (entry) {
        const opened = await deps.openDocument(entry.doc.record.documentId, entry.doc.path)
        return opened ? { ok: true } : { ok: false, code: 'other' }
      }
      const facts = await deps.getFacts()
      const row = [...(facts.intents ?? []), ...(facts.recentCommits ?? [])].find(
        (item) => item.id === rowId || item.documentId === rowId || item.documentKey === rowId,
      )
      const docId = row?.documentId ?? row?.documentKey
      if (!docId) return { ok: false, code: 'not_found' }
      const opened = await deps.openDocument(docId)
      return opened ? { ok: true } : { ok: false, code: 'other' }
    },

    async openDraft(rowId: string): Promise<SyncCenterActionResult> {
      if (typeof rowId !== 'string' || !rowId) return { ok: false, code: 'not_found' }
      const resolved = await resolveDraftRow(rowId)
      if (!resolved) return { ok: false, code: 'not_found' }
      if (resolved.revoked) return { ok: false, code: 'other' }
      const opened = await deps.openDraft({
        documentKey: resolved.documentKey,
        draftId: resolved.draftId,
        title: resolved.title,
        ext: resolved.ext,
        snapshot: resolved.snapshot,
        readOnly: true,
      })
      return opened ? { ok: true } : { ok: false, code: 'other' }
    },

    async discardDraft(rowId: string): Promise<SyncCenterActionResult> {
      if (typeof rowId !== 'string' || !rowId) return { ok: false, code: 'not_found' }
      const resolved = await resolveDraftRow(rowId)
      if (!resolved) {
        // a kept-draft row whose draft is gone stays gone: it is never reread as a
        // blocked-intent discard (that would drop a queued save nobody chose to discard)
        if (parseDraftRowId(rowId)) return { ok: false, code: 'not_found' }
        return discardBlockedIntent(rowId)
      }
      const draftStore = await deps.drafts()
      if (!draftStore) return { ok: false, code: 'other' }
      await draftStore.remove(resolved.documentKey, resolved.draftId)
      await deps.draftDiscarded(resolved.documentKey, resolved.draftId).catch(() => undefined)
      notifyChanged()
      return { ok: true }
    },

    async saveAgain(rowId: string): Promise<SyncCenterActionResult> {
      if (typeof rowId !== 'string' || !rowId) return { ok: false, code: 'not_found' }
      const entry = await deps.findDoc(rowId)
      if (!entry) return { ok: false, code: 'not_found' }
      if (entry.doc.record.state !== 'failed') return { ok: false, code: 'busy' }
      const dispatcher = await deps.dispatcher()
      if (!dispatcher) return { ok: false, code: 'other' }

      // the old intent is superseded only together with the durable write of the new one
      // (spine: Superseded); a refusal leaves the old intent, and so the queued save, as it was
      const old = entry.doc.record
      const id = (deps.newId ?? randomUUID)()
      const replaced = await dispatcher.replace(
        entry.doc,
        {
          intentId: `office-intent-${id}`,
          idempotencyKey: `office-key-${id}`,
          documentId: old.documentId,
          orgId: old.orgId,
          workspaceId: old.workspaceId,
          baseRevision: old.baseRevision,
          baseVersion: old.baseVersion,
          checksum: old.checksum,
          length: old.length,
        },
        deps.now?.() ?? Date.now(),
      )
      if (replaced.kind === 'busy') return { ok: false, code: 'busy' }
      if (replaced.kind === 'refused') {
        return { ok: false, code: replaced.reason === 'store_full' ? 'store_full' : 'other' }
      }
      notifyChanged()
      return { ok: true }
    },

    async saveMyCopy(rowId: string): Promise<SyncCenterActionResult> {
      if (typeof rowId !== 'string' || !rowId) return { ok: false, code: 'not_found' }
      const entry = await deps.findDoc(rowId)
      if (entry) {
        if (!entry.canEdit) return { ok: false, code: 'other' }
        const defaultFilename = buildMyCopyDefaultFilename(entry.title, entry.ext)
        const targetPath = await deps.pickSaveCopyPath({
          defaultFilename,
          title: entry.title,
          ext: entry.ext,
        })
        if (!targetPath) return { ok: true }
        try {
          await deps.writeCopyFile(targetPath, entry.doc.payload, {
            defaultFilename,
            title: entry.title,
            ext: entry.ext,
          })
          return { ok: true }
        } catch {
          return { ok: false, code: 'other' }
        }
      }

      const draft = await resolveDraftRow(rowId)
      if (!draft) return { ok: false, code: 'not_found' }
      if (!draft.canEdit || draft.revoked) return { ok: false, code: 'other' }
      const defaultFilename = buildMyCopyDefaultFilename(draft.title, draft.ext)
      const targetPath = await deps.pickSaveCopyPath({
        defaultFilename,
        title: draft.title,
        ext: draft.ext,
      })
      if (!targetPath) return { ok: true }
      try {
        await deps.writeCopyFile(targetPath, draft.snapshot, {
          defaultFilename,
          title: draft.title,
          ext: draft.ext,
        })
        return { ok: true }
      } catch {
        return { ok: false, code: 'other' }
      }
    },

    async retryStore(): Promise<SyncCenterActionResult> {
      try {
        const ok = await deps.retryStore()
        notifyChanged()
        return ok ? { ok: true } : { ok: false, code: 'other' }
      } catch {
        return { ok: false, code: 'other' }
      }
    },

    subscribe(cb: (snapshot: SyncCenterSnapshot) => void): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },

    notifyChanged,
  }
}

export interface IpcMainLike {
  handle(channel: string, listener: (_event: unknown, ...args: unknown[]) => unknown): void
}

/**
 * Register all Sync Center IPC handlers on `ipcMain` and forward debounced
 * snapshot changes via `sendChanged`.
 */
export function registerSyncCenterIpc(
  ipcMain: IpcMainLike,
  controller: SyncCenterController,
  options: { sendChanged?: (snapshot: SyncCenterSnapshot) => void } = {},
): () => void {
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.snapshot, () => controller.getSnapshot())
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.syncNow, () => controller.syncNow())
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.setSendingPaused, (_event, paused: unknown) =>
    controller.setSendingPaused(paused === true),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.sendNow, (_event, rowId: unknown) =>
    controller.sendNow(typeof rowId === 'string' ? rowId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.cancelSave, (_event, rowId: unknown) =>
    controller.cancelSave(typeof rowId === 'string' ? rowId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.recheck, (_event, rowId: unknown) =>
    controller.recheck(typeof rowId === 'string' ? rowId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.copySupportCode, (_event, rowId: unknown) =>
    controller.copySupportCode(typeof rowId === 'string' ? rowId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.discardSave, (_event, rowId: unknown) =>
    controller.discardSave(typeof rowId === 'string' ? rowId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.openDocument, (_event, rowId: unknown) =>
    controller.openDocument(typeof rowId === 'string' ? rowId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.openDraft, (_event, rowId: unknown) =>
    controller.openDraft(typeof rowId === 'string' ? rowId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.discardDraft, (_event, rowId: unknown) =>
    controller.discardDraft(typeof rowId === 'string' ? rowId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.saveAgain, (_event, rowId: unknown) =>
    controller.saveAgain(typeof rowId === 'string' ? rowId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.saveMyCopy, (_event, rowId: unknown) =>
    controller.saveMyCopy(typeof rowId === 'string' ? rowId : ''),
  )
  ipcMain.handle(UNIWORK_SYNC_CENTER_CHANNELS.retryStore, () => controller.retryStore())

  if (options.sendChanged) {
    return controller.subscribe(options.sendChanged)
  }
  return () => undefined
}

/** the S11 lock reason of a store written by a newer app (header priority 1) */
const STORE_NEWER: UniworkLockReason = 'store_newer'

/**
 * A kept draft opened read-only is closed again, by the user, before its preview is
 * swept: a preview whose window is gone for this long is deleted (the shell has no
 * close event for a path, so the sweep reads `isPathOpen` on every poll and change).
 */
export const DRAFT_PREVIEW_CLOSE_GRACE_MS = 30_000

/** the preview root name and its path test live in electron-utils (docs/slides guard their own recents with them) */
export { DRAFT_PREVIEW_DIR, isDraftPreviewPath }

/** the feed runtime's verdict of its last pass (header conditions 7 and 9) */
export interface SyncFeedVerdict {
  /** a consumer of the last pass rebuilt from a full resync */
  resynced: boolean
  /** a consumer's full resync was refused past the retry cap */
  resyncFailed: boolean
}

export interface WiredSyncCenterService {
  readonly store: BindingStore
  currentLocks(): ReadonlyArray<{ reason: UniworkLockReason }>
  syncCenterEngine(): Promise<
    | {
        kind: 'ok'
        dispatcher: QueueDispatcher
        intents: IntentStore
        drafts: DraftStore
        pause: PauseStore
      }
    | { kind: 'keystore_locked' }
    | { kind: 'unavailable' }
  >
  openSyncStore(): Promise<{ kind: string }>
  pollSaveQueue(): Promise<void>
  pauseSending(): Promise<void>
  resumeSending(): Promise<void>
  /** the save pill's "Hủy lần lưu": `closed` = no tab holds it (its snapshot is kept) */
  cancelSave(path: string, closed: boolean): Promise<void>
  /**
   * "Kiểm tra lại" on a blocked row: the access re-probe of F1 for that one
   * intent, now; `false` when the live session's queue cannot be reached.
   */
  recheckBlockedSave(path: string): Promise<boolean>
  openDocument(documentId: string): Promise<{ ok: boolean }>
}

export interface WiredSyncCenterDeps {
  ipcMain: IpcMainLike
  userDataDir: string
  service: WiredSyncCenterService
  store: { layer: StoreLayer; access: SyncStoreAccess }
  accountStatus(): AccountStatus
  capabilityRead(orgId: string): Promise<{
    kind: string
    capabilities: { sync_write: boolean; sync_feed?: boolean; offline_library?: boolean }
  }>
  /** the feed runtime's last pass verdict (resynced / resync refused past the cap) */
  feedVerdict(): SyncFeedVerdict
  /** the runtime forgets its feeds' refused resyncs and backoff (the retry of header 7) */
  resetFeedResync(): Promise<void>
  /**
   * G5-08c: the lease manager's effective state of a document (RES-3). Only its
   * `expired` and `clock_rollback` states are read, as a blocked row's reason.
   */
  leaseState?(documentId: string): Promise<{ state: string }>
  tickRuntime(): Promise<void>
  openPath(path: string): boolean
  isPathOpen(path: string): boolean
  defaultSaveDir(): string
  writeClipboard(text: string): void
  pickSaveDialog(options: {
    defaultPath: string
    ext: UniworkDocFormat | string
  }): Promise<string | null>
  pushChanged(snapshot: SyncCenterSnapshot): void
  /** test seam: the clock of the preview sweep */
  now?(): number
}

export interface WiredSyncCenter {
  controller: SyncCenterController
  /** the runtime's poll verdict (`undefined` = the pass had nothing to do) */
  notePoll(online: boolean | undefined): Promise<void>
  /**
   * An account status push. Crossing an account boundary (sign-out, another account)
   * deletes every read-only draft preview of the outgoing session.
   */
  noteAccount(): Promise<void>
  /** deletes the previews no window shows any more (also run by every poll) */
  sweepPreviews(): Promise<void>
}

/**
 * Production bridge used by `uniwork-docs/wiring.ts` to bind the live
 * `UniworkDocsService`, `SyncRuntime`, and `StoreLayer` to `registerSyncCenterIpc`.
 */
export function createWiredSyncCenter(deps: WiredSyncCenterDeps): WiredSyncCenter {
  // online until the first poll says otherwise (a pass that attempted nothing has no verdict)
  let online = true
  let lastSyncAt: string | undefined
  const now = () => deps.now?.() ?? Date.now()

  /*
   * "Mở nháp" (read-only): the editors only open files, so a kept draft is shown through a
   * decrypted temp copy. It lives under a directory of THIS app session, and is deleted on
   * draft discard, once its window is closed (sweep), at an account boundary, and at the
   * next startup (the whole preview root is removed when the sync center is built).
   */
  const previewRoot = join(deps.userDataDir, DRAFT_PREVIEW_DIR)
  let previewSession = randomUUID()
  const previews = new Map<string, { dir: string; path: string; openedAt: number }>()
  const removeDir = (dir: string) =>
    rm(dir, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined)
  // startup sweep: a crash or a power cut left the previous session's previews behind
  const startupSweep = removeDir(previewRoot)
  let lastAccount: string | undefined

  const dropPreview = async (draftId: string): Promise<void> => {
    const found = previews.get(draftId)
    if (!found) return
    previews.delete(draftId)
    await removeDir(found.dir)
  }

  const sweepPreviews = async (): Promise<void> => {
    const at = now()
    for (const [draftId, preview] of [...previews]) {
      if (deps.isPathOpen(preview.path)) continue
      if (at - preview.openedAt < DRAFT_PREVIEW_CLOSE_GRACE_MS) continue
      await dropPreview(draftId)
    }
  }

  const dropAllPreviews = async (): Promise<void> => {
    previews.clear()
    const session = previewSession
    previewSession = randomUUID()
    await removeDir(join(previewRoot, session))
  }

  const readSessionDocs = async () => {
    const scope = deps.store.access.scope()
    if (!scope) return { engine: null, dirs: [] as string[], scope: null }
    const engine = await deps.service.syncCenterEngine()
    if (engine.kind !== 'ok') return { engine, dirs: [] as string[], scope }
    const dirs = scopeWorkingCopyDirs(deps.service.store.root, scope)
    return { engine, dirs, scope }
  }

  /*
   * RES-3: the reason of a blocked intent the queue filed without a known cause, from the
   * G5-08c lease state (expired / clock rollback). It only names the cause of a row the
   * queue already blocked: a lease never blocks, unblocks or re-states a row here (UNI-1645).
   */
  const leaseBlockedReason = async (
    documentId: string,
  ): Promise<SyncCenterBlockedReason | undefined> => {
    const lease = await deps.leaseState?.(documentId).catch(() => null)
    if (lease?.state === 'expired') return 'lease_expired'
    if (lease?.state === 'clock_rollback') return 'clock_rollback'
    return undefined
  }

  const controller = createSyncCenterController({
    isOnline: () => online,
    isResyncFailed: () => deps.feedVerdict().resyncFailed,
    resetFeedResync: () => deps.resetFeedResync(),
    getFacts: async (): Promise<SyncCenterFacts> => {
      const status = deps.accountStatus()
      const storeNewer = deps.service.currentLocks().some((lock) => lock.reason === STORE_NEWER)
      const sessionState: SyncCenterFacts['sessionState'] =
        status.state === 'session-expired'
          ? 'session_expired'
          : status.state === 'signed-in'
            ? 'signed_in'
            : 'signed_out'

      const account = accountInfoOf(status)
      const org = status.org ? { id: status.org.id, name: status.org.name } : undefined

      if (sessionState === 'signed_out') {
        const lastOwner = deps.service.store.readLastOwner()
        let lockedCount = 0
        if (lastOwner) {
          for (const dir of scopeWorkingCopyDirs(deps.service.store.root, lastOwner)) {
            const b = await deps.service.store.readDir(dir)
            if (b && b.state !== 'ready' && b.state !== 'saved') lockedCount += 1
          }
        }
        return {
          storeNewer,
          sessionState,
          online,
          paused: false,
          adminPaused: false,
          signedOutLockedCount: lockedCount,
        }
      }

      const feed = deps.feedVerdict()
      const feedFacts = {
        ...(feed.resyncFailed ? { resyncFailed: true } : {}),
        ...(feed.resynced ? { resynced: true } : {}),
      }
      const { engine, dirs, scope } = await readSessionDocs()
      if (!engine || engine.kind !== 'ok') {
        return {
          storeNewer,
          sessionState,
          online,
          paused: false,
          adminPaused: false,
          ...feedFacts,
          ...(lastSyncAt ? { lastSyncAt } : {}),
          ...(account ? { account } : {}),
          ...(org ? { org } : {}),
          storeError: engine?.kind === 'keystore_locked',
        }
      }

      const paused = await engine.pause.isPaused()
      const usage = scope ? await deps.store.layer.usage(scope).catch(() => null) : null
      const cap = org?.id ? await deps.capabilityRead(org.id).catch(() => null) : null
      const adminPaused = cap ? cap.capabilities.sync_write === false : false
      const feedOff = cap ? cap.capabilities.sync_feed === false : false
      const offlineLibrary = cap ? cap.capabilities.offline_library !== false : undefined

      const intents: SyncCenterIntentFact[] = []
      const drafts: SyncCenterDraftFact[] = []
      const recentCommits: SyncCenterRecentFact[] = []

      for (const dir of dirs) {
        const binding = await deps.service.store.readDir(dir)
        if (!binding) continue
        const key = basename(dir)
        const canEdit = bindingCanEdit(binding)
        const revoked =
          binding.state === 'blocked' &&
          (binding.error === 'permission_revoked' || binding.error === 'forbidden')

        const stored = await engine.intents.read(key, {
          orgId: binding.orgId,
          workspaceId: binding.workspaceId,
          baseVersion: binding.baseVersion,
          length: 0,
        })
        if (stored) {
          const leaseReason =
            stored.intent.state === 'blocked' && !mapBlockedReason(stored.intent.lastError)
              ? await leaseBlockedReason(binding.documentId)
              : undefined
          const maxBytes = stored.intent.maxBytes ?? binding.maxBytes
          intents.push({
            id: stored.intent.intentId,
            documentKey: key,
            documentId: binding.documentId,
            orgId: stored.intent.orgId || binding.orgId,
            workspaceId: stored.intent.workspaceId || binding.workspaceId,
            title: binding.title,
            ext: binding.format,
            record: stored.intent,
            canEdit,
            ...(typeof maxBytes === 'number' && maxBytes > 0 ? { maxBytes } : {}),
            ...(leaseReason ? { blockedReason: leaseReason } : {}),
            ...(binding.serverVersion !== undefined
              ? { conflict: { version: binding.serverVersion } }
              : {}),
          })
        } else if (binding.state === 'failed') {
          const stamp = binding.lastSavedAt ?? new Date(now()).toISOString()
          intents.push({
            id: `failed:${key}`,
            documentKey: key,
            documentId: binding.documentId,
            orgId: binding.orgId,
            workspaceId: binding.workspaceId,
            title: binding.title,
            ext: binding.format,
            record: {
              v: 2,
              intentId: `failed:${key}`,
              idempotencyKey: `failed:${key}`,
              documentId: binding.documentId,
              orgId: binding.orgId,
              workspaceId: binding.workspaceId,
              baseRevision: binding.baseRevision,
              baseVersion: binding.baseVersion,
              checksum: binding.baseChecksum,
              length: binding.sizeBytes ?? 0,
              generation: 1,
              state: 'failed',
              attempt: 0,
              createdAt: stamp,
              updatedAt: stamp,
              ...(binding.error ? { lastError: binding.error } : {}),
              ...(binding.maxBytes ? { maxBytes: binding.maxBytes } : {}),
            },
            canEdit,
            ...(binding.maxBytes ? { maxBytes: binding.maxBytes } : {}),
          })
        } else if (binding.state === 'saved' && binding.lastSavedAt) {
          recentCommits.push({
            id: `committed:${key}`,
            documentKey: key,
            documentId: binding.documentId,
            orgId: binding.orgId,
            title: binding.title,
            ext: binding.format,
            savedAt: binding.lastSavedAt,
            base: binding.baseVersion,
            committedVersion: binding.baseVersion,
            canEdit,
          })
        }

        const docDrafts = await engine.drafts.list(key)
        for (const draft of docDrafts) {
          drafts.push({
            id: `draft:${key}:${draft.id}`,
            documentKey: key,
            documentId: binding.documentId,
            orgId: binding.orgId,
            title: draft.title ?? binding.title,
            ext: binding.format,
            draft,
            canEdit,
            revoked,
          })
        }
      }

      return {
        storeNewer,
        sessionState,
        online,
        paused,
        adminPaused,
        feedOff,
        ...feedFacts,
        ...(offlineLibrary === undefined ? {} : { offlineLibrary }),
        ...(lastSyncAt ? { lastSyncAt } : {}),
        ...(account ? { account } : {}),
        ...(org ? { org } : {}),
        ...(usage ? { storeBudget: { used: usage.bytes, cap: usage.budgetBytes } } : {}),
        intents,
        drafts,
        recentCommits,
      }
    },

    findDoc: async (rowId) => {
      const { engine, dirs } = await readSessionDocs()
      if (!engine || engine.kind !== 'ok') return null
      for (const dir of dirs) {
        const binding = await deps.service.store.readDir(dir)
        if (!binding) continue
        const key = basename(dir)
        const stored = await engine.intents.read(key, {
          orgId: binding.orgId,
          workspaceId: binding.workspaceId,
          baseVersion: binding.baseVersion,
          length: 0,
        })
        if (!stored || isTerminalQueueState(stored.intent.state)) continue
        if (stored.intent.intentId === rowId || key === rowId || binding.documentId === rowId) {
          const path = join(dir, binding.filename)
          return {
            doc: {
              key,
              path,
              filename: binding.filename,
              format: binding.format,
              orgId: stored.intent.orgId || binding.orgId,
              workspaceId: stored.intent.workspaceId || binding.workspaceId,
              baseVersion: stored.intent.baseVersion || binding.baseVersion,
              record: stored.intent,
              payload: stored.payload,
            },
            title: binding.title,
            ext: binding.format,
            canEdit: bindingCanEdit(binding),
            // an open window holds the working copy the intent was snapshotted from, or a
            // newer one: a cancel keeps that work in the window instead of minting a draft
            openWindowHasNewer: deps.isPathOpen(path),
          }
        }
      }
      return null
    },

    cancelSave: async (entry, documentClosed) => {
      const { doc } = entry
      await deps.service.cancelSave(doc.path, documentClosed)
      const engine = await deps.service.syncCenterEngine()
      if (engine.kind !== 'ok') return { ok: false, code: 'other' }
      const stored = await engine.intents.read(doc.key, {
        orgId: doc.orgId,
        workspaceId: doc.workspaceId,
        baseVersion: doc.baseVersion,
        length: 0,
      })
      if (
        !stored ||
        stored.intent.intentId !== doc.record.intentId ||
        isTerminalQueueState(stored.intent.state)
      ) {
        return { ok: true }
      }
      // refused: the stored intent is exactly as it was. The service reports no reason, so
      // it is read back from the facts the dispatcher's refusal depends on
      if (!CANCELLABLE.has(stored.intent.state) || !documentClosed) {
        return { ok: false, code: 'busy' }
      }
      const kept = await engine.drafts.list(doc.key)
      if (kept.length >= QUEUE_LIMITS.draftsPerDocument) return cancelRefusalCode('drafts_full')
      const scope = deps.store.access.scope()
      const usage = scope ? await deps.store.layer.usage(scope).catch(() => null) : null
      if (usage && usage.bytes + doc.payload.byteLength > usage.budgetBytes) {
        return cancelRefusalCode('store_full')
      }
      return cancelRefusalCode('keystore_locked')
    },

    draftDiscarded: (_documentKey, draftId) => dropPreview(draftId),

    dispatcher: async () => {
      const engine = await deps.service.syncCenterEngine()
      return engine.kind === 'ok' ? engine.dispatcher : null
    },

    recheckBlocked: (doc) => deps.service.recheckBlockedSave(doc.path),

    drafts: async () => {
      const engine = await deps.service.syncCenterEngine()
      return engine.kind === 'ok' ? engine.drafts : null
    },

    listQueueDocs: async () => {
      const { engine, dirs } = await readSessionDocs()
      if (!engine || engine.kind !== 'ok') return []
      const docs: QueueDoc[] = []
      for (const dir of dirs) {
        const binding = await deps.service.store.readDir(dir)
        if (!binding) continue
        const key = basename(dir)
        const stored = await engine.intents.read(key, {
          orgId: binding.orgId,
          workspaceId: binding.workspaceId,
          baseVersion: binding.baseVersion,
          length: 0,
        })
        if (!stored || isTerminalQueueState(stored.intent.state)) continue
        docs.push({
          key,
          path: join(dir, binding.filename),
          filename: binding.filename,
          format: binding.format,
          orgId: stored.intent.orgId || binding.orgId,
          workspaceId: stored.intent.workspaceId || binding.workspaceId,
          baseVersion: stored.intent.baseVersion || binding.baseVersion,
          record: stored.intent,
          payload: stored.payload,
        })
      }
      return docs
    },

    syncNow: async () => {
      await deps.tickRuntime()
      await deps.service.pollSaveQueue()
      // the pass's own verdict may have gone offline: no "synced" time for a pass that failed
      if (online) lastSyncAt = new Date(now()).toISOString()
    },

    setSendingPaused: async (paused) => {
      if (paused) await deps.service.pauseSending()
      else await deps.service.resumeSending()
      return true
    },

    writeClipboard: (text) => deps.writeClipboard(text),

    openDocument: async (documentId, path) => {
      if (path && deps.service.store.exists(path)) {
        return deps.openPath(path)
      }
      const res = await deps.service.openDocument(documentId)
      return res.ok
    },

    openDraft: async ({ draftId, title, ext, snapshot }) => {
      await startupSweep
      const shown = previews.get(draftId)
      // already open: show that window again rather than writing a second copy
      if (shown && deps.isPathOpen(shown.path)) return deps.openPath(shown.path)
      await dropPreview(draftId)
      const dir = join(previewRoot, previewSession, draftId)
      await mkdir(dir, { recursive: true })
      const safeStem = (title.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'draft').slice(0, 120)
      const filePath = join(dir, `${safeStem}.${ext}`)
      previews.set(draftId, { dir, path: filePath, openedAt: now() })
      await writeFile(filePath, snapshot)
      await chmod(filePath, 0o444).catch(() => undefined)
      return deps.openPath(filePath)
    },

    pickSaveCopyPath: ({ defaultFilename, ext }) =>
      deps.pickSaveDialog({
        defaultPath: join(deps.defaultSaveDir(), defaultFilename),
        ext,
      }),

    writeCopyFile: async (targetPath, bytes) => {
      await writeFile(targetPath, bytes)
    },

    retryStore: async () => {
      const open = await deps.service.openSyncStore()
      return open.kind === 'ok'
    },
  })

  registerSyncCenterIpc(deps.ipcMain, controller, {
    sendChanged: (snap) => deps.pushChanged(snap),
  })

  return {
    controller,
    async notePoll(nextOnline) {
      if (nextOnline !== undefined) {
        online = nextOnline
        if (nextOnline) lastSyncAt = new Date(now()).toISOString()
      }
      controller.notifyChanged()
      await sweepPreviews()
    },
    async noteAccount() {
      const scope = deps.store.access.scope()
      const account = scope ? `${scope.deploymentId}/${scope.accountId}` : ''
      controller.notifyChanged()
      if (account === lastAccount) return
      lastAccount = account
      await dropAllPreviews()
    },
    sweepPreviews,
  }
}
