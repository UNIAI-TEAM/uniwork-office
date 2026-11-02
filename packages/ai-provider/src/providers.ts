import { uniworkCloudEnabled } from './uniwork-cloud'
import type { AiSettings } from './types'

/**
 * UniWork AI (the `uniwork` provider), the only AI provider. No key, no model choice: the
 * server's policy picks the model, and it may only be offered where the server offers it
 * (signed in, plan entitlement, `tools.chat`, the organization/format capability).
 */
export const UNIWORK_PROVIDER_META = { id: 'uniwork', label: 'UniWork AI' } as const

let uniworkAvailable = false

/** UniWork AI is offered in this process (the host evaluates the S7 conditions) */
export function uniworkAiAvailable(): boolean {
  return uniworkAvailable
}

/**
 * The host's availability flag for UniWork AI (desktop: cloud ready with
 * `tools.chat`, the `ai_uniwork` capability and the module format; web: the
 * `uniworkAi` grant). While it is off the panels show the S7 unavailable state
 * with Send blocked.
 */
export function setUniworkAiAvailable(available: boolean): void {
  uniworkAvailable = available
}

/** Fresh settings: UniWork AI with the cloud tools on. */
export function defaultAiSettings(): AiSettings {
  return { provider: 'uniwork', providers: {}, gskToolsEnabled: true }
}

/**
 * The only shape ai-settings.json may hold: UniWork AI is the one provider, so the file keeps the
 * `gskToolsEnabled` opt-out and nothing else. Every other key (provider keys, base URLs, CLI paths,
 * media/search keys, legacy root-level key fields) is dropped. `providers: {}` keeps the file in
 * the AiSettings shape older builds read.
 */
export function aiSettingsFileOf(raw: unknown): {
  provider: 'uniwork'
  providers: Record<string, never>
  gskToolsEnabled?: boolean
} {
  const gsk = isRecord(raw) ? raw.gskToolsEnabled : undefined
  return {
    provider: 'uniwork',
    providers: {},
    ...(typeof gsk === 'boolean' ? { gskToolsEnabled: gsk } : {}),
  }
}

/**
 * UniWork cloud tools are reachable only while signed in + entitled (uniwork-cloud.ts); then
 * false only on an explicit opt-out (absent, from pre-toggle settings files, means on).
 */
export function cloudToolsEnabled(settings: Pick<AiSettings, 'gskToolsEnabled'>): boolean {
  return uniworkCloudEnabled() && settings.gskToolsEnabled !== false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Settings from a parsed settings file (this function does no file I/O): only the boolean
 * cloud-tools opt-out is read over `defaults`; every other stored field is ignored.
 */
export function resolveAiSettings(stored: unknown, defaults: AiSettings): AiSettings {
  const gsk = isRecord(stored) ? stored.gskToolsEnabled : undefined
  return typeof gsk === 'boolean' ? { ...defaults, gskToolsEnabled: gsk } : defaults
}
