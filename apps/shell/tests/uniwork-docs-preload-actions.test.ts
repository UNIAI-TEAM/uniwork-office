/**
 * @vitest-environment jsdom
 */
/**
 * The shell preload's S18 action bridge (contract G8-17 §2/§3). Every action
 * reply main sends is checked here before the renderer sees it: the renderer
 * dereferences `value.title` and `error` directly, so a result of the wrong
 * shape must become `malformed_response` (R1-9) exactly as the other pushes are
 * validated. The upload cancel (FX10) names its upload through the channel and
 * upload-progress events carry that id, so a stale dialog's event is dropped.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'

interface ActionsBridge {
  uniworkRenameDocument(documentId: string, name: string): Promise<unknown>
  uniworkArchiveDocument(documentId: string): Promise<unknown>
  uniworkCancelUploadDocument(uploadId: string): Promise<void>
  onUniworkUploadProgress(cb: (event: unknown) => void): () => void
  uniworkFolderTree(workspaceId: string): Promise<unknown>
  uniworkListChildren(q: unknown): Promise<unknown>
  uniworkSearchDocuments(q: unknown): Promise<unknown>
  uniworkCreateFolder(i: unknown): Promise<unknown>
  uniworkMoveDocument(i: unknown): Promise<unknown>
  onUniworkTreeChanged(cb: (event: unknown) => void): () => void
}

/**
 * The preload with an electron mock, exposing what it hands to the renderer.
 * `reply` is what every `invoke` resolves with (main's answer).
 */
async function loadBridge(reply: unknown) {
  vi.resetModules()
  const handlers = new Map<string, (event: unknown, raw: unknown) => void>()
  const invoked: Array<{ channel: string; args: unknown[] }> = []
  const exposed: Record<string, unknown> = {}
  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => void (exposed[key] = value),
    },
    ipcRenderer: {
      on: (channel: string, cb: (event: unknown, raw: unknown) => void) => {
        handlers.set(channel, cb)
      },
      invoke: async (channel: string, ...args: unknown[]) => {
        invoked.push({ channel, args })
        return reply
      },
      send: () => undefined,
      removeListener: (channel: string, cb: unknown) => {
        if (handlers.get(channel) === cb) handlers.delete(channel)
      },
    },
    webUtils: { getPathForFile: () => '' },
  }))
  await import('../src/preload/index')
  return { bridge: exposed.aiOffice as unknown as ActionsBridge, invoked, handlers }
}

afterEach(() => {
  vi.doUnmock('electron')
  vi.resetModules()
})

describe('the S18 action result crossing the preload (R1-9)', () => {
  it('answers malformed_response for a result of neither shape', async () => {
    const bad: unknown[] = [
      undefined,
      null,
      'x',
      7,
      { ok: true },
      { ok: true, value: 7 },
      { ok: true, value: null },
      { ok: true, value: [] },
      { ok: false },
      { ok: false, error: 7 },
      { ok: false, error: '' },
      { ok: 'yes', value: { id: 'doc_1' } },
    ]
    for (const reply of bad) {
      const { bridge } = await loadBridge(reply)
      expect(await bridge.uniworkRenameDocument('doc_1', 'A.docx')).toEqual({
        ok: false,
        error: 'malformed_response',
      })
    }
  })

  it('passes both well-formed branches through unchanged', async () => {
    const value = { ok: true, value: { id: 'doc_1', title: 'A.docx' } }
    const created = await loadBridge(value)
    expect(await created.bridge.uniworkRenameDocument('doc_1', 'A.docx')).toEqual(value)

    // a field error and a cancelled upload are ordinary strings main may answer
    for (const error of ['forbidden', 'name_too_long', 'upload_cancelled']) {
      const denied = await loadBridge({ ok: false, error })
      expect(await denied.bridge.uniworkArchiveDocument('doc_1')).toEqual({ ok: false, error })
    }
  })
})

describe('the upload cancel and progress of the preload (FX10)', () => {
  it('invokes the cancel channel with the id, never without one', async () => {
    const { bridge, invoked } = await loadBridge(undefined)
    const cancels = () =>
      invoked.filter((call) => call.channel === UNIWORK_DOC_CHANNELS.cancelUpload)
    await bridge.uniworkCancelUploadDocument('up-1')
    expect(cancels()).toEqual([{ channel: UNIWORK_DOC_CHANNELS.cancelUpload, args: ['up-1'] }])
    // a missing or empty id names no upload: nothing is invoked
    await bridge.uniworkCancelUploadDocument('')
    await bridge.uniworkCancelUploadDocument(undefined as unknown as string)
    expect(cancels()).toHaveLength(1)
  })

  it('drops an upload-progress push without an uploadId', async () => {
    const { bridge, handlers } = await loadBridge(undefined)
    const seen: unknown[] = []
    bridge.onUniworkUploadProgress((event) => seen.push(event))
    const push = handlers.get(UNIWORK_DOC_CHANNELS.uploadProgress)!
    // the shape before FX10 (no uploadId) belongs to no upload: dropped
    push({}, { path: 'C:/Q4.docx', loaded: 0, total: 10 })
    push({}, { uploadId: '', path: 'C:/Q4.docx', loaded: 0, total: 10 })
    push({}, { uploadId: 'up-1', path: 'C:/Q4.docx', loaded: 0, total: 10 })
    expect(seen).toEqual([{ uploadId: 'up-1', path: 'C:/Q4.docx', loaded: 0, total: 10 }])
  })
})

describe('the FD-11 folder bridge members (FD11-A-R1-03)', () => {
  it('invokes each of the five folder channels with its argument and guards the reply', async () => {
    const okReply = { ok: true, value: { id: 'fold_1' } }
    const { bridge, invoked } = await loadBridge(okReply)
    invoked.length = 0

    expect(await bridge.uniworkFolderTree('ws_1')).toEqual(okReply)
    expect(await bridge.uniworkListChildren({ workspaceId: 'ws_1', parentId: null })).toEqual(
      okReply,
    )
    expect(
      await bridge.uniworkSearchDocuments({ workspaceId: 'ws_1', query: 'Q4', kind: 'all' }),
    ).toEqual(okReply)
    expect(
      await bridge.uniworkCreateFolder({
        workspaceId: 'ws_1',
        parentId: 'fold_1',
        title: 'Specs',
      }),
    ).toEqual(okReply)
    expect(await bridge.uniworkMoveDocument({ documentId: 'doc_1', parentId: 'fold_1' })).toEqual(
      okReply,
    )

    expect(invoked).toEqual([
      { channel: UNIWORK_DOC_CHANNELS.folderTree, args: ['ws_1'] },
      {
        channel: UNIWORK_DOC_CHANNELS.listChildren,
        args: [{ workspaceId: 'ws_1', parentId: null }],
      },
      {
        channel: UNIWORK_DOC_CHANNELS.searchDocuments,
        args: [{ workspaceId: 'ws_1', query: 'Q4', kind: 'all' }],
      },
      {
        channel: UNIWORK_DOC_CHANNELS.createFolder,
        args: [{ workspaceId: 'ws_1', parentId: 'fold_1', title: 'Specs' }],
      },
      {
        channel: UNIWORK_DOC_CHANNELS.moveDocument,
        args: [{ documentId: 'doc_1', parentId: 'fold_1' }],
      },
    ])
  })

  it('guards onUniworkTreeChanged with asUniworkTreeChanged and removes the subscriber on unsubscribe', async () => {
    const { bridge, handlers } = await loadBridge(undefined)
    const seen: unknown[] = []
    const off = bridge.onUniworkTreeChanged((event) => seen.push(event))
    const push = handlers.get(UNIWORK_DOC_CHANNELS.treeChanged)!

    // malformed payloads without a non-empty string workspaceId are dropped
    push({}, null)
    push({}, {})
    push({}, { workspaceId: '' })
    push({}, { workspaceId: 42 })
    push({}, { workspaceId: 'ws_1', extra: 'ignored' })
    expect(seen).toEqual([{ workspaceId: 'ws_1' }])

    // unsubscribing stops further deliveries
    off()
    push({}, { workspaceId: 'ws_2' })
    expect(seen).toEqual([{ workspaceId: 'ws_1' }])
  })
})
