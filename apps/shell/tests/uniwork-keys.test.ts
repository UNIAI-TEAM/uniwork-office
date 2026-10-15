/**
 * G6-05k slice F2 (Test 8): desktop uses keys saved on UniWork through the BYOK proxy.
 *
 * Covers:
 * - Precedence table (§1, §6.2): local key vs org key per provider, mixed local + org,
 *   byok.enabled=false, older R1 server without `byok`, and signed-out state.
 * - Device bearer added in main, never in renderer-visible settings (`apiKey` stays `''`,
 *   never `key_hint`, never persisted to `ai-settings.json`).
 * - R5 model listing (`GET /api/v1/orgs/{orgId}/ai/byok/{provider}/models`), 10-min cache,
 *   and re-list when `key_hint` / `base_url` / `updated_at` changes.
 * - Sign-out, org switch, and `401 device_revoked` aborting a running stream and clearing
 *   the R1/R5 caches.
 * - `404 credential_missing` re-reading R1 and removing the provider group, while vendor 404
 *   passes through unchanged.
 * - Status mapping (§2.3): 400 (`base_url_refused` / `provider_not_supported` / `invalid_request`),
 *   401 (`unauthorized` 1 refresh + retry), 403 (`entitlement_required`),
 *   424 (`provider_auth_failed`), 429 (`rate_limited` + `Retry-After`), 502 (`provider_unreachable`).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers, dirs } = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
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
    getAppPath: () => '/app',
    setAsDefaultProtocolClient: vi.fn(),
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
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text),
    decryptString: (buf: Buffer) => buf.toString(),
  },
  session: { defaultSession: {} },
  net: { fetch: vi.fn(), isOnline: () => true },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1000, height: 800 } }) },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  clipboard: {},
  webContents: { fromId: vi.fn(), getAllWebContents: () => [] },
  WebContentsView: class {},
}))

import {
  isProviderUsable,
  type AiSettings,
  type AiStreamChunk,
  type AiStreamRequest,
} from '@genoffice/ai-provider'
import { registerAiIpc, setUniworkKeysHost } from '../../docs/src/main/docs-main'
import type { AccountStatus } from '../src/shared/home-api'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { TransportError, type FetchLike } from '../src/main/uniwork-auth/transport'
import { listProviderModels } from '@genoffice/ai-provider/provider-models'
import {
  CREDENTIALS_RETRY_MS,
  CREDENTIALS_TTL_MS,
  MODEL_LIST_TTL_MS,
  UniworkKeyError,
  createUniworkKeysHost,
  parseCredentialsResponse,
  type UniworkKeysHost,
} from '../src/main/uniwork-auth/keys'

const ORIGIN = 'https://uniwork.example'
const PROFILE: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const ORG_1 = '01J8X4ORG0N1P2Q3R4S5T6U7'
const ORG_2 = '01J8X4ORG9Z8Y7X6W5V4U3T2'
const TOKEN_1 = 'at_device_token_one'
const TOKEN_2 = 'at_device_token_two'

interface RecordedCall {
  url: string
  init: RequestInit
  headers: Record<string, string>
}

function recordHeaders(raw: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  if (raw instanceof Headers) {
    raw.forEach((v, k) => {
      out[k.toLowerCase()] = v
    })
  } else if (Array.isArray(raw)) {
    for (const [k, v] of raw) out[k.toLowerCase()] = v
  } else {
    for (const [k, v] of Object.entries(raw)) {
      if (v !== undefined) out[k.toLowerCase()] = v
    }
  }
  return out
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}

function openAiSseResponse(text = 'Hello from OpenAI'): Response {
  const payload =
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n` +
    `data: [DONE]\n\n`
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function anthropicSseResponse(text = 'Hello from Anthropic'): Response {
  const payload =
    `event: content_block_delta\n` +
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n` +
    `event: message_delta\n` +
    `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n` +
    `event: message_stop\n` +
    `data: {"type":"message_stop"}\n\n`
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function createSender() {
  const chunks: AiStreamChunk[] = []
  const sender = {
    id: 101,
    isDestroyed: () => false,
    once: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn((channel: string, chunk: AiStreamChunk) => {
      if (channel === 'ai:stream-chunk') chunks.push(chunk)
    }),
  }
  return { event: { sender }, chunks }
}

const getSettings = (): Promise<AiSettings> =>
  Promise.resolve(handlers.get('ai:get-settings')!({ sender: { id: 101 } })) as Promise<AiSettings>

const setSettings = (settings: AiSettings, options?: unknown): Promise<void> =>
  Promise.resolve(
    handlers.get('ai:set-settings')!({ sender: { id: 101 } }, settings, options),
  ) as Promise<void>

/** the chip / Settings save for a model pick: the whole settings with the model, plus the marker */
const withModel = (settings: AiSettings, provider: 'anthropic', model: string): AiSettings => ({
  ...settings,
  providers: { ...settings.providers, [provider]: { ...settings.providers[provider], model } },
})
const pickMarker = (provider: string, model: string) => ({ modelPick: { provider, model } })

const readStoredSettings = (): {
  providers: Record<string, { apiKey?: string; model?: string; baseUrl?: string }>
} => JSON.parse(readFileSync(join(dirs.userData, 'ai-settings.json'), 'utf8'))

const runStream = async (settings: AiSettings, requestId = 'req-1'): Promise<AiStreamChunk[]> => {
  const { event, chunks } = createSender()
  const req: AiStreamRequest = {
    requestId,
    settings,
    system: 'You are helpful.',
    messages: [{ role: 'user', content: 'Say hi' }],
  }
  await handlers.get('ai:stream')!(event, req)
  return chunks
}

describe('UniworkKeysHost + docs-main BYOK proxy integration (G6-05k F2)', () => {
  const originalFetch = globalThis.fetch

  beforeAll(() => {
    registerAiIpc()
  })

  beforeEach(() => {
    dirs.userData = mkdtempSync(join(tmpdir(), 'uniwork-keys-test-'))
    setUniworkKeysHost(null)
  })

  afterEach(() => {
    setUniworkKeysHost(null)
    globalThis.fetch = originalFetch
    if (dirs.userData) {
      rmSync(dirs.userData, { recursive: true, force: true })
      dirs.userData = ''
    }
  })

  afterAll(() => {
    setUniworkKeysHost(null)
    globalThis.fetch = originalFetch
  })

  it('parses R1 only when byok.enabled is boolean; older servers without byok return empty', () => {
    const legacy = parseCredentialsResponse({
      items: [
        {
          provider: 'openai',
          label: 'OpenAI',
          base_url: '',
          key_hint: 'sk-...1234',
          model: 'gpt-4o-mini',
        },
      ],
    })
    expect(legacy.hasByok).toBe(false)
    expect(legacy.byok.enabled).toBe(false)
    expect(legacy.items).toEqual([])

    const disabled = parseCredentialsResponse({
      byok: { enabled: false, reason: 'entitlement_required' },
      items: [
        {
          provider: 'openai',
          label: 'OpenAI',
          base_url: '',
          key_hint: 'sk-...1234',
          model: 'gpt-4o-mini',
        },
      ],
    })
    expect(disabled.hasByok).toBe(true)
    expect(disabled.byok).toEqual({ enabled: false, reason: 'entitlement_required' })
    expect(disabled.items).toHaveLength(1)

    const enabled = parseCredentialsResponse({
      byok: { enabled: true, reason: '' },
      items: [
        {
          provider: 'anthropic',
          label: 'Anthropic',
          base_url: '',
          key_hint: 'sk-ant-...9999',
          model: 'claude-sonnet-4-6',
          updated_at: '2026-10-14T10:00:00Z',
        },
        // custom without base_url is skipped
        {
          provider: 'custom',
          label: 'Broken Custom',
          base_url: '',
          key_hint: 'sk-...0000',
        },
      ],
    })
    expect(enabled.hasByok).toBe(true)
    expect(enabled.byok.enabled).toBe(true)
    expect(enabled.items).toHaveLength(1)
    expect(enabled.items[0]?.provider).toBe('anthropic')
    expect(enabled.items[0]?.model).toBe('claude-sonnet-4-6')
    expect(enabled.items[0]?.keyHint).toBe('sk-ant-...9999')
  })

  it('merges org credentials into ai:get-settings with origin:"org", keeps apiKey empty, and never persists to disk', async () => {
    const calls: RecordedCall[] = []
    const fetchMock: FetchLike = vi.fn(async (url, init = {}) => {
      calls.push({ url, init, headers: recordHeaders(init.headers) })
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/credentials`) {
        return jsonResponse({
          byok: { enabled: true, reason: '' },
          items: [
            {
              provider: 'anthropic',
              label: 'Anthropic Org',
              base_url: '',
              key_hint: 'sk-ant-...abcd',
              model: 'claude-sonnet-4-6',
              updated_at: '2026-10-14T10:00:00Z',
            },
          ],
        })
      }
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/anthropic/models`) {
        return jsonResponse({
          data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-haiku-4-5' }],
        })
      }
      throw new Error(`unexpected URL: ${url}`)
    })

    let changedCount = 0
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      sessionKey: () => 'default/acc_1/dev_1',
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
      onChanged: () => {
        changedCount++
      },
    })
    setUniworkKeysHost(host)
    await host.list()

    const settings = await getSettings()
    expect(settings.modelSources?.anthropic?.origin).toBe('org')
    expect(settings.modelSources?.anthropic?.chosen).toBe('claude-sonnet-4-6')
    // key_hint and bearer token must NEVER appear in renderer-visible apiKey
    expect(settings.providers.anthropic.apiKey).toBe('')
    expect(JSON.stringify(settings)).not.toContain('sk-ant-...abcd')
    expect(JSON.stringify(settings)).not.toContain(TOKEN_1)
    // the org model is only `chosen`: providers.anthropic keeps what the file (defaults) holds
    expect(settings.providers.anthropic.model).toBe('claude-sonnet-5')
    expect(isProviderUsable(settings, 'anthropic')).toBe(true)
    // Nothing was written to ai-settings.json on disk
    expect(existsSync(join(dirs.userData, 'ai-settings.json'))).toBe(false)

    // Wait for background R5 `/models` listing to settle
    await vi.waitFor(async () => {
      const afterModels = await getSettings()
      expect(afterModels.modelSources?.anthropic).toEqual({
        origin: 'org',
        chosen: 'claude-sonnet-4-6',
        listed: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
      })
    })
    expect(changedCount).toBeGreaterThan(0)
    // Both R1 and R5 carried the device bearer token in main
    expect(calls.map((c) => [c.url, c.headers.authorization])).toEqual([
      [`${ORIGIN}/api/v1/orgs/${ORG_1}/ai/credentials`, `Bearer ${TOKEN_1}`],
      [`${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/anthropic/models`, `Bearer ${TOKEN_1}`],
    ])
  })

  it('a model picked on this computer for an org-served provider wins over an older server model and streams through the proxy', async () => {
    const stored = {
      provider: 'anthropic',
      providers: { anthropic: { apiKey: '', model: 'claude-sonnet-5' } },
    }
    writeFileSync(join(dirs.userData, 'ai-settings.json'), JSON.stringify(stored))

    const fetchMock: FetchLike = vi.fn(async (url, init = {}) => {
      const headers = recordHeaders(init.headers)
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/credentials`) {
        return jsonResponse({
          byok: { enabled: true, reason: '' },
          items: [
            {
              provider: 'anthropic',
              label: 'Anthropic',
              base_url: '',
              key_hint: 'sk-ant-...9999',
              model: 'claude-sonnet-4-6',
              model_updated_at: '2026-10-11T08:00:00Z',
              updated_at: '2026-10-14T10:00:00Z',
            },
          ],
        })
      }
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/anthropic/models`) {
        return jsonResponse({ data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-haiku-4-5' }] })
      }
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/anthropic/messages`) {
        expect(headers.authorization).toBe(`Bearer ${TOKEN_1}`)
        expect(headers['x-api-key']).toBeUndefined()
        const body = JSON.parse(String(init.body ?? '{}')) as { model?: string }
        expect(body.model).toBe('claude-haiku-4-5')
        return anthropicSseResponse('Haiku reply')
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      sessionKey: () => 'default/acc_1/dev_1',
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
    })
    setUniworkKeysHost(host)
    await host.list()

    const before = await getSettings()
    // the stored slot model is no pick: the server's model is chosen
    expect(before.modelSources?.anthropic?.chosen).toBe('claude-sonnet-4-6')

    // the chip pick saves the settings with the new model (withAiModelSelection)
    await setSettings(
      {
        ...before,
        providers: {
          ...before.providers,
          anthropic: { ...before.providers.anthropic, model: 'claude-haiku-4-5' },
        },
      },
      pickMarker('anthropic', 'claude-haiku-4-5'),
    )
    const settings = await getSettings()
    expect(settings.modelSources?.anthropic?.origin).toBe('org')
    expect(settings.modelSources?.anthropic?.chosen).toBe('claude-haiku-4-5')
    // the pick is kept with the account, the stored slot is untouched
    expect(readStoredSettings().providers.anthropic).toEqual(stored.providers.anthropic)

    const chunks = await runStream(settings)
    expect(chunks.some((c) => c.type === 'delta' && c.text === 'Haiku reply')).toBe(true)
    expect(chunks.at(-1)?.type).toBe('done')
  })

  it('enforces the precedence table per provider: local key for X goes direct, org key for Y goes via proxy', async () => {
    // User has a local OpenAI key on disk, and the org has both OpenAI and Anthropic keys on UniWork
    writeFileSync(
      join(dirs.userData, 'ai-settings.json'),
      JSON.stringify({
        provider: 'openai',
        providers: {
          openai: { apiKey: 'sk-local-openai-secret', model: 'gpt-5.4' },
        },
      }),
    )

    const calls: RecordedCall[] = []
    const fetchMock: FetchLike = vi.fn(async (url, init = {}) => {
      const headers = recordHeaders(init.headers)
      calls.push({ url, init, headers })
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/credentials`) {
        return jsonResponse({
          byok: { enabled: true, reason: '' },
          items: [
            {
              provider: 'openai',
              label: 'Org OpenAI',
              base_url: '',
              key_hint: 'sk-org-...1111',
              model: 'gpt-4o-mini',
              updated_at: '2026-10-14T10:00:00Z',
            },
            {
              provider: 'anthropic',
              label: 'Org Anthropic',
              base_url: '',
              key_hint: 'sk-ant-...2222',
              model: 'claude-sonnet-4-6',
              updated_at: '2026-10-14T10:00:00Z',
            },
          ],
        })
      }
      if (url === 'https://api.openai.com/v1/models') {
        return jsonResponse({ data: [{ id: 'gpt-5.4' }] })
      }
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/anthropic/models`) {
        return jsonResponse({ data: [{ id: 'claude-sonnet-4-6' }] })
      }
      if (url === 'https://api.openai.com/v1/chat/completions') {
        return openAiSseResponse('Direct local OpenAI')
      }
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/anthropic/messages`) {
        return anthropicSseResponse('Proxied org Anthropic')
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      sessionKey: () => 'default/acc_1/dev_1',
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
    })
    setUniworkKeysHost(host)
    await host.list()

    const settings = await getSettings()
    // OpenAI has a local key -> local source wins (origin is not 'org')
    expect(settings.modelSources?.openai?.origin).toBeUndefined()
    expect(settings.modelSources?.openai?.chosen).toBe('gpt-5.4')
    // Anthropic has no local key -> org source is exposed with origin: 'org'
    expect(settings.modelSources?.anthropic?.origin).toBe('org')
    expect(settings.modelSources?.anthropic?.chosen).toBe('claude-sonnet-4-6')
    expect(settings.providers.anthropic.apiKey).toBe('')

    // 1. Stream with OpenAI -> goes directly to https://api.openai.com/v1/chat/completions with local key
    const openAiChunks = await runStream({ ...settings, provider: 'openai' }, 'req-openai')
    expect(openAiChunks.some((c) => c.type === 'delta' && c.text === 'Direct local OpenAI')).toBe(
      true,
    )
    const directCall = calls.find((c) => c.url === 'https://api.openai.com/v1/chat/completions')
    expect(directCall).toBeDefined()
    expect(directCall?.headers.authorization).toBe('Bearer sk-local-openai-secret')
    expect(
      calls.some((c) => c.url.includes('/api/v1/orgs/') && c.url.includes('/byok/openai/')),
    ).toBe(false)

    // 2. Stream with Anthropic -> goes through UniWork BYOK proxy with device bearer token
    const anthropicChunks = await runStream({ ...settings, provider: 'anthropic' }, 'req-anthropic')
    expect(
      anthropicChunks.some((c) => c.type === 'delta' && c.text === 'Proxied org Anthropic'),
    ).toBe(true)
    const proxyCall = calls.find(
      (c) => c.url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/anthropic/messages`,
    )
    expect(proxyCall).toBeDefined()
    expect(proxyCall?.headers.authorization).toBe(`Bearer ${TOKEN_1}`)
    expect(proxyCall?.headers['x-api-key']).toBeUndefined()
  })

  it('hides org sources and fails locally without calling proxy when byok.enabled is false or signed out', async () => {
    const calls: RecordedCall[] = []
    const byokEnabled = false
    let signedIn = true

    const fetchMock: FetchLike = vi.fn(async (url, init = {}) => {
      calls.push({ url, init, headers: recordHeaders(init.headers) })
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/credentials`) {
        return jsonResponse({
          byok: { enabled: byokEnabled, reason: byokEnabled ? '' : 'entitlement_required' },
          items: [
            {
              provider: 'openai',
              label: 'Org OpenAI',
              base_url: '',
              key_hint: 'sk-...1111',
              model: 'gpt-5.4',
            },
          ],
        })
      }
      throw new Error(`unexpected proxy call: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => (signedIn ? ORG_1 : null),
      sessionKey: () => (signedIn ? 'default/acc_1/dev_1' : ''),
      authorized: async (call) => {
        if (!signedIn) throw new TransportError('unauthorized')
        return call(TOKEN_1)
      },
      fetch: fetchMock,
    })
    setUniworkKeysHost(host)
    await host.list()

    // 1. Signed in, byok.enabled = false
    const s1 = await getSettings()
    expect(s1.modelSources?.openai).toBeUndefined()
    const c1 = await runStream({ ...s1, provider: 'openai' }, 'req-disabled')
    expect(c1).toHaveLength(1)
    expect(c1[0]?.type).toBe('error')
    expect(calls.some((c) => c.url.includes('/byok/'))).toBe(false)

    // 2. Signed out
    signedIn = false
    const s2 = await getSettings()
    expect(s2.modelSources?.openai).toBeUndefined()
    const c2 = await runStream({ ...s2, provider: 'openai' }, 'req-signed-out')
    expect(c2).toHaveLength(1)
    expect(c2[0]?.type).toBe('error')
    expect(calls.some((c) => c.url.includes('/byok/'))).toBe(false)
  })

  it('aborts an in-flight proxied stream and clears R1/R5 caches on sign-out and on org switch', async () => {
    let activeOrg: string | null = ORG_1
    let session = 'default/acc_1/dev_1'
    let streamPullResolve: (() => void) | null = null

    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/credentials`) {
        return jsonResponse({
          byok: { enabled: true, reason: '' },
          items: [
            {
              provider: 'openai',
              label: 'Org 1 OpenAI',
              base_url: '',
              key_hint: 'sk-...1111',
              model: 'gpt-5.4',
            },
          ],
        })
      }
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_2}/ai/credentials`) {
        return jsonResponse({
          byok: { enabled: true, reason: '' },
          items: [
            {
              provider: 'gemini',
              label: 'Org 2 Gemini',
              base_url: '',
              key_hint: 'AIza...2222',
              model: 'gemini-3.1-pro',
            },
          ],
        })
      }
      if (url.endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'gpt-5.4' }] })
      }
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/openai/chat/completions`) {
        const encoder = new TextEncoder()
        let firstChunkSent = false
        const stream = new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              if (!firstChunkSent) {
                firstChunkSent = true
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: 'part-1' }, finish_reason: null }] })}\n\n`,
                  ),
                )
                return
              }
              streamPullResolve?.()
              // Hold stream open until aborted by sign-out or org switch
              await new Promise<void>(() => {})
            },
          },
          { highWaterMark: 0 },
        )
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const host: UniworkKeysHost = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => activeOrg,
      sessionKey: () => session,
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
    })
    setUniworkKeysHost(host)
    await host.list()

    const s1 = await getSettings()
    expect(s1.modelSources?.openai?.origin).toBe('org')

    // Start a streaming turn that stays open after sending the first delta
    const firstChunkReady = new Promise<void>((resolve) => {
      streamPullResolve = resolve
    })
    const streamPromise = runStream({ ...s1, provider: 'openai' }, 'req-abort-signout')
    await firstChunkReady
    expect(host.activeStreamCount()).toBe(1)

    // Trigger org switch (ORG_1 -> ORG_2) via onAccountStatus
    activeOrg = ORG_2
    host.onAccountStatus({
      loggedIn: true,
      state: 'signed-in',
      org: { id: ORG_2, name: 'Org 2', slug: 'org-2', role: 'member' },
    } as AccountStatus)

    const chunks = await streamPromise
    expect(host.activeStreamCount()).toBe(0)
    expect(chunks.some((c) => c.type === 'delta' && c.text === 'part-1')).toBe(true)
    expect(chunks.at(-1)?.type).toBe('done')
    // ORG_1 cache was cleared immediately on org switch
    expect(host.hasOrgSource('openai')).toBe(false)

    // Reading settings now loads ORG_2's credentials (gemini)
    await host.list()
    const s2 = await getSettings()
    expect(s2.modelSources?.openai).toBeUndefined()
    expect(s2.modelSources?.gemini?.origin).toBe('org')

    // Sign-out clears ORG_2's cache as well
    activeOrg = null
    session = ''
    host.onAccountStatus({
      loggedIn: false,
      state: 'signed-out',
    } as AccountStatus)
    expect(host.hasOrgSource('gemini')).toBe(false)
  })

  it('404 credential_missing removes the provider and re-reads R1 immediately, while vendor 404 passes through', async () => {
    let r1Reads = 0
    let serverHasOpenAi = true
    let proxy404Mode: 'credential_missing' | 'vendor_404' = 'vendor_404'

    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/credentials`) {
        r1Reads++
        return jsonResponse({
          byok: { enabled: true, reason: '' },
          items: serverHasOpenAi
            ? [
                {
                  provider: 'openai',
                  label: 'OpenAI',
                  base_url: '',
                  key_hint: 'sk-...1234',
                  model: 'gpt-5.4',
                },
              ]
            : [],
        })
      }
      if (url.endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'gpt-5.4' }] })
      }
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/openai/chat/completions`) {
        if (proxy404Mode === 'vendor_404') {
          return jsonResponse(
            {
              error: {
                message: 'The model `gpt-5.4` does not exist',
                type: 'invalid_request_error',
                code: 'model_not_found',
              },
            },
            404,
          )
        }
        serverHasOpenAi = false
        return jsonResponse(
          { error: { code: 'credential_missing', message: 'No credential for openai' } },
          404,
        )
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      sessionKey: () => 'default/acc_1/dev_1',
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
    })
    setUniworkKeysHost(host)
    await host.list()

    const settings = await getSettings()
    expect(r1Reads).toBe(1)
    expect(host.hasOrgSource('openai')).toBe(true)

    // 1. Vendor 404 (code: 'model_not_found') passes through unchanged and does NOT drop the credential
    const vendorChunks = await runStream({ ...settings, provider: 'openai' }, 'req-vendor-404')
    expect(vendorChunks.at(-1)?.type).toBe('error')
    expect(host.hasOrgSource('openai')).toBe(true)
    expect(r1Reads).toBe(1)

    // 2. Proxy 404 (code: 'credential_missing') removes the provider and triggers an immediate R1 re-read
    proxy404Mode = 'credential_missing'
    const missingChunks = await runStream({ ...settings, provider: 'openai' }, 'req-cred-missing')
    const errChunk = missingChunks.find((c) => c.type === 'error')
    expect(errChunk).toBeDefined()
    expect(errChunk?.errorCode).toBeUndefined()
    expect(errChunk?.error).toContain('No AI key yet')
    expect(errChunk?.uniworkCode).toBeUndefined()
    expect(host.hasOrgSource('openai')).toBe(false)
    await vi.waitFor(() => {
      expect(r1Reads).toBe(2)
    })
  })

  it('maps §2.3 proxy statuses: 401 refresh+retry, 401 device_revoked, 403 entitlement_required, 424 provider_auth_failed, 429 Retry-After, 502 provider_unreachable, 400 base_url_refused', async () => {
    let clock = 1_000_000
    let chatResponseFactory: (token: string, attempt: number) => Response = () =>
      openAiSseResponse('ok')
    let chatAttempts = 0
    let revokedCount = 0

    const fetchMock: FetchLike = vi.fn(async (url, init = {}) => {
      const headers = recordHeaders(init.headers)
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/credentials`) {
        return jsonResponse({
          byok: { enabled: true, reason: '' },
          items: [
            {
              provider: 'openai',
              label: 'OpenAI',
              base_url: '',
              key_hint: 'sk-...1234',
              model: 'gpt-5.4',
            },
          ],
        })
      }
      if (url.endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'gpt-5.4' }] })
      }
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/openai/chat/completions`) {
        chatAttempts++
        const token = (headers.authorization ?? '').replace(/^Bearer\s+/i, '')
        return chatResponseFactory(token, chatAttempts)
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    // authorized() helper that refreshes once on TransportError('unauthorized')
    const authorized = vi.fn(async <T>(call: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await call(TOKEN_1)
      } catch (err) {
        if (err instanceof TransportError && err.code === 'unauthorized') {
          return call(TOKEN_2)
        }
        throw err
      }
    })

    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      sessionKey: () => 'default/acc_1/dev_1',
      authorized,
      fetch: fetchMock,
      now: () => clock,
      onDeviceRevoked: () => {
        revokedCount++
      },
    })
    setUniworkKeysHost(host)
    await host.list()

    const settings = await getSettings()
    const streamReq = { ...settings, provider: 'openai' as const }

    // 1. 401 unauthorized -> 1 refresh + retry with TOKEN_2 succeeds
    chatAttempts = 0
    chatResponseFactory = (token, attempt) => {
      if (attempt === 1) {
        expect(token).toBe(TOKEN_1)
        return jsonResponse({ error: { code: 'unauthorized' } }, 401)
      }
      expect(token).toBe(TOKEN_2)
      return openAiSseResponse('Refreshed and succeeded')
    }
    const retryChunks = await runStream(streamReq, 'req-401-retry')
    expect(chatAttempts).toBe(2)
    expect(
      retryChunks.some((c) => c.type === 'delta' && c.text === 'Refreshed and succeeded'),
    ).toBe(true)

    // 2. 424 provider_auth_failed -> invalid_key ("The AI key was refused")
    chatResponseFactory = () =>
      jsonResponse({ error: { code: 'provider_auth_failed', message: 'Upstream 401' } }, 424)
    const c424 = await runStream(streamReq, 'req-424')
    expect(c424.at(-1)).toMatchObject({
      type: 'error',
    })
    expect(c424.at(-1)?.error).toContain('The AI key was refused')

    // 3. 429 ai_rate_limited (the wire code) with Retry-After: 23 -> the wait in the line
    chatResponseFactory = () =>
      jsonResponse({ error: { code: 'ai_rate_limited', message: 'Rate limit exceeded' } }, 429, {
        'Retry-After': '23',
      })
    const c429 = await runStream(streamReq, 'req-429')
    expect(c429.at(-1)).toMatchObject({
      type: 'error',
    })
    expect(c429.at(-1)?.error).toContain('Wait 23 s and try again.')
    // the renderer's generic per-code texts would replace the wait time: no errorCode is sent
    expect(c429.at(-1)?.errorCode).toBeUndefined()
    expect(c429.at(-1)?.retryAfterSec).toBeUndefined()

    // 4. 502 provider_unreachable -> unreachable
    chatResponseFactory = () =>
      jsonResponse({ error: { code: 'provider_unreachable', message: 'Bad gateway' } }, 502)
    const c502 = await runStream(streamReq, 'req-502')
    expect(c502.at(-1)).toMatchObject({
      type: 'error',
    })
    expect(c502.at(-1)?.error).toContain('AI provider unreachable')

    // 5. 400 base_url_refused -> bad_url
    chatResponseFactory = () =>
      jsonResponse({ error: { code: 'base_url_refused', message: 'Private IP refused' } }, 400)
    const c400 = await runStream(streamReq, 'req-400')
    expect(c400.at(-1)).toMatchObject({
      type: 'error',
    })
    expect(c400.at(-1)?.error).toContain('This base URL is not allowed')

    // 6. 403 entitlement_required -> not_entitled and hides org sources until next list read
    chatResponseFactory = () =>
      jsonResponse({ error: { code: 'entitlement_required', message: 'Plan required' } }, 403)
    const c403 = await runStream(streamReq, 'req-403')
    expect(c403.at(-1)).toMatchObject({
      type: 'error',
    })
    expect(c403.at(-1)?.error).toContain('AI is not in your plan')
    expect(host.hasOrgSource('openai')).toBe(false)

    // Advance clock past CREDENTIALS_TTL_MS so next getSettings re-reads R1
    clock += CREDENTIALS_TTL_MS + 1_000
    await getSettings()
    await vi.waitFor(() => expect(host.hasOrgSource('openai')).toBe(true))

    // 7. 401 device_revoked -> clears cache immediately without retry and triggers onDeviceRevoked
    chatAttempts = 0
    chatResponseFactory = () =>
      jsonResponse({ error: { code: 'device_revoked', message: 'Device revoked' } }, 401)
    const cRevoked = await runStream(streamReq, 'req-revoked')
    expect(chatAttempts).toBe(1) // no retry on device_revoked
    expect(revokedCount).toBe(1)
    expect(host.hasOrgSource('openai')).toBe(false)
    expect(cRevoked.at(-1)).toMatchObject({
      type: 'error',
    })
    expect(cRevoked.at(-1)?.error).toContain('Session expired')
  })

  it('caches R5 model lists for 10 min per (orgId, provider) and re-lists when credential stamp changes', async () => {
    let clock = 500_000
    let keyHint = 'sk-...1111'
    let r5Reads = 0

    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/credentials`) {
        return jsonResponse({
          byok: { enabled: true, reason: '' },
          items: [
            {
              provider: 'openai',
              label: 'OpenAI',
              base_url: '',
              key_hint: keyHint,
              model: 'gpt-5.4',
              updated_at: '2026-10-14T10:00:00Z',
            },
          ],
        })
      }
      if (url === `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/openai/models`) {
        r5Reads++
        return jsonResponse({ data: [{ id: `gpt-model-${r5Reads}` }] })
      }
      throw new Error(`unexpected URL: ${url}`)
    })

    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      sessionKey: () => 'default/acc_1/dev_1',
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
      now: () => clock,
    })

    await host.list()
    host.sources()
    await vi.waitFor(() => {
      expect(host.sources().openai?.listed).toEqual(['gpt-model-1'])
    })

    // Within 10-min TTL: does not re-fetch R5
    clock += MODEL_LIST_TTL_MS - 1_000
    expect(host.sources().openai?.listed).toEqual(['gpt-model-1'])
    expect(r5Reads).toBe(1)

    // Rotating the key on UniWork changes key_hint -> invalidates R5 immediately
    keyHint = 'sk-...2222'
    await host.list({ force: true })
    host.sources()
    await vi.waitFor(() => {
      expect(host.sources().openai?.listed).toEqual(['gpt-model-2'])
    })
  })

  it('refuses non-HTTPS origins on stable channel and normalizes opencode-zen /v1/ paths', async () => {
    const insecureHost = createUniworkKeysHost({
      profile: () => ({
        ...PROFILE,
        apiOrigin: 'http://uniwork.example',
        channel: 'stable',
      }),
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
    })
    expect(insecureHost.byokBaseUrl('openai')).toBeNull()
    await expect(
      insecureHost.fetchFor('openai')(
        'http://uniwork.example/api/v1/orgs/o1/ai/byok/openai/models',
      ),
    ).rejects.toBeInstanceOf(UniworkKeyError)

    const seenUrls: string[] = []
    const zenHost = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
      fetch: async (url) => {
        seenUrls.push(url)
        return openAiSseResponse('zen')
      },
    })
    const zenBase = zenHost.byokBaseUrl('opencode-zen')!
    // OpenCode Zen adapter resolves `${baseUrl}/v1/chat/completions`; fetchFor normalizes it
    await zenHost.fetchFor('opencode-zen')(`${zenBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer should-be-stripped' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [], stream: true }),
    })
    expect(seenUrls).toEqual([
      `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok/opencode-zen/chat/completions`,
    ])
  })

  // ---- review round 1 (desktop main) ----

  const R1_URL = `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/credentials`
  const BYOK_URL = `${ORIGIN}/api/v1/orgs/${ORG_1}/ai/byok`

  const orgItem = (provider: string, extra: Record<string, unknown> = {}) => ({
    provider,
    label: '',
    base_url: '',
    key_hint: `${provider}-...abcd`,
    model:
      provider === 'anthropic'
        ? 'claude-sonnet-4-6'
        : provider === 'deepseek'
          ? 'deepseek-chat'
          : 'gpt-5.4',
    model_updated_at: '2026-10-11T08:00:00Z',
    created_at: '2026-10-09T08:00:00Z',
    updated_at: '2026-10-09T08:00:00Z',
    ...extra,
  })

  const r1Body = (items: unknown[]) => ({ byok: { enabled: true, reason: '' }, items })

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  it('ai:get-settings answers at once while R1 never answers (local keys only, no wait)', async () => {
    writeFileSync(
      join(dirs.userData, 'ai-settings.json'),
      JSON.stringify({
        provider: 'openai',
        providers: { openai: { apiKey: 'sk-local-openai-secret', model: 'gpt-5.4' } },
      }),
    )
    let r1Calls = 0
    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === R1_URL) {
        r1Calls++
        return new Promise<Response>(() => {})
      }
      if (url === 'https://api.openai.com/v1/models') return jsonResponse({ data: [] })
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    setUniworkKeysHost(
      createUniworkKeysHost({
        profile: () => PROFILE,
        orgId: () => ORG_1,
        authorized: async (call) => call(TOKEN_1),
        fetch: fetchMock,
      }),
    )

    const started = Date.now()
    const settings = await Promise.race([
      getSettings(),
      new Promise<'stalled'>((resolve) => setTimeout(() => resolve('stalled'), 1_000)),
    ])
    expect(settings).not.toBe('stalled')
    expect(Date.now() - started).toBeLessThan(1_000)
    const read = settings as AiSettings
    expect(read.modelSources?.openai?.chosen).toBe('gpt-5.4')
    expect(read.modelSources?.openai?.origin).toBeUndefined()
    expect(read.modelSources?.anthropic).toBeUndefined()
    expect(r1Calls).toBe(1)
  })

  it('a failing R1 costs one request per backoff window, and a landing R1 announces itself once', async () => {
    let clock = 2_000_000
    let r1Calls = 0
    let mode: 'throw' | 'answer' = 'throw'
    let release: (() => void) | null = null
    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === R1_URL) {
        r1Calls++
        if (mode === 'throw') throw new TypeError('fetch failed: ECONNRESET')
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return jsonResponse(r1Body([orgItem('anthropic')]))
      }
      if (url === `${BYOK_URL}/anthropic/models`) return jsonResponse({ data: [] })
      throw new Error(`unexpected URL: ${url}`)
    })
    let changed = 0
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
      now: () => clock,
      onChanged: () => {
        changed++
      },
    })
    setUniworkKeysHost(host)

    for (let i = 0; i < 10; i++) {
      await getSettings()
      await flush()
    }
    expect(r1Calls).toBe(1)

    // past the backoff the next read re-reads in the background; the read itself does not wait
    clock += CREDENTIALS_RETRY_MS + 1
    mode = 'answer'
    const first = await getSettings()
    expect(first.modelSources?.anthropic).toBeUndefined()
    await vi.waitFor(() => expect(release).not.toBeNull())
    release!()
    await vi.waitFor(() => expect(changed).toBe(1))
    expect(r1Calls).toBe(2)
    const next = await getSettings()
    expect(next.modelSources?.anthropic?.origin).toBe('org')
  })

  it('R1 429 / 5xx keep the last good list (no flap, Retry-After honoured); only 404 drops the source', async () => {
    let clock = 3_000_000
    let r1Calls = 0
    let answer: () => Response = () => jsonResponse(r1Body([orgItem('anthropic')]))
    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === R1_URL) {
        r1Calls++
        return answer()
      }
      if (url === `${BYOK_URL}/anthropic/models`) return jsonResponse({ data: [] })
      if (url === `${BYOK_URL}/anthropic/messages`) return anthropicSseResponse('still proxied')
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    let changed = 0
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
      now: () => clock,
      onChanged: () => {
        changed++
      },
    })
    setUniworkKeysHost(host)
    await host.list()
    expect(host.hasOrgSource('anthropic')).toBe(true)
    const changedAfterLoad = changed

    clock += CREDENTIALS_TTL_MS + 1
    answer = () => jsonResponse({ error: { code: 'internal' } }, 500)
    await host.list()
    expect(host.hasOrgSource('anthropic')).toBe(true)

    clock += CREDENTIALS_RETRY_MS + 1
    answer = () => jsonResponse({ error: { code: 'rate_limited' } }, 429, { 'Retry-After': '120' })
    await host.list()
    expect(host.hasOrgSource('anthropic')).toBe(true)
    expect(changed).toBe(changedAfterLoad)
    const callsAt429 = r1Calls
    clock += 60_000
    await host.list()
    expect(r1Calls).toBe(callsAt429)

    const settings = await getSettings()
    const chunks = await runStream({ ...settings, provider: 'anthropic' }, 'req-kept')
    expect(chunks.some((c) => c.type === 'delta' && c.text === 'still proxied')).toBe(true)

    clock += 61_000
    answer = () => jsonResponse({ error: { code: 'not_found' } }, 404)
    const beforeDrop = changed
    await host.list()
    expect(host.hasOrgSource('anthropic')).toBe(false)
    expect(changed).toBe(beforeDrop + 1)
  })

  it('a vendor 402 / 503 / 400 passes through; only a UniWork-coded 503 is a proxy state', async () => {
    let answer: () => Response = () => openAiSseResponse('ok')
    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === R1_URL) return jsonResponse(r1Body([orgItem('openai')]))
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      if (url === `${BYOK_URL}/openai/chat/completions`) return answer()
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
    })
    setUniworkKeysHost(host)
    await host.list()
    const proxied = host.fetchFor('openai')
    const post = { method: 'POST', body: '{}' }

    answer = () => jsonResponse({ error: { message: 'Insufficient Balance' } }, 402)
    expect((await proxied(`${BYOK_URL}/openai/chat/completions`, post)).status).toBe(402)
    const settings = await getSettings()
    const c402 = await runStream({ ...settings, provider: 'openai' }, 'req-vendor-402')
    expect(c402.at(-1)?.type).toBe('error')
    expect(c402.at(-1)?.error).not.toContain('credits_exhausted')
    expect(c402.at(-1)?.error).not.toContain('AI credits used up')

    answer = () => jsonResponse({ error: { type: 'overloaded_error', message: 'busy' } }, 503)
    expect((await proxied(`${BYOK_URL}/openai/chat/completions`, post)).status).toBe(503)

    answer = () =>
      jsonResponse(
        { error: { message: 'max_tokens too large', type: 'invalid_request_error' } },
        400,
      )
    expect((await proxied(`${BYOK_URL}/openai/chat/completions`, post)).status).toBe(400)

    answer = () => jsonResponse({ error: { code: 'ai_credentials_unavailable' } }, 503)
    const refused = await proxied(`${BYOK_URL}/openai/chat/completions`, post).catch((e) => e)
    expect(refused).toBeInstanceOf(UniworkKeyError)
    expect((refused as UniworkKeyError).code).toBe('keys_unavailable')
    expect((refused as UniworkKeyError).describe('en')).toContain('Keys on UniWork unavailable')
    expect((refused as UniworkKeyError).describe('vi')).toContain(
      'Chưa dùng được khóa trên UniWork',
    )
  })

  it('ai:chat and ai:settings-test use the org key through the proxy for an org-only provider', async () => {
    const calls: RecordedCall[] = []
    const fetchMock: FetchLike = vi.fn(async (url, init = {}) => {
      calls.push({ url, init, headers: recordHeaders(init.headers) })
      if (url === R1_URL) return jsonResponse(r1Body([orgItem('anthropic')]))
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      if (url === `${BYOK_URL}/anthropic/messages`) {
        const body = JSON.parse(String(init.body ?? '{}')) as { stream?: boolean }
        return body.stream
          ? anthropicSseResponse('OK')
          : jsonResponse({ content: [{ type: 'text', text: 'One-shot answer' }] })
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
    })
    setUniworkKeysHost(host)
    await host.list()
    const settings = { ...(await getSettings()), provider: 'anthropic' as const }

    const chat = (await handlers.get('ai:chat')!(
      { sender: { id: 101 } },
      { settings, system: 's', user: 'hello' },
    )) as { ok: boolean; content?: string; error?: string }
    expect(chat.ok).toBe(true)
    expect(chat.content).toContain('One-shot answer')

    const test = (await handlers.get('ai:settings-test')!(
      { sender: { id: 101 } },
      { settings, system: '', user: '' },
    )) as { ok: boolean }
    expect(test.ok).toBe(true)

    const proxyCalls = calls.filter((c) => c.url === `${BYOK_URL}/anthropic/messages`)
    expect(proxyCalls).toHaveLength(2)
    for (const call of proxyCalls) {
      expect(call.headers.authorization).toBe(`Bearer ${TOKEN_1}`)
      expect(call.headers['x-api-key']).toBeUndefined()
    }
  })

  it('Settings save round trip: no org model in ai-settings.json, server model newer-wins, a local key or slot is kept', async () => {
    let serverModel = 'claude-sonnet-4-6'
    let serverAt = '2026-10-11T08:00:00Z'
    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === R1_URL) {
        return jsonResponse(
          r1Body([
            orgItem('anthropic', { model: serverModel, model_updated_at: serverAt }),
            orgItem('custom', { base_url: 'https://llm.example/v1' }),
          ]),
        )
      }
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    // custom holds a key typed on this computer but no base URL yet: it stays local (incomplete)
    const stored = {
      provider: 'anthropic',
      providers: { custom: { apiKey: 'sk-local-custom', model: 'my-model', baseUrl: '' } },
    }
    writeFileSync(join(dirs.userData, 'ai-settings.json'), JSON.stringify(stored))
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
    })
    setUniworkKeysHost(host)
    await host.list()

    const first = await getSettings()
    expect(first.modelSources?.anthropic).toMatchObject({
      origin: 'org',
      chosen: 'claude-sonnet-4-6',
    })
    expect(first.modelSources?.custom).toBeUndefined()
    await setSettings(first)
    const afterSave = readStoredSettings()
    expect(afterSave.providers.anthropic?.model).not.toBe('claude-sonnet-4-6')
    expect(afterSave.providers.custom?.apiKey).toBe('sk-local-custom')

    // a model changed on the web (newer model_updated_at) is followed
    serverModel = 'claude-opus-4-7'
    serverAt = '2026-10-12T08:00:00Z'
    await host.list({ force: true })
    expect((await getSettings()).modelSources?.anthropic?.chosen).toBe('claude-opus-4-7')

    // a pick on this computer (now) is newer than the server's
    const current = await getSettings()
    await setSettings(
      {
        ...current,
        providers: {
          ...current.providers,
          anthropic: { ...current.providers.anthropic, model: 'claude-haiku-4-5' },
        },
      },
      pickMarker('anthropic', 'claude-haiku-4-5'),
    )
    expect((await getSettings()).modelSources?.anthropic?.chosen).toBe('claude-haiku-4-5')
    expect(readStoredSettings().providers.anthropic?.model).toBe(
      afterSave.providers.anthropic?.model,
    )

    // a later change on the web wins again
    serverModel = 'claude-sonnet-4-7'
    serverAt = new Date(Date.now() + 60_000).toISOString()
    await host.list({ force: true })
    expect((await getSettings()).modelSources?.anthropic?.chosen).toBe('claude-sonnet-4-7')

    // typing a key for the org-served provider saves it, and the local key wins from then on
    const typed = await getSettings()
    await setSettings({
      ...typed,
      providers: {
        ...typed.providers,
        anthropic: { apiKey: 'sk-ant-typed-locally', model: 'claude-sonnet-5' },
      },
    })
    expect(readStoredSettings().providers.anthropic?.apiKey).toBe('sk-ant-typed-locally')
    expect((await getSettings()).modelSources?.anthropic?.origin).toBeUndefined()
  })

  it('never replaces globalThis.fetch, works without a fetch dependency, and keeps concurrent streams apart', async () => {
    writeFileSync(
      join(dirs.userData, 'ai-settings.json'),
      JSON.stringify({
        provider: 'openai',
        providers: { openai: { apiKey: 'sk-local-openai-secret', model: 'gpt-5.4' } },
      }),
    )
    const calls: RecordedCall[] = []
    let arrived = 0
    let openGate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    let mode: 'barrier' | 'fail' = 'barrier'
    const original = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, init, headers: recordHeaders(init.headers) })
      // the global is never swapped while a proxied call runs
      expect(globalThis.fetch).toBe(original)
      if (url === R1_URL) return jsonResponse(r1Body([orgItem('anthropic'), orgItem('deepseek')]))
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      if (mode === 'fail') return jsonResponse({ error: { code: 'provider_auth_failed' } }, 424)
      if (url === 'https://api.openai.com/v1/chat/completions') return openAiSseResponse('local')
      // both org turns stay open until the local turn has run in between them
      arrived++
      await gate
      if (url === `${BYOK_URL}/anthropic/messages`) return anthropicSseResponse('org-anthropic')
      if (url === `${BYOK_URL}/deepseek/chat/completions`) return openAiSseResponse('org-deepseek')
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = original as typeof globalThis.fetch
    // no `fetch` dependency: the host uses globalThis.fetch like production
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
    })
    setUniworkKeysHost(host)
    await host.list()
    const settings = await getSettings()
    expect(globalThis.fetch).toBe(original)

    const orgTurns = Promise.all([
      runStream({ ...settings, provider: 'anthropic' }, 'req-c-anthropic'),
      runStream({ ...settings, provider: 'deepseek' }, 'req-c-deepseek'),
    ])
    await vi.waitFor(() => expect(arrived).toBe(2))
    // a local turn started while two org turns are open must not see their scoped fetch
    const local = await runStream({ ...settings, provider: 'openai' }, 'req-c-local')
    openGate!()
    const [anthropic, deepseek] = await orgTurns
    expect(local.some((c) => c.type === 'delta' && c.text === 'local')).toBe(true)
    expect(anthropic.some((c) => c.type === 'delta' && c.text === 'org-anthropic')).toBe(true)
    expect(deepseek.some((c) => c.type === 'delta' && c.text === 'org-deepseek')).toBe(true)
    expect(globalThis.fetch).toBe(original)

    const direct = calls.filter((c) => c.url === 'https://api.openai.com/v1/chat/completions')
    expect(direct).toHaveLength(1)
    expect(direct[0]!.headers.authorization).toBe('Bearer sk-local-openai-secret')
    for (const url of [`${BYOK_URL}/anthropic/messages`, `${BYOK_URL}/deepseek/chat/completions`]) {
      const proxied = calls.filter((c) => c.url === url)
      expect(proxied, url).toHaveLength(1)
      expect(proxied[0]!.headers.authorization).toBe(`Bearer ${TOKEN_1}`)
    }
    expect(
      calls
        .filter((c) => c.headers.authorization === `Bearer ${TOKEN_1}`)
        .every((c) => c.url.startsWith(`${ORIGIN}/`)),
    ).toBe(true)

    // a failed org turn leaves the global as it was too
    mode = 'fail'
    const failed = await runStream({ ...settings, provider: 'anthropic' }, 'req-c-fail')
    expect(failed.at(-1)?.type).toBe('error')
    expect(globalThis.fetch).toBe(original)
  })

  it('keeps the device bearer out of stream errors and logs, and refuses redirects on R1 and proxy calls', async () => {
    const calls: RecordedCall[] = []
    const fetchMock: FetchLike = vi.fn(async (url, init = {}) => {
      calls.push({ url, init, headers: recordHeaders(init.headers) })
      if (url === R1_URL) return jsonResponse(r1Body([orgItem('openai')]))
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      return jsonResponse({ error: { code: 'provider_auth_failed', message: 'Upstream 401' } }, 424)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const host = createUniworkKeysHost({
        profile: () => PROFILE,
        orgId: () => ORG_1,
        authorized: async (call) => call(TOKEN_1),
        fetch: fetchMock,
      })
      setUniworkKeysHost(host)
      await host.list()
      const settings = await getSettings()
      const chunks = await runStream({ ...settings, provider: 'openai' }, 'req-no-leak')
      expect(chunks.at(-1)?.error).toContain('The AI key was refused')
      expect(JSON.stringify(chunks)).not.toContain(TOKEN_1)
      expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN_1)
      expect(warn).toHaveBeenCalled()
      const r1 = calls.find((c) => c.url === R1_URL)
      const proxy = calls.find((c) => c.url === `${BYOK_URL}/openai/chat/completions`)
      expect(r1?.init.redirect).toBe('error')
      expect(proxy?.init.redirect).toBe('error')
    } finally {
      warn.mockRestore()
    }
  })

  it('reads R5 model ids like a direct listing (Gemini non-chat models dropped, list capped)', async () => {
    const geminiBody = {
      models: [
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-9', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/aqa', supportedGenerationMethods: ['generateAnswer'] },
        ...Array.from({ length: 3000 }, (_, i) => ({ name: `models/g-${i}` })),
      ],
    }
    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === R1_URL) return jsonResponse(r1Body([orgItem('gemini', { model: '' })]))
      if (url === `${BYOK_URL}/gemini/models`) return jsonResponse(geminiBody)
      throw new Error(`unexpected URL: ${url}`)
    })
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
    })
    await host.list()
    const viaProxy = await host.listModels('gemini')

    globalThis.fetch = vi.fn(async () => jsonResponse(geminiBody)) as typeof globalThis.fetch
    const direct = await listProviderModels('gemini', { apiKey: 'k', model: '' })
    expect(direct.ok).toBe(true)
    expect(viaProxy).toEqual(direct.ids)
    expect(viaProxy).not.toContain('text-embedding-9')
    expect(viaProxy).not.toContain('aqa')
    expect(viaProxy.length).toBeLessThanOrEqual(2000)
  })

  it('device_revoked tells the account once and backs R1 off; a 401 that is not from UniWork keeps the source', async () => {
    let clock = 4_000_000
    let r1Calls = 0
    let r1Answer: () => Response = () => jsonResponse(r1Body([orgItem('openai')]))
    let proxyAnswer: () => Response = () => openAiSseResponse('ok')
    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === R1_URL) {
        r1Calls++
        return r1Answer()
      }
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      if (url === `${BYOK_URL}/openai/chat/completions`) return proxyAnswer()
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    // the shell's authorized(): one refresh + retry on `unauthorized`, anything else rethrown
    const authorized = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await call(TOKEN_1)
      } catch (err) {
        if (!(err instanceof TransportError) || err.code !== 'unauthorized') throw err
      }
      return call(TOKEN_2)
    }
    let revoked = 0
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized,
      fetch: fetchMock,
      now: () => clock,
      onDeviceRevoked: () => {
        revoked++
      },
    })
    setUniworkKeysHost(host)
    await host.list()
    const settings = await getSettings()

    // a gateway / captive portal 401 (no UniWork body), twice: this call fails, the source stays
    proxyAnswer = () => new Response('<html>login</html>', { status: 401 })
    const gateway = await runStream({ ...settings, provider: 'openai' }, 'req-gw-401')
    expect(gateway.at(-1)?.type).toBe('error')
    expect(host.hasOrgSource('openai')).toBe(true)

    // the server says the device is revoked on R1
    clock += CREDENTIALS_TTL_MS + 1
    r1Answer = () => jsonResponse({ error: { code: 'device_revoked' } }, 401)
    await host.list()
    expect(revoked).toBe(1)
    expect(host.hasOrgSource('openai')).toBe(false)
    const callsAfterRevoke = r1Calls
    for (let i = 0; i < 10; i++) {
      await getSettings()
      await flush()
    }
    expect(r1Calls).toBe(callsAfterRevoke)
    expect(revoked).toBe(1)
  })

  // ---- fx2: explicit pick marker (G05KSH-13, G05KFE-14) ----

  it('records exactly the picked model: the default, A then the default, never a plain echo', async () => {
    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === R1_URL) {
        return jsonResponse(
          r1Body([orgItem('anthropic', { model: 'claude-opus-4-7' }), orgItem('openai')]),
        )
      }
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    writeFileSync(
      join(dirs.userData, 'ai-settings.json'),
      JSON.stringify({
        provider: 'anthropic',
        providers: { anthropic: { apiKey: '', model: '' } },
      }),
    )
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
    })
    setUniworkKeysHost(host)
    await host.list()

    const loaded = await getSettings()
    // the stored slot holds the provider default (blank slot filled), the server row another model
    const slotModel = loaded.providers.anthropic.model
    expect(slotModel).not.toBe('')
    expect(slotModel).not.toBe('claude-opus-4-7')
    expect(loaded.modelSources?.anthropic?.chosen).toBe('claude-opus-4-7')

    // a plain echo of the loaded settings records nothing
    await setSettings(loaded)
    await setSettings(loaded, { includeUniworkPick: true })
    expect((await getSettings()).modelSources?.anthropic?.chosen).toBe('claude-opus-4-7')

    // picking the model the stored slot already holds is a pick (the old diff could not see it)
    await setSettings(withModel(loaded, 'anthropic', slotModel), pickMarker('anthropic', slotModel))
    expect((await getSettings()).modelSources?.anthropic?.chosen).toBe(slotModel)

    // pick A, then the default again: the default wins, not the earlier A
    await setSettings(
      withModel(loaded, 'anthropic', 'claude-haiku-4-5'),
      pickMarker('anthropic', 'claude-haiku-4-5'),
    )
    expect((await getSettings()).modelSources?.anthropic?.chosen).toBe('claude-haiku-4-5')
    await setSettings(withModel(loaded, 'anthropic', slotModel), pickMarker('anthropic', slotModel))
    expect((await getSettings()).modelSources?.anthropic?.chosen).toBe(slotModel)

    // a renderer writing providers[id].model without the marker changes nothing, and the file keeps its slot
    await setSettings(withModel(loaded, 'anthropic', 'claude-haiku-4-5'))
    expect((await getSettings()).modelSources?.anthropic?.chosen).toBe(slotModel)
    expect(readStoredSettings().providers.anthropic?.model).toBe(slotModel)
  })

  it('ignores a pick that does not belong to an org-served provider or is malformed', async () => {
    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === R1_URL)
        return jsonResponse(r1Body([orgItem('anthropic', { model: 'claude-opus-4-7' })]))
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    writeFileSync(
      join(dirs.userData, 'ai-settings.json'),
      JSON.stringify({
        provider: 'anthropic',
        providers: { anthropic: { apiKey: '', model: '' } },
      }),
    )
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
    })
    setUniworkKeysHost(host)
    await host.list()
    const loaded = await getSettings()
    const bad: unknown[] = [
      pickMarker('openai', 'gpt-5.4'), // no org source for openai
      pickMarker('nope', 'x'),
      pickMarker('anthropic', '   '),
      { modelPick: { provider: 'anthropic', model: 7 } },
      { modelPick: 'anthropic' },
      { modelPick: null },
      pickMarker('anthropic', 'm'.repeat(201)),
    ]
    for (const options of bad)
      await setSettings(withModel(loaded, 'anthropic', 'claude-haiku-4-5'), options)
    expect((await getSettings()).modelSources?.anthropic?.chosen).toBe('claude-opus-4-7')
    expect(host.chosenModelFor('openai')).not.toBe('gpt-5.4')

    // a key typed for the provider wins over the marker: the key is saved, nothing is recorded
    await setSettings(
      {
        ...loaded,
        providers: {
          ...loaded.providers,
          anthropic: { apiKey: 'sk-ant-typed', model: 'claude-sonnet-5' },
        },
      },
      pickMarker('anthropic', 'claude-haiku-4-5'),
    )
    expect(readStoredSettings().providers.anthropic?.apiKey).toBe('sk-ant-typed')
    expect(host.chosenModelFor('anthropic')).toBe('claude-opus-4-7')
  })

  // ---- fx2: R1 backoff, custom slot, picks per account, timeout (G05KSH-16..19) ----

  it('keeps a keyless custom endpoint typed on this computer when an org custom key exists', async () => {
    const fetchMock: FetchLike = vi.fn(async (url) => {
      if (url === R1_URL) {
        return jsonResponse(r1Body([orgItem('custom', { base_url: 'https://llm.example/v1' })]))
      }
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    writeFileSync(
      join(dirs.userData, 'ai-settings.json'),
      JSON.stringify({
        provider: 'custom',
        providers: { custom: { apiKey: '', model: 'my-model' } },
      }),
    )
    const host = createUniworkKeysHost({
      profile: () => PROFILE,
      orgId: () => ORG_1,
      authorized: async (call) => call(TOKEN_1),
      fetch: fetchMock,
    })
    setUniworkKeysHost(host)
    await host.list()
    const loaded = await getSettings()
    expect(loaded.modelSources?.custom?.origin).toBe('org')

    // an echo keeps the stored slot (no endpoint appears)
    await setSettings(loaded)
    expect(readStoredSettings().providers.custom?.baseUrl ?? '').toBe('')

    // a local endpoint typed without a key is saved and wins from then on
    await setSettings({
      ...loaded,
      providers: {
        ...loaded.providers,
        custom: { apiKey: '', model: 'my-model', baseUrl: 'http://127.0.0.1:1234/v1' },
      },
    })
    expect(readStoredSettings().providers.custom?.baseUrl).toBe('http://127.0.0.1:1234/v1')
    expect((await getSettings()).modelSources?.custom?.origin).toBeUndefined()
  })

})
