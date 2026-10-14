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

// the one-shot chat and the settings test never reach a network: the provider they pick is the point
const { chatForProvider, testChatConnection } = vi.hoisted(() => ({
  chatForProvider: vi.fn(async () => ({ ok: true as const, text: 'hi' })),
  testChatConnection: vi.fn(async () => ({ ok: true as const })),
}))
vi.mock('@genoffice/ai-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider')>()),
  chatForProvider,
  testChatConnection,
}))

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
import {
  registerAiIpc,
  setUniworkAiChoiceStore,
  setUniworkAiEditorSender,
} from '../src/main/docs-main'
import type { AiSettings } from '../src/shared/ipc'

/** webContents ids: an editor tab, and the home window (My AI, email, Settings) */
const EDITOR = 11
const HOME = 22
const from = (id: number) => ({ sender: { id } })

const getSettings = (sender = EDITOR) =>
  Promise.resolve(handlers.get('ai:get-settings')!(from(sender))) as Promise<AiSettings>
const setSettings = (s: AiSettings, sender = EDITOR) =>
  handlers.get('ai:set-settings')!(from(sender), s)
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
    // the shell's tab lookup: only an editor tab runs UniWork AI
    setUniworkAiEditorSender((id) => id === EDITOR)
  })
  afterEach(() => {
    setUniworkAiAvailable(false)
    setUniworkAiChoiceStore(null)
    setUniworkAiEditorSender(null)
    chatForProvider.mockClear()
    testChatConnection.mockClear()
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

  it('a save while UniWork AI is hidden (the degraded genspark) keeps the stored pick', async () => {
    const accounts = fakeAccounts()
    await setSettings(picked('anthropic'))
    await setSettings(picked('uniwork'))
    const before = accounts.writes.length
    setUniworkAiAvailable(false)
    // the renderer saves what it was handed while hidden (e.g. after a BYOK key edit)
    await setSettings(picked('genspark'))
    setUniworkAiAvailable(true)
    expect((await getSettings()).provider).toBe('uniwork')
    expect(accounts.choice.get('a-1')).toBe(true)
    expect(accounts.writes.slice(before)).toEqual([])
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

  it('the pick reaches editor tabs only: My AI, email and Settings read the file provider', async () => {
    fakeAccounts()
    await setSettings(picked('anthropic'))
    await setSettings(picked('uniwork'))
    expect((await getSettings(EDITOR)).provider).toBe('uniwork')
    expect((await getSettings(HOME)).provider).toBe('anthropic')
  })

  it('ai:chat and the settings test with provider uniwork run the file provider, never ask a key for uniwork', async () => {
    fakeAccounts()
    await setSettings(picked('anthropic'))
    await setSettings(picked('uniwork'))
    // an editor's settings copy carries the overlay; a one-click action sends it as is
    const request = { settings: picked('uniwork'), system: 's', user: 'u' }
    const chat = (await handlers.get('ai:chat')!(from(EDITOR), request)) as { ok: boolean }
    expect(chat.ok).toBe(true)
    expect(chatForProvider).toHaveBeenCalledTimes(1)
    expect((chatForProvider.mock.calls[0] as unknown[])[0]).toBe('anthropic')
    const test = (await handlers.get('ai:settings-test')!(from(HOME), request)) as { ok: boolean }
    expect(test.ok).toBe(true)
    expect((testChatConnection.mock.calls[0] as unknown[])[0]).toBe('anthropic')
  })

  it('a Settings save from the home window (same BYOK provider) keeps the pick', async () => {
    const accounts = fakeAccounts()
    await setSettings(picked('anthropic'))
    await setSettings(picked('uniwork'))
    const before = accounts.writes.length
    await setSettings(
      {
        ...picked('anthropic'),
        providers: { anthropic: { apiKey: 'sk-newer', model: 'claude-test' } },
      } as unknown as AiSettings,
      HOME,
    )
    expect(accounts.writes.slice(before)).toEqual([])
    expect(file().providers.anthropic?.apiKey).toBe('sk-newer')
    expect((await getSettings(EDITOR)).provider).toBe('uniwork')
  })

  it('a provider change from the home window is a choice: the pick is cleared', async () => {
    const accounts = fakeAccounts()
    await setSettings(picked('anthropic'))
    await setSettings(picked('uniwork'))
    await setSettings(picked('openai'), HOME)
    expect(accounts.writes.at(-1)).toEqual(['a-1', false])
    expect((await getSettings(EDITOR)).provider).toBe('openai')
  })
})
