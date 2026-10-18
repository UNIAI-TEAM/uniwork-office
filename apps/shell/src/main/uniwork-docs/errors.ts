import type { UniworkDocEditLock, UniworkDocErrorCode } from '../../shared/home-api'
import { isDecimalString } from './formats'

/**
 * A failed UniWork documents call. `code` is the user-facing code from the
 * shared contract; `serverCode` keeps the server's own `{error:{code}}` when
 * it answered with the UniWork envelope (the save pipeline switches on a few
 * of them). Never carries a URL, body, ticket or token.
 */
export class UniworkDocError extends Error {
  readonly code: UniworkDocErrorCode
  readonly serverCode?: string
  readonly status?: number
  /** `fields.current_revision` of a version conflict (decimal string) */
  readonly currentRevision?: string
  /** a `Retry-After` the server sent (ms), honoured by the queue's backoff */
  readonly retryAfterMs?: number
  /** SIZE-F1: file name when a local upload is refused as too_large */
  readonly filename?: string
  /** SIZE-F1: actual payload size in bytes when refused as too_large */
  readonly sizeBytes?: number
  /** SIZE-F1: server or preflight limit in bytes (`fields.max_bytes`) when refused as too_large */
  readonly maxBytes?: number
  /**
   * FD-11 / B-R2-01: the depth cap a `document_too_deep` answer carries so the
   * renderer can name it. D's `document_too_deep` has no `fields` map and `max`
   * is always the app constant 20 (matching the server's `maxDocumentDepth`).
   */
  readonly maxDepth?: number
  /**
   * SAVE-01 r2 (S01-R1-2): on a first-save failure AFTER the create landed,
   * the server document that exists, so the action result can name it for the
   * user (archived to the trash, or orphaned when the archive failed too).
   */
  readonly documentId?: string
  readonly documentTitle?: string
  /** EL-1(a) (UNI-1645c): main-only holder user id from 423 `document_locked` (`fields.holder_id`) */
  readonly holderId?: string | null
  /** EL-1(a) (UNI-1645c): lock holder metadata from 423 `document_locked` */
  readonly editLock?: UniworkDocEditLock
  /**
   * UNI-1918 (B69-lite): the server's own `fields.reason` of a
   * `document_upload_invalid` refusal (`file_claim_expired`,
   * `file_not_ready`, `upload_canceled`, `file_deleting`). Without it those
   * four answers are indistinguishable, and only an expired claim may be
   * resumed with a fresh upload key after ONE lookup.
   */
  readonly reason?: string

  constructor(
    code: UniworkDocErrorCode,
    extra: {
      serverCode?: string
      status?: number
      currentRevision?: string
      retryAfterMs?: number
      filename?: string
      sizeBytes?: number
      maxBytes?: number
      maxDepth?: number
      documentId?: string
      documentTitle?: string
      holderId?: string | null
      editLock?: UniworkDocEditLock
      reason?: string
    } = {},
  ) {
    super(`uniwork document request failed: ${code}`)
    this.name = 'UniworkDocError'
    this.code = code
    this.serverCode = extra.serverCode
    this.status = extra.status
    this.currentRevision = extra.currentRevision
    this.retryAfterMs = extra.retryAfterMs
    this.filename = extra.filename
    this.sizeBytes = extra.sizeBytes
    this.maxBytes = extra.maxBytes
    this.maxDepth = extra.maxDepth
    this.documentId = extra.documentId
    this.documentTitle = extra.documentTitle
    this.holderId = extra.holderId
    this.editLock = extra.editLock
    this.reason = extra.reason
  }
}

function boundedLockString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : null
}

/**
 * FD-11 / B-R1-08: how deep D lets the document tree go (its own documented
 * cap; D's `errDocumentTooDeep` emits no `fields` map).
 */
const DEFAULT_TREE_MAX_DEPTH = 20

/**
 * A `Retry-After` header (RFC 9110) as milliseconds from `now`: delta-seconds,
 * or an HTTP date (never negative). Anything malformed is undefined, so a bad
 * header never invents a delay.
 */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined
  const value = header.trim()
  if (!value) return undefined
  if (/^\d+$/.test(value)) {
    const seconds = Number(value)
    return Number.isSafeInteger(seconds) ? seconds * 1000 : undefined
  }
  const at = Date.parse(value)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, at - now)
}

export function isUniworkDocError(error: unknown): error is UniworkDocError {
  return error instanceof UniworkDocError
}

/** the server's error envelope, or null when the body is not one (a gateway, a proxy) */
export function readEnvelope(
  body: unknown,
): { code: string; fields?: Record<string, unknown> } | null {
  if (!body || typeof body !== 'object') return null
  const error = (body as { error?: unknown }).error
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'string' || !code) return null
  const fields = (error as { fields?: unknown }).fields
  return {
    code,
    ...(fields && typeof fields === 'object' && !Array.isArray(fields)
      ? { fields: fields as Record<string, unknown> }
      : {}),
  }
}

/** change-feed cursor verdicts (G5-01a): about the cursor, never a document */
export const CHANGE_CURSOR_EXPIRED = 'change_cursor_expired'
export const CHANGE_CURSOR_INVALID = 'change_cursor_invalid'

const CONFLICT_CODES = new Set(['document_version_conflict', 'revision_conflict'])
const IDEMPOTENCY_STOP_CODES = new Set(['idempotency_payload_mismatch', 'idempotency_key_reuse'])

/**
 * Status + envelope -> typed error. A 403/404 is the server's verdict only
 * when it carries the UniWork envelope; a bare one (gateway, captive portal)
 * stays a transient server_error so it never ends a document for good.
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  retryAfterMs?: number,
): UniworkDocError {
  const envelope = readEnvelope(body)
  const serverCode = envelope?.code
  const at = { status, ...(serverCode ? { serverCode } : {}) }
  // BIGUP-A1: an upload-session refusal carries its delay in
  // `fields.retry_after` (seconds) as well as in the `Retry-After` header the
  // server sets for its 429s; either spelling gives the same wait, and the
  // header wins when both are there.
  const rawFieldRetry = envelope?.fields?.retry_after
  const fieldRetryMs =
    typeof rawFieldRetry === 'number' && Number.isFinite(rawFieldRetry) && rawFieldRetry >= 0
      ? Math.floor(rawFieldRetry) * 1000
      : undefined
  // only a throttled / temporarily unavailable answer and the in-flight
  // idempotency verdict carry a Retry-After; anywhere else the header is noise
  const delay = retryAfterMs ?? fieldRetryMs
  const retried = delay === undefined ? at : { ...at, retryAfterMs: delay }
  // a feed cursor verdict must never reach the coded-410 -> `deleted` branch
  // below; the feed classifies it first with parseFeedError
  if (serverCode === CHANGE_CURSOR_EXPIRED || serverCode === CHANGE_CURSOR_INVALID) {
    return new UniworkDocError('server_error', at)
  }
  // BIGUP-A1: the upload-session verdicts, each its own answer.
  // `upload_session_expired` (410) is NOT a document tombstone: the session is
  // gone, so it reads `not_found` - the caller drops its saved session and
  // starts a new one. `upload_session_busy` (409) is a wait, never the
  // terminal 409 below, and keeps the server's own 5 s delay. A too-small
  // answer (422) is the threshold-drift fallback signal, and the three 422
  // part/probe verdicts each keep their serverCode for the caller to act on.
  if (serverCode === 'upload_session_expired') return new UniworkDocError('not_found', at)
  if (serverCode === 'upload_session_busy') return new UniworkDocError('server_error', retried)
  if (serverCode === 'upload_session_too_small') return new UniworkDocError('server_error', at)
  if (serverCode === 'upload_parts_invalid') return new UniworkDocError('server_error', at)
  // UNI-1918 (B69-lite): a staged upload the server can no longer resolve. The
  // four reasons (`file_claim_expired`, `file_not_ready`, `upload_canceled`,
  // `file_deleting`) are NOT interchangeable: only an expired claim may be
  // resumed (a fresh upload key, after ONE lookup proves the old attempt did
  // not commit), so the reason is kept on the error. The code stays the coded
  // 409 (`server_error` + status) the save pipeline already switches on.
  if (serverCode === 'document_upload_invalid') {
    const reason = boundedLockString(envelope?.fields?.reason, 64)
    return new UniworkDocError('server_error', { ...at, ...(reason ? { reason } : {}) })
  }
  if (serverCode === 'upload_size_mismatch' || serverCode === 'upload_probe_mismatch') {
    // the file changed under us: the same shape the app already answers an
    // upload-checksum mismatch with, so nothing retries it silently
    return new UniworkDocError('malformed_response', at)
  }
  if (serverCode === 'unsupported_media_type') {
    return new UniworkDocError('unsupported_format', at)
  }
  // throttled (429) or temporarily down (503): retryable, never a terminal
  // refusal - the save queue backs off and can honour the Retry-After
  if (status === 429 || status === 503) return new UniworkDocError('server_error', retried)
  // EL-1(a) (UNI-1645c): HTTP 423 document_locked -> edit_locked (never conflict, never server_error).
  // Any other 423 code or bare 423 falls through to server_error.
  if (status === 423 && serverCode === 'document_locked') {
    const fields = envelope?.fields
    const holderId = boundedLockString(fields?.holder_id, 128)
    const offlineHoldUntil = boundedLockString(fields?.offline_hold_until, 64)
    const editLock: UniworkDocEditLock = {
      holderName: boundedLockString(fields?.holder_name, 256),
      since: boundedLockString(fields?.since, 64),
      expiresAt: boundedLockString(fields?.expires_at, 64),
      heldByMe: fields?.held_by_me === true,
      ...(offlineHoldUntil ? { offlineHoldUntil } : {}),
    }
    const current = fields?.current_revision
    return new UniworkDocError('edit_locked', {
      ...at,
      holderId,
      editLock,
      ...(isDecimalString(current) ? { currentRevision: current } : {}),
    })
  }
  if (serverCode && CONFLICT_CODES.has(serverCode)) {
    const current = envelope?.fields?.current_revision
    return new UniworkDocError('conflict', {
      ...at,
      ...(isDecimalString(current) ? { currentRevision: current } : {}),
    })
  }
  if (serverCode && IDEMPOTENCY_STOP_CODES.has(serverCode)) {
    return new UniworkDocError('idempotency_mismatch', at)
  }
  // retried by the save pipeline with a bounded backoff; offline-like after that
  if (serverCode === 'idempotency_in_flight') return new UniworkDocError('network', retried)
  if (serverCode === 'quota_exceeded') return new UniworkDocError('quota_exceeded', at)
  if (serverCode === 'engine_incompatible') return new UniworkDocError('engine_incompatible', at)
  // FD-11: the folder tree's own refusals, each its own code - a 409/422 that
  // fell through to `server_error` before. `folder_name_taken` stays off
  // `UniworkDocErrorCode` (mapped in `actionErrorOf` from `serverCode` to
  // `folder_name_taken` or `move_name_taken`), and `document_too_deep` carries
  // the tree's depth cap (20).
  if (serverCode === 'document_too_deep') {
    return new UniworkDocError('document_too_deep', { ...at, maxDepth: DEFAULT_TREE_MAX_DEPTH })
  }
  if (serverCode === 'document_cycle') return new UniworkDocError('document_cycle', at)
  if (serverCode === 'document_parent_kind') {
    return new UniworkDocError('document_parent_kind', at)
  }
  // G5-06 (UNI-1352): the server's own verdicts, kept apart from the generic
  // forbidden/deleted a caller would otherwise act on. A capability kill
  // switch is a pause, not a permission denial; a swept intent is unknown,
  // never deleted; only a real tombstone ends a document.
  if (serverCode === 'office_capability_off') return new UniworkDocError('capability_off', at)
  if (serverCode === 'commit_intent_unknown') return new UniworkDocError('intent_unknown', at)
  // a document in the trash answers every write refusal with its own code: the
  // intent is parked `blocked` (a restore is what lifts it) instead of ending as
  // a terminal refusal the queue would drop. A document in the archive is not a
  // deleted one - the archive is reversible, and telling the user it was deleted
  // would be a false fact - so it gets its own code and its own block
  if (serverCode === 'document_deleted') {
    return new UniworkDocError('document_deleted', at)
  }
  if (serverCode === 'document_archived') {
    return new UniworkDocError('document_archived', at)
  }
  if (serverCode === 'forbidden') return new UniworkDocError('permission_revoked', at)
  if (serverCode === 'member_deactivated') return new UniworkDocError('member_deactivated', at)
  if (serverCode === 'organization_suspended') {
    return new UniworkDocError('organization_suspended', at)
  }
  // any other coded 410 keeps the tombstone verdict the open paths expect
  if (status === 410 && serverCode) {
    return new UniworkDocError('deleted', at)
  }
  if (
    status === 413 ||
    serverCode === 'file_too_large' ||
    serverCode === 'document_too_large' ||
    serverCode === 'payload_too_large'
  ) {
    const rawMax =
      envelope?.fields?.max_bytes ??
      envelope?.fields?.upload_max_bytes ??
      envelope?.fields?.maxBytes
    const rawSize = envelope?.fields?.size_bytes ?? envelope?.fields?.sizeBytes
    const maxBytes =
      typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0
        ? Math.floor(rawMax)
        : undefined
    const sizeBytes =
      typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize >= 0
        ? Math.floor(rawSize)
        : undefined
    return new UniworkDocError('too_large', {
      ...at,
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    })
  }
  if (status === 403 && serverCode) return new UniworkDocError('forbidden', at)
  if (status === 404 && serverCode) return new UniworkDocError('not_found', at)
  if (status === 401) return new UniworkDocError('session_expired', at)
  return new UniworkDocError('server_error', at)
}

/** errors after which the intent is known never to have committed and is dropped */
export function isTerminalRefusal(error: UniworkDocError): boolean {
  return (
    error.code === 'idempotency_mismatch' ||
    error.code === 'forbidden' ||
    error.code === 'permission_revoked' ||
    error.code === 'member_deactivated' ||
    error.code === 'organization_suspended' ||
    error.code === 'quota_exceeded' ||
    error.code === 'not_found' ||
    error.code === 'deleted' ||
    error.code === 'document_deleted' ||
    // `document_archived` is deliberately NOT here: the archive is reversible
    // (the block lifts when the document is unarchived), so its intent record
    // stays parked for the access probe / the sync center's re-check to free -
    // unlike the terminal document_deleted, whose copy only a reopen answers.
    // `edit_locked` (HTTP 423 document_locked) is also NOT here: `isTerminalRefusal`
    // in save-coordinator.ts deletes the stored intent + recovery bytes via
    // `cleanupIntent`. For `edit_locked`, the local edit and recovery snapshot
    // must be kept in the intent store (settled to `failed` with `lastError:
    // 'edit_locked'` and no `retryAt` so it never auto-retries on a timer) until
    // the user explicitly saves again or closes the document.
    error.code === 'too_large' ||
    error.code === 'engine_incompatible' ||
    // a 409 the pipeline cannot recover by replaying (upload claim gone, ...);
    // a 409 base conflict is NOT here: its intent stays and can settle by
    // replay, and capability_off / intent_unknown keep the intent too
    (error.code === 'server_error' && error.status === 409)
  )
}
