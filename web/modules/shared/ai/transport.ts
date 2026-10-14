/**
 * The genoffice ai-provider, unchanged, on the UniWork BYOK proxy (CONTRACT C16).
 *
 * ai-provider builds each vendor request in the vendor's own wire format from a base URL; on the
 * web that base URL is the proxy route of the chosen provider (`<ai mount>/byok/<provider>`) and
 * no key is sent. This module is the `setPrimaryFetch` transport (packages/ai-provider/src/fetch.ts)
 * that turns the vendor-shaped URL into the proxy route and adds the frame token:
 *
 * | ai-provider asks for                                       | sent to                             |
 * |------------------------------------------------------------|-------------------------------------|
 * | <base>/chat/completions                                    | same (openai-compatible)            |
 * | <base>/v1/messages                                         | <base>/messages (Anthropic)         |
 * | <base>/models/<model>:streamGenerateContent?alt=sse        | <base>/generate {model, stream: true, request} |
 * | <base>/models/<model>:generateContent                      | <base>/generate {model, stream: false, request} |
 * | <base>/models                                              | same (GET)                          |
 *
 * Vendor key headers (`x-api-key`, `x-goog-api-key`, a vendor `Authorization`) and the
 * User-Agent are dropped; the request then goes out as an authorised AI-route call. Any URL
 * outside `<ai mount>/byok/` is refused: the frame never calls a vendor directly.
 *
 * Failures the proxy answers itself (contract codes, see ./errors.ts) are thrown as AiWebError
 * before ai-provider reads the body, so the UI shows a typed state; a provider's own 4xx (bad
 * model, output-cap rejection) reaches ai-provider unchanged.
 */
import {
  ProxyUrlError,
  proxyAnswered,
  toProxyRequest as toSharedProxyRequest,
  type ProxyRequest,
} from '../../../../packages/ai-provider/src/proxy-url'
import type { AiWebClient } from './client'
import { AiWebError, aiErrorFromResponse } from './errors'

export type { ProxyRequest }

/** vendor-shaped request -> the proxy request (pure; throws AiWebError for a foreign URL) */
export function toProxyRequest(aiBase: string, url: string, init: RequestInit = {}): ProxyRequest {
  try {
    return toSharedProxyRequest(aiBase, url, init)
  } catch (err) {
    // only a refused URL becomes the typed state; anything else (a malformed Gemini body) is rethrown as before
    if (!(err instanceof ProxyUrlError)) throw err
    throw new AiWebError({ code: 'bad_request', status: 0, message: err.message })
  }
}

/** the `setPrimaryFetch` transport for one frame */
export function createProxyFetch(
  client: Pick<AiWebClient, 'base' | 'fetch'>,
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const req = toProxyRequest(client.base, url, init)
    const res = await client.fetch(req.url, req.init)
    if (await proxyAnswered(res)) throw await aiErrorFromResponse(res)
    return res
  }
}
