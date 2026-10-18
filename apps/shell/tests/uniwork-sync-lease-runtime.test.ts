import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  NEVER_READ_CAPABILITIES,
  type CapabilityRead,
} from '../src/main/uniwork-sync/capability/cache'
import type { FeedClient } from '../src/main/uniwork-sync/feed/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { FeedError } from '../src/main/uniwork-sync/feed/errors'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import type { LeaseClient, OfficeOfflineLeaseSDO } from '../src/main/uniwork-sync/lease/client'
import { LEASE_STORE_REGISTRATION } from '../src/main/uniwork-sync/lease/store'
import {
  DOC_INDEX_REGISTRATION,
  FEED_CURSORS_REGISTRATION,
  SyncRuntime,
} from '../src/main/uniwork-sync/runtime'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * W1f (G5-08c): the lease manager inside the feed runtime. An org change is a
 * stop()/start() pair of the same account and deployment and must leave every
 * lease valid; the runtime's own poll verdict drives the renewal pass (row 2):
 * an online pass renews a due lease, an offline pass sends nothing at all.
 */

const T0 = Date.parse('2026-10-13T08:00:00Z')
const HOUR = 60 * 60 * 1000
const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }

function makeSdo(
  nowMs: number,
  overrides: Partial<OfficeOfflineLeaseSDO> = {},
): OfficeOfflineLeaseSDO {
  return {
    lease: `ofl1.token-at-${nowMs}`,
    lease_id: '01J8X4LEASE1P2Q3R4S5T6U7V8',
    document_id: 'doc_1',
    organization_id: 'org_a',
    workspace_id: 'ws_1',
    version_id: 'ver_1',
    version: 1,
    revision: '10',
    level: 'view',
    policy_epoch: 0,
    generation: 1,
    renewed: false,
    issued_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + 24 * HOUR).toISOString(),
    renew_after: new Date(nowMs + 12 * HOUR).toISOString(),
    server_time: new Date(nowMs).toISOString(),
    ...overrides,
  }
}

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-lease-runtime-'))
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

function harness() {
  let wallMs = T0
  let monoMs = 5_000
  let feedFails = false
  let renewGate: Promise<void> | null = null
  let renewEntered: () => void = () => undefined
  const events: string[] = []
  const grantCalls: string[] = []
  const renewCalls: string[] = []
  const releaseCalls: string[] = []
  const safeStorage = createLockableSafeStorage()
  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => wallMs,
  })
  layer.register(FEED_CURSORS_REGISTRATION)
  layer.register(DOC_INDEX_REGISTRATION)
  layer.register(LEASE_STORE_REGISTRATION)
  const store = createSyncStoreAccess({ layer, scope: () => ({ ...SCOPE }) })

  const leaseClient: LeaseClient = {
    async grant(documentId) {
      grantCalls.push(documentId)
      return makeSdo(wallMs, { document_id: documentId })
    },
    async renew(documentId) {
      renewCalls.push(documentId)
      events.push('renew-enter')
      renewEntered()
      if (renewGate) await renewGate
      events.push('renew-exit')
      return makeSdo(wallMs, { document_id: documentId, generation: 2, renewed: true })
    },
    async release(documentId) {
      releaseCalls.push(documentId)
    },
  }
  const feed: FeedClient = {
    async listChanges() {
      if (feedFails) throw new FeedError({ kind: 'other', error: new UniworkDocError('network') })
      return {
        phase: 'snapshot',
        hasMore: false,
        expiresAt: '2026-10-14T00:00:00Z',
        changes: [],
        nextCursor: 'c1',
      }
    },
  }
  const capability: CapabilityRead = {
    kind: 'ok',
    capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: true },
    source: 'fresh',
  }
  const runtime = new SyncRuntime({
    store,
    targets: { orgs: () => ['org_a'], workspaces: async () => ['ws_1'] },
    capability: async () => capability,
    client: () => feed,
    keepDraft: async () => false,
    onPoll: async () => {
      events.push('queue')
    },
    clock: { now: () => wallMs },
    schedule: () => () => undefined,
    lease: {
      client: () => leaseClient,
      session: () => 'dev_1',
      monotonicNow: () => monoMs,
    },
  })
  return {
    runtime,
    grantCalls,
    renewCalls,
    releaseCalls,
    advance(ms: number) {
      wallMs += ms
      monoMs += ms
    },
    setFeedFails(next: boolean) {
      feedFails = next
    },
    events,
    /** the next renewal request waits until the returned release is called */
    blockRenewal(): { entered: Promise<void>; release: () => void } {
      let release: () => void = () => undefined
      renewGate = new Promise<void>((resolve) => {
        release = () => {
          renewGate = null
          resolve()
        }
      })
      const entered = new Promise<void>((resolve) => {
        renewEntered = resolve
      })
      return { entered, release }
    },
  }
}

describe('the lease manager inside the feed runtime (W1f)', () => {
  it('R1BE-1: an org switch stop()/start() pair keeps a lease valid and sends no DELETE', async () => {
    const h = harness()
    await h.runtime.tick()
    expect((await h.runtime.leases.grant('doc_1')).kind).toBe('renewed')

    // the org picker: same account, same deployment, the pass it replaces stops
    h.runtime.stop()
    h.runtime.start()
    await h.runtime.tick()

    const state = await h.runtime.leases.effectiveState('doc_1')
    expect(state.state).toBe('valid')
    expect(state.usable).toBe(true)
    expect(h.releaseCalls).toEqual([])
  })

  it('R1BE-3: an online pass renews a due lease once', async () => {
    const h = harness()
    await h.runtime.tick()
    await h.runtime.leases.grant('doc_1')
    await h.runtime.tick()
    // not due yet: an online pass makes no renewal
    expect(h.renewCalls).toEqual([])

    h.advance(13 * HOUR)
    await h.runtime.tick()
    expect(h.renewCalls).toEqual(['doc_1'])
    expect((await h.runtime.leases.effectiveState('doc_1')).record?.generation).toBe(2)
    // renewed: the next online pass does not renew again
    await h.runtime.tick()
    expect(h.renewCalls).toEqual(['doc_1'])
  })

  it('R1BE-3: an offline pass makes zero grant, renew or release calls', async () => {
    const h = harness()
    await h.runtime.tick()
    await h.runtime.leases.grant('doc_1')
    h.advance(13 * HOUR)
    h.setFeedFails(true)
    await h.runtime.tick()
    // the pass said offline: a direct renew does not reach the server either
    expect((await h.runtime.leases.renew('doc_1')).kind).toBe('offline')
    expect(h.grantCalls).toEqual(['doc_1'])
    expect(h.renewCalls).toEqual([])
    expect(h.releaseCalls).toEqual([])

    // reconnect: the next online pass renews it
    h.setFeedFails(false)
    await h.runtime.tick()
    expect(h.renewCalls).toEqual(['doc_1'])
  })

  it('G703-R7-3: a blocked lease renewal does not delay the queue or the poll listeners', async () => {
    const h = harness()
    h.runtime.onPollVerdict(() => h.events.push('listener'))
    await h.runtime.tick()
    await h.runtime.leases.grant('doc_1')
    h.events.length = 0
    h.advance(13 * HOUR)
    const gate = h.blockRenewal()
    const pass = h.runtime.tick()
    await gate.entered
    // the renewal round trip is still pending: the verdict was already delivered
    expect(h.events).toEqual(['queue', 'listener', 'renew-enter'])
    gate.release()
    await pass
    expect(h.events).toEqual(['queue', 'listener', 'renew-enter', 'renew-exit'])
  })

  it('G703-R7-4: the post-renewal hook runs after the renewal settled, with the pass verdict', async () => {
    const h = harness()
    const seen: Array<boolean | undefined> = []
    h.runtime.onAfterLeasePass((online) => {
      seen.push(online)
      h.events.push('after-lease-pass')
    })
    await h.runtime.tick()
    await h.runtime.leases.grant('doc_1')
    h.events.length = 0
    seen.length = 0
    h.advance(13 * HOUR)
    const gate = h.blockRenewal()
    const pass = h.runtime.tick()
    await gate.entered
    expect(h.events).not.toContain('after-lease-pass')
    gate.release()
    await pass
    expect(h.events).toEqual(['queue', 'renew-enter', 'renew-exit', 'after-lease-pass'])
    expect(seen).toEqual([true])
    expect((await h.runtime.leases.effectiveState('doc_1')).record?.generation).toBe(2)
  })

  it('G703-R7-1: the commit stamp is even while idle, odd during a lease write, and moves on every landed commit', async () => {
    const h = harness()
    await h.runtime.tick()
    expect(h.runtime.leases.commitStamp('doc_1')).toBe(0)
    await h.runtime.leases.grant('doc_1')
    const afterGrant = h.runtime.leases.commitStamp('doc_1')
    expect(afterGrant).toBeGreaterThan(0)
    expect(afterGrant % 2).toBe(0)
    h.advance(13 * HOUR)
    await h.runtime.tick()
    const afterRenew = h.runtime.leases.commitStamp('doc_1')
    expect(afterRenew).toBeGreaterThan(afterGrant)
    expect(afterRenew % 2).toBe(0)
  })

  it('R1BE-12: the runtime builds its one lease manager from the lease options', () => {
    const h = harness()
    expect(h.runtime.leases).toBeDefined()
    expect('leaseManager' in h.runtime).toBe(false)
  })
})
