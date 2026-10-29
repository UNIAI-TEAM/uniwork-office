/**
 * The frame's client of the web AI routes (GO-A7 contract, CONTRACT C16).
 *
 * The frame calls the frame-token mount itself, same origin (`connect-src 'self'`), with
 * `Authorization: Bearer <frame token>` and `credentials: 'omit'` (never cookies), and retries
 * once with a refreshed token after a 401. There is no postMessage relay for AI.
 *
 *   <same-origin api prefix>/v1/office-frame/documents/{documentID}/ai/
 *     cloud                            GET            { enabled, reason?, tools, credits, uniwork_model? }
 *     cloud/search                     POST           { query, kind, max_results } -> { results, answer? }
 *     cloud/images                     POST           { prompt, aspect_ratio?, ... } -> { images, model }
 *     cloud/media/analyze              POST           { requirements, media: [...] } -> { text }
 *     cloud/transcribe                 POST           { prompt?, audio } -> { text }
 *     uniwork/chat/completions         POST           UniWork AI: one agent turn, openai-compatible, raw Response
 *     uniwork/write                    POST           { kind, lang, input }: a one-shot writer of the open run, SSE, raw Response
 *
 * UniWork AI is the only AI of the frame (UNI-2289): it never reads or stores a key.
 */
import { isInsideAiMount } from './mount'
import { AiWebError, aiErrorFromResponse } from './errors'

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
  /** optional organization id from GET cloud (used for UniWork AI disclosure ack identity) */
  org_id?: string
  /** optional organization display name from GET cloud (used for {org} in UniWork AI disclosure) */
  org_name?: string
  tools: AiCloudTools
  credits: {
    unit: string
    used: number
    limit: number | null
    remaining: number | null
    period_end: string | null
  }
  /** the model UniWork AI serves (server policy); "" = unknown (an older server omits it) */
  uniwork_model: string
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
  /**
   * One UniWork AI request (`uniwork/chat/completions`): authorised like every AI call (frame token,
   * one refresh after a 401) and returned RAW, a non-2xx answer included. The UniWork AI adapter reads
   * the status, the body's `code` and the id headers itself (a thrown AiWebError would hide them).
   */
  uniworkChat(request: {
    headers: Record<string, string>
    body: string
    signal?: AbortSignal
  }): Promise<Response>
  /**
   * One UniWork AI writer call (`uniwork/write`): a one-shot writer inside the run the headers
   * name, authorised and returned RAW like `uniworkChat`.
   */
  uniworkWrite(
    body: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Response>
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
    ...(typeof r.org_id === 'string' && r.org_id ? { org_id: r.org_id } : {}),
    ...(typeof r.org_name === 'string' && r.org_name ? { org_name: r.org_name } : {}),
    tools: { ...EMPTY_TOOLS, ...(r.tools ?? {}) },
    credits: {
      unit: typeof credits.unit === 'string' ? credits.unit : 'ai.tokens',
      used: typeof credits.used === 'number' ? credits.used : 0,
      limit: typeof credits.limit === 'number' ? credits.limit : null,
      remaining: typeof credits.remaining === 'number' ? credits.remaining : null,
      period_end: typeof credits.period_end === 'string' ? credits.period_end : null,
    },
    uniwork_model: typeof r.uniwork_model === 'string' ? r.uniwork_model.trim() : '',
  }
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

  /** as authorised, but a non-2xx answer throws its AiWebError and the JSON body is returned */
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
    uniworkChat: (request) =>
      authorised('uniwork/chat/completions', {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        ...(request.signal ? { signal: request.signal } : {}),
      }),
    uniworkWrite: (body, headers, signal) =>
      authorised('uniwork/write', { method: 'POST', headers, body, ...(signal ? { signal } : {}) }),
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
