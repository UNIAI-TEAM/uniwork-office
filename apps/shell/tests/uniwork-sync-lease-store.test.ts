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
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import {
  LEASE_RECORD_SCHEMA,
  compareLeaseRevision,
  decodeLeaseRecord,
  encodeLeaseRecord,
  parseLeaseRecord,
  type LeaseRecordInput,
} from '../src/main/uniwork-sync/lease/record'
import {
  LEASE_STORE_REGISTRATION,
  createLeaseStore,
} from '../src/main/uniwork-sync/lease/store'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import {
  RECORD_IV_BYTES,
  RECORD_TAG_BYTES,
  createStoreLayer,
  encodeRecord,
  recordPath,
} from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  runStoreCompliance,
  type ComplianceEnv,
  type ComplianceSubject,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'

const SCOPE = { deploymentId: 'dep_1', accountId: 'user_1' }

function sampleLease(overrides: Partial<LeaseRecordInput> = {}): LeaseRecordInput {
  return {
    lease: 'ofl1.eyJ2IjoxfQ.opaque-signed-token',
    lease_id: '01J8X4LEASE1P2Q3R4S5T6U7V8',
    generation: 2,
    issued_at: '2026-10-13T08:00:00Z',
    expires_at: '2026-10-14T08:00:00Z',
    renew_after: '2026-10-13T20:00:00Z',
    level: 'edit',
    version_id: '01J8X4VER0N1P2Q3R4S5T6U7V8',
    version: 3,
    revision: '9007199254740993',
    document_id: 'doc_1',
    scope: {
      user_id: SCOPE.accountId,
      deployment_id: SCOPE.deploymentId,
      organization_id: 'org_1',
      workspace_id: 'ws_1',
    },
    server_time_at_receipt: 1_760_342_400_000,
    monotonic_at_receipt: 10_000,
    max_wall_clock_seen: 1_760_342_400_500,
    policy_epoch: 1,
    ...overrides,
  }
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

function filesContaining(root: string, needle: Buffer): string[] {
  return listFilesUnder(root).filter((path) => readFileSync(path).includes(needle))
}

let base: string
let safeStorage: LockableSafeStorage

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-lease-store-'))
  safeStorage = createLockableSafeStorage()
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function makeEnv(budgetBytes = 1 << 20) {
  const root = join(base, 'records')
  const keyDir = join(base, 'keys')
  const layer = createStoreLayer({
    root,
    keys: createSafeStorageKeyProvider({ safeStorage, dir: keyDir }),
    budgetBytes,
    clock: () => 1_760_342_400_000,
  })
  layer.register(LEASE_STORE_REGISTRATION)
  let currentScope: { deploymentId: string; accountId: string } | null = { ...SCOPE }
  const access = createSyncStoreAccess({
    layer,
    scope: () => currentScope,
  })
  const store = createLeaseStore(access)
  return {
    root,
    keyDir,
    layer,
    access,
    store,
    setScope: (next: { deploymentId: string; accountId: string } | null) => {
      currentScope = next
    },
  }
}

describe('uniwork-sync lease record and store (G5-08c)', () => {
  it('lease record codec: preserves opaque signed lease, plaintext SDO fields, scope, clock anchors and compares revision with BigInt', () => {
    const input = sampleLease()
    const bytes = encodeLeaseRecord(input)
    const decoded = decodeLeaseRecord(bytes)
    expect(decoded).not.toBeNull()
    expect(decoded).toMatchObject({
      schema: LEASE_RECORD_SCHEMA,
      lease: 'ofl1.eyJ2IjoxfQ.opaque-signed-token',
      lease_id: '01J8X4LEASE1P2Q3R4S5T6U7V8',
      generation: 2,
      expires_at: '2026-10-14T08:00:00Z',
      renew_after: '2026-10-13T20:00:00Z',
      level: 'edit',
      version_id: '01J8X4VER0N1P2Q3R4S5T6U7V8',
      version: 3,
      revision: '9007199254740993',
      document_id: 'doc_1',
      user_id: 'user_1',
      deployment_id: 'dep_1',
      organization_id: 'org_1',
      workspace_id: 'ws_1',
      scope: {
        user_id: 'user_1',
        deployment_id: 'dep_1',
        organization_id: 'org_1',
        workspace_id: 'ws_1',
      },
      server_time_at_receipt: 1_760_342_400_000,
      monotonic_at_receipt: 10_000,
      max_wall_clock_seen: 1_760_342_400_500,
    })
    expect(compareLeaseRevision('10', '9')).toBe(1)
    expect(compareLeaseRevision('9007199254740993', '9007199254740992')).toBe(1)
    expect(compareLeaseRevision('9007199254740992', '9007199254740993')).toBe(-1)
    expect(compareLeaseRevision('42', '42')).toBe(0)
  })

  it('lease record codec: malformed or newer-schema records are refused', () => {
    const valid = JSON.parse(new TextDecoder().decode(encodeLeaseRecord(sampleLease()))) as Record<
      string,
      unknown
    >
    expect(parseLeaseRecord(valid)).not.toBeNull()
    expect(parseLeaseRecord({ ...valid, schema: LEASE_RECORD_SCHEMA + 1 })).toBeNull()
    expect(parseLeaseRecord({ ...valid, schema: 0 })).toBeNull()
    expect(parseLeaseRecord({ ...valid, lease: '' })).toBeNull()
    expect(parseLeaseRecord({ ...valid, level: 'manage' })).toBeNull()
    expect(parseLeaseRecord({ ...valid, generation: 0 })).toBeNull()
    expect(parseLeaseRecord({ ...valid, revision: 'not-a-number' })).toBeNull()
    expect(parseLeaseRecord({ ...valid, expires_at: 'not-a-date' })).toBeNull()
    expect(parseLeaseRecord({ ...valid, renew_after: 'not-a-date' })).toBeNull()
    expect(parseLeaseRecord({ ...valid, server_time_at_receipt: Number.NaN })).toBeNull()
    expect(parseLeaseRecord({ ...valid, monotonic_at_receipt: -1 })).toBeNull()
    expect(parseLeaseRecord({ ...valid, max_wall_clock_seen: Number.POSITIVE_INFINITY })).toBeNull()
    expect(
      parseLeaseRecord({
        ...valid,
        user_id: 'user_1',
        scope: { ...(valid.scope as Record<string, unknown>), user_id: 'user_2' },
      }),
    ).toBeNull()
    expect(decodeLeaseRecord(new TextEncoder().encode('{not json'))).toBeNull()
  })

  it('keystore locked -> keystore_locked, no write, no plaintext file anywhere under the store root', async () => {
    const env = makeEnv()
    safeStorage.lock()

    const lease = sampleLease({ lease: 'ofl1.secret-token-never-written-plaintext' })
    const writeRes = await env.store.put(lease)
    expect(writeRes).toEqual({ kind: 'keystore_locked' })
    expect(await env.store.get('doc_1')).toEqual({ kind: 'keystore_locked' })
    expect(await env.store.delete('doc_1')).toEqual({ kind: 'keystore_locked' })
    expect(listFilesUnder(env.root)).toEqual([])
    expect(filesContaining(base, Buffer.from('ofl1.secret-token-never-written-plaintext'))).toEqual(
      [],
    )

    // Unlock, write an encrypted record, then relock: subsequent ops return keystore_locked and write nothing
    safeStorage.unlock()
    const okWrite = await env.store.put(lease)
    expect(okWrite.kind).toBe('ok')
    expect(filesContaining(base, Buffer.from('ofl1.secret-token-never-written-plaintext'))).toEqual(
      [],
    )

    safeStorage.lock()
    const lockedRead = await env.store.get('doc_1')
    expect(lockedRead).toEqual({ kind: 'keystore_locked' })
    const lockedUpdate = await env.store.put(
      sampleLease({ document_id: 'doc_2', lease: 'ofl1.second-secret-token' }),
    )
    expect(lockedUpdate).toEqual({ kind: 'keystore_locked' })
    expect(existsSync(recordPath(env.root, SCOPE, LEASE_STORE_REGISTRATION.name, 'doc_2'))).toBe(
      false,
    )
    expect(filesContaining(base, Buffer.from('ofl1.second-secret-token'))).toEqual([])
  })

  it('store full -> no write', async () => {
    const env = makeEnv(900)
    const first = await env.store.put(sampleLease({ document_id: 'doc_1' }))
    expect(first.kind).toBe('ok')

    const second = await env.store.put(
      sampleLease({
        document_id: 'doc_2',
        lease: `ofl1.${'x'.repeat(512)}`,
      }),
    )
    expect(second).toEqual({ kind: 'store_full' })
    expect(existsSync(recordPath(env.root, SCOPE, LEASE_STORE_REGISTRATION.name, 'doc_2'))).toBe(
      false,
    )
    expect(await env.store.get('doc_2')).toEqual({ kind: 'missing' })
    expect(filesContaining(base, Buffer.from(`ofl1.${'x'.repeat(512)}`))).toEqual([])
  })

  it('tampered/forged lease file on disk is not read', async () => {
    const env = makeEnv()
    await env.store.put(sampleLease({ document_id: 'doc_1', level: 'view' }))
    const targetPath = recordPath(env.root, SCOPE, LEASE_STORE_REGISTRATION.name, 'doc_1')
    expect(existsSync(targetPath)).toBe(true)

    // 1. Plaintext JSON dropped directly onto the store record path (forged outside the store)
    const forgedPlaintext = JSON.stringify({
      ...sampleLease({
        document_id: 'doc_forged',
        level: 'edit',
        expires_at: '2099-01-01T00:00:00Z',
      }),
      schema: 1,
    })
    const forgedPath = recordPath(env.root, SCOPE, LEASE_STORE_REGISTRATION.name, 'doc_forged')
    mkdirSync(dirname(forgedPath), { recursive: true })
    writeFileSync(forgedPath, forgedPlaintext, 'utf8')
    expect(await env.store.get('doc_forged')).toEqual({ kind: 'refused' })

    // 2. Plaintext JSON placed outside the store namespace in the root directory is never consulted
    writeFileSync(join(env.root, 'doc_outside.json'), forgedPlaintext, 'utf8')
    expect(await env.store.get('doc_outside')).toEqual({ kind: 'missing' })
    expect(await env.store.get('../doc_outside.json')).toEqual({ kind: 'refused' })

    // 3. Ciphertext bit-flip on an existing encrypted lease record is refused
    const cipherBytes = readFileSync(targetPath)
    cipherBytes[cipherBytes.length - 1] = (cipherBytes[cipherBytes.length - 1] ?? 0) ^ 0xff
    writeFileSync(targetPath, cipherBytes)
    expect(await env.store.get('doc_1')).toEqual({ kind: 'refused' })

    // 4. Forged frame with valid header but invalid GCM tag is refused
    writeFileSync(
      targetPath,
      encodeRecord(
        { schema: LEASE_STORE_REGISTRATION.schema, min_store_level: LEASE_STORE_REGISTRATION.minStoreLevel },
        Buffer.alloc(RECORD_IV_BYTES, 1),
        Buffer.alloc(RECORD_TAG_BYTES, 2),
        Buffer.from(forgedPlaintext, 'utf8'),
      ),
    )
    expect(await env.store.get('doc_1')).toEqual({ kind: 'refused' })
  })

  it('survives a lock-and-keep (records stay encrypted, unreadable until reopen)', async () => {
    const env = makeEnv()
    const written = await env.store.put(sampleLease({ document_id: 'doc_1', level: 'edit' }))
    expect(written.kind).toBe('ok')
    const path = recordPath(env.root, SCOPE, LEASE_STORE_REGISTRATION.name, 'doc_1')
    expect(existsSync(path)).toBe(true)

    // Simulate lock-and-keep: keychain locks and session store forgets its open handle,
    // while encrypted files remain on disk
    safeStorage.lock()
    env.access.forget()
    expect(existsSync(path)).toBe(true)
    expect(await env.store.get('doc_1')).toEqual({ kind: 'keystore_locked' })

    // Unlock and reopen (including across a fresh StoreLayer / restart): record is readable again
    safeStorage.unlock()
    const freshLayer = createStoreLayer({
      root: env.root,
      keys: createSafeStorageKeyProvider({ safeStorage, dir: env.keyDir }),
      budgetBytes: 1 << 20,
      clock: () => 1_760_342_400_000,
    })
    freshLayer.register(LEASE_STORE_REGISTRATION)
    const reopenedStore = createLeaseStore(
      createSyncStoreAccess({ layer: freshLayer, scope: () => ({ ...SCOPE }) }),
    )
    const reread = await reopenedStore.get('doc_1')
    expect(reread.kind).toBe('ok')
    if (reread.kind === 'ok') {
      expect(reread.record.lease_id).toBe('01J8X4LEASE1P2Q3R4S5T6U7V8')
      expect(reread.record.level).toBe('edit')
    }
  })
})

describe('uniwork-sync lease store outcomes and on-disk hygiene (W1f)', () => {
  it('R1BE-8: no usable keyring surfaces as keyring_unavailable, not keystore_locked', async () => {
    const root = join(base, 'records')
    const layer = createStoreLayer({
      root,
      keys: createSafeStorageKeyProvider({
        safeStorage: { ...safeStorage, getSelectedStorageBackend: () => 'basic_text' },
        dir: join(base, 'keys'),
      }),
      budgetBytes: 1 << 20,
      clock: () => 1_760_342_400_000,
    })
    layer.register(LEASE_STORE_REGISTRATION)
    const store = createLeaseStore(createSyncStoreAccess({ layer, scope: () => ({ ...SCOPE }) }))
    expect(await store.put(sampleLease())).toEqual({ kind: 'keyring_unavailable' })
    expect(await store.get('doc_1')).toEqual({ kind: 'keyring_unavailable' })
    expect(await store.delete('doc_1')).toEqual({ kind: 'keyring_unavailable' })
    expect(listFilesUnder(root)).toEqual([])
  })

  it('R1BE-8: no session surfaces as no_session, distinct from a locked keychain', async () => {
    const env = makeEnv()
    env.setScope(null)
    expect(await env.store.put(sampleLease())).toEqual({ kind: 'no_session' })
    expect(await env.store.get('doc_1')).toEqual({ kind: 'no_session' })
    expect(await env.store.delete('doc_1')).toEqual({ kind: 'no_session' })
    expect(listFilesUnder(env.root)).toEqual([])
  })

  it('T1-6: no plaintext SDO field reaches the disk', async () => {
    const env = makeEnv()
    const distinct = sampleLease({
      lease: 'ofl1.plaintext-scan-token',
      lease_id: '01J8X4LEASEPLAINSCAN000001',
      version_id: '01J8X4VERSIONPLAINSCAN0001',
      revision: '8100200300400500600',
      expires_at: '2026-10-14T08:00:00.000Z',
      renew_after: '2026-10-13T20:00:00.000Z',
      scope: {
        user_id: SCOPE.accountId,
        deployment_id: SCOPE.deploymentId,
        organization_id: 'org_plainscan',
        workspace_id: 'ws_plainscan',
      },
    })
    expect((await env.store.put(distinct)).kind).toBe('ok')
    for (const field of [
      'ofl1.plaintext-scan-token',
      '01J8X4LEASEPLAINSCAN000001',
      '01J8X4VERSIONPLAINSCAN0001',
      '8100200300400500600',
      '2026-10-14T08:00:00.000Z',
      '2026-10-13T20:00:00.000Z',
      'org_plainscan',
      'ws_plainscan',
      '"level"',
    ]) {
      expect(filesContaining(base, Buffer.from(field)), field).toEqual([])
    }
  })

  it('T1-6: a truncated or empty lease record is refused', async () => {
    const env = makeEnv()
    await env.store.put(sampleLease({ document_id: 'doc_1' }))
    const path = recordPath(env.root, SCOPE, LEASE_STORE_REGISTRATION.name, 'doc_1')
    const full = readFileSync(path)

    writeFileSync(path, full.subarray(0, Math.floor(full.length / 2)))
    expect(await env.store.get('doc_1')).toEqual({ kind: 'refused' })
    writeFileSync(path, Buffer.alloc(0))
    expect(await env.store.get('doc_1')).toEqual({ kind: 'refused' })

    // an encrypted record whose plaintext is empty, or a cut JSON body
    const opened = await env.layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const records = opened.store.records(LEASE_STORE_REGISTRATION.name)
    await records.write('doc_2', new Uint8Array())
    expect(await env.store.get('doc_2')).toEqual({ kind: 'refused' })
    const body = encodeLeaseRecord(sampleLease({ document_id: 'doc_3' }))
    await records.write('doc_3', body.subarray(0, body.length - 5))
    expect(await env.store.get('doc_3')).toEqual({ kind: 'refused' })
  })
})

runStoreCompliance('uniwork-sync offline-leases', async (env: ComplianceEnv) => {
  const layer = createStoreLayer({
    root: env.root,
    keys: createSafeStorageKeyProvider({ safeStorage: env.safeStorage, dir: env.keyDir }),
    budgetBytes: env.budgetBytes,
    clock: env.clock,
  })
  layer.register(LEASE_STORE_REGISTRATION)
  const opened = await layer.open(env.scope)
  if (opened.kind !== 'ok') throw new Error(`offline-leases did not open: ${opened.kind}`)
  const subject: ComplianceSubject = {
    registration: LEASE_STORE_REGISTRATION,
    layer,
    scope: env.scope,
    records: opened.store.records(LEASE_STORE_REGISTRATION.name),
  }
  return subject
})
