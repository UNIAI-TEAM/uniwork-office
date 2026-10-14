import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DRAFTS_STORE_REGISTRATION,
  createDraftStore,
  type DraftStore,
} from '../src/main/uniwork-sync/queue/drafts'
import { QUEUE_LIMITS } from '../src/main/uniwork-sync/queue/limits'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createStoreLayer, type StoreLayer } from '../src/main/uniwork-sync/store'
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
  base = mkdtempSync(join(tmpdir(), 'uw-sync-drafts-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function makeDraftsLayer(options: { budgetBytes?: number } = {}): {
  layer: StoreLayer
  safeStorage: LockableSafeStorage
} {
  const safeStorage = createLockableSafeStorage()
  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
    budgetBytes: options.budgetBytes ?? 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(DRAFTS_STORE_REGISTRATION)
  return { layer, safeStorage }
}

async function openDraftStore(layer: StoreLayer): Promise<DraftStore> {
  const opened = await layer.open(SCOPE)
  if (opened.kind !== 'ok') throw new Error(`draft store did not open: ${opened.kind}`)
  return createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
}

const meta = (id: string, overrides: { createdAt?: string; title?: string } = {}) => ({
  id,
  createdAt: overrides.createdAt ?? '2026-10-13T12:00:00.000Z',
  ...(overrides.title === undefined ? {} : { title: overrides.title }),
})

describe('uniwork sync kept-draft store', () => {
  it('keeps drafts per document with their exact snapshot bytes and metadata', async () => {
    const { layer } = makeDraftsLayer()
    const store = await openDraftStore(layer)
    expect(await store.keep('doc-1', Buffer.from([1, 2, 3]), meta('d1', { title: 'Report' }))).toBe(
      'ok',
    )
    expect(await store.keep('doc-1', Buffer.from([9, 8]), meta('d2'))).toBe('ok')
    expect(await store.keep('doc-2', Buffer.from([7]), meta('d3'))).toBe('ok')

    const drafts = await store.list('doc-1')
    expect(drafts.map((draft) => draft.id)).toEqual(['d1', 'd2'])
    expect(drafts[0]?.title).toBe('Report')
    expect(Buffer.from(drafts[0]?.snapshot ?? [])).toEqual(Buffer.from([1, 2, 3]))
    expect(Buffer.from(drafts[1]?.snapshot ?? [])).toEqual(Buffer.from([9, 8]))
    expect((await store.list('doc-2')).map((draft) => draft.id)).toEqual(['d3'])
    expect(await store.list('doc-3')).toEqual([])
  })

  it('caps a document at draftsPerDocument (3) → drafts_full', async () => {
    const { layer } = makeDraftsLayer()
    const store = await openDraftStore(layer)
    for (const id of ['d1', 'd2', 'd3']) {
      expect(await store.keep('doc-1', Buffer.from(id), meta(id))).toBe('ok')
    }
    expect(await store.keep('doc-1', Buffer.from('d4'), meta('d4'))).toBe('drafts_full')
    expect(QUEUE_LIMITS.draftsPerDocument).toBe(3)
    expect(await store.list('doc-1')).toHaveLength(3)
    // replacing a kept id does not count as a new draft
    expect(await store.keep('doc-1', Buffer.from('d1b'), meta('d1'))).toBe('ok')
    const replaced = await store.list('doc-1')
    expect(replaced).toHaveLength(3)
    expect(Buffer.from(replaced[2]?.snapshot ?? []).toString()).toBe('d1b')
    expect(replaced.map((draft) => draft.id)).toEqual(['d2', 'd3', 'd1'])
  })

  it('removes one draft and treats an unknown id as done', async () => {
    const { layer } = makeDraftsLayer()
    const store = await openDraftStore(layer)
    await store.keep('doc-1', Buffer.from('a'), meta('d1'))
    await store.keep('doc-1', Buffer.from('b'), meta('d2'))
    await store.remove('doc-1', 'd1')
    expect((await store.list('doc-1')).map((draft) => draft.id)).toEqual(['d2'])
    await expect(store.remove('doc-1', 'nope')).resolves.toBeUndefined()
    await store.remove('doc-2', 'x')
    expect(await store.list('doc-1')).toHaveLength(1)
  })

  it('refuses a draft the account budget cannot hold → store_full', async () => {
    const { layer } = makeDraftsLayer({ budgetBytes: 4096 })
    const store = await openDraftStore(layer)
    expect(await store.keep('doc-1', Buffer.alloc(2_000, 1), meta('d1'))).toBe('ok')
    expect(await store.keep('doc-1', Buffer.alloc(3_000, 2), meta('d2'))).toBe('store_full')
    expect(await store.list('doc-1')).toHaveLength(1)
  })

  it('reports a locked/wiped scope as keystore_locked', async () => {
    const { layer } = makeDraftsLayer()
    const store = await openDraftStore(layer)
    await layer.lockAndWipe(SCOPE)
    expect(await store.keep('doc-1', Buffer.from('a'), meta('d1'))).toBe('keystore_locked')
    expect(await store.list('doc-1')).toEqual([])
  })

  runStoreCompliance('uniwork-sync kept-draft store', async (env: ComplianceEnv) => {
    const layer = createStoreLayer({
      root: env.root,
      keys: createSafeStorageKeyProvider({ safeStorage: env.safeStorage, dir: env.keyDir }),
      budgetBytes: env.budgetBytes,
      clock: env.clock,
    })
    layer.register(DRAFTS_STORE_REGISTRATION)
    const opened = await layer.open(env.scope)
    if (opened.kind !== 'ok') throw new Error(`draft store did not open: ${opened.kind}`)
    const subject: ComplianceSubject = {
      registration: DRAFTS_STORE_REGISTRATION,
      layer,
      scope: env.scope,
      records: opened.store.records(DRAFTS_STORE_REGISTRATION.name),
    }
    return subject
  })
})
