import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FIRST_SAVES_STORE_REGISTRATION,
  createFirstSaveStore,
  firstSaveKey,
  type FirstSaveRecord,
} from '../src/main/uniwork-sync/first-saves'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  runStoreCompliance,
  type ComplianceEnv,
  type ComplianceSubject,
} from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * S01-R2-4 (UNI-1847): the first-save restart record. One record per account
 * and original path, written `pending` with the attempt's Idempotency-Key
 * before the create and `bound` once the binding exists, so a restart can tell
 * a first-saved original from a plain file and replay an unfinished create.
 */

const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-first-saves-store-'))
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
  layer.register(FIRST_SAVES_STORE_REGISTRATION)
  return layer
}

const pending = (overrides: Partial<FirstSaveRecord> = {}): FirstSaveRecord => ({
  idempotencyKey: 'uniwork-doc-1',
  fingerprint: 'f'.repeat(64),
  state: 'pending',
  at: '2026-10-19T00:00:00.000Z',
  ...overrides,
})

const bound = (overrides: Partial<FirstSaveRecord> = {}): FirstSaveRecord =>
  pending({
    state: 'bound',
    documentId: 'doc_1',
    workingCopyPath: '/store/dep_1/acc_1/doc_1/Draft.docx',
    ...overrides,
  })

describe('firstSaveKey', () => {
  it('names one key per account and path, and never carries the path', () => {
    const key = firstSaveKey('dep_1acc_1', '/home/me/Draft.docx')
    expect(key).toBe(firstSaveKey('dep_1acc_1', '/home/me/Draft.docx'))
    expect(key).not.toBe(firstSaveKey('dep_1acc_2', '/home/me/Draft.docx'))
    expect(key).not.toBe(firstSaveKey('dep_1acc_1', '/home/me/Other.docx'))
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('createFirstSaveStore', () => {
  it('round-trips a pending and a bound record and removes them', async () => {
    const layer = makeLayer()
    const opened = await layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
    const store = createFirstSaveStore(opened.store.records(FIRST_SAVES_STORE_REGISTRATION.name))

    expect(await store.get('k')).toBeNull()
    expect(await store.put('k', pending())).toEqual({ kind: 'ok' })
    expect(await store.get('k')).toEqual(pending())
    expect(await store.put('k', bound())).toEqual({ kind: 'ok' })
    expect(await store.get('k')).toEqual(bound())
    await store.remove('k')
    expect(await store.get('k')).toBeNull()
  })

  it('drops a record this build cannot act on instead of guessing', async () => {
    const layer = makeLayer()
    const opened = await layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
    const records = opened.store.records(FIRST_SAVES_STORE_REGISTRATION.name)
    const store = createFirstSaveStore(records)
    const write = (key: string, value: unknown) =>
      records.write(key, Buffer.from(JSON.stringify(value)))

    await records.write('a', Buffer.from('{not json'))
    await write('b', { idempotencyKey: 'k' })
    await write('c', { ...pending(), state: 'archived' })
    // a bound record that names no document cannot be checked against a binding
    await write('d', { ...pending(), state: 'bound' })
    await write('e', { ...pending(), idempotencyKey: '' })

    for (const key of ['a', 'b', 'c', 'd', 'e']) expect(await store.get(key)).toBeNull()
  })

  it('reports a wiped scope as no record, and refuses a write into it', async () => {
    const layer = makeLayer()
    const opened = await layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
    const store = createFirstSaveStore(opened.store.records(FIRST_SAVES_STORE_REGISTRATION.name))
    await store.put('k', bound())
    await layer.lockAndWipe(SCOPE)

    expect(await store.get('k')).toBeNull()
    expect((await store.put('k', bound())).kind === 'ok').toBe(false)
  })

  runStoreCompliance('uniwork-sync first-saves store', async (env: ComplianceEnv) => {
    const layer = createStoreLayer({
      root: env.root,
      keys: createSafeStorageKeyProvider({ safeStorage: env.safeStorage, dir: env.keyDir }),
      budgetBytes: env.budgetBytes,
      clock: env.clock,
    })
    layer.register(FIRST_SAVES_STORE_REGISTRATION)
    const opened = await layer.open(env.scope)
    if (opened.kind !== 'ok') throw new Error(`first-saves store did not open: ${opened.kind}`)
    const subject: ComplianceSubject = {
      registration: FIRST_SAVES_STORE_REGISTRATION,
      layer,
      scope: env.scope,
      records: opened.store.records(FIRST_SAVES_STORE_REGISTRATION.name),
    }
    return subject
  })
})
