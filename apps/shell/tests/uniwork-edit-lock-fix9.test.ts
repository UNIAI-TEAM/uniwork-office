import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocStatus } from '../src/shared/home-api'
import type { DocumentDetail } from '../src/main/uniwork-docs/parse'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import type { UniworkDocsClient } from '../src/main/uniwork-docs/client'
import type { EditLockTenure, UniworkEditLockClient } from '../src/main/uniwork-edit-lock/client'
import {
  beginEditLockWillQuit,
  resetEditLockWillQuitForTests,
  runEditLockWillQuit,
} from '../src/main/uniwork-docs/edit-lock-quit'

/**
 * EL-1(b) fix9 (UNI-1645 c): sheets-find-replace e2e hung in app.close().
 * Electron 43 clears its quitting flag only after the will-quit emit returns,
 * and microtasks drain inside that emit; a re-issued app.quit() that runs as a
 * microtask (release already settled) is ignored, so the app never exits.
 * A gate with nothing to release must not hold at all.
 */

const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const LOCK = '01J8X4LOCK0N1P2Q3R4S5T6U7V'
const enc = (text: string) => new TextEncoder().encode(text)
const hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const BYTES = enc('working copy')
const drain = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

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

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-el1b-fix9-'))
})
afterEach(() => {
  vi.useRealTimers()
  resetEditLockWillQuitForTests()
  rmSync(dir, { recursive: true, force: true })
})

function setup(opts: {
  release?: UniworkEditLockClient['release']
  sleep?: (ms: number) => Promise<void>
}) {
  const statuses: UniworkDocStatus[] = []
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
    async acquire() {
      lockCalls.push('R2')
      return TENURE
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
      return detail
    },
    async download() {
      return { bytes: BYTES }
    },
    async upload() {
      return { uploadId: 'up_1', checksumSha256: hex(BYTES), sizeBytes: BYTES.byteLength }
    },
    async commit() {
      return {
        documentId: DOC,
        revision: '10',
        versionId: 'ver_4',
        version: 4,
        checksumSha256: hex(BYTES),
      }
    },
    async createFile() {
      return { id: DOC, workspaceId: 'ws_1', title: 'Plan.docx' }
    },
    async listWorkspaces() {
      return [{ id: 'ws_1', name: 'Team', orgId: 'org_a', slug: 'team', orgSlug: 'acme' }]
    },
  }
  const service = new UniworkDocsService({
    userDataDir: dir,
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
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    openPath: () => true,
    isPathOpen: () => true,
    requestModuleSave: () => false,
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
  return { service, statuses, lockCalls }
}

const macrotask = () => new Promise<void>((resolve) => setImmediate(resolve))
const microtasks = async (n = 20) => {
  for (let i = 0; i < n; i += 1) await Promise.resolve()
}

describe('EL-1(b) fix9: will-quit gate must not re-quit re-entrantly', () => {
  it('re-issues quit on a later macrotask, never inside the will-quit emit', async () => {
    let quits = 0
    const gate = runEditLockWillQuit({
      preventDefault: () => undefined,
      release: async () => undefined,
      quitAgain: () => {
        quits += 1
      },
    })
    await microtasks()
    expect(quits).toBe(0)
    await gate
    await macrotask()
    await macrotask()
    expect(quits).toBe(1)
  })

  it('a release that already failed still re-quits, on a macrotask', async () => {
    let quits = 0
    const gate = runEditLockWillQuit({
      preventDefault: () => undefined,
      release: () => Promise.reject(new Error('boom')),
      quitAgain: () => {
        quits += 1
      },
    })
    await microtasks()
    expect(quits).toBe(0)
    await gate
    await macrotask()
    await macrotask()
    expect(quits).toBe(1)
  })

  it('index.ts re-quits through the deferral helper, not a bare app.quit() in the then', () => {
    const source = readFileSync(join(__dirname, '..', 'src/main/index.ts'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    const will = source.slice(source.indexOf("app.on('will-quit'"))
    const gate = will.slice(0, will.indexOf('stopUniworkAccount'))
    expect(gate).not.toMatch(/\.then\(\(\) => app\.quit\(\)\)/)
    expect(gate).toMatch(/quitAgainAfterWillQuit/)
  })
})

describe('EL-1(b) fix9: hold only when there is something to release', () => {
  it('nothing held or in flight: the gate passes through without preventDefault', () => {
    expect(beginEditLockWillQuit(false)).toBe('passthrough')
    // a later pass with work still gets its one hold
    expect(beginEditLockWillQuit(true)).toBe('hold')
    expect(beginEditLockWillQuit(true)).toBe('passthrough')
  })

  it('runEditLockWillQuit with no work never prevents the quit', async () => {
    const out = await runEditLockWillQuit({
      hasWork: () => false,
      preventDefault: () => {
        throw new Error('must not preventDefault with nothing to release')
      },
      release: async () => {
        throw new Error('must not release')
      },
      quitAgain: () => {
        throw new Error('must not re-quit')
      },
    })
    expect(out).toBe('passthrough')
  })

  it('the service reports work only while a lock or a drop release is outstanding', async () => {
    const h = setup({})
    expect(h.service.hasEditLocksToRelease()).toBe(false)
    const opened = await h.service.openFromServer(DOC)
    await drain()
    expect(h.service.hasEditLocksToRelease()).toBe(true)
    await h.service.releaseAllEditLocks(1500)
    expect(h.service.hasEditLocksToRelease()).toBe(false)
    expect(opened.path).toBeTruthy()
  })

  it('drop-only work (no held session, one in-flight drop release): will-quit holds and joins it (EL1B-BE-R3-14)', async () => {
    const order: string[] = []
    const h = setup({
      release: async () => {
        await drain(50)
        order.push('DELETE')
      },
    })
    const opened = await h.service.openFromServer(DOC)
    await drain()
    // the last window closes: the held session is dropped, its DELETE is in flight
    void h.service.notePathsDropped([opened.path])
    expect((h.service as unknown as { editLocks: Map<string, unknown> }).editLocks.size).toBe(0)
    expect(h.service.hasEditLocksToRelease()).toBe(true)

    const out = await runEditLockWillQuit({
      hasWork: () => h.service.hasEditLocksToRelease(),
      preventDefault: () => order.push('hold'),
      release: (capMs) => h.service.releaseEditLocksOnQuit().then(() => void capMs),
      quitAgain: () => order.push('quit'),
    })
    expect(out).toBe('released')
    expect(order).toEqual(['hold', 'DELETE', 'quit'])
    expect(h.service.hasEditLocksToRelease()).toBe(false)
  })

  it('index.ts asks the service before holding', () => {
    const source = readFileSync(join(__dirname, '..', 'src/main/index.ts'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    const will = source.slice(source.indexOf("app.on('will-quit'"))
    expect(will.slice(0, will.indexOf('stopUniworkAccount'))).toMatch(
      /beginEditLockWillQuit\([^)]*hasEditLocksToRelease/,
    )
  })
})
