import type { Binding } from '../../uniwork-docs/binding-store'
import type { SyncStoreAccess } from '../session-store'
import { APP_STORE_LEVEL } from '../store-level'
import type { StoreRecords, StoreRegistration } from '../store'

/**
 * Parked working copies (G5-11): when an account signs out or switches away,
 * each dirty working copy whose N+1 bytes are not already captured in `intents`
 * is encrypted into one record per `documentKey` (full binding.json value +
 * bytes + timestamp) before the plaintext working-copy folder is removed. On
 * same-account sign-in the caller restores each parked copy atomically, checks
 * its sha256, and removes the parked record.
 */

export const PARKED_STORE_REGISTRATION: StoreRegistration = {
  name: 'parked',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

export interface ParkedCopy {
  documentKey: string
  /** full binding.json value */
  binding: Binding
  bytes: Uint8Array
  parkedAt: string
}

export type ParkedWriteResult = 'ok' | 'store_full' | 'keystore_locked' | 'interrupted'

export interface ParkedStore {
  /** one record per documentKey, atomic */
  park(copy: ParkedCopy): Promise<ParkedWriteResult>
  /** document keys */
  list(): Promise<string[]>
  /** read; caller deletes after the restore is durable */
  take(documentKey: string): Promise<ParkedCopy | null>
  remove(documentKey: string): Promise<void>
}

export function createParkedStore(
  _source: StoreRecords | Pick<SyncStoreAccess, 'open'>,
): ParkedStore {
  return {
    async park(_copy) {
      throw new Error('not implemented')
    },
    async list() {
      throw new Error('not implemented')
    },
    async take(_documentKey) {
      throw new Error('not implemented')
    },
    async remove(_documentKey) {
      throw new Error('not implemented')
    },
  }
}
