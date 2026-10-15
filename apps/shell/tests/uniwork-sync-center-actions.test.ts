import { describe, expect, it, vi } from 'vitest'
import {
  createSyncCenterController,
  registerSyncCenterIpc,
} from '../src/main/uniwork-sync/sync-center'
import { UNIWORK_SYNC_CENTER_CHANNELS } from '../src/shared/sync-center'
import { QueueDispatcher, type QueueDoc, type QueueIntents } from '../src/main/uniwork-sync/queue/dispatcher'
import { createDraftStore, type DraftKeepResult, type DraftStore, type KeptDraft } from '../src/main/uniwork-sync/queue/drafts'
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

function makeQueueDoc(overrides: Partial<QueueDoc> & { state?: IntentRecordV2['state'] } = {}): QueueDoc {
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

function createHarness(options: {
  online?: boolean
  storeFull?: boolean
  canEdit?: boolean
  revokedDraft?: boolean
  initialDocs?: QueueDoc[]
} = {}) {
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
          supportCode: doc.record.state === 'reconciling-stuck' ? `SUP-${doc.record.intentId}` : undefined,
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
      const kept: DraftKeepResult = await h.draftStore.keep(
        'doc-stuck',
        new Uint8Array([i]),
        { id: `existing-${i}`, createdAt: NOW_ISO, title: `Draft ${i}` },
      )
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
    expect(h.openedDrafts).toEqual([
      { documentKey: 'doc-draft', draftId: 'd-1', readOnly: true },
    ])

    expect(await h.controller.discardDraft('draft:doc-draft:d-1')).toEqual({ ok: true })
    expect(await h.draftStore.list('doc-draft')).toHaveLength(0)

    h.setStoreError(true)
    expect(await h.controller.retryStore()).toEqual({ ok: true })
    expect(h.getRetryStoreCalls()).toBe(1)
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
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.saveMyCopy)).toBe(true)
    expect(handlers.has(UNIWORK_SYNC_CENTER_CHANNELS.retryStore)).toBe(true)

    const pauseHandler = handlers.get(UNIWORK_SYNC_CENTER_CHANNELS.setSendingPaused)!
    expect(await pauseHandler({}, true)).toEqual({ ok: true })
    await new Promise((r) => setTimeout(r, 25))
    expect(pushed).toEqual(['paused'])
    unsubscribe()
  })
})

