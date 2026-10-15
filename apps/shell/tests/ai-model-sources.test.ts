/**
 * G6-05m slice C: what the desktop model chip reads. The real `ai:get-settings` / `ai:set-settings`
 * handlers of docs-main run with electron mocked and a fake vendor on `fetch`:
 *  - `modelSources[p].chosen` is the model in ai-settings.json (the Settings pane's own file);
 *  - the first read starts a background listing (answered `loading`), announces the answer through
 *    `ai:settings-changed`, and a later read carries `listed`; a failed first listing reads `error`;
 *  - `modelSources` / `uniworkModel` are derived: `ai:set-settings` never writes them;
 *  - `uniworkModel` comes from the shell's UniworkAiHost (the cloud status), absent when unknown.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers, dirs, wc } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  dirs: { userData: '' },
  wc: { send: vi.fn(), isDestroyed: () => false },
}))

vi.mock('@genoffice/ai-search', () => ({}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => dirs.userData),
    on: vi.fn(),
    once: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => {})),
    isPackaged: false,
    getVersion: () => '0.0.0',
    getName: () => 'test',
  },
  BrowserWindow: class {
    static fromWebContents() {
      return null
    }
    static getFocusedWindow() {
      return null
    }
    static getAllWindows() {
      return []
    }
  },
  dialog: { showSaveDialog: vi.fn(), showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    once: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  session: { defaultSession: {} },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1000, height: 800 } }) },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  clipboard: {},
  webContents: { fromId: vi.fn(), getAllWebContents: () => [wc] },
  WebContentsView: class {},
}))

import { setUniworkAiAvailable, type AiSettings } from '@genoffice/ai-provider'
import { registerAiIpc, setUniworkAiHost } from '../../docs/src/main/docs-main'

const EVENT = { sender: { id: 1 } }
const getSettings = () =>
  Promise.resolve(handlers.get('ai:get-settings')!(EVENT)) as Promise<AiSettings>
const setSettings = (s: unknown) => handlers.get('ai:set-settings')!(EVENT, s)
const file = () => JSON.parse(readFileSync(join(dirs.userData, 'ai-settings.json'), 'utf8'))
const writeFile = (value: unknown) =>
  writeFileSync(join(dirs.userData, 'ai-settings.json'), JSON.stringify(value))

/** one Anthropic key; every test uses its own key so the module-level cache never carries over */
const anthropicFile = (apiKey: string, model = 'claude-sonnet-5') => ({
  provider: 'anthropic',
  providers: { anthropic: { apiKey, model } },
})

const ANTHROPIC_LIST = { data: [{ id: 'claude-opus-5-5' }, { id: 'claude-future-9' }] }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('desktop model chip sources', () => {
  beforeAll(() => registerAiIpc())
  beforeEach(() => {
    dirs.userData = mkdtempSync(join(tmpdir(), 'uniwork-model-sources-'))
    setUniworkAiAvailable(true)
    wc.send.mockClear()
    fetchMock = vi.fn(async () => json(ANTHROPIC_LIST))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    setUniworkAiAvailable(false)
    setUniworkAiHost(null)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  afterAll(() => rmSync(dirs.userData, { recursive: true, force: true }))

  it('chosen is the model in ai-settings.json; only providers that can send get a source', async () => {
    writeFile(anthropicFile('sk-ant-chosen', 'claude-haiku-4-5-20251001'))
    const sources = (await getSettings()).modelSources!
    expect(sources.anthropic).toMatchObject({ chosen: 'claude-haiku-4-5-20251001' })
    // no key for openai: nothing to show, nothing listed
    expect(sources.openai).toBeUndefined()
    expect(sources.uniwork).toBeUndefined()
    // UniAI needs no key of its own: the Settings pick is still offered
    expect(sources.genspark?.chosen).toBeTruthy()
  })

  it('the first read starts one listing and answers loading; the next read carries listed', async () => {
    writeFile(anthropicFile('sk-ant-first'))
    const first = (await getSettings()).modelSources!.anthropic
    expect(first).toEqual({ chosen: 'claude-sonnet-5', listState: 'loading' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(new Headers(init.headers).get('x-api-key')).toBe('sk-ant-first')

    await flush()
    expect(wc.send).toHaveBeenCalledWith('ai:settings-changed')
    const later = (await getSettings()).modelSources!.anthropic
    expect(later).toEqual({
      chosen: 'claude-sonnet-5',
      listed: ['claude-opus-5-5', 'claude-future-9'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a failed first listing reads error and keeps no list (the chip falls back to the catalog)', async () => {
    fetchMock.mockResolvedValue(json({ error: { message: 'nope' } }, 401))
    writeFile(anthropicFile('sk-ant-bad'))
    await getSettings()
    await flush()
    const source = (await getSettings()).modelSources!.anthropic
    expect(source).toEqual({ chosen: 'claude-sonnet-5', listState: 'error' })
    expect(wc.send).toHaveBeenCalledWith('ai:settings-changed')
  })

  it('a refresh after the TTL keeps the list and sets no state while it runs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    writeFile(anthropicFile('sk-ant-ttl'))
    await getSettings()
    await flush()
    expect((await getSettings()).modelSources!.anthropic?.listed).toHaveLength(2)
    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    const during = (await getSettings()).modelSources!.anthropic
    expect(during).toEqual({
      chosen: 'claude-sonnet-5',
      listed: ['claude-opus-5-5', 'claude-future-9'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a changed key lists again', async () => {
    writeFile(anthropicFile('sk-ant-one'))
    await getSettings()
    await flush()
    writeFile(anthropicFile('sk-ant-two'))
    expect((await getSettings()).modelSources!.anthropic?.listState).toBe('loading')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await flush()
  })

  it('never lists for Codex or UniWork AI', async () => {
    writeFile({ provider: 'codex', providers: { codex: { apiKey: '', model: 'gpt-x' } } })
    const settings = await getSettings()
    expect(settings.modelSources!.codex).toEqual({ chosen: 'gpt-x' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ai:set-settings drops the derived fields: the file never holds them', async () => {
    writeFile(anthropicFile('sk-ant-save'))
    const read = await getSettings()
    await flush()
    await setSettings({
      ...read,
      modelSources: { anthropic: { chosen: 'x', listed: ['y'] } },
      uniworkModel: 'claude-opus-5',
    })
    const saved = file()
    expect(saved).not.toHaveProperty('modelSources')
    expect(saved).not.toHaveProperty('uniworkModel')
    expect(saved.providers.anthropic).toMatchObject({
      apiKey: 'sk-ant-save',
      model: 'claude-sonnet-5',
    })
  })

  describe('uniworkModel', () => {
    const host = (model: () => string) =>
      setUniworkAiHost({ stream: vi.fn(async () => undefined), uniworkModel: model })

    it('is the shell cloud status model while UniWork AI is offered', async () => {
      writeFile(anthropicFile('sk-ant-uw'))
      host(() => 'claude-opus-5')
      expect((await getSettings()).uniworkModel).toBe('claude-opus-5')
    })

    it('is absent when the server does not say, there is no host, or the grant is off', async () => {
      writeFile(anthropicFile('sk-ant-uw2'))
      host(() => '')
      expect(await getSettings()).not.toHaveProperty('uniworkModel')
      setUniworkAiHost(null)
      expect(await getSettings()).not.toHaveProperty('uniworkModel')
      host(() => 'claude-opus-5')
      setUniworkAiAvailable(false)
      expect(await getSettings()).not.toHaveProperty('uniworkModel')
    })
  })
})
