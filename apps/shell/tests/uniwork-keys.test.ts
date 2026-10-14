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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import {
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
          default_model: 'gpt-4o-mini',
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
          default_model: 'gpt-4o-mini',
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
          default_model: 'claude-sonnet-4-6',
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
    expect(enabled.items[0]?.defaultModel).toBe('claude-sonnet-4-6')
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
              default_model: 'claude-sonnet-4-6',
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

    const settings = await getSettings()
    expect(settings.modelSources?.anthropic?.origin).toBe('org')
    expect(settings.modelSources?.anthropic?.chosen).toBe('claude-sonnet-4-6')
    // key_hint and bearer token must NEVER appear in renderer-visible apiKey
    expect(settings.providers.anthropic.apiKey).toBe('')
    expect(JSON.stringify(settings)).not.toContain('sk-ant-...abcd')
    expect(JSON.stringify(settings)).not.toContain(TOKEN_1)
    // In-memory model reflects credential.default_model when no local model was saved
    expect(settings.providers.anthropic.model).toBe('claude-sonnet-4-6')
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

  it('local model pick in ai-settings.json overrides credential.default_model without needing a local apiKey', async () => {
    writeFileSync(
      join(dirs.userData, 'ai-settings.json'),
      JSON.stringify({
        provider: 'anthropic',
        providers: {
          anthropic: { apiKey: '', model: 'claude-haiku-4-5' },
        },
      }),
    )

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
              default_model: 'claude-sonnet-4-6',
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

    const settings = await getSettings()
    expect(settings.modelSources?.anthropic?.origin).toBe('org')
    expect(settings.modelSources?.anthropic?.chosen).toBe('claude-haiku-4-5')
    expect(settings.providers.anthropic.model).toBe('claude-haiku-4-5')

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
              default_model: 'gpt-4o-mini',
              updated_at: '2026-10-14T10:00:00Z',
            },
            {
              provider: 'anthropic',
              label: 'Org Anthropic',
              base_url: '',
              key_hint: 'sk-ant-...2222',
              default_model: 'claude-sonnet-4-6',
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
              default_model: 'gpt-5.4',
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
              default_model: 'gpt-5.4',
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
              default_model: 'gemini-3.1-pro',
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
                  default_model: 'gpt-5.4',
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
    expect(errChunk?.errorCode).toBe('invalid_key')
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
              default_model: 'gpt-5.4',
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
      errorCode: 'invalid_key',
    })
    expect(c424.at(-1)?.error).toContain('The AI key was refused')

    // 3. 429 rate_limited with Retry-After: 23 -> rate_limit + retryAfterSec: 23
    chatResponseFactory = () =>
      jsonResponse({ error: { code: 'rate_limited', message: 'Rate limit exceeded' } }, 429, {
        'Retry-After': '23',
      })
    const c429 = await runStream(streamReq, 'req-429')
    expect(c429.at(-1)).toMatchObject({
      type: 'error',
      errorCode: 'rate_limit',
      retryAfterSec: 23,
    })
    expect(c429.at(-1)?.error).toContain('Wait 23 s and try again.')

    // 4. 502 provider_unreachable -> unreachable
    chatResponseFactory = () =>
      jsonResponse({ error: { code: 'provider_unreachable', message: 'Bad gateway' } }, 502)
    const c502 = await runStream(streamReq, 'req-502')
    expect(c502.at(-1)).toMatchObject({
      type: 'error',
      errorCode: 'unreachable',
    })
    expect(c502.at(-1)?.error).toContain('AI provider unreachable')

    // 5. 400 base_url_refused -> bad_url
    chatResponseFactory = () =>
      jsonResponse({ error: { code: 'base_url_refused', message: 'Private IP refused' } }, 400)
    const c400 = await runStream(streamReq, 'req-400')
    expect(c400.at(-1)).toMatchObject({
      type: 'error',
      errorCode: 'bad_url',
    })
    expect(c400.at(-1)?.error).toContain('This base URL is not allowed')

    // 6. 403 entitlement_required -> not_entitled and hides org sources until next list read
    chatResponseFactory = () =>
      jsonResponse({ error: { code: 'entitlement_required', message: 'Plan required' } }, 403)
    const c403 = await runStream(streamReq, 'req-403')
    expect(c403.at(-1)).toMatchObject({
      type: 'error',
      errorCode: 'not_entitled',
    })
    expect(c403.at(-1)?.error).toContain('AI is not in your plan')
    expect(host.hasOrgSource('openai')).toBe(false)

    // Advance clock past CREDENTIALS_TTL_MS so next getSettings re-reads R1
    clock += CREDENTIALS_TTL_MS + 1_000
    await getSettings()
    expect(host.hasOrgSource('openai')).toBe(true)

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
      errorCode: 'invalid_key',
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
              default_model: 'gpt-5.4',
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
    host.sources(undefined)
    await vi.waitFor(() => {
      expect(host.sources(undefined).openai?.listed).toEqual(['gpt-model-1'])
    })

    // Within 10-min TTL: does not re-fetch R5
    clock += MODEL_LIST_TTL_MS - 1_000
    expect(host.sources(undefined).openai?.listed).toEqual(['gpt-model-1'])
    expect(r5Reads).toBe(1)

    // Rotating the key on UniWork changes key_hint -> invalidates R5 immediately
    keyHint = 'sk-...2222'
    await host.list({ force: true })
    host.sources(undefined)
    await vi.waitFor(() => {
      expect(host.sources(undefined).openai?.listed).toEqual(['gpt-model-2'])
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
})
