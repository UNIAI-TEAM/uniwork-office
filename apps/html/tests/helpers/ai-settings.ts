import { defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'

/**
 * What a preload bridge answers to getAiSettings in panel tests: a complete settings object on
 * UniWork AI, the one provider (UNI-2309). A bare `undefined` is not a value any host returns, and
 * the model chip reads fields of it (the served model) to show its text.
 */
export function usableAiSettings(): AiSettings {
  return defaultAiSettings()
}
