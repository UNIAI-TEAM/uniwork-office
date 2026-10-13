import type {
  AccountEntitlements,
  AccountErrorCode,
  AccountOrg,
  AccountProfile,
  AccountState,
  OrgMembershipState,
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

/**
 * The membership state of one org row. `/orgs` reports only the tenant's own
 * status, so a suspended (or archived) organization is blocked here; a
 * deactivated membership is learned later from the per-org membership read
 * (see `resolveOrgChoice` and AccountManager.selectOrg).
 */
export function membershipOf(org: OrgResponse, deactivated = false): OrgMembershipState {
  if (org.status !== 'active') return 'organization_suspended'
  return deactivated ? 'member_deactivated' : 'active'
}

export function toAccountOrg(org: OrgResponse, deactivated = false): AccountOrg {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    role: org.role,
    membership: membershipOf(org, deactivated),
  }
}

export interface OrgChoice {
  /** the organization to work in; undefined while a choice is pending or every org is blocked */
  org: OrgResponse | undefined
  /** true when the renderer must show the S16 picker and no org-scoped call may run yet */
  needsOrgChoice: boolean
  /** true when a stored choice is no longer a membership of this account */
  rememberedGone: boolean
}

/**
 * G8-16 S16: no auto-pick when the account belongs to more than one usable
 * organization and none was remembered. The stored choice (per account +
 * machine) is used when it is still a membership and usable; when it is gone
 * the picker returns with `rememberedGone`; when it is present but blocked the
 * picker returns without `rememberedGone` (the row itself is not selectable).
 */
export function resolveOrgChoice(
  orgs: readonly OrgResponse[],
  persistedId: unknown,
): OrgChoice {
  const remembered =
    typeof persistedId === 'string' && persistedId
      ? orgs.find((org) => org.id === persistedId)
      : undefined
  if (remembered) {
    if (remembered.status === 'active') {
      return { org: remembered, needsOrgChoice: false, rememberedGone: false }
    }
    // still a membership, but the organization (or the membership) is blocked
    return { org: undefined, needsOrgChoice: true, rememberedGone: false }
  }
  const hadRemembered = typeof persistedId === 'string' && persistedId.length > 0
  const active = orgs.filter((org) => org.status === 'active')
  if (active.length === 1) {
    return { org: active[0], needsOrgChoice: false, rememberedGone: false }
  }
  if (active.length > 1) {
    // more than one usable organization and no remembered choice: never guess
    return { org: undefined, needsOrgChoice: true, rememberedGone: hadRemembered }
  }
  // nothing usable: no picker (the renderer shows the all-blocked panel)
  return { org: undefined, needsOrgChoice: false, rememberedGone: hadRemembered }
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
