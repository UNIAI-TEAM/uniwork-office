import { describe, expect, it } from 'vitest'
import { aiChatFailureText } from '../src/ai-chat-error-text'
import { aiStreamErrorFields } from '../src/ai-chat-error'
import type { AiTestFailureKind } from '../src/ai-test-failure'
import { AiTimeoutError } from '../src/watchdog'

const RAW_401 = '{"error":"API key required for remote API access"}'

/** nothing of the provider's own wording may reach a person */
function expectProductText(text: string): void {
  expect(text).not.toMatch(/HTTP \d{3}/)
  expect(text).not.toContain('{')
  expect(text).not.toContain('API key required for remote API access')
}

describe('chat failure texts', () => {
  const kinds: AiTestFailureKind[] = ['invalid_key', 'network', 'limit', 'unavailable', 'failed']

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
  it('a rejected sign-in becomes the invalid-key message in vi and en, raw text kept for the log', () => {
    const err = new Error(`HTTP 401: ${RAW_401}`)
    const en = aiStreamErrorFields(err, 'en')
    expect(en.error).toBe(aiChatFailureText('invalid_key', 'en'))
    expect(en.errorCode).toBeUndefined()
    expect(en.raw).toContain('HTTP 401')
    expectProductText(en.error)
    const vi = aiStreamErrorFields(err, 'vi')
    expect(vi.error).toBe(aiChatFailureText('invalid_key', 'vi'))
    expectProductText(vi.error)
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
