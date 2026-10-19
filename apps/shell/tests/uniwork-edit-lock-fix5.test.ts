import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocStatus } from '../src/shared/home-api'
import type { DocumentDetail } from '../src/main/uniwork-docs/parse'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import type { UniworkDocsClient } from '../src/main/uniwork-docs/client'
import type { EditLockTenure, UniworkEditLockClient } from '../src/main/uniwork-edit-lock/client'
import {
  EDIT_LOCK_QUIT_CAP_MS,
  resetEditLockWillQuitForTests,
  runEditLockWillQuit,
} from '../src/main/uniwork-docs/edit-lock-quit'

/**
 * EL-1(b) fix5 BE (UNI-1645 c) EL1B-BE-R2-1: will-quit joins in-flight
 * notePathsDropped releases under the same 1.5 s cap.
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
  dir = mkdtempSync(join(tmpdir(), 'uw-el1b-fix5-'))
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

function dropReleaseSet(service: UniworkDocsService): Set<unknown> | undefined {
  return (service as unknown as { inFlightDropReleases?: Set<unknown> }).inFlightDropReleases
}

describe('EL1B-BE-R2-1: will-quit joins in-flight drop releases', () => {
  it('last-window close with a held lock: DELETE finishes before token teardown', async () => {
    const order: string[] = []
    const h = setup({
      release: async () => {
        await drain(50)
        order.push('DELETE')
      },
    })
    const opened = await h.service.openFromServer(DOC)
    await drain()
    expect((await h.service.docStatus(opened.path))?.lockSession?.phase).toBe('held')

    // production: win.on('closed') fire-and-forgets the drop, then will-quit
    void h.service.notePathsDropped([opened.path])
    await runEditLockWillQuit({
      preventDefault: () => undefined,
      release: async (capMs) => {
        expect(capMs).toBe(EDIT_LOCK_QUIT_CAP_MS)
        await h.service.releaseAllEditLocks(capMs)
      },
      quitAgain: () => undefined,
    })
    order.push('stopUniworkAccount')
    await drain(80)
    expect(order).toEqual(['DELETE', 'stopUniworkAccount'])
    expect(h.lockCalls.filter((c) => c === 'R4')).toEqual(['R4'])
  })

  it('hanging DELETE from a drop: will-quit waits ~cap then proceeds', async () => {
    const h = setup({
      release: () => new Promise(() => undefined),
    })
    const opened = await h.service.openFromServer(DOC)
    await drain()
    vi.useFakeTimers()
    void h.service.notePathsDropped([opened.path])
    const order: string[] = []
    const first = runEditLockWillQuit({
      preventDefault: () => undefined,
      release: async (capMs) => {
        expect(capMs).toBe(EDIT_LOCK_QUIT_CAP_MS)
        await h.service.releaseAllEditLocks(capMs)
      },
      quitAgain: () => order.push('quit'),
    })
    await Promise.resolve()
    expect(order).toEqual([])
    await vi.advanceTimersByTimeAsync(EDIT_LOCK_QUIT_CAP_MS - 1)
    expect(order).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    // fix9: quit is re-issued on a later macrotask (fake setImmediate)
    await vi.advanceTimersByTimeAsync(1)
    await first
    expect(order).toEqual(['quit'])
  })

  it('no held or in-flight work: will-quit does not wait', async () => {
    const h = setup({})
    vi.useFakeTimers()
    const order: string[] = []
    const gate = runEditLockWillQuit({
      preventDefault: () => undefined,
      release: async (capMs) => {
        await h.service.releaseAllEditLocks(capMs)
      },
      quitAgain: () => order.push('quit'),
    })
    // fix9: quit is re-issued on a later macrotask (fake setImmediate)
    await vi.advanceTimersByTimeAsync(0)
    await gate
    expect(order).toEqual(['quit'])
  })

  it('tracking set is empty after a drop release settles', async () => {
    const h = setup({
      release: async () => {
        await drain(40)
      },
    })
    const opened = await h.service.openFromServer(DOC)
    await drain()
    const dropped = h.service.notePathsDropped([opened.path])
    await Promise.resolve()
    expect(dropReleaseSet(h.service)?.size).toBe(1)
    await dropped
    expect(dropReleaseSet(h.service)?.size).toBe(0)
  })
})
