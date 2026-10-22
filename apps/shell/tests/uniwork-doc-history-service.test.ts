import { describe, expect, it, vi } from 'vitest'
import type { DocHistoryClient } from '../src/main/uniwork-docs/doc-history-client'
import {
  createDocHistoryService,
  docHistoryErrorOf,
  isShellMainFrame,
  registerDocHistoryIpc,
  type DocHistoryServiceDeps,
} from '../src/main/uniwork-docs/doc-history-service'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { DOC_HISTORY_CHANNELS } from '../src/shared/doc-history-api'
import { versionOf } from './doc-history-fake-bridge'

/**
 * UNI-2077: the service behind `uniwork-doc-history:*`. It checks what the
 * renderer sends before anything leaves, answers a coded result (never a
 * rejection), adds the open tab's edit lock and base to a restore, tells the
 * open tab about the restored revision, and maps the server's refusals the way
 * the web's sheets read them.
 */

const KEY = 'key_12345678'

function setup(
  overrides: Partial<DocHistoryServiceDeps> = {},
  client: Partial<DocHistoryClient> = {},
) {
  const api = {
    listVersions: vi.fn<DocHistoryClient['listVersions']>(async () => ({
      versions: [versionOf()],
      next_cursor: null,
    })),
    getDocumentHead: vi.fn<DocHistoryClient['getDocumentHead']>(async () => ({
      kind: 'file',
      revision: '42',
    })),
    getVersion: vi.fn<DocHistoryClient['getVersion']>(async (_id, no) =>
      versionOf({ version: no }),
    ),
    createVersion: vi.fn<DocHistoryClient['createVersion']>(async () => versionOf({ version: 4 })),
    restoreVersion: vi.fn<DocHistoryClient['restoreVersion']>(async (id, no) => ({
      document: { id, kind: 'file', title: 'T', revision: '43', current_version: 4 },
      version: versionOf({ id: 'ver_4', version: 4, reason: 'restore', restored_from: no }),
    })),
    listAccessLogs: vi.fn<DocHistoryClient['listAccessLogs']>(async () => ({
      logs: [],
      next_cursor: null,
    })),
    ...client,
  } satisfies DocHistoryClient
  const deps = {
    client: vi.fn(() => api),
    isSignedIn: vi.fn(() => true),
    openCopy: vi.fn<DocHistoryServiceDeps['openCopy']>(async () => null),
    noteRestored: vi.fn<DocHistoryServiceDeps['noteRestored']>(),
    openVersionView: vi.fn<DocHistoryServiceDeps['openVersionView']>(async () => ({
      path: '/copies/doc_1@v2/a.docx',
      title: 'a',
    })),
    downloadVersion: vi.fn<DocHistoryServiceDeps['downloadVersion']>(async () => ({
      path: '/home/u/Downloads/a.docx',
    })),
    ...overrides,
  }
  return { service: createDocHistoryService(deps), deps, api }
}

describe('versions / version / accessLogs', () => {
  it('pages the versions with the web page size by default', async () => {
    const { service, api } = setup()
    const out = await service.versions({ documentId: 'doc_1' })
    expect(out).toMatchObject({ ok: true, value: { next_cursor: null } })
    expect(api.listVersions).toHaveBeenCalledWith('doc_1', { limit: 50 })
    await service.versions({ documentId: 'doc_1', cursor: 'c2', limit: 10 })
    expect(api.listVersions).toHaveBeenLastCalledWith('doc_1', { cursor: 'c2', limit: 10 })
  })

  it('reads one version', async () => {
    const { service, api } = setup()
    expect(await service.version({ documentId: 'doc_1', versionNo: 2 })).toMatchObject({
      ok: true,
      value: { version: 2 },
    })
    expect(api.getVersion).toHaveBeenCalledWith('doc_1', 2)
  })

  it('passes the action filter, and no action for an empty one', async () => {
    const { service, api } = setup()
    await service.accessLogs({ documentId: 'doc_1', action: 'link_view' })
    expect(api.listAccessLogs).toHaveBeenLastCalledWith('doc_1', { limit: 50, action: 'link_view' })
    await service.accessLogs({ documentId: 'doc_1', action: '' })
    expect(api.listAccessLogs).toHaveBeenLastCalledWith('doc_1', { limit: 50 })
  })

  it('refuses bad input before the client is touched', async () => {
    const { service, deps } = setup()
    const bad = { ok: false, error: 'invalid_request' }
    expect(await service.versions(null as never)).toEqual(bad)
    expect(await service.versions({ documentId: '' })).toEqual(bad)
    expect(await service.versions({ documentId: 'doc_1', limit: 0 })).toEqual(bad)
    expect(await service.version({ documentId: 'doc_1', versionNo: 0 })).toEqual(bad)
    expect(await service.accessLogs({ documentId: 'doc_1', action: 'edit' as never })).toEqual(bad)
    expect(await service.createVersion({ documentId: 'doc_1', label: 'x'.repeat(201) })).toEqual(
      bad,
    )
    expect(await service.createVersion({ documentId: 'doc_1', idempotencyKey: 'short' })).toEqual(
      bad,
    )
    expect(await service.restore({ documentId: 'doc_1', versionNo: -1 })).toEqual(bad)
    expect(await service.restore({ documentId: 'doc_1', versionNo: 1, baseRevision: 'x' })).toEqual(
      bad,
    )
    expect(deps.client).not.toHaveBeenCalled()
  })

  it('is not_signed_in without a session, before any request', async () => {
    const { service, deps } = setup({ isSignedIn: vi.fn(() => false) })
    expect(await service.versions({ documentId: 'doc_1' })).toEqual({
      ok: false,
      error: 'not_signed_in',
    })
    expect(deps.client).not.toHaveBeenCalled()
  })
})

describe('createVersion', () => {
  it('trims the label, drops an empty one, and passes the renderer key', async () => {
    const { service, api } = setup()
    await service.createVersion({
      documentId: 'doc_1',
      label: '  Gửi khách  ',
      idempotencyKey: KEY,
    })
    expect(api.createVersion).toHaveBeenLastCalledWith('doc_1', { label: 'Gửi khách' }, KEY)
    await service.createVersion({ documentId: 'doc_1', label: '   ' })
    const [, body, key] = api.createVersion.mock.calls[1]!
    expect(body).toEqual({})
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,128}$/)
  })

  it('409 document_version_unchanged is version_unchanged', async () => {
    const { service } = setup(
      {},
      {
        createVersion: vi.fn(async () => {
          throw new UniworkDocError('server_error', {
            serverCode: 'document_version_unchanged',
            status: 409,
          })
        }),
      },
    )
    expect(await service.createVersion({ documentId: 'doc_1' })).toEqual({
      ok: false,
      error: 'version_unchanged',
      status: 409,
    })
  })
})

describe('restore', () => {
  it('adds the open tab edit lock and base revision, then tells the tab about the new revision', async () => {
    const { service, api, deps } = setup({
      openCopy: vi.fn(async () => ({ editLockId: 'lock_1', baseRevision: '40' })),
    })
    const out = await service.restore({ documentId: 'doc_1', versionNo: 2, idempotencyKey: KEY })
    expect(out).toMatchObject({ ok: true, value: { version: { reason: 'restore' } } })
    expect(api.restoreVersion).toHaveBeenCalledWith('doc_1', 2, {
      idempotencyKey: KEY,
      baseRevision: '40',
      editLockId: 'lock_1',
    })
    expect(api.getDocumentHead).not.toHaveBeenCalled()
    expect(deps.noteRestored).toHaveBeenCalledWith({
      documentId: 'doc_1',
      revision: '43',
      version: 4,
      versionId: 'ver_4',
    })
  })

  it('the renderer base wins over the open tab base', async () => {
    const { service, api } = setup({
      openCopy: vi.fn(async () => ({ editLockId: null, baseRevision: '40' })),
    })
    await service.restore({
      documentId: 'doc_1',
      versionNo: 2,
      baseRevision: '41',
      idempotencyKey: KEY,
    })
    expect(api.restoreVersion).toHaveBeenCalledWith('doc_1', 2, {
      idempotencyKey: KEY,
      baseRevision: '41',
    })
  })

  it('not open here: a file takes the server current revision, a page sends no base', async () => {
    const { service, api } = setup()
    await service.restore({ documentId: 'doc_1', versionNo: 2, idempotencyKey: KEY })
    expect(api.restoreVersion).toHaveBeenLastCalledWith('doc_1', 2, {
      idempotencyKey: KEY,
      baseRevision: '42',
    })
    api.getDocumentHead.mockResolvedValueOnce({ kind: 'page', revision: '7' })
    await service.restore({ documentId: 'doc_1', versionNo: 2, idempotencyKey: KEY })
    expect(api.restoreVersion).toHaveBeenLastCalledWith('doc_1', 2, { idempotencyKey: KEY })
  })

  it('a refusal tells the open tab nothing', async () => {
    const { service, deps } = setup(
      {},
      {
        restoreVersion: vi.fn(async () => {
          throw new UniworkDocError('conflict', { status: 409, currentRevision: '50' })
        }),
      },
    )
    expect(await service.restore({ documentId: 'doc_1', versionNo: 2 })).toEqual({
      ok: false,
      error: 'conflict',
      status: 409,
      currentRevision: '50',
    })
    expect(deps.noteRestored).not.toHaveBeenCalled()
  })

  it('423 is edit_locked with the holder (no offline hold detail)', async () => {
    const { service } = setup(
      {},
      {
        restoreVersion: vi.fn(async () => {
          throw new UniworkDocError('edit_locked', {
            status: 423,
            holderId: 'u_9',
            editLock: {
              holderName: 'Bình',
              since: null,
              expiresAt: '2099-01-01T00:00:00Z',
              heldByMe: false,
              offlineHoldUntil: 'x',
            },
          })
        }),
      },
    )
    expect(await service.restore({ documentId: 'doc_1', versionNo: 2 })).toEqual({
      ok: false,
      error: 'edit_locked',
      status: 423,
      editLock: {
        holderName: 'Bình',
        since: null,
        expiresAt: '2099-01-01T00:00:00Z',
        heldByMe: false,
      },
    })
  })
})

describe('openVersion', () => {
  it('opens the read-only copy of a file version', async () => {
    const { service, deps } = setup()
    expect(await service.openVersion({ documentId: 'doc_1', versionNo: 2 })).toEqual({
      ok: true,
      value: { path: '/copies/doc_1@v2/a.docx', title: 'a' },
    })
    expect(deps.openVersionView).toHaveBeenCalledWith('doc_1', 2)
  })

  it('a page version is unsupported_format and opens nothing', async () => {
    const { service, deps } = setup(
      {},
      { getVersion: vi.fn(async () => versionOf({ kind: 'page', version: 2 })) },
    )
    expect(await service.openVersion({ documentId: 'doc_1', versionNo: 2 })).toEqual({
      ok: false,
      error: 'unsupported_format',
    })
    expect(deps.openVersionView).not.toHaveBeenCalled()
  })
})

describe('downloadVersion', () => {
  it('saves the version under the suggested name', async () => {
    const { service, deps } = setup()
    expect(
      await service.downloadVersion({ documentId: 'doc_1', versionNo: 2, suggestedName: 'a.docx' }),
    ).toEqual({ ok: true, value: { path: '/home/u/Downloads/a.docx' } })
    expect(deps.downloadVersion).toHaveBeenCalledWith('doc_1', 2, 'a.docx')
  })

  it('a canceled dialog is dialog_canceled; a disk failure is write_failed; a refused target keeps its code', async () => {
    const canceled = setup({ downloadVersion: vi.fn(async () => null) })
    expect(await canceled.service.downloadVersion({ documentId: 'doc_1', versionNo: 2 })).toEqual({
      ok: false,
      error: 'dialog_canceled',
    })
    const disk = setup({
      downloadVersion: vi.fn(async () => {
        throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })
      }),
    })
    expect(await disk.service.downloadVersion({ documentId: 'doc_1', versionNo: 2 })).toEqual({
      ok: false,
      error: 'write_failed',
    })
    const target = setup({ downloadVersion: vi.fn(async () => 'forbidden_target' as const) })
    expect(await target.service.downloadVersion({ documentId: 'doc_1', versionNo: 2 })).toEqual({
      ok: false,
      error: 'forbidden_target',
    })
  })
})

describe('docHistoryErrorOf', () => {
  const of = (code: ConstructorParameters<typeof UniworkDocError>[0], extra = {}) =>
    docHistoryErrorOf(new UniworkDocError(code, extra))

  it('maps the server verdicts the sheets name', () => {
    expect(of('forbidden', { status: 403 })).toEqual({ ok: false, error: 'forbidden', status: 403 })
    expect(of('permission_revoked', { status: 403 })).toMatchObject({ error: 'forbidden' })
    expect(of('not_found', { status: 404 })).toMatchObject({ error: 'not_found' })
    expect(of('deleted', { status: 410 })).toMatchObject({ error: 'deleted', status: 410 })
    expect(of('document_archived', { status: 403 })).toMatchObject({ error: 'document_archived' })
    expect(of('document_deleted')).toMatchObject({ error: 'document_deleted' })
    expect(of('forbidden', { serverCode: 'document_shelved', status: 409 })).toMatchObject({
      error: 'document_shelved',
    })
    expect(of('server_error', { status: 409, lostReason: 'expired' })).toMatchObject({
      error: 'edit_lock_lost',
    })
  })

  it('keeps the transport codes and marks a throttle retryable', () => {
    expect(of('network')).toEqual({ ok: false, error: 'network' })
    expect(of('session_expired', { status: 401 })).toMatchObject({ error: 'session_expired' })
    expect(of('server_error', { status: 429 })).toEqual({
      ok: false,
      error: 'server_error',
      status: 429,
      retryable: true,
    })
    expect(of('server_error', { serverCode: 'invalid_input' })).toEqual({
      ok: false,
      error: 'invalid_request',
    })
    expect(docHistoryErrorOf(new Error('boom'))).toEqual({ ok: false, error: 'server_error' })
  })
})

describe('registerDocHistoryIpc', () => {
  it('answers the shell main frame only', async () => {
    const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>()
    const ipc = { handle: vi.fn((ch: string, fn: never) => void handlers.set(ch, fn)) }
    const { service } = setup()
    const shell = { id: 'shell' }
    registerDocHistoryIpc(ipc as never, service, (event) => event === shell)
    expect([...handlers.keys()].sort()).toEqual(Object.values(DOC_HISTORY_CHANNELS).sort())
    const call = handlers.get(DOC_HISTORY_CHANNELS.versions)!
    expect(await call(shell, { documentId: 'doc_1' })).toMatchObject({ ok: true })
    expect(await call({ id: 'editor' }, { documentId: 'doc_1' })).toEqual({
      ok: false,
      error: 'forbidden',
    })
  })
})

describe('isShellMainFrame', () => {
  const mainFrame = { frame: 'main' }
  const shell = { isDestroyed: () => false, mainFrame }

  it('is the shell webContents main frame only', () => {
    expect(isShellMainFrame({ sender: shell, senderFrame: mainFrame }, shell)).toBe(true)
    expect(isShellMainFrame({ sender: shell, senderFrame: { frame: 'sub' } }, shell)).toBe(false)
    const editor = { isDestroyed: () => false, mainFrame }
    expect(isShellMainFrame({ sender: editor, senderFrame: mainFrame }, shell)).toBe(false)
    expect(isShellMainFrame({ sender: shell, senderFrame: mainFrame }, null)).toBe(false)
    const gone = { isDestroyed: () => true, mainFrame }
    expect(isShellMainFrame({ sender: gone, senderFrame: mainFrame }, gone)).toBe(false)
    expect(isShellMainFrame(undefined, shell)).toBe(false)
  })
})
