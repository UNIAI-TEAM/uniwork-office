import { describe, expect, it } from 'vitest'
import {
  ProxyUrlError,
  isInsideAiMount,
  isProxy404,
  isProxyContractStatus,
  proxyAnswered,
  proxyErrorBodyFields,
  toProxyRequest,
} from '../src/index'

const BASE = 'https://app.test/api/v1/orgs/org-1/ai'
const BYOK = `${BASE}/byok`

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('toProxyRequest (ai-provider wire format -> BYOK proxy routes)', () => {
  it('keeps chat/completions, messages and models, maps Anthropic /v1/messages, drops vendor keys and user-agent', () => {
    const o = toProxyRequest(BASE, `${BYOK}/openai/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk-x',
        'Content-Type': 'application/json',
        'User-Agent': 'UniWorkOffice',
      },
      body: '{}',
    })
    expect(o.url).toBe(`${BYOK}/openai/chat/completions`)
    expect(o.init.headers).toEqual({ 'content-type': 'application/json' })

    const a = toProxyRequest(BASE, `${BYOK}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01' },
      body: '{}',
    })
    expect(a.url).toBe(`${BYOK}/anthropic/messages`)
    expect(a.init.headers).toEqual({ 'anthropic-version': '2023-06-01' })

    const directMessages = toProxyRequest(BASE, `${BYOK}/anthropic/messages`, {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant', 'anthropic-beta': 'interleaved-thinking-2025-05-14' },
      body: '{}',
    })
    expect(directMessages.url).toBe(`${BYOK}/anthropic/messages`)
    expect(directMessages.init.headers).toEqual({
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
    })

    const m = toProxyRequest(BASE, `${BYOK}/openai/models?limit=1000`, {
      method: 'GET',
      headers: { Authorization: 'Bearer sk-x', Accept: 'application/json' },
    })
    expect(m.url).toBe(`${BYOK}/openai/models`)
    expect(m.init.headers).toEqual({ accept: 'application/json' })
  })

  it('wraps a Gemini call (stream and non-stream) into /generate {model, stream, request}', () => {
    const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })
    const s = toProxyRequest(
      BASE,
      `${BYOK}/gemini/models/gemini-3.8-flash:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': 'k', 'Content-Type': 'application/json' },
        body,
      },
    )
    expect(s.url).toBe(`${BYOK}/gemini/generate`)
    expect(s.init.method).toBe('POST')
    expect(JSON.parse(String(s.init.body))).toEqual({
      model: 'gemini-3.8-flash',
      stream: true,
      request: JSON.parse(body),
    })
    expect(s.init.headers).not.toHaveProperty('x-goog-api-key')

    const n = toProxyRequest(BASE, `${BYOK}/gemini/models/gemini-3.8-flash:generateContent`, {
      body,
    })
    expect(n.url).toBe(`${BYOK}/gemini/generate`)
    expect(JSON.parse(String(n.init.body))).toEqual({
      model: 'gemini-3.8-flash',
      stream: false,
      request: JSON.parse(body),
    })
  })

  it('refuses any foreign vendor URL', () => {
    expect(() => toProxyRequest(BASE, 'https://api.openai.com/v1/chat/completions')).toThrow(
      ProxyUrlError,
    )
    expect(() =>
      toProxyRequest(
        BASE,
        'https://app.test.evil.test/api/v1/orgs/org-1/ai/byok/openai/chat/completions',
      ),
    ).toThrow(ProxyUrlError)
  })

  it('refuses a proxy URL that leaves the byok mount after normalisation or uses invalid slugs/routes', () => {
    for (const url of [
      `${BASE}/byok/../../x`,
      `${BASE}/byok/openai/../../../me`,
      `${BASE}/byok/%2e%2e/credentials`,
      `${BASE}/byok/open%2fai/models`,
      `${BASE}/byok/openai\\..\\x`,
      `${BASE}/byok/.hidden/models`,
      `${BASE}/byok/openai/unknown-route`,
    ]) {
      expect(() => toProxyRequest(BASE, url), url).toThrow(ProxyUrlError)
    }
    expect(isInsideAiMount(`${BYOK}/openai/models`, BYOK)).toBe(true)
    expect(isInsideAiMount(`${BYOK}/../../x`, BYOK)).toBe(false)
  })

  it('distinguishes proxy 404 credential_missing from vendor or route 404s', async () => {
    expect(isProxyContractStatus(404)).toBe(true)
    expect(isProxyContractStatus(424)).toBe(true)
    expect(isProxyContractStatus(400)).toBe(false)

    const flatMissing = jsonResponse(404, { code: 'credential_missing' })
    expect(await isProxy404(flatMissing)).toBe(true)
    expect(await proxyAnswered(flatMissing)).toBe(true)

    const wrappedMissing = jsonResponse(404, {
      error: { code: 'credential_missing', message: 'missing key' },
    })
    expect(proxyErrorBodyFields(await wrappedMissing.clone().json())).toEqual({
      code: 'credential_missing',
      message: 'missing key',
    })
    expect(await proxyAnswered(wrappedMissing)).toBe(true)

    const vendor404 = jsonResponse(404, { error: { message: 'model not found' } })
    expect(await isProxy404(vendor404)).toBe(false)
    expect(await proxyAnswered(vendor404)).toBe(false)

    const vendor400 = jsonResponse(400, { error: { message: 'max_tokens too large' } })
    expect(await proxyAnswered(vendor400)).toBe(false)

    const authFailed = jsonResponse(424, { code: 'provider_auth_failed' })
    expect(await proxyAnswered(authFailed)).toBe(true)
  })

  it('counts a 402 or 503 as a proxy answer only with a UniWork code (vendor ones pass through)', async () => {
    const vendor402 = jsonResponse(402, { error: { message: 'Insufficient Balance' } })
    expect(await proxyAnswered(vendor402)).toBe(false)
    const vendor503 = jsonResponse(503, { error: { type: 'overloaded_error', message: 'busy' } })
    expect(await proxyAnswered(vendor503)).toBe(false)
    const htmlGateway = new Response('<html>busy</html>', { status: 503 })
    expect(await proxyAnswered(htmlGateway)).toBe(false)

    for (const [status, code] of [
      [402, 'credits_exhausted'],
      [503, 'cloud_unavailable'],
      [503, 'ai_credentials_unavailable'],
      [503, 'unavailable'],
    ] as const) {
      expect(await proxyAnswered(jsonResponse(status, { error: { code } })), code).toBe(true)
    }
  })
})
