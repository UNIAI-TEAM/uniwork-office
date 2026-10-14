import { afterEach, describe, expect, it } from 'vitest'
import { aiStreamErrorFields } from '../src/ai-chat-error'
import { isAiOverloadedError } from '../src/overload-error'
import {
  AI_PROVIDERS,
  defaultAiSettings,
  providerNeed,
  selectedProvider,
  setUniworkAiAvailable,
  uniworkAiAvailable,
} from '../src/providers'
import { UNIWORK_CLOUD_TOOLS, normalizeUniworkCloudStatus } from '../src/uniwork-cloud'
import { UniworkError, uniworkErrorFromResponse, uniworkErrorKey } from '../src/uniwork/errors'

afterEach(() => {
  setUniworkAiAvailable(false)
})

const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

describe('UniWork AI errors branch on the code', () => {
  it('409/413/403/502/504 codes never classify as overloaded', async () => {
    const cases: Array<[number, string]> = [
      [409, 'run_limit_reached'],
      [409, 'conversation_expired'],
      [409, 'run_expired'],
      [413, 'ai_tool_result_too_large'],
      [403, 'office_capability_off'],
      [403, 'entitlement_required'],
      [502, 'provider_unreachable'],
      [504, 'ai_provider_timeout'],
      [503, 'ai_disabled'],
      [429, 'ai_rate_limited'],
      [429, 'ai_uniwork_busy'],
    ]
    for (const [status, code] of cases) {
      const err = await uniworkErrorFromResponse(
        response(status, { code, message: 'Upstream overloaded, rate limit, too many requests' }),
      )
      expect(err.code).toBe(code)
      expect(err.status).toBe(status)
      expect(isAiOverloadedError(err)).toBe(false)
      expect(isAiOverloadedError(new Error('wrapped', { cause: err }))).toBe(false)
      const fields = aiStreamErrorFields(err, 'en')
      expect(fields.errorCode).toBeUndefined()
      expect(fields.uniworkCode).toBe(code)
    }
  })

  it('reads Retry-After, fields and the nested error shape', async () => {
    const busy = await uniworkErrorFromResponse(
      response(429, { code: 'ai_uniwork_busy' }, { 'Retry-After': '5' }),
    )
    expect(busy.retryAfterSec).toBe(5)
    expect(aiStreamErrorFields(busy, 'en').retryAfterSec).toBe(5)
    const limit = await uniworkErrorFromResponse(
      response(409, { code: 'run_limit_reached', fields: { limit: 'model_calls' } }),
    )
    expect(limit.fields).toEqual({ limit: 'model_calls' })
    const nested = await uniworkErrorFromResponse(
      response(402, { error: { code: 'credits_exhausted' } }),
    )
    expect(nested.code).toBe('credits_exhausted')
  })

  it('a status without a known code falls back by status', async () => {
    expect((await uniworkErrorFromResponse(response(401, 'nope'))).code).toBe('session_expired')
    expect((await uniworkErrorFromResponse(response(403, { code: 'forbidden' }))).code).toBe(
      'access_revoked',
    )
    expect((await uniworkErrorFromResponse(response(404, ''))).code).toBe('access_revoked')
    expect((await uniworkErrorFromResponse(response(429, ''))).code).toBe('rate_limited')
    expect((await uniworkErrorFromResponse(response(500, '<html>'))).code).toBe('ai_provider_error')
    expect((await uniworkErrorFromResponse(response(400, { code: 'weird' }))).code).toBe(
      'invalid_request',
    )
  })

  it('maps every code to its S9 message key', () => {
    expect(uniworkErrorKey('credits_exhausted')).toBe('aiErrCredits')
    expect(uniworkErrorKey('entitlement_required')).toBe('aiErrEntitlement')
    expect(uniworkErrorKey('office_capability_off')).toBe('aiErrCapabilityOff')
    expect(uniworkErrorKey('conversation_expired')).toBe('aiConversationRestarted')
    expect(uniworkErrorKey('run_expired')).toBe('aiErrRunLimit')
    expect(uniworkErrorKey('run_limit_reached')).toBe('aiErrRunLimit')
    expect(uniworkErrorKey('ai_uniwork_busy')).toBe('aiErrRateLimitedNoWait')
    for (const code of [
      'ai_provider_error',
      'provider_unreachable',
      'cloud_unavailable',
      'ai_disabled',
      'ai_provider_timeout',
    ] as const) {
      expect(uniworkErrorKey(code)).toBe('aiErrUnavailable')
    }
    expect(uniworkErrorKey('session_expired')).toBe('aiErrSession')
    expect(uniworkErrorKey('access_revoked')).toBe('aiErrRevoked')
    expect(uniworkErrorKey('disconnected')).toBe('aiErrDisconnected')
    expect(uniworkErrorKey('offline')).toBe('aiErrOffline')
    // Q-5: desktop has no "open in the app" action for 413
    expect(uniworkErrorKey('ai_tool_result_too_large')).toBe('aiErrUnavailable')
    expect(uniworkErrorKey('ai_tool_result_too_large', 'web')).toBe('aiErrWorkbookTooLarge')
    expect(uniworkErrorKey('payload_too_large', 'web')).toBe('aiErrWorkbookTooLarge')
  })

  it('the message never carries the server text', async () => {
    const err = await uniworkErrorFromResponse(
      response(502, { code: 'provider_unreachable', message: 'dial tcp 10.0.0.1:443' }),
    )
    expect(err.message).not.toContain('10.0.0.1')
    expect(err).toBeInstanceOf(UniworkError)
  })
})

describe('uniwork provider entry (Q-4)', () => {
  it('stays out of AI_PROVIDERS until UniWork AI is available', () => {
    expect(uniworkAiAvailable()).toBe(false)
    expect(AI_PROVIDERS.some((m) => m.id === 'uniwork')).toBe(false)
    setUniworkAiAvailable(true)
    expect(AI_PROVIDERS.filter((m) => m.id === 'uniwork')).toHaveLength(1)
    setUniworkAiAvailable(true)
    expect(AI_PROVIDERS.filter((m) => m.id === 'uniwork')).toHaveLength(1)
    setUniworkAiAvailable(false)
    expect(AI_PROVIDERS.some((m) => m.id === 'uniwork')).toBe(false)
  })

  it('sits right after UniAI, which leads the list, and leaves the other entries in order', () => {
    const before = AI_PROVIDERS.map((m) => m.id)
    expect(AI_PROVIDERS[0]!.label).toBe('UniAI')
    setUniworkAiAvailable(true)
    expect(AI_PROVIDERS[1]!.id).toBe('uniwork')
    expect(AI_PROVIDERS.filter((m) => m.id !== 'uniwork').map((m) => m.id)).toEqual(before)
    setUniworkAiAvailable(false)
    expect(AI_PROVIDERS.map((m) => m.id)).toEqual(before)
  })

  it('needs no key and stays the selection whether or not it is offered (no silent switch to UniAI)', () => {
    const settings = { ...defaultAiSettings(), provider: 'uniwork' as const }
    expect(providerNeed(settings, 'uniwork')).toBeNull()
    expect(selectedProvider(settings)).toBe('uniwork')
    setUniworkAiAvailable(true)
    expect(providerNeed(settings, 'uniwork')).toBeNull()
    expect(selectedProvider(settings)).toBe('uniwork')
  })

  it('chat is a cloud flag read from the status', () => {
    expect(UNIWORK_CLOUD_TOOLS).toContain('chat')
    const status = normalizeUniworkCloudStatus({
      state: 'ready',
      enabled: true,
      tools: { chat: true },
    })
    expect(status.tools.chat).toBe(true)
    expect(
      normalizeUniworkCloudStatus({ state: 'ready', enabled: true, tools: {} }).tools.chat,
    ).toBe(false)
  })
})
