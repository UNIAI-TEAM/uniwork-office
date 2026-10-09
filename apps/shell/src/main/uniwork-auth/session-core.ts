import type {
  AccountEntitlements,
  AccountErrorCode,
  AccountLoginEvent,
  AccountProfile,
  AccountState,
  AccountStatus,
} from '../../shared/home-api'
import { CredentialStoreError, type CredentialStore, type StoredCredential } from './credentials'
import type { DeploymentProfile } from './deployment'
import {
  classifyTransportFailure,
  toAccountOrg,
  type FailureOutcome,
  type FailurePhase,
} from './mapping'
import type { LoginAttemptStore } from './pkce'
import {
  TransportError,
  type DesktopSession,
  type OrgResponse,
  type UniworkTransport,
} from './transport'

export interface AccountManagerDeps {
  resolveProfile(): DeploymentProfile | null
  createTransport(profile: DeploymentProfile): UniworkTransport
  credentials: CredentialStore
  /** opens the validated authorization URL in the system browser */
  openBrowser(url: string, profile: DeploymentProfile): Promise<void>
  readSelectedOrgId(): unknown
  persistSelectedOrgId(orgId: string): void
  device?: { label?: string; platform?: string; build?: string }
  attempts?: LoginAttemptStore
  now?: () => number
}

/** refresh proactively at this share of the access token lifetime */
const PROACTIVE_REFRESH_RATIO = 0.8
/** an access token this close to expiry is refreshed before use */
export const ACCESS_TOKEN_SKEW_MS = 30_000
/** automatic retry after a transient failure: 5 s doubling up to 5 min */
export const RECOVERY_MIN_MS = 5_000
export const RECOVERY_MAX_MS = 300_000
/** setTimeout fires at once past 2^31-1 ms, so longer delays are clamped */
const MAX_TIMER_MS = 2_147_483_647

export interface LiveSession {
  credential: StoredCredential
  accessToken: string
  accessExpiresAt: number
}

/** Failures whose account state was already applied where they happened. */
export const handled = new WeakSet<object>()

/**
 * Session state shared by the account flows: the state machine and its
 * listeners, the in-memory token pair, the single in-flight refresh with its
 * proactive timer, secure persistence, and the failure -> state mapping.
 * Tokens never leave this object except through getAccessToken() for other
 * main-process callers; the renderer only ever sees AccountStatus.
 */
export class SessionCore {
  protected readonly deps: AccountManagerDeps
  protected readonly now: () => number
  protected profile: DeploymentProfile | null = null
  protected transport: UniworkTransport | null = null
  protected state: AccountState = 'signed-out'
  protected error: AccountErrorCode | undefined
  protected session: LiveSession | null = null
  protected accountProfile: AccountProfile | undefined
  protected orgs: OrgResponse[] = []
  protected org: OrgResponse | undefined
  protected entitlements: AccountEntitlements | null = null
  /** last known plan from the stored credential: shown, never published, until fresh data arrives */
  protected cachedEntitlements: AccountEntitlements | null = null
  private publishedEntitlements: AccountEntitlements | null = null
  protected generation = 0
  protected refreshInFlight: Promise<void> | null = null
  protected refreshTimer: ReturnType<typeof setTimeout> | null = null
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null
  private recoveryAttempts = 0
  private recoveryInFlight: Promise<void> | null = null
  /** when the last recovery attempt started or a session refresh last failed */
  private lastRecoveryAt = Number.NEGATIVE_INFINITY
  protected readonly statusListeners = new Set<(status: AccountStatus) => void>()
  protected readonly loginListeners = new Set<(event: AccountLoginEvent) => void>()
  protected readonly entitlementListeners = new Set<(e: AccountEntitlements | null) => void>()

  constructor(deps: AccountManagerDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
  }

  status(): AccountStatus {
    const showsAccount =
      this.state === 'signed-in' ||
      this.state === 'refreshing' ||
      this.state === 'server-unreachable'
    const profile = showsAccount ? this.accountProfile : undefined
    return {
      loggedIn: this.state === 'signed-in' || this.state === 'refreshing',
      ...(profile ? { email: profile.email, profile: { ...profile } } : {}),
      state: this.state,
      ...(showsAccount && this.org ? { org: toAccountOrg(this.org) } : {}),
      ...(showsAccount && this.orgs.length ? { orgs: this.orgs.map(toAccountOrg) } : {}),
      ...(showsAccount ? { entitlements: this.entitlements ?? this.cachedEntitlements } : {}),
      ...(this.profile ? { serverOrigin: new URL(this.profile.apiOrigin).host } : {}),
      ...(this.error ? { error: this.error } : {}),
    }
  }

  onStatus(listener: (status: AccountStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  onLoginEvent(listener: (event: AccountLoginEvent) => void): () => void {
    this.loginListeners.add(listener)
    return () => this.loginListeners.delete(listener)
  }

  onEntitlementsChanged(listener: (e: AccountEntitlements | null) => void): () => void {
    this.entitlementListeners.add(listener)
    return () => this.entitlementListeners.delete(listener)
  }

  getEntitlements(): AccountEntitlements | null {
    return this.state === 'signed-in' || this.state === 'refreshing' ? this.entitlements : null
  }

  /**
   * A valid access token for main-process cloud calls, refreshing if needed.
   * From server-unreachable (credential kept) it tries a refresh itself, so a
   * caller does not have to wait for the next automatic retry.
   */
  async getAccessToken(): Promise<string | null> {
    if (!this.session) return null
    if (this.state === 'server-unreachable') return this.recoverAccessToken()
    if (!(this.state === 'signed-in' || this.state === 'refreshing')) return null
    if (this.session.accessExpiresAt - this.now() > ACCESS_TOKEN_SKEW_MS)
      return this.session.accessToken
    try {
      await this.refresh()
    } catch {
      return null
    }
    return this.session?.accessToken ?? null
  }

  /**
   * Refresh-only recovery for a getAccessToken() caller while offline. Calls
   * share one refresh, and a new one starts at most once per RECOVERY_MIN_MS
   * after the last failed or caller-started attempt, so a burst of offline
   * calls returns null at once instead of each waiting on the network. The
   * account reload follows in the background.
   */
  private async recoverAccessToken(): Promise<string | null> {
    // a still-valid access token needs no refresh (and no refresh-token rotation)
    if (
      !this.refreshInFlight &&
      this.session &&
      this.session.accessExpiresAt - this.now() > ACCESS_TOKEN_SKEW_MS
    ) {
      void this.runRecovery()
      return this.session.accessToken
    }
    if (!this.refreshInFlight) {
      if (this.recoveryInFlight || this.now() - this.lastRecoveryAt < RECOVERY_MIN_MS) return null
      this.lastRecoveryAt = this.now()
    }
    try {
      await this.refresh()
    } catch {
      return null
    }
    const token = this.session?.accessToken
    if (!token) return null
    if (this.state === 'server-unreachable') void this.runRecovery()
    return token
  }

  /** single in-flight refresh; applies the failure state itself, then rethrows */
  refresh(): Promise<void> {
    if (!this.refreshInFlight) {
      const run = this.runRefresh().finally(() => {
        if (this.refreshInFlight === run) this.refreshInFlight = null
      })
      this.refreshInFlight = run
    }
    return this.refreshInFlight
  }

  protected async runRefresh(): Promise<void> {
    const generation = this.generation
    const live = this.session
    if (!live || !this.transport) throw this.markHandled(new TransportError('unauthorized'))
    if (live.credential.refreshExpiresAt <= this.now()) {
      this.applyOutcome({ state: 'session-expired', error: 'unauthorized', clearCredentials: true })
      throw this.markHandled(new TransportError('unauthorized'))
    }
    // only a refresh that showed `refreshing` itself flips it back: startup
    // restore keeps `refreshing` until the account reload has verified it
    const showsRefreshing = this.state === 'signed-in'
    if (showsRefreshing) this.setState('refreshing')
    let next: DesktopSession
    try {
      next = await this.transport.refresh({
        deviceSessionId: live.credential.deviceSessionId,
        refreshToken: live.credential.refreshToken,
      })
    } catch (error) {
      if (generation === this.generation) this.applyFailure(error, 'session')
      throw this.markHandled(error)
    }
    if (generation !== this.generation) throw this.markHandled(new TransportError('unauthorized'))
    // rotation: the old refresh token is dead server-side, persist the new one first
    const credential: StoredCredential = {
      ...live.credential,
      deviceSessionId: next.deviceSessionId,
      sessionId: next.sessionId,
      refreshToken: next.refreshToken,
      refreshExpiresAt: this.now() + next.refreshExpiresIn * 1000,
    }
    if (!this.persist(credential)) throw this.markHandled(new TransportError('unauthorized'))
    this.adoptSession(credential, next)
    if (showsRefreshing && this.state === 'refreshing') this.setState('signed-in')
  }

  /** what an automatic recovery runs; the manager reloads the account too */
  protected recover(): Promise<unknown> {
    return this.refresh()
  }

  /** one recovery at a time, shared by the backoff timer and getAccessToken() */
  protected runRecovery(): Promise<void> {
    if (!this.recoveryInFlight) {
      this.lastRecoveryAt = this.now()
      const run = this.recover()
        .then(
          () => undefined,
          () => undefined,
        )
        .finally(() => {
          if (this.recoveryInFlight === run) this.recoveryInFlight = null
        })
      this.recoveryInFlight = run
    }
    return this.recoveryInFlight
  }

  /** server-unreachable with a credential retries on its own, with a bounded backoff */
  private scheduleRecovery(): void {
    if (this.recoveryTimer) return
    const delay = Math.min(RECOVERY_MAX_MS, RECOVERY_MIN_MS * 2 ** this.recoveryAttempts)
    this.recoveryAttempts = Math.min(this.recoveryAttempts + 1, 16)
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      void this.runRecovery()
    }, delay)
  }

  protected clearRecoveryTimer(): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = null
  }

  /** the active deployment profile (resolved once per process), or null */
  deploymentProfile(): DeploymentProfile | null {
    if (!this.profile) {
      this.profile = this.deps.resolveProfile()
      this.transport = this.profile ? this.deps.createTransport(this.profile) : null
    }
    return this.profile
  }

  protected ensureProfile(): boolean {
    if (!this.deploymentProfile()) this.setState('not-configured', 'not_configured')
    return this.profile !== null
  }

  protected adoptSession(credential: StoredCredential, session: DesktopSession): void {
    this.session = {
      credential,
      accessToken: session.accessToken,
      accessExpiresAt: this.now() + session.expiresIn * 1000,
    }
    this.clearRefreshTimer()
    const delay = Math.min(
      MAX_TIMER_MS,
      Math.max(1000, session.expiresIn * 1000 * PROACTIVE_REFRESH_RATIO),
    )
    this.refreshTimer = setTimeout(() => void this.refresh().catch(() => undefined), delay)
  }

  /**
   * Public form of authorized() for other main-process cloud callers: `call`
   * signals a 401 by throwing TransportError('unauthorized'), which shares the
   * single in-flight refresh and retries once. Only while the account shows a
   * session (signed-in, refreshing, or server-unreachable with a credential).
   */
  authorizedRequest<T>(call: (token: string) => Promise<T>): Promise<T> {
    if (
      !this.session ||
      !(
        this.state === 'signed-in' ||
        this.state === 'refreshing' ||
        this.state === 'server-unreachable'
      )
    ) {
      return Promise.reject(this.markHandled(new TransportError('unauthorized')))
    }
    return this.authorized(call)
  }

  /** who the session belongs to (never a token); null without a session */
  sessionIdentity(): { accountId: string; deviceSessionId: string; deploymentId: string } | null {
    if (!this.session || !this.profile) return null
    if (!(
      this.state === 'signed-in' ||
      this.state === 'refreshing' ||
      this.state === 'server-unreachable'
    ))
      return null
    const { accountId, deviceSessionId } = this.session.credential
    return { accountId, deviceSessionId, deploymentId: this.profile.deploymentId }
  }

  /** one 401 -> refresh -> retry; session-level failures are applied once */
  protected async authorized<T>(call: (token: string) => Promise<T>): Promise<T> {
    if (!this.session) throw this.markHandled(new TransportError('unauthorized'))
    if (this.session.accessExpiresAt - this.now() <= ACCESS_TOKEN_SKEW_MS) await this.refresh()
    try {
      return await call(this.liveToken())
    } catch (error) {
      if (!(error instanceof TransportError) || error.code !== 'unauthorized') throw error
    }
    await this.refresh()
    return call(this.liveToken())
  }

  /** the current access token; a session dropped meanwhile (logout) ends the call */
  protected liveToken(): string {
    if (!this.session) throw this.markHandled(new TransportError('unauthorized'))
    return this.session.accessToken
  }

  /** false (and state applied) when the secure store refuses */
  protected persist(credential: StoredCredential, failHard = true): boolean {
    try {
      this.deps.credentials.save(credential)
      return true
    } catch (error) {
      if (!failHard) return true
      if (error instanceof CredentialStoreError && error.code === 'keyring_unavailable') {
        this.resetSession()
        this.setState('keyring-unavailable', 'keyring_unavailable')
        return false
      }
      // a disk failure keeps the session for this run; restart signs in again
      return true
    }
  }

  protected applyFailure(error: unknown, phase: FailurePhase): AccountErrorCode {
    if (handled.has(error as object)) return this.error ?? 'server_error'
    this.markHandled(error)
    if (error instanceof CredentialStoreError) {
      return this.applyOutcome({
        state: 'keyring-unavailable',
        error: 'keyring_unavailable',
        clearCredentials: false,
      })
    }
    if (!(error instanceof TransportError)) {
      return this.applyOutcome(classifyTransportFailure('server_error', phase))
    }
    return this.applyOutcome(classifyTransportFailure(error.code, phase, error.fromServer))
  }

  protected applyOutcome(outcome: FailureOutcome): AccountErrorCode {
    if (outcome.clearCredentials) {
      this.deps.credentials.clear()
      this.resetSession()
    } else if (
      outcome.state === 'wrong-deployment' ||
      outcome.state === 'signed-out' ||
      outcome.state === 'keyring-unavailable'
    ) {
      // no usable session: a later sign-in must start fresh, not "recover" this one
      this.resetSession()
    }
    this.setState(outcome.state, outcome.error)
    return outcome.error
  }

  protected markHandled<T>(error: T): T {
    if (error && typeof error === 'object') handled.add(error)
    return error
  }

  /** drops in-memory tokens and account data (the disk credential is untouched) */
  protected resetSession(): void {
    this.clearRefreshTimer()
    this.clearRecoveryTimer()
    this.refreshInFlight = null
    this.session = null
    this.accountProfile = undefined
    this.orgs = []
    this.org = undefined
    this.setEntitlements(null)
  }

  /** `keepCache`: a plan that stays display-only (never live) while billing is unreadable */
  protected setEntitlements(
    next: AccountEntitlements | null,
    keepCache: AccountEntitlements | null = null,
  ): void {
    this.entitlements = next
    this.cachedEntitlements = keepCache
    this.publishEntitlements()
  }

  protected setState(state: AccountState, error?: AccountErrorCode): void {
    this.state = state
    this.error = error
    if (state === 'server-unreachable' && this.session) {
      this.lastRecoveryAt = this.now()
      this.scheduleRecovery()
    } else if (state !== 'refreshing') {
      this.clearRecoveryTimer()
      if (state === 'signed-in') this.recoveryAttempts = 0
    }
    const status = this.status()
    for (const listener of this.statusListeners) listener(status)
    this.publishEntitlements()
  }

  /** notifies when the effective value (what getEntitlements() returns) changes */
  private publishEntitlements(): void {
    const effective = this.getEntitlements()
    if (effective === this.publishedEntitlements) return
    this.publishedEntitlements = effective
    for (const listener of this.entitlementListeners) listener(effective)
  }

  protected emitLogin(event: AccountLoginEvent): void {
    for (const listener of this.loginListeners) listener(event)
  }

  protected clearRefreshTimer(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = null
  }
}
