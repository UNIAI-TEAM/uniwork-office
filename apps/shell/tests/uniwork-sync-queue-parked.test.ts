import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Binding } from '../src/main/uniwork-docs/binding-store'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import {
  PARKED_STORE_REGISTRATION,
  createParkedStore,
  type ParkedCopy,
  type ParkedStore,
} from '../src/main/uniwork-sync/queue/parked'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { APP_STORE_LEVEL } from '../src/main/uniwork-sync/store-level'
import { createStoreLayer, storeDirFor, type StoreLayer } from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  runStoreCompliance,
  type ComplianceEnv,
  type ComplianceSubject,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'

const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-parked-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function makeBinding(documentId: string, overrides: Partial<Binding> = {}): Binding {
  return {
    schema: 2,
    documentId,
    workspaceId: 'ws_1',
    orgId: 'org_1',
    title: `Doc ${documentId}`,
    filename: `${documentId}.docx`,
    format: 'docx',
    access: 'edit',
    baseRevision: '10',
    baseVersion: 2,
    baseChecksum: 'a'.repeat(64),
    state: 'dirty',
    minStoreLevel: APP_STORE_LEVEL,
    minAppVersion: '0.11.0',
    ...overrides,
  }
}

function makeCopy(
  documentKey: string,
  bytes: Uint8Array = Buffer.from(`bytes-${documentKey}`),
  overrides: Partial<ParkedCopy> = {},
): ParkedCopy {
  return {
    documentKey,
    binding: makeBinding(documentKey),
    bytes,
    parkedAt: '2026-10-14T12:00:00.000Z',
    ...overrides,
  }
}

function makeParkedLayer(
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
  layer.register(PARKED_STORE_REGISTRATION)
  return { layer, safeStorage }
}

async function openParkedStore(layer: StoreLayer): Promise<ParkedStore> {
  const opened = await layer.open(SCOPE)
  if (opened.kind !== 'ok') throw new Error(`parked store did not open: ${opened.kind}`)
  return createParkedStore(opened.store.records(PARKED_STORE_REGISTRATION.name))
}

describe('uniwork sync parked working-copy store', () => {
  it('parks, lists, takes and removes working copies across a reopen', async () => {
    const { layer, safeStorage } = makeParkedLayer()
    const store = await openParkedStore(layer)
    expect(await store.list()).toEqual([])
    expect(await store.take('doc-1')).toBeNull()

    const copy1 = makeCopy('doc-1', Buffer.from([1, 2, 3, 4]), {
      binding: makeBinding('doc-1', {
        serverRevision: '11',
        serverVersion: 3,
        lastSavedAt: '2026-10-14T11:55:00.000Z',
        baseVersionId: 'ver_2',
        level: 'edit',
      }),
    })
    const copy2 = makeCopy('doc-2', Buffer.from([9, 8, 7]))

    expect(await store.park(copy1)).toBe('ok')
    expect(await store.park(copy2)).toBe('ok')
    expect((await store.list()).sort()).toEqual(['doc-1', 'doc-2'])

    // take reads without deleting: caller deletes only after the restore is durable
    const taken1 = await store.take('doc-1')
    expect(taken1).not.toBeNull()
    expect(taken1?.documentKey).toBe('doc-1')
    expect(taken1?.parkedAt).toBe(copy1.parkedAt)
    expect(taken1?.binding).toEqual(copy1.binding)
    expect(Buffer.from(taken1?.bytes ?? [])).toEqual(Buffer.from([1, 2, 3, 4]))
    expect((await store.list()).sort()).toEqual(['doc-1', 'doc-2'])

    // sign-out locks the layer; a fresh layer over the same root/keys still lists and takes both
    await layer.lock(SCOPE)
    const { layer: reopenedLayer } = makeParkedLayer({ safeStorage })
    const reopened = await openParkedStore(reopenedLayer)
    expect((await reopened.list()).sort()).toEqual(['doc-1', 'doc-2'])
    const afterReopen = await reopened.take('doc-1')
    expect(afterReopen?.binding).toEqual(copy1.binding)
    expect(Buffer.from(afterReopen?.bytes ?? [])).toEqual(Buffer.from([1, 2, 3, 4]))

    await reopened.remove('doc-1')
    expect(await reopened.take('doc-1')).toBeNull()
    expect(await reopened.list()).toEqual(['doc-2'])
    await expect(reopened.remove('absent')).resolves.toBeUndefined()
  })

  it('overwrites an existing parked copy atomically in one record', async () => {
    const { layer } = makeParkedLayer()
    const store = await openParkedStore(layer)
    expect(await store.park(makeCopy('doc-1', Buffer.from('v1')))).toBe('ok')
    const updated = makeCopy('doc-1', Buffer.from('v2-newer'), {
      parkedAt: '2026-10-14T12:05:00.000Z',
      binding: makeBinding('doc-1', { title: 'Updated Title', baseVersion: 5 }),
    })
    expect(await store.park(updated)).toBe('ok')

    const files = readdirSync(storeDirFor(join(base, 'records'), SCOPE, 'parked'))
    expect(files).toHaveLength(1)
    expect(await store.list()).toEqual(['doc-1'])
    const taken = await store.take('doc-1')
    expect(taken?.binding.title).toBe('Updated Title')
    expect(taken?.binding.baseVersion).toBe(5)
    expect(taken?.parkedAt).toBe('2026-10-14T12:05:00.000Z')
    expect(Buffer.from(taken?.bytes ?? []).toString()).toBe('v2-newer')
  })

  it('refuses a parked copy that exceeds the account budget -> store_full', async () => {
    const { layer } = makeParkedLayer({ budgetBytes: 4096 })
    const store = await openParkedStore(layer)
    expect(await store.park(makeCopy('doc-1', Buffer.alloc(1500, 1)))).toBe('ok')
    expect(await store.park(makeCopy('doc-2', Buffer.alloc(3000, 2)))).toBe('store_full')
    expect(await store.list()).toEqual(['doc-1'])
    expect(await store.take('doc-2')).toBeNull()
  })

  it('reports keystore_locked when the keystore is locked', async () => {
    const { layer, safeStorage } = makeParkedLayer()
    const access = createSyncStoreAccess({
      layer,
      scope: () => SCOPE,
    })
    const store = createParkedStore(access)
    expect(await store.park(makeCopy('doc-1', Buffer.from('ok-first')))).toBe('ok')

    safeStorage.lock()
    expect(await store.park(makeCopy('doc-2', Buffer.from('while-locked')))).toBe('keystore_locked')
    expect(await store.list()).toEqual([])
    expect(await store.take('doc-1')).toBeNull()

    safeStorage.unlock()
    expect(await store.list()).toEqual(['doc-1'])
  })

  it('returns interrupted after the scope is locked', async () => {
    const { layer } = makeParkedLayer()
    const store = await openParkedStore(layer)
    expect(await store.park(makeCopy('doc-1', Buffer.from('before-lock')))).toBe('ok')
    await layer.lock(SCOPE)
    expect(await store.park(makeCopy('doc-2', Buffer.from('after-lock')))).toBe('interrupted')
    expect(await store.list()).toEqual([])
    expect(await store.take('doc-1')).toBeNull()
  })

  runStoreCompliance('uniwork-sync parked store', async (env: ComplianceEnv) => {
    const layer = createStoreLayer({
      root: env.root,
      keys: createSafeStorageKeyProvider({ safeStorage: env.safeStorage, dir: env.keyDir }),
      budgetBytes: env.budgetBytes,
      clock: env.clock,
    })
    layer.register(PARKED_STORE_REGISTRATION)
    const opened = await layer.open(env.scope)
    if (opened.kind !== 'ok') throw new Error(`parked store did not open: ${opened.kind}`)
    const subject: ComplianceSubject = {
      registration: PARKED_STORE_REGISTRATION,
      layer,
      scope: env.scope,
      records: opened.store.records(PARKED_STORE_REGISTRATION.name),
    }
    return subject
  })
})
