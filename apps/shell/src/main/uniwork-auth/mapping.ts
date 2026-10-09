import type {
  AccountEntitlements,
  AccountErrorCode,
  AccountOrg,
  AccountProfile,
  AccountState,
} from '../../shared/home-api'
import type { BillingResponse, MeResponse, OrgResponse, TransportErrorCode } from './transport'

/** where a failure happened: no credential yet (sign-in) or with one (session) */
export type FailurePhase = 'sign-in' | 'session'

export interface FailureOutcome {
  state: AccountState
  error: AccountErrorCode
  /** the stored credential is dead and must be deleted */
  clearCredentials: boolean
}

/**
 * The single table from a transport failure to an account state (see the
 * GO-A5 contract). Transient failures keep credentials; only a server
 * verdict that the refresh token or device is dead clears them.
 */
export function classifyTransportFailure(
  code: TransportErrorCode,
  phase: FailurePhase,
  /** false when the code was inferred from a bare HTTP status (no server envelope) */
  fromServer = true,
): FailureOutcome {
  const keep = (state: AccountState, error: AccountErrorCode): FailureOutcome => ({
    state,
    error,
    clearCredentials: false,
  })
  // sign-in has no session to keep, so non-transient failures go back to signed-out
  const soft = (error: AccountErrorCode): FailureOutcome =>
    phase === 'sign-in' ? keep('signed-out', error) : keep('server-unreachable', error)
  switch (code) {
    case 'network':
      return keep('server-unreachable', 'network')
    case 'timeout':
      return keep('server-unreachable', 'timeout')
    case 'server_error':
    case 'desktop_auth_unavailable':
      return keep('server-unreachable', 'server_error')
    case 'wrong_deployment':
      return keep('wrong-deployment', 'wrong_deployment')
    case 'device_revoked':
    case 'refresh_reused':
      return { state: 'session-revoked', error: code, clearCredentials: true }
    case 'unauthorized':
    case 'auth_code_invalid':
      if (phase === 'sign-in') return keep('signed-out', code)
      // only the UniWork server's own verdict ends a session; a bare 401 from
      // something in between keeps the credential for a later retry
      if (!fromServer) return keep('server-unreachable', 'server_error')
      return { state: 'session-expired', error: code, clearCredentials: true }
    case 'rate_limited':
      return soft('rate_limited')
    case 'malformed_response':
      return soft('malformed_response')
    case 'invalid_request':
    case 'forbidden':
      return soft('server_error')
  }
}

export function toProfile(me: MeResponse): AccountProfile {
  return {
    accountId: me.id,
    email: me.email,
    displayName: me.displayName,
    ...(me.avatarUrl ? { avatarUrl: me.avatarUrl } : {}),
  }
}

export function toAccountOrg(org: OrgResponse): AccountOrg {
  return { id: org.id, name: org.name, slug: org.slug, role: org.role }
}

/** persisted choice if still a member, else the first active organization */
export function pickOrg(
  orgs: readonly OrgResponse[],
  persistedId: unknown,
): OrgResponse | undefined {
  if (typeof persistedId === 'string' && persistedId) {
    const kept = orgs.find((org) => org.id === persistedId)
    if (kept) return kept
  }
  return orgs.find((org) => org.status === 'active')
}

export function toEntitlements(
  orgId: string,
  billing: BillingResponse,
  fetchedAt: number,
): AccountEntitlements {
  return {
    orgId,
    planCode: billing.planCode,
    planName: billing.planName,
    status: billing.status,
    features: billing.features.map((feature) => ({ ...feature })),
    fetchedAt,
  }
}
