/**
 * Typed failures of the web AI routes (GO-A7 contract, app-api-contract section 3.4; CONTRACT C16).
 *
 * Every non-2xx answer of /office-frame/documents/{id}/ai/... becomes one `AiWebError` with a
 * closed `code`, so the UI picks its state (and its translated text) from the code, never from the
 * server's `message`:
 *
 * | HTTP | server `code`                              | AiWebErrorCode         |
 * |------|--------------------------------------------|------------------------|
 * | 400  |                                            | bad_request            |
 * | 401  | (after one token refresh)                  | unauthorized           |
 * | 402  | credits_exhausted                          | credits_exhausted      |
 * | 403  | entitlement_required                       | entitlement_required   |
 * | 429  | (none; `retry-after` forwarded)            | rate_limited           |
 * | 502  | provider_unreachable                       | provider_unreachable   |
 * | 503  | cloud_unavailable                          | cloud_unavailable      |
 * | 503  | (no JSON error body: gateway page, empty)  | cloud_outage           |
 * | else |                                            | unknown                |
 *
 * The status decides; the body's `code` is kept in `serverCode` (diagnostics only). The frame runs
 * UniWork AI only (UNI-2289): there is no key store, so no key state either.
 */

import { UniworkError, uniworkErrorKey } from '../../../../packages/ai-provider/src/uniwork/errors'
import { proxyErrorBodyFields } from '../../../../packages/ai-provider/src/proxy-url'
import {
  aiUniworkStrings,
  type AiUniworkStringKey,
} from '../../../../packages/ui/src/strings-ai-uniwork'

export type AiWebErrorCode =
  | 'credits_exhausted'
  | 'entitlement_required'
  | 'rate_limited'
  | 'provider_unreachable'
  | 'cloud_unavailable'
  /** a 503 with no JSON error body (a gateway page while the UniWork API is down): retry, not "not set up" */
  | 'cloud_outage'
  | 'unauthorized'
  | 'bad_request'
  | 'unknown'

export const AI_WEB_ERROR_CODES: readonly AiWebErrorCode[] = [
  'credits_exhausted',
  'entitlement_required',
  'rate_limited',
  'provider_unreachable',
  'cloud_unavailable',
  'cloud_outage',
  'unauthorized',
  'bad_request',
  'unknown',
]

export class AiWebError extends Error {
  readonly code: AiWebErrorCode
  readonly status: number
  /** the body's `code`, verbatim (diagnostics only, never shown) */
  readonly serverCode: string | undefined
  /** seconds from `retry-after` (429), when the server sent one */
  readonly retryAfterSec: number | undefined

  constructor(init: {
    code: AiWebErrorCode
    status: number
    message?: string
    serverCode?: string
    retryAfterSec?: number
  }) {
    super(init.message || `ai ${init.code} (HTTP ${init.status})`)
    this.name = 'AiWebError'
    this.code = init.code
    this.status = init.status
    this.serverCode = init.serverCode
    this.retryAfterSec = init.retryAfterSec
  }
}

export function isAiWebError(err: unknown): err is AiWebError {
  return err instanceof AiWebError
}

const BY_STATUS: Record<number, AiWebErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  402: 'credits_exhausted',
  403: 'entitlement_required',
  429: 'rate_limited',
  502: 'provider_unreachable',
  503: 'cloud_unavailable',
}

/** HTTP status -> the typed code */
export function aiErrorCodeFor(status: number): AiWebErrorCode {
  return BY_STATUS[status] ?? 'unknown'
}

/** `retry-after` as seconds (delta-seconds or an HTTP date); undefined when absent or unreadable */
export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n)
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : undefined
}

/**
 * `code` / `message` of a server error body (`{ "error": { code, message } }` or the flat shape);
 * the reader shared with the desktop (packages/ai-provider/src/proxy-url.ts).
 */
export const errorBodyFields = proxyErrorBodyFields

/** read a failed response once into an AiWebError (the body is consumed) */
export async function aiErrorFromResponse(res: Response): Promise<AiWebError> {
  let serverCode: string | undefined
  let message: string | undefined
  let hasJsonError = false
  try {
    const body: unknown = await res.json()
    ;({ code: serverCode, message } = errorBodyFields(body))
    hasJsonError = !!body && typeof body === 'object' && ('error' in body || 'code' in body)
  } catch {
    // not JSON (a 429 page, a gateway error): the status alone decides
  }
  return new AiWebError({
    // only a 503 with no JSON error body is an outage; a coded or JSON 503 keeps cloud_unavailable
    code: res.status === 503 && !hasJsonError ? 'cloud_outage' : aiErrorCodeFor(res.status),
    status: res.status,
    ...(message ? { message } : {}),
    ...(serverCode ? { serverCode } : {}),
    ...(res.status === 429
      ? { retryAfterSec: retryAfterSeconds(res.headers.get('retry-after')) }
      : {}),
  })
}

// ------------------------------------------------------------------ UniWork AI (G6-05)

/**
 * What the panel text of a failed UniWork AI turn is picked from: the adapter's `UniworkError`
 * (the façade's `code`, `Retry-After` seconds, the run id when one was open). The text comes from
 * the code, never from the message; these are not AiWebErrors (no card).
 */
export interface UniworkFailure {
  code: string
  retryAfterSec?: number
  /** a run was open when it failed (the capability went off mid-run, not before the first one) */
  runId?: string
}

/** the adapter's error as a UniworkFailure; undefined for anything else */
export function asUniworkFailure(err: unknown): UniworkFailure | undefined {
  if (!(err instanceof UniworkError)) return undefined
  return {
    code: err.code,
    ...(err.retryAfterSec !== undefined ? { retryAfterSec: err.retryAfterSec } : {}),
    ...(err.runId ? { runId: err.runId } : {}),
  }
}

/**
 * The S9/S10 string of a failed UniWork AI turn: the adapter's `uniworkErrorKey` (web host), except
 * that "off" before any run is the entry's own note (`aiUniworkOff`), falling back to
 * `aiErrUnavailable` if the key is not in `aiUniworkStrings`.
 */
export function uniworkFailureKey(
  failure: UniworkFailure,
  resolveErrorKey: (code: string, host: 'desktop' | 'web') => string = uniworkErrorKey,
): AiUniworkStringKey {
  if (failure.code === 'office_capability_off' && !failure.runId) return 'aiUniworkOff'
  const key = resolveErrorKey(failure.code, 'web')
  return key in aiUniworkStrings.zh ? (key as AiUniworkStringKey) : 'aiErrUnavailable'
}
