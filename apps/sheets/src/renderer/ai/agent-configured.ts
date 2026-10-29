import type { AiSettings } from '@genoffice/ai-provider/browser'

/**
 * True when the Sheets agent can send a request with the current AI settings: UniWork AI as it is;
 * any other provider once its slot names a model and, except the built-in UniAI (`genspark`), holds
 * a key. A web frame names UniWork AI only and gets no provider key (UNI-2289).
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
