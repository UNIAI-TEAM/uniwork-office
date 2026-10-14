/**
 * Shared URL and request rewriter for the UniWork BYOK proxy (used by both the web frame transport
 * and the desktop shell's UniWork-key host, ADR 0029 / ADR 0034).
 *
 * ai-provider builds each vendor request in the vendor's own wire format from a base URL
 * (`<ai mount>/byok/<provider>`). `toProxyRequest` rewrites that vendor-shaped URL into the
 * UniWork proxy route and strips vendor key headers (`authorization`, `x-api-key`,
 * `x-goog-api-key`) and `user-agent`:
 *
 * | ai-provider asks for                                       | sent to                                         |
 * |------------------------------------------------------------|-------------------------------------------------|
 * | <base>/chat/completions                                    | same (openai-compatible)                        |
 * | <base>/v1/messages                                         | <base>/messages (Anthropic)                     |
 * | <base>/models/<model>:streamGenerateContent?alt=sse        | <base>/generate {model, stream: true, request}  |
 * | <base>/models/<model>:generateContent                      | <base>/generate {model, stream: false, request} |
 * | <base>/models                                              | same (GET)                                      |
 *
 * Any URL outside `<aiBase>/byok/` after URL path normalisation is refused with `ProxyUrlError`.
 */

const DROPPED_HEADERS = new Set(['authorization', 'x-api-key', 'x-goog-api-key', 'user-agent'])

const PROXY_CONTRACT_STATUSES = new Set([401, 402, 403, 404, 424, 429, 502, 503])

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

export class ProxyUrlError extends Error {
  readonly code = 'bad_request' as const
  readonly status = 0

  constructor(message: string) {
    super(message)
    this.name = 'ProxyUrlError'
  }
}

/**
 * `url` is inside `base` (the AI mount or a path below it): same origin and, after the URL parser
 * has collapsed `.` / `..` / `%2e` segments, a path under the mount's. Encoded slashes and
 * backslashes are refused outright (a server may decode them into a different path). A raw string
 * prefix test is not enough: `${base}/../../x` starts with `${base}/` and still leaves the mount.
 */
export function isInsideAiMount(url: string, base: string): boolean {
  let u: URL
  let b: URL
  try {
    u = new URL(url)
    b = new URL(base)
  } catch {
    return false
  }
  if (u.origin !== b.origin || u.username || u.password) return false
  if (/%2f|%5c|\\/i.test(u.pathname)) return false
  return u.pathname === b.pathname || u.pathname.startsWith(`${b.pathname}/`)
}

/** vendor-shaped request -> the proxy request (pure; throws ProxyUrlError for a foreign URL) */
export function toProxyRequest(aiBase: string, url: string, init: RequestInit = {}): ProxyRequest {
  const byok = `${aiBase}/byok/`
  // a parsed, normalised path check (a raw string prefix lets `byok/../../x` through)
  if (!url.startsWith(byok) || !isInsideAiMount(url, `${aiBase}/byok`)) {
    throw new ProxyUrlError('not an AI proxy URL')
  }
  const parsed = new URL(url)
  const rest = parsed.pathname.slice(new URL(byok).pathname.length)
  const slash = rest.indexOf('/')
  const provider = slash < 0 ? rest : rest.slice(0, slash)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(provider)) {
    throw new ProxyUrlError('not an AI proxy URL')
  }
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
  throw new ProxyUrlError(`no proxy route for ${tail}`)
}

/**
 * `code` / `message` of a server error body (`{ error: { code, message } }` or flat `{ code, message }`).
 */
export function proxyErrorBodyFields(body: unknown): { code?: string; message?: string } {
  const read = (v: unknown): { code?: string; message?: string } => {
    if (!v || typeof v !== 'object') return {}
    const { code, message } = v as { code?: unknown; message?: unknown }
    return {
      ...(typeof code === 'string' ? { code } : {}),
      ...(typeof message === 'string' ? { message } : {}),
    }
  }
  const wrapped = read((body as { error?: unknown } | null | undefined)?.error)
  return wrapped.code !== undefined ? wrapped : read(body)
}

/** Statuses the BYOK proxy answers itself (contract errors). A vendor 400/422 passes through. */
export function isProxyContractStatus(status: number): boolean {
  return PROXY_CONTRACT_STATUSES.has(status)
}

/**
 * A 404 counts as a proxy answer only when `code` is `credential_missing`; a vendor's own 404
 * (e.g. unknown model) or an older server's route-level 404 without that code returns false.
 */
export async function isProxy404(res: Response): Promise<boolean> {
  if (res.status !== 404) return false
  try {
    return proxyErrorBodyFields(await res.clone().json()).code === 'credential_missing'
  } catch {
    return false
  }
}

/** a 404 is a contract failure only when the proxy says so (a provider's own 404 passes through) */
export async function proxyAnswered(res: Response): Promise<boolean> {
  if (!isProxyContractStatus(res.status)) return false
  if (res.status !== 404) return true
  return isProxy404(res)
}
