import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UniworkDocLock } from '../src/shared/home-api'
import {
  UniworkDocsService,
  type ConflictUi,
  type OfflineCopyOpen,
} from '../src/main/uniwork-docs/service'
import {
  createOfflineCopies,
  offlineCopyKey,
  type OfflineCopies,
} from '../src/main/uniwork-sync/offline-library/copies'
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
  opened: string[]
  locks: UniworkDocLock[]
  /** the open-path test seam: what `isPathOpen` answers */
  pathOpen: { value: boolean }
  clock: { now: number }
  capability: { on: boolean }
  userDataDir: string
}

function openHarness(): OpenHarness {
  const h = createHarness()
  const userDataDir = mkdtempSync(join(tmpdir(), 'uw-offline-open-'))
  const opened: string[] = []
  const locks: UniworkDocLock[] = []
  const pathOpen = { value: true }
  const clock = { now: 1_000 }
  const capability = { on: true }
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
    identity: () => ({
      accountId: SCOPE.accountId,
      deviceSessionId: 'dev_1',
      deploymentId: SCOPE.deploymentId,
    }),
    keystoreLocked: () => false,
    selectedOrg: () => ({ id: ORG, slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    // no network at all: every server read is the offline case
    fetch: (() => Promise.reject(new TypeError('fetch failed'))) as never,
    openPath: (path) => {
      opened.push(path)
      return true
    },
    isPathOpen: () => pathOpen.value,
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
    scope: () => ({ deploymentId: SCOPE.deploymentId, accountId: SCOPE.accountId }),
    show: (path) => service.showOfflineCopy(path),
    isPathOpen: () => pathOpen.value,
    appVersion: () => '0.0.0-test',
    now: () => clock.now,
  })
  return { h, service, copies, opened, locks, pathOpen, clock, capability, userDataDir }
}

const pin = (h: Harness, documentId = 'doc_1') =>
  h.manager.pin({ documentId, orgId: ORG, workspaceId: WS })

let dirs: string[] = []
beforeEach(() => {
  dirs = []
})
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('G5-05u B5 an offline open shows the read-only cached copy', () => {
  it('a pinned ready document opens its copy: access view, read-only, never saved here', async () => {
    const o = openHarness()
    dirs.push(o.userDataDir)
    const doc = addDoc(o.h, 'doc_1', 1)
    expect((await pin(o.h)).kind).toBe('pinned')
    const result = await o.service.openDocument('doc_1')
    expect(result).toEqual({ ok: true, value: { path: expect.stringContaining('doc_1@offline') } })
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

  it('no rows, no heads', () => {
    expect(offlineHeadIds([]).size).toBe(0)
  })
})
