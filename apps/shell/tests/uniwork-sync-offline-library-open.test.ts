import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type * as NodeFsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocLock } from '../src/shared/home-api'
import {
  UniworkDocsService,
  type ConflictUi,
  type OfflineCopyOpen,
} from '../src/main/uniwork-docs/service'
import { BINDING_FILE, scopeWorkingCopyDirs } from '../src/main/uniwork-docs/binding-store'
import { ID } from '../src/main/uniwork-sync/feed/http'
import {
  OFFLINE_COPY_KEY_MAX,
  OFFLINE_COPY_KEY_SUFFIX,
  createOfflineCopies,
  offlineCopyKey,
  type OfflineCopies,
} from '../src/main/uniwork-sync/offline-library/copies'
import {
  createOfflineLibraryApi,
  type OfflineLibraryApi,
} from '../src/main/uniwork-sync/offline-library/api'
import { offlineHeadIds, offlineRowView } from '../src/main/uniwork-sync/offline-library/view'
import {
  ORG,
  SCOPE,
  WS,
  addDoc,
  createHarness,
  leaseState,
  type Harness,
} from './uniwork-sync-offline-library-fakes'

const fsFault = vi.hoisted(() => ({
  rmGate: null as null | ((path: string) => Promise<void> | void),
  rmFault: null as null | ((path: string) => boolean),
  probeFault: null as null | ((path: string) => boolean),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  const fail = (code: string): never => {
    throw Object.assign(new Error(code), { code })
  }
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      const path = String(args[0])
      await fsFault.rmGate?.(path)
      if (fsFault.rmFault?.(path)) fail('EBUSY')
      return actual.rm(...args)
    },
    stat: async (...args: Parameters<typeof actual.stat>) => {
      if (fsFault.probeFault?.(String(args[0]))) fail('EACCES')
      return actual.stat(...args)
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      if (fsFault.probeFault?.(String(args[0]))) fail('EACCES')
      return actual.lstat(...args)
    },
  }
})

/**
 * G5-05u B5: a pinned document opened with no network is served from its
 * verified cached copy - a read-only bound working copy (access `view`, 0o444)
 * that goes as soon as no window shows it and at sign-out. Every refusal names
 * the S11 lock the shell shows.
 */

const noUi: ConflictUi = {
  chooseConflict: async () => 'later',
  confirmDiscard: async () => false,
  pickCopyPath: async () => null,
  showOpenLatestFailed: () => undefined,
  showCopyFailed: () => undefined,
  chooseUnsavedClose: async () => 'cancel',
}

interface OpenHarness {
  h: Harness
  service: UniworkDocsService
  copies: OfflineCopies
  api: OfflineLibraryApi
  opened: string[]
  locks: UniworkDocLock[]
  /** the open-path test seam: what `isPathOpen` answers */
  pathOpen: { value: boolean; closed: Set<string> }
  clock: { now: number }
  /** the lease manager's commit stamp (G703-R7-1): odd while a renewal commit is in flight */
  leaseStamp: { value: number }
  capability: { on: boolean }
  /** the auth module's state the service reads: a cold restore with a locked keychain has no identity */
  account: { signedIn: boolean; keystoreLocked: boolean }
  scope: { value: { deploymentId: string; accountId: string } }
  /** the server read: every URL asked, and an optional answer (default: no network) */
  server: { answer: ((url: string) => Response) | null; calls: string[] }
  userDataDir: string
}

/** a server answer for one status + UniWork envelope (BE-R1-4) */
const answerOf = (status: number, body: unknown): Response =>
  ({
    ok: false,
    status,
    redirected: false,
    url: '',
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as Response

function openHarness(): OpenHarness {
  const h = createHarness()
  const userDataDir = mkdtempSync(join(tmpdir(), 'uw-offline-open-'))
  const opened: string[] = []
  const locks: UniworkDocLock[] = []
  const pathOpen = { value: true, closed: new Set<string>() }
  const isPathOpen = (path: string) => !pathOpen.closed.has(path) && pathOpen.value
  const clock = { now: 1_000 }
  const leaseStamp = { value: 0 }
  const capability = { on: true }
  const account = { signedIn: true, keystoreLocked: false }
  const scope = { value: { deploymentId: SCOPE.deploymentId, accountId: SCOPE.accountId } }
  const server: OpenHarness['server'] = { answer: null, calls: [] }
  /** what the wiring passes the service: the module's outcome as the service's seam */
  const openOfflineCopy = async (documentId: string): Promise<OfflineCopyOpen> => {
    const outcome = await copies.open(documentId)
    if (outcome.kind === 'opened') {
      return { kind: 'opened', path: outcome.path, title: outcome.title }
    }
    return outcome.kind === 'refused' ? { kind: 'locked', ...outcome.lock } : null
  }
  const service = new UniworkDocsService({
    userDataDir,
    profile: () => ({
      deploymentId: SCOPE.deploymentId,
      apiOrigin: 'https://uniwork.example',
      clientId: 'uniwork-office',
      channel: 'stable',
    }),
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () =>
      account.signedIn
        ? {
            accountId: SCOPE.accountId,
            deviceSessionId: 'dev_1',
            deploymentId: SCOPE.deploymentId,
          }
        : null,
    keystoreLocked: () => account.keystoreLocked,
    selectedOrg: () => ({ id: ORG, slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    // no network at all by default: every server read is the offline case. A
    // test may answer one status instead (BE-R1-4)
    fetch: ((url: string) => {
      server.calls.push(url)
      const answer = server.answer?.(url)
      return answer ? Promise.resolve(answer) : Promise.reject(new TypeError('fetch failed'))
    }) as never,
    openPath: (path) => {
      opened.push(path)
      return true
    },
    isPathOpen,
    requestModuleSave: () => false,
    reloadPath: () => undefined,
    activePath: () => undefined,
    ui: noUi,
    pushStatus: () => undefined,
    pushLaunch: () => undefined,
    pushLock: (lock) => locks.push(lock),
    reveal: () => undefined,
    openOfflineCopy,
  })
  const copies = createOfflineCopies({
    library: () => h.manager,
    capabilityOn: async () => capability.on,
    store: service.store,
    // the account's own working-copy folders: what the startup sweep walks
    scopeDirs: (deploymentId, accountId) =>
      scopeWorkingCopyDirs(service.store.root, { deploymentId, accountId }),
    scope: () => scope.value,
    show: (path) => service.showOfflineCopy(path),
    isPathOpen,
    appVersion: () => '0.0.0-test',
    lockOpened: (lock) => service.recordOfflineLock(lock),
    leaseStamp: () => leaseStamp.value,
    now: () => clock.now,
  })
  const api = createOfflineLibraryApi({
    library: () => h.manager,
    activeOrgId: () => ORG,
    capabilityOn: async () => capability.on,
    signedOut: () => h.session.scope === null,
    lastOwner: () => service.store.readLastOwner(),
    activeDeploymentId: () => SCOPE.deploymentId,
    libraryLayer: () => h.layer,
    openDocument: (documentId) => service.openDocument(documentId),
    openCopy: (documentId) => copies.open(documentId),
    revealLibraryFolder: async () => true,
    lockRefused: (lock) => service.recordOfflineLock(lock),
    keystoreLock: (documentId) => service.offlineKeystoreLock(documentId),
    changed: () => undefined,
    now: () => clock.now,
  })
  return {
    h,
    service,
    copies,
    api,
    opened,
    locks,
    pathOpen,
    clock,
    leaseStamp,
    capability,
    account,
    scope,
    server,
    userDataDir,
  }
}

/** the binding path segment rule the key must satisfy (`SEGMENT`, binding-store.ts) */
const SANITIZED_KEY = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/

const pin = (h: Harness, documentId = 'doc_1') =>
  h.manager.pin({ documentId, orgId: ORG, workspaceId: WS })

let dirs: string[] = []
beforeEach(() => {
  dirs = []
  fsFault.rmGate = null
  fsFault.rmFault = null
  fsFault.probeFault = null
})
afterEach(() => {
  fsFault.rmGate = null
  fsFault.rmFault = null
  fsFault.probeFault = null
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('G5-05u B5 an offline open shows the read-only cached copy', () => {
  it('a pinned ready document opens its copy: access view, read-only, never saved here', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const doc = addDoc(o.h, 'doc_1', 1)
    expect((await pin(o.h)).kind).toBe('pinned')
    const result = await o.service.openDocument('doc_1')
    expect(result).toEqual({
      ok: true,
      value: { path: expect.stringContaining(offlineCopyKey('doc_1')) },
    })
    const path = o.service.store.dirFor(
      SCOPE.deploymentId,
      SCOPE.accountId,
      offlineCopyKey('doc_1'),
    )
    expect(o.opened).toHaveLength(1)
    const copy = o.service.store.lookup(o.opened[0]!)
    expect(copy?.binding).toMatchObject({
      documentId: 'doc_1',
      workspaceId: WS,
      access: 'view',
      level: 'view',
      filename: 'doc_1.docx',
    })
    expect(o.service.isReadOnly(o.opened[0]!)).toBe(true)
    // the bytes are the verified cached copy, byte for byte
    expect(new Uint8Array(await readFile(join(path, 'doc_1.docx')))).toEqual(doc.bytes)
    // while a tab reads it, the pin's own cleanup waits (markOpen)
    expect(await o.h.manager.row('doc_1')).toMatchObject({ open: true })
    expect(o.locks).toEqual([])
  })

  it('the copy goes when no window shows it any more, and the library hears the close', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    await o.copies.open('doc_1')
    const dir = o.service.store.dirFor(SCOPE.deploymentId, SCOPE.accountId, offlineCopyKey('doc_1'))
    expect(existsSync(dir)).toBe(true)
    // a window still shows it: nothing goes
    await o.copies.sweep()
    expect(existsSync(dir)).toBe(true)
    o.pathOpen.value = false
    await o.copies.sweep()
    expect(existsSync(dir)).toBe(true)
    o.clock.now += 31_000
    await o.copies.sweep()
    expect(existsSync(dir)).toBe(false)
    expect(await o.h.manager.row('doc_1')).toMatchObject({ open: false })
    expect((await o.h.manager.row('doc_1'))?.readyVersion).toBe(1)
  })

  it('opening the same document again brings the copy forward instead of writing a second one', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    const first = await o.copies.open('doc_1')
    const again = await o.copies.open('doc_1')
    expect(again).toEqual(first)
    expect(o.opened).toHaveLength(2)
  })

  it('sign-out drops every copy of the account, and the library is not called', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1)
    addDoc(o.h, 'doc_2', 1)
    await pin(o.h, 'doc_1')
    await pin(o.h, 'doc_2')
    await o.copies.open('doc_1')
    await o.copies.open('doc_2')
    const dirOne = o.service.store.dirFor(
      SCOPE.deploymentId,
      SCOPE.accountId,
      offlineCopyKey('doc_1'),
    )
    const dirTwo = o.service.store.dirFor(
      SCOPE.deploymentId,
      SCOPE.accountId,
      offlineCopyKey('doc_2'),
    )
    expect(existsSync(dirOne) && existsSync(dirTwo)).toBe(true)
    await o.copies.dropAll()
    expect(existsSync(dirOne) || existsSync(dirTwo)).toBe(false)
  })

  it('nothing pinned leaves the open to the normal path (which fails offline)', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const result = await o.service.openDocument('doc_1')
    expect(result.ok).toBe(false)
    expect(o.opened).toEqual([])
  })
})

describe('G703B-P3 (FL-09) a pinned open with the keychain locked and no restored session', () => {
  it('is refused keystore_locked (the S11 keychain reason), not signed_out', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    // the second launch: the saved sign-in cannot be read, so no session is restored
    o.account.signedIn = false
    o.account.keystoreLocked = true
    const result = await o.api.open('doc_1')
    expect(result).toMatchObject({
      ok: false,
      code: 'keystore_locked',
      lockReason: 'keystore_locked',
    })
  })

  it('raises the S11 keychain lock and opens nothing: no tab, no server read', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    o.account.signedIn = false
    o.account.keystoreLocked = true
    await o.api.open('doc_1')
    expect(o.opened).toEqual([])
    expect(o.server.calls).toEqual([])
    expect(o.locks).toEqual([expect.objectContaining({ reason: 'keystore_locked' })])
    // the panel names a path under the store: the tab that never opened has no folder yet
    expect(o.locks[0]!.path.startsWith(o.service.store.root)).toBe(true)
  })

  it('a plain signed-out machine (keychain fine) still answers no_session / signed_out, no lock', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    o.account.signedIn = false
    const result = await o.api.open('doc_1')
    expect(result).toMatchObject({ ok: false, code: 'no_session', lockReason: 'signed_out' })
    expect(o.locks).toEqual([])
  })
})

describe('G703B-P1 (FL-04a) an open offline copy whose lease lapses is locked in place', () => {
  const copyDir = (o: OpenHarness) =>
    o.service.store.dirFor(SCOPE.deploymentId, SCOPE.accountId, offlineCopyKey('doc_1'))

  async function openCopy(o: OpenHarness): Promise<string> {
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    const outcome = await o.copies.open('doc_1')
    if (outcome.kind !== 'opened') throw new Error(`expected an open, got ${outcome.kind}`)
    return outcome.path
  }

  it('(a) the lease lapses while the copy is on screen: the next pass raises lease_expired for its path and the plaintext goes', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const path = await openCopy(o)
    // a window shows it and the lease is fine: nothing happens
    await o.copies.sweep()
    expect(o.locks).toEqual([])
    expect(existsSync(copyDir(o))).toBe(true)
    o.h.leases.states.set('doc_1', leaseState('expired'))
    await o.copies.sweep()
    expect(o.locks).toEqual([expect.objectContaining({ path, reason: 'lease_expired' })])
    expect(existsSync(copyDir(o))).toBe(false)
    // the tab is still on screen while locked in place: open remains true until the tab closes
    expect(await o.h.manager.row('doc_1')).toMatchObject({
      state: 'lease-expired',
      open: true,
    })
    // and the next pass does not raise it again or falsify open
    await o.copies.sweep()
    expect(o.locks).toHaveLength(1)
    expect(await o.h.manager.row('doc_1')).toMatchObject({ open: true })
    // once the tab actually closes (past the close grace), open becomes false
    o.pathOpen.value = false
    o.clock.now += 31_000
    await o.copies.sweep()
    expect(await o.h.manager.row('doc_1')).toMatchObject({ open: false })
  })

  it('(a) the capability off names the lock libraryOff, a clock rollback its own reason', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    await openCopy(o)
    o.capability.on = false
    o.h.leases.states.set('doc_1', leaseState('expired'))
    await o.copies.sweep()
    expect(o.locks).toEqual([
      expect.objectContaining({ reason: 'lease_expired', libraryOff: true }),
    ])
    const rolled = openHarness()
    dirs.push(rolled.userDataDir)
    await openCopy(rolled)
    rolled.h.leases.states.set('doc_1', leaseState('clock_rollback'))
    await rolled.copies.sweep()
    expect(rolled.locks).toEqual([expect.objectContaining({ reason: 'clock_rollback' })])
  })

  it('(a) a lease the online pass renewed in time never locks the open copy', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    await openCopy(o)
    o.h.leases.states.set('doc_1', leaseState('expiring_soon'))
    await o.copies.sweep()
    o.h.leases.states.set('doc_1', leaseState('valid'))
    await o.copies.sweep()
    expect(o.locks).toEqual([])
    expect(existsSync(copyDir(o))).toBe(true)
  })

  it('(b) a reopen of the on-screen copy with an expired lease is refused, locks, and shows nothing', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const path = await openCopy(o)
    o.h.leases.states.set('doc_1', leaseState('expired'))
    const again = await o.copies.open('doc_1')
    expect(again).toMatchObject({
      kind: 'refused',
      failure: { code: 'lease_unusable', lockReason: 'lease_expired' },
      lock: { path, reason: 'lease_expired' },
    })
    expect(existsSync(copyDir(o))).toBe(false)
    expect(await o.h.manager.row('doc_1')).toMatchObject({ open: true })
  })

  it('(b) the app-level reopen (offline, copy on screen, lease expired) raises the lock and never answers opened', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const path = await openCopy(o)
    o.h.leases.states.set('doc_1', leaseState('expired'))
    const result = await o.api.open('doc_1')
    expect(result).toMatchObject({ ok: false, lockReason: 'lease_expired' })
    expect(o.locks.at(-1)).toMatchObject({ path, reason: 'lease_expired' })
  })

  it('(c) a valid lease: the reopen still brings the on-screen copy forward, no second write', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const path = await openCopy(o)
    const before = await readFile(path)
    const again = await o.copies.open('doc_1')
    expect(again).toMatchObject({ kind: 'opened', path })
    expect(new Uint8Array(await readFile(path))).toEqual(new Uint8Array(before))
    expect(o.locks).toEqual([])
  })

  it('a renewed lease lets the locked document open again', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    await openCopy(o)
    o.h.leases.states.set('doc_1', leaseState('expired'))
    await o.copies.sweep()
    o.h.leases.states.set('doc_1', leaseState('valid'))
    expect((await o.copies.open('doc_1')).kind).toBe('opened')
    expect(existsSync(copyDir(o))).toBe(true)
  })

  it('(G703-R6-3) a visible copy with the feed stopped and no session still locks and deletes plaintext when its lease expires', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    o.clock.now = 1_760_000_000_000
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    o.h.leases.states.set('doc_1', {
      ...leaseState('valid'),
      record: {
        expires_at: new Date(o.clock.now + 40).toISOString(),
      } as never,
      remainingMs: 40,
    })
    const outcome = await o.copies.open('doc_1')
    if (outcome.kind !== 'opened') throw new Error(`expected an open, got ${outcome.kind}`)
    const path = outcome.path
    expect(existsSync(copyDir(o))).toBe(true)
    // feed poll is stopped and the session scope is gone: library.row('doc_1') is null
    o.h.session.scope = null
    o.account.signedIn = false
    expect(await o.h.manager.row('doc_1')).toBeNull()
    // time reaches the lease expiry without any reopen or forced poll
    o.clock.now += 50
    await vi.waitFor(() => {
      expect(o.locks).toEqual([expect.objectContaining({ path, reason: 'lease_expired' })])
      expect(existsSync(copyDir(o))).toBe(false)
    })
    // and when a copy has no tracked expiry and loses session scope, sweep locks it as signed_out
    const o2 = openHarness()
    dirs.push(o2.userDataDir)
    const path2 = await openCopy(o2)
    o2.h.session.scope = null
    o2.scope.value = null as never
    await o2.copies.sweep()
    expect(o2.locks).toEqual([expect.objectContaining({ path: path2, reason: 'signed_out' })])
    expect(existsSync(copyDir(o2))).toBe(false)
  })

  it('(G703-R6-4) a renewal that lands after the first expired read but before the destructive action keeps the copy and raises no lock', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const path = await openCopy(o)
    o.h.leases.states.set('doc_1', leaseState('expired'))
    let rowReads = 0
    const origRow = o.h.manager.row.bind(o.h.manager)
    vi.spyOn(o.h.manager, 'row').mockImplementation(async (id) => {
      rowReads += 1
      const r = await origRow(id)
      if (rowReads === 1) {
        // renewal lands right after the first expired read, while capabilityOn runs
        o.h.leases.states.set('doc_1', leaseState('valid'))
      }
      return r
    })
    await o.copies.sweep()
    expect(rowReads).toBe(2)
    expect(o.locks).toEqual([])
    expect(existsSync(copyDir(o))).toBe(true)
    expect(existsSync(path)).toBe(true)
  })

  it('(G703-R7-1) a renewal that lands after the final row read and before the deletion keeps the copy and raises no lock', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const path = await openCopy(o)
    o.h.leases.states.set('doc_1', leaseState('expired'))
    let rowReads = 0
    const origRow = o.h.manager.row.bind(o.h.manager)
    vi.spyOn(o.h.manager, 'row').mockImplementation(async (id) => {
      rowReads += 1
      const read = await origRow(id)
      if (rowReads === 2) {
        // the final expired read is already in hand: the renewal commits now
        o.h.leases.states.set('doc_1', leaseState('valid'))
        o.leaseStamp.value += 2
      }
      return read
    })
    await o.copies.sweep()
    expect(rowReads).toBe(2)
    expect(o.locks).toEqual([])
    expect(existsSync(copyDir(o))).toBe(true)
    expect(existsSync(path)).toBe(true)
    expect(await o.h.manager.row('doc_1')).toMatchObject({ open: true })
    // the cancelled lock retries later (bounded, not a spin) and sees the valid lease
    rowReads = 100
    o.clock.now += 40_000
    await o.copies.sweep()
    expect(o.locks).toEqual([])
    expect(existsSync(path)).toBe(true)
  })

  it('(G703-R7-1) a renewal commit in flight defers the lock: the copy stays until it settles', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const path = await openCopy(o)
    o.h.leases.states.set('doc_1', leaseState('expired'))
    o.leaseStamp.value = 1
    await o.copies.sweep()
    expect(o.locks).toEqual([])
    expect(existsSync(path)).toBe(true)
    // the commit settled with a renewed lease
    o.h.leases.states.set('doc_1', leaseState('valid'))
    o.leaseStamp.value = 2
    await o.copies.sweep()
    expect(o.locks).toEqual([])
    expect(existsSync(path)).toBe(true)
  })
})

describe('G5-05u B5 every refusal names its S11 lock', () => {
  const refused = async (o: OpenHarness): Promise<{ failure: unknown; lock: UniworkDocLock }> => {
    const outcome = await o.copies.open('doc_1')
    if (outcome.kind !== 'refused') throw new Error(`expected a refusal, got ${outcome.kind}`)
    return { failure: outcome.failure, lock: outcome.lock }
  }

  it('a lease that expired names lease_expired', async () => {
    const o = openHarness()
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    o.h.leases.states.set('doc_1', leaseState('expired'))
    const { failure, lock } = await refused(o)
    expect(failure).toMatchObject({ code: 'lease_unusable', lockReason: 'lease_expired' })
    expect(lock).toMatchObject({ reason: 'lease_expired', name: 'doc_1.docx' })
  })

  it('lease_expired with the capability off carries libraryOff (uwLockLibraryOff)', async () => {
    const o = openHarness()
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    o.h.leases.states.set('doc_1', leaseState('expired'))
    o.capability.on = false
    expect((await refused(o)).failure).toMatchObject({
      lockReason: 'lease_expired',
      libraryOff: true,
    })
    expect((await refused(o)).lock.libraryOff).toBe(true)
  })

  it('a clock rollback names clock_rollback, a locked keychain keystore_locked', async () => {
    const o = openHarness()
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    o.h.leases.states.set('doc_1', leaseState('clock_rollback'))
    expect((await refused(o)).failure).toMatchObject({ lockReason: 'clock_rollback' })
    o.h.leases.states.set('doc_1', leaseState('keystore_locked'))
    expect((await refused(o)).failure).toMatchObject({ lockReason: 'keystore_locked' })
  })

  it('a revoked copy names permission_revoked, a deleted one document_deleted', async () => {
    const o = openHarness()
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    await o.h.manager.handlePermissionRevoked('doc_1')
    expect((await refused(o)).failure).toMatchObject({
      code: 'revoked',
      lockReason: 'permission_revoked',
    })
    await o.h.manager.handleDeleted('doc_1')
    expect((await refused(o)).failure).toMatchObject({
      code: 'deleted',
      lockReason: 'document_deleted',
    })
  })

  it('no session at all names signed_out', async () => {
    const o = openHarness()
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    o.h.session.scope = null
    expect((await refused(o)).failure).toMatchObject({ lockReason: 'signed_out' })
  })

  it('the service records the lock it was handed and keeps the open failing', async () => {
    const o = openHarness()
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    o.h.leases.states.set('doc_1', leaseState('expired'))
    const result = await o.service.openDocument('doc_1')
    expect(result.ok).toBe(false)
    expect(o.locks).toEqual([
      expect.objectContaining({ reason: 'lease_expired', name: 'doc_1.docx' }),
    ])
    // the S11 list the shell reads back on mount carries it too
    expect(o.service.currentLocks()).toEqual([expect.objectContaining({ reason: 'lease_expired' })])
  })
})

describe('G5-05u B5 the copy is named and cleared like the normal open path (BE-R1-1, BE-R1-2)', () => {
  it('names the copy as the normal open path does, inside its own folder, for every hostile server name', async () => {
    const cases: Array<[string, string]> = [
      ['../escape.docx', '_escape.docx'],
      ['foo/bar.docx', 'foo_bar.docx'],
      ['a:b.docx', 'a_b.docx'],
      ['CON.docx', '_CON.docx'],
    ]
    for (const [sent, expected] of cases) {
      const o = openHarness()
      dirs.push(o.userDataDir)
      const doc = addDoc(o.h, 'doc_1', 1)
      doc.filename = sent
      expect((await pin(o.h)).kind).toBe('pinned')
      expect((await o.service.openDocument('doc_1')).ok).toBe(true)
      const dir = o.service.store.dirFor(
        SCOPE.deploymentId,
        SCOPE.accountId,
        offlineCopyKey('doc_1'),
      )
      const openedPath = o.opened[0]!
      // one segment, under the copy folder: no `../`, no separator, no drive
      expect(dirname(openedPath)).toBe(dir)
      expect(basename(openedPath)).toBe(expected)
      expect(openedPath.includes('..')).toBe(false)
      // the binding the shell reads back is the read-only one, never a plain file
      expect(o.service.store.lookup(openedPath)?.binding).toMatchObject({
        documentId: 'doc_1',
        access: 'view',
        level: 'view',
        filename: expected,
      })
      expect(o.service.isReadOnly(openedPath)).toBe(true)
      expect(readdirSync(dir).sort()).toEqual([BINDING_FILE, expected].sort())
      expect(new Uint8Array(await readFile(openedPath))).toEqual(doc.bytes)
      // read-only on disk too (Windows reports the POSIX bits chmod set; host probe: 0o444)
      expect(((await stat(openedPath)).mode & 0o777).toString(8)).toBe('444')
      rmSync(o.userDataDir, { recursive: true, force: true })
    }
  })

  it('a refusal names its S11 lock with the same safe segment, never the raw server name (BE-R1-1)', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1).filename = '../escape.docx'
    await pin(o.h)
    o.h.leases.states.set('doc_1', leaseState('expired'))
    const outcome = await o.copies.open('doc_1')
    if (outcome.kind !== 'refused') throw new Error(`expected a refusal, got ${outcome.kind}`)
    expect(outcome.lock.name).toBe('_escape.docx')
    expect(dirname(outcome.lock.path)).toBe(
      o.service.store.dirFor(SCOPE.deploymentId, SCOPE.accountId, offlineCopyKey('doc_1')),
    )
    expect(outcome.lock.reason).toBe('lease_expired')
  })

  it('a read-only leftover of an earlier session goes before the new bytes land', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const doc = addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    const dir = o.service.store.dirFor(SCOPE.deploymentId, SCOPE.accountId, offlineCopyKey('doc_1'))
    // what a crash (or a remove that failed) leaves: the copy, view-only, plus a stray
    mkdirSync(dir, { recursive: true })
    const leftover = join(dir, 'doc_1.docx')
    writeFileSync(leftover, new Uint8Array([1, 2, 3]))
    chmodSync(leftover, 0o444)
    writeFileSync(join(dir, 'stale.bin'), new Uint8Array([4]))
    const outcome = await o.copies.open('doc_1')
    expect(outcome.kind).toBe('opened')
    expect(new Uint8Array(await readFile(leftover))).toEqual(doc.bytes)
    expect(existsSync(join(dir, 'stale.bin'))).toBe(false)
    expect(readdirSync(dir).sort()).toEqual([BINDING_FILE, 'doc_1.docx'].sort())
  })

  it('a 128-char document id still opens its copy: the key fits one binding segment (BE-R1-5)', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const id = 'a'.repeat(128)
    const doc = addDoc(o.h, id, 1)
    expect((await o.h.manager.pin({ documentId: id, orgId: ORG, workspaceId: WS })).kind).toBe(
      'pinned',
    )
    const outcome = await o.copies.open(id)
    expect(outcome.kind).toBe('opened')
    const key = offlineCopyKey(id)
    // one accepted segment, and the same key for the same document every time
    expect(ID.test(id)).toBe(true)
    expect(key.length).toBeLessThanOrEqual(OFFLINE_COPY_KEY_MAX)
    expect(offlineCopyKey(id)).toBe(key)
    expect(SANITIZED_KEY.test(key)).toBe(true)
    expect(offlineCopyKey(`${'a'.repeat(127)}b`)).not.toBe(key)
    expect(dirname(o.opened[0]!)).toBe(
      o.service.store.dirFor(SCOPE.deploymentId, SCOPE.accountId, key),
    )
    expect(new Uint8Array(await readFile(o.opened[0]!))).toEqual(doc.bytes)
  })

  it('two accepted ids never share a copy folder: a long id and its shortened twin (BE-R2-1)', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const longId = 'a'.repeat(128)
    // the reviewer's pair: the 120-char id that aliased the old shortened key of
    // `longId`, plus the key stem of `longId` itself (both are accepted feed ids)
    const shortId = `${longId.slice(0, 103)}-${createHash('sha256').update(longId).digest('hex').slice(0, 16)}`
    const stemId = offlineCopyKey(longId).slice(0, -OFFLINE_COPY_KEY_SUFFIX.length)
    expect(ID.test(longId)).toBe(true)
    expect(ID.test(shortId)).toBe(true)
    expect(ID.test(stemId)).toBe(true)
    expect(shortId).not.toBe(longId)
    expect(offlineCopyKey(shortId)).not.toBe(offlineCopyKey(longId))
    expect(offlineCopyKey(stemId)).not.toBe(offlineCopyKey(longId))
    const longDoc = addDoc(o.h, longId, 1)
    const shortDoc = addDoc(o.h, shortId, 1)
    expect((await o.h.manager.pin({ documentId: longId, orgId: ORG, workspaceId: WS })).kind).toBe(
      'pinned',
    )
    expect((await o.h.manager.pin({ documentId: shortId, orgId: ORG, workspaceId: WS })).kind).toBe(
      'pinned',
    )
    const long = await o.copies.open(longId)
    const short = await o.copies.open(shortId)
    if (long.kind !== 'opened' || short.kind !== 'opened') throw new Error('both must open')
    expect(dirname(long.path)).not.toBe(dirname(short.path))
    // both plaintexts and bindings survive both opens, byte for byte
    expect(new Uint8Array(await readFile(long.path))).toEqual(longDoc.bytes)
    expect(new Uint8Array(await readFile(short.path))).toEqual(shortDoc.bytes)
    expect(o.service.store.lookup(long.path)?.binding.documentId).toBe(longId)
    expect(o.service.store.lookup(short.path)?.binding.documentId).toBe(shortId)
    // cleaning up one copy leaves the other copy and its binding untouched
    o.pathOpen.closed.add(short.path)
    o.clock.now += 31_000
    await o.copies.sweep()
    expect(existsSync(dirname(short.path))).toBe(false)
    expect(existsSync(dirname(long.path))).toBe(true)
    expect(new Uint8Array(await readFile(long.path))).toEqual(longDoc.bytes)
    expect(o.service.store.lookup(long.path)?.binding.documentId).toBe(longId)
  })

  it('the account activation sweep deletes a leftover copy folder and keeps a real working copy', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const leftover = o.service.store.dirFor(
      SCOPE.deploymentId,
      SCOPE.accountId,
      offlineCopyKey('doc_9'),
    )
    mkdirSync(leftover, { recursive: true })
    const file = join(leftover, 'doc_9.docx')
    writeFileSync(file, new Uint8Array([9]))
    chmodSync(file, 0o444)
    const workingCopy = o.service.store.dirFor(SCOPE.deploymentId, SCOPE.accountId, 'doc_8')
    mkdirSync(workingCopy, { recursive: true })
    await o.copies.recover()
    expect(existsSync(leftover)).toBe(false)
    expect(existsSync(workingCopy)).toBe(true)
  })

  it('a crash leftover whose first removal fails is retried by the next sweep, recover and dropAll (BE-R2-3)', async () => {
    for (const retry of ['sweep', 'recover', 'dropAll'] as const) {
      const o = openHarness()
      dirs.push(o.userDataDir)
      const leftover = o.service.store.dirFor(
        SCOPE.deploymentId,
        SCOPE.accountId,
        offlineCopyKey('doc_9'),
      )
      mkdirSync(leftover, { recursive: true })
      const file = join(leftover, 'doc_9.docx')
      writeFileSync(file, new Uint8Array([9]))
      chmodSync(file, 0o444)
      fsFault.rmFault = (path) => path === leftover
      fsFault.probeFault = (path) => path === leftover
      await o.copies.recover()
      expect(existsSync(leftover)).toBe(true)
      fsFault.rmFault = null
      fsFault.probeFault = null
      await o.copies[retry]()
      expect(existsSync(leftover)).toBe(false)
    }
  })

  it('a removal that fails with an inspection error keeps the copy on the record for sweep, recover and dropAll (BE-R2-8)', async () => {
    for (const first of ['sweep', 'dropAll'] as const) {
      const o = openHarness()
      dirs.push(o.userDataDir)
      addDoc(o.h, 'doc_1', 1)
      await pin(o.h)
      const dir = o.service.store.dirFor(
        SCOPE.deploymentId,
        SCOPE.accountId,
        offlineCopyKey('doc_1'),
      )
      expect((await o.copies.open('doc_1')).kind).toBe('opened')
      o.pathOpen.value = false
      o.clock.now += 31_000
      fsFault.rmFault = (path) => path === dir
      fsFault.probeFault = (path) => path === dir
      await o.copies[first]()
      expect(existsSync(dir)).toBe(true)
      fsFault.rmFault = null
      fsFault.probeFault = null
      await o.copies.sweep()
      expect(existsSync(dir)).toBe(false)
    }
  })

  it('a tracked copy that could not be deleted is retried by the next sweep and dropAll (BE-R2-11)', async () => {
    for (const mode of ['sweep', 'dropAll'] as const) {
      const o = openHarness()
      dirs.push(o.userDataDir)
      addDoc(o.h, 'doc_1', 1)
      await pin(o.h)
      const dir = o.service.store.dirFor(
        SCOPE.deploymentId,
        SCOPE.accountId,
        offlineCopyKey('doc_1'),
      )
      expect((await o.copies.open('doc_1')).kind).toBe('opened')
      o.pathOpen.value = false
      o.clock.now += 31_000
      fsFault.rmFault = (path) => path === dir
      await o.copies[mode]()
      expect(existsSync(dir)).toBe(true)
      if (mode === 'sweep') {
        expect(await o.h.manager.row('doc_1')).toMatchObject({ open: true })
      } else {
        // even if a new account opens the same document id before the retry, the failed dir stays tracked
        o.scope.value = { deploymentId: SCOPE.deploymentId, accountId: 'user_2' }
        expect((await o.copies.open('doc_1')).kind).toBe('opened')
      }
      fsFault.rmFault = null
      await o.copies[mode]()
      expect(existsSync(dir)).toBe(false)
      if (mode === 'sweep') {
        expect(await o.h.manager.row('doc_1')).toMatchObject({ open: false })
      }
    }
  })

  it('a recovery that runs while a second copy is opening does not delete it (BE-R2-2)', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const docOne = addDoc(o.h, 'doc_1', 1)
    const docTwo = addDoc(o.h, 'doc_2', 1)
    await pin(o.h, 'doc_1')
    await pin(o.h, 'doc_2')
    const dirOne = o.service.store.dirFor(
      SCOPE.deploymentId,
      SCOPE.accountId,
      offlineCopyKey('doc_1'),
    )
    const dirTwo = o.service.store.dirFor(
      SCOPE.deploymentId,
      SCOPE.accountId,
      offlineCopyKey('doc_2'),
    )
    mkdirSync(dirOne, { recursive: true })
    writeFileSync(join(dirOne, 'doc_1.docx'), new Uint8Array([1]))
    mkdirSync(dirTwo, { recursive: true })
    writeFileSync(join(dirTwo, 'doc_2.docx'), new Uint8Array([2]))
    // gate whichever directory `scopeDirs` enumerates first, and open the second
    const [firstDir, secondId, secondDir, secondFile, secondBytes] =
      basename(dirOne) < basename(dirTwo)
        ? [dirOne, 'doc_2', dirTwo, 'doc_2.docx', docTwo.bytes]
        : [dirTwo, 'doc_1', dirOne, 'doc_1.docx', docOne.bytes]
    const gate = Promise.withResolvers<void>()
    const reached = Promise.withResolvers<void>()
    fsFault.rmGate = async (path) => {
      if (path !== firstDir) return
      reached.resolve()
      await gate.promise
    }
    const recovering = o.copies.recover()
    await reached.promise
    // the second copy opens while recovery is parked on the first removal
    const opening = o.copies.open(secondId)
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    gate.resolve()
    const [opened] = await Promise.all([opening, recovering])
    fsFault.rmGate = null
    expect(opened.kind).toBe('opened')
    expect(existsSync(secondDir)).toBe(true)
    expect(new Uint8Array(await readFile(join(secondDir, secondFile)))).toEqual(secondBytes)
    expect(o.service.store.lookup(join(secondDir, secondFile))?.binding.documentId).toBe(secondId)
  })

  it('a dropAll of the outgoing account never loses the incoming account copy (BE-R2-5)', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const docOne = addDoc(o.h, 'doc_1', 1)
    await pin(o.h, 'doc_1')
    const dirA = o.service.store.dirFor(
      SCOPE.deploymentId,
      SCOPE.accountId,
      offlineCopyKey('doc_1'),
    )
    const first = await o.copies.open('doc_1')
    if (first.kind !== 'opened') throw new Error('expected A open')
    expect(new Uint8Array(await readFile(join(dirA, 'doc_1.docx')))).toEqual(docOne.bytes)
    // A's tab closes before the boundary dropAll
    o.pathOpen.closed.add(first.path)
    const gate = Promise.withResolvers<void>()
    const reached = Promise.withResolvers<void>()
    fsFault.rmGate = async (path) => {
      if (path !== dirA) return
      reached.resolve()
      await gate.promise
    }
    const dropping = o.copies.dropAll()
    await reached.promise
    // the account switches while A's removal is parked: B opens the same document
    o.scope.value = { deploymentId: SCOPE.deploymentId, accountId: 'user_2' }
    const dirB = o.service.store.dirFor(SCOPE.deploymentId, 'user_2', offlineCopyKey('doc_1'))
    const opening = o.copies.open('doc_1')
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    gate.resolve()
    const [opened] = await Promise.all([opening, dropping])
    fsFault.rmGate = null
    expect(opened.kind).toBe('opened')
    expect(dirname(opened.kind === 'opened' ? opened.path : '')).toBe(dirB)
    expect(existsSync(dirA)).toBe(false)
    expect(new Uint8Array(await readFile(join(dirB, 'doc_1.docx')))).toEqual(docOne.bytes)
    o.pathOpen.value = false
    o.clock.now += 31_000
    await o.copies.sweep()
    expect(existsSync(dirB)).toBe(false)
  })

  it('a rejected open never wedges the queue: the next open resolves and a sweep still runs (BE-R3-2)', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const doc = addDoc(o.h, 'doc_1', 1)
    await pin(o.h, 'doc_1')
    const dir = o.service.store.dirFor(SCOPE.deploymentId, SCOPE.accountId, offlineCopyKey('doc_1'))
    vi.spyOn(o.h.manager, 'row').mockRejectedValueOnce(new Error('row read failed'))
    await expect(o.copies.open('doc_1')).rejects.toThrow('row read failed')
    const opened = await o.copies.open('doc_1')
    expect(opened.kind).toBe('opened')
    expect(existsSync(dir)).toBe(true)
    expect(new Uint8Array(await readFile(join(dir, 'doc_1.docx')))).toEqual(doc.bytes)
    o.pathOpen.value = false
    o.clock.now += 31_000
    await o.copies.sweep()
    expect(existsSync(dir)).toBe(false)
  })

  it('a save of the offline copy is refused as view-only, and mints no intent', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    const outcome = await o.copies.open('doc_1')
    if (outcome.kind !== 'opened') throw new Error(`expected an open, got ${outcome.kind}`)
    const dir = o.service.store.dirFor(SCOPE.deploymentId, SCOPE.accountId, offlineCopyKey('doc_1'))
    const before = await readFile(join(dir, BINDING_FILE))
    const ended = await o.service.coordinator.save(outcome.path, { userSave: true })
    expect(ended?.binding.access).toBe('view')
    // nothing was minted: the binding on disk is byte for byte the one the open wrote
    expect(await readFile(join(dir, BINDING_FILE))).toEqual(before)
    expect(existsSync(join(dir, 'pending-upload.bin'))).toBe(false)
    expect(o.server.calls).toEqual([])
  })
})

describe('G5-05u B5 only the network class opens the cached copy (BE-R1-4, BE-R2-6)', () => {
  it('a 403 while online never opens the ready copy', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    o.server.answer = () => answerOf(403, { error: { code: 'forbidden' } })
    expect((await o.service.openDocument('doc_1')).ok).toBe(false)
    expect(o.opened).toEqual([])
  })

  it('a 410 (revoked/deleted) never opens the ready copy', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    o.server.answer = () => answerOf(410, { error: { code: 'document_deleted' } })
    expect((await o.service.openDocument('doc_1')).ok).toBe(false)
    expect(o.opened).toEqual([])
  })

  it('a network failure still opens the copy', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)
    const result = await o.service.openDocument('doc_1')
    expect(result.ok).toBe(true)
    expect(o.opened).toHaveLength(1)
    expect(o.opened[0]).toContain(offlineCopyKey('doc_1'))
  })

  it('S3 offlineOpen through service + copies + api never falls back on 403 or 410, and opens the copy on a network error (BE-R2-6)', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    addDoc(o.h, 'doc_1', 1)
    await pin(o.h)

    o.server.answer = () => answerOf(403, { error: { code: 'forbidden' } })
    expect(await o.api.open('doc_1')).toEqual({
      ok: false,
      code: 'revoked',
      lockReason: 'permission_revoked',
    })
    expect(o.opened).toEqual([])

    o.server.answer = () => answerOf(410, { error: { code: 'document_deleted' } })
    expect(await o.api.open('doc_1')).toEqual({
      ok: false,
      code: 'deleted',
      lockReason: 'document_deleted',
    })
    expect(o.opened).toEqual([])

    o.server.answer = null
    expect(await o.api.open('doc_1')).toEqual({ ok: true })
    expect(o.opened).toHaveLength(1)
    expect(o.opened[0]).toContain(offlineCopyKey('doc_1'))
  })
})

describe('G5-05u B7 hasOfflineHead', () => {
  it('is true only for a document whose committed copy is the head the pin saw', () => {
    const base = {
      documentId: 'doc_1',
      workspaceId: WS,
      name: 'doc_1.docx',
      state: 'ready' as const,
      progress: null,
      sizeBytes: 4096,
      leaseUntil: null,
      leaseLevel: 'edit' as const,
      updateKeptReason: null,
      open: false,
    }
    const head = offlineHeadIds([
      { ...base, version: 3, headVersion: 3 },
      { ...base, documentId: 'doc_2', version: 2, headVersion: 3, state: 'update-available' },
      { ...base, documentId: 'doc_3', version: null, headVersion: 3, state: 'waiting-network' },
      { ...base, documentId: 'doc_4', version: 1, headVersion: 2, state: 'update-kept' },
      { ...base, documentId: 'doc_5', version: 2, headVersion: 2, state: 'view-only' },
    ])
    expect([...head].sort()).toEqual(['doc_1', 'doc_5'])
  })

  it('reads off the live library rows: a newer head is not offline yet', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    await pin(h)
    const projected = async () =>
      offlineHeadIds((await h.manager.list()).map((row) => offlineRowView(row, true)))
    expect((await projected()).has('doc_1')).toBe(true)
    addDoc(h, 'doc_1', 2)
    expect(await h.manager.refresh('doc_1')).toMatchObject({ row: { state: 'update-available' } })
    expect((await projected()).has('doc_1')).toBe(false)
    // the download lands: the copy is the head again
    expect(await h.manager.downloadNow('doc_1')).toMatchObject({
      kind: 'ok',
      row: { state: 'ready' },
    })
    expect((await projected()).has('doc_1')).toBe(true)
  })

  it('a lease-expired row whose committed version is the head is not offline (BE-R1-6)', () => {
    const base = {
      workspaceId: WS,
      name: 'doc_1.docx',
      progress: null,
      sizeBytes: 4096,
      leaseUntil: null,
      leaseLevel: 'view' as const,
      updateKeptReason: null,
      open: false,
      version: 2,
      headVersion: 2,
    }
    const head = offlineHeadIds([
      {
        ...base,
        documentId: 'doc_1',
        state: 'lease-expired',
        lockReason: 'lease_expired',
      },
      {
        ...base,
        documentId: 'doc_2',
        state: 'locked',
        lockReason: 'keystore_locked',
      },
      { ...base, documentId: 'doc_3', state: 'corrupt' },
      { ...base, documentId: 'doc_4', state: 'revoked' },
      { ...base, documentId: 'doc_5', state: 'waiting-network' },
      { ...base, documentId: 'doc_6', state: 'view-only' },
    ])
    expect([...head]).toEqual(['doc_6'])
  })

  it('a lease-expiring or archived head whose cached open succeeds is offline, while a blocked head is not (BE-R2-4)', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    await pin(h)
    const projected = async () => {
      const rows = (await h.manager.list()).map((row) => offlineRowView(row, true))
      return { rows, heads: offlineHeadIds(rows) }
    }
    h.leases.states.set('doc_1', leaseState('expiring_soon'))
    expect((await h.manager.openCached('doc_1')).kind).toBe('ok')
    expect((await projected()).rows[0]?.state).toBe('lease-expiring')
    expect((await projected()).heads.has('doc_1')).toBe(true)

    h.leases.states.set('doc_1', leaseState('valid'))
    await h.manager.noteArchived('doc_1', true)
    expect((await h.manager.openCached('doc_1')).kind).toBe('ok')
    expect((await projected()).rows[0]?.state).toBe('archived')
    expect((await projected()).heads.has('doc_1')).toBe(true)

    h.leases.states.set('doc_1', leaseState('expired'))
    expect((await h.manager.openCached('doc_1')).kind).toBe('refused')
    expect((await projected()).rows[0]?.state).toBe('lease-expired')
    expect((await projected()).heads.has('doc_1')).toBe(false)
  })

  it('no rows, no heads', () => {
    expect(offlineHeadIds([]).size).toBe(0)
  })
})
