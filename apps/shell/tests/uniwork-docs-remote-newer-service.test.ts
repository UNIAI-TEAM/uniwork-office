import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkConflictChoice, UniworkDocStatus } from '../src/shared/home-api'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import type { DocumentDetail } from '../src/main/uniwork-docs/parse'
import type { DownloadResult, UniworkDocsClient } from '../src/main/uniwork-docs/client'
import {
  createIntentStore,
  INTENT_STORE_REGISTRATION,
  type IntentStore,
} from '../src/main/uniwork-sync/intent-store'
import type { IntentRecordV2 } from '../src/main/uniwork-sync/queue/record'
import { NEVER_READ_CAPABILITIES } from '../src/main/uniwork-sync/capability/cache'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import {
  DOC_INDEX_REGISTRATION,
  FEED_CURSORS_REGISTRATION,
  SyncRuntime,
} from '../src/main/uniwork-sync/runtime'
import { createSyncStoreAccess, type SyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'
import { cursorInvalid, FakeFeedClient } from './fixtures/fake-feed'

/**
 * G5-03a W1: the service side of the S6 newer-version bar, on fakes over the
 * REAL binding store and the REAL durable store (temp dir). The pure decision
 * is already pinned in uniwork-docs-remote-newer.test.ts, so every test here
 * proves the part only the service can: the guarded clean reload and its race
 * guard, the lock from its four sources, the persisted rebuild, `later`, and
 * the runtime's drop report end to end (real SyncRuntime + FakeFeedClient).
 */

const SCOPE = { deploymentId: 'default', accountId: 'acc_1' }
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const OTHER = '01J8X4DOC0N1P2Q3R4S5T6U8'
const enc = (text: string) => new TextEncoder().encode(text)
const hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const BASE_BYTES = enc('working copy bytes')
const HEAD_BYTES = enc('the server head bytes')
/** a beat for the fire-and-forget paths (noteFeedChange returns before it is done) */
const drain = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))

const detailOf = (revision: string, version: number, bytes: Uint8Array): DocumentDetail => ({
  id: DOC,
  organizationId: 'org_a',
  workspaceId: 'ws_1',
  title: 'Plan.docx',
  revision,
  currentVersion: version,
  myLevel: 'edit',
  archivedAt: null,
  file: {
    filename: 'Plan.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    version,
    checksumSha256: hex(bytes),
    sizeBytes: bytes.byteLength,
  },
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-remote-newer-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const docDir = () => join(dir, 'uniwork-documents', 'default', 'acc_1', DOC)
const docPath = () => join(docDir(), 'Plan.docx')
const copyBytes = () => new Uint8Array(readFileSync(docPath()))
const bindingOf = () =>
  JSON.parse(readFileSync(join(docDir(), BINDING_FILE), 'utf8')) as Record<string, unknown>

/** the clean working copy of DOC: base revision 9, version 3, its bytes on disk */
function seedCopy(over: Record<string, unknown> = {}, bytes: Uint8Array = BASE_BYTES): void {
  mkdirSync(docDir(), { recursive: true })
  writeFileSync(docPath(), bytes)
  writeFileSync(
    join(docDir(), BINDING_FILE),
    `${JSON.stringify(
      {
        schema: 2,
        documentId: DOC,
        workspaceId: 'ws_1',
        orgId: 'org_a',
        title: 'Plan.docx',
        filename: 'Plan.docx',
        format: 'docx',
        access: 'edit',
        baseRevision: '9',
        baseVersion: 3,
        baseChecksum: hex(bytes),
        state: 'saved',
        min_store_level: 2,
        min_app_version: '0.11.0',
        ...over,
      },
      null,
      2,
    )}\n`,
  )
}

/** the editor state sequence editorStateOf answers with; the last entry repeats */
type EditorState = { dirty: boolean | null; aiRunning: boolean; aiEpoch: number }
const CLEAN: EditorState = { dirty: false, aiRunning: false, aiEpoch: 1 }
const AI_TURN: EditorState = { dirty: false, aiRunning: true, aiEpoch: 2 }

interface Harness {
  service: UniworkDocsService
  statuses: UniworkDocStatus[]
  reloaded: string[]
  openPaths: Set<string>
  client: {
    detail: DocumentDetail
    error: UniworkDocError | null
    downloadError: UniworkDocError | null
    calls: { getDocument: number; download: number }
  }
  editorStates: EditorState[]
  syncStore: SyncStoreAccess
  intents(): Promise<IntentStore>
  capability: { syncFeed: boolean }
  /** what the conflict dialog (the bar's `reload` action) answers */
  ui: { conflict: UniworkConflictChoice; discard: boolean }
}

function setup(): Harness {
  const safeStorage = createLockableSafeStorage()
  const layer = createStoreLayer({
    root: join(dir, 'uniwork-sync', 'store'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(dir, 'uniwork-sync', 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  layer.register(FEED_CURSORS_REGISTRATION)
  layer.register(DOC_INDEX_REGISTRATION)
  const syncStore = createSyncStoreAccess({ layer, scope: () => ({ ...SCOPE }) })

  const statuses: UniworkDocStatus[] = []
  const reloaded: string[] = []
  const openPaths = new Set<string>([docPath()])
  const editorStates: EditorState[] = [CLEAN]
  let editorCalls = 0
  const capability = { syncFeed: true }
  const client = {
    detail: detailOf('10', 4, HEAD_BYTES),
    error: null as UniworkDocError | null,
    downloadError: null as UniworkDocError | null,
    calls: { getDocument: 0, download: 0 },
  }
  const api = {
    async getDocument(): Promise<DocumentDetail> {
      client.calls.getDocument += 1
      if (client.error) throw client.error
      return client.detail
    },
    async download(): Promise<DownloadResult> {
      client.calls.download += 1
      if (client.downloadError) throw client.downloadError
      return { bytes: HEAD_BYTES }
    },
  }
  const uiState = { conflict: 'later' as UniworkConflictChoice, discard: false }
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => uiState.conflict),
    confirmDiscard: vi.fn(async () => uiState.discard),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  const service = new UniworkDocsService({
    userDataDir: dir,
    syncStore,
    appVersion: () => '0.11.0',
    profile: () => ({
      deploymentId: 'default',
      apiOrigin: 'https://uniwork.example',
      clientId: 'uniwork-office',
      channel: 'stable',
    }),
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('fake-token'),
    openPath: vi.fn(() => true),
    isPathOpen: (path: string) => openPaths.has(path),
    requestModuleSave: vi.fn(() => false),
    reloadPath: (path: string) => reloaded.push(path),
    activePath: () => docPath(),
    editorStateOf: async () => {
      const state = editorStates[Math.min(editorCalls, editorStates.length - 1)] ?? CLEAN
      editorCalls += 1
      return state
    },
    capability: {
      get: async () => ({
        kind: 'ok' as const,
        capabilities: { sync_write: true, sync_feed: capability.syncFeed },
        source: 'fresh' as const,
      }),
    },
    client: api as unknown as UniworkDocsClient,
    ui,
    pushStatus: (status) => statuses.push(status),
    pushLaunch: vi.fn(),
    reveal: vi.fn(),
  })
  return {
    service,
    statuses,
    reloaded,
    openPaths,
    client,
    editorStates,
    syncStore,
    async intents() {
      const open = await syncStore.open()
      if (open.kind !== 'ok') throw new Error('the test store did not open')
      return createIntentStore(open.records(INTENT_STORE_REGISTRATION.name))
    },
    capability,
    ui: uiState,
  }
}

/** the notice the feed would announce for DOC at head revision 10, version 4 */
function notice(h: Harness, revision = '10', version = 4): void {
  h.service.noteFeedChange(DOC, revision, {
    documentId: DOC,
    kind: 'file',
    revision,
    currentVersion: version,
    versionId: `ver_${version}`,
  })
}

/** the S6 bar the renderer would read for the working copy right now */
async function barOf(h: Harness): Promise<unknown> {
  return (await h.service.docStatus(docPath()))?.remote
}

/** wait until the notice's async work shows the expected bar */
async function waitForBar(h: Harness, expected: unknown): Promise<void> {
  await vi.waitFor(async () => {
    expect(await barOf(h)).toEqual(expected)
  })
}

describe('G5-03a S6 service: the guarded clean reload', () => {
  it('a dirty working copy keeps its bytes and base; bar newer-dirty, pill remote-newer', async () => {
    seedCopy({ state: 'dirty' })
    const h = setup()
    notice(h)
    await waitForBar(h, { kind: 'newer-dirty', version: 4 })
    // the chip still says unsaved (the renderer's pill priority turns this into
    // `remote-newer`; the pill itself is W3)
    expect((await h.service.docStatus(docPath()))?.state).toBe('dirty')
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
    expect(bindingOf().baseRevision).toBe('9')
    expect(h.client.calls.download).toBe(0)
    expect(h.reloaded).toEqual([])
  })

  it('a clean copy reloads to the noticed head: bytes sha256 = detail checksum, base revision/version = head, reloadPath once, bar updated', async () => {
    seedCopy()
    const h = setup()
    notice(h)
    await vi.waitFor(() => expect(h.reloaded).toEqual([docPath()]))
    expect(hex(copyBytes())).toBe(hex(HEAD_BYTES))
    expect(bindingOf()).toMatchObject({
      baseRevision: '10',
      baseVersion: 4,
      baseChecksum: hex(HEAD_BYTES),
      state: 'saved',
    })
    expect(bindingOf()).not.toHaveProperty('serverRevision')
    expect(bindingOf()).not.toHaveProperty('serverVersion')
    await waitForBar(h, { kind: 'updated', version: 4 })
  })

  it('no download while aiRunning (bar newer-ai, the copy stays)', async () => {
    seedCopy()
    const h = setup()
    h.editorStates.splice(0, 1, AI_TURN)
    notice(h)
    await waitForBar(h, { kind: 'newer-ai', version: 4 })
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
    expect(h.client.calls.download).toBe(0)
    expect(h.reloaded).toEqual([])
  })

  it('an AI turn starting during the fetch (aiEpoch moves) drops the result: no write, no reloadPath, bar newer-ai', async () => {
    seedCopy()
    const h = setup()
    // the decision reads and the pre-fetch read are clean; the read after the
    // fetch sees the turn that started meanwhile
    h.editorStates.splice(0, 1, CLEAN, CLEAN, CLEAN, AI_TURN)
    notice(h)
    await waitForBar(h, { kind: 'newer-ai', version: 4 })
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
    expect(h.reloaded).toEqual([])
    expect(bindingOf().baseRevision).toBe('9')
  })

  it('an AI turn starting after the write restores the previous bytes and binding', async () => {
    seedCopy()
    const h = setup()
    // four clean reads (decision x2, before the fetch, after the fetch), then
    // the turn that started while the write landed
    h.editorStates.splice(0, 1, CLEAN, CLEAN, CLEAN, CLEAN, AI_TURN)
    notice(h)
    await waitForBar(h, { kind: 'newer-ai', version: 4 })
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
    expect(bindingOf()).toMatchObject({ baseRevision: '9', baseVersion: 3, state: 'saved' })
    expect(h.reloaded).toEqual([])
  })

  it('a transient fetch failure shows reload-failed, and Retry reloads once it works', async () => {
    seedCopy()
    const h = setup()
    h.client.error = new UniworkDocError('server_error', { status: 503 })
    notice(h)
    await waitForBar(h, { kind: 'reload-failed', version: 4 })
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))

    h.client.error = null
    const status = await h.service.remoteAction(docPath(), 'retry')
    expect(status?.remote).toEqual({ kind: 'updated', version: 4 })
    expect(hex(copyBytes())).toBe(hex(HEAD_BYTES))
    expect(h.reloaded).toEqual([docPath()])
  })

  it('a fetched head that is not newer than the open base is dropped silently', async () => {
    seedCopy()
    const h = setup()
    h.client.detail = detailOf('9', 3, HEAD_BYTES)
    notice(h)
    await drain()
    expect(h.reloaded).toEqual([])
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
    // the fetch happened (the head's checksum is only known after the download),
    // but the base it returned is not newer, so nothing was written
    expect(h.client.calls.download).toBe(1)
    expect(await barOf(h)).toBeUndefined()
  })
})

describe('G5-03a S6 service: the lock', () => {
  it('403 on reload -> locked revoked: isReadOnly true, module save refused, bytes kept, bar revoked', async () => {
    seedCopy()
    const h = setup()
    h.client.error = new UniworkDocError('forbidden', { status: 403 })
    notice(h)
    await waitForBar(h, { kind: 'revoked' })
    await vi.waitFor(() => {
      expect(bindingOf()).toMatchObject({ state: 'blocked', error: 'permission_revoked' })
    })
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
    expect(h.service.isReadOnly(docPath())).toBe(true)
    // the document Save is refused before any request (blocked + locked)
    await h.service.save(docPath())
    expect(h.client.calls.download).toBe(0)
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
  })

  it('403 on the metadata read locks the copy too', async () => {
    seedCopy()
    const h = setup()
    h.client.error = new UniworkDocError('permission_revoked', { status: 403 })
    await h.service.refreshMetadataFor(DOC)
    expect(bindingOf()).toMatchObject({ state: 'blocked', error: 'permission_revoked' })
    expect(h.service.isReadOnly(docPath())).toBe(true)
    expect((await h.service.docStatus(docPath()))?.remote).toEqual({ kind: 'revoked' })
  })

  it('410 on reload -> deleted', async () => {
    seedCopy()
    const h = setup()
    h.client.error = new UniworkDocError('document_deleted', { status: 410 })
    notice(h)
    await waitForBar(h, { kind: 'deleted' })
    await vi.waitFor(() => {
      expect(bindingOf()).toMatchObject({ state: 'blocked', error: 'document_deleted' })
    })
    expect(h.service.isReadOnly(docPath())).toBe(true)
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
  })

  it('a bare (envelope-less) 403 is transient: reload-failed, never a lock', async () => {
    seedCopy()
    const h = setup()
    h.client.error = new UniworkDocError('server_error', { status: 403 })
    notice(h)
    await waitForBar(h, { kind: 'reload-failed', version: 4 })
    expect(h.service.isReadOnly(docPath())).toBe(false)
  })

  it('feed-gone: a dropped open bound document is classified 404 -> revoked, 410 -> deleted, 200 -> nothing', async () => {
    seedCopy()
    const h = setup()
    h.client.error = new UniworkDocError('not_found', { status: 404 })
    await h.service.noteFeedGone(DOC)
    expect(bindingOf()).toMatchObject({ state: 'blocked', error: 'permission_revoked' })

    // a fresh copy: 410 deletes it
    seedCopy()
    const h2 = setup()
    h2.client.error = new UniworkDocError('deleted', { status: 410 })
    await h2.service.noteFeedGone(DOC)
    expect(bindingOf()).toMatchObject({ state: 'blocked', error: 'document_deleted' })

    // a document the server still answers for is left exactly as it is
    seedCopy()
    const h3 = setup()
    await h3.service.noteFeedGone(DOC)
    expect(bindingOf()).toMatchObject({ state: 'saved' })
    expect(await barOf(h3)).toBeUndefined()
  })

  it('a successful resync that drops an open bound document locks it (runtime onFeedGone)', async () => {
    seedCopy()
    const h = setup()
    h.client.error = new UniworkDocError('not_found', { status: 404 })
    const feed = new FakeFeedClient([
      // the first snapshot lists the document at the open base (not newer)
      {
        phase: 'snapshot',
        rows: [{ document_id: DOC, revision: '9', current_version: 3 }],
        next_cursor: 'c1',
      },
      cursorInvalid(),
      // the resync no longer lists it: the drop is reported
      { phase: 'snapshot', rows: [], next_cursor: 'c2' },
    ])
    const runtime = new SyncRuntime({
      store: h.syncStore,
      targets: { orgs: () => ['org_a'], workspaces: async () => ['ws_1'] },
      capability: async () => ({
        kind: 'ok' as const,
        capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: true },
        source: 'fresh' as const,
      }),
      client: () => feed,
      keepDraft: async () => false,
      clock: { now: () => 1_700_000_000_000 },
      onFeedChange: (change) =>
        h.service.noteFeedChange(change.documentId, change.revision, change),
      isOpenBound: (documentId) => h.service.isOpenBound(documentId),
      onFeedGone: (documentId) => {
        void h.service.noteFeedGone(documentId)
      },
    })
    await runtime.tick()
    await runtime.tick()
    await vi.waitFor(() => {
      expect(bindingOf()).toMatchObject({ state: 'blocked', error: 'permission_revoked' })
    })
    expect(h.service.isReadOnly(docPath())).toBe(true)
    expect((await h.service.docStatus(docPath()))?.remote).toEqual({ kind: 'revoked' })
  })
})

describe('G5-03a S6 service: hold, later and the persisted rebuild', () => {
  it('a notice during committing is held and dropped when the receipt matches', async () => {
    seedCopy()
    const h = setup()
    const intents = await h.intents()
    const record: IntentRecordV2 = {
      v: 2,
      intentId: 'office-intent-1',
      idempotencyKey: 'office-key-1',
      documentId: DOC,
      orgId: 'org_a',
      workspaceId: 'ws_1',
      baseRevision: '9',
      baseVersion: 3,
      checksum: hex(BASE_BYTES),
      length: BASE_BYTES.byteLength,
      generation: 1,
      state: 'committing',
      attempt: 0,
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
    }
    await intents.put(DOC, record, BASE_BYTES)
    notice(h)
    await drain()
    // held: no bar, nothing sent while the intent's outcome is unknown
    expect(await barOf(h)).toBeUndefined()
    expect(h.client.calls.download).toBe(0)

    // the receipt comes back with exactly the noticed revision: this app's own
    // commit, so the held notice is dropped for good
    const settle = (
      h.service as unknown as { redecideHeld(id: string, record?: IntentRecordV2): Promise<void> }
    ).redecideHeld
    await settle.call(h.service, DOC, {
      ...record,
      state: 'committed',
      receipt: { versionId: 'ver_4', version: 4, revision: '10' },
    })
    await drain()
    expect(await barOf(h)).toBeUndefined()
    expect(h.client.calls.download).toBe(0)
  })

  it('later keeps remote (pill stays), close clears it', async () => {
    seedCopy({ state: 'dirty' })
    const h = setup()
    notice(h, '10', 4)
    await waitForBar(h, { kind: 'newer-dirty', version: 4 })

    // EXPERIENCE S6: Later hides the BAR in the renderer (per path + bar
    // signature), so main keeps the bar and the chip's remote-newer pill stays
    const kept = await h.service.remoteAction(docPath(), 'later')
    expect(kept?.remote).toEqual({ kind: 'newer-dirty', version: 4 })
    expect(await barOf(h)).toEqual({ kind: 'newer-dirty', version: 4 })

    // a newer revision replaces the version as usual
    notice(h, '11', 5)
    await waitForBar(h, { kind: 'newer-dirty', version: 5 })

    // Close is the action that clears it
    expect((await h.service.remoteAction(docPath(), 'close'))?.remote).toBeUndefined()
    expect(await barOf(h)).toBeUndefined()
  })

  it('a second notice replaces the version: one bar, no stacking', async () => {
    seedCopy({ state: 'dirty' })
    const h = setup()
    notice(h, '10', 4)
    await waitForBar(h, { kind: 'newer-dirty', version: 4 })
    notice(h, '11', 5)
    await waitForBar(h, { kind: 'newer-dirty', version: 5 })
    const pushed = h.statuses.filter((status) => status.path === docPath())
    expect(pushed.length).toBeGreaterThan(0)
    expect(pushed.every((status) => status.remote?.kind === 'newer-dirty')).toBe(true)
  })

  it('a restart rebuilds the newer-* bar from serverRevision/serverVersion', async () => {
    seedCopy({ serverRevision: '10', serverVersion: 4 })
    const h = setup()
    expect((await h.service.docStatus(docPath()))?.remote).toEqual({
      kind: 'newer-dirty',
      version: 4,
    })
    // a stale pair (not newer than the base) rebuilds nothing
    seedCopy({ serverRevision: '9', serverVersion: 3 })
    const h2 = setup()
    expect((await h2.service.docStatus(docPath()))?.remote).toBeUndefined()
  })

  it('close hides the info bar for this session', async () => {
    seedCopy()
    const h = setup()
    notice(h)
    await vi.waitFor(() => expect(h.reloaded).toEqual([docPath()]))
    await waitForBar(h, { kind: 'updated', version: 4 })
    expect((await h.service.remoteAction(docPath(), 'close'))?.remote).toBeUndefined()
    expect(await barOf(h)).toBeUndefined()
  })

  it('a notice for a document that is not open is ignored', async () => {
    seedCopy()
    const h = setup()
    h.openPaths.clear()
    notice(h)
    await drain()
    expect(h.client.calls.download).toBe(0)
    expect(bindingOf()).toMatchObject({ state: 'saved' })
    expect(bindingOf()).not.toHaveProperty('serverRevision')
  })

  it('the feed off ignores the notice', async () => {
    seedCopy()
    const h = setup()
    h.capability.syncFeed = false
    notice(h)
    await drain()
    expect(h.client.calls.download).toBe(0)
    expect(bindingOf()).not.toHaveProperty('serverRevision')
    expect(await barOf(h)).toBeUndefined()
  })

  it('a notice for another document never touches this copy', async () => {
    seedCopy()
    const h = setup()
    h.service.noteFeedChange(OTHER, '10', {
      documentId: OTHER,
      kind: 'file',
      revision: '10',
      currentVersion: 4,
      versionId: 'ver_4',
    })
    await drain()
    expect(bindingOf()).toMatchObject({ baseRevision: '9' })
    expect(await barOf(h)).toBeUndefined()
  })
})

describe('G5-03a S6 service: the poll edges and the reload action', () => {
  it('newer-ai: the poll sees the turn end, the rule runs again and a clean copy reloads', async () => {
    seedCopy()
    const h = setup()
    h.editorStates.splice(0, 1, AI_TURN)
    h.service.noteEditorState(docPath(), AI_TURN, 0)
    notice(h)
    await waitForBar(h, { kind: 'newer-ai', version: 4 })

    // the turn is over: the fresh read now answers a clean, idle editor
    h.editorStates.splice(0, 1, CLEAN)
    h.service.noteEditorState(docPath(), CLEAN, 0)
    await vi.waitFor(() => expect(h.reloaded).toEqual([docPath()]))
    await waitForBar(h, { kind: 'updated', version: 4 })
    expect(hex(copyBytes())).toBe(hex(HEAD_BYTES))
  })

  it('newer-dirty: the copy is clean again → now-clean (no auto reload)', async () => {
    seedCopy()
    const h = setup()
    h.service.noteEditorState(docPath(), { dirty: true, aiRunning: false, aiEpoch: 1 }, 0)
    notice(h)
    await waitForBar(h, { kind: 'newer-dirty', version: 4 })

    h.service.noteEditorState(docPath(), { dirty: false, aiRunning: false, aiEpoch: 1 }, 0)
    await waitForBar(h, { kind: 'now-clean', version: 4 })
    expect(h.reloaded).toEqual([])
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
  })

  it('reload opens the conflict dialog and “open the latest” replaces the copy', async () => {
    seedCopy({ state: 'dirty' })
    const h = setup()
    notice(h)
    await waitForBar(h, { kind: 'newer-dirty', version: 4 })

    h.ui.conflict = 'open-latest'
    h.ui.discard = true
    const status = await h.service.remoteAction(docPath(), 'reload')
    expect(status?.remote).toEqual({ kind: 'updated', version: 4 })
    expect(hex(copyBytes())).toBe(hex(HEAD_BYTES))
    expect(bindingOf()).toMatchObject({ baseRevision: '10', baseVersion: 4, state: 'saved' })
    expect(h.reloaded).toEqual([docPath()])
  })

  it('reload cancel (decide later) keeps the bar and the copy', async () => {
    seedCopy({ state: 'dirty' })
    const h = setup()
    notice(h)
    await waitForBar(h, { kind: 'newer-dirty', version: 4 })

    h.ui.conflict = 'later'
    const status = await h.service.remoteAction(docPath(), 'reload')
    expect(status?.remote).toEqual({ kind: 'newer-dirty', version: 4 })
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
    expect(h.reloaded).toEqual([])
  })
})
