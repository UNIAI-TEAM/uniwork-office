import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UniworkConflictChoice,
  UniworkConflictView,
  UniworkDocStatus,
} from '../src/shared/home-api'
import {
  BINDING_FILE,
  type Binding,
  type BindingStore,
} from '../src/main/uniwork-docs/binding-store'
import { errorFromResponse, UniworkDocError } from '../src/main/uniwork-docs/errors'
import type { SaveCoordinator } from '../src/main/uniwork-docs/save-coordinator'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import type { DocumentDetail } from '../src/main/uniwork-docs/parse'
import type { DownloadResult, UniworkDocsClient } from '../src/main/uniwork-docs/client'
import {
  createIntentStore,
  INTENT_STORE_REGISTRATION,
  type IntentStore,
} from '../src/main/uniwork-sync/intent-store'
import type { IntentRecordV2 } from '../src/main/uniwork-sync/queue/record'
import { DRAFTS_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/drafts'
import { PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
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
    versionId: `ver_${version}`,
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
  /** the first pushed status (already pushed, or the next one) that matches */
  statusWhere(match: (status: UniworkDocStatus) => boolean): Promise<UniworkDocStatus>
  reloaded: string[]
  /** resolves with the path of the next reloadPath call */
  nextReload(): Promise<string>
  openPaths: Set<string>
  client: {
    detail: DocumentDetail
    error: UniworkDocError | null
    downloadError: UniworkDocError | null
    /** when set, the next download parks on it (and calls `downloadEntered`) */
    downloadGate: Promise<void> | null
    downloadEntered: (() => void) | null
    calls: { getDocument: number; download: number; commit: number }
  }
  editorStates: EditorState[]
  syncStore: SyncStoreAccess
  intents(): Promise<IntentStore>
  capability: {
    syncFeed: boolean
    /**
     * When set, the capability read a remote decision makes parks on this
     * promise, so a test can hold the decision open across a close.
     */
    hold: Promise<void> | null
    /** called the first time a capability read parks on `hold` */
    entered: (() => void) | null
  }
  /** what the conflict dialog (the bar's `reload` action) answers */
  ui: { conflict: UniworkConflictChoice; discard: boolean }
  views: UniworkConflictView[]
}

function setup(
  options: {
    requestFirstSaveName?: (request: {
      requestId: string
      path: string
    }) => Promise<'continue' | 'cancel'>
  } = {},
): Harness {
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
  layer.register(DRAFTS_STORE_REGISTRATION)
  layer.register(PAUSE_STORE_REGISTRATION)
  const syncStore = createSyncStoreAccess({ layer, scope: () => ({ ...SCOPE }) })

  const statuses: UniworkDocStatus[] = []
  const statusWaiters = new Set<(status: UniworkDocStatus) => void>()
  const views: UniworkConflictView[] = []
  const reloaded: string[] = []
  const reloadWaiters: Array<(path: string) => void> = []
  const openPaths = new Set<string>([docPath()])
  const editorStates: EditorState[] = [CLEAN]
  let editorCalls = 0
  const capability = {
    syncFeed: true,
    hold: null as Promise<void> | null,
    entered: null as (() => void) | null,
  }
  const client = {
    detail: detailOf('10', 4, HEAD_BYTES),
    error: null as UniworkDocError | null,
    downloadError: null as UniworkDocError | null,
    downloadGate: null as Promise<void> | null,
    downloadEntered: null as (() => void) | null,
    calls: { getDocument: 0, download: 0, commit: 0 },
  }
  const api = {
    async documentRef() {
      return { id: DOC, workspaceId: 'ws_1', title: 'Untitled document.docx', parentId: 'f_mine' }
    },
    async getDocument(): Promise<DocumentDetail> {
      client.calls.getDocument += 1
      if (client.error) throw client.error
      return client.detail
    },
    async download(): Promise<DownloadResult> {
      client.calls.download += 1
      const gate = client.downloadGate
      if (gate) {
        client.downloadGate = null
        client.downloadEntered?.()
        await gate
      }
      if (client.downloadError) throw client.downloadError
      return { bytes: HEAD_BYTES }
    },
    // a save's upload + commit: the server head is client.detail, so a commit
    // on an older base is the server's version conflict
    async upload(input: { bytes: Uint8Array }) {
      return {
        uploadId: 'upl_1',
        checksumSha256: hex(input.bytes),
        sizeBytes: input.bytes.byteLength,
        claimExpiresAt: '2026-10-17T00:00:00Z',
      }
    },
    async commit(input: { baseRevision: string }) {
      client.calls.commit += 1
      if (input.baseRevision !== client.detail.revision) {
        throw errorFromResponse(409, {
          error: {
            code: 'document_version_conflict',
            message: 'x',
            fields: { current_revision: client.detail.revision },
          },
        })
      }
      throw new Error('this harness commits only onto an older base')
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
    requestFirstSaveName: options.requestFirstSaveName as never,
    reloadPath: (path: string) => {
      reloaded.push(path)
      for (const waiter of reloadWaiters.splice(0)) waiter(path)
    },
    activePath: () => docPath(),
    editorStateOf: async () => {
      const state = editorStates[Math.min(editorCalls, editorStates.length - 1)] ?? CLEAN
      editorCalls += 1
      return state
    },
    capability: {
      get: async () => {
        // A3 regression seam: the FIRST read after `hold` is set parks on it,
        // which lands the decision between its editor-AI sample and its bar
        const held = capability.hold
        if (held) {
          capability.hold = null
          capability.entered?.()
          await held
        }
        return {
          kind: 'ok' as const,
          capabilities: { sync_write: true, sync_feed: capability.syncFeed },
          source: 'fresh' as const,
        }
      },
    },
    client: api as unknown as UniworkDocsClient,
    ui,
    pushStatus: (status) => {
      statuses.push(status)
      for (const waiter of [...statusWaiters]) waiter(status)
    },
    pushConflict: (view) => views.push(view),
    pushLaunch: vi.fn(),
    reveal: vi.fn(),
  })
  return {
    service,
    statuses,
    statusWhere: (match) => {
      const seen = statuses.find(match)
      if (seen) return Promise.resolve(seen)
      return new Promise((resolve) => {
        const waiter = (status: UniworkDocStatus) => {
          if (!match(status)) return
          statusWaiters.delete(waiter)
          resolve(status)
        }
        statusWaiters.add(waiter)
      })
    },
    reloaded,
    nextReload: () => new Promise((resolve) => reloadWaiters.push(resolve)),
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
    views,
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
    seedCopy({ baseVersionId: 'ver_3' })
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
    // the base moved to the fetched head: the anchor base moves with it, so a
    // comment created before the next Save anchors against the version on screen
    expect(bindingOf().baseVersionId).toBe('ver_4')
    expect(h.service.commentContext(docPath())?.versionId).toBe('ver_4')
    expect(bindingOf()).not.toHaveProperty('serverRevision')
    expect(bindingOf()).not.toHaveProperty('serverVersion')
    await waitForBar(h, { kind: 'updated', version: 4 })
  })

  it('a clean reload whose read reports a lower level moves the comments level with the head', async () => {
    seedCopy({ baseVersionId: 'ver_3', level: 'manage' })
    const h = setup()
    h.client.detail = { ...detailOf('10', 4, HEAD_BYTES), myLevel: 'view' }
    notice(h)
    await vi.waitFor(() => expect(h.reloaded).toEqual([docPath()]))
    expect(bindingOf()).toMatchObject({ baseRevision: '10', baseVersion: 4, level: 'view' })
    expect(h.service.commentContext(docPath())?.level).toBe('view')
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

    // The W4 race, made deterministic without a timing sleep: the restore's own
    // binding write is held open, so a status refresh started in that window
    // reads the reloaded head (`10/saved`) plus the just-restored BASE bytes
    // and queues `{base:10, state:'dirty'}` behind the gated restore.
    const store = (h.service as unknown as { store: BindingStore }).store
    const realWrite = store.write.bind(store)
    const written: Binding[] = []
    let gated = false
    let restoreEntered!: () => void
    const restoreEnteredP = new Promise<void>((resolve) => (restoreEntered = resolve))
    let releaseRestore!: () => void
    const restoreGate = new Promise<void>((resolve) => (releaseRestore = resolve))
    store.write = async (dir, binding) => {
      written.push(binding)
      if (
        !gated &&
        binding.baseRevision === '9' &&
        binding.state === 'saved' &&
        binding.serverRevision === undefined
      ) {
        gated = true
        restoreEntered()
        await restoreGate
      }
      return realWrite(dir, binding)
    }
    const coordinator = (h.service as unknown as { coordinator: SaveCoordinator }).coordinator
    const realCommitState = coordinator.commitState.bind(coordinator)
    let refreshQueued!: () => void
    const refreshQueuedP = new Promise<void>((resolve) => (refreshQueued = resolve))
    coordinator.commitState = (doc, binding, guard) => {
      const result = realCommitState(doc, binding, guard)
      if (binding.state === 'dirty') refreshQueued()
      return result
    }

    notice(h)
    await restoreEnteredP
    const refreshing = h.service.docStatus(docPath())
    await refreshQueuedP
    releaseRestore()
    await refreshing

    // the refresh's queued write must not resurrect the reloaded head as the
    // copy's base: the restore's `9/saved` is what the binding still carries
    expect(bindingOf()).toMatchObject({ baseRevision: '9', baseVersion: 3, state: 'saved' })
    expect(written.filter((binding) => binding.state === 'dirty')).toEqual([])

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
    // join the notice-triggered guarded reload itself: its promise settles only after
    // the not-newer decision (G703-R8-2), so the assertions below cannot run early
    const guarded = h.service as unknown as {
      guardedReload(path: string, notice: unknown): Promise<void>
    }
    const reloads: Promise<void>[] = []
    const realGuardedReload = guarded.guardedReload.bind(guarded)
    vi.spyOn(guarded, 'guardedReload').mockImplementation((path, remoteNotice) => {
      const run = realGuardedReload(path, remoteNotice)
      reloads.push(run)
      return run
    })
    notice(h)
    await vi.waitFor(() => expect(reloads).toHaveLength(1))
    await reloads[0]
    expect(h.reloaded).toEqual([])
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
    // the head was fetched, and its base is not newer, so nothing was written
    expect(h.client.calls.download).toBe(1)
    expect(bindingOf()).toMatchObject({ baseRevision: '9', baseVersion: 3, state: 'saved' })
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

  it('a re-granted copy is editable again after the reopen: lock, bar and binding agree', async () => {
    seedCopy()
    const h = setup()
    h.client.error = new UniworkDocError('forbidden', { status: 403 })
    notice(h)
    await waitForBar(h, { kind: 'revoked' })
    await vi.waitFor(() => {
      expect(bindingOf()).toMatchObject({ state: 'blocked', error: 'permission_revoked' })
    })
    expect(h.service.isReadOnly(docPath())).toBe(true)
    expect(h.service.isLocked(docPath())).toBe(true)

    // the server grants edit again and the document is reopened from the picker
    h.client.error = null
    await h.service.openFromServer(DOC)

    expect(h.service.isReadOnly(docPath())).toBe(false)
    expect(h.service.isLocked(docPath())).toBe(false)
    expect(bindingOf()).toMatchObject({ state: 'dirty' })
    expect(bindingOf()).not.toHaveProperty('error')
    expect(await barOf(h)).toBeUndefined()
  })

  it('the account boundary forgets the lock with its bar, so no verdict answers for the next session', async () => {
    seedCopy()
    const h = setup()
    h.client.error = new UniworkDocError('not_found', { status: 404 })
    await h.service.noteFeedGone(DOC)
    expect(h.service.isLocked(docPath())).toBe(true)

    h.service.forgetLocksWhere(() => true)

    // the durable binding this account left still reads blocked - that copy IS
    // still revoked for its owner, exactly like an S11 folder that keeps
    // refusing after the panel is forgotten. The session's verdict is gone, so
    // the next account's copy of the same document is not locked by it, and no
    // bar survives with it either.
    seedCopy({ state: 'dirty' })
    expect(h.service.isLocked(docPath())).toBe(false)
    expect(h.service.isReadOnly(docPath())).toBe(false)
    expect(await barOf(h)).toBeUndefined()
  })
})

describe('G5-03a S6 service: the bar through the real runtime (wiring onFeedChange)', () => {
  /** the real SyncRuntime over the scripted feed, wired as wiring.ts wires it */
  function runtimeOf(h: Harness, feed: FakeFeedClient): SyncRuntime {
    return new SyncRuntime({
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
  }

  /** a snapshot listing DOC at head revision 10, version 4 (the open base is 9/3) */
  const newerSnapshot = () =>
    new FakeFeedClient([
      {
        phase: 'snapshot',
        rows: [{ document_id: DOC, revision: '10', current_version: 4, version_id: 'ver_4' }],
        next_cursor: 'c1',
      },
    ])

  it('a newer snapshot reaches the bar of a dirty copy through onFeedChange alone', async () => {
    seedCopy({ state: 'dirty' })
    const h = setup()
    await runtimeOf(h, newerSnapshot()).tick()
    await waitForBar(h, { kind: 'newer-dirty', version: 4 })
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
    expect(bindingOf().baseRevision).toBe('9')
    expect(h.client.calls.download).toBe(0)
  })

  it('a newer snapshot reloads a clean copy through onFeedChange alone: updated bar', async () => {
    seedCopy()
    const h = setup()
    await runtimeOf(h, newerSnapshot()).tick()
    await vi.waitFor(() => expect(h.reloaded).toEqual([docPath()]))
    await waitForBar(h, { kind: 'updated', version: 4 })
    expect(hex(copyBytes())).toBe(hex(HEAD_BYTES))
    expect(bindingOf()).toMatchObject({ baseRevision: '10', baseVersion: 4, state: 'saved' })
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

  it('EL1A-BE-1: an edit_locked copy never rebuilds a newer-* bar from a revision it carries', async () => {
    // the pair a 423 would have left behind (holder head 10 > base 9) must not
    // become an S6 bar while the copy is still edit_locked: the pill names the holder
    seedCopy({
      state: 'edit_locked',
      error: 'edit_locked',
      serverRevision: '10',
      serverVersion: 4,
      editLock: {
        holderName: 'Minh Trần',
        since: '2026-04-17T03:00:00Z',
        expiresAt: '2026-04-17T03:02:00Z',
        heldByMe: false,
      },
    })
    const h = setup()
    const status = await h.service.docStatus(docPath())
    expect(status?.remote).toBeUndefined()
    expect(status).toMatchObject({ state: 'edit_locked', error: 'edit_locked' })
  })

  it('EL1A-BE-1: a feed notice does not raise a newer bar over an edit_locked copy', async () => {
    seedCopy({ state: 'edit_locked', error: 'edit_locked' })
    const h = setup()
    notice(h, '10', 4)
    await drain()
    // the copy is locked by someone else: the notice never rebuilds a bar or reloads
    expect(await barOf(h)).toBeUndefined()
    expect(h.client.calls.download).toBe(0)
    expect(bindingOf()).toMatchObject({ state: 'edit_locked' })
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
    // awaited on the pushes themselves (no polling deadline): load cannot time it out
    await h.statusWhere((status) => status.remote?.kind === 'newer-ai')
    expect(await barOf(h)).toEqual({ kind: 'newer-ai', version: 4 })

    // the turn is over: the fresh read now answers a clean, idle editor
    h.editorStates.splice(0, 1, CLEAN)
    const reload = h.nextReload()
    h.service.noteEditorState(docPath(), CLEAN, 0)
    expect(await reload).toBe(docPath())
    expect(h.reloaded).toEqual([docPath()])
    expect(await barOf(h)).toEqual({ kind: 'updated', version: 4 })
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

    const pending = h.service.remoteAction(docPath(), 'reload')
    await vi.waitFor(() => expect(h.views).toHaveLength(1))
    await h.service.conflictAct(h.views[0]!.sessionId, {
      kind: 'reload',
      keep: 'discard',
      stopAi: false,
    })
    const status = await pending
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

    const pending = h.service.remoteAction(docPath(), 'reload')
    await vi.waitFor(() => expect(h.views).toHaveLength(1))
    await h.service.conflictAct(h.views[0]!.sessionId, { kind: 'cancel' })
    const status = await pending
    expect(status?.remote).toEqual({ kind: 'newer-dirty', version: 4 })
    expect(hex(copyBytes())).toBe(hex(BASE_BYTES))
    expect(h.reloaded).toEqual([])
  })

  it('A5 (UNI-1362): refuses the reload with reload-failed when the previous working-copy bytes cannot be read', async () => {
    seedCopy()
    const h = setup()
    unlinkSync(docPath())
    notice(h)
    await waitForBar(h, { kind: 'reload-failed', version: 4 })
    expect(existsSync(docPath())).toBe(false)
    expect(h.reloaded).toEqual([])
    expect(bindingOf()).toMatchObject({ baseRevision: '9', state: 'saved' })
    expect(h.client.calls.download).toBe(1)
  })

  it('A3 (UNI-1362): keeps the editor-AI sample a closed path needs while its remote decision is still in flight', async () => {
    seedCopy()
    const h = setup()
    h.editorStates.splice(0, 1, AI_TURN)
    const internals = h.service as unknown as { editorAi: Map<string, unknown> }
    // the running turn the session already reported: this is the sample the
    // settle edge of a `newer-ai` bar is decided on
    h.service.noteEditorState(docPath(), AI_TURN, 0)
    expect(internals.editorAi.get(docPath())).toEqual({ aiRunning: true, aiEpoch: 2 })

    // hold the decision between its editor-AI sample and the bar it publishes:
    // remoteLocalFor reads the AI turn, then parks on the capability read
    let entered!: () => void
    const enteredP = new Promise<void>((resolve) => (entered = resolve))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    h.capability.hold = gate
    h.capability.entered = entered
    notice(h)
    await enteredP

    // the path closes while the decision is in flight: the poll must not drop
    // the `aiRunning` sample the decision was made on
    h.openPaths.delete(docPath())
    await h.service.pollSaveQueue()
    expect(internals.editorAi.has(docPath())).toBe(true)

    // the delayed bar lands after the close, then the path is reopened and the
    // AI turn ends: the sample is what lets the settle edge re-decide the notice
    release()
    await waitForBar(h, { kind: 'newer-ai', version: 4 })
    h.editorStates.splice(0, 1, CLEAN)
    h.openPaths.add(docPath())
    h.service.noteEditorState(docPath(), CLEAN, 0)
    await vi.waitFor(() => expect(h.reloaded).toEqual([docPath()]))
    await waitForBar(h, { kind: 'updated', version: 4 })
    expect(hex(copyBytes())).toBe(hex(HEAD_BYTES))
  })

  it('A3 (UNI-1362): a decision dropped by the session reset never releases the counter entry the next session registered', async () => {
    seedCopy()
    const h = setup()
    h.editorStates.splice(0, 1, AI_TURN)
    const internals = h.service as unknown as {
      editorAi: Map<string, unknown>
      remoteDecisions: Map<string, { n: number }>
    }
    h.service.noteEditorState(docPath(), AI_TURN, 0)

    // decision A of the outgoing session: a notice that resolves to `ignore`
    // (not-newer), held after its editor-AI sample on the capability read
    let enteredA!: () => void
    const enteredAP = new Promise<void>((resolve) => (enteredA = resolve))
    let releaseA!: () => void
    const gateA = new Promise<void>((resolve) => (releaseA = resolve))
    h.capability.hold = gateA
    h.capability.entered = enteredA
    notice(h, '9', 3)
    await enteredAP
    expect(internals.remoteDecisions.get(docPath())).toEqual({ n: 1 })

    // the account boundary's step 5 clears the map without awaiting A (exactly
    // what lockSession does), the same account signs in again and its editor
    // reports the new session's AI turn
    internals.remoteDecisions.clear()
    h.service.noteEditorState(docPath(), AI_TURN, 0)
    expect(internals.editorAi.has(docPath())).toBe(true)

    // decision B of the new session for the same path: held after its own
    // editor-AI sample, before it publishes its `newer-ai` bar
    let enteredB!: () => void
    const enteredBP = new Promise<void>((resolve) => (enteredB = resolve))
    let releaseB!: () => void
    const gateB = new Promise<void>((resolve) => (releaseB = resolve))
    h.capability.hold = gateB
    h.capability.entered = enteredB
    notice(h)
    await enteredBP
    const entryB = internals.remoteDecisions.get(docPath())
    expect(entryB).toEqual({ n: 1 })

    // A resumes and is ignored: its finalizer must release only its own entry,
    // never B's replacement
    releaseA()
    await drain()
    expect(internals.remoteDecisions.get(docPath())).toBe(entryB)

    // the path closes while B is still in flight: the poll must keep the sample
    // B's own bar re-decides on (B's entry is what keeps it)
    h.openPaths.delete(docPath())
    await h.service.pollSaveQueue()
    expect(internals.editorAi.has(docPath())).toBe(true)

    // B publishes its bar, the turn ends after the reopen: the retained sample
    // is what lets the settle edge re-decide the notice and reload the head
    releaseB()
    await waitForBar(h, { kind: 'newer-ai', version: 4 })
    h.editorStates.splice(0, 1, CLEAN)
    h.openPaths.add(docPath())
    h.service.noteEditorState(docPath(), CLEAN, 0)
    await vi.waitFor(() => expect(h.reloaded).toEqual([docPath()]))
    await waitForBar(h, { kind: 'updated', version: 4 })
    expect(hex(copyBytes())).toBe(hex(HEAD_BYTES))
  })

  it('A3 (UNI-1362): prunes closed-path editor-AI memory on poll once no live bar needs it, and drops settled reload chains', async () => {
    seedCopy()
    const h = setup()
    const internals = h.service as unknown as {
      editorAi: Map<string, unknown>
      remoteReloads: Map<string, unknown>
    }
    h.service.noteEditorState(docPath(), CLEAN, 0)
    expect(internals.editorAi.has(docPath())).toBe(true)
    notice(h)
    await vi.waitFor(() => expect(h.reloaded).toEqual([docPath()]))
    await waitForBar(h, { kind: 'updated', version: 4 })
    expect(internals.remoteReloads.size).toBe(0)

    // while the updated bar is still on screen, closing the path keeps the memory
    h.openPaths.delete(docPath())
    await h.service.pollSaveQueue()
    expect(internals.editorAi.has(docPath())).toBe(true)

    // once the session hides the bar (close) and the path is closed, the poll prunes it
    await h.service.remoteAction(docPath(), 'close')
    await h.service.pollSaveQueue()
    expect(internals.editorAi.has(docPath())).toBe(false)
  })
})

describe('UNI-1959 a pending first-save ask is local unsent work', () => {
  const UNSENT = enc('local saved edits awaiting naming')

  /** a version-1 copy under the default blank title, whose editor just saved `UNSENT` */
  async function askedCopy() {
    seedCopy({ title: 'Untitled document.docx', baseVersion: 1, state: 'ready' }, BASE_BYTES)
    const asked: Array<{ requestId: string; path: string }> = []
    let answer: (verdict: 'continue' | 'cancel') => void = () => undefined
    const h = setup({
      requestFirstSaveName: (request) =>
        new Promise((resolve) => {
          asked.push(request)
          answer = resolve
        }),
    })
    writeFileSync(docPath(), UNSENT)
    h.service.onUserSave(docPath())
    await drain()
    expect(asked).toHaveLength(1)
    return { h, asked, answer: (verdict: 'continue' | 'cancel') => answer(verdict) }
  }

  it('a newer feed notice while the ask is open keeps the saved bytes and the base', async () => {
    const { h } = await askedCopy()
    notice(h)
    await drain(120)
    expect(Buffer.from(copyBytes()).toString()).toBe('local saved edits awaiting naming')
    expect(bindingOf().baseRevision).toBe('9')
    expect(bindingOf().baseVersion).toBe(1)
    expect(h.client.calls.download).toBe(0)
    expect(h.reloaded).toEqual([])
    // the chip reads the copy as unsent while the dialog is open
    expect((await h.service.docStatus(docPath()))?.state).toBe('dirty')
  })

  it('after a Cancel the unsent copy is still protected: dirty, bar newer-dirty, bytes kept', async () => {
    const { h, answer } = await askedCopy()
    answer('cancel')
    await drain()
    notice(h)
    await waitForBar(h, { kind: 'newer-dirty', version: 4 })
    expect(Buffer.from(copyBytes()).toString()).toBe('local saved edits awaiting naming')
    expect(bindingOf().baseRevision).toBe('9')
    expect(h.client.calls.download).toBe(0)
    expect((await h.service.docStatus(docPath()))?.state).toBe('dirty')
  })

  /** a clean version-1 blank copy whose naming answers are in the test's hands */
  function blankCopy() {
    seedCopy({ title: 'Untitled document.docx', baseVersion: 1, state: 'ready' }, BASE_BYTES)
    const asked: Array<{ requestId: string; path: string }> = []
    let answer: (verdict: 'continue' | 'cancel') => void = () => undefined
    const h = setup({
      requestFirstSaveName: (request) =>
        new Promise((resolve) => {
          asked.push(request)
          answer = resolve
        }),
    })
    // the head still carries the blank title the notice's metadata read brings along
    h.client.detail = { ...detailOf('10', 4, HEAD_BYTES), title: 'Untitled document.docx' }
    return { h, asked, answer: (verdict: 'continue' | 'cancel') => answer(verdict) }
  }

  it('UWNM-BE-R2-1: a reload already downloading when the first Save lands never writes over the held bytes', async () => {
    const { h, asked, answer } = blankCopy()
    // "never writes": not even a write a later check undoes
    const store = (h.service as unknown as { store: BindingStore }).store
    const realWrite = store.writeWorkingCopy.bind(store)
    const headWrites: string[] = []
    store.writeWorkingCopy = async (target, filename, bytes) => {
      if (hex(bytes) === hex(HEAD_BYTES)) headWrites.push(filename)
      return realWrite(target, filename, bytes)
    }
    let release!: () => void
    h.client.downloadGate = new Promise<void>((resolve) => (release = resolve))
    const entered = new Promise<void>((resolve) => (h.client.downloadEntered = resolve))
    // the copy is clean when the notice is decided: the reload starts its download
    notice(h)
    await entered
    // the person saves while the download is parked: the naming ask holds the upload
    writeFileSync(docPath(), UNSENT)
    h.service.onUserSave(docPath())
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    release()

    await waitForBar(h, { kind: 'newer-dirty', version: 4 })
    expect(Buffer.from(copyBytes()).toString()).toBe('local saved edits awaiting naming')
    expect(bindingOf()).toMatchObject({ baseRevision: '9', baseVersion: 1 })
    expect(h.reloaded).toEqual([])
    expect(headWrites).toEqual([])

    // the answer releases the held edits into the normal save, which meets the
    // newer head as a version conflict - the bytes are still the person's
    const coordinator = (h.service as unknown as { coordinator: SaveCoordinator }).coordinator
    const realSave = coordinator.save.bind(coordinator)
    const saves: Array<Promise<unknown>> = []
    coordinator.save = (path, options) => {
      const run = realSave(path, options)
      saves.push(run)
      return run
    }
    answer('continue')
    await vi.waitFor(() => expect(saves).toHaveLength(1))
    await saves[0]
    expect(bindingOf().state).toBe('conflict')
    expect(h.client.calls.commit).toBe(1)
    expect(Buffer.from(copyBytes()).toString()).toBe('local saved edits awaiting naming')
    expect(bindingOf().baseRevision).toBe('9')
    expect(h.reloaded).toEqual([])
  })

  it('UWNM-BE-R2-1: a first Save that lands after the reload wrote keeps its bytes; the base goes back', async () => {
    const { h, asked } = blankCopy()
    // the module's Save lands between the reload's file write and its last read
    const store = (h.service as unknown as { store: BindingStore }).store
    const realWrite = store.writeWorkingCopy.bind(store)
    let saved = false
    store.writeWorkingCopy = async (target, filename, bytes) => {
      const written = await realWrite(target, filename, bytes)
      if (!saved && hex(bytes) === hex(HEAD_BYTES)) {
        saved = true
        writeFileSync(docPath(), UNSENT)
        h.service.onUserSave(docPath())
      }
      return written
    }
    notice(h)

    await waitForBar(h, { kind: 'newer-dirty', version: 4 })
    expect(saved).toBe(true)
    expect(asked).toHaveLength(1)
    expect(Buffer.from(copyBytes()).toString()).toBe('local saved edits awaiting naming')
    expect(bindingOf()).toMatchObject({ baseRevision: '9', baseVersion: 1 })
    expect(h.reloaded).toEqual([])
  })

  /**
   * The module seam: a requested Save writes what the editor still holds
   * (`editorBytes`) and fires the user-save hook, as a tab's module does. Each
   * call's landing is a promise the test awaits (no wall-clock wait); with a
   * `gate` the write waits on it, so a test can read the chip in between.
   */
  function moduleSaves(
    h: Harness,
    editorBytes: Uint8Array,
    gate: Promise<void> = Promise.resolve(),
  ): Array<Promise<void>> {
    const landed: Array<Promise<void>> = []
    const deps = (h.service as unknown as { deps: { requestModuleSave: ReturnType<typeof vi.fn> } })
      .deps
    deps.requestModuleSave.mockImplementation((path: string) => {
      landed.push(
        gate.then(() => {
          writeFileSync(path, editorBytes)
          h.service.onUserSave(path)
        }),
      )
      return true
    })
    return landed
  }

  /** every coordinator save the service starts, so a test awaits the one `continue` releases */
  function coordinatorSaves(h: Harness): Array<Promise<unknown>> {
    const coordinator = (h.service as unknown as { coordinator: SaveCoordinator }).coordinator
    const realSave = coordinator.save.bind(coordinator)
    const saves: Array<Promise<unknown>> = []
    coordinator.save = (path, options) => {
      const run = realSave(path, options)
      saves.push(run)
      return run
    }
    return saves
  }

  it('UWNM-BE-R3-1: a first Save landing inside the reload write is saved again over the restored base; continue meets the version conflict', async () => {
    const { h, asked, answer } = blankCopy()
    let releaseResave!: () => void
    const resaves = moduleSaves(h, UNSENT, new Promise((resolve) => (releaseResave = resolve)))
    // PROBE-c: the module's Save lands after the reload read the previous bytes
    // but before its own write replaces the file, so the head lands over it
    const store = (h.service as unknown as { store: BindingStore }).store
    const realWrite = store.writeWorkingCopy.bind(store)
    let saved = false
    store.writeWorkingCopy = async (target, filename, bytes) => {
      if (!saved && hex(bytes) === hex(HEAD_BYTES)) {
        saved = true
        writeFileSync(docPath(), UNSENT)
        h.service.onUserSave(docPath())
        // the editor's next poll reports it clean: it believes the Save is done
        h.service.noteEditorDirty(docPath(), false)
      }
      return realWrite(target, filename, bytes)
    }
    notice(h)

    await waitForBar(h, { kind: 'newer-dirty', version: 4 })
    expect(saved).toBe(true)
    // the person's bytes were only in the editor: the module is asked to write them again
    await vi.waitFor(() => expect(resaves).toHaveLength(1))
    // until that write lands the disk holds the base bytes: the chip still reads unsent work
    expect(Buffer.from(copyBytes()).toString()).toBe('working copy bytes')
    expect((await h.service.docStatus(docPath()))?.state).toBe('dirty')
    releaseResave()
    await resaves[0]
    expect(asked).toHaveLength(1)
    expect(Buffer.from(copyBytes()).toString()).toBe('local saved edits awaiting naming')
    expect(bindingOf()).toMatchObject({ baseRevision: '9', baseVersion: 1 })
    expect(h.reloaded).toEqual([])
    expect(await barOf(h)).toEqual({ kind: 'newer-dirty', version: 4 })
    expect((await h.service.docStatus(docPath()))?.state).toBe('dirty')

    const saves = coordinatorSaves(h)
    answer('continue')
    await vi.waitFor(() => expect(saves).toHaveLength(1))
    await saves[0]
    expect(bindingOf().state).toBe('conflict')
    expect(h.client.calls.commit).toBe(1)
    expect(Buffer.from(copyBytes()).toString()).toBe('local saved edits awaiting naming')
    expect(bindingOf().baseRevision).toBe('9')
    expect(h.reloaded).toEqual([])
  })

  it('UWNM-BE-R3-1: a late first Save whose bytes equal the fetched head never reads saved with nothing sent', async () => {
    const { h, asked, answer } = blankCopy()
    // PROBE-d: the person's saved bytes happen to be the head's bytes
    const resaves = moduleSaves(h, HEAD_BYTES)
    const store = (h.service as unknown as { store: BindingStore }).store
    const realWrite = store.writeWorkingCopy.bind(store)
    let saved = false
    store.writeWorkingCopy = async (target, filename, bytes) => {
      const written = await realWrite(target, filename, bytes)
      if (!saved && hex(bytes) === hex(HEAD_BYTES)) {
        saved = true
        writeFileSync(docPath(), HEAD_BYTES)
        h.service.onUserSave(docPath())
      }
      return written
    }
    notice(h)

    await waitForBar(h, { kind: 'newer-dirty', version: 4 })
    await vi.waitFor(() => expect(resaves).toHaveLength(1))
    await resaves[0]
    expect(asked).toHaveLength(1)
    expect(hex(copyBytes())).toBe(hex(HEAD_BYTES))
    expect(bindingOf()).toMatchObject({ baseRevision: '9', baseVersion: 1 })
    expect(h.reloaded).toEqual([])
    expect((await h.service.docStatus(docPath()))?.state).toBe('dirty')

    const saves = coordinatorSaves(h)
    answer('continue')
    await vi.waitFor(() => expect(saves).toHaveLength(1))
    await saves[0]
    // the edits went up and met the newer head: never a silent `saved`
    expect(bindingOf().state).toBe('conflict')
    expect(h.client.calls.commit).toBe(1)
    expect(hex(copyBytes())).toBe(hex(HEAD_BYTES))
  })

  it('UWNM-BE-R3-1: a first Save landing while the reload reads the previous bytes stops it before any head write', async () => {
    const { h, asked } = blankCopy()
    const resaves = moduleSaves(h, UNSENT)
    const store = (h.service as unknown as { store: BindingStore }).store
    const realWrite = store.writeWorkingCopy.bind(store)
    const headWrites: string[] = []
    store.writeWorkingCopy = async (target, filename, bytes) => {
      if (hex(bytes) === hex(HEAD_BYTES)) headWrites.push(filename)
      return realWrite(target, filename, bytes)
    }
    // the reload's pre-write check is the first save-state read after the
    // download: the module's Save is queued there, so it lands while the reload
    // awaits its read of the previous bytes (a microtask runs before any file I/O).
    // Nothing else reads the save state until the reload settles: the test awaits
    // the reload chain itself, never a status poll (docStatus reads it too)
    const coordinator = (h.service as unknown as { coordinator: SaveCoordinator }).coordinator
    const realIsSaving = coordinator.isSaving.bind(coordinator)
    let armed = false
    let landed!: () => void
    const saved = new Promise<void>((resolve) => (landed = resolve))
    coordinator.isSaving = (path) => {
      if (armed) {
        armed = false
        queueMicrotask(() => {
          writeFileSync(docPath(), UNSENT)
          h.service.onUserSave(docPath())
          landed()
        })
      }
      return realIsSaving(path)
    }
    const reloads = (h.service as unknown as { remoteReloads: Map<string, Promise<void>> })
      .remoteReloads
    let release!: () => void
    h.client.downloadGate = new Promise<void>((resolve) => (release = resolve))
    const entered = new Promise<void>((resolve) => (h.client.downloadEntered = resolve))
    notice(h)
    await entered
    const reload = [...reloads.values()]
    expect(reload).toHaveLength(1)
    armed = true
    release()
    await saved
    await reload[0]

    expect(armed).toBe(false)
    expect(headWrites).toEqual([])
    expect(await barOf(h)).toEqual({ kind: 'newer-dirty', version: 4 })
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    expect(resaves).toHaveLength(0)
    expect(Buffer.from(copyBytes()).toString()).toBe('local saved edits awaiting naming')
    expect(bindingOf()).toMatchObject({ baseRevision: '9', baseVersion: 1 })
    expect(h.reloaded).toEqual([])
    expect((await h.service.docStatus(docPath()))?.state).toBe('dirty')
  })
})
