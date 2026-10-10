/**
 * Local stand-in for the UniWork desktop auth server, replaying the wire
 * contract (`/api/v1/auth/desktop/*`, `/me`, `/orgs`, `/orgs/{id}/billing`)
 * plus the UniWork cloud tool routes (`/orgs/{id}/ai/cloud*`, GO-A7 contract).
 * It validates what the real server validates (client id, S256 challenge
 * length, exact redirect URI, deployment id, PKCE on exchange, single-use
 * codes, refresh rotation) so the shell's sign-in flow is exercised end to end
 * without a network dependency.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const STUB_CLIENT_ID = 'uniwork-office-dev'
export const STUB_REDIRECT_URI = 'uniwork-office-dev://auth/callback'
export const STUB_DEPLOYMENT_ID = 'default'

export const STUB_ACCOUNT = {
  id: 'acct_e2e_01',
  email: 'ada.lovelace@example.test',
  displayName: 'Ada Lovelace',
}
export const STUB_ORG = {
  id: 'org_e2e_01',
  name: 'Analytical Engines Ltd',
  slug: 'analytical',
  role: 'owner',
}
export const STUB_PLAN = { code: 'team', name: 'Team Plan' }

export interface StubAttempt {
  id: string
  clientId: string
  codeChallenge: string
  state: string
  redirectUri: string
  deploymentId: string
  /** set by approve(); the authorization code bound to this attempt */
  code?: string
  redeemed: boolean
}

export type StubRefreshMode = 'ok' | 'device_revoked' | 'refresh_reused'

/**
 * What a route extension sees for a request that already carried a live bearer
 * token and matched no auth route (see `UniworkAuthStubOptions.extend`).
 */
export interface StubRouteContext {
  req: IncomingMessage
  res: ServerResponse
  /** path below `/api/v1` */
  route: string
  url: URL
  /** the raw request body */
  readBody(): Promise<Buffer>
  send(status: number, body: unknown): void
  /** the device session the stub issued last (what a launch exchange must carry) */
  deviceSessionId(): string
}

export interface UniworkAuthStubOptions {
  /**
   * Extra authenticated routes on the same origin. Resolve true once the
   * request was answered (or deliberately left hanging/dropped); false falls
   * through to the stub's 404.
   */
  extend?: (ctx: StubRouteContext) => Promise<boolean> | boolean
  /** what the cloud AI routes answer (default ready) */
  cloudMode?: StubCloudMode
}

/**
 * What the cloud routes answer: `ready` (entitled, credits left, every tool
 * on), `not_entitled` (status enabled=false, tools 403), `credits_exhausted`
 * (remaining 0, tools 402), `unavailable` (entitled, no tool configured,
 * tools 503), `subscription_inactive` (status enabled=false with that reason,
 * tools 403) and `not_configured` (status enabled=false, reason
 * cloud_unavailable: the plan has it but the server has no tool configured).
 */
export type StubCloudMode =
  | 'ready'
  | 'not_entitled'
  | 'credits_exhausted'
  | 'unavailable'
  | 'subscription_inactive'
  | 'not_configured'

/** a 1x1 PNG the image route returns */
export const STUB_CLOUD_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export interface UniworkAuthStub {
  /** `http://127.0.0.1:<port>` */
  origin: string
  /** the most recent `/auth/desktop/start` attempt, or undefined */
  lastAttempt(): StubAttempt | undefined
  /** issues a code for the last attempt and returns `redirect_uri?code=..&state=..` */
  approve(): string
  /** number of `POST /auth/desktop/logout` calls */
  logoutCalls(): number
  refreshCalls(): number
  /** what refresh answers: a rotated session, or a 401 with that error code */
  setRefreshBehavior(mode: StubRefreshMode): void
  /** what the `/ai/cloud*` routes answer from now on (default `ready`) */
  setCloudMode(mode: StubCloudMode): void
  /** every cloud route call: method, route under the org, and whether the bearer was live */
  cloudCalls(): { method: string; route: string; authorized: boolean }[]
  /** every secret the stub issued or saw (tokens, codes, PKCE verifiers, attempt states) */
  issuedSecrets(): string[]
  /** the device session id of the last sign-in ('' before one) */
  deviceSessionId(): string
  close(): Promise<void>
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function startUniworkAuthStub(
  options: UniworkAuthStubOptions = {},
): Promise<UniworkAuthStub> {
  const attempts: StubAttempt[] = []
  const codes = new Map<string, StubAttempt>()
  const secrets: string[] = []
  const accessTokens = new Set<string>()
  /** access tokens of a revoked device: the server answers device_revoked */
  const revokedAccess = new Set<string>()
  let deviceRevoked = false
  let refreshToken = ''
  let deviceSessionId = ''
  let logouts = 0
  let refreshes = 0
  let refreshMode: StubRefreshMode = 'ok'
  let cloudMode: StubCloudMode = options.cloudMode ?? 'ready'
  const cloudLog: { method: string; route: string; authorized: boolean }[] = []
  let creditsUsed = 1_200

  const issue = (prefix: string): string => {
    const value = `${prefix}_${b64url(randomBytes(24))}`
    secrets.push(value)
    return value
  }

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const fail = (res: ServerResponse, status: number, code: string): void =>
    send(res, status, { error: { code, message: code } })

  function session(): Record<string, unknown> {
    const access = issue('at')
    accessTokens.add(access)
    refreshToken = issue('rt')
    return {
      account_id: STUB_ACCOUNT.id,
      device_session_id: deviceSessionId,
      session_id: deviceSessionId,
      deployment_id: STUB_DEPLOYMENT_ID,
      access_token: access,
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: refreshToken,
      refresh_expires_in: 2_592_000,
      refresh_rotates: true,
    }
  }

  /** logout, refresh reuse: the whole device family dies, as on the server */
  const revokeDevice = (): void => {
    deviceRevoked = true
    for (const token of accessTokens) revokedAccess.add(token)
    accessTokens.clear()
  }

  /** null when the bearer token is live, else the error code the server sends */
  const bearerError = (req: IncomingMessage): string | null => {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (accessTokens.has(token)) return null
    return revokedAccess.has(token) ? 'device_revoked' : 'unauthorized'
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  function start(url: URL, res: ServerResponse, origin: string): void {
    const q = url.searchParams
    const challenge = q.get('code_challenge') ?? ''
    if (
      q.get('client_id') !== STUB_CLIENT_ID ||
      q.get('code_challenge_method') !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      !q.get('state') ||
      q.get('redirect_uri') !== STUB_REDIRECT_URI ||
      q.get('deployment_id') !== STUB_DEPLOYMENT_ID
    ) {
      return fail(res, 400, 'invalid_request')
    }
    const attempt: StubAttempt = {
      id: `att_${b64url(randomBytes(9))}`,
      clientId: STUB_CLIENT_ID,
      codeChallenge: challenge,
      state: q.get('state') as string,
      redirectUri: STUB_REDIRECT_URI,
      deploymentId: STUB_DEPLOYMENT_ID,
      redeemed: false,
    }
    attempts.push(attempt)
    secrets.push(attempt.state)
    send(res, 200, {
      authorization_url: `${origin}/auth/desktop/authorize?attempt=${attempt.id}`,
      attempt_expires_at: new Date(Date.now() + 600_000).toISOString(),
    })
  }

  function exchange(body: Record<string, unknown>, res: ServerResponse): void {
    const attempt = typeof body.code === 'string' ? codes.get(body.code) : undefined
    const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : ''
    if (verifier) secrets.push(verifier)
    const valid =
      attempt &&
      !attempt.redeemed &&
      body.client_id === attempt.clientId &&
      body.redirect_uri === attempt.redirectUri &&
      body.deployment_id === attempt.deploymentId &&
      verifier.length >= 43 &&
      b64url(createHash('sha256').update(verifier, 'ascii').digest()) === attempt.codeChallenge
    if (!attempt || !valid) return fail(res, 401, 'auth_code_invalid')
    attempt.redeemed = true
    deviceSessionId = `dev_${b64url(randomBytes(9))}`
    deviceRevoked = false
    send(res, 200, session())
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = `http://${req.headers.host}`
    const url = new URL(req.url ?? '/', origin)
    if (!url.pathname.startsWith('/api/v1/')) return fail(res, 404, 'not_found')
    const route = url.pathname.slice('/api/v1'.length)
    if (req.method === 'GET' && route === '/auth/desktop/start') return start(url, res, origin)
    if (req.method === 'POST' && route === '/auth/desktop/exchange') {
      return exchange(await readJson(req), res)
    }
    if (req.method === 'POST' && route === '/auth/desktop/refresh') {
      const body = await readJson(req)
      refreshes += 1
      if (refreshMode !== 'ok') return fail(res, 401, refreshMode)
      if (
        deviceRevoked ||
        body.device_session_id !== deviceSessionId ||
        body.deployment_id !== STUB_DEPLOYMENT_ID
      ) {
        return fail(res, 401, 'device_revoked')
      }
      if (body.refresh_token !== refreshToken) {
        revokeDevice()
        return fail(res, 401, 'refresh_reused')
      }
      return send(res, 200, session())
    }
    if (req.method === 'POST' && route === '/auth/desktop/logout') {
      const denied = bearerError(req)
      if (denied) return fail(res, 401, denied)
      const body = await readJson(req)
      if (body.scope !== 'device' || body.device_session_id !== deviceSessionId) {
        return fail(res, 400, 'invalid_request')
      }
      logouts += 1
      revokeDevice()
      return send(res, 200, { status: 'ok' })
    }
    // cloud routes check (and log) the bearer themselves
    const cloudPrefix = `/orgs/${STUB_ORG.id}/ai/cloud`
    if (route === cloudPrefix || route.startsWith(`${cloudPrefix}/`)) {
      return cloud(req, res, route.slice(cloudPrefix.length))
    }
    const denied = bearerError(req)
    if (denied) return fail(res, 401, denied)
    if (req.method === 'GET' && route === '/me') {
      return send(res, 200, {
        user: {
          id: STUB_ACCOUNT.id,
          email: STUB_ACCOUNT.email,
          display_name: STUB_ACCOUNT.displayName,
        },
      })
    }
    if (req.method === 'GET' && route === '/orgs') {
      return send(res, 200, { organizations: [{ ...STUB_ORG, status: 'active' }] })
    }
    if (req.method === 'GET' && route === `/orgs/${STUB_ORG.id}/billing`) {
      return send(res, 200, {
        subscription: { plan_code: STUB_PLAN.code, plan_name: STUB_PLAN.name, status: 'active' },
        entitlements: [
          {
            feature_key: 'ai_assistant',
            name: 'AI assistant',
            kind: 'flag',
            enabled: true,
            quota_limit: null,
            current_usage: 0,
          },
        ],
      })
    }
    if (options.extend) {
      const handled = await options.extend({
        req,
        res,
        route,
        url,
        readBody: async () => {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          return Buffer.concat(chunks)
        },
        send: (status, body) => send(res, status, body),
        deviceSessionId: () => deviceSessionId,
      })
      if (handled) return
    }
    return fail(res, 404, 'not_found')
  }

  const CLOUD_LIMIT = 50_000

  function cloudStatus(): Record<string, unknown> {
    const reason =
      cloudMode === 'not_entitled'
        ? 'entitlement_required'
        : cloudMode === 'subscription_inactive'
          ? 'subscription_inactive'
          : cloudMode === 'not_configured'
            ? 'cloud_unavailable'
            : null
    const entitled = reason === null
    const toolsOn = cloudMode === 'ready' || cloudMode === 'credits_exhausted'
    const tools = Object.fromEntries(
      ['web_search', 'image_search', 'image_generate', 'media_analyze', 'transcribe'].map((t) => [
        t,
        entitled && toolsOn,
      ]),
    )
    return {
      enabled: entitled,
      ...(reason ? { reason } : {}),
      tools,
      credits: {
        unit: 'ai.tokens',
        used: cloudMode === 'credits_exhausted' ? CLOUD_LIMIT : creditsUsed,
        limit: CLOUD_LIMIT,
        remaining: cloudMode === 'credits_exhausted' ? 0 : CLOUD_LIMIT - creditsUsed,
        period_end: '2026-11-01T00:00:00Z',
      },
    }
  }

  async function cloud(req: IncomingMessage, res: ServerResponse, sub: string): Promise<void> {
    const authError = bearerError(req)
    cloudLog.push({ method: req.method ?? '', route: sub || '/', authorized: !authError })
    if (authError) return fail(res, 401, authError)
    if (req.method === 'GET' && sub === '') return send(res, 200, cloudStatus())
    if (req.method !== 'POST') return fail(res, 404, 'not_found')
    const body = await readJson(req)
    if (cloudMode === 'not_entitled') return fail(res, 403, 'entitlement_required')
    if (cloudMode === 'subscription_inactive') return fail(res, 403, 'subscription_inactive')
    if (cloudMode === 'not_configured') return fail(res, 503, 'cloud_unavailable')
    if (cloudMode === 'credits_exhausted') return fail(res, 402, 'credits_exhausted')
    if (cloudMode === 'unavailable') return fail(res, 503, 'cloud_unavailable')
    if (sub === '/search') {
      if (typeof body.query !== 'string' || !body.query) return fail(res, 400, 'invalid_request')
      creditsUsed += 500
      const image = body.kind === 'image'
      return send(res, 200, {
        results: [
          {
            title: `UniWork result for ${body.query}`,
            url: 'https://example.com/article',
            snippet: 'A stub search result.',
            ...(image ? { image_url: 'https://example.com/photo.png' } : {}),
          },
        ],
        ...(image ? {} : { answer: 'Stub answer.' }),
      })
    }
    if (sub === '/images') {
      if (typeof body.prompt !== 'string' || !body.prompt) return fail(res, 400, 'invalid_request')
      creditsUsed += 4_000
      return send(res, 200, {
        images: [{ mime: 'image/png', data_base64: STUB_CLOUD_IMAGE_BASE64 }],
        model: 'stub-image',
      })
    }
    if (sub === '/media/analyze' || sub === '/transcribe') {
      creditsUsed += 1_000
      return send(res, 200, {
        text: sub === '/transcribe' ? 'Stub transcript.' : 'A stub analysis.',
      })
    }
    return fail(res, 404, 'not_found')
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) fail(res, 500, 'server_error')
      else res.end()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  return {
    origin: `http://127.0.0.1:${port}`,
    lastAttempt: () => attempts[attempts.length - 1],
    approve() {
      const attempt = attempts[attempts.length - 1]
      if (!attempt) throw new Error('no sign-in attempt to approve')
      const code = issue('code')
      attempt.code = code
      codes.set(code, attempt)
      return `${attempt.redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(attempt.state)}`
    },
    logoutCalls: () => logouts,
    refreshCalls: () => refreshes,
    setRefreshBehavior: (mode) => {
      refreshMode = mode
    },
    setCloudMode: (mode) => {
      cloudMode = mode
    },
    cloudCalls: () => [...cloudLog],
    issuedSecrets: () => [...secrets],
    deviceSessionId: () => deviceSessionId,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
