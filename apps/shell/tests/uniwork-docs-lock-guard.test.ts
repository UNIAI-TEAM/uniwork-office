import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocLock, UniworkDocStatus, UniworkLaunchEvent } from '../src/shared/home-api'
import { pathKey } from '../src/shared/path-key'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import {
  UniworkDocsService,
  refuseLockedOpenPath,
  type ConflictUi,
} from '../src/main/uniwork-docs/service'
import {
  BINDING_FILE,
  INTENT_PAYLOAD_FILE,
  LAST_OWNER_FILE,
} from '../src/main/uniwork-docs/binding-store'
import { INTENT_STORE_REGISTRATION, createIntentStore } from '../src/main/uniwork-sync/intent-store'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * G5-04g (AC-1, AC-2): a working copy whose folder holds a binding.json with an
 * integer schema >= 2 belongs to a store this build does not read. Opening it
 * (any route) must not open a module, must record + push the S11 lock, and must
 * not create an intent, write the folder or touch the network for that
 * document. `min_app_version` is never compared (OQ-P4).
 */

// counts reads of binding.json, so the hot-path policy can be pinned to one
// read per call (a module namespace cannot be spied on in ESM)
const reads = vi.hoisted(() => ({ binding: 0 }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => {
      if (String(args[0]).endsWith('binding.json')) reads.binding += 1
      return (actual.readFileSync as (...a: unknown[]) => unknown)(...args)
    },
  }
})

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

/** one call the fake server saw; the guard must keep this empty for its document */
const calls: Array<{ path: string }> = []

function fakeFetch(url: string): Promise<Response> {
  calls.push({ path: new URL(url).pathname })
  return Promise.resolve(
    new Response(
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
            checksum_sha256: hex(enc('server bytes')),
            size_bytes: 12,
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  )
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-lock-guard-'))
  calls.length = 0
  // the service remembers a newly seen live account with a fire-and-forget
  // atomic write of last-account.json (`liveIdentity`); seeding acc_1 as
  // already remembered removes that write, which otherwise outlived the
  // refused opens and raced the rmSync below (ENOTEMPTY), as in R1-13
  mkdirSync(join(dir, 'uniwork-documents'), { recursive: true })
  writeFileSync(
    join(dir, 'uniwork-documents', LAST_OWNER_FILE),
    JSON.stringify({ accountId: 'acc_1', deploymentId: 'default' }),
  )
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** the working-copy folder the service uses for the live account + document */
const docDir = () => join(dir, 'uniwork-documents', 'default', 'acc_1', DOC)
const docPath = () => join(docDir(), 'Plan.docx')

/** a working copy + binding.json in the folder the service will read */
function seedFolder(binding: unknown): void {
  mkdirSync(docDir(), { recursive: true })
  writeFileSync(docPath(), 'working copy bytes')
  writeFileSync(join(docDir(), BINDING_FILE), JSON.stringify(binding, null, 2))
}

function setup(opts: { account?: string | null; keystoreLocked?: boolean } = {}) {
  const statuses: UniworkDocStatus[] = []
  const launches: UniworkLaunchEvent[] = []
  const locks: UniworkDocLock[] = []
  const safeStorage: LockableSafeStorage = createLockableSafeStorage()
  /** the live session identity; null models a cold locked restore */
  let account: string | null = opts.account === undefined ? 'acc_1' : opts.account
  /** the account's keystore-locked state, independent of the session */
  let keystoreLocked = opts.keystoreLocked === true
  const layer = createStoreLayer({
    root: join(dir, 'uniwork-sync', 'store'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(dir, 'uniwork-sync', 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
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
  const deps = {
    userDataDir: dir,
    syncStore,
    profile: () => profile,
    identity: () =>
      account ? { accountId: account, deviceSessionId: 'dev_1', deploymentId: 'default' } : null,
    keystoreLocked: () => keystoreLocked,
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    fetch: fakeFetch as never,
    openPath: vi.fn(() => true),
    isPathOpen: vi.fn(() => false),
    requestModuleSave: vi.fn(() => false),
    reloadPath: vi.fn(),
    activePath: () => undefined,
    ui,
    pushStatus: (s: UniworkDocStatus) => statuses.push(s),
    pushLaunch: (e: UniworkLaunchEvent) => launches.push(e),
    pushLock: (lock: UniworkDocLock) => locks.push(lock),
    reveal: vi.fn(),
    sleep: async () => undefined,
  }
  const service = new UniworkDocsService(deps)
  return {
    service,
    ui,
    statuses,
    locks,
    deps,
    safeStorage,
    layer,
    /** the keychain unlocks and Retry restores the saved session */
    signIn: (id: string) => {
      account = id
      keystoreLocked = false
    },
  }
}

const bytesOf = (path: string) => readFileSync(path, 'utf8')
const bindingText = () => readFileSync(join(docDir(), BINDING_FILE), 'utf8')
const folderFiles = () => readdirSync(docDir()).sort()

/**
 * The intent records the durable store actually holds on disk (one `.rec` per
 * intent). Read from the filesystem, not through the layer: while the keychain
 * is locked the layer cannot be asked, and "no record was written" is the
 * assertion.
 */
const intentRecords = () =>
  (() => {
    try {
      return readdirSync(join(dir, 'uniwork-sync', 'store', 'default', 'acc_1', 'intents')).filter(
        (name) => name.endsWith('.rec'),
      )
    } catch {
      return []
    }
  })()

/** a schema-1 binding: the store this build writes, bound and editable */
const schema1 = {
  schema: 1,
  documentId: DOC,
  workspaceId: 'ws_1',
  orgId: 'org_a',
  title: 'Plan.docx',
  filename: 'Plan.docx',
  format: 'docx',
  access: 'edit',
  baseRevision: '41',
  baseVersion: 3,
  baseChecksum: hex(enc('working copy bytes')),
  state: 'ready',
}

/**
 * The four malformed/missing-level shapes of AC-1, a VALID min_store_level
 * above this build's APP_STORE_LEVEL (OQ-P4: the level is the gate) and a
 * schema-3 store. `min_app_version` alone never locks anything.
 */
const NEWER: Array<[string, unknown]> = [
  ['schema 2, min_app_version lower', { schema: 2, min_app_version: '0.0.1' }],
  ['schema 2, min_app_version higher', { schema: 2, min_app_version: '99.0.0' }],
  ['schema 2, no min_app_version', { schema: 2 }],
  ['schema 2, malformed min_app_version', { schema: 2, min_app_version: { nested: true } }],
  ['schema 2, min_store_level above this build', { schema: 2, min_store_level: 3 }],
  ['schema 3', { schema: 3, min_app_version: '0.1.0' }],
]

/** schema-2 stores inside the level window: they open like any bound copy */
const OPENING: Array<[string, unknown]> = [
  [
    'schema 2, min_store_level 2, min_app_version 0.11.0-beta.9',
    { ...schema1, schema: 2, min_store_level: 2, min_app_version: '0.11.0-beta.9' },
  ],
  [
    'schema 2, min_store_level 2, min_app_version 0.11.0-dev.3',
    { ...schema1, schema: 2, min_store_level: 2, min_app_version: '0.11.0-dev.3' },
  ],
  [
    'schema 2, min_store_level 2, min_app_version 0.11.0 (0.11.0-beta.1 store in 1.0.0)',
    { ...schema1, schema: 2, min_store_level: 2, min_app_version: '0.11.0' },
  ],
  [
    'schema 2, min_store_level 2, min_app_version 1.0.0 (1.0.0 store in an older build)',
    { ...schema1, schema: 2, min_store_level: 2, min_app_version: '1.0.0' },
  ],
  ['schema 2, min_store_level 1', { ...schema1, schema: 2, min_store_level: 1 }],
]

describe('a newer store is refused before anything opens (AC-1)', () => {
  it.each(NEWER)(
    '%s: lock pushed, nothing opened, folder untouched, no request',
    (_name, binding) => {
      seedFolder(binding)
      const ctx = setup()
      const before = { binding: bindingText(), copy: bytesOf(docPath()) }

      expect(ctx.service.refuseLockedPath(docPath())).toBe(true)

      expect(ctx.locks).toEqual([{ path: docPath(), reason: 'store_newer', name: 'Plan.docx' }])
      expect(ctx.service.currentLocks()).toEqual(ctx.locks)
      expect(ctx.service.isBound(docPath())).toBe(true)
      expect(ctx.service.isReadOnly(docPath())).toBe(true)
      // never a plain local file in recents: a working copy of ours is enriched,
      // and one whose binding cannot be read stays hidden (as it does today)
      expect(ctx.service.recentSource(docPath())).toBe('hidden')
      expect(calls).toEqual([])
      // not one byte of the folder changed, and no intent was created
      expect(bindingText()).toBe(before.binding)
      expect(bytesOf(docPath())).toBe(before.copy)
      expect(folderFiles()).toEqual(['Plan.docx', BINDING_FILE])
    },
  )

  it('the funnel decision is the guard, exercised at runtime over a seeded store (R1-be-7)', () => {
    seedFolder({ schema: 2 })
    const ctx = setup()
    // the real function the router calls, with the real service
    expect(refuseLockedOpenPath(ctx.service, docPath())).toBe(true)
    expect(refuseLockedOpenPath(ctx.service, docPath())).toBe(true)
    expect(ctx.service.currentLocks()).toHaveLength(1)
    // no service yet (before app ready): the router keeps its normal behaviour
    expect(refuseLockedOpenPath(null, docPath())).toBe(false)
    expect(refuseLockedOpenPath(undefined, docPath())).toBe(false)
    // a schema-1 copy and a plain local file are not refused
    rmSync(docDir(), { recursive: true, force: true })
    seedFolder({ schema: 1 })
    expect(refuseLockedOpenPath(ctx.service, docPath())).toBe(false)
    expect(refuseLockedOpenPath(ctx.service, join(dir, 'plain.docx'))).toBe(false)
  })

  it('the open route calls no module and pushes the lock again only on a new refusal', () => {
    seedFolder({ schema: 2 })
    const ctx = setup()
    expect(ctx.service.refuseLockedPath(docPath())).toBe(true)
    expect(ctx.locks).toHaveLength(1)
    // the same path again: one entry, but the renderer is told again (a reload may have lost it)
    expect(ctx.service.refuseLockedPath(docPath())).toBe(true)
    expect(ctx.service.currentLocks()).toHaveLength(1)
    expect(ctx.locks).toHaveLength(2)
    // a path that is not a working copy is not ours to refuse
    expect(ctx.service.refuseLockedPath(join(dir, 'plain.docx'))).toBe(false)
    expect(ctx.service.refuseLockedPath(join(tmpdir(), 'elsewhere.docx'))).toBe(false)
  })

  it('dismissLock forgets the lock (Close on the S11 panel); nothing else changes', () => {
    seedFolder({ schema: 2 })
    const ctx = setup()
    expect(ctx.service.refuseLockedPath(docPath())).toBe(true)
    ctx.service.dismissLock(docPath())
    expect(ctx.service.currentLocks()).toEqual([])
    expect(ctx.service.lockShownFor(docPath())).toBe(false)
    // the folder is still there, untouched: only the panel went away
    expect(folderFiles()).toEqual(['Plan.docx', BINDING_FILE])
  })

  it('keys a lock by pathKey: a drive-letter path spelled another way dismisses it (R1-be-2)', () => {
    seedFolder({ schema: 2 })
    const ctx = setup()
    expect(ctx.service.refuseLockedPath(docPath())).toBe(true)
    // the fold is a drive-letter rule; assert it on a drive-letter path, not on
    // this temp dir (which keeps its case on Linux, where the suite also runs)
    expect(pathKey('C:\\Root\\Plan.docx')).toBe(pathKey('c:/root/PLAN.DOCX'))
    // the same file spelled with the other separator is the same lock: pathKey
    // folds backslashes on every platform, so swap either way by platform (the
    // Linux cloud runner's temp dir already uses '/', where a one-way swap was
    // a no-op and the old assertion failed)
    const other =
      process.platform === 'win32' ? docPath().replace(/\\/g, '/') : docPath().replace(/\//g, '\\')
    expect(other).not.toBe(docPath())
    ctx.service.dismissLock(other)
    expect(ctx.service.currentLocks()).toEqual([])
  })

  it('schema 1 stays a plain bound document, and garbage stays unbound (regression)', () => {
    seedFolder(schema1)
    const ctx = setup()
    expect(ctx.service.refuseLockedPath(docPath())).toBe(false)
    expect(ctx.locks).toEqual([])
    expect(ctx.service.isBound(docPath())).toBe(true)
    expect(ctx.service.isReadOnly(docPath())).toBe(false)
    expect(ctx.service.recentSource(docPath())).toMatchObject({ documentId: DOC })

    rmSync(docDir(), { recursive: true, force: true })
    seedFolder({ schema: 'x' })
    const other = setup()
    expect(other.service.refuseLockedPath(docPath())).toBe(false)
    expect(other.service.isBound(docPath())).toBe(false)
    expect(other.locks).toEqual([])
  })
})

describe('a schema-2 store level inside the window opens (OQ-P4)', () => {
  it.each(OPENING)('%s: bound, editable, opens with no lock', async (_name, binding) => {
    seedFolder(binding)
    const ctx = setup()
    // the gate is min_store_level only: a level <= APP_STORE_LEVEL opens, and
    // the two prerelease tails of the same base decide identically
    expect(ctx.service.refuseLockedPath(docPath())).toBe(false)
    expect(ctx.service.isBound(docPath())).toBe(true)
    expect(ctx.service.isReadOnly(docPath())).toBe(false)
    expect(ctx.locks).toEqual([])
    const opened = await ctx.service.openFromServer(DOC)
    expect(opened.path).toBe(docPath())
    expect(ctx.deps.openPath).toHaveBeenCalledWith(docPath())
    expect(ctx.locks).toEqual([])
    // the ordinary open flow ran: the document was read once
    expect(calls).toHaveLength(1)
  })
})

describe('the module policy reads binding.json once per call (R1-be-5)', () => {
  it('isBound / isReadOnly cost one binding read each, even for a newer store', () => {
    seedFolder({ schema: 2, min_app_version: '99.0.0' })
    const ctx = setup()
    reads.binding = 0
    expect(ctx.service.isBound(docPath())).toBe(true)
    expect(reads.binding).toBe(1)
    reads.binding = 0
    expect(ctx.service.isReadOnly(docPath())).toBe(true)
    expect(reads.binding).toBe(1)
  })

  it('a schema-1 copy is also classified in one read, and still bound and editable', () => {
    seedFolder(schema1)
    const ctx = setup()
    reads.binding = 0
    expect(ctx.service.isBound(docPath())).toBe(true)
    expect(reads.binding).toBe(1)
    reads.binding = 0
    expect(ctx.service.isReadOnly(docPath())).toBe(false)
    expect(reads.binding).toBe(1)
  })

  it('a plain local file costs no binding read at all', () => {
    seedFolder(schema1)
    const ctx = setup()
    reads.binding = 0
    expect(ctx.service.isBound(join(dir, 'plain.docx'))).toBe(false)
    expect(ctx.service.isReadOnly(join(dir, 'plain.docx'))).toBe(false)
    expect(reads.binding).toBe(0)
  })
})

describe('no intent, no module save, no client call for a locked path (AC-2)', () => {
  function locked(binding: unknown = { schema: 2, min_app_version: '99.0.0' }) {
    seedFolder(binding)
    const ctx = setup()
    expect(ctx.service.refuseLockedPath(docPath())).toBe(true)
    return ctx
  }

  it('save, the chip Retry and a user Save write nothing and send nothing', async () => {
    const ctx = locked()
    const before = { binding: bindingText(), copy: bytesOf(docPath()) }
    expect(await ctx.service.save(docPath())).toBeNull()
    ctx.service.onUserSave(docPath())
    await ctx.service.coordinator.settled(docPath())
    expect(await ctx.service.coordinator.save(docPath())).toBeNull()
    expect(calls).toEqual([])
    expect(bindingText()).toBe(before.binding)
    expect(bytesOf(docPath())).toBe(before.copy)
    // no intent file, no payload, no state file: only the two files we seeded
    expect(folderFiles()).toEqual(['Plan.docx', BINDING_FILE])
    expect(folderFiles()).not.toContain(INTENT_PAYLOAD_FILE)
    expect(ctx.deps.requestModuleSave).not.toHaveBeenCalled()
  })

  it('status, close, conflict and refresh answer without a dialog, a write or a request', async () => {
    const ctx = locked()
    expect(await ctx.service.docStatus(docPath())).toBeNull()
    expect(await ctx.service.activeDocStatus()).toBeNull()
    await expect(ctx.service.refreshPath(docPath())).resolves.toBeUndefined()
    expect(ctx.service.isCloseGuarded(docPath())).toBe(false)
    expect(ctx.service.needsClosePrompt(docPath())).toBe(false)
    expect(await ctx.service.confirmClose(docPath())).toBe(true)
    expect(await ctx.service.resolveConflict(docPath())).toBeNull()
    ctx.service.noteEditorDirty(docPath(), true)
    ctx.service.noteActivePath(docPath())
    expect(ctx.ui.chooseConflict).not.toHaveBeenCalled()
    expect(ctx.ui.chooseUnsavedClose).not.toHaveBeenCalled()
    expect(ctx.statuses).toEqual([])
    expect(calls).toEqual([])
  })

  // R1-be-7 (c): the five AC-1 variants, not just one, run through the open path
  it.each(NEWER)(
    '%s: openFromServer refuses before the first request and opens no module',
    async (_name, binding) => {
      const ctx = locked(binding)
      calls.length = 0
      await expect(ctx.service.openFromServer(DOC)).rejects.toMatchObject({
        code: 'engine_incompatible',
      })
      // zero requests for that document: no metadata read, no download
      expect(calls).toEqual([])
      expect(ctx.locks.at(-1)).toEqual({
        path: docPath(),
        reason: 'store_newer',
        name: 'Plan.docx',
      })
      expect(ctx.deps.openPath).not.toHaveBeenCalled()
      expect(folderFiles()).toEqual(['Plan.docx', BINDING_FILE])
    },
  )

  it.each(NEWER)(
    '%s: a launch ticket also opens nothing and sends nothing',
    async (_name, binding) => {
      const ctx = locked(binding)
      calls.length = 0
      await expect(
        ctx.service.openFromServer(DOC, {
          receiptId: 'r',
          redeemedAt: '2026-10-12T10:00:00Z',
          id: DOC,
          organizationId: 'org_a',
          workspaceId: 'ws_1',
          title: 'Plan.docx',
          operation: 'edit',
          version: 0,
          revision: '41',
          downloadPath: `/api/v1/documents/${DOC}/download`,
        }),
      ).rejects.toMatchObject({ code: 'engine_incompatible' })
      expect(calls).toEqual([])
      expect(ctx.deps.openPath).not.toHaveBeenCalled()
      expect(bytesOf(docPath())).toBe('working copy bytes')
    },
  )
})

/**
 * W3b: a copy that still holds a pre-store pending intent (schema 1 + the
 * pendingIntent + pending-upload.bin) needs the durable store before it can
 * open - the intent is the save that must not be lost. While the keychain is
 * locked that open is refused with the S11 `keystore_locked`, the plaintext is
 * left exactly as it is, and nothing is written; unlocking opens the copy.
 */
describe('a locked keychain holds a pre-store intent (W3b)', () => {
  const LEGACY_INTENT = {
    intentId: 'office-intent-legacy',
    idempotencyKey: 'office-key-legacy',
    documentId: DOC,
    baseRevision: '41',
    checksum: hex(enc('working copy bytes')),
    createdAt: '2026-10-11T00:00:00.000Z',
  }

  function seedLegacyIntent(): void {
    seedFolder({ ...schema1, state: 'saving', pendingIntent: LEGACY_INTENT })
    writeFileSync(join(docDir(), INTENT_PAYLOAD_FILE), 'working copy bytes')
  }

  it('the open is refused with S11 keystore_locked and the plaintext stays untouched', async () => {
    seedLegacyIntent()
    const ctx = setup()
    ctx.safeStorage.lock()
    const before = {
      binding: bindingText(),
      copy: bytesOf(docPath()),
      payload: readFileSync(join(docDir(), INTENT_PAYLOAD_FILE), 'utf8'),
    }
    await expect(ctx.service.openFromServer(DOC)).rejects.toMatchObject({
      code: 'engine_incompatible',
    })
    expect(calls).toEqual([])
    expect(ctx.deps.openPath).not.toHaveBeenCalled()
    expect(ctx.locks.at(-1)).toEqual({
      path: docPath(),
      reason: 'keystore_locked',
      name: 'Plan.docx',
    })
    // nothing was written anywhere: the binding, the copy and the payload are
    // byte-identical
    expect(bindingText()).toBe(before.binding)
    expect(bytesOf(docPath())).toBe(before.copy)
    expect(readFileSync(join(docDir(), INTENT_PAYLOAD_FILE), 'utf8')).toBe(before.payload)
    expect(folderFiles()).toEqual(['Plan.docx', BINDING_FILE, INTENT_PAYLOAD_FILE])
    // and the durable store holds no intent record at all while it is locked
    expect(intentRecords()).toEqual([])
  })

  it('the sync funnel refuses the path while locked, then opens it once unlocked', async () => {
    seedLegacyIntent()
    const ctx = setup()
    ctx.safeStorage.lock()
    // the same open the session does: the funnel is asked before any module sees it
    expect((await ctx.service.openSyncStore()).kind).toBe('keystore_locked')
    expect(ctx.service.refuseLockedPath(docPath())).toBe(true)
    expect(ctx.locks.at(-1)?.reason).toBe('keystore_locked')
    // the keychain is back: the lock clears, the legacy intent moves into the
    // store exactly once, and the copy opens with its local work
    ctx.safeStorage.unlock()
    expect((await ctx.service.openSyncStore()).kind).toBe('ok')
    const migrated = JSON.parse(bindingText()) as Record<string, unknown>
    expect(migrated).toMatchObject({ schema: 2, min_store_level: 2, state: 'dirty' })
    expect(migrated).not.toHaveProperty('pendingIntent')
    expect(folderFiles()).toEqual(['Plan.docx', BINDING_FILE])
    const records = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (records.kind !== 'ok') throw new Error(records.kind)
    const intent = await createIntentStore(
      records.store.records(INTENT_STORE_REGISTRATION.name),
    ).get(DOC)
    expect(intent?.intent).toMatchObject({
      documentId: DOC,
      baseRevision: '41',
      idempotencyKey: LEGACY_INTENT.idempotencyKey,
    })
    expect(Buffer.from(intent?.payload ?? []).toString()).toBe('working copy bytes')
    // exactly one record was written, and a second open is a no-op: the sweep
    // runs once per scope
    expect(intentRecords()).toHaveLength(1)
    expect((await ctx.service.openSyncStore()).kind).toBe('ok')
    expect(intentRecords()).toHaveLength(1)
    expect(ctx.service.refuseLockedPath(docPath())).toBe(false)
    expect(ctx.service.currentLocks().filter((l) => l.reason === 'keystore_locked')).toEqual([])
    const opened = await ctx.service.openFromServer(DOC)
    expect(opened.path).toBe(docPath())
    expect(bytesOf(docPath())).toBe('working copy bytes')
    // a copy without a pre-store intent never needs the store to open
    rmSync(docDir(), { recursive: true, force: true })
    seedFolder(schema1)
    const plain = setup()
    plain.safeStorage.lock()
    expect((await plain.service.openSyncStore()).kind).toBe('keystore_locked')
    expect(plain.service.refuseLockedPath(docPath())).toBe(false)
  })

  it('a cold locked restore (no live session) still tells keystore_locked and locks the copy (R1-be-4)', async () => {
    seedLegacyIntent()
    // the state a locked restart leaves behind: the saved profile and the last
    // owner on disk, no in-memory session, the account keystore-locked
    writeFileSync(
      join(dir, 'uniwork-documents', 'last-account.json'),
      JSON.stringify({ accountId: 'acc_1', deploymentId: 'default' }),
    )
    const ctx = setup({ account: null, keystoreLocked: true })
    ctx.safeStorage.lock()
    const before = {
      binding: bindingText(),
      copy: bytesOf(docPath()),
      payload: readFileSync(join(docDir(), INTENT_PAYLOAD_FILE), 'utf8'),
    }

    // the store is the lock, not "no session": the cold restore maps the open
    // to keystore_locked and locks the saved account's still-legacy copy
    expect((await ctx.service.openSyncStore()).kind).toBe('keystore_locked')
    expect(ctx.locks.at(-1)).toEqual({
      path: docPath(),
      reason: 'keystore_locked',
      name: 'Plan.docx',
    })
    // opening the document from recents is refused before any module sees it
    expect(refuseLockedOpenPath(ctx.service, docPath())).toBe(true)
    expect(ctx.deps.openPath).not.toHaveBeenCalled()
    // nothing was written anywhere: binding, copy and payload are byte-identical
    expect(bindingText()).toBe(before.binding)
    expect(bytesOf(docPath())).toBe(before.copy)
    expect(readFileSync(join(docDir(), INTENT_PAYLOAD_FILE), 'utf8')).toBe(before.payload)
    // the store holds no intent record while it cannot open
    expect(intentRecords()).toEqual([])

    // the keychain unlocks and Retry restores the session: the lock clears and
    // the sweep moves the intent exactly once
    ctx.safeStorage.unlock()
    ctx.signIn('acc_1')
    expect((await ctx.service.openSyncStore()).kind).toBe('ok')
    const migrated = JSON.parse(bindingText()) as Record<string, unknown>
    expect(migrated).toMatchObject({ schema: 2, min_store_level: 2, state: 'dirty' })
    expect(migrated).not.toHaveProperty('pendingIntent')
    expect(folderFiles()).toEqual(['Plan.docx', BINDING_FILE])
    expect(ctx.service.currentLocks().filter((l) => l.reason === 'keystore_locked')).toEqual([])
    // one intent record, same idempotencyKey; a second open changes nothing
    expect(intentRecords()).toHaveLength(1)
    const records = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (records.kind !== 'ok') throw new Error(records.kind)
    const intent = await createIntentStore(
      records.store.records(INTENT_STORE_REGISTRATION.name),
    ).get(DOC)
    expect(intent?.intent.idempotencyKey).toBe(LEGACY_INTENT.idempotencyKey)
    expect((await ctx.service.openSyncStore()).kind).toBe('ok')
    expect(intentRecords()).toHaveLength(1)
  })
})
