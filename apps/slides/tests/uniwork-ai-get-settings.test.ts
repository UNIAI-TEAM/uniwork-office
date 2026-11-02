// @vitest-environment node
/**
 * UniWork AI is the only provider (slides, standalone): ai:get-settings always answers `uniwork`
 * whatever the file holds, ai:set-settings keeps only the cloud-tools opt-out, and a send is
 * refused with ai_disabled without any provider request. The real handlers run with electron mocked.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const storeFile = (content: unknown): void =>
  writeFileSync(join(dirs.userData, 'ai-settings.json'), JSON.stringify(content))
const getSettings = () =>
  Promise.resolve(handlers.get('ai:get-settings')!({})) as Promise<AiSettings>

describe('slides ai:get-settings is UniWork AI only', () => {
  beforeAll(() => {
    dirs.userData = mkdtempSync(join(tmpdir(), 'slides-uniwork-choice-'))
    registerAiIpc()
  })
  afterEach(() => {
    setUniworkAiAvailable(false)
    streamForProvider.mockClear()
  })
  afterAll(() => rmSync(dirs.userData, { recursive: true, force: true }))

  it('answers uniwork whatever provider the file holds, offered or not', async () => {
    storeFile({ provider: 'anthropic', providers: { anthropic: { apiKey: 'sk-own' } } })
    expect((await getSettings()).provider).toBe('uniwork')
    storeFile({ provider: 'nonsense' })
    setUniworkAiAvailable(true)
    expect((await getSettings()).provider).toBe('uniwork')
  })

  it('keeps the stored cloud-tools opt-out and nothing else', async () => {
    storeFile({ provider: 'openai', gskToolsEnabled: false })
    expect((await getSettings()).gskToolsEnabled).toBe(false)
    await handlers.get('ai:set-settings')!(
      {},
      { provider: 'openai', providers: { openai: { apiKey: 'sk-3' } }, gskToolsEnabled: true },
    )
    const written = readFileSync(join(dirs.userData, 'ai-settings.json'), 'utf8')
    expect(JSON.parse(written)).toEqual({
      provider: 'uniwork',
      providers: {},
      gskToolsEnabled: true,
    })
    expect(written).not.toContain('sk-')
  })

  it('registering scrubs an old provider key from the file and leaves no removed channel', () => {
    storeFile({
      provider: 'openrouter',
      providers: { openrouter: { apiKey: 'sk-or-old', model: 'm' } },
      gskToolsEnabled: false,
    })
    registerAiIpc()
    const written = readFileSync(join(dirs.userData, 'ai-settings.json'), 'utf8')
    expect(JSON.parse(written)).toEqual({
      provider: 'uniwork',
      providers: {},
      gskToolsEnabled: false,
    })
    expect(written).not.toContain('sk-')
    for (const channel of [
      'ai:chat',
      'ai:settings-test',
      'ai:search-test',
      'ai:media-test',
      'ai:codex-models',
      'ai:custom-models',
      'ai:openrouter-key-status',
    ])
      expect(handlers.has(channel)).toBe(false)
  })

  it('a send is refused without any provider request', async () => {
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
