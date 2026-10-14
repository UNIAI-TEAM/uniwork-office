import {
  AI_PROVIDERS,
  isProviderUsable,
  providerNeed,
  selectedProvider,
  uniAiOpenRouterKey,
  type AiProviderId,
  type AiSettings,
} from '@genoffice/ai-provider/browser'

export interface AiModelPickerGroup {
  readonly id: AiProviderId
  readonly label: string
  readonly models: readonly string[]
}

export interface AiModelPickerSelection {
  readonly provider: AiProviderId
  readonly model: string
}

/**
 * Providers the composer chip may switch to: UniAI once its Token Hub key is
 * set (or while a cloud sign-in is reported), every
 * other vendor once its settings pass the same usability test the chat path
 * applies (`isProviderUsable`), so picking a row never lands on a 401. A model
 * typed into the settings page that is not in the catalog is listed first.
 */
export function aiModelPickerGroups(
  settings: AiSettings,
  gskLoggedIn: boolean,
): AiModelPickerGroup[] {
  const groups: AiModelPickerGroup[] = []
  for (const meta of AI_PROVIDERS) {
    const config = settings.providers?.[meta.id]
    const stored = config?.model?.trim() ?? ''
    // CLI vendors pass isProviderUsable unconfigured (the binary auto-discovers);
    // list them only once the settings page holds a model or a path
    const usable =
      meta.id === 'genspark'
        ? settings.uniAiAvailable !== false && (gskLoggedIn || uniAiOpenRouterKey(settings) !== '')
        : meta.needsCliPath
          ? Boolean(stored || config?.cliPath?.trim())
          : isProviderUsable(settings, meta.id)
    if (!usable) continue
    const models = stored && !meta.models.includes(stored) ? [stored, ...meta.models] : meta.models
    if (models.length === 0 && !meta.needsCliPath && meta.id !== 'uniwork') continue
    groups.push({ id: meta.id, label: meta.label, models })
  }
  return groups
}

/**
 * The chosen provider, even while its config is incomplete: the chip then reads
 * "Choose model" and `aiModelPickerNeed` says what is missing, instead of the
 * selection silently turning into UniAI.
 */
export function aiModelPickerSelection(settings: AiSettings): AiModelPickerSelection {
  const provider = selectedProvider(settings)
  const meta = AI_PROVIDERS.find((m) => m.id === provider)
  const model = settings.providers?.[provider]?.model?.trim() || meta?.defaultModel || ''
  return { provider, model }
}

/**
 * What the chosen vendor still lacks before a request can go out: 'model' (no model
 * id), 'base-url' (a custom endpoint without its server URL; its key is optional) or
 * 'key' (no API key). null for a usable selection and for UniAI, whose access is the
 * cloud account.
 */
export function aiModelPickerNeed(settings: AiSettings): 'key' | 'model' | 'base-url' | null {
  return providerNeed(settings, selectedProvider(settings))
}

export function withAiModelSelection(
  settings: AiSettings,
  pick: AiModelPickerSelection,
): AiSettings {
  const config = settings.providers[pick.provider] ?? { apiKey: '', model: '' }
  return {
    ...settings,
    provider: pick.provider,
    providers: { ...settings.providers, [pick.provider]: { ...config, model: pick.model } },
  }
}
