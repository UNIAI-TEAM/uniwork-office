import {
  AI_PROVIDERS,
  ProxyUrlError,
  proxyAnswered,
  proxyErrorBodyFields,
  toProxyRequest,
  type AiModelSource,
  type AiProviderId,
} from '@genoffice/ai-provider'
import { modelIdsOfListBody } from '@genoffice/ai-provider/provider-models'
import type { UniworkKeysHost as DocsUniworkKeysHost } from '../../../../docs/src/main/ai-org-route'
import type { AccountStatus } from '../../shared/home-api'
import { isAllowedOrigin, type DeploymentProfile } from './deployment'
import { TransportError, type FetchLike } from './transport'
import { bindResponseToSignal } from './abortable-response'
import {
  EMPTY_CREDENTIALS,
  ORG_KEY_PROVIDER_IDS,
  credentialSignature,
  parseCredentialsResponse,
  stampOf,
  type UniworkCredentialItem,
  type UniworkCredentialsResponse,
} from './keys-credentials'
import {
  UniworkKeyError,
  isProxy400,
  keyErrorFromResponse,
  parseRetryAfterHeader,
} from './keys-errors'

export * from './keys-errors'
export * from './keys-credentials'

/**
 * How long a loaded R1 credential list is trusted before a fresh settings read
 * re-checks the server (matches the web bridge's CREDENTIALS_TTL_MS).
 */
export const CREDENTIALS_TTL_MS = 4_000

/** How long a provider's live R5 `/models` list is cached in memory (10 min). */
export const MODEL_LIST_TTL_MS = 10 * 60 * 1_000

/** Pause before retrying a failed R5 `/models` listing (60 s). */
export const MODEL_LIST_RETRY_MS = 60 * 1_000

/** Header timeout for R5 listings (>= 20 s per §3, above the server's 15 s). */
export const KEY_PROXY_HEADER_TIMEOUT_MS = 25_000

/**
 * R1 timeout. A settings read never waits for R1 (it answers the cached list), but a stream for a
 * provider with no cached org source does, so a black-holed server must not hold it for long.
 */
export const CREDENTIALS_TIMEOUT_MS = 5_000

/**
 * Pause after a failed R1 (thrown, timed out, 5xx, 429 without a longer `Retry-After`, or a
 * revoked device): reads answer the last good list meanwhile, so a dead server costs one request
 * per window instead of one per settings read.
 */
export const CREDENTIALS_RETRY_MS = 30_000

const ORG_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export interface LocalModelChoice {
  readonly model: string
  /** Epoch ms when the user picked the model on this computer. */
  readonly updatedAt: number
}

/**
 * The desktop model pick per organization-served provider (contract §6.1: kept with the account,
 * not in ai-settings.json). `scope` names the account and organization.
 */
export interface ModelPickStore {
  read(scope: string): Partial<Record<string, LocalModelChoice>>
  write(scope: string, provider: AiProviderId, choice: LocalModelChoice): void
}

/** The docs-main interface (ai-org-route.ts) plus the shell-only calls. */
export interface UniworkKeysHost extends DocsUniworkKeysHost {
  /**
   * Reads (or returns cached) R1 (`GET /api/v1/orgs/{orgId}/ai/credentials`) for the active
   * signed-in organization. Never throws; while the list is fresh or a failure backoff runs it
   * answers the cached list without a request.
   */
  list(options?: { force?: boolean }): Promise<UniworkCredentialsResponse>
  /** The cached R1 credential item for `provider` when `byok.enabled` is true, or null. */
  credentialFor(provider: AiProviderId): UniworkCredentialItem | null
  /** Lists one provider's models via R5 (`/byok/{provider}/models`) into the in-memory cache. */
  listModels(provider: AiProviderId): Promise<readonly string[]>
  /** Clears caches and aborts running streams on sign-out or an organization change. */
  onAccountStatus(status: AccountStatus): void
  /** Number of currently active proxied streams. */
  activeStreamCount(): number
}

export interface UniworkKeysHostDeps {
  profile: () => DeploymentProfile | null
  orgId: () => string | null
  /** Optional session identity (deploymentId/accountId/deviceSessionId) to scope cache per user. */
  sessionKey?: () => string | null
  /** Optional account identity (deploymentId/accountId) that scopes the stored model picks. */
  accountKey?: () => string | null
  /** Optional persistent store of the desktop model picks (defaults to memory only). */
  modelPicks?: ModelPickStore
  /** Runs an authenticated request with the device bearer token (1 refresh + retry on 401). */
  authorized?: <T>(call: (token: string) => Promise<T>) => Promise<T>
  /** Alias for `authorized` (matches `createUniworkCloudClient`). */
  withAccessToken?: <T>(call: (token: string) => Promise<T>) => Promise<T>
  /** Optional online check (defaults to `() => true`). */
  online?: () => boolean
  /** Optional fetch implementation (defaults to `globalThis.fetch`). */
  fetch?: FetchLike
  /** Optional clock for TTL checks in tests (defaults to `Date.now`). */
  now?: () => number
  /** Optional callback fired whenever the cached org sources or live model lists change. */
  onChanged?: () => void
  /** Optional callback fired when a 401 `device_revoked` is observed on a proxy/credentials call. */
  onDeviceRevoked?: () => void
}

interface R5Entry {
  stamp: string
  ids: readonly string[]
  at: number
  failedAt: number
  failedStamp: string
  inFlight?: Promise<readonly string[]>
}

export function createUniworkKeysHost(deps: UniworkKeysHostDeps): UniworkKeysHost {
  const now = deps.now ?? Date.now
  const online = deps.online ?? (() => true)
  const getFetch = (): FetchLike => deps.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const runAuthorized = <T>(call: (token: string) => Promise<T>): Promise<T> => {
    const auth = deps.authorized ?? deps.withAccessToken
    if (!auth) return Promise.reject(new TransportError('unauthorized'))
    return auth(call)
  }

  let generation = 0
  let lastOwnerKey = ''
  let r1State: UniworkCredentialsResponse = EMPTY_CREDENTIALS
  let r1LoadedAt = 0
  let r1EverLoaded = false
  let r1InFlight: Promise<UniworkCredentialsResponse> | null = null
  /** no R1 request before this time (failure backoff); 0 = none */
  let r1RetryAt = 0
  const r5Cache = new Map<string, R5Entry>()
  const activeStreams = new Map<AbortController, { onAbort?: () => void }>()
  const memoryPicks = new Map<string, Partial<Record<string, LocalModelChoice>>>()
  const pickStore: ModelPickStore = deps.modelPicks ?? {
    read: (scope) => memoryPicks.get(scope) ?? {},
    write: (scope, provider, choice) =>
      memoryPicks.set(scope, { ...memoryPicks.get(scope), [provider]: choice }),
  }

  function notifyChanged(): void {
    try {
      deps.onChanged?.()
    } catch {
      // ignore listener errors
    }
  }

  function resolveTarget(): {
    profile: DeploymentProfile
    orgId: string
    aiBase: string
    ownerKey: string
  } | null {
    const profile = deps.profile()
    if (!profile) return null
    let originUrl: URL
    try {
      originUrl = new URL(profile.apiOrigin)
    } catch {
      return null
    }
    if (!isAllowedOrigin(originUrl, profile.channel)) return null
    const orgId = deps.orgId()
    if (!orgId || !ORG_ID.test(orgId)) return null
    const sessionPart = deps.sessionKey ? (deps.sessionKey() ?? '') : ''
    const origin = originUrl.origin
    const aiBase = `${origin}/api/v1/orgs/${encodeURIComponent(orgId)}/ai`
    const ownerKey = `${origin}|${profile.deploymentId}|${sessionPart}|${orgId}`
    return { profile, orgId, aiBase, ownerKey }
  }

  function abortAllStreams(): void {
    const entries = [...activeStreams.entries()]
    activeStreams.clear()
    for (const [controller, meta] of entries) {
      try {
        meta.onAbort?.()
      } catch {
        // ignore
      }
      try {
        controller.abort()
      } catch {
        // ignore
      }
    }
  }

  function clear(reason?: 'sign-out' | 'org-switch' | 'device-revoked'): void {
    generation++
    const hadSources = r1State.hasByok && r1State.byok.enabled && r1State.items.length > 0
    r1State = EMPTY_CREDENTIALS
    r1LoadedAt = 0
    r1EverLoaded = false
    r1InFlight = null
    // a revoked device gets the same answer until the shell signs out: no R1 per settings read
    r1RetryAt = reason === 'device-revoked' ? now() + CREDENTIALS_RETRY_MS : 0
    r5Cache.clear()
    abortAllStreams()
    if (hadSources) notifyChanged()
  }

  function syncOwner(): {
    profile: DeploymentProfile
    orgId: string
    aiBase: string
    ownerKey: string
  } | null {
    const target = resolveTarget()
    const nextKey = target?.ownerKey ?? ''
    if (nextKey !== lastOwnerKey) {
      if (lastOwnerKey !== '') {
        clear(nextKey === '' ? 'sign-out' : 'org-switch')
      }
      lastOwnerKey = nextKey
    }
    return target
  }

  async function inspect401AndThrow(res: Response): Promise<never> {
    let code: string | undefined
    try {
      const body = await res.clone().json()
      code = proxyErrorBodyFields(body).code
    } catch {
      // non-JSON 401
    }
    if (code === 'device_revoked') {
      clear('device-revoked')
      lastOwnerKey = ''
      try {
        deps.onDeviceRevoked?.()
      } catch {
        // ignore
      }
      throw new TransportError('device_revoked', 401, true)
    }
    throw new TransportError('unauthorized', 401, code === 'unauthorized')
  }

  /** a 401 from the UniWork server itself, a revoked device or a reused refresh ends the source */
  function endsSession(err: TransportError): boolean {
    return (
      err.code === 'device_revoked' ||
      err.code === 'refresh_reused' ||
      (err.code === 'unauthorized' && err.fromServer)
    )
  }

  function adoptCredentials(next: UniworkCredentialsResponse): UniworkCredentialsResponse {
    const prevSig = credentialSignature(r1State)
    r1State = next
    r1LoadedAt = now()
    r1EverLoaded = true
    r1RetryAt = 0
    if (prevSig !== credentialSignature(next)) notifyChanged()
    return next
  }

  /** keep the last good list (no notify) and wait before the next R1 request */
  function backOff(retryAfterSeconds?: number): UniworkCredentialsResponse {
    const wait =
      retryAfterSeconds !== undefined
        ? Math.max(retryAfterSeconds * 1_000, CREDENTIALS_TTL_MS)
        : CREDENTIALS_RETRY_MS
    r1RetryAt = now() + wait
    return r1State
  }

  async function list(options?: { force?: boolean }): Promise<UniworkCredentialsResponse> {
    const target = syncOwner()
    if (!target) return EMPTY_CREDENTIALS
    if (!online()) return r1State
    const force = options?.force === true
    if (!force) {
      if (now() < r1RetryAt) return r1State
      if (r1EverLoaded && now() - r1LoadedAt < CREDENTIALS_TTL_MS) return r1State
      if (r1InFlight) return r1InFlight
    }
    const runGen = generation
    const runOwner = target.ownerKey
    const url = `${target.aiBase}/credentials`
    const stale = () => runGen !== generation || runOwner !== lastOwnerKey
    const run = (async (): Promise<UniworkCredentialsResponse> => {
      try {
        const res = await runAuthorized(async (token) => {
          const response = await getFetch()(url, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
            redirect: 'error',
            signal: AbortSignal.timeout(CREDENTIALS_TIMEOUT_MS),
          })
          if (response.status === 401) {
            return inspect401AndThrow(response)
          }
          return response
        })
        if (stale()) return r1State
        // route-level 404: an older server or no longer a member, so no org source
        if (res.status === 404) return adoptCredentials(EMPTY_CREDENTIALS)
        // 429 / 5xx / anything else is not an answer about the keys: keep the last good list
        if (!res.ok) {
          return backOff(
            res.status === 429 ? parseRetryAfterHeader(res.headers.get('retry-after')) : undefined,
          )
        }
        const raw = await res.json()
        if (stale()) return r1State
        // a parsed `byok.enabled=false` (or no `byok` at all) drops the source
        return adoptCredentials(parseCredentialsResponse(raw))
      } catch (err) {
        if (stale()) return r1State
        if (err instanceof TransportError && endsSession(err)) {
          clear(err.code === 'device_revoked' ? 'device-revoked' : 'sign-out')
          lastOwnerKey = ''
          return EMPTY_CREDENTIALS
        }
        // offline, timed out, a gateway's 401 or an unreadable body: transient
        return backOff()
      }
    })()
    r1InFlight = run
    void run.finally(() => {
      if (r1InFlight === run) r1InFlight = null
    })
    return run
  }

  function handleEntitlementRequired(): void {
    if (!r1State.hasByok) return
    const wasEnabled = r1State.byok.enabled
    r1State = {
      ...r1State,
      byok: { enabled: false, reason: 'entitlement_required' },
    }
    if (wasEnabled) notifyChanged()
  }

  function handleCredentialMissing(provider: AiProviderId): void {
    const before = r1State.items.length
    r1State = {
      ...r1State,
      items: r1State.items.filter((item) => item.provider !== provider),
    }
    r1LoadedAt = 0
    for (const key of r5Cache.keys()) {
      if (key.endsWith(`|${provider}`)) r5Cache.delete(key)
    }
    if (r1State.items.length !== before) notifyChanged()
    // Re-read R1 immediately so the server's current credential list replaces the cache (§2.3, §7 test 8)
    void list({ force: true }).catch(() => undefined)
  }

  function byokBaseUrl(provider: AiProviderId): string | null {
    const target = syncOwner()
    if (!target) return null
    if (!ORG_KEY_PROVIDER_IDS.has(provider)) return null
    return `${target.aiBase}/byok/${encodeURIComponent(provider)}`
  }

  function normalizeProviderProxyUrl(aiBase: string, provider: AiProviderId, url: string): string {
    const prefix = `${aiBase}/byok/${encodeURIComponent(provider)}/v1/`
    if (url.startsWith(prefix)) {
      const rest = url.slice(prefix.length)
      if (rest === 'chat/completions' || rest.startsWith('models/') || rest === 'models') {
        return `${aiBase}/byok/${encodeURIComponent(provider)}/${rest}`
      }
    }
    return url
  }

  function fetchFor(
    provider: AiProviderId,
    options?: { onAbort?: () => void },
  ): (url: string, init?: RequestInit) => Promise<Response> {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      const target = syncOwner()
      if (!target) {
        throw new UniworkKeyError({ code: 'unauthorized', status: 401 })
      }
      if (!ORG_KEY_PROVIDER_IDS.has(provider)) {
        throw new ProxyUrlError(`provider not supported on BYOK proxy: ${provider}`)
      }
      const normalizedUrl = normalizeProviderProxyUrl(target.aiBase, provider, url)
      const proxyReq = toProxyRequest(target.aiBase, normalizedUrl, init)
      const expectedPrefix = `${target.aiBase}/byok/${encodeURIComponent(provider)}/`
      if (!proxyReq.url.startsWith(expectedPrefix)) {
        throw new ProxyUrlError(
          `proxy URL provider mismatch: expected ${provider}, got ${proxyReq.url}`,
        )
      }

      const callController = new AbortController()
      const callerSignal = proxyReq.init.signal as AbortSignal | null | undefined
      const forwardAbort = () => callController.abort()
      if (callerSignal?.aborted) {
        callController.abort()
      } else if (callerSignal) {
        callerSignal.addEventListener('abort', forwardAbort, { once: true })
      }

      activeStreams.set(callController, { onAbort: options?.onAbort })
      let streamHandedOff = false
      const releaseStream = () => {
        activeStreams.delete(callController)
        callerSignal?.removeEventListener('abort', forwardAbort)
      }

      try {
        const res = await runAuthorized(async (token) => {
          if (callController.signal.aborted) {
            const err = new Error('The operation was aborted.')
            err.name = 'AbortError'
            throw err
          }
          const headers: Record<string, string> = {
            ...(proxyReq.init.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${token}`,
          }
          const response = await getFetch()(proxyReq.url, {
            ...proxyReq.init,
            headers,
            redirect: 'error',
            signal: callController.signal,
          })
          if (response.status === 401) {
            return inspect401AndThrow(response)
          }
          return response
        })

        if (res.ok) {
          const isSse = (res.headers.get('content-type') ?? '').includes('text/event-stream')
          if (isSse || (proxyReq.init.method ?? 'GET').toUpperCase() === 'POST') {
            streamHandedOff = true
            return bindResponseToSignal(res, callController.signal, releaseStream)
          }
          return res
        }

        if (await proxyAnswered(res)) {
          const keyErr = await keyErrorFromResponse(res)
          if (keyErr.code === 'entitlement_required') {
            handleEntitlementRequired()
          } else if (keyErr.code === 'credential_missing') {
            handleCredentialMissing(provider)
          }
          throw keyErr
        }

        if (await isProxy400(res)) {
          throw await keyErrorFromResponse(res)
        }

        // Vendor 4xx/5xx (e.g. 400 exceeded output cap, 404 unknown model) passes through unchanged
        return res
      } catch (err) {
        if (err instanceof TransportError) {
          if (endsSession(err)) {
            clear(err.code === 'device_revoked' ? 'device-revoked' : 'sign-out')
            lastOwnerKey = ''
          }
          // a 401 that did not come from the UniWork server (gateway, captive portal) ends only this call
          if (endsSession(err) || err.code === 'unauthorized') {
            throw new UniworkKeyError({
              code: err.code === 'device_revoked' ? 'device_revoked' : 'unauthorized',
              status: 401,
            })
          }
        }
        throw err
      } finally {
        if (!streamHandedOff) {
          releaseStream()
        }
      }
    }
  }

  async function listModels(provider: AiProviderId): Promise<readonly string[]> {
    const target = syncOwner()
    if (!target || !r1State.hasByok || !r1State.byok.enabled) return []
    const item = r1State.items.find((c) => c.provider === provider)
    if (!item) return []
    const cacheKey = `${target.ownerKey}|${provider}`
    const stamp = stampOf(item)
    const existing = r5Cache.get(cacheKey)
    if (existing?.inFlight && existing.stamp === stamp) {
      return existing.inFlight
    }
    const runGen = generation
    const runOwner = target.ownerKey
    const modelsUrl = `${target.aiBase}/byok/${encodeURIComponent(provider)}/models`

    const run = (async (): Promise<readonly string[]> => {
      try {
        // a proxy 404 credential_missing already threw inside fetchFor (and re-read R1)
        const res = await fetchFor(provider)(modelsUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(KEY_PROXY_HEADER_TIMEOUT_MS),
        })
        if (runGen !== generation || runOwner !== lastOwnerKey) return []
        if (!res.ok) {
          const prev = r5Cache.get(cacheKey)
          r5Cache.set(cacheKey, {
            stamp,
            ids: prev && prev.stamp === stamp ? prev.ids : [],
            at: prev && prev.stamp === stamp ? prev.at : 0,
            failedAt: now(),
            failedStamp: stamp,
          })
          notifyChanged()
          return []
        }
        const body = await res.json()
        if (runGen !== generation || runOwner !== lastOwnerKey) return []
        const ids = modelIdsOfListBody(body)
        r5Cache.set(cacheKey, {
          stamp,
          ids,
          at: now(),
          failedAt: 0,
          failedStamp: '',
        })
        notifyChanged()
        return ids
      } catch {
        if (
          runGen === generation &&
          runOwner === lastOwnerKey &&
          r1State.items.some((i) => i.provider === provider)
        ) {
          const prev = r5Cache.get(cacheKey)
          r5Cache.set(cacheKey, {
            stamp,
            ids: prev && prev.stamp === stamp ? prev.ids : [],
            at: prev && prev.stamp === stamp ? prev.at : 0,
            failedAt: now(),
            failedStamp: stamp,
          })
          notifyChanged()
        }
        return []
      }
    })()

    r5Cache.set(cacheKey, {
      stamp,
      ids: existing && existing.stamp === stamp ? existing.ids : [],
      at: existing && existing.stamp === stamp ? existing.at : 0,
      failedAt: existing && existing.stamp === stamp ? existing.failedAt : 0,
      failedStamp: existing && existing.stamp === stamp ? existing.failedStamp : '',
      inFlight: run,
    })
    void run.finally(() => {
      const current = r5Cache.get(cacheKey)
      if (current?.inFlight === run) {
        const { inFlight: _dropped, ...rest } = current
        r5Cache.set(cacheKey, rest)
      }
    })
    return run
  }

  function readModelListState(
    ownerKey: string,
    item: UniworkCredentialItem,
  ): { listed?: readonly string[]; listState?: 'loading' | 'error' } {
    const cacheKey = `${ownerKey}|${item.provider}`
    const stamp = stampOf(item)
    let entry = r5Cache.get(cacheKey)
    if (entry && entry.stamp !== stamp) {
      r5Cache.delete(cacheKey)
      entry = undefined
    }
    const have = Boolean(entry && entry.at > 0)
    const expired = have && now() - entry!.at >= MODEL_LIST_TTL_MS
    const retryReady =
      !have &&
      (!entry ||
        entry.failedAt === 0 ||
        entry.failedStamp !== stamp ||
        now() - entry.failedAt >= MODEL_LIST_RETRY_MS)

    if (!entry?.inFlight && (expired || retryReady)) {
      void listModels(item.provider)
      entry = r5Cache.get(cacheKey)
    }

    if (entry && entry.at > 0) {
      return entry.ids.length > 0 ? { listed: entry.ids } : {}
    }
    if (entry?.inFlight) {
      return { listState: 'loading' }
    }
    if (entry && entry.failedAt > 0) {
      return { listState: 'error' }
    }
    return {}
  }

  function credentialFor(provider: AiProviderId): UniworkCredentialItem | null {
    const target = syncOwner()
    if (!target || !r1State.hasByok || !r1State.byok.enabled) return null
    return r1State.items.find((item) => item.provider === provider) ?? null
  }

  function hasOrgSource(provider: AiProviderId): boolean {
    return credentialFor(provider) !== null
  }

  /** account + organization the desktop picks belong to, or null while not signed in */
  function pickScope(): string | null {
    const target = syncOwner()
    if (!target) return null
    const account = deps.accountKey?.() ?? deps.sessionKey?.() ?? ''
    return `${target.profile.deploymentId}|${account}|${target.orgId}`
  }

  function localPickFor(provider: AiProviderId): LocalModelChoice | undefined {
    const scope = pickScope()
    if (!scope) return undefined
    try {
      const pick = pickStore.read(scope)[provider]
      return pick && typeof pick.model === 'string' && pick.model.trim() ? pick : undefined
    } catch {
      return undefined
    }
  }

  function recordModelPick(provider: AiProviderId, model: string): void {
    const scope = pickScope()
    const picked = model.trim()
    if (!scope || !picked) return
    try {
      pickStore.write(scope, provider, { model: picked, updatedAt: now() })
    } catch {
      // a store that cannot write keeps the previous pick
    }
  }

  /**
   * The model of an org-served provider: the newer of the desktop pick and the server row's
   * `model` / `model_updated_at` (contract §6.1); then the provider default, then the first listed.
   */
  function chosenModelFor(provider: AiProviderId): string {
    const item = credentialFor(provider)
    const pick = localPickFor(provider)
    const defaultModel = AI_PROVIDERS.find((m) => m.id === provider)?.defaultModel ?? ''
    if (!item) return pick?.model.trim() || defaultModel

    const serverModel = item.model.trim()
    const parsedServerAt = item.modelUpdatedAt ? Date.parse(item.modelUpdatedAt) : Number.NaN
    const serverAt = Number.isFinite(parsedServerAt) ? parsedServerAt : 0
    let chosen: string
    if (serverModel && pick) {
      chosen = (pick.updatedAt ?? 0) >= serverAt ? pick.model.trim() : serverModel
    } else {
      chosen = serverModel || pick?.model.trim() || defaultModel
    }

    if (!chosen) {
      const target = syncOwner()
      if (target) {
        const entry = r5Cache.get(`${target.ownerKey}|${provider}`)
        if (entry && entry.ids.length > 0) {
          chosen = entry.ids[0] ?? ''
        }
      }
    }
    return chosen
  }

  function sources(
    excludeProviders?: ReadonlySet<AiProviderId>,
  ): Partial<Record<AiProviderId, AiModelSource>> {
    const target = syncOwner()
    if (!target || !r1State.hasByok || !r1State.byok.enabled) return {}
    const out: Partial<Record<AiProviderId, AiModelSource>> = {}
    for (const item of r1State.items) {
      if (excludeProviders?.has(item.provider)) continue
      const listInfo = readModelListState(target.ownerKey, item)
      out[item.provider] = {
        chosen: chosenModelFor(item.provider),
        ...listInfo,
        origin: 'org',
      }
    }
    return out
  }

  function onAccountStatus(status: AccountStatus): void {
    if (
      !status.loggedIn ||
      status.state === 'signed-out' ||
      status.state === 'session-expired' ||
      status.needsOrgChoice
    ) {
      if (lastOwnerKey !== '' || activeStreams.size > 0 || r1EverLoaded) {
        clear('sign-out')
        lastOwnerKey = ''
      }
      return
    }
    syncOwner()
  }

  return {
    list,
    sources,
    credentialFor,
    hasOrgSource,
    chosenModelFor,
    recordModelPick,
    listModels,
    byokBaseUrl,
    fetchFor,
    clear,
    onAccountStatus,
    activeStreamCount: () => activeStreams.size,
  }
}
