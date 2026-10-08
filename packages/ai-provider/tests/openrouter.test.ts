import { describe, expect, it, vi } from 'vitest'
import {
  formatOpenRouterKeySummary,
  openRouterAttributionHeaders,
  probeOpenRouterKey,
} from '../src/openrouter'

describe('openrouter token hub', () => {
  it('formats remaining + usage', () => {
    expect(
      formatOpenRouterKeySummary({ limitRemaining: 12.5, usage: 3.2, limit: 100 }),
    ).toBe('Remaining $12.50 · usage $3.20')
    expect(formatOpenRouterKeySummary({ limit: null, usage: 1 })).toBe('No key limit · usage $1.00')
  })

  it('adds attribution headers only for openrouter hosts', () => {
    expect(openRouterAttributionHeaders('https://openrouter.ai/api/v1')['HTTP-Referer']).toBe(
      'https://uniwork.app',
    )
    expect(openRouterAttributionHeaders('https://api.openai.com/v1')).toEqual({})
  })

  it('probes GET /api/v1/key', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            label: 'sk-or-v1-…',
            usage: 25.5,
            limit: 100,
            limit_remaining: 74.5,
            is_free_tier: false,
          },
        }),
        { status: 200 },
      ),
    )
    const r = await probeOpenRouterKey('sk-or-test', fetchImpl as unknown as typeof fetch)
    expect(r.ok).toBe(true)
    expect(r.limitRemaining).toBe(74.5)
    expect(r.summary).toContain('Remaining')
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://openrouter.ai/api/v1/key')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer sk-or-test',
    })
  })

  it('returns error on HTTP failure', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'Missing Authentication header' } }), {
          status: 401,
        }),
    )
    const r = await probeOpenRouterKey('bad', fetchImpl as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Missing Authentication|401/)
  })
})
