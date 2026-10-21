import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenDialogOptions } from 'electron'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'
import type {
  FolderUploadRunnerPort,
  FolderUploadRunOptions,
} from '../src/main/uniwork-docs/folder-upload/runner-port'
import type { PreflightSDO } from '../src/shared/folder-upload-api'

/**
 * UNI-2052 FU-C: the folder-upload IPC registered by the docs wiring. The
 * handlers must exist under the contract's channel names, validate what the
 * renderer sends, keep absolute paths in main, and push progress to the window
 * that started the run. The batch runner (FU-B) is injected through the wiring.
 */

let dir: string

const dialogs = vi.hoisted(() => ({
  open: [] as OpenDialogOptions[],
  result: { canceled: true, filePaths: [] as string[] },
}))

vi.mock('electron', () => ({
  app: { getPath: () => dir, configureHostResolver: () => undefined },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {
    showOpenDialog: vi.fn(async (...args: unknown[]) => {
      dialogs.open.push(args.at(-1) as OpenDialogOptions)
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
  session: {
    defaultSession: {
      setSpellCheckerDictionaryDownloadURL: () => undefined,
      getSpellCheckerLanguages: () => ['en-US'],
      setSpellCheckerLanguages: () => undefined,
      isSpellCheckerEnabled: () => true,
      setSpellCheckerEnabled: () => undefined,
    },
  },
}))

vi.mock('../src/main/uniwork-auth', () => ({
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
  uniworkSessionIdentity: () => ({
    accountId: 'acc_1',
    deviceSessionId: 'dev_1',
    deploymentId: 'default',
  }),
}))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-batch-upload-wiring-'))
  dialogs.open.length = 0
  dialogs.result = { canceled: true, filePaths: [] }
  stubServer()
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** a fake UniWork server: one workspace with My Folder and a "Contracts" folder */
function stubServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/documents/tree')) {
        return json(200, {
          documents: [
            {
              id: 'fold_my',
              kind: 'folder',
              title: 'My Folder',
              parent_id: null,
              position: 0,
              children: [],
              system_kind: 'my_folder',
            },
            {
              id: 'fold_1',
              kind: 'folder',
              title: 'Contracts',
              parent_id: null,
              position: 1,
              children: [],
            },
          ],
        })
      }
      if (url.pathname.endsWith('/documents/my-folder') && init?.method === 'POST') {
        return json(200, {
          document: {
            id: 'fold_my',
            kind: 'folder',
            workspace_id: 'ws_1',
            title: 'My Folder',
            updated_at: '2026-10-21T09:00:00Z',
            my_level: 'manage',
            system_kind: 'my_folder',
          },
        })
      }
      return json(404, { error: { code: 'not_found', message: 'x' } })
    }),
  )
}

const LIMITS = {
  maxFiles: 100,
  maxFolders: 50,
  maxTotalBytes: 10_000_000,
  maxDepth: 5,
  perFileMaxBytes: 1_000_000,
}

function fakePort() {
  const started: FolderUploadRunOptions[] = []
  const calls: string[] = []
  const port: FolderUploadRunnerPort = {
    start: (_plan, opts) => {
      started.push(opts)
      return { runId: opts.runId }
    },
    cancel: (runId) => void calls.push(`cancel:${runId}`),
    retry: (runId) => void calls.push(`retry:${runId}`),
    dismiss: (runId) => void calls.push(`dismiss:${runId}`),
  }
  return { port, started, calls }
}

async function setup(withRunner = true) {
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const shellSent: Array<{ channel: string; payload: unknown }> = []
  const senderSent: Array<{ channel: string; payload: unknown }> = []
  const runner = fakePort()
  createUniworkDocs(
    {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    } as never,
    {
      shellWindow: () => null,
      shellContents: () =>
        ({
          isDestroyed: () => false,
          isLoadingMainFrame: () => false,
          send: (channel: string, payload: unknown) => shellSent.push({ channel, payload }),
        }) as never,
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
      notifyPathRenamed: vi.fn(),
      ...(withRunner ? { folderUpload: { getLimits: () => LIMITS, runner: runner.port } } : {}),
    },
  )
  const sender = {
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => senderSent.push({ channel, payload }),
  }
  const call = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers.get(channel)
    expect(handler, `handler for ${channel}`).toBeTypeOf('function')
    return handler!({ sender }, ...args)
  }
  return { call, handlers, runner, shellSent, senderSent }
}

function tree(...files: string[]): string {
  const root = join(dir, 'Case')
  for (const rel of files) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, 'x'.repeat(10))
  }
  return root
}

const C = UNIWORK_DOC_CHANNELS

describe('the folder-upload channels', () => {
  it('names the six invoke channels and the pushed progress channel as the contract does', () => {
    expect(C.batchUploadPick).toBe('uniwork-doc:batch-upload-pick')
    expect(C.batchUploadPreflight).toBe('uniwork-doc:batch-upload-preflight')
    expect(C.batchUploadStart).toBe('uniwork-doc:batch-upload-start')
    expect(C.batchUploadCancel).toBe('uniwork-doc:batch-upload-cancel')
    expect(C.batchUploadRetry).toBe('uniwork-doc:batch-upload-retry')
    expect(C.batchUploadDismiss).toBe('uniwork-doc:batch-upload-dismiss')
    expect(C.batchUploadProgress).toBe('uniwork-doc:batch-upload-progress')
    expect(C.batchUploadFoldersAvailable).toBe('uniwork-doc:batch-upload-folders-available')
  })

  it('registers a handler for each invoke channel', async () => {
    const { handlers } = await setup()
    for (const channel of [
      C.batchUploadPick,
      C.batchUploadPreflight,
      C.batchUploadStart,
      C.batchUploadCancel,
      C.batchUploadRetry,
      C.batchUploadDismiss,
      C.batchUploadFoldersAvailable,
    ]) {
      expect(handlers.has(channel), channel).toBe(true)
    }
    // the progress channel is a push, never invoked
    expect(handlers.has(C.batchUploadProgress)).toBe(false)
  })
})

describe('foldersAvailable', () => {
  it('is true when the limits getter has a folder_upload block', async () => {
    const { call } = await setup()
    expect(await call(C.batchUploadFoldersAvailable)).toBe(true)
  })

  it('is false when the limits getter is not wired (an old server)', async () => {
    const { call } = await setup(false)
    expect(await call(C.batchUploadFoldersAvailable)).toBe(false)
  })
})

describe('pick', () => {
  it('answers null when the dialog is cancelled', async () => {
    const { call } = await setup()
    expect(
      await call(C.batchUploadPick, { workspaceId: 'ws_1', folderId: null, mode: 'folder' }),
    ).toBeNull()
    expect(dialogs.open[0]?.properties).toEqual(['openDirectory'])
  })

  it('opens the files dialog with multiple selections, filtered by the app formats', async () => {
    const { call } = await setup()
    await call(C.batchUploadPick, { workspaceId: 'ws_1', folderId: null, mode: 'files' })
    const options = dialogs.open[0]!
    expect(options.properties).toEqual(['openFile', 'multiSelections'])
    expect(options.filters?.[0]?.extensions).toContain('docx')
  })

  it('turns a picked folder into a preflight on My Folder, with no absolute path in the reply', async () => {
    const { call } = await setup()
    const root = tree('a.docx', 'sub/b.docx')
    dialogs.result = { canceled: false, filePaths: [root] }
    const sdo = (await call(C.batchUploadPick, {
      workspaceId: 'ws_1',
      folderId: null,
      mode: 'folder',
    })) as PreflightSDO
    expect(sdo).toMatchObject({
      mode: 'folder',
      rootName: 'Case',
      target: { workspaceId: 'ws_1', folderId: 'fold_my', label: 'My Folder' },
      totals: { files: 2, bytes: 20 },
      refusal: null,
    })
    expect(JSON.stringify(sdo)).not.toContain(dir)
  })

  it('refuses folder mode with folder_upload_unavailable when the runner is not wired (an old server)', async () => {
    const { call } = await setup(false)
    const sdo = (await call(C.batchUploadPick, {
      workspaceId: 'ws_1',
      folderId: null,
      mode: 'folder',
    })) as PreflightSDO
    expect(sdo.refusal).toEqual({ code: 'folder_upload_unavailable' })
    expect(dialogs.open).toHaveLength(0)
  })
})

describe('preflight, start and the run controls', () => {
  it('validates the renderer input and answers a narrow reply', async () => {
    const { call, runner } = await setup()
    expect(await call(C.batchUploadPreflight, null)).toEqual([])
    expect(
      await call(C.batchUploadPreflight, {
        workspaceId: 'ws_1',
        folderId: null,
        paths: [1, 'a/b'],
      }),
    ).toEqual([])
    expect(await call(C.batchUploadStart, undefined)).toEqual({ ok: false, error: 'invalid_input' })
    expect(await call(C.batchUploadStart, { preflightId: 'x', shareWithWorkspace: false })).toEqual(
      {
        ok: false,
        error: 'unknown_preflight',
      },
    )
    // a bad run id reaches no runner
    await call(C.batchUploadCancel, 5)
    expect(runner.calls).toEqual([])
  })

  it('starts the preflight on the runner, pushes progress to the window that started it, and forwards the controls', async () => {
    const { call, runner, senderSent, shellSent } = await setup()
    const root = tree('a.docx')
    const [sdo] = (await call(C.batchUploadPreflight, {
      workspaceId: 'ws_1',
      folderId: 'fold_1',
      paths: [root],
    })) as PreflightSDO[]
    expect(sdo.target).toMatchObject({ folderId: 'fold_1', label: 'Contracts' })

    const started = (await call(C.batchUploadStart, {
      preflightId: sdo.preflightId,
      shareWithWorkspace: true,
    })) as { ok: true; runId: string }
    expect(started.ok).toBe(true)
    expect(runner.started).toHaveLength(1)
    expect(runner.started[0]).toMatchObject({
      runId: started.runId,
      workspaceId: 'ws_1',
      parentId: 'fold_1',
      shareWithWorkspace: true,
    })

    runner.started[0].onProgress({
      phase: 'uploading',
      done: 1,
      failed: 0,
      total: 1,
      sentBytes: 10,
      totalBytes: 10,
    })
    const pushed = senderSent.filter((m) => m.channel === C.batchUploadProgress)
    expect(pushed.at(-1)?.payload).toMatchObject({
      runId: started.runId,
      phase: 'uploading',
      done: 1,
    })
    // the shell window is not the target of a run another window started
    expect(shellSent.filter((m) => m.channel === C.batchUploadProgress)).toEqual([])

    await call(C.batchUploadCancel, started.runId)
    await call(C.batchUploadRetry, started.runId)
    await call(C.batchUploadDismiss, started.runId)
    expect(runner.calls).toEqual([
      `cancel:${started.runId}`,
      `retry:${started.runId}`,
      `dismiss:${started.runId}`,
    ])
  })
})
