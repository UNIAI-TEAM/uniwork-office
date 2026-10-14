/**
 * Typed failures of the web AI routes (GO-A7 contract, app-api-contract section 3.4; CONTRACT C16).
 *
 * Every non-2xx answer of /office-frame/documents/{id}/ai/... becomes one `AiWebError` with a
 * closed `code`, so the UI picks its state (and its translated text) from the code, never from the
 * server's `message`:
 *
 * | HTTP | server `code`                              | AiWebErrorCode         |
 * |------|--------------------------------------------|------------------------|
 * | 400  | provider_not_supported / base_url_refused  | same                   |
 * | 400  | other                                      | bad_request            |
 * | 401  | (after one token refresh)                  | unauthorized           |
 * | 402  | credits_exhausted                          | credits_exhausted      |
 * | 403  | entitlement_required                       | entitlement_required   |
 * | 404  | credential_missing                         | credential_missing     |
 * | 424  | provider_auth_failed                       | provider_auth_failed   |
 * | 429  | (none; `retry-after` forwarded)            | rate_limited           |
 * | 502  | provider_unreachable                       | provider_unreachable   |
 * | 503  | cloud_unavailable                          | cloud_unavailable      |
 * | else |                                            | unknown                |
 *
 * The status decides; the body's `code` only refines a 400 (and is kept in `serverCode`).
 */

import { UniworkError, uniworkErrorKey } from '../../../../packages/ai-provider/src/uniwork/errors'
import {
  isProxyContractStatus,
  proxyErrorBodyFields,
} from '../../../../packages/ai-provider/src/proxy-url'
import {
  aiUniworkStrings,
  type AiUniworkStringKey,
} from '../../../../packages/ui/src/strings-ai-uniwork'

export type AiWebErrorCode =
  | 'credits_exhausted'
  | 'entitlement_required'
  | 'credential_missing'
  | 'provider_auth_failed'
  | 'rate_limited'
  | 'provider_unreachable'
  | 'cloud_unavailable'
  | 'unauthorized'
  | 'provider_not_supported'
  | 'base_url_refused'
  | 'bad_request'
  /** raised in the frame, never by the server: no model is known for the provider, nothing was sent */
  | 'model_required'
  | 'unknown'

export const AI_WEB_ERROR_CODES: readonly AiWebErrorCode[] = [
  'credits_exhausted',
  'entitlement_required',
  'credential_missing',
  'provider_auth_failed',
  'rate_limited',
  'provider_unreachable',
  'cloud_unavailable',
  'unauthorized',
  'provider_not_supported',
  'base_url_refused',
  'bad_request',
  'model_required',
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

/**
 * The proxy's typed error inside a protocol adapter's wrapper: anthropic/gemini rethrow a failed
 * fetch as `new Error('... fetch failed ...', { cause })`, which would otherwise read as a network
 * problem.
 */
export function findAiWebError(err: unknown): AiWebError | undefined {
  let current: unknown = err
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof AiWebError) return current
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

const BY_STATUS: Record<number, AiWebErrorCode> = {
  401: 'unauthorized',
  402: 'credits_exhausted',
  403: 'entitlement_required',
  404: 'credential_missing',
  424: 'provider_auth_failed',
  429: 'rate_limited',
  502: 'provider_unreachable',
  503: 'cloud_unavailable',
}

/** HTTP status (+ the body's `code` for a 400) -> the typed code */
export function aiErrorCodeFor(status: number, serverCode?: string): AiWebErrorCode {
  if (status === 400) {
    return serverCode === 'provider_not_supported' || serverCode === 'base_url_refused'
      ? serverCode
      : 'bad_request'
  }
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
 * the shared reader of the BYOK proxy (packages/ai-provider/src/proxy-url.ts).
 */
export const errorBodyFields = proxyErrorBodyFields

/** read a failed response once into an AiWebError (the body is consumed) */
export async function aiErrorFromResponse(res: Response): Promise<AiWebError> {
  let serverCode: string | undefined
  let message: string | undefined
  try {
    ;({ code: serverCode, message } = errorBodyFields(await res.json()))
  } catch {
    // not JSON (a provider 429 page, a proxy error): the status alone decides
  }
  return new AiWebError({
    code: aiErrorCodeFor(res.status, serverCode),
    status: res.status,
    ...(message ? { message } : {}),
    ...(serverCode ? { serverCode } : {}),
    ...(res.status === 429
      ? { retryAfterSec: retryAfterSeconds(res.headers.get('retry-after')) }
      : {}),
  })
}

const RAW_HTTP = /\bHTTP (\d{3})\b/
const RAW_PAYLOAD = /[{[]\s*"/

/**
 * A vendor adapter's own failure text ("Claude HTTP 502: {...}", a JSON body) as a typed failure,
 * so the panel shows a translated state instead of the raw payload. undefined for a message that
 * carries no status or payload (those keep their own readable text). A provider's 401 is a key
 * problem here, never a UniWork session problem (the proxy maps provider auth failures to 424).
 */
export function rawFailureAsTyped(err: unknown): AiWebError | undefined {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const status = RAW_HTTP.exec(message)?.[1]
  if (!status && !RAW_PAYLOAD.test(message)) return undefined
  const http = status ? Number(status) : 0
  const code = http === 401 ? 'provider_auth_failed' : aiErrorCodeFor(http)
  return new AiWebError({ code, status: http })
}

/**
 * Statuses the BYOK proxy answers itself (contract errors). A provider's own 400/422 (bad model,
 * output cap) is passed to ai-provider unchanged: its output-cap fallback reads that body.
 */
export const isContractFailure = isProxyContractStatus

// ------------------------------------------------------------------ UniWork AI (G6-05)

/**
 * What the panel text of a failed UniWork AI turn is picked from: the adapter's `UniworkError`
 * (the façade's `code`, `Retry-After` seconds, the run id when one was open). The text comes from
 * the code, never from the message; these are not AiWebErrors (no card, no BYOK state).
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
 * that "off" before any run is the entry's own note (`aiUniworkOff`), and a key U-02 has no string
 * for yet (the web 413 `aiErrWorkbookTooLarge`) reads as `aiErrUnavailable`.
 */
export function uniworkFailureKey(failure: UniworkFailure): AiUniworkStringKey {
  if (failure.code === 'office_capability_off' && !failure.runId) return 'aiUniworkOff'
  const key = uniworkErrorKey(failure.code, 'web')
  return key in aiUniworkStrings.zh ? (key as AiUniworkStringKey) : 'aiErrUnavailable'
}
