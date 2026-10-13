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
} from '../src/main/uniwork-sync/intent-store'
import { createSafeStorageKeyProvider, type StoreKeyProvider } from '../src/main/uniwork-sync/keys'
import type {
  IntentBindFacts,
  IntentRecordV2,
  PendingIntentRecord,
} from '../src/main/uniwork-sync/queue/record'
import { APP_STORE_LEVEL } from '../src/main/uniwork-sync/store-level'
import {
  RECORD_IV_BYTES,
  RECORD_TAG_BYTES,
  createStoreLayer,
  encodeRecord,
  recordFileName,
  recordPath,
  type RecordHeader,
  type StoreLayer,
} from '../src/main/uniwork-sync/store'
import { sealRecord } from '../src/main/uniwork-sync/store/codec'
import {
  createLockableSafeStorage,
  runStoreCompliance,
  type ComplianceEnv,
  type ComplianceSubject,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'

const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }
const FACTS: IntentBindFacts = {
  orgId: 'org_1',
  workspaceId: 'ws_1',
  baseVersion: 7,
  length: 12,
}
const INDEX_FILE = recordFileName('intents/index')

/** the G5-04 record, still written by callers this build has not replaced */
const legacy = (overrides: Partial<PendingIntentRecord> = {}): PendingIntentRecord => ({
  intentId: 'intent_1',
  idempotencyKey: 'idem_1',
  documentId: 'doc_1',
  baseRevision: '9007199254740993',
  checksum: 'a'.repeat(64),
  createdAt: '2026-10-12T00:00:00.000Z',
  ...overrides,
})

const record = (overrides: Partial<IntentRecordV2> = {}): IntentRecordV2 => ({
  v: 2,
  ...legacy(),
  orgId: 'org_1',
  workspaceId: 'ws_1',
  baseVersion: 7,
  length: 12,
  generation: 1,
  state: 'queued',
  attempt: 0,
  updatedAt: '2026-10-12T00:00:00.000Z',
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
  keys: StoreKeyProvider
} {
  const safeStorage = options.safeStorage ?? createLockableSafeStorage()
  const keys = createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') })
  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys,
    budgetBytes: options.budgetBytes ?? 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  return { layer, safeStorage, keys }
}

async function openIntentStore(layer: StoreLayer): Promise<IntentStore> {
  const opened = await layer.open(SCOPE)
  if (opened.kind !== 'ok') throw new Error(`intent store did not open: ${opened.kind}`)
  return createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
}

/** `<meta length BE><meta JSON><payload>`, the layout the store writes */
function encodeRaw(meta: unknown, payload: Uint8Array): Uint8Array {
  const metaBytes = Buffer.from(JSON.stringify(meta), 'utf8')
  const out = Buffer.alloc(4 + metaBytes.length + payload.length)
  out.writeUInt32BE(metaBytes.length, 0)
  metaBytes.copy(out, 4)
  out.set(payload, 4 + metaBytes.length)
  return out
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
  it('round-trips a v2 record and the exact payload bytes', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    const payload = Buffer.from([0, 1, 2, 255, 254, 0, 7, 13, 10])
    expect(await store.put('doc-key-1', record(), payload, FACTS)).toEqual({ kind: 'ok' })
    const value = await store.get('doc-key-1', FACTS)
    expect(value).not.toBeNull()
    if (!value) throw new Error('intent missing')
    expect(value.intent).toEqual(record())
    expect(Buffer.from(value.payload)).toEqual(payload)
    expect(await store.get('another-document', FACTS)).toBeNull()
  })

  it('reads a record on disk that the G5-04 build sealed as v1, upgraded with the binding facts', async () => {
    const { layer, keys } = makeIntentLayer()
    const store = await openIntentStore(layer)
    const payload = Buffer.alloc(12, 7)
    const sealed = sealRecord(
      await keys.key(SCOPE),
      { schema: INTENT_STORE_REGISTRATION.schema, min_store_level: APP_STORE_LEVEL },
      encodeRaw(legacy(), payload),
    )
    const path = recordPath(
      join(base, 'records'),
      SCOPE,
      INTENT_STORE_REGISTRATION.name,
      'doc-key-1',
    )
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, sealed)

    const value = await store.get('doc-key-1', FACTS)
    if (!value) throw new Error('intent missing')
    expect(value.intent).toEqual(
      record({
        updatedAt: legacy().createdAt,
        orgId: FACTS.orgId,
        workspaceId: FACTS.workspaceId,
        baseVersion: FACTS.baseVersion,
        length: FACTS.length,
      }),
    )
    expect(Buffer.from(value.payload)).toEqual(payload)
  })

  it('keeps only the latest intent of a document', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    await store.put('doc-key-1', record({ intentId: 'intent_1' }), Buffer.from('first'), FACTS)
    await store.put('doc-key-1', record({ intentId: 'intent_2' }), Buffer.from('second'), FACTS)
    const value = await store.get('doc-key-1', FACTS)
    expect(value?.intent.intentId).toBe('intent_2')
    expect(value && Buffer.from(value.payload).toString()).toBe('second')
    const files = readdirSync(
      join(base, 'records', 'dep_1', 'acc_1', INTENT_STORE_REGISTRATION.name),
    ).filter((name) => name !== INDEX_FILE)
    expect(files).toHaveLength(1)
  })

  it('stores a v1 put from a G5-04 caller and reads it back as v2 with real facts', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    const payload = Buffer.alloc(12, 3)
    expect(await store.put('doc-key-1', legacy(), payload)).toEqual({ kind: 'ok' })
    const value = await store.get('doc-key-1', FACTS)
    expect(value?.intent.v).toBe(2)
    expect(value?.intent.state).toBe('queued')
    expect(value?.intent.attempt).toBe(0)
    expect(value?.intent.generation).toBe(1)
    expect(value?.intent.orgId).toBe('org_1')
    expect(value?.intent.baseVersion).toBe(7)
    expect(value?.intent.baseRevision).toBe(legacy().baseRevision)
    expect(Buffer.from(value?.payload ?? [])).toEqual(payload)
    // the one-argument view a G5-04 caller uses still carries its fields
    const legacyView = await store.get('doc-key-1')
    expect(legacyView?.intent.intentId).toBe(legacy().intentId)
    expect(legacyView?.intent.checksum).toBe(legacy().checksum)
  })

  it('lists every stored intent through the index, and drops a deleted one', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    await store.put('doc-a', record({ documentId: 'doc_a' }), Buffer.from('a'), FACTS)
    await store.put('doc-b', record({ documentId: 'doc_b' }), Buffer.from('b'), FACTS)
    await store.put('doc-a', record({ documentId: 'doc_a' }), Buffer.from('a2'), FACTS)
    const listed = await store.list()
    expect(listed.map((entry) => entry.documentKey).sort()).toEqual(['doc-a', 'doc-b'])
    expect(listed.every((entry) => entry.intent.v === 2)).toBe(true)
    await store.delete('doc-a')
    expect((await store.list()).map((entry) => entry.documentKey)).toEqual(['doc-b'])
  })

  it('deletes an intent and treats a repeated delete as done', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    await store.put('doc-key-1', record(), Buffer.from('payload'), FACTS)
    await store.delete('doc-key-1')
    expect(await store.get('doc-key-1', FACTS)).toBeNull()
    await expect(store.delete('doc-key-1')).resolves.toBeUndefined()
  })

  it('reads a corrupt record as no intent instead of throwing', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    await store.put('doc-key-1', record(), Buffer.from('payload'), FACTS)
    const path = recordPath(
      join(base, 'records'),
      SCOPE,
      INTENT_STORE_REGISTRATION.name,
      'doc-key-1',
    )
    const bytes = readFileSync(path)
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff
    writeFileSync(path, bytes)
    await expect(store.get('doc-key-1', FACTS)).resolves.toBeNull()
  })

  it('reads a record needing a newer store level as no intent and keeps it', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    const path = forgeIntentRecord('doc-key-1', {
      schema: INTENT_STORE_REGISTRATION.schema,
      min_store_level: APP_STORE_LEVEL + 1,
    })
    await expect(store.get('doc-key-1', FACTS)).resolves.toBeNull()
    expect(existsSync(path)).toBe(true)
  })

  it('refuses an intent whose record shape is broken', async () => {
    const { layer } = makeIntentLayer()
    const store = await openIntentStore(layer)
    await expect(
      store.put(
        'doc-key-1',
        { ...record(), state: 'sending' } as unknown as IntentRecordV2,
        Buffer.from('x'),
        FACTS,
      ),
    ).rejects.toThrow('invalid save intent')
    await expect(
      store.put('doc-key-1', { ...legacy(), intentId: '' }, Buffer.from('x')),
    ).rejects.toThrow('invalid save intent')
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
