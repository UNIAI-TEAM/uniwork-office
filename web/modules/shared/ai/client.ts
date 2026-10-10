/**
 * The frame's client of the web AI routes (GO-A7 contract, CONTRACT C16).
 *
 * The frame calls the frame-token mount itself, same origin (`connect-src 'self'`), with
 * `Authorization: Bearer <frame token>` and `credentials: 'omit'` (never cookies), and retries
 * once with a refreshed token after a 401. There is no postMessage relay for AI.
 *
 *   <same-origin api prefix>/v1/office-frame/documents/{documentID}/ai/
 *     credentials                      GET            { items: [Credential], providers: [...] }
 *     credentials/{provider}           PUT / DELETE   { api_key?, base_url?, label? } -> Credential
 *     byok/{provider}/chat/completions POST           openai-compatible wire format (SSE stays SSE)
 *     byok/{provider}/messages         POST           Anthropic Messages wire format
 *     byok/{provider}/generate         POST           { model, stream, request: <Gemini body> }
 *     byok/{provider}/models           GET            the provider's own JSON
 *     cloud                            GET            { enabled, reason?, tools, credits }
 *     cloud/search                     POST           { query, kind, max_results } -> { results, answer? }
 *     cloud/images                     POST           { prompt, aspect_ratio?, ... } -> { images, model }
 *     cloud/media/analyze              POST           { requirements, media: [...] } -> { text }
 *     cloud/transcribe                 POST           { prompt?, audio } -> { text }
 *
 * A key is never read back: `key_hint` is "…" + the last four characters.
 */
import { isInsideAiMount } from './mount'
import { AiWebError, aiErrorFromResponse } from './errors'

export interface AiCredential {
  provider: string
  label: string
  base_url: string
  key_hint: string
  created_at: string
  updated_at: string
}

export interface AiServerProvider {
  id: string
  protocol: string
  requires_base_url: boolean
  default_base_url: string
}

export interface AiCredentialList {
  items: AiCredential[]
  providers: AiServerProvider[]
}

export interface AiCredentialInput {
  /** required on create (<= 4096); omitted on update keeps the stored key */
  api_key?: string
  base_url?: string
  label?: string
}

export interface AiCloudTools {
  web_search: boolean
  image_search: boolean
  image_generate: boolean
  media_analyze: boolean
  transcribe: boolean
}

export interface AiCloudStatus {
  enabled: boolean
  reason?: string
  tools: AiCloudTools
  credits: {
    unit: string
    used: number
    limit: number | null
    remaining: number | null
    period_end: string | null
  }
}

export interface AiMedia {
  mime: string
  data_base64: string
}

export interface AiSearchResult {
  title: string
  url: string
  snippet: string
  image_url?: string
  thumbnail_url?: string
}

/** the slice of the frame protocol client the AI client needs (structural, mockable) */
export interface AiTokenSource {
  getToken(): Promise<string>
  refreshToken(reason: 'expiring' | 'unauthorized'): Promise<string>
}

export interface AiWebClientOptions {
  documentId: string
  /** `init.apiBase` (e.g. "https://app/api/v1" or "https://app/api") */
  apiBase: string
  tokens: AiTokenSource
  /** the frame's own origin (the routes are same-origin, C16); default location.origin */
  origin?: string
  fetch?: typeof fetch
}

export interface AiWebClient {
  /** absolute URL of the AI mount, without a trailing slash */
  readonly base: string
  /** authorised fetch of `base + path` (or of an absolute URL under `base`) */
  fetch(path: string, init?: RequestInit): Promise<Response>
  /** as fetch, but a non-2xx answer throws its AiWebError and the JSON body is returned */
  json<T>(path: string, init?: RequestInit): Promise<T>
  listCredentials(): Promise<AiCredentialList>
  saveCredential(provider: string, input: AiCredentialInput): Promise<AiCredential>
  deleteCredential(provider: string): Promise<void>
  cloudStatus(): Promise<AiCloudStatus>
  search(input: {
    query: string
    kind: 'web' | 'image'
    max_results?: number
  }): Promise<{ results: AiSearchResult[]; answer?: string }>
  generateImage(input: {
    prompt: string
    aspect_ratio?: string
    image_size?: string
    reference_images?: AiMedia[]
  }): Promise<{ images: AiMedia[]; model: string }>
  analyzeMedia(input: { requirements: string; media: AiMedia[] }): Promise<{ text: string }>
  transcribe(input: { prompt?: string; audio: AiMedia }): Promise<{ text: string }>
}

/**
 * `<origin><api path>/v1/office-frame/documents/<id>/ai`. The host's apiBase names the API prefix;
 * its path is kept and put on the frame's own origin (the routes are same-origin: the frame CSP is
 * `connect-src 'self'`). Both "/api" and "/api/v1" spellings of the prefix are accepted.
 */
export function aiRouteBase(apiBase: string, documentId: string, origin: string): string {
  let path: string
  try {
    path = new URL(apiBase, origin).pathname
  } catch {
    path = '/api'
  }
  path = path.replace(/\/+$/, '')
  if (!/\/v1$/.test(path)) path = `${path}/v1`
  return `${origin}${path}/office-frame/documents/${encodeURIComponent(documentId)}/ai`
}

const EMPTY_TOOLS: AiCloudTools = {
  web_search: false,
  image_search: false,
  image_generate: false,
  media_analyze: false,
  transcribe: false,
}

/** lenient reader of GET cloud (missing fields default like the dev client's zod schema) */
export function readCloudStatus(raw: unknown): AiCloudStatus {
  const r = (raw ?? {}) as Partial<AiCloudStatus>
  const credits = (r.credits ?? {}) as Partial<AiCloudStatus['credits']>
  return {
    enabled: r.enabled === true,
    ...(typeof r.reason === 'string' && r.reason ? { reason: r.reason } : {}),
    tools: { ...EMPTY_TOOLS, ...(r.tools ?? {}) },
    credits: {
      unit: typeof credits.unit === 'string' ? credits.unit : 'ai.tokens',
      used: typeof credits.used === 'number' ? credits.used : 0,
      limit: typeof credits.limit === 'number' ? credits.limit : null,
      remaining: typeof credits.remaining === 'number' ? credits.remaining : null,
      period_end: typeof credits.period_end === 'string' ? credits.period_end : null,
    },
  }
}

function readCredential(raw: unknown, fallbackProvider = ''): AiCredential {
  const r = (raw ?? {}) as Partial<AiCredential>
  const s = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    provider: s(r.provider) || fallbackProvider,
    label: s(r.label),
    base_url: s(r.base_url),
    key_hint: s(r.key_hint),
    created_at: s(r.created_at),
    updated_at: s(r.updated_at),
  }
}

function readCredentialList(raw: unknown): AiCredentialList {
  const r = (raw ?? {}) as { items?: unknown; providers?: unknown }
  const items = Array.isArray(r.items) ? r.items.map((c) => readCredential(c)) : []
  const providers = Array.isArray(r.providers)
    ? r.providers
        .map((p) => p as Partial<AiServerProvider>)
        .filter((p) => typeof p.id === 'string' && p.id)
        .map((p) => ({
          id: p.id as string,
          protocol: typeof p.protocol === 'string' ? p.protocol : '',
          requires_base_url: p.requires_base_url === true,
          default_base_url: typeof p.default_base_url === 'string' ? p.default_base_url : '',
        }))
    : []
  return { items, providers }
}

export function createAiWebClient(options: AiWebClientOptions): AiWebClient {
  const origin = options.origin ?? location.origin
  const base = aiRouteBase(options.apiBase, options.documentId, origin)
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))

  async function authorised(path: string, init: RequestInit = {}): Promise<Response> {
    const url = /^https?:\/\//.test(path) ? path : `${base}/${path.replace(/^\/+/, '')}`
    // the frame token never leaves the AI mount
    if (!isInsideAiMount(url, base)) {
      throw new AiWebError({ code: 'bad_request', status: 0, message: 'outside the AI routes' })
    }
    const attempt = (bearer: string): Promise<Response> => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${bearer}`)
      return doFetch(url, { ...init, headers, credentials: 'omit', mode: 'same-origin' })
    }
    let res = await attempt(await options.tokens.getToken())
    if (res.status === 401) res = await attempt(await options.tokens.refreshToken('unauthorized'))
    return res
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await authorised(path, init)
    if (!res.ok) throw await aiErrorFromResponse(res)
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  const post = <T>(path: string, body: unknown): Promise<T> =>
    json<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  return {
    base,
    fetch: authorised,
    json,
    listCredentials: async () => readCredentialList(await json('credentials')),
    saveCredential: async (provider, input) =>
      readCredential(
        await json(`credentials/${encodeURIComponent(provider)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
        provider,
      ),
    deleteCredential: async (provider) => {
      await json(`credentials/${encodeURIComponent(provider)}`, { method: 'DELETE' })
    },
    cloudStatus: async () => readCloudStatus(await json('cloud')),
    search: async (input) => {
      const r = await post<{ results?: AiSearchResult[]; answer?: string }>('cloud/search', input)
      return {
        results: Array.isArray(r?.results) ? r.results : [],
        ...(typeof r?.answer === 'string' && r.answer ? { answer: r.answer } : {}),
      }
    },
    generateImage: async (input) => {
      const r = await post<{ images?: AiMedia[]; model?: string }>('cloud/images', input)
      return {
        images: Array.isArray(r?.images) ? r.images : [],
        model: typeof r?.model === 'string' ? r.model : '',
      }
    },
    analyzeMedia: async (input) => {
      const r = await post<{ text?: string }>('cloud/media/analyze', input)
      return { text: typeof r?.text === 'string' ? r.text : '' }
    },
    transcribe: async (input) => {
      const r = await post<{ text?: string }>('cloud/transcribe', input)
      return { text: typeof r?.text === 'string' ? r.text : '' }
    },
  }
}
