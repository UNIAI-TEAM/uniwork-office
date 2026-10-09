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

/** read a failed response once into an AiWebError (the body is consumed) */
export async function aiErrorFromResponse(res: Response): Promise<AiWebError> {
  let serverCode: string | undefined
  let message: string | undefined
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown }
    if (typeof body?.code === 'string') serverCode = body.code
    if (typeof body?.message === 'string') message = body.message
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

/**
 * Statuses the BYOK proxy answers itself (contract errors). A provider's own 400/422 (bad model,
 * output cap) is passed to ai-provider unchanged: its output-cap fallback reads that body.
 */
export function isContractFailure(status: number): boolean {
  return status in BY_STATUS
}
