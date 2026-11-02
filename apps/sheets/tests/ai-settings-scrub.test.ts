/**
 * Standalone Sheets: registering its AI handlers scrubs an ai-settings.json left by an older build
 * (provider keys never stay on disk until the next save), and none of the removed BYOK channels
 * is registered. The real registration runs with electron mocked.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers, dirs } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  dirs: { userData: '' },
}))

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    once: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => {})),
    getPath: () => dirs.userData,
    getAppPath: () => dirs.userData,
    getSystemLocale: () => 'en-US',
    getVersion: () => '0.0.0',
    isPackaged: false,
  },
  BrowserWindow: class {
    static fromWebContents = () => null
    static getAllWindows = () => []
  },
  WebContentsView: class {},
  desktopCapturer: {},
  dialog: {},
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  net: {},
  screen: {},
  session: {},
  shell: {},
  systemPreferences: {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => void handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => void handlers.set(channel, handler)),
    removeHandler: vi.fn(),
  },
}))

import { registerSheetsAiIpc } from '../src/main/sheets-main'

const REMOVED_CHANNELS = [
  'ai:chat',
  'ai:settings-test',
  'ai:search-test',
  'ai:media-test',
  'ai:codex-models',
  'ai:custom-models',
  'ai:openrouter-key-status',
]

describe('sheets AI registration', () => {
  dirs.userData = mkdtempSync(join(tmpdir(), 'sheets-ai-scrub-'))
  afterAll(() => rmSync(dirs.userData, { recursive: true, force: true }))

  it('scrubs an old provider key and registers no removed channel', () => {
    const path = join(dirs.userData, 'ai-settings.json')
    writeFileSync(
      path,
      JSON.stringify({
        provider: 'openrouter',
        providers: { openrouter: { apiKey: 'sk-or-old', model: 'm' } },
        gskToolsEnabled: false,
      }),
    )
    registerSheetsAiIpc()
    const written = readFileSync(path, 'utf8')
    expect(JSON.parse(written)).toEqual({
      provider: 'uniwork',
      providers: {},
      gskToolsEnabled: false,
    })
    expect(written).not.toContain('sk-')
    for (const channel of REMOVED_CHANNELS) expect(handlers.has(channel)).toBe(false)
    expect(handlers.has('ai:stream')).toBe(true)
  })
})
