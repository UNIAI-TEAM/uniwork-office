import { describe, expect, it } from 'vitest'
import {
  aiTestFailureKindForChat,
  aiTestFailureKindForCloudCode,
  aiTestFailureKindForStatus,
  aiTestFailureKindForText,
  normalizeAiTestFailureKind,
  withAiTestFailureKind,
} from '../src/ai-test-failure'

describe('settings test failure kinds', () => {
  it('maps the UniWork cloud reason codes onto the notice states', () => {
    expect(aiTestFailureKindForCloudCode('entitlement_required')).toBe('not_entitled')
    expect(aiTestFailureKindForCloudCode('subscription_inactive')).toBe('not_entitled')
    expect(aiTestFailureKindForCloudCode('credits_exhausted')).toBe('credits_exhausted')
    expect(aiTestFailureKindForCloudCode('rate_limited')).toBe('limit')
    expect(aiTestFailureKindForCloudCode('timeout')).toBe('network')
    expect(aiTestFailureKindForCloudCode('server_error')).toBe('unavailable')
    expect(aiTestFailureKindForCloudCode('something_new')).toBe('failed')
  })

  it('reads a cloud 402 as credits and a cloud 403 as the plan, a provider 402/403 otherwise', () => {
    expect(aiTestFailureKindForStatus(402, true)).toBe('credits_exhausted')
    expect(aiTestFailureKindForStatus(403, true)).toBe('not_entitled')
    expect(aiTestFailureKindForStatus(403)).toBe('invalid_key')
    expect(aiTestFailureKindForStatus(401)).toBe('invalid_key')
    expect(aiTestFailureKindForStatus(402)).toBe('limit')
    expect(aiTestFailureKindForStatus(429)).toBe('limit')
    expect(aiTestFailureKindForStatus(503)).toBe('unavailable')
    expect(aiTestFailureKindForStatus(400)).toBe('failed')
  })

  it('classifies raw text by its status or its transport failure', () => {
    expect(aiTestFailureKindForText('Gemini: HTTP 403: { "error": {} }')).toBe('invalid_key')
    expect(aiTestFailureKindForText('fetch failed cause=ECONNRESET')).toBe('network')
    const abort = new Error('The operation was aborted due to timeout')
    abort.name = 'TimeoutError'
    expect(aiTestFailureKindForText('', abort)).toBe('network')
    expect(aiTestFailureKindForText('Something odd')).toBe('failed')
  })

  it('classifies a one-shot chat failure by its code, then by the status in its text', () => {
    expect(aiTestFailureKindForChat({ errorCode: 'timeout', error: 'x' })).toBe('network')
    expect(aiTestFailureKindForChat({ errorCode: 'network' })).toBe('network')
    expect(aiTestFailureKindForChat({ errorCode: 'credits', error: 'HTTP 402: no credit' })).toBe(
      'limit',
    )
    expect(aiTestFailureKindForChat({ errorCode: 'overloaded' })).toBe('unavailable')
    expect(
      aiTestFailureKindForChat({ error: 'Claude HTTP 401: {"error":"invalid x-api-key"}' }),
    ).toBe('invalid_key')
    expect(aiTestFailureKindForChat({ error: 'HTTP 404: model not found' })).toBe('failed')
    expect(aiTestFailureKindForChat({ error: 'codex exited with code 1' })).toBe('failed')
  })

  it('fills a missing kind on a failure and leaves passes and tagged failures alone', () => {
    expect(withAiTestFailureKind({ ok: false, error: 'HTTP 401' })).toEqual({
      ok: false,
      error: 'HTTP 401',
      errorKind: 'invalid_key',
    })
    expect(withAiTestFailureKind({ ok: true })).toEqual({ ok: true })
    const tagged = { ok: false, error: 'x', errorKind: 'network' as const }
    expect(withAiTestFailureKind(tagged)).toBe(tagged)
  })

  it('reads an unknown IPC kind as the generic failure', () => {
    expect(normalizeAiTestFailureKind('network')).toBe('network')
    expect(normalizeAiTestFailureKind('misconfigured')).toBe('misconfigured')
    expect(normalizeAiTestFailureKind('<script>')).toBe('failed')
    expect(normalizeAiTestFailureKind(undefined)).toBe('failed')
  })
})
