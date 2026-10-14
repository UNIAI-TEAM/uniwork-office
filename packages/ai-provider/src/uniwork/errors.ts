/**
 * UniWork AI failures, keyed by the server's `code` (never its message text):
 * the panel picks the S9 message from the code, and the desktop error
 * classifier never sees a UniWork failure as a generic "overloaded" one.
 */
import { parseRetryAfterSeconds } from './retry-after'
import type { UniworkWireCode } from './types'

/**
 * Codes the adapter assigns itself when the server gave none it knows:
 * - `session_expired`: 401, or no session transport (signed out)
 * - `access_revoked`: 403/404 without a gate code (the document is no longer readable)
 * - `disconnected`: the request or the stream broke after it was sent
 * - `offline`: the host knew it was offline before sending (its transport rejects with this code)
 * - `protocol_error`: the request could not be built (a history the adapter cannot slice)
 * - `question_too_long`: the user's own words are over the façade's question cap; nothing was sent
 * - `question_rejected`: the façade refused the question (400 `invalid_request`); sending it again cannot help
 */
export type UniworkClientCode =
  | 'session_expired'
  | 'access_revoked'
  | 'disconnected'
  | 'offline'
  | 'protocol_error'
  | 'question_too_long'
  | 'question_rejected'

export type UniworkErrorCode = UniworkWireCode | UniworkClientCode

const WIRE_CODES: ReadonlySet<string> = new Set<UniworkWireCode>([
  'conversation_expired',
  'run_expired',
  'run_limit_reached',
  'credits_exhausted',
  'entitlement_required',
  'office_capability_off',
  'ai_rate_limited',
  'ai_uniwork_busy',
  'rate_limited',
  'ai_provider_timeout',
  'ai_provider_error',
  'provider_unreachable',
  'cloud_unavailable',
  'ai_disabled',
  'ai_tool_result_too_large',
  'payload_too_large',
  'invalid_request',
])

/** the 429 codes the Retry-After rule applies to */
export const UNIWORK_RATE_LIMIT_CODES: ReadonlySet<string> = new Set([
  'ai_rate_limited',
  'ai_uniwork_busy',
  'rate_limited',
])

export interface UniworkErrorInit {
  status?: number | undefined
  /** seconds from Retry-After, when the answer had a readable one */
  retryAfterSec?: number | undefined
  /** the error body's `fields` (`limit` of run_limit_reached, `capability` of office_capability_off) */
  fields?: Record<string, unknown> | undefined
  /** the run id the failed answer belonged to, when known */
  runId?: string | undefined
  cause?: unknown
}

export class UniworkError extends Error {
  readonly code: UniworkErrorCode
  readonly status: number | undefined
  readonly retryAfterSec: number | undefined
  readonly fields: Record<string, unknown> | undefined
  readonly runId: string | undefined

  constructor(code: UniworkErrorCode, init: UniworkErrorInit = {}) {
    // the text is for logs only: the code decides what people read
    super(
      `UniWork AI ${code}${init.status ? ` (${init.status})` : ''}`,
      init.cause === undefined ? undefined : { cause: init.cause },
    )
    this.name = 'UniworkError'
    this.code = code
    this.status = init.status
    this.retryAfterSec = init.retryAfterSec
    this.fields = init.fields
    this.runId = init.runId
  }
}

export function isUniworkError(err: unknown): err is UniworkError {
  return err instanceof UniworkError
}

function codeForStatus(status: number): UniworkErrorCode {
  if (status === 401) return 'session_expired'
  if (status === 403 || status === 404) return 'access_revoked'
  if (status === 413) return 'payload_too_large'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'ai_provider_error'
  return 'invalid_request'
}

function bodyCode(body: unknown): { code?: string; fields?: Record<string, unknown> } {
  if (!body || typeof body !== 'object') return {}
  const b = body as { code?: unknown; fields?: unknown; error?: unknown }
  const inner =
    b.error && typeof b.error === 'object'
      ? (b.error as { code?: unknown; fields?: unknown })
      : undefined
  const code =
    typeof b.code === 'string' ? b.code : typeof inner?.code === 'string' ? inner.code : undefined
  const rawFields = b.fields ?? inner?.fields
  const fields =
    rawFields && typeof rawFields === 'object' ? (rawFields as Record<string, unknown>) : undefined
  return { ...(code ? { code } : {}), ...(fields ? { fields } : {}) }
}

/** the error of a non-2xx façade answer; consumes the body */
export async function uniworkErrorFromResponse(
  response: Response,
  now: number = Date.now(),
): Promise<UniworkError> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await response.text())
  } catch {
    parsed = undefined
  }
  const { code, fields } = bodyCode(parsed)
  const status = response.status
  let resolved: UniworkErrorCode =
    code && WIRE_CODES.has(code) ? (code as UniworkWireCode) : codeForStatus(status)
  // a 403 that is not one of the two gates is a lost document/organization access
  if (status === 403 && resolved === 'invalid_request') resolved = 'access_revoked'
  const retryAfterSec =
    parseRetryAfterSeconds(response.headers.get('Retry-After'), now) ?? undefined
  return new UniworkError(resolved, {
    status,
    retryAfterSec,
    fields,
    runId: response.headers.get('X-UniWork-AI-Run') ?? undefined,
  })
}

/** the host the message is shown on (413 has an "open in the app" action only on the web) */
export type UniworkHost = 'desktop' | 'web'

/** the S9 message key (packages/ui/src/ai-uniwork) of a code */
export function uniworkErrorKey(
  code: UniworkErrorCode | (string & {}),
  host: UniworkHost = 'desktop',
): string {
  switch (code) {
    case 'conversation_expired':
      return 'aiConversationRestarted'
    case 'run_expired':
    case 'run_limit_reached':
      return 'aiErrRunLimit'
    case 'credits_exhausted':
      return 'aiErrCredits'
    case 'entitlement_required':
      return 'aiErrEntitlement'
    case 'office_capability_off':
      return 'aiErrCapabilityOff'
    case 'ai_rate_limited':
    case 'ai_uniwork_busy':
    case 'rate_limited':
      // an error surfaces only once the wait rule gave up
      return 'aiErrRateLimitedNoWait'
    case 'ai_tool_result_too_large':
    case 'payload_too_large':
      return host === 'web' ? 'aiErrWorkbookTooLarge' : 'aiErrUnavailable'
    case 'session_expired':
      return 'aiErrSession'
    case 'access_revoked':
      return 'aiErrRevoked'
    case 'disconnected':
      return 'aiErrDisconnected'
    case 'offline':
      return 'aiErrOffline'
    case 'question_too_long':
      return 'aiErrQuestionTooLong'
    case 'question_rejected':
      return 'aiErrQuestionRejected'
    default:
      return 'aiErrUnavailable'
  }
}
