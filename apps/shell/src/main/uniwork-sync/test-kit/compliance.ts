import { randomBytes } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SafeStorageLike } from '../../uniwork-auth/credentials'
import type { StoreScope } from '../keys'
import { APP_STORE_LEVEL } from '../store-level'
import {
  RECORD_IV_BYTES,
  RECORD_TAG_BYTES,
  encodeRecord,
  recordPath,
  scopeDir,
  type RecordHeader,
  type StoreLayer,
  type StoreRecords,
  type StoreRegistration,
} from '../store'

/**
 * The compliance contract every registered store has to hold: a sign-out or
 * account switch locks the open handles and wipes the scope's plaintext, a
 * record of any level outside this build's window is refused (and kept), the
 * per-account budget is accounted in encrypted bytes, and a write in flight at
 * sign-out resolves interrupted with nothing readable left behind.
 *
 * A store's test calls runStoreCompliance(name, makeStore) once. makeStore
 * builds a layer over `env.root` with `env.budgetBytes`, a wrapped key provider
 * over `env.safeStorage` and `env.keyDir`, registers the store and returns it
 * opened for `env.scope`. It is called again (with the same env) to re-open the
 * scope after a wipe; each call must build a fresh layer so the reopen
 * simulates a restart.
 */

export interface LockableSafeStorage extends SafeStorageLike {
  /** the keyring is there but refuses to open or wrap keys (locked keychain) */
  lock(): void
  unlock(): void
}

/** a reversible stand-in for DPAPI/Keychain that can be locked at runtime */
export function createLockableSafeStorage(): LockableSafeStorage {
  let locked = false
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => {
      if (locked) throw new Error('keychain access denied')
      return Buffer.from(`ENC1${Buffer.from(text).toString('base64')}`.split('').reverse().join(''))
    },
    decryptString: (buf) => {
      if (locked) throw new Error('keychain access denied')
      const raw = buf.toString().split('').reverse().join('')
      if (!raw.startsWith('ENC1')) throw new Error('bad ciphertext')
      return Buffer.from(raw.slice(4), 'base64').toString()
    },
    lock: () => {
      locked = true
    },
    unlock: () => {
      locked = false
    },
  }
}

export interface ComplianceEnv {
  /** fixed for the whole block, so a reopen targets the same account */
  scope: StoreScope
  /** the layer root (real fs); the kit owns it and cleans it up */
  root: string
  /** where the wrapped keys live (beside the root, never inside it) */
  keyDir: string
  safeStorage: LockableSafeStorage
  clock: () => number
  /** the kit sets this per case; the factory must build the layer with it */
  budgetBytes: number
}

export interface ComplianceSubject {
  registration: StoreRegistration
  layer: StoreLayer
  scope: StoreScope
  /** the store's namespace, opened for `scope` */
  records: StoreRecords
}

export type ComplianceStoreFactory = (env: ComplianceEnv) => Promise<ComplianceSubject>

const readValue = async (records: StoreRecords, key: string): Promise<Buffer | null> => {
  const read = await records.read(key)
  return read.kind === 'ok' ? Buffer.from(read.value) : null
}

const listFilesUnder = (root: string): string[] => {
  const found: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else found.push(path)
    }
  }
  try {
    visit(root)
  } catch {
    return []
  }
  return found
}

const directoryBytes = (root: string): number =>
  listFilesUnder(root).reduce((total, path) => total + statSync(path).size, 0)

const filesContaining = (root: string, needle: Buffer): string[] =>
  listFilesUnder(root).filter((path) => readFileSync(path).includes(needle))

/** the encoded size of one record of `registration` with a value of `size` bytes */
const encodedSize = (registration: StoreRegistration, size: number): number =>
  encodeRecord(
    { schema: registration.schema, min_store_level: registration.minStoreLevel },
    Buffer.alloc(RECORD_IV_BYTES),
    Buffer.alloc(RECORD_TAG_BYTES),
    Buffer.alloc(size),
  ).length

export function runStoreCompliance(
  name: string,
  makeStore: ComplianceStoreFactory,
  options: { budgetBytes?: number } = {},
): void {
  const budget = options.budgetBytes ?? 4096

  describe(`${name} — store compliance`, () => {
    // everything but the budget case gets room to spare
    const roomy = Math.max(budget * 64, 1 << 20)
    let base: string
    let safeStorage: LockableSafeStorage
    let ticks = 0

    beforeEach(() => {
      base = mkdtempSync(join(tmpdir(), 'uniwork-store-compliance-'))
      safeStorage = createLockableSafeStorage()
      ticks = 0
    })
    afterEach(() => {
      rmSync(base, { recursive: true, force: true })
    })

    const envFor = (budgetBytes: number): ComplianceEnv => ({
      scope: { deploymentId: 'compliance-deployment', accountId: 'compliance-account' },
      root: join(base, 'records'),
      keyDir: join(base, 'keys'),
      safeStorage,
      clock: () => 1_700_000_000_000 + ticks++,
      budgetBytes,
    })

    const scopeFiles = (env: ComplianceEnv): string[] =>
      listFilesUnder(scopeDir(env.root, env.scope))

    /** a record with a valid header and undecryptable bytes, as another build would leave */
    const forge = (
      env: ComplianceEnv,
      subject: ComplianceSubject,
      key: string,
      header: RecordHeader,
    ): string => {
      const path = recordPath(env.root, subject.scope, subject.registration.name, key)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(
        path,
        encodeRecord(
          header,
          Buffer.alloc(RECORD_IV_BYTES),
          Buffer.alloc(RECORD_TAG_BYTES),
          Buffer.from('not decryptable'),
        ),
      )
      return path
    }

    it('writes a record and reads it back without plaintext at rest', async () => {
      const env = envFor(roomy)
      const subject = await makeStore(env)
      const marker = randomBytes(24)
      expect(await subject.records.write('k1', marker)).toEqual({ kind: 'ok' })
      expect(await readValue(subject.records, 'k1')).toEqual(marker)
      expect(filesContaining(env.root, marker)).toEqual([])
    })

    it('a sign-out locks every handle and wipes the scope', async () => {
      const env = envFor(roomy)
      const subject = await makeStore(env)
      const marker = randomBytes(24)
      expect(await subject.records.write('k1', marker)).toEqual({ kind: 'ok' })
      await subject.layer.lockAndWipe(subject.scope)
      expect(await subject.records.read('k1')).toEqual({ kind: 'interrupted' })
      expect(await subject.records.write('k2', marker)).toEqual({ kind: 'interrupted' })
      expect((await subject.layer.usage(subject.scope)).bytes).toBe(0)
      expect(scopeFiles(env)).toEqual([])
      expect(filesContaining(env.root, marker)).toEqual([])
      // signing back in opens an empty scope
      const reopened = await makeStore(env)
      expect(await reopened.records.read('k1')).toEqual({ kind: 'missing' })
    })

    it('an account switch locks only the switched-out scope', async () => {
      const env = envFor(roomy)
      const subject = await makeStore(env)
      const otherScope = { ...subject.scope, accountId: 'compliance-other-account' }
      const opened = await subject.layer.open(otherScope)
      if (opened.kind !== 'ok') throw new Error(`other scope did not open: ${opened.kind}`)
      const other = opened.store.records(subject.registration.name)
      const mine = randomBytes(24)
      const theirs = randomBytes(24)
      expect(await subject.records.write('mine', mine)).toEqual({ kind: 'ok' })
      expect(await other.write('theirs', theirs)).toEqual({ kind: 'ok' })
      await subject.layer.lockAndWipe(subject.scope)
      expect(await subject.records.read('mine')).toEqual({ kind: 'interrupted' })
      // the other account keeps its state and its live handle
      expect(await readValue(other, 'theirs')).toEqual(theirs)
      expect((await subject.layer.usage(otherScope)).bytes).toBeGreaterThan(0)
    })

    it('refuses a record that requires a newer store level and keeps it', async () => {
      const env = envFor(roomy)
      const subject = await makeStore(env)
      const path = forge(env, subject, 'from-newer-build', {
        schema: subject.registration.schema,
        min_store_level: APP_STORE_LEVEL + 1,
      })
      expect(await subject.records.read('from-newer-build')).toEqual({ kind: 'refused' })
      // the record is left alone: the build that wrote it still owns it
      expect(readFileSync(path).length).toBeGreaterThan(0)
    })

    it('refuses a record older than the store minimum', async () => {
      const env = envFor(roomy)
      const subject = await makeStore(env)
      forge(env, subject, 'from-older-store', {
        schema: subject.registration.schema,
        min_store_level: subject.registration.minStoreLevel - 1,
      })
      expect(await subject.records.read('from-older-store')).toEqual({ kind: 'refused' })
    })

    it('counts the budget in encrypted bytes and refuses past it', async () => {
      const env = envFor(budget)
      const subject = await makeStore(env)
      const valueSize = Math.max(16, Math.floor(budget / 4))
      const value = Buffer.alloc(valueSize, 3)
      const next = encodedSize(subject.registration, valueSize)
      let refused = false
      for (let index = 0; index < 64; index += 1) {
        const result = await subject.records.write(`k${index}`, value)
        if (result.kind === 'store_full') {
          refused = true
          break
        }
        expect(result).toEqual({ kind: 'ok' })
      }
      expect(refused).toBe(true)
      const used = (await subject.layer.usage(subject.scope)).bytes
      expect(used).toBe(directoryBytes(scopeDir(env.root, env.scope)))
      expect(used).toBeLessThanOrEqual(budget)
      // the refusal was exact: the next record would have crossed the budget
      expect(used + next).toBeGreaterThan(budget)
      // replacing a record with a smaller one fits again
      expect(await subject.records.write('k0', Buffer.from('x'))).toEqual({ kind: 'ok' })
      expect((await subject.layer.usage(subject.scope)).bytes).toBeLessThanOrEqual(budget)
    })

    it('a write in flight at sign-out resolves interrupted and leaves nothing readable', async () => {
      const env = envFor(roomy)
      const subject = await makeStore(env)
      const marker = randomBytes(24)
      const pending = subject.records.write('inflight', marker)
      await subject.layer.lockAndWipe(subject.scope)
      expect(await pending).toEqual({ kind: 'interrupted' })
      expect(scopeFiles(env)).toEqual([])
      expect(filesContaining(env.root, marker)).toEqual([])
      const reopened = await makeStore(env)
      expect(await reopened.records.read('inflight')).toEqual({ kind: 'missing' })
    })
  })
}
