// Web AI bridge (CONTRACT C16): contract shapes, frame-token auth + 401 refresh, error mapping,
// the UniWork AI turn, the off/on member switch, the in-frame state card. The frame runs UniWork AI
// only (UNI-2289): no key store, no BYOK proxy, no provider choice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getUniworkCloudStatus,
  setUniworkCloudStatus,
} from '../../../../packages/ai-provider/src/uniwork-cloud'
import { aiRouteBase, createAiWebClient, readCloudStatus } from './client'
import {
  AI_WEB_ERROR_CODES,
  AiWebError,
  aiErrorCodeFor,
  aiErrorFromResponse,
  errorBodyFields,
  retryAfterSeconds,
  uniworkFailureKey,
} from './errors'
import {
  setUniworkAiAvailable,
  uniworkAiAvailable,
} from '../../../../packages/ai-provider/src/providers'
import { uniworkConversations } from '../../../../packages/ai-provider/src/uniwork/conversation'
import { UniworkError } from '../../../../packages/ai-provider/src/uniwork/errors'
import { createAiRunTracker, type AiRunTracker } from '../ai-run'
import { createWebAiStreams } from './stream'
import { aiHostGrants, createWebAi, mediaFromUrl, withWebAi } from './web-ai'
import { describeAiError, hideAiState, showAiState } from './ui'

const ORIGIN = 'https://app.test'
const BASE = `${ORIGIN}/api/v1/office-frame/documents/doc-1/ai`

interface Call {
  url: string
  init: RequestInit
}

function jsonResponse(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function sseResponse(lines: string[], headers: Record<string, string> = {}): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l))
      c.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  })
}

/** one finished UniWork AI answer of the frame route, as the server streams it */
function uniworkOk(): Response {
  const chunk = {
    choices: [{ index: 0, delta: { content: 'Done.' }, finish_reason: 'stop' }],
    x_uniwork: { step: 0, limit: 8 },
  }
  return sseResponse([`data: ${JSON.stringify(chunk)}\n\n`, 'data: [DONE]\n\n'], {
    'X-UniWork-AI-Conversation': 'conv-1',
    'X-UniWork-AI-Run': 'run-1',
  })
}

function tokens(first = 'tok-1', next = 'tok-2') {
  return {
    getToken: vi.fn(async () => first),
    refreshToken: vi.fn(async () => next),
  }
}

function recorder(answer: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init }
    calls.push(call)
    return answer(call, calls.length)
  }) as unknown as typeof globalThis.fetch
  return { calls, fetch }
}

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name)

/** a frame port whose session grants `caps`; `withToken` = false is the headless entry */
function port(caps: Record<string, boolean> | undefined, withToken = true, module?: string) {
  return {
    whenInitialized: async () => ({
      documentId: 'doc-1',
      apiBase: 'https://app.test/api/v1',
      ...(caps ? { capabilities: caps } : {}),
      ...(module ? { module } : {}),
    }),
    ...(withToken ? tokens() : {}),
  }
}

const CLOUD = {
  enabled: true,
  tools: {
    web_search: true,
    image_search: false,
    image_generate: true,
    media_analyze: true,
    transcribe: true,
  },
  credits: { unit: 'ai.tokens', used: 10, limit: 100, remaining: 90, period_end: null },
}

afterEach(() => {
  setUniworkAiAvailable(false)
  setUniworkCloudStatus(null)
  uniworkConversations.clear()
  hideAiState()
  document.body.replaceChildren()
})

describe('routes', () => {
  it('puts the frame-token AI mount on the frame origin, from either apiBase spelling', () => {
    expect(aiRouteBase('https://app.test/api/v1', 'doc-1', ORIGIN)).toBe(BASE)
    expect(aiRouteBase('https://app.test/api', 'doc-1', ORIGIN)).toBe(BASE)
    expect(aiRouteBase('/api/v1/', 'doc-1', ORIGIN)).toBe(BASE)
    // another API origin in apiBase: still same origin (connect-src 'self')
    expect(aiRouteBase('https://api.other.test/api/v1', 'd/2', ORIGIN)).toBe(
      `${ORIGIN}/api/v1/office-frame/documents/d%2F2/ai`,
    )
  })
})

describe('client', () => {
  it('sends the frame token as Bearer, never cookies, and reads the contract shapes', async () => {
    const { calls, fetch } = recorder(() => jsonResponse(200, CLOUD))
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: 'https://app.test/api/v1',
      tokens: tokens(),
      origin: ORIGIN,
      fetch,
    })
    const cloud = await client.cloudStatus()
    expect(cloud.tools.image_search).toBe(false)
    expect(cloud.credits).toMatchObject({ limit: 100, remaining: 90 })
    expect(calls[0]!.url).toBe(`${BASE}/cloud`)
    expect(header(calls[0]!, 'authorization')).toBe('Bearer tok-1')
    expect(calls[0]!.init.credentials).toBe('omit')
    expect(calls[0]!.init.mode).toBe('same-origin')
  })

  it('has no key store and no provider listing: only the cloud tools and the UniWork AI routes', () => {
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: '/api',
      tokens: tokens(),
      origin: ORIGIN,
      fetch: recorder(() => jsonResponse(200, {})).fetch,
    })
    for (const gone of ['listCredentials', 'saveCredential', 'deleteCredential', 'json']) {
      expect(client, gone).not.toHaveProperty(gone)
    }
  })

  it('refreshes the token once after a 401 and retries', async () => {
    const t = tokens('old', 'new')
    const { calls, fetch } = recorder((_c, n) =>
      n === 1 ? jsonResponse(401, { code: 'unauthorized' }) : jsonResponse(200, CLOUD),
    )
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: '/api',
      tokens: t,
      origin: ORIGIN,
      fetch,
    })
    await client.cloudStatus()
    expect(t.refreshToken).toHaveBeenCalledWith('unauthorized')
    expect(calls.map((c) => header(c, 'authorization'))).toEqual(['Bearer old', 'Bearer new'])
  })

  it('a second 401 is the typed `unauthorized` state', async () => {
    const { fetch } = recorder(() => jsonResponse(401, { code: 'unauthorized' }))
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: '/api',
      tokens: tokens(),
      origin: ORIGIN,
      fetch,
    })
    await expect(client.cloudStatus()).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it.each([
    [402, 'credits_exhausted', 'credits_exhausted'],
    [403, 'entitlement_required', 'entitlement_required'],
    // no key store behind these routes: the old key codes are no state of their own
    [404, 'credential_missing', 'unknown'],
    [424, 'provider_auth_failed', 'unknown'],
    [502, 'provider_unreachable', 'provider_unreachable'],
    [503, 'cloud_unavailable', 'cloud_unavailable'],
    [400, 'base_url_refused', 'bad_request'],
    [400, 'provider_not_supported', 'bad_request'],
    [400, 'invalid_request', 'bad_request'],
    [500, 'internal', 'unknown'],
  ])('maps HTTP %i %s to %s', async (status, code, typed) => {
    const { fetch } = recorder(() => jsonResponse(status, { code, message: 'server text' }))
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: '/api',
      tokens: tokens(),
      origin: ORIGIN,
      fetch,
    })
    const err = await client.search({ query: 'q', kind: 'web' }).catch((e) => e)
    expect(err).toBeInstanceOf(AiWebError)
    expect(err.code).toBe(typed)
    expect(err.status).toBe(status)
  })

  it('maps 429 with retry-after (seconds or date)', async () => {
    expect(aiErrorCodeFor(429)).toBe('rate_limited')
    expect(retryAfterSeconds('7')).toBe(7)
    expect(retryAfterSeconds(new Date(Date.now() + 3000).toUTCString())).toBeGreaterThanOrEqual(2)
    const { fetch } = recorder(
      () => new Response('slow down', { status: 429, headers: { 'retry-after': '12' } }),
    )
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: '/api',
      tokens: tokens(),
      origin: ORIGIN,
      fetch,
    })
    await expect(client.generateImage({ prompt: 'p' })).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSec: 12,
    })
  })

  it('refuses to send the token outside the AI mount', async () => {
    const { fetch } = recorder(() => jsonResponse(200, {}))
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: '/api',
      tokens: tokens(),
      origin: ORIGIN,
      fetch,
    })
    await expect(client.fetch('https://api.openai.com/v1/chat/completions')).rejects.toBeInstanceOf(
      AiWebError,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses path traversal, encoded slashes and other origins that still start with the mount string', async () => {
    const { fetch } = recorder(() => jsonResponse(200, {}))
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: '/api',
      tokens: tokens(),
      origin: ORIGIN,
      fetch,
    })
    for (const path of [
      `${BASE}/../../../me`,
      `${BASE}/%2e%2e/%2e%2e/x`,
      `${BASE}/cloud%2f..%2f..%2fx`,
      `${BASE}\\..\\x`,
      `${BASE.replace('app.test', 'app.test.evil.test')}/cloud`,
    ]) {
      await expect(client.fetch(path), path).rejects.toBeInstanceOf(AiWebError)
    }
    expect(fetch).not.toHaveBeenCalled()
    // a normal route below the mount still goes out
    await client.fetch(`${BASE}/cloud`)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reads a sparse cloud status leniently', () => {
    expect(readCloudStatus({ enabled: false, reason: 'entitlement_required' })).toMatchObject({
      enabled: false,
      reason: 'entitlement_required',
      tools: { web_search: false },
      credits: { limit: null, remaining: null },
    })
  })

  it('reads the code and message from the wrapped and the flat error body', async () => {
    expect(errorBodyFields({ error: { code: 'a', message: 'b' } })).toEqual({
      code: 'a',
      message: 'b',
    })
    expect(errorBodyFields({ code: 'a', message: 'b' })).toEqual({ code: 'a', message: 'b' })
    expect(errorBodyFields({ error: { message: 'only' } })).toEqual({})
    expect(errorBodyFields('x')).toEqual({})
    const err = await aiErrorFromResponse(
      jsonResponse(400, { error: { code: 'invalid_request', message: 'm' } }),
    )
    expect(err).toMatchObject({ code: 'bad_request', serverCode: 'invalid_request' })
  })
})

describe('members (off = as today, on = UniWork routes)', () => {
  const stubs = {
    getAiSettings: vi.fn(async () => ({ provider: 'genspark', providers: {} })),
    webSearch: vi.fn(async () => ({
      results: [],
      method: 'error',
      error: 'ai-unavailable: web search',
    })),
    aiStream: vi.fn(async () => {}),
    onAiStream: vi.fn(() => () => {}),
  }

  beforeEach(() => {
    for (const s of Object.values(stubs)) s.mockClear()
  })

  it('aiHostGrants: tools need the UniWork AI grant too; nothing without it', () => {
    expect(aiHostGrants(undefined)).toEqual({
      ai: false,
      uniworkAi: false,
      webSearch: false,
      imageSearch: false,
      imageGeneration: false,
    })
    expect(aiHostGrants({ webSearch: true, imageGeneration: true })).toMatchObject({
      ai: false,
      webSearch: false,
    })
    expect(aiHostGrants({ uniworkAi: true, webSearch: true })).toEqual({
      ai: true,
      uniworkAi: true,
      webSearch: true,
      imageSearch: false,
      imageGeneration: false,
    })
  })

  it('without the UniWork AI grant every member is the module stub and no request is made (the old ai grant alone opens nothing)', async () => {
    const { fetch } = recorder(() => jsonResponse(200, {}))
    const ai = createWebAi({
      port: port({ ai: true, webSearch: true }),
      capabilities: {},
      fetch,
      origin: ORIGIN,
    })
    const api = withWebAi({ ...stubs }, ai)
    expect(await ai.active()).toBe(false)
    expect(await (api.webSearch as (q: string) => Promise<unknown>)('q')).toMatchObject({
      method: 'error',
    })
    expect(stubs.webSearch).toHaveBeenCalled()
    await (api.getAiSettings as () => Promise<unknown>)()
    expect(stubs.getAiSettings).toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a port without a frame token (headless) keeps AI off even with the grant', async () => {
    const ai = createWebAi({ port: port({ uniworkAi: true }, false), capabilities: {} })
    expect(await ai.active()).toBe(false)
  })

  it('with the grant: UniWork AI settings, cloud switches, search shapes', async () => {
    const { calls, fetch } = recorder((c) => {
      if (c.url.endsWith('/cloud')) return jsonResponse(200, CLOUD)
      if (c.url.endsWith('/cloud/search')) {
        return jsonResponse(200, {
          results: [{ title: 'T', url: 'https://x.test/a', snippet: 'S' }],
          answer: 'A',
        })
      }
      if (c.url.endsWith('/cloud/images')) {
        return jsonResponse(200, {
          images: [{ mime: 'image/png', data_base64: 'AAAA' }],
          model: 'm',
        })
      }
      return jsonResponse(404, { code: 'not_found' })
    })
    const grants = { uniworkAi: true, webSearch: true, imageSearch: true, imageGeneration: true }
    const capabilities: Record<string, unknown> = { ai: true, ...grants }
    const ai = createWebAi({ port: port(grants), capabilities, fetch, origin: ORIGIN })
    const api = withWebAi({ ...stubs }, ai)
    const settings = (await (api.getAiSettings as () => Promise<Record<string, unknown>>)()) as {
      provider: string
      providers: Record<string, { apiKey: string }>
      gskToolsEnabled: boolean
    }
    expect(settings.provider).toBe('uniwork')
    expect(Object.keys(settings.providers)).toEqual(['uniwork'])
    expect(settings.gskToolsEnabled).toBe(true)
    // GET cloud says image_search is not available: its capability goes off
    expect(capabilities.imageSearch).toBe(false)
    expect(capabilities.webSearch).toBe(true)
    // GO-A7's ai-provider gates read the process-wide status: published from the same answer
    expect(getUniworkCloudStatus()).toMatchObject({
      state: 'ready',
      enabled: true,
      tools: { web_search: true, image_search: false, image_generate: true },
    })
    setUniworkCloudStatus(null)
    const web = await (api.webSearch as (q: string, n: number) => Promise<unknown>)('cats', 50)
    expect(web).toEqual({
      results: [{ title: 'T', url: 'https://x.test/a', snippet: 'S' }],
      answer: 'A',
      method: 'uniwork',
    })
    const search = calls.find((c) => c.url.endsWith('/cloud/search'))!
    expect(JSON.parse(String(search.init.body))).toEqual({
      query: 'cats',
      kind: 'web',
      max_results: 10,
    })
    const img = await (api.aiGenerateImage as (o: object) => Promise<unknown>)({
      prompt: 'a cat',
      aspectRatio: '1:1',
    })
    expect(img).toEqual({ url: 'data:image/png;base64,AAAA' })
    expect(stubs.webSearch).not.toHaveBeenCalled()
    expect(await (api.aiGskStatus as () => Promise<unknown>)()).toEqual({ loggedIn: true })
    // every request went to the cloud tools
    expect(calls.every((c) => c.url.startsWith(`${BASE}/cloud`))).toBe(true)
  })

  it('a 402 on a cloud tool returns the module error shape with the typed text and a card that offers no settings', async () => {
    const { fetch } = recorder((c) =>
      c.url.endsWith('/cloud')
        ? jsonResponse(200, CLOUD)
        : jsonResponse(402, { code: 'credits_exhausted' }),
    )
    const ai = createWebAi({
      port: port({ uniworkAi: true, webSearch: true }),
      capabilities: { ai: true, uniworkAi: true, webSearch: true },
      fetch,
      origin: ORIGIN,
    })
    const api = withWebAi({ ...stubs }, ai)
    const r = await (api.webSearch as (q: string) => Promise<{ method: string; error: string }>)(
      'q',
    )
    expect(r.method).toBe('error')
    expect(r.error).toBe(
      describeAiError(new AiWebError({ code: 'credits_exhausted', status: 402 })),
    )
    const card = document.querySelector('[data-ai-state="credits_exhausted"]')!
    expect(card).not.toBeNull()
    expect([...card.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Close'])
  })

  it('a 403 before the first run turns the panel off: one quiet turn, no route but the UniWork AI one', async () => {
    const { calls, fetch } = recorder((c) =>
      c.url.endsWith('/uniwork/chat/completions')
        ? jsonResponse(403, { code: 'office_capability_off', message: 'off' })
        : jsonResponse(200, CLOUD),
    )
    // an older host still sends the old `ai` grant beside `uniworkAi`
    const capabilities: Record<string, unknown> = { ai: true, uniworkAi: true }
    const ai = createWebAi({
      port: port({ ai: true, uniworkAi: true }),
      capabilities,
      fetch,
      origin: ORIGIN,
    })
    const api = withWebAi({ ...stubs }, ai)
    const changed = vi.fn()
    ai.onChanged(changed)
    const chunks: Array<{ type: string }> = []
    ;(api.onAiStream as (h: (c: { type: string }) => void) => () => void)((c) => chunks.push(c))
    await (api.aiStream as (r: object) => Promise<void>)({
      requestId: 'off-1',
      sessionId: 'sess-off',
      settings: { provider: 'uniwork', providers: {} },
      system: 's',
      messages: [{ role: 'user', text: 'hi' }],
    })
    expect(capabilities.ai).toBe(false)
    expect(capabilities.uniworkAi).toBe(false)
    expect(changed).toHaveBeenCalled()
    // the note is the whole answer (the adapter's activity pings aside): no error chunk
    expect(chunks.filter((c) => c.type !== 'ping').map((c) => c.type)).toEqual(['notice', 'done'])
    expect(document.querySelector('.ow-ai-state')).toBeNull()
    expect(new Set(calls.map((c) => c.url.slice(BASE.length)))).toEqual(
      new Set(['/cloud', '/uniwork/chat/completions']),
    )
  })

  it('the model chip manage row, the AI settings entry and the sign-in prompt open nothing while AI is on', async () => {
    const stub = vi.fn(async () => {})
    const { calls, fetch } = recorder(() => jsonResponse(200, CLOUD))
    const on = createWebAi({
      port: port({ uniworkAi: true }),
      capabilities: { ai: true, uniworkAi: true },
      fetch,
      origin: ORIGIN,
    })
    const api = withWebAi({ ...stubs, openAiModelSettings: stub, openAiSettings: stub }, on)
    expect(await on.active()).toBe(true)
    await (api.openAiModelSettings as () => Promise<void>)()
    await (api.openAiSettings as () => Promise<void>)()
    // the module's own members answer: there is no key dialog to open
    expect(stub).toHaveBeenCalledTimes(2)
    // the web viewer is always signed in: the prompt resolves at once
    await expect((api.aiGskLogin as () => Promise<unknown>)()).resolves.toBeUndefined()
    expect(document.querySelector('[data-office-web="ai-settings"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(calls.every((c) => c.url === `${BASE}/cloud`)).toBe(true)
  })

  it('reads data: URLs as media bytes only', () => {
    expect(mediaFromUrl('data:image/png;base64,QUJD')).toEqual({
      mime: 'image/png',
      data_base64: 'QUJD',
    })
    expect(mediaFromUrl('https://x.test/a.png')).toBeNull()
  })
})

describe('in-frame UI', () => {
  it('one typed state card at a time, and no state offers AI settings (there are no keys to fix)', () => {
    showAiState(new AiWebError({ code: 'rate_limited', status: 429, retryAfterSec: 5 }))
    let card: HTMLElement | null = null
    for (const code of AI_WEB_ERROR_CODES) {
      card = showAiState(new AiWebError({ code, status: 0 }))
      expect(document.querySelectorAll('.ow-ai-state')).toHaveLength(1)
      expect(card.dataset.aiState).toBe(code)
      expect(
        [...card.querySelectorAll('button')].map((b) => b.textContent),
        code,
      ).toEqual(['Close'])
    }
    ;(card!.querySelector('button') as HTMLButtonElement).click()
    expect(document.querySelector('.ow-ai-state')).toBeNull()
  })

  it('every error code has its own text, and the codes are the UniWork AI routes ones only', () => {
    expect([...AI_WEB_ERROR_CODES]).toEqual([
      'credits_exhausted',
      'entitlement_required',
      'rate_limited',
      'provider_unreachable',
      'cloud_unavailable',
      'cloud_outage',
      'unauthorized',
      'bad_request',
      'unknown',
    ])
    const texts = AI_WEB_ERROR_CODES.map((code) =>
      describeAiError(new AiWebError({ code, status: 0 })),
    )
    expect(new Set(texts).size).toBe(texts.length)
    for (const t of texts) {
      expect(t).not.toMatch(/aiWeb/)
      expect(t).not.toMatch(/\bkey\b/i)
    }
  })
})

describe('installModuleBridge wiring', () => {
  it('AI members only on globals that have them; the UniWork AI grant turns the keys on', async () => {
    const { installModuleBridge } = await import('../../../docs/bridge/module-bridge')
    const { createMockPort } = await import('../../../docs/bridge/testing/mock-port')
    const { fetch } = recorder(() => jsonResponse(200, CLOUD))
    vi.stubGlobal('fetch', fetch)
    const mock = createMockPort({ documentId: 'doc-1' })
    const ownStream = vi.fn(async () => {})
    const target: Record<string, unknown> = {}
    const { capabilities } = installModuleBridge({
      module: 'markdown',
      frameCapabilities: { save: true },
      client: { ...mock.port, ...tokens() },
      target,
      globals: {
        markdownApi: () => ({ aiStream: ownStream, getAiSettings: async () => null }),
        other: () => ({}),
      },
    })
    expect(capabilities).toMatchObject({ ai: false })
    expect(typeof (target.markdownApi as Record<string, unknown>).aiGskLogin).toBe('function')
    expect(Object.prototype.hasOwnProperty.call(target.other, 'aiGskLogin')).toBe(false)
    mock.init({ apiBase: '/api/v1', capabilities: { uniworkAi: true, webSearch: true } })
    await vi.waitFor(() => expect(capabilities.ai).toBe(true))
    expect(capabilities).toMatchObject({
      uniworkAi: true,
      webSearch: true,
      imageGeneration: false,
    })
    vi.unstubAllGlobals()
  })
})

describe('UniWork AI on the web (G6-05)', () => {
  const ROUTE = `${BASE}/uniwork/chat/completions`

  type FakeStream = NonNullable<
    NonNullable<Parameters<typeof createWebAiStreams>[0]['uniwork']>['stream']
  >

  const wire = (extra: Record<string, string> = {}) => ({
    headers: { 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
  })

  interface Rig {
    s: ReturnType<typeof createWebAiStreams>
    calls: Call[]
    chunks: Array<Record<string, unknown>>
    onOff: ReturnType<typeof vi.fn>
    stream: ReturnType<typeof vi.fn>
    runIds: string[]
  }

  function rig(
    script: FakeStream,
    opts: {
      answer?: (c: Call) => Response
      aiRun?: AiRunTracker
      cloudTools?: boolean
      scope?: object | null
    } = {},
  ): Rig {
    const { calls, fetch } = recorder((c) =>
      (opts.answer ?? (() => jsonResponse(200, {}, { 'X-UniWork-AI-Run': 'run-srv-1' })))(c),
    )
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: 'https://app.test/api/v1',
      tokens: tokens(),
      origin: ORIGIN,
      fetch,
    })
    const onOff = vi.fn()
    const stream = vi.fn(script)
    const runIds: string[] = []
    const aiRun = opts.aiRun
      ? Object.assign(opts.aiRun, { setRunId: (id: string) => runIds.push(id) })
      : undefined
    const s = createWebAiStreams({
      client,
      ...(aiRun ? { aiRun } : {}),
      uniwork: {
        scope: () =>
          opts.scope === undefined
            ? { kind: 'frame', documentId: 'doc-1', format: 'docx' }
            : (opts.scope as never),
        cloudTools: () => opts.cloudTools ?? false,
        describeFailure: (f) => `uniwork:${f.code}`,
        onOff,
        stream: stream as unknown as FakeStream,
      },
    })
    const chunks: Array<Record<string, unknown>> = []
    s.onAiStream((c) => chunks.push(c as never))
    return { s, calls, chunks, onOff, stream, runIds }
  }

  const uniworkTurn = (s: Rig['s'], id = 'u1', extra: object = {}) =>
    s.aiStream({
      requestId: id,
      sessionId: 'sess-1',
      settings: { provider: 'uniwork', providers: { uniwork: { apiKey: '…', model: '' } } },
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'edit_doc', description: 'd', parameters: { type: 'object' } }],
      ...extra,
    } as never)

  const failure = (
    code: string,
    status: number,
    more: { retryAfterSec?: number; runId?: string } = {},
  ) => new UniworkError(code as never, { status, ...more })

  describe('Grant formula', () => {
    it('aiHostGrants: only the UniWork AI grant opens the panel, the old ai grant opens nothing, no key settings entry', () => {
      expect(aiHostGrants({ ai: true, uniworkAi: false })).toMatchObject({ ai: false })
      const on = aiHostGrants({ uniworkAi: true })
      expect(on).toEqual({
        ai: true,
        uniworkAi: true,
        webSearch: false,
        imageSearch: false,
        imageGeneration: false,
      })
      expect(on).not.toHaveProperty('aiCredentials')
      // a cloud tool follows its own grant, under the UniWork AI one only
      expect(aiHostGrants({ uniworkAi: true, webSearch: true })).toMatchObject({
        ai: true,
        webSearch: true,
      })
      expect(aiHostGrants({ ai: true, imageSearch: true })).toMatchObject({
        ai: false,
        imageSearch: false,
      })
      // the tool grants alone still open nothing
      expect(aiHostGrants({ webSearch: true })).toMatchObject({ ai: false, webSearch: false })
    })

    it('the frame claims uniworkAi', async () => {
      const { AI_FRAME_CAPABILITIES } = await import('./web-ai')
      expect(AI_FRAME_CAPABILITIES.uniworkAi).toBe(true)
    })
  })

  describe('client.uniworkChat', () => {
    it('posts to the frame route with the frame token and returns the raw Response', async () => {
      const { calls, fetch } = recorder(() =>
        jsonResponse(409, { code: 'conversation_expired' }, { 'X-UniWork-AI-Run': 'r1' }),
      )
      const client = createAiWebClient({
        documentId: 'doc-1',
        apiBase: '/api/v1',
        tokens: tokens(),
        origin: ORIGIN,
        fetch,
      })
      const res = await client.uniworkChat({ ...wire({ 'X-UniWork-AI-Conversation': 'c1' }) })
      // a non-2xx answer is NOT thrown here: the adapter branches on status and code itself
      expect(res.status).toBe(409)
      expect(res.headers.get('X-UniWork-AI-Run')).toBe('r1')
      expect(calls[0]!.url).toBe(ROUTE)
      expect(calls[0]!.url).not.toContain('/byok/')
      expect(calls[0]!.init.method).toBe('POST')
      expect(header(calls[0]!, 'authorization')).toBe('Bearer tok-1')
      expect(header(calls[0]!, 'x-uniwork-ai-conversation')).toBe('c1')
      expect(calls[0]!.init.credentials).toBe('omit')
    })

    it('refreshes the token once after a 401 and retries the same turn', async () => {
      const t = tokens('old', 'new')
      const { calls, fetch } = recorder((_c, n) =>
        n === 1 ? jsonResponse(401, { code: 'unauthorized' }) : jsonResponse(200, {}),
      )
      const client = createAiWebClient({
        documentId: 'doc-1',
        apiBase: '/api/v1',
        tokens: t,
        origin: ORIGIN,
        fetch,
      })
      const res = await client.uniworkChat(wire())
      expect(res.status).toBe(200)
      expect(calls.map((c) => header(c, 'authorization'))).toEqual(['Bearer old', 'Bearer new'])
    })
  })

  describe('aiStream uniwork branch', () => {
    it('goes through the frame route, never the BYOK proxy, and reports the server run id', async () => {
      const sent: Array<{ state: string }> = []
      const aiRun = createAiRunTracker({ report: (p) => sent.push(p), graceMs: 0 })
      const r = rig(
        async (transport, request, cb) => {
          const res = await transport.post({
            scope: request.scope,
            ...wire(),
            signal: cb.signal,
          })
          expect(res.status).toBe(200)
          cb.onDelta('hello')
        },
        { aiRun },
      )
      await uniworkTurn(r.s)
      expect(r.calls.map((c) => c.url)).toEqual([ROUTE])
      expect(r.runIds).toEqual(['run-srv-1'])
      expect(r.chunks.filter((c) => c.type === 'delta')).toEqual([
        { requestId: 'u1', type: 'delta', text: 'hello' },
      ])
      expect(r.chunks.at(-1)).toEqual({ requestId: 'u1', type: 'done' })
      expect(sent.map((p) => p.state)).toEqual(['running', 'idle'])
    })

    it('hands the adapter the frame scope, the loop history, the module tools and the cloud policy', async () => {
      const r = rig(async () => {}, { cloudTools: true })
      await uniworkTurn(r.s)
      const [, request, cb] = r.stream.mock.calls[0]!
      expect(request).toMatchObject({
        scope: { kind: 'frame', documentId: 'doc-1', format: 'docx' },
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'edit_doc' }],
        toolPolicy: { cloudTools: true },
      })
      expect(cb.sessionId).toBe('sess-1')
    })

    const WRITER = { kind: 'docs.write_document', input: { plan: 'intro, body' } }
    it.each([
      ['summary', {}],
      ['one-shot', {}],
      // a writer is only ever a one-shot: the loop's summary never names one
      ['summary', { writer: WRITER }],
    ])(
      'a %s request (not an agent turn, no writer) is refused with unsupported before any request',
      async (purpose, extra) => {
        const r = rig(async () => {})
        await uniworkTurn(r.s, 'u1', { purpose, ...extra })
        expect(r.stream).not.toHaveBeenCalled()
        expect(r.calls).toHaveLength(0)
        expect(r.chunks).toHaveLength(1)
        expect(r.chunks[0]).toMatchObject({ type: 'error', uniworkCode: 'unsupported' })
      },
    )

    it('a one-shot with a writer goes to the writer route in the open run, never the chat route', async () => {
      uniworkConversations.update('sess-1', { conversationId: 'conv-w', runId: 'run-w' })
      try {
        const r = rig(async () => {}, {
          answer: () =>
            sseResponse([
              `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '<p>hi</p>' } }] })}\n\n`,
              `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
              'data: [DONE]\n\n',
            ]),
        })
        await uniworkTurn(r.s, 'u1', { purpose: 'one-shot', writer: WRITER })
        expect(r.stream).not.toHaveBeenCalled()
        expect(r.calls.map((c) => c.url)).toEqual([`${BASE}/uniwork/write`])
        expect(header(r.calls[0]!, 'x-uniwork-ai-run')).toBe('run-w')
        expect(header(r.calls[0]!, 'x-uniwork-ai-conversation')).toBe('conv-w')
        expect(JSON.parse(String(r.calls[0]!.init.body))).toEqual({ ...WRITER, lang: 'en' })
        expect(r.chunks).toEqual([
          { requestId: 'u1', type: 'delta', text: '<p>hi</p>' },
          { requestId: 'u1', type: 'done' },
        ])
      } finally {
        uniworkConversations.forget('sess-1')
      }
    })

    it('passes the adapter notices and a turn reset on to the panel, in order', async () => {
      const r = rig(async (_t, _req, cb) => {
        cb.onDelta('partial')
        cb.onNotice?.({ kind: 'rate-limit-wait', seconds: 120, attempt: 1 })
        cb.onTurnReset?.()
        cb.onDelta('whole')
        cb.onNotice?.({ kind: 'step', step: 1, limit: 12 })
      })
      await uniworkTurn(r.s)
      expect(r.chunks.map((c) => c.type)).toEqual([
        'delta',
        'notice',
        'reset',
        'delta',
        'notice',
        'done',
      ])
      expect(r.chunks[1]).toMatchObject({
        notice: { kind: 'rate-limit-wait', seconds: 120, attempt: 1 },
      })
      // a wait is a notice, never an error
      expect(r.chunks.some((c) => c.type === 'error')).toBe(false)
    })

    it.each([
      ['run_limit_reached', 409, undefined],
      ['credits_exhausted', 402, undefined],
      ['entitlement_required', 403, undefined],
      ['ai_provider_error', 502, undefined],
      ['rate_limited', 429, 301],
    ])(
      'a %s failure (%i) is one error chunk with the code, in the failure text',
      async (code, status, retry) => {
        const r = rig(async () => {
          throw failure(code, status, retry ? { retryAfterSec: retry } : {})
        })
        await uniworkTurn(r.s)
        const err = r.chunks.at(-1)!
        expect(err).toMatchObject({ type: 'error', error: `uniwork:${code}`, uniworkCode: code })
        if (retry) expect(err.retryAfterSec).toBe(retry)
        // never the BYOK classifier's `overloaded`, and no floating card
        expect(err.errorCode).toBeUndefined()
        expect(document.querySelector('.ow-ai-state')).toBeNull()
      },
    )

    it('UniWork AI off before any run: hides the entry, asks the panel for no error chip', async () => {
      const r = rig(async (_t, _req, cb) => {
        cb.onNotice?.({ kind: 'uniwork-off' })
        throw failure('office_capability_off', 403)
      })
      await uniworkTurn(r.s)
      expect(r.onOff).toHaveBeenCalledTimes(1)
      expect(r.chunks.find((c) => c.type === 'notice')).toMatchObject({
        notice: { kind: 'uniwork-off' },
      })
      // the turn ends quietly: the note is the whole message, never an error chunk
      expect(r.chunks.map((c) => c.type)).toEqual(['notice', 'done'])
      expect(r.chunks.at(-1)!.type).toBe('done')
      expect(document.querySelector('.ow-ai-state')).toBeNull()
    })

    it('a frame without the UniWork scope answers as off, sends nothing', async () => {
      const r = rig(async () => {}, { scope: null })
      await uniworkTurn(r.s)
      expect(r.stream).not.toHaveBeenCalled()
      expect(r.calls).toEqual([])
      expect(r.onOff).toHaveBeenCalledTimes(1)
      expect(r.chunks.map((c) => c.type)).toEqual(['notice', 'done'])
      expect(r.chunks.some((c) => c.type === 'error')).toBe(false)
    })

    it('a chat turn is a running turn until it ends: aiRun running, then one idle (X-02, S6)', async () => {
      const sent: string[] = []
      const aiRun = createAiRunTracker({ report: (p) => sent.push(p.state), graceMs: 0 })
      const r = rig(
        async (_t, _req, cb) => {
          cb.onDelta('x')
        },
        { aiRun },
      )
      const turn = uniworkTurn(r.s, 'run1')
      expect(aiRun.running()).toBe(true)
      await turn
      expect(aiRun.running()).toBe(false)
      expect(sent).toEqual(['running', 'idle'])
    })

    it('a turn that cannot start (no UniWork AI scope, a refused purpose) is not a running turn; a stopped one ends the run', async () => {
      const sent: string[] = []
      const aiRun = createAiRunTracker({ report: (p) => sent.push(p.state), graceMs: 0 })
      await uniworkTurn(rig(async () => {}, { aiRun, scope: null }).s, 'r0')
      await uniworkTurn(rig(async () => {}, { aiRun }).s, 'r1', { purpose: 'summary' })
      expect(sent).toEqual([])
      // a turn that hangs until it is cancelled (the "stop to reload" path)
      const hang = rig(
        (_t, _req, cb) =>
          new Promise<void>((_resolve, reject) =>
            cb.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            ),
          ),
        { aiRun },
      )
      const turn = uniworkTurn(hang.s, 'r2')
      await new Promise((r) => setTimeout(r, 0))
      expect(aiRun.running()).toBe(true)
      await aiRun.stop()
      await turn
      expect(aiRun.running()).toBe(false)
      expect(sent).toEqual(['running', 'idle'])
    })

    it('every turn is a UniWork AI turn: a vendor provider left in the settings never reaches a vendor route', async () => {
      const r = rig(async (transport, request, cb) => {
        await transport.post({ scope: request.scope, ...wire(), signal: cb.signal })
      })
      await r.s.aiStream({
        requestId: 'v1',
        sessionId: 'sess-1',
        settings: { provider: 'openai', providers: { openai: { apiKey: 'sk-x', model: 'gpt-x' } } },
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
      } as never)
      expect(r.stream).toHaveBeenCalledTimes(1)
      expect(r.calls.map((c) => c.url)).toEqual([ROUTE])
      expect(JSON.stringify(r.calls[0]!.init)).not.toContain('sk-x')
      expect(r.chunks.at(-1)).toEqual({ requestId: 'v1', type: 'done' })
    })

    it('aiChat (one-shot) has no UniWork AI route: its failure text, nothing sent', async () => {
      const r = rig(async () => {})
      for (const provider of ['uniwork', 'openai']) {
        expect(
          await r.s.aiChat({
            settings: { provider, providers: {} } as never,
            system: 's',
            user: 'u',
          }),
        ).toEqual({ ok: false, error: 'uniwork:ai_disabled' })
      }
      expect(r.calls).toEqual([])
      expect(r.stream).not.toHaveBeenCalled()
    })

    describe('uniwork turn: one idle per ending path', () => {
      const paths: Array<[string, FakeStream]> = [
        ['done', async () => {}],
        [
          'error',
          async () => {
            throw failure('ai_provider_error', 502)
          },
        ],
        [
          '401',
          async () => {
            throw failure('session_expired', 401)
          },
        ],
        [
          'disconnect',
          async () => {
            throw new TypeError('Failed to fetch')
          },
        ],
        [
          '429 give-up',
          async () => {
            throw failure('ai_rate_limited', 429)
          },
        ],
        [
          'wait, then 429 give-up',
          async (_t, _req, cb) => {
            cb.onNotice?.({ kind: 'rate-limit-wait', seconds: 5, attempt: 1 })
            cb.onTurnReset?.()
            throw failure('ai_rate_limited', 429)
          },
        ],
        [
          'session lost after a wait',
          async (_t, _req, cb) => {
            cb.onNotice?.({ kind: 'rate-limit-wait', seconds: 5, attempt: 1 })
            cb.onTurnReset?.()
            throw failure('session_expired', 401)
          },
        ],
        [
          'session lost mid-stream (sign-out)',
          async (_t, _req, cb) => {
            cb.onDelta('partial')
            throw failure('session_expired', 401)
          },
        ],
        [
          'UniWork AI off before a run id (a note, then a quiet done)',
          async (_t, _req, cb) => {
            cb.onNotice?.({ kind: 'uniwork-off' })
            throw failure('office_capability_off', 403)
          },
        ],
      ]
      it.each(paths)('%s', async (_name, script) => {
        const sent: string[] = []
        const aiRun = createAiRunTracker({ report: (p) => sent.push(p.state), graceMs: 0 })
        const r = rig(script, { aiRun })
        await uniworkTurn(r.s)
        expect(sent).toEqual(['running', 'idle'])
        expect(aiRun.running()).toBe(false)
        expect(r.chunks.filter((c) => c.type === 'done' || c.type === 'error')).toHaveLength(1)
      })

      it('Stop ends the run with one idle and a done', async () => {
        const sent: string[] = []
        const aiRun = createAiRunTracker({ report: (p) => sent.push(p.state), graceMs: 0 })
        const r = rig(
          (_t, _req, cb) =>
            new Promise<void>((_resolve, reject) =>
              cb.signal.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              ),
            ),
          { aiRun },
        )
        const turn = uniworkTurn(r.s)
        expect(aiRun.running()).toBe(true)
        await r.s.aiStreamCancel('u1')
        await turn
        expect(sent).toEqual(['running', 'idle'])
        expect(r.chunks.at(-1)).toEqual({ requestId: 'u1', type: 'done' })
      })

      it('a Retry-After wait inside the adapter keeps the run running, one idle at the end', async () => {
        vi.useFakeTimers()
        try {
          const sent: string[] = []
          const aiRun = createAiRunTracker({ report: (p) => sent.push(p.state), graceMs: 0 })
          const r = rig(
            async (_t, _req, cb) => {
              cb.onNotice?.({ kind: 'rate-limit-wait', seconds: 120, attempt: 1 })
              await new Promise((resolve) => setTimeout(resolve, 120_000))
              cb.onDelta('after the wait')
            },
            { aiRun },
          )
          const turn = uniworkTurn(r.s)
          await vi.advanceTimersByTimeAsync(119_000)
          expect(sent).toEqual(['running'])
          await vi.advanceTimersByTimeAsync(2_000)
          await turn
          expect(sent).toEqual(['running', 'idle'])
        } finally {
          vi.useRealTimers()
        }
      })
    })
  })

  describe('createWebAi with uniworkAi', () => {
    const uniworkPort = (caps: Record<string, boolean>, module?: string) => port(caps, true, module)

    it('settings name UniWork AI only: one provider, an unlocked slot, the model the server names', async () => {
      const { fetch } = recorder(() =>
        jsonResponse(200, { ...CLOUD, uniwork_model: 'claude-opus-5' }),
      )
      const ai = createWebAi({
        port: uniworkPort({ ai: true, uniworkAi: true }),
        capabilities: { ai: true, uniworkAi: true },
        fetch,
        origin: ORIGIN,
      })
      expect(await ai.active()).toBe(true)
      const s = await ai.settings()
      expect(s.provider).toBe('uniwork')
      expect(Object.keys(s.providers)).toEqual(['uniwork'])
      // not locked: the picker sees a non-empty slot; the server's policy picks the model
      expect(s.providers.uniwork).toEqual({ apiKey: '…', model: '' })
      expect(s.uniworkModel).toBe('claude-opus-5')
      expect(s.uniAiAvailable).toBe(false)
      expect(s.modelSources).toBeUndefined()
    })

    it('activation, settings, a turn and a return to the tab touch only the cloud status and the UniWork AI routes', async () => {
      const { calls, fetch } = recorder((c) =>
        c.url === ROUTE ? uniworkOk() : jsonResponse(200, CLOUD),
      )
      // an older host still sends the old `ai` grant beside `uniworkAi`
      const grants = { ai: true, uniworkAi: true, webSearch: true }
      const ai = createWebAi({
        port: uniworkPort(grants),
        capabilities: { ...grants },
        fetch,
        origin: ORIGIN,
      })
      const api = withWebAi({}, ai)
      expect(await ai.active()).toBe(true)
      await ai.settings()
      const chunks: Array<{ type: string }> = []
      ;(api.onAiStream as (h: (c: { type: string }) => void) => () => void)((c) => chunks.push(c))
      await (api.aiStream as (r: object) => Promise<void>)({
        requestId: 'q1',
        sessionId: 'sess-routes',
        settings: { provider: 'uniwork', providers: {} },
        system: 's',
        messages: [{ role: 'user', text: 'hi' }],
      })
      expect(chunks.at(-1)!.type).toBe('done')
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
      await new Promise((r) => setTimeout(r, 0))
      await ai.settings()
      const paths = calls.map((c) => c.url.slice(BASE.length))
      expect(paths).toContain('/cloud')
      expect(paths).toContain('/uniwork/chat/completions')
      expect(paths.filter((p) => p !== '/cloud' && !p.startsWith('/uniwork/'))).toEqual([])
      expect(calls.filter((c) => /\/ai\/(credentials|byok\/)/.test(c.url))).toEqual([])
    })

    it('uniworkAi alone with no cloud-tool grant still shows the model the server names, and leaves the tools off', async () => {
      const { fetch } = recorder(() =>
        jsonResponse(200, { ...CLOUD, uniwork_model: 'claude-opus-5' }),
      )
      const capabilities: Record<string, unknown> = { ai: true, uniworkAi: true }
      const ai = createWebAi({
        port: uniworkPort({ uniworkAi: true }),
        capabilities,
        fetch,
        origin: ORIGIN,
      })
      const s = await ai.settings()
      expect(s.provider).toBe('uniwork')
      expect(s.uniworkModel).toBe('claude-opus-5')
      // the cloud switches are only applied for a frame that was granted a tool
      expect(capabilities).toEqual({ ai: true, uniworkAi: true })
    })

    it('uniworkAi alone, the status read fails: the plain name, nothing breaks', async () => {
      const { fetch } = recorder(() => jsonResponse(503, { code: 'cloud_unavailable' }))
      const ai = createWebAi({
        port: uniworkPort({ uniworkAi: true }),
        capabilities: { ai: true, uniworkAi: true },
        fetch,
        origin: ORIGIN,
      })
      const s = await ai.settings()
      expect(s.provider).toBe('uniwork')
      expect(s.uniworkModel).toBeUndefined()
    })

    it.each([
      ['no grant', {}],
      ['the old ai grant alone', { ai: true, webSearch: true }],
    ])('%s: nothing is asked of the server', async (_name, grants) => {
      const { calls, fetch } = recorder(() => jsonResponse(200, CLOUD))
      const ai = createWebAi({
        port: uniworkPort(grants),
        capabilities: { ...grants },
        fetch,
        origin: ORIGIN,
      })
      expect(await ai.active()).toBe(false)
      await ai.settings()
      expect(calls).toEqual([])
    })

    it('the grant sets the availability flag (the entry in AI_PROVIDERS); off clears it', async () => {
      const capabilities: Record<string, unknown> = { ai: true, uniworkAi: true }
      const ai = createWebAi({
        port: uniworkPort({ uniworkAi: true }),
        capabilities,
        fetch: recorder(() => jsonResponse(404, {})).fetch,
        origin: ORIGIN,
        uniworkStream: async () => {
          throw failure('office_capability_off', 403)
        },
      })
      await ai.active()
      expect(uniworkAiAvailable()).toBe(true)
      await ai.streams.aiStream({
        requestId: 'f1',
        settings: await ai.settings(),
        system: '',
        messages: [{ role: 'user', content: 'hi' }],
      } as never)
      expect(uniworkAiAvailable()).toBe(false)
    })

    it('a lost session clears every UniWork AI conversation', async () => {
      const r = rig(async () => {
        throw failure('session_expired', 401)
      })
      uniworkConversations.update('sess-2', { conversationId: 'c2' })
      await uniworkTurn(r.s)
      expect(r.chunks.at(-1)).toMatchObject({ uniworkCode: 'session_expired' })
      expect(uniworkConversations.ids('sess-2')).toEqual({})
    })

    it('a provider or model pick from the renderer changes nothing: UniWork AI stays the one provider', async () => {
      const { calls, fetch } = recorder(() => jsonResponse(200, CLOUD))
      const ai = createWebAi({
        port: uniworkPort({ uniworkAi: true }),
        capabilities: { ai: true, uniworkAi: true },
        fetch,
        origin: ORIGIN,
      })
      const api = withWebAi({}, ai)
      expect(await ai.active()).toBe(true)
      const changed = vi.fn()
      ai.onChanged(changed)
      ai.choose('openai', 'gpt-x')
      await (api.setAiSettings as (s: object) => Promise<void>)({
        provider: 'openai',
        providers: { openai: { apiKey: 'sk-x', model: 'gpt-x' } },
      })
      const s = await ai.settings()
      expect(s.provider).toBe('uniwork')
      expect(Object.keys(s.providers)).toEqual(['uniwork'])
      expect(changed).not.toHaveBeenCalled()
      // nothing is saved anywhere: only the cloud status is read
      expect(calls.every((c) => c.url === `${BASE}/cloud` && !c.init.method)).toBe(true)
    })

    it('the scope carries the document and the module of the session as the format token', async () => {
      const seen: unknown[] = []
      const { fetch } = recorder(() => jsonResponse(200, {}))
      const ai = createWebAi({
        port: uniworkPort({ uniworkAi: true }, 'sheets'),
        capabilities: { ai: true, uniworkAi: true },
        fetch,
        origin: ORIGIN,
        uniworkStream: async (_t, request) => {
          seen.push(request.scope)
        },
      })
      const api = withWebAi({ aiStream: async () => {}, onAiStream: () => () => {} }, ai)
      await (api.aiStream as (r: unknown) => Promise<void>)({
        requestId: 'x1',
        settings: { provider: 'uniwork', providers: {} },
        system: '',
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(seen).toEqual([{ kind: 'frame', documentId: 'doc-1', format: 'xlsx' }])
    })

    it('office_capability_off before any run: the entry and the panel hide, no error chip', async () => {
      const { fetch } = recorder(() => jsonResponse(200, CLOUD))
      // an older host still sends the old `ai` grant beside `uniworkAi`
      const capabilities: Record<string, unknown> = { ai: true, uniworkAi: true }
      const ai = createWebAi({
        port: uniworkPort({ ai: true, uniworkAi: true }),
        capabilities,
        fetch,
        origin: ORIGIN,
        uniworkStream: async (_t, _r, cb) => {
          cb.onNotice?.({ kind: 'uniwork-off' })
          throw failure('office_capability_off', 403)
        },
      })
      expect((await ai.settings()).provider).toBe('uniwork')
      const changed = vi.fn()
      ai.onChanged(changed)
      const chunks: Array<Record<string, unknown>> = []
      ai.streams.onAiStream((c) => chunks.push(c as never))
      await ai.streams.aiStream({
        requestId: 'off1',
        settings: await ai.settings(),
        system: '',
        messages: [{ role: 'user', content: 'hi' }],
      } as never)
      expect(capabilities.uniworkAi).toBe(false)
      expect(capabilities.ai).toBe(false)
      expect(changed).toHaveBeenCalled()
      expect(document.querySelector('.ow-ai-state')).toBeNull()
      // the one provider stays, unavailable (an empty slot: Send blocked), never another provider
      const s = await ai.settings()
      expect(s.provider).toBe('uniwork')
      expect(s.providers).toEqual({ uniwork: { apiKey: '', model: '' } })
      expect(chunks.at(-1)!.type).toBe('done')
      expect(chunks.some((c) => c.type === 'error')).toBe(false)
    })

    it('maps payload_too_large, mid-run office_capability_off, and unknown keys in uniworkFailureKey (G6-05u, C10, RF1-7)', () => {
      expect(uniworkFailureKey({ code: 'payload_too_large' })).toBe('aiErrWorkbookTooLarge')
      expect(uniworkFailureKey({ code: 'office_capability_off' })).toBe('aiUniworkOff')
      expect(uniworkFailureKey({ code: 'office_capability_off', runId: 'run-1' })).toBe(
        'aiErrCapabilityOff',
      )
      expect(uniworkFailureKey({ code: 'access_revoked' })).toBe('aiErrRevoked')
      expect(
        uniworkFailureKey({ code: 'future_unmapped_code' }, () => 'aiErrNotInDictionary'),
      ).toBe('aiErrUnavailable')
    })

    it('exposes uniworkIdentity from session and GET cloud org_id / org_name, and falls back orgName to UniWork instead of raw documentId (RF1-17)', async () => {
      const { fetch } = recorder(() =>
        jsonResponse(200, {
          ...CLOUD,
          org_id: 'org-cloud-1',
          org_name: 'UniWork Org',
        }),
      )
      const ai = createWebAi({
        port: {
          whenInitialized: async () => ({
            documentId: 'doc-42',
            workspaceId: 'ws-1',
            apiBase: 'https://app.test/api/v1',
            capabilities: { ai: true, uniworkAi: true, webSearch: true },
            user: { id: 'user-7', displayName: 'Alice' },
          }),
          ...tokens(),
        },
        capabilities: { ai: true, uniworkAi: true, webSearch: true },
        fetch,
        origin: ORIGIN,
      })
      await ai.state(true)
      expect(ai.uniworkIdentity()).toEqual({
        account: 'user-7',
        org: 'org-cloud-1',
        orgName: 'UniWork Org',
        document: 'doc-42',
      })

      // UniWork-only frame without cloud tools does not fetch GET /cloud; orgName must not fall back to raw documentId
      const uniworkOnly = createWebAi({
        port: {
          whenInitialized: async () => ({
            documentId: 'doc-raw-uuid-99',
            apiBase: 'https://app.test/api/v1',
            capabilities: { ai: false, uniworkAi: true },
            user: { id: 'user-9', displayName: 'Bob' },
          }),
          ...tokens(),
        },
        capabilities: { ai: false, uniworkAi: true },
        fetch,
        origin: ORIGIN,
      })
      await uniworkOnly.active()
      expect(uniworkOnly.uniworkIdentity()).toEqual({
        account: 'user-9',
        org: 'doc-raw-uuid-99',
        orgName: 'UniWork',
        document: 'doc-raw-uuid-99',
      })
    })
  })
})
