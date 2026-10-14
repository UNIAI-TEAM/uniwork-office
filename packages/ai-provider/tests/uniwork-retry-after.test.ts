import { describe, expect, it } from 'vitest'
import { decideRateLimitWait, parseRetryAfterSeconds } from '../src/uniwork/retry-after'

const NOW = Date.UTC(2026, 9, 14, 3, 0, 0)

describe('decideRateLimitWait (EXPERIENCE 429 rule, G6-02: max 3 waits, cap 300 s)', () => {
  it('0 retries once at once', () => {
    expect(decideRateLimitWait('0', 0, NOW)).toEqual({ kind: 'wait', seconds: 0, attempt: 1 })
  })

  it('120 waits 120s', () => {
    expect(decideRateLimitWait('120', 0, NOW)).toEqual({ kind: 'wait', seconds: 120, attempt: 1 })
    expect(decideRateLimitWait(120, 1, NOW)).toEqual({ kind: 'wait', seconds: 120, attempt: 2 })
  })

  it('300 is still waited, 301 gives up', () => {
    expect(decideRateLimitWait('300', 0, NOW)).toMatchObject({ kind: 'wait', seconds: 300 })
    expect(decideRateLimitWait('301', 0, NOW)).toEqual({
      kind: 'give-up',
      reason: 'over-cap',
      seconds: 301,
    })
  })

  it('HTTP-date converts; past date retries once', () => {
    const in90 = new Date(NOW + 90_000).toUTCString()
    expect(decideRateLimitWait(in90, 0, NOW)).toEqual({ kind: 'wait', seconds: 90, attempt: 1 })
    const past = new Date(NOW - 30_000).toUTCString()
    expect(decideRateLimitWait(past, 0, NOW)).toEqual({ kind: 'wait', seconds: 0, attempt: 1 })
    const far = new Date(NOW + 400_000).toUTCString()
    expect(decideRateLimitWait(far, 0, NOW)).toMatchObject({ kind: 'give-up', reason: 'over-cap' })
  })

  it('missing gives up', () => {
    expect(decideRateLimitWait(null, 0, NOW)).toEqual({ kind: 'give-up', reason: 'missing' })
    expect(decideRateLimitWait(undefined, 0, NOW)).toEqual({ kind: 'give-up', reason: 'missing' })
    expect(decideRateLimitWait('soon', 0, NOW)).toEqual({ kind: 'give-up', reason: 'missing' })
    expect(decideRateLimitWait('-5', 0, NOW)).toEqual({ kind: 'give-up', reason: 'missing' })
  })

  it('a fourth wait gives up', () => {
    expect(decideRateLimitWait('5', 2, NOW)).toEqual({ kind: 'wait', seconds: 5, attempt: 3 })
    expect(decideRateLimitWait('5', 3, NOW)).toEqual({
      kind: 'give-up',
      reason: 'max-waits',
      seconds: 5,
    })
  })

  it('parseRetryAfterSeconds reads delta-seconds and HTTP-dates only', () => {
    expect(parseRetryAfterSeconds(' 30 ', NOW)).toBe(30)
    expect(parseRetryAfterSeconds('1.5', NOW)).toBeNull()
    expect(parseRetryAfterSeconds('', NOW)).toBeNull()
    expect(parseRetryAfterSeconds(new Date(NOW + 2_000).toUTCString(), NOW)).toBe(2)
  })
})
