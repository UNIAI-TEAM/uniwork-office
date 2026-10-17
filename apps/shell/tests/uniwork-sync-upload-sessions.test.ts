import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  runStoreCompliance,
  type ComplianceEnv,
  type ComplianceSubject,
} from '../src/main/uniwork-sync/test-kit/compliance'
import {
  UPLOAD_SESSIONS_STORE_REGISTRATION,
  createUploadSessionStore,
  uploadSessionKey,
  type UploadSessionRecord,
} from '../src/main/uniwork-sync/upload-sessions'

/**
 * BIGUP-A1 (UNI-1864): the new-document upload-session resume store. It keeps
 * one record per `sha256("<path>:<size>:<mtimeMs>")` so a restart (or a re-pick
 * of the same, unmodified file) resumes the parts already in the storage, and
 * an edited file - a different key - never resumes a session whose probe
 * described the older bytes.
 */

const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-upload-sessions-store-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

const safeStorage = createLockableSafeStorage()

function makeLayer(): ReturnType<typeof createStoreLayer> {
  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(UPLOAD_SESSIONS_STORE_REGISTRATION)
  return layer
}

const record = (overrides: Partial<UploadSessionRecord> = {}): UploadSessionRecord => ({
  sessionId: 'ups_1',
  workspaceId: 'ws_1',
  folderId: 'fold_1',
  path: '/home/me/Bao-cao.docx',
  size: 45 * 1024 * 1024,
  mtimeMs: 1_700_000_000_000,
  partSize: 8 * 1024 * 1024,
  totalParts: 6,
  completedParts: [
    { partNumber: 1, etag: '"e1"' },
    { partNumber: 2, etag: '"e2"' },
  ],
  expiresAt: '2026-10-19T00:00:00Z',
  updatedAt: '2026-10-18T00:00:00Z',
  ...overrides,
})

describe('uploadSessionKey', () => {
  it('names the same key for the same file and a different one for an edited file', () => {
    const key = uploadSessionKey('/a/b.docx', 100, 1_000)
    expect(key).toBe(uploadSessionKey('/a/b.docx', 100, 1_000))
    expect(key).not.toBe(uploadSessionKey('/a/b.docx', 100, 1_001))
    expect(key).not.toBe(uploadSessionKey('/a/b.docx', 101, 1_000))
    expect(key).not.toBe(uploadSessionKey('/a/c.docx', 100, 1_000))
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('createUploadSessionStore', () => {
  it('round-trips a record and removes it', async () => {
    const layer = makeLayer()
    const opened = await layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
    const store = createUploadSessionStore(
      opened.store.records(UPLOAD_SESSIONS_STORE_REGISTRATION.name),
    )
    const key = uploadSessionKey(record().path, record().size, record().mtimeMs)

    expect(await store.get(key)).toBeNull()
    expect(await store.put(key, record())).toEqual({ kind: 'ok' })
    expect(await store.get(key)).toEqual(record())
    await store.remove(key)
    expect(await store.get(key)).toBeNull()
  })

  it('reads a record whose parts are already complete, and drops a malformed one', async () => {
    const layer = makeLayer()
    const opened = await layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
    const records = opened.store.records(UPLOAD_SESSIONS_STORE_REGISTRATION.name)
    const store = createUploadSessionStore(records)

    expect(await store.put('a', record({ completedParts: [] }))).toEqual({ kind: 'ok' })
    expect((await store.get('a'))?.completedParts).toEqual([])

    // a record this build cannot read is dropped, never guessed at
    await records.write('b', Buffer.from('{not json'))
    expect(await store.get('b')).toBeNull()
    await records.write('c', Buffer.from(JSON.stringify({ sessionId: 'ups_1' })))
    expect(await store.get('c')).toBeNull()
    await records.write(
      'd',
      Buffer.from(JSON.stringify({ ...record(), completedParts: [{ partNumber: 0, etag: 'e' }] })),
    )
    expect(await store.get('d')).toBeNull()
  })

  it('reports a locked scope as no record to resume from', async () => {
    const layer = makeLayer()
    const opened = await layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
    const store = createUploadSessionStore(
      opened.store.records(UPLOAD_SESSIONS_STORE_REGISTRATION.name),
    )
    await store.put('k', record())
    await layer.lockAndWipe(SCOPE)
    // a wiped scope holds nothing to resume: the read answers no record, and a
    // write is refused rather than landing in a scope that is gone
    expect(await store.get('k')).toBeNull()
    const written = await store.put('k', record())
    expect(written.kind === 'ok').toBe(false)
  })

  runStoreCompliance('uniwork-sync upload-sessions store', async (env: ComplianceEnv) => {
    const layer = createStoreLayer({
      root: env.root,
      keys: createSafeStorageKeyProvider({ safeStorage: env.safeStorage, dir: env.keyDir }),
      budgetBytes: env.budgetBytes,
      clock: env.clock,
    })
    layer.register(UPLOAD_SESSIONS_STORE_REGISTRATION)
    const opened = await layer.open(env.scope)
    if (opened.kind !== 'ok') throw new Error(`upload-sessions store did not open: ${opened.kind}`)
    const subject: ComplianceSubject = {
      registration: UPLOAD_SESSIONS_STORE_REGISTRATION,
      layer,
      scope: env.scope,
      records: opened.store.records(UPLOAD_SESSIONS_STORE_REGISTRATION.name),
    }
    return subject
  })
})
