// @vitest-environment node
/**
 * No silent fallback: a saved `uniwork` provider stays `uniwork` through ai:get-settings while
 * UniWork AI is not offered (the picker shows the S7 reason and Send is blocked), and a send with
 * it never reaches another provider. The real handlers run with electron mocked.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { handlers, dirs, streamForProvider } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  dirs: { userData: '' },
  streamForProvider: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => dirs.userData),
    once: vi.fn(),
    getVersion: () => '0.0.0',
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    ),
    on: vi.fn(),
  },
  net: { fetch: vi.fn() },
  webContents: { fromId: vi.fn(), getAllWebContents: () => [] },
}))
vi.mock('@genoffice/ai-search', () => ({
  webSearchTool: {},
  imageSearchTool: {},
  generateImageTool: {},
  analyzeMediaTool: {},
  documentMediaRoots: () => [],
  gskLoginInfo: async () => null,
  hasGskAuth: () => false,
}))
vi.mock('@genoffice/pptx-engine', () => ({
  addPicture: {},
  editPictureSrcRect: {},
  replacePictureBytes: {},
}))
vi.mock('@genoffice/pptx-engine/identity', () => ({ matchesElementRef: () => false }))
vi.mock('@genoffice/pptx-render', () => ({ EMU_PER_PX_96: 9525 }))
vi.mock('@genoffice/pipelines/slides', () => ({ coverCropFractions: () => ({}) }))
vi.mock('../src/main/session-state', () => ({
  pushHistory: () => {},
  rebuildSlide: () => {},
  scheduleHistoryNotify: () => {},
  sessions: new Map(),
}))
vi.mock('@genoffice/ai-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider')>()),
  streamForProvider,
}))

import { setUniworkAiAvailable, type AiSettings } from '@genoffice/ai-provider'
import { registerAiIpc } from '../src/main/ai-ipc'

const storeProvider = (provider: string): void =>
  writeFileSync(
    join(dirs.userData, 'ai-settings.json'),
    JSON.stringify({
      provider,
      providers: { anthropic: { apiKey: 'sk-own', model: 'claude-test' } },
    }),
  )
const getSettings = () =>
  Promise.resolve(handlers.get('ai:get-settings')!({})) as Promise<AiSettings>

describe('slides ai:get-settings keeps uniwork', () => {
  beforeAll(() => {
    dirs.userData = mkdtempSync(join(tmpdir(), 'slides-uniwork-choice-'))
    registerAiIpc()
  })
  afterEach(() => {
    setUniworkAiAvailable(false)
    streamForProvider.mockClear()
  })
  afterAll(() => rmSync(dirs.userData, { recursive: true, force: true }))

  it('a stored uniwork stays uniwork while UniWork AI is unavailable, never UniAI', async () => {
    storeProvider('uniwork')
    setUniworkAiAvailable(false)
    expect((await getSettings()).provider).toBe('uniwork')
    setUniworkAiAvailable(true)
    expect((await getSettings()).provider).toBe('uniwork')
  })

  it('a BYOK provider and an unknown id behave as before', async () => {
    storeProvider('anthropic')
    expect((await getSettings()).provider).toBe('anthropic')
    storeProvider('nonsense')
    expect((await getSettings()).provider).toBe('genspark')
  })

  it('a send with uniwork selected is refused without any provider request', async () => {
    storeProvider('uniwork')
    const settings = await getSettings()
    const chunks: Array<{ type: string; uniworkCode?: string }> = []
    const event = {
      sender: {
        id: 1,
        isDestroyed: () => false,
        send: (_channel: string, chunk: { type: string; uniworkCode?: string }) =>
          chunks.push(chunk),
      },
    }
    await handlers.get('ai:stream')!(event, {
      requestId: 'r-1',
      settings,
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(chunks.map((c) => [c.type, c.uniworkCode])).toEqual([['error', 'ai_disabled']])
    expect(streamForProvider).not.toHaveBeenCalled()
  })
})
