import { uniworkAiAvailable, type AiSettings } from '@genoffice/ai-provider/browser'

/**
 * True when the Sheets agent can send a request: UniWork AI, the one provider, while the host
 * offers it (signed in, the organization and the format with UniWork AI). Otherwise Sheets runs
 * its fixed planner, which needs no model.
 */
export function agentConfigured(settings: AiSettings | null | undefined): boolean {
  return settings?.provider === 'uniwork' && uniworkAiAvailable()
}
