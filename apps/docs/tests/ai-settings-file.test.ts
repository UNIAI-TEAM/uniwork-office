/**
 * UniWork AI is the only provider on the desktop: ai-settings.json holds `gskToolsEnabled` and
 * nothing else. The real handlers of docs-main run with electron mocked: registering them scrubs
 * what older builds stored (provider keys, base URLs, media/search keys), ai:set-settings writes
 * only the opt-out, ai:get-settings answers `uniwork` to every sender, and the BYOK channels are gone.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers, dirs } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  dirs: { userData: '' },
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
  webContents: { fromId: vi.fn(), getAllWebContents: () => [] },
  WebContentsView: class {},
}))

import { registerAiIpc } from '../src/main/docs-main'
import type { AiSettings } from '../src/shared/ipc'

const SETTINGS_FILE = () => join(dirs.userData, 'ai-settings.json')
const text = () => readFileSync(SETTINGS_FILE(), 'utf8')
const from = (id: number) => ({ sender: { id } })

const OLD_FILE = {
  provider: 'codex',
  apiKey: 'sk-old',
  baseUrl: 'https://x',
  providers: { openai: { apiKey: 'sk-1', model: 'gpt' } },
  media: { providers: { openai: { apiKey: 'sk-2' } } },
  search: { providers: { tavily: { apiKey: 'tv' } } },
  gskToolsEnabled: false,
  maxOutputTokens: 9000,
}

const REMOVED_CHANNELS = [
  'ai:chat',
  'ai:settings-test',
  'ai:search-test',
  'ai:media-test',
  'ai:codex-models',
  'ai:custom-models',
  'ai:openrouter-key-status',
  // the panels open the account settings from the model chip, not a billing button
  'ai:open-billing',
]

/** a fresh userData with `content` as the settings file (none when undefined), then the handlers register */
function register(content?: unknown): void {
  dirs.userData = mkdtempSync(join(tmpdir(), 'ai-settings-file-'))
  if (content !== undefined) writeFileSync(SETTINGS_FILE(), JSON.stringify(content))
  handlers.clear()
  registerAiIpc()
}

describe('ai-settings.json holds the cloud-tools opt-out only', () => {
  beforeEach(() => {
    if (dirs.userData) rmSync(dirs.userData, { recursive: true, force: true })
  })
  afterAll(() => rmSync(dirs.userData, { recursive: true, force: true }))

  it('registering scrubs every provider key, base URL and legacy field, keeping the opt-out', () => {
    register(OLD_FILE)
    expect(JSON.parse(text())).toEqual({
      provider: 'uniwork',
      providers: {},
      gskToolsEnabled: false,
    })
    expect(text()).not.toContain('sk-')
  })

  it('a file already in shape is not written again', () => {
    register({ provider: 'uniwork', providers: {}, gskToolsEnabled: true })
    const past = new Date('2020-01-01T00:00:00Z')
    utimesSync(SETTINGS_FILE(), past, past)
    handlers.clear()
    registerAiIpc()
    expect(statSync(SETTINGS_FILE()).mtimeMs).toBe(past.getTime())
  })

  it('ai:set-settings writes only gskToolsEnabled, whatever else the payload carries', async () => {
    register(OLD_FILE)
    await handlers.get('ai:set-settings')!(from(11), {
      provider: 'openai',
      providers: { openai: { apiKey: 'sk-3' } },
      gskToolsEnabled: true,
    })
    expect(JSON.parse(text())).toEqual({
      provider: 'uniwork',
      providers: {},
      gskToolsEnabled: true,
    })
    expect(text()).not.toContain('sk-')
  })

  it('ai:get-settings answers uniwork to every sender, with the stored opt-out', async () => {
    register(OLD_FILE)
    for (const sender of [11, 22]) {
      const settings = (await handlers.get('ai:get-settings')!(from(sender), {
        includeUniworkPick: true,
      })) as AiSettings
      expect(settings.provider).toBe('uniwork')
      expect(settings.gskToolsEnabled).toBe(false)
    }
  })

  it('ai:get-settings without a file defaults to uniwork with cloud tools on', async () => {
    register()
    const settings = (await handlers.get('ai:get-settings')!(from(11))) as AiSettings
    expect(settings.provider).toBe('uniwork')
    expect(settings.gskToolsEnabled).toBe(true)
  })

  it('has no handler left for the BYOK channels', () => {
    register(OLD_FILE)
    for (const channel of REMOVED_CHANNELS) expect(handlers.has(channel)).toBe(false)
    for (const channel of ['ai:get-settings', 'ai:set-settings', 'ai:stream'])
      expect(handlers.has(channel)).toBe(true)
  })
})
