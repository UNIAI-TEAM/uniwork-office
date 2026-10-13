import { APP_STORE_LEVEL } from '../store-level'
import type { StoreRecords, StoreRegistration, StoreWriteResult } from '../store'

/**
 * The durable "pause sending" flag (EXPERIENCE › Pause/resume gửi, :121). It is
 * per account - the store scope IS the account boundary ({deploymentId,
 * accountId}) - and survives a restart until the user resumes: "Tạm dừng gửi"
 * only stops dispatching new intents, it deletes nothing.
 */

export const PAUSE_STORE_REGISTRATION: StoreRegistration = {
  name: 'pause',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

/** the one record of the scope */
const PAUSE_KEY = 'paused'

export interface PauseStore {
  isPaused(): Promise<boolean>
  setPaused(paused: boolean): Promise<StoreWriteResult>
}

export function createPauseStore(records: StoreRecords): PauseStore {
  return {
    async isPaused() {
      const read = await records.read(PAUSE_KEY)
      if (read.kind !== 'ok') return false
      return new TextDecoder().decode(read.value) === 'paused'
    },
    async setPaused(paused) {
      return records.write(PAUSE_KEY, new TextEncoder().encode(paused ? 'paused' : 'resumed'))
    },
  }
}
