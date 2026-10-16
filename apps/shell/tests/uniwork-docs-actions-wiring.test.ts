import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenDialogOptions } from 'electron'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'
import { UPLOAD_EXTENSIONS } from '../src/main/uniwork-docs/formats'

/**
 * G8-17 S18: the shell's own IPC bridge for create / upload / rename / archive
 * / restore and the two pushes (upload progress, renamed). The handlers must
 * exist under the contract's channel names, answer the action-result shape, and
 * the preload must expose the matching methods; a call that fails still answers
 * `{ ok: false, error }` rather than throwing across Electron.
 */

let dir: string
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null

/**
 * the options of every showOpenDialog call (a parent-less call passes one
 * argument), plus the result the next call answers (cancelled by default)
 */
const dialogs = vi.hoisted(() => ({
  open: [] as unknown[],
  result: { canceled: true, filePaths: [] as string[] },
}))

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {
    showOpenDialog: vi.fn(async (...args: unknown[]) => {
      dialogs.open.push(args.at(-1))
      return dialogs.result
    }),
    showMessageBox: vi.fn(async () => ({ response: 1 })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`ENC1${text}`),
    decryptString: (buf: Buffer) => buf.toString().slice(4),
  },
}))

vi.mock('../src/main/uniwork-auth', () => ({
  // the real module runs the caller's request with the live token; a call that
  // reaches the network here must see the same
  authorizedRequest: <T>(call: (token: string) => Promise<T>) => call('tok'),
  setUniworkSignOutHooks: vi.fn(),
  onUniworkAccountStatus: () => () => undefined,
  uniworkAccount: () => ({
    status: () => ({ state: 'signed-in', org: { id: 'org_a', slug: 'acme' } }),
  }),
  uniworkAppChannel: () => 'stable',
  uniworkDeploymentProfile: () => ({
    deploymentId: 'default',
    apiOrigin: 'https://uniwork.example',
    clientId: 'uniwork-office',
    channel: 'stable',
  }),
  uniworkSessionIdentity: () => identity,
}))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-docs-actions-wiring-'))
  identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
  dialogs.open.length = 0
  dialogs.result = { canceled: true, filePaths: [] }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function setup() {
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const sent: Array<{ channel: string; payload: unknown }> = []
  const wc = {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload })
    },
  }
  const notifyPathRenamed = vi.fn()
  const handle = createUniworkDocs(
    {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    } as never,
    {
      shellWindow: () => null,
      shellContents: () => wc as never,
      openPath: () => true,
      refuseLockedPath: () => false,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      reveal: () => undefined,
      lang: () => 'en',
      defaultSaveDir: () => dir,
      openPaths: () => [],
      closePath: async () => true,
      confirmClosePath: async () => true,
      closePathNow: () => undefined,
      aiHistoryPaths: () => [],
      forgetAiHistory: () => undefined,
      notifyPathRenamed,
    },
  )
  return { handle, handlers, notifyPathRenamed, sent }
}

describe('the S18 action IPC', () => {
  it('registers every channel of the contract', async () => {
    const { handlers } = await setup()
    for (const channel of [
      UNIWORK_DOC_CHANNELS.createDocument,
      UNIWORK_DOC_CHANNELS.pickUploadFile,
      UNIWORK_DOC_CHANNELS.uploadDocument,
      UNIWORK_DOC_CHANNELS.cancelUpload,
      UNIWORK_DOC_CHANNELS.renameDocument,
      UNIWORK_DOC_CHANNELS.archiveDocument,
      UNIWORK_DOC_CHANNELS.restoreDocument,
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
    // the pushes are not invoke handlers
    expect(handlers.has(UNIWORK_DOC_CHANNELS.uploadProgress)).toBe(false)
    expect(handlers.has(UNIWORK_DOC_CHANNELS.docRenamed)).toBe(false)
  })

  it('answers the action-result shape, never throwing across IPC', async () => {
    const { handlers } = await setup()
    // a malformed input still answers an error result (the name is empty here)
    const result = await handlers.get(UNIWORK_DOC_CHANNELS.createDocument)!(null, {
      workspaceId: 'ws_1',
      folderId: null,
      name: '   ',
      format: 'docx',
    })
    expect(result).toEqual({ ok: false, error: 'name_empty' })
  })

  it('the upload dialog seam answers null when cancelled', async () => {
    const { handlers } = await setup()
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.pickUploadFile)!(null)).toBeNull()
  })

  it('offers the formats UniWork Office opens, with no all-files filter', async () => {
    const { handlers } = await setup()
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.pickUploadFile)!(null)).toBeNull()
    const options = dialogs.open.at(-1) as OpenDialogOptions
    // one "Documents" filter, whose extensions are the formats table's keys
    expect(options.filters).toHaveLength(1)
    expect(options.filters![0]!.name).toBe('Documents')
    const extensions = options.filters![0]!.extensions
    expect([...extensions].sort()).toEqual([...UPLOAD_EXTENSIONS].sort())
    // the reported gap: the hardcoded list missed markdown and htm
    expect(UPLOAD_EXTENSIONS).toEqual(expect.arrayContaining(['markdown', 'htm']))
    // no "All files": an image picked by mistake would upload but never open here
    expect(options.filters!.some((filter) => filter.extensions.includes('*'))).toBe(false)
  })

  // N-2a: a typed path outside the native filter is still returned to the
  // renderer so uploadDocument stays the single refusal authority and the
  // dialog can surface unsupported_format at the file field instead of
  // silently behaving like a cancel.
  it('passes a picked path through to the renderer regardless of extension', async () => {
    const { handlers } = await setup()
    dialogs.result = { canceled: false, filePaths: [join(dir, 'photo.png')] }
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.pickUploadFile)!(null)).toEqual({
      path: join(dir, 'photo.png'),
      name: 'photo.png',
    })

    dialogs.result = { canceled: false, filePaths: [join(dir, 'Q3 report.docx')] }
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.pickUploadFile)!(null)).toEqual({
      path: join(dir, 'Q3 report.docx'),
      name: 'Q3 report.docx',
    })
  })

  it('refuses every action while signed out, before any request', async () => {
    const { handlers } = await setup()
    identity = null
    expect(
      await handlers.get(UNIWORK_DOC_CHANNELS.renameDocument)!(null, 'doc_1', 'Nope.docx'),
    ).toEqual({ ok: false, error: 'not_signed_in' })
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.archiveDocument)!(null, 'doc_1')).toEqual({
      ok: false,
      error: 'not_signed_in',
    })
    expect(
      await handlers.get(UNIWORK_DOC_CHANNELS.createDocument)!(null, {
        workspaceId: 'ws_1',
        folderId: null,
        name: 'Plan',
        format: 'docx',
      }),
    ).toEqual({ ok: false, error: 'not_signed_in' })
  })

  it('registers the FD-11 folder channels and answers them from the service', async () => {
    const { handlers } = await setup()
    for (const channel of [
      UNIWORK_DOC_CHANNELS.folderTree,
      UNIWORK_DOC_CHANNELS.listChildren,
      UNIWORK_DOC_CHANNELS.searchDocuments,
      UNIWORK_DOC_CHANNELS.createFolder,
      UNIWORK_DOC_CHANNELS.moveDocument,
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
    // the tree-changed notice is a push, never an invoke handler
    expect(handlers.has(UNIWORK_DOC_CHANNELS.treeChanged)).toBe(false)

    // a malformed input still answers a result instead of throwing across IPC
    expect(await handlers.get(UNIWORK_DOC_CHANNELS.folderTree)!(null, 7)).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(
      await handlers.get(UNIWORK_DOC_CHANNELS.createFolder)!(null, {
        workspaceId: 'ws_1',
        parentId: null,
        title: '  ',
      }),
    ).toEqual({ ok: false, error: 'name_empty' })
  })

  it('pushes the tree-changed event once an own folder action landed', async () => {
    const { handlers, sent } = await setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).endsWith('/workspaces/ws_1/documents') && init.method === 'POST') {
          return new Response(
            JSON.stringify({
              document: {
                id: 'fold_9',
                kind: 'folder',
                workspace_id: 'ws_1',
                title: 'Contracts',
                revision: '1',
                updated_at: '2026-10-16T09:00:00Z',
                my_level: 'manage',
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('{}', { status: 404 })
      }),
    )
    try {
      const created = await handlers.get(UNIWORK_DOC_CHANNELS.createFolder)!(null, {
        workspaceId: 'ws_1',
        parentId: null,
        title: 'Contracts',
      })
      expect(created).toMatchObject({ ok: true, value: { id: 'fold_9', kind: 'folder' } })

      // the push is coalesced, so it arrives a window after the action
      await vi.waitFor(() =>
        expect(sent.some((message) => message.channel === UNIWORK_DOC_CHANNELS.treeChanged)).toBe(
          true,
        ),
      )
      const treeChanged = sent.filter(
        (message) => message.channel === UNIWORK_DOC_CHANNELS.treeChanged,
      )
      expect(treeChanged).toHaveLength(1)
      expect(treeChanged[0]!.payload).toEqual({ workspaceId: 'ws_1' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('FD11-C-R1-06: pushes tree-changed over IPC when a feed page (including removal-only) commits through createSyncRuntime', async () => {
    const { handle, sent } = await setup()
    const { createSyncRuntime } = await import('../src/main/uniwork-docs/wiring')
    const { createTreeChangedCoalescer } = await import('../src/main/uniwork-docs/tree-changed')
    const coalescer = createTreeChangedCoalescer({
      emit: (workspaceId) =>
        sent.push({ channel: UNIWORK_DOC_CHANNELS.treeChanged, payload: { workspaceId } }),
    })
    const runtime = createSyncRuntime(handle.service, {
      treeChanged: (workspaceId) => coalescer.notify(workspaceId),
      fetch: async (input) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith('/orgs/org_a/office/capabilities')) {
          return new Response(
            JSON.stringify({
              sync_feed: true,
              sync_write: true,
              offline_library: false,
              ai_uniwork: false,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.pathname.endsWith('/orgs/org_a/workspaces')) {
          return new Response(
            JSON.stringify({ workspaces: [{ id: 'ws_1', name: 'Workspace 1', slug: 'ws-1' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.pathname.endsWith('/workspaces/ws_1/documents/changes')) {
          return new Response(
            JSON.stringify({
              phase: 'feed',
              changes: [],
              feed: [
                {
                  document_id: 'doc_1',
                  change_kind: 'removal',
                  kind: '',
                  revision: 9,
                  current_version: 0,
                  version_id: null,
                  archived: false,
                  removal: 'permission_revoked',
                },
              ],
              has_more: false,
              next_cursor: 'feed:1',
              expires_at: '2026-10-20T00:00:00Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('{}', { status: 404 })
      },
    })

    await runtime.tick()
    await vi.waitFor(() =>
      expect(sent.some((message) => message.channel === UNIWORK_DOC_CHANNELS.treeChanged)).toBe(
        true,
      ),
    )
    expect(sent.filter((message) => message.channel === UNIWORK_DOC_CHANNELS.treeChanged)).toEqual([
      { channel: UNIWORK_DOC_CHANNELS.treeChanged, payload: { workspaceId: 'ws_1' } },
    ])
  })
})
