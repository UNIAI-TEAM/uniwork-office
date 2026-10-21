import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZIP_DOWNLOAD_CHANNELS } from '../src/shared/zip-download-api'

/**
 * UNI-2068: the zip download through the real wiring - the three IPC channels,
 * the save dialog (opens first, in Downloads when nothing was remembered), the
 * progress push to the asking window only, and the quit / sign-out cleanup -
 * over a stubbed network.
 */

const DOC_A = '01J8X4D0C0N1P2Q3R4S5T6V7WA'
const DOC_B = '01J8X4D0C0N1P2Q3R4S5T6V7WB'
const WS = 'ws_1'

let dir: string
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null

const dialogs = vi.hoisted(() => ({
  save: { canceled: true } as { canceled: boolean; filePath?: string },
  saveOptions: [] as Array<{ defaultPath?: string; filters?: Array<{ extensions: string[] }> }>,
}))

vi.mock('electron', () => ({
  app: { getPath: () => dir, configureHostResolver: () => undefined, isPackaged: false },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showMessageBox: vi.fn(async () => ({ response: 1 })),
    showSaveDialog: vi.fn(async (...args: unknown[]) => {
      dialogs.saveOptions.push(args.at(-1) as never)
      return dialogs.save
    }),
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
  uniworkSessionIdentity: () => identity,
}))

beforeEach(() => {
  vi.resetModules()
  dir = mkdtempSync(join(tmpdir(), 'uw-zip-wiring-'))
  identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
  dialogs.save = { canceled: true }
  dialogs.saveOptions.length = 0
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

async function setup() {
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const makeContents = () => {
    const sent: Array<{ channel: string; payload: unknown }> = []
    return {
      sent,
      wc: {
        isDestroyed: () => false,
        isLoadingMainFrame: () => false,
        send: (channel: string, payload: unknown) => void sent.push({ channel, payload }),
      },
    }
  }
  const shell = makeContents()
  const asker = makeContents()
  const handle = createUniworkDocs(
    {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    } as never,
    {
      shellWindow: () => null,
      shellContents: () => shell.wc as never,
      openPath: () => true,
      refuseLockedPath: () => false,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      reveal: () => undefined,
      lang: () => 'en',
      defaultSaveDir: () => join(dir, 'app-save-dir'),
      openPaths: () => [],
      closePath: async () => true,
      confirmClosePath: async () => true,
      closePathNow: () => undefined,
      aiHistoryPaths: () => [],
      forgetAiHistory: () => undefined,
      notifyPathRenamed: vi.fn(),
    },
  )
  const call = (channel: string, ...args: unknown[]) =>
    handlers.get(channel)!({ sender: asker.wc }, ...args)
  return { handle, handlers, call, shell, asker }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const readyJob = {
  id: 'job_1',
  status: 'ready',
  download_url: `/api/v1/workspaces/${WS}/documents/download-jobs/job_1/download`,
  file_count: 2,
  skipped: [],
  error: null,
}
const input = { workspaceId: WS, documentIds: [DOC_A, DOC_B] }
const tick = () => new Promise((resolve) => setTimeout(resolve, 30))
const tmpLeft = () => readdirSync(dir).filter((name) => name.endsWith('.tmp'))

function stubNetwork(routes: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => routes(String(url), init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('the zip download IPC', () => {
  it('registers the three channels of the contract', async () => {
    const { handlers } = await setup()
    for (const channel of [
      ZIP_DOWNLOAD_CHANNELS.start,
      ZIP_DOWNLOAD_CHANNELS.cancel,
      ZIP_DOWNLOAD_CHANNELS.downloadFile,
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
    // the progress is a push, never an invoke handler
    expect(handlers.has(ZIP_DOWNLOAD_CHANNELS.progress)).toBe(false)
  })

  it('opens the save dialog first, in Downloads when nothing was remembered; cancel = no job', async () => {
    const { call } = await setup()
    const fetchMock = stubNetwork(() => json(500, {}))
    expect(await call(ZIP_DOWNLOAD_CHANNELS.start, input)).toEqual({
      ok: false,
      code: 'dialog_canceled',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    const options = dialogs.saveOptions.at(-1)!
    expect(options.defaultPath).toMatch(
      new RegExp(
        `^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/\\\\]documents-\\d{8}T\\d{4}\\.zip$`,
      ),
    )
    expect(options.filters?.[0]?.extensions).toEqual(['zip'])
  })

  it('refuses a signed-out start before the dialog', async () => {
    const { call } = await setup()
    identity = null
    expect(await call(ZIP_DOWNLOAD_CHANNELS.start, input)).toEqual({
      ok: false,
      code: 'signed_out',
    })
    expect(dialogs.saveOptions).toHaveLength(0)
  })

  it('runs a whole download: job, stream to a temp file, rename; progress to the asker only', async () => {
    const { call, shell, asker } = await setup()
    dialogs.save = { canceled: false, filePath: join(dir, 'mine.zip') }
    const seen: string[] = []
    stubNetwork((url, init) => {
      seen.push(`${init.method} ${url}`)
      if (init.method === 'POST')
        return json(202, { ...readyJob, status: 'queued', download_url: null })
      if (url.endsWith('/download')) {
        return new Response(new Uint8Array([80, 75, 3, 4]), {
          status: 200,
          headers: { 'Content-Length': '4' },
        })
      }
      return json(200, readyJob)
    })
    const started = (await call(ZIP_DOWNLOAD_CHANNELS.start, input)) as {
      ok: boolean
      runId: string
    }
    expect(started.ok).toBe(true)
    // the poll waits 2 s: let the real timer run out
    await new Promise((resolve) => setTimeout(resolve, 2_300))
    expect(readFileSync(join(dir, 'mine.zip'))).toEqual(Buffer.from([80, 75, 3, 4]))
    expect(tmpLeft()).toEqual([])
    expect(seen[0]).toBe(
      `POST https://uniwork.example/api/v1/workspaces/${WS}/documents/download-jobs`,
    )
    const pushes = asker.sent.filter((s) => s.channel === ZIP_DOWNLOAD_CHANNELS.progress)
    expect(pushes.length).toBeGreaterThan(1)
    expect(pushes.every((p) => (p.payload as { runId: string }).runId === started.runId)).toBe(true)
    expect(pushes.at(-1)!.payload).toMatchObject({ phase: 'done', path: join(dir, 'mine.zip') })
    // no other window hears it
    expect(shell.sent.filter((s) => s.channel === ZIP_DOWNLOAD_CHANNELS.progress)).toEqual([])
  }, 10_000)

  it('quit removes the temp file of a stalled download', async () => {
    const { call, handle } = await setup()
    dialogs.save = { canceled: false, filePath: join(dir, 'stalled.zip') }
    stubNetwork((url, init) => {
      if (init.method === 'POST') return json(202, readyJob)
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]))
          },
        }),
        { status: 200 },
      )
    })
    await call(ZIP_DOWNLOAD_CHANNELS.start, input)
    await tick()
    await tick()
    expect(tmpLeft()).toHaveLength(1)
    handle.disposeZipDownloads()
    expect(tmpLeft()).toEqual([])
    await tick()
    expect(existsSync(join(dir, 'stalled.zip'))).toBe(false)
  })

  it('a sign-out through the account boundary ends a run with signed_out', async () => {
    const { call, handle, asker } = await setup()
    dialogs.save = { canceled: false, filePath: join(dir, 'gone.zip') }
    stubNetwork((url, init) => {
      if (init.method === 'POST') return json(202, readyJob)
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]))
          },
        }),
        { status: 200 },
      )
    })
    await call(ZIP_DOWNLOAD_CHANNELS.start, input)
    await tick()
    await tick()
    handle.boundary.afterSignOut()
    await tick()
    await tick()
    const last = asker.sent.filter((s) => s.channel === ZIP_DOWNLOAD_CHANNELS.progress).at(-1)!
    expect(last.payload).toMatchObject({ phase: 'failed', error: { code: 'signed_out' } })
    expect(tmpLeft()).toEqual([])
    expect(existsSync(join(dir, 'gone.zip'))).toBe(false)
  })
})

describe('the single file download (D4)', () => {
  const file = { workspaceId: WS, documentId: DOC_A, suggestedName: 'Plan.docx' }

  it('a canceled dialog reads nothing', async () => {
    const { call } = await setup()
    const fetchMock = stubNetwork(() => json(500, {}))
    expect(await call(ZIP_DOWNLOAD_CHANNELS.downloadFile, file)).toEqual({
      ok: false,
      path: null,
      code: 'dialog_canceled',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dialogs.saveOptions.at(-1)!.defaultPath).toContain('Plan.docx')
  })

  it('saves the file through the temp file + rename pattern', async () => {
    const { call } = await setup()
    dialogs.save = { canceled: false, filePath: join(dir, 'Plan.docx') }
    const fetchMock = stubNetwork(
      () =>
        new Response(new Uint8Array([7, 8, 9]), {
          status: 200,
          headers: { 'Content-Length': '3' },
        }),
    )
    expect(await call(ZIP_DOWNLOAD_CHANNELS.downloadFile, file)).toEqual({
      ok: true,
      path: join(dir, 'Plan.docx'),
    })
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `https://uniwork.example/api/v1/documents/${DOC_A}/download`,
    )
    expect([...readFileSync(join(dir, 'Plan.docx'))]).toEqual([7, 8, 9])
    expect(tmpLeft()).toEqual([])
  })

  it('a file past the in-memory cap answers too_large and leaves nothing', async () => {
    const { call } = await setup()
    dialogs.save = { canceled: false, filePath: join(dir, 'Big.docx') }
    stubNetwork(
      () =>
        new Response(new Uint8Array(4), {
          status: 200,
          headers: { 'Content-Length': String(300 * 1024 * 1024) },
        }),
    )
    expect(await call(ZIP_DOWNLOAD_CHANNELS.downloadFile, file)).toEqual({
      ok: false,
      path: null,
      code: 'too_large',
    })
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses a signed-out call and malformed ids before the dialog', async () => {
    const { call } = await setup()
    expect(
      await call(ZIP_DOWNLOAD_CHANNELS.downloadFile, { ...file, documentId: 7 }),
    ).toMatchObject({
      ok: false,
      code: 'server_error',
    })
    identity = null
    expect(await call(ZIP_DOWNLOAD_CHANNELS.downloadFile, file)).toEqual({
      ok: false,
      path: null,
      code: 'signed_out',
    })
    expect(dialogs.saveOptions).toHaveLength(0)
  })
})
