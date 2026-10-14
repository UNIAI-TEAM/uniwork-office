/**
 * The one 429 rule of a UniWork AI turn (EXPERIENCE › Vòng đời, G6-02 §4.5):
 * wait out a readable Retry-After (seconds or an HTTP-date; a past date
 * means "now") up to the cap, at most three waits per turn; anything else
 * gives up at once.
 */
import { UNIWORK_MAX_RATE_LIMIT_WAITS, UNIWORK_RETRY_AFTER_CAP_SECONDS } from './types'

export type RateLimitDecision =
  | { kind: 'wait'; seconds: number; attempt: number }
  | { kind: 'give-up'; reason: 'missing' }
  | { kind: 'give-up'; reason: 'over-cap' | 'max-waits'; seconds: number }

/** Retry-After as whole seconds (>= 0), or null when absent or unreadable */
export function parseRetryAfterSeconds(
  value: string | number | null | undefined,
  now: number,
): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)
  // only an HTTP-date is accepted besides delta-seconds (a bare number with a sign or a fraction is not one)
  if (!/[a-z]/i.test(text)) return null
  const at = Date.parse(text)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.ceil((at - now) / 1000))
}

/** what to do with a 429 when `waitsDone` waits already happened in this turn */
export function decideRateLimitWait(
  retryAfter: string | number | null | undefined,
  waitsDone: number,
  now: number,
): RateLimitDecision {
  const seconds = parseRetryAfterSeconds(retryAfter, now)
  if (seconds === null) return { kind: 'give-up', reason: 'missing' }
  if (seconds > UNIWORK_RETRY_AFTER_CAP_SECONDS)
    return { kind: 'give-up', reason: 'over-cap', seconds }
  if (waitsDone >= UNIWORK_MAX_RATE_LIMIT_WAITS)
    return { kind: 'give-up', reason: 'max-waits', seconds }
  return { kind: 'wait', seconds, attempt: waitsDone + 1 }
}
