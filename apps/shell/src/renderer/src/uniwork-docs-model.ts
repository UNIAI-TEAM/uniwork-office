import type {
  RecentEntry,
  UniworkDocErrorCode,
  UniworkDocListPage,
  UniworkDocStatus,
  UniworkDocSummary,
  UniworkLaunchEvent,
  UniworkResult,
  UniworkSaveState,
  UniworkWorkspaceRef,
} from '../../shared/home-api'
import { pathKey } from '../../shared/path-key'
import type { AccountView } from './account-model'
import type { StringKey, TFunc } from './locale'

/**
 * View models for the UniWork document UI: what the Home card, the picker
 * dialog, the tab-strip status chip and the launch notice show for a given
 * state. Pure (no React, no window) so the mapping is unit-tested.
 */

// ── Copy per code / state ───────────────────────────────

/** user-facing sentence for every error the main process can report */
export const UNIWORK_ERROR_KEYS: Record<UniworkDocErrorCode, StringKey> = {
  not_signed_in: 'uwErrNotSignedIn',
  session_expired: 'uwErrSessionExpired',
  wrong_deployment: 'uwErrWrongDeployment',
  forbidden: 'uwErrForbidden',
  not_found: 'uwErrNotFound',
  deleted: 'uwErrDeleted',
  conflict: 'uwErrConflict',
  quota_exceeded: 'uwErrQuotaExceeded',
  too_large: 'uwErrTooLarge',
  unsupported_format: 'uwErrUnsupportedFormat',
  engine_incompatible: 'uwErrEngineIncompatible',
  idempotency_mismatch: 'uwErrIdempotencyMismatch',
  ticket_invalid: 'uwErrTicketInvalid',
  ticket_expired: 'uwErrTicketExpired',
  network: 'uwErrNetwork',
  timeout: 'uwErrTimeout',
  server_error: 'uwErrServerError',
  malformed_response: 'uwErrMalformedResponse',
  // refusals before anything is queued: the keychain is locked, or the account's store is full
  keystore_locked: 'uwReasonKeystore',
  store_full: 'uwQueueFull',
  // G5-06 save queue (EXPERIENCE l.144-171 blocked reasons, l.223 / l.230 / l.129 / l.304-321).
  // The sentence for a refusal or a lock; a {cap} / {time} in it is filled by the caller.
  capability_off: 'uwTipPausedAdmin',
  intent_unknown: 'uwChipReconcileStuck',
  document_deleted: 'uwErrDeleted',
  permission_revoked: 'uwErrForbidden',
  member_deactivated: 'uwLockDeactivated',
  organization_suspended: 'uwLockSuspended',
  drafts_full: 'uwConflictDraftCapReached',
  other_window: 'uwLockOtherWindow',
}

/** chip label for every save state (ready and saved read the same: nothing is waiting to upload) */
export const UNIWORK_STATE_KEYS: Record<UniworkSaveState, StringKey> = {
  ready: 'uwChipSaved',
  saved: 'uwChipSaved',
  dirty: 'uwChipDirty',
  saving: 'uwChipSaving',
  offline: 'uwChipOffline',
  'signed-out': 'uwChipSignedOut',
  conflict: 'uwChipConflict',
  blocked: 'uwChipBlocked',
  error: 'uwChipError',
  // G5-06 durable save queue: queued / paused_offline / paused_user read as "queued" (EXPERIENCE
  // l.185-187; pendingNext picks uwChipQueuedNewer in chipModelOf), the rest have their own label
  queued: 'uwChipQueued',
  paused_offline: 'uwChipQueued',
  paused_user: 'uwChipQueued',
  paused_admin: 'uwChipPausedAdmin',
  reconciling: 'uwChipReconciling',
  'reconciling-stuck': 'uwChipReconcileStuck',
  failed: 'uwChipError',
}

/**
 * A reason the document layer reports beyond the HTTP-level codes: the keychain
 * holding the sync store's key is locked (session state `keystore-locked`).
 * Deferred (G504-fe-2): the document status badge for it (`uwBadgeKeystore`, and
 * `uwBadgeBlocked` for store_full, EXPERIENCE l.212) goes with the S4 queue rows;
 * the tab chip reads `blockedReasonKey`, the account entry already shows the badge.
 */
export type UniworkLockReason = 'keystore_locked'

/** short reason shown after "Blocked:" */
export function blockedReasonKey(
  error: UniworkDocErrorCode | UniworkLockReason | undefined,
): StringKey {
  switch (error) {
    case 'keystore_locked':
      return 'uwReasonKeystore'
    case 'store_full':
      return 'uwReasonStoreFull'
    case 'forbidden':
    case 'permission_revoked':
      return 'uwReasonForbidden'
    case 'not_found':
      return 'uwReasonNotFound'
    case 'deleted':
    case 'document_deleted':
      return 'uwReasonDeleted'
    case 'organization_suspended':
      return 'uwReasonSuspended'
    case 'member_deactivated':
      return 'uwReasonDeactivated'
    case 'quota_exceeded':
      return 'uwReasonQuota'
    case 'too_large':
      return 'uwReasonTooLarge'
    default:
      return 'uwReasonOther'
  }
}

/**
 * what the person can do about an error: sign in again, try again, or nothing (just read it).
 * Deferred (G504-fe-3): a save refused with keystore_locked / store_full has its own S4 action
 * ("Mở trung tâm đồng bộ" / Retry, EXPERIENCE l.156, l.212) once the sync center and the S4
 * row exist in the shell; the Open dialog and launch notice never see these two codes.
 */
export type ErrorAction = 'sign-in' | 'retry' | 'none'

export function errorActionOf(error: UniworkDocErrorCode): ErrorAction {
  switch (error) {
    case 'not_signed_in':
    case 'session_expired':
      return 'sign-in'
    case 'network':
    case 'timeout':
    case 'server_error':
    case 'malformed_response':
      return 'retry'
    default:
      return 'none'
  }
}

// ── Status chip ─────────────────────────────────────────

export type ChipTone = 'ok' | 'neutral' | 'busy' | 'warn' | 'error'
export type ChipActionKind = 'retry' | 'sign-in' | 'resolve'

export interface ChipModel {
  tone: ChipTone
  labelKey: StringKey
  /** filled into {reason} of the label (blocked) */
  reasonKey?: StringKey
  tipKey: StringKey
  /** the error sentence the tooltip leads with (blocked / error) */
  errorKey?: StringKey
  /** a click on the chip's button */
  action?: { kind: ChipActionKind; labelKey: StringKey }
  /** time filled into the tooltip: the last save, or for the queued states the save waiting to be sent */
  savedAt?: string
}

/** UniWork answered badly, slowly or not at all while the network itself may be fine */
function isServerSideError(error: UniworkDocErrorCode | undefined): boolean {
  return error === 'server_error' || error === 'timeout' || error === 'malformed_response'
}

const QUIET_STATES: ReadonlySet<UniworkSaveState> = new Set(['ready', 'saved', 'dirty', 'saving'])

/**
 * The chip for a bound document. `needsSignIn` is the account state: when the
 * save state is signed-out and the account is signed in again, the way forward
 * is Retry, not another browser sign-in. `queuedAt` is when the waiting save was
 * made (the intent's creation time), filled into the queued tooltips.
 *
 * The queue states carry no action here: "View queue" (EXPERIENCE l.185-190, 195)
 * opens the Queue popover, which belongs to the Save pill component (G5-06u).
 */
export function chipModelOf(
  status: UniworkDocStatus,
  ctx: { needsSignIn: boolean; queuedAt?: string } = { needsSignIn: true },
): ChipModel {
  const { state, access, error } = status
  if (access === 'view' && QUIET_STATES.has(state)) {
    return { tone: 'neutral', labelKey: 'uwChipViewOnly', tipKey: 'uwTipViewOnly' }
  }
  switch (state) {
    case 'ready':
    case 'saved':
      return {
        tone: 'ok',
        labelKey: UNIWORK_STATE_KEYS[state],
        tipKey: status.lastSavedAt ? 'uwTipSavedAt' : 'uwTipSaved',
        savedAt: status.lastSavedAt,
      }
    case 'dirty':
      return { tone: 'neutral', labelKey: 'uwChipDirty', tipKey: 'uwTipDirty' }
    case 'saving':
      return { tone: 'busy', labelKey: 'uwChipSaving', tipKey: 'uwTipSaving' }
    case 'offline': {
      // offline also covers a slow or failing server: only a network error means the
      // computer is offline, so say so only then
      const unreachable = isServerSideError(error)
      return {
        tone: 'warn',
        labelKey: unreachable ? 'uwChipUnreachable' : 'uwChipOffline',
        tipKey: unreachable ? 'uwTipUnreachable' : 'uwTipOffline',
        action: { kind: 'retry', labelKey: 'uwActRetry' },
      }
    }
    case 'signed-out':
      return {
        tone: 'warn',
        labelKey: 'uwChipSignedOut',
        tipKey: 'uwTipSignedOut',
        action: ctx.needsSignIn
          ? { kind: 'sign-in', labelKey: 'acctSignIn' }
          : { kind: 'retry', labelKey: 'uwActRetry' },
      }
    case 'conflict':
      return {
        tone: 'warn',
        labelKey: 'uwChipConflict',
        tipKey: 'uwTipConflict',
        action: { kind: 'resolve', labelKey: 'uwActResolve' },
      }
    case 'blocked':
      return {
        tone: 'error',
        labelKey: 'uwChipBlocked',
        reasonKey: blockedReasonKey(error),
        tipKey: 'uwTipBlocked',
        errorKey: error ? UNIWORK_ERROR_KEYS[error] : undefined,
      }
    case 'error':
      return {
        tone: 'error',
        labelKey: 'uwChipError',
        tipKey: 'uwTipError',
        errorKey: error ? UNIWORK_ERROR_KEYS[error] : undefined,
        action: { kind: 'retry', labelKey: 'uwActRetry' },
      }
    case 'queued':
    case 'paused_offline':
      return {
        tone: 'neutral',
        labelKey: status.pendingNext ? 'uwChipQueuedNewer' : UNIWORK_STATE_KEYS[state],
        tipKey: status.pendingNext ? 'uwTipQueuedNewer' : 'uwTipQueued',
        savedAt: ctx.queuedAt,
      }
    case 'paused_user':
      // same label as queued; the tooltip says why it is not going out (EXPERIENCE l.187)
      return {
        tone: 'neutral',
        labelKey: status.pendingNext ? 'uwChipQueuedNewer' : UNIWORK_STATE_KEYS[state],
        tipKey: 'uwTipPausedUser',
        savedAt: ctx.queuedAt,
      }
    case 'paused_admin':
      return { tone: 'neutral', labelKey: 'uwChipPausedAdmin', tipKey: 'uwTipPausedAdmin' }
    case 'reconciling':
      return { tone: 'warn', labelKey: 'uwChipReconciling', tipKey: 'uwTipReconciling' }
    case 'reconciling-stuck':
      // the tooltip stays the reconciling one (EXPERIENCE l.190)
      return { tone: 'warn', labelKey: 'uwChipReconcileStuck', tipKey: 'uwTipReconciling' }
    case 'failed':
      // no automatic retry; {reason} of the tooltip reuses the quota / too-large / other fragments (l.233)
      return {
        tone: 'error',
        labelKey: 'uwChipError',
        reasonKey: blockedReasonKey(error),
        tipKey: 'uwTipFailed',
      }
  }
}

/**
 * the chip's visible label, its explanation and the hover text, translated. The
 * label truncates in a narrow window, so the hover text always starts with the
 * full label.
 */
export function chipCopy(
  model: ChipModel,
  t: TFunc,
  dateLocale: string,
  now: Date = new Date(),
): { label: string; tip: string; title: string } {
  const label = model.reasonKey
    ? t(model.labelKey, { reason: t(model.reasonKey) })
    : t(model.labelKey)
  const tipParams: Record<string, string> = {}
  if (model.savedAt) tipParams.time = formatWhen(model.savedAt, dateLocale, now)
  if (model.reasonKey) tipParams.reason = t(model.reasonKey)
  const tip = t(model.tipKey, tipParams)
  const fullTip = model.errorKey ? `${t(model.errorKey)} ${tip}` : tip
  return { label, tip: fullTip, title: `${label}\n${fullTip}` }
}

// status of a bound tab is keyed by the shared pathKey, so a path spelled with
// the other slash or case still finds it and main keys its lock map identically
export { pathKey }

// ── Launch notice (open in desktop app / recents failure) ─

export type NoticeTone = 'busy' | 'warn' | 'error'

export interface LaunchNotice {
  tone: NoticeTone
  messageKey: StringKey
  params?: { title: string }
  /** a Sign in button */
  signIn: boolean
  /** hide on its own after this long (failures only; a sign-in prompt stays until acted on) */
  autoHideMs?: number
}

export const LAUNCH_ERROR_HIDE_MS = 12_000

/** null: nothing to show (the document opened) */
export function launchNoticeOf(event: UniworkLaunchEvent): LaunchNotice | null {
  switch (event.phase) {
    case 'opening': {
      const title = event.title?.trim()
      return title
        ? { tone: 'busy', messageKey: 'uwLaunchOpeningTitle', params: { title }, signIn: false }
        : { tone: 'busy', messageKey: 'uwLaunchOpening', signIn: false }
    }
    case 'opened':
      return null
    case 'needs-sign-in':
      return { tone: 'warn', messageKey: 'uwLaunchNeedsSignIn', signIn: true }
    case 'failed':
      return {
        tone: 'error',
        messageKey: UNIWORK_ERROR_KEYS[event.error],
        signIn: errorActionOf(event.error) === 'sign-in',
        autoHideMs: LAUNCH_ERROR_HIDE_MS,
      }
  }
}

// ── Home "Open from UniWork" card ───────────────────────

export type OpenCardAction = 'picker' | 'sign-in' | 'settings' | 'none'

export interface OpenCardModel {
  action: OpenCardAction
  subKey: StringKey
  /** the sub-line asks for attention (sign in, fix settings) */
  attention: boolean
}

/** what the card says and does for the account state (the card is always visible) */
export function openCardOf(view: AccountView): OpenCardModel {
  switch (view) {
    case 'signed-out':
      return { action: 'sign-in', subKey: 'uwOpenCardSubSignIn', attention: true }
    case 'session-expired':
    case 'session-revoked':
      return { action: 'sign-in', subKey: 'uwOpenCardSubExpired', attention: true }
    case 'signing-in':
      return { action: 'none', subKey: 'acctSigningIn', attention: false }
    case 'not-configured':
      return { action: 'settings', subKey: 'uwOpenCardSubSetup', attention: true }
    case 'wrong-deployment':
    case 'keyring-unavailable':
    case 'keystore-locked':
      return { action: 'settings', subKey: 'uwOpenCardSubAttention', attention: true }
    // signed-in, refreshing, server-unreachable (cached session) and the first read:
    // the picker itself reports an unreachable server with a Retry
    default:
      return { action: 'picker', subKey: 'uwOpenCardSub', attention: false }
  }
}

// ── Recents ─────────────────────────────────────────────

export interface RecentRowPolicy {
  /** the UniWork badge replaces the folder location */
  badge: boolean
  /** bulk selection (move / delete files) */
  selectable: boolean
  /** drag onto a folder or project */
  draggable: boolean
  /** Show in folder / Copy path (the working copy's location is the app's business) */
  showLocation: boolean
  /** rename, duplicate, move, delete file: actions on a local file */
  fileActions: boolean
}

/** a UniWork document row is not a local file: nothing that moves, renames or deletes it applies */
export function recentRowPolicy(entry: Pick<RecentEntry, 'uniwork'>): RecentRowPolicy {
  const local = !entry.uniwork
  return {
    badge: !local,
    selectable: local,
    draggable: local,
    showLocation: local,
    fileActions: local,
  }
}

/**
 * Whether the missing-file prompt applies to a recents row. A UniWork row whose
 * working copy has gone (cleaned userData, deleted file) is still openable:
 * opening it downloads the document again.
 */
export function recentRowIsMissing(entry: Pick<RecentEntry, 'missing' | 'uniwork'>): boolean {
  return !!entry.missing && !entry.uniwork
}

/** What a click (or Enter) on a recents row does */
export function recentOpenAction(
  entry: Pick<RecentEntry, 'missing' | 'uniwork'>,
): 'open' | 'confirm-missing' {
  return recentRowIsMissing(entry) ? 'confirm-missing' : 'open'
}

/**
 * The row's Modified time. A UniWork row's file time is when its working copy
 * was downloaded, not when the document changed, so it has none to show.
 */
export function recentRowModifiedMs(
  entry: Pick<RecentEntry, 'mtimeMs' | 'missing' | 'uniwork'>,
): number | null {
  return entry.missing || entry.uniwork ? null : entry.mtimeMs
}

// ── Picker ──────────────────────────────────────────────

export const PICKER_PAGE_SIZE = 50
export const PICKER_SEARCH_DEBOUNCE_MS = 300

export type PickerFetchStatus = 'loading' | 'ready' | 'error'

export interface PickerState {
  workspaces: {
    status: PickerFetchStatus
    items: UniworkWorkspaceRef[]
    error?: UniworkDocErrorCode
  }
  workspaceId: string | null
  /** committed (debounced) search text */
  query: string
  list: {
    status: PickerFetchStatus
    docs: UniworkDocSummary[]
    nextCursor: string | null
    loadingMore: boolean
    /** bumped for every fresh fetch; a late answer for an older id is dropped */
    requestId: number
    error?: UniworkDocErrorCode
    /** a "Load more" that failed keeps the rows; the error shows under them */
    moreError?: UniworkDocErrorCode
  }
  activeId: string | null
  opening: { id: string; title: string } | null
  openError: UniworkDocErrorCode | null
}

export type PickerAction =
  | { type: 'workspaces-retry' }
  | { type: 'workspaces-loaded'; result: UniworkResult<UniworkWorkspaceRef[]> }
  | { type: 'select-workspace'; id: string }
  | { type: 'set-query'; query: string }
  | { type: 'list-retry' }
  | {
      type: 'list-loaded'
      requestId: number
      append: boolean
      result: UniworkResult<UniworkDocListPage>
    }
  | { type: 'load-more' }
  | { type: 'move-active'; to: 'next' | 'prev' | 'first' | 'last' }
  | { type: 'set-active'; id: string }
  | { type: 'open-start'; id: string; title: string }
  | { type: 'open-failed'; error: UniworkDocErrorCode }
  | { type: 'clear-open-error' }

export function initialPickerState(): PickerState {
  return {
    workspaces: { status: 'loading', items: [] },
    workspaceId: null,
    query: '',
    list: { status: 'loading', docs: [], nextCursor: null, loadingMore: false, requestId: 0 },
    activeId: null,
    opening: null,
    openError: null,
  }
}

/** only docx, xlsx, pptx, pdf, md and html open; the server list also holds other file types */
export function isOpenable(doc: UniworkDocSummary): boolean {
  return doc.format !== null
}

/** extension for the file-type icon: the known format, else whatever the title ends in */
export function docExtension(doc: UniworkDocSummary): string {
  if (doc.format) return doc.format
  const dot = doc.title.lastIndexOf('.')
  return dot > 0 ? doc.title.slice(dot + 1).toLowerCase() : ''
}

function firstOpenable(docs: UniworkDocSummary[]): string | null {
  return docs.find(isOpenable)?.id ?? null
}

/** arrow keys step over documents that cannot be opened */
export function moveActive(
  docs: UniworkDocSummary[],
  activeId: string | null,
  to: 'next' | 'prev' | 'first' | 'last',
): string | null {
  const ids = docs.filter(isOpenable).map((d) => d.id)
  if (ids.length === 0) return null
  if (to === 'first') return ids[0]!
  if (to === 'last') return ids[ids.length - 1]!
  const at = activeId ? ids.indexOf(activeId) : -1
  if (to === 'next') return ids[Math.min(at + 1, ids.length - 1)]!
  return ids[at <= 0 ? 0 : at - 1]!
}

function freshList(prev: PickerState['list']): PickerState['list'] {
  return {
    status: 'loading',
    docs: [],
    nextCursor: null,
    loadingMore: false,
    requestId: prev.requestId + 1,
  }
}

export function pickerReducer(state: PickerState, action: PickerAction): PickerState {
  switch (action.type) {
    case 'workspaces-retry':
      return {
        ...state,
        workspaces: { status: 'loading', items: [] },
        list: { ...state.list, status: 'loading', error: undefined },
      }
    case 'workspaces-loaded': {
      if (!action.result.ok) {
        return {
          ...state,
          workspaces: { status: 'error', items: [], error: action.result.error },
          list: { ...state.list, status: 'ready', docs: [], error: undefined },
        }
      }
      const items = action.result.value
      const keep = items.find((w) => w.id === state.workspaceId)
      const workspaceId = keep?.id ?? items[0]?.id ?? null
      return {
        ...state,
        workspaces: { status: 'ready', items },
        workspaceId,
        // no workspace: nothing to list; otherwise the list fetch starts now
        list: workspaceId ? freshList(state.list) : { ...freshList(state.list), status: 'ready' },
        activeId: null,
      }
    }
    case 'select-workspace':
      if (action.id === state.workspaceId) return state
      return {
        ...state,
        workspaceId: action.id,
        list: freshList(state.list),
        activeId: null,
        openError: null,
      }
    case 'set-query': {
      if (action.query === state.query) return state
      return {
        ...state,
        query: action.query,
        list: state.workspaceId ? freshList(state.list) : state.list,
        activeId: null,
        openError: null,
      }
    }
    case 'list-retry':
      return { ...state, list: freshList(state.list), activeId: null, openError: null }
    case 'list-loaded': {
      if (action.requestId !== state.list.requestId) return state
      if (!action.result.ok) {
        if (action.append) {
          return {
            ...state,
            list: { ...state.list, loadingMore: false, moreError: action.result.error },
          }
        }
        return {
          ...state,
          list: {
            ...state.list,
            status: 'error',
            docs: [],
            nextCursor: null,
            loadingMore: false,
            error: action.result.error,
          },
        }
      }
      const page = action.result.value
      const docs = action.append ? [...state.list.docs, ...page.documents] : page.documents
      return {
        ...state,
        list: {
          ...state.list,
          status: 'ready',
          docs,
          nextCursor: page.nextCursor,
          loadingMore: false,
          error: undefined,
          moreError: undefined,
        },
        activeId:
          state.activeId && docs.some((d) => d.id === state.activeId && isOpenable(d))
            ? state.activeId
            : firstOpenable(docs),
      }
    }
    case 'load-more':
      if (!state.list.nextCursor || state.list.loadingMore || state.list.status !== 'ready') {
        return state
      }
      return { ...state, list: { ...state.list, loadingMore: true, moreError: undefined } }
    case 'move-active':
      return { ...state, activeId: moveActive(state.list.docs, state.activeId, action.to) }
    case 'set-active':
      return { ...state, activeId: action.id }
    case 'open-start':
      if (state.opening) return state
      return { ...state, opening: { id: action.id, title: action.title }, openError: null }
    case 'open-failed':
      return { ...state, opening: null, openError: action.error }
    case 'clear-open-error':
      return state.openError ? { ...state, openError: null } : state
  }
}

export type PickerBody =
  | { kind: 'loading' }
  | { kind: 'no-workspaces' }
  | { kind: 'error'; error: UniworkDocErrorCode; action: ErrorAction }
  | { kind: 'empty' }
  | { kind: 'no-results'; query: string }
  | { kind: 'list' }

/** which of the picker's bodies to show */
export function pickerBodyOf(state: PickerState): PickerBody {
  const { workspaces, list } = state
  if (workspaces.status === 'loading') return { kind: 'loading' }
  if (workspaces.status === 'error') {
    const error = workspaces.error ?? 'server_error'
    return { kind: 'error', error, action: errorActionOf(error) }
  }
  if (workspaces.items.length === 0) return { kind: 'no-workspaces' }
  if (list.status === 'loading') return { kind: 'loading' }
  if (list.status === 'error') {
    const error = list.error ?? 'server_error'
    return { kind: 'error', error, action: errorActionOf(error) }
  }
  if (list.docs.length === 0) {
    return state.query ? { kind: 'no-results', query: state.query } : { kind: 'empty' }
  }
  return { kind: 'list' }
}

/** retry what failed: the workspace list when that was it, else the document list */
export function retryActionOf(state: PickerState): PickerAction {
  return state.workspaces.status === 'error' ? { type: 'workspaces-retry' } : { type: 'list-retry' }
}

// ── Time ────────────────────────────────────────────────

/** "10:42" for today, a medium date otherwise; '' when the server sent no usable time */
export function formatWhen(iso: string, locale: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  try {
    return new Intl.DateTimeFormat(
      locale,
      sameDay ? { timeStyle: 'short' } : { dateStyle: 'medium' },
    ).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/** "Updated 10:42 by Linh" for a picker row ('' when there is no time to show) */
export function pickerRowMeta(
  doc: UniworkDocSummary,
  t: TFunc,
  dateLocale: string,
  now: Date = new Date(),
): string {
  const time = formatWhen(doc.updatedAt, dateLocale, now)
  if (!time) return ''
  const name = doc.updatedByName?.trim()
  return name ? t('uwPickUpdatedBy', { name, time }) : t('uwPickUpdated', { time })
}
