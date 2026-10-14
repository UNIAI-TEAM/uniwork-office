import { randomBytes } from 'node:crypto'
import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { join } from 'node:path'
import { CredentialStoreError } from '../../uniwork-auth/credentials'
import { isStoreSegment, type StoreKeyProvider, type StoreScope } from '../keys'
import { APP_STORE_LEVEL } from '../store-level'
import { openRecord, readRecordFrame, recordHeaderOf, sealRecord, type RecordHeader } from './codec'
import { recordFileName, scopeDir } from './paths'

/**
 * The durable store layer. Every record is one AES-256-GCM file under
 * `<root>/<deploymentId>/<accountId>/<store>`, named by the hash of its record
 * key. Writes go to a fsync'd temp file published by a synchronous rename, so
 * a crash leaves the old or the new record, never a torn one, and the
 * per-account budget counts encrypted bytes: a write that would exceed it
 * resolves `store_full` and leaves nothing behind.
 *
 * `lockAndWipe(scope)` is the sign-out / account-switch boundary. It bumps the
 * scope's generation synchronously first - every handle and in-flight write of
 * that scope is dead from that instant - then removes the scope and waits for
 * in-flight writes to settle: they resolve `interrupted` and leave nothing
 * readable, never a half-written record.
 */

export interface StoreRegistration {
  /** the store's namespace segment under the scope directory */
  name: string
  /** the record schema this build writes; a record with a newer schema is refused */
  schema: number
  /** the store generation this store reads and writes (OQ-P4 b) */
  minStoreLevel: number
}

export type StoreWriteResult =
  { kind: 'ok' } | { kind: 'store_full' } | { kind: 'refused' } | { kind: 'interrupted' }

export type StoreReadResult =
  | { kind: 'ok'; value: Uint8Array }
  | { kind: 'missing' }
  | { kind: 'refused' }
  | { kind: 'corrupt' }
  | { kind: 'interrupted' }

export type StoreDeleteResult = { kind: 'ok' } | { kind: 'interrupted' }

export interface StoreRecords {
  write(key: string, value: Uint8Array): Promise<StoreWriteResult>
  read(key: string): Promise<StoreReadResult>
  delete(key: string): Promise<StoreDeleteResult>
  /** decrypted payloads of every readable record in the store namespace */
  values?(): Promise<Uint8Array[]>
}

/** one scope, opened: the registered stores are reachable by their name */
export interface OpenedStore {
  readonly scope: StoreScope
  records(name: string): StoreRecords
}

export type StoreOpenResult =
  { kind: 'ok'; store: OpenedStore } | { kind: 'keystore_locked' } | { kind: 'keyring_unavailable' }

/** whether a scope's record key can be produced right now */
export type StoreKeyStatus = 'ok' | 'keystore_locked' | 'keyring_unavailable'

export interface StoreUsage {
  /** encrypted bytes on disk for the whole account */
  bytes: number
  budgetBytes: number
}

/**
 * What the layer needs from a filesystem. The default is node's; tests inject
 * it to force a failing flush or rename.
 */
export interface StoreFs {
  mkdir(path: string, mode: number): Promise<void>
  writeFile(path: string, data: Uint8Array, mode: number): Promise<void>
  /** open + fsync + close the file; a filesystem that refuses the flush is tolerated */
  syncFile(path: string): Promise<void>
  /** the atomic publish step, deliberately synchronous so a wipe cannot interleave */
  renameSync(from: string, to: string): void
  rm(path: string): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  list(path: string): Promise<Array<{ name: string; directory: boolean }>>
  /** bytes of the file, null when it does not exist */
  size(path: string): Promise<number | null>
}

export interface StoreLayer {
  register(registration: StoreRegistration): void
  open(scope: StoreScope): Promise<StoreOpenResult>
  /**
   * Re-check that the scope's key can still be produced - an OS keychain that
   * relocked since `open` refuses here - without reading or writing records.
   * A caller holding an already-opened store asks this before every use, so a
   * cached handle never outlives the key it was built from.
   */
  verifyKey(scope: StoreScope): Promise<StoreKeyStatus>
  /**
   * Sign-out / switch: bump the epoch (every handle + in-flight write of scope
   * dead -> `interrupted`), wait for in-flight writes, drop RAM key material;
   * FILES STAY (ciphertext only). A later open() re-fetches the key and reads
   * everything.
   */
  lock(scope: StoreScope): Promise<void>
  /** close every handle of `scope` and wipe everything it kept on disk */
  lockAndWipe(scope: StoreScope): Promise<void>
  usage(scope: StoreScope): Promise<StoreUsage>
}

export interface StoreLayerOptions {
  root: string
  keys: StoreKeyProvider
  /** encrypted bytes the whole account may keep */
  budgetBytes: number
  clock: () => number
  fs?: Partial<StoreFs>
}

interface WalkEntry {
  path: string
  name: string
  directory: boolean
}

const TOLERATED_SYNC_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EINVAL', 'ENOSYS'])
const RENAME_RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_RETRIES = 4
const RENAME_RETRY_MS = 50
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const defaultFs: StoreFs = {
  mkdir: async (path, mode) => {
    await nodeFsPromises.mkdir(path, { recursive: true, mode })
  },
  writeFile: async (path, data, mode) => {
    await nodeFsPromises.writeFile(path, data, { mode })
  },
  syncFile: async (path) => {
    let handle: nodeFsPromises.FileHandle
    try {
      handle = await nodeFsPromises.open(path, 'r')
    } catch (error) {
      if (TOLERATED_SYNC_CODES.has((error as NodeJS.ErrnoException).code ?? '')) return
      throw error
    }
    try {
      await handle.sync()
    } catch (error) {
      if (!TOLERATED_SYNC_CODES.has((error as NodeJS.ErrnoException).code ?? '')) throw error
    } finally {
      await handle.close()
    }
  },
  renameSync: (from, to) => {
    nodeFs.renameSync(from, to)
  },
  rm: async (path) => {
    await nodeFsPromises.rm(path, { recursive: true, force: true })
  },
  readFile: (path) => nodeFsPromises.readFile(path),
  list: async (path) =>
    (await nodeFsPromises.readdir(path, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      directory: entry.isDirectory(),
    })),
  size: async (path) => {
    try {
      return (await nodeFsPromises.stat(path)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  },
}

export function createStoreLayer(options: StoreLayerOptions): StoreLayer {
  const fs: StoreFs = { ...defaultFs, ...options.fs }
  const root = options.root
  const keys = options.keys
  const budgetBytes = options.budgetBytes
  const clock = options.clock
  const registrations = new Map<string, StoreRegistration>()
  /** per scope: bumped by lockAndWipe; a handle holding an older value is dead */
  const epochs = new Map<string, number>()
  /** per scope: started writes that have not settled (lockAndWipe waits for them) */
  const inFlight = new Map<string, Set<Promise<unknown>>>()
  /** per scope: the write queue, so the budget is accounted one write at a time */
  const queues = new Map<string, Promise<unknown>>()

  const tokenOf = (scope: StoreScope) => `${scope.deploymentId}/${scope.accountId}`
  const epochOf = (token: string) => epochs.get(token) ?? 0

  const walk = async (dir: string): Promise<WalkEntry[]> => {
    const found: WalkEntry[] = []
    const visit = async (current: string): Promise<void> => {
      for (const entry of await fs.list(current)) {
        const path = join(current, entry.name)
        found.push({ path, name: entry.name, directory: entry.directory })
        if (entry.directory) await visit(path)
      }
    }
    await visit(dir)
    return found
  }

  const dirBytes = async (dir: string): Promise<number> => {
    try {
      let total = 0
      for (const entry of await walk(dir)) {
        if (!entry.directory) total += (await fs.size(entry.path)) ?? 0
      }
      return total
    } catch {
      // an unreadable scope holds nothing this build can account for
      return 0
    }
  }

  /** temp files are never readable state: a crash's leftovers are dropped at open */
  const scrubTemps = async (dir: string): Promise<void> => {
    try {
      for (const entry of await walk(dir)) {
        if (!entry.directory && entry.name.endsWith('.tmp')) await fs.rm(entry.path)
      }
    } catch {
      // a scope that cannot be listed has nothing to scrub
    }
  }

  /** the rename is only durable once the folder entry is flushed (POSIX only) */
  const syncDir = async (dir: string): Promise<void> => {
    if (process.platform === 'win32') return
    try {
      await fs.syncFile(dir)
    } catch {
      // the record is already visible; only power-loss durability weakens
    }
  }

  const enqueue = <T>(token: string, run: () => Promise<T>): Promise<T> => {
    const previous = queues.get(token) ?? Promise.resolve()
    const next = previous.then(run, run)
    const settled = next.then(
      () => undefined,
      () => undefined,
    )
    queues.set(token, settled)
    void settled.then(() => {
      if (queues.get(token) === settled) queues.delete(token)
    })
    const pending = inFlight.get(token) ?? new Set<Promise<unknown>>()
    inFlight.set(token, pending)
    pending.add(settled)
    void settled.then(() => {
      pending.delete(settled)
      if (pending.size === 0 && inFlight.get(token) === pending) inFlight.delete(token)
    })
    return next
  }

  /**
   * Publish a temp file over its record. The first attempt renames
   * synchronously, so between the caller's liveness check and the rename no
   * other task can run - a wipe either deletes the record right after, or the
   * rename sees the bumped generation and the temp file is dropped. Only a
   * filesystem refusing the replace (EPERM/EACCES/EBUSY) waits and retries.
   */
  const publish = async (live: () => boolean, from: string, to: string): Promise<boolean> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(from, to)
        return true
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? ''
        if (!RENAME_RETRYABLE.has(code) || attempt >= RENAME_RETRIES) throw error
        await sleep(RENAME_RETRY_MS * 2 ** attempt)
        if (!live()) {
          await fs.rm(from)
          return false
        }
      }
    }
  }

  /**
   * The record key of one scope, or why it cannot be produced right now. A
   * keyring that refuses the unwrap is a lock the caller retries later (or a
   * host with no usable keyring at all); anything else is the provider's bug
   * and is rethrown.
   */
  const fetchKey = async (
    scope: StoreScope,
  ): Promise<{ key: Buffer } | { kind: 'keystore_locked' } | { kind: 'keyring_unavailable' }> => {
    try {
      return { key: await keys.key(scope) }
    } catch (error) {
      if (error instanceof CredentialStoreError) {
        if (error.code === 'keystore_locked') return { kind: 'keystore_locked' }
        if (error.code === 'keyring_unavailable') return { kind: 'keyring_unavailable' }
      }
      throw error
    }
  }

  const recordsFor = (
    name: string,
    scope: StoreScope,
    token: string,
    scopePath: string,
    epoch: number,
    recordKey: Buffer,
  ): StoreRecords => {
    const registration = registrations.get(name)
    if (!registration) throw new Error(`store not registered: ${name}`)
    const storePath = join(scopePath, name)
    const live = () => epochOf(token) === epoch

    /** OQ-P4 (b) in both directions: only records inside this build's window are served */
    const withinWindow = (header: RecordHeader): boolean =>
      header.min_store_level >= registration.minStoreLevel &&
      header.min_store_level <= APP_STORE_LEVEL &&
      header.schema <= registration.schema

    return {
      async write(key, value) {
        if (!live()) return { kind: 'interrupted' }
        // a store that needs a level this build does not have never writes
        if (registration.minStoreLevel > APP_STORE_LEVEL) return { kind: 'refused' }
        return enqueue(token, async (): Promise<StoreWriteResult> => {
          if (!live()) return { kind: 'interrupted' }
          const dest = join(storePath, recordFileName(key))
          const header: RecordHeader = {
            schema: registration.schema,
            min_store_level: registration.minStoreLevel,
          }
          const encoded = sealRecord(recordKey, header, value)
          const existing = (await fs.size(dest)) ?? 0
          // the budget counts encrypted bytes across the account, replacing this key
          if ((await dirBytes(scopePath)) - existing + encoded.length > budgetBytes) {
            return { kind: 'store_full' }
          }
          await fs.mkdir(storePath, 0o700)
          const tmp = join(
            storePath,
            `.${recordFileName(key)}.${process.pid}.${clock()}.${randomBytes(4).toString('hex')}.tmp`,
          )
          try {
            await fs.writeFile(tmp, encoded, 0o600)
            await fs.syncFile(tmp)
          } catch (error) {
            // a wipe mid-flush takes the folder with it: that is the wipe's
            // interruption, not a filesystem failure to report
            if (!live()) return { kind: 'interrupted' }
            throw error
          }
          if (!live()) {
            await fs.rm(tmp)
            return { kind: 'interrupted' }
          }
          let published: boolean
          try {
            published = await publish(live, tmp, dest)
          } catch (error) {
            // the rename can fail because the wiped folder is gone
            if (!live()) return { kind: 'interrupted' }
            throw error
          }
          if (!published) return { kind: 'interrupted' }
          await syncDir(storePath)
          // the wipe may have landed since the rename: a record it removed is
          // never reported as written
          if (!live()) return { kind: 'interrupted' }
          return { kind: 'ok' }
        })
      },

      async read(key) {
        if (!live()) return { kind: 'interrupted' }
        let bytes: Uint8Array
        try {
          bytes = await fs.readFile(join(storePath, recordFileName(key)))
        } catch (error) {
          // a record the wipe removed was not a missing record
          if (!live()) return { kind: 'interrupted' }
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
          throw error
        }
        // the wipe may have landed while the read was suspended: never decrypt
        // (let alone hand back) plaintext of a scope that was locked and wiped
        if (!live()) return { kind: 'interrupted' }
        const frame = readRecordFrame(bytes)
        const header = frame ? recordHeaderOf(frame.header) : null
        if (!frame || !header) return { kind: 'corrupt' }
        // the gate reads the header only: a newer build's record is never decrypted
        if (!withinWindow(header)) return { kind: 'refused' }
        const value = openRecord(recordKey, frame)
        return value ? { kind: 'ok', value } : { kind: 'corrupt' }
      },

      async delete(key) {
        if (!live()) return { kind: 'interrupted' }
        return enqueue(token, async (): Promise<StoreDeleteResult> => {
          if (!live()) return { kind: 'interrupted' }
          try {
            await fs.rm(join(storePath, recordFileName(key)))
          } catch (error) {
            if (!live()) return { kind: 'interrupted' }
            throw error
          }
          if (!live()) return { kind: 'interrupted' }
          return { kind: 'ok' }
        })
      },
    }
  }

  return {
    register(registration) {
      if (!isStoreSegment(registration.name)) {
        throw new Error(`invalid store name: ${registration.name}`)
      }
      if (!Number.isSafeInteger(registration.schema) || registration.schema < 1) {
        throw new Error(`invalid store registration: ${registration.name}`)
      }
      if (!Number.isSafeInteger(registration.minStoreLevel) || registration.minStoreLevel < 1) {
        throw new Error(`invalid store registration: ${registration.name}`)
      }
      if (registrations.has(registration.name)) {
        throw new Error(`store already registered: ${registration.name}`)
      }
      registrations.set(registration.name, { ...registration })
    },

    async open(scope) {
      const scopePath = scopeDir(root, scope)
      const token = tokenOf(scope)
      // captured before the key is fetched: a wipe during open() leaves the
      // handle dead instead of live inside a wiped scope
      const epoch = epochOf(token)
      const fetched = await fetchKey(scope)
      if ('kind' in fetched) return fetched
      const recordKey = fetched.key
      await fs.mkdir(scopePath, 0o700)
      await scrubTemps(scopePath)
      const opened: StoreScope = { deploymentId: scope.deploymentId, accountId: scope.accountId }
      return {
        kind: 'ok',
        store: {
          scope: opened,
          records: (name) => recordsFor(name, opened, token, scopePath, epoch, recordKey),
        },
      }
    },

    async verifyKey(scope) {
      const fetched = await fetchKey(scope)
      return 'kind' in fetched ? fetched.kind : 'ok'
    },

    async lock(_scope) {
      throw new Error('not implemented')
    },

    async lockAndWipe(scope) {
      const scopePath = scopeDir(root, scope)
      const token = tokenOf(scope)
      // bump first, synchronously: no handle or in-flight write can publish
      // anything after this point
      epochs.set(token, epochOf(token) + 1)
      await fs.rm(scopePath)
      const started = [...(inFlight.get(token) ?? [])]
      // writes already past their entry check settle now (interrupted), and
      // may have recreated a folder on the way
      if (started.length > 0) await Promise.allSettled(started)
      await fs.rm(scopePath)
    },

    async usage(scope) {
      return { bytes: await dirBytes(scopeDir(root, scope)), budgetBytes }
    },
  }
}
