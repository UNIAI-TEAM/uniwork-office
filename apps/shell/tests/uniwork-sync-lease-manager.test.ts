import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NEVER_READ_CAPABILITIES } from '../src/main/uniwork-sync/capability/cache'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import {
  LeaseClientError,
  type LeaseClient,
  type OfficeOfflineLeaseSDO,
} from '../src/main/uniwork-sync/lease/client'
import {
  createLeaseManager,
  type LeaseRevokeNotice,
} from '../src/main/uniwork-sync/lease/manager'
import { LEASE_STORE_REGISTRATION, createLeaseStore } from '../src/main/uniwork-sync/lease/store'
import {
  DOC_INDEX_REGISTRATION,
  FEED_CURSORS_REGISTRATION,
  SyncRuntime,
} from '../src/main/uniwork-sync/runtime'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'

const T0 = Date.parse('2026-10-13T08:00:00Z')
const HOUR = 60 * 60 * 1000
const MIN = 60 * 1000
const SCOPE = { deploymentId: 'dep_1', accountId: 'user_1' }

function makeSdo(
  nowMs: number,
  overrides: Partial<OfficeOfflineLeaseSDO> = {},
): OfficeOfflineLeaseSDO {
  const issuedMs = nowMs
  const expiresMs = nowMs + 24 * HOUR
  const renewAfterMs = nowMs + 12 * HOUR
  return {
    lease: `ofl1.token-at-${nowMs}`,
    lease_id: '01J8X4LEASE1P2Q3R4S5T6U7V8',
    document_id: 'doc_1',
    organization_id: 'org_1',
    workspace_id: 'ws_1',
    version_id: 'ver_1',
    version: 1,
    revision: '10',
    level: 'edit',
    policy_epoch: 0,
    generation: 1,
    renewed: false,
    issued_at: new Date(issuedMs).toISOString(),
    expires_at: new Date(expiresMs).toISOString(),
    renew_after: new Date(renewAfterMs).toISOString(),
    server_time: new Date(nowMs).toISOString(),
    ...overrides,
  }
}

let base: string
let safeStorage: LockableSafeStorage

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-lease-mgr-'))
  safeStorage = createLockableSafeStorage()
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function makeHarness(
  options: {
    online?: boolean
    loadedVersions?: Record<string, string>
    grantImpl?: (documentId: string) => Promise<OfficeOfflineLeaseSDO>
    renewImpl?: (documentId: string, lease: string) => Promise<OfficeOfflineLeaseSDO>
    releaseImpl?: (documentId: string) => Promise<void>
  } = {},
) {
  let wallMs = T0
  let monoMs = 1_000
  let online = options.online ?? true
  let currentScope: { deploymentId: string; accountId: string } | null = { ...SCOPE }
  const loadedVersions: Record<string, string> = {
    doc_1: 'ver_1',
    ...(options.loadedVersions ?? {}),
  }
  const grantCalls: string[] = []
  const renewCalls: Array<{ documentId: string; lease: string }> = []
  const releaseCalls: string[] = []
  const revokedNotices: LeaseRevokeNotice[] = []
  let sessionExpiredCount = 0

  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => wallMs,
  })
  layer.register(LEASE_STORE_REGISTRATION)
  layer.register(FEED_CURSORS_REGISTRATION)
  layer.register(DOC_INDEX_REGISTRATION)

  const access = createSyncStoreAccess({
    layer,
    scope: () => currentScope,
  })
  const store = createLeaseStore(access)

  const client: LeaseClient = {
    async grant(documentId) {
      grantCalls.push(documentId)
      if (options.grantImpl) return options.grantImpl(documentId)
      return makeSdo(wallMs, { document_id: documentId })
    },
    async renew(documentId, lease) {
      renewCalls.push({ documentId, lease })
      if (options.renewImpl) return options.renewImpl(documentId, lease)
      return makeSdo(wallMs, {
        document_id: documentId,
        generation: 2,
        renewed: true,
        lease: `ofl1.renewed-at-${wallMs}`,
      })
    },
    async release(documentId) {
      releaseCalls.push(documentId)
      if (options.releaseImpl) return options.releaseImpl(documentId)
    },
  }

  const manager = createLeaseManager({
    store,
    client: () => (online && currentScope ? client : null),
    clock: {
      wallNow: () => wallMs,
      monotonicNow: () => monoMs,
    },
    scope: () => currentScope,
    isOnline: () => online,
    loadedVersionId: (docId) => loadedVersions[docId],
    onRevoked: (notice) => {
      revokedNotices.push(notice)
    },
    onSessionExpired: () => {
      sessionExpiredCount += 1
    },
  })

  return {
    layer,
    access,
    store,
    manager,
    grantCalls,
    renewCalls,
    releaseCalls,
    revokedNotices,
    loadedVersions,
    sessionExpiredCount: () => sessionExpiredCount,
    advanceTime: (deltaMs: number) => {
      wallMs += deltaMs
      monoMs += deltaMs
    },
    setWallClock: (nextWallMs: number) => {
      wallMs = nextWallMs
    },
    getWallClock: () => wallMs,
    setOnline: (next: boolean) => {
      online = next
    },
    setScope: (next: { deploymentId: string; accountId: string } | null) => {
      currentScope = next
    },
  }
}

describe('uniwork-sync lease manager (G5-08c)', () => {
  it('renew at < 50 % only when online, never offline; new expiry is not cumulative', async () => {
    const h = makeHarness()
    const granted = await h.manager.grant('doc_1')
    expect(granted.kind).toBe('renewed')
    expect(h.grantCalls).toEqual(['doc_1'])

    // 10h elapsed (14h left > 50% of 24h TTL): startup/reconnect while online does NOT renew
    h.advanceTime(10 * HOUR)
    await h.manager.onStartup()
    await h.manager.onReconnect()
    expect(h.renewCalls).toHaveLength(0)

    // Advance another 3h -> 13h elapsed (11h left < 50% of 24h TTL), but OFFLINE: never renews offline
    h.advanceTime(3 * HOUR)
    h.setOnline(false)
    const offlineRenew = await h.manager.renew('doc_1')
    expect(offlineRenew.kind).toBe('offline')
    await h.manager.onReconnect()
    expect(h.renewCalls).toHaveLength(0)

    // Back ONLINE on reconnect with < 50% left: renews with previous signed token; new expiry is 24h from now (not cumulative)
    h.setOnline(true)
    const nowAtRenew = h.getWallClock()
    const results = await h.manager.onReconnect()
    const docRes = results.get('doc_1')
    expect(docRes?.kind).toBe('renewed')
    expect(h.renewCalls).toEqual([{ documentId: 'doc_1', lease: `ofl1.token-at-${T0}` }])

    const state = await h.manager.effectiveState('doc_1')
    expect(state.state).toBe('valid')
    expect(state.record?.generation).toBe(2)
    expect(Date.parse(state.record?.expires_at ?? '')).toBe(nowAtRenew + 24 * HOUR)
  })

  it('renew response version mismatch -> needs_refresh', async () => {
    const h = makeHarness({
      loadedVersions: { doc_1: 'ver_1' },
      renewImpl: async (documentId) =>
        makeSdo(h.getWallClock(), {
          document_id: documentId,
          version_id: 'ver_2',
          version: 2,
          revision: '25',
          generation: 2,
          renewed: true,
        }),
    })

    await h.manager.grant('doc_1')
    h.advanceTime(13 * HOUR)

    const outcome = await h.manager.renew('doc_1')
    expect(outcome.kind).toBe('needs_refresh')
    if (outcome.kind === 'needs_refresh') {
      expect(outcome.loadedVersionId).toBe('ver_1')
      expect(outcome.headVersionId).toBe('ver_2')
      expect(outcome.headVersion).toBe(2)
      expect(outcome.headRevision).toBe('25')
    }

    const state = await h.manager.effectiveState('doc_1')
    expect(state.needs_refresh).toBe(true)

    // Once caller downloads head version ver_2 and renews again, needs_refresh clears
    h.loadedVersions.doc_1 = 'ver_2'
    const refreshed = await h.manager.renew('doc_1', { force: true })
    expect(refreshed.kind).toBe('renewed')
    const afterRefresh = await h.manager.effectiveState('doc_1')
    expect(afterRefresh.needs_refresh).toBeFalsy()
    expect(afterRefresh.record?.version_id).toBe('ver_2')
  })

  it('revoke via feed event while online -> locked at once and marks committed cache for deletion', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')

    const afterRevoke = await h.manager.handleFeedRevoked({
      user_id: SCOPE.accountId,
      document_id: 'doc_1',
      lease_id: '01J8X4LEASE1P2Q3R4S5T6U7V8',
    })
    expect(afterRevoke.state).toBe('revoked')
    expect(afterRevoke.locked).toBe(true)
    expect(afterRevoke.usable).toBe(false)
    expect(h.revokedNotices).toEqual([
      {
        documentId: 'doc_1',
        leaseId: '01J8X4LEASE1P2Q3R4S5T6U7V8',
        userId: SCOPE.accountId,
        reason: 'office_lease.revoked',
        deleteCommittedCache: true,
        keepDrafts: true,
      },
    ])
  })

  it('renew 403 offline_lease_revoked -> re-grant once then revoked', async () => {
    // Part A: signature/secret rotation revoke where re-grant with empty body succeeds
    let grantCountA = 0
    const hSuccess = makeHarness({
      grantImpl: async (documentId) => {
        grantCountA += 1
        return makeSdo(hSuccess.getWallClock(), {
          document_id: documentId,
          lease: `ofl1.fresh-grant-${grantCountA}`,
          generation: 1,
        })
      },
      renewImpl: async () => {
        throw new LeaseClientError({
          kind: 'revoked',
          code: 'offline_lease_revoked',
          status: 403,
        })
      },
    })

    await hSuccess.manager.grant('doc_1')
    hSuccess.advanceTime(13 * HOUR)
    const regranted = await hSuccess.manager.renew('doc_1')
    expect(regranted.kind).toBe('renewed')
    expect(hSuccess.renewCalls).toHaveLength(1)
    expect(hSuccess.grantCalls).toEqual(['doc_1', 'doc_1'])
    expect((await hSuccess.manager.effectiveState('doc_1')).state).toBe('valid')
    expect(hSuccess.revokedNotices).toHaveLength(0)

    // Part B: policy epoch / ACL revoke where the single re-grant also fails -> revoked
    let grantCountB = 0
    const hFail = makeHarness({
      grantImpl: async (documentId) => {
        grantCountB += 1
        if (grantCountB === 1) {
          return makeSdo(hFail.getWallClock(), { document_id: documentId })
        }
        throw new LeaseClientError({
          kind: 'revoked',
          code: 'offline_lease_revoked',
          status: 403,
        })
      },
      renewImpl: async () => {
        throw new LeaseClientError({
          kind: 'revoked',
          code: 'offline_lease_revoked',
          status: 403,
        })
      },
    })

    await hFail.manager.grant('doc_1')
    hFail.advanceTime(13 * HOUR)
    const failedRegrant = await hFail.manager.renew('doc_1')
    expect(failedRegrant.kind).toBe('revoked')
    expect(hFail.renewCalls).toHaveLength(1)
    // Re-granted with empty body exactly once after the renew 403
    expect(hFail.grantCalls).toEqual(['doc_1', 'doc_1'])
    const stateB = await hFail.manager.effectiveState('doc_1')
    expect(stateB.state).toBe('revoked')
    expect(stateB.locked).toBe(true)
    expect(hFail.revokedNotices).toHaveLength(1)
    expect(hFail.revokedNotices[0]?.deleteCommittedCache).toBe(true)
    expect(hFail.revokedNotices[0]?.keepDrafts).toBe(true)
  })

  it('archived -> keeps existing lease until expiry then locks as expired', async () => {
    const h = makeHarness({
      renewImpl: async () => {
        throw new LeaseClientError({
          kind: 'archived',
          code: 'document_archived',
          status: 403,
        })
      },
    })

    await h.manager.grant('doc_1')
    h.advanceTime(13 * HOUR)

    const res = await h.manager.renew('doc_1')
    expect(res.kind).toBe('archived')
    // Not revoked: committed copy stays readable until the existing lease expires
    expect(h.revokedNotices).toHaveLength(0)
    const whileValid = await h.manager.effectiveState('doc_1')
    expect(whileValid.state).toBe('valid')
    expect(whileValid.usable).toBe(true)

    // < 4h left -> expiring_soon
    h.advanceTime(8 * HOUR)
    expect((await h.manager.effectiveState('doc_1')).state).toBe('expiring_soon')

    // Past 24h expiry -> locked as expired (lease_expired)
    h.advanceTime(3 * HOUR + MIN)
    const afterExpiry = await h.manager.effectiveState('doc_1')
    expect(afterExpiry.state).toBe('expired')
    expect(afterExpiry.reason).toBe('lease_expired')
    expect(afterExpiry.locked).toBe(true)
  })

  it('capability off keeps existing lease until expiry', async () => {
    const h = makeHarness({
      renewImpl: async () => {
        throw new LeaseClientError({
          kind: 'capability_off',
          code: 'office_capability_off',
          status: 403,
          capability: 'offline_library',
        })
      },
    })

    await h.manager.grant('doc_1')
    h.advanceTime(13 * HOUR)

    const res = await h.manager.renew('doc_1')
    expect(res.kind).toBe('capability_off')
    expect(h.revokedNotices).toHaveLength(0)

    const stillReadable = await h.manager.effectiveState('doc_1')
    expect(stillReadable.state).toBe('valid')
    expect(stillReadable.usable).toBe(true)

    // Past original 24h expiry -> expired
    h.advanceTime(11 * HOUR + MIN)
    const expired = await h.manager.effectiveState('doc_1')
    expect(expired.state).toBe('expired')
    expect(expired.reason).toBe('lease_expired')
  })

  it('view level reported (including edit -> view downgrade on renewal)', async () => {
    let currentLevel: 'view' | 'edit' = 'edit'
    const h = makeHarness({
      grantImpl: async (documentId) =>
        makeSdo(h.getWallClock(), { document_id: documentId, level: currentLevel }),
      renewImpl: async (documentId) =>
        makeSdo(h.getWallClock(), {
          document_id: documentId,
          level: currentLevel,
          generation: 2,
          renewed: true,
        }),
    })

    await h.manager.grant('doc_1')
    expect((await h.manager.effectiveState('doc_1')).level).toBe('edit')

    // Downgrade to view on renewal (row 9)
    currentLevel = 'view'
    h.advanceTime(13 * HOUR)
    await h.manager.renew('doc_1')

    const state = await h.manager.effectiveState('doc_1')
    expect(state.state).toBe('valid')
    expect(state.level).toBe('view')
  })

  it('logout locks immediately and prevents offline cold-login without a session', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')

    // Logout locks all leases immediately through lockAll without waiting for the server
    h.manager.lockAll('logout')
    const afterLogout = await h.manager.effectiveState('doc_1')
    expect(afterLogout.state).toBe('revoked')
    expect(afterLogout.locked).toBe(true)
    expect(afterLogout.usable).toBe(false)

    // Cold start with no session (scope = null): even if disk has encrypted records, no lease is usable
    const coldManager = createLeaseManager({
      store: h.store,
      client: () => null,
      clock: { wallNow: () => T0, monotonicNow: () => 1_000 },
      scope: () => null,
      isOnline: () => false,
    })
    const coldState = await coldManager.effectiveState('doc_1')
    expect(coldState.usable).toBe(false)
    expect(coldState.state).toBe('none')
  })

  it('clock rollback > 5 min locks manager state as clock_rollback until online check clears it', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    h.advanceTime(30 * MIN)
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')

    // Roll back wall clock by 6 minutes (> 5 min)
    h.setWallClock(h.getWallClock() - 6 * MIN)
    const rolledState = await h.manager.effectiveState('doc_1')
    expect(rolledState.state).toBe('clock_rollback')
    expect(rolledState.reason).toBe('clock_rollback')
    expect(rolledState.locked).toBe(true)

    // Online server-time check clears clock_rollback
    const cleared = await h.manager.onOnlineServerTimeCheck(
      'doc_1',
      new Date(T0 + 31 * MIN).toISOString(),
    )
    expect(cleared.state).toBe('valid')
    expect(cleared.locked).toBe(false)
  })

  it('exposes the lease manager from SyncRuntime and registers LEASE_STORE_REGISTRATION', async () => {
    const h = makeHarness()
    const runtime = new SyncRuntime({
      store: h.access,
      targets: { orgs: () => ['org_1'], workspaces: async () => ['ws_1'] },
      capability: async () => ({
        kind: 'ok',
        capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: false },
        source: 'fresh',
      }),
      client: () => null,
      keepDraft: async () => false,
      clock: { now: () => h.getWallClock() },
      leases: h.manager,
    })

    expect(runtime.leases).toBe(h.manager)
    expect(runtime.leaseManager()).toBe(h.manager)
  })
})
