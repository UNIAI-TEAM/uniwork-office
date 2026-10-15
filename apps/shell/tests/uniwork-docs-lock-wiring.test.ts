import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS, type UniworkDocLock } from '../src/shared/home-api'
import { BINDING_FILE, INTENT_PAYLOAD_FILE } from '../src/main/uniwork-docs/binding-store'
import { INTENT_STORE_REGISTRATION, createIntentStore } from '../src/main/uniwork-sync/intent-store'
import { SyncRuntime } from '../src/main/uniwork-sync/runtime'

/**
 * G5-04g wiring: the lock IPC and the open-route diversion. `lock` is a push
 * to the shell window, `locks`/`dismissLock` are invoke handlers, and the
 * service's openPath goes through the guard, so no module ever opens a working
 * copy whose folder declares a store this build does not read. The account
 * boundary clears the previous account's locks (R1-be-6).
 */

let dir: string
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null
let statusListener:
  ((status: { state: string; org?: { id: string; slug: string } | null }) => void) | null = null
/** the account state the mocked auth module reports (keystore-locked after a lock) */
let accountState = 'signed-out'
/** the chosen org the mocked auth module reports (null = the picker is up) */
let accountOrg: { id: string; slug: string } | null = null

const safe = vi.hoisted(() => ({ locked: false }))

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    // a locked keychain: the store key cannot be produced (or opened), which is
    // what the S11 keystore lock reports
    encryptString: (text: string) => {
      if (safe.locked) throw new Error('keychain locked')
      return Buffer.from(`ENC1${text}`)
    },
    decryptString: (buf: Buffer) => {
      if (safe.locked) throw new Error('keychain locked')
      return buf.toString().slice(4)
    },
  },
}))

vi.mock('../src/main/uniwork-auth', () => ({
  authorizedRequest: vi.fn(),
  setUniworkSignOutHooks: vi.fn(),
  onUniworkAccountStatus: (
    listener: (status: { state: string; org?: { id: string; slug: string } | null }) => void,
  ) => {
    statusListener = listener
    return () => undefined
  },
  uniworkAccount: () => ({ status: () => ({ state: accountState, org: accountOrg }) }),
  uniworkDeploymentProfile: () => ({
    deploymentId: 'default',
    apiOrigin: 'https://uniwork.example',
    clientId: 'uniwork-office',
    channel: 'stable',
  }),
  uniworkSessionIdentity: () => identity,
}))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-lock-wiring-'))
  identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
  statusListener = null
  accountState = 'signed-out'
  accountOrg = null
  safe.locked = false
})
/**
 * The store layer and the save queue may still be settling a write when a test
 * ends (an in-flight rename, a heartbeat). Await a beat, then remove the tree
 * with retries: a bare synchronous rmdir races a late write and flakes with
 * ENOTEMPTY on the cloud runner.
 */
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 25))
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const docDir = () => join(dir, 'uniwork-documents', 'default', 'acc_1', 'doc_1')
const docPath = () => join(docDir(), 'Plan.docx')

/** a newer-store working copy of another account (acc_9) */
const otherDir = () => join(dir, 'uniwork-documents', 'default', 'acc_9', 'doc_9')
const otherPath = () => join(otherDir(), 'Other.docx')

function seed(binding: unknown): void {
  mkdirSync(docDir(), { recursive: true })
  writeFileSync(docPath(), 'working copy bytes')
  writeFileSync(join(docDir(), BINDING_FILE), JSON.stringify(binding))
}

function seedOther(binding: unknown): void {
  mkdirSync(otherDir(), { recursive: true })
  writeFileSync(otherPath(), 'other bytes')
  writeFileSync(join(otherDir(), BINDING_FILE), JSON.stringify(binding))
}

/** a pre-store working copy of acc_1: schema 1 + pendingIntent + its payload */
function seedLegacyIntent(): void {
  mkdirSync(docDir(), { recursive: true })
  writeFileSync(docPath(), 'working copy bytes')
  writeFileSync(
    join(docDir(), BINDING_FILE),
    JSON.stringify({
      schema: 1,
      documentId: 'doc_1',
      workspaceId: 'ws_1',
      orgId: 'org_a',
      title: 'Plan.docx',
      filename: 'Plan.docx',
      format: 'docx',
      access: 'edit',
      baseRevision: '41',
      baseVersion: 3,
      baseChecksum: 'abc',
      state: 'saving',
      pendingIntent: {
        intentId: 'office-intent-legacy',
        idempotencyKey: 'office-key-legacy',
        documentId: 'doc_1',
        baseRevision: '41',
        checksum: 'abc',
        createdAt: '2026-10-11T00:00:00.000Z',
      },
    }),
  )
  writeFileSync(join(docDir(), INTENT_PAYLOAD_FILE), 'working copy bytes')
}

/** a working copy with a binding this build reads (schema 2, gate open) */
function seedReadable(bytes = 'working copy bytes'): void {
  mkdirSync(docDir(), { recursive: true })
  writeFileSync(docPath(), bytes)
  writeFileSync(
    join(docDir(), BINDING_FILE),
    JSON.stringify({
      schema: 2,
      documentId: 'doc_1',
      workspaceId: 'ws_1',
      orgId: 'org_a',
      title: 'Plan.docx',
      filename: 'Plan.docx',
      format: 'docx',
      access: 'edit',
      baseRevision: '41',
      baseVersion: 3,
      baseChecksum: createHash('sha256').update(bytes).digest('hex'),
      state: 'saved',
      min_store_level: 2,
      min_app_version: '0.11.0',
    }),
  )
}

async function setup(
  openPath = vi.fn(() => true),
  overrides: {
    openPaths?: () => string[]
    closePathNow?: (path: string) => void
    confirmClosePath?: (path: string) => Promise<boolean>
    aiHistoryPaths?: () => string[]
    forgetAiHistory?: (paths: string[]) => void
  } = {},
) {
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const sent: Array<{ channel: string; payload: unknown }> = []
  const wc = {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    once: () => undefined,
  }
  const handle = createUniworkDocs(
    {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    } as never,
    {
      shellWindow: () => null,
      shellContents: () => wc as never,
      openPath,
      refuseLockedPath: (path: string) => handle.service.refuseLockedPath(path),
      isPathOpen: (path: string) => (overrides.openPaths?.() ?? []).includes(path),
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      reveal: () => undefined,
      lang: () => 'en',
      defaultSaveDir: () => dir,
      openPaths: overrides.openPaths ?? (() => []),
      closePath: async () => true,
      confirmClosePath: overrides.confirmClosePath ?? (async () => true),
      closePathNow: overrides.closePathNow ?? (() => undefined),
      aiHistoryPaths: overrides.aiHistoryPaths ?? (() => []),
      forgetAiHistory: overrides.forgetAiHistory ?? (() => undefined),
    },
  )
  handle.activate(() => undefined)
  return { handle, handlers, sent, openPath }
}

describe('the newer-store lock IPC (G5-04g)', () => {
  it('registers locks / dismissLock and answers an empty list', async () => {
    const { handlers } = await setup()
    // `lock` is a push to the shell window, not an invoke handler
    expect(handlers.has(UNIWORK_DOC_CHANNELS.locks)).toBe(true)
    expect(handlers.has(UNIWORK_DOC_CHANNELS.dismissLock)).toBe(true)
    expect(handlers.get(UNIWORK_DOC_CHANNELS.locks)!(null)).toEqual([])
    expect(handlers.get(UNIWORK_DOC_CHANNELS.dismissLock)!(null, 42)).toBeUndefined()
  })

  it('a refusal pushes the lock on the lock channel and the list reports it', async () => {
    seed({ schema: 2, min_app_version: '99.0.0' })
    const { handle, handlers, sent } = await setup()
    expect(handle.service.refuseLockedPath(docPath())).toBe(true)
    const lock: UniworkDocLock = { path: docPath(), reason: 'store_newer', name: 'Plan.docx' }
    expect(sent).toEqual([{ channel: UNIWORK_DOC_CHANNELS.lock, payload: lock }])
    expect(handlers.get(UNIWORK_DOC_CHANNELS.locks)!(null)).toEqual([lock])
    handlers.get(UNIWORK_DOC_CHANNELS.dismissLock)!(null, docPath())
    expect(handlers.get(UNIWORK_DOC_CHANNELS.locks)!(null)).toEqual([])
  })

  it('the service openPath never reaches the module router for a locked path', async () => {
    seed({ schema: 2 })
    const openPath = vi.fn(() => true)
    const { handle, sent } = await setup(openPath)
    // the service asks its deps.openPath; the wiring refuses before the router
    const shown = handle.service as unknown as {
      show(path: string, binding: unknown): unknown
    }
    expect(() => shown.show(docPath(), {})).toThrowError(
      expect.objectContaining({ code: 'engine_incompatible' }),
    )
    expect(openPath).not.toHaveBeenCalled()
    expect(sent).toHaveLength(1)
  })

  it("a sign-in as another account forgets the previous account's locks (R1-be-6)", async () => {
    seed({ schema: 2 })
    seedOther({ schema: 2 })
    const { handle, handlers } = await setup()
    // two locks: one of the account that goes away, one of the account that takes over
    expect(handle.service.refuseLockedPath(docPath())).toBe(true)
    expect(handle.service.refuseLockedPath(otherPath())).toBe(true)
    expect(handle.service.currentLocks()).toHaveLength(2)
    // acc_9 signs in: acc_1's working copy (and its lock) is no longer this session's
    identity = { accountId: 'acc_9', deviceSessionId: 'dev_9', deploymentId: 'default' }
    statusListener?.({ state: 'signed-in' })
    await vi.waitFor(() =>
      expect(handlers.get(UNIWORK_DOC_CHANNELS.locks)!(null)).toEqual([
        { path: otherPath(), reason: 'store_newer', name: 'Other.docx' },
      ]),
    )
  })

  it('a schema-1 working copy still opens through the router', async () => {
    seed({
      schema: 1,
      documentId: 'doc_1',
      workspaceId: 'ws_1',
      orgId: 'org_a',
      title: 'Plan.docx',
      filename: 'Plan.docx',
      format: 'docx',
      access: 'edit',
      baseRevision: '41',
      baseVersion: 3,
      baseChecksum: 'abc',
      state: 'ready',
    })
    const openPath = vi.fn(() => true)
    const { handle, sent } = await setup(openPath)
    const shown = handle.service as unknown as {
      show(path: string, binding: unknown): unknown
    }
    expect(shown.show(docPath(), { title: 'Plan.docx' })).toEqual({
      path: docPath(),
      title: 'Plan.docx',
    })
    expect(openPath).toHaveBeenCalledWith(docPath())
    // the status chip is pushed as usual; no lock is
    expect(sent.filter((m) => m.channel === UNIWORK_DOC_CHANNELS.lock)).toEqual([])
    expect(sent.map((m) => m.channel)).toEqual([UNIWORK_DOC_CHANNELS.docStatusEvent])
  })
})

describe('the durable store at the account boundary (W3b)', () => {
  it('an explicit Sign out locks the outgoing scope and keeps its ciphertext for the next sign-in', async () => {
    seed({ schema: 2 })
    const { handle } = await setup()
    // the account's store scope holds a record, read through a handle that is
    // open when the sign-out runs
    const opened = await handle.service.openSyncStore()
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const records = opened.records(INTENT_STORE_REGISTRATION.name)
    await createIntentStore(records).put(
      'doc_1',
      {
        v: 2,
        intentId: 'intent_1',
        idempotencyKey: 'idem_1',
        documentId: 'doc_1',
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: 'abc',
        length: 3,
        generation: 1,
        state: 'queued',
        attempt: 0,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
      new TextEncoder().encode('v4'),
    )
    // the hooks the shell's sign-out runs (see uniwork-auth's signOutUniwork)
    expect(await handle.boundary.beforeSignOut()).toBe(true)
    handle.boundary.afterSignOut()
    // lock-and-keep: the scope directory survives, the pre-lock handle is dead
    expect(existsSync(join(dir, 'uniwork-sync', 'store', 'default', 'acc_1'))).toBe(true)
    expect(await records.read('doc_1')).toEqual({ kind: 'interrupted' })
    // a same-account sign-in reopens the scope and reads the record back
    const again = await handle.service.openSyncStore()
    if (again.kind !== 'ok') throw new Error(again.kind)
    const record = await createIntentStore(again.records(INTENT_STORE_REGISTRATION.name)).get(
      'doc_1',
    )
    expect(record?.intent.intentId).toBe('intent_1')
    // another account's scope is not touched
    const otherScope = join(dir, 'uniwork-sync', 'store', 'default', 'acc_9', 'feed-cursors')
    mkdirSync(otherScope, { recursive: true })
    writeFileSync(join(otherScope, 'record.rec'), 'x')
    identity = { accountId: 'acc_9', deviceSessionId: 'dev_9', deploymentId: 'default' }
    statusListener?.({ state: 'signed-in' })
    await handle.boundary.enforce({ accountId: 'acc_9', deploymentId: 'default' })
    expect(existsSync(otherScope)).toBe(true)
  })
})

describe('a cold locked restore at the wiring (R1-be-4)', () => {
  it('the account keystore-locked state locks the saved account copy with no session', async () => {
    seedLegacyIntent()
    mkdirSync(join(dir, 'uniwork-documents'), { recursive: true })
    writeFileSync(
      join(dir, 'uniwork-documents', 'last-account.json'),
      JSON.stringify({ accountId: 'acc_1', deploymentId: 'default' }),
    )
    // the locked restart: the restore dropped the session, the account says locked
    identity = null
    accountState = 'keystore-locked'
    const { handle, sent } = await setup()
    expect(handle.service.refuseLockedPath(docPath())).toBe(true)
    expect(sent.at(-1)).toEqual({
      channel: UNIWORK_DOC_CHANNELS.lock,
      payload: { path: docPath(), reason: 'keystore_locked', name: 'Plan.docx' },
    })
    // the plaintext pair is untouched
    expect(existsSync(join(docDir(), INTENT_PAYLOAD_FILE))).toBe(true)
  })
})

describe('the lock list push when a keystore lock clears (R1-fe-1 BE)', () => {
  it('main pushes the cleared list after the store opens, so the S11 panel can go away', async () => {
    seedLegacyIntent()
    const { handle, sent } = await setup()
    safe.locked = true

    // the locked open records + pushes the S11 keystore lock
    expect((await handle.service.openSyncStore()).kind).toBe('keystore_locked')
    expect(sent.filter((m) => m.channel === UNIWORK_DOC_CHANNELS.lock)).toEqual([
      {
        channel: UNIWORK_DOC_CHANNELS.lock,
        payload: { path: docPath(), reason: 'keystore_locked', name: 'Plan.docx' },
      },
    ])
    // and the list itself is not pushed while the lock is on screen
    expect(sent.filter((m) => m.channel === UNIWORK_DOC_CHANNELS.locksChanged)).toEqual([])

    // the keychain unlocks and Retry opens the store: the intent migrates and
    // main tells the shell the list changed (it is empty now)
    safe.locked = false
    expect((await handle.service.openSyncStore()).kind).toBe('ok')
    expect(handle.service.currentLocks()).toEqual([])
    expect(sent.filter((m) => m.channel === UNIWORK_DOC_CHANNELS.locksChanged)).toEqual([
      { channel: UNIWORK_DOC_CHANNELS.locksChanged, payload: [] },
    ])
    // the same open ran the sweep: the plaintext pair is gone for good
    expect(existsSync(join(docDir(), INTENT_PAYLOAD_FILE))).toBe(false)

    // a later open that clears nothing does not push the list again
    expect((await handle.service.openSyncStore()).kind).toBe('ok')
    expect(sent.filter((m) => m.channel === UNIWORK_DOC_CHANNELS.locksChanged)).toHaveLength(1)
  })
})

describe('the account boundary at the production wiring (G511-be-3)', () => {
  it('an account switch runs the real lockSession and restarts the feed for the new session', async () => {
    seedReadable()
    const stop = vi.spyOn(SyncRuntime.prototype, 'stop')
    const start = vi.spyOn(SyncRuntime.prototype, 'start')
    accountOrg = { id: 'org_a', slug: 'acme' }
    accountState = 'signed-in'
    const { handle } = await setup()
    // the signed-in push starts the feed for the chosen org
    statusListener?.({ state: 'signed-in', org: accountOrg })
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1))
    // a live store handle from before the switch
    const opened = await handle.service.openSyncStore()
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const records = opened.records(INTENT_STORE_REGISTRATION.name)
    await createIntentStore(records).put(
      'doc_1',
      {
        v: 2,
        intentId: 'intent_boundary',
        idempotencyKey: 'idem_boundary',
        documentId: 'doc_1',
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: 'abc',
        length: 3,
        generation: 1,
        state: 'queued',
        attempt: 0,
        createdAt: '2026-04-17T00:00:00.000Z',
        updatedAt: '2026-04-17T00:00:00.000Z',
      },
      new TextEncoder().encode('v4'),
    )

    // acc_2 signs in for the same org: enforce locks acc_1 through the real
    // lockSession, which stops the feed pass itself
    identity = { accountId: 'acc_2', deviceSessionId: 'dev_2', deploymentId: 'default' }
    statusListener?.({ state: 'signed-in', org: accountOrg })
    // the real lockSession ran for acc_1: the pre-switch handle is dead and the
    // outgoing account's working copy is gone
    await vi.waitFor(async () =>
      expect(await records.read('doc_1')).toEqual({ kind: 'interrupted' }),
    )
    expect(existsSync(docDir())).toBe(false)
    // and the forced stop does not leave the feed dead: it restarts for the new
    // session once the boundary settled
    await vi.waitFor(() => expect(start.mock.calls.length).toBeGreaterThan(1))
    expect(stop.mock.calls.length).toBeGreaterThan(1)
    stop.mockRestore()
    start.mockRestore()
  })

  it("a confirmed sign-out closes the owner's views with no module or UniWork close prompt (row 7)", async () => {
    seedReadable()
    const closePathNow = vi.fn()
    const confirmClosePath = vi.fn(async () => true)
    const forgetAiHistory = vi.fn()
    const { handle, sent } = await setup(
      vi.fn(() => true),
      {
        openPaths: () => [docPath()],
        closePathNow,
        confirmClosePath,
        aiHistoryPaths: () => [docPath()],
        forgetAiHistory,
      },
    )
    // unsaved edits: the plan has a count, and the renderer already confirmed
    handle.service.noteEditorDirty(docPath(), true)

    expect(await handle.boundary.beforeSignOut({ confirmed: true })).toBe(true)

    expect(closePathNow).toHaveBeenCalledWith(docPath())
    // neither the module's unsaved-changes prompt nor a UniWork close prompt ran
    expect(confirmClosePath).not.toHaveBeenCalled()
    expect(sent.filter((m) => m.channel === UNIWORK_DOC_CHANNELS.signOutPrompt)).toEqual([])
    // the outgoing account's AI history went with its views
    expect(forgetAiHistory).toHaveBeenCalledWith([docPath()])
  })

  it('lockStore pushes phase:done with captureFailed count when capture fails (d1-2)', async () => {
    seedReadable()
    const { handle, sent } = await setup(
      vi.fn(() => true),
      {
        openPaths: () => [docPath()],
      },
    )
    handle.service.noteEditorDirty(docPath(), true)

    expect(await handle.boundary.beforeSignOut({ confirmed: true })).toBe(true)

    expect(sent.filter((m) => m.channel === UNIWORK_DOC_CHANNELS.signOutProgress)).toEqual([
      {
        channel: UNIWORK_DOC_CHANNELS.signOutProgress,
        payload: { phase: 'done', captureFailed: 1 },
      },
    ])
  })

  it('lockStore pushes phase:done in a finally block even if lockSession throws (FE d1-n1)', async () => {
    seedReadable()
    const { handle, sent } = await setup()
    vi.spyOn(handle.service, 'lockSession').mockRejectedValueOnce(new Error('syncStore boom'))

    await handle.boundary.beforeSignOut({ confirmed: true })

    expect(sent.filter((m) => m.channel === UNIWORK_DOC_CHANNELS.signOutProgress)).toEqual([
      {
        channel: UNIWORK_DOC_CHANNELS.signOutProgress,
        payload: { phase: 'done' },
      },
    ])
  })
})
