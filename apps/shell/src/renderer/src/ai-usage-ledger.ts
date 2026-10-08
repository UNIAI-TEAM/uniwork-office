/**
 * Local AI usage ledger — one row per AI request (My AI / future sources).
 * Stored in Workbench SQLite via wbStore. Token/Credit are estimates until
 * the provider returns native usage on the stream.
 */
import { CREDITS_PER_USD, usdToCredits } from './credit-wallet'
import { wbStoreGetRaw, wbStoreSetRaw } from './workbench-store-client'

const KEY = 'uniwork.ai.usage.v1'
const MAX = 300

/** Rough chars→token heuristic (Latin/CJK mix). */
export const CHARS_PER_TOKEN = 4

/**
 * Blended mid-tier estimate: ~$2 / 1M tokens → Credit via CREDITS_PER_USD.
 * Mark rows `estimated: true` so UI can say “ước lượng”.
 */
export const EST_USD_PER_MILLION_TOKENS = 2

export type AiUsageSource = 'my-ai' | 'office' | 'other'

export interface AiUsageEntry {
  id: string
  at: string
  source: AiUsageSource
  provider?: string
  model?: string
  /** Short user-facing label */
  summary: string
  ok: boolean
  cancelled?: boolean
  promptChars: number
  completionChars: number
  estPromptTokens: number
  estCompletionTokens: number
  estTotalTokens: number
  /** Estimated USD spend for this turn */
  estUsd: number
  /** Estimated UniWork Credit (1 USD = 1000 Credit) */
  estCredits: number
  estimated: boolean
}

export function estimateTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN))
}

export function estimateUsdFromTokens(totalTokens: number): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0
  return (totalTokens / 1_000_000) * EST_USD_PER_MILLION_TOKENS
}

export function estimateCreditsFromTokens(totalTokens: number): number {
  return usdToCredits(estimateUsdFromTokens(totalTokens))
}

/** Keep fractional Credit for small turns (display with 1 decimal). */
export function estimateCreditsPrecise(totalTokens: number): number {
  const usd = estimateUsdFromTokens(totalTokens)
  if (!Number.isFinite(usd) || usd <= 0) return 0
  return Math.round(usd * CREDITS_PER_USD * 10) / 10
}

export function buildAiUsageEstimate(input: {
  promptChars: number
  completionChars: number
}): Pick<
  AiUsageEntry,
  | 'promptChars'
  | 'completionChars'
  | 'estPromptTokens'
  | 'estCompletionTokens'
  | 'estTotalTokens'
  | 'estUsd'
  | 'estCredits'
  | 'estimated'
> {
  const promptChars = Math.max(0, Math.floor(input.promptChars))
  const completionChars = Math.max(0, Math.floor(input.completionChars))
  const estPromptTokens = promptChars > 0 ? estimateTokensFromChars(promptChars) : 0
  const estCompletionTokens = completionChars > 0 ? estimateTokensFromChars(completionChars) : 0
  const estTotalTokens = estPromptTokens + estCompletionTokens
  const estUsd = estimateUsdFromTokens(estTotalTokens)
  const estCredits = estimateCreditsPrecise(estTotalTokens)
  return {
    promptChars,
    completionChars,
    estPromptTokens,
    estCompletionTokens,
    estTotalTokens,
    estUsd,
    estCredits,
    estimated: true,
  }
}

function readAll(): AiUsageEntry[] {
  try {
    const raw = wbStoreGetRaw(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as AiUsageEntry[]) : []
  } catch {
    return []
  }
}

function writeAll(entries: AiUsageEntry[]): void {
  wbStoreSetRaw(KEY, JSON.stringify(entries.slice(0, MAX)))
}

export function appendAiUsage(
  entry: Omit<AiUsageEntry, 'id' | 'at'> & { id?: string; at?: string },
): AiUsageEntry {
  const row: AiUsageEntry = {
    id: entry.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: entry.at ?? new Date().toISOString(),
    source: entry.source,
    ...(entry.provider ? { provider: entry.provider } : {}),
    ...(entry.model ? { model: entry.model } : {}),
    summary: entry.summary.slice(0, 200),
    ok: entry.ok,
    ...(entry.cancelled ? { cancelled: true } : {}),
    promptChars: entry.promptChars,
    completionChars: entry.completionChars,
    estPromptTokens: entry.estPromptTokens,
    estCompletionTokens: entry.estCompletionTokens,
    estTotalTokens: entry.estTotalTokens,
    estUsd: entry.estUsd,
    estCredits: entry.estCredits,
    estimated: entry.estimated,
  }
  writeAll([row, ...readAll()])
  try {
    window.dispatchEvent(new Event('uniwork:credit-refresh'))
  } catch {
    /* non-DOM test env */
  }
  return row
}

/** Record a completed turn from char counts (My AI / shell). */
export function recordAiTurnUsage(opts: {
  source: AiUsageSource
  summary: string
  system: string
  user: string
  completion?: string
  provider?: string
  model?: string
  ok: boolean
  cancelled?: boolean
}): AiUsageEntry {
  const promptChars = (opts.system?.length ?? 0) + (opts.user?.length ?? 0)
  const completionChars = opts.completion?.length ?? 0
  const est = buildAiUsageEstimate({ promptChars, completionChars })
  return appendAiUsage({
    source: opts.source,
    summary: opts.summary,
    ok: opts.ok,
    cancelled: opts.cancelled,
    provider: opts.provider,
    model: opts.model,
    ...est,
  })
}

export function listAiUsage(limit = 40): AiUsageEntry[] {
  return readAll().slice(0, Math.max(0, limit))
}

export function sumAiUsageCreditsSince(isoDayStart: string): number {
  const start = Date.parse(isoDayStart)
  if (!Number.isFinite(start)) return 0
  let sum = 0
  for (const e of readAll()) {
    if (!e.ok || e.cancelled) continue
    const t = Date.parse(e.at)
    if (!Number.isFinite(t) || t < start) continue
    sum += e.estCredits
  }
  return Math.round(sum * 10) / 10
}

export function localDayStartIso(now = new Date()): string {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function formatEstCredits(n: number, locale = 'en'): string {
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 1,
      minimumFractionDigits: n > 0 && n < 1 ? 1 : 0,
    }).format(n)
  } catch {
    return String(n)
  }
}
