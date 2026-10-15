import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Binding, BoundDocument } from '../src/main/uniwork-docs/binding-store'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { sha256Hex } from '../src/main/uniwork-docs/formats'
import type { CommitLookup } from '../src/main/uniwork-docs/parse'
import { SaveCoordinator } from '../src/main/uniwork-docs/save-coordinator'
import type { DocLock } from '../src/main/uniwork-sync/doc-lock'
import {
  createIntentStore,
  INTENT_STORE_REGISTRATION,
  type IntentStore,
} from '../src/main/uniwork-sync/intent-store'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import {
  QueueDispatcher,
  type QueueClient,
  type QueueDoc,
} from '../src/main/uniwork-sync/queue/dispatcher'
import { createDraftStore, DRAFTS_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/drafts'
import { QUEUE_LIMITS } from '../src/main/uniwork-sync/queue/limits'
import { createPauseStore, PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
import type { IntentRecordV2 } from '../src/main/uniwork-sync/queue/record'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import {
  readTestQueueLimit,
  setTestPackagedOverride,
} from '../src/main/uniwork-sync/test-hooks/limits'
import {
  traceIntentTransition,
  type IntentTraceLine,
} from '../src/main/uniwork-sync/test-hooks/trace'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'

const ALLOWED_TRACE_KEYS = new Set([
  'ts',
  'intentId',
  'documentId',
  'from',
  'to',
  'httpStatus',
  'code',
])

const CANARY_SECRETS = {
  title: 'Confidential-Board-Acquisition-Plan-2026.docx',
  filename: 'secret-payroll-export-2026.docx',
  content: 'TOP_SECRET_DOCUMENT_PAYLOAD_BYTES_99887766',
  pathSeg: 'alice.nguyen@corp-secret.example.com',
  userId: 'usr_sensitive_account_445566',
  token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.super_secret_access_token',
  idempotencyKey: 'office-key-secret-idempotency-11223344',
  url: 'https://internal-vault.corp-secret.example.com/api/v1/documents',
}

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'uw-sync-hooks-'))
  delete process.env.UNIWORK_SYNC_TRACE_FILE
  delete process.env.UNIWORK_SYNC_TEST_STUCK_AFTER_MS
  delete process.env.UNIWORK_SYNC_TEST_RECHECK_MS
  setTestPackagedOverride(undefined)
})

afterEach(() => {
  delete process.env.UNIWORK_SYNC_TRACE_FILE
  delete process.env.UNIWORK_SYNC_TEST_STUCK_AFTER_MS
  delete process.env.UNIWORK_SYNC_TEST_RECHECK_MS
  setTestPackagedOverride(undefined)
  rmSync(tempDir, { recursive: true, force: true })
})

function readTraceLines(file: string): IntentTraceLine[] {
  const raw = readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split('\n').map((line) => JSON.parse(line) as IntentTraceLine)
}

function assertOnlyAllowedKeys(lines: IntentTraceLine[]): void {
  expect(lines.length).toBeGreaterThan(0)
  for (const line of lines) {
    const keys = Object.keys(line)
    for (const key of keys) {
      expect(ALLOWED_TRACE_KEYS.has(key)).toBe(true)
    }
    expect(keys).toEqual(expect.arrayContaining(['ts', 'intentId', 'documentId', 'from', 'to']))
  }
}

function assertNoCanaryLeaks(rawFileContent: string): void {
  for (const secret of Object.values(CANARY_SECRETS)) {
    expect(rawFileContent).not.toContain(secret)
  }
}

async function buildFixture() {
  let now = Date.parse('2026-10-15T02:00:00.000Z')
  const safeStorage = createLockableSafeStorage()
  const layer = createStoreLayer({
    root: join(tempDir, 'records'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(tempDir, 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => now,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  layer.register(DRAFTS_STORE_REGISTRATION)
  layer.register(PAUSE_STORE_REGISTRATION)
  const scope = { deploymentId: 'default', accountId: CANARY_SECRETS.userId }
  const opened = await layer.open(scope)
  if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
  const intents: IntentStore = createIntentStore(
    opened.store.records(INTENT_STORE_REGISTRATION.name),
  )
  const drafts = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
  const pause = createPauseStore(opened.store.records(PAUSE_STORE_REGISTRATION.name))

  const payload = new TextEncoder().encode(CANARY_SECRETS.content)
  const checksum = sha256Hex(payload)
  const serverState = {
    uploadError: null as UniworkDocError | null,
    commitError: null as UniworkDocError | null,
    lookupError: null as UniworkDocError | null,
    lookupOutcome: 'committed' as CommitLookup['outcome'],
  }

  const client: QueueClient = {
    async upload() {
      if (serverState.uploadError) throw serverState.uploadError
      return { uploadId: 'up_1', checksumSha256: checksum }
    },
    async commit(input) {
      if (serverState.commitError) throw serverState.commitError
      return {
        documentId: input.documentId,
        versionId: 'ver_2',
        version: 2,
        revision: '12',
        checksumSha256: checksum,
      }
    },
    async lookupCommit() {
      if (serverState.lookupError) throw serverState.lookupError
      if (serverState.lookupOutcome === 'committed') {
        return {
          outcome: 'committed',
          receipt: { versionId: 'ver_2', version: 2, revision: '12' },
        }
      }
      if (serverState.lookupOutcome === 'unknown') return { outcome: 'unknown' }
      return { outcome: serverState.lookupOutcome }
    },
  }

  const lock: DocLock = {
    acquire: async () => ({ kind: 'held', generation: 1 }),
    heartbeat: async () => true,
    check: async () => true,
    release: async () => undefined,
  }

  const dispatcher = new QueueDispatcher({
    intents: async () => ({ kind: 'ok', intents }),
    client,
    capability: {
      get: async () => ({ kind: 'ok', capabilities: { sync_write: true }, source: 'fresh' }),
    },
    lock,
    pause,
    drafts,
    clock: () => now,
    random: () => 0.5,
    publish: () => undefined,
  })

  const docPath = join(tempDir, CANARY_SECRETS.pathSeg, 'doc_1', CANARY_SECRETS.filename)
  const binding: Binding = {
    schema: 2,
    documentId: 'doc_1',
    workspaceId: 'ws_1',
    orgId: 'org_1',
    title: CANARY_SECRETS.title,
    filename: CANARY_SECRETS.filename,
    format: 'docx',
    access: 'edit',
    baseRevision: '11',
    baseVersion: 1,
    baseChecksum: sha256Hex(new TextEncoder().encode('previous-v1')),
    state: 'dirty',
    minStoreLevel: 2,
    minAppVersion: '0.0.0',
  }
  const boundDoc: BoundDocument = {
    path: docPath,
    dir: join(tempDir, CANARY_SECRETS.pathSeg, 'doc_1'),
    deploymentId: CANARY_SECRETS.url,
    userId: CANARY_SECRETS.userId,
    key: 'doc_1',
    binding,
  }
  const bindingMap = new Map<string, BoundDocument>([[docPath, boundDoc]])
  const coordinator = new SaveCoordinator({
    store: {
      classify: (p: string) => {
        const found = bindingMap.get(p)
        return found ? { kind: 'bound' as const, doc: found } : { kind: 'plain' as const }
      },
      lookup: (p: string) => bindingMap.get(p) ?? null,
      write: async (dir: string, nextBinding: Binding) => {
        for (const [k, v] of bindingMap) {
          if (v.dir === dir) bindingMap.set(k, { ...v, binding: nextBinding })
        }
        return true
      },
    } as never,
    client: {
      upload: (input) => client.upload(input),
      commit: (input) => client.commit(input),
      getDocument: async () => {
        throw new UniworkDocError('not_found')
      },
    },
    isSignedIn: () => true,
    ownsBinding: () => true,
    intents: async () => ({ kind: 'ok', intents }),
    publish: () => undefined,
    now: () => new Date(now),
    uuid: () => 'u_save_1',
    readBytes: async () => payload,
    capability: {
      get: async () => ({ kind: 'ok', capabilities: { sync_write: true }, source: 'fresh' }),
    },
    pause,
    drafts,
    dispatcher,
  })

  const record: IntentRecordV2 = {
    v: 2,
    intentId: 'intent_doc_1',
    idempotencyKey: CANARY_SECRETS.idempotencyKey,
    documentId: 'doc_1',
    orgId: 'org_1',
    workspaceId: 'ws_1',
    baseRevision: '11',
    baseVersion: 1,
    checksum,
    length: payload.byteLength,
    generation: 1,
    state: 'queued',
    attempt: 0,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
  const queueDoc: QueueDoc = {
    key: 'doc_1',
    path: docPath,
    filename: CANARY_SECRETS.filename,
    format: 'docx',
    orgId: 'org_1',
    workspaceId: 'ws_1',
    baseVersion: 1,
    record,
    payload,
  }

  return {
    advance: (ms: number) => {
      now += ms
    },
    getNow: () => now,
    serverState,
    dispatcher,
    coordinator,
    queueDoc,
    docPath,
  }
}

describe('UNI-1380 G7-03a test-only sync trace + queue timer hooks', () => {
  it('trace is off when UNIWORK_SYNC_TRACE_FILE is unset or packaged (no file created)', async () => {
    const traceFile = join(tempDir, 'nested', 'intent-trace.jsonl')
    const fx = await buildFixture()
    await fx.dispatcher.enqueue(fx.queueDoc)
    await fx.dispatcher.dispatchAll([fx.queueDoc])
    expect(existsSync(traceFile)).toBe(false)

    // Packaged build also keeps tracing off even when UNIWORK_SYNC_TRACE_FILE is set
    process.env.UNIWORK_SYNC_TRACE_FILE = traceFile
    setTestPackagedOverride(true)
    const fxPackaged = await buildFixture()
    await fxPackaged.dispatcher.enqueue(fxPackaged.queueDoc)
    await fxPackaged.dispatcher.dispatchAll([fxPackaged.queueDoc])
    expect(existsSync(traceFile)).toBe(false)
  })

  it('writes only allowlisted keys on queue transitions and never leaks document content, title, path, token, key, user or URL', async () => {
    const traceFile = join(tempDir, 'trace', 'intent-log.jsonl')
    process.env.UNIWORK_SYNC_TRACE_FILE = traceFile

    const fx = await buildFixture()
    // 1. Enqueue (null -> queued)
    await fx.dispatcher.enqueue(fx.queueDoc)
    // 2. Dispatch fails commit with 503 timeout/network -> validating -> uploading -> committing -> reconciling
    fx.serverState.commitError = new UniworkDocError('timeout')
    await fx.dispatcher.dispatchAll([fx.queueDoc])
    expect(fx.queueDoc.record.state).toBe('reconciling')

    // 3. Lookup fails with 403 organization_suspended -> blocked
    fx.serverState.lookupError = new UniworkDocError('organization_suspended', {
      status: 403,
      serverCode: 'organization_suspended',
    })
    await fx.dispatcher.reconcile(fx.queueDoc)
    expect(fx.queueDoc.record.state).toBe('blocked')

    // Even if extra fields are passed via untyped object, traceIntentTransition strips them
    traceIntentTransition({
      ts: fx.getNow(),
      intentId: 'intent_doc_1',
      documentId: 'doc_1',
      from: 'blocked',
      to: 'queued',
      ...CANARY_SECRETS,
    } as unknown as Parameters<typeof traceIntentTransition>[0])

    const raw = readFileSync(traceFile, 'utf8')
    assertNoCanaryLeaks(raw)

    const lines = readTraceLines(traceFile)
    assertOnlyAllowedKeys(lines)

    expect(
      lines.map((l) => ({ from: l.from, to: l.to, httpStatus: l.httpStatus, code: l.code })),
    ).toEqual([
      { from: null, to: 'queued', httpStatus: undefined, code: undefined },
      { from: 'queued', to: 'validating', httpStatus: undefined, code: undefined },
      { from: 'validating', to: 'uploading', httpStatus: undefined, code: undefined },
      { from: 'uploading', to: 'committing', httpStatus: undefined, code: undefined },
      { from: 'committing', to: 'reconciling', httpStatus: undefined, code: 'timeout' },
      {
        from: 'reconciling',
        to: 'blocked',
        httpStatus: 403,
        code: 'organization_suspended',
      },
      { from: 'blocked', to: 'queued', httpStatus: undefined, code: undefined },
    ])
  })

  it('records Ctrl+S SaveCoordinator inline mint, settle, and conflict failure transitions in trace', async () => {
    const traceFile = join(tempDir, 'trace', 'coordinator-trace.jsonl')
    process.env.UNIWORK_SYNC_TRACE_FILE = traceFile

    const fx = await buildFixture()
    await fx.coordinator.save(fx.docPath)

    let raw = readFileSync(traceFile, 'utf8')
    assertNoCanaryLeaks(raw)
    let lines = readTraceLines(traceFile)
    assertOnlyAllowedKeys(lines)
    expect(
      lines.map((l) => ({ from: l.from, to: l.to, httpStatus: l.httpStatus, code: l.code })),
    ).toEqual([
      { from: null, to: 'queued', httpStatus: undefined, code: undefined },
      { from: 'queued', to: 'committed', httpStatus: 200, code: undefined },
    ])

    // Second Ctrl+S that hits a 409 version conflict records mint + conflict with httpStatus 409
    const fxConflict = await buildFixture()
    fxConflict.serverState.commitError = new UniworkDocError('conflict', {
      status: 409,
      serverCode: 'document_version_conflict',
      currentRevision: '99',
    })
    await fxConflict.coordinator.save(fxConflict.docPath)

    raw = readFileSync(traceFile, 'utf8')
    assertNoCanaryLeaks(raw)
    lines = readTraceLines(traceFile)
    assertOnlyAllowedKeys(lines)
    expect(
      lines
        .slice(2)
        .map((l) => ({ from: l.from, to: l.to, httpStatus: l.httpStatus, code: l.code })),
    ).toEqual([
      { from: null, to: 'queued', httpStatus: undefined, code: undefined },
      { from: 'queued', to: 'conflict', httpStatus: 409, code: 'conflict' },
    ])
  })

  it('honours stuckAfterMs and recheckMs overrides only with UNIWORK_SYNC_TRACE_FILE set and unpackaged; ignores invalid values', async () => {
    // 1. Defaults when unset
    expect(QUEUE_LIMITS.stuckAfterMs).toBe(3_600_000)
    expect(QUEUE_LIMITS.recheckMs).toBe(900_000)

    // 2. Ignored when UNIWORK_SYNC_TRACE_FILE is unset
    process.env.UNIWORK_SYNC_TEST_STUCK_AFTER_MS = '1200'
    process.env.UNIWORK_SYNC_TEST_RECHECK_MS = '400'
    expect(QUEUE_LIMITS.stuckAfterMs).toBe(3_600_000)
    expect(QUEUE_LIMITS.recheckMs).toBe(900_000)

    // 3. Applied when both trace env and positive-integer overrides are set
    const traceFile = join(tempDir, 'limits-trace.jsonl')
    process.env.UNIWORK_SYNC_TRACE_FILE = traceFile
    expect(QUEUE_LIMITS.stuckAfterMs).toBe(1_200)
    expect(QUEUE_LIMITS.recheckMs).toBe(400)

    // 4. Ignored when packaged (both via setTestPackagedOverride and explicit option)
    setTestPackagedOverride(true)
    expect(QUEUE_LIMITS.stuckAfterMs).toBe(3_600_000)
    expect(QUEUE_LIMITS.recheckMs).toBe(900_000)
    setTestPackagedOverride(undefined)
    expect(
      readTestQueueLimit('UNIWORK_SYNC_TEST_STUCK_AFTER_MS', 3_600_000, { isPackaged: true }),
    ).toBe(3_600_000)
    expect(readTestQueueLimit('UNIWORK_SYNC_TEST_RECHECK_MS', 900_000, { isPackaged: true })).toBe(
      900_000,
    )

    // 5. Invalid values ignored (zero, negative, float, non-numeric, empty, scientific, unsafe int)
    for (const invalid of ['0', '-1', '-500', '1.5', 'abc', '', '   ', '1e3', '9007199254740992']) {
      process.env.UNIWORK_SYNC_TEST_STUCK_AFTER_MS = invalid
      process.env.UNIWORK_SYNC_TEST_RECHECK_MS = invalid
      expect(QUEUE_LIMITS.stuckAfterMs).toBe(3_600_000)
      expect(QUEUE_LIMITS.recheckMs).toBe(900_000)
    }

    // 6. End-to-end dispatcher tick uses overridden stuckAfterMs and recheckMs
    process.env.UNIWORK_SYNC_TEST_STUCK_AFTER_MS = '500'
    process.env.UNIWORK_SYNC_TEST_RECHECK_MS = '200'
    const fx = await buildFixture()
    await fx.dispatcher.enqueue(fx.queueDoc)
    fx.serverState.commitError = new UniworkDocError('timeout')
    await fx.dispatcher.dispatchAll([fx.queueDoc])
    expect(fx.queueDoc.record.state).toBe('reconciling')

    // Advance by 500 ms (overridden stuckAfterMs) -> tick moves reconciling -> reconciling-stuck
    fx.advance(500)
    await fx.dispatcher.tick([fx.queueDoc])
    expect(fx.queueDoc.record.state).toBe('reconciling-stuck')

    // Advance by 200 ms (overridden recheckMs) -> tick triggers lookup -> committed
    fx.serverState.lookupOutcome = 'committed'
    fx.advance(200)
    await fx.dispatcher.tick([fx.queueDoc])
    expect(fx.queueDoc.record.state).toBe('committed')
  })
})
