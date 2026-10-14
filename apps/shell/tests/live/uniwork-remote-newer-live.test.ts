/**
 * G5-A03 desktop half (UNI-1354): a web save on a REAL D server - a new version
 * committed by ANOTHER client, not this app - reaches this desktop through the
 * REAL change feed. The suite skips unless UNIWORK_LIVE_ORIGIN names the
 * deployment origin, so the normal shell suite is unchanged.
 *
 * Cloud run (Linux VM, D repo root):
 *   HARNESS_SKIP_APP=1 bash scripts/office/g5g6g7/harness/start.sh
 *   source .harness-run/ports.env    # API_ORIGIN is the origin
 *   cd <fork clone> && UNIWORK_LIVE_ORIGIN=$API_ORIGIN \
 *     UNIWORK_LIVE_FIXTURE_DIR=$D_ROOT/docs/office/g5g6g7/fixtures AI_PROVIDER=fake \
 *     npx vitest run --root apps/shell tests/live/uniwork-remote-newer-live.test.ts --reporter=verbose
 *   bash scripts/office/g5g6g7/harness/stop.sh
 *
 * What is real: the fork's `UniworkDocsService` over the real
 * `createUniworkDocsClient` (detail read + download), the real `SyncRuntime`
 * wired exactly as `wiring.ts` wires it (`onFeedChange` ->
 * `service.noteFeedChange(documentId, revision, change)`, `isOpenBound`,
 * `onFeedGone`, `keepDraft`), the real feed client over the live change feed,
 * the real per-org `CapabilityCache`, and the real durable store layer in a
 * temp directory. Nothing here fakes HTTP; `runtime.tick()` is called by hand
 * instead of waiting for the 60 s poll. The copy is not auto-reloaded: the
 * steps assert what the service does with the notice the feed raises.
 *
 * The "web save": a SECOND `createUniworkDocsClient` instance (its own
 * idempotency keys, prefixed `web-`) uploads new bytes and commits them against
 * the server's current head, so the desktop service under test never issues it,
 * holds no receipt and no self-rename revision for it, and cannot recognise it
 * as this app's own echo. The D commit route carries no client-kind header, so
 * "another client" is the separate client instance with its own key prefix; I5
 * grounds the opposite side on the same server - a commit made by THIS desktop
 * (through the service's own client, settled onto its binding) raises no bar.
 *
 * The "new version" bytes: the same fixture with its zip end-of-central-
 * directory comment replaced (each step uses its own comment). The OOXML file
 * stays structurally valid, and the bytes are a deterministic derivation, never
 * random data.
 *
 * Fixtures: `fx-docx-report-vi.docx` and `fx-xlsx-revenue-xyz.xlsx`, read from
 * UNIWORK_LIVE_FIXTURE_DIR. Unset -> the fixture steps (I1-I4) skip with the
 * reason printed; the self-echo step (I5) uses its own minimal PDF and runs
 * either way. The suite creates only throwaway state (a fresh user/org/
 * workspace per run, like the other live suites); the harness offers no delete
 * route, so nothing else is cleaned up. A token, a password or an origin never
 * enters a message.
 */

import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest'
import type {
  UniworkDocFormat,
  UniworkDocStatus,
  UniworkRemoteBar,
} from '../../src/shared/home-api'
import { BINDING_FILE } from '../../src/main/uniwork-docs/binding-store'
import {
  createUniworkDocsClient,
  type FetchLike,
  type UniworkDocsClient,
} from '../../src/main/uniwork-docs/client'
import { sha256Hex } from '../../src/main/uniwork-docs/formats'
import type { CommitReceipt } from '../../src/main/uniwork-docs/parse'
import { UniworkDocsService, type ConflictUi } from '../../src/main/uniwork-docs/service'
import { CapabilityCache } from '../../src/main/uniwork-sync/capability/cache'
import { createCapabilityFetch } from '../../src/main/uniwork-sync/capability/client'
import { createFeedClient, type FeedChange } from '../../src/main/uniwork-sync/feed/client'
import { INTENT_STORE_REGISTRATION } from '../../src/main/uniwork-sync/intent-store'
import { createSafeStorageKeyProvider } from '../../src/main/uniwork-sync/keys'
import { DRAFTS_STORE_REGISTRATION } from '../../src/main/uniwork-sync/queue/drafts'
import { PAUSE_STORE_REGISTRATION } from '../../src/main/uniwork-sync/queue/pause'
import {
  DOC_INDEX_REGISTRATION,
  FEED_CURSORS_REGISTRATION,
  SyncRuntime,
} from '../../src/main/uniwork-sync/runtime'
import { createSyncStoreAccess } from '../../src/main/uniwork-sync/session-store'
import { createStoreLayer } from '../../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../../src/main/uniwork-sync/test-kit/compliance'
import {
  LIVE,
  LIVE_ORIGIN,
  createLiveApi,
  listDocumentVersions,
  observeFeedClient,
  seedFileDocument,
  seedLiveRun,
  sleep,
  tokenAuthorized,
  type LiveApi,
  type LiveSeed,
  type ObservedFeedClient,
  type SeededFileDocument,
} from './live-harness'

const DOCX_FIXTURE = 'fx-docx-report-vi.docx'
const XLSX_FIXTURE = 'fx-xlsx-revenue-xyz.xlsx'
/** the binding scope this suite runs under (the service's identity must agree) */
const DEPLOYMENT = 'default'
/** a per-run tag so every derived version's bytes are unique to this run */
const RUN_TAG = randomUUID().slice(0, 8)

/** how long one step may wait for the feed to deliver, ticks included */
const STEP_SYNC_BUDGET_MS = 90_000
/** how long one tick's announced notice may take to settle before the next tick */
const TICK_POLL_WINDOW_MS = 10_000
const POLL_INTERVAL_MS = 250

interface ClientCounters {
  getDocument: number
  download: number
  upload: number
  commit: number
}

interface LiveState {
  api: LiveApi
  seed: LiveSeed
  /** the fixture bytes, or null when UNIWORK_LIVE_FIXTURE_DIR is unset */
  fixtures: { docx: Uint8Array; xlsx: Uint8Array } | null
  root: string
  service: UniworkDocsService
  runtime: SyncRuntime
  feed: ObservedFeedClient
  /** what the desktop service's own client did (the app's requests only) */
  serviceClient: ClientCounters
  /** what the `web-` client did (the foreign writer's requests only) */
  webClient: ClientCounters
  /** the org capability `sync_feed` the run's server reports (null = unreadable) */
  syncFeed: boolean | null
  web: UniworkDocsClient
  openPaths: Set<string>
  reloaded: string[]
  statuses: UniworkDocStatus[]
  docs: {
    echo: SeededFileDocument
    docx: SeededFileDocument | null
    xlsx: SeededFileDocument | null
  }
  paths: { docx: string | null; xlsx: string | null; echo: string | null }
}

let liveState: LiveState | null = null

/** one feed page as the server sent it, before the client under test parsed it */
interface RawFeedPage {
  phase: string
  changes: number
  feed: number
}

/** this run's raw feed pages; the client shares the fetch, so a dropped row is still visible here */
let rawFeedPages: RawFeedPage[] = []

/**
 * The fetch the feed client runs on: each feed page's raw row counts are
 * recorded beside the parsed page, so a timeout can tell "the server carried no
 * row" from "the server carried rows and this run saw none" - the two cannot be
 * told apart from the parsed pages alone. The round trip itself is untouched.
 */
const observingFetch: FetchLike = async (input, init) => {
  const response = await fetch(input, init)
  if (new URL(input).pathname.endsWith('/documents/changes')) {
    void response
      .clone()
      .text()
      .then((text) => {
        const body = JSON.parse(text) as Record<string, unknown>
        rawFeedPages.push({
          phase: typeof body.phase === 'string' ? body.phase : '',
          changes: Array.isArray(body.changes) ? body.changes.length : -1,
          feed: Array.isArray(body.feed) ? body.feed.length : -1,
        })
      })
      .catch(() => undefined)
  }
  return response
}

function live(): LiveState {
  if (!liveState) throw new Error('the live suite has no seeded context')
  return liveState
}

function skipStep(context: TestContext, reason: string): void {
  context.skip(reason)
}

function fixtureSkipReason(step: string): string {
  return (
    `${step}: UNIWORK_LIVE_FIXTURE_DIR is not set, so the ${DOCX_FIXTURE} / ${XLSX_FIXTURE} bytes cannot ` +
    "be read; export it (the D root's docs/office/g5g6g7/fixtures) and rerun to ground this step"
  )
}

function readFixture(dir: string, name: string): Uint8Array {
  const file = join(dir, name)
  try {
    return new Uint8Array(readFileSync(file))
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unreadable'
    throw new Error(`the live fixture ${name} could not be read (${reason})`, { cause: error })
  }
}

/** the fixture bytes, or null when the run names no fixture directory */
function readFixtures(): { docx: Uint8Array; xlsx: Uint8Array } | null {
  const dir = (process.env.UNIWORK_LIVE_FIXTURE_DIR ?? '').trim()
  if (!dir) return null
  return { docx: readFixture(dir, DOCX_FIXTURE), xlsx: readFixture(dir, XLSX_FIXTURE) }
}

/** a minimal well-formed PDF the D file validator accepts (header + %%EOF trailer) */
function minimalPdf(tag: string): Uint8Array {
  return new TextEncoder().encode(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n${tag}\n`,
  )
}

/**
 * The fixture bytes with the zip end-of-central-directory comment replaced: the
 * EOCD record is the file's last structure, so the OOXML content and the
 * central directory are untouched and the file stays valid, while the bytes (and
 * their sha256) differ. A fixture without an EOCD record falls back to appending
 * the marker - still deterministic distinct bytes.
 */
function withZipComment(bytes: Uint8Array, comment: string): Uint8Array {
  const marker = new TextEncoder().encode(comment)
  const earliest = Math.max(0, bytes.length - (22 + 0xffff))
  for (let at = bytes.length - 22; at >= earliest; at -= 1) {
    const eocd =
      bytes[at] === 0x50 &&
      bytes[at + 1] === 0x4b &&
      bytes[at + 2] === 0x05 &&
      bytes[at + 3] === 0x06
    if (!eocd) continue
    const commentLength = bytes[at + 20] | (bytes[at + 21] << 8)
    if (at + 22 + commentLength > bytes.length) continue
    const out = new Uint8Array(at + 22 + marker.length)
    out.set(bytes.subarray(0, at + 22), 0)
    out.set(marker, at + 22)
    out[at + 20] = marker.length & 0xff
    out[at + 21] = (marker.length >>> 8) & 0xff
    return out
  }
  const out = new Uint8Array(bytes.length + marker.length)
  out.set(bytes, 0)
  out.set(marker, bytes.length)
  return out
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const out = new Uint8Array(first.length + second.length)
  out.set(first, 0)
  out.set(second, first.length)
  return out
}

function readBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path))
}

/** sha256 of a file on disk, the form the server reports as checksum_sha256 */
function fileSha(path: string): string {
  return sha256Hex(readBytes(path))
}

/** the binding.json of the working copy's folder, as the service wrote it */
function bindingOf(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dirname(path), BINDING_FILE), 'utf8')) as Record<
    string,
    unknown
  >
}

/** the real client behind per-verb counters; the round trip is untouched */
function countedClient(real: UniworkDocsClient, counters: ClientCounters): UniworkDocsClient {
  return {
    ...real,
    async getDocument(documentId) {
      counters.getDocument += 1
      return real.getDocument(documentId)
    },
    async download(documentId, version) {
      counters.download += 1
      return real.download(documentId, version)
    },
    async upload(input) {
      counters.upload += 1
      return real.upload(input)
    },
    async commit(input) {
      counters.commit += 1
      return real.commit(input)
    },
  }
}

function delta(after: number, before: number): number {
  return after - before
}

/** how many reload pushes the shell has seen for one path so far */
function reloadCount(s: LiveState, path: string): number {
  return s.reloaded.filter((seen) => seen === path).length
}

/** the S6 bar the renderer would read for the working copy right now */
async function remoteOf(s: LiveState, path: string): Promise<UniworkRemoteBar | undefined> {
  return (await s.service.docStatus(path))?.remote
}

/** the change row the feed pages carried for one document at one revision */
function feedRow(s: LiveState, documentId: string, revision: string): FeedChange | undefined {
  for (const page of s.feed.pages) {
    for (const change of page.changes) {
      if (change.documentId === documentId && change.revision === revision) return change
    }
  }
  return undefined
}

/**
 * Run the real runtime's pass and poll until it holds, bounded: a notice the
 * feed announced is handled asynchronously (noteFeedChange is fire-and-forget),
 * and the server may take a moment to list a just-committed version, so every
 * window is retried with another tick until the step's budget runs out.
 *
 * The timeout carries the step's diagnostics (see syncDiagnostic), so the next
 * run can tell "the feed never carried the head" from "the feed carried it and
 * this app dropped it".
 */
async function syncUntil(
  s: LiveState,
  step: string,
  done: () => Promise<boolean> | boolean,
  diag?: SyncDiag,
): Promise<void> {
  const deadline = Date.now() + STEP_SYNC_BUDGET_MS
  let ticks = 0
  for (;;) {
    await s.runtime.tick()
    ticks += 1
    const windowEnd = Math.min(deadline, Date.now() + TICK_POLL_WINDOW_MS)
    for (;;) {
      if (await done()) return
      if (Date.now() >= windowEnd) break
      await sleep(POLL_INTERVAL_MS)
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${step}: the live feed did not deliver the expected state within ` +
          `${Math.round(STEP_SYNC_BUDGET_MS / 1000)}s (${ticks} runtime tick(s), ` +
          `${s.feed.pages.length} feed page(s) seen; ` +
          `office_sync_feed=${s.syncFeed === null ? 'unreadable' : s.syncFeed})\n  ` +
          (await syncDiagnostic(s, diag)),
      )
    }
  }
}

/** what the timeout reports about the step (ids, never an origin or a token) */
interface SyncDiag {
  documentId: string
  path: string
  /** the revision the step's own web commit receipt named */
  receiptRevision: string
}

/** the last 6 characters of an id: enough to match a log line, never the whole id */
function shortId(id: string): string {
  return id.length <= 6 ? id : `...${id.slice(-6)}`
}

/** the feed pages seen so far, by phase */
function phaseCounts(s: LiveState): string {
  const counts = new Map<string, number>()
  for (const page of s.feed.pages) counts.set(page.phase, (counts.get(page.phase) ?? 0) + 1)
  if (counts.size === 0) return 'none'
  return [...counts].map(([phase, count]) => `${phase}=${count}`).join(' ')
}

/** what the raw bodies of the feed-phase pages carried, rows the parse may not have kept */
function rawCounts(): string {
  let pages = 0
  let feed = 0
  let changes = 0
  for (const page of rawFeedPages) {
    if (page.phase !== 'feed') continue
    pages += 1
    feed += Math.max(0, page.feed)
    changes += Math.max(0, page.changes)
  }
  return `raw: ${pages} feed page(s) carried ${feed} feed row(s), ${changes} changes row(s)`
}

/** the distinct feed rows the pages actually carried for one document */
function feedRowsSeen(s: LiveState, documentId: string): string {
  const rows = new Set<string>()
  for (const page of s.feed.pages) {
    for (const change of page.changes) {
      if (change.documentId !== documentId) continue
      rows.add(`rev=${change.revision} ver=${change.currentVersion} kind=${change.kind}`)
    }
  }
  const seen = [...rows]
  if (seen.length === 0) return 'no row for this document'
  const shown = seen.slice(-8)
  const older = seen.length - shown.length
  return `${shown.join(' | ')}${older > 0 ? ` | (+${older} earlier)` : ''}`
}

/**
 * The second half of a step timeout: what the feed carried for the step's
 * document, the binding the copy holds now, the service's status/bar and the
 * commit receipt's revision. Nothing here names a token, an origin or a full
 * document id, and a diagnostic failure never replaces the timeout's cause.
 */
async function syncDiagnostic(s: LiveState, diag?: SyncDiag): Promise<string> {
  try {
    const parts = [`feed pages: ${phaseCounts(s)} (${rawCounts()})`]
    if (!diag) return parts.join('; ')
    parts.push(`feed rows for ${shortId(diag.documentId)}: ${feedRowsSeen(s, diag.documentId)}`)
    parts.push(`receipt revision: ${diag.receiptRevision}`)
    let binding = 'unreadable'
    try {
      const raw = bindingOf(diag.path)
      const caught =
        raw.serverRevision === undefined
          ? ''
          : ` caughtRevision=${String(raw.serverRevision)} caughtVersion=${String(raw.serverVersion)}`
      binding = `state=${String(raw.state)} baseRevision=${String(raw.baseRevision)} baseVersion=${String(raw.baseVersion)}${caught}`
    } catch {
      // a copy whose binding is gone is itself the finding
    }
    parts.push(`binding: ${binding}`)
    const status = await s.service.docStatus(diag.path).catch(() => null)
    const bar = status?.remote
    const barText = !bar
      ? 'none'
      : bar.kind === 'revoked' || bar.kind === 'deleted'
        ? bar.kind
        : `${bar.kind} version=${bar.version ?? 'none'}`
    parts.push(status ? `status: state=${status.state} bar=${barText}` : 'status: none (not bound)')
    return parts.join('; ')
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unreadable'
    return `diagnostics unavailable (${reason})`
  }
}

/** the notice for a foreign commit must be seen and handled; nothing may move on the copy */
async function assertNoBarFor(s: LiveState, step: string, path: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  for (;;) {
    expect(
      await remoteOf(s, path),
      `${step}: this app's own commit must never raise a bar`,
    ).toBeUndefined()
    if (Date.now() >= deadline) return
    await sleep(200)
  }
}

/**
 * The "web save": upload new bytes through the `web-` client and commit them
 * against the server's current head, exactly as another client of the
 * deployment would. This app never issues it and holds no receipt for it.
 */
async function webSave(
  s: LiveState,
  step: string,
  documentId: string,
  filename: string,
  format: UniworkDocFormat,
  bytes: Uint8Array,
): Promise<CommitReceipt> {
  const head = await s.web.getDocument(documentId)
  const upload = await s.web.upload({
    documentId,
    bytes,
    filename,
    format,
    idempotencyKey: `web-upload-${step}-${randomUUID()}`,
  })
  const receipt = await s.web.commit({
    documentId,
    uploadId: upload.uploadId,
    baseRevision: head.revision,
    idempotencyKey: `web-commit-${step}-${randomUUID()}`,
  })
  expect(receipt.documentId, `${step}: the web commit receipt names the document`).toBe(documentId)
  expect(receipt.checksumSha256, `${step}: the web commit stored exactly the uploaded bytes`).toBe(
    sha256Hex(bytes),
  )
  return receipt
}

/** a local edit the feed never sees: the working copy's bytes move past its base */
async function makeDirty(
  s: LiveState,
  step: string,
  path: string,
  marker: string,
): Promise<Uint8Array> {
  const bytes = concat(readBytes(path), new TextEncoder().encode(marker))
  writeFileSync(path, bytes)
  const status = await s.service.docStatus(path)
  expect(status?.state, `${step}: the local edit must read as a dirty working copy`).toBe('dirty')
  return bytes
}

describe.skipIf(!LIVE)('G5-A03 live: a web save on the real D server reaches the desktop', () => {
  beforeAll(async () => {
    const origin = LIVE_ORIGIN
    const api = createLiveApi(origin)
    const fixtures = readFixtures()
    const seed = await seedLiveRun(api, 0)
    const root = mkdtempSync(join(tmpdir(), 'uw-g503a-live-'))

    const safeStorage = createLockableSafeStorage()
    const layer = createStoreLayer({
      root: join(root, 'sync', 'store'),
      keys: createSafeStorageKeyProvider({ safeStorage, dir: join(root, 'sync', 'keys') }),
      budgetBytes: 1 << 20,
      clock: () => Date.now(),
    })
    layer.register(INTENT_STORE_REGISTRATION)
    layer.register(DRAFTS_STORE_REGISTRATION)
    layer.register(PAUSE_STORE_REGISTRATION)
    layer.register(FEED_CURSORS_REGISTRATION)
    layer.register(DOC_INDEX_REGISTRATION)
    const syncStore = createSyncStoreAccess({
      layer,
      scope: () => ({ deploymentId: DEPLOYMENT, accountId: seed.userId }),
    })

    const authorized = tokenAuthorized(seed.token)
    const serviceClient: ClientCounters = { getDocument: 0, download: 0, upload: 0, commit: 0 }
    const webClient: ClientCounters = { getDocument: 0, download: 0, upload: 0, commit: 0 }
    const client = countedClient(
      createUniworkDocsClient({ apiOrigin: origin, authorized, isSignedIn: () => true }),
      serviceClient,
    )
    const web = countedClient(
      createUniworkDocsClient({ apiOrigin: origin, authorized, isSignedIn: () => true }),
      webClient,
    )
    // the one per-org capability cache the runtime and the service's save queue
    // share, exactly as the production wiring shares it
    const capability = new CapabilityCache({
      fetch: createCapabilityFetch({ apiOrigin: origin, authorized, isSignedIn: () => true }),
      clock: { now: () => Date.now() },
    })
    // read once up front so a feed-off server is named, not waited on for 90 s
    const capabilityRead = await capability.get(seed.orgId)
    const syncFeed = capabilityRead.kind === 'ok' ? capabilityRead.capabilities.sync_feed : null

    const openPaths = new Set<string>()
    const reloaded: string[] = []
    const statuses: UniworkDocStatus[] = []
    const ui: ConflictUi = {
      async chooseConflict() {
        return 'later'
      },
      async confirmDiscard() {
        return false
      },
      async pickCopyPath() {
        return null
      },
      showOpenLatestFailed() {},
      showCopyFailed() {},
      async chooseUnsavedClose() {
        return 'cancel'
      },
    }
    const service = new UniworkDocsService({
      userDataDir: root,
      syncStore,
      appVersion: () => '0.11.0',
      profile: () => ({
        deploymentId: DEPLOYMENT,
        apiOrigin: origin,
        clientId: 'uniwork-office',
        channel: 'stable',
      }),
      channel: () => 'stable',
      applyProfile: async () => 'unchanged',
      identity: () => ({
        accountId: seed.userId,
        deviceSessionId: 'g5-03a-live',
        deploymentId: DEPLOYMENT,
      }),
      keystoreLocked: () => false,
      selectedOrg: () => ({ id: seed.orgId, slug: 'g5-03a-live' }),
      authorized,
      openPath: (path) => {
        openPaths.add(path)
        return true
      },
      isPathOpen: (path) => openPaths.has(path),
      requestModuleSave: () => false,
      reloadPath: (path) => {
        reloaded.push(path)
      },
      activePath: () => undefined,
      // the copy has no open editor in this suite: the dirty cases are file-level
      editorStateOf: async () => ({ dirty: false, aiRunning: false, aiEpoch: 0 }),
      capability: { get: (orgId) => capability.get(orgId) },
      client,
      ui,
      pushStatus: (status) => {
        statuses.push(status)
      },
      pushLaunch: () => {},
      reveal: () => {},
      isPackaged: true,
    })

    // the real runtime, wired exactly as wiring.ts wires it against the live feed
    const feed = observeFeedClient(
      createFeedClient({
        apiOrigin: origin,
        authorized,
        isSignedIn: () => true,
        fetch: observingFetch,
      }),
    )
    const runtime = new SyncRuntime({
      store: syncStore,
      targets: {
        orgs: () => [seed.orgId],
        workspaces: async (orgId) => (await client.listWorkspaces(orgId)).map((row) => row.id),
      },
      capability: async (orgId) => capability.get(orgId),
      client: () => feed.client,
      keepDraft: (documentId) => service.hasLocalDraft(documentId),
      clock: { now: () => Date.now() },
      onFeedChange: (change) => service.noteFeedChange(change.documentId, change.revision, change),
      isOpenBound: (documentId) => service.isOpenBound(documentId),
      onFeedGone: (documentId) => {
        void service.noteFeedGone(documentId).catch(() => undefined)
      },
    })

    const echo = await seedFileDocument(
      origin,
      seed.token,
      seed.workspaceId,
      'g5-03a-live-echo.pdf',
      minimalPdf('g5-03a-live-echo-v1'),
    )
    const docx = fixtures
      ? await seedFileDocument(origin, seed.token, seed.workspaceId, DOCX_FIXTURE, fixtures.docx)
      : null
    const xlsx = fixtures
      ? await seedFileDocument(origin, seed.token, seed.workspaceId, XLSX_FIXTURE, fixtures.xlsx)
      : null

    liveState = {
      api,
      seed,
      fixtures,
      root,
      service,
      runtime,
      feed,
      serviceClient,
      webClient,
      syncFeed,
      web,
      openPaths,
      reloaded,
      statuses,
      docs: { echo, docx, xlsx },
      paths: { docx: null, xlsx: null, echo: null },
    }
  }, 180_000)

  afterAll(() => {
    if (liveState) rmSync(liveState.root, { recursive: true, force: true })
    liveState = null
    rawFeedPages = []
  })

  it('I0. cold start: the real feed lists every seeded head through the runtime', async () => {
    const s = live()
    expect(
      s.syncFeed,
      'I0: this acceptance needs the live org capability office_sync_feed on (D default); the ' +
        'harness must not be started with FF_OFFICE_SYNC_FEED=false for this suite',
    ).toBe(true)
    const seeded = [s.docs.echo, s.docs.docx, s.docs.xlsx].filter(
      (doc): doc is SeededFileDocument => doc !== null,
    )
    await syncUntil(s, 'I0', () =>
      seeded.every((doc) => feedRow(s, doc.documentId, doc.revision) !== undefined),
    )
    expect(
      s.feed.snapshotOpens(),
      'I0: the cold start must open a snapshot (no cursor exists yet)',
    ).toBeGreaterThan(0)
    for (const doc of seeded) {
      const row = feedRow(s, doc.documentId, doc.revision)
      expect(row, `I0: the feed must list the seeded head of ${doc.documentId}`).toBeTruthy()
      expect(
        row?.currentVersion,
        `I0: the feed's current_version must be the seeded version of ${doc.documentId}`,
      ).toBe(doc.currentVersion)
    }
    // nothing is open yet: the cold-start notices have no surface to move
    expect(s.reloaded, 'I0: a cold start must reload nothing').toEqual([])
  }, 60_000)

  it('I1. docx clean reload: a web save lands as the new head (bytes sha, base, bar updated)', async (context) => {
    const s = live()
    if (!s.fixtures || !s.docs.docx) {
      skipStep(context, fixtureSkipReason('I1'))
      return
    }
    const doc = s.docs.docx
    const opened = await s.service.openFromServer(doc.documentId)
    s.paths.docx = opened.path
    const path = opened.path
    expect(basename(path), 'I1: the working copy keeps the fixture name').toBe(DOCX_FIXTURE)

    const headBefore = await s.web.getDocument(doc.documentId)
    expect(headBefore.revision, 'I1: the copy opened at the seeded head revision').toBe(
      doc.revision,
    )
    expect(fileSha(path), 'I1: the clean copy holds the seeded head bytes').toBe(
      headBefore.file.checksumSha256,
    )
    expect(await remoteOf(s, path), 'I1: no bar exists before the web save').toBeUndefined()

    const bytes = withZipComment(s.fixtures.docx, `g5-03a I1 web save ${RUN_TAG}`)
    expect(
      sha256Hex(bytes),
      'I1: the derived new version must differ from the seeded head bytes',
    ).not.toBe(headBefore.file.checksumSha256)

    const before = { ...s.serviceClient }
    const receipt = await webSave(s, 'I1', doc.documentId, DOCX_FIXTURE, 'docx', bytes)
    expect(
      delta(s.serviceClient.upload, before.upload),
      'I1: the web save must not go through the desktop client',
    ).toBe(0)
    expect(
      delta(s.serviceClient.commit, before.commit),
      'I1: the web save must not go through the desktop client',
    ).toBe(0)
    const downloadsBefore = s.serviceClient.download

    await syncUntil(s, 'I1', async () => (await remoteOf(s, path))?.kind === 'updated', {
      documentId: doc.documentId,
      path,
      receiptRevision: receipt.revision,
    })

    const status = await s.service.docStatus(path)
    expect(status?.remote, 'I1: the bar must say the copy was updated to the new head').toEqual({
      kind: 'updated',
      version: receipt.version,
    })
    expect(status?.state, 'I1: the reloaded copy reads saved').toBe('saved')

    const headAfter = await s.web.getDocument(doc.documentId)
    expect(headAfter.revision, 'I1: the head revision is the commit receipt revision').toBe(
      receipt.revision,
    )
    expect(fileSha(path), 'I1: the copy bytes hash to the uploaded version bytes').toBe(
      sha256Hex(bytes),
    )
    expect(fileSha(path), 'I1: the copy bytes hash to the server head checksum').toBe(
      headAfter.file.checksumSha256,
    )
    const binding = bindingOf(path)
    expect(binding.baseRevision, 'I1: the binding base revision is the head revision').toBe(
      headAfter.revision,
    )
    expect(binding.baseVersion, 'I1: the binding base version is the head version').toBe(
      headAfter.file.version,
    )
    expect(binding.baseVersion, 'I1: the binding base version is the receipt version').toBe(
      receipt.version,
    )
    expect(binding.baseChecksum, 'I1: the binding base checksum is the head bytes').toBe(
      sha256Hex(bytes),
    )
    expect(
      binding.serverRevision,
      'I1: a consumed notice leaves no caught head behind',
    ).toBeUndefined()
    expect(s.reloaded, 'I1: the tab reload push ran for the copy').toContain(path)
    expect(reloadCount(s, path), 'I1: exactly one reload push followed the notice').toBe(1)
    expect(
      delta(s.serviceClient.download, downloadsBefore),
      'I1: the clean reload downloads the head exactly once',
    ).toBe(1)

    const versions = await listDocumentVersions(s.api, s.seed.token, doc.documentId)
    expect(versions.ids[0], 'I1: the server head version id is the receipt version id').toBe(
      receipt.versionId,
    )
    const row = feedRow(s, doc.documentId, receipt.revision)
    expect(row, 'I1: the feed carried the new head revision').toBeTruthy()
    expect(row?.versionId, 'I1: the feed notice carried the head version id').toBe(
      receipt.versionId,
    )
    expect(row?.currentVersion, 'I1: the feed notice carried the head version number').toBe(
      receipt.version,
    )
  }, 120_000)

  it('I2. docx dirty kept: the next web save moves nothing (bytes, base, no download)', async (context) => {
    const s = live()
    if (!s.fixtures || !s.docs.docx || !s.paths.docx) {
      skipStep(context, fixtureSkipReason('I2'))
      return
    }
    const doc = s.docs.docx
    const path = s.paths.docx
    const beforeBinding = bindingOf(path)
    const edited = await makeDirty(s, 'I2', path, `\n<!-- g5-03a I2 local edit ${RUN_TAG} -->\n`)
    const editedSha = fileSha(path)
    const reloadsBefore = reloadCount(s, path)

    const before = { ...s.serviceClient }
    const receipt = await webSave(
      s,
      'I2',
      doc.documentId,
      DOCX_FIXTURE,
      'docx',
      withZipComment(s.fixtures.docx, `g5-03a I2 web save ${RUN_TAG}`),
    )

    await syncUntil(s, 'I2', async () => (await remoteOf(s, path))?.kind === 'newer-dirty', {
      documentId: doc.documentId,
      path,
      receiptRevision: receipt.revision,
    })

    const status = await s.service.docStatus(path)
    expect(status?.remote, 'I2: a dirty copy gets the newer-dirty bar at the web save').toEqual({
      kind: 'newer-dirty',
      version: receipt.version,
    })
    expect(status?.state, 'I2: the copy still reads dirty').toBe('dirty')
    expect(readBytes(path), 'I2: the locally edited bytes are untouched').toEqual(edited)
    expect(fileSha(path), 'I2: the copy bytes are untouched').toBe(editedSha)
    const binding = bindingOf(path)
    expect(binding.baseRevision, 'I2: the base revision is untouched').toBe(
      beforeBinding.baseRevision,
    )
    expect(binding.baseVersion, 'I2: the base version is untouched').toBe(beforeBinding.baseVersion)
    expect(binding.baseChecksum, 'I2: the base checksum is untouched').toBe(
      beforeBinding.baseChecksum,
    )
    expect(binding.serverRevision, 'I2: the caught head is kept for a restart rebuild').toBe(
      receipt.revision,
    )
    expect(binding.serverVersion, 'I2: the caught head version is kept too').toBe(receipt.version)
    expect(
      delta(s.serviceClient.download, before.download),
      'I2: a dirty copy is never downloaded over',
    ).toBe(0)
    expect(
      delta(s.serviceClient.upload, before.upload),
      'I2: the desktop uploaded nothing for the web save',
    ).toBe(0)
    expect(
      delta(s.serviceClient.commit, before.commit),
      'I2: the desktop committed nothing for the web save',
    ).toBe(0)
    expect(
      delta(reloadCount(s, path), reloadsBefore),
      'I2: no reload push may follow a kept dirty copy',
    ).toBe(0)
  }, 120_000)

  it('I3. xlsx clean reload: the web save lands as the new head (bytes sha, base, bar updated)', async (context) => {
    const s = live()
    if (!s.fixtures || !s.docs.xlsx) {
      skipStep(context, fixtureSkipReason('I3'))
      return
    }
    const doc = s.docs.xlsx
    const opened = await s.service.openFromServer(doc.documentId)
    s.paths.xlsx = opened.path
    const path = opened.path
    expect(basename(path), 'I3: the working copy keeps the fixture name').toBe(XLSX_FIXTURE)

    const headBefore = await s.web.getDocument(doc.documentId)
    expect(headBefore.revision, 'I3: the copy opened at the seeded head revision').toBe(
      doc.revision,
    )
    expect(fileSha(path), 'I3: the clean copy holds the seeded head bytes').toBe(
      headBefore.file.checksumSha256,
    )

    const bytes = withZipComment(s.fixtures.xlsx, `g5-03a I3 web save ${RUN_TAG}`)
    expect(
      sha256Hex(bytes),
      'I3: the derived new version must differ from the seeded head bytes',
    ).not.toBe(headBefore.file.checksumSha256)

    const before = { ...s.serviceClient }
    const receipt = await webSave(s, 'I3', doc.documentId, XLSX_FIXTURE, 'xlsx', bytes)
    expect(
      delta(s.serviceClient.upload, before.upload),
      'I3: the web save must not go through the desktop client',
    ).toBe(0)
    expect(
      delta(s.serviceClient.commit, before.commit),
      'I3: the web save must not go through the desktop client',
    ).toBe(0)
    const downloadsBefore = s.serviceClient.download

    await syncUntil(s, 'I3', async () => (await remoteOf(s, path))?.kind === 'updated', {
      documentId: doc.documentId,
      path,
      receiptRevision: receipt.revision,
    })

    const status = await s.service.docStatus(path)
    expect(status?.remote, 'I3: the bar must say the copy was updated to the new head').toEqual({
      kind: 'updated',
      version: receipt.version,
    })
    expect(status?.state, 'I3: the reloaded copy reads saved').toBe('saved')

    const headAfter = await s.web.getDocument(doc.documentId)
    expect(fileSha(path), 'I3: the copy bytes hash to the uploaded version bytes').toBe(
      sha256Hex(bytes),
    )
    expect(fileSha(path), 'I3: the copy bytes hash to the server head checksum').toBe(
      headAfter.file.checksumSha256,
    )
    const binding = bindingOf(path)
    expect(binding.baseRevision, 'I3: the binding base revision is the head revision').toBe(
      headAfter.revision,
    )
    expect(binding.baseVersion, 'I3: the binding base version is the head version').toBe(
      headAfter.file.version,
    )
    expect(binding.baseChecksum, 'I3: the binding base checksum is the head bytes').toBe(
      sha256Hex(bytes),
    )
    expect(s.reloaded, 'I3: the tab reload push ran for the copy').toContain(path)
    expect(reloadCount(s, path), 'I3: exactly one reload push followed the notice').toBe(1)
    expect(
      delta(s.serviceClient.download, downloadsBefore),
      'I3: the clean reload downloads the head exactly once',
    ).toBe(1)

    const versions = await listDocumentVersions(s.api, s.seed.token, doc.documentId)
    expect(versions.ids[0], 'I3: the server head version id is the receipt version id').toBe(
      receipt.versionId,
    )
    const row = feedRow(s, doc.documentId, receipt.revision)
    expect(row, 'I3: the feed carried the new head revision').toBeTruthy()
    expect(row?.versionId, 'I3: the feed notice carried the head version id').toBe(
      receipt.versionId,
    )
  }, 120_000)

  it('I4. xlsx dirty kept: the next web save moves nothing (bytes, base, no download)', async (context) => {
    const s = live()
    if (!s.fixtures || !s.docs.xlsx || !s.paths.xlsx) {
      skipStep(context, fixtureSkipReason('I4'))
      return
    }
    const doc = s.docs.xlsx
    const path = s.paths.xlsx
    const beforeBinding = bindingOf(path)
    const edited = await makeDirty(s, 'I4', path, `\n<!-- g5-03a I4 local edit ${RUN_TAG} -->\n`)
    const editedSha = fileSha(path)
    const reloadsBefore = reloadCount(s, path)

    const before = { ...s.serviceClient }
    const receipt = await webSave(
      s,
      'I4',
      doc.documentId,
      XLSX_FIXTURE,
      'xlsx',
      withZipComment(s.fixtures.xlsx, `g5-03a I4 web save ${RUN_TAG}`),
    )

    await syncUntil(s, 'I4', async () => (await remoteOf(s, path))?.kind === 'newer-dirty', {
      documentId: doc.documentId,
      path,
      receiptRevision: receipt.revision,
    })

    const status = await s.service.docStatus(path)
    expect(status?.remote, 'I4: a dirty copy gets the newer-dirty bar at the web save').toEqual({
      kind: 'newer-dirty',
      version: receipt.version,
    })
    expect(status?.state, 'I4: the copy still reads dirty').toBe('dirty')
    expect(readBytes(path), 'I4: the locally edited bytes are untouched').toEqual(edited)
    expect(fileSha(path), 'I4: the copy bytes are untouched').toBe(editedSha)
    const binding = bindingOf(path)
    expect(binding.baseRevision, 'I4: the base revision is untouched').toBe(
      beforeBinding.baseRevision,
    )
    expect(binding.baseVersion, 'I4: the base version is untouched').toBe(beforeBinding.baseVersion)
    expect(binding.baseChecksum, 'I4: the base checksum is untouched').toBe(
      beforeBinding.baseChecksum,
    )
    expect(binding.serverRevision, 'I4: the caught head is kept for a restart rebuild').toBe(
      receipt.revision,
    )
    expect(
      delta(s.serviceClient.download, before.download),
      'I4: a dirty copy is never downloaded over',
    ).toBe(0)
    expect(
      delta(reloadCount(s, path), reloadsBefore),
      'I4: no reload push may follow a kept dirty copy',
    ).toBe(0)
  }, 120_000)

  it("I5. self-echo: this app's own commit raises no bar on the copy that made it", async () => {
    const s = live()
    const doc = s.docs.echo
    const opened = await s.service.openFromServer(doc.documentId)
    s.paths.echo = opened.path
    const path = opened.path
    expect(fileSha(path), 'I5: the copy opened at the seeded head bytes').toBe(
      sha256Hex(minimalPdf('g5-03a-live-echo-v1')),
    )

    const next = minimalPdf(`g5-03a-live-echo-v2-${RUN_TAG}`)
    writeFileSync(path, next)
    expect((await s.service.docStatus(path))?.state, 'I5: the local edit must read dirty').toBe(
      'dirty',
    )

    const before = { ...s.serviceClient }
    const webBefore = { ...s.webClient }
    const saved = await s.service.save(path)
    expect(saved?.state, "I5: the app's own save settles the copy").toBe('saved')
    const binding = bindingOf(path)
    const appRevision = String(binding.baseRevision ?? '')
    expect(appRevision, "I5: the app's own commit moved the base onto its receipt").not.toBe(
      doc.revision,
    )
    expect(binding.baseChecksum, 'I5: the base checksum is the uploaded bytes').toBe(
      sha256Hex(next),
    )
    expect(
      delta(s.serviceClient.upload, before.upload),
      "I5: the app's own save uploads through its own client",
    ).toBe(1)
    expect(
      delta(s.serviceClient.commit, before.commit),
      "I5: the app's own save commits through its own client",
    ).toBe(1)

    // the feed must really deliver this app's own revision, and the service must
    // ignore it: no bar, no reload, no byte moves
    await syncUntil(s, 'I5', () => feedRow(s, doc.documentId, appRevision) !== undefined, {
      documentId: doc.documentId,
      path,
      receiptRevision: appRevision,
    })
    expect(
      delta(s.webClient.commit, webBefore.commit),
      'I5: no web client commit is involved in the self-echo check',
    ).toBe(0)
    await assertNoBarFor(s, 'I5', path, 2_000)
    expect(readBytes(path), "I5: the app's own commit leaves the copy bytes untouched").toEqual(
      next,
    )
    expect(delta(reloadCount(s, path), 0), "I5: no reload push follows the app's own commit").toBe(
      0,
    )
    expect(bindingOf(path).baseRevision, "I5: the base stays the app's own receipt revision").toBe(
      appRevision,
    )
  }, 120_000)
})
