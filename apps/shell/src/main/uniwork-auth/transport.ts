import { isAllowedOrigin, type DeploymentProfile } from './deployment'

/**
 * Main-process HTTP client for the UniWork desktop auth routes plus the three
 * account reads. The only URLs it can build are the profile origin + one of
 * the routes below; responses are parsed strictly from the server's
 * snake_case DTOs and fail closed on a missing or mistyped field.
 */

export type TransportErrorCode =
  | 'network'
  | 'timeout'
  | 'server_error'
  | 'malformed_response'
  | 'rate_limited'
  | 'unauthorized'
  | 'auth_code_invalid'
  | 'device_revoked'
  | 'refresh_reused'
  | 'wrong_deployment'
  | 'desktop_auth_unavailable'
  | 'invalid_request'
  | 'forbidden'

export class TransportError extends Error {
  readonly code: TransportErrorCode
  readonly status?: number
  constructor(code: TransportErrorCode, status?: number) {
    // never carries a URL, body, or token: the code is the whole story
    super(`uniwork request failed: ${code}`)
    this.name = 'TransportError'
    this.code = code
    this.status = status
  }
}

export interface DesktopSession {
  accountId: string
  deviceSessionId: string
  sessionId: string
  deploymentId: string
  accessToken: string
  refreshToken: string
  expiresIn: number
  refreshExpiresIn: number
}

export interface StartRequest {
  clientId: string
  codeChallenge: string
  state: string
  redirectUri: string
  deviceLabel?: string
  platform?: string
  build?: string
}

export interface MeResponse {
  id: string
  email: string
  displayName: string
  avatarUrl?: string
}

export interface OrgResponse {
  id: string
  name: string
  slug: string
  role: string
  /** active | suspended | archived; absent is treated as active */
  status: string
}

export interface BillingResponse {
  planCode: string
  planName: string
  status: string
  features: {
    featureKey: string
    name: string
    kind: 'flag' | 'quota'
    enabled: boolean
    quotaLimit: number | null
    currentUsage: number
    unit?: string
  }[]
}

export interface UniworkTransport {
  start(request: StartRequest): Promise<{ authorizationUrl: string }>
  exchange(request: {
    clientId: string
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<DesktopSession>
  refresh(request: { deviceSessionId: string; refreshToken: string }): Promise<DesktopSession>
  logout(request: { deviceSessionId: string }, accessToken: string): Promise<void>
  me(accessToken: string): Promise<MeResponse>
  orgs(accessToken: string): Promise<OrgResponse[]>
  billing(orgId: string, accessToken: string): Promise<BillingResponse>
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export const REQUEST_TIMEOUT_MS = 15_000
const ORG_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

type Route =
  | '/auth/desktop/start'
  | '/auth/desktop/exchange'
  | '/auth/desktop/refresh'
  | '/auth/desktop/logout'
  | '/me'
  | '/orgs'
  | `/orgs/${string}/billing`

/** server error code -> transport code; anything else falls back by status */
const SERVER_CODES: ReadonlySet<string> = new Set([
  'unauthorized',
  'auth_code_invalid',
  'device_revoked',
  'refresh_reused',
  'rate_limited',
  'desktop_auth_unavailable',
  'invalid_request',
  'forbidden',
])

async function errorFromResponse(response: Response): Promise<TransportError> {
  let code: unknown
  try {
    const body = (await response.json()) as { error?: { code?: unknown } }
    code = body?.error?.code
  } catch {
    // no JSON body
  }
  const status = response.status
  if (typeof code === 'string' && SERVER_CODES.has(code)) {
    return new TransportError(code as TransportErrorCode, status)
  }
  if (status === 429) return new TransportError('rate_limited', status)
  if (status >= 500) return new TransportError('server_error', status)
  if (status === 401) return new TransportError('unauthorized', status)
  if (status === 403) return new TransportError('forbidden', status)
  return new TransportError('invalid_request', status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function str(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new TransportError('malformed_response')
  return value
}

function optStr(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new TransportError('malformed_response')
  return value
}

function positiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TransportError('malformed_response')
  }
  return value
}

export function parseSession(raw: unknown, deploymentId: string): DesktopSession {
  if (!isRecord(raw)) throw new TransportError('malformed_response')
  const session: DesktopSession = {
    accountId: str(raw.account_id),
    deviceSessionId: str(raw.device_session_id),
    sessionId: str(raw.session_id),
    deploymentId: str(raw.deployment_id),
    accessToken: str(raw.access_token),
    refreshToken: str(raw.refresh_token),
    expiresIn: positiveInt(raw.expires_in),
    refreshExpiresIn: positiveInt(raw.refresh_expires_in),
  }
  if (raw.token_type !== undefined && raw.token_type !== 'Bearer') {
    throw new TransportError('malformed_response')
  }
  if (session.deploymentId !== deploymentId) throw new TransportError('wrong_deployment')
  return session
}

export function parseMe(raw: unknown): MeResponse {
  if (!isRecord(raw) || !isRecord(raw.user)) throw new TransportError('malformed_response')
  const user = raw.user
  if (typeof user.display_name !== 'string') throw new TransportError('malformed_response')
  const avatarUrl = optStr(user.avatar_url)
  return {
    id: str(user.id),
    email: str(user.email),
    displayName: user.display_name,
    ...(avatarUrl ? { avatarUrl } : {}),
  }
}

export function parseOrgs(raw: unknown): OrgResponse[] {
  if (!isRecord(raw) || !Array.isArray(raw.organizations)) {
    throw new TransportError('malformed_response')
  }
  return raw.organizations.map((row) => {
    if (!isRecord(row)) throw new TransportError('malformed_response')
    return {
      id: str(row.id),
      name: str(row.name),
      slug: str(row.slug),
      role: optStr(row.role) ?? '',
      status: optStr(row.status) ?? 'active',
    }
  })
}

export function parseBilling(raw: unknown): BillingResponse {
  if (!isRecord(raw) || !isRecord(raw.subscription) || !Array.isArray(raw.entitlements)) {
    throw new TransportError('malformed_response')
  }
  const sub = raw.subscription
  return {
    planCode: str(sub.plan_code),
    planName: str(sub.plan_name),
    status: str(sub.status),
    features: raw.entitlements.map((row) => {
      if (!isRecord(row)) throw new TransportError('malformed_response')
      if (row.kind !== 'flag' && row.kind !== 'quota')
        throw new TransportError('malformed_response')
      if (typeof row.enabled !== 'boolean') throw new TransportError('malformed_response')
      const limit = row.quota_limit
      if (
        limit !== null &&
        limit !== undefined &&
        (typeof limit !== 'number' || !Number.isFinite(limit))
      ) {
        throw new TransportError('malformed_response')
      }
      const usage = row.current_usage ?? 0
      if (typeof usage !== 'number' || !Number.isFinite(usage)) {
        throw new TransportError('malformed_response')
      }
      const unit = optStr(row.unit)
      return {
        featureKey: str(row.feature_key),
        name: optStr(row.name) ?? '',
        kind: row.kind,
        enabled: row.enabled,
        quotaLimit: typeof limit === 'number' ? limit : null,
        currentUsage: usage,
        ...(unit ? { unit } : {}),
      }
    }),
  }
}

export function createUniworkTransport(
  profile: DeploymentProfile,
  options: { fetch?: FetchLike; timeoutMs?: number } = {},
): UniworkTransport {
  const origin = new URL(profile.apiOrigin)
  if (!isAllowedOrigin(origin, profile.channel)) throw new Error('UniWork origin must use HTTPS')
  const base = `${origin.origin}/api/v1`
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS

  async function request(
    method: 'GET' | 'POST',
    route: Route,
    opts: { query?: URLSearchParams; body?: unknown; accessToken?: string } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    let response: Response
    try {
      response = await fetchImpl(`${base}${route}${opts.query ? `?${opts.query}` : ''}`, {
        method,
        headers,
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      })
    } catch {
      throw new TransportError(timedOut ? 'timeout' : 'network')
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) throw await errorFromResponse(response)
    try {
      return await response.json()
    } catch {
      throw new TransportError('malformed_response', response.status)
    }
  }

  const sessionRequest = async (route: Route, body: unknown) =>
    parseSession(await request('POST', route, { body }), profile.deploymentId)

  return {
    async start(input) {
      const query = new URLSearchParams({
        client_id: input.clientId,
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
        state: input.state,
        redirect_uri: input.redirectUri,
        deployment_id: profile.deploymentId,
      })
      if (input.deviceLabel) query.set('device_label', input.deviceLabel)
      if (input.platform) query.set('platform', input.platform)
      if (input.build) query.set('build', input.build)
      const raw = await request('GET', '/auth/desktop/start', { query })
      if (!isRecord(raw)) throw new TransportError('malformed_response')
      const url = str(raw.authorization_url)
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new TransportError('malformed_response')
      }
      if (!isAllowedOrigin(parsed, profile.channel) || parsed.username || parsed.password) {
        throw new TransportError('malformed_response')
      }
      return { authorizationUrl: parsed.href }
    },
    exchange: (input) =>
      sessionRequest('/auth/desktop/exchange', {
        client_id: input.clientId,
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
        deployment_id: profile.deploymentId,
      }),
    refresh: (input) =>
      sessionRequest('/auth/desktop/refresh', {
        device_session_id: input.deviceSessionId,
        refresh_token: input.refreshToken,
        deployment_id: profile.deploymentId,
      }),
    async logout(input, accessToken) {
      await request('POST', '/auth/desktop/logout', {
        accessToken,
        body: {
          device_session_id: input.deviceSessionId,
          deployment_id: profile.deploymentId,
          scope: 'device',
        },
      })
    },
    async me(accessToken) {
      return parseMe(await request('GET', '/me', { accessToken }))
    },
    async orgs(accessToken) {
      return parseOrgs(await request('GET', '/orgs', { accessToken }))
    },
    async billing(orgId, accessToken) {
      if (!ORG_ID.test(orgId)) throw new TransportError('invalid_request')
      return parseBilling(await request('GET', `/orgs/${orgId}/billing`, { accessToken }))
    },
  }
}
