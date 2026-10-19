import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CredentialStoreError,
  type CredentialStoreErrorCode,
} from '../src/main/uniwork-auth/credentials'
import type { StoreKeyProvider } from '../src/main/uniwork-sync/keys'
import { APP_STORE_LEVEL } from '../src/main/uniwork-sync/store-level'
import {
  RECORD_IV_BYTES,
  RECORD_TAG_BYTES,
  createStoreLayer,
  encodeRecord,
  recordPath,
  scopeDir,
  type RecordHeader,
  type StoreLayer,
  type StoreLayerOptions,
  type StoreRecords,
} from '../src/main/uniwork-sync/store'

const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }
const CURSORS = { name: 'cursors', schema: 1, minStoreLevel: APP_STORE_LEVEL }
const KEY = Buffer.alloc(32, 7)

const keyProvider = (key: Buffer = KEY): StoreKeyProvider => ({ key: async () => key })

const rejectingKeys = (code: CredentialStoreErrorCode): StoreKeyProvider => ({
  key: async () => {
    throw new CredentialStoreError(code)
  },
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-sync-store-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeLayer(options: Partial<StoreLayerOptions> = {}): StoreLayer {
  const layer = createStoreLayer({
    root: dir,
    keys: keyProvider(),
    budgetBytes: 1 << 20,
    clock: () => 1_700_000_000_000,
    ...options,
  })
  layer.register(CURSORS)
  return layer
}

async function openRecords(layer: StoreLayer, name = CURSORS.name): Promise<StoreRecords> {
  const opened = await layer.open(SCOPE)
  if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
  return opened.store.records(name)
}

async function readValue(records: StoreRecords, key: string): Promise<Buffer | null> {
  const read = await records.read(key)
  return read.kind === 'ok' ? Buffer.from(read.value) : null
}

function listFilesUnder(root: string): string[] {
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

function dirBytes(root: string): number {
  return listFilesUnder(root).reduce((total, path) => total + statSync(path).size, 0)
}

function filesContaining(root: string, needle: Buffer): string[] {
  return listFilesUnder(root).filter((path) => readFileSync(path).includes(needle))
}

/** a record with a valid-looking header and undecryptable bytes, as another build would leave */
function forgeRecord(key: string, header: RecordHeader): string {
  const path = recordPath(dir, SCOPE, CURSORS.name, key)
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

/** the encoded size of one record of this store with a value of `size` bytes */
const recordBytes = (size: number): number =>
  encodeRecord(
    { schema: CURSORS.schema, min_store_level: CURSORS.minStoreLevel },
    Buffer.alloc(RECORD_IV_BYTES),
    Buffer.alloc(RECORD_TAG_BYTES),
    Buffer.alloc(size),
  ).length

describe('uniwork sync store layer', () => {
  it('writes a record into the scope namespace and reads it back encrypted', async () => {
    const records = await openRecords(makeLayer())
    const marker = Buffer.from('soạn thảo bí mật — secret marker')
    const key = 'deployment/org-1/ws-1'
    expect(await records.write(key, marker)).toEqual({ kind: 'ok' })
    const path = recordPath(dir, SCOPE, 'cursors', key)
    expect(path.startsWith(join(dir, 'dep_1', 'acc_1', 'cursors'))).toBe(true)
    expect(existsSync(path)).toBe(true)
    expect(await readValue(records, key)).toEqual(marker)
    // at rest the value is only ciphertext, never the plaintext bytes
    expect(readFileSync(path).includes(marker)).toBe(false)
    expect(filesContaining(dir, marker)).toEqual([])
  })

  it('encrypts each record with its own random IV', async () => {
    const records = await openRecords(makeLayer())
    await records.write('a', Buffer.from('same value'))
    await records.write('b', Buffer.from('same value'))
    const a = readFileSync(recordPath(dir, SCOPE, 'cursors', 'a'))
    const b = readFileSync(recordPath(dir, SCOPE, 'cursors', 'b'))
    expect(a.equals(b)).toBe(false)
  })

  it('replaces a record in place and leaves no temp file', async () => {
    const records = await openRecords(makeLayer())
    await records.write('k', Buffer.from('one'))
    await records.write('k', Buffer.from('two'))
    expect(listFilesUnder(join(dir, 'dep_1', 'acc_1', 'cursors'))).toHaveLength(1)
    expect(await readValue(records, 'k')).toEqual(Buffer.from('two'))
  })

  it('reports a missing record and deletes idempotently', async () => {
    const records = await openRecords(makeLayer())
    expect(await records.read('absent')).toEqual({ kind: 'missing' })
    expect(await records.delete('absent')).toEqual({ kind: 'ok' })
    await records.write('present', Buffer.from('x'))
    expect(await records.delete('present')).toEqual({ kind: 'ok' })
    expect(await records.read('present')).toEqual({ kind: 'missing' })
    expect(existsSync(recordPath(dir, SCOPE, 'cursors', 'present'))).toBe(false)
  })

  it('opens as keystore_locked or keyring_unavailable when the keyring is not usable', async () => {
    for (const code of ['keystore_locked', 'keyring_unavailable'] as const) {
      const layer = createStoreLayer({
        root: dir,
        keys: rejectingKeys(code),
        budgetBytes: 1 << 20,
        clock: () => 0,
      })
      layer.register(CURSORS)
      expect(await layer.open(SCOPE)).toEqual({ kind: code })
    }
    expect(listFilesUnder(dir)).toEqual([])
  })

  it('refuses a record that needs a newer store level and leaves it alone', async () => {
    const records = await openRecords(makeLayer())
    const path = forgeRecord('from-newer-build', {
      schema: CURSORS.schema,
      min_store_level: APP_STORE_LEVEL + 1,
    })
    expect(await records.read('from-newer-build')).toEqual({ kind: 'refused' })
    expect(existsSync(path)).toBe(true)
  })

  it('refuses a record older than the store minimum', async () => {
    const records = await openRecords(makeLayer())
    forgeRecord('from-older-store', {
      schema: CURSORS.schema,
      min_store_level: CURSORS.minStoreLevel - 1,
    })
    expect(await records.read('from-older-store')).toEqual({ kind: 'refused' })
  })

  it('refuses a record with a newer schema', async () => {
    const records = await openRecords(makeLayer())
    forgeRecord('newer-schema', {
      schema: CURSORS.schema + 1,
      min_store_level: CURSORS.minStoreLevel,
    })
    expect(await records.read('newer-schema')).toEqual({ kind: 'refused' })
  })

  it('refuses writes from a store registered at a newer level', async () => {
    const layer = makeLayer()
    layer.register({ name: 'future', schema: 1, minStoreLevel: APP_STORE_LEVEL + 1 })
    const records = await openRecords(layer, 'future')
    expect(await records.write('k', Buffer.from('x'))).toEqual({ kind: 'refused' })
    expect(listFilesUnder(join(dir, 'dep_1', 'acc_1', 'future'))).toEqual([])
  })

  it('reports a tampered record as corrupt and keeps the file', async () => {
    const records = await openRecords(makeLayer())
    await records.write('k', Buffer.from('value'))
    const path = recordPath(dir, SCOPE, 'cursors', 'k')
    const bytes = readFileSync(path)
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff
    writeFileSync(path, bytes)
    expect(await records.read('k')).toEqual({ kind: 'corrupt' })
    expect(existsSync(path)).toBe(true)
  })

  it('reports a record written under another key as corrupt', async () => {
    const records = await openRecords(makeLayer())
    await records.write('k', Buffer.from('value'))
    const other = makeLayer({ keys: keyProvider(Buffer.alloc(32, 9)) })
    expect(await readValue(await openRecords(other), 'k')).toBeNull()
    expect(await (await openRecords(other)).read('k')).toEqual({ kind: 'corrupt' })
  })

  it('counts the budget per account in encrypted bytes and refuses past it', async () => {
    const layer = makeLayer({ budgetBytes: 4096 })
    layer.register({ name: 'other', schema: 1, minStoreLevel: APP_STORE_LEVEL })
    const opened = await layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const records = opened.store.records('cursors')
    const other = opened.store.records('other')
    const value = Buffer.alloc(1024, 5)
    expect(await records.write('k0', value)).toEqual({ kind: 'ok' })
    expect(await records.write('k1', value)).toEqual({ kind: 'ok' })
    expect(await records.write('k2', value)).toEqual({ kind: 'ok' })
    // the fourth record would cross the budget: refused, and nothing is left behind
    expect(await records.write('k3', value)).toEqual({ kind: 'store_full' })
    const used = (await layer.usage(SCOPE)).bytes
    expect(used).toBe(3 * recordBytes(1024))
    expect(used).toBe(dirBytes(scopeDir(dir, SCOPE)))
    expect(used + recordBytes(1024)).toBeGreaterThan(4096)
    expect(existsSync(recordPath(dir, SCOPE, 'cursors', 'k3'))).toBe(false)
    // replacing a record with a smaller one fits again
    expect(await records.write('k0', Buffer.from('x'))).toEqual({ kind: 'ok' })
    expect((await layer.usage(SCOPE)).bytes).toBe(2 * recordBytes(1024) + recordBytes(1))
    // the budget is the account's, not the store's: the second store shares it
    expect(await other.write('o0', value)).toEqual({ kind: 'ok' })
    expect(await other.write('o1', value)).toEqual({ kind: 'store_full' })
  })

  it('a sign-out locks every handle and wipes the scope', async () => {
    const layer = makeLayer()
    const records = await openRecords(layer)
    await records.write('k1', Buffer.from('one'))
    await records.write('k2', Buffer.from('two'))
    await layer.lockAndWipe(SCOPE)
    expect(await records.read('k1')).toEqual({ kind: 'interrupted' })
    expect(await records.write('k3', Buffer.from('three'))).toEqual({ kind: 'interrupted' })
    expect(await records.delete('k1')).toEqual({ kind: 'interrupted' })
    expect((await layer.usage(SCOPE)).bytes).toBe(0)
    expect(listFilesUnder(scopeDir(dir, SCOPE))).toEqual([])
    // signing back in opens an empty scope that writes again
    const reopened = await openRecords(layer)
    expect(await reopened.read('k1')).toEqual({ kind: 'missing' })
    expect(await reopened.write('k4', Buffer.from('four'))).toEqual({ kind: 'ok' })
  })

  it('a write in flight at lockAndWipe resolves interrupted and leaves nothing readable', async () => {
    const layer = makeLayer()
    const records = await openRecords(layer)
    const marker = Buffer.from('in-flight secret')
    const pending = records.write('inflight', marker)
    await layer.lockAndWipe(SCOPE)
    expect(await pending).toEqual({ kind: 'interrupted' })
    expect(listFilesUnder(scopeDir(dir, SCOPE))).toEqual([])
    expect(filesContaining(dir, marker)).toEqual([])
    const reopened = await openRecords(layer)
    expect(await reopened.read('inflight')).toEqual({ kind: 'missing' })
  })

  it('scrubs temp files a crash left behind at open', async () => {
    const storePath = join(dir, 'dep_1', 'acc_1', 'cursors')
    mkdirSync(storePath, { recursive: true })
    writeFileSync(join(storePath, '.dead.rec.1.2.3.tmp'), Buffer.from('half written'))
    const records = await openRecords(makeLayer())
    expect(readdirSync(storePath)).toEqual([])
    expect(await records.read('anything')).toEqual({ kind: 'missing' })
  })

  it('retries the publish when the filesystem refuses the replace', async () => {
    let attempts = 0
    const layer = makeLayer({
      fs: {
        renameSync: (from, to) => {
          attempts += 1
          if (attempts === 1) throw Object.assign(new Error('locked'), { code: 'EPERM' })
          renameSync(from, to)
        },
      },
    })
    const records = await openRecords(layer)
    expect(await records.write('k', Buffer.from('value'))).toEqual({ kind: 'ok' })
    expect(attempts).toBe(2)
    expect(await readValue(records, 'k')).toEqual(Buffer.from('value'))
  })

  // B33 (UNI-1362): a real write failure (ENOSPC) used to leave the encrypted
  // temp file behind until the next scope scrub. The write drops the file it
  // owns, then rethrows the original error. R1-5: the writer must really create
  // the temp first (a throw-only writer never writes a byte, so the assertion
  // held with the cleanup removed), and a cleanup that itself fails must not
  // replace the primary error.
  it('a failed flush leaves no temp file behind and rethrows the original error', async () => {
    const storePath = join(dir, 'dep_1', 'acc_1', 'cursors')
    const layer = makeLayer({
      fs: {
        // half the encrypted record lands, then the disk fills: the temp exists
        writeFile: async (path, data, mode) => {
          await writeFile(path, data.subarray(0, Math.max(1, Math.floor(data.length / 2))), {
            mode,
          })
          throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
        },
      },
    })
    const records = await openRecords(layer)
    await expect(records.write('k', Buffer.from('value'))).rejects.toThrow('no space left')
    expect(readdirSync(storePath)).toEqual([])
  })

  it('a cleanup that fails does not replace the error the flush reported', async () => {
    const storePath = join(dir, 'dep_1', 'acc_1', 'cursors')
    const layer = makeLayer({
      fs: {
        writeFile: async (path, data, mode) => {
          await writeFile(path, data.subarray(0, Math.max(1, Math.floor(data.length / 2))), {
            mode,
          })
          throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
        },
        rm: async () => {
          throw Object.assign(new Error('the temp cannot be removed'), { code: 'EACCES' })
        },
      },
    })
    const records = await openRecords(layer)
    await expect(records.write('k', Buffer.from('value'))).rejects.toThrow('no space left')
    expect(readdirSync(storePath)).toHaveLength(1)
  })

  it('a refused publish drops its temp file too and keeps the published value', async () => {
    const storePath = join(dir, 'dep_1', 'acc_1', 'cursors')
    let renames = 0
    const layer = makeLayer({
      fs: {
        // the first publish lands; the replacement cannot rename its temp
        renameSync: (from, to) => {
          renames += 1
          if (renames > 1) throw Object.assign(new Error('the disk is gone'), { code: 'EIO' })
          renameSync(from, to)
        },
      },
    })
    const records = await openRecords(layer)
    expect(await records.write('k', Buffer.from('first'))).toEqual({ kind: 'ok' })
    await expect(records.write('k', Buffer.from('second'))).rejects.toThrow('the disk is gone')
    // the temp of the refused replacement is gone; the published value stays
    expect(readdirSync(storePath)).toHaveLength(1)
    expect(await readValue(records, 'k')).toEqual(Buffer.from('first'))
  })

  it('rejects unregistered stores, duplicate registrations and invalid registrations', async () => {
    const layer = makeLayer()
    const opened = await layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error('store did not open')
    expect(() => opened.store.records('nope')).toThrow(/store not registered/)
    expect(() => layer.register(CURSORS)).toThrow(/already registered/)
    expect(() => layer.register({ name: '../escape', schema: 1, minStoreLevel: 2 })).toThrow(
      /invalid store name/,
    )
    expect(() => layer.register({ name: 'bad-schema', schema: 0, minStoreLevel: 2 })).toThrow(
      /invalid store registration/,
    )
    expect(() => layer.register({ name: 'bad-level', schema: 1, minStoreLevel: 0 })).toThrow(
      /invalid store registration/,
    )
  })

  it('rejects a malformed scope', async () => {
    const layer = makeLayer()
    await expect(layer.open({ deploymentId: '..', accountId: 'acc_1' })).rejects.toThrow(
      /invalid store path segment/,
    )
    await expect(layer.lockAndWipe({ deploymentId: 'dep_1', accountId: 'a/b' })).rejects.toThrow(
      /invalid store path segment/,
    )
  })

  it('a wipe between the flush and the publish interrupts the write (G504-be-11)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reached!: () => void
    const held = new Promise<void>((resolve) => {
      reached = resolve
    })
    let holdOnce = true
    const layer = makeLayer({
      fs: {
        // the flush phase: the last real I/O before the record is published
        syncFile: async () => {
          if (!holdOnce) return
          holdOnce = false
          reached()
          await gate
        },
      },
    })
    const records = await openRecords(layer)
    const marker = Buffer.from('in flight at the flush')
    const pending = records.write('inflight', marker)
    await held
    const wiping = layer.lockAndWipe(SCOPE)
    release()
    expect(await pending).toEqual({ kind: 'interrupted' })
    await wiping
    expect(listFilesUnder(scopeDir(dir, SCOPE))).toEqual([])
    expect(filesContaining(dir, marker)).toEqual([])
    const reopened = await openRecords(layer)
    expect(await reopened.read('inflight')).toEqual({ kind: 'missing' })
  })

  it('a wipe that removes the folder mid-write is an interruption, not a throw (G504-be-11)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reached!: () => void
    const held = new Promise<void>((resolve) => {
      reached = resolve
    })
    let removed!: () => void
    const gone = new Promise<void>((resolve) => {
      removed = resolve
    })
    let holdOnce = true
    const layer = makeLayer({
      fs: {
        rm: async (path) => {
          await rm(path, { recursive: true, force: true })
          removed()
        },
        writeFile: async (path, data, mode) => {
          if (holdOnce) {
            holdOnce = false
            reached()
            await gate
          }
          // the wipe took the folder: this is the ENOENT a real write gets
          await writeFile(path, data, { mode })
        },
      },
    })
    const records = await openRecords(layer)
    const marker = Buffer.from('written while the folder goes')
    const pending = records.write('inflight', marker)
    await held
    const wiping = layer.lockAndWipe(SCOPE)
    await gone
    release()
    expect(await pending).toEqual({ kind: 'interrupted' })
    await wiping
    expect(listFilesUnder(scopeDir(dir, SCOPE))).toEqual([])
    expect(filesContaining(dir, marker)).toEqual([])
  })

  it('a wipe while the read is suspended never yields the plaintext (G504-be-11)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reached!: () => void
    const held = new Promise<void>((resolve) => {
      reached = resolve
    })
    let holdOnce = true
    const layer = makeLayer({
      fs: {
        // the bytes are already read off the disk when the wipe lands
        readFile: async (path) => {
          const bytes = readFileSync(path)
          if (holdOnce) {
            holdOnce = false
            reached()
            await gate
          }
          return bytes
        },
      },
    })
    const records = await openRecords(layer)
    const marker = Buffer.from('read while wiped')
    expect(await records.write('k', marker)).toEqual({ kind: 'ok' })

    const pending = records.read('k')
    await held
    await layer.lockAndWipe(SCOPE)
    release()
    expect(await pending).toEqual({ kind: 'interrupted' })
    expect(filesContaining(dir, marker)).toEqual([])
  })

  it('createSyncStoreLayer registers exactly the stores the compliance runs cover', async () => {
    const { SYNC_STORE_REGISTRATIONS } = await import('../src/main/uniwork-sync/session-store')
    const bySymbol = new Map<string, string>([
      ['INTENT_STORE_REGISTRATION', 'intents'],
      ['DRAFTS_STORE_REGISTRATION', 'drafts'],
      ['PAUSE_STORE_REGISTRATION', 'pause'],
      ['PARKED_STORE_REGISTRATION', 'parked'],
      ['FEED_CURSORS_REGISTRATION', 'feed-cursors'],
      ['DOC_INDEX_REGISTRATION', 'doc-index'],
      ['LEASE_STORE_REGISTRATION', 'offline-leases'],
      ['UPLOAD_SESSIONS_STORE_REGISTRATION', 'upload-sessions'],
    ])
    const testFiles = readdirSync(__dirname).filter(
      (name) => name.startsWith('uniwork-sync-') && name.endsWith('.test.ts'),
    )
    // stores registered on another layer (the offline library has its own layer, see libraryLayerFor in wiring.ts)
    const otherLayers = new Set(['OFFLINE_LIBRARY_STORE_REGISTRATION'])
    const covered = new Set<string>()
    for (const file of testFiles) {
      const source = readFileSync(join(__dirname, file), 'utf8')
      const matches = source.matchAll(/runStoreCompliance\([\s\S]*?registration:\s*([A-Z0-9_]+)/g)
      for (const match of matches) {
        const symbol = match[1]
        if (symbol && !otherLayers.has(symbol)) covered.add(bySymbol.get(symbol) ?? symbol)
      }
    }
    const registered = SYNC_STORE_REGISTRATIONS.map((r) => r.name).sort()
    expect([...covered].sort()).toEqual(registered)

    // every registered store opens and locks cleanly through the layer contract
    const layer = createStoreLayer({
      root: dir,
      keys: keyProvider(),
      budgetBytes: 1 << 20,
      clock: () => 1_700_000_000_000,
    })
    for (const reg of SYNC_STORE_REGISTRATIONS) layer.register(reg)
    const opened = await layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
    for (const reg of SYNC_STORE_REGISTRATIONS) {
      expect(await opened.store.records(reg.name).write('k', Buffer.from(reg.name))).toEqual({
        kind: 'ok',
      })
    }
    await layer.lock(SCOPE)
    for (const reg of SYNC_STORE_REGISTRATIONS) {
      expect(await opened.store.records(reg.name).read('k')).toEqual({ kind: 'interrupted' })
    }
  })
})
