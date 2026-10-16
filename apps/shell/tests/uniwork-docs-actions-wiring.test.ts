import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'

/**
 * G8-17 S18: the shell's own IPC bridge for create / upload / rename / archive
 * / restore and the two pushes (upload progress, renamed). The handlers must
 * exist under the contract's channel names, answer the action-result shape, and
 * the preload must expose the matching methods; a call that fails still answers
 * `{ ok: false, error }` rather than throwing across Electron.
 */

let dir: string
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
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
      UNIWORK_DOC_CHANNELS.listFolders,
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
})
