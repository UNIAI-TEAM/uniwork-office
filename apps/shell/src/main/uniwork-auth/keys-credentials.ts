import { AI_PROVIDERS, type AiProviderId } from '@genoffice/ai-provider'

/** R1 credential list parsing, signatures and R5 cache stamps (contract §2.1, §6.1). */

/** Providers that can hold a personal BYOK key on UniWork (excludes CLI and cloud-only ids). */
export const ORG_KEY_PROVIDER_IDS: ReadonlySet<string> = new Set(
  AI_PROVIDERS.map((p) => p.id).filter(
    (id) => id !== 'uniwork' && id !== 'codex' && id !== 'genspark',
  ),
)

export interface UniworkByokStatus {
  readonly enabled: boolean
  readonly reason: string
}

export interface UniworkCredentialItem {
  readonly provider: AiProviderId
  readonly label: string
  readonly baseUrl: string
  readonly keyHint: string
  readonly defaultModel: string
  readonly model: string
  readonly modelUpdatedAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface UniworkCredentialsResponse {
  readonly items: readonly UniworkCredentialItem[]
  readonly byok: UniworkByokStatus
  /** True only when the server response carried the additive `byok` object (D1+). */
  readonly hasByok: boolean
}

/** Extracts model IDs from a vendor's `/models` JSON payload (`data[].id` or `models[].name`). */
export function parseProxyModelIds(body: unknown): string[] {
  const b = (body ?? {}) as { data?: unknown; models?: unknown }
  const rows = Array.isArray(b.data) ? b.data : Array.isArray(b.models) ? b.models : []
  const ids = rows.map((row) => {
    const r = (row ?? {}) as { id?: unknown; name?: unknown }
    const raw = typeof r.id === 'string' ? r.id : typeof r.name === 'string' ? r.name : ''
    return raw.replace(/^models\//, '').trim()
  })
  return [...new Set(ids.filter(Boolean))]
}

export const EMPTY_CREDENTIALS: UniworkCredentialsResponse = Object.freeze({
  items: Object.freeze([]),
  byok: Object.freeze({ enabled: false, reason: '' }),
  hasByok: false,
})

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Parses R1 (`GET /api/v1/orgs/{orgId}/ai/credentials`).
 * Older servers that omit `byok` resolve to `hasByok: false, byok.enabled: false` so
 * the desktop exposes no org sources (§2.1, §6.3).
 */
export function parseCredentialsResponse(raw: unknown): UniworkCredentialsResponse {
  if (!isRecord(raw)) return EMPTY_CREDENTIALS
  const rawByok = raw.byok
  if (!isRecord(rawByok) || typeof rawByok.enabled !== 'boolean') {
    return EMPTY_CREDENTIALS
  }
  const byok: UniworkByokStatus = {
    enabled: rawByok.enabled === true,
    reason: typeof rawByok.reason === 'string' ? rawByok.reason : '',
  }
  const requiresBaseUrl = new Set<string>(['custom'])
  if (Array.isArray(raw.providers)) {
    for (const p of raw.providers) {
      if (isRecord(p) && typeof p.id === 'string' && p.requires_base_url === true) {
        requiresBaseUrl.add(p.id)
      }
    }
  }
  const items: UniworkCredentialItem[] = []
  const seen = new Set<string>()
  const rawItems = Array.isArray(raw.items) ? raw.items : []
  for (const entry of rawItems) {
    if (!isRecord(entry) || typeof entry.provider !== 'string') continue
    const provider = entry.provider.trim()
    if (!ORG_KEY_PROVIDER_IDS.has(provider) || seen.has(provider)) continue
    const baseUrl = typeof entry.base_url === 'string' ? entry.base_url.trim() : ''
    if (requiresBaseUrl.has(provider) && !baseUrl) continue
    const serverModel =
      typeof entry.default_model === 'string' && entry.default_model.trim()
        ? entry.default_model.trim()
        : typeof entry.model === 'string'
          ? entry.model.trim()
          : ''
    seen.add(provider)
    items.push({
      provider: provider as AiProviderId,
      label: typeof entry.label === 'string' ? entry.label : '',
      baseUrl,
      keyHint: typeof entry.key_hint === 'string' ? entry.key_hint : '',
      defaultModel: serverModel,
      model: serverModel,
      modelUpdatedAt: typeof entry.model_updated_at === 'string' ? entry.model_updated_at : '',
      createdAt: typeof entry.created_at === 'string' ? entry.created_at : '',
      updatedAt: typeof entry.updated_at === 'string' ? entry.updated_at : '',
    })
  }
  return { items, byok, hasByok: true }
}

export function credentialSignature(resp: UniworkCredentialsResponse): string {
  if (!resp.hasByok || !resp.byok.enabled) return `off:${resp.byok.reason}`
  return resp.items
    .map(
      (c) =>
        `${c.provider}:${c.keyHint}:${c.baseUrl}:${c.updatedAt}:${c.model}:${c.modelUpdatedAt}`,
    )
    .sort()
    .join('|')
}

export function stampOf(item: UniworkCredentialItem): string {
  return `${item.keyHint}:${item.baseUrl}:${item.updatedAt}`
}
