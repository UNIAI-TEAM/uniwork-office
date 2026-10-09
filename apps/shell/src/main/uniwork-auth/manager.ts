import type { AccountEntitlements, AccountErrorCode, AccountStatus } from '../../shared/home-api'
import { isAuthCallbackUrl, validateCallback } from './callback'
import type { StoredCredential } from './credentials'
import { redirectUriForProfile, type DeploymentProfile } from './deployment'
import { pickOrg, toEntitlements, toProfile } from './mapping'
import { LoginAttemptStore } from './pkce'
import {
  ACCESS_TOKEN_SKEW_MS,
  SessionCore,
  handled,
  type AccountManagerDeps,
  type LiveSession,
} from './session-core'
import { TransportError, type DesktopSession, type UniworkTransport } from './transport'

export type { AccountManagerDeps } from './session-core'

/**
 * Main-process owner of the UniWork desktop session: startup restore, the
 * PKCE sign-in flow and its callback, retry, organization choice and logout.
 * Every async step captures the generation and drops its result when
 * sign-in, cancel or logout moved on in the meantime.
 */
export class AccountManager extends SessionCore {
  private readonly attempts: LoginAttemptStore
  private attemptTimer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: AccountManagerDeps) {
    super(deps)
    this.attempts = deps.attempts ?? new LoginAttemptStore()
  }

  /**
   * Startup restore once `gate` settles (the main-process proxy install), so
   * the first refresh does not go out before the system proxy is in place.
   * Skipped when the user already started something in the meantime.
   */
  async startupRestore(gate: Promise<unknown>): Promise<AccountStatus> {
    const generation = this.generation
    await gate.catch(() => undefined)
    if (generation !== this.generation) return this.status()
    return this.restore()
  }

  /** Restores the stored session (refresh + account reload); never throws. */
  async restore(): Promise<AccountStatus> {
    const generation = ++this.generation
    this.resetSession()
    if (!this.ensureProfile()) return this.status()
    const profile = this.profile as DeploymentProfile
    let credential: StoredCredential | null
    try {
      credential = this.deps.credentials.load()
    } catch {
      this.setState('keyring-unavailable', 'keyring_unavailable')
      return this.status()
    }
    if (!credential) {
      this.setState('signed-out')
      return this.status()
    }
    if (
      credential.deploymentId !== profile.deploymentId ||
      credential.apiOrigin !== profile.apiOrigin ||
      credential.clientId !== profile.clientId
    ) {
      // a credential issued by another deployment is never sent to this one
      this.setState('wrong-deployment', 'wrong_deployment')
      return this.status()
    }
    this.session = { credential, accessToken: '', accessExpiresAt: 0 }
    this.accountProfile = credential.profile
    this.setState('refreshing')
    try {
      await this.refresh()
      await this.loadAccount(generation)
    } catch (error) {
      if (generation === this.generation) this.applyFailure(error, 'session')
    }
    return this.status()
  }

  async login(): Promise<boolean> {
    if (this.state === 'signed-in' || this.state === 'refreshing') return true
    // a live session (server-unreachable) is recovered, never shadowed by a
    // second attempt whose cancel would hide it behind signed-out
    if (this.session) return (await this.retry()).loggedIn
    if (!this.ensureProfile()) {
      this.emitLogin({ phase: 'error', error: 'not_configured' })
      return false
    }
    const profile = this.profile as DeploymentProfile
    const transport = this.transport as UniworkTransport
    const generation = ++this.generation
    this.clearAttemptTimer()
    const attempt = this.attempts.begin({
      clientId: profile.clientId,
      deploymentId: profile.deploymentId,
      redirectUri: redirectUriForProfile(profile),
      now: this.now(),
    })
    this.setState('signing-in')
    let url: string
    try {
      const device = this.deps.device ?? {}
      const started = await transport.start({
        clientId: attempt.clientId,
        codeChallenge: attempt.codeChallenge,
        state: attempt.state,
        redirectUri: attempt.redirectUri,
        deviceLabel: device.label,
        platform: device.platform,
        build: device.build,
      })
      url = started.authorizationUrl
    } catch (error) {
      if (generation !== this.generation) return false
      this.attempts.cancel()
      this.failLogin(this.applyFailure(error, 'sign-in'))
      return false
    }
    if (generation !== this.generation) return false
    attempt.authorizationUrl = url
    this.attemptTimer = setTimeout(
      () => this.expireAttempt(attempt.attemptId),
      attempt.expiresAt - this.now(),
    )
    this.emitLogin({ phase: 'url', url })
    try {
      await this.deps.openBrowser(url, profile)
    } catch {
      // the attempt stays live: the renderer offers openLoginUrl() as a rescue
      return false
    }
    if (generation !== this.generation) return false
    this.emitLogin({
      phase: 'launched',
      expiresInSec: Math.round((attempt.expiresAt - this.now()) / 1000),
    })
    return true
  }

  /** re-opens the pending authorization URL (never a renderer-supplied one) */
  async openLoginUrl(): Promise<void> {
    const attempt = this.attempts.current(this.now())
    if (!attempt?.authorizationUrl || !this.profile) return
    await this.deps.openBrowser(attempt.authorizationUrl, this.profile)
  }

  cancelLogin(): void {
    if (!this.attempts.cancel() && this.state !== 'signing-in') return
    this.generation++
    this.clearAttemptTimer()
    this.setState('signed-out')
    this.emitLogin({ phase: 'error', error: 'cancelled' })
  }

  /** true when the URL is a sign-in callback (consumed here, never routed elsewhere) */
  handleCallbackUrl(url: unknown): boolean {
    if (!isAuthCallbackUrl(url)) return false
    void this.completeCallback(url)
    return true
  }

  async completeCallback(url: string): Promise<void> {
    const attempt = this.attempts.peek()
    // a stray callback (e.g. after a restart lost the verifier) changes nothing
    if (!attempt || !this.profile || !this.transport) return
    const validation = validateCallback(url, attempt, this.now())
    if (!validation.ok) {
      if (validation.reason === 'expired') this.expireAttempt(attempt.attemptId)
      // a forged, stale or foreign-scheme callback is discarded; the user's
      // live attempt and its state are left alone (anything can open a URL)
      return
    }
    this.clearAttemptTimer()
    const claimed = this.attempts.consume(validation.attemptId)
    if (!claimed) return
    const generation = this.generation
    const profile = this.profile
    let session: DesktopSession
    try {
      session = await this.transport.exchange({
        clientId: claimed.clientId,
        code: validation.code,
        codeVerifier: claimed.verifier,
        redirectUri: claimed.redirectUri,
      })
    } catch (error) {
      if (generation === this.generation) this.failLogin(this.applyFailure(error, 'sign-in'))
      return
    }
    if (generation !== this.generation) return
    const credential: StoredCredential = {
      deploymentId: profile.deploymentId,
      apiOrigin: profile.apiOrigin,
      clientId: profile.clientId,
      accountId: session.accountId,
      deviceSessionId: session.deviceSessionId,
      sessionId: session.sessionId,
      refreshToken: session.refreshToken,
      refreshExpiresAt: this.now() + session.refreshExpiresIn * 1000,
    }
    if (!this.persist(credential)) {
      this.failLogin('keyring_unavailable')
      return
    }
    this.resetSession()
    this.adoptSession(credential, session)
    await this.loadAccount(generation).catch((error) => {
      if (generation === this.generation) this.applyFailure(error, 'session')
    })
    if (generation !== this.generation) return
    if (this.state === 'signed-in') this.emitLogin({ phase: 'success' })
    else this.emitLogin({ phase: 'error', error: this.error ?? 'server_error' })
  }

  async retry(): Promise<AccountStatus> {
    if (this.state === 'not-configured' || this.state === 'keyring-unavailable')
      return this.restore()
    if (this.state !== 'server-unreachable' && this.state !== 'signed-in') return this.status()
    if (!this.session) {
      // the failure happened while signing in: retrying means signing in again
      await this.login()
      return this.status()
    }
    const generation = this.generation
    try {
      if (this.session.accessExpiresAt - this.now() <= ACCESS_TOKEN_SKEW_MS) await this.refresh()
      await this.loadAccount(generation)
    } catch (error) {
      if (generation === this.generation) this.applyFailure(error, 'session')
    }
    return this.status()
  }

  async selectOrg(orgId: string): Promise<AccountStatus> {
    const org = this.orgs.find((candidate) => candidate.id === orgId)
    if (!org || !this.session) return this.status()
    try {
      this.deps.persistSelectedOrgId(org.id)
    } catch {
      // the choice still applies to this run
    }
    this.org = org
    const generation = this.generation
    try {
      await this.loadEntitlements(generation)
    } catch (error) {
      if (generation === this.generation) this.applyFailure(error, 'session')
      return this.status()
    }
    this.setState(this.state, this.error)
    return this.status()
  }

  /**
   * Clears locally first (disk, memory, state push), then revokes the device
   * (scope device) in the background; a failed revoke changes nothing locally.
   */
  async logout(): Promise<AccountStatus> {
    this.generation++
    this.attempts.cancel()
    this.clearAttemptTimer()
    const live = this.session
    const transport = this.transport
    this.resetSession()
    this.deps.credentials.clear()
    this.setState('signed-out')
    if (live && transport) void this.revokeDevice(live, transport)
    return this.status()
  }

  private async revokeDevice(live: LiveSession, transport: UniworkTransport): Promise<void> {
    try {
      let token = live.accessToken
      if (!token || live.accessExpiresAt <= this.now()) {
        token = (
          await transport.refresh({
            deviceSessionId: live.credential.deviceSessionId,
            refreshToken: live.credential.refreshToken,
          })
        ).accessToken
      }
      await transport.logout({ deviceSessionId: live.credential.deviceSessionId }, token)
    } catch {
      // offline or already revoked: the server-side device expires on its own
    }
  }

  dispose(): void {
    this.generation++
    this.clearAttemptTimer()
    this.clearRefreshTimer()
    this.clearRecoveryTimer()
  }

  protected override recover(): Promise<unknown> {
    return this.retry()
  }

  private async loadAccount(generation: number): Promise<void> {
    const me = await this.authorized((token) => (this.transport as UniworkTransport).me(token))
    const orgs = await this.authorized((token) => (this.transport as UniworkTransport).orgs(token))
    if (generation !== this.generation) return
    // the tokens belong to the account the credential was issued for
    if (this.session && me.id !== this.session.credential.accountId) {
      throw new TransportError('unauthorized', undefined, true)
    }
    this.accountProfile = toProfile(me)
    this.orgs = orgs
    this.org = pickOrg(orgs, this.deps.readSelectedOrgId())
    await this.loadEntitlements(generation)
    if (generation !== this.generation || !this.session) return
    // cache the profile (encrypted) so server-unreachable can still show it;
    // later rotations persist it from session.credential
    this.session.credential = { ...this.session.credential, profile: this.accountProfile }
    this.persist(this.session.credential, false)
    this.setState('signed-in')
  }

  private async loadEntitlements(generation: number): Promise<void> {
    const org = this.org
    let next: AccountEntitlements | null = null
    if (org) {
      try {
        const billing = await this.authorized((token) =>
          (this.transport as UniworkTransport).billing(org.id, token),
        )
        next = toEntitlements(org.id, billing, this.now())
      } catch (error) {
        if (handled.has(error as object)) throw error
        if (
          error instanceof TransportError &&
          (error.code === 'device_revoked' || error.code === 'refresh_reused')
        ) {
          throw error
        }
        // entitlements are data only: a billing read failure leaves them unknown
        next = this.entitlements?.orgId === org.id ? this.entitlements : null
      }
    }
    if (generation !== this.generation) return
    this.setEntitlements(next)
  }

  /** the failure state is already applied unless the attempt was still pending */
  private failLogin(error: AccountErrorCode): void {
    if (this.state === 'signing-in') this.setState('signed-out', error)
    this.emitLogin({ phase: 'error', error })
  }

  private expireAttempt(attemptId: string): void {
    if (this.attempts.peek()?.attemptId !== attemptId) return
    this.attempts.cancel()
    this.generation++
    this.clearAttemptTimer()
    this.failLogin('login_timeout')
  }

  private clearAttemptTimer(): void {
    if (this.attemptTimer) clearTimeout(this.attemptTimer)
    this.attemptTimer = null
  }
}
