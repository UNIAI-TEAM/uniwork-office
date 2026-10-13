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
  authorizedRequest: vi.fn(),
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
  const wc = { isDestroyed: () => false, isLoadingMainFrame: () => false, send: () => undefined }
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
  return { handle, handlers, notifyPathRenamed }
}

describe('the S18 action IPC', () => {
  it('registers every channel of the contract', async () => {
    const { handlers } = await setup()
    for (const channel of [
      UNIWORK_DOC_CHANNELS.createDocument,
      UNIWORK_DOC_CHANNELS.pickUploadFile,
      UNIWORK_DOC_CHANNELS.uploadDocument,
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
})
