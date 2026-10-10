import { timingSafeEqual } from 'node:crypto'
import type { PendingLoginAttempt } from './pkce'

/** Any URL on a sign-in callback scheme belongs to the auth manager, never
 * to the `uniwork://` office-bridge router. */
const AUTH_SCHEME_PREFIX = /^uniwork-office(-dev)?:\/\//i

export function isAuthCallbackUrl(url: unknown): url is string {
  return typeof url === 'string' && AUTH_SCHEME_PREFIX.test(url)
}

/** Windows/Linux deliver the callback as a command-line argument (cold start
 * or second instance). */
export function extractAuthCallbackFromArgv(argv: readonly unknown[]): string | null {
  for (const arg of argv) if (isAuthCallbackUrl(arg)) return arg
  return null
}

/** additionalData from a second instance's requestSingleInstanceLock */
export function extractAuthCallbackFromLockData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const value = data as Record<string, unknown>
  if (isAuthCallbackUrl(value.authCallbackUrl)) return value.authCallbackUrl
  if (isAuthCallbackUrl(value.launchUrl)) return value.launchUrl
  return null
}

export type CallbackRejectReason =
  | 'no_attempt'
  | 'expired'
  | 'malformed'
  | 'wrong_redirect'
  | 'duplicate_query'
  | 'unexpected_query'
  | 'missing_param'
  | 'state_mismatch'

export type CallbackValidation =
  { ok: true; code: string; attemptId: string } | { ok: false; reason: CallbackRejectReason }

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Validates the custom-scheme callback before any exchange call: exact
 * redirect base, a query holding only `code` and `state` once each, no
 * fragment, and a constant-time state comparison. Never returns or logs the
 * URL, code or state on rejection.
 */
export function validateCallback(
  callbackUrl: string,
  attempt: PendingLoginAttempt | undefined,
  now: number,
): CallbackValidation {
  if (!attempt) return { ok: false, reason: 'no_attempt' }
  if (attempt.expiresAt <= now) return { ok: false, reason: 'expired' }
  if (typeof callbackUrl !== 'string' || callbackUrl.includes('#')) {
    return { ok: false, reason: 'malformed' }
  }
  const queryStart = callbackUrl.indexOf('?')
  const base = queryStart < 0 ? callbackUrl : callbackUrl.slice(0, queryStart)
  if (base !== attempt.redirectUri) return { ok: false, reason: 'wrong_redirect' }
  if (queryStart < 0) return { ok: false, reason: 'missing_param' }
  const params = new URLSearchParams(callbackUrl.slice(queryStart + 1))
  const seen = new Set<string>()
  for (const [key] of params) {
    if (seen.has(key)) return { ok: false, reason: 'duplicate_query' }
    seen.add(key)
    if (key !== 'code' && key !== 'state') return { ok: false, reason: 'unexpected_query' }
  }
  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return { ok: false, reason: 'missing_param' }
  if (!equalSecret(state, attempt.state)) return { ok: false, reason: 'state_mismatch' }
  return { ok: true, code, attemptId: attempt.attemptId }
}
