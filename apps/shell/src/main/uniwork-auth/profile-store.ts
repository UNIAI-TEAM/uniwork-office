import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PROFILE_FILE,
  parseDeploymentProfile,
  type DeploymentChannel,
  type DeploymentProfile,
} from './deployment'

/**
 * Which server this install talks to is the user's choice, written to
 * `deployment-profile.json` in userData. The choice arrives from a web "open"
 * link or from the address the user types; the rules for changing it are the
 * pure `decideProfileChange` and the orchestration in `createProfileApplier`.
 */

export type ProfileChange = 'refuse' | 'unchanged' | 'update' | 'confirm'

/**
 * - another channel's profile is refused (a dev link never re-points a stable app);
 * - the same deployment id with the same origin changes nothing, with a new
 *   origin it moves without a question (the domain moved), but the old
 *   sign-in still ends the normal way;
 * - no profile yet, or another deployment id, needs the user's yes.
 */
export function decideProfileChange(
  current: DeploymentProfile | null,
  incoming: DeploymentProfile,
  appChannel: DeploymentChannel,
): ProfileChange {
  if (incoming.channel !== appChannel) return 'refuse'
  if (current && current.deploymentId === incoming.deploymentId) {
    return current.apiOrigin === incoming.apiOrigin ? 'unchanged' : 'update'
  }
  return 'confirm'
}

/** writes the userData profile atomically (temp file, then rename) */
export function writeUserProfile(userDataDir: string, profile: DeploymentProfile): void {
  mkdirSync(userDataDir, { recursive: true })
  const target = join(userDataDir, PROFILE_FILE)
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
  renameSync(temp, target)
}

export type ProfileOutcome = 'applied' | 'unchanged' | 'refused' | 'declined'

export interface ProfileApplierDeps {
  appChannel(): DeploymentChannel
  /** the profile in force now */
  current(): DeploymentProfile | null
  /** asks "Connect UniWork Office to <origin>?"; true = yes */
  confirm(origin: string): Promise<boolean>
  /**
   * Ends the sign-in made on the old deployment (documents closed, device
   * revoked in the background). false = the user cancelled, nothing changed.
   */
  endSession(): Promise<boolean>
  save(profile: DeploymentProfile): void
  /** points the account at the profile in memory */
  adopt(profile: DeploymentProfile): Promise<void>
}

export interface ProfileApplier {
  /** `confirmed`: the user typed the address themselves, so no second question */
  apply(incoming: DeploymentProfile, options?: { confirmed?: boolean }): Promise<ProfileOutcome>
}

export function createProfileApplier(deps: ProfileApplierDeps): ProfileApplier {
  return {
    async apply(incoming, options = {}) {
      const change = decideProfileChange(deps.current(), incoming, deps.appChannel())
      try {
        if (change === 'refuse') return 'refused'
        if (change === 'unchanged') return 'unchanged'
        if (change === 'confirm' && !options.confirmed) {
          if (!(await deps.confirm(incoming.apiOrigin))) return 'declined'
        }
        // a moved origin also ends the old sign-in through the sign-out hooks:
        // its documents close and its AI history is forgotten, as on Sign out
        if (!(await deps.endSession())) return 'declined'
        deps.save(incoming)
        await deps.adopt(incoming)
        return 'applied'
      } catch {
        // a failed write leaves the old profile in force
        return 'refused'
      }
    },
  }
}

/**
 * One profile change at a time. A link that arrives while another change is
 * still being decided (a confirm or close prompt is open) is dropped, so a
 * burst of links cannot stack dialogs; a typed address waits its turn. Each
 * change decides on the profile in force when it runs.
 */
export function serializeProfileApplies<O extends { confirmed?: boolean }>(
  apply: (incoming: DeploymentProfile, options: O) => Promise<ProfileOutcome>,
): (incoming: DeploymentProfile, options: O) => Promise<ProfileOutcome> {
  let running: Promise<ProfileOutcome> | null = null
  return (incoming, options) => {
    if (running && !options.confirmed) return Promise.resolve('declined')
    const next: Promise<ProfileOutcome> = (running ?? Promise.resolve('unchanged'))
      .catch(() => 'refused' as const)
      .then(() => apply(incoming, options))
    running = next
    void next.finally(() => {
      if (running === next) running = null
    })
    return next
  }
}

export type ServerAddressError = 'invalid_address' | 'unreachable'

const SERVER_PROBE_MS = 8_000
/** the public config is a few KB; a typed host never gets to stream more */
const SERVER_PROBE_MAX_BYTES = 64 * 1024

async function readBounded(response: Response, limit: number): Promise<string | null> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
const SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * A hand-typed address as a profile for `channel`. The deployment id is the
 * server's own `office_deployment_id` from its public config
 * (`GET <origin>/api/v1/config`); a server that answers without it gets the
 * `default` id the environment path uses. A server that does not answer at
 * all is not saved.
 */
export async function profileFromAddress(
  address: string,
  channel: DeploymentChannel,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response> = (input, init) =>
    fetch(input, init),
): Promise<{ ok: true; profile: DeploymentProfile } | { ok: false; error: ServerAddressError }> {
  const typed = address.trim()
  if (!typed) return { ok: false, error: 'invalid_address' }
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(typed)
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed)
    ? typed
    : `${channel === 'dev' && loopback ? 'http' : 'https'}://${typed}`
  const probe = parseDeploymentProfile({ deploymentId: 'default', apiOrigin: withScheme, channel })
  if (!probe) return { ok: false, error: 'invalid_address' }
  let deploymentId = 'default'
  try {
    const response = await fetchImpl(`${probe.apiOrigin}/api/v1/config`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(SERVER_PROBE_MS),
    })
    const text = await readBounded(response, SERVER_PROBE_MAX_BYTES)
    let body: unknown = null
    try {
      body = text === null ? null : JSON.parse(text)
    } catch {
      body = null
    }
    const id =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>).office_deployment_id
        : null
    if (typeof id === 'string' && SERVER_ID.test(id)) deploymentId = id
  } catch {
    return { ok: false, error: 'unreachable' }
  }
  const profile = parseDeploymentProfile({ deploymentId, apiOrigin: probe.apiOrigin, channel })
  return profile ? { ok: true, profile } : { ok: false, error: 'invalid_address' }
}
