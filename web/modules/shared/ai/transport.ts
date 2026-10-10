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
import { AiWebError, aiErrorFromResponse, isContractFailure } from './errors'
import type { AiWebClient } from './client'

const DROPPED_HEADERS = new Set(['authorization', 'x-api-key', 'x-goog-api-key', 'user-agent'])

function plainHeaders(given: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  new Headers(given).forEach((value, name) => {
    if (!DROPPED_HEADERS.has(name.toLowerCase())) out[name] = value
  })
  return out
}

export interface ProxyRequest {
  url: string
  init: RequestInit
}

/** vendor-shaped request -> the proxy request (pure; throws AiWebError for a foreign URL) */
export function toProxyRequest(aiBase: string, url: string, init: RequestInit = {}): ProxyRequest {
  const byok = `${aiBase}/byok/`
  if (!url.startsWith(byok)) {
    throw new AiWebError({ code: 'bad_request', status: 0, message: 'not an AI proxy URL' })
  }
  const parsed = new URL(url)
  const rest = parsed.pathname.slice(new URL(byok).pathname.length)
  const slash = rest.indexOf('/')
  const provider = slash < 0 ? rest : rest.slice(0, slash)
  const tail = slash < 0 ? '' : rest.slice(slash)
  const providerBase = `${aiBase}/byok/${provider}`
  const headers = plainHeaders(init.headers)
  const base: RequestInit = { ...init, headers }

  if (tail === '/chat/completions' || tail === '/models' || tail === '/messages') {
    return { url: `${providerBase}${tail}`, init: base }
  }
  if (tail === '/v1/messages') return { url: `${providerBase}/messages`, init: base }
  const gemini = /^\/models\/([^/:]+):(streamGenerateContent|generateContent)$/.exec(tail)
  if (gemini) {
    const [, model, method] = gemini
    let request: unknown = {}
    if (typeof init.body === 'string' && init.body) request = JSON.parse(init.body)
    return {
      url: `${providerBase}/generate`,
      init: {
        ...base,
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: decodeURIComponent(model!),
          stream: method === 'streamGenerateContent',
          request,
        }),
      },
    }
  }
  throw new AiWebError({ code: 'bad_request', status: 0, message: `no proxy route for ${tail}` })
}

/** a 404 is a contract failure only when the proxy says so (a provider's own 404 passes through) */
async function proxyAnswered(res: Response): Promise<boolean> {
  if (!isContractFailure(res.status)) return false
  if (res.status !== 404) return true
  try {
    const body = (await res.clone().json()) as { code?: unknown }
    return body?.code === 'credential_missing'
  } catch {
    return false
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
