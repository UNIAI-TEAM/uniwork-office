export interface HubProbeInput {
  baseUrl: string
  apiKey: string
}

export interface HubProbeResult {
  ok: boolean
  /** Short status for the Teacher Home UI */
  message: string
  /** Best-effort remaining balance text when the gateway exposes it */
  balanceText?: string
  modelCount?: number
  /** True when base URL points at OpenRouter */
  openRouter?: boolean
}

/** Canonical OpenRouter OpenAI-compatible root (no trailing slash). */
export const OPENROUTER_HUB_BASE_URL = 'https://openrouter.ai/api/v1'

/** Detect OpenRouter from a Hub / custom base URL (host match). */
export function isOpenRouterHubUrl(baseUrl: string): boolean {
  const raw = baseUrl.trim()
  if (!raw) return false
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const host = new URL(withProto).hostname.toLowerCase()
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai')
  } catch {
    return /openrouter\.ai/i.test(raw)
  }
}

/** Normalize a Hub base URL to an OpenAI-compatible /v1 root (no trailing slash). */
export function normalizeHubBaseUrl(baseUrl: string): string {
  let u = baseUrl.trim().replace(/\/+$/, '')
  if (!u) return ''
  if (isOpenRouterHubUrl(u)) return OPENROUTER_HUB_BASE_URL
  if (!/\/v\d+$/i.test(u)) u = `${u}/v1`
  return u
}

export function hubModelsUrl(baseUrl: string): string {
  const root = normalizeHubBaseUrl(baseUrl)
  return root ? `${root}/models` : ''
}

/**
 * Parse optional balance hints from a Hub /models (or billing) JSON body.
 * Gateways differ; this is best-effort for commercial Teacher UX.
 */
export function extractHubBalanceHint(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const o = body as Record<string, unknown>
  const candidates = [
    o.balance,
    o.credits,
    o.remaining_credits,
    o.credit_balance,
    o.soft_limit_remaining,
    (o.data as Record<string, unknown> | undefined)?.balance,
    (o.data as Record<string, unknown> | undefined)?.credits,
  ]
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return String(c)
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return undefined
}
