import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import {
  LeaseClientError,
  type LeaseClient,
  type OfficeOfflineLeaseSDO,
} from '../src/main/uniwork-sync/lease/client'
import { createLeaseManager, type LeaseRevokeNotice } from '../src/main/uniwork-sync/lease/manager'
import {
  LEASE_STORE_REGISTRATION,
  createLeaseStore,
  type LeaseStore,
} from '../src/main/uniwork-sync/lease/store'
import { DOC_INDEX_REGISTRATION, FEED_CURSORS_REGISTRATION } from '../src/main/uniwork-sync/runtime'
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
    /** wraps the lease store (a refused write, ...) */
    wrapStore?: (store: LeaseStore) => LeaseStore
  } = {},
) {
  let wallMs = T0
  let monoMs = 1_000
  let online = options.online ?? true
  let currentScope: { deploymentId: string; accountId: string } | null = { ...SCOPE }
  let currentSession: string | null = 'dev_1'
  const loadedVersions: Record<string, string> = {
    doc_1: 'ver_1',
    ...(options.loadedVersions ?? {}),
  }
  const grantCalls: string[] = []
  const renewCalls: Array<{ documentId: string; lease: string }> = []
  const releaseCalls: string[] = []
  const revokedNotices: LeaseRevokeNotice[] = []
  const archivedNotices: Array<{ documentId: string; boundaryToken: string | null }> = []
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
  const storeGets: string[] = []
  const baseStore = createLeaseStore(access)
  const counted: LeaseStore = {
    get: (documentId) => {
      storeGets.push(documentId)
      return baseStore.get(documentId)
    },
    put: (record) => baseStore.put(record),
    delete: (documentId) => baseStore.delete(documentId),
  }
  const store = options.wrapStore ? options.wrapStore(counted) : counted

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
    session: () => currentSession,
    isOnline: () => online,
    loadedVersionId: (docId) => loadedVersions[docId],
    onRevoked: (notice) => {
      revokedNotices.push(notice)
    },
    onSessionExpired: () => {
      sessionExpiredCount += 1
    },
  })
  manager.onArchived((documentId, boundaryToken) => {
    archivedNotices.push({ documentId, boundaryToken })
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
    archivedNotices,
    storeGets,
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
    setSession: (next: string | null) => {
      currentSession = next
    },
  }
}

const OTHER_ACCOUNT = { deploymentId: 'dep_1', accountId: 'user_2' }
const OTHER_DEPLOYMENT = { deploymentId: 'dep_2', accountId: 'user_1' }
const LEASE_ID = '01J8X4LEASE1P2Q3R4S5T6U7V8'

function leaseError(
  kind: LeaseClientError['kind'],
  code: string,
  status: number,
): LeaseClientError {
  return new LeaseClientError({ kind, code, status })
}

/** a promise the test settles by hand: the server's answer arrives when the test says so */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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

  it('R1-4: an archived answer that resumes after an account switch emits no notice', async () => {
    let atPut!: () => void
    const entered = new Promise<void>((resolve) => {
      atPut = resolve
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const h = makeHarness({
      renewImpl: async () => {
        throw new LeaseClientError({
          kind: 'archived',
          code: 'document_archived',
          status: 403,
        })
      },
      // the boundary moves while the archived record is being written: exactly
      // the window between handleClientError's generation check and its emit
      wrapStore: (store) => ({
        ...store,
        async put(record) {
          if (record.archived === true) {
            atPut()
            await gate
          }
          return store.put(record)
        },
      }),
    })

    await h.manager.grant('doc_1')
    h.advanceTime(13 * HOUR)
    const pending = h.manager.renew('doc_1')
    await entered

    h.setScope({ ...OTHER_ACCOUNT })
    expect(h.manager.lockBoundary({ ...SCOPE })).toBe('account_switch')
    release()
    expect((await pending).kind).toBe('none')

    // the stale answer never reached the library listener
    expect(h.archivedNotices).toEqual([])
  })

  it('R1-4: a fresh archived answer reaches the listener under its own boundary token', async () => {
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
    expect((await h.manager.renew('doc_1')).kind).toBe('archived')

    expect(h.archivedNotices).toEqual([
      { documentId: 'doc_1', boundaryToken: 'dep_1/user_1#dev_1' },
    ])
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

  it('logout locks immediately as signed_out (not revoked) and prevents offline cold-login without a session', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')

    // Logout locks all leases immediately through lockAll without waiting for the server
    h.manager.lockAll('signed_out')
    const afterLogout = await h.manager.effectiveState('doc_1')
    expect(afterLogout.state).toBe('locked')
    expect(afterLogout.reason).toBe('signed_out')
    expect(afterLogout.locked).toBe(true)
    expect(afterLogout.usable).toBe(false)

    // Cold start with no session (scope = null): even if disk has encrypted records, no lease is usable
    const coldManager = createLeaseManager({
      store: h.store,
      client: () => null,
      clock: { wallNow: () => T0, monotonicNow: () => 1_000 },
      scope: () => null,
      session: () => null,
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

  it('T1-5: logout sends no awaited DELETE and emits no cache-delete notice', async () => {
    // the server never answers the DELETE: a logout that awaited it would hang here
    const h = makeHarness({ releaseImpl: () => new Promise<void>(() => undefined) })
    await h.manager.grant('doc_1')
    const returned = h.manager.lockAll('signed_out')
    expect(returned).toBeUndefined()
    expect((await h.manager.effectiveState('doc_1')).reason).toBe('signed_out')
    // best effort only: fired once in the background, never awaited
    expect(h.releaseCalls).toEqual(['doc_1'])
    expect(h.revokedNotices).toEqual([])
  })

  it('R1BE-4: a null scope after logout reads none, not revoked', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    h.manager.lockAll('signed_out')
    h.setScope(null)
    const signedOut = await h.manager.effectiveState('doc_1')
    expect(signedOut.state).toBe('none')
    expect(signedOut.reason).toBeUndefined()
  })

  it('R1BE-4: the same account signing in again resets the boundary and a fresh grant works', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    h.manager.lockAll('signed_out')
    h.setScope(null)
    expect((await h.manager.effectiveState('doc_1')).state).toBe('none')

    h.setScope({ ...SCOPE })
    // a document that never held a lease is none, never a lock
    expect((await h.manager.effectiveState('doc_2')).state).toBe('none')
    // the same account reopens its own lease from the store
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')
    const fresh = await h.manager.grant('doc_2')
    expect(fresh.kind).toBe('renewed')
    expect((await h.manager.effectiveState('doc_2')).state).toBe('valid')
  })

  it('R1BE-4: a new session of the same account resets the boundary even when the null scope was never observed', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    h.manager.lockAll('signed_out')
    // sign-out and sign-in happened between two calls: only the session changed
    h.setSession('dev_2')
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')
    expect((await h.manager.grant('doc_2')).kind).toBe('renewed')
  })

  it('R1BE-4: another account signing in after logout starts unlocked', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    h.manager.lockAll('signed_out')
    h.setScope({ ...OTHER_ACCOUNT })
    expect((await h.manager.effectiveState('doc_1')).state).toBe('none')
    expect((await h.manager.grant('doc_1')).kind).toBe('renewed')
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')
  })

  it('T1-3: sign-out through lockBoundary while the session is live locks as signed_out and refuses a grant', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    expect(h.manager.lockBoundary({ ...SCOPE })).toBe('signed_out')
    const state = await h.manager.effectiveState('doc_1')
    expect(state.state).toBe('locked')
    expect(state.reason).toBe('signed_out')
    const refused = await h.manager.grant('doc_2')
    expect(refused.kind).toBe('locked')
    expect(h.grantCalls).toEqual(['doc_1'])
  })

  it('T1-3: account switch locks the outgoing account at once, sends no DELETE and leaves the incoming one unlocked', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    h.setScope({ ...OTHER_ACCOUNT })
    expect(h.manager.lockBoundary({ ...SCOPE })).toBe('account_switch')
    // the incoming account never sees the outgoing account's lease
    expect((await h.manager.effectiveState('doc_1')).state).toBe('none')
    expect(h.releaseCalls).toEqual([])
    expect((await h.manager.grant('doc_1')).kind).toBe('renewed')
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')
  })

  it('T1-3: deployment switch locks the outgoing deployment at once and sends no DELETE', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    h.setScope({ ...OTHER_DEPLOYMENT })
    expect(h.manager.lockBoundary({ ...SCOPE })).toBe('deployment_switch')
    expect((await h.manager.effectiveState('doc_1')).state).toBe('none')
    expect(h.releaseCalls).toEqual([])
    expect(h.revokedNotices).toEqual([])
  })

  it('T1-3: keystore locked at manager level -> keystore_locked, no grant request, unlock restores the lease', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    safeStorage.lock()
    const locked = await h.manager.effectiveState('doc_1')
    expect(locked.state).toBe('keystore_locked')
    expect(locked.locked).toBe(true)
    const grant = await h.manager.grant('doc_2')
    expect(grant.kind).toBe('keystore_locked')
    expect(h.grantCalls).toEqual(['doc_1'])
    safeStorage.unlock()
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')
  })

  it('T1-3: store full at manager level -> store_full, nothing kept', async () => {
    const h = makeHarness({
      wrapStore: (store) => ({ ...store, put: async () => ({ kind: 'store_full' }) }),
    })
    const grant = await h.manager.grant('doc_1')
    expect(grant.kind).toBe('store_full')
    expect((await h.manager.effectiveState('doc_1')).state).toBe('none')
  })

  it('T1-3: device_required and limit_reached -> failed with that kind, nothing stored, no revoke notice', async () => {
    for (const [kind, code, status] of [
      ['device_required', 'offline_lease_device_required', 403],
      ['limit_reached', 'offline_lease_limit_reached', 409],
    ] as const) {
      const h = makeHarness({
        grantImpl: async () => {
          throw leaseError(kind, code, status)
        },
      })
      const grant = await h.manager.grant('doc_1')
      expect(grant.kind).toBe('failed')
      if (grant.kind === 'failed') expect(grant.failure.kind).toBe(kind)
      expect((await h.manager.effectiveState('doc_1')).state).toBe('none')
      expect(h.revokedNotices).toEqual([])
    }
  })

  it('T1-3: renew 401 session_expired locks as session_expired, reports the session once, sends no DELETE', async () => {
    const h = makeHarness({
      renewImpl: async () => {
        throw leaseError('session_expired', 'session_expired', 401)
      },
    })
    await h.manager.grant('doc_1')
    h.advanceTime(13 * HOUR)
    const renew = await h.manager.renew('doc_1')
    expect(renew.kind).toBe('session_expired')
    const state = await h.manager.effectiveState('doc_1')
    expect(state.state).toBe('locked')
    expect(state.reason).toBe('session_expired')
    expect(h.sessionExpiredCount()).toBe(1)
    expect(h.releaseCalls).toEqual([])
    expect(h.revokedNotices).toEqual([])
  })

  it('T1-4: offline renew makes zero grant, renew or release calls', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    h.advanceTime(13 * HOUR)
    h.setOnline(false)
    expect((await h.manager.renew('doc_1')).kind).toBe('offline')
    await h.manager.onReconnect()
    await h.manager.onOnlinePass(false)
    expect(h.grantCalls).toEqual(['doc_1'])
    expect(h.renewCalls).toEqual([])
    expect(h.releaseCalls).toEqual([])
  })

  it('R1BE-6: a clock rollback the store refuses to persist stays latched in memory', async () => {
    let refuse = false
    const h = makeHarness({
      wrapStore: (store) => ({
        ...store,
        put: async (record) => (refuse ? { kind: 'store_full' } : store.put(record)),
      }),
    })
    await h.manager.grant('doc_1')
    h.advanceTime(30 * MIN)
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')

    refuse = true
    h.setWallClock(h.getWallClock() - 6 * MIN)
    expect((await h.manager.effectiveState('doc_1')).state).toBe('clock_rollback')
    // the wall clock creeps back inside the 5 min window: the latch still holds
    h.setWallClock(h.getWallClock() + 2 * MIN)
    expect((await h.manager.effectiveState('doc_1')).state).toBe('clock_rollback')
  })

  it('R1BE-7: a document queried without a stored lease is not read on the next reconnect pass', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')
    expect((await h.manager.effectiveState('doc_browsed')).state).toBe('none')
    h.storeGets.length = 0
    await h.manager.onReconnect()
    // only the held lease is read; the browsed document costs nothing
    expect(new Set(h.storeGets)).toEqual(new Set(['doc_1']))
  })

  it('R1BE-5: the lease-revoked entry point locks only for the signed-in user and ignores others', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')

    // another user's event and malformed payloads: ignored
    expect(
      await h.manager.handleFeedRevoked({
        user_id: 'user_2',
        document_id: 'doc_1',
        lease_id: LEASE_ID,
      }),
    ).toBeNull()
    expect(
      await h.manager.handleFeedRevoked({ user_id: SCOPE.accountId, document_id: 'doc_1' }),
    ).toBeNull()
    expect(await h.manager.handleFeedRevoked('office_lease.revoked')).toBeNull()
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')

    // no signed-in scope: nothing to match, ignored
    h.setScope(null)
    expect(
      await h.manager.handleFeedRevoked({
        user_id: SCOPE.accountId,
        document_id: 'doc_1',
        lease_id: LEASE_ID,
      }),
    ).toBeNull()
    h.setScope({ ...SCOPE })
    expect((await h.manager.effectiveState('doc_1')).state).toBe('valid')
    expect(h.revokedNotices).toEqual([])

    const locked = await h.manager.handleFeedRevoked({
      user_id: SCOPE.accountId,
      document_id: 'doc_1',
      lease_id: LEASE_ID,
    })
    expect(locked?.state).toBe('revoked')
    expect(h.revokedNotices).toHaveLength(1)
  })

  it('R2BE-4: an event for another lease than the held one is ignored; the matching one revokes', async () => {
    const h = makeHarness()
    await h.manager.grant('doc_1')

    // the document was re-granted since: a late event names the older lease
    expect(
      await h.manager.handleFeedRevoked({
        user_id: SCOPE.accountId,
        document_id: 'doc_1',
        lease_id: '01J8X4OLDLEASE0000000000AA',
      }),
    ).toBeNull()
    const stillValid = await h.manager.effectiveState('doc_1')
    expect(stillValid.state).toBe('valid')
    expect(stillValid.usable).toBe(true)
    expect(h.revokedNotices).toEqual([])

    const revoked = await h.manager.handleFeedRevoked({
      user_id: SCOPE.accountId,
      document_id: 'doc_1',
      lease_id: LEASE_ID,
    })
    expect(revoked?.state).toBe('revoked')
    expect(h.revokedNotices).toHaveLength(1)
    expect(h.revokedNotices[0]?.leaseId).toBe(LEASE_ID)
  })

  it('R2BE-4: an event for a document that holds no lease still locks it and emits the notice', async () => {
    const h = makeHarness()
    const revoked = await h.manager.handleFeedRevoked({
      user_id: SCOPE.accountId,
      document_id: 'doc_9',
      lease_id: LEASE_ID,
    })
    expect(revoked?.state).toBe('revoked')
    expect(h.revokedNotices).toHaveLength(1)
    expect(h.revokedNotices[0]?.documentId).toBe('doc_9')
  })

  it('R2BE-3: a store that answers keyring_unavailable -> keyring_unavailable state (with its reason) and no grant request', async () => {
    const h = makeHarness({
      wrapStore: (store) => ({ ...store, get: async () => ({ kind: 'keyring_unavailable' }) }),
    })
    const state = await h.manager.effectiveState('doc_1')
    expect(state.state).toBe('keyring_unavailable')
    expect(state.reason).toBe('keyring_unavailable')
    expect(state.locked).toBe(true)
    expect(state.usable).toBe(false)

    const grant = await h.manager.grant('doc_1')
    expect(grant.kind).toBe('keyring_unavailable')
    expect(h.grantCalls).toEqual([])
  })

  it('R2BE-3: a store that answers no_session -> none (state and grant), no grant request', async () => {
    const h = makeHarness({
      wrapStore: (store) => ({ ...store, get: async () => ({ kind: 'no_session' }) }),
    })
    const state = await h.manager.effectiveState('doc_1')
    expect(state.state).toBe('none')
    expect(state.usable).toBe(false)

    const grant = await h.manager.grant('doc_1')
    expect(grant.kind).toBe('none')
    expect(h.grantCalls).toEqual([])
  })

  it('R2BE-2: a grant answered after a sign-out lock is dropped: not locked open, not kept', async () => {
    const answer = deferred<OfficeOfflineLeaseSDO>()
    const h = makeHarness({ grantImpl: () => answer.promise })
    const pending = h.manager.grant('doc_1')
    await vi.waitFor(() => expect(h.grantCalls).toEqual(['doc_1']))

    expect(h.manager.lockBoundary({ ...SCOPE })).toBe('signed_out')
    answer.resolve(makeSdo(h.getWallClock()))
    const result = await pending

    expect(result.kind).toBe('locked')
    const state = await h.manager.effectiveState('doc_1')
    expect(state.state).toBe('locked')
    expect(state.usable).toBe(false)
    // nothing was kept: the next session of the account starts without it
    h.setSession('dev_2')
    expect((await h.manager.effectiveState('doc_1')).state).toBe('none')
  })

  it('R2BE-2: a renewal answered after a session_expired lock does not lift it', async () => {
    const answer = deferred<OfficeOfflineLeaseSDO>()
    const h = makeHarness({ renewImpl: () => answer.promise })
    await h.manager.grant('doc_1')
    h.advanceTime(13 * HOUR)
    const pending = h.manager.renew('doc_1')
    await vi.waitFor(() => expect(h.renewCalls).toHaveLength(1))

    h.manager.lockAll('session_expired')
    answer.resolve(makeSdo(h.getWallClock(), { generation: 2, renewed: true }))
    const result = await pending

    expect(result.kind).toBe('locked')
    const state = await h.manager.effectiveState('doc_1')
    expect(state.state).toBe('locked')
    expect(state.reason).toBe('session_expired')
  })

  it('R2BE-2: a grant answered after an account switch is not served to the incoming account', async () => {
    const answer = deferred<OfficeOfflineLeaseSDO>()
    const h = makeHarness({ grantImpl: () => answer.promise })
    const pending = h.manager.grant('doc_1')
    await vi.waitFor(() => expect(h.grantCalls).toEqual(['doc_1']))

    h.setScope({ ...OTHER_ACCOUNT })
    expect(h.manager.lockBoundary({ ...SCOPE })).toBe('account_switch')
    answer.resolve(makeSdo(h.getWallClock()))
    const result = await pending

    expect(result.kind).toBe('none')
    expect((await h.manager.effectiveState('doc_1')).state).toBe('none')
  })

  it('R2BE-2: a grant refused after a sign-out lock is dropped: no revoke, no notice', async () => {
    const answer = deferred<OfficeOfflineLeaseSDO>()
    const h = makeHarness({ grantImpl: () => answer.promise })
    const pending = h.manager.grant('doc_1')
    await vi.waitFor(() => expect(h.grantCalls).toEqual(['doc_1']))

    h.manager.lockBoundary({ ...SCOPE })
    answer.reject(leaseError('revoked', 'offline_lease_revoked', 403))
    const result = await pending

    expect(result.kind).toBe('locked')
    expect(h.revokedNotices).toEqual([])
    expect((await h.manager.effectiveState('doc_1')).state).toBe('locked')
  })

  it('R2BE-2: a lock that lands while the store keeps the answer still drops the answer', async () => {
    let lockWhileWriting: (() => void) | null = null
    const h = makeHarness({
      wrapStore: (store) => ({
        ...store,
        put: async (record) => {
          const written = await store.put(record)
          lockWhileWriting?.()
          return written
        },
      }),
    })
    await h.manager.grant('doc_1')
    h.advanceTime(13 * HOUR)

    lockWhileWriting = () => h.manager.lockAll('session_expired')
    const result = await h.manager.renew('doc_1')

    expect(result.kind).toBe('locked')
    const state = await h.manager.effectiveState('doc_1')
    expect(state.state).toBe('locked')
    expect(state.reason).toBe('session_expired')
  })
})
