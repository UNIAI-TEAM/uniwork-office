import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountLoginEvent, AccountStatus } from '../src/shared/home-api'
import {
  CredentialStoreError,
  type CredentialStore,
  type StoredCredential,
} from '../src/main/uniwork-auth/credentials'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { AccountManager, STARTUP_GATE_DEADLINE_MS } from '../src/main/uniwork-auth/manager'
import {
  TransportError,
  type DesktopSession,
  type TransportErrorCode,
  type UniworkTransport,
} from '../src/main/uniwork-auth/transport'
import { createAuthCallbackRouter } from '../src/main/uniwork-auth/routing'
import { createMemoryCredentialStore } from './uniwork-auth-fakes'

const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  channel: 'stable',
}

let tokenSeq = 0
const session = (overrides: Partial<DesktopSession> = {}): DesktopSession => {
  tokenSeq += 1
  return {
    accountId: 'acc_1',
    deviceSessionId: 'dev_1',
    sessionId: 'sess_1',
    deploymentId: 'default',
    accessToken: `at_${tokenSeq}`,
    refreshToken: `rt_${tokenSeq}`,
    expiresIn: 900,
    refreshExpiresIn: 30 * 24 * 3600,
    ...overrides,
  }
}

/** server codes arrive in the `{error:{code}}` envelope; network-ish ones never do */
const LOCAL_CODES: ReadonlySet<TransportErrorCode> = new Set([
  'network',
  'timeout',
  'malformed_response',
  'wrong_deployment',
])
const fail = (code: TransportErrorCode) => () =>
  Promise.reject(new TransportError(code, undefined, !LOCAL_CODES.has(code)))

function fakeTransport() {
  return {
    start: vi.fn(async () => ({
      authorizationUrl: 'https://uniwork.example/auth/desktop/authorize?attempt=1',
    })),
    exchange: vi.fn(async () => session()),
    refresh: vi.fn(async () => session()),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => ({ id: 'acc_1', email: 'mai@example.com', displayName: 'Mai' })),
    orgs: vi.fn(async () => [
      { id: 'org_s', name: 'Old', slug: 'old', role: 'member', status: 'suspended' },
      { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', status: 'active' },
      { id: 'org_b', name: 'Beta', slug: 'beta', role: 'member', status: 'active' },
    ]),
    billing: vi.fn(async (orgId: string) => ({
      planCode: orgId === 'org_b' ? 'pro' : 'starter',
      planName: orgId === 'org_b' ? 'Pro' : 'Starter',
      status: 'active',
      features: [
        {
          featureKey: 'members.max',
          name: 'Members',
          kind: 'quota' as const,
          enabled: true,
          quotaLimit: 50,
          currentUsage: 3,
        },
      ],
    })),
  } satisfies UniworkTransport
}

const stored = (overrides: Partial<StoredCredential> = {}): StoredCredential => ({
  deploymentId: 'default',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  accountId: 'acc_1',
  deviceSessionId: 'dev_1',
  sessionId: 'sess_1',
  refreshToken: 'rt_stored',
  refreshExpiresAt: Date.now() + 86_400_000,
  profile: { accountId: 'acc_1', email: 'cached@example.com', displayName: 'Cached' },
  ...overrides,
})

function setup(
  options: {
    credentials?: CredentialStore
    profile?: DeploymentProfile | null
    orgId?: string
  } = {},
) {
  const transport = fakeTransport()
  const credentials = options.credentials ?? createMemoryCredentialStore()
  const openBrowser = vi.fn(async () => undefined)
  const persistSelectedOrgId = vi.fn()
  const manager = new AccountManager({
    resolveProfile: () => (options.profile === undefined ? profile : options.profile),
    createTransport: () => transport,
    credentials,
    openBrowser,
    readSelectedOrgId: () => options.orgId,
    persistSelectedOrgId,
  })
  const statuses: AccountStatus[] = []
  const events: AccountLoginEvent[] = []
  const entitlements: unknown[] = []
  manager.onStatus((s) => statuses.push(s))
  manager.onLoginEvent((e) => events.push(e))
  manager.onEntitlementsChanged((e) => entitlements.push(e))
  return {
    manager,
    transport,
    credentials,
    openBrowser,
    persistSelectedOrgId,
    statuses,
    events,
    entitlements,
  }
}

/** signs in through start -> callback -> exchange with the real attempt state */
async function signIn(ctx: ReturnType<typeof setup>) {
  expect(await ctx.manager.login()).toBe(true)
  const startArgs = ctx.transport.start.mock.calls.at(-1)?.[0] as { state: string }
  await ctx.manager.completeCallback(
    `uniwork-office://auth/callback?code=c1&state=${encodeURIComponent(startArgs.state)}`,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-01T00:00:00Z') })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('sign-in', () => {
  it('starts PKCE, opens the browser, exchanges the code and loads the account', async () => {
    const ctx = setup()
    await signIn(ctx)
    const start = ctx.transport.start.mock.calls[0][0]
    expect(start).toMatchObject({
      clientId: 'uniwork-office',
      redirectUri: 'uniwork-office://auth/callback',
    })
    expect(start.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const exchange = ctx.transport.exchange.mock.calls[0][0]
    expect(exchange.code).toBe('c1')
    expect(exchange.codeVerifier).toMatch(/^[A-Za-z0-9._~-]{64}$/)
    expect(ctx.openBrowser).toHaveBeenCalledWith(
      'https://uniwork.example/auth/desktop/authorize?attempt=1',
      profile,
    )
    expect(ctx.events.map((e) => e.phase)).toEqual(['url', 'launched', 'success'])
    expect(ctx.events[1].expiresInSec).toBe(600)

    const status = ctx.manager.status()
    expect(status).toMatchObject({
      loggedIn: true,
      state: 'signed-in',
      email: 'mai@example.com',
      profile: { accountId: 'acc_1', displayName: 'Mai' },
      org: { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner' },
      serverOrigin: 'uniwork.example',
      entitlements: { orgId: 'org_a', planCode: 'starter' },
    })
    expect(status.orgs).toHaveLength(3)
    expect(ctx.statuses.map((s) => s.state)).toContain('signing-in')
    // tokens never reach a status payload; the refresh token is persisted
    expect(JSON.stringify(ctx.statuses)).not.toMatch(/at_\d|rt_\d/)
    expect(ctx.credentials.load()?.refreshToken).toMatch(/^rt_/)
    expect(ctx.manager.getEntitlements()?.orgId).toBe('org_a')
    expect(ctx.entitlements.at(-1)).toMatchObject({ orgId: 'org_a' })
    expect(await ctx.manager.getAccessToken()).toMatch(/^at_/)
  })

  it('a callback for another scheme is discarded and the attempt stays live', async () => {
    const ctx = setup()
    await ctx.manager.login()
    const state = (ctx.transport.start.mock.calls[0][0] as { state: string }).state
    await ctx.manager.completeCallback(`uniwork-office-dev://auth/callback?code=c&state=${state}`)
    expect(ctx.manager.status().state).toBe('signing-in')
    expect(ctx.manager.status().error).toBeUndefined()
    expect(ctx.transport.exchange).not.toHaveBeenCalled()
    // the real callback still completes the same attempt
    await ctx.manager.completeCallback(`uniwork-office://auth/callback?code=c1&state=${state}`)
    expect(ctx.manager.status().state).toBe('signed-in')
  })

  it('a forged or malformed callback never cancels the live sign-in', async () => {
    const ctx = setup()
    await ctx.manager.login()
    const state = (ctx.transport.start.mock.calls[0][0] as { state: string }).state
    await ctx.manager.completeCallback('uniwork-office://auth/callback?code=c&state=forged')
    await ctx.manager.completeCallback(`uniwork-office://auth/callback?code=c&state=${state}&x=1`)
    await ctx.manager.completeCallback('uniwork-office://auth/callback#code=c')
    expect(ctx.manager.status().state).toBe('signing-in')
    expect(ctx.manager.status().error).toBeUndefined()
    expect(ctx.transport.exchange).not.toHaveBeenCalled()
    // reported for a passing notice only; the attempt is not over
    expect(ctx.events.filter((e) => e.phase === 'error')).toEqual([
      { phase: 'error', error: 'state_mismatch' },
      { phase: 'error', error: 'invalid_callback' },
      { phase: 'error', error: 'invalid_callback' },
    ])
    await ctx.manager.completeCallback(`uniwork-office://auth/callback?code=c1&state=${state}`)
    expect(ctx.transport.exchange).toHaveBeenCalledTimes(1)
    expect(ctx.manager.status().state).toBe('signed-in')
  })

  it('a callback for an expired attempt ends it with login_timeout', async () => {
    const ctx = setup()
    await ctx.manager.login()
    const state = (ctx.transport.start.mock.calls[0][0] as { state: string }).state
    vi.setSystemTime(Date.now() + 10 * 60 * 1000)
    await ctx.manager.completeCallback(`uniwork-office://auth/callback?code=c&state=${state}`)
    expect(ctx.manager.status()).toMatchObject({ state: 'signed-out', error: 'login_timeout' })
    expect(ctx.transport.exchange).not.toHaveBeenCalled()
  })

  it('times out after 10 minutes', async () => {
    const ctx = setup()
    await ctx.manager.login()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(ctx.manager.status()).toMatchObject({ state: 'signed-out', error: 'login_timeout' })
    expect(ctx.events.at(-1)).toEqual({ phase: 'error', error: 'login_timeout' })
  })

  it('cancel returns to signed-out and ignores a late callback', async () => {
    const ctx = setup()
    await ctx.manager.login()
    const state = (ctx.transport.start.mock.calls[0][0] as { state: string }).state
    ctx.manager.cancelLogin()
    expect(ctx.manager.status().state).toBe('signed-out')
    expect(ctx.events.at(-1)).toEqual({ phase: 'error', error: 'cancelled' })
    await ctx.manager.completeCallback(`uniwork-office://auth/callback?code=c&state=${state}`)
    expect(ctx.transport.exchange).not.toHaveBeenCalled()
  })

  it.each<[TransportErrorCode, string, string]>([
    ['auth_code_invalid', 'signed-out', 'auth_code_invalid'],
    ['rate_limited', 'signed-out', 'rate_limited'],
    ['network', 'server-unreachable', 'network'],
    ['desktop_auth_unavailable', 'server-unreachable', 'server_error'],
    ['wrong_deployment', 'wrong-deployment', 'wrong_deployment'],
  ])('exchange failure %s -> %s', async (code, state, error) => {
    const ctx = setup()
    ctx.transport.exchange.mockImplementation(fail(code))
    await signIn(ctx)
    expect(ctx.manager.status()).toMatchObject({ state, error, loggedIn: false })
    expect(ctx.events.at(-1)).toEqual({ phase: 'error', error })
    expect(ctx.credentials.load()).toBeNull()
  })

  it('start failure maps to state and keeps no attempt', async () => {
    const ctx = setup()
    ctx.transport.start.mockImplementation(fail('timeout'))
    expect(await ctx.manager.login()).toBe(false)
    expect(ctx.manager.status()).toMatchObject({ state: 'server-unreachable', error: 'timeout' })
    expect(ctx.openBrowser).not.toHaveBeenCalled()
  })

  it('retry after a failed sign-in start signs in again', async () => {
    const ctx = setup()
    ctx.transport.start.mockImplementationOnce(fail('network'))
    expect(await ctx.manager.login()).toBe(false)
    expect(ctx.manager.status()).toMatchObject({ state: 'server-unreachable', error: 'network' })
    const status = await ctx.manager.retry()
    expect(ctx.transport.start).toHaveBeenCalledTimes(2)
    expect(ctx.openBrowser).toHaveBeenCalledTimes(1)
    expect(status.state).toBe('signing-in')
    // no credential: nothing to recover automatically
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1)
    expect(ctx.transport.refresh).not.toHaveBeenCalled()
  })

  it('refuses to store when the keyring is unavailable', async () => {
    const credentials = createMemoryCredentialStore()
    credentials.save = () => {
      throw new CredentialStoreError('keyring_unavailable')
    }
    const ctx = setup({ credentials })
    await signIn(ctx)
    expect(ctx.manager.status()).toMatchObject({
      state: 'keyring-unavailable',
      error: 'keyring_unavailable',
      loggedIn: false,
    })
    expect(await ctx.manager.getAccessToken()).toBeNull()
  })

  it('keyring-unavailable: a fresh sign-in replaces the unreadable credential', async () => {
    const credentials = createMemoryCredentialStore()
    const load = credentials.load
    let unreadable = true
    credentials.load = () => {
      if (unreadable) throw new CredentialStoreError('keyring_unavailable')
      return load()
    }
    const save = credentials.save
    credentials.save = (c) => {
      unreadable = false
      save(c)
    }
    const ctx = setup({ credentials })
    expect((await ctx.manager.restore()).state).toBe('keyring-unavailable')
    await signIn(ctx)
    expect(ctx.manager.status().state).toBe('signed-in')
    expect(ctx.credentials.load()?.deviceSessionId).toBe('dev_1')
  })

  it('keyring-unavailable: sign-in opens no browser while nothing could be stored', async () => {
    const credentials = createMemoryCredentialStore()
    credentials.load = () => {
      throw new CredentialStoreError('keyring_unavailable')
    }
    credentials.canStore = () => false
    const ctx = setup({ credentials })
    await ctx.manager.restore()
    expect(await ctx.manager.login()).toBe(false)
    expect(ctx.transport.start).not.toHaveBeenCalled()
    expect(ctx.openBrowser).not.toHaveBeenCalled()
    expect(ctx.events.at(-1)).toEqual({ phase: 'error', error: 'keyring_unavailable' })
    expect(ctx.manager.status().state).toBe('keyring-unavailable')
  })

  it('a secure-store failure during the account reload leaves no session to recover', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    ctx.transport.me.mockImplementationOnce(() =>
      Promise.reject(new CredentialStoreError('keyring_unavailable')),
    )
    expect((await ctx.manager.restore()).state).toBe('keyring-unavailable')
    // sign-in starts a fresh attempt instead of "recovering" a dropped session
    expect(await ctx.manager.login()).toBe(true)
    expect(ctx.transport.start).toHaveBeenCalledTimes(1)
  })

  it('not-configured without a deployment profile', async () => {
    const ctx = setup({ profile: null })
    expect((await ctx.manager.restore()).state).toBe('not-configured')
    expect(await ctx.manager.login()).toBe(false)
    expect(ctx.events.at(-1)).toEqual({ phase: 'error', error: 'not_configured' })
  })
})

describe('restore and refresh', () => {
  it('restores by refreshing; the rotated refresh token is persisted', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    const status = await ctx.manager.restore()
    expect(ctx.transport.refresh).toHaveBeenCalledWith({
      deviceSessionId: 'dev_1',
      refreshToken: 'rt_stored',
    })
    expect(status).toMatchObject({ state: 'signed-in', email: 'mai@example.com' })
    const saved = ctx.credentials.load()
    expect(saved?.refreshToken).not.toBe('rt_stored')
    expect(saved?.profile?.email).toBe('mai@example.com')
  })

  it('a credential bound to another deployment is never used', async () => {
    const ctx = setup({
      credentials: createMemoryCredentialStore(stored({ apiOrigin: 'https://other.example' })),
    })
    expect(await ctx.manager.restore()).toMatchObject({
      state: 'wrong-deployment',
      error: 'wrong_deployment',
    })
    expect(ctx.transport.refresh).not.toHaveBeenCalled()
  })

  it('an expired refresh token is session-expired without a network call', async () => {
    const ctx = setup({
      credentials: createMemoryCredentialStore(stored({ refreshExpiresAt: Date.now() - 1 })),
    })
    expect((await ctx.manager.restore()).state).toBe('session-expired')
    expect(ctx.transport.refresh).not.toHaveBeenCalled()
    expect(ctx.credentials.load()).toBeNull()
  })

  it.each<[TransportErrorCode, string, boolean]>([
    ['refresh_reused', 'session-revoked', true],
    ['device_revoked', 'session-revoked', true],
    ['unauthorized', 'session-expired', true],
    ['auth_code_invalid', 'session-expired', true],
    ['network', 'server-unreachable', false],
    ['timeout', 'server-unreachable', false],
    ['server_error', 'server-unreachable', false],
    ['malformed_response', 'server-unreachable', false],
    ['wrong_deployment', 'wrong-deployment', false],
  ])('refresh failure %s -> %s', async (code, state, cleared) => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    ctx.transport.refresh.mockImplementation(fail(code))
    const status = await ctx.manager.restore()
    expect(status.state).toBe(state)
    expect(status.loggedIn).toBe(false)
    expect(ctx.credentials.load() === null).toBe(cleared)
    if (state === 'server-unreachable') expect(status.profile?.email).toBe('cached@example.com')
  })

  it('server-unreachable with a credential recovers on its own with a bounded backoff', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    ctx.transport.refresh
      .mockImplementationOnce(fail('network'))
      .mockImplementationOnce(fail('timeout'))
      .mockImplementationOnce(fail('server_error'))
    expect((await ctx.manager.restore()).state).toBe('server-unreachable')
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(4)
    expect(ctx.manager.status()).toMatchObject({ state: 'signed-in', email: 'mai@example.com' })
    // recovered: no further retries
    await vi.advanceTimersByTimeAsync(600_000)
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(4)
  })

  it('the recovery backoff is capped at five minutes', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    ctx.transport.refresh.mockImplementation(fail('network'))
    await ctx.manager.restore()
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    const calls = ctx.transport.refresh.mock.calls.length
    await vi.advanceTimersByTimeAsync(300_000)
    expect(ctx.transport.refresh.mock.calls.length).toBe(calls + 1)
    expect(ctx.credentials.load()?.refreshToken).toBe('rt_stored')
  })

  it('getAccessToken() recovers from server-unreachable instead of returning null', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    ctx.transport.refresh.mockImplementationOnce(fail('network'))
    expect((await ctx.manager.restore()).state).toBe('server-unreachable')
    vi.setSystemTime(Date.now() + 5_000)
    expect(await ctx.manager.getAccessToken()).toMatch(/^at_/)
    // the account reload follows in the background
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.manager.status().state).toBe('signed-in')
  })

  it('getAccessToken() while offline is refresh-only and does not wait for the account reload', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    ctx.transport.refresh.mockImplementationOnce(fail('network'))
    await ctx.manager.restore()
    ctx.transport.me.mockImplementationOnce(() => new Promise(() => undefined))
    vi.setSystemTime(Date.now() + 5_000)
    expect(await ctx.manager.getAccessToken()).toMatch(/^at_/)
  })

  it('getAccessToken() while offline does not refresh when the access token is still valid', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    // the refresh succeeds, the account reload does not
    ctx.transport.orgs.mockImplementationOnce(fail('network'))
    expect((await ctx.manager.restore()).state).toBe('server-unreachable')
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 5_000)
    expect(await ctx.manager.getAccessToken()).toMatch(/^at_/)
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1)
    // the account reload still follows in the background
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.manager.status().state).toBe('signed-in')
  })

  it('getAccessToken() bursts while offline share one attempt and are throttled', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    ctx.transport.refresh.mockImplementation(fail('network'))
    await ctx.manager.restore()
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1)
    // right after a failed attempt: null at once, no network call
    expect(await ctx.manager.getAccessToken()).toBeNull()
    vi.setSystemTime(Date.now() + 4_000)
    const burst = await Promise.all([1, 2, 3, 4].map(() => ctx.manager.getAccessToken()))
    expect(burst).toEqual([null, null, null, null])
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 1_000)
    const second = await Promise.all([1, 2, 3].map(() => ctx.manager.getAccessToken()))
    expect(second).toEqual([null, null, null])
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(2)
    expect(ctx.transport.me).not.toHaveBeenCalled()
  })

  it('startup restore waits for the gate (proxy install) before the first refresh', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    let open: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (open = resolve))
    const restoring = ctx.manager.startupRestore(gate)
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.transport.refresh).not.toHaveBeenCalled()
    open()
    expect((await restoring).state).toBe('signed-in')
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1)
  })

  it('startup restore shows the stored account as refreshing while it waits for the gate', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    let open: () => void = () => undefined
    const restoring = ctx.manager.startupRestore(new Promise<void>((r) => (open = r)))
    expect(ctx.manager.status()).toMatchObject({ state: 'refreshing', email: 'cached@example.com' })
    expect(ctx.statuses.map((s) => s.state)).not.toContain('signed-out')
    // a click meanwhile does not open a second sign-in (no orphaned device)
    expect(await ctx.manager.login()).toBe(true)
    expect(ctx.transport.start).not.toHaveBeenCalled()
    open()
    expect((await restoring).state).toBe('signed-in')
  })

  it('startup restore stands down when the user signed out while it waited', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    let open: () => void = () => undefined
    const restoring = ctx.manager.startupRestore(new Promise<void>((r) => (open = r)))
    await ctx.manager.logout()
    open()
    await restoring
    expect(ctx.manager.status().state).toBe('signed-out')
    // only the background device revoke ran; no restore refresh, no reload
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1)
    expect(ctx.transport.logout).toHaveBeenCalledTimes(1)
    expect(ctx.transport.me).not.toHaveBeenCalled()
  })

  it('startup restore stops waiting for a gate that never settles', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    const restoring = ctx.manager.startupRestore(new Promise<void>(() => undefined))
    await vi.advanceTimersByTimeAsync(STARTUP_GATE_DEADLINE_MS - 1)
    expect(ctx.transport.refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await restoring).state).toBe('signed-in')
  })

  it('server-unreachable after a restart shows the cached organization and plan', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    expect((await ctx.manager.restore()).state).toBe('signed-in')
    // a new process: only the stored credential survives
    const next = setup({ credentials: ctx.credentials })
    next.transport.refresh.mockImplementation(fail('network'))
    const status = await next.manager.restore()
    expect(status).toMatchObject({
      state: 'server-unreachable',
      email: 'mai@example.com',
      org: { id: 'org_a', name: 'Acme' },
      entitlements: { orgId: 'org_a', planName: 'Starter' },
    })
    // shown, but not handed to main-process consumers as live entitlements
    expect(next.manager.getEntitlements()).toBeNull()
  })

  it('restore stays refreshing until the account reload has finished', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    let releaseMe: () => void = () => undefined
    ctx.transport.me.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseMe = () => resolve({ id: 'acc_1', email: 'mai@example.com', displayName: 'Mai' })
        }),
    )
    const restoring = ctx.manager.restore()
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1)
    expect(ctx.manager.status().state).toBe('refreshing')
    expect(ctx.statuses.map((s) => s.state)).not.toContain('signed-in')
    releaseMe()
    expect((await restoring).state).toBe('signed-in')
  })

  it('an access token lifetime past the timer range does not loop refresh', async () => {
    const ctx = setup()
    ctx.transport.exchange.mockImplementationOnce(async () => session({ expiresIn: 2_000_000_000 }))
    await signIn(ctx)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ctx.transport.refresh).not.toHaveBeenCalled()
  })

  it('a bare 401 on refresh keeps the credential (server-unreachable)', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    ctx.transport.refresh.mockImplementationOnce(() =>
      Promise.reject(new TransportError('unauthorized', 401, false)),
    )
    expect((await ctx.manager.restore()).state).toBe('server-unreachable')
    expect(ctx.credentials.load()?.refreshToken).toBe('rt_stored')
  })

  it('a /me answer for another account ends the session', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    ctx.transport.me.mockImplementation(async () => ({
      id: 'acc_other',
      email: 'x@example.com',
      displayName: 'X',
    }))
    expect((await ctx.manager.restore()).state).toBe('session-expired')
    expect(ctx.credentials.load()).toBeNull()
  })

  it('sign-in from server-unreachable recovers the live session instead of a new attempt', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    ctx.transport.refresh.mockImplementationOnce(fail('network'))
    await ctx.manager.restore()
    expect(await ctx.manager.login()).toBe(true)
    expect(ctx.transport.start).not.toHaveBeenCalled()
    expect(ctx.manager.status().state).toBe('signed-in')
  })

  it('retry after server-unreachable recovers', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    ctx.transport.refresh.mockImplementationOnce(fail('network'))
    expect((await ctx.manager.restore()).state).toBe('server-unreachable')
    expect((await ctx.manager.retry()).state).toBe('signed-in')
  })

  it('runs a single refresh for concurrent callers', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    await ctx.manager.restore()
    ctx.transport.refresh.mockClear()
    await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(Date.now() + 899_000)
    const [a, b, c] = await Promise.all([
      ctx.manager.getAccessToken(),
      ctx.manager.getAccessToken(),
      ctx.manager.getAccessToken(),
    ])
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('refreshes proactively at 80% of the access token lifetime', async () => {
    const ctx = setup()
    await signIn(ctx)
    expect(ctx.transport.refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(720_000)
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1)
    expect(ctx.manager.status().state).toBe('signed-in')
    expect(ctx.statuses.map((s) => s.state)).toContain('refreshing')
  })

  it('401 -> refresh -> retry once', async () => {
    const ctx = setup()
    ctx.transport.me.mockImplementationOnce(fail('unauthorized'))
    await signIn(ctx)
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1)
    expect(ctx.transport.me).toHaveBeenCalledTimes(2)
    expect(ctx.manager.status().state).toBe('signed-in')
  })

  it('a second 401 after refresh ends the session', async () => {
    const ctx = setup()
    ctx.transport.me.mockImplementation(fail('unauthorized'))
    await signIn(ctx)
    expect(ctx.transport.me).toHaveBeenCalledTimes(2)
    expect(ctx.manager.status().state).toBe('session-expired')
  })
})

describe('organizations and entitlements', () => {
  it('keeps the persisted org while still a member', async () => {
    const ctx = setup({ orgId: 'org_b' })
    await signIn(ctx)
    expect(ctx.manager.status().org?.id).toBe('org_b')
    expect(ctx.manager.getEntitlements()?.planCode).toBe('pro')
  })

  it('selectOrg persists the choice and reloads entitlements', async () => {
    const ctx = setup()
    await signIn(ctx)
    const status = await ctx.manager.selectOrg('org_b')
    expect(ctx.persistSelectedOrgId).toHaveBeenCalledWith('org_b')
    expect(status.org?.id).toBe('org_b')
    expect(status.entitlements).toMatchObject({ orgId: 'org_b', planCode: 'pro' })
    expect(ctx.entitlements.at(-1)).toMatchObject({ orgId: 'org_b' })
    await ctx.manager.selectOrg('not-a-member')
    expect(ctx.persistSelectedOrgId).toHaveBeenCalledTimes(1)
  })

  it('a billing failure after a restart shows the cached plan but never publishes it as live', async () => {
    const first = setup({ credentials: createMemoryCredentialStore(stored()) })
    expect((await first.manager.restore()).state).toBe('signed-in')
    const next = setup({ credentials: first.credentials })
    next.transport.billing.mockImplementation(fail('server_error'))
    const status = await next.manager.restore()
    expect(status).toMatchObject({
      state: 'signed-in',
      entitlements: { orgId: 'org_a', planName: 'Starter' },
    })
    expect(next.manager.getEntitlements()).toBeNull()
    expect(next.entitlements.filter((e) => e !== null)).toEqual([])
    // the cache survives for the next start
    expect(first.credentials.load()?.entitlements).toMatchObject({ planName: 'Starter' })
    expect(next.credentials.load()?.entitlements).toMatchObject({ planName: 'Starter' })
  })

  it('a billing failure leaves entitlements unknown but stays signed in', async () => {
    const ctx = setup()
    ctx.transport.billing.mockImplementation(fail('forbidden'))
    await signIn(ctx)
    expect(ctx.manager.status()).toMatchObject({ state: 'signed-in', entitlements: null })
  })
})

describe('logout', () => {
  it('revokes the device, then clears local credentials', async () => {
    const ctx = setup()
    await signIn(ctx)
    const status = await ctx.manager.logout()
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.transport.logout).toHaveBeenCalledWith(
      { deviceSessionId: 'dev_1' },
      expect.stringMatching(/^at_/),
    )
    expect(status).toMatchObject({ state: 'signed-out', loggedIn: false })
    expect(status.profile).toBeUndefined()
    expect(ctx.credentials.load()).toBeNull()
    expect(ctx.entitlements.at(-1)).toBeNull()
    expect(await ctx.manager.getAccessToken()).toBeNull()
  })

  it('clears and reports signed-out before the server round trip', async () => {
    const ctx = setup()
    await signIn(ctx)
    vi.setSystemTime(Date.now() + 900_000)
    ctx.transport.refresh.mockImplementation(() => new Promise(() => undefined))
    const status = await ctx.manager.logout()
    expect(status.state).toBe('signed-out')
    expect(ctx.statuses.at(-1)?.state).toBe('signed-out')
    expect(ctx.credentials.load()).toBeNull()
    // the device revoke still goes out (refresh first: the access token expired)
    expect(ctx.transport.refresh).toHaveBeenCalled()
  })

  it('still clears when the server is unreachable', async () => {
    const ctx = setup()
    await signIn(ctx)
    ctx.transport.logout.mockImplementation(fail('network'))
    expect((await ctx.manager.logout()).state).toBe('signed-out')
    expect(ctx.credentials.load()).toBeNull()
  })

  it('drops a refresh response that lands after logout', async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) })
    let release: (s: DesktopSession) => void = () => undefined
    ctx.transport.refresh.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    )
    const restoring = ctx.manager.restore()
    await ctx.manager.logout()
    release(session())
    await restoring
    expect(ctx.manager.status().state).toBe('signed-out')
    expect(ctx.credentials.load()).toBeNull()
  })
})

describe('signing in again after the device was revoked', () => {
  /** signed in, then the server revokes the device: a 401 call, then the refresh says so */
  async function revoked(ctx: ReturnType<typeof setup>) {
    await signIn(ctx)
    ctx.transport.refresh.mockImplementationOnce(fail('device_revoked'))
    await expect(
      ctx.manager.authorizedRequest(() => Promise.reject(new TransportError('unauthorized'))),
    ).rejects.toBeTruthy()
    expect(ctx.manager.status().state).toBe('session-revoked')
    expect(ctx.credentials.load()).toBeNull()
  }

  it('a callback delivered by a second instance (Windows argv) completes the new sign-in', async () => {
    const ctx = setup()
    await revoked(ctx)
    const router = createAuthCallbackRouter(['C:\UniWork Office\UniWork Office.exe'])
    router.start((url) => ctx.manager.handleCallbackUrl(url))
    expect(await ctx.manager.login()).toBe(true)
    const state = (ctx.transport.start.mock.calls.at(-1)?.[0] as { state: string }).state
    const routed = router.secondInstance(
      [
        'C:\UniWork Office\UniWork Office.exe',
        `uniwork-office://auth/callback?code=c2&state=${encodeURIComponent(state)}`,
      ],
      {},
    )
    expect(routed).toBe(true)
    await vi.waitFor(() => expect(ctx.manager.status().state).toBe('signed-in'))
    expect(ctx.transport.exchange).toHaveBeenCalledTimes(2)
    expect(ctx.transport.exchange.mock.calls.at(-1)?.[0]).toMatchObject({ code: 'c2' })
    expect(ctx.credentials.load()?.refreshToken).toMatch(/^rt_/)
  })

  it('a second Sign in click keeps the attempt the open browser tab belongs to', async () => {
    const ctx = setup()
    await revoked(ctx)
    expect(await ctx.manager.login()).toBe(true)
    const first = (ctx.transport.start.mock.calls.at(-1)?.[0] as { state: string }).state
    const starts = ctx.transport.start.mock.calls.length
    // the chip still offers Sign in while the browser is open: a second click
    // re-opens the same page instead of starting an attempt that would turn
    // the first tab's callback into a state mismatch
    expect(await ctx.manager.login()).toBe(true)
    expect(ctx.transport.start).toHaveBeenCalledTimes(starts)
    expect(ctx.openBrowser).toHaveBeenCalledTimes(3)
    expect(ctx.openBrowser.mock.calls.at(-1)?.[0]).toBe(ctx.openBrowser.mock.calls.at(-2)?.[0])
    await ctx.manager.completeCallback(
      `uniwork-office://auth/callback?code=c2&state=${encodeURIComponent(first)}`,
    )
    expect(ctx.transport.exchange).toHaveBeenCalledTimes(2)
    expect(ctx.manager.status().state).toBe('signed-in')
    expect(ctx.events.some((e) => e.phase === 'error' && e.error === 'state_mismatch')).toBe(false)
  })

  it('a click after the attempt expired starts a fresh one', async () => {
    const ctx = setup()
    expect(await ctx.manager.login()).toBe(true)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(ctx.manager.status().state).toBe('signed-out')
    expect(await ctx.manager.login()).toBe(true)
    expect(ctx.transport.start).toHaveBeenCalledTimes(2)
  })
})

