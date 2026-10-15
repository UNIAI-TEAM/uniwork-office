import { CredentialStoreError } from '../../uniwork-auth/credentials'
import { isStoreSegment, type StoreScope } from '../keys'
import type { SyncStoreAccess } from '../session-store'
import { APP_STORE_LEVEL } from '../store-level'
import type { StoreKeyStatus, StoreLayer, StoreRecords, StoreRegistration } from '../store'
import {
  LEASE_RECORD_SCHEMA,
  decodeLeaseRecord,
  encodeLeaseRecord,
  parseLeaseRecord,
  type LeaseRecord,
  type LeaseRecordInput,
} from './record'

/**
 * Durable offline-lease store (`offline-leases`, schema 1, APP_STORE_LEVEL).
 *
 * Every lease is stored in the encrypted store layer keyed by the account's
 * OS-keystore-wrapped key (GO-A5). Plaintext files are never written or read,
 * and paths outside the store namespace are refused.
 *
 * - Keystore locked -> every operation returns `{ kind: 'keystore_locked' }`
 *   with nothing written. No usable keyring at all (`keyring_unavailable`) and
 *   no signed-in session (`no_session`) are reported as they are, never folded
 *   into `keystore_locked` (a lock is transient, the other two are not).
 * - Store full -> `{ kind: 'store_full' }` with nothing written.
 * - Survives lock-and-keep: records stay encrypted on disk and become readable
 *   again once the keystore unlocks and the scope reopens.
 */

export const LEASE_STORE_REGISTRATION: StoreRegistration = {
  name: 'offline-leases',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

/** the store cannot be reached right now, and why */
export type LeaseStoreUnavailable =
  { kind: 'keystore_locked' } | { kind: 'keyring_unavailable' } | { kind: 'no_session' }

export type LeaseStoreReadResult =
  | { kind: 'ok'; record: LeaseRecord }
  | { kind: 'missing' }
  | { kind: 'refused' }
  | LeaseStoreUnavailable

export type LeaseStoreWriteResult =
  | { kind: 'ok'; record: LeaseRecord }
  | { kind: 'store_full' }
  | { kind: 'refused' }
  | LeaseStoreUnavailable

export type LeaseStoreDeleteResult = { kind: 'ok' } | LeaseStoreUnavailable

export interface LeaseStore {
  get(documentId: string): Promise<LeaseStoreReadResult>
  put(record: LeaseRecordInput): Promise<LeaseStoreWriteResult>
  delete(documentId: string): Promise<LeaseStoreDeleteResult>
}

export type LeaseStoreSource =
  | SyncStoreAccess
  | {
      layer: StoreLayer
      scope: StoreScope | (() => StoreScope | null)
    }
  | {
      records: StoreRecords
      scope?: StoreScope | (() => StoreScope | null)
      verifyKey?: () => Promise<StoreKeyStatus>
    }
  | StoreRecords

type ResolvedRecords =
  { kind: 'ok'; records: StoreRecords; scope: StoreScope | null } | LeaseStoreUnavailable

/** a key status that is not ok, as the store's unavailable outcome */
function unavailable(status: Exclude<StoreKeyStatus, 'ok'>): LeaseStoreUnavailable {
  return { kind: status }
}

function isSyncStoreAccess(source: LeaseStoreSource): source is SyncStoreAccess {
  return (
    typeof (source as SyncStoreAccess).open === 'function' &&
    typeof (source as SyncStoreAccess).scope === 'function' &&
    typeof (source as SyncStoreAccess).forget === 'function'
  )
}

function isLayerSource(
  source: LeaseStoreSource,
): source is { layer: StoreLayer; scope: StoreScope | (() => StoreScope | null) } {
  return (
    typeof (source as { layer?: unknown }).layer === 'object' &&
    (source as { layer?: unknown }).layer !== null
  )
}

function isDirectRecords(source: LeaseStoreSource): source is StoreRecords {
  return (
    typeof (source as StoreRecords).read === 'function' &&
    typeof (source as StoreRecords).write === 'function' &&
    typeof (source as StoreRecords).delete === 'function'
  )
}

function readScope(scope?: StoreScope | (() => StoreScope | null)): StoreScope | null {
  if (!scope) return null
  return typeof scope === 'function' ? scope() : scope
}

function matchesScope(record: LeaseRecord, scope: StoreScope | null): boolean {
  if (!scope) return true
  return record.deployment_id === scope.deploymentId && record.user_id === scope.accountId
}

export function createLeaseStore(source: LeaseStoreSource): LeaseStore {
  const resolve = async (): Promise<ResolvedRecords> => {
    try {
      if (isSyncStoreAccess(source)) {
        const currentScope = source.scope()
        if (!currentScope) return { kind: 'no_session' }
        const opened = await source.open()
        if (opened.kind !== 'ok') return { kind: opened.kind }
        return {
          kind: 'ok',
          records: opened.records(LEASE_STORE_REGISTRATION.name),
          scope: currentScope,
        }
      }
      if (isLayerSource(source)) {
        const currentScope = readScope(source.scope)
        if (!currentScope) return { kind: 'no_session' }
        const keyStatus = await source.layer.verifyKey(currentScope)
        if (keyStatus !== 'ok') return unavailable(keyStatus)
        const opened = await source.layer.open(currentScope)
        if (opened.kind !== 'ok') return { kind: opened.kind }
        return {
          kind: 'ok',
          records: opened.store.records(LEASE_STORE_REGISTRATION.name),
          scope: currentScope,
        }
      }
      if (isDirectRecords(source)) {
        return { kind: 'ok', records: source, scope: null }
      }
      if (source.verifyKey) {
        const status = await source.verifyKey()
        if (status !== 'ok') return unavailable(status)
      }
      return {
        kind: 'ok',
        records: source.records,
        scope: readScope(source.scope),
      }
    } catch (error) {
      if (error instanceof CredentialStoreError) {
        return {
          kind: error.code === 'keyring_unavailable' ? 'keyring_unavailable' : 'keystore_locked',
        }
      }
      throw error
    }
  }

  return {
    async get(documentId) {
      if (!isStoreSegment(documentId)) return { kind: 'refused' }
      const resolved = await resolve()
      if (resolved.kind !== 'ok') return resolved
      const read = await resolved.records.read(documentId)
      if (read.kind === 'interrupted') return { kind: 'keystore_locked' }
      if (read.kind === 'missing') return { kind: 'missing' }
      if (read.kind === 'refused' || read.kind === 'corrupt') return { kind: 'refused' }
      const record = decodeLeaseRecord(read.value)
      if (!record || record.document_id !== documentId || !matchesScope(record, resolved.scope)) {
        return { kind: 'refused' }
      }
      return { kind: 'ok', record }
    },

    async put(input) {
      const record = parseLeaseRecord({
        ...input,
        schema: input.schema ?? LEASE_RECORD_SCHEMA,
      })
      if (!record || !isStoreSegment(record.document_id)) {
        return { kind: 'refused' }
      }
      const resolved = await resolve()
      if (resolved.kind !== 'ok') return resolved
      if (!matchesScope(record, resolved.scope)) {
        return { kind: 'refused' }
      }
      const encoded = encodeLeaseRecord(record)
      const written = await resolved.records.write(record.document_id, encoded)
      if (written.kind === 'ok') return { kind: 'ok', record }
      if (written.kind === 'store_full') return { kind: 'store_full' }
      if (written.kind === 'interrupted') return { kind: 'keystore_locked' }
      return { kind: 'refused' }
    },

    async delete(documentId) {
      if (!isStoreSegment(documentId)) return { kind: 'ok' }
      const resolved = await resolve()
      if (resolved.kind !== 'ok') return resolved
      const deleted = await resolved.records.delete(documentId)
      if (deleted.kind === 'interrupted') return { kind: 'keystore_locked' }
      return { kind: 'ok' }
    },
  }
}
