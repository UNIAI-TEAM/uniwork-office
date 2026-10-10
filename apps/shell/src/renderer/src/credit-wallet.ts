/**
 * UniWork Credit wallet — user-facing unit derived from OpenRouter Token Hub USD.
 * 1 USD (OpenRouter usage / remaining) = 1_000 Credit.
 */
import type { OpenRouterKeyStatus } from '@genoffice/ai-provider'

/** Fixed rate: OpenRouter $1.00 → 1_000 UniWork Credit */
export const CREDITS_PER_USD = 1_000

export function usdToCredits(usd: number): number {
  if (!Number.isFinite(usd)) return 0
  return Math.max(0, Math.round(usd * CREDITS_PER_USD))
}

export function creditsToUsd(credits: number): number {
  if (!Number.isFinite(credits)) return 0
  return credits / CREDITS_PER_USD
}

export function formatCreditCount(n: number, locale = 'en'): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n)
  } catch {
    return String(Math.round(n))
  }
}

export interface CreditWalletSnapshot {
  /** Hub probe succeeded */
  ok: boolean
  missingKey: boolean
  /** Remaining Credit; null = no spend limit on the key */
  remaining: number | null
  /** Lifetime / key usage converted to Credit */
  used: number
  unlimited: boolean
  error?: string
  /** Raw USD from Hub (for tooltips) */
  remainingUsd?: number | null
  usedUsd?: number
}

export function creditWalletFromOpenRouter(
  status: OpenRouterKeyStatus | null | undefined,
  hasKey: boolean,
): CreditWalletSnapshot {
  if (!hasKey) {
    return {
      ok: false,
      missingKey: true,
      remaining: null,
      used: 0,
      unlimited: false,
    }
  }
  if (!status) {
    return {
      ok: false,
      missingKey: false,
      remaining: null,
      used: 0,
      unlimited: false,
      error: 'pending',
    }
  }
  if (!status.ok) {
    return {
      ok: false,
      missingKey: false,
      remaining: null,
      used: 0,
      unlimited: false,
      error: status.error || 'probe-failed',
    }
  }
  const usedUsd = status.usage ?? 0
  const used = usdToCredits(usedUsd)
  const hasRemaining = status.limitRemaining != null && Number.isFinite(status.limitRemaining)
  const unlimited = !hasRemaining && (status.limit == null || status.limit === undefined)
  return {
    ok: true,
    missingKey: false,
    remaining: hasRemaining ? usdToCredits(status.limitRemaining as number) : null,
    used,
    unlimited,
    remainingUsd: hasRemaining ? (status.limitRemaining as number) : null,
    usedUsd,
  }
}

export const CREDIT_RATE_NOTE_VI = '1 USD số dư khóa = 1.000 tín dụng AI'
export const CREDIT_RATE_NOTE_EN = '1 USD of key balance = 1,000 AI credits'
