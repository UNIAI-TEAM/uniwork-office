/**
 * AC-4 of G5-06 (UNI-1352): the fork's REAL durable save queue against a REAL
 * D server carrying G5-07 (commit intents + the commit-intent lookup). The
 * suite skips unless UNIWORK_LIVE_ORIGIN names the deployment origin, so the
 * normal shell suite is unchanged.
 *
 * Cloud run (Linux VM, D repo root):
 *   HARNESS_SKIP_APP=1 bash scripts/office/g5g6g7/harness/start.sh
 *   source .harness-run/ports.env          # API_ORIGIN is the origin
 *   cd <fork clone> && UNIWORK_LIVE_ORIGIN=$API_ORIGIN npx vitest run --root apps/shell tests/live --reporter=verbose
 *   bash scripts/office/g5g6g7/harness/stop.sh
 *
 * Step 8 (office_sync_write off) needs the server started with
 * FF_OFFICE_SYNC_WRITE=false (the FF_ env override of the `office_sync_write`
 * registry key) AND UNIWORK_LIVE_EXPECT_SYNC_WRITE_OFF=1 on the test process;
 * that is server-wide, so it cannot share a run with steps 4 and 5, which then
 * skip with the reason printed.
 *
 * What is driven here is the production code, not a stand-in: the fork's
 * `createUniworkDocsClient` (upload / commit / lookupCommit) over the global
 * fetch, and the real `QueueDispatcher` over the real G5-04 store layer in a
 * temp directory (the intent store), a real per-document lock and the real
 * capability cache. Every failure message names the step and the HTTP method,
 * path and status; a token or password never enters one.
 *
 * Deviations from the AC-4 brief (each a stated gap, not a silent pass):
 *   - Step 1: the brief said a never-used Idempotency-Key looks up as
 *     `not_committed`. The shipped D contract (contract-p0 §3) and the shipped
 *     code answer 410 `commit_intent_unknown` for a key the server never
 *     received, "never a false not_committed". Step 1 asserts that shipped
 *     contract instead of a claim the server would fail.
 *   - Step 6 (`in_flight`) and step 7 (`unknown` after the retention sweep)
 *     skip with their reasons: the server exposes no way to hold a claim open,
 *     and the intent sweep runs every 10 minutes against a 7-day retention with
 *     no harness override (the numbers are the open gate G5-D2).
 */

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest'
import { createUniworkDocsClient, type UniworkDocsClient } from '../../src/main/uniwork-docs/client'
import { errorFromResponse } from '../../src/main/uniwork-docs/errors'
import { sha256Hex } from '../../src/main/uniwork-docs/formats'
import type { UniworkDocFormat } from '../../src/shared/home-api'
import { CapabilityCache } from '../../src/main/uniwork-sync/capability/cache'
import { createCapabilityFetch } from '../../src/main/uniwork-sync/capability/client'
import { createDocLock } from '../../src/main/uniwork-sync/doc-lock'
import {
  createIntentStore,
  INTENT_STORE_REGISTRATION,
  type IntentStore,
} from '../../src/main/uniwork-sync/intent-store'
import { createSafeStorageKeyProvider } from '../../src/main/uniwork-sync/keys'
import {
  QueueDispatcher,
  type QueueClient,
  type QueueDoc,
} from '../../src/main/uniwork-sync/queue/dispatcher'
import type { IntentRecordV2, QueueState } from '../../src/main/uniwork-sync/queue/record'
import { createStoreLayer, type StoreLayer } from '../../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../../src/main/uniwork-sync/test-kit/compliance'
import {
  LIVE,
  LIVE_ORIGIN,
  countedFetch,
  createLiveApi,
  envelopeCode,
  listDocumentVersions,
  seedFileDocument,
  seedLiveRun,
  tokenAuthorized,
  type CountedFetch,
  type LiveApi,
  type LiveSeed,
  type SeededFileDocument,
} from './live-harness'

/** the app capability route's shape (contract-p0 §4, `OfficeCapabilitiesSDO`) */
interface LiveCapabilities {
  sync_feed: boolean
  sync_write: boolean
  offline_library: boolean
  ai_uniwork: boolean
  ai_uniwork_formats: string[]
  ttl_seconds: number
}

/** how many upload / commit / lookup requests the client sent (a per-step oracle) */
interface ClientCounters {
  upload: number
  commit: number
  lookup: number
}

interface LiveState {
  origin: string
  api: LiveApi
  seed: LiveSeed
  docs: {
    lookup: SeededFileDocument
    commit: SeededFileDocument
    dispatch: SeededFileDocument
    settle: SeededFileDocument
    uploading: SeededFileDocument
    flagOff: SeededFileDocument
  }
  capabilities: LiveCapabilities
  http: CountedFetch
  counters: ClientCounters
  client: UniworkDocsClient
  intents: IntentStore
  dispatcher: QueueDispatcher
  published: IntentRecordV2[]
  root: string
  /** the Idempotency-Key step 2 committed with, replayed by step 3 */
  commitKey: string
}

let liveState: LiveState | null = null

function live(): LiveState {
  if (!liveState) throw new Error('the live suite has no seeded context')
  return liveState
}

function skipStep(context: TestContext, reason: string): void {
  context.skip(reason)
}

/** the reason steps 4 and 5 print when the run was started with FF_OFFICE_SYNC_WRITE=false */
function syncWriteOffNote(step: string): string {
  return (
    `${step}: office_sync_write is off for this run (FF_OFFICE_SYNC_WRITE=false), so a queued intent ` +
    'parks paused_admin and no byte moves; run without the override to ground this step'
  )
}

/** a minimal well-formed PDF the D file validator accepts (header + %%EOF trailer) */
function pdfBody(tag: string): Uint8Array {
  return new TextEncoder().encode(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n${tag}\n`,
  )
}

/** the real fork client behind per-verb counters; the round trip is untouched */
function observedClient(real: UniworkDocsClient, counters: ClientCounters): QueueClient {
  return {
    async upload(input) {
      counters.upload += 1
      return real.upload({ ...input, format: input.format as UniworkDocFormat })
    },
    async commit(input) {
      counters.commit += 1
      return real.commit(input)
    },
    async lookupCommit(input) {
      counters.lookup += 1
      return real.lookupCommit(input)
    },
  }
}

/** the counter snapshot a step compares its deltas against */
function snapshotCounters(s: LiveState): ClientCounters {
  return { ...s.counters }
}

function delta(after: number, before: number): number {
  return after - before
}

/** one queue document over a freshly seeded file document */
function makeQueueDoc(input: {
  key: string
  filename: string
  documentId: string
  orgId: string
  workspaceId: string
  baseRevision: string
  baseVersion: number
  payload: Uint8Array
  idempotencyKey: string
  state?: QueueState
}): QueueDoc {
  const checksum = sha256Hex(input.payload)
  const now = new Date().toISOString()
  const record: IntentRecordV2 = {
    v: 2,
    intentId: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    documentId: input.documentId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    baseRevision: input.baseRevision,
    baseVersion: input.baseVersion,
    checksum,
    length: input.payload.byteLength,
    generation: 1,
    state: input.state ?? 'queued',
    attempt: 0,
    createdAt: now,
    updatedAt: now,
  }
  return {
    key: input.key,
    path: join('/tmp', 'ac4', `${input.key}.pdf`),
    filename: input.filename,
    format: 'pdf',
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    baseVersion: input.baseVersion,
    record,
    payload: input.payload,
  }
}

describe.skipIf(!LIVE)('G5-06 AC-4 live: real D server against the fork durable save queue', () => {
  beforeAll(async () => {
    const origin = LIVE_ORIGIN
    const api = createLiveApi(origin)
    const seed = await seedLiveRun(api, 0)
    const [lookup, commit, dispatch, settle, uploading, flagOff] = await Promise.all([
      seedFileDocument(origin, seed.token, seed.workspaceId, 'ac4-lookup.pdf', pdfBody('lookup')),
      seedFileDocument(origin, seed.token, seed.workspaceId, 'ac4-commit.pdf', pdfBody('commit')),
      seedFileDocument(
        origin,
        seed.token,
        seed.workspaceId,
        'ac4-dispatch.pdf',
        pdfBody('dispatch'),
      ),
      seedFileDocument(origin, seed.token, seed.workspaceId, 'ac4-settle.pdf', pdfBody('settle')),
      seedFileDocument(
        origin,
        seed.token,
        seed.workspaceId,
        'ac4-uploading.pdf',
        pdfBody('uploading'),
      ),
      seedFileDocument(origin, seed.token, seed.workspaceId, 'ac4-flagoff.pdf', pdfBody('flagoff')),
    ])

    // the capability the server reports for the seeded org: sync_write is true
    // in the default run and false only when the server started with
    // FF_OFFICE_SYNC_WRITE=false (step 8's run)
    const raw = await api.ok(
      'setup:capability',
      'GET',
      `/api/v1/orgs/${encodeURIComponent(seed.orgId)}/office/capabilities`,
      { token: seed.token },
    )
    const capabilities = raw.body as LiveCapabilities

    const root = mkdtempSync(join(tmpdir(), 'uw-ac4-live-'))
    const safeStorage = createLockableSafeStorage()
    const layer: StoreLayer = createStoreLayer({
      root: join(root, 'records'),
      keys: createSafeStorageKeyProvider({ safeStorage, dir: join(root, 'keys') }),
      budgetBytes: 1 << 20,
      clock: () => Date.now(),
    })
    layer.register(INTENT_STORE_REGISTRATION)
    const scope = { deploymentId: 'default', accountId: seed.userId }
    const opened = await layer.open(scope)
    if (opened.kind !== 'ok') throw new Error(`the intent store did not open: ${opened.kind}`)
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))

    const http = countedFetch()
    const client = createUniworkDocsClient({
      apiOrigin: origin,
      authorized: tokenAuthorized(seed.token),
      isSignedIn: () => true,
      fetch: http.fetch,
    })
    const counters: ClientCounters = { upload: 0, commit: 0, lookup: 0 }

    const capability = new CapabilityCache({
      fetch: createCapabilityFetch({
        apiOrigin: origin,
        authorized: tokenAuthorized(seed.token),
        isSignedIn: () => true,
        fetch: http.fetch,
      }),
      clock: { now: () => Date.now() },
    })

    const published: IntentRecordV2[] = []
    const dispatcher = new QueueDispatcher({
      intents: async () => ({ kind: 'ok', intents }),
      client: observedClient(client, counters),
      capability,
      lock: createDocLock({
        root: join(root, 'locks'),
        scope,
        clock: () => Date.now(),
        owner: 'ac4-live',
      }),
      clock: () => Date.now(),
      publish: (record) => published.push(record),
      uuid: () => randomUUID(),
    })

    liveState = {
      origin,
      api,
      seed,
      docs: { lookup, commit, dispatch, settle, uploading, flagOff },
      capabilities,
      http,
      counters,
      client,
      intents,
      dispatcher,
      published,
      root,
      commitKey: '',
    }
  }, 180_000)

  afterAll(() => {
    if (liveState) rmSync(liveState.root, { recursive: true, force: true })
    liveState = null
  })

  it('1. lookup of a never-received key: 410 commit_intent_unknown, never a false not_committed', async () => {
    const s = live()
    const documentId = s.docs.lookup.documentId
    const key = `ac4-never-${randomUUID()}`
    const path = `/api/v1/documents/${encodeURIComponent(documentId)}/versions/commit`

    const raw = await s.api.request('1.never-used:read', 'GET', path, {
      token: s.seed.token,
      headers: { 'Idempotency-Key': key },
    })
    expect(raw.status, `1.never-used:read: GET ${path} must answer 410`).toBe(410)
    expect(
      envelopeCode(raw.body),
      '1.never-used:read: the 410 must carry commit_intent_unknown',
    ).toBe('commit_intent_unknown')

    // the fork's client maps the 410 to the `unknown` verdict, never a failure
    const lookup = await s.client.lookupCommit({ documentId, idempotencyKey: key })
    expect(
      lookup.outcome,
      '1: a never-received key must read as unknown (410 commit_intent_unknown)',
    ).toBe('unknown')
    expect(
      lookup.outcome,
      '1: the server must never fake not_committed for a key it holds nothing for',
    ).not.toBe('not_committed')
    expect(lookup.outcome, '1: an unknown key can never read as committed').not.toBe('committed')

    // the raw 410 the server actually sent maps to the client's `intent_unknown`
    // (never the tombstone `deleted`): the D behaviour the lane's reconciling
    // path depends on (packet residual Q1)
    const mapped = errorFromResponse(raw.status, raw.body)
    expect(mapped.code, '1: the live 410 commit_intent_unknown must map to intent_unknown').toBe(
      'intent_unknown',
    )
    expect(mapped.code, '1: a commit-intent 410 is never the tombstone deleted').not.toBe('deleted')
  }, 60_000)

  it('2. commit with a key: a receipt, and the lookup reports the same version and revision', async () => {
    const s = live()
    const documentId = s.docs.commit.documentId
    const key = `ac4-commit-${randomUUID()}`
    s.commitKey = key
    const payload = pdfBody('ac4-commit-v2')

    const upload = await s.client.upload({
      documentId,
      bytes: payload,
      filename: 'ac4-commit.pdf',
      format: 'pdf',
      idempotencyKey: `${key}-upload`,
    })
    const receipt = await s.client.commit({
      documentId,
      uploadId: upload.uploadId,
      baseRevision: s.docs.commit.revision,
      idempotencyKey: key,
    })
    expect(receipt.documentId, '2: the commit receipt names the document').toBe(documentId)
    expect(receipt.version, '2: the commit produced a version').toBeGreaterThan(
      s.docs.commit.currentVersion,
    )

    const lookup = await s.client.lookupCommit({ documentId, idempotencyKey: key })
    expect(lookup.outcome, '2: the lookup of a committed key must be committed').toBe('committed')
    if (lookup.outcome !== 'committed') return
    expect(
      lookup.receipt.versionId,
      '2: the lookup must name the version the commit produced',
    ).toBe(receipt.versionId)
    expect(lookup.receipt.version, '2: the lookup must report the same version number').toBe(
      receipt.version,
    )
    expect(lookup.receipt.revision, '2: the lookup must report the same document revision').toBe(
      receipt.revision,
    )
  }, 90_000)

  it('3. replay of the same key: the stored answer, no second version', async () => {
    const s = live()
    const documentId = s.docs.commit.documentId
    const key = s.commitKey
    expect(key, '3: step 2 must have committed with a key').toBeTruthy()

    const before = await listDocumentVersions(s.api, s.seed.token, documentId)
    expect(before.count, '3: step 2 must have left at least two versions').toBeGreaterThanOrEqual(2)

    const upload = await s.client.upload({
      documentId,
      bytes: pdfBody('ac4-commit-v2'),
      filename: 'ac4-commit.pdf',
      format: 'pdf',
      idempotencyKey: `ac4-commit-replay-upload-${randomUUID()}`,
    })
    // the replay of a committed key answers from the idempotency ledger: the
    // same upload, the same base revision, the same key, the same version
    const receipt = await s.client.commit({
      documentId,
      uploadId: upload.uploadId,
      baseRevision: s.docs.commit.revision,
      idempotencyKey: key,
    })
    expect(receipt.versionId, '3: the replay must name the version step 2 produced').toBeTruthy()

    const after = await listDocumentVersions(s.api, s.seed.token, documentId)
    expect(after.count, '3: a replay must not append a version').toBe(before.count)
    expect([...after.ids].sort(), '3: the version list must be unchanged').toEqual(
      [...before.ids].sort(),
    )
  }, 90_000)

  it('4. a queued intent dispatched by the QueueDispatcher: exactly one version, a second pass does nothing', async (context) => {
    const s = live()
    if (!s.capabilities.sync_write) {
      skipStep(context, syncWriteOffNote('4'))
      return
    }
    const seeded = s.docs.dispatch
    const doc = makeQueueDoc({
      key: 'ac4-dispatch',
      filename: 'ac4-dispatch.pdf',
      documentId: seeded.documentId,
      orgId: s.seed.orgId,
      workspaceId: s.seed.workspaceId,
      baseRevision: seeded.revision,
      baseVersion: seeded.currentVersion,
      payload: pdfBody('ac4-dispatch-v2'),
      idempotencyKey: `ac4-dispatch-${randomUUID()}`,
    })
    const before = await listDocumentVersions(s.api, s.seed.token, seeded.documentId)

    const state = await s.dispatcher.enqueue(doc)
    expect(state, '4: a queued intent starts queued when sync_write is on').toBe('queued')

    const first = await s.dispatcher.dispatchAll([doc])
    expect(first.outcomes.get(doc.key), '4: the dispatcher must commit the queued intent').toBe(
      'committed',
    )
    expect(first.dispatched, '4: the first pass dispatches one document').toBe(1)

    const after = await listDocumentVersions(s.api, s.seed.token, seeded.documentId)
    expect(after.count, '4: exactly one version was appended').toBe(before.count + 1)

    const second = await s.dispatcher.dispatchAll([doc])
    expect(second.dispatched, '4: a second pass on a settled intent dispatches nothing').toBe(0)
    const again = await listDocumentVersions(s.api, s.seed.token, seeded.documentId)
    expect(again.count, '4: a second pass must not append a version').toBe(after.count)
    expect(
      s.published.filter((record) => record.documentId === seeded.documentId).at(-1)?.state,
      '4: the last published record for the document is committed',
    ).toBe('committed')
  }, 120_000)

  it('5. an intent left committing at rest resolves by lookup to committed, no second version', async (context) => {
    const s = live()
    if (!s.capabilities.sync_write) {
      skipStep(context, syncWriteOffNote('5'))
      return
    }
    const seeded = s.docs.settle
    const documentId = seeded.documentId
    const key = `ac4-settle-${randomUUID()}`

    // the commit already landed server-side (a crash after the POST): do it
    // through the client, then leave a record at rest in `committing`
    const upload = await s.client.upload({
      documentId,
      bytes: pdfBody('ac4-settle-v2'),
      filename: 'ac4-settle.pdf',
      format: 'pdf',
      idempotencyKey: `${key}-upload`,
    })
    const receipt = await s.client.commit({
      documentId,
      uploadId: upload.uploadId,
      baseRevision: seeded.revision,
      idempotencyKey: key,
    })
    expect(receipt.versionId, '5: the direct commit produced a version').toBeTruthy()
    const before = await listDocumentVersions(s.api, s.seed.token, documentId)
    // the counters wrap only the dispatcher's client, and the direct upload and
    // commit above went through the real `s.client` (uncounted): snapshot AFTER
    // them so each delta below measures the settle pass alone (G5-06 stage FG)
    const settleStart = snapshotCounters(s)

    const doc = makeQueueDoc({
      key: 'ac4-settle',
      filename: 'ac4-settle.pdf',
      documentId,
      orgId: s.seed.orgId,
      workspaceId: s.seed.workspaceId,
      baseRevision: seeded.revision,
      baseVersion: seeded.currentVersion,
      payload: pdfBody('ac4-settle-v2'),
      idempotencyKey: key,
      state: 'committing',
    })
    // persist the at-rest record so the pass owns it (driving() reads the store)
    const written = await s.intents.put(doc.key, doc.record, doc.payload)
    expect(written.kind, '5: the at-rest record must be persisted').toBe('ok')

    const result = await s.dispatcher.dispatchAll([doc])
    expect(
      result.outcomes.get(doc.key),
      '5: the pass must settle the at-rest record to committed by lookup',
    ).toBe('committed')
    expect(
      delta(s.counters.lookup, settleStart.lookup),
      '5: settling by lookup issues exactly one lookup',
    ).toBe(1)
    expect(
      delta(s.counters.upload, settleStart.upload),
      '5: settling must never re-upload a byte',
    ).toBe(0)
    expect(
      delta(s.counters.commit, settleStart.commit),
      '5: settling must never issue a second commit',
    ).toBe(0)

    const after = await listDocumentVersions(s.api, s.seed.token, documentId)
    expect(after.count, '5: settling must not append a second version').toBe(before.count)
    expect([...after.ids].sort(), '5: the version list must be unchanged').toEqual(
      [...before.ids].sort(),
    )
    expect(
      await s.intents.read(doc.key, {
        orgId: doc.orgId,
        workspaceId: doc.workspaceId,
        baseVersion: doc.baseVersion,
        length: doc.record.length,
      }),
      '5: a committed intent is cleaned up from the store',
    ).toBeNull()
  }, 120_000)

  it('5b. an uploading record at rest for a never-received key re-sends the SAME key', async (context) => {
    const s = live()
    if (!s.capabilities.sync_write) {
      skipStep(context, syncWriteOffNote('5b'))
      return
    }
    const seeded = s.docs.uploading
    const documentId = seeded.documentId
    const key = `ac4-uploading-${randomUUID()}`

    // the record is at rest in `uploading` but the server never received the
    // key (no commit POST was made): a lookup would answer 410
    // commit_intent_unknown, so the pass must requeue it with the SAME key and
    // re-send it - 0 lookups, one upload, one commit, exactly one new version
    const doc = makeQueueDoc({
      key: 'ac4-uploading',
      filename: 'ac4-uploading.pdf',
      documentId,
      orgId: s.seed.orgId,
      workspaceId: s.seed.workspaceId,
      baseRevision: seeded.revision,
      baseVersion: seeded.currentVersion,
      payload: pdfBody('ac4-uploading-v2'),
      idempotencyKey: key,
      state: 'uploading',
    })
    const written = await s.intents.put(doc.key, doc.record, doc.payload)
    expect(written.kind, '5b: the at-rest record must be persisted').toBe('ok')
    const before = await listDocumentVersions(s.api, s.seed.token, documentId)
    const start = snapshotCounters(s)

    const result = await s.dispatcher.dispatchAll([doc])
    expect(
      result.outcomes.get(doc.key),
      '5b: the pass must re-send the uploading-at-rest record to committed',
    ).toBe('committed')
    expect(
      delta(s.counters.lookup, start.lookup),
      '5b: an uploading-at-rest record must never be settled by lookup (the server never received the key)',
    ).toBe(0)
    expect(
      delta(s.counters.upload, start.upload),
      '5b: the pass re-uploads the payload exactly once',
    ).toBe(1)
    expect(
      delta(s.counters.commit, start.commit),
      '5b: the pass commits exactly once with the same key',
    ).toBe(1)

    const after = await listDocumentVersions(s.api, s.seed.token, documentId)
    expect(after.count, '5b: exactly one new version was appended').toBe(before.count + 1)
    expect(
      await s.intents.read(doc.key, {
        orgId: doc.orgId,
        workspaceId: doc.workspaceId,
        baseVersion: doc.baseVersion,
        length: doc.record.length,
      }),
      '5b: a committed intent is cleaned up from the store',
    ).toBeNull()

    const second = await s.dispatcher.dispatchAll([doc])
    expect(second.dispatched, '5b: a second pass on a settled intent dispatches nothing').toBe(0)
    const again = await listDocumentVersions(s.api, s.seed.token, documentId)
    expect(again.count, '5b: a second pass must not append a version').toBe(after.count)
    expect(
      [...again.ids].sort(),
      '5b: a second pass must leave the version list unchanged',
    ).toEqual([...after.ids].sort())
  }, 120_000)

  it('6. lookup in_flight: needs a way to hold a claim open', async (context) => {
    skipStep(
      context,
      '6: the server exposes no way to hold a commit-intent claim open for a lookup (the claim is ' +
        'live only inside a real in-flight commit POST, TTL DOCUMENT_COMMIT_INTENT_CLAIM_TTL, ' +
        'default 2m), so in_flight cannot be grounded from the harness; stated gap G5-D2',
    )
  }, 30_000)

  it('7. lookup unknown after the retention sweep: pending G5-D2 retention numbers', async (context) => {
    skipStep(
      context,
      '7: commit_intent_unknown for a SWEPT intent is only reachable after the server retention sweep ' +
        '(DOCUMENT_COMMIT_INTENT_RETENTION, default 7 days) and the sweep tick is fixed at 10 minutes ' +
        'with no harness/env override, so a short-retention run cannot ground it; the never-received ' +
        'key form of the same 410 is asserted in step 1. Pending G5-D2 retention numbers',
    )
  }, 30_000)

  it('8. sync_write off: a queued intent parks paused_admin and no request reaches the server', async (context) => {
    const s = live()
    if (process.env.UNIWORK_LIVE_EXPECT_SYNC_WRITE_OFF !== '1') {
      skipStep(
        context,
        '8: office_sync_write is on for this run (D keys.go default true); ground the off path by ' +
          'starting the harness server with FF_OFFICE_SYNC_WRITE=false and running with ' +
          'UNIWORK_LIVE_EXPECT_SYNC_WRITE_OFF=1, and do not reuse that origin for steps 4-5',
      )
      return
    }
    expect(
      s.capabilities.sync_write,
      '8: the run must be started with FF_OFFICE_SYNC_WRITE=false (capability sync_write false)',
    ).toBe(false)

    const seeded = s.docs.flagOff
    const doc = makeQueueDoc({
      key: 'ac4-flagoff',
      filename: 'ac4-flagoff.pdf',
      documentId: seeded.documentId,
      orgId: s.seed.orgId,
      workspaceId: s.seed.workspaceId,
      baseRevision: seeded.revision,
      baseVersion: seeded.currentVersion,
      payload: pdfBody('ac4-flagoff-v2'),
      idempotencyKey: `ac4-flagoff-${randomUUID()}`,
    })
    const start = snapshotCounters(s)

    const state = await s.dispatcher.enqueue(doc)
    expect(state, '8: a queued intent parks paused_admin when sync_write is off').toBe(
      'paused_admin',
    )
    const pass = await s.dispatcher.dispatchAll([doc])
    expect(pass.outcomes.get(doc.key), '8: the pass leaves the intent parked paused_admin').toBe(
      'paused_admin',
    )
    expect(pass.dispatched, '8: a parked lane dispatches nothing').toBe(0)

    expect(
      delta(s.counters.upload, start.upload),
      '8: no upload request may reach the server',
    ).toBe(0)
    expect(
      delta(s.counters.commit, start.commit),
      '8: no commit request may reach the server',
    ).toBe(0)
    expect(
      delta(s.counters.lookup, start.lookup),
      '8: no lookup request may reach the server',
    ).toBe(0)

    const stored = await s.intents.read(doc.key, {
      orgId: doc.orgId,
      workspaceId: doc.workspaceId,
      baseVersion: doc.baseVersion,
      length: doc.record.length,
    })
    expect(stored, '8: the queue keeps the intent (nothing is deleted)').toBeTruthy()
    expect(stored?.intent.state, '8: the stored intent stays parked').toBe('paused_admin')

    const versions = await listDocumentVersions(s.api, s.seed.token, seeded.documentId)
    expect(versions.count, '8: the parked intent produced no version').toBe(1)
  }, 90_000)
})
