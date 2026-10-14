/**
 * G6-05 S2 gap 3 (Q-3): on desktop the "UniWork AI" pick is saved per UniWork account, in the
 * account store the shell hands to ai:get-settings / ai:set-settings (key
 * `uniwork.ai.uniwork-choice`); the BYOK settings stay in ai-settings.json. The real handlers run
 * here with electron mocked; the account store is a fake keyed by "account".
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { registerAiIpc, setUniworkAiChoiceStore } from '../src/main/docs-main'
import type { AiSettings } from '../src/shared/ipc'

const getSettings = () =>
  Promise.resolve(handlers.get('ai:get-settings')!({})) as Promise<AiSettings>
const setSettings = (s: AiSettings) => handlers.get('ai:set-settings')!({}, s)
const file = (): AiSettings =>
  JSON.parse(readFileSync(join(dirs.userData, 'ai-settings.json'), 'utf8')) as AiSettings

/** the settings the renderer sends after the user picked `provider`, with an Anthropic key of their own */
const picked = (provider: AiSettings['provider']): AiSettings =>
  ({
    provider,
    providers: { anthropic: { apiKey: 'sk-own', model: 'claude-test' } },
  }) as unknown as AiSettings

/** the shell's account store, one choice per account; `account` is the active bucket */
function fakeAccounts() {
  const choice = new Map<string, boolean>()
  let account = 'a-1'
  const writes: Array<[string, boolean]> = []
  setUniworkAiChoiceStore({
    read: () => choice.get(account) === true,
    write: (on) => {
      writes.push([account, on])
      choice.set(account, on)
    },
  })
  return { switchTo: (next: string) => (account = next), choice, writes }
}

describe('UniWork AI choice per account (desktop)', () => {
  beforeAll(() => registerAiIpc())
  beforeEach(() => {
    dirs.userData = mkdtempSync(join(tmpdir(), 'uniwork-choice-'))
    setUniworkAiAvailable(true)
  })
  afterEach(() => {
    setUniworkAiAvailable(false)
    setUniworkAiChoiceStore(null)
  })
  afterAll(() => rmSync(dirs.userData, { recursive: true, force: true }))

  it('picking UniWork AI saves the choice to the account store; ai-settings.json keeps the BYOK provider and keys', async () => {
    const accounts = fakeAccounts()
    await setSettings(picked('anthropic'))
    await setSettings(picked('uniwork'))
    expect(accounts.writes.at(-1)).toEqual(['a-1', true])
    expect(file().provider).toBe('anthropic')
    expect(file().providers.anthropic?.apiKey).toBe('sk-own')
    expect((await getSettings()).provider).toBe('uniwork')
  })

  it('picking a BYOK provider clears that account choice', async () => {
    const accounts = fakeAccounts()
    await setSettings(picked('uniwork'))
    await setSettings(picked('anthropic'))
    expect(accounts.writes.at(-1)).toEqual(['a-1', false])
    expect(file().provider).toBe('anthropic')
    expect((await getSettings()).provider).toBe('anthropic')
  })

  it('switching account restores that account choice, not the previous one', async () => {
    const accounts = fakeAccounts()
    await setSettings(picked('anthropic'))
    await setSettings(picked('uniwork')) // account a-1 picks UniWork AI
    accounts.switchTo('a-2')
    expect((await getSettings()).provider).toBe('anthropic') // a-2 never chose it
    await setSettings(picked('anthropic'))
    accounts.switchTo('a-1')
    expect((await getSettings()).provider).toBe('uniwork') // a-1's choice is back
    expect(accounts.choice.get('a-2')).toBe(false)
  })

  it('while UniWork AI is unavailable the choice falls back like selectedProvider (genspark) and survives', async () => {
    fakeAccounts()
    await setSettings(picked('uniwork'))
    setUniworkAiAvailable(false)
    expect((await getSettings()).provider).toBe('genspark')
    setUniworkAiAvailable(true)
    expect((await getSettings()).provider).toBe('uniwork')
  })

  it('BYOK edits made while UniWork AI is chosen still reach ai-settings.json', async () => {
    fakeAccounts()
    await setSettings(picked('uniwork'))
    await setSettings({
      ...picked('uniwork'),
      providers: { anthropic: { apiKey: 'sk-new', model: 'claude-test' } },
    } as unknown as AiSettings)
    expect(file().providers.anthropic?.apiKey).toBe('sk-new')
    expect(file().provider).not.toBe('uniwork')
  })

  it('without an account store (standalone) uniwork is never written to the file', async () => {
    setUniworkAiChoiceStore(null)
    await setSettings(picked('anthropic'))
    await setSettings(picked('uniwork'))
    expect(file().provider).toBe('anthropic')
    expect((await getSettings()).provider).toBe('anthropic')
  })
})
