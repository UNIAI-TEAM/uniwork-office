import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOC_HISTORY_CHANNELS } from '../src/shared/doc-history-api'

/**
 * UNI-2077: the history channels end to end on the main side
 * (`uniwork-doc-history:*` registered by the documents wiring, answered by the
 * history service through the real client against a stubbed server), and only
 * for the shell window's main frame.
 */

let dir: string

vi.mock('electron', () => ({
  app: { getPath: () => dir, configureHostResolver: () => undefined },
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
  dir = mkdtempSync(join(tmpdir(), 'uw-doc-history-ipc-'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

const mainFrame = { frame: 'main' }
const shell = {
  isDestroyed: () => false,
  isLoadingMainFrame: () => false,
  send: () => undefined,
  mainFrame,
}
const fromShell = { sender: shell, senderFrame: mainFrame }

async function setup() {
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  createUniworkDocs(
    {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    } as never,
    {
      shellWindow: () => null,
      shellContents: () => shell as never,
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
    },
  )
  return {
    handlers,
    call: async (channel: string, event: unknown, input: unknown): Promise<unknown> => {
      const handler = handlers.get(channel)
      expect(handler, `handler for ${channel}`).toBeTypeOf('function')
      return handler!(event, input)
    },
  }
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Seen {
  method: string
  path: string
  search: string
  body: unknown
}

function stubServer(answer: (seen: Seen) => Response): Seen[] {
  const seen: Seen[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input))
      const entry: Seen = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        search: url.search,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      }
      seen.push(entry)
      return answer(entry)
    }),
  )
  return seen
}

const VERSION = { id: 'ver_2', document_id: 'doc_1', version: 2, kind: 'file' }

describe('main: the history handlers', () => {
  it('registers a handler for every channel', async () => {
    const { handlers } = await setup()
    for (const channel of Object.values(DOC_HISTORY_CHANNELS)) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('versions -> GET /documents/{id}/versions with the web page size', async () => {
    const { call } = await setup()
    const seen = stubServer(() => reply(200, { versions: [VERSION], next_cursor: null }))
    const res = await call(DOC_HISTORY_CHANNELS.versions, fromShell, { documentId: 'doc_1' })
    expect(res).toMatchObject({ ok: true, value: { versions: [{ id: 'ver_2' }] } })
    expect(seen).toMatchObject([
      { method: 'GET', path: '/api/v1/documents/doc_1/versions', search: '?limit=50' },
    ])
  })

  it('restore of a document not open here -> reads its revision, then POSTs it as the base', async () => {
    const { call } = await setup()
    const seen = stubServer((s) =>
      s.method === 'GET'
        ? reply(200, { document: { id: 'doc_1', kind: 'file', revision: '42' } })
        : reply(200, {
            document: { id: 'doc_1', kind: 'file', title: 'T', revision: '43', current_version: 3 },
            version: { ...VERSION, id: 'ver_3', version: 3, reason: 'restore', restored_from: 2 },
          }),
    )
    const res = await call(DOC_HISTORY_CHANNELS.restore, fromShell, {
      documentId: 'doc_1',
      versionNo: 2,
      idempotencyKey: 'key_12345678',
    })
    expect(res).toMatchObject({ ok: true, value: { document: { revision: '43' } } })
    expect(seen).toMatchObject([
      { method: 'GET', path: '/api/v1/documents/doc_1' },
      {
        method: 'POST',
        path: '/api/v1/documents/doc_1/versions/2/restore',
        body: { base_revision: '42' },
      },
    ])
  })

  it('access logs: a 403 is forbidden', async () => {
    const { call } = await setup()
    stubServer(() => reply(403, { error: { code: 'document_forbidden', message: 'x' } }))
    expect(await call(DOC_HISTORY_CHANNELS.accessLogs, fromShell, { documentId: 'doc_1' })).toEqual(
      { ok: false, error: 'forbidden', status: 403 },
    )
  })

  it('refuses any sender but the shell main frame, before any request', async () => {
    const { call } = await setup()
    const seen = stubServer(() => reply(200, { versions: [] }))
    const editor = { ...shell }
    expect(
      await call(
        DOC_HISTORY_CHANNELS.versions,
        { sender: editor, senderFrame: mainFrame },
        {
          documentId: 'doc_1',
        },
      ),
    ).toEqual({ ok: false, error: 'forbidden' })
    expect(
      await call(
        DOC_HISTORY_CHANNELS.versions,
        { sender: shell, senderFrame: {} },
        {
          documentId: 'doc_1',
        },
      ),
    ).toEqual({ ok: false, error: 'forbidden' })
    expect(seen).toHaveLength(0)
  })
})
