import { describe, expect, it } from 'vitest'
import {
  extractAuthCallbackFromArgv,
  extractAuthCallbackFromLockData,
  isAuthCallbackUrl,
  validateCallback,
} from '../src/main/uniwork-auth/callback'
import {
  LoginAttemptStore,
  LOGIN_ATTEMPT_TTL_MS,
  createCodeChallenge,
  generateCodeVerifier,
} from '../src/main/uniwork-auth/pkce'

const REDIRECT = 'uniwork-office://auth/callback'

function attempt(now = 1_000) {
  const store = new LoginAttemptStore()
  return {
    store,
    attempt: store.begin({
      clientId: 'uniwork-office',
      deploymentId: 'default',
      redirectUri: REDIRECT,
      now,
    }),
  }
}

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B S256 vector (base64url, no padding)', () => {
    expect(createCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('generates 64-char unreserved verifiers and 43-char challenges', () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{64}$/)
    expect(createCodeChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('attempt store keeps one live attempt with a 10 minute TTL', () => {
    const { store, attempt: first } = attempt(0)
    expect(first.expiresAt).toBe(LOGIN_ATTEMPT_TTL_MS)
    expect(first.codeChallenge).toBe(createCodeChallenge(first.verifier))
    const second = store.begin({
      clientId: 'uniwork-office',
      deploymentId: 'default',
      redirectUri: REDIRECT,
      now: 5,
    })
    expect(store.consume(first.attemptId)).toBeUndefined()
    expect(store.current(LOGIN_ATTEMPT_TTL_MS + 5)).toBeUndefined()
    expect(store.consume(second.attemptId)).toBeUndefined()
  })
})

describe('callback validation', () => {
  const url = (state: string, extra = '') =>
    `${REDIRECT}?code=abc&state=${encodeURIComponent(state)}${extra}`

  it('accepts the exact redirect with code + state', () => {
    const { attempt: a } = attempt()
    expect(validateCallback(url(a.state), a, 2_000)).toEqual({
      ok: true,
      code: 'abc',
      attemptId: a.attemptId,
    })
  })

  it.each([
    [
      'wrong scheme',
      (s: string) => `uniwork-office-dev://auth/callback?code=abc&state=${s}`,
      'wrong_redirect',
    ],
    [
      'near-miss path',
      (s: string) => `uniwork-office://auth/callback/?code=abc&state=${s}`,
      'wrong_redirect',
    ],
    [
      'case change',
      (s: string) => `UNIWORK-OFFICE://auth/callback?code=abc&state=${s}`,
      'wrong_redirect',
    ],
    ['extra key', (s: string) => url(s, '&next=https://evil.example'), 'unexpected_query'],
    ['duplicate code', (s: string) => url(s, '&code=other'), 'duplicate_query'],
    ['fragment', (s: string) => `${url(s)}#frag`, 'malformed'],
    ['missing code', (s: string) => `${REDIRECT}?state=${s}`, 'missing_param'],
    ['no query', () => REDIRECT, 'missing_param'],
    ['state mismatch', () => url('state_wrong'), 'state_mismatch'],
  ])('rejects %s', (_label, build, reason) => {
    const { attempt: a } = attempt()
    expect(validateCallback(build(a.state), a, 2_000)).toEqual({ ok: false, reason })
  })

  it('rejects an expired attempt and a missing attempt', () => {
    const { attempt: a } = attempt(0)
    expect(validateCallback(url(a.state), a, LOGIN_ATTEMPT_TTL_MS)).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(validateCallback(url(a.state), undefined, 0)).toEqual({
      ok: false,
      reason: 'no_attempt',
    })
  })
})

describe('callback URL extraction', () => {
  const cb = 'uniwork-office://auth/callback?code=c&state=s'

  it('recognizes both sign-in schemes but not the office-bridge scheme', () => {
    expect(isAuthCallbackUrl(cb)).toBe(true)
    expect(isAuthCallbackUrl('uniwork-office-dev://auth/callback?code=c&state=s')).toBe(true)
    expect(isAuthCallbackUrl('uniwork://open?ticket=t')).toBe(false)
    expect(isAuthCallbackUrl(42)).toBe(false)
  })

  it('finds the callback in cold-start / second-instance argv', () => {
    expect(extractAuthCallbackFromArgv(['C:\\UniWork Office.exe', '--flag', cb])).toBe(cb)
    expect(extractAuthCallbackFromArgv(['electron', '.', 'uniwork://open?x=1'])).toBeNull()
  })

  it('reads second-instance additionalData', () => {
    expect(extractAuthCallbackFromLockData({ authCallbackUrl: cb })).toBe(cb)
    expect(extractAuthCallbackFromLockData({ launchUrl: cb })).toBe(cb)
    expect(extractAuthCallbackFromLockData({ launchUrl: 'uniwork://open' })).toBeNull()
    expect(extractAuthCallbackFromLockData(null)).toBeNull()
  })
})
