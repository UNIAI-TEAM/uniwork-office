import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolCall } from '@genoffice/agent-core'
import { aiChatFailureText } from '../src/ai-chat-error-text'
import { aiChatFailure, aiChatFailureFromError, aiStreamErrorFields } from '../src/ai-chat-error'
import type { AiTestFailureKind } from '../src/ai-test-failure'
import { chatForProvider } from '../src/chat'
import { AiCreditsError, streamForProvider } from '../src/stream'
import { AiTimeoutError } from '../src/watchdog'
import { errorResponse } from './test-utils'

afterEach(() => {
  vi.unstubAllGlobals()
})

const RAW_401 = '{"error":"API key required for remote API access"}'
const CUSTOM = { baseUrl: 'https://router.example/v1', apiKey: 'bad', model: 'deepseek-4.1' }
const BUSY = 'busy (app text)'

/** nothing of the provider's own wording may reach a person */
function expectProductText(text: string): void {
  expect(text).not.toMatch(/HTTP \d{3}/)
  expect(text).not.toContain('{')
  expect(text).not.toContain('API key required for remote API access')
}

describe('chat failure texts', () => {
  const kinds: AiTestFailureKind[] = [
    'not_entitled',
    'credits_exhausted',
    'invalid_key',
    'network',
    'limit',
    'unavailable',
    'misconfigured',
    'failed',
  ]

  it('has an en and a vi message for every kind, and other locales read English', () => {
    for (const kind of kinds) {
      const en = aiChatFailureText(kind, 'en')
      const vi = aiChatFailureText(kind, 'vi')
      expect(en.length, kind).toBeGreaterThan(10)
      expect(vi.length, kind).toBeGreaterThan(10)
      expect(vi, kind).not.toBe(en)
      expect(aiChatFailureText(kind, 'de'), kind).toBe(en)
    }
  })

  it('never names a git host, an internal code or a purchase', () => {
    for (const kind of kinds) {
      for (const lang of ['en', 'vi']) {
        const text = aiChatFailureText(kind, lang)
        expect(text).not.toMatch(/\b(GO-\d|UNI-\d|git|GitHub)\b/i)
        expect(text).not.toMatch(/purchase|buy|mua gói/i)
      }
    }
  })
})

describe('stream failures (chat panel in docs, sheets, slides, markdown, html, pdf)', () => {
  it('a rejected key becomes the invalid-key message in vi and en, raw text kept for the log', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(401, RAW_401)))
    const err = await streamForProvider(
      'custom',
      CUSTOM,
      'sys',
      [{ role: 'user', text: 'hi' }],
      [],
      256,
      {
        signal: new AbortController().signal,
        onDelta: () => undefined,
        onToolCall: (_call: AgentToolCall) => undefined,
      },
    ).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    const en = aiStreamErrorFields(err, 'en')
    expect(en.error).toBe(aiChatFailureText('invalid_key', 'en'))
    expect(en.errorCode).toBeUndefined()
    expect(en.raw).toContain('HTTP 401')
    expectProductText(en.error)
    const vi2 = aiStreamErrorFields(err, 'vi')
    expect(vi2.error).toBe(aiChatFailureText('invalid_key', 'vi'))
    expectProductText(vi2.error)
  })

  it('maps each status family onto its kind', () => {
    const text = (message: string, lang = 'en') =>
      aiStreamErrorFields(new Error(message), lang).error
    expect(text(`Claude HTTP 403: ${RAW_401}`)).toBe(aiChatFailureText('invalid_key', 'en'))
    expect(text('HTTP 500: {"error":"boom"}')).toBe(aiChatFailureText('unavailable', 'en'))
    expect(text('HTTP 404: {"error":"model not found"}')).toBe(aiChatFailureText('failed', 'en'))
    expect(text('HTTP 400: {"error":{"message":"bad"}}', 'vi')).toBe(
      aiChatFailureText('failed', 'vi'),
    )
  })

  it('keeps the codes the renderers already translate', () => {
    expect(aiStreamErrorFields(new AiTimeoutError(180_000), 'vi').errorCode).toBe('timeout')
    expect(aiStreamErrorFields(new AiCreditsError('OpenRouter credits'), 'vi').errorCode).toBe(
      'credits',
    )
    expect(aiStreamErrorFields(new Error('fetch failed cause=ECONNRESET'), 'vi').errorCode).toBe(
      'network',
    )
    expect(aiStreamErrorFields(new Error('HTTP 429: slow down'), 'vi').errorCode).toBe('overloaded')
  })

  it('leaves a plain message of ours alone', () => {
    const fields = aiStreamErrorFields(
      new Error('The model returned no content (empty stream)'),
      'vi',
    )
    expect(fields.error).toBe('The model returned no content (empty stream)')
    expect(fields.errorCode).toBeUndefined()
  })
})

describe('one-shot failures (one-click actions, email AI, settings test)', () => {
  it('a rejected key in a result becomes the invalid-key message with its kind', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(401, RAW_401)))
    const result = await chatForProvider('custom', CUSTOM, 'sys', 'hi')
    expect(result.ok).toBe(false)
    const failure = aiChatFailure(result, 'vi', BUSY)
    expect(failure.error).toBe(aiChatFailureText('invalid_key', 'vi'))
    expect(failure.errorKind).toBe('invalid_key')
    expect(failure.raw).toContain('HTTP 401')
    expectProductText(failure.error)
  })

  it('capacity failures read the app own localized busy text', () => {
    const failure = aiChatFailure({ ok: false, error: 'HTTP 429: rate limited' }, 'en', BUSY)
    expect(failure).toMatchObject({ error: BUSY, errorKind: 'unavailable' })
  })

  it('a credits code is the provider-limit message', () => {
    const failure = aiChatFailure(
      { ok: false, error: 'out of credits', errorCode: 'credits' },
      'en',
      BUSY,
    )
    expect(failure).toMatchObject({
      error: aiChatFailureText('limit', 'en'),
      errorKind: 'limit',
    })
  })

  it('a thrown error is classified from its text, a timeout as a network failure', () => {
    expect(aiChatFailureFromError(new Error('HTTP 502: bad gateway'), 'en', BUSY)).toMatchObject({
      error: aiChatFailureText('unavailable', 'en'),
      errorKind: 'unavailable',
    })
    expect(aiChatFailureFromError(new AiTimeoutError(60_000), 'vi', BUSY)).toMatchObject({
      error: aiChatFailureText('network', 'vi'),
      errorKind: 'network',
    })
    expect(
      aiChatFailureFromError(new Error('fetch failed cause=ECONNREFUSED'), 'en', BUSY).errorKind,
    ).toBe('network')
  })

  it('a plain message of ours is kept, a JSON body is not', () => {
    expect(
      aiChatFailure({ ok: false, error: 'AI returned an empty response' }, 'en', BUSY).error,
    ).toBe('AI returned an empty response')
    expect(
      aiChatFailure({ ok: false, error: 'AI returned a non-JSON response: {"x":1}' }, 'en', BUSY)
        .error,
    ).toBe(aiChatFailureText('failed', 'en'))
  })
})
