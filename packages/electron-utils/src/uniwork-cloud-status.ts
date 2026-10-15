/// Read-only UniWork cloud status and account/organization identity snapshot from the shell main
/// process to every renderer (see ./uniwork-cloud-status-bridge).
///
/// Editor renderers only had the boolean `window.uniworkAiFlag`; the S7 model picker row/footer
/// and the S7/S8 composer note & disclosure need the cloud state, credits, whether `unavailable`
/// came from a server `cloud_unavailable` answer vs a failed first read, whether the user is
/// signed in, and the signed-in account/org identity (`accountId`, `orgId`, `orgName`) — all
/// token-free.
///
/// Pure (no Electron import) so main, preload, renderer UI and tests share it.

/** renderer -> main: ask for the current cloud status snapshot (answers UniworkCloudStatusSnapshot | null) */
export const UNIWORK_CLOUD_STATUS_GET = 'uniwork:cloud-status'
/** main -> renderer: the cloud status snapshot changed (payload: UniworkCloudStatusSnapshot | null) */
export const UNIWORK_CLOUD_STATUS_CHANGED = 'uniwork:cloud-status-changed'
/** renderer -> main: open Settings > Account in the shell window */
export const UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT = 'uniwork:cloud-status-open-account'
/** renderer -> main: start UniWork sign-in (or open Settings > Account) */
export const UNIWORK_CLOUD_STATUS_SIGN_IN = 'uniwork:cloud-status-sign-in'

/** the global each preload exposes the cloud status bridge under */
export const UNIWORK_CLOUD_STATUS_BRIDGE_KEY = 'uniworkCloudStatus'

export type UniworkCloudStateName =
  | 'signed-out'
  | 'not-entitled'
  | 'subscription-inactive'
  | 'credits-exhausted'
  | 'unavailable'
  | 'ready'

const VALID_STATES: readonly UniworkCloudStateName[] = [
  'signed-out',
  'not-entitled',
  'subscription-inactive',
  'credits-exhausted',
  'unavailable',
  'ready',
]

const OFF_STATES: readonly UniworkCloudStateName[] = [
  'signed-out',
  'not-entitled',
  'subscription-inactive',
]

export interface UniworkCloudCreditsSnapshot {
  unit: string
  used: number | null
  limit: number | null
  remaining: number | null
  periodEnd: string | null
}

/**
 * Token-free snapshot of UniWork cloud status + signed-in organization identity.
 * `null` means the first server read has not completed yet (or standalone mode with no shell).
 */
export interface UniworkCloudStatusSnapshot {
  state: UniworkCloudStateName
  signedIn: boolean
  enabled: boolean
  credits: UniworkCloudCreditsSnapshot | null
  /**
   * Server/error reason when `state === 'unavailable'` (e.g. `'cloud_unavailable'` vs
   * `'network'` / `'timeout'`). S7 picker footer shows `cloudStateUnavailable` only when
   * `reason === 'cloud_unavailable'` (`cloudUnavailable === true`), not on a failed first read.
   */
  reason?: string | null
  /** True iff `state === 'unavailable'` and the server returned `cloud_unavailable`. */
  cloudUnavailable?: boolean
  /** Signed-in account id (for per-account+org+document disclosure acknowledgement). */
  accountId?: string | null
  /** Selected organization id (for per-account+org+document disclosure acknowledgement). */
  orgId?: string | null
  /** Selected organization display name (interpolated into `aiUniworkDisclosure` `{org}`). */
  orgName?: string | null
}

/** what a preload exposes to its renderer as window.uniworkCloudStatus */
export interface UniworkCloudStatusBridge {
  get(): Promise<UniworkCloudStatusSnapshot | null>
  onChange(handler: (status: UniworkCloudStatusSnapshot | null) => void): () => void
  openAccountSettings(): Promise<void>
  signIn(): Promise<void>
}

/**
 * A standalone editor has no UniWork session and no shell: its main can answer the pull
 * with `null` so the renderer treats the cloud status as not read / absent.
 */
export function answerUniworkCloudStatusOff(ipc: {
  handle(channel: string, listener: () => unknown): void
}): void {
  ipc.handle(UNIWORK_CLOUD_STATUS_GET, () => null)
}

function finiteNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonEmptyStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Defensive parser for IPC payloads. Anything non-object or with an unknown state
 * returns `null` (which means no server read has completed yet -> no picker footer).
 */
export function parseUniworkCloudStatusSnapshot(
  payload: unknown,
): UniworkCloudStatusSnapshot | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const r = payload as Record<string, unknown>
  const state = r.state as UniworkCloudStateName
  if (!VALID_STATES.includes(state)) return null

  const signedIn = typeof r.signedIn === 'boolean' ? r.signedIn : state !== 'signed-out'
  const enabled = r.enabled === true && !OFF_STATES.includes(state)

  let credits: UniworkCloudCreditsSnapshot | null = null
  if (r.credits && typeof r.credits === 'object' && !Array.isArray(r.credits)) {
    const c = r.credits as Record<string, unknown>
    credits = {
      unit: nonEmptyStr(c.unit) ?? 'ai.tokens',
      used: finiteNum(c.used),
      limit: finiteNum(c.limit),
      remaining: finiteNum(c.remaining),
      periodEnd: nonEmptyStr(c.periodEnd) ?? nonEmptyStr(c.periodEndsAt),
    }
  }

  const reason = nonEmptyStr(r.reason)
  const cloudUnavailable =
    typeof r.cloudUnavailable === 'boolean'
      ? r.cloudUnavailable
      : state === 'unavailable' && reason === 'cloud_unavailable'

  const accountId = nonEmptyStr(r.accountId)
  const orgId = nonEmptyStr(r.orgId)
  const orgName = nonEmptyStr(r.orgName)

  return {
    state,
    signedIn,
    enabled,
    credits,
    reason,
    cloudUnavailable,
    accountId,
    orgId,
    orgName,
  }
}
