/**
 * UniWork cloud tools (web/image search, image generation, media analysis,
 * transcription), paid with the organization's UniWork AI credits.
 *
 * This module is the seam shared by every process: it holds the last cloud
 * status the shell main process published and, in that main process only, the
 * transport that performs the calls. Nothing here imports Electron or opens a
 * connection: the shell injects the transport (a client that adds the bearer
 * token itself, so no token ever reaches this module or a renderer), and the
 * shell / editor preloads mirror the status for their pickers.
 *
 * The cloud is enabled iff the user is signed in to UniWork AND the server says
 * the selected organization's plan includes it; each tool also needs its own
 * availability flag. Slide generation is not a cloud tool.
 */

export type UniworkCloudTool =
  'web_search' | 'image_search' | 'image_generate' | 'media_analyze' | 'transcribe'

export const UNIWORK_CLOUD_TOOLS: readonly UniworkCloudTool[] = [
  'web_search',
  'image_search',
  'image_generate',
  'media_analyze',
  'transcribe',
]

/**
 * What the UI shows:
 * - `signed-out`: no UniWork session (sign in to use the cloud)
 * - `not-entitled`: signed in, the plan does not include UniWork cloud AI
 * - `subscription-inactive`: the plan has it but the organization's subscription is not active
 * - `credits-exhausted`: entitled, no credits left this period
 * - `unavailable`: entitled but the server could not be read, or no tool is configured
 * - `ready`: entitled with tools to offer
 */
export type UniworkCloudState =
  | 'signed-out'
  | 'not-entitled'
  | 'subscription-inactive'
  | 'credits-exhausted'
  | 'unavailable'
  | 'ready'

/** states in which the cloud is not offered at all (no tool, no picker entry) */
const CLOUD_OFF_STATES: readonly UniworkCloudState[] = [
  'signed-out',
  'not-entitled',
  'subscription-inactive',
]

export interface UniworkCloudCredits {
  /** the server meter (`ai.tokens`) */
  unit: string
  used: number
  /** null = no cap on this plan */
  limit: number | null
  remaining: number | null
  periodEnd: string | null
}

/** token-free snapshot; safe to send to any renderer */
export interface UniworkCloudStatus {
  state: UniworkCloudState
  /** signed in and the plan includes the cloud (calls may still answer 402 / 503) */
  enabled: boolean
  tools: Record<UniworkCloudTool, boolean>
  credits: UniworkCloudCredits | null
  /** display only: the signed-in account and plan */
  email?: string
  planName?: string
}

const NO_TOOLS: Record<UniworkCloudTool, boolean> = {
  web_search: false,
  image_search: false,
  image_generate: false,
  media_analyze: false,
  transcribe: false,
}

export const UNIWORK_CLOUD_SIGNED_OUT: UniworkCloudStatus = Object.freeze({
  state: 'signed-out',
  enabled: false,
  tools: NO_TOOLS,
  credits: null,
}) as UniworkCloudStatus

let current: UniworkCloudStatus = UNIWORK_CLOUD_SIGNED_OUT
const listeners = new Set<(status: UniworkCloudStatus) => void>()

/** Replaces this process's snapshot (shell main after each status read; preloads on a push). */
export function setUniworkCloudStatus(status: UniworkCloudStatus | null | undefined): void {
  current = normalizeUniworkCloudStatus(status)
  for (const listener of listeners) listener(current)
}

export function getUniworkCloudStatus(): UniworkCloudStatus {
  return current
}

export function onUniworkCloudStatus(listener: (status: UniworkCloudStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Signed in and entitled: the cloud route is offered (each tool still needs its flag). */
export function uniworkCloudEnabled(): boolean {
  return current.enabled
}

export function uniworkCloudToolAvailable(tool: UniworkCloudTool): boolean {
  return current.enabled && current.tools[tool] === true
}

/** Defensive copy of an IPC payload; anything malformed reads as signed out. */
export function normalizeUniworkCloudStatus(raw: unknown): UniworkCloudStatus {
  if (!raw || typeof raw !== 'object') return UNIWORK_CLOUD_SIGNED_OUT
  const r = raw as Partial<UniworkCloudStatus>
  const states: UniworkCloudState[] = [
    'signed-out',
    'not-entitled',
    'subscription-inactive',
    'credits-exhausted',
    'unavailable',
    'ready',
  ]
  if (!states.includes(r.state as UniworkCloudState)) return UNIWORK_CLOUD_SIGNED_OUT
  const tools = { ...NO_TOOLS }
  for (const tool of UNIWORK_CLOUD_TOOLS) tools[tool] = r.tools?.[tool] === true
  const c = r.credits
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const credits: UniworkCloudCredits | null =
    c && typeof c === 'object'
      ? {
          unit: typeof c.unit === 'string' ? c.unit : 'ai.tokens',
          used: num(c.used) ?? 0,
          limit: num(c.limit),
          remaining: num(c.remaining),
          periodEnd: typeof c.periodEnd === 'string' ? c.periodEnd : null,
        }
      : null
  return {
    state: r.state as UniworkCloudState,
    enabled: r.enabled === true && !CLOUD_OFF_STATES.includes(r.state as UniworkCloudState),
    tools,
    credits,
    ...(typeof r.email === 'string' && r.email ? { email: r.email } : {}),
    ...(typeof r.planName === 'string' && r.planName ? { planName: r.planName } : {}),
  }
}

// ── Transport (shell main process only) ─────────────────────────────

export type UniworkCloudErrorCode =
  | 'signed_out'
  | 'entitlement_required'
  | 'subscription_inactive'
  | 'no_access'
  | 'credits_exhausted'
  | 'cloud_unavailable'
  | 'rate_limited'
  | 'invalid_request'
  | 'network'
  | 'timeout'
  | 'server_error'
  | 'malformed_response'
  | 'aborted'

/** Messages are written for the model reading a tool result; they never carry a URL, body or token. */
const ERROR_TEXT: Record<UniworkCloudErrorCode, string> = {
  signed_out:
    'UniWork cloud AI needs a UniWork sign-in; ask the user to sign in under Settings (Account)',
  entitlement_required:
    "The organization's UniWork plan does not include UniWork cloud AI; tell the user to ask an organization admin about the plan, or to set up their own provider under Settings (AI Media); never offer a purchase",
  subscription_inactive:
    "The organization's UniWork subscription is not active; tell the user to ask an organization admin to renew it, or to set up their own provider under Settings (AI Media)",
  no_access:
    'The user no longer has access to the selected UniWork organization; ask them to check the organization under Settings (Account) or set up their own provider under Settings (AI Media)',
  credits_exhausted:
    'The UniWork AI credits for this billing period are used up; tell the user their organization is out of credits (an organization admin can add credits, or they can use their own provider under Settings (AI Media))',
  cloud_unavailable: 'This UniWork cloud AI tool is unavailable right now; try again later',
  rate_limited: 'Too many UniWork cloud AI requests; wait a minute and try again',
  invalid_request: 'UniWork cloud AI rejected the request (check the input size and content)',
  network: 'Could not reach the UniWork server; check the connection and try again',
  timeout: 'The UniWork cloud AI request timed out; try again',
  server_error: 'The UniWork server had a problem; try again later',
  malformed_response: 'The UniWork server sent an unexpected answer; try again later',
  aborted: 'The request was cancelled',
}

export class UniworkCloudError extends Error {
  readonly code: UniworkCloudErrorCode
  readonly status?: number | undefined
  constructor(code: UniworkCloudErrorCode, status?: number) {
    super(ERROR_TEXT[code])
    this.name = 'UniworkCloudError'
    this.code = code
    this.status = status
  }
}

export interface UniworkCloudMedia {
  mime: string
  /** base64 without a data: prefix */
  dataBase64: string
}

export interface UniworkCloudSearchResult {
  title: string
  url: string
  snippet: string
  imageUrl?: string
  thumbnailUrl?: string
}

export interface UniworkCloudTransport {
  search(
    request: { query: string; kind: 'web' | 'image'; maxResults: number },
    signal?: AbortSignal,
  ): Promise<{ results: UniworkCloudSearchResult[]; answer?: string }>
  generateImage(
    request: {
      prompt: string
      aspectRatio?: string
      imageSize?: string
      referenceImages?: UniworkCloudMedia[]
    },
    signal?: AbortSignal,
  ): Promise<{ images: UniworkCloudMedia[]; model: string }>
  analyzeMedia(
    request: { requirements: string; media: UniworkCloudMedia[] },
    signal?: AbortSignal,
  ): Promise<{ text: string }>
  transcribe(
    request: { prompt?: string; audio: UniworkCloudMedia },
    signal?: AbortSignal,
  ): Promise<{ text: string }>
}

let transport: UniworkCloudTransport | null = null

/** Shell main only: installs (or clears) the client that talks to the UniWork server. */
export function setUniworkCloudTransport(next: UniworkCloudTransport | null): void {
  transport = next
}

/** The installed transport; throws `signed_out` where none exists (renderers, the CLI). */
export function uniworkCloudTransport(): UniworkCloudTransport {
  if (!transport) throw new UniworkCloudError('signed_out')
  return transport
}
