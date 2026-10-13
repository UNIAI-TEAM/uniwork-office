import type { AccountEntitlements, AccountErrorCode, AccountStatus } from '../../shared/home-api'
import { isAuthCallbackUrl, validateCallback } from './callback'
import { CredentialStoreError, type StoredCredential } from './credentials'
import { redirectUriForProfile, type DeploymentProfile } from './deployment'
import { resolveOrgChoice, toAccountOrg, toEntitlements, toProfile } from './mapping'
import { LoginAttemptStore, type PendingLoginAttempt } from './pkce'
import {
  ACCESS_TOKEN_SKEW_MS,
  SessionCore,
  handled,
  type AccountManagerDeps,
  type LiveSession,
} from './session-core'
import { TransportError, type DesktopSession, type UniworkTransport } from './transport'

export type { AccountManagerDeps } from './session-core'

/** the startup restore waits at most this long for the proxy install */
export const STARTUP_GATE_DEADLINE_MS = 4_000

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
   * Startup restore. The stored credential is read and `refreshing` shown at
   * once (a click meanwhile does not open a second sign-in); only the network
   * step waits for `gate` (the main-process proxy install), and for at most
   * `gateDeadlineMs` so a hung proxy lookup cannot block the restore.
   * Skipped when the user signed out or cancelled in the meantime.
   */
  async startupRestore(
    gate: Promise<unknown>,
    gateDeadlineMs = STARTUP_GATE_DEADLINE_MS,
  ): Promise<AccountStatus> {
    const generation = this.beginRestore()
    if (generation === null) return this.status()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, gateDeadlineMs)
      void gate
        .catch(() => undefined)
        .then(() => {
          clearTimeout(timer)
          resolve()
        })
    })
    if (generation !== this.generation) return this.status()
    return this.finishRestore(generation)
  }

  /** Restores the stored session (refresh + account reload); never throws. */
  async restore(): Promise<AccountStatus> {
    const generation = this.beginRestore()
    if (generation === null) return this.status()
    return this.finishRestore(generation)
  }

  /**
   * The synchronous half of a restore: reads the credential and shows it as
   * `refreshing` with the cached account. Null when there is nothing to
   * refresh (the final state is already applied).
   */
  private beginRestore(): number | null {
    const generation = ++this.generation
    this.resetSession()
    if (!this.ensureProfile()) return null
    const profile = this.profile as DeploymentProfile
    let credential: StoredCredential | null
    try {
      credential = this.deps.credentials.load()
    } catch (error) {
      // a locked keystore is transient (retry once unlocked) and keeps the
      // saved profile; a missing keyring is the permanent keyring-unavailable
      if (error instanceof CredentialStoreError && error.code === 'keystore_locked') {
        this.setState('keystore-locked', 'keystore_locked')
      } else {
        this.setState('keyring-unavailable', 'keyring_unavailable')
      }
      return null
    }
    if (!credential) {
      this.setState('signed-out')
      return null
    }
    if (
      credential.deploymentId !== profile.deploymentId ||
      credential.apiOrigin !== profile.apiOrigin ||
      credential.clientId !== profile.clientId
    ) {
      // a credential issued by another deployment is never sent to this one
      this.setState('wrong-deployment', 'wrong_deployment')
      return null
    }
    this.session = { credential, accessToken: '', accessExpiresAt: 0 }
    this.accountProfile = credential.profile
    // the last known organization and plan, shown until the server answers
    // (or while it cannot be reached)
    const org = credential.org
    if (org && typeof org.id === 'string' && typeof org.name === 'string') {
      // display-only until the server answers: a cached org is shown as active
      this.org = { id: org.id, name: org.name, slug: org.slug, role: org.role, status: 'active' }
      this.orgs = [this.org]
      if (credential.entitlements?.orgId === org.id)
        this.cachedEntitlements = credential.entitlements
    }
    this.setState('refreshing')
    return generation
  }

  private async finishRestore(generation: number): Promise<AccountStatus> {
    try {
      await this.refresh()
      await this.loadAccount(generation)
    } catch (error) {
      if (generation === this.generation) this.applyFailure(error, 'session')
    }
    return this.status()
  }

  /**
   * Points the account at `next` (the user or a web link chose another
   * server). A stored sign-in for the same deployment follows a moved origin;
   * one for another deployment stays refused by the restore check (the caller
   * signs out first). Ends with a restore against the new server.
   */
  async adoptProfile(next: DeploymentProfile): Promise<AccountStatus> {
    this.generation++
    this.attempts.cancel()
    this.clearAttemptTimer()
    this.clearRefreshTimer()
    this.clearRecoveryTimer()
    this.profile = next
    this.transport = this.deps.createTransport(next)
    // A link may move the address silently, but never the sign-in: the
    // deployment id is public, so a link naming it proves nothing about the
    // new origin. The stored refresh credential stays bound to the origin that
    // issued it and is dropped here (that origin is usually gone after a move);
    // the user signs in again on the new origin in the browser, where they see
    // its address. No token is ever sent to an origin the user did not sign in to.
    try {
      const stored = this.deps.credentials.load()
      if (stored && stored.apiOrigin !== next.apiOrigin) {
        this.session = null
        this.deps.credentials.clear()
      }
    } catch {
      // an unreadable credential is reported by the restore below
    }
    return this.restore()
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
    // a fresh sign-in overwrites an unreadable credential, but only when it can
    // be stored encrypted: otherwise the redeemed code would orphan a device
    if (this.state === 'keyring-unavailable' && !this.deps.credentials.canStore()) {
      this.emitLogin({ phase: 'error', error: 'keyring_unavailable' })
      return false
    }
    // a locked keystore cannot be written: refuse before opening a browser, so
    // the redeemed code never overwrites the saved credential
    if (this.state === 'keystore-locked' && !this.deps.credentials.canStore()) {
      this.emitLogin({ phase: 'error', error: 'keystore_locked' })
      return false
    }
    const profile = this.profile as DeploymentProfile
    // a click while the browser sign-in is open (the chip and the account
    // entry still offer Sign in) re-opens that page: a new attempt would turn
    // the open tab's callback into a state mismatch and the sign-in would be lost
    const live = this.state === 'signing-in' ? this.attempts.current(this.now()) : undefined
    if (live) return this.reopenAttempt(live, profile)
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

  /** login() during a live attempt: same attempt, same page; true once the browser opened */
  private async reopenAttempt(
    attempt: PendingLoginAttempt,
    profile: DeploymentProfile,
  ): Promise<boolean> {
    // still starting: the first login() call opens the browser itself
    if (!attempt.authorizationUrl) return true
    const generation = this.generation
    this.emitLogin({ phase: 'url', url: attempt.authorizationUrl })
    try {
      await this.deps.openBrowser(attempt.authorizationUrl, profile)
    } catch {
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
      if (validation.reason === 'expired') {
        this.expireAttempt(attempt.attemptId)
        return
      }
      // a forged, stale or foreign-scheme callback is discarded; the user's
      // live attempt and its state are left alone (anything can open a URL).
      // The renderer shows it as a passing notice, not as a failed sign-in.
      this.emitLogin({
        phase: 'error',
        error: validation.reason === 'state_mismatch' ? 'state_mismatch' : 'invalid_callback',
      })
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
      this.failLogin(this.state === 'keystore-locked' ? 'keystore_locked' : 'keyring_unavailable')
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
    if (
      this.state === 'not-configured' ||
      this.state === 'keyring-unavailable' ||
      this.state === 'keystore-locked'
    )
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
    // a suspended organization is never selectable, and its row says so
    if (org.status !== 'active') return this.status()
    const generation = this.generation
    // the org list cannot carry a deactivated membership (D sends only the
    // tenant status), so the caller's own membership is read here: this is
    // the one org-scoped call a select makes, and only for the chosen org.
    try {
      const membership = await this.authorized((token) =>
        (this.transport as UniworkTransport).orgMembership(org.slug, token),
      )
      if (generation !== this.generation) return this.status()
      if (membership.deactivatedAt) {
        this.deactivatedOrgIds.add(org.id)
        this.setState(this.state, this.error)
        return this.status()
      }
    } catch (error) {
      if (generation !== this.generation) return this.status()
      // an unreachable membership read must not silently hand out an org the
      // account may no longer be in: keep the picker and report the failure
      this.applyFailure(error, 'session')
      return this.status()
    }
    this.deactivatedOrgIds.delete(org.id)
    try {
      this.deps.persistSelectedOrgId(org.id)
    } catch {
      // the choice still applies to this run
    }
    this.org = org
    this.needsOrgChoice = false
    this.rememberedGone = false
    try {
      await this.loadEntitlements(generation)
    } catch (error) {
      if (generation === this.generation) this.applyFailure(error, 'session')
      return this.status()
    }
    if (generation !== this.generation) return this.status()
    this.cacheAccount()
    this.setState(this.state, this.error)
    return this.status()
  }

  /**
   * Clears locally first (disk, memory, state push), then revokes the device
   * (scope device) in the background; a failed revoke changes nothing locally.
   * There is no retry or tombstone: if the revoke never lands (offline, quit
   * within the request timeout) the server-side device session stays valid
   * until its refresh expiry, but its refresh token no longer exists anywhere
   * on this machine.
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
    // G8-16 S16: a >1-org account with no remembered choice stops here, before
    // any org-scoped read (billing included); one org is picked automatically.
    const choice = resolveOrgChoice(orgs, this.deps.readSelectedOrgId())
    this.needsOrgChoice = choice.needsOrgChoice
    this.rememberedGone = choice.rememberedGone
    this.org = choice.org
    if (choice.needsOrgChoice) {
      // no org to load a plan for, and nothing org-scoped may run yet: the
      // credential's display-only cached plan (if any) is left untouched
      this.setState('signed-in')
      return
    }
    // the auto-picked single org is remembered like a manual choice, so the
    // next sign-in on this machine skips the question
    if (this.org && this.org.id !== this.deps.readSelectedOrgId()) {
      try {
        this.deps.persistSelectedOrgId(this.org.id)
      } catch {
        // the choice still applies to this run
      }
    }
    await this.loadEntitlements(generation)
    if (generation !== this.generation || !this.session) return
    this.cacheAccount()
    this.setState('signed-in')
  }

  private async loadEntitlements(generation: number): Promise<void> {
    const org = this.org
    let next: AccountEntitlements | null = null
    let keepCache: AccountEntitlements | null = null
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
        // entitlements are data only: a billing read failure keeps this
        // session's last plan of the organization, else leaves it unknown. A
        // plan from the stored credential stays display-only (status), it is
        // never published as live entitlements
        next = this.entitlements?.orgId === org.id ? this.entitlements : null
        if (!next && this.cachedEntitlements?.orgId === org.id) keepCache = this.cachedEntitlements
      }
    }
    if (generation !== this.generation) return
    this.setEntitlements(next, keepCache)
  }

  /**
   * Caches the profile, organization and plan in the (encrypted) credential so
   * a restart that cannot reach UniWork still shows them; later rotations
   * persist them from session.credential.
   */
  private cacheAccount(): void {
    if (!this.session) return
    this.session.credential = {
      ...this.session.credential,
      profile: this.accountProfile,
      org: this.org ? toAccountOrg(this.org) : undefined,
      entitlements: this.entitlements ?? this.cachedEntitlements,
    }
    this.persist(this.session.credential, false)
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
