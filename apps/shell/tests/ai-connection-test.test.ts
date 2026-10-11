import { describe, expect, it, vi } from 'vitest'
import { UNIWORK_CLOUD_SIGNED_OUT } from '@genoffice/ai-provider/browser'
import type { UniworkCloudState, UniworkCloudStatus } from '@genoffice/ai-provider/browser'
import {
  connectionTestResult,
  runConnectionTests,
  testFailureText,
} from '../src/renderer/src/ai-connection-test'
import type { BlockCheck } from '../src/renderer/src/ai-connection-test'
import type { TFunc } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/cloud/en'
import { vi as viCloud } from '../src/renderer/src/i18n/cloud/vi'

const tOf = (cloud: Record<string, string>) =>
  ((key: string) =>
    cloud[key] ?? { setAiTestFail: 'Connection failed' }[key as 'setAiTestFail'] ?? key) as TFunc
const tEn = tOf(en)
const tVi = tOf({ ...viCloud, setAiTestFail: 'Kết nối thất bại' })

const statusOf = (state: UniworkCloudState): UniworkCloudStatus => ({
  ...UNIWORK_CLOUD_SIGNED_OUT,
  state,
  enabled: state === 'ready' || state === 'credits-exhausted',
})

const config = { apiKey: '', imageModel: '', analysisModel: '' }
const media = (block: BlockCheck['block'], provider = 'openai'): BlockCheck => ({
  block,
  kind: 'media',
  provider: provider as 'openai',
  config,
})

function apiOf(overrides: Record<string, unknown> = {}) {
  return {
    uniworkCloudRefresh: vi.fn(async () => statusOf('ready')),
    testAiMediaSettings: vi.fn(async () => ({ ok: true })),
    testAiSearchSettings: vi.fn(async () => ({ ok: true })),
    testFileSearchRerank: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } as unknown as Parameters<typeof runConnectionTests>[1]
}

describe('settings test connection: product messages', () => {
  it('turns each failure kind into a message in English', () => {
    expect(testFailureText('not_entitled', tEn)).toBe('Not in your plan')
    expect(testFailureText('credits_exhausted', tEn)).toBe('Out of AI credits')
    expect(testFailureText('invalid_key', tEn)).toBe('API key missing or rejected')
    expect(testFailureText('network', tEn)).toBe('Can’t connect. Check your connection')
    expect(testFailureText('limit', tEn)).toBe('Provider limit reached. Try again later')
    expect(testFailureText('unavailable', tEn)).toBe('Service not answering. Try again later')
    expect(testFailureText('misconfigured', tEn)).toBe(
      'Settings incomplete: check the service address and account fields',
    )
    expect(testFailureText('failed', tEn)).toBe('Connection failed')
    expect(testFailureText(undefined, tEn)).toBe('Connection failed')
  })

  it('answers in Vietnamese, not English, for every kind', () => {
    for (const kind of [
      'not_entitled',
      'credits_exhausted',
      'invalid_key',
      'network',
      'limit',
      'unavailable',
      'misconfigured',
    ] as const) {
      expect(testFailureText(kind, tVi)).not.toBe(testFailureText(kind, tEn))
    }
    expect(testFailureText('invalid_key', tVi)).toBe('Khóa API thiếu hoặc bị từ chối')
    expect(testFailureText('misconfigured', tVi)).toBe(
      'Cài đặt chưa đầy đủ: hãy kiểm tra địa chỉ dịch vụ và các trường tài khoản',
    )
  })

  it('never lets a raw provider error or an HTTP status into the pill', () => {
    const raw = {
      ok: false,
      error: 'Gemini: HTTP 403: { "error": { "code": 403 } }',
      errorKind: 'invalid_key',
    } as never
    const verdict = connectionTestResult(raw, tEn)
    expect(verdict).toEqual({ ok: false, error: 'API key missing or rejected' })
    expect(verdict.error).not.toMatch(/HTTP|403|\{/)
    expect(connectionTestResult({ ok: false }, tEn).error).toBe('Connection failed')
  })

  it('draws the AI Model test failure from its kind, never its text', () => {
    const chat = { ok: false, errorKind: 'invalid_key' } as never
    expect(connectionTestResult(chat, tVi)).toEqual({
      ok: false,
      error: 'Khóa API thiếu hoặc bị từ chối',
    })
    expect(connectionTestResult({ ok: false, errorKind: 'network' } as never, tEn).error).toBe(
      'Can’t connect. Check your connection',
    )
    expect(connectionTestResult({ ok: true }, tEn)).toEqual({ ok: true })
  })

  it('shows a missing rerank key as the key message, not the generic failure', async () => {
    const api = apiOf({
      testFileSearchRerank: vi.fn(async () => ({
        ok: false,
        errorKind: 'invalid_key',
      })),
    })
    const settings = { endpoint: 'direct' } as never
    const results = await runConnectionTests(
      [{ block: 'rerank', kind: 'rerank', settings }],
      api,
      tEn,
    )
    expect(results.rerank).toEqual({ ok: false, error: 'API key missing or rejected' })
  })

  it('shows a misconfigured rerank or media block as a settings message, not the generic failure', async () => {
    const api = apiOf({
      testFileSearchRerank: vi.fn(async () => ({ ok: false, errorKind: 'misconfigured' })),
      testAiMediaSettings: vi.fn(async () => ({ ok: false, errorKind: 'misconfigured' })),
    })
    const settings = { endpoint: 'custom' } as never
    const results = await runConnectionTests(
      [{ block: 'rerank', kind: 'rerank', settings }, media('image', 'custom')],
      api,
      tEn,
    )
    const message = 'Settings incomplete: check the service address and account fields'
    expect(results.rerank).toEqual({ ok: false, error: message })
    expect(results.image).toEqual({ ok: false, error: message })
  })

  it('shows a thrown IPC error as the generic failure, not its text', async () => {
    const api = apiOf({
      testAiMediaSettings: vi.fn(async () => {
        throw new Error("Error invoking remote method 'ai:media-test': HTTP 401")
      }),
    })
    const results = await runConnectionTests([media('image')], api, tEn)
    expect(results.image).toEqual({ ok: false, error: 'Connection failed' })
  })

  it('maps each block of a mixed test to its own message and shares a vendor check', async () => {
    const api = apiOf({
      testAiMediaSettings: vi.fn(async ({ provider }: { provider: string }) =>
        provider === 'openai'
          ? { ok: false, errorKind: 'invalid_key' }
          : { ok: false, errorKind: 'network' },
      ),
      testAiSearchSettings: vi.fn(async () => ({ ok: false, errorKind: 'limit' })),
    })
    const results = await runConnectionTests(
      [
        { block: 'search', kind: 'search', provider: 'serper', apiKey: 'k' },
        media('image'),
        media('analysis', 'gemini'),
        media('video'),
      ],
      api,
      tEn,
    )
    expect(results.search?.error).toBe('Provider limit reached. Try again later')
    expect(results.image?.error).toBe('API key missing or rejected')
    expect(results.video?.error).toBe('API key missing or rejected')
    expect(results.analysis?.error).toBe('Can’t connect. Check your connection')
    const media_ = (api as unknown as { testAiMediaSettings: ReturnType<typeof vi.fn> })
      .testAiMediaSettings
    expect(media_).toHaveBeenCalledTimes(2)
  })
})

describe('settings test connection: the cloud state is re-read', () => {
  it('re-reads the cloud on every test, even when no block runs on the cloud', async () => {
    const api = apiOf()
    const results = await runConnectionTests([media('image'), media('video')], api, tEn)
    expect(results.image).toEqual({ ok: true })
    expect(api.uniworkCloudRefresh).toHaveBeenCalledTimes(1)
  })

  it('reads the cloud once for several cloud blocks and names the plan state', async () => {
    const api = apiOf({ uniworkCloudRefresh: vi.fn(async () => statusOf('not-entitled')) })
    const cloud = (block: BlockCheck['block']): BlockCheck => ({ block, kind: 'cloud' })
    const results = await runConnectionTests(
      [cloud('search'), cloud('image'), media('video')],
      api,
      tEn,
    )
    expect(api.uniworkCloudRefresh).toHaveBeenCalledTimes(1)
    expect(results.search).toEqual({ ok: false, error: 'Not in your plan' })
    expect(results.image).toEqual({ ok: false, error: 'Not in your plan' })
    expect(results.video).toEqual({ ok: true })
  })

  it('does not hold the other blocks back for a slow cloud answer', async () => {
    let release: (s: UniworkCloudStatus) => void = () => undefined
    const api = apiOf({
      uniworkCloudRefresh: vi.fn(() => new Promise<UniworkCloudStatus>((r) => (release = r))),
    })
    const results = await runConnectionTests([media('image')], api, tEn)
    expect(results.image).toEqual({ ok: true })
    release(statusOf('ready'))
  })

  it('a failed cloud read does not break the vendor blocks', async () => {
    const api = apiOf({
      uniworkCloudRefresh: vi.fn(async () => {
        throw new Error('ipc closed')
      }),
    })
    const results = await runConnectionTests(
      [{ block: 'search', kind: 'cloud' }, media('image')],
      api,
      tEn,
    )
    expect(results.search).toEqual({ ok: false, error: 'Unavailable' })
    expect(results.image).toEqual({ ok: true })
  })
})
