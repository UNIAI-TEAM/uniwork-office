import { describe, expect, it, vi } from 'vitest'
import {
  parseDeploymentProfile,
  redirectUriForProfile,
  resolveDeploymentProfile,
  type DeploymentProfile,
} from '../src/main/uniwork-auth/deployment'
import {
  classifyCallbackRejection,
  classifyTransportFailure,
  pickOrg,
} from '../src/main/uniwork-auth/mapping'
import {
  TransportError,
  createUniworkTransport,
  type FetchLike,
  type TransportErrorCode,
} from '../src/main/uniwork-auth/transport'

const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  channel: 'stable',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const sessionBody = (overrides: Record<string, unknown> = {}) => ({
  account_id: 'acc_1',
  device_session_id: 'dev_1',
  session_id: 'sess_1',
  deployment_id: 'default',
  access_token: 'at_1',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'rt_1',
  refresh_expires_in: 2592000,
  refresh_rotates: true,
  ...overrides,
})

async function codeOf(promise: Promise<unknown>): Promise<TransportErrorCode> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(TransportError)
    return (error as TransportError).code
  }
  throw new Error('expected a TransportError')
}

describe('UniWork transport', () => {
  it('start sends the PKCE query and refuses redirects / caching', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        authorization_url: 'https://uniwork.example/auth/desktop/authorize?a=1',
        attempt_expires_at: 'x',
      }),
    )
    const transport = createUniworkTransport(profile, { fetch })
    const result = await transport.start({
      clientId: 'uniwork-office',
      codeChallenge: 'c'.repeat(43),
      state: 'state_1',
      redirectUri: 'uniwork-office://auth/callback',
    })
    expect(result.authorizationUrl).toBe('https://uniwork.example/auth/desktop/authorize?a=1')
    const [url, init] = fetch.mock.calls[0]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe(
      'https://uniwork.example/api/v1/auth/desktop/start',
    )
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
      client_id: 'uniwork-office',
      code_challenge_method: 'S256',
      state: 'state_1',
      redirect_uri: 'uniwork-office://auth/callback',
      deployment_id: 'default',
    })
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' })
  })

  it('start rejects a non-https authorization URL', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, { authorization_url: 'http://evil.example/x' }),
    )
    const transport = createUniworkTransport(profile, { fetch })
    expect(
      await codeOf(
        transport.start({
          clientId: 'uniwork-office',
          codeChallenge: 'c',
          state: 's',
          redirectUri: 'r',
        }),
      ),
    ).toBe('malformed_response')
  })

  it('exchange posts snake_case and parses the session strictly', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, sessionBody()))
    const transport = createUniworkTransport(profile, { fetch })
    const session = await transport.exchange({
      clientId: 'uniwork-office',
      code: 'code_1',
      codeVerifier: 'v'.repeat(64),
      redirectUri: 'uniwork-office://auth/callback',
    })
    expect(session).toMatchObject({
      accountId: 'acc_1',
      accessToken: 'at_1',
      refreshToken: 'rt_1',
      expiresIn: 900,
    })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://uniwork.example/api/v1/auth/desktop/exchange')
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: 'uniwork-office',
      code: 'code_1',
      code_verifier: 'v'.repeat(64),
      redirect_uri: 'uniwork-office://auth/callback',
      deployment_id: 'default',
    })
  })

  it.each([
    [{ deployment_id: 'other' }, 'wrong_deployment'],
    [{ access_token: undefined }, 'malformed_response'],
    [{ expires_in: '900' }, 'malformed_response'],
    [{ refresh_expires_in: 0 }, 'malformed_response'],
    [{ token_type: 'MAC' }, 'malformed_response'],
  ])('refresh rejects session %j as %s', async (override, code) => {
    const fetch = vi.fn<FetchLike>(async () => json(200, sessionBody(override)))
    const transport = createUniworkTransport(profile, { fetch })
    expect(await codeOf(transport.refresh({ deviceSessionId: 'dev_1', refreshToken: 'rt' }))).toBe(
      code,
    )
  })

  it.each([
    [401, { error: { code: 'auth_code_invalid' } }, 'auth_code_invalid'],
    [401, { error: { code: 'device_revoked' } }, 'device_revoked'],
    [401, { error: { code: 'refresh_reused' } }, 'refresh_reused'],
    [401, { error: { code: 'unauthorized' } }, 'unauthorized'],
    [401, null, 'unauthorized'],
    [429, { error: { code: 'rate_limited' } }, 'rate_limited'],
    [429, null, 'rate_limited'],
    [503, { error: { code: 'desktop_auth_unavailable' } }, 'desktop_auth_unavailable'],
    [502, null, 'server_error'],
    [400, { error: { code: 'invalid_request' } }, 'invalid_request'],
    [403, null, 'forbidden'],
  ])('maps HTTP %i %j to %s', async (status, body, code) => {
    const fetch = vi.fn<FetchLike>(async () =>
      body ? json(status, body) : new Response('', { status }),
    )
    const transport = createUniworkTransport(profile, { fetch })
    expect(await codeOf(transport.refresh({ deviceSessionId: 'd', refreshToken: 'r' }))).toBe(code)
  })

  it('maps network failure, timeout and bad JSON', async () => {
    const offline = createUniworkTransport(profile, {
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
    })
    expect(await codeOf(offline.me('at'))).toBe('network')

    const hanging = createUniworkTransport(profile, {
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    })
    expect(await codeOf(hanging.me('at'))).toBe('timeout')

    const garbled = createUniworkTransport(profile, {
      fetch: async () => new Response('<html>', { status: 200 }),
    })
    expect(await codeOf(garbled.me('at'))).toBe('malformed_response')
  })

  it('reads profile, orgs and billing with a bearer token', async () => {
    const fetch = vi.fn<FetchLike>(async (url) => {
      if (url.endsWith('/me'))
        return json(200, {
          user: {
            id: 'acc_1',
            email: 'mai@example.com',
            display_name: 'Mai',
            avatar_url: 'https://cdn.example/a.png',
          },
        })
      if (url.endsWith('/orgs'))
        return json(200, {
          organizations: [
            { id: 'org_1', slug: 'acme', name: 'Acme', role: 'owner', status: 'active' },
            { id: 'org_2', slug: 'b', name: 'B' },
          ],
        })
      return json(200, {
        subscription: { plan_code: 'starter', plan_name: 'Starter', status: 'active' },
        entitlements: [
          {
            feature_key: 'members.max',
            name: 'Members',
            kind: 'quota',
            unit: 'members',
            enabled: true,
            quota_limit: 50,
            current_usage: 12,
          },
          {
            feature_key: 'ai.assist',
            name: 'AI',
            kind: 'flag',
            enabled: false,
            quota_limit: null,
            current_usage: 0,
          },
        ],
      })
    })
    const transport = createUniworkTransport(profile, { fetch })
    expect(await transport.me('at')).toEqual({
      id: 'acc_1',
      email: 'mai@example.com',
      displayName: 'Mai',
      avatarUrl: 'https://cdn.example/a.png',
    })
    expect(await transport.orgs('at')).toEqual([
      { id: 'org_1', slug: 'acme', name: 'Acme', role: 'owner', status: 'active' },
      { id: 'org_2', slug: 'b', name: 'B', role: '', status: 'active' },
    ])
    const billing = await transport.billing('org_1', 'at')
    expect(billing.planCode).toBe('starter')
    expect(billing.features[1]).toEqual({
      featureKey: 'ai.assist',
      name: 'AI',
      kind: 'flag',
      enabled: false,
      quotaLimit: null,
      currentUsage: 0,
    })
    expect(fetch.mock.calls[2][0]).toBe('https://uniwork.example/api/v1/orgs/org_1/billing')
    expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer at')
    expect(await codeOf(transport.billing('../admin', 'at'))).toBe('invalid_request')
  })

  it('refuses an http origin outside dev loopback', () => {
    expect(() =>
      createUniworkTransport({ ...profile, apiOrigin: 'http://uniwork.example' }),
    ).toThrow()
    expect(() =>
      createUniworkTransport({
        ...profile,
        apiOrigin: 'http://localhost:8080',
        channel: 'dev',
        clientId: 'uniwork-office-dev',
      }),
    ).not.toThrow()
  })
})

describe('error mapping', () => {
  it.each<[TransportErrorCode, string, string, boolean]>([
    ['network', 'server-unreachable', 'network', false],
    ['timeout', 'server-unreachable', 'timeout', false],
    ['server_error', 'server-unreachable', 'server_error', false],
    ['desktop_auth_unavailable', 'server-unreachable', 'server_error', false],
    ['malformed_response', 'server-unreachable', 'malformed_response', false],
    ['rate_limited', 'server-unreachable', 'rate_limited', false],
    ['unauthorized', 'session-expired', 'unauthorized', true],
    ['auth_code_invalid', 'session-expired', 'auth_code_invalid', true],
    ['device_revoked', 'session-revoked', 'device_revoked', true],
    ['refresh_reused', 'session-revoked', 'refresh_reused', true],
    ['wrong_deployment', 'wrong-deployment', 'wrong_deployment', false],
    ['invalid_request', 'server-unreachable', 'server_error', false],
    ['forbidden', 'server-unreachable', 'server_error', false],
  ])('session failure %s -> %s (%s)', (code, state, error, clear) => {
    expect(classifyTransportFailure(code, 'session')).toEqual({
      state,
      error,
      clearCredentials: clear,
    })
  })

  it.each<[TransportErrorCode, string, string]>([
    ['network', 'server-unreachable', 'network'],
    ['desktop_auth_unavailable', 'server-unreachable', 'server_error'],
    ['auth_code_invalid', 'signed-out', 'auth_code_invalid'],
    ['rate_limited', 'signed-out', 'rate_limited'],
    ['malformed_response', 'signed-out', 'malformed_response'],
    ['wrong_deployment', 'wrong-deployment', 'wrong_deployment'],
  ])('sign-in failure %s -> %s (%s)', (code, state, error) => {
    expect(classifyTransportFailure(code, 'sign-in')).toMatchObject({
      state,
      error,
      clearCredentials: false,
    })
  })

  it('maps callback rejections', () => {
    expect(classifyCallbackRejection('expired')).toMatchObject({
      state: 'signed-out',
      error: 'login_timeout',
    })
    expect(classifyCallbackRejection('wrong_redirect')).toMatchObject({
      state: 'wrong-deployment',
      error: 'wrong_deployment',
    })
    expect(classifyCallbackRejection('state_mismatch')).toMatchObject({ error: 'state_mismatch' })
    expect(classifyCallbackRejection('unexpected_query')).toMatchObject({
      error: 'invalid_callback',
    })
  })

  it('picks the persisted org while a member, else the first active one', () => {
    const orgs = [
      { id: 'o1', name: 'A', slug: 'a', role: 'member', status: 'suspended' },
      { id: 'o2', name: 'B', slug: 'b', role: 'owner', status: 'active' },
    ]
    expect(pickOrg(orgs, 'o1')?.id).toBe('o1')
    expect(pickOrg(orgs, 'gone')?.id).toBe('o2')
    expect(pickOrg(orgs, undefined)?.id).toBe('o2')
    expect(pickOrg([orgs[0]], undefined)).toBeUndefined()
  })
})

describe('deployment profile', () => {
  const files = (map: Record<string, unknown>) => (path: string) => {
    const key = Object.keys(map).find((name) => path.replace(/\\/g, '/').endsWith(name))
    if (!key) throw new Error('ENOENT')
    return JSON.stringify(map[key])
  }

  it('prefers the installed profile, then userData, then env, then the app setting', () => {
    const installed = { deploymentId: 'acme', apiOrigin: 'https://acme.example', channel: 'stable' }
    expect(
      resolveDeploymentProfile({
        resourcesDir: '/res',
        userDataDir: '/ud',
        isPackaged: true,
        env: { UNIWORK_API_ORIGIN: 'https://env.example' },
        readFile: files({ '/res/deployment-profile.json': installed }),
      }),
    ).toEqual({ ...installed, clientId: 'uniwork-office' })
    expect(
      resolveDeploymentProfile({
        userDataDir: '/ud',
        isPackaged: false,
        env: { UNIWORK_API_ORIGIN: 'http://localhost:8080/' },
        readFile: files({}),
      }),
    ).toEqual({
      deploymentId: 'default',
      apiOrigin: 'http://localhost:8080',
      clientId: 'uniwork-office-dev',
      channel: 'dev',
    })
    expect(
      resolveDeploymentProfile({
        userDataDir: '/ud',
        isPackaged: true,
        env: {},
        settingsApiOrigin: 'https://uniwork.app',
        readFile: files({}),
      }),
    ).toEqual({
      deploymentId: 'default',
      apiOrigin: 'https://uniwork.app',
      clientId: 'uniwork-office',
      channel: 'stable',
    })
    expect(
      resolveDeploymentProfile({
        userDataDir: '/ud',
        isPackaged: true,
        env: {},
        readFile: files({}),
      }),
    ).toBeNull()
  })

  it('fails closed on an invalid profile file and http outside dev loopback', () => {
    expect(
      resolveDeploymentProfile({
        userDataDir: '/ud',
        isPackaged: true,
        env: { UNIWORK_API_ORIGIN: 'https://env.example' },
        readFile: files({
          '/ud/deployment-profile.json': {
            deploymentId: 'x',
            apiOrigin: 'http://acme.example',
            channel: 'stable',
          },
        }),
      }),
    ).toBeNull()
    expect(
      parseDeploymentProfile({
        deploymentId: 'd',
        apiOrigin: 'http://localhost',
        channel: 'stable',
      }),
    ).toBeNull()
    expect(
      parseDeploymentProfile({
        deploymentId: 'd',
        apiOrigin: 'https://a.example/api',
        channel: 'stable',
      }),
    ).toBeNull()
    expect(
      parseDeploymentProfile({
        deploymentId: 'd',
        apiOrigin: 'https://a.example',
        channel: 'beta',
        clientId: 'uniwork-office-dev',
      }),
    ).toBeNull()
  })

  it('derives the exact callback per channel', () => {
    expect(redirectUriForProfile(profile)).toBe('uniwork-office://auth/callback')
    expect(redirectUriForProfile({ ...profile, channel: 'dev' })).toBe(
      'uniwork-office-dev://auth/callback',
    )
  })
})
