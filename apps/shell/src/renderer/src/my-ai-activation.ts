/**
 * First-run / unactivated AI detection for My AI soft messaging.
 * Default install ships UniAI (genspark) with an empty Token Hub key — treat
 * that as “not activated” rather than a raw API-key configuration error.
 */
import type { AiSettings } from '@genoffice/ai-provider/browser'
import { uniAiOpenRouterKey } from '@genoffice/ai-provider/browser'

/** True when the active provider can actually send a request. */
export function aiSettingsReady(settings: AiSettings): boolean {
  const provider = settings.provider
  if (provider === 'codex') return true
  if (provider === 'genspark' || provider === 'openrouter') {
    return Boolean(uniAiOpenRouterKey(settings))
  }
  const cfg = settings.providers?.[provider]
  if (!cfg) return false
  if (cfg.apiKey?.trim()) return true
  // Custom OpenAI-compatible endpoints may omit a key when baseUrl is set.
  if (provider === 'custom' && cfg.baseUrl?.trim() && cfg.model?.trim()) return true
  return false
}

/** Match main-process errNoApiKey (any locale) and common English fallbacks. */
export function looksLikeMissingAiActivation(error: string): boolean {
  const e = error.trim()
  if (!e) return false
  return /API\s*[Kk]ey|api key|khóa API|API Key|未配置|未設定|API キー|API 키|clé API|API-Schlüssel|clave de API|API-ключ|مفتاح API|chave de API|chiave API|klucza API|API-sleutel|מפתח API|API कुंजी|kích hoạt|mua gói AI|not activated|purchase an AI/i.test(
    e,
  )
}

export function softAiActivationMessage(vi: boolean): string {
  return vi
    ? 'Chưa kích hoạt / mua gói AI. Hãy mua gói để dùng Trợ lý AI.'
    : 'AI is not activated. Purchase a plan to use the AI assistant.'
}

export function buyAiPlanLabel(vi: boolean): string {
  return vi ? 'Mua gói AI' : 'Buy AI plan'
}
