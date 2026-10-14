import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStatus, UniworkDocLock, UniworkDocStatus } from '../src/shared/home-api'
import type { StoredCredential } from '../src/main/uniwork-auth/credentials'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { AccountManager } from '../src/main/uniwork-auth/manager'
import type { DesktopSession, UniworkTransport } from '../src/main/uniwork-auth/transport'
import { BINDING_FILE, INTENT_PAYLOAD_FILE } from '../src/main/uniwork-docs/binding-store'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import { createIntentStore, INTENT_STORE_REGISTRATION } from '../src/main/uniwork-sync/intent-store'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'
import { createLockableCredentialStore } from './uniwork-auth-fakes'

/**
 * l.480-481 end to end: a locked restart (keystore-locked, no session) followed
 * by unlock + Retry. The real AccountManager drives the real restore through
 * the account-status listener the wiring installs (`noteSessionIdentity()`),
 * so the service opens the session's store and its schema 1 -> 2 sweep only
 * after the session is back - and that sweep runs exactly once.
 */

// counts real sweep runs (started and finished) without changing what the sweep does
const sweeps = vi.hoisted(() => ({ calls: 0, done: 0 }))
vi.mock('../src/main/uniwork-sync/migration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/uniwork-sync/migration')>()
  return {
    ...actual,
    migrateLegacyIntents: async (deps: Parameters<typeof actual.migrateLegacyIntents>[0]) => {
      sweeps.calls += 1
      try {
        return await actual.migrateLegacyIntents(deps)
      } finally {
        sweeps.done += 1
      }
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

const LEGACY_INTENT = {
  intentId: 'office-intent-legacy',
  idempotencyKey: 'office-key-legacy',
  documentId: DOC,
  baseRevision: '41',
  checksum: hex(enc('working copy bytes')),
  createdAt: '2026-10-11T00:00:00.000Z',
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-lock-retry-'))
  sweeps.calls = 0
  sweeps.done = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const docDir = () => join(dir, 'uniwork-documents', 'default', 'acc_1', DOC)
const docPath = () => join(docDir(), 'Plan.docx')
const bindingText = () => readFileSync(join(docDir(), BINDING_FILE), 'utf8')

/** the intent records the durable store holds on disk for the account */
const intentRecords = () => {
  try {
    return readdirSync(join(dir, 'uniwork-sync', 'store', 'default', 'acc_1', 'intents')).filter(
      (name) => name.endsWith('.rec'),
    )
  } catch {
    return []
  }
}

/** the copy a pre-store build left behind: schema 1 + the plaintext intent pair */
function seedLegacyCopy(): void {
  mkdirSync(docDir(), { recursive: true })
  writeFileSync(docPath(), 'working copy bytes')
  writeFileSync(
    join(docDir(), BINDING_FILE),
    JSON.stringify(
      {
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
        state: 'saving',
        pendingIntent: LEGACY_INTENT,
      },
      null,
      2,
    ),
  )
  writeFileSync(join(docDir(), INTENT_PAYLOAD_FILE), 'working copy bytes')
}

const stored = (): StoredCredential => ({
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  accountId: 'acc_1',
  deviceSessionId: 'dev_1',
  sessionId: 'sess_1',
  refreshToken: 'rt_stored',
  refreshExpiresAt: Date.now() + 86_400_000,
  profile: { accountId: 'acc_1', email: 'cached@example.com' },
})

const session = (): DesktopSession => ({
  accountId: 'acc_1',
  deviceSessionId: 'dev_1',
  sessionId: 'sess_1',
  deploymentId: 'default',
  accessToken: 'at_1',
  refreshToken: 'rt_1',
  expiresIn: 900,
  refreshExpiresIn: 30 * 24 * 3600,
})

function fakeTransport(): UniworkTransport {
  return {
    start: vi.fn(async () => ({ authorizationUrl: `${ORIGIN}/auth` })),
    exchange: vi.fn(async () => session()),
    refresh: vi.fn(async () => session()),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => ({ id: 'acc_1', email: 'mai@example.com', displayName: 'Mai' })),
    orgs: vi.fn(async () => [
      { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', status: 'active' },
    ]),
    billing: vi.fn(async () => ({
      planCode: 'pro',
      planName: 'Pro',
      status: 'active',
      features: [],
    })),
  } satisfies UniworkTransport
}

/**
 * The wiring's account listener and the real service over the account's real
 * store layer: `activate()` calls `noteSessionIdentity()` on every status push,
 * which is what opens the store (and runs the sweep) after a Retry.
 */
function setup() {
  const credentials = createLockableCredentialStore(stored())
  const transport = fakeTransport()
  const manager = new AccountManager({
    resolveProfile: () => profile,
    createTransport: () => transport,
    credentials: credentials.store,
    openBrowser: vi.fn(async () => undefined),
    readSelectedOrgId: () => 'org_a',
    persistSelectedOrgId: vi.fn(),
  })
  const statuses: AccountStatus[] = []
  const safeStorage: LockableSafeStorage = createLockableSafeStorage()
  const layer = createStoreLayer({
    root: join(dir, 'uniwork-sync', 'store'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(dir, 'uniwork-sync', 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  const syncStore = createSyncStoreAccess({
    layer,
    scope: () => {
      const identity = manager.sessionIdentity()
      return identity
        ? { deploymentId: identity.deploymentId, accountId: identity.accountId }
        : null
    },
  })
  const docStatuses: UniworkDocStatus[] = []
  const locks: UniworkDocLock[] = []
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  const service = new UniworkDocsService({
    userDataDir: dir,
    syncStore,
    appVersion: () => '0.11.0',
    profile: () => profile,
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () => manager.sessionIdentity(),
    // the account's own state, as the wiring reports it
    keystoreLocked: () => manager.status().state === 'keystore-locked',
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    openPath: vi.fn(() => true),
    isPathOpen: vi.fn(() => false),
    requestModuleSave: vi.fn(() => false),
    reloadPath: vi.fn(),
    activePath: () => undefined,
    ui,
    pushStatus: (status: UniworkDocStatus) => docStatuses.push(status),
    pushLaunch: vi.fn(),
    pushLock: (lock: UniworkDocLock) => locks.push(lock),
    reveal: vi.fn(),
  })
  // exactly the wiring's activate(): the session's identity may have changed
  manager.onStatus((status) => {
    statuses.push(status)
    service.noteSessionIdentity()
  })
  return { manager, credentials, layer, service, statuses, locks, safeStorage }
}

describe('unlock + Retry ends in a live session with one migration (l.480-481)', () => {
  it('a locked restart migrates nothing; Retry migrates exactly once, end to end', async () => {
    seedLegacyCopy()
    const ctx = setup()

    // a locked restart: keystore-locked, no session, nothing written
    const locked = await ctx.manager.startupRestore(Promise.resolve())
    expect(locked.state).toBe('keystore-locked')
    expect(locked.error).toBe('keystore_locked')
    await ctx.service.openSyncStore()
    expect(sweeps.calls).toBe(0)
    expect(intentRecords()).toEqual([])
    expect(existsSync(join(docDir(), INTENT_PAYLOAD_FILE))).toBe(true)

    // the keychain unlocks and the user hits Retry
    ctx.credentials.unlock()
    const status = await ctx.manager.retry()
    expect(status.state).toBe('signed-in')
    expect(status.loggedIn).toBe(true)
    expect(status.error).toBeUndefined()

    // no explicit open here: the account listener opened the store on the
    // status push, so the sweep count below depends on the listener alone
    // the sweep writes the record first and rewrites the binding / drops the
    // payload after it: wait for the sweep to finish, not just for the record
    await vi.waitFor(() => expect(sweeps.done).toBe(1))
    expect(intentRecords()).toHaveLength(1)
    expect(sweeps.calls).toBe(1)
    const migrated = JSON.parse(bindingText()) as Record<string, unknown>
    expect(migrated).toMatchObject({ schema: 2, min_store_level: 2 })
    expect(migrated).not.toHaveProperty('pendingIntent')
    expect(existsSync(join(docDir(), INTENT_PAYLOAD_FILE))).toBe(false)
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const intent = await createIntentStore(
      opened.store.records(INTENT_STORE_REGISTRATION.name),
    ).get(DOC)
    expect(intent?.intent.idempotencyKey).toBe(LEGACY_INTENT.idempotencyKey)

    // the session is live and this account's copies are no longer locked
    expect(ctx.manager.sessionIdentity()?.accountId).toBe('acc_1')
    expect(ctx.locks.filter((lock) => lock.reason === 'keystore_locked')).toEqual([])

    // a second Retry and a second open are no-ops: still one migration, one record
    await ctx.manager.retry()
    expect((await ctx.service.openSyncStore()).kind).toBe('ok')
    expect(sweeps.calls).toBe(1)
    expect(intentRecords()).toHaveLength(1)
  })
})
