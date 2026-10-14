import { createHash, randomBytes } from 'node:crypto'
import * as nodeFs from 'node:fs/promises'
import { join } from 'node:path'
import type { StoreScope } from './keys'
import { QUEUE_LIMITS } from './queue/limits'
import { scopeDir } from './store/paths'

/**
 * The per-document lock of the durable save queue (EXPERIENCE - Second-window
 * bar, :129). One window at a time may edit a document; the other windows open
 * it read-only. The lock is a lease file per document under the account store
 * root - `<scopeDir(root, scope)>/doc-locks/<sha256(docKey)>.lock` - holding
 * `{owner, generation, heartbeatAt}` as JSON, so no file name and no document
 * title is ever written in plaintext.
 *
 * The holder beats every `heartbeatMs` (the caller drives the timer) and the
 * lease is stale after `goneMs` (three missed beats), so a crashed or hung
 * window is taken over: the new holder writes `generation + 1`, and the old
 * holder - whose `check`/`heartbeat` now see a generation it does not own -
 * goes read-only and never deletes the new lock. Every replace is an atomic
 * temp-file publish (fsync + rename); a fresh lease is an exclusive create, so
 * two windows racing the same `acquire` leave exactly one holder. There are no
 * timers in here: the caller drives the heartbeat, and `fs` and `clock` are
 * injectable for deterministic tests.
 */

/** the lease record written to disk; opaque owner, generation, last beat */
interface DocLease {
  owner: string
  generation: number
  heartbeatAt: number
}

export type DocLockResult = { kind: 'held'; generation: number } | { kind: 'other_window' }

/**
 * What the lock needs from a filesystem. The default is node's; tests inject an
 * in-memory one to race acquires and to freeze the clock.
 */
export interface DocLockFs {
  mkdir(path: string): Promise<void>
  readFile(path: string): Promise<string>
  /** write a (unique) temp file; the caller publishes it with `rename` */
  writeFile(path: string, data: string): Promise<void>
  /** create `path` only if it does not exist; `EEXIST` when another writer won */
  writeFileExclusive(path: string, data: string): Promise<void>
  /** open + fsync + close the file; a filesystem that refuses the flush is tolerated */
  syncFile(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
}

export interface DocLockOptions {
  /** the store root the account scope lives under */
  root: string
  /** the account boundary the lease belongs to */
  scope: StoreScope
  /** the wall clock the lease is stamped and judged with */
  clock: () => number
  fs?: Partial<DocLockFs>
  /** an opaque holder identity the caller passes (e.g. `${pid}:${windowId}`) */
  owner: string
  /** the stale window; defaults to the signed queue limits */
  limits?: Pick<typeof QUEUE_LIMITS, 'goneMs'>
}

export interface DocLock {
  acquire(docKey: string): Promise<DocLockResult>
  /** refresh the lease when it is still ours; false means we lost it */
  heartbeat(docKey: string, generation: number): Promise<boolean>
  /** true only while the lease still has our owner and this generation */
  check(docKey: string, generation: number): Promise<boolean>
  /** delete the lease only when owner and generation still match */
  release(docKey: string, generation: number): Promise<void>
}

const LOCK_DIR = 'doc-locks'
const LOCK_SUFFIX = '.lock'
/** bounded retries when a racing writer keeps winning the publish */
const MAX_ATTEMPTS = 8
const TOLERATED_SYNC_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EINVAL', 'ENOSYS'])

const defaultFs: DocLockFs = {
  mkdir: async (path) => {
    await nodeFs.mkdir(path, { recursive: true, mode: 0o700 })
  },
  readFile: (path) => nodeFs.readFile(path, 'utf8'),
  writeFile: async (path, data) => {
    await nodeFs.writeFile(path, data, { encoding: 'utf8', mode: 0o600 })
  },
  writeFileExclusive: async (path, data) => {
    await nodeFs.writeFile(path, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  },
  syncFile: async (path) => {
    let handle: nodeFs.FileHandle
    try {
      handle = await nodeFs.open(path, 'r')
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
  rename: (from, to) => nodeFs.rename(from, to),
  unlink: (path) => nodeFs.unlink(path),
}

type LeaseRead = { kind: 'missing' } | { kind: 'ok'; lease: DocLease } | { kind: 'corrupt' }

function isLease(value: unknown): value is DocLease {
  if (typeof value !== 'object' || value === null) return false
  const lease = value as Record<string, unknown>
  return (
    typeof lease.owner === 'string' &&
    Number.isSafeInteger(lease.generation) &&
    (lease.generation as number) >= 1 &&
    typeof lease.heartbeatAt === 'number' &&
    Number.isFinite(lease.heartbeatAt)
  )
}

export function createDocLock(options: DocLockOptions): DocLock {
  const fs: DocLockFs = { ...defaultFs, ...options.fs }
  const owner = options.owner
  const clock = options.clock
  const goneMs = (options.limits ?? QUEUE_LIMITS).goneMs
  const lockDir = join(scopeDir(options.root, options.scope), LOCK_DIR)

  const leasePathOf = (docKey: string): string =>
    join(lockDir, `${createHash('sha256').update(docKey, 'utf8').digest('hex')}${LOCK_SUFFIX}`)

  /** a missing file, a readable lease, or bytes we cannot trust (taken over as stale) */
  const readLease = async (path: string): Promise<LeaseRead> => {
    let raw: string
    try {
      raw = await fs.readFile(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
      throw error
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      return isLease(parsed) ? { kind: 'ok', lease: parsed } : { kind: 'corrupt' }
    } catch {
      return { kind: 'corrupt' }
    }
  }

  /** publish a lease over its path: fsync'd temp file, then an atomic rename */
  const writeLease = async (path: string, lease: DocLease): Promise<void> => {
    await fs.mkdir(lockDir)
    const tmp = join(lockDir, `.${randomBytes(6).toString('hex')}.tmp`)
    try {
      await fs.writeFile(tmp, JSON.stringify(lease))
      await fs.syncFile(tmp)
      await fs.rename(tmp, path)
    } catch (error) {
      await fs.unlink(tmp).catch(() => {})
      throw error
    }
  }

  /** a fresh lease is an exclusive create, so a racing writer is refused by the OS */
  const createLease = async (path: string, lease: DocLease): Promise<boolean> => {
    await fs.mkdir(lockDir)
    try {
      await fs.writeFileExclusive(path, JSON.stringify(lease))
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
  }

  const holds = (lease: DocLease, generation: number): boolean =>
    lease.owner === owner && lease.generation === generation

  return {
    async acquire(docKey) {
      const path = leasePathOf(docKey)
      const now = clock()
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const read = await readLease(path)
        if (read.kind === 'ok') {
          const { lease } = read
          // another owner's fresh lease: this window opens the document read-only
          if (lease.owner !== owner && now - lease.heartbeatAt <= goneMs) {
            return { kind: 'other_window' }
          }
        }
        const current = read.kind === 'ok' ? read.lease : null
        // a take-over bumps the generation; re-acquiring our own lease keeps it
        const generation =
          current === null
            ? 1
            : current.owner === owner
              ? current.generation
              : current.generation + 1
        const lease: DocLease = { owner, generation, heartbeatAt: now }
        if (read.kind === 'missing') {
          if (!(await createLease(path, lease))) continue
        } else {
          await writeLease(path, lease)
        }
        // re-read and confirm: a racing writer that won the publish wins
        const confirmed = await readLease(path)
        if (confirmed.kind === 'ok' && holds(confirmed.lease, generation)) {
          return { kind: 'held', generation }
        }
      }
      // the racing writer kept winning: report whatever actually settled
      const settled = await readLease(path)
      if (settled.kind === 'ok' && settled.lease.owner === owner) {
        return { kind: 'held', generation: settled.lease.generation }
      }
      return { kind: 'other_window' }
    },

    async heartbeat(docKey, generation) {
      const path = leasePathOf(docKey)
      const current = await readLease(path)
      if (current.kind !== 'ok' || !holds(current.lease, generation)) return false
      await writeLease(path, { owner, generation, heartbeatAt: clock() })
      return true
    },

    async check(docKey, generation) {
      const current = await readLease(leasePathOf(docKey))
      return current.kind === 'ok' && holds(current.lease, generation)
    },

    async release(docKey, generation) {
      const path = leasePathOf(docKey)
      const current = await readLease(path)
      // never delete someone else's newer lock
      if (current.kind !== 'ok' || !holds(current.lease, generation)) return
      try {
        await fs.unlink(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    },
  }
}
