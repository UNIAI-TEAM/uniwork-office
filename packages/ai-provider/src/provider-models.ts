// Live model lists for the desktop model chip: each provider's own `/models`,
// fetched with the person's local key (the app talks to the vendor directly, as
// it does for chat; UniWork never sees the key). The chip shows the list under
// the Settings pick and keeps the hard-coded catalog as the fallback.
//
// Same stance as `listCustomModels`, which this generalises to the Anthropic and
// Gemini wire shapes: not `aiFetch` (its rescue retry and warning are right for a
// chat turn and wrong for a background probe), a 5 s cut, a 2 MiB cap, and never
// a throw. Unlike it, the answer says whether the listing worked, because the
// chip tells "nothing listed" from "could not list".
import { createHash } from 'node:crypto'
import type { AiProviderConfig, AiProviderId } from './types'
import { withUserAgent } from './fetch'
import { getProviderAdapter } from './registry'
import { endpointUrl, readCappedResponseText } from './protocols/shared'
import { createStreamWatchdog } from './watchdog'

/** a vendor this slow is not usable for chat either, and the chip must stay responsive */
const REQUEST_TIMEOUT_MS = 5000

/** ids past this are dropped; the chip caps what it shows far below this */
const MAX_MODELS = 2000

/** a model list is a few hundred KB at worst; past this the endpoint is not what it claims */
const MAX_BODY_BYTES = 2 * 1024 * 1024

/** a list is reused this long before the next chip read lists again */
export const PROVIDER_MODELS_TTL_MS = 10 * 60 * 1000

/** a failed listing is retried sooner, but not on every chip open */
export const PROVIDER_MODELS_FAILURE_TTL_MS = 60 * 1000

export interface ProviderModelListing {
  /** false = the listing failed (or was not possible); true with no ids = the vendor listed nothing */
  readonly ok: boolean
  readonly ids: string[]
}

const FAILED: ProviderModelListing = { ok: false, ids: [] }

/** codex lists through its app-server and UniWork AI has no key of its own */
function listable(provider: AiProviderId, config: AiProviderConfig | undefined): boolean {
  if (!config || provider === 'codex' || provider === 'uniwork') return false
  if (config.apiKey.trim()) return true
  // a user-hosted endpoint usually needs no key, but it does need an address
  return provider === 'custom' && !!config.baseUrl?.trim()
}

function cleanIds(raw: unknown[]): string[] {
  const seen = new Set<string>()
  for (const id of raw) {
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (trimmed) seen.add(trimmed)
    if (seen.size >= MAX_MODELS) break
  }
  return [...seen]
}

function openAiIds(body: unknown): string[] | null {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return null
  return cleanIds(data.map((entry) => (entry as { id?: unknown } | null)?.id))
}

function geminiIds(body: unknown): string[] | null {
  const models = (body as { models?: unknown } | null)?.models
  if (!Array.isArray(models)) return null
  const names = models.map((entry) => {
    const item = entry as { name?: unknown; supportedGenerationMethods?: unknown } | null
    const methods = item?.supportedGenerationMethods
    // embedding / AQA models are listed too; a model that names its methods must be able to chat
    if (Array.isArray(methods) && !methods.includes('generateContent')) return undefined
    return typeof item?.name === 'string' ? item.name.replace(/^models\//, '') : undefined
  })
  return cleanIds(names)
}

/**
 * The model ids one provider advertises.
 *
 * Never throws: an unlistable provider, an unusable base URL, a refusal, an
 * unreachable, slow, oversized, non-JSON or wrongly shaped answer all return
 * `{ ok: false, ids: [] }`. Server order is kept; blank, repeated and non-string
 * ids are dropped. `config.model` is ignored: the endpoint is resolved model-less.
 */
export async function listProviderModels(
  provider: AiProviderId,
  config: AiProviderConfig,
): Promise<ProviderModelListing> {
  if (!listable(provider, config)) return FAILED
  const key = config.apiKey.trim()
  const watchdog = createStreamWatchdog(undefined, REQUEST_TIMEOUT_MS)
  try {
    const endpoint = getProviderAdapter(provider).resolveEndpoint({ ...config, model: '' })
    const headers: Record<string, string> = { Accept: 'application/json' }
    let target: string
    let read: (body: unknown) => string[] | null
    if (endpoint.protocol === 'anthropic') {
      target = endpointUrl(endpoint.baseUrl, 'v1/models', '?limit=1000')
      headers['x-api-key'] = key
      headers['anthropic-version'] = '2023-06-01'
      read = openAiIds
    } else if (endpoint.protocol === 'gemini') {
      target = endpointUrl(endpoint.baseUrl, 'models', '?pageSize=1000')
      headers['x-goog-api-key'] = key
      read = geminiIds
    } else if (endpoint.protocol === 'openai-compatible') {
      target = endpointUrl(endpoint.baseUrl, 'models')
      // an empty `Bearer ` is a malformed credential that strict servers reject
      if (key) headers.Authorization = `Bearer ${key}`
      read = openAiIds
    } else {
      return FAILED
    }
    return await watchdog.guard(async () => {
      const response = await fetch(target, withUserAgent({ headers, signal: watchdog.signal }))
      if (!response.ok) return FAILED
      const text = await readCappedResponseText(response, { maxBytes: MAX_BODY_BYTES })
      const ids = read(JSON.parse(text))
      return ids ? { ok: true, ids } : FAILED
    })
  } catch {
    return FAILED
  }
}

/** what one chip read needs from the cache; both fields absent = nothing listed, nothing to say */
export interface ProviderModelSnapshot {
  readonly listed?: readonly string[]
  readonly listState?: 'loading' | 'error'
}

interface CacheEntry {
  /** base URL + SHA-256 of the key: the key itself is never stored as a map key */
  fingerprint: string
  at: number
  ids: string[] | undefined
  /** a listing has answered at least once for this fingerprint */
  settled: boolean
  /** the last answer was a failure */
  failed: boolean
  inflight: boolean
}

export interface ProviderModelCacheOptions {
  ttlMs?: number
  failureTtlMs?: number
  list?: typeof listProviderModels
  now?: () => number
}

/**
 * Main-process cache of the live lists, one entry per provider keyed by
 * (baseUrl, key hash). `read` is synchronous: it answers from what is cached and
 * starts a background listing when the entry is missing or older than its TTL,
 * then calls `onSettled` once the answer lands so the caller can announce it.
 *
 * `listState` follows the chip's needs: `loading` only while no listing has
 * answered yet, `error` only when the last listing failed and no list is kept.
 * A refresh over an existing list, or a failed refresh, leaves the list as is.
 */
export class ProviderModelCache {
  private readonly entries = new Map<AiProviderId, CacheEntry>()
  private readonly ttlMs: number
  private readonly failureTtlMs: number
  private readonly list: typeof listProviderModels
  private readonly now: () => number

  constructor(options: ProviderModelCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? PROVIDER_MODELS_TTL_MS
    this.failureTtlMs = options.failureTtlMs ?? PROVIDER_MODELS_FAILURE_TTL_MS
    this.list = options.list ?? listProviderModels
    this.now = options.now ?? Date.now
  }

  read(
    provider: AiProviderId,
    config: AiProviderConfig | undefined,
    onSettled: () => void,
  ): ProviderModelSnapshot {
    if (!config || !listable(provider, config)) {
      this.entries.delete(provider)
      return {}
    }
    const fingerprint = `${config.baseUrl?.trim() ?? ''}\0${createHash('sha256').update(config.apiKey.trim()).digest('hex')}`
    let entry = this.entries.get(provider)
    if (!entry || entry.fingerprint !== fingerprint) {
      entry = { fingerprint, at: 0, ids: undefined, settled: false, failed: false, inflight: false }
      this.entries.set(provider, entry)
    }
    const ttl = entry.failed ? this.failureTtlMs : this.ttlMs
    if (!entry.inflight && (!entry.settled || this.now() - entry.at > ttl)) {
      this.start(provider, config, entry, onSettled)
    }
    if (entry.ids && entry.ids.length > 0) return { listed: [...entry.ids] }
    if (!entry.settled) return { listState: 'loading' }
    return entry.failed ? { listState: 'error' } : {}
  }

  /** drop one provider's list so the next read lists again */
  forget(provider: AiProviderId): void {
    this.entries.delete(provider)
  }

  private start(
    provider: AiProviderId,
    config: AiProviderConfig,
    entry: CacheEntry,
    onSettled: () => void,
  ): void {
    entry.inflight = true
    void this.list(provider, config)
      .catch(() => FAILED)
      .then((result) => {
        // the key or address changed while this ran: the new entry lists for itself
        if (this.entries.get(provider) !== entry) return
        entry.inflight = false
        entry.settled = true
        entry.at = this.now()
        if (result.ok) {
          entry.ids = result.ids
          entry.failed = false
        } else {
          // a failed refresh keeps the list it already has
          entry.failed = true
        }
        try {
          onSettled()
        } catch {
          // the announcement is best effort; the answer is cached either way
        }
      })
  }
}
