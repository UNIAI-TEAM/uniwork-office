import { defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'

/**
 * What a preload bridge answers to getAiSettings in panel tests: a complete settings object whose
 * chosen provider can send. A bare `undefined` is not a value any host returns, and the model
 * picker reads fields of it (provider, its key and model) to decide the chip and the hint.
 */
export function usableAiSettings(): AiSettings {
  const settings = { ...defaultAiSettings(), uniAiAvailable: false, provider: 'openai' as const }
  settings.providers.openai = {
    ...settings.providers.openai,
    apiKey: 'test-key',
    model: 'gpt-test',
  }
  return settings
}
