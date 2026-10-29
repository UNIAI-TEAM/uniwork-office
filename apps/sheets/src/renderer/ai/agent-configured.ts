import type { AiSettings } from '@genoffice/ai-provider/browser'

/**
 * True when the Sheets agent can send a request with the current AI settings. A web frame names
 * UniWork AI only (UNI-2289); a provider key never reaches it, so any other provider is not ready there.
 */
export function agentConfigured(settings: AiSettings | null | undefined): boolean {
  if (!settings) return false
  // UniWork AI has no key and no model choice here: the server's policy picks the model
  if (settings.provider === 'uniwork') return true
  const config = settings.providers[settings.provider]
  if (!config?.model) return false
  // the built-in UniAI provider's key never lands in the settings file; the
  // main process injects it. Missing access surfaces as a request error.
  return settings.provider === 'genspark' || !!config.apiKey
}
