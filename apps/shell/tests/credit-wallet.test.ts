import { describe, expect, it } from 'vitest'
import {
  CREDITS_PER_USD,
  creditWalletFromOpenRouter,
  creditsToUsd,
  formatCreditCount,
  usdToCredits,
} from '../src/renderer/src/credit-wallet'

describe('credit wallet conversion', () => {
  it('uses 1 USD = 1000 Credit', () => {
    expect(CREDITS_PER_USD).toBe(1000)
    expect(usdToCredits(12.5)).toBe(12_500)
    expect(usdToCredits(0.001)).toBe(1)
    expect(creditsToUsd(2500)).toBe(2.5)
  })

  it('maps OpenRouter remaining + usage into Credit', () => {
    const snap = creditWalletFromOpenRouter(
      {
        ok: true,
        limitRemaining: 12.5,
        usage: 3.2,
        limit: 100,
        summary: 'Remaining $12.50 · usage $3.20',
      },
      true,
    )
    expect(snap.ok).toBe(true)
    expect(snap.remaining).toBe(12_500)
    expect(snap.used).toBe(3_200)
    expect(snap.unlimited).toBe(false)
  })

  it('treats null limit as unlimited remaining', () => {
    const snap = creditWalletFromOpenRouter(
      { ok: true, limit: null, usage: 1.5, limitRemaining: null },
      true,
    )
    expect(snap.remaining).toBeNull()
    expect(snap.unlimited).toBe(true)
    expect(snap.used).toBe(1_500)
  })

  it('flags missing key', () => {
    expect(creditWalletFromOpenRouter(null, false).missingKey).toBe(true)
  })

  it('formats counts', () => {
    expect(formatCreditCount(12500, 'en-US')).toMatch(/12,500|12500/)
  })
})
