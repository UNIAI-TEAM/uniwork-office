import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  INTENT_STORE_REGISTRATION,
  createIntentStore,
  type IntentStore,
  type PendingIntentRecord,
} from '../src/main/uniwork-sync/intent-store'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { APP_STORE_LEVEL } from '../src/main/uniwork-sync/store-level'
import {
  RECORD_IV_BYTES,
  RECORD_TAG_BYTES,
  createStoreLayer,
  encodeRecord,
  recordPath,
  type RecordHeader,
  type StoreLayer,
} from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  runStoreCompliance,
  type ComplianceEnv,
  type ComplianceSubject,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'

const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }

const intent = (overrides: Partial<PendingIntentRecord> = {}): PendingIntentRecord => ({
  intentId: 'intent_1',
  idempotencyKey: 'idem_1',
  documentId: 'doc_1',
  baseRevision: '9007199254740993',
  checksum: 'a'.repeat(64),
  createdAt: '2026-10-12T00:00:00.000Z',
  ...overrides,
})

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-intent-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function makeIntentLayer(
  options: { budgetBytes?: number; safeStorage?: LockableSafeStorage } = {},
): {
  layer: StoreLayer
  safeStorage: LockableSafeStorage
} {
  const safeStorage = options.safeStorage ?? createLockableSafeStorage()
  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
    budgetBytes: options.budgetBytes ?? 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  return { layer, safeStorage }
}

async function openIntentStore(layer: StoreLayer): Promise<IntentStore> {
  const opened = await layer.open(SCOPE)
  if (opened.kind !== 'ok') throw new Error(`intent store did not open: ${opened.kind}`)
  return createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
}

function forgeIntentRecord(key: string, header: RecordHeader): string {
  const path = recordPath(join(base, 'records'), SCOPE, INTENT_STORE_REGISTRATION.name, key)
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

describe('uniwork sync intent store', () => {
  it('round-trips the intent fields and the exact payload bytes', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    const payload = Buffer.from([0, 1, 2, 255, 254, 0, 7, 13, 10])
    expect(await store.put('doc-key-1', intent(), payload)).toEqual({ kind: 'ok' })
    const value = await store.get('doc-key-1')
    expect(value).not.toBeNull()
    if (!value) throw new Error('intent missing')
    expect(value.intent).toEqual(intent())
    expect(Buffer.from(value.payload)).toEqual(payload)
    expect(await store.get('another-document')).toBeNull()
  })

  it('keeps only the latest intent of a document', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    await store.put('doc-key-1', intent({ intentId: 'intent_1' }), Buffer.from('first'))
    await store.put('doc-key-1', intent({ intentId: 'intent_2' }), Buffer.from('second'))
    const value = await store.get('doc-key-1')
    expect(value?.intent.intentId).toBe('intent_2')
    expect(value && Buffer.from(value.payload).toString()).toBe('second')
    expect(
      readdirSync(join(base, 'records', 'dep_1', 'acc_1', INTENT_STORE_REGISTRATION.name)),
    ).toHaveLength(1)
  })

  it('deletes an intent and treats a repeated delete as done', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    await store.put('doc-key-1', intent(), Buffer.from('payload'))
    await store.delete('doc-key-1')
    expect(await store.get('doc-key-1')).toBeNull()
    await expect(store.delete('doc-key-1')).resolves.toBeUndefined()
  })

  it('reads a corrupt record as no intent instead of throwing', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    await store.put('doc-key-1', intent(), Buffer.from('payload'))
    const path = recordPath(
      join(base, 'records'),
      SCOPE,
      INTENT_STORE_REGISTRATION.name,
      'doc-key-1',
    )
    const bytes = readFileSync(path)
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff
    writeFileSync(path, bytes)
    await expect(store.get('doc-key-1')).resolves.toBeNull()
  })

  it('reads a record needing a newer store level as no intent and keeps it', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    const path = forgeIntentRecord('doc-key-1', {
      schema: INTENT_STORE_REGISTRATION.schema,
      min_store_level: APP_STORE_LEVEL + 1,
    })
    await expect(store.get('doc-key-1')).resolves.toBeNull()
    expect(existsSync(path)).toBe(true)
  })

  it('reports keystore_locked when the keychain is locked', async () => {
    const { layer, safeStorage } = makeIntentLayer()
    await openIntentStore(layer)
    safeStorage.lock()
    expect(await layer.open(SCOPE)).toEqual({ kind: 'keystore_locked' })
  })

  runStoreCompliance('uniwork-sync intent store', async (env: ComplianceEnv) => {
    const layer = createStoreLayer({
      root: env.root,
      keys: createSafeStorageKeyProvider({ safeStorage: env.safeStorage, dir: env.keyDir }),
      budgetBytes: env.budgetBytes,
      clock: env.clock,
    })
    layer.register(INTENT_STORE_REGISTRATION)
    const opened = await layer.open(env.scope)
    if (opened.kind !== 'ok') throw new Error(`intent store did not open: ${opened.kind}`)
    const subject: ComplianceSubject = {
      registration: INTENT_STORE_REGISTRATION,
      layer,
      scope: env.scope,
      records: opened.store.records(INTENT_STORE_REGISTRATION.name),
    }
    return subject
  })
})
