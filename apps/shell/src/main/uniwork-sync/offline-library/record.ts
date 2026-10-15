import { ID } from '../feed/http'
import { isStoreSegment } from '../keys'
import type { LeaseEffectiveState } from '../lease/manager'
import { parseManifest, type PinManifest } from './manifest'

/**
 * One pinned document of the offline library (G5-05), schema-versioned. The
 * row keeps what was asked (`manifest`, the head last seen), what is held
 * (`readyManifest` + `readyGeneration`, the verified committed copy) and the
 * staging blobs of a download in flight, so a crash or a failure can always
 * name - and delete - every byte the pin owns. Any malformed or newer-schema
 * record is refused (null).
 */

export const PIN_RECORD_SCHEMA = 1

/** every state an S3 row can show (EXPERIENCE › Offline library rows) */
export const PIN_ROW_STATES = [
  'waiting-network',
  'downloading',
  'verifying',
  'ready',
  'update-available',
  'update-kept',
  'interrupted',
  'disk-full',
  'corrupt',
  'lease-expiring',
  'lease-expired',
  'locked',
  'revoked',
  'deleted',
  'archived',
  'moved',
  'view-only',
] as const

export type PinRowState = (typeof PIN_ROW_STATES)[number]

/** the states a row stores itself; the rest are derived from flags and the lease */
export type PinBaseState =
  | 'waiting-network'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'interrupted'
  | 'disk-full'
  | 'corrupt'
  | 'revoked'
  | 'deleted'

const BASE_STATES: ReadonlySet<string> = new Set<PinBaseState>([
  'waiting-network',
  'downloading',
  'verifying',
  'ready',
  'interrupted',
  'disk-full',
  'corrupt',
  'revoked',
  'deleted',
])

/**
 * S3 priority, highest first: revoked/deleted > lease-expired/locked >
 * disk-full/corrupt > interrupted > downloading/verifying > lease-expiring >
 * update-available/update-kept > waiting-network > archived/moved >
 * ready/view-only.
 */
export const S3_PRIORITY: readonly PinRowState[] = [
  'revoked',
  'deleted',
  'lease-expired',
  'locked',
  'disk-full',
  'corrupt',
  'interrupted',
  'downloading',
  'verifying',
  'lease-expiring',
  'update-available',
  'update-kept',
  'waiting-network',
  'archived',
  'moved',
  // same tier: a view-only lease is what a ready row of it shows
  'view-only',
  'ready',
]

export interface PinProgress {
  receivedBytes: number
  totalBytes: number
}

export interface PinStaging {
  generation: string
  /** every store key the staging may have written */
  keys: string[]
}

export interface PinRecord {
  schema: 1
  documentId: string
  scope: { orgId: string; workspaceId: string }
  /** the snapshot asked for: the head last seen (null while it was never read) */
  manifest: PinManifest | null
  /** the verified committed copy, or null */
  readyManifest: PinManifest | null
  readyGeneration: string | null
  readyVersion: number | null
  state: PinBaseState
  progress: PinProgress | null
  /** committed bytes (main + assets) */
  bytes: number
  pinnedAt: number
  lastVerifiedAt: number | null
  staging: PinStaging | null
  updateAvailable: boolean
  updateKept: boolean
  archived: boolean
  /** why the last download or open failed (a refusal code); kept for the row detail */
  failure?: string
}

const GENERATION = /^[0-9a-f]{8,64}$/

export function isGeneration(value: unknown): value is string {
  return typeof value === 'string' && GENERATION.test(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value) && isStoreSegment(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function manifestOrNull(raw: unknown): PinManifest | null | undefined {
  if (raw === null) return null
  return parseManifest(raw) ?? undefined
}

export function parsePinRecord(raw: unknown): PinRecord | null {
  if (!isRecord(raw)) return null
  if (raw.schema !== PIN_RECORD_SCHEMA) return null
  if (!isId(raw.documentId)) return null
  if (!isRecord(raw.scope) || !isId(raw.scope.orgId) || !isId(raw.scope.workspaceId)) return null
  const manifest = manifestOrNull(raw.manifest)
  const readyManifest = manifestOrNull(raw.readyManifest)
  if (manifest === undefined || readyManifest === undefined) return null
  if (raw.readyGeneration !== null && !isGeneration(raw.readyGeneration)) return null
  // a committed copy is its manifest and its generation, or neither
  if ((raw.readyGeneration === null) !== (readyManifest === null)) return null
  if (raw.readyVersion !== null && !isCount(raw.readyVersion)) return null
  if (typeof raw.state !== 'string' || !BASE_STATES.has(raw.state)) return null
  let progress: PinProgress | null = null
  if (raw.progress !== null) {
    if (!isRecord(raw.progress)) return null
    if (!isCount(raw.progress.receivedBytes) || !isCount(raw.progress.totalBytes)) return null
    progress = { receivedBytes: raw.progress.receivedBytes, totalBytes: raw.progress.totalBytes }
  }
  if (!isCount(raw.bytes) || !isCount(raw.pinnedAt)) return null
  if (raw.lastVerifiedAt !== null && !isCount(raw.lastVerifiedAt)) return null
  let staging: PinStaging | null = null
  if (raw.staging !== null) {
    if (!isRecord(raw.staging) || !isGeneration(raw.staging.generation)) return null
    const keys = raw.staging.keys
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) return null
    staging = { generation: raw.staging.generation, keys: [...(keys as string[])] }
  }
  if (typeof raw.updateAvailable !== 'boolean' || typeof raw.updateKept !== 'boolean') return null
  if (typeof raw.archived !== 'boolean') return null
  if (raw.failure !== undefined && typeof raw.failure !== 'string') return null
  return {
    schema: PIN_RECORD_SCHEMA,
    documentId: raw.documentId,
    scope: { orgId: raw.scope.orgId, workspaceId: raw.scope.workspaceId },
    manifest,
    readyManifest,
    readyGeneration: raw.readyGeneration as string | null,
    readyVersion: raw.readyVersion as number | null,
    state: raw.state as PinBaseState,
    progress,
    bytes: raw.bytes,
    pinnedAt: raw.pinnedAt,
    lastVerifiedAt: raw.lastVerifiedAt as number | null,
    staging,
    updateAvailable: raw.updateAvailable,
    updateKept: raw.updateKept,
    archived: raw.archived,
    ...(raw.failure !== undefined ? { failure: raw.failure } : {}),
  }
}

export function encodePinRecord(record: PinRecord): Uint8Array {
  const validated = parsePinRecord(record)
  if (!validated) throw new Error('invalid offline library pin record')
  return new TextEncoder().encode(JSON.stringify(validated))
}

export function decodePinRecord(bytes: Uint8Array): PinRecord | null {
  try {
    return parsePinRecord(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

/** the one state a row shows when several conditions hold (S3 priority) */
export function effectiveRowState(conditions: Iterable<PinRowState>): PinRowState {
  const held = new Set(conditions)
  for (const state of S3_PRIORITY) {
    if (held.has(state)) return state
  }
  return 'ready'
}

/** the lease part of a row: the subset of the lease manager's state a row reads */
export type RowLease = Pick<LeaseEffectiveState, 'state' | 'level'>

/** every condition of a row: its stored state and flags, and the document's lease */
export function rowConditions(record: PinRecord, lease: RowLease | null): PinRowState[] {
  const conditions: PinRowState[] = [record.state]
  if (record.updateAvailable) conditions.push('update-available')
  if (record.updateKept) conditions.push('update-kept')
  if (record.archived) conditions.push('archived')
  const held = record.readyGeneration !== null
  if (lease) {
    switch (lease.state) {
      case 'expiring_soon':
        conditions.push('lease-expiring')
        break
      case 'expired':
      case 'clock_rollback':
        conditions.push('lease-expired')
        break
      case 'revoked':
        conditions.push('revoked')
        break
      case 'locked':
      case 'keystore_locked':
      case 'keyring_unavailable':
        conditions.push('locked')
        break
      case 'none':
        // a committed copy with no lease behind it cannot be opened
        if (held) conditions.push('locked')
        break
      default:
        break
    }
    if (held && record.state === 'ready' && lease.level === 'view') conditions.push('view-only')
  }
  return conditions
}

/** the S3 state of one row */
export function rowStateOf(record: PinRecord, lease: RowLease | null): PinRowState {
  return effectiveRowState(rowConditions(record, lease))
}
