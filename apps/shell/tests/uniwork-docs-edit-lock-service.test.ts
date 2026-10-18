import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocStatus } from '../src/shared/home-api'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { parseDocumentList, type DocumentDetail } from '../src/main/uniwork-docs/parse'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import type { UniworkDocsClient } from '../src/main/uniwork-docs/client'
import type { EditLockTenure, UniworkEditLockClient } from '../src/main/uniwork-edit-lock/client'

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

function locked(heldByMe = false): UniworkDocError {
  return new UniworkDocError('edit_locked', {
    status: 423,
    serverCode: 'document_locked',
    editLock: {
      holderName: 'Lan',
      since: '2026-10-15T03:12:00Z',
      expiresAt: '2026-10-15T03:14:00Z',
      heldByMe,
    },
  })
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
  dir = mkdtempSync(join(tmpdir(), 'uw-el1b-svc-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function setup(opts: {
  acquire: UniworkEditLockClient['acquire']
  getDocument?: () => Promise<DocumentDetail>
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
      return opts.acquire(input)
    },
    async heartbeat() {
      lockCalls.push('R3')
      return { lockId: LOCK, expiresAt: 't', serverTime: 't' }
    },
    async release() {
      lockCalls.push('R4')
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
  })
  return { service, statuses, commits, lockCalls }
}

describe('EL-1(b) service: acquire, isReadOnly, Ctrl+S, editHere, EL1A-R2-1', () => {
  it('editable open acquires; 423 other is read-only and Ctrl+S does not save', async () => {
    const h = setup({
      acquire: async () => {
        throw locked(false)
      },
    })
    const opened = await h.service.openFromServer(DOC)
    await drain()
    expect(h.lockCalls).toContain('R2')
    expect(h.service.isReadOnly(opened.path)).toBe(true)
    const status = await h.service.docStatus(opened.path)
    expect(status?.lockSession).toMatchObject({
      phase: 'other',
      holderName: 'Lan',
      since: '2026-10-15T03:12:00Z',
    })
    await h.service.save(opened.path)
    expect(h.commits).toHaveLength(0)
  })

  it('held open is editable and status.lockSession.phase is held', async () => {
    const h = setup({ acquire: async () => TENURE })
    const opened = await h.service.openFromServer(DOC)
    await drain()
    expect(h.service.isReadOnly(opened.path)).toBe(false)
    expect((await h.service.docStatus(opened.path))?.lockSession?.phase).toBe('held')
  })

  it('editHere from other re-acquires (R2)', async () => {
    let n = 0
    const h = setup({
      acquire: async () => {
        n += 1
        if (n === 1) throw locked(false)
        return TENURE
      },
    })
    const opened = await h.service.openFromServer(DOC)
    await drain()
    expect((await h.service.docStatus(opened.path))?.lockSession?.phase).toBe('other')
    const after = await h.service.editHere(opened.path)
    expect(after?.lockSession?.phase).toBe('held')
    expect(h.lockCalls.filter((c) => c === 'R2').length).toBeGreaterThanOrEqual(2)
  })

  it('EL1A-R2-1: a notice ignored while edit_lock is replayed after grant', async () => {
    const head: DocumentDetail = {
      ...detail,
      revision: '10',
      currentVersion: 4,
      file: { ...detail.file, version: 4, versionId: 'ver_4' },
    }
    let n = 0
    const h = setup({
      acquire: async () => {
        n += 1
        if (n === 1) throw locked(false)
        return TENURE
      },
      getDocument: async () => (n >= 2 ? head : detail),
    })
    const opened = await h.service.openFromServer(DOC)
    await drain()
    expect((await h.service.docStatus(opened.path))?.lockSession?.phase).toBe('other')
    h.service.noteEditorDirty(opened.path, true)
    h.service.noteFeedChange(DOC, '10', {
      documentId: DOC,
      kind: 'file',
      revision: '10',
      currentVersion: 4,
      versionId: 'ver_4',
    })
    await drain()
    expect((await h.service.docStatus(opened.path))?.remote).toBeUndefined()
    await h.service.editHere(opened.path)
    await drain(50)
    const status = await h.service.docStatus(opened.path)
    expect(status?.lockSession?.phase).toBe('held')
    expect(status?.remote).toMatchObject({ kind: 'newer-dirty', version: 4 })
  })

  it('releaseAllEditLocks sends R4 for a held session', async () => {
    const h = setup({ acquire: async () => TENURE })
    await h.service.openFromServer(DOC)
    await drain()
    await h.service.releaseAllEditLocks()
    expect(h.lockCalls).toContain('R4')
  })
})

describe('EL-1(b) parse list-row edit_lock', () => {
  const file = {
    filename: 'Plan.docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  const base = {
    id: DOC,
    workspace_id: 'ws_1',
    title: 'Plan.docx',
    updated_at: '2026-10-15T03:12:00Z',
    kind: 'file',
    my_level: 'edit',
    file,
  }

  it('parses holder_name / since / expires_at / held_by_me / offline_hold_until', () => {
    const page = parseDocumentList(
      {
        documents: [
          {
            ...base,
            edit_lock: {
              holder_id: 'u1',
              holder_name: 'Lan',
              since: '2026-10-15T03:12:00Z',
              expires_at: '2026-10-15T03:14:00Z',
              held_by_me: true,
              offline_hold_until: '2026-10-15T11:12:00Z',
            },
          },
        ],
      },
      'ws_1',
    )
    expect(page.documents[0]?.editLock).toEqual({
      holderName: 'Lan',
      since: '2026-10-15T03:12:00Z',
      expiresAt: '2026-10-15T03:14:00Z',
      heldByMe: true,
      offlineHoldUntil: '2026-10-15T11:12:00Z',
    })
  })

  it('omits editLock when the server sent none; drops a malformed object', () => {
    const bare = parseDocumentList({ documents: [base] }, 'ws_1')
    expect(bare.documents[0]?.editLock).toBeUndefined()
    const bad = parseDocumentList({ documents: [{ ...base, edit_lock: 'nope' }] }, 'ws_1')
    expect(bad.documents[0]?.editLock).toBeUndefined()
  })
})
