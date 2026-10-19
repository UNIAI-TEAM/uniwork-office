import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocStatus } from '../src/shared/home-api'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'
import { UniworkDocError, errorFromResponse } from '../src/main/uniwork-docs/errors'
import { parseDocumentList, type DocumentDetail } from '../src/main/uniwork-docs/parse'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import type { UniworkDocsClient } from '../src/main/uniwork-docs/client'
import type { Binding, BoundDocument } from '../src/main/uniwork-docs/binding-store'
import { SaveCoordinator } from '../src/main/uniwork-docs/save-coordinator'
import { QueueDispatcher, type QueueClient } from '../src/main/uniwork-sync/queue/dispatcher'
import { QUEUE_LIMITS } from '../src/main/uniwork-sync/queue/limits'
import { createIntentStore, INTENT_STORE_REGISTRATION } from '../src/main/uniwork-sync/intent-store'
import { createDraftStore, DRAFTS_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/drafts'
import { createPauseStore, PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'
import {
  createSyncStoreAccess,
  SYNC_STORE_REGISTRATIONS,
} from '../src/main/uniwork-sync/session-store'
import { sha256Hex } from '../src/main/uniwork-docs/formats'
import type { IntentRecordV2 } from '../src/main/uniwork-sync/queue/record'
import { EditLockSession, type EditLockTransport } from '../src/main/uniwork-edit-lock/session'
import type {
  EditLockHeartbeat,
  EditLockTenure,
  UniworkEditLockClient,
} from '../src/main/uniwork-edit-lock/client'
import {
  resetEditLockWillQuitForTests,
  runEditLockWillQuit,
} from '../src/main/uniwork-docs/edit-lock-quit'

/**
 * EL-1(b) fix3 BE (UNI-1645 c) red pins: B1/B3 quit, B2 drop, A4/B5 cap,
 * B4 first-save, A2 in-flight acquire, A5 settle identity, B6 publish,
 * B8 holder on synthesised 423, A1/A7/B11 pins, B9 extra lost reasons.
 */

const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const LOCK = '01J8X4LOCK0N1P2Q3R4S5T6U7V'
const EDITOR = '01J8X4ED1T0R0000000000000A'
const enc = (text: string) => new TextEncoder().encode(text)
const hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const BYTES = enc('working copy')
const drain = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
const ISO = '2026-10-15T03:12:00.000Z'

const TENURE: EditLockTenure = {
  lockId: LOCK,
  documentId: DOC,
  holderId: 'u1',
  client: 'desktop',
  acquiredAt: '2026-10-15T03:12:00Z',
  expiresAt: '2026-10-15T03:14:00Z',
  heartbeatIntervalMs: 30_000,
  ttlMs: 120_000,
  serverTime: '2026-10-15T03:12:00Z',
}

const detail: DocumentDetail = {
  id: DOC,
  organizationId: 'org_a',
  workspaceId: 'ws_1',
  title: 'Plan.docx',
  revision: '9',
  currentVersion: 3,
  myLevel: 'edit',
  archivedAt: null,
  file: {
    filename: 'Plan.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    version: 3,
    versionId: 'ver_3',
    checksumSha256: hex(BYTES),
    sizeBytes: BYTES.byteLength,
  },
}

function locked(heldByMe = false, holderName = 'Lan'): UniworkDocError {
  return new UniworkDocError('edit_locked', {
    status: 423,
    serverCode: 'document_locked',
    editLock: {
      holderName,
      since: '2026-10-15T03:12:00Z',
      expiresAt: '2026-10-15T03:14:00Z',
      heldByMe,
    },
  })
}

function lost(reason: string, byName?: string): UniworkDocError {
  return new UniworkDocError('server_error', {
    status: 409,
    serverCode: 'edit_lock_lost',
    lostReason: reason as UniworkDocError['lostReason'],
    byName: byName ?? null,
  })
}

function transport(overrides: Partial<EditLockTransport> = {}): EditLockTransport & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    async getState() {
      calls.push('R1')
      return { lock: null, serverTime: 't' }
    },
    async acquire() {
      calls.push('R2')
      return TENURE
    },
    async heartbeat() {
      calls.push('R3')
      return {
        lockId: LOCK,
        expiresAt: '2026-10-15T03:16:00Z',
        serverTime: 't',
      } satisfies EditLockHeartbeat
    },
    async release() {
      calls.push('R4')
    },
    ...overrides,
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-el1b-fix3-'))
})
afterEach(() => {
  resetEditLockWillQuitForTests()
  rmSync(dir, { recursive: true, force: true })
})

function setup(opts: {
  acquire?: UniworkEditLockClient['acquire']
  release?: UniworkEditLockClient['release']
  getDocument?: () => Promise<DocumentDetail>
  createFile?: () => Promise<{ id: string; workspaceId: string; title: string }>
  sleep?: (ms: number) => Promise<void>
  isPathOpen?: () => boolean
  requestModuleSave?: () => boolean
}) {
  const statuses: UniworkDocStatus[] = []
  const commits: unknown[] = []
  const lockCalls: string[] = []
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  const editLockClient: UniworkEditLockClient = {
    async getState() {
      lockCalls.push('R1')
      return { lock: null, serverTime: 't' }
    },
    async acquire(input) {
      lockCalls.push(input.moveFromSelf ? 'R2-move' : 'R2')
      return opts.acquire ? opts.acquire(input) : TENURE
    },
    async heartbeat() {
      lockCalls.push('R3')
      return { lockId: LOCK, expiresAt: 't', serverTime: 't' }
    },
    async release() {
      lockCalls.push('R4')
      if (opts.release) await opts.release({ documentId: DOC, lockId: LOCK })
    },
  }
  const client = {
    async getDocument() {
      return opts.getDocument ? await opts.getDocument() : detail
    },
    async download() {
      return { bytes: BYTES }
    },
    async upload() {
      return { uploadId: 'up_1', checksumSha256: hex(BYTES), sizeBytes: BYTES.byteLength }
    },
    async commit(input: unknown) {
      commits.push(input)
      return {
        documentId: DOC,
        revision: '10',
        versionId: 'ver_4',
        version: 4,
        checksumSha256: hex(BYTES),
      }
    },
    async createFile() {
      if (opts.createFile) return opts.createFile()
      return { id: DOC, workspaceId: 'ws_1', title: 'Plan.docx' }
    },
    async listWorkspaces() {
      return [{ id: 'ws_1', name: 'Team', orgId: 'org_a', slug: 'team', orgSlug: 'acme' }]
    },
  }
  const layer = createStoreLayer({
    root: join(dir, 'sync-store'),
    keys: createSafeStorageKeyProvider({
      safeStorage: createLockableSafeStorage(),
      dir: join(dir, 'sync-store-keys'),
    }),
    budgetBytes: 64 * 1024 * 1024,
    clock: () => Date.now(),
  })
  for (const registration of SYNC_STORE_REGISTRATIONS) layer.register(registration)
  const syncStore = createSyncStoreAccess({
    layer,
    scope: () => ({ deploymentId: 'default', accountId: 'acc_1' }),
  })
  const service = new UniworkDocsService({
    userDataDir: dir,
    appVersion: () => '0.11.0',
    syncStore,
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
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    openPath: () => true,
    isPathOpen: opts.isPathOpen ?? (() => true),
    requestModuleSave: opts.requestModuleSave ?? (() => false),
    reloadPath: () => undefined,
    activePath: () => undefined,
    client: client as unknown as UniworkDocsClient,
    editLockClient,
    ui,
    pushStatus: (status) => statuses.push(status),
    pushLaunch: vi.fn(),
    reveal: vi.fn(),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  })
  return { service, statuses, commits, lockCalls }
}

describe('EL1B-BE-A2: ensureHeldBeforeCommit awaits an in-flight acquire', () => {
  it('commit queued mid-acquire goes out with the granted edit_lock_id (R2 then commit)', async () => {
    let grant!: (lock: EditLockTenure) => void
    const order: string[] = []
    const t = transport({
      async acquire() {
        order.push('R2')
        return new Promise<EditLockTenure>((resolve) => {
          grant = resolve
        })
      },
    })
    const s = new EditLockSession({
      documentId: DOC,
      path: '/tmp/doc.docx',
      editorId: EDITOR,
      transport: t,
    })
    const acquiring = s.acquire()
    expect(s.view().phase).toBe('acquiring')
    const held = s.ensureHeldBeforeCommit()
    grant(TENURE)
    await acquiring
    expect(await held).toBe('held')
    order.push('commit')
    expect(order).toEqual(['R2', 'commit'])
    expect(s.lockId()).toBe(LOCK)
    s.dispose()
  })
})

describe('EL1B-BE-B9: extra 409 lost reasons map through to the session view', () => {
  it.each([
    'session_revoked',
    'member_deactivated',
    'organization_suspended',
    'document_deleted',
  ] as const)('%s is kept on the lost view (unknown stays fallback)', async (reason) => {
    const parsed = errorFromResponse(409, {
      error: { code: 'edit_lock_lost', message: 'x', fields: { reason } },
    })
    expect(parsed.lostReason).toBe(reason)
    const t = transport({
      async heartbeat() {
        t.calls.push('R3')
        throw lost(parsed.lostReason ?? 'unknown')
      },
    })
    const s = new EditLockSession({
      documentId: DOC,
      path: '/tmp/doc.docx',
      editorId: EDITOR,
      transport: t,
    })
    await s.acquire()
    await s.wake()
    expect(s.view()).toMatchObject({ phase: 'lost', lostReason: reason })
    s.dispose()
  })

  it('an unknown reason stays the fallback', () => {
    const parsed = errorFromResponse(409, {
      error: { code: 'edit_lock_lost', message: 'x', fields: { reason: 'nope' } },
    })
    expect(parsed.lostReason).toBe('unknown')
  })
})

describe('EL1B-BE-B1+B3: will-quit release (never on veto; actually leaves)', () => {
  it('a vetoed quit keeps sessions held (no DELETE)', async () => {
    const h = setup({})
    const opened = await h.service.openFromServer(DOC)
    await drain()
    expect((await h.service.docStatus(opened.path))?.lockSession?.phase).toBe('held')
    // before-quit no longer releases: a cancelled close prompt is a no-op here
    expect(h.lockCalls.filter((c) => c === 'R4')).toHaveLength(0)
    expect((await h.service.docStatus(opened.path))?.lockSession?.phase).toBe('held')
  })

  it('a completed quit sends DELETE for each held lock before exit', async () => {
    const h = setup({})
    await h.service.openFromServer(DOC)
    await drain()
    const order: string[] = []
    await runEditLockWillQuit({
      preventDefault: () => order.push('prevent'),
      release: async (capMs) => {
        expect(capMs).toBe(1500)
        order.push('release')
        await h.service.releaseAllEditLocks(capMs)
      },
      quitAgain: () => order.push('quit'),
    })
    expect(order).toEqual(['prevent', 'release', 'quit'])
    expect(h.lockCalls.filter((c) => c === 'R4')).toEqual(['R4'])
  })

  it('a hanging server still exits within the 1.5 s cap; the second pass does not loop', async () => {
    const h = setup({
      release: () => new Promise(() => undefined),
    })
    await h.service.openFromServer(DOC)
    await drain()
    const started = Date.now()
    let quits = 0
    let releasing = false
    const first = await runEditLockWillQuit({
      preventDefault: () => undefined,
      release: async (capMs) => {
        releasing = true
        await h.service.releaseAllEditLocks(capMs)
        releasing = false
      },
      quitAgain: () => {
        quits += 1
      },
    })
    expect(first).toBe('released')
    expect(Date.now() - started).toBeLessThan(2500)
    expect(quits).toBe(1)
    const second = await runEditLockWillQuit({
      preventDefault: () => {
        throw new Error('second pass must not preventDefault')
      },
      release: async () => {
        throw new Error('second pass must not release')
      },
      quitAgain: () => {
        quits += 1
      },
    })
    expect(second).toBe('passthrough')
    expect(quits).toBe(1)
    expect(releasing).toBe(false)
  })

  it('index.ts moves the release to will-quit, before stopUniworkAccount, with a guard flag', () => {
    const source = readFileSync(join(__dirname, '..', 'src/main/index.ts'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    expect(source).not.toMatch(/before-quit[\s\S]{0,400}releaseEditLocksOnQuit/)
    expect(source).toMatch(/app\.on\('will-quit'/)
    const will = source.slice(source.indexOf("app.on('will-quit'"))
    const release = will.indexOf('releaseAllEditLocks')
    const begin = will.indexOf('beginEditLockWillQuit')
    const finish = will.indexOf('finishEditLockWillQuit')
    const stop = will.indexOf('stopUniworkAccount')
    expect(begin).toBeGreaterThan(-1)
    expect(finish).toBeGreaterThan(-1)
    expect(release).toBeGreaterThan(-1)
    expect(stop).toBeGreaterThan(-1)
    expect(release).toBeLessThan(stop)
    expect(begin).toBeLessThan(stop)
  })
})

describe('EL1B-BE-B2: MCP close / removeTab / window closed release dropped paths', () => {
  it('notePathsDropped releases every bound path it is given (one service hook)', async () => {
    const h = setup({})
    const opened = await h.service.openFromServer(DOC)
    await drain()
    expect(h.lockCalls).toContain('R2')
    await h.service.notePathsDropped([opened.path])
    expect(h.lockCalls.filter((c) => c === 'R4')).toEqual(['R4'])
    expect((await h.service.docStatus(opened.path))?.lockSession).toBeUndefined()
  })

  it('a hanging release on drop is capped at 1.5 s', async () => {
    const h = setup({
      release: () => new Promise(() => undefined),
    })
    const opened = await h.service.openFromServer(DOC)
    await drain()
    const started = Date.now()
    await h.service.notePathsDropped([opened.path])
    expect(Date.now() - started).toBeLessThan(2500)
  })

  it('closeTabWithoutPrompt / removeTab / window closed call notePathsDropped', () => {
    const tabs = readFileSync(join(__dirname, '..', 'src/main/tab-manager.ts'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    expect(tabs).toMatch(/notePathsDropped/)
    expect(tabs).toMatch(/closeTabWithoutPrompt[\s\S]{0,400}removeTab/)
    const index = readFileSync(join(__dirname, '..', 'src/main/index.ts'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    const closed = index.slice(index.indexOf("win.on('closed'"))
    expect(closed).toMatch(/notePathsDropped|releaseDroppedTabs|openFilePaths/)
  })
})

describe('EL1B-BE-A4+B5: close and sign-out release are capped at 1.5 s', () => {
  it('tab close (confirmClose) does not stall on a hanging DELETE', async () => {
    const h = setup({
      release: () => new Promise(() => undefined),
    })
    const opened = await h.service.openFromServer(DOC)
    await drain()
    const started = Date.now()
    await expect(h.service.confirmClose(opened.path)).resolves.toBe(true)
    expect(Date.now() - started).toBeLessThan(2500)
  })

  it('sign-out / lockSession releases BEFORE the token goes and never stalls', async () => {
    let stopRuntime = 0
    const hanging = setup({
      release: () => new Promise(() => undefined),
    })
    hanging.service['deps'].stopRuntime = () => {
      stopRuntime += 1
    }
    await hanging.service.openFromServer(DOC)
    await drain()
    expect(hanging.lockCalls.filter((c) => c === 'R4')).toHaveLength(0)
    const started = Date.now()
    await hanging.service.lockSession()
    expect(Date.now() - started).toBeLessThan(2500)
    expect(hanging.lockCalls.filter((c) => c === 'R4').length).toBeGreaterThanOrEqual(1)
    expect(stopRuntime).toBe(1)
  })
})

describe('EL1B-BE-B4: first-save bind starts the edit-lock session', () => {
  it('the second save after the bind carries edit_lock_id', async () => {
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, BYTES)
    const h = setup({
      isPathOpen: () => false,
    })
    const saved = await h.service.firstSave({
      tabPath: file,
      title: 'Plan.docx',
      workspaceId: 'ws_1',
      target: { kind: 'my_folder' },
    })
    expect(saved.ok).toBe(true)
    expect(h.lockCalls).toContain('R2')
    let bound = h.statuses.find((s) => s.documentId === DOC && s.lockSession?.phase === 'held')
    for (let i = 0; i < 20 && !bound; i += 1) {
      await drain(20)
      bound = h.statuses.find((s) => s.documentId === DOC && s.lockSession?.phase === 'held')
    }
    expect(bound?.lockSession?.phase).toBe('held')
    const path = bound!.path
    expect(h.service['editLockIdOf'](path)).toBe(LOCK)
    const source = readFileSync(
      join(__dirname, '..', 'src/main/uniwork-docs/service.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    const firstSave = source.slice(source.indexOf('private async runFirstSave'))
    const bindPublish = firstSave.indexOf('this.publish(toStatus(doc))')
    const start = firstSave.indexOf("if (doc.binding.access === 'edit') this.startEditLock(doc)")
    expect(start).toBeGreaterThan(-1)
    expect(start).toBeLessThan(bindPublish === -1 ? firstSave.length : bindPublish + 1)
    expect(bindPublish).toBeGreaterThan(-1)
  })
})

describe('EL1B-BE-A5: acquire settle only deletes the same session instance', () => {
  it('a stale none-settle does not evict a newer session of the same path', async () => {
    let first!: (lock: EditLockTenure) => void
    let n = 0
    const h = setup({
      acquire: async () => {
        n += 1
        if (n === 1) {
          return new Promise<EditLockTenure>((resolve) => {
            first = resolve
          })
        }
        return { ...TENURE, lockId: 'lock-new' }
      },
    })
    const opened = await h.service.openFromServer(DOC)
    await drain(10)
    expect(n).toBe(1)
    // a second start replaces the in-flight session (access drop then re-grant)
    const doc = h.service.store.lookup(opened.path)
    expect(doc).toBeTruthy()
    h.service['startEditLock'](doc!)
    await drain()
    expect(n).toBe(2)
    expect((await h.service.docStatus(opened.path))?.lockSession?.phase).toBe('held')
    first(TENURE)
    await drain()
    expect((await h.service.docStatus(opened.path))?.lockSession?.phase).toBe('held')
    const lockId = h.service['editLockIdOf'](opened.path)
    expect(lockId).toBe('lock-new')
  })
})

describe('EL1B-BE-B6: publish attaches lockSession so non-statusOf pushes keep it', () => {
  it('a title/remote-bar style publish while other keeps lockSession', async () => {
    const h = setup({
      acquire: async () => {
        throw locked(false)
      },
    })
    const opened = await h.service.openFromServer(DOC)
    await drain()
    expect((await h.service.docStatus(opened.path))?.lockSession?.phase).toBe('other')
    const doc = h.service.store.lookup(opened.path)!
    h.statuses.length = 0
    h.service['publish']({
      path: doc.path,
      documentId: doc.binding.documentId,
      workspaceId: doc.binding.workspaceId,
      title: 'Renamed.docx',
      format: 'docx',
      access: 'edit',
      state: 'ready',
    })
    const last = h.statuses.at(-1)
    expect(last?.lockSession).toMatchObject({
      phase: 'other',
      holderName: 'Lan',
      since: '2026-10-15T03:12:00Z',
    })
  })
})

describe('EL1B-BE-B8: synthesised 423 on a held/parked commit carries holder summary', () => {
  it('parked binding editLock keeps the session holder name / since', async () => {
    const t = transport({
      async acquire() {
        t.calls.push('R2')
        throw locked(false, 'Lan')
      },
    })
    const s = new EditLockSession({
      documentId: DOC,
      path: join(dir, 'Plan.docx'),
      editorId: EDITOR,
      transport: t,
    })
    await s.acquire()
    expect(s.view().phase).toBe('other')
    const layer = createStoreLayer({
      root: join(dir, 'records-b8'),
      keys: createSafeStorageKeyProvider({
        safeStorage: createLockableSafeStorage(),
        dir: join(dir, 'keys-b8'),
      }),
      budgetBytes: 1 << 20,
      clock: () => Date.parse(ISO),
    })
    layer.register(INTENT_STORE_REGISTRATION)
    layer.register(DRAFTS_STORE_REGISTRATION)
    layer.register(PAUSE_STORE_REGISTRATION)
    const opened = await layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
    const drafts = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
    const pause = createPauseStore(opened.store.records(PAUSE_STORE_REGISTRATION.name))
    const payload = enc('v4')
    const checksum = sha256Hex(payload)
    const path = s.path
    const binding: Binding = {
      schema: 2,
      documentId: DOC,
      workspaceId: 'ws_1',
      orgId: 'org_a',
      title: 'Plan.docx',
      filename: 'Plan.docx',
      format: 'docx',
      access: 'edit',
      baseRevision: '41',
      baseVersion: 3,
      baseChecksum: sha256Hex(enc('v3')),
      state: 'dirty',
      minStoreLevel: 2,
      minAppVersion: '0.0.0',
    }
    const bound: BoundDocument = {
      path,
      dir: join(dir, 'wc-b8'),
      deploymentId: 'default',
      userId: 'acc_1',
      key: 'doc_b8',
      binding,
    }
    const store = {
      classify: (p: string) =>
        p === path ? { kind: 'bound' as const, doc: bound } : { kind: 'plain' as const },
      lookup: (p: string) => (p === path ? bound : null),
      async write(_dir: string, next: Binding) {
        bound.binding = next
        return true
      },
    }
    const coordinator = new SaveCoordinator({
      store: store as never,
      client: {
        upload: async () => ({ uploadId: 'up_1', checksumSha256: checksum }),
        commit: async () => {
          throw new Error('commit must not run when park')
        },
        getDocument: async () => {
          throw new UniworkDocError('not_found')
        },
      },
      isSignedIn: () => true,
      ownsBinding: () => true,
      intents: async () => ({ kind: 'ok' as const, intents }),
      publish: () => undefined,
      now: () => new Date(ISO),
      uuid: () => 'u1',
      readBytes: async () => payload,
      capability: {
        get: async () => ({
          kind: 'ok' as const,
          capabilities: { sync_write: true },
          source: 'default',
        }),
      },
      pause,
      drafts,
      prepareEditLock: async () => 'park',
      editLockHolder: () => ({
        holderName: s.view().holderName,
        since: s.view().since,
        expiresAt: null,
        heldByMe: false,
      }),
    })
    const ended = await coordinator.save(path, { userSave: true })
    expect(ended?.binding.state).toBe('edit_locked')
    expect(ended?.binding.editLock).toMatchObject({
      holderName: 'Lan',
      since: '2026-10-15T03:12:00Z',
    })
    s.dispose()
  })
})

describe('EL1B-BE-A1: real session flips to lost on a commit 423 (coordinator + dispatcher)', () => {
  it('save-coordinator 423 while held marks the real session lost', async () => {
    const t = transport()
    const s = new EditLockSession({
      documentId: DOC,
      path: join(dir, 'Plan.docx'),
      editorId: EDITOR,
      transport: t,
    })
    await s.acquire()
    expect(s.view().phase).toBe('held')
    const layer = createStoreLayer({
      root: join(dir, 'records'),
      keys: createSafeStorageKeyProvider({
        safeStorage: createLockableSafeStorage(),
        dir: join(dir, 'keys'),
      }),
      budgetBytes: 1 << 20,
      clock: () => Date.parse(ISO),
    })
    layer.register(INTENT_STORE_REGISTRATION)
    layer.register(DRAFTS_STORE_REGISTRATION)
    layer.register(PAUSE_STORE_REGISTRATION)
    const opened = await layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
    const drafts = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
    const pause = createPauseStore(opened.store.records(PAUSE_STORE_REGISTRATION.name))
    const payload = enc('v4')
    const checksum = sha256Hex(payload)
    const path = s.path
    const binding: Binding = {
      schema: 2,
      documentId: DOC,
      workspaceId: 'ws_1',
      orgId: 'org_a',
      title: 'Plan.docx',
      filename: 'Plan.docx',
      format: 'docx',
      access: 'edit',
      baseRevision: '41',
      baseVersion: 3,
      baseChecksum: sha256Hex(enc('v3')),
      state: 'dirty',
      minStoreLevel: 2,
      minAppVersion: '0.0.0',
    }
    const bound: BoundDocument = {
      path,
      dir: join(dir, 'wc'),
      deploymentId: 'default',
      userId: 'acc_1',
      key: 'doc_1',
      binding,
    }
    const store = {
      classify: (p: string) =>
        p === path ? { kind: 'bound' as const, doc: bound } : { kind: 'plain' as const },
      lookup: (p: string) => (p === path ? bound : null),
      async write(_dir: string, next: Binding) {
        bound.binding = next
        return true
      },
    }
    const coordinator = new SaveCoordinator({
      store: store as never,
      client: {
        upload: async () => ({ uploadId: 'up_1', checksumSha256: checksum }),
        commit: async () => {
          throw locked(false, 'Minh')
        },
        getDocument: async () => {
          throw new UniworkDocError('not_found')
        },
      },
      isSignedIn: () => true,
      ownsBinding: () => true,
      intents: async () => ({ kind: 'ok' as const, intents }),
      publish: () => undefined,
      now: () => new Date(ISO),
      uuid: () => 'u1',
      readBytes: async () => payload,
      capability: {
        get: async () => ({
          kind: 'ok' as const,
          capabilities: { sync_write: true },
          source: 'default',
        }),
      },
      pause,
      drafts,
      editLockId: () => s.lockId(),
      onCommitEditLocked: (_path, error) => s.markLostFromCommit(error),
    })
    const ended = await coordinator.save(path, { userSave: true })
    expect(ended?.binding.state).toBe('edit_locked')
    expect(s.view().phase).toBe('lost')
    s.dispose()
  })

  it('dispatcher 423 while held marks the real session lost', async () => {
    const t = transport()
    const s = new EditLockSession({
      documentId: DOC,
      path: join(dir, 'Plan.docx'),
      editorId: EDITOR,
      transport: t,
    })
    await s.acquire()
    const layer = createStoreLayer({
      root: join(dir, 'records2'),
      keys: createSafeStorageKeyProvider({
        safeStorage: createLockableSafeStorage(),
        dir: join(dir, 'keys2'),
      }),
      budgetBytes: 1 << 20,
      clock: () => Date.parse(ISO),
    })
    layer.register(INTENT_STORE_REGISTRATION)
    layer.register(DRAFTS_STORE_REGISTRATION)
    layer.register(PAUSE_STORE_REGISTRATION)
    const opened = await layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
    const drafts = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
    const pause = createPauseStore(opened.store.records(PAUSE_STORE_REGISTRATION.name))
    const payload = enc('v4')
    const checksum = sha256Hex(payload)
    const client: QueueClient = {
      async upload() {
        return { uploadId: 'up_1', checksumSha256: checksum }
      },
      async commit() {
        throw locked(false, 'Minh')
      },
      async lookupCommit() {
        return { outcome: 'in_flight' }
      },
    }
    const lock = {
      async acquire() {
        return { kind: 'held' as const, generation: 1 }
      },
      async heartbeat() {
        return true
      },
      async check() {
        return true
      },
      async release() {
        return
      },
    }
    const dispatcher = new QueueDispatcher({
      intents: async () => ({ kind: 'ok' as const, intents }),
      client,
      capability: {
        get: async () => ({
          kind: 'ok' as const,
          capabilities: { sync_write: true },
          source: 'default',
        }),
      },
      lock,
      pause,
      drafts,
      clock: () => Date.parse(ISO),
      random: () => 0.5,
      limits: QUEUE_LIMITS,
      publish: () => undefined,
      uuid: () => 'u1',
      editLockId: () => s.lockId(),
      onCommitEditLocked: (_path, error) => s.markLostFromCommit(error),
    })
    const record: IntentRecordV2 = {
      v: 2,
      intentId: 'intent_1',
      idempotencyKey: 'key_1',
      documentId: DOC,
      orgId: 'org_a',
      workspaceId: 'ws_1',
      baseRevision: '41',
      baseVersion: 3,
      checksum,
      length: payload.byteLength,
      generation: 1,
      state: 'queued',
      attempt: 0,
      createdAt: ISO,
      updatedAt: ISO,
    }
    const doc = {
      key: 'doc_1',
      path: s.path,
      filename: 'Plan.docx' as const,
      format: 'docx' as const,
      orgId: 'org_a',
      workspaceId: 'ws_1',
      baseVersion: 3,
      record,
      payload,
    }
    await dispatcher.enqueue(doc)
    await dispatcher.dispatchAll([doc])
    expect(s.view().phase).toBe('lost')
    s.dispose()
  })
})

describe('EL1B-BE-A7: client commit body has edit_lock_id (already pinned; keep live)', () => {
  it('home-api UniworkEditLockLostReason includes the four extra server reasons', () => {
    const source = readFileSync(join(__dirname, '..', 'src/shared/home-api.ts'), 'utf8')
    expect(source).toMatch(/session_revoked/)
    expect(source).toMatch(/member_deactivated/)
    expect(source).toMatch(/organization_suspended/)
    expect(source).toMatch(/document_deleted/)
  })
})

describe('EL1B-BE-B11: wiring pins around the slice lifelines', () => {
  it('stopEditLock on close and access drop; quit release + cap; resume/focus/online; editHere IPC', () => {
    const service = readFileSync(
      join(__dirname, '..', 'src/main/uniwork-docs/service.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(service).toMatch(/async confirmClose[\s\S]{0,800}stopEditLock\(path, true\)/)
    expect(service).toMatch(/if \(doc\.binding\.access !== 'edit'\) \{[\s\S]{0,80}stopEditLock/)
    expect(service).toMatch(/releaseAllEditLocks\(capMs/)
    expect(service).toMatch(/notePowerResume\(\)/)
    expect(service).toMatch(/noteWindowFocus\(\)/)
    expect(service).toMatch(/async setQueueOnline\(online: boolean\)/)
    expect(service).toMatch(
      /for \(const session of this\.editLocks\.values\(\)\) void session\.wake\(\)/,
    )

    const index = readFileSync(join(__dirname, '..', 'src/main/index.ts'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    expect(index).toMatch(
      /powerMonitor\.on\('resume', \(\) => uniworkDocs\?\.service\.notePowerResume\(\)\)/,
    )
    expect(index).toMatch(
      /app\.on\('browser-window-focus', \(\) => uniworkDocs\?\.service\.noteWindowFocus\(\)\)/,
    )

    const wiring = readFileSync(
      join(__dirname, '..', 'src/main/uniwork-docs/wiring.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(wiring).toMatch(
      /ipcMain\.handle\(UNIWORK_DOC_CHANNELS\.editHere, \(_event, path: unknown\) =>\s*service\.editHere\(path as string\),/,
    )
    const preload = readFileSync(join(__dirname, '..', 'src/preload/index.ts'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    expect(preload).toMatch(/async uniworkEditHere\(path\)/)
    expect(preload).toMatch(/ipcRenderer\.invoke\(UNIWORK_DOC_CHANNELS\.editHere, path\)/)
    expect(UNIWORK_DOC_CHANNELS.editHere).toBe('uniwork-doc:edit-here')
  })
})

describe('list-row parse still drops malformed edit_lock', () => {
  it('does not invent a row lock from junk', () => {
    const page = parseDocumentList(
      {
        documents: [
          {
            id: DOC,
            workspace_id: 'ws_1',
            title: 'Plan.docx',
            updated_at: '2026-10-15T03:12:00Z',
            kind: 'file',
            my_level: 'edit',
            file: {
              filename: 'Plan.docx',
              mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
            edit_lock: 'nope',
          },
        ],
      },
      'ws_1',
    )
    expect(page.documents[0]?.editLock).toBeUndefined()
  })
})
