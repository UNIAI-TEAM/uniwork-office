import type { UniworkDocErrorCode } from '../../shared/home-api'
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

  constructor(
    code: UniworkDocErrorCode,
    extra: {
      serverCode?: string
      status?: number
      currentRevision?: string
      retryAfterMs?: number
    } = {},
  ) {
    super(`uniwork document request failed: ${code}`)
    this.name = 'UniworkDocError'
    this.code = code
    this.serverCode = extra.serverCode
    this.status = extra.status
    this.currentRevision = extra.currentRevision
    this.retryAfterMs = extra.retryAfterMs
  }
}

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
  // only a throttled / temporarily unavailable answer and the in-flight
  // idempotency verdict carry a Retry-After; anywhere else the header is noise
  const retried = retryAfterMs === undefined ? at : { ...at, retryAfterMs }
  // a feed cursor verdict must never reach the coded-410 -> `deleted` branch
  // below; the feed classifies it first with parseFeedError
  if (serverCode === CHANGE_CURSOR_EXPIRED || serverCode === CHANGE_CURSOR_INVALID) {
    return new UniworkDocError('server_error', at)
  }
  // throttled (429) or temporarily down (503): retryable, never a terminal
  // refusal - the save queue backs off and can honour the Retry-After
  if (status === 429 || status === 503) return new UniworkDocError('server_error', retried)
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
  if (status === 413 || serverCode === 'file_too_large' || serverCode === 'payload_too_large') {
    return new UniworkDocError('too_large', at)
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
    // unlike the terminal document_deleted, whose copy only a reopen answers
    error.code === 'too_large' ||
    error.code === 'engine_incompatible' ||
    // a 409 the pipeline cannot recover by replaying (upload claim gone, ...);
    // a 409 base conflict is NOT here: its intent stays and can settle by
    // replay, and capability_off / intent_unknown keep the intent too
    (error.code === 'server_error' && error.status === 409)
  )
}
