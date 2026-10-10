import { afterEach, describe, expect, it, vi } from 'vitest'
import { testChatConnection } from '../src/ai-chat-test'
import { errorResponse, jsonResponse, okResponse, sseStream } from './test-utils'

afterEach(() => {
  vi.unstubAllGlobals()
})

const CUSTOM = { baseUrl: 'https://router.example/v1', apiKey: 'k', model: 'deepseek-4.1' }
const ANSWER = [
  'data: {"choices":[{"delta":{"content":"OK"}}]}',
  'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
  'data: [DONE]',
]

describe('testChatConnection (Settings > AI Model test)', () => {
  it('talks to the endpoint chat uses: streamed chat/completions with the configured model', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(okResponse(sseStream(ANSWER))))
    vi.stubGlobal('fetch', fetchMock)
    const result = await testChatConnection('custom', CUSTOM)
    expect(result).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://router.example/v1/chat/completions')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.stream).toBe(true)
    expect(body.model).toBe('deepseek-4.1')
  })

  it('passes against a gateway that only answers the streamed wire (the one-shot request fails there)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const streamed = (JSON.parse(String(init.body)) as { stream?: boolean }).stream === true
        return Promise.resolve(
          streamed
            ? okResponse(sseStream(ANSWER))
            : errorResponse(400, '{"error":"stream required"}'),
        )
      }),
    )
    expect(await testChatConnection('custom', CUSTOM)).toEqual({ ok: true })
  })

  it('counts a thinking-only start as an answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          okResponse(
            sseStream([
              'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}',
              'data: [DONE]',
            ]),
          ),
        ),
    )
    expect(await testChatConnection('custom', CUSTOM)).toEqual({ ok: true })
  })

  it('a rejected key fails with the raw text the log keeps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errorResponse(401, '{"error":"API key required"}')),
    )
    const result = await testChatConnection('custom', CUSTOM)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('HTTP 401')
  })

  it('a JSON body in place of a stream is a failure, not a pass', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ choices: [] })))
    const result = await testChatConnection('custom', CUSTOM)
    expect(result.ok).toBe(false)
  })

  it('a provider that never answers times out with the timeout code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      ),
    )
    const result = await testChatConnection('custom', CUSTOM, { timeoutMs: 20 })
    expect(result).toMatchObject({ ok: false, errorCode: 'timeout' })
  })
})
