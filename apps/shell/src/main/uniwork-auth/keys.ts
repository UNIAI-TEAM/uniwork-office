import {
  AI_PROVIDERS,
  ProxyUrlError,
  isProxy404,
  proxyAnswered,
  proxyErrorBodyFields,
  toProxyRequest,
  type AiModelSource,
  type AiProviderId,
  type AiTestFailureKind,
} from '@genoffice/ai-provider'
import type { AccountStatus } from '../../shared/home-api'
import { isAllowedOrigin, type DeploymentProfile } from './deployment'
import { TransportError, type FetchLike } from './transport'

/**
 * How long a loaded R1 credential list is trusted before a fresh settings read
 * re-checks the server (matches the web bridge's CREDENTIALS_TTL_MS).
 */
export const CREDENTIALS_TTL_MS = 4_000

/** How long a provider's live R5 `/models` list is cached in memory (10 min). */
export const MODEL_LIST_TTL_MS = 10 * 60 * 1_000

/** Pause before retrying a failed R5 `/models` listing (60 s). */
export const MODEL_LIST_RETRY_MS = 60 * 1_000

/** Header timeout for R1 / R5 requests (>= 20 s per §3, above the server's 15 s). */
export const KEY_PROXY_HEADER_TIMEOUT_MS = 25_000

const ORG_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

/** Providers that can hold a personal BYOK key on UniWork (excludes CLI and cloud-only ids). */
const ORG_KEY_PROVIDER_IDS: ReadonlySet<string> = new Set(
  AI_PROVIDERS.map((p) => p.id).filter(
    (id) => id !== 'uniwork' && id !== 'codex' && id !== 'genspark',
  ),
)

const PROXY_400_CODES: ReadonlySet<string> = new Set([
  'provider_not_supported',
  'base_url_refused',
  'invalid_request',
])

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

export type UniworkKeyErrorCode =
  | 'entitlement_required'
  | 'credential_missing'
  | 'provider_auth_failed'
  | 'rate_limited'
  | 'provider_unreachable'
  | 'provider_not_supported'
  | 'base_url_refused'
  | 'invalid_request'
  | 'unauthorized'
  | 'device_revoked'
  | 'forbidden'
  | 'cloud_unavailable'
  | 'credits_exhausted'
  | 'unknown'

const KNOWN_KEY_ERROR_CODES: ReadonlySet<string> = new Set<UniworkKeyErrorCode>([
  'entitlement_required',
  'credential_missing',
  'provider_auth_failed',
  'rate_limited',
  'provider_unreachable',
  'provider_not_supported',
  'base_url_refused',
  'invalid_request',
  'unauthorized',
  'device_revoked',
  'forbidden',
  'cloud_unavailable',
  'credits_exhausted',
  'unknown',
])

interface StateCopy {
  readonly entitlementTitle: string
  readonly entitlementBody: string
  readonly keyMissingTitle: string
  readonly keyMissingBody: string
  readonly keyRejectedTitle: string
  readonly keyRejectedBody: string
  readonly rateTitle: string
  readonly rateBody: string
  readonly rateBodyNow: string
  readonly unreachableTitle: string
  readonly unreachableBody: string
  readonly cloudTitle: string
  readonly cloudBody: string
  readonly sessionTitle: string
  readonly sessionBody: string
  readonly refusedTitle: string
  readonly refusedBody: string
  readonly baseUrlBody: string
  readonly providerBody: string
  readonly creditsTitle: string
  readonly creditsBody: string
  readonly unknownTitle: string
  readonly unknownBody: string
}

const STATE_COPY_EN: StateCopy = {
  entitlementTitle: 'AI is not in your plan',
  entitlementBody:
    "Your organization's UniWork plan does not include this AI feature. Ask your administrator.",
  keyMissingTitle: 'No AI key yet',
  keyMissingBody: 'Add an API key in AI settings to use the assistant.',
  keyRejectedTitle: 'The AI key was refused',
  keyRejectedBody: 'The provider refused the saved key. Replace it in AI settings.',
  rateTitle: 'Too many AI requests',
  rateBody: 'Wait {seconds} s and try again.',
  rateBodyNow: 'Wait a moment and try again.',
  unreachableTitle: 'AI provider unreachable',
  unreachableBody: 'UniWork could not reach the AI provider. Try again in a moment.',
  cloudTitle: 'Cloud tool unavailable',
  cloudBody: 'This UniWork AI tool is not set up on the server yet.',
  sessionTitle: 'Session expired',
  sessionBody: 'Sign in to UniWork again to continue.',
  refusedTitle: 'Request refused',
  refusedBody: 'The server refused the AI request.',
  baseUrlBody: 'This base URL is not allowed. Use a public https:// address.',
  providerBody: 'This provider is not supported.',
  creditsTitle: 'AI credits used up',
  creditsBody:
    'Your organization has used all UniWork AI credits for this period. Ask your administrator, or wait until they renew.',
  unknownTitle: 'AI request failed',
  unknownBody: 'Something went wrong. Try again.',
}

const STATE_COPY_VI: StateCopy = {
  entitlementTitle: 'Gói không bao gồm AI',
  entitlementBody:
    'Gói UniWork của tổ chức bạn không bao gồm tính năng AI này. Hãy liên hệ quản trị viên.',
  keyMissingTitle: 'Chưa có khóa AI',
  keyMissingBody: 'Thêm khóa API trong Cài đặt AI để dùng trợ lý.',
  keyRejectedTitle: 'Khóa AI bị từ chối',
  keyRejectedBody: 'Nhà cung cấp đã từ chối khóa đã lưu. Hãy thay khóa trong Cài đặt AI.',
  rateTitle: 'Quá nhiều yêu cầu AI',
  rateBody: 'Hãy chờ {seconds} giây rồi thử lại.',
  rateBodyNow: 'Hãy chờ một lát rồi thử lại.',
  unreachableTitle: 'Không kết nối được nhà cung cấp AI',
  unreachableBody: 'UniWork không kết nối được tới nhà cung cấp AI. Hãy thử lại sau ít phút.',
  cloudTitle: 'Công cụ đám mây chưa sẵn sàng',
  cloudBody: 'Công cụ UniWork AI này chưa được cấu hình trên máy chủ.',
  sessionTitle: 'Phiên đã hết hạn',
  sessionBody: 'Hãy đăng nhập lại UniWork để tiếp tục.',
  refusedTitle: 'Yêu cầu bị từ chối',
  refusedBody: 'Máy chủ đã từ chối yêu cầu AI.',
  baseUrlBody: 'Không cho phép Base URL này. Hãy dùng một địa chỉ https:// công khai.',
  providerBody: 'Nhà cung cấp này không được hỗ trợ.',
  creditsTitle: 'Đã hết tín dụng AI',
  creditsBody:
    'Tổ chức của bạn đã dùng hết tín dụng UniWork AI của kỳ này. Hãy liên hệ quản trị viên hoặc chờ kỳ mới.',
  unknownTitle: 'Yêu cầu AI thất bại',
  unknownBody: 'Đã xảy ra lỗi. Hãy thử lại.',
}

export type UniworkKeyErrorKind =
  AiTestFailureKind | 'not_entitled' | 'rate_limit' | 'unreachable' | 'bad_url' | 'quota'

export function errorKindForKeyCode(code: UniworkKeyErrorCode): UniworkKeyErrorKind {
  switch (code) {
    case 'entitlement_required':
      return 'not_entitled'
    case 'credential_missing':
    case 'provider_auth_failed':
    case 'unauthorized':
    case 'device_revoked':
    case 'forbidden':
      return 'invalid_key'
    case 'rate_limited':
      return 'rate_limit'
    case 'provider_unreachable':
    case 'cloud_unavailable':
      return 'unreachable'
    case 'base_url_refused':
      return 'bad_url'
    case 'credits_exhausted':
      return 'quota'
    case 'provider_not_supported':
    case 'invalid_request':
    case 'unknown':
      return 'failed'
  }
}

export class UniworkKeyError extends Error {
  readonly code: UniworkKeyErrorCode
  readonly status: number
  readonly serverCode?: string | undefined
  readonly retryAfterSeconds?: number | undefined
  readonly retryAfterSec?: number | undefined
  readonly errorKind: UniworkKeyErrorKind

  constructor(opts: {
    code: UniworkKeyErrorCode
    status: number
    serverCode?: string | undefined
    retryAfterSeconds?: number | undefined
    message?: string | undefined
  }) {
    super(opts.message ?? `uniwork key proxy failed: ${opts.code} (${opts.status})`)
    this.name = 'UniworkKeyError'
    this.code = opts.code
    this.status = opts.status
    if (opts.serverCode !== undefined) this.serverCode = opts.serverCode
    if (opts.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = opts.retryAfterSeconds
      this.retryAfterSec = opts.retryAfterSeconds
    }
    this.errorKind = errorKindForKeyCode(opts.code)
  }

  describe(lang = 'en', providerLabel?: string): string {
    return describeUniworkKeyError(this, lang, providerLabel)
  }
}

export function isUniworkKeyError(err: unknown): err is UniworkKeyError {
  return err instanceof UniworkKeyError
}

/**
 * Formats a `UniworkKeyError` into the localized state line matching the web frame's
 * `KEY_CODES` states (§2.3, `web/e2e/ai-web.spec.ts:15-22`).
 */
export function describeUniworkKeyError(
  err: UniworkKeyError,
  lang = 'en',
  providerLabel?: string,
): string {
  const copy = lang === 'vi' ? STATE_COPY_VI : STATE_COPY_EN
  let title: string
  let body: string
  switch (err.code) {
    case 'entitlement_required':
      title = copy.entitlementTitle
      body = copy.entitlementBody
      break
    case 'credential_missing':
      title = copy.keyMissingTitle
      body = copy.keyMissingBody
      break
    case 'provider_auth_failed':
      title = copy.keyRejectedTitle
      body = copy.keyRejectedBody
      break
    case 'rate_limited':
      title = copy.rateTitle
      body =
        err.retryAfterSeconds !== undefined
          ? copy.rateBody.replace('{seconds}', String(err.retryAfterSeconds))
          : copy.rateBodyNow
      break
    case 'provider_unreachable':
      title = copy.unreachableTitle
      body = copy.unreachableBody
      break
    case 'cloud_unavailable':
      title = copy.cloudTitle
      body = copy.cloudBody
      break
    case 'unauthorized':
    case 'device_revoked':
      title = copy.sessionTitle
      body = copy.sessionBody
      break
    case 'base_url_refused':
      title = copy.refusedTitle
      body = copy.baseUrlBody
      break
    case 'provider_not_supported':
      title = copy.refusedTitle
      body = copy.providerBody
      break
    case 'forbidden':
    case 'invalid_request':
      title = copy.refusedTitle
      body = copy.refusedBody
      break
    case 'credits_exhausted':
      title = copy.creditsTitle
      body = copy.creditsBody
      break
    default:
      title = copy.unknownTitle
      body = copy.unknownBody
      break
  }
  return providerLabel ? `${providerLabel} — ${title}: ${body}` : `${title}: ${body}`
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

function parseRetryAfterHeader(raw: string | null): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds)
  const at = Date.parse(trimmed)
  if (!Number.isNaN(at)) {
    const delta = Math.ceil((at - Date.now()) / 1_000)
    return delta > 0 ? delta : 1
  }
  return undefined
}

function keyErrorCodeForStatus(status: number, serverCode?: string): UniworkKeyErrorCode {
  if (serverCode && KNOWN_KEY_ERROR_CODES.has(serverCode)) {
    return serverCode as UniworkKeyErrorCode
  }
  switch (status) {
    case 400:
      return 'invalid_request'
    case 401:
      return 'unauthorized'
    case 402:
      return 'credits_exhausted'
    case 403:
      return 'entitlement_required'
    case 404:
      return 'credential_missing'
    case 424:
      return 'provider_auth_failed'
    case 429:
      return 'rate_limited'
    case 502:
      return 'provider_unreachable'
    case 503:
      return 'cloud_unavailable'
    default:
      return 'unknown'
  }
}

export async function keyErrorFromResponse(res: Response): Promise<UniworkKeyError> {
  const status = res.status
  let serverCode: string | undefined
  try {
    const body = await res.clone().json()
    serverCode = proxyErrorBodyFields(body).code
  } catch {
    // non-JSON error body
  }
  const code = keyErrorCodeForStatus(status, serverCode)
  const retryAfterSeconds =
    code === 'rate_limited' ? parseRetryAfterHeader(res.headers.get('retry-after')) : undefined
  return new UniworkKeyError({
    code,
    status,
    ...(serverCode !== undefined ? { serverCode } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  })
}

async function isProxy400(res: Response): Promise<boolean> {
  if (res.status !== 400) return false
  try {
    const { code } = proxyErrorBodyFields(await res.clone().json())
    return typeof code === 'string' && PROXY_400_CODES.has(code)
  } catch {
    return false
  }
}

const EMPTY_CREDENTIALS: UniworkCredentialsResponse = Object.freeze({
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

function credentialSignature(resp: UniworkCredentialsResponse): string {
  if (!resp.hasByok || !resp.byok.enabled) return `off:${resp.byok.reason}`
  return resp.items
    .map(
      (c) =>
        `${c.provider}:${c.keyHint}:${c.baseUrl}:${c.updatedAt}:${c.model}:${c.modelUpdatedAt}`,
    )
    .sort()
    .join('|')
}

function stampOf(item: UniworkCredentialItem): string {
  return `${item.keyHint}:${item.baseUrl}:${item.updatedAt}`
}

/**
 * Wraps a streaming `Response` body so that aborting `signal` mid-stream
 * immediately rejects any pending `reader.read()` and cancels the underlying stream.
 */
function bindResponseToSignal(res: Response, signal: AbortSignal, onDone: () => void): Response {
  const body = res.body
  if (!body) {
    onDone()
    return res
  }
  const reader = body.getReader()
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    signal.removeEventListener('abort', onAbort)
    onDone()
  }
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
  const abortError = () => {
    const err = new Error('The operation was aborted.')
    err.name = 'AbortError'
    return err
  }
  const onAbort = () => {
    finish()
    void reader.cancel().catch(() => undefined)
    try {
      streamController?.error(abortError())
    } catch {
      // already closed
    }
  }
  if (signal.aborted) {
    finish()
    void reader.cancel().catch(() => undefined)
    const wrapped = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(abortError())
      },
    })
    return new Response(wrapped, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  }
  signal.addEventListener('abort', onAbort, { once: true })
  const wrapped = new ReadableStream<Uint8Array>(
    {
      start(c) {
        streamController = c
      },
      async pull(c) {
        if (signal.aborted) {
          finish()
          c.error(abortError())
          return
        }
        try {
          const { done, value } = await reader.read()
          if (signal.aborted) {
            finish()
            c.error(abortError())
            return
          }
          if (done) {
            finish()
            c.close()
            return
          }
          c.enqueue(value)
        } catch (err) {
          finish()
          c.error(err)
        }
      },
      cancel(reason) {
        finish()
        return reader.cancel(reason)
      },
    },
    { highWaterMark: 0 },
  )
  return new Response(wrapped, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

export interface LocalModelChoice {
  readonly model: string
  /** Epoch ms when the user picked the model locally; 0 or omitted if only from defaults. */
  readonly updatedAt?: number | undefined
}

export interface UniworkKeysHost {
  /**
   * Reads (or returns cached) R1 (`GET /api/v1/orgs/{orgId}/ai/credentials`) for the
   * active signed-in organization. Never throws.
   */
  list(options?: { force?: boolean }): Promise<UniworkCredentialsResponse>
  /**
   * Returns current `origin: 'org'` model sources for the active organization when `byok.enabled`
   * is true. Starts background R5 (`/byok/{provider}/models`) listings and invokes `onChanged`
   * when a listing settles or a 404 `credential_missing` invalidates R1.
   */
  sources(
    localChoices?: Partial<Record<AiProviderId, string | LocalModelChoice>>,
    onChanged?: () => void,
    excludeProviders?: ReadonlySet<AiProviderId>,
  ): Partial<Record<AiProviderId, AiModelSource>>
  /**
   * Returns the cached R1 credential item for `provider` when `byok.enabled` is true, or null.
   */
  credentialFor(provider: AiProviderId): UniworkCredentialItem | null
  /**
   * True when `provider` has a usable org credential in the active organization (`byok.enabled` is true).
   */
  hasOrgSource(provider: AiProviderId): boolean
  /**
   * Resolves the chosen model for an org-backed `provider` using the newer-wins rule against a
   * local pick, falling back to the server row's `model`, the provider's default model, or the
   * first listed model.
   */
  chosenModelFor(provider: AiProviderId, localChoice?: string | LocalModelChoice): string
  /**
   * Lists one provider's models via R5 (`GET /api/v1/orgs/{orgId}/ai/byok/{provider}/models`),
   * updating the host's in-memory R5 cache.
   */
  listModels(provider: AiProviderId): Promise<readonly string[]>
  /**
   * The proxy base URL (`${apiOrigin}/api/v1/orgs/${orgId}/ai/byok/${provider}`) for `provider`,
   * or `null` when not signed in / origin not allowed.
   */
  byokBaseUrl(provider: AiProviderId): string | null
  /**
   * Per-call fetch for `provider`: rewrites the URL with `toProxyRequest(aiBase, url, init)`,
   * drops vendor key headers, adds the device bearer token through `authorized()`,
   * refuses any origin outside `isAllowedOrigin`, tracks the stream so sign-out / org switch /
   * `device_revoked` aborts it, and maps proxy contract statuses (§2.3).
   */
  fetchFor(
    provider: AiProviderId,
    options?: { onAbort?: () => void },
  ): (url: string, init?: RequestInit) => Promise<Response>
  /**
   * Clears the R1/R5 caches and aborts every running proxied stream.
   */
  clear(reason?: 'sign-out' | 'org-switch' | 'device-revoked'): void
  /**
   * Synchronizes with an `AccountStatus` push: clears caches and aborts running streams when
   * signed out or when the selected organization changed.
   */
  onAccountStatus(status: AccountStatus): void
  /** Number of currently active proxied streams. */
  activeStreamCount(): number
}

export interface UniworkKeysHostDeps {
  profile: () => DeploymentProfile | null
  orgId: () => string | null
  /** Optional session identity (deploymentId/accountId/deviceSessionId) to scope cache per user. */
  sessionKey?: () => string | null
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
  const r5Cache = new Map<string, R5Entry>()
  const activeStreams = new Map<AbortController, { onAbort?: () => void }>()
  const extraChangeListeners = new Set<() => void>()

  function notifyChanged(): void {
    try {
      deps.onChanged?.()
    } catch {
      // ignore listener errors
    }
    for (const fn of [...extraChangeListeners]) {
      try {
        fn()
      } catch {
        // ignore listener errors
      }
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

  function clear(_reason?: 'sign-out' | 'org-switch' | 'device-revoked'): void {
    generation++
    const hadSources = r1State.hasByok && r1State.byok.enabled && r1State.items.length > 0
    r1State = EMPTY_CREDENTIALS
    r1LoadedAt = 0
    r1EverLoaded = false
    r1InFlight = null
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

  async function list(options?: { force?: boolean }): Promise<UniworkCredentialsResponse> {
    const target = syncOwner()
    if (!target || !online()) {
      if (!target) return EMPTY_CREDENTIALS
      return r1State
    }
    const force = options?.force === true
    if (!force && r1EverLoaded && now() - r1LoadedAt < CREDENTIALS_TTL_MS) {
      return r1State
    }
    if (!force && r1InFlight) {
      return r1InFlight
    }
    const runGen = generation
    const runOwner = target.ownerKey
    const url = `${target.aiBase}/credentials`
    const run = (async (): Promise<UniworkCredentialsResponse> => {
      try {
        const res = await runAuthorized(async (token) => {
          const timeout = AbortSignal.timeout(KEY_PROXY_HEADER_TIMEOUT_MS)
          const response = await getFetch()(url, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
            redirect: 'error',
            signal: timeout,
          })
          if (response.status === 401) {
            return inspect401AndThrow(response)
          }
          return response
        })
        if (runGen !== generation || runOwner !== lastOwnerKey) return r1State
        if (!res.ok) {
          const prevSig = credentialSignature(r1State)
          r1State = EMPTY_CREDENTIALS
          r1LoadedAt = now()
          r1EverLoaded = true
          if (prevSig !== credentialSignature(r1State)) notifyChanged()
          return r1State
        }
        const raw = await res.json()
        if (runGen !== generation || runOwner !== lastOwnerKey) return r1State
        const parsed = parseCredentialsResponse(raw)
        const prevSig = credentialSignature(r1State)
        r1State = parsed
        r1LoadedAt = now()
        r1EverLoaded = true
        if (prevSig !== credentialSignature(parsed)) notifyChanged()
        return parsed
      } catch (err) {
        if (runGen !== generation || runOwner !== lastOwnerKey) return r1State
        if (
          err instanceof TransportError &&
          (err.code === 'unauthorized' ||
            err.code === 'device_revoked' ||
            err.code === 'refresh_reused')
        ) {
          clear(err.code === 'device_revoked' ? 'device-revoked' : 'sign-out')
          lastOwnerKey = ''
          return EMPTY_CREDENTIALS
        }
        // Offline / transient failure: if never loaded, return empty; keep any previous state otherwise
        if (!r1EverLoaded) {
          r1State = EMPTY_CREDENTIALS
        }
        return r1State
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
      if (callerSignal?.aborted) {
        callController.abort()
      } else if (callerSignal) {
        callerSignal.addEventListener('abort', () => callController.abort(), { once: true })
      }

      activeStreams.set(callController, { onAbort: options?.onAbort })
      let streamHandedOff = false
      const releaseStream = () => {
        activeStreams.delete(callController)
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
          if (
            err.code === 'unauthorized' ||
            err.code === 'device_revoked' ||
            err.code === 'refresh_reused'
          ) {
            clear(err.code === 'device_revoked' ? 'device-revoked' : 'sign-out')
            lastOwnerKey = ''
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
        const res = await fetchFor(provider)(modelsUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        })
        if (runGen !== generation || runOwner !== lastOwnerKey) return []
        if (!res.ok) {
          if (await isProxy404(res)) {
            handleCredentialMissing(provider)
            return []
          }
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
        const ids = parseProxyModelIds(body)
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

  function chosenModelFor(provider: AiProviderId, localChoice?: string | LocalModelChoice): string {
    const item = credentialFor(provider)
    const meta = AI_PROVIDERS.find((m) => m.id === provider)
    const defaultModel = meta?.defaultModel ?? ''
    const localModel =
      typeof localChoice === 'string' ? localChoice.trim() : (localChoice?.model?.trim() ?? '')
    const localAt =
      typeof localChoice === 'object' && localChoice !== null ? (localChoice.updatedAt ?? 0) : 0

    if (!item) {
      return localModel || defaultModel
    }

    const serverModel = item.model.trim()
    const parsedServerAt = item.modelUpdatedAt ? Date.parse(item.modelUpdatedAt) : Number.NaN
    const serverAt = Number.isFinite(parsedServerAt) ? parsedServerAt : 0

    let chosen: string
    if (serverModel && localModel) {
      if (typeof localChoice === 'string') {
        chosen = localModel
      } else if (localAt > 0 && serverAt > 0) {
        chosen = localAt >= serverAt ? localModel : serverModel
      } else if (localAt > 0) {
        chosen = localModel
      } else if (localModel !== defaultModel && !item.modelUpdatedAt) {
        chosen = localModel
      } else {
        chosen = serverModel
      }
    } else if (serverModel) {
      chosen = serverModel
    } else if (localModel) {
      chosen = localModel
    } else {
      chosen = defaultModel
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
    localChoices?: Partial<Record<AiProviderId, string | LocalModelChoice>>,
    onChanged?: () => void,
    excludeProviders?: ReadonlySet<AiProviderId>,
  ): Partial<Record<AiProviderId, AiModelSource>> {
    if (onChanged) extraChangeListeners.add(onChanged)
    const target = syncOwner()
    if (!target || !r1State.hasByok || !r1State.byok.enabled) return {}
    const out: Partial<Record<AiProviderId, AiModelSource>> = {}
    for (const item of r1State.items) {
      if (excludeProviders?.has(item.provider)) continue
      const listInfo = readModelListState(target.ownerKey, item)
      const chosen = chosenModelFor(item.provider, localChoices?.[item.provider])
      out[item.provider] = {
        chosen,
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
    listModels,
    byokBaseUrl,
    fetchFor,
    clear,
    onAccountStatus,
    activeStreamCount: () => activeStreams.size,
  }
}
