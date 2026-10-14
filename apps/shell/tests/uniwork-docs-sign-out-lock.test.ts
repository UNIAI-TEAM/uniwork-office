import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SignOutProgress,
  UniworkDocLock,
  UniworkDocStatus,
  UniworkLaunchEvent,
} from '../src/shared/home-api'
import { pathKey } from '../src/shared/path-key'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { AccountBoundary } from '../src/main/uniwork-docs/account-boundary'
import {
  BINDING_FILE,
  LAST_OWNER_FILE,
  bindingJson,
  type Binding,
} from '../src/main/uniwork-docs/binding-store'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import { INTENT_STORE_REGISTRATION, createIntentStore } from '../src/main/uniwork-sync/intent-store'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { PARKED_STORE_REGISTRATION, createParkedStore } from '../src/main/uniwork-sync/queue/parked'
import { SIGN_OUT_RECEIPT_WAIT_MS } from '../src/main/uniwork-sync/queue/limits'
import {
  SYNC_STORE_REGISTRATIONS,
  createSyncStoreAccess,
} from '../src/main/uniwork-sync/session-store'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'

const TOKEN = 'secret-access-token-0123456789'
const ORIGIN = 'https://uniwork.example'
const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const enc = (text: string) => new TextEncoder().encode(text)
const hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-sign-out-lock-'))
  mkdirSync(join(dir, 'uniwork-documents'), { recursive: true })
  writeFileSync(
    join(dir, 'uniwork-documents', LAST_OWNER_FILE),
    JSON.stringify({ accountId: 'acc_1', deploymentId: 'default' }),
  )
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const ownerA = { deploymentId: 'default', accountId: 'acc_1' }
const docDir = (docId = DOC) => join(dir, 'uniwork-documents', 'default', 'acc_1', docId)
const docPath = (docId = DOC, name = 'Plan.docx') => join(docDir(docId), name)

function seedWorkingCopy(
  opts: {
    docId?: string
    name?: string
    format?: 'docx' | 'xlsx'
    bytes?: string
    baseBytes?: string
    state?: Binding['state']
  } = {},
): string {
  const docId = opts.docId ?? DOC
  const name = opts.name ?? 'Plan.docx'
  const format = opts.format ?? 'docx'
  const bytes = opts.bytes ?? 'v3 base'
  const baseBytes = opts.baseBytes ?? 'v3 base'
  const folder = docDir(docId)
  const file = docPath(docId, name)
  mkdirSync(folder, { recursive: true })
  writeFileSync(file, bytes)
  const binding: Binding = {
    schema: 2,
    documentId: docId,
    workspaceId: 'ws_1',
    orgId: 'org_a',
    title: name,
    filename: name,
    format,
    access: 'edit',
    baseRevision: '41',
    baseVersion: 3,
    baseChecksum: hex(enc(baseBytes)),
    state: opts.state ?? (bytes === baseBytes ? 'saved' : 'dirty'),
    minStoreLevel: 2,
    minAppVersion: '0.11.0',
  }
  writeFileSync(join(folder, BINDING_FILE), JSON.stringify(bindingJson(binding), null, 2))
  return file
}

/** every file under `root` whose bytes contain `marker`, sorted (row 8 sweep) */
function filesContaining(root: string, marker: string): string[] {
  const hits: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (readFileSync(full).includes(marker)) hits.push(full)
    }
  }
  walk(root)
  return hits.sort()
}

function setup(
  opts: {
    account?: string | null
    keystoreLocked?: boolean
    budgetBytes?: number
    openPaths?: string[]
    sleep?: (ms: number) => Promise<void>
    requestModuleSave?: (
      path: string,
      onNotWritten?: () => void,
      mode?: 'save' | 'capture',
    ) => boolean
    fetch?: (url: string, init?: RequestInit) => Promise<Response>
  } = {},
) {
  const statuses: UniworkDocStatus[] = []
  const launches: UniworkLaunchEvent[] = []
  const locks: UniworkDocLock[] = []
  const progress: SignOutProgress[] = []
  const slept: number[] = []
  const safeStorage: LockableSafeStorage = createLockableSafeStorage()
  let account: string | null = opts.account === undefined ? 'acc_1' : opts.account
  let keystoreLocked = opts.keystoreLocked === true
  const openSet = new Set(opts.openPaths ?? [])

  const layer = createStoreLayer({
    root: join(dir, 'uniwork-sync', 'store'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(dir, 'uniwork-sync', 'keys') }),
    budgetBytes: opts.budgetBytes ?? 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  for (const reg of SYNC_STORE_REGISTRATIONS) layer.register(reg)

  const syncStore = createSyncStoreAccess({
    layer,
    scope: () => (account ? { deploymentId: 'default', accountId: account } : null),
  })

  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }

  const sleep =
    opts.sleep ??
    vi.fn(async (ms: number) => {
      slept.push(ms)
    })

  const requestModuleSave =
    opts.requestModuleSave ??
    vi.fn((_p: string, onNotWritten?: () => void) => {
      onNotWritten?.()
      return false
    })

  const defaultFetch = vi.fn(async (url: string) => {
    const pathname = new URL(url).pathname
    if (pathname.endsWith('/uploads')) {
      return new Response(
        JSON.stringify({
          upload_id: 'up_tok_1',
          checksum_sha256: hex(enc('v4 restored')),
          size_bytes: 11,
          claim_expires_at: '2026-04-17T01:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (pathname.endsWith('/versions/commit')) {
      return new Response(
        JSON.stringify({
          document: { id: DOC, revision: '42', current_version: 4 },
          version: { id: 'ver_4', version: 4, checksum_sha256: hex(enc('v4 restored')) },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(
      JSON.stringify({
        document: {
          id: DOC,
          organization_id: 'org_a',
          workspace_id: 'ws_1',
          title: 'Plan.docx',
          kind: 'file',
          revision: '41',
          current_version: 3,
          my_level: 'edit',
          file: {
            filename: 'Plan.docx',
            mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            version: 3,
            checksum_sha256: hex(enc('v3 base')),
            size_bytes: 7,
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  })

  const fetchFn = opts.fetch ?? defaultFetch

  const service = new UniworkDocsService({
    userDataDir: dir,
    syncStore,
    profile: () => profile,
    identity: () =>
      account ? { accountId: account, deviceSessionId: 'dev_1', deploymentId: 'default' } : null,
    keystoreLocked: () => keystoreLocked,
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    fetch: fetchFn as never,
    openPath: vi.fn((p: string) => {
      openSet.add(p)
      return true
    }),
    isPathOpen: vi.fn((p: string) => openSet.has(p)),
    openPaths: () => [...openSet],
    requestModuleSave,
    reloadPath: vi.fn(),
    activePath: () => undefined,
    reveal: vi.fn(),
    pushStatus: (s) => statuses.push(s),
    pushLaunch: (e) => launches.push(e),
    pushLock: (l) => locks.push(l),
    pushSignOutProgress: (p) => progress.push(p),
    channel: () => 'stable',
    applyProfile: () => ({ ok: true, profile }),
    ui,
    sleep,
    now: () => 1_700_000_000_000,
  })

  return {
    service,
    layer,
    syncStore,
    safeStorage,
    statuses,
    locks,
    progress,
    slept,
    openSet,
    requestModuleSave,
    ui,
    fetch: fetchFn,
    setAccount: (next: string | null) => {
      account = next
    },
    setKeystoreLocked: (locked: boolean) => {
      keystoreLocked = locked
    },
  }
}

describe('G5-11 sign-out lock-and-keep, N+1 park, and restoreParked', () => {
  it('1. clean sign-out: plan has count=0, locks store (open handle reads interrupted), deletes working copies', async () => {
    const path = seedWorkingCopy({ bytes: 'v3 base', baseBytes: 'v3 base', state: 'saved' })
    const ctx = setup({ openPaths: [path] })
    const opened = await ctx.service.openSyncStore()
    expect(opened.kind).toBe('ok')
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const recordsBefore = opened.records(INTENT_STORE_REGISTRATION.name)

    const plan = await ctx.service.signOutPlan()
    expect(plan).toEqual({
      count: 0,
      waiting: 0,
      keystoreLocked: false,
      ramOnly: 0,
    })

    const res = await ctx.service.lockSession(ownerA)
    expect(res).toEqual({ ok: true, captureFailed: [] })
    expect(existsSync(docDir())).toBe(false)
    // Open handle from before lockSession now reads 'interrupted'
    expect(await recordsBefore.read(DOC)).toEqual({ kind: 'interrupted' })
    // Store directory still exists on disk (locked, not wiped)
    expect(existsSync(join(dir, 'uniwork-sync', 'store', 'default', 'acc_1'))).toBe(true)
  })

  it('2. dirty sign-out with stored intent and N+1 bytes: plan has count=1, intent ciphertext stays byte-identical, N+1 parked, working copy deleted', async () => {
    const path = seedWorkingCopy({ bytes: 'v5 n+1 on disk', baseBytes: 'v3 base', state: 'dirty' })
    const ctx = setup({ openPaths: [path] })
    const opened = await ctx.layer.open(ownerA)
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
    const payload = enc('v4 queued')
    await intents.put(
      DOC,
      {
        v: 2,
        intentId: 'int_1',
        idempotencyKey: 'idem_1',
        documentId: DOC,
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: hex(payload),
        length: payload.byteLength,
        generation: 1,
        state: 'queued',
        attempt: 0,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
      payload,
    )
    const intentDir = join(dir, 'uniwork-sync', 'store', 'default', 'acc_1', 'intents')
    const recFilesBefore = readdirSync(intentDir).filter((f) => f.endsWith('.rec'))
    expect(recFilesBefore).toHaveLength(1)
    const intentBytesBefore = readFileSync(join(intentDir, recFilesBefore[0]!))

    const plan = await ctx.service.signOutPlan()
    expect(plan).toEqual({
      count: 1,
      waiting: 0,
      keystoreLocked: false,
      ramOnly: 0,
    })

    const res = await ctx.service.lockSession(ownerA)
    expect(res).toEqual({ ok: true, captureFailed: [] })
    expect(existsSync(docDir())).toBe(false)

    // Intent .rec file stays byte-identical in intents store; N+1 bytes land in parked
    const intentBytesAfter = readFileSync(join(intentDir, recFilesBefore[0]!))
    expect(intentBytesAfter.equals(intentBytesBefore)).toBe(true)
    const reopen = await ctx.layer.open(ownerA)
    if (reopen.kind !== 'ok') throw new Error(reopen.kind)
    const parked = createParkedStore(reopen.store.records(PARKED_STORE_REGISTRATION.name))
    expect(await parked.list()).toEqual([DOC])
  })

  it('3. dirty sign-out with N+1 in editor/disk: captures via requestModuleSave(..., "capture"), parks N+1, deletes working and recovery copies', async () => {
    const path = seedWorkingCopy({ bytes: 'v3 base', baseBytes: 'v3 base', state: 'saved' })
    const sheetPath = seedWorkingCopy({
      docId: '01J8X4DOCSHEET0000000000',
      name: 'Budget.xlsx',
      format: 'xlsx',
      bytes: 's1',
      baseBytes: 's1',
      state: 'saved',
    })

    // Seed docs-autosave and sheets-autosave recovery copies under the module's
    // real naming (`sha1(path).slice(0,16)` + the module's extension)
    const docsRecoveryDir = join(dir, 'docs-autosave')
    const sheetsRecoveryDir = join(dir, 'sheets-autosave')
    mkdirSync(docsRecoveryDir, { recursive: true })
    mkdirSync(sheetsRecoveryDir, { recursive: true })
    const docHash = createHash('sha1').update(path).digest('hex').slice(0, 16)
    const sheetHash = createHash('sha1').update(sheetPath).digest('hex').slice(0, 16)
    const docRecoveryFile = join(docsRecoveryDir, `${docHash}.docx`)
    const sheetRecoveryFile = join(sheetsRecoveryDir, `${sheetHash}.xlsx`)
    writeFileSync(docRecoveryFile, 'recovery docx')
    writeFileSync(sheetRecoveryFile, 'recovery xlsx')

    let onUserSaveCount = 0
    const ctx = setup({
      openPaths: [path, sheetPath],
      requestModuleSave: vi.fn(
        (targetPath: string, _onNotWritten?: () => void, mode?: 'save' | 'capture') => {
          expect(mode).toBe('capture')
          if (targetPath === path) {
            // Simulate module writing N+1 bytes during capture without triggering onUserSave
            writeFileSync(path, 'v4 n+1 captured')
          }
          return true
        },
      ),
    })
    const origOnUserSave = ctx.service.onUserSave.bind(ctx.service)
    ctx.service.onUserSave = (p: string) => {
      onUserSaveCount += 1
      origOnUserSave(p)
    }

    ctx.service.noteEditorDirty(path, true)

    const plan = await ctx.service.signOutPlan()
    expect(plan).toEqual({
      count: 1,
      waiting: 0,
      keystoreLocked: false,
      ramOnly: 0,
    })

    const res = await ctx.service.lockSession(ownerA)
    expect(res).toEqual({ ok: true, captureFailed: [] })
    expect(onUserSaveCount).toBe(0)
    expect(ctx.requestModuleSave).toHaveBeenCalledWith(path, expect.any(Function), 'capture')

    // Plaintext working copies and recovery copies are gone
    expect(existsSync(path)).toBe(false)
    expect(existsSync(docRecoveryFile)).toBe(false)
    expect(existsSync(sheetRecoveryFile)).toBe(false)

    // Parked record contains the captured N+1 bytes
    const reopen = await ctx.layer.open(ownerA)
    if (reopen.kind !== 'ok') throw new Error(reopen.kind)
    const parked = createParkedStore(reopen.store.records(PARKED_STORE_REGISTRATION.name))
    const stored = await parked.take(DOC)
    expect(stored).not.toBeNull()
    expect(new TextDecoder().decode(stored!.bytes)).toBe('v4 n+1 captured')
    expect(stored!.binding.state).toBe('dirty')
  })

  it('4. park failure (store_full) aborts lockSession: working copy stays on disk and returns { ok: false }', async () => {
    const path = seedWorkingCopy({
      bytes: 'x'.repeat(2048),
      baseBytes: 'v3 base',
      state: 'dirty',
    })
    // Tiny budget so parked.park returns 'store_full'
    const ctx = setup({ openPaths: [path], budgetBytes: 256 })

    const res = await ctx.service.lockSession(ownerA)
    expect(res).toEqual({ ok: false, captureFailed: [] })
    // Step 4 did NOT run: plaintext working copy is still intact on disk
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('x'.repeat(2048))
  })

  it('5. in-flight upload/commit during sign-out: emits waiting/done, bounds wait to 30s, transitions to reconciling (or settles committed if within 30s), ignores late response', async () => {
    expect(SIGN_OUT_RECEIPT_WAIT_MS).toBe(30_000)
    const path = seedWorkingCopy({ bytes: 'v4 uploading', baseBytes: 'v3 base', state: 'saving' })
    let releaseUpload: (() => void) | null = null
    const ctx = setup({
      openPaths: [path],
      fetch: vi.fn(
        () =>
          new Promise<Response>((resolveFetch) => {
            releaseUpload = () =>
              resolveFetch(
                new Response(
                  JSON.stringify({
                    upload_id: 'late_tok',
                    checksum_sha256: hex(enc('v4 uploading')),
                    size_bytes: 12,
                    claim_expires_at: '2026-04-17T01:00:00.000Z',
                  }),
                  { status: 200, headers: { 'Content-Type': 'application/json' } },
                ),
              )
          }),
      ),
    })

    // Seed an intent in 'committing' state
    const opened = await ctx.layer.open(ownerA)
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
    const payload = enc('v4 uploading')
    await intents.put(
      DOC,
      {
        v: 2,
        intentId: 'int_inflight_42',
        idempotencyKey: 'idem_inflight_42',
        documentId: DOC,
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: hex(payload),
        length: payload.byteLength,
        generation: 1,
        state: 'committing',
        attempt: 2,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
      payload,
    )

    const plan = await ctx.service.signOutPlan()
    expect(plan).toEqual({
      count: 1,
      waiting: 1,
      keystoreLocked: false,
      ramOnly: 0,
    })

    let waitingCalled = 0
    const res = await ctx.service.lockSession(ownerA, () => {
      waitingCalled += 1
    })
    expect(res).toEqual({ ok: true, captureFailed: [] })
    expect(waitingCalled).toBe(1)
    expect(ctx.progress).toEqual([{ phase: 'waiting' }, { phase: 'done' }])
    expect(ctx.slept).toContain(SIGN_OUT_RECEIPT_WAIT_MS)

    // Reopen store and verify record was transitioned to 'reconciling' with same idempotencyKey and attempt
    const reopen = await ctx.layer.open(ownerA)
    if (reopen.kind !== 'ok') throw new Error(reopen.kind)
    const intentsAfter = createIntentStore(reopen.store.records(INTENT_STORE_REGISTRATION.name))
    const rec = await intentsAfter.get(DOC)
    expect(rec).not.toBeNull()
    expect(rec!.intent.state).toBe('reconciling')
    expect(rec!.intent.idempotencyKey).toBe('idem_inflight_42')
    expect(rec!.intent.attempt).toBe(2)

    // Release any late HTTP response: must not resurrect binding.json or overwrite the reconciling record
    releaseUpload?.()
    await Promise.resolve()
    expect(existsSync(docDir())).toBe(false)
  })

  it('5b. in-flight commit that answers within the 30s bound settles committed before lock', async () => {
    const path = seedWorkingCopy({ bytes: 'v4 restored', baseBytes: 'v3 base', state: 'dirty' })
    let resolveCommit: (() => void) | null = null
    const ctx = setup({
      openPaths: [path],
      sleep: vi.fn((ms: number) => {
        // When lockSession starts the 30s receipt timer, the in-flight commit answers before the timer expires
        if (ms === SIGN_OUT_RECEIPT_WAIT_MS) {
          resolveCommit?.()
          return new Promise<void>(() => undefined)
        }
        return Promise.resolve()
      }),
      fetch: vi.fn(async (url: string) => {
        const pathname = new URL(url).pathname
        if (pathname.endsWith('/uploads')) {
          return new Response(
            JSON.stringify({
              upload_id: 'up_tok_fast',
              checksum_sha256: hex(enc('v4 restored')),
              size_bytes: 11,
              claim_expires_at: '2026-04-17T01:00:00.000Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (pathname.endsWith('/versions/commit')) {
          await new Promise<void>((r) => {
            resolveCommit = r
          })
          return new Response(
            JSON.stringify({
              document: { id: DOC, revision: '42', current_version: 4 },
              version: { id: 'ver_4', version: 4, checksum_sha256: hex(enc('v4 restored')) },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        throw new Error(`unexpected ${url}`)
      }),
    })

    const opened = await ctx.layer.open(ownerA)
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
    const payload = enc('v4 restored')
    await intents.put(
      DOC,
      {
        v: 2,
        intentId: 'int_fast_1',
        idempotencyKey: 'idem_fast_1',
        documentId: DOC,
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: hex(payload),
        length: payload.byteLength,
        generation: 1,
        state: 'queued',
        attempt: 0,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
      payload,
    )

    // Start the save dispatch so commit is in-flight when lockSession runs
    const pollPromise = ctx.service.pollSaveQueue()
    await vi.waitFor(() => {
      expect(resolveCommit).not.toBeNull()
    })

    const res = await ctx.service.lockSession(ownerA)
    await pollPromise
    expect(res).toEqual({ ok: true, captureFailed: [] })

    // Because commit settled within the 30s bound, finishCleanup deleted the committed intent, status settled to 'saved', and nothing needed to be parked
    expect(ctx.statuses.some((s) => s.state === 'saved')).toBe(true)
    const reopen = await ctx.layer.open(ownerA)
    if (reopen.kind !== 'ok') throw new Error(reopen.kind)
    const intentsAfter = createIntentStore(reopen.store.records(INTENT_STORE_REGISTRATION.name))
    expect(await intentsAfter.get(DOC)).toBeNull()
    const parkedAfter = createParkedStore(reopen.store.records(PARKED_STORE_REGISTRATION.name))
    expect(await parkedAfter.list()).toEqual([])
  })

  it('6. keystore-locked sign-out: plan reports keystoreLocked=true and ramOnly=1, skips capture, deletes working copies, writes no parked record and keeps the ciphertext byte-identical', async () => {
    const path = seedWorkingCopy({ bytes: 'v3 base', baseBytes: 'v3 base', state: 'saved' })
    const ctx = setup({ openPaths: [path], keystoreLocked: false })
    // a stored intent whose ciphertext must survive the locked sign-out untouched
    const opened = await ctx.layer.open(ownerA)
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const payload = enc('v4 queued')
    await createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name)).put(
      DOC,
      {
        v: 2,
        intentId: 'int_locked',
        idempotencyKey: 'idem_locked',
        documentId: DOC,
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: hex(payload),
        length: payload.byteLength,
        generation: 1,
        state: 'queued',
        attempt: 0,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
      payload,
    )
    const intentDir = join(dir, 'uniwork-sync', 'store', 'default', 'acc_1', 'intents')
    const recFile = readdirSync(intentDir).find((f) => f.endsWith('.rec'))!
    const ciphertextBefore = readFileSync(join(intentDir, recFile))

    ctx.service.noteEditorDirty(path, true)
    ctx.safeStorage.lock()
    ctx.setKeystoreLocked(true)

    const plan = await ctx.service.signOutPlan()
    expect(plan).toEqual({
      count: 1,
      waiting: 0,
      keystoreLocked: true,
      ramOnly: 1,
    })

    const res = await ctx.service.lockSession(ownerA)
    expect(res).toEqual({ ok: true, captureFailed: [] })
    expect(ctx.requestModuleSave).not.toHaveBeenCalled()
    expect(existsSync(docDir())).toBe(false)
    // no record was written while the keychain was locked: the stored ciphertext
    // of the account is unchanged byte-for-byte
    expect(readFileSync(join(intentDir, recFile)).equals(ciphertextBefore)).toBe(true)

    // the keychain comes back and the scope reopens: no parked record was left
    ctx.safeStorage.unlock()
    ctx.setKeystoreLocked(false)
    const reopen = await ctx.layer.open(ownerA)
    if (reopen.kind !== 'ok') throw new Error(reopen.kind)
    const parked = createParkedStore(reopen.store.records(PARKED_STORE_REGISTRATION.name))
    expect(await parked.list()).toEqual([])
  })

  it('7. cancel on sign-out prompt (or unconfirmed logout when count > 0): closes no tab, locks no store, deletes no working copy', async () => {
    const path = seedWorkingCopy({ bytes: 'v4 dirty', baseBytes: 'v3 base', state: 'dirty' })
    const ctx = setup({ openPaths: [path] })
    const plan = await ctx.service.signOutPlan()
    expect(plan.count).toBe(1)

    const closed: string[] = []
    let lockedCount = 0
    const boundary = new AccountBoundary({
      root: join(dir, 'uniwork-documents'),
      openPaths: () => [...ctx.openSet],
      closeDocument: async () => true,
      confirmClose: async () => true,
      closeNow: (p) => closed.push(p),
      aiHistoryPaths: () => [path],
      forgetAiHistory: () => undefined,
      forgetLocks: () => undefined,
      closeConflictPrompt: () => undefined,
      sessionOwner: () => ownerA,
      confirmSignOut: async (_owner, options) => options?.confirmed === true,
      lockStore: async () => {
        lockedCount += 1
        return true
      },
    })

    // Unconfirmed sign-out when count > 0 is refused
    expect(await boundary.beforeSignOut()).toBe(false)
    expect(closed).toEqual([])
    expect(lockedCount).toBe(0)
    expect(existsSync(path)).toBe(true)
  })

  it('8. same-account sign-in (restoreParked): B restores nothing of A; A restores working copy + binding, verifies sha256, deletes parked record, and next pollSaveQueue dispatches', async () => {
    const path = seedWorkingCopy({
      bytes: 'v4 restored',
      baseBytes: 'v3 base',
      state: 'dirty',
    })
    const ctx = setup({ openPaths: [path] })
    const opened = await ctx.layer.open(ownerA)
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
    const payload = enc('v4 restored')
    await intents.put(
      DOC,
      {
        v: 2,
        intentId: 'int_restore_1',
        idempotencyKey: 'idem_restore_1',
        documentId: DOC,
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: hex(payload),
        length: payload.byteLength,
        generation: 1,
        state: 'queued',
        attempt: 0,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
      payload,
    )

    // Sign out A: parks working copy and deletes plaintext folder
    expect(await ctx.service.lockSession(ownerA)).toEqual({ ok: true, captureFailed: [] })
    expect(existsSync(path)).toBe(false)

    // Sign in as B: restores nothing of A and A's folder stays absent
    ctx.setAccount('acc_2')
    ctx.service.noteSessionIdentity()
    await ctx.service.restoreParked({ deploymentId: 'default', accountId: 'acc_2' })
    expect(existsSync(docDir())).toBe(false)

    // Sign back in as A and restoreParked
    ctx.setAccount('acc_1')
    ctx.service.noteSessionIdentity()
    await ctx.service.restoreParked(ownerA)

    // Working copy and binding.json restored on disk with matching sha256
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('v4 restored')
    const restoredBinding = JSON.parse(
      readFileSync(join(docDir(), BINDING_FILE), 'utf8'),
    ) as Record<string, unknown>
    expect(restoredBinding.state).toBe('dirty')

    // Parked record removed after verification
    const reopened = await ctx.syncStore.open()
    if (reopened.kind !== 'ok') throw new Error(reopened.kind)
    const parked = createParkedStore(reopened.records(PARKED_STORE_REGISTRATION.name))
    expect(await parked.list()).toEqual([])

    // Next pollSaveQueue dispatches the queued intent and settles the binding to saved
    await ctx.service.pollSaveQueue()
    await vi.waitFor(() => {
      const settledBinding = JSON.parse(
        readFileSync(join(docDir(), BINDING_FILE), 'utf8'),
      ) as Record<string, unknown>
      expect(settledBinding.state).toBe('saved')
      expect(settledBinding.baseVersion).toBe(4)
    })
  })

  it('9. RAM cache audit + signed_out lock reason: lockSession clears all 15 caches and refuses residual working copy while signed out', async () => {
    const path = seedWorkingCopy({ bytes: 'v3 base', baseBytes: 'v3 base', state: 'saved' })
    const ctx = setup({ openPaths: [path] })
    await ctx.service.openSyncStore()

    // Populate all 15 in-memory caches on service
    const svc = ctx.service as unknown as Record<string, unknown>
    ;(svc.locks as Map<string, UniworkDocLock>).set(pathKey(path), {
      path,
      reason: 'store_newer',
      name: 'Plan.docx',
    })
    ;(svc.hashMemo as Map<string, unknown>).set(path, { mtimeMs: 1, size: 1, checksum: 'abc' })
    ;(svc.editorDirty as Set<string>).add(path)
    ;(svc.lastUserSave as Map<string, number>).set(path, 1)
    ;(svc.otherWindowStatus as Map<string, unknown>).set(path, { state: 'blocked' })
    ;(svc.selfRenamed as Map<string, string>).set(DOC, '41')
    ;(svc.remoteBars as Map<string, unknown>).set(pathKey(path), { kind: 'updated', version: 4 })
    ;(svc.remoteNotices as Map<string, unknown>).set(pathKey(path), { documentId: DOC })
    ;(svc.remoteHeld as Map<string, unknown>).set(DOC, { documentId: DOC })
    ;(svc.ownEcho as Map<string, Set<string>>).set(DOC, new Set(['41']))
    ;(svc.remoteLocked as Map<string, string>).set(DOC, 'revoked')
    ;(svc.editorAi as Map<string, unknown>).set(path, { aiRunning: true, aiEpoch: 1 })
    ;(svc.remoteReloads as Map<string, Promise<void>>).set(path, Promise.resolve())
    ;(svc.orgMemberNames as Map<string, string>).set('usr_1', 'Alice')
    svc.orgMemberNamesOrg = 'org_a'
    ;(svc.migratedScopes as Set<string>).add('default/acc_1')

    // the editor is marked dirty (one of the 15 caches) and the harness module
    // never writes a capture: be-1 keeps the folder and lists the doc
    expect(await ctx.service.lockSession(ownerA)).toEqual({ ok: true, captureFailed: [DOC] })

    expect((svc.locks as Map<string, unknown>).size).toBe(0)
    expect((svc.hashMemo as Map<string, unknown>).size).toBe(0)
    expect((svc.editorDirty as Set<string>).size).toBe(0)
    expect((svc.lastUserSave as Map<string, unknown>).size).toBe(0)
    expect((svc.otherWindowStatus as Map<string, unknown>).size).toBe(0)
    expect((svc.selfRenamed as Map<string, unknown>).size).toBe(0)
    expect((svc.remoteBars as Map<string, unknown>).size).toBe(0)
    expect((svc.remoteNotices as Map<string, unknown>).size).toBe(0)
    expect((svc.remoteHeld as Map<string, unknown>).size).toBe(0)
    expect((svc.ownEcho as Map<string, unknown>).size).toBe(0)
    expect((svc.remoteLocked as Map<string, unknown>).size).toBe(0)
    expect((svc.editorAi as Map<string, unknown>).size).toBe(0)
    expect((svc.remoteReloads as Map<string, unknown>).size).toBe(0)
    expect((svc.orgMemberNames as Map<string, unknown>).size).toBe(0)
    expect(svc.orgMemberNamesOrg).toBeNull()
    expect((svc.migratedScopes as Set<string>).has('default/acc_1')).toBe(false)

    // Simulate a residual working copy that survived a crash before Step 4 while signed out
    ctx.setAccount(null)
    const residual = seedWorkingCopy({ bytes: 'v3 base', baseBytes: 'v3 base', state: 'saved' })
    expect(ctx.service.refuseLockedPath(residual)).toBe(true)
    expect(ctx.locks.at(-1)).toEqual({
      path: residual,
      reason: 'signed_out',
      name: 'Plan.docx',
    })
    expect(ctx.service.isReadOnly(residual)).toBe(true)
    expect(ctx.service.isLocked(residual)).toBe(true)
  })

  it('10. be-1: a capture that never writes keeps the working copy, lists the doc, and leaves no other plaintext', async () => {
    const path = seedWorkingCopy({ bytes: 'v3 base', baseBytes: 'v3 base', state: 'saved' })
    const ctx = setup({
      openPaths: [path],
      // a busy / hung renderer: the capture is accepted and never writes a byte
      requestModuleSave: vi.fn(() => true),
    })
    ctx.service.noteEditorDirty(path, true)

    const plan = await ctx.service.signOutPlan()
    expect(plan.count).toBe(1)

    const res = await ctx.service.lockSession(ownerA)
    expect(res).toEqual({ ok: true, captureFailed: [DOC] })
    // nothing may be deleted after a capture that never landed
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('v3 base')
    expect(existsSync(join(docDir(), BINDING_FILE))).toBe(true)
    // nothing was parked; the doc's bytes exist nowhere else under userData
    const reopen = await ctx.layer.open(ownerA)
    if (reopen.kind !== 'ok') throw new Error(reopen.kind)
    const parked = createParkedStore(reopen.store.records(PARKED_STORE_REGISTRATION.name))
    expect(await parked.list()).toEqual([])
    expect(filesContaining(dir, 'v3 base')).toEqual([path])
  })

  it('11. be-6/be-8: recovery copies go under the module naming, including a path whose folder is already gone', async () => {
    const path = seedWorkingCopy({ bytes: 'v3 base', baseBytes: 'v3 base', state: 'saved' })
    const docsRecoveryDir = join(dir, 'docs-autosave')
    const sheetsRecoveryDir = join(dir, 'sheets-autosave')
    mkdirSync(docsRecoveryDir, { recursive: true })
    mkdirSync(sheetsRecoveryDir, { recursive: true })
    const recoveryFor = (p: string) =>
      join(docsRecoveryDir, `${createHash('sha1').update(p).digest('hex').slice(0, 16)}.docx`)
    const sheetRecoveryFor = (p: string) =>
      join(sheetsRecoveryDir, `${createHash('sha1').update(p).digest('hex').slice(0, 16)}.xlsx`)
    writeFileSync(recoveryFor(path), 'recovery docx')
    writeFileSync(sheetRecoveryFor(path), 'recovery xlsx')
    // a path whose folder was removed while a view still had it open
    const gonePath = join(dir, 'uniwork-documents', 'default', 'acc_1', 'doc_gone', 'Gone.docx')
    writeFileSync(recoveryFor(gonePath), 'recovery docx gone')
    // naming no writer ever produced: it must not be swept (dead candidates)
    const fullHash = createHash('sha1').update(path).digest('hex')
    const deadDocs = join(docsRecoveryDir, `${fullHash}.docx`)
    const deadMeta = join(docsRecoveryDir, `${fullHash}.json`)
    const deadSheet = join(sheetsRecoveryDir, `${fullHash}.recovery.json`)
    writeFileSync(deadDocs, 'not a module file')
    writeFileSync(deadMeta, '{}')
    writeFileSync(deadSheet, '{}')

    const ctx = setup({ openPaths: [path, gonePath] })
    expect(await ctx.service.lockSession(ownerA)).toEqual({ ok: true, captureFailed: [] })

    expect(existsSync(recoveryFor(path))).toBe(false)
    expect(existsSync(sheetRecoveryFor(path))).toBe(false)
    expect(existsSync(recoveryFor(gonePath))).toBe(false)
    expect(existsSync(deadDocs)).toBe(true)
    expect(existsSync(deadMeta)).toBe(true)
    expect(existsSync(deadSheet)).toBe(true)
  })

  it('12. be-7: a refused binding write leaves no orphan plaintext; the next poll restores', async () => {
    const path = seedWorkingCopy({ bytes: 'v5 n+1', baseBytes: 'v3 base', state: 'dirty' })
    const ctx = setup({ openPaths: [path] })
    expect(await ctx.service.lockSession(ownerA)).toEqual({ ok: true, captureFailed: [] })
    expect(existsSync(path)).toBe(false)
    const parkedNow = async () => {
      const opened = await ctx.syncStore.open()
      if (opened.kind !== 'ok') throw new Error(opened.kind)
      return createParkedStore(opened.records(PARKED_STORE_REGISTRATION.name))
    }
    expect(await (await parkedNow()).list()).toEqual([DOC])

    // the restore's binding write is refused once
    const write = vi.spyOn(ctx.service.store, 'write').mockResolvedValueOnce(false)
    await ctx.service.restoreParked(ownerA)
    expect(write).toHaveBeenCalledTimes(1)
    // binding first: a refused binding write leaves no plaintext behind it
    expect(existsSync(path)).toBe(false)
    expect(existsSync(docDir())).toBe(false)
    expect(await (await parkedNow()).list()).toEqual([DOC])
    write.mockRestore()

    // the next poll restores it for good
    await ctx.service.restoreParked(ownerA)
    expect(readFileSync(path, 'utf8')).toBe('v5 n+1')
    expect(await (await parkedNow()).list()).toEqual([])
  })

  it("13. be-10: another account's S11 lock survives the sign-out", async () => {
    const path = seedWorkingCopy({ bytes: 'v3 base', baseBytes: 'v3 base', state: 'saved' })
    const ctx = setup({ openPaths: [path] })
    const otherDir = join(dir, 'uniwork-documents', 'default', 'acc_9', 'doc_9')
    const otherPath = join(otherDir, 'Other.docx')
    mkdirSync(otherDir, { recursive: true })
    writeFileSync(otherPath, 'other bytes')
    writeFileSync(join(otherDir, BINDING_FILE), JSON.stringify({ schema: 2 }))
    expect(ctx.service.refuseLockedPath(otherPath)).toBe(true)
    expect(ctx.service.currentLocks()).toHaveLength(1)

    expect(await ctx.service.lockSession(ownerA)).toEqual({ ok: true, captureFailed: [] })
    expect(ctx.service.currentLocks()).toEqual([
      { path: otherPath, reason: 'store_newer', name: 'Other.docx' },
    ])
  })

  it('14. rows 7/9/10: the sign-out shows no prompt, sends no request and mints no intent', async () => {
    const path = seedWorkingCopy({ bytes: 'v4 dirty', baseBytes: 'v3 base', state: 'dirty' })
    const ctx = setup({ openPaths: [path] })
    const opened = await ctx.layer.open(ownerA)
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const payload = enc('v4 dirty')
    await createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name)).put(
      DOC,
      {
        v: 2,
        intentId: 'int_prompt',
        idempotencyKey: 'idem_prompt',
        documentId: DOC,
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: hex(payload),
        length: payload.byteLength,
        generation: 1,
        state: 'queued',
        attempt: 0,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
      payload,
    )
    const intentDir = join(dir, 'uniwork-sync', 'store', 'default', 'acc_1', 'intents')
    const recFiles = readdirSync(intentDir)
      .filter((f) => f.endsWith('.rec'))
      .sort()
    expect(recFiles).toHaveLength(1)
    const ciphertextBefore = readFileSync(join(intentDir, recFiles[0]!))

    expect(await ctx.service.lockSession(ownerA)).toEqual({ ok: true, captureFailed: [] })

    // row 7: neither the module's unsaved-close prompt nor the UniWork discard
    // prompt ran for the dirty doc that had a queued intent
    expect(ctx.ui.chooseUnsavedClose).not.toHaveBeenCalled()
    expect(ctx.ui.confirmDiscard).not.toHaveBeenCalled()

    // row 9: the dispatcher sends nothing after the boundary, even on a poll
    const fetchMock = ctx.fetch as unknown as ReturnType<typeof vi.fn>
    const callsAtSignOut = fetchMock.mock.calls.length
    await ctx.service.pollSaveQueue()
    await ctx.service.setQueueOnline(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock.mock.calls.length).toBe(callsAtSignOut)

    // row 10: no intent was minted during or after the sign-out
    expect(
      readdirSync(intentDir)
        .filter((f) => f.endsWith('.rec'))
        .sort(),
    ).toEqual(recFiles)
    expect(readFileSync(join(intentDir, recFiles[0]!)).equals(ciphertextBefore)).toBe(true)
  })

  it('15. row 8: a marker from the N+1 bytes is found in no file under userData after sign-out', async () => {
    const marker = 'MARKER-N1-7f31'
    const path = seedWorkingCopy({ bytes: `v5 ${marker}`, baseBytes: 'v3 base', state: 'dirty' })
    // the crash-recovery copy of that path holds the same bytes
    const docsRecoveryDir = join(dir, 'docs-autosave')
    mkdirSync(docsRecoveryDir, { recursive: true })
    const recovery = join(
      docsRecoveryDir,
      `${createHash('sha1').update(path).digest('hex').slice(0, 16)}.docx`,
    )
    writeFileSync(recovery, `v5 ${marker}`)

    const ctx = setup({ openPaths: [path] })
    expect(await ctx.service.lockSession(ownerA)).toEqual({ ok: true, captureFailed: [] })

    // the N+1 bytes live only inside the encrypted parked record now
    expect(existsSync(path)).toBe(false)
    expect(existsSync(recovery)).toBe(false)
    expect(filesContaining(dir, marker)).toEqual([])
  })

  it('16. be-2: sign-out hands the deleted working copies to the module originals clearer', async () => {
    const path = seedWorkingCopy({ bytes: 'v3 base', baseBytes: 'v3 base', state: 'saved' })
    const ctx = setup({ openPaths: [path] })
    const clearOriginals = vi.fn()
    ctx.service.setClearOriginals(clearOriginals)

    expect(await ctx.service.lockSession(ownerA)).toEqual({ ok: true, captureFailed: [] })
    // the module hashes the bytes just before they are deleted: the path is
    // handed over while the working copy still exists
    expect(clearOriginals).toHaveBeenCalledWith([path])
    expect(existsSync(path)).toBe(false)
  })
})
