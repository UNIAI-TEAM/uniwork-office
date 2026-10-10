import type { AiNoticeKind } from './ai-notice'
import { isAiNetworkError } from './network-error'

/**
 * Why a settings "Test connection" failed, as a code the renderer turns into a
 * product message in the UI language. The raw provider text ("HTTP 401: {...}")
 * stays in the main process log and never reaches the pill.
 *
 * `not_entitled` and `credits_exhausted` are the plan states of the notice
 * mapping in `ai-notice.ts` (the UniWork cloud's `entitlement_required` and
 * `credits_exhausted` reasons); the rest are about the user's own provider.
 */
export type AiTestFailureKind =
  Exclude<AiNoticeKind, 'no_model'> | 'invalid_key' | 'network' | 'limit' | 'unavailable' | 'failed'

export interface AiTestResult {
  ok: boolean
  /** raw detail for logs; the UI shows `errorKind` instead */
  error?: string
  errorKind?: AiTestFailureKind
}

const KINDS: readonly AiTestFailureKind[] = [
  'not_entitled',
  'credits_exhausted',
  'invalid_key',
  'network',
  'limit',
  'unavailable',
  'failed',
]

/** a kind read from an IPC payload; anything unknown is the generic failure */
export function normalizeAiTestFailureKind(value: unknown): AiTestFailureKind {
  return KINDS.includes(value as AiTestFailureKind) ? (value as AiTestFailureKind) : 'failed'
}

/** the UniWork cloud's reason codes (contract 3.5: /orgs/{org}/ai/cloud/*) */
export function aiTestFailureKindForCloudCode(code: string): AiTestFailureKind {
  switch (code) {
    case 'entitlement_required':
    case 'subscription_inactive':
    case 'no_access':
      return 'not_entitled'
    case 'credits_exhausted':
      return 'credits_exhausted'
    case 'rate_limited':
      return 'limit'
    case 'network':
    case 'timeout':
      return 'network'
    case 'cloud_unavailable':
    case 'server_error':
    case 'malformed_response':
      return 'unavailable'
    default:
      return 'failed'
  }
}

/**
 * An HTTP status from the user's own provider (`cloud` false) or from a UniWork
 * cloud tool (`cloud` true: 402 is the organization out of credits, 403 the plan
 * without cloud AI; for a provider both are about the provider account).
 */
export function aiTestFailureKindForStatus(status: number, cloud = false): AiTestFailureKind {
  if (cloud && status === 402) return 'credits_exhausted'
  if (cloud && status === 403) return 'not_entitled'
  if (status === 401 || status === 403) return 'invalid_key'
  if (status === 402 || status === 429) return 'limit'
  if (status === 408 || status >= 500) return 'unavailable'
  return 'failed'
}

/** a thrown error or a raw result text: a status in it ("HTTP 401: ...") or a transport failure */
export function aiTestFailureKindForText(text: string, error?: unknown): AiTestFailureKind {
  const status = /\bHTTP (\d{3})\b/.exec(text)?.[1]
  if (status) return aiTestFailureKindForStatus(Number(status))
  if (isAiNetworkError(error ?? text)) return 'network'
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'network'
  }
  return 'failed'
}

/** a one-shot chat failure: its machine-readable cause first (the same codes the chat UI localizes), then its text */
export function aiTestFailureKindForChat(result: {
  error?: string
  errorCode?: 'timeout' | 'credits' | 'network' | 'overloaded'
}): AiTestFailureKind {
  switch (result.errorCode) {
    case 'timeout':
    case 'network':
      return 'network'
    case 'credits':
      return 'limit'
    case 'overloaded':
      return 'unavailable'
    default:
      return aiTestFailureKindForText(result.error ?? '')
  }
}

export function aiTestFailure(kind: AiTestFailureKind, detail: string): AiTestResult {
  return { ok: false, error: detail, errorKind: kind }
}

/** a failed result without a kind gets the one its raw text implies; passes and tagged results are untouched */
export function withAiTestFailureKind<T extends AiTestResult>(result: T): T {
  if (result.ok || result.errorKind) return result
  return { ...result, errorKind: aiTestFailureKindForText(result.error ?? '') }
}
