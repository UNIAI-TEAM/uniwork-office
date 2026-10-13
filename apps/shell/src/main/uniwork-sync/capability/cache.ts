/**
 * Per-org cache of `GET /api/v1/orgs/{orgID}/office/capabilities`.
 *
 * - A read lives `ttl_seconds` (0, missing or invalid -> 300 s); `get` inside
 *   the TTL answers from the cache without a request unless `force`.
 * - A failed refresh (5xx, malformed body, offline) inside the TTL keeps the
 *   cached value as is; after the TTL it keeps the last G5 capabilities
 *   (`sync_feed`, `sync_write`, `offline_library`) but turns `ai_uniwork` off.
 * - Never read -> `sync_write` on, feed / offline library / AI off.
 * - 401 -> `session_expired` (with the same degraded capabilities).
 * - Entries are keyed by org id and never applied to another org.
 */

export interface OfficeCapabilities {
  sync_feed: boolean
  sync_write: boolean
  offline_library: boolean
  ai_uniwork: boolean
  ai_uniwork_formats: string[]
}

export type CapabilitySource = 'fresh' | 'cached' | 'stale' | 'default'

export type CapabilityRead =
  | { kind: 'ok'; capabilities: OfficeCapabilities; source: CapabilitySource }
  | { kind: 'session_expired'; capabilities: OfficeCapabilities; source: CapabilitySource }

/** status + parsed body (undefined when it is not JSON); a rejection means offline */
export type CapabilityFetch = (orgId: string) => Promise<{ status: number; body: unknown }>

export interface CapabilityClock {
  now(): number
}

export interface CapabilityCacheOptions {
  fetch: CapabilityFetch
  clock: CapabilityClock
}

export const DEFAULT_CAPABILITY_TTL_SECONDS = 300
/** a server TTL past a day is clamped so a typo cannot pin a flag for weeks */
const MAX_CAPABILITY_TTL_SECONDS = 24 * 60 * 60

export const NEVER_READ_CAPABILITIES: Readonly<OfficeCapabilities> = Object.freeze({
  sync_feed: false,
  sync_write: true,
  offline_library: false,
  ai_uniwork: false,
  ai_uniwork_formats: [],
})

interface Entry {
  capabilities: OfficeCapabilities
  expiresAt: number
}

export function parseCapabilities(
  body: unknown,
): { capabilities: OfficeCapabilities; ttlSeconds: number } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const raw = body as Record<string, unknown>
  const flags = ['sync_feed', 'sync_write', 'offline_library', 'ai_uniwork'] as const
  if (flags.some((flag) => typeof raw[flag] !== 'boolean')) return null
  const formats = raw.ai_uniwork_formats ?? []
  if (!Array.isArray(formats) || formats.some((format) => typeof format !== 'string')) return null
  const ttl = raw.ttl_seconds
  const ttlSeconds =
    typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0
      ? Math.min(ttl, MAX_CAPABILITY_TTL_SECONDS)
      : DEFAULT_CAPABILITY_TTL_SECONDS
  return {
    capabilities: {
      sync_feed: raw.sync_feed as boolean,
      sync_write: raw.sync_write as boolean,
      offline_library: raw.offline_library as boolean,
      ai_uniwork: raw.ai_uniwork as boolean,
      ai_uniwork_formats: [...(formats as string[])],
    },
    ttlSeconds,
  }
}

const copy = (capabilities: OfficeCapabilities): OfficeCapabilities => ({
  ...capabilities,
  ai_uniwork_formats: [...capabilities.ai_uniwork_formats],
})

export class CapabilityCache {
  private readonly options: CapabilityCacheOptions
  private readonly entries = new Map<string, Entry>()
  private readonly inFlight = new Map<string, Promise<CapabilityRead>>()
  /** bumped by clear(): a read that started before it never lands in the cache */
  private generation = 0

  constructor(options: CapabilityCacheOptions) {
    this.options = options
  }

  get(orgId: string, options: { force?: boolean } = {}): Promise<CapabilityRead> {
    const entry = this.entries.get(orgId)
    if (entry && !options.force && this.options.clock.now() < entry.expiresAt) {
      return Promise.resolve({
        kind: 'ok',
        capabilities: copy(entry.capabilities),
        source: 'cached',
      })
    }
    let pending = this.inFlight.get(orgId)
    if (!pending) {
      const started = this.refresh(orgId).finally(() => {
        if (this.inFlight.get(orgId) === started) this.inFlight.delete(orgId)
      })
      pending = started
      this.inFlight.set(orgId, pending)
    }
    return pending
  }

  /** forget one org, or every org (account / deployment boundary) */
  clear(orgId?: string): void {
    this.generation += 1
    if (orgId === undefined) {
      this.entries.clear()
      this.inFlight.clear()
    } else {
      this.entries.delete(orgId)
      this.inFlight.delete(orgId)
    }
  }

  private async refresh(orgId: string): Promise<CapabilityRead> {
    const generation = this.generation
    let response: { status: number; body: unknown } | null
    try {
      response = await this.options.fetch(orgId)
    } catch {
      response = null
    }
    if (response?.status === 401) return { kind: 'session_expired', ...this.fallback(orgId) }
    const parsed =
      response && response.status >= 200 && response.status < 300
        ? parseCapabilities(response.body)
        : null
    if (!parsed) return { kind: 'ok', ...this.fallback(orgId) }
    if (generation !== this.generation) {
      return { kind: 'ok', capabilities: copy(parsed.capabilities), source: 'fresh' }
    }
    this.entries.set(orgId, {
      capabilities: parsed.capabilities,
      expiresAt: this.options.clock.now() + parsed.ttlSeconds * 1000,
    })
    return { kind: 'ok', capabilities: copy(parsed.capabilities), source: 'fresh' }
  }

  private fallback(orgId: string): { capabilities: OfficeCapabilities; source: CapabilitySource } {
    const entry = this.entries.get(orgId)
    if (!entry) return { capabilities: copy(NEVER_READ_CAPABILITIES), source: 'default' }
    if (this.options.clock.now() < entry.expiresAt) {
      return { capabilities: copy(entry.capabilities), source: 'cached' }
    }
    return {
      capabilities: { ...copy(entry.capabilities), ai_uniwork: false, ai_uniwork_formats: [] },
      source: 'stale',
    }
  }
}
