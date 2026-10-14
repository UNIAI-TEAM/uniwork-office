import { extname } from 'node:path'
import { getUiLang } from '@genoffice/i18n'
import {
  UNIWORK_RUN_HEADER,
  UniworkError,
  aiStreamErrorFields,
  streamUniwork,
  type AiStreamChunk,
  type AiStreamRequest,
  type StreamCallbacks,
  type UniworkChatRequest,
  type UniworkChatTransport,
  type UniworkCloudStatus,
  type UniworkFormat,
  type UniworkScope,
  type UniworkToolPolicy,
  type UniworkTurnRequest,
} from '@genoffice/ai-provider'
import type { TabKind } from '../../shared/tabs-api'
import type { CapabilityRead, OfficeCapabilities } from '../uniwork-sync/capability/cache'
import { cloudChatEnabled } from './cloud'
import { isAllowedOrigin, type DeploymentProfile } from './deployment'
import { TransportError, type FetchLike } from './transport'

/**
 * UniWork AI in the shell main process (desktop half of the `uniwork`
 * provider; the adapter itself lives in @genoffice/ai-provider):
 *
 * - the chat transport the adapter posts through: the document route for a
 *   tab showing a document bound to UniWork, the organization route (+
 *   `module`) for a local file; the device bearer is added here per call and
 *   never leaves main;
 * - the sender webContents -> scope resolver (OQ-P2);
 * - when UniWork AI is offered (EXPERIENCE › S7, desktop);
 * - the `ai:stream` runner for the provider: pings through a Retry-After
 *   wait, a sign-out cancels every running turn, and a failure carries the
 *   server's code so the renderer never classifies it as "overloaded".
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const CHAT_ROUTE = '/ai/uniwork/chat/completions'

// ── Transport ───────────────────────────────────────────────────────

export interface UniworkAiChatTransportDeps {
  /** the active deployment profile (null = not configured) */
  profile(): DeploymentProfile | null
  /** account manager: a token per call, one refresh + retry on TransportError `unauthorized` */
  authorized<T>(call: (token: string) => Promise<T>): Promise<T>
  fetch?: FetchLike
}

/** the façade URL of a desktop scope; throws for the web frame route or an id that is not one */
export function uniworkAiChatUrl(profile: DeploymentProfile, scope: UniworkScope): string {
  const origin = new URL(profile.apiOrigin)
  if (!isAllowedOrigin(origin, profile.channel)) throw new Error('uniwork ai: origin refused')
  switch (scope.kind) {
    case 'document':
      if (!ID.test(scope.documentId)) throw new Error('uniwork ai: invalid document id')
      return `${origin.origin}/api/v1/documents/${encodeURIComponent(scope.documentId)}${CHAT_ROUTE}`
    case 'org':
      if (!ID.test(scope.orgId)) throw new Error('uniwork ai: invalid organization id')
      return `${origin.origin}/api/v1/orgs/${encodeURIComponent(scope.orgId)}${CHAT_ROUTE}`
    default:
      // the frame route belongs to the web host (frame token), never to the desktop
      throw new Error('uniwork ai: no desktop route for this scope')
  }
}

/** what the adapter reads when there is no session: the façade's own 401 shape */
function sessionEnded(): Response {
  return new Response(JSON.stringify({ code: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * One POST per adapter request. Every answer the server gives resolves as the
 * raw Response (the adapter branches on status, `code` and the id headers);
 * a 401 first gets the account's one refresh + resend, and a 401 that
 * survives it, or no session at all, resolves as a 401. A rejection means the
 * request got no answer (offline, aborted) or the scope has no route here.
 */
export function createUniworkAiChatTransport(
  deps: UniworkAiChatTransportDeps,
): UniworkChatTransport {
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init))
  return {
    async post(request: UniworkChatRequest): Promise<Response> {
      const profile = deps.profile()
      if (!profile) return sessionEnded()
      const url = uniworkAiChatUrl(profile, request.scope)
      // auth is this transport's alone: a header from the request never replaces it
      const headers: Record<string, string> = {}
      for (const [name, value] of Object.entries(request.headers)) {
        if (name.toLowerCase() !== 'authorization') headers[name] = value
      }
      let unauthorized: Response | null = null
      try {
        return await deps.authorized(async (token) => {
          const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
              Accept: 'text/event-stream, application/json',
              ...headers,
              Authorization: `Bearer ${token}`,
            },
            body: request.body,
            cache: 'no-store',
            redirect: 'error',
            signal: request.signal,
          })
          if (response.status === 401) {
            unauthorized = response
            throw new TransportError('unauthorized', 401, true)
          }
          return response
        })
      } catch (error) {
        if (error instanceof TransportError && error.code === 'unauthorized') {
          return unauthorized ?? sessionEnded()
        }
        throw error
      }
    },
  }
}

// ── Scope (OQ-P2) ───────────────────────────────────────────────────

/** a refusal before any request, in the façade's own codes (the renderer maps them like a server answer) */
export type UniworkAiRefusal =
  'access_revoked' | 'office_capability_off' | 'session_expired' | 'ai_disabled'

export type UniworkAiScopeResult =
  { ok: true; scope: UniworkScope; orgId: string } | { ok: false; code: UniworkAiRefusal }

export interface UniworkAiScopeDeps {
  /** the editor tab or detached window rendered by this webContents id (null: not an editor) */
  describe(senderId: number): { kind: TabKind; filePath?: string } | null
  /** the UniWork binding of a path: the document and its org, 'hidden' for another account's copy */
  binding(path: string): { documentId: string; orgId: string } | 'hidden' | null
  /** the selected organization of the live session */
  orgId(): string | null
}

const FORMAT_OF_KIND: Partial<Record<TabKind, UniworkFormat>> = {
  docs: 'docx',
  sheets: 'xlsx',
  slides: 'pptx',
  pdf: 'pdf',
  markdown: 'markdown',
  html: 'html',
}

const FORMAT_OF_EXTENSION: Record<string, UniworkFormat> = {
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  pdf: 'pdf',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
}

/** the format token of a tab: its file's extension (one of six), or its module's when untitled */
export function uniworkFormatOfTab(tab: {
  kind: TabKind
  filePath?: string
}): UniworkFormat | null {
  if (tab.filePath) {
    return FORMAT_OF_EXTENSION[extname(tab.filePath).slice(1).toLowerCase()] ?? null
  }
  return FORMAT_OF_KIND[tab.kind] ?? null
}

export function resolveUniworkAiScope(
  senderId: number,
  deps: UniworkAiScopeDeps,
): UniworkAiScopeResult {
  const tab = deps.describe(senderId)
  if (!tab || !FORMAT_OF_KIND[tab.kind]) return { ok: false, code: 'ai_disabled' }
  const format = uniworkFormatOfTab(tab)
  if (!format) return { ok: false, code: 'office_capability_off' }
  const bound = tab.filePath ? deps.binding(tab.filePath) : null
  if (bound === 'hidden') return { ok: false, code: 'access_revoked' }
  if (bound) {
    return {
      ok: true,
      scope: { kind: 'document', documentId: bound.documentId, format },
      orgId: bound.orgId,
    }
  }
  const orgId = deps.orgId()
  if (!orgId) return { ok: false, code: 'session_expired' }
  return { ok: true, scope: { kind: 'org', orgId, format }, orgId }
}

// ── Availability (EXPERIENCE › S7, desktop) ─────────────────────────

/** cloud `ready` with `tools.chat`, and the org capability on for this format */
export function uniworkAiOffered(
  cloud: UniworkCloudStatus,
  capabilities: OfficeCapabilities | null,
  format: UniworkFormat,
): boolean {
  if (cloud.state !== 'ready' || !cloud.enabled || !cloudChatEnabled(cloud)) return false
  if (!capabilities?.ai_uniwork) return false
  return capabilities.ai_uniwork_formats.includes(format)
}

const UNIWORK_FORMATS: readonly UniworkFormat[] = [
  'docx',
  'xlsx',
  'pptx',
  'pdf',
  'markdown',
  'html',
]

/** the cloud-only pre-check: every format on, so only the cloud status decides */
const ALL_FORMATS_ON: OfficeCapabilities = {
  sync_feed: false,
  sync_write: false,
  offline_library: false,
  ai_uniwork: true,
  ai_uniwork_formats: [...UNIWORK_FORMATS],
}

export interface UniworkAiAvailabilityDeps {
  /** the published cloud status of the selected organization */
  cloud(): UniworkCloudStatus
  /** the per-org capability cache read (TTL rule: stale -> ai_uniwork off) */
  capability(orgId: string): Promise<CapabilityRead>
}

export interface UniworkAiAvailability {
  available(orgId: string | null, format: UniworkFormat): Promise<boolean>
  /** offered for at least one format of this org (the process-wide provider entry) */
  availableAny(orgId: string | null): Promise<boolean>
}

export function createUniworkAiAvailability(
  deps: UniworkAiAvailabilityDeps,
): UniworkAiAvailability {
  return {
    async available(orgId, format) {
      if (!orgId) return false
      const cloud = deps.cloud()
      // no capability read for an org whose cloud already says no
      if (!uniworkAiOffered(cloud, { ...ALL_FORMATS_ON }, format)) return false
      let read: CapabilityRead
      try {
        read = await deps.capability(orgId)
      } catch {
        return false
      }
      // a 401 re-evaluates the session elsewhere; it never offers AI meanwhile
      if (read.kind !== 'ok') return false
      return uniworkAiOffered(deps.cloud(), read.capabilities, format)
    },
    async availableAny(orgId) {
      for (const format of UNIWORK_FORMATS) if (await this.available(orgId, format)) return true
      return false
    },
  }
}

// ── ai:stream runner ────────────────────────────────────────────────

type UniworkStream = (
  transport: UniworkChatTransport,
  request: UniworkTurnRequest,
  cb: StreamCallbacks,
) => Promise<void>

export interface UniworkAiStreamDeps {
  /** the installed chat transport, null when there is no session */
  transport(): UniworkChatTransport | null
  scope(senderId: number): UniworkAiScopeResult
  available(scope: UniworkScope, orgId: string): Promise<boolean>
  toolPolicy(): UniworkToolPolicy
  /** the adapter (default: streamUniwork) */
  stream?: UniworkStream
  /** keepalive period while a Retry-After wait runs (renderer silence watchdog: 240 s) */
  waitPingMs?: number
}

export interface UniworkAiStreamCall {
  senderId: number
  request: AiStreamRequest
  send(chunk: AiStreamChunk): void
  /** Stop, or the sender went away */
  signal: AbortSignal
}

export interface UniworkAiStreams {
  run(call: UniworkAiStreamCall): Promise<void>
  /** sign-out / account switch: ends every running turn with a session error; returns how many */
  cancelAll(): number
  active(): number
}

const WAIT_PING_MS = 5_000
const ACTIVITY_PING_MS = 5_000

/**
 * The renderer localizes from `uniworkCode`; this text is only the fallback
 * line and never carries a code, a URL or the server's message.
 */
const FALLBACK_TEXT = 'UniWork AI could not finish this turn.'

interface UniworkFailure {
  code: string
  retryAfterSec?: number
}

/** the adapter's UniworkError (or anything shaped like it): its server code decides */
function failureOf(error: unknown): UniworkFailure {
  if (error instanceof UniworkError) {
    // uniworkCode + retryAfterSec, never an overload errorCode; its text names the code, so
    // the line the renderer may show stays the fallback below
    const fields = aiStreamErrorFields(error, getUiLang())
    if (fields.uniworkCode) {
      return {
        code: fields.uniworkCode,
        ...(fields.retryAfterSec !== undefined ? { retryAfterSec: fields.retryAfterSec } : {}),
      }
    }
  }
  if (error && typeof error === 'object') {
    const { code, retryAfterSec } = error as { code?: unknown; retryAfterSec?: unknown }
    if (typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code)) {
      return {
        code,
        ...(typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec)
          ? { retryAfterSec }
          : {}),
      }
    }
  }
  // no server code: a failure of the turn, never "overloaded" (no regex on the text)
  return { code: 'ai_provider_error' }
}

export function createUniworkAiStreams(deps: UniworkAiStreamDeps): UniworkAiStreams {
  const stream = deps.stream ?? streamUniwork
  const waitPingMs = deps.waitPingMs ?? WAIT_PING_MS
  const running = new Map<AbortController, { signedOut: boolean }>()

  async function run(call: UniworkAiStreamCall): Promise<void> {
    const { request } = call
    const requestId = request.requestId
    const send = (chunk: Omit<AiStreamChunk, 'requestId'>) => call.send({ requestId, ...chunk })
    const fail = (failure: UniworkFailure) =>
      send({
        type: 'error',
        error: FALLBACK_TEXT,
        uniworkCode: failure.code,
        ...pick(failure),
      })
    // the loop's context summary and the one-shot writers are not the user's question: the server
    // keeps the conversation, so they never go out (the loop then folds old turns mechanically)
    if (request.purpose) {
      fail({ code: 'unsupported' })
      return
    }

    const resolved = deps.scope(call.senderId)
    if (!resolved.ok) {
      if (resolved.code === 'office_capability_off') {
        // hidden, not an error: the note is the whole answer
        send({ type: 'notice', notice: { kind: 'uniwork-off' } })
        send({ type: 'done' })
        return
      }
      fail({ code: resolved.code })
      return
    }
    const transport = deps.transport()
    if (!transport) {
      fail({ code: 'session_expired' })
      return
    }

    const controller = new AbortController()
    const state = { signedOut: false }
    running.set(controller, state)
    const onAbort = () => controller.abort()
    if (call.signal.aborted) controller.abort()
    else call.signal.addEventListener('abort', onAbort, { once: true })

    let waitTimer: ReturnType<typeof setInterval> | null = null
    const stopWait = () => {
      if (waitTimer) clearInterval(waitTimer)
      waitTimer = null
    }
    // the adapter sent `uniwork-off` (a 403 before any run id): the note is the whole answer
    let offNoticed = false
    let lastPing = 0
    const ping = () => {
      const now = Date.now()
      if (now - lastPing < ACTIVITY_PING_MS) return
      lastPing = now
      send({ type: 'ping' })
    }
    try {
      if (!(await deps.available(resolved.scope, resolved.orgId))) {
        // hidden, not an error chip: the panel shows aiUniworkOff
        send({ type: 'notice', notice: { kind: 'uniwork-off' } })
        send({ type: 'done' })
        return
      }
      if (controller.signal.aborted) throw new Error('aborted')
      let stopReason: string | undefined
      // the renderer's aiRun names the turn by the server's run id as soon as an answer carries it
      let reportedRunId: string | undefined
      const turnTransport: UniworkChatTransport = {
        post: async (req) => {
          const response = await transport.post(req)
          const runId = response.headers.get(UNIWORK_RUN_HEADER)
          if (runId && runId !== reportedRunId) {
            reportedRunId = runId
            send({ type: 'ping', runId })
          }
          return response
        },
      }
      await stream(
        turnTransport,
        {
          scope: resolved.scope,
          messages: request.messages,
          tools: request.tools ?? [],
          toolPolicy: deps.toolPolicy(),
        },
        {
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          signal: controller.signal,
          onDelta: (text) => {
            stopWait()
            send({ type: 'delta', text })
          },
          onReasoningDelta: (text) => {
            stopWait()
            send({ type: 'reasoning', text })
          },
          onToolCall: (toolCall) => {
            stopWait()
            send({ type: 'tool-call', toolCall })
          },
          onActivity: ping,
          onStopReason: (reason) => {
            stopReason = reason
          },
          onNotice: (notice) => {
            if (notice.kind === 'uniwork-off') offNoticed = true
            send({ type: 'notice', notice })
            if (notice.kind === 'rate-limit-wait') {
              // the turn stays running through the wait: keep the 240 s watchdog fed
              stopWait()
              send({ type: 'ping' })
              lastPing = Date.now()
              waitTimer = setInterval(() => {
                lastPing = Date.now()
                send({ type: 'ping' })
              }, waitPingMs)
            }
          },
          onTurnReset: () => {
            stopWait()
            send({ type: 'reset' })
          },
        },
      )
      stopWait()
      send({ type: 'done', ...(stopReason ? { stopReason } : {}) })
    } catch (error) {
      stopWait()
      if (state.signedOut) fail({ code: 'session_expired' })
      else if (controller.signal.aborted) send({ type: 'done' })
      else if (offNoticed && failureOf(error).code === 'office_capability_off')
        send({ type: 'done' })
      else {
        console.warn(`[ai-stream] ${requestId} (uniwork) failed:`, failureOf(error).code)
        fail(failureOf(error))
      }
    } finally {
      stopWait()
      call.signal.removeEventListener('abort', onAbort)
      running.delete(controller)
    }
  }

  return {
    run,
    cancelAll() {
      const all = [...running]
      for (const [controller, state] of all) {
        state.signedOut = true
        controller.abort()
      }
      return all.length
    },
    active: () => running.size,
  }
}

function pick(failure: UniworkFailure): { retryAfterSec?: number } {
  return failure.retryAfterSec !== undefined ? { retryAfterSec: failure.retryAfterSec } : {}
}
