import { isOrgServedReady, type AiSettings } from '@genoffice/ai-provider/browser'

/**
 * True when the Sheets agent can send a request with the current AI settings.
 * `webCredentials` is the web frame, where the keys live in UniWork and never reach the page.
 */
export function agentConfigured(settings: AiSettings | null | undefined, webCredentials: boolean) {
  if (!settings) return false
  // UniWork AI has no key and no model choice here: the server's policy picks the model
  if (settings.provider === 'uniwork') return true
  // a key saved on UniWork serves the provider: main routes the call and the slot holds no key
  if (isOrgServedReady(settings, settings.provider)) return true
  const config = settings.providers[settings.provider]
  if (!config?.model) return false
  // web: the keys live in UniWork and never reach the frame (`apiKey` is always ''); a missing
  // or refused key comes back as a typed state card (credential_missing, provider_auth_failed)
  if (webCredentials) return true
  // the built-in UniAI provider's key never lands in the settings file; the
  // main process injects it. Missing access surfaces as a request error.
  return settings.provider === 'genspark' || !!config.apiKey
}
