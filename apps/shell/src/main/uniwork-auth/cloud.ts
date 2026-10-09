import {
  UNIWORK_CLOUD_SIGNED_OUT,
  UNIWORK_CLOUD_TOOLS,
  UniworkCloudError,
  type UniworkCloudCredits,
  type UniworkCloudErrorCode,
  type UniworkCloudMedia,
  type UniworkCloudSearchResult,
  type UniworkCloudState,
  type UniworkCloudStatus,
  type UniworkCloudTool,
  type UniworkCloudTransport,
} from '@genoffice/ai-provider'
import { isAllowedOrigin, type DeploymentProfile } from './deployment'
import { TransportError, type FetchLike } from './transport'

/**
 * Main-process client for the UniWork cloud tool routes
 * (`/api/v1/orgs/{orgID}/ai/cloud*`) plus the controller that keeps the
 * published cloud status. The bearer token comes from the account manager per
 * call (one refresh + retry after a 401) and is never part of a result, an
 * error or the published status; renderers only ever see UniworkCloudStatus.
 * The only URLs it builds are the deployment-profile origin + these routes.
 */

const ORG_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

/** per-route deadlines: the whole exchange, body included */
export const CLOUD_TIMEOUTS_MS = {
  status: 15_000,
  search: 30_000,
  images: 180_000,
  analyze: 180_000,
  transcribe: 300_000,
} as const

type CloudRoute = '' | '/search' | '/images' | '/media/analyze' | '/transcribe'

export interface CloudClientDeps {
  /** the active deployment profile (null = not configured) */
  profile(): DeploymentProfile | null
  /** the selected organization while signed in */
  orgId(): string | null
  /** account manager: a fresh token per call, one refresh + retry on TransportError `unauthorized` */
  withAccessToken<T>(call: (token: string) => Promise<T>): Promise<T>
  /** the app UI language as the server's analysis language (vi | en); omitted = the server default */
  locale?(): string | null
  fetch?: FetchLike
  timeouts?: Partial<typeof CLOUD_TIMEOUTS_MS>
}

/** the server's answer to GET /orgs/{orgID}/ai/cloud, camel-cased */
export interface CloudServerStatus {
  enabled: boolean
  reason?: string
  tools: Record<UniworkCloudTool, boolean>
  credits: UniworkCloudCredits | null
}

export interface UniworkCloudClient extends UniworkCloudTransport {
  status(signal?: AbortSignal): Promise<CloudServerStatus>
}

/** server error code -> cloud error code; anything else falls back by status */
const SERVER_CODES: ReadonlySet<string> = new Set<UniworkCloudErrorCode>([
  'entitlement_required',
  'subscription_inactive',
  'no_access',
  'credits_exhausted',
  'cloud_unavailable',
  'rate_limited',
])

async function cloudErrorFrom(response: Response): Promise<UniworkCloudError | TransportError> {
  let code: unknown
  try {
    const body = (await response.json()) as { error?: { code?: unknown } | string; code?: unknown }
    code =
      typeof body?.error === 'object' && body.error
        ? body.error.code
        : typeof body?.error === 'string'
          ? body.error
          : body?.code
  } catch {
    // no JSON body
  }
  const status = response.status
  // 401 goes back to the account manager for its one refresh + retry
  if (status === 401) return new TransportError('unauthorized', status, true)
  if (typeof code === 'string' && SERVER_CODES.has(code)) {
    return new UniworkCloudError(code as UniworkCloudErrorCode, status)
  }
  // the organization is not (or no longer) the caller's: not a plan problem
  if (code === 'forbidden' || code === 'not_found')
    return new UniworkCloudError('no_access', status)
  if (status === 402) return new UniworkCloudError('credits_exhausted', status)
  if (status === 403) return new UniworkCloudError('entitlement_required', status)
  if (status === 404) return new UniworkCloudError('no_access', status)
  if (status === 429) return new UniworkCloudError('rate_limited', status)
  if (status === 503) return new UniworkCloudError('cloud_unavailable', status)
  if (status >= 500) return new UniworkCloudError('server_error', status)
  return new UniworkCloudError('invalid_request', status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function malformed(): UniworkCloudError {
  return new UniworkCloudError('malformed_response')
}

function str(value: unknown, allowEmpty = true): string {
  if (typeof value !== 'string' || (!allowEmpty && !value)) throw malformed()
  return value
}

function optStr(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw malformed()
  return value
}

function optNum(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw malformed()
  return value
}

export function parseCloudStatus(raw: unknown): CloudServerStatus {
  if (!isRecord(raw) || typeof raw.enabled !== 'boolean') throw malformed()
  const toolsRaw = isRecord(raw.tools) ? raw.tools : {}
  const tools = {} as Record<UniworkCloudTool, boolean>
  for (const tool of UNIWORK_CLOUD_TOOLS) tools[tool] = toolsRaw[tool] === true
  let credits: UniworkCloudCredits | null = null
  if (isRecord(raw.credits)) {
    const c = raw.credits
    credits = {
      unit: optStr(c.unit) ?? 'ai.tokens',
      used: optNum(c.used) ?? 0,
      limit: optNum(c.limit),
      remaining: optNum(c.remaining),
      periodEnd: optStr(c.period_end) ?? null,
    }
  }
  const reason = optStr(raw.reason)
  return { enabled: raw.enabled, ...(reason ? { reason } : {}), tools, credits }
}

function parseMediaList(raw: unknown): UniworkCloudMedia[] {
  if (!Array.isArray(raw)) throw malformed()
  return raw.map((item) => {
    if (!isRecord(item)) throw malformed()
    return { mime: str(item.mime, false), dataBase64: str(item.data_base64, false) }
  })
}

function parseSearch(raw: unknown): { results: UniworkCloudSearchResult[]; answer?: string } {
  if (!isRecord(raw) || !Array.isArray(raw.results)) throw malformed()
  const results = raw.results.map((row): UniworkCloudSearchResult => {
    if (!isRecord(row)) throw malformed()
    const imageUrl = optStr(row.image_url)
    const thumbnailUrl = optStr(row.thumbnail_url)
    return {
      title: str(row.title),
      url: str(row.url),
      snippet: optStr(row.snippet) ?? '',
      ...(imageUrl ? { imageUrl } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    }
  })
  const answer = optStr(raw.answer)
  return { results, ...(answer ? { answer } : {}) }
}

function parseText(raw: unknown): { text: string } {
  if (!isRecord(raw)) throw malformed()
  return { text: str(raw.text) }
}

const media = (m: UniworkCloudMedia) => ({ mime: m.mime, data_base64: m.dataBase64 })

export function createUniworkCloudClient(deps: CloudClientDeps): UniworkCloudClient {
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init))
  const timeouts = { ...CLOUD_TIMEOUTS_MS, ...deps.timeouts }

  function baseUrl(): string {
    const profile = deps.profile()
    if (!profile) throw new UniworkCloudError('signed_out')
    const origin = new URL(profile.apiOrigin)
    if (!isAllowedOrigin(origin, profile.channel)) throw new UniworkCloudError('signed_out')
    const orgId = deps.orgId()
    if (!orgId) throw new UniworkCloudError('signed_out')
    if (!ORG_ID.test(orgId)) throw new UniworkCloudError('invalid_request')
    return `${origin.origin}/api/v1/orgs/${orgId}/ai/cloud`
  }

  /** one HTTP exchange with this token; 401 surfaces as TransportError for the retry */
  async function exchange(
    token: string,
    method: 'GET' | 'POST',
    url: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) throw new UniworkCloudError('aborted')
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const failure = (): UniworkCloudError =>
      new UniworkCloudError(timedOut ? 'timeout' : signal?.aborted ? 'aborted' : 'network')
    try {
      let response: Response
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        })
      } catch {
        throw failure()
      }
      if (!response.ok) {
        const error = await cloudErrorFrom(response)
        throw timedOut || signal?.aborted ? failure() : error
      }
      try {
        return await response.json()
      } catch {
        throw timedOut || signal?.aborted ? failure() : malformed()
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async function call<T>(
    method: 'GET' | 'POST',
    route: CloudRoute,
    body: unknown,
    timeoutMs: number,
    parse: (raw: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${baseUrl()}${route}`
    let raw: unknown
    try {
      raw = await deps.withAccessToken((token) =>
        exchange(token, method, url, body, timeoutMs, signal),
      )
    } catch (error) {
      if (error instanceof UniworkCloudError) throw error
      if (error instanceof TransportError) {
        // still 401 after the refresh, or the session ended meanwhile
        if (error.code === 'unauthorized' || error.code === 'device_revoked') {
          throw new UniworkCloudError('signed_out', error.status)
        }
        if (error.code === 'timeout') throw new UniworkCloudError('timeout')
        if (error.code === 'rate_limited') throw new UniworkCloudError('rate_limited')
        if (error.code === 'server_error') throw new UniworkCloudError('server_error')
        throw new UniworkCloudError('network')
      }
      throw new UniworkCloudError('network')
    }
    return parse(raw)
  }

  return {
    status: (signal) => call('GET', '', undefined, timeouts.status, parseCloudStatus, signal),
    search: (request, signal) =>
      call(
        'POST',
        '/search',
        { query: request.query, kind: request.kind, max_results: request.maxResults },
        timeouts.search,
        parseSearch,
        signal,
      ),
    generateImage: (request, signal) =>
      call(
        'POST',
        '/images',
        {
          prompt: request.prompt,
          ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
          ...(request.imageSize ? { image_size: request.imageSize } : {}),
          ...(request.referenceImages?.length
            ? { reference_images: request.referenceImages.map(media) }
            : {}),
        },
        timeouts.images,
        (raw) => {
          if (!isRecord(raw)) throw malformed()
          const images = parseMediaList(raw.images)
          if (!images.length) throw malformed()
          return { images, model: optStr(raw.model) ?? '' }
        },
        signal,
      ),
    analyzeMedia: (request, signal) => {
      const locale = deps.locale?.()
      return call(
        'POST',
        '/media/analyze',
        {
          requirements: request.requirements,
          media: request.media.map(media),
          ...(locale ? { locale } : {}),
        },
        timeouts.analyze,
        parseText,
        signal,
      )
    },
    transcribe: (request, signal) =>
      call(
        'POST',
        '/transcribe',
        { ...(request.prompt ? { prompt: request.prompt } : {}), audio: media(request.audio) },
        timeouts.transcribe,
        parseText,
        signal,
      ),
  }
}

// ── Status controller ───────────────────────────────────────────────

export interface CloudAccountView {
  signedIn: boolean
  orgId: string | null
  email?: string
  planName?: string
}

export interface CloudControllerDeps {
  client: UniworkCloudClient
  account(): CloudAccountView
  /** receives every new status (ai-provider seam + renderer push) */
  publish(status: UniworkCloudStatus): void
  /** re-reads the account's organizations and plan (a 403/404 may mean the membership changed) */
  refreshAccount?(): Promise<unknown>
  /** pauses between automatic re-reads after a transient failure; the last one repeats */
  retryDelaysMs?: readonly number[]
}

/** failures that say nothing about the plan: the cloud is re-read later on its own */
const TRANSIENT_CODES: ReadonlySet<string> = new Set<UniworkCloudErrorCode>([
  'network',
  'timeout',
  'server_error',
  'rate_limited',
  'cloud_unavailable',
])
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [30_000, 120_000, 600_000]
/** at most one account re-read per this long when calls keep answering "no access" */
const ACCOUNT_REFRESH_MIN_GAP_MS = 60_000

/** why the server says the cloud is off: a plan, billing or server-side configuration problem */
function stateForDisabled(reason: string | undefined): UniworkCloudState {
  switch (reason) {
    case undefined:
    case 'entitlement_required':
      return 'not-entitled'
    case 'subscription_inactive':
      return 'subscription-inactive'
    default:
      // cloud_unavailable (no tool configured on the server) and anything unknown
      return 'unavailable'
  }
}

/** the published status for a server answer */
export function statusFromServer(
  server: CloudServerStatus,
  account: CloudAccountView,
): UniworkCloudStatus {
  const display = {
    ...(account.email ? { email: account.email } : {}),
    ...(account.planName ? { planName: account.planName } : {}),
  }
  if (!server.enabled) {
    return {
      ...UNIWORK_CLOUD_SIGNED_OUT,
      state: stateForDisabled(server.reason),
      credits: server.credits,
      ...display,
    }
  }
  // enabled with a zero cap: the plan has no AI credits at all, which is not "used up"
  if (server.credits?.limit === 0) {
    return { ...UNIWORK_CLOUD_SIGNED_OUT, state: 'not-entitled', credits: null, ...display }
  }
  const anyTool = UNIWORK_CLOUD_TOOLS.some((tool) => server.tools[tool])
  const exhausted = server.credits?.remaining === 0
  return {
    state: exhausted ? 'credits-exhausted' : anyTool ? 'ready' : 'unavailable',
    enabled: true,
    tools: { ...server.tools },
    credits: server.credits,
    ...display,
  }
}

/**
 * Keeps the cloud status of the selected organization: re-read on account /
 * entitlement changes and after every tool call (credits move). Reads are
 * single-flight per account generation; an answer for an account or
 * organization that is no longer current is dropped.
 */
export class UniworkCloudController {
  private readonly deps: CloudControllerDeps
  private current: UniworkCloudStatus = UNIWORK_CLOUD_SIGNED_OUT
  /** the org the current status belongs to */
  private currentOrg: string | null = null
  private generation = 0
  private inFlight: { key: string; run: Promise<UniworkCloudStatus> } | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  private lastAccountRefresh = 0

  constructor(deps: CloudControllerDeps) {
    this.deps = deps
  }

  /** stops the automatic re-read (quit) */
  dispose(): void {
    this.generation++
    this.inFlight = null
    this.clearRetry()
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.retryAttempt = 0
  }

  /** a transient failure left the status unread or stale: read again after a growing pause */
  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    const delays = this.deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
    const delay = delays[Math.min(this.retryAttempt, delays.length - 1)] ?? 600_000
    this.retryAttempt++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.refresh().catch(() => undefined)
    }, delay)
    this.retryTimer.unref?.()
  }

  /** the membership may have changed: re-read the account, at most once a minute */
  private refreshAccountSoon(): void {
    const refresh = this.deps.refreshAccount
    if (!refresh || Date.now() - this.lastAccountRefresh < ACCOUNT_REFRESH_MIN_GAP_MS) return
    this.lastAccountRefresh = Date.now()
    void Promise.resolve(refresh()).catch(() => undefined)
  }

  status(): UniworkCloudStatus {
    return this.current
  }

  private set(next: UniworkCloudStatus, orgId: string | null): void {
    this.current = next
    this.currentOrg = orgId
    this.deps.publish(next)
  }

  /**
   * Re-reads the status (or publishes signed-out at once when there is no
   * session). A read already in flight is joined unless `fresh` is set: the
   * credits moved after that read started, so it is superseded (its answer is
   * dropped) by a new one.
   */
  refresh(options: { fresh?: boolean } = {}): Promise<UniworkCloudStatus> {
    const account = this.deps.account()
    if (!account.signedIn || !account.orgId) {
      this.generation++
      this.inFlight = null
      this.clearRetry()
      if (this.current.state !== 'signed-out') this.set(UNIWORK_CLOUD_SIGNED_OUT, null)
      return Promise.resolve(this.current)
    }
    const key = account.orgId
    if (!options.fresh && this.inFlight?.key === key) return this.inFlight.run
    const generation = ++this.generation
    const run = this.read(account, generation).finally(() => {
      if (this.inFlight?.run === run) this.inFlight = null
    })
    this.inFlight = { key, run }
    return run
  }

  private async read(account: CloudAccountView, generation: number): Promise<UniworkCloudStatus> {
    let next: UniworkCloudStatus
    let answered = false
    try {
      next = statusFromServer(await this.deps.client.status(), account)
      answered = true
    } catch (error) {
      if (generation !== this.generation) return this.current
      const code = error instanceof UniworkCloudError ? error.code : 'network'
      if (code === 'signed_out') {
        next = UNIWORK_CLOUD_SIGNED_OUT
      } else if (code === 'entitlement_required') {
        next = { ...UNIWORK_CLOUD_SIGNED_OUT, state: 'not-entitled' }
      } else if (code === 'subscription_inactive') {
        next = { ...UNIWORK_CLOUD_SIGNED_OUT, state: 'subscription-inactive' }
      } else if (code === 'no_access') {
        // not a plan problem: the organization is gone for this user, so re-read the account
        this.refreshAccountSoon()
        next = { ...UNIWORK_CLOUD_SIGNED_OUT, state: 'unavailable' }
      } else {
        if (TRANSIENT_CODES.has(code)) this.scheduleRetry()
        if (this.currentOrg === account.orgId && this.current.state !== 'signed-out') {
          // a passing outage keeps the last known answer for this organization
          return this.current
        }
        next = { ...UNIWORK_CLOUD_SIGNED_OUT, state: 'unavailable' }
      }
    }
    if (generation !== this.generation) return this.current
    // any answer from the server (even "off") ends the retry cycle; a failure that left a status keeps it
    if (answered || next.state !== 'unavailable') this.clearRetry()
    this.set(next, account.orgId)
    return next
  }

  /** a tool call's verdict that changes what the UI shows, before the re-read lands */
  private noteError(error: unknown): void {
    if (!(error instanceof UniworkCloudError)) return
    const orgId = this.currentOrg
    if (error.code === 'credits_exhausted' && this.current.enabled) {
      const credits = this.current.credits ? { ...this.current.credits, remaining: 0 } : null
      this.set({ ...this.current, state: 'credits-exhausted', credits }, orgId)
    } else if (error.code === 'entitlement_required') {
      this.set({ ...UNIWORK_CLOUD_SIGNED_OUT, state: 'not-entitled' }, orgId)
    } else if (error.code === 'subscription_inactive') {
      this.set({ ...UNIWORK_CLOUD_SIGNED_OUT, state: 'subscription-inactive' }, orgId)
    } else if (error.code === 'no_access') {
      this.set({ ...UNIWORK_CLOUD_SIGNED_OUT, state: 'unavailable' }, orgId)
      this.refreshAccountSoon()
    }
  }

  private async tracked<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      this.noteError(error)
      throw error
    } finally {
      // credits moved (or the verdict changed): re-read in the background, superseding
      // a read that started before this call was charged
      void this.refresh({ fresh: true }).catch(() => undefined)
    }
  }

  /** the transport installed in the ai-provider seam */
  transport(): UniworkCloudTransport {
    const client = this.deps.client
    return {
      search: (request, signal) => this.tracked(() => client.search(request, signal)),
      generateImage: (request, signal) => this.tracked(() => client.generateImage(request, signal)),
      analyzeMedia: (request, signal) => this.tracked(() => client.analyzeMedia(request, signal)),
      transcribe: (request, signal) => this.tracked(() => client.transcribe(request, signal)),
    }
  }
}
