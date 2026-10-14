import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_DEFAULT_USER_AGENT, setRescueFetch } from '../src/fetch'
import {
  PROVIDER_MODELS_FAILURE_TTL_MS,
  PROVIDER_MODELS_TTL_MS,
  ProviderModelCache,
  listProviderModels,
} from '../src/provider-models'
import type { AiProviderConfig } from '../src/types'

/**
 * `listProviderModels` feeds the model chip on the desktop with each vendor's own
 * `/models` answer, using the person's local key (never UniWork). Three halves
 * are pinned: the wire shape each protocol family returns, the fact that nothing
 * the network does can make it throw, and the cache that keeps the chip from
 * listing on every open. Bodies are synthetic but shaped like the vendors' docs.
 */

const OPENAI_BODY = { object: 'list', data: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-5.7-x' }] }
const ANTHROPIC_BODY = {
  data: [
    { type: 'model', id: 'claude-opus-5-5', display_name: 'Opus' },
    { type: 'model', id: 'claude-sonnet-5', display_name: 'Sonnet' },
  ],
  has_more: false,
}
const GEMINI_BODY = {
  models: [
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-9', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-3.7-flash' },
  ],
}
const OPENROUTER_BODY = {
  data: [{ id: 'openai/gpt-5.6-sol' }, { id: 'anthropic/claude-sonnet-5' }],
}

function json(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubFetch(response: Response | (() => Promise<Response>)): ReturnType<typeof vi.fn> {
  const mock =
    typeof response === 'function' ? vi.fn(response) : vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', mock)
  return mock
}

const url = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls[0]![0] as string
const headers = (mock: ReturnType<typeof vi.fn>) =>
  new Headers((mock.mock.calls[0]![1] as RequestInit).headers)

const key = (apiKey: string, extra: Partial<AiProviderConfig> = {}): AiProviderConfig => ({
  apiKey,
  model: '',
  ...extra,
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setRescueFetch(null)
})

describe('listProviderModels request and shapes', () => {
  it('openai-compatible: GET {base}/models with a Bearer key, reads data[].id', async () => {
    const mock = stubFetch(json(OPENAI_BODY))
    const out = await listProviderModels('openai', key('sk-secret'))
    expect(out).toEqual({ ok: true, ids: ['gpt-5.6-sol', 'gpt-5.7-x'] })
    expect(url(mock)).toBe('https://api.openai.com/v1/models')
    expect(headers(mock).get('authorization')).toBe('Bearer sk-secret')
    expect(headers(mock).get('user-agent')).toBe(AI_DEFAULT_USER_AGENT)
  })

  it('a stored base URL replaces the vendor default (regional mirror)', async () => {
    const mock = stubFetch(json(OPENAI_BODY))
    await listProviderModels('openai', key('k', { baseUrl: 'https://mirror.example/v1/' }))
    expect(url(mock)).toBe('https://mirror.example/v1/models')
  })

  it('anthropic: x-api-key + anthropic-version, reads data[].id', async () => {
    const mock = stubFetch(json(ANTHROPIC_BODY))
    const out = await listProviderModels('anthropic', key('sk-ant'))
    expect(out).toEqual({ ok: true, ids: ['claude-opus-5-5', 'claude-sonnet-5'] })
    expect(url(mock)).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(headers(mock).get('x-api-key')).toBe('sk-ant')
    expect(headers(mock).get('anthropic-version')).toBe('2023-06-01')
    expect(headers(mock).has('authorization')).toBe(false)
  })

  it('gemini: x-goog-api-key, strips models/, drops models that cannot generate', async () => {
    const mock = stubFetch(json(GEMINI_BODY))
    const out = await listProviderModels('gemini', key('AIza-k'))
    expect(out).toEqual({ ok: true, ids: ['gemini-3.8-flash', 'gemini-3.7-flash'] })
    expect(url(mock)).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
    expect(headers(mock).get('x-goog-api-key')).toBe('AIza-k')
  })

  it('OpenRouter / UniAI (genspark): the openrouter /models list with the Token Hub key', async () => {
    const mock = stubFetch(json(OPENROUTER_BODY))
    const out = await listProviderModels('genspark', key('sk-or-1'))
    expect(out.ids).toEqual(['openai/gpt-5.6-sol', 'anthropic/claude-sonnet-5'])
    expect(url(mock)).toBe('https://openrouter.ai/api/v1/models')
    expect(headers(mock).get('authorization')).toBe('Bearer sk-or-1')
  })

  it('custom: needs a base URL, key optional and omitted when blank', async () => {
    const mock = stubFetch(json(OPENAI_BODY))
    await listProviderModels('custom', key('', { baseUrl: 'http://127.0.0.1:8800/v1' }))
    expect(url(mock)).toBe('http://127.0.0.1:8800/v1/models')
    expect(headers(mock).has('authorization')).toBe(false)

    const none = stubFetch(json(OPENAI_BODY))
    expect(await listProviderModels('custom', key(''))).toEqual({ ok: false, ids: [] })
    expect(none).not.toHaveBeenCalled()
  })

  it('does not call out for a provider without a key, codex, or UniWork AI', async () => {
    const mock = stubFetch(json(OPENAI_BODY))
    expect(await listProviderModels('openai', key('  '))).toEqual({ ok: false, ids: [] })
    expect(await listProviderModels('codex', key('k'))).toEqual({ ok: false, ids: [] })
    expect(await listProviderModels('uniwork', key('k'))).toEqual({ ok: false, ids: [] })
    expect(mock).not.toHaveBeenCalled()
  })

  it('drops blank, repeated and non-string ids and keeps server order', async () => {
    stubFetch(
      json({ data: [{ id: ' b ' }, { id: 'a' }, { id: 'b' }, { id: '' }, { id: 7 }, null] }),
    )
    expect((await listProviderModels('openai', key('k'))).ids).toEqual(['b', 'a'])
  })
})

describe('listProviderModels never throws', () => {
  const failed = { ok: false, ids: [] }

  it('4xx / 5xx answers', async () => {
    stubFetch(json({ error: { message: 'bad key' } }, 401))
    expect(await listProviderModels('openai', key('k'))).toEqual(failed)
    stubFetch(json('upstream down', 502))
    expect(await listProviderModels('anthropic', key('k'))).toEqual(failed)
  })

  it('a non-JSON or wrongly shaped body', async () => {
    stubFetch(new Response('<html>502</html>', { status: 200 }))
    expect(await listProviderModels('openai', key('k'))).toEqual(failed)
    stubFetch(json({ data: 'nope' }))
    expect(await listProviderModels('openai', key('k'))).toEqual(failed)
    stubFetch(json({ models: {} }))
    expect(await listProviderModels('gemini', key('k'))).toEqual(failed)
  })

  it('an oversized body', async () => {
    const big = JSON.stringify({ data: [{ id: 'x'.repeat(3 * 1024 * 1024) }] })
    stubFetch(new Response(big, { status: 200 }))
    expect(await listProviderModels('openai', key('k'))).toEqual(failed)
  })

  it('a network error, silently: no rescue fetch, no console noise', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const rescue = vi.fn().mockResolvedValue(json(OPENAI_BODY))
    setRescueFetch(rescue)
    stubFetch(() => Promise.reject(new Error('fetch failed')))
    expect(await listProviderModels('openai', key('k'))).toEqual(failed)
    expect(rescue).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('a hang is cut at 5 s', async () => {
    vi.useFakeTimers()
    let aborted = false
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              aborted = true
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            })
          }),
      ),
    )
    const pending = listProviderModels('openai', key('k'))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await pending).toEqual(failed)
    expect(aborted).toBe(true)
  })

  it('an unusable base URL', async () => {
    const mock = stubFetch(json(OPENAI_BODY))
    expect(await listProviderModels('openai', key('k', { baseUrl: 'ftp://x' }))).toEqual(failed)
    expect(mock).not.toHaveBeenCalled()
  })

  it('an empty list is a successful answer', async () => {
    stubFetch(json({ data: [] }))
    expect(await listProviderModels('openai', key('k'))).toEqual({ ok: true, ids: [] })
  })
})

describe('ProviderModelCache', () => {
  function make(results: Array<{ ok: boolean; ids: string[] }>) {
    let now = 1_000
    const list = vi.fn(async () => results.shift() ?? { ok: false, ids: [] })
    const cache = new ProviderModelCache({ list, now: () => now })
    const settled = vi.fn()
    return {
      cache,
      list,
      settled,
      advance: (ms: number) => {
        now += ms
      },
    }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('the first read is "loading" and starts one listing; the next read carries the list', async () => {
    const t = make([{ ok: true, ids: ['m1', 'm2'] }])
    expect(t.cache.read('openai', key('k'), t.settled)).toEqual({ listState: 'loading' })
    expect(t.cache.read('openai', key('k'), t.settled)).toEqual({ listState: 'loading' })
    expect(t.list).toHaveBeenCalledTimes(1)
    await flush()
    expect(t.settled).toHaveBeenCalledTimes(1)
    expect(t.cache.read('openai', key('k'), t.settled)).toEqual({ listed: ['m1', 'm2'] })
    expect(t.list).toHaveBeenCalledTimes(1)
  })

  it('a refresh after the TTL keeps the old list and sets no state while it runs', async () => {
    const t = make([
      { ok: true, ids: ['m1'] },
      { ok: true, ids: ['m1', 'm3'] },
    ])
    t.cache.read('openai', key('k'), t.settled)
    await flush()
    t.advance(PROVIDER_MODELS_TTL_MS + 1)
    expect(t.cache.read('openai', key('k'), t.settled)).toEqual({ listed: ['m1'] })
    expect(t.list).toHaveBeenCalledTimes(2)
    await flush()
    expect(t.settled).toHaveBeenCalledTimes(2)
    expect(t.cache.read('openai', key('k'), t.settled)).toEqual({ listed: ['m1', 'm3'] })
  })

  it('a failed first listing reads as "error" and is retried only after the short TTL', async () => {
    const t = make([
      { ok: false, ids: [] },
      { ok: true, ids: ['m1'] },
    ])
    t.cache.read('openai', key('k'), t.settled)
    await flush()
    expect(t.cache.read('openai', key('k'), t.settled)).toEqual({ listState: 'error' })
    expect(t.list).toHaveBeenCalledTimes(1)
    t.advance(PROVIDER_MODELS_FAILURE_TTL_MS + 1)
    t.cache.read('openai', key('k'), t.settled)
    expect(t.list).toHaveBeenCalledTimes(2)
    await flush()
    expect(t.cache.read('openai', key('k'), t.settled)).toEqual({ listed: ['m1'] })
  })

  it('a failed refresh over a kept list leaves the list and sets no error', async () => {
    const t = make([
      { ok: true, ids: ['m1'] },
      { ok: false, ids: [] },
    ])
    t.cache.read('openai', key('k'), t.settled)
    await flush()
    t.advance(PROVIDER_MODELS_TTL_MS + 1)
    t.cache.read('openai', key('k'), t.settled)
    await flush()
    expect(t.cache.read('openai', key('k'), t.settled)).toEqual({ listed: ['m1'] })
  })

  it('a changed key or base URL drops the old list and lists again', async () => {
    const t = make([
      { ok: true, ids: ['old'] },
      { ok: true, ids: ['new'] },
      { ok: true, ids: ['mirror'] },
    ])
    t.cache.read('openai', key('k1'), t.settled)
    await flush()
    expect(t.cache.read('openai', key('k2'), t.settled)).toEqual({ listState: 'loading' })
    await flush()
    expect(t.cache.read('openai', key('k2'), t.settled)).toEqual({ listed: ['new'] })
    expect(
      t.cache.read('openai', key('k2', { baseUrl: 'https://m.example/v1' }), t.settled),
    ).toEqual({ listState: 'loading' })
    expect(t.list).toHaveBeenCalledTimes(3)
  })

  it('an answer that lands after the key changed is dropped', async () => {
    let release!: (v: { ok: boolean; ids: string[] }) => void
    const list = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (release = r)))
      .mockResolvedValueOnce({ ok: true, ids: ['fresh'] })
    const cache = new ProviderModelCache({ list })
    const settled = vi.fn()
    cache.read('openai', key('k1'), settled)
    cache.read('openai', key('k2'), settled)
    release({ ok: true, ids: ['stale'] })
    await flush()
    expect(cache.read('openai', key('k2'), settled)).toEqual({ listed: ['fresh'] })
  })

  it('an empty successful list is "listed nothing": no list, no error, no loop', async () => {
    const t = make([{ ok: true, ids: [] }])
    t.cache.read('openai', key('k'), t.settled)
    await flush()
    expect(t.cache.read('openai', key('k'), t.settled)).toEqual({})
    expect(t.list).toHaveBeenCalledTimes(1)
  })

  it('providers that cannot be listed read as empty without calling out', () => {
    const t = make([])
    expect(t.cache.read('codex', key('k'), t.settled)).toEqual({})
    expect(t.cache.read('openai', key(''), t.settled)).toEqual({})
    expect(t.list).not.toHaveBeenCalled()
  })

  it('the key is never a map key: a different key with the same length is a different entry', async () => {
    const t = make([
      { ok: true, ids: ['a'] },
      { ok: true, ids: ['b'] },
    ])
    t.cache.read('openai', key('aaaa'), t.settled)
    await flush()
    t.cache.read('openai', key('bbbb'), t.settled)
    await flush()
    expect(t.list).toHaveBeenCalledTimes(2)
    expect(JSON.stringify([...Object.keys(t.cache)])).not.toContain('aaaa')
  })

  it('forget() drops one provider so the next read lists again', async () => {
    const t = make([
      { ok: true, ids: ['a'] },
      { ok: true, ids: ['b'] },
    ])
    t.cache.read('openai', key('k'), t.settled)
    await flush()
    t.cache.forget('openai')
    expect(t.cache.read('openai', key('k'), t.settled)).toEqual({ listState: 'loading' })
  })
})
