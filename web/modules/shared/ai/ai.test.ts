// Web AI bridge (CONTRACT C16): contract shapes, frame-token auth + 401 refresh, error mapping,
// the ai-provider proxy transport, streaming chunks, the off/on member switch, the in-frame UI.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPrimaryFetch } from '../../../../packages/ai-provider/src/fetch'
import {
  getUniworkCloudStatus,
  setUniworkCloudStatus,
} from '../../../../packages/ai-provider/src/uniwork-cloud'
import { aiRouteBase, createAiWebClient, readCloudStatus } from './client'
import {
  AiWebError,
  aiErrorCodeFor,
  aiErrorFromResponse,
  errorBodyFields,
  rawFailureAsTyped,
  retryAfterSeconds,
} from './errors'
import { createProxyFetch, toProxyRequest } from './transport'
import { createWebAiStreams } from './stream'
import { aiHostGrants, createWebAi, mediaFromUrl, withWebAi } from './web-ai'
import { describeAiError, hideAiState, openAiSettingsDialog, showAiState } from './ui'

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

function sseResponse(lines: string[]): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l))
      c.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
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

const CREDENTIALS = {
  items: [
    {
      provider: 'openai',
      label: '',
      base_url: '',
      key_hint: '…abcd',
      created_at: '2026-10-09T00:00:00Z',
      updated_at: '2026-10-09T00:00:00Z',
    },
  ],
  providers: [
    { id: 'anthropic', protocol: 'anthropic', requires_base_url: false, default_base_url: '' },
    { id: 'gemini', protocol: 'gemini', requires_base_url: false, default_base_url: '' },
    { id: 'openai', protocol: 'openai-compatible', requires_base_url: false, default_base_url: '' },
    { id: 'custom', protocol: 'openai-compatible', requires_base_url: true, default_base_url: '' },
    {
      id: 'hunyuan',
      protocol: 'openai-compatible',
      requires_base_url: false,
      default_base_url: '',
    },
  ],
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
  setPrimaryFetch(null)
  hideAiState()
  document.body.replaceChildren()
  try {
    localStorage.clear()
  } catch {
    // no storage in this environment
  }
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
    const { calls, fetch } = recorder((c) =>
      c.url.endsWith('/credentials') ? jsonResponse(200, CREDENTIALS) : jsonResponse(200, CLOUD),
    )
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: 'https://app.test/api/v1',
      tokens: tokens(),
      origin: ORIGIN,
      fetch,
    })
    const list = await client.listCredentials()
    expect(list.items[0]).toEqual(CREDENTIALS.items[0])
    expect(list.providers.map((p) => p.id)).toContain('anthropic')
    const cloud = await client.cloudStatus()
    expect(cloud.tools.image_search).toBe(false)
    expect(calls[0]!.url).toBe(`${BASE}/credentials`)
    expect(header(calls[0]!, 'authorization')).toBe('Bearer tok-1')
    expect(calls[0]!.init.credentials).toBe('omit')
    expect(calls[0]!.init.mode).toBe('same-origin')
  })

  it('refreshes the token once after a 401 and retries', async () => {
    const t = tokens('old', 'new')
    const { calls, fetch } = recorder((_c, n) =>
      n === 1 ? jsonResponse(401, { code: 'unauthorized' }) : jsonResponse(200, CREDENTIALS),
    )
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: '/api',
      tokens: t,
      origin: ORIGIN,
      fetch,
    })
    await client.listCredentials()
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
    [404, 'credential_missing', 'credential_missing'],
    [424, 'provider_auth_failed', 'provider_auth_failed'],
    [502, 'provider_unreachable', 'provider_unreachable'],
    [503, 'cloud_unavailable', 'cloud_unavailable'],
    [400, 'base_url_refused', 'base_url_refused'],
    [400, 'provider_not_supported', 'provider_not_supported'],
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

  it('credential PUT / DELETE: write-only key, masked hint back', async () => {
    const { calls, fetch } = recorder((c) =>
      c.init.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : jsonResponse(201, { ...CREDENTIALS.items[0], provider: 'anthropic', key_hint: '…wxyz' }),
    )
    const client = createAiWebClient({
      documentId: 'doc-1',
      apiBase: '/api',
      tokens: tokens(),
      origin: ORIGIN,
      fetch,
    })
    const saved = await client.saveCredential('anthropic', { api_key: 'sk-secret-wxyz' })
    expect(saved.key_hint).toBe('…wxyz')
    expect(JSON.stringify(saved)).not.toContain('sk-secret')
    expect(calls[0]!.init.method).toBe('PUT')
    expect(calls[0]!.url).toBe(`${BASE}/credentials/anthropic`)
    await client.deleteCredential('anthropic')
    expect(calls[1]!.init.method).toBe('DELETE')
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
      `${BASE}/credentials%2f..%2f..%2fx`,
      `${BASE}\\..\\x`,
      `${BASE.replace('app.test', 'app.test.evil.test')}/credentials`,
    ]) {
      await expect(client.fetch(path), path).rejects.toBeInstanceOf(AiWebError)
    }
    expect(fetch).not.toHaveBeenCalled()
    // a normal route below the mount still goes out
    await client.fetch(`${BASE}/credentials`)
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
})

describe('proxy transport (ai-provider wire format -> BYOK routes)', () => {
  const p = `${BASE}/byok`

  it('keeps chat/completions, maps Anthropic /v1/messages, drops vendor keys and the user agent', () => {
    const o = toProxyRequest(BASE, `${p}/openai/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk-x',
        'Content-Type': 'application/json',
        'User-Agent': 'UniWorkOffice',
      },
      body: '{}',
    })
    expect(o.url).toBe(`${p}/openai/chat/completions`)
    expect(o.init.headers).toEqual({ 'content-type': 'application/json' })
    const a = toProxyRequest(BASE, `${p}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': '', 'anthropic-version': '2023-06-01' },
      body: '{}',
    })
    expect(a.url).toBe(`${p}/anthropic/messages`)
    expect(a.init.headers).toEqual({ 'anthropic-version': '2023-06-01' })
  })

  it('wraps a Gemini call into /generate {model, stream, request}', () => {
    const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })
    const s = toProxyRequest(
      BASE,
      `${p}/gemini/models/gemini-3.8-flash:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': 'k', 'Content-Type': 'application/json' },
        body,
      },
    )
    expect(s.url).toBe(`${p}/gemini/generate`)
    expect(JSON.parse(String(s.init.body))).toEqual({
      model: 'gemini-3.8-flash',
      stream: true,
      request: JSON.parse(body),
    })
    expect(s.init.headers).not.toHaveProperty('x-goog-api-key')
    const n = toProxyRequest(BASE, `${p}/gemini/models/gemini-3.8-flash:generateContent`, { body })
    expect(JSON.parse(String(n.init.body)).stream).toBe(false)
  })

  it('refuses any vendor URL (the frame never calls a provider directly)', () => {
    expect(() => toProxyRequest(BASE, 'https://api.openai.com/v1/chat/completions')).toThrow(
      AiWebError,
    )
  })

  it('refuses a proxy URL that leaves the byok mount after normalisation', () => {
    for (const url of [
      `${BASE}/byok/../../x`,
      `${BASE}/byok/openai/../../../me`,
      `${BASE}/byok/%2e%2e/credentials`,
      `${BASE}/byok/open%2fai/models`,
    ]) {
      expect(() => toProxyRequest(BASE, url), url).toThrow(AiWebError)
    }
  })

  it('throws contract failures, passes a provider 404 / 400 through to ai-provider', async () => {
    let answer = jsonResponse(404, { code: 'credential_missing' })
    const client = { base: BASE, fetch: vi.fn(async () => answer) }
    const proxied = createProxyFetch(client)
    await expect(proxied(`${p}/openai/chat/completions`, { body: '{}' })).rejects.toMatchObject({
      code: 'credential_missing',
    })
    // the UniWork API's own envelope: { error: { code, message } }
    answer = jsonResponse(404, {
      error: { code: 'credential_missing', message: 'chưa lưu khóa cho nhà cung cấp này' },
    })
    await expect(proxied(`${p}/openai/chat/completions`, { body: '{}' })).rejects.toMatchObject({
      code: 'credential_missing',
      serverCode: 'credential_missing',
    })
    answer = jsonResponse(404, { error: { message: 'model not found' } })
    expect((await proxied(`${p}/openai/chat/completions`, { body: '{}' })).status).toBe(404)
    answer = jsonResponse(400, { error: { message: 'max_tokens too large' } })
    expect((await proxied(`${p}/openai/chat/completions`, { body: '{}' })).status).toBe(400)
  })
})

describe('streams', () => {
  const settings = (provider: string) =>
    ({
      provider,
      providers: { [provider]: { apiKey: 'never-sent', model: 'm-1' } },
    }) as never

  function streams(answer: (c: Call) => Response) {
    const { calls, fetch } = recorder((c) => answer(c))
    const client = { base: BASE, fetch: (u: string, i?: RequestInit) => fetch(u, i) }
    const onTypedError = vi.fn()
    const s = createWebAiStreams({
      client,
      protocolOf: (id) =>
        id === 'openai'
          ? 'openai-compatible'
          : id === 'anthropic'
            ? 'anthropic'
            : id === 'gemini'
              ? 'gemini'
              : null,
      describe: (err) => `typed:${err.code}`,
      onTypedError,
    })
    const chunks: Array<{ type: string; text?: string; error?: string }> = []
    s.onAiStream((c) => chunks.push(c))
    return { s, calls, chunks, onTypedError }
  }

  it('streams an openai-compatible turn through the proxy (native wire format, no key)', async () => {
    const { s, calls, chunks } = streams(() =>
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    await s.aiStream({
      requestId: 'r1',
      settings: settings('openai'),
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    } as never)
    expect(
      chunks
        .filter((c) => c.type === 'delta')
        .map((c) => c.text)
        .join(''),
    ).toBe('Hello')
    expect(chunks.at(-1)!.type).toBe('done')
    expect(calls[0]!.url).toBe(`${BASE}/byok/openai/chat/completions`)
    expect(header(calls[0]!, 'authorization')).toBeNull() // the client adds the frame token, not the protocol
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.model).toBe('m-1')
    expect(body.stream).toBe(true)
    expect(JSON.stringify(calls[0]!.init)).not.toContain('never-sent')
  })

  it('streams an Anthropic turn on /messages', async () => {
    const ev = (type: string, data: object) =>
      `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
    const { s, calls, chunks } = streams(() =>
      sseResponse([
        ev('message_start', { message: {} }),
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hi there' } }),
        ev('content_block_stop', { index: 0 }),
        ev('message_delta', { delta: { stop_reason: 'end_turn' } }),
        ev('message_stop', {}),
      ]),
    )
    await s.aiStream({
      requestId: 'r2',
      settings: settings('anthropic'),
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    } as never)
    expect(calls[0]!.url).toBe(`${BASE}/byok/anthropic/messages`)
    expect(chunks.find((c) => c.type === 'delta')?.text).toBe('Hi there')
    expect(chunks.at(-1)!.type).toBe('done')
  })

  // anthropic / gemini rethrow a failed fetch wrapped in `cause`: still the typed state, not "network"
  it.each(
    ['openai', 'anthropic', 'gemini'].flatMap((provider) =>
      (
        [
          [402, 'credits_exhausted'],
          [403, 'entitlement_required'],
          [404, 'credential_missing'],
          [424, 'provider_auth_failed'],
          [429, 'rate_limited'],
          [502, 'provider_unreachable'],
        ] as const
      ).map(([status, code]) => [provider, status, code] as const),
    ),
  )('%s: a proxy %i ends the turn with the typed %s state', async (provider, status, code) => {
    const { s, chunks, onTypedError } = streams(() =>
      jsonResponse(status, status === 429 ? { message: 'x' } : { error: { code, message: 'm' } }),
    )
    await s.aiStream({
      requestId: 'r3',
      settings: settings(provider),
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    } as never)
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: `typed:${code}` })
    expect(onTypedError.mock.calls[0]![0].code).toBe(code)
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
      jsonResponse(400, { error: { code: 'base_url_refused', message: 'm' } }),
    )
    expect(err).toMatchObject({ code: 'base_url_refused', serverCode: 'base_url_refused' })
  })

  it('maps a vendor adapter failure text to a typed state, never the raw payload', async () => {
    expect(rawFailureAsTyped(new Error('Claude HTTP 404: {"error":{"code":"x"}}'))).toMatchObject({
      code: 'credential_missing',
      status: 404,
    })
    expect(rawFailureAsTyped(new Error('OpenAI HTTP 401: bad key'))).toMatchObject({
      code: 'provider_auth_failed',
    })
    expect(rawFailureAsTyped(new Error('Gemini HTTP 500: boom'))).toMatchObject({ code: 'unknown' })
    expect(rawFailureAsTyped(new Error('{"detail":"nope"}'))).toMatchObject({ code: 'unknown' })
    expect(rawFailureAsTyped(new Error('The model returned no text'))).toBeUndefined()
    const { s, chunks, onTypedError } = streams(() =>
      jsonResponse(500, { error: { type: 'api_error', message: 'upstream exploded' } }),
    )
    await s.aiStream({
      requestId: 'r5',
      settings: settings('openai'),
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    } as never)
    const last = chunks.at(-1) as { type: string; error: string }
    expect(last.type).toBe('error')
    expect(last.error).toBe('typed:unknown')
    expect(onTypedError).toHaveBeenCalledTimes(1)
  })

  it('a provider without a server route is credential_missing (no request sent)', async () => {
    const { s, calls, chunks } = streams(() => jsonResponse(200, {}))
    await s.aiStream({
      requestId: 'r4',
      settings: settings('codex'),
      system: 's',
      messages: [],
    } as never)
    expect(calls).toHaveLength(0)
    expect(chunks).toEqual([
      expect.objectContaining({ type: 'error', error: 'typed:credential_missing' }),
    ])
  })

  it('aiChat (one-shot) uses the same route without stream', async () => {
    const { s, calls } = streams(() =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    )
    const r = await s.aiChat({ settings: settings('openai'), system: 's', user: 'u' })
    expect(r).toMatchObject({ ok: true, content: 'ok' })
    expect(JSON.parse(String(calls[0]!.init.body)).stream).toBeFalsy()
  })
})

describe('members (off = as today, on = UniWork routes)', () => {
  function port(caps: Record<string, boolean> | undefined, withToken = true) {
    return {
      whenInitialized: async () => ({
        documentId: 'doc-1',
        apiBase: 'https://app.test/api/v1',
        ...(caps ? { capabilities: caps } : {}),
      }),
      ...(withToken ? tokens() : {}),
    }
  }

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

  it('aiHostGrants: tools need ai too; nothing without the ai grant', () => {
    expect(aiHostGrants(undefined)).toEqual({
      ai: false,
      aiCredentials: false,
      webSearch: false,
      imageSearch: false,
      imageGeneration: false,
    })
    expect(aiHostGrants({ webSearch: true, imageGeneration: true })).toMatchObject({
      ai: false,
      webSearch: false,
    })
    expect(aiHostGrants({ ai: true, webSearch: true })).toEqual({
      ai: true,
      aiCredentials: true,
      webSearch: true,
      imageSearch: false,
      imageGeneration: false,
    })
  })

  it('without the ai grant every member is the module stub and no request is made', async () => {
    const { fetch } = recorder(() => jsonResponse(200, {}))
    const ai = createWebAi({ port: port({ ai: false }), capabilities: {}, fetch, origin: ORIGIN })
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
    const ai = createWebAi({ port: port({ ai: true }, false), capabilities: {} })
    expect(await ai.active()).toBe(false)
  })

  it('with the grant: settings from stored credentials (no key), cloud switches, search shapes', async () => {
    const { calls, fetch } = recorder((c) => {
      if (c.url.endsWith('/credentials')) return jsonResponse(200, CREDENTIALS)
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
    const capabilities: Record<string, unknown> = {
      ai: true,
      webSearch: true,
      imageSearch: true,
      imageGeneration: true,
    }
    const ai = createWebAi({ port: port({ ai: true }), capabilities, fetch, origin: ORIGIN })
    const api = withWebAi({ ...stubs }, ai)
    const settings = (await (api.getAiSettings as () => Promise<Record<string, unknown>>)()) as {
      provider: string
      providers: Record<string, { apiKey: string }>
      gskToolsEnabled: boolean
    }
    expect(settings.provider).toBe('openai')
    expect(Object.values(settings.providers).every((p) => p.apiKey === '')).toBe(true)
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
  })

  it('a cloud failure returns the module error shape with the typed text and shows the card', async () => {
    const { fetch } = recorder((c) => {
      if (c.url.endsWith('/credentials')) return jsonResponse(200, CREDENTIALS)
      if (c.url.endsWith('/cloud')) return jsonResponse(200, CLOUD)
      return jsonResponse(402, { code: 'credits_exhausted' })
    })
    const ai = createWebAi({
      port: port({ ai: true }),
      capabilities: { ai: true },
      fetch,
      origin: ORIGIN,
    })
    const api = withWebAi({ ...stubs }, ai)
    const r = await (api.webSearch as (q: string) => Promise<{ method: string; error: string }>)(
      'q',
    )
    expect(r.method).toBe('error')
    expect(r.error).toBe(
      describeAiError(new AiWebError({ code: 'credits_exhausted', status: 402 }), ''),
    )
    expect(document.querySelector('[data-ai-state="credits_exhausted"]')).not.toBeNull()
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
  it('one typed state card at a time; key states offer AI settings', () => {
    const openSettings = vi.fn()
    showAiState(new AiWebError({ code: 'rate_limited', status: 429, retryAfterSec: 5 }), 'OpenAI', {
      openSettings,
    })
    const card = showAiState(
      new AiWebError({ code: 'credential_missing', status: 404 }),
      'OpenAI',
      { openSettings },
    )
    expect(document.querySelectorAll('.ow-ai-state')).toHaveLength(1)
    expect(card.dataset.aiState).toBe('credential_missing')
    expect(card.textContent).toContain('OpenAI')
    const settingsBtn = card.querySelector('button.primary') as HTMLButtonElement
    settingsBtn.click()
    expect(openSettings).toHaveBeenCalled()
    expect(document.querySelector('.ow-ai-state')).toBeNull()
  })

  it('every error code has its own text', () => {
    const codes = [
      'credits_exhausted',
      'entitlement_required',
      'credential_missing',
      'provider_auth_failed',
      'rate_limited',
      'provider_unreachable',
      'cloud_unavailable',
      'unauthorized',
      'base_url_refused',
      'provider_not_supported',
      'bad_request',
      'unknown',
    ] as const
    const texts = codes.map((code) => describeAiError(new AiWebError({ code, status: 0 }), 'X'))
    expect(new Set(texts).size).toBe(texts.length)
    for (const t of texts) expect(t).not.toMatch(/aiWeb/)
  })

  it('settings dialog: masked hint, write-only key, save + remove through the client', async () => {
    let items = [...CREDENTIALS.items]
    const client = {
      saveCredential: vi.fn(async (provider: string) => {
        items = [...items, { ...CREDENTIALS.items[0]!, provider, key_hint: '…9999' }]
        return items.at(-1)!
      }),
      deleteCredential: vi.fn(async (provider: string) => {
        items = items.filter((c) => c.provider !== provider)
      }),
    }
    const choose = vi.fn()
    const closed = openAiSettingsDialog({
      load: async () => ({
        credentials: { items, providers: CREDENTIALS.providers },
        cloud: readCloudStatus(CLOUD),
      }),
      client,
      current: async () => ({ provider: 'openai', model: 'gpt-x' }),
      choose,
      supported: (id) => id !== 'hunyuan',
      label: (id) => id.toUpperCase(),
      models: () => ['m-a', 'm-b'],
    })
    await vi.waitFor(() => expect(document.querySelector('select[name="provider"]')).not.toBeNull())
    const select = document.querySelector('select[name="provider"]') as HTMLSelectElement
    // hunyuan has no genoffice adapter: not offered
    expect([...select.options].map((o) => o.value)).toEqual([
      'anthropic',
      'gemini',
      'openai',
      'custom',
    ])
    expect(select.value).toBe('openai')
    expect(document.body.textContent).toContain('…abcd')
    expect((document.querySelector('input[name="model"]') as HTMLInputElement).value).toBe('gpt-x')
    // add an Anthropic key
    select.value = 'anthropic'
    select.dispatchEvent(new Event('change'))
    const key = document.querySelector('input[name="api_key"]') as HTMLInputElement
    expect(key.type).toBe('password')
    key.value = 'sk-ant-9999'
    ;(document.querySelector('.ow-ai-dialog button.primary') as HTMLButtonElement).click()
    await vi.waitFor(() =>
      expect(client.saveCredential).toHaveBeenCalledWith('anthropic', { api_key: 'sk-ant-9999' }),
    )
    await vi.waitFor(() => expect(document.body.textContent).toContain('…9999'))
    expect(key.value).toBe('')
    // remove it again
    ;(document.querySelector('.ow-ai-dialog button.danger') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(client.deleteCredential).toHaveBeenCalledWith('anthropic'))
    // custom shows the base URL field
    select.value = 'custom'
    select.dispatchEvent(new Event('change'))
    expect(
      (document.querySelector('input[name="base_url"]')!.closest('label') as HTMLElement).hidden,
    ).toBe(false)
    // Done keeps the choice
    select.value = 'openai'
    select.dispatchEvent(new Event('change'))
    const done = [...document.querySelectorAll('.ow-ai-dialog button')].at(-1) as HTMLButtonElement
    done.click()
    await closed
    expect(choose).toHaveBeenCalledWith('openai', 'gpt-x')
    expect(document.querySelector('.ow-ai-dialog')).toBeNull()
  })
})

describe('installModuleBridge wiring', () => {
  it('AI members only on globals that have them; the ai grant turns the keys on', async () => {
    const { installModuleBridge } = await import('../../../docs/bridge/module-bridge')
    const { createMockPort } = await import('../../../docs/bridge/testing/mock-port')
    const { fetch } = recorder((c) =>
      c.url.endsWith('/credentials') ? jsonResponse(200, CREDENTIALS) : jsonResponse(200, CLOUD),
    )
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
    expect(capabilities).toMatchObject({ ai: false, aiCredentials: false })
    expect(typeof (target.markdownApi as Record<string, unknown>).openAiSettings).toBe('function')
    expect(Object.prototype.hasOwnProperty.call(target.other, 'openAiSettings')).toBe(false)
    mock.init({ apiBase: '/api/v1', capabilities: { ai: true, webSearch: true } })
    await vi.waitFor(() => expect(capabilities.ai).toBe(true))
    expect(capabilities).toMatchObject({
      aiCredentials: true,
      webSearch: true,
      imageGeneration: false,
    })
    vi.unstubAllGlobals()
  })
})
