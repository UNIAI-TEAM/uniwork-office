import {
  AI_PROVIDERS,
<<<<<<< ours
  isProviderUsable,
  providerNeed,
  selectedProvider,
  uniAiOpenRouterKey,
  uniworkAiAvailable,
  type AiModelSource,
=======
  activeProvider,
  customEndpointLabel,
  resolveCustomEndpoints,
  upsertCustomEndpoint,
>>>>>>> theirs
  type AiProviderId,
  type AiSettings,
} from '@genoffice/ai-provider/browser'

export interface AiModelPickerGroup {
  readonly id: AiProviderId
  /** set on custom groups: one group per saved endpoint */
  readonly endpoint?: string | undefined
  readonly label: string
  readonly models: readonly string[]
  /** text of the row for an empty model id: the group label, or the model UniWork AI serves once known */
  readonly rowLabel: string
  /** the host's listing state for this group (absent = ok or not asked): the catalog is shown meanwhile */
  readonly listState?: 'loading' | 'error' | undefined
}

/** live ids shown per group; the rest is reachable through Manage models (Q-M4) */
export const AI_MODEL_PICKER_LIVE_CAP = 25

export interface AiModelPickerSelection {
  readonly provider: AiProviderId
  readonly endpoint?: string | undefined
  readonly model: string
}

/**
 * Rows of one group, in order: the model chosen in Settings (and the one the host selected, when
 * it differs), then the provider's live list (catalog ids it confirms first, the rest A to Z,
 * capped), else the hard-coded catalog. The catalog is only the fallback: no list, an empty list
 * or a failed listing. A chosen id the live list lacks is still shown.
 */
function groupModels(
  catalog: readonly string[],
  stored: string,
  source: AiModelSource | undefined,
): readonly string[] {
  const chosen = source?.chosen?.trim() ?? ''
  const head = [...new Set([chosen || stored, stored].filter((id) => id !== ''))]
  const live =
    source && source.listState !== 'error'
      ? [
          ...new Set((source.listed ?? []).map((id) => (typeof id === 'string' ? id.trim() : ''))),
        ].filter((id) => id !== '')
      : []
  if (live.length === 0) {
    // today's list: an off-catalog pick (typed in Settings) goes first
    const first = head.filter((id) => !catalog.includes(id))
    return first.length > 0 ? [...first, ...catalog] : catalog
  }
  const known = new Set(catalog)
  const confirmed = catalog.filter((id) => live.includes(id))
  const others = live.filter((id) => !known.has(id)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const listed = [...confirmed, ...others].filter((id) => !head.includes(id))
  return [...head, ...listed.slice(0, AI_MODEL_PICKER_LIVE_CAP)]
}

/**
 * Providers the composer chip may switch to: UniAI once its Token Hub key is
 * set (or while a cloud sign-in is reported), every
 * other vendor once its settings pass the same usability test the chat path
 * applies (`isProviderUsable`), so picking a row never lands on a 401. The rows
 * come from the host's model sources (`groupModels`); sources of providers that
 * are not usable or not in the catalog of providers are ignored.
 */
export function aiModelPickerGroups(input: AiSettings, gskLoggedIn: boolean): AiModelPickerGroup[] {
  const settings = resolveCustomEndpoints(input)
  const groups: AiModelPickerGroup[] = []
  for (const meta of AI_PROVIDERS) {
    if (meta.id === 'custom') {
      for (const ep of settings.customEndpoints ?? []) {
        if (!ep.baseUrl || !ep.model) continue
        // Declared models come before a server probe's answer: a profile entry
        // is the user's own list, which outranks what the server advertised
        // (a server that no longer serves an id the user pinned keeps it
        // selectable). The configured model is pinned to the top, as before.
        const ids = [ep.model, ...(ep.modelProfiles ?? []).map((m) => m.id), ...(ep.models ?? [])]
        const seen = new Set<string>()
        const models = ids.filter((m) => {
          if (!m || seen.has(m)) return false
          seen.add(m)
          return true
        })
        groups.push({
          id: meta.id,
          endpoint: ep.id,
          label: customEndpointLabel(ep, meta.label),
          models,
        })
      }
      continue
    }
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
    const source = settings.modelSources?.[meta.id]
    const models = groupModels(meta.models, stored, source)
    // UniWork AI has no model ids: its one row is the served model (or its label)
    if (models.length === 0 && !meta.needsCliPath && meta.id !== 'uniwork') continue
    const served = meta.id === 'uniwork' ? (settings.uniworkModel?.trim() ?? '') : ''
    groups.push({
      id: meta.id,
      label: meta.label,
      models,
      rowLabel: served || meta.label,
      ...(source?.listState ? { listState: source.listState } : {}),
    })
  }
  return groups
}

<<<<<<< ours
/**
 * The chosen provider, even while its config is incomplete: the chip then reads
 * "Choose model" and `aiModelPickerNeed` says what is missing, instead of the
 * selection silently turning into UniAI.
 */
export function aiModelPickerSelection(settings: AiSettings): AiModelPickerSelection {
  const provider = settings.provider === 'uniwork' ? 'uniwork' : selectedProvider(settings)
=======
export function aiModelPickerSelection(input: AiSettings): AiModelPickerSelection {
  const settings = resolveCustomEndpoints(input)
  const provider = activeProvider(settings)
>>>>>>> theirs
  const meta = AI_PROVIDERS.find((m) => m.id === provider)
  const model = settings.providers?.[provider]?.model?.trim() || meta?.defaultModel || ''
  if (provider === 'custom' && settings.customEndpoint) {
    return { provider, endpoint: settings.customEndpoint, model }
  }
  return { provider, model }
}

<<<<<<< ours
/**
 * What the chosen vendor still lacks before a request can go out: 'model' (no model
 * id), 'base-url' (a custom endpoint without its server URL; its key is optional) or
 * 'key' (no API key). null for a usable selection and for UniAI, whose access is the
 * cloud account. When `uniwork` is selected while unavailable, returns 'model' so the
 * composer shows "Choose model" + needModel hint instead of silently falling back to UniAI.
 */
export function aiModelPickerNeed(settings: AiSettings): 'key' | 'model' | 'base-url' | null {
  if (settings.provider === 'uniwork') {
    return uniworkAiAvailable() ? null : 'model'
  }
  return providerNeed(settings, selectedProvider(settings))
}

export function withAiModelSelection(
  settings: AiSettings,
  pick: AiModelPickerSelection,
): AiSettings {
=======
export function withAiModelSelection(input: AiSettings, pick: AiModelPickerSelection): AiSettings {
  const settings = resolveCustomEndpoints(input)
  if (pick.provider === 'custom' && pick.endpoint) {
    const ep = settings.customEndpoints?.find((e) => e.id === pick.endpoint)
    if (ep) {
      return {
        ...upsertCustomEndpoint(settings, { ...ep, model: pick.model }, true),
        provider: 'custom',
      }
    }
  }
>>>>>>> theirs
  const config = settings.providers[pick.provider] ?? { apiKey: '', model: '' }
  return {
    ...settings,
    provider: pick.provider,
    providers: { ...settings.providers, [pick.provider]: { ...config, model: pick.model } },
  }
}
