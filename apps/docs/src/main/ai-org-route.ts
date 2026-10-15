import { AsyncLocalStorage } from 'node:async_hooks'
import {
  AI_PROVIDERS,
  setPrimaryFetch,
  type AiModelPick,
  type AiModelSource,
  type AiProviderConfig,
  type AiProviderId,
  type AiSettings,
  type AiTestFailureKind,
} from '@genoffice/ai-provider'

/**
 * Route choice for "keys saved on UniWork" (organization keys through the UniWork proxy) on the
 * desktop main process. One helper decides for `ai:stream`, `ai:chat` and `ai:settings-test`:
 * a usable local slot goes direct (as before), otherwise an organization key goes through the
 * proxy, otherwise the caller shows today's "needs key" state.
 *
 * The keys host itself lives in the shell (`apps/shell/src/main/uniwork-auth/keys.ts`) and is
 * handed over through one global symbol, because this module also runs without the shell.
 */

const UNIWORK_KEYS_HOST_SYMBOL = Symbol.for('genoffice.uniworkKeysHost')

/** What docs-main needs from the shell's keys host (the shell host is type-checked against it). */
export interface UniworkKeysHost {
  /** R1 read; answers the cached list while it is fresh or a failure backoff runs. Never throws. */
  list(options?: { force?: boolean }): Promise<unknown>
  /** cached `origin: 'org'` sources (never waits for the network; a stale list re-reads in the background) */
  sources(
    excludeProviders?: ReadonlySet<AiProviderId>,
  ): Partial<Record<AiProviderId, AiModelSource>>
  hasOrgSource(provider: AiProviderId): boolean
  /** the model an org-served provider uses: newer of the desktop pick and the server row's model */
  chosenModelFor(provider: AiProviderId): string
  /** the user picked `model` for an org-served provider on this computer (kept with a timestamp) */
  recordModelPick(provider: AiProviderId, model: string): void
  byokBaseUrl(provider: AiProviderId): string | null
  fetchFor(
    provider: AiProviderId,
    options?: { onAbort?: () => void },
  ): (url: string, init?: RequestInit) => Promise<Response>
  clear(reason?: 'sign-out' | 'org-switch' | 'device-revoked'): void
}

export function setUniworkKeysHost(host: UniworkKeysHost | null): void {
  ;(globalThis as Record<symbol, unknown>)[UNIWORK_KEYS_HOST_SYMBOL] = host
}

export function getUniworkKeysHost(): UniworkKeysHost | null {
  const host = (globalThis as Record<symbol, unknown>)[UNIWORK_KEYS_HOST_SYMBOL]
  return (host as UniworkKeysHost | null | undefined) ?? null
}

/** The shell's `UniworkKeyError`, read by shape (this module cannot import the shell). */
export interface DuckUniworkKeyError extends Error {
  readonly name: 'UniworkKeyError'
  readonly code: string
  readonly status: number
  readonly errorKind:
    AiTestFailureKind | 'not_entitled' | 'rate_limit' | 'unreachable' | 'bad_url' | 'quota'
  describe(lang?: string, providerLabel?: string): string
}

export function isDuckUniworkKeyError(err: unknown): err is DuckUniworkKeyError {
  return (
    err instanceof Error &&
    err.name === 'UniworkKeyError' &&
    typeof (err as Partial<DuckUniworkKeyError>).errorKind === 'string' &&
    typeof (err as Partial<DuckUniworkKeyError>).describe === 'function'
  )
}

// ---- scoped fetch: one primary-fetch dispatcher, installed once ----

type ScopedFetch = (url: string, init?: RequestInit) => Promise<Response>

const orgFetchScope = new AsyncLocalStorage<ScopedFetch>()
let dispatcherInstalled = false

/**
 * Installs the ai-provider primary fetch once: inside `runWithOrgFetch` it is that call's
 * organization fetch, everywhere else the plain `globalThis.fetch` (looked up per call, so local
 * keys keep the direct path and nothing global is replaced).
 */
export function installOrgFetchDispatcher(): void {
  if (dispatcherInstalled) return
  dispatcherInstalled = true
  setPrimaryFetch((url, init) => {
    const scoped = orgFetchScope.getStore()
    return scoped ? scoped(url, init) : globalThis.fetch(url, init)
  })
}

/** runs `run` with ai-provider requests going through `scoped` (only in this async chain) */
export function runWithOrgFetch<T>(scoped: ScopedFetch, run: () => Promise<T>): Promise<T> {
  installOrgFetchDispatcher()
  return orgFetchScope.run(scoped, run)
}

/** true inside an organization-routed call (the Chromium rescue retry must not resend it) */
export function insideOrgFetch(): boolean {
  return orgFetchScope.getStore() !== undefined
}

// ---- route choice ----

/**
 * The local slot belongs to the user: codex, a slot with an API key, or a custom endpoint with its
 * own address. An incomplete slot with a key stays local (Settings shows what is missing); only a
 * slot without a key can be served by the organization key.
 */
export function localSlotClaimed(
  provider: AiProviderId,
  config: AiProviderConfig | undefined,
  byokBase: string | null,
): boolean {
  if (!config) return false
  if (provider === 'codex') return true
  if (config.apiKey?.trim()) return true
  if (provider === 'custom') {
    const base = config.baseUrl?.trim() ?? ''
    return Boolean(base && base !== byokBase)
  }
  return false
}

export type AiRoute =
  | { readonly kind: 'local'; readonly config: AiProviderConfig | undefined }
  | {
      readonly kind: 'org'
      readonly config: AiProviderConfig
      readonly host: UniworkKeysHost
    }

/**
 * Where one call for `provider` goes. `requestConfig` is the caller's settings copy (it may carry a
 * key typed but not saved yet, e.g. the Settings test), `storedConfig` the one in ai-settings.json.
 * The org route is decided from main state only (stored file + the R1 list); without a cached org
 * source the R1 read is awaited once (short timeout, failure backoff in the host).
 */
export async function resolveAiRoute(
  provider: AiProviderId,
  requestConfig: AiProviderConfig | undefined,
  storedConfig: AiProviderConfig | undefined,
  host: UniworkKeysHost | null,
): Promise<AiRoute> {
  const byokBase = host?.byokBaseUrl(provider) ?? null
  if (localSlotClaimed(provider, requestConfig, byokBase)) {
    return { kind: 'local', config: requestConfig }
  }
  if (localSlotClaimed(provider, storedConfig, byokBase)) {
    const model = requestConfig?.model?.trim()
    return { kind: 'local', config: { ...storedConfig!, ...(model ? { model } : {}) } }
  }
  if (host && byokBase) {
    if (!host.hasOrgSource(provider)) await host.list().catch(() => undefined)
    const base = host.hasOrgSource(provider) ? host.byokBaseUrl(provider) : null
    if (base) {
      const model = host.chosenModelFor(provider) || (requestConfig?.model ?? '').trim()
      return { kind: 'org', config: { apiKey: '', model, baseUrl: base }, host }
    }
  }
  return { kind: 'local', config: requestConfig }
}

/** runs `call` on the route: org calls get the proxied fetch for this async chain only */
export function runOnRoute<T>(
  route: AiRoute,
  provider: AiProviderId,
  call: () => Promise<T>,
  onAbort?: () => void,
): Promise<T> {
  if (route.kind !== 'org') return call()
  return runWithOrgFetch(route.host.fetchFor(provider, onAbort ? { onAbort } : {}), call)
}

/**
 * `ai:set-settings` for org-served providers (an org key, no local key in the stored slot): the
 * stored slot (key, base URL, model) is kept as it is unless the payload fills it on this computer
 * (a non-empty key, or a `custom` endpoint with its own base URL: it is saved and wins). The renderer writing
 * `providers[id].model` changes nothing here: the stored slot is always restored. The user's pick
 * of a model is only what the picks say (`modelPick` from the chip, `modelPicks` from the Settings pane; a plain
 * echo of the loaded settings sends none), including the default or the stored slot's model. It
 * goes to the keys host with a timestamp, never into ai-settings.json. There is no fallback that
 * infers a pick from a changed model: every picking caller sends the marker.
 */
export function keepOrgServedSlots(
  payload: AiSettings,
  stored: AiSettings,
  host: UniworkKeysHost | null,
  modelPicks?: readonly AiModelPick[],
): void {
  if (!host) return
  for (const meta of AI_PROVIDERS) {
    const id = meta.id
    if (!host.hasOrgSource(id)) continue
    const storedSlot = stored.providers[id]
    if (localSlotClaimed(id, storedSlot, host.byokBaseUrl(id))) continue
    // a slot the user filled on this computer (a key, or a custom endpoint with its own address) is
    // saved whole and wins from then on, exactly as the route decides it
    const incoming = payload.providers[id]
    if (localSlotClaimed(id, incoming, host.byokBaseUrl(id))) continue
    const pick = modelPicks?.filter((entry) => entry.provider === id).at(-1)
    if (pick) host.recordModelPick(id, pick.model)
    if (storedSlot) payload.providers[id] = storedSlot
    else delete payload.providers[id]
  }
}
