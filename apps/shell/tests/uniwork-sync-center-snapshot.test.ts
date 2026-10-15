import { describe, expect, it } from 'vitest'
import {
  buildSyncCenterSnapshot,
  isDiscardableBlockedReason,
  mapBlockedReason,
  type SyncCenterFacts,
  type SyncCenterIntentFact,
} from '../src/main/uniwork-sync/sync-center'
import type { IntentRecordV2, QueueState } from '../src/main/uniwork-sync/queue/record'

const NOW_MS = Date.parse('2026-10-15T09:00:00.000Z')
const NOW_ISO = new Date(NOW_MS).toISOString()

function makeRecord(
  overrides: Partial<IntentRecordV2> & { state?: QueueState } = {},
): IntentRecordV2 {
  const id = overrides.intentId ?? 'intent-1'
  return {
    v: 2,
    intentId: id,
    idempotencyKey: `idem-${id}`,
    documentId: overrides.documentId ?? 'doc-1',
    orgId: overrides.orgId ?? 'org-1',
    workspaceId: overrides.workspaceId ?? 'ws-1',
    baseRevision: '10',
    baseVersion: 3,
    checksum: 'abc123',
    length: 4096,
    generation: 1,
    state: 'queued',
    attempt: 1,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  }
}

function makeIntentFact(
  overrides: Partial<SyncCenterIntentFact> & { state?: QueueState; orgId?: string } = {},
): SyncCenterIntentFact {
  const record = makeRecord({
    intentId: overrides.id ?? 'intent-1',
    documentId: overrides.documentId ?? 'doc-1',
    orgId: overrides.orgId ?? 'org-1',
    ...(overrides.state ? { state: overrides.state } : {}),
    ...(overrides.record ?? {}),
  })
  return {
    id: overrides.id ?? record.intentId,
    documentKey: overrides.documentKey ?? record.documentId,
    documentId: record.documentId,
    orgId: record.orgId,
    title: overrides.title ?? 'Báo cáo tài chính Q3',
    ext: overrides.ext ?? 'xlsx',
    record,
    canEdit: overrides.canEdit ?? true,
    ...overrides,
  }
}

function baseFacts(overrides: Partial<SyncCenterFacts> = {}): SyncCenterFacts {
  return {
    nowMs: NOW_MS,
    sessionState: 'signed_in',
    online: true,
    paused: false,
    adminPaused: false,
    account: { name: 'Minh Trần', email: 'minh@vietants.com' },
    org: { id: 'org-1', name: 'VietAnts' },
    storeBudget: { used: 12 * 1024 * 1024, cap: 256 * 1024 * 1024 },
    ...overrides,
  }
}

describe('G5-10 buildSyncCenterSnapshot — header 10-priority table', () => {
  it('resolves priority 1: store_newer over all other conditions', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        storeNewer: true,
        sessionState: 'signed_out',
        online: false,
        paused: true,
        adminPaused: true,
        resyncFailed: true,
        feedOff: true,
        resynced: true,
      }),
    )
    expect(snap.header.status).toBe('store_newer')
  })

  it('resolves priority 2: signed_out over session_expired and below', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        sessionState: 'signed_out',
        online: false,
        paused: true,
        adminPaused: true,
        resyncFailed: true,
        feedOff: true,
        resynced: true,
      }),
    )
    expect(snap.header.status).toBe('signed_out')
  })

  it('resolves priority 3: session_expired over admin_paused and below', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        sessionState: 'session_expired',
        online: false,
        paused: true,
        adminPaused: true,
        resyncFailed: true,
        feedOff: true,
        resynced: true,
      }),
    )
    expect(snap.header.status).toBe('session_expired')
  })

  it('resolves priority 4: admin_paused over offline and below', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        adminPaused: true,
        online: false,
        paused: true,
        resyncFailed: true,
        feedOff: true,
        resynced: true,
      }),
    )
    expect(snap.header.status).toBe('admin_paused')
  })

  it('resolves priority 5: offline over paused and below', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        online: false,
        paused: true,
        resyncFailed: true,
        feedOff: true,
        resynced: true,
      }),
    )
    expect(snap.header.status).toBe('offline')
  })

  it('resolves priority 6: paused (user) over resync_failed and below', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        paused: true,
        resyncFailed: true,
        feedOff: true,
        resynced: true,
      }),
    )
    expect(snap.header.status).toBe('paused')
  })

  it('resolves priority 7: resync_failed over feed_off and below', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        resyncFailed: true,
        feedOff: true,
        resynced: true,
      }),
    )
    expect(snap.header.status).toBe('resync_failed')
  })

  it('resolves priority 8: feed_off over resynced and online', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        feedOff: true,
        resynced: true,
      }),
    )
    expect(snap.header.status).toBe('feed_off')
  })

  it('resolves priority 9: resynced over online', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        resynced: true,
      }),
    )
    expect(snap.header.status).toBe('resynced')
  })

  it('resolves priority 10: online when all higher conditions are inactive', () => {
    const snap = buildSyncCenterSnapshot(baseFacts())
    expect(snap.header.status).toBe('online')
  })
})

describe('G5-10 buildSyncCenterSnapshot — tab split, defaultTab, org filter, 24h window, signed-out, storeError', () => {
  it('splits rows across attention, pending, and recent tabs and computes defaultTab', () => {
    const attentionStates: QueueState[] = ['reconciling-stuck', 'conflict', 'blocked', 'failed']
    const pendingStates: QueueState[] = [
      'queued',
      'paused_offline',
      'paused_user',
      'paused_admin',
      'validating',
      'uploading',
      'committing',
      'reconciling',
    ]

    const intents: SyncCenterIntentFact[] = [
      ...attentionStates.map((state, idx) =>
        makeIntentFact({
          id: `att-${idx}`,
          documentKey: `doc-att-${idx}`,
          documentId: `doc-att-${idx}`,
          state,
        }),
      ),
      ...pendingStates.map((state, idx) =>
        makeIntentFact({
          id: `pend-${idx}`,
          documentKey: `doc-pend-${idx}`,
          documentId: `doc-pend-${idx}`,
          state,
        }),
      ),
      makeIntentFact({
        id: 'pend-moved',
        documentKey: 'doc-moved',
        documentId: 'doc-moved',
        state: 'queued',
        stateOverride: 'moved',
        workspaceName: 'Kế toán',
      }),
      makeIntentFact({
        id: 'pend-archived',
        documentKey: 'doc-archived',
        documentId: 'doc-archived',
        state: 'queued',
        stateOverride: 'archived',
      }),
      makeIntentFact({
        id: 'rec-1',
        documentKey: 'doc-rec-1',
        documentId: 'doc-rec-1',
        state: 'committed',
        record: makeRecord({
          intentId: 'rec-1',
          documentId: 'doc-rec-1',
          state: 'committed',
          updatedAt: new Date(NOW_MS - 30 * 60 * 1000).toISOString(),
          receipt: { versionId: 'v-4', version: 4, revision: '14' },
        }),
      }),
    ]

    const snap = buildSyncCenterSnapshot(
      baseFacts({
        intents,
        drafts: [
          {
            id: 'draft-row-1',
            documentKey: 'doc-draft-1',
            documentId: 'doc-draft-1',
            orgId: 'org-1',
            title: 'Bản nháp hợp đồng',
            ext: 'docx',
            draft: { id: 'd-1', createdAt: NOW_ISO, title: 'Bản nháp hợp đồng' },
            canEdit: true,
          },
        ],
      }),
    )

    expect(snap.tabs.attention.map((r) => r.state)).toEqual([
      'reconciling_stuck',
      'conflict',
      'blocked',
      'failed',
      'kept_draft',
    ])
    expect(snap.tabs.pending.map((r) => r.state)).toEqual([
      'queued',
      'paused_offline',
      'paused_user',
      'paused_admin',
      'uploading',
      'uploading',
      'committing',
      'reconciling',
      'moved',
      'archived',
    ])
    expect(snap.tabs.recent).toHaveLength(1)
    expect(snap.tabs.recent[0]?.state).toBe('committed')
    expect(snap.tabs.recent[0]?.committedVersion).toBe(4)
    expect(snap.defaultTab).toBe('attention')

    // When attention is empty, defaultTab falls back to 'pending'
    const noAttentionSnap = buildSyncCenterSnapshot(
      baseFacts({
        intents: intents.filter((i) => i.id?.startsWith('pend-')),
      }),
    )
    expect(noAttentionSnap.tabs.attention).toHaveLength(0)
    expect(noAttentionSnap.defaultTab).toBe('pending')
  })

  it('filters tabs by active org and sets otherOrgHasIntents when another org has pending work', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        org: { id: 'org-1', name: 'VietAnts' },
        intents: [
          makeIntentFact({
            id: 'in-org-1',
            documentKey: 'doc-1',
            documentId: 'doc-1',
            orgId: 'org-1',
            title: 'Tài liệu Org 1',
            state: 'queued',
          }),
          makeIntentFact({
            id: 'in-org-2',
            documentKey: 'doc-2',
            documentId: 'doc-2',
            orgId: 'org-2',
            title: 'Tài liệu Org 2',
            state: 'reconciling-stuck',
          }),
        ],
      }),
    )

    expect(snap.header.otherOrgHasIntents).toBe(true)
    expect(snap.header.otherOrgCount).toBe(1)
    expect(snap.tabs.pending.map((r) => r.id)).toEqual(['in-org-1'])
    expect(snap.tabs.attention).toHaveLength(0)
  })

  it('keeps only committed rows within the 24h recent window', () => {
    const within24h = new Date(NOW_MS - 23 * 60 * 60 * 1000).toISOString()
    const olderThan24h = new Date(NOW_MS - 25 * 60 * 60 * 1000).toISOString()

    const snap = buildSyncCenterSnapshot(
      baseFacts({
        intents: [
          makeIntentFact({
            id: 'recent-fresh',
            documentKey: 'doc-fresh',
            documentId: 'doc-fresh',
            state: 'committed',
            record: makeRecord({
              intentId: 'recent-fresh',
              documentId: 'doc-fresh',
              state: 'committed',
              updatedAt: within24h,
            }),
          }),
          makeIntentFact({
            id: 'recent-stale',
            documentKey: 'doc-stale',
            documentId: 'doc-stale',
            state: 'committed',
            record: makeRecord({
              intentId: 'recent-stale',
              documentId: 'doc-stale',
              state: 'committed',
              updatedAt: olderThan24h,
            }),
          }),
        ],
      }),
    )

    expect(snap.tabs.recent.map((r) => r.id)).toEqual(['recent-fresh'])
  })

  it('exposes only signedOut.lockedCount and never leaks document titles when signed out', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        sessionState: 'signed_out',
        intents: [
          makeIntentFact({
            id: 'secret-1',
            title: 'Kế hoạch M&A tuyệt mật',
            state: 'queued',
          }),
          makeIntentFact({
            id: 'secret-2',
            title: 'Bảng lương 2026',
            state: 'conflict',
          }),
        ],
        drafts: [
          {
            id: 'secret-draft',
            documentKey: 'doc-secret',
            documentId: 'doc-secret',
            orgId: 'org-1',
            title: 'Nháp mật',
            ext: 'docx',
            draft: { id: 'd-secret', createdAt: NOW_ISO, title: 'Nháp mật' },
            canEdit: true,
          },
        ],
      }),
    )

    expect(snap.header.status).toBe('signed_out')
    expect(snap.signedOut).toEqual({ lockedCount: 3 })
    expect(snap.tabs.attention).toEqual([])
    expect(snap.tabs.pending).toEqual([])
    expect(snap.tabs.recent).toEqual([])
    expect(JSON.stringify(snap)).not.toContain('Kế hoạch M&A tuyệt mật')
    expect(JSON.stringify(snap)).not.toContain('Bảng lương 2026')
    expect(JSON.stringify(snap)).not.toContain('Nháp mật')
  })

  it('returns empty tabs and storeError=true when local store fails to open', () => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        storeError: true,
        intents: [makeIntentFact({ id: 'row-1', state: 'queued' })],
      }),
    )

    expect(snap.storeError).toBe(true)
    expect(snap.tabs.attention).toEqual([])
    expect(snap.tabs.pending).toEqual([])
    expect(snap.tabs.recent).toEqual([])
  })
})

describe('G5-10 buildSyncCenterSnapshot — blocked reasons follow the spine contract', () => {
  const blockedRow = (
    lastError: IntentRecordV2['lastError'] | undefined,
    extra: Partial<SyncCenterIntentFact> = {},
    facts: Partial<SyncCenterFacts> = {},
  ) => {
    const snap = buildSyncCenterSnapshot(
      baseFacts({
        ...facts,
        intents: [
          {
            ...makeIntentFact({ id: 'blk-1', state: 'blocked' }),
            record: makeRecord({
              intentId: 'blk-1',
              state: 'blocked',
              ...(lastError ? { lastError } : {}),
            }),
            ...extra,
          },
        ],
      }),
    )
    return snap.tabs.attention[0]
  }

  it.each([
    ['session_expired', 'session_expired'],
    ['not_signed_in', 'session_expired'],
    ['wrong_deployment', 'session_expired'],
    ['permission_revoked', 'permission_revoked'],
    ['forbidden', 'permission_revoked'],
    ['not_found', 'permission_revoked'],
    ['document_deleted', 'document_deleted'],
    ['deleted', 'document_deleted'],
    ['organization_suspended', 'organization_suspended'],
    ['member_deactivated', 'member_deactivated'],
    ['keystore_locked', 'keystore_locked'],
    ['store_full', 'store_full'],
  ] as const)('maps the queue error %s to the blocked reason %s', (lastError, reason) => {
    expect(blockedRow(lastError)?.blockedReason).toBe(reason)
  })

  it('maps a recorded document_archived error (server code of G5-08s, not a UniworkDocErrorCode yet) to document_archived', () => {
    expect(blockedRow('document_archived' as never)?.blockedReason).toBe('document_archived')
  })

  it('BE-5: an absent or unrecognised queue error has no reason and is never discardable', () => {
    for (const error of [undefined, 'other_window', 'server_error'] as const) {
      const row = blockedRow(error)
      expect(row?.state, String(error)).toBe('blocked')
      expect(row?.blockedReason, String(error)).toBeUndefined()
      expect(row && 'blockedReason' in row, String(error)).toBe(false)
      expect(mapBlockedReason(error), String(error)).toBeUndefined()
      expect(isDiscardableBlockedReason(mapBlockedReason(error)), String(error)).toBe(false)
    }
    expect(isDiscardableBlockedReason('permission_revoked')).toBe(true)
  })

  it('lets an explicit fact reason win over the queue error (document_archived, foreign_account, lease_expired, clock_rollback)', () => {
    for (const reason of [
      'document_archived',
      'foreign_account',
      'lease_expired',
      'clock_rollback',
      'signed_out',
      'store_newer',
    ] as const) {
      expect(blockedRow('permission_revoked', { blockedReason: reason })?.blockedReason).toBe(
        reason,
      )
    }
  })

  it('declares exactly the 13 blocked reasons of the spine, in the spine order', async () => {
    const { SYNC_CENTER_BLOCKED_REASONS } = await import('../src/shared/sync-center')
    expect([...SYNC_CENTER_BLOCKED_REASONS]).toEqual([
      'session_expired',
      'signed_out',
      'foreign_account',
      'permission_revoked',
      'document_deleted',
      'document_archived',
      'organization_suspended',
      'member_deactivated',
      'lease_expired',
      'keystore_locked',
      'clock_rollback',
      'store_full',
      'store_newer',
    ])
  })

  it('marks libraryOff only on lease_expired while offline_library is off', () => {
    const lease = { blockedReason: 'lease_expired' } as const
    expect(blockedRow(undefined, lease, { offlineLibrary: false })?.libraryOff).toBe(true)
    expect(blockedRow(undefined, lease, { offlineLibrary: true })?.libraryOff).toBeUndefined()
    expect(blockedRow(undefined, lease)?.libraryOff).toBeUndefined()
    expect(
      blockedRow('permission_revoked', {}, { offlineLibrary: false })?.libraryOff,
    ).toBeUndefined()
    expect(
      blockedRow(undefined, { blockedReason: 'clock_rollback' }, { offlineLibrary: false })
        ?.libraryOff,
    ).toBeUndefined()
  })
})

describe('BE-10: the preload boundary validates the snapshot shape', () => {
  it('accepts a built snapshot and refuses one the renderer model could not read', async () => {
    const { asSyncCenterSnapshot } = await import('../src/shared/sync-center')
    const good = buildSyncCenterSnapshot(baseFacts())
    expect(asSyncCenterSnapshot(good)).toBe(good)
    for (const bad of [
      null,
      undefined,
      'snapshot',
      {},
      { header: good.header },
      { tabs: good.tabs },
      { header: {}, tabs: good.tabs },
      { header: good.header, tabs: { attention: [], pending: [] } },
      { header: good.header, tabs: { attention: [], pending: null, recent: [] } },
    ]) {
      expect(() => asSyncCenterSnapshot(bad)).not.toThrow()
      expect(asSyncCenterSnapshot(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
