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

  constructor(
    code: UniworkDocErrorCode,
    extra: { serverCode?: string; status?: number; currentRevision?: string } = {},
  ) {
    super(`uniwork document request failed: ${code}`)
    this.name = 'UniworkDocError'
    this.code = code
    this.serverCode = extra.serverCode
    this.status = extra.status
    this.currentRevision = extra.currentRevision
  }
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

const CONFLICT_CODES = new Set(['document_version_conflict', 'revision_conflict'])
const IDEMPOTENCY_STOP_CODES = new Set(['idempotency_payload_mismatch', 'idempotency_key_reuse'])

/**
 * Status + envelope -> typed error. A 403/404 is the server's verdict only
 * when it carries the UniWork envelope; a bare one (gateway, captive portal)
 * stays a transient server_error so it never ends a document for good.
 */
export function errorFromResponse(status: number, body: unknown): UniworkDocError {
  const envelope = readEnvelope(body)
  const serverCode = envelope?.code
  const at = { status, ...(serverCode ? { serverCode } : {}) }
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
  if (serverCode === 'idempotency_in_flight') return new UniworkDocError('network', at)
  if (serverCode === 'quota_exceeded') return new UniworkDocError('quota_exceeded', at)
  if (serverCode === 'engine_incompatible') return new UniworkDocError('engine_incompatible', at)
  if (serverCode === 'document_deleted' || (status === 410 && serverCode)) {
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
    error.code === 'conflict' ||
    error.code === 'idempotency_mismatch' ||
    error.code === 'forbidden' ||
    error.code === 'quota_exceeded' ||
    error.code === 'not_found' ||
    error.code === 'deleted' ||
    error.code === 'too_large' ||
    error.code === 'engine_incompatible' ||
    // a 409 the pipeline cannot recover by replaying (upload claim gone, ...)
    (error.code === 'server_error' && error.status === 409)
  )
}
