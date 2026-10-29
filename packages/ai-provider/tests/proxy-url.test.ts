import { describe, expect, it } from 'vitest'
import * as index from '../src/index'
import * as proxyUrl from '../src/proxy-url'
import { isInsideAiMount, proxyErrorBodyFields } from '../src/index'

const BASE = 'https://app.test/api/v1/office-frame/documents/doc-1/ai'

// UNI-2289: UniWork AI only. What is left of the old BYOK proxy rewriter is the AI mount check
// (every frame AI fetch) and the error-body reader (every typed failure of the AI routes).
describe('proxy-url', () => {
  it('isInsideAiMount keeps a URL inside the AI mount after normalisation; nothing rewrites vendor URLs any more', () => {
    expect(Object.keys(proxyUrl).sort()).toEqual(['isInsideAiMount', 'proxyErrorBodyFields'])
    for (const gone of [
      'toProxyRequest',
      'ProxyUrlError',
      'isProxy404',
      'isProxyContractStatus',
      'proxyAnswered',
    ]) {
      expect(index, gone).not.toHaveProperty(gone)
    }
    expect(isInsideAiMount(BASE, BASE)).toBe(true)
    expect(isInsideAiMount(`${BASE}/uniwork/chat/completions`, BASE)).toBe(true)
    for (const url of [
      `${BASE}/../../x`,
      `${BASE}/%2e%2e/%2e%2e/x`,
      `${BASE}/cloud%2f..%2fx`,
      `${BASE}\\..\\x`,
      `${BASE}-other/cloud`,
      `${BASE.replace('app.test', 'app.test.evil.test')}/cloud`,
      BASE.replace('https://', 'https://user:pw@'),
      'not a url',
    ]) {
      expect(isInsideAiMount(url, BASE), url).toBe(false)
    }
  })

  it('proxyErrorBodyFields reads code and message from the wrapped and the flat error body', () => {
    expect(
      proxyErrorBodyFields({ error: { code: 'credits_exhausted', message: 'no credits' } }),
    ).toEqual({ code: 'credits_exhausted', message: 'no credits' })
    expect(proxyErrorBodyFields({ code: 'cloud_unavailable', message: 'down' })).toEqual({
      code: 'cloud_unavailable',
      message: 'down',
    })
    // a wrapped body without a code falls back to the flat fields
    expect(proxyErrorBodyFields({ error: { message: 'only' }, code: 'flat' })).toEqual({
      code: 'flat',
    })
    expect(proxyErrorBodyFields({ error: 'busy' })).toEqual({})
    expect(proxyErrorBodyFields('x')).toEqual({})
    expect(proxyErrorBodyFields(null)).toEqual({})
  })
})
