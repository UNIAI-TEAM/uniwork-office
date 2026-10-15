import { ID } from '../feed/http'
import { REVISION, compareRevision } from '../feed/revision'
import { isStoreSegment } from '../keys'
import { APP_STORE_LEVEL } from '../store-level'

/**
 * Offline lease record codec (DOC-005 §6.2 / G5-D1).
 *
 * The signed `lease` token is kept as an opaque string to send back on renewal
 * and is never parsed for trust. Display and state transitions read the
 * server's plaintext SDO fields (`lease_id`, `generation`, `expires_at`,
 * `renew_after`, `level`, `version_id`, `version`, `revision`, `document_id`,
 * scope) and the client's clock anchors (`server_time_at_receipt`,
 * `monotonic_at_receipt`, `max_wall_clock_seen`).
 *
 * Records are schema-versioned (`schema: 1`); any malformed or newer-schema
 * record is refused (`null`).
 */

export const LEASE_RECORD_SCHEMA = 1
export { APP_STORE_LEVEL }

export type LeaseLevel = 'view' | 'edit'

export interface LeaseScope {
  user_id: string
  deployment_id: string
  organization_id: string
  workspace_id: string
}

export interface LeaseRecord {
  schema: 1
  /** Opaque HMAC-signed token from the server; never parsed for trust */
  lease: string
  lease_id: string
  generation: number
  expires_at: string
  renew_after: string
  issued_at?: string
  level: LeaseLevel
  version_id: string
  version: number
  /** Decimal int64 string; compare with compareLeaseRevision (BigInt) */
  revision: string
  document_id: string
  user_id: string
  deployment_id: string
  organization_id: string
  workspace_id: string
  scope: LeaseScope
  /** Server clock at receipt in epoch ms */
  server_time_at_receipt: number
  /** Client monotonic clock at receipt in ms */
  monotonic_at_receipt: number
  /** Highest wall-clock timestamp (epoch ms) observed for this lease */
  max_wall_clock_seen: number
  policy_epoch?: number
  revoked?: boolean
  archived?: boolean
  clock_rollback?: boolean
}

export type LeaseRecordInput = Omit<
  LeaseRecord,
  'schema' | 'scope' | 'user_id' | 'deployment_id' | 'organization_id' | 'workspace_id'
> & {
  schema?: number
  scope?: Partial<LeaseScope>
  user_id?: string
  deployment_id?: string
  organization_id?: string
  workspace_id?: string
}

export function isLeaseLevel(value: unknown): value is LeaseLevel {
  return value === 'view' || value === 'edit'
}

export function compareLeaseRevision(a: string, b: string): -1 | 0 | 1 {
  return compareRevision(a, b)
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  return Number.isFinite(Date.parse(value))
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isSafeIntAtLeast(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value) && isStoreSegment(value)
}

function resolveScopeField(
  topLevel: unknown,
  nested: unknown,
): string | null {
  if (topLevel !== undefined && nested !== undefined && topLevel !== nested) {
    return null
  }
  const candidate = nested ?? topLevel
  return isValidId(candidate) ? candidate : null
}

export function parseLeaseRecord(raw: unknown): LeaseRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>

  const schema = r.schema ?? r.v
  if (schema !== LEASE_RECORD_SCHEMA) return null
  if (r.schema !== undefined && r.schema !== LEASE_RECORD_SCHEMA) return null
  if (r.v !== undefined && r.v !== LEASE_RECORD_SCHEMA) return null

  if (typeof r.lease !== 'string' || r.lease.trim().length === 0) return null
  if (!isValidId(r.lease_id)) return null
  if (!isSafeIntAtLeast(r.generation, 1)) return null
  if (!isValidIsoTimestamp(r.expires_at)) return null
  if (!isValidIsoTimestamp(r.renew_after)) return null
  if (r.issued_at !== undefined && !isValidIsoTimestamp(r.issued_at)) return null
  if (!isLeaseLevel(r.level)) return null
  if (typeof r.version_id !== 'string' || r.version_id.trim().length === 0 || !ID.test(r.version_id)) {
    return null
  }
  if (!isSafeIntAtLeast(r.version, 0)) return null
  if (typeof r.revision !== 'string' || !REVISION.test(r.revision)) return null
  if (!isValidId(r.document_id)) return null

  const rawScope =
    r.scope && typeof r.scope === 'object' && !Array.isArray(r.scope)
      ? (r.scope as Record<string, unknown>)
      : undefined
  if (r.scope !== undefined && !rawScope) return null

  const user_id = resolveScopeField(r.user_id, rawScope?.user_id)
  const deployment_id = resolveScopeField(r.deployment_id, rawScope?.deployment_id)
  const organization_id = resolveScopeField(r.organization_id, rawScope?.organization_id)
  const workspace_id = resolveScopeField(r.workspace_id, rawScope?.workspace_id)
  if (!user_id || !deployment_id || !organization_id || !workspace_id) return null

  if (!isNonNegativeNumber(r.server_time_at_receipt)) return null
  if (!isNonNegativeNumber(r.monotonic_at_receipt)) return null
  if (!isNonNegativeNumber(r.max_wall_clock_seen)) return null

  if (r.policy_epoch !== undefined && !isSafeIntAtLeast(r.policy_epoch, 0)) return null
  if (r.revoked !== undefined && typeof r.revoked !== 'boolean') return null
  if (r.archived !== undefined && typeof r.archived !== 'boolean') return null
  if (r.clock_rollback !== undefined && typeof r.clock_rollback !== 'boolean') return null

  const scope: LeaseScope = {
    user_id,
    deployment_id,
    organization_id,
    workspace_id,
  }

  return {
    schema: LEASE_RECORD_SCHEMA,
    lease: r.lease,
    lease_id: r.lease_id,
    generation: r.generation,
    expires_at: r.expires_at,
    renew_after: r.renew_after,
    ...(r.issued_at !== undefined ? { issued_at: r.issued_at } : {}),
    level: r.level,
    version_id: r.version_id,
    version: r.version,
    revision: r.revision,
    document_id: r.document_id,
    user_id,
    deployment_id,
    organization_id,
    workspace_id,
    scope,
    server_time_at_receipt: r.server_time_at_receipt,
    monotonic_at_receipt: r.monotonic_at_receipt,
    max_wall_clock_seen: r.max_wall_clock_seen,
    ...(r.policy_epoch !== undefined ? { policy_epoch: r.policy_epoch } : {}),
    ...(r.revoked !== undefined ? { revoked: r.revoked } : {}),
    ...(r.archived !== undefined ? { archived: r.archived } : {}),
    ...(r.clock_rollback !== undefined ? { clock_rollback: r.clock_rollback } : {}),
  }
}

export function encodeLeaseRecord(input: LeaseRecordInput): Uint8Array {
  const validated = parseLeaseRecord({
    ...input,
    schema: input.schema ?? LEASE_RECORD_SCHEMA,
  })
  if (!validated) {
    throw new Error('invalid offline lease record')
  }
  return new TextEncoder().encode(JSON.stringify(validated))
}

export function decodeLeaseRecord(bytes: Uint8Array): LeaseRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  return parseLeaseRecord(parsed)
}
