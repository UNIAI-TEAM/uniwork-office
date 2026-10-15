import { describe, expect, it, vi } from 'vitest'
import {
  createSyncCenterController,
  createWiredSyncCenter,
  registerSyncCenterIpc,
} from '../src/main/uniwork-sync/sync-center'
import {
  UNIWORK_SYNC_CENTER_CHANNELS,
  type SyncCenterBlockedReason,
} from '../src/shared/sync-center'
import {
  QueueDispatcher,
  type QueueDoc,
  type QueueIntents,
} from '../src/main/uniwork-sync/queue/dispatcher'
import {
  createDraftStore,
  type DraftKeepResult,
  type DraftStore,
  type KeptDraft,
} from '../src/main/uniwork-sync/queue/drafts'
import type { IntentRecordV2 } from '../src/main/uniwork-sync/queue/record'
import type { StoreRecords, StoreWriteResult } from '../src/main/uniwork-sync/store'

const NOW_MS = Date.parse('2026-10-15T09:00:00.000Z')
const NOW_ISO = new Date(NOW_MS).toISOString()

function createMemoryRecords(options: { storeFull?: boolean } = {}): StoreRecords {
  const map = new Map<string, Uint8Array>()
  return {
    async read(key) {
      const found = map.get(key)
      return found ? { kind: 'ok', value: found } : { kind: 'missing' }
    },
    async write(key, value): Promise<StoreWriteResult> {
      if (options.storeFull) return { kind: 'store_full' }
      map.set(key, new Uint8Array(value))
      return { kind: 'ok' }
    },
    async delete(key) {
      map.delete(key)
    },
    async listKeys() {
      return [...map.keys()]
    },
  }
}

function makeQueueDoc(
  overrides: Partial<QueueDoc> & { state?: IntentRecordV2['state'] } = {},
): QueueDoc {
  const key = overrides.key ?? 'doc-1'
  const record: IntentRecordV2 = {
    v: 2,
    intentId: `intent-${key}`,
    idempotencyKey: `idem-${key}`,
    documentId: key,
    orgId: overrides.orgId ?? 'org-1',
    workspaceId: overrides.workspaceId ?? 'ws-1',
    baseRevision: '10',
    baseVersion: 2,
    checksum: 'sha256-payload',
    length: 5,
    generation: 1,
    state: overrides.state ?? 'queued',
    attempt: 1,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...(overrides.record ?? {}),
  }
  return {
    key,
    path: `/work/${key}.docx`,
    filename: `${key}.docx`,
    format: 'docx',
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    baseVersion: record.baseVersion,
    record,
    payload: overrides.payload ?? new Uint8Array([1, 2, 3, 4, 5]),
    ...overrides,
  }
}

/** a doc whose record carries extra fields (`makeQueueDoc` spreads an override over its own record) */
function withRecord(doc: QueueDoc, patch: Partial<IntentRecordV2>): QueueDoc {
  doc.record = { ...doc.record, ...patch }
  return doc
}

function createHarness(
  options: {
    online?: boolean
    storeFull?: boolean
    canEdit?: boolean
    revokedDraft?: boolean
    initialDocs?: QueueDoc[]
    /** explicit blocked reasons the read model derived, by document key (e.g. `document_archived`) */
    blockedReasons?: Record<string, SyncCenterBlockedReason>
    /** the intent store refuses every record `saveAgain` mints (budget full) */
    refuseNewIntent?: boolean
  } = {},
) {
  let online = options.online ?? true
  let paused = false
  let storeError = false
  const docs = new Map<string, QueueDoc>()
  for (const doc of options.initialDocs ?? []) {
    docs.set(doc.key, doc)
  }

  const draftRecords = createMemoryRecords({ storeFull: options.storeFull })
  const draftStore: DraftStore = createDraftStore(draftRecords)

  const intentsStore: QueueIntents = {
    async read(documentKey) {
      const doc = docs.get(documentKey)
      return doc ? { intent: doc.record, payload: doc.payload } : null
    },
    async put(documentKey, intent, payload) {
      writes.push(`${intent.intentId}:${intent.state}`)
      if (options.refuseNewIntent && intent.intentId.startsWith('office-intent-')) {
        return { kind: 'store_full' }
      }
      const existing = docs.get(documentKey)
      if (existing) {
        existing.record = intent
        existing.payload = payload
      }
      return { kind: 'ok' }
    },
    async delete(documentKey) {
      docs.delete(documentKey)
    },
    async get(documentKey) {
      const doc = docs.get(documentKey)
      return doc ? { intent: doc.record, payload: doc.payload } : null
    },
  }

  let seq = 0
  let idSeq = 0
  /** every write the intent store was asked for, as `intentId:state` */
  const writes: string[] = []
  const published: IntentRecordV2[] = []
  const lookupCommit = vi.fn(async () => ({
    outcome: 'committed' as const,
    receipt: { versionId: 'v-3', version: 3, revision: '11' },
  }))
  const upload = vi.fn(async () => ({ uploadId: 'up-1', checksumSha256: 'sha256-payload' }))
  const commit = vi.fn(async () => ({
    documentId: 'doc-1',
    versionId: 'v-3',
    version: 3,
    revision: '11',
    checksumSha256: 'sha256-payload',
  }))

  const dispatcher = new QueueDispatcher({
    intents: async () => ({ kind: 'ok', intents: intentsStore }),
    client: {
      upload,
      commit,
      lookupCommit,
    },
    capability: {
      get: async () => ({
        kind: 'ok',
        capabilities: { sync_write: true },
        source: 'live',
      }),
    },
    lock: {
      acquire: async () => ({ kind: 'acquired', generation: 1 }),
      check: async () => true,
      heartbeat: async () => true,
      release: async () => undefined,
    },
    pause: {
      isPaused: async () => paused,
      setPaused: async (next) => {
        paused = next
        return { kind: 'ok' }
      },
    },
    drafts: draftStore,
    clock: () => NOW_MS,
    uuid: () => `draft-uuid-${++seq}`,
    publish: (record) => {
      published.push(record)
    },
  })

  const clipboardWrites: string[] = []
  const openedDocs: string[] = []
  const openedDrafts: Array<{ documentKey: string; draftId: string; readOnly: boolean }> = []
  const savedCopies: Array<{ defaultFilename: string; path: string; bytes: Uint8Array }> = []
  let syncNowCalls = 0
  let retryStoreCalls = 0

  const controller = createSyncCenterController({
    now: () => NOW_MS,
    debounceMs: 5,
    isOnline: () => online,
    isPaused: async () => paused,
    isStoreError: () => storeError,
    getFacts: async () => {
      const allDrafts: Array<{
        id: string
        documentKey: string
        documentId: string
        orgId: string
        title: string
        ext: string
        draft: KeptDraft
        canEdit: boolean
        revoked?: boolean
      }> = []
      for (const key of ['doc-1', 'doc-stuck', 'doc-draft']) {
        const list = await draftStore.list(key)
        for (const d of list) {
          allDrafts.push({
            id: `draft:${key}:${d.id}`,
            documentKey: key,
            documentId: key,
            orgId: 'org-1',
            title: d.title ?? 'Báo cáo Q3',
            ext: 'docx',
            draft: d,
            canEdit: options.canEdit ?? true,
            revoked: options.revokedDraft,
          })
        }
      }
      return {
        nowMs: NOW_MS,
        sessionState: 'signed_in',
        online,
        paused,
        adminPaused: false,
        org: { id: 'org-1', name: 'VietAnts' },
        storeError,
        intents: [...docs.values()].map((doc) => ({
          id: doc.record.intentId,
          documentKey: doc.key,
          documentId: doc.record.documentId,
          orgId: doc.orgId,
          title: 'Báo cáo Q3',
          ext: 'docx',
          record: doc.record,
          supportCode:
            doc.record.state === 'reconciling-stuck' ? `SUP-${doc.record.intentId}` : undefined,
          ...(options.blockedReasons?.[doc.key]
            ? { blockedReason: options.blockedReasons[doc.key] }
            : {}),
          canEdit: options.canEdit ?? true,
        })),
        drafts: allDrafts,
      }
    },
    findDoc: async (rowId) => {
      for (const doc of docs.values()) {
        if (doc.record.intentId === rowId || doc.key === rowId) {
          return {
            doc,
            title: 'Báo cáo Q3',
            ext: 'docx',
            canEdit: options.canEdit ?? true,
            supportCode:
              doc.record.state === 'reconciling-stuck' ? `SUP-${doc.record.intentId}` : undefined,
          }
        }
      }
      return null
    },
    dispatcher: () => Promise.resolve(dispatcher),
    drafts: () => Promise.resolve(draftStore),
    listQueueDocs: async () => [...docs.values()],
    newId: () => `new-${++idSeq}`,
    syncNow: async () => {
      syncNowCalls += 1
    },
    writeClipboard: (text) => {
      clipboardWrites.push(text)
    },
    openDocument: async (documentId) => {
      openedDocs.push(documentId)
      return true
    },
    openDraft: async (input) => {
      openedDrafts.push({
        documentKey: input.documentKey,
        draftId: input.draftId,
        readOnly: input.readOnly,
      })
      return true
    },
    pickSaveCopyPath: async ({ defaultFilename }) => `/exports/${defaultFilename}`,
    writeCopyFile: async (targetPath, bytes, meta) => {
      savedCopies.push({ defaultFilename: meta.defaultFilename, path: targetPath, bytes })
    },
    retryStore: async () => {
      retryStoreCalls += 1
      storeError = false
      return true
    },
  })

  return {
    controller,
    docs,
    draftStore,
    dispatcher,
    published,
    writes,
    clipboardWrites,
    openedDocs,
    openedDrafts,
    savedCopies,
    lookupCommit,
    upload,
    commit,
    getSyncNowCalls: () => syncNowCalls,
    getRetryStoreCalls: () => retryStoreCalls,
    setOnline: (next: boolean) => {
      online = next
    },
    setStoreError: (next: boolean) => {
      storeError = next
    },
  }
}

describe('G5-10 wired Sync Center facts: header account', () => {
  const wired = (status: Record<string, unknown>) =>
    createWiredSyncCenter({
      ipcMain: { handle: () => undefined },
      userDataDir: '/tmp/uw',
      service: {
        store: { root: '/tmp/uw/store', readLastOwner: () => null },
        currentLocks: () => [],
        syncCenterEngine: async () => ({ kind: 'unavailable' as const }),
      },
      store: { access: { scope: () => ({ deploymentId: 'dep-1', accountId: 'acc-1' }) } },
      accountStatus: () => ({ loggedIn: true, state: 'signed-in', ...status }),
      capabilityRead: async () => ({ kind: 'ok', capabilities: { sync_write: true } }),
      tickRuntime: async () => undefined,
      openPath: () => true,
      isPathOpen: () => false,
      defaultSaveDir: () => '/tmp',
      writeClipboard: () => undefined,
      pickSaveDialog: async () => null,
      pushChanged: () => undefined,
    } as never)

  it('maps the header account from the profile (display name, email)', async () => {
    const { controller } = wired({
      email: 'old@example.test',
      profile: { accountId: 'acc-1', email: 'minh@example.test', displayName: '  Minh Trần ' },
      org: { id: 'org-1', name: 'VietAnts', slug: 'vietants', role: 'member' },
    })
    const snap = await controller.getSnapshot()
    expect(snap.header.account).toEqual({ name: 'Minh Trần', email: 'minh@example.test' })
    expect(snap.header.org).toEqual({ id: 'org-1', name: 'VietAnts' })
  })

  it('falls back to the email local part when the profile has no display name, and to nothing without an identity', async () => {
    const mail = await wired({
      email: 'lan.nguyen@example.test',
      profile: { accountId: 'acc-1', email: '', displayName: '' },
    }).controller.getSnapshot()
    expect(mail.header.account).toEqual({ name: 'lan.nguyen', email: 'lan.nguyen@example.test' })

    const none = await wired({}).controller.getSnapshot()
    expect(none.header.account).toBeUndefined()
  })
})

describe('G5-10 Sync Center actions and change notifications', () => {
  it('syncNow runs sync when online and refuses with offline when disconnected', async () => {
    const h = createHarness({ online: true })
    expect(await h.controller.syncNow()).toEqual({ ok: true })
    expect(h.getSyncNowCalls()).toBe(1)

    h.setOnline(false)
    expect(await h.controller.syncNow()).toEqual({ ok: false, code: 'offline' })
    expect(h.getSyncNowCalls()).toBe(1)
  })

  it('setSendingPaused pauses and resumes user sending', async () => {
    const doc = makeQueueDoc({ key: 'doc-1', state: 'paused_user' })
    const h = createHarness({ initialDocs: [doc] })

    expect(await h.controller.setSendingPaused(true)).toEqual({ ok: true })
    expect((await h.controller.getSnapshot()).header.paused).toBe(true)

    expect(await h.controller.setSendingPaused(false)).toEqual({ ok: true })
    expect((await h.controller.getSnapshot()).header.paused).toBe(false)
    expect(doc.record.state).toBe('queued')
  })

  it('sendNow dispatches a single row immediately and refuses when offline or missing', async () => {
    const doc = makeQueueDoc({ key: 'doc-1', state: 'queued' })
    const h = createHarness({ initialDocs: [doc] })

    expect(await h.controller.sendNow('missing-id')).toEqual({ ok: false, code: 'not_found' })

    h.setOnline(false)
    expect(await h.controller.sendNow(doc.record.intentId)).toEqual({ ok: false, code: 'offline' })

    h.setOnline(true)
    expect(await h.controller.sendNow(doc.record.intentId)).toEqual({ ok: true })
    expect(h.upload).toHaveBeenCalledTimes(1)
    expect(h.commit).toHaveBeenCalledTimes(1)
  })

  it('cancelSave preserves the snapshot as a kept draft and removes the intent', async () => {
    const payload = new Uint8Array([9, 8, 7, 6])
    const doc = makeQueueDoc({ key: 'doc-1', state: 'queued', payload })
    const h = createHarness({ initialDocs: [doc] })

    const res = await h.controller.cancelSave(doc.record.intentId)
    expect(res).toEqual({ ok: true })
    expect(h.docs.has('doc-1')).toBe(false)

    const drafts = await h.draftStore.list('doc-1')
    expect(drafts).toHaveLength(1)
    expect(Array.from(drafts[0]!.snapshot)).toEqual([9, 8, 7, 6])
  })

  it('discardSave converts reconciling_stuck to kept draft and refuses with draft_cap or store_full leaving intent untouched', async () => {
    const stuckDoc = makeQueueDoc({ key: 'doc-stuck', state: 'reconciling-stuck' })
    const h = createHarness({ initialDocs: [stuckDoc] })

    // Seed 3 kept drafts to hit the per-document cap of 3
    for (let i = 1; i <= 3; i += 1) {
      const kept: DraftKeepResult = await h.draftStore.keep('doc-stuck', new Uint8Array([i]), {
        id: `existing-${i}`,
        createdAt: NOW_ISO,
        title: `Draft ${i}`,
      })
      expect(kept).toBe('ok')
    }

    // Refusal 1: draft_cap at 3 drafts — intent must stay reconciling-stuck in store and in memory
    const capRefusal = await h.controller.discardSave(stuckDoc.record.intentId)
    expect(capRefusal).toEqual({ ok: false, code: 'draft_cap' })
    expect(h.docs.get('doc-stuck')?.record.state).toBe('reconciling-stuck')
    expect(stuckDoc.record.state).toBe('reconciling-stuck')

    // Remove one draft so there is room, then discardSave succeeds
    await h.draftStore.remove('doc-stuck', 'existing-1')
    const okDiscard = await h.controller.discardSave(stuckDoc.record.intentId)
    expect(okDiscard).toEqual({ ok: true })
    expect(h.docs.has('doc-stuck')).toBe(false)
    expect(await h.draftStore.list('doc-stuck')).toHaveLength(3)

    // Refusal 2: store_full leaves the intent untouched
    const stuckFull = makeQueueDoc({ key: 'doc-stuck', state: 'reconciling-stuck' })
    const hFull = createHarness({ initialDocs: [stuckFull], storeFull: true })
    const fullRefusal = await hFull.controller.discardSave(stuckFull.record.intentId)
    expect(fullRefusal).toEqual({ ok: false, code: 'store_full' })
    expect(hFull.docs.get('doc-stuck')?.record.state).toBe('reconciling-stuck')
    expect(stuckFull.record.state).toBe('reconciling-stuck')
  })

  it('recheck performs a commit lookup without re-uploading bytes', async () => {
    const stuckDoc = makeQueueDoc({ key: 'doc-stuck', state: 'reconciling-stuck' })
    const h = createHarness({ initialDocs: [stuckDoc] })

    expect(await h.controller.recheck(stuckDoc.record.intentId)).toEqual({ ok: true })
    expect(h.lookupCommit).toHaveBeenCalledTimes(1)
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('copySupportCode writes the stuck row support code to the clipboard', async () => {
    const stuckDoc = makeQueueDoc({ key: 'doc-stuck', state: 'reconciling-stuck' })
    const h = createHarness({ initialDocs: [stuckDoc] })

    expect(await h.controller.copySupportCode(stuckDoc.record.intentId)).toEqual({ ok: true })
    expect(h.clipboardWrites).toEqual([`SUP-${stuckDoc.record.intentId}`])
  })

  it('saveMyCopy uses default name "{title} (bản của tôi).{ext}" and guards on canEdit', async () => {
    const payload = new Uint8Array([10, 20, 30])
    const stuckDoc = makeQueueDoc({ key: 'doc-stuck', state: 'reconciling-stuck', payload })
    const hEditable = createHarness({ initialDocs: [stuckDoc], canEdit: true })

    expect(await hEditable.controller.saveMyCopy(stuckDoc.record.intentId)).toEqual({ ok: true })
    expect(hEditable.savedCopies).toHaveLength(1)
    expect(hEditable.savedCopies[0]?.defaultFilename).toBe('Báo cáo Q3 (bản của tôi).docx')
    expect(Array.from(hEditable.savedCopies[0]!.bytes)).toEqual([10, 20, 30])

    // When canEdit is false, saveMyCopy refuses without writing a copy
    const hViewOnly = createHarness({ initialDocs: [stuckDoc], canEdit: false })
    expect(await hViewOnly.controller.saveMyCopy(stuckDoc.record.intentId)).toEqual({
      ok: false,
      code: 'other',
    })
    expect(hViewOnly.savedCopies).toHaveLength(0)
  })

  it('openDocument, openDraft (read-only), discardDraft, and retryStore execute as specified', async () => {
    const doc = makeQueueDoc({ key: 'doc-1', state: 'conflict' })
    const h = createHarness({ initialDocs: [doc] })
    await h.draftStore.keep('doc-draft', new Uint8Array([42]), {
      id: 'd-1',
      createdAt: NOW_ISO,
      title: 'Nháp 1',
    })

    expect(await h.controller.openDocument(doc.record.intentId)).toEqual({ ok: true })
    expect(h.openedDocs).toEqual(['doc-1'])

    expect(await h.controller.openDraft('draft:doc-draft:d-1')).toEqual({ ok: true })
    expect(h.openedDrafts).toEqual([{ documentKey: 'doc-draft', draftId: 'd-1', readOnly: true }])

    expect(await h.controller.discardDraft('draft:doc-draft:d-1')).toEqual({ ok: true })
    expect(await h.draftStore.list('doc-draft')).toHaveLength(0)

    h.setStoreError(true)
    expect(await h.controller.retryStore()).toEqual({ ok: true })
    expect(h.getRetryStoreCalls()).toBe(1)
  })

  it('discardDraft drops a blocked intent for the access-lost reasons without keeping a draft', async () => {
    const lost: Array<[SyncCenterBlockedReason, Partial<IntentRecordV2>]> = [
      ['permission_revoked', { lastError: 'permission_revoked' }],
      ['document_deleted', { lastError: 'document_deleted' }],
      ['member_deactivated', { lastError: 'member_deactivated' }],
      ['document_archived', {}],
    ]
    for (const [reason, record] of lost) {
      const doc = withRecord(makeQueueDoc({ key: 'doc-1', state: 'blocked' }), record)
      const h = createHarness({
        initialDocs: [doc],
        blockedReasons: reason === 'document_archived' ? { 'doc-1': 'document_archived' } : {},
      })

      expect(await h.controller.discardDraft(doc.record.intentId), reason).toEqual({ ok: true })
      expect(h.docs.has('doc-1'), reason).toBe(false)
      expect(await h.draftStore.list('doc-1'), reason).toHaveLength(0)
      const last = h.published[h.published.length - 1]
      expect(last?.state, reason).toBe('cancelled')
      expect(last?.cancelReason, reason).toBe('user')
    }
  })

  it('discardDraft refuses a blocked intent whose reason has no discard action and leaves it blocked', async () => {
    const cases: Array<[string, Partial<IntentRecordV2>, SyncCenterBlockedReason | undefined]> = [
      ['session_expired', { lastError: 'session_expired' }, undefined],
      ['organization_suspended', { lastError: 'organization_suspended' }, undefined],
      ['keystore_locked', { lastError: 'keystore_locked' }, undefined],
      ['store_full', { lastError: 'store_full' }, undefined],
      ['lease_expired', {}, 'lease_expired'],
      ['clock_rollback', {}, 'clock_rollback'],
    ]
    for (const [reason, record, explicit] of cases) {
      const doc = withRecord(makeQueueDoc({ key: 'doc-1', state: 'blocked' }), record)
      const h = createHarness({
        initialDocs: [doc],
        blockedReasons: explicit ? { 'doc-1': explicit } : {},
      })
      expect(await h.controller.discardDraft(doc.record.intentId), reason).toEqual({
        ok: false,
        code: 'busy',
      })
      expect(h.docs.get('doc-1')?.record.state, reason).toBe('blocked')
      expect(h.published, reason).toEqual([])
    }
  })

  it('discardDraft never discards an intent that is not blocked, and reports an unknown row', async () => {
    for (const state of ['queued', 'failed', 'conflict', 'reconciling-stuck'] as const) {
      const doc = makeQueueDoc({ key: 'doc-1', state })
      const h = createHarness({ initialDocs: [doc] })
      expect(await h.controller.discardDraft(doc.record.intentId), state).toEqual({
        ok: false,
        code: 'busy',
      })
      expect(h.docs.get('doc-1')?.record.state, state).toBe(state)
    }
    const h = createHarness()
    expect(await h.controller.discardDraft('missing-row')).toEqual({ ok: false, code: 'not_found' })
  })

  it('saveAgain supersedes a failed intent, then mints a new one from the same snapshot', async () => {
    const payload = new Uint8Array([4, 5, 6])
    const doc = withRecord(makeQueueDoc({ key: 'doc-1', state: 'failed', payload }), {
      lastError: 'quota_exceeded',
    })
    const old = doc.record
    const h = createHarness({ initialDocs: [doc] })

    expect(await h.controller.saveAgain(old.intentId)).toEqual({ ok: true })

    // the old intent was superseded first, before the new one was published
    expect(h.published.map((r) => [r.intentId, r.state, r.cancelReason])).toEqual([
      [old.intentId, 'cancelled', 'superseded'],
      ['office-intent-new-1', 'queued', undefined],
    ])
    const next = h.docs.get('doc-1')!.record
    expect(next.intentId).toBe('office-intent-new-1')
    expect(next.idempotencyKey).toBe('office-key-new-1')
    expect(next.state).toBe('queued')
    expect(next.generation).toBe(old.generation + 1)
    expect(next.attempt).toBe(0)
    expect(next.lastError).toBeUndefined()
    // same snapshot: bytes, checksum, base and binding carry over
    expect(next.checksum).toBe(old.checksum)
    expect(next.baseRevision).toBe(old.baseRevision)
    expect(next.baseVersion).toBe(old.baseVersion)
    expect(next.length).toBe(old.length)
    expect(next.documentId).toBe(old.documentId)
    expect(next.orgId).toBe(old.orgId)
    expect(Array.from(h.docs.get('doc-1')!.payload)).toEqual([4, 5, 6])
    // one durable write replaces the old intent with the new one: the new intent is never
    // preceded by a store state in which the old one is cancelled and no new one exists
    expect(h.writes).toEqual(['office-intent-new-1:queued'])
    // no draft is kept: nothing was discarded
    expect(await h.draftStore.list('doc-1')).toHaveLength(0)
  })

  it('saveAgain refuses a row that is not failed or unknown, leaving the intent untouched', async () => {
    const states = ['queued', 'blocked', 'conflict', 'reconciling', 'reconciling-stuck'] as const
    for (const state of states) {
      const doc = makeQueueDoc({ key: 'doc-1', state })
      const h = createHarness({ initialDocs: [doc] })
      expect(await h.controller.saveAgain(doc.record.intentId), state).toEqual({
        ok: false,
        code: 'busy',
      })
      expect(h.docs.get('doc-1')?.record.intentId, state).toBe(doc.record.intentId)
      expect(h.docs.get('doc-1')?.record.state, state).toBe(state)
      expect(h.published, state).toEqual([])
    }
    const h = createHarness()
    expect(await h.controller.saveAgain('missing-row')).toEqual({ ok: false, code: 'not_found' })
    expect(await h.controller.saveAgain('')).toEqual({ ok: false, code: 'not_found' })
  })

  it('saveAgain reports store_full when the store takes no new intent and keeps the old failed intent', async () => {
    const payload = new Uint8Array([7, 7, 7])
    const doc = withRecord(makeQueueDoc({ key: 'doc-1', state: 'failed', payload }), {
      lastError: 'quota_exceeded',
    })
    const old = { ...doc.record }
    const h = createHarness({ initialDocs: [doc], refuseNewIntent: true })
    expect(await h.controller.saveAgain(old.intentId)).toEqual({
      ok: false,
      code: 'store_full',
    })
    // the queued save is not lost: the stored record is the old one, still failed, same bytes
    const kept = h.docs.get('doc-1')!
    expect(kept.record).toEqual(old)
    expect(kept.record.state).toBe('failed')
    expect(Array.from(kept.payload)).toEqual([7, 7, 7])
    // no cancelled/superseded or new-intent status was announced
    expect(h.published).toEqual([])
    // and the row can still be saved again once there is room
    const snap = await h.controller.getSnapshot()
    expect(snap.tabs.attention.map((r) => [r.id, r.state])).toEqual([[old.intentId, 'failed']])
  })

  it('subscribe pushes a debounced fresh snapshot on state changes', async () => {
    const doc = makeQueueDoc({ key: 'doc-1', state: 'queued' })
    const h = createHarness({ initialDocs: [doc] })
    const received: string[] = []
    const unsubscribe = h.controller.subscribe((snap) => {
      received.push(snap.header.status)
    })

    h.setOnline(false)
    h.controller.notifyChanged()
    h.controller.notifyChanged()
    await new Promise((r) => setTimeout(r, 25))

    expect(received).toEqual(['offline'])
    unsubscribe()
  })

  it('registerSyncCenterIpc binds all Sync Center channels and forwards changed snapshots', async () => {
    const doc = makeQueueDoc({ key: 'doc-1', state: 'queued' })
    const h = createHarness({ initialDocs: [doc] })
    const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
    const pushed: string[] = []

    const unsubscribe = registerSyncCenterIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener)
        },
      },
      h.controller,
      {
        sendChanged: (snap) => pushed.push(snap.header.status),
      },
    )

    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.snapshot)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.syncNow)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.setSendingPaused)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.sendNow)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.cancelSave)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.recheck)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.copySupportCode)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.discardSave)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.openDocument)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.openDraft)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.discardDraft)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.saveAgain)).toBe(true)
    expect(UNIWORK_SYNC_CENTER_CHANNELS.saveAgain).toBe('uniwork-sync-center:save-again')
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.saveMyCopy)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.retryStore)).toBe(true)

    const pauseHandler = handlers.get(UNIWORK_SYNC_CENTER_CHANNELS.setSendingPaused)!
    expect(await pauseHandler({}, true)).toEqual({ ok: true })
    await new Promise((r) => setTimeout(r, 25))
    expect(pushed).toEqual(['paused'])
    unsubscribe()
  })
})
