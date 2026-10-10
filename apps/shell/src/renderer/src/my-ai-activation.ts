/**
 * First-run / no-model detection for My AI soft messaging.
 * Default install ships UniAI with an empty key — treat that as a setup state
 * (add your own AI key) rather than a raw API-key configuration error. The text
 * follows the organization plan state; it never offers a purchase in the app.
 */
import type { AiSettings, UniworkCloudState } from '@genoffice/ai-provider/browser'
import {
  aiNoticeKind,
  aiNoticeKindForCloud,
  aiNoticeText,
  uniAiOpenRouterKey,
} from '@genoffice/ai-provider/browser'

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

/** Match main-process errNoApiKey (any locale), the product notices and common English fallbacks. */
export function looksLikeMissingAiActivation(error: string): boolean {
  const e = error.trim()
  if (!e) return false
  if (aiNoticeKind(e)) return true
  return /API\s*[Kk]ey|api key|khóa API|API Key|未配置|未設定|API キー|API 키|clé API|API-Schlüssel|clave de API|API-ключ|مفتاح API|chave de API|chiave API|klucza API|API-sleutel|מפתח API|API कुंजी|kích hoạt|mua gói AI|not activated|purchase an AI/i.test(
    e,
  )
}

/** the notice for "nothing to chat with", by what the organization plan says about cloud AI */
export function softAiActivationMessage(
  vi: boolean,
  cloudState: UniworkCloudState = 'signed-out',
): string {
  return aiNoticeText(aiNoticeKindForCloud(cloudState), vi ? 'vi' : 'en')
}

/** the action on that notice: it opens the AI model settings (keys are added there) */
export function openAiSettingsLabel(vi: boolean): string {
  return vi ? 'Mở cài đặt AI' : 'Open AI settings'
}
