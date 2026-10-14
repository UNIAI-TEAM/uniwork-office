/**
 * The `uniwork` provider's wire protocol: one agent turn per request against
 * the UniWork façade (design: g6-05-design.md §3).
 *
 * A turn sends only the new question or the trailing tool results (./slice),
 * with the conversation and run ids the server handed out (./conversation).
 * The answer (a real stream or the v1 one-chunk SSE, or JSON) is read by the
 * same code as the BYOK openai-compatible path. A 429, before the headers or
 * as the reserved `x_uniwork.terminal` frame, is waited out here under the
 * one Retry-After rule (./retry-after), so the turn stays one stream: the
 * run indicator never drops to idle and the host watchdog keeps getting
 * pinged. Every failure is a UniworkError keyed by the server's code.
 */
import type { AgentDroppedToolCall, AgentMessage, AgentToolDef } from '@genoffice/agent-core'
import { isAiNetworkError } from '../network-error'
import { consumeOpenAiCompatibleResponse } from '../protocols/openai-compatible'
import type { StreamCallbacks } from '../protocols/shared'
import { AiTimeoutError, createStreamWatchdog } from '../watchdog'
import { uniworkConversations, type UniworkConversations } from './conversation'
import { UNIWORK_RATE_LIMIT_CODES, UniworkError, uniworkErrorFromResponse } from './errors'
import { decideRateLimitWait } from './retry-after'
import { sliceUniworkTurn, type UniworkTurnSlice } from './slice'
import {
  UNIWORK_CONVERSATION_HEADER,
  UNIWORK_RUN_HEADER,
  type UniworkChatTransport,
  type UniworkScope,
  type UniworkTerminal,
  type UniworkToolPolicy,
  type UniworkTurnIds,
} from './types'

export interface UniworkTurnRequest {
  scope: UniworkScope
  /** the loop's full history; the adapter sends only the new question or the trailing tool results */
  messages: AgentMessage[]
  tools: AgentToolDef[]
  toolPolicy: UniworkToolPolicy
  /** the panel session the ids belong to; defaults to the callbacks' sessionId */
  sessionId?: string | undefined
}

export interface UniworkStreamDeps {
  /** the id store; the process-wide one by default */
  conversations?: UniworkConversations | undefined
}

/** cloud tool names (UniWork cloud tools and the module skills' names for them) */
const CLOUD_TOOL_NAMES: ReadonlySet<string> = new Set([
  'web_search',
  'image_search',
  'image_generate',
  'generate_image',
  'media_analyze',
  'analyze_media',
  'transcribe',
])

/** the host watchdog (desktop IPC: 240 s of silence) is pinged this often while a Retry-After wait runs */
const WAIT_PING_MS = 5_000

/**
 * The tools a UniWork AI turn may offer: the module's editor tools, cloud
 * tools only with office.ai_cloud, never an MCP tool. The server intersects
 * the list with the module allowlist again.
 */
export function uniworkAllowedTools(tools: AgentToolDef[], policy: UniworkToolPolicy): AgentToolDef[] {
  return tools.filter((t) => !t.name.startsWith('mcp__') && (policy.cloudTools || !CLOUD_TOOL_NAMES.has(t.name)))
}

/** the `x_uniwork.terminal` frame stopped the read */
class TerminalFrame extends Error {
  constructor(readonly terminal: UniworkTerminal) {
    super(`UniWork AI terminal frame ${terminal.code}`)
  }
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

function waitWithPings(seconds: number, signal: AbortSignal, ping: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal))
      return
    }
    const cleanup = () => {
      clearTimeout(timer)
      clearInterval(pinger)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(abortError(signal))
    }
    const pinger = setInterval(ping, WAIT_PING_MS)
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, seconds * 1000)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function readIds(headers: Headers): UniworkTurnIds {
  const conversationId = headers.get(UNIWORK_CONVERSATION_HEADER) ?? undefined
  const runId = headers.get(UNIWORK_RUN_HEADER) ?? undefined
  return { ...(conversationId ? { conversationId } : {}), ...(runId ? { runId } : {}) }
}

function droppedCalls(raw: unknown): AgentDroppedToolCall[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (c): c is AgentDroppedToolCall =>
      !!c &&
      typeof c === 'object' &&
      typeof (c as AgentDroppedToolCall).name === 'string' &&
      ((c as AgentDroppedToolCall).reason === 'view_only' || (c as AgentDroppedToolCall).reason === 'not_allowlisted'),
  )
}

/** `x_uniwork` → notices; a terminal frame ends the read */
function readExtension(raw: unknown, cb: StreamCallbacks): void {
  if (!raw || typeof raw !== 'object') return
  const ext = raw as { dropped_tool_calls?: unknown; step?: unknown; limit?: unknown; terminal?: unknown }
  if (ext.terminal && typeof ext.terminal === 'object' && typeof (ext.terminal as UniworkTerminal).code === 'string') {
    throw new TerminalFrame(ext.terminal as UniworkTerminal)
  }
  const calls = droppedCalls(ext.dropped_tool_calls)
  if (calls.length > 0) cb.onNotice?.({ kind: 'dropped-tool-calls', calls })
  if (typeof ext.step === 'number' && typeof ext.limit === 'number') {
    cb.onNotice?.({ kind: 'step', step: ext.step, limit: ext.limit })
  }
}

function requestBody(slice: UniworkTurnSlice, tools: AgentToolDef[], scope: UniworkScope): string {
  return JSON.stringify({
    messages: slice.messages,
    ...(tools.length > 0
      ? {
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })),
        }
      : {}),
    // always a stream: never the JSON path's credits-notice scan; a JSON answer is still read
    stream: true,
    // the organization route keys the conversation by module, so every turn carries it
    module: scope.format,
  })
}

type Attempt =
  | { kind: 'done' }
  | { kind: 'rate-limited'; error: UniworkError; retryAfter: string | number | null | undefined }
  | { kind: 'failed'; error: UniworkError }

export async function streamUniwork(
  transport: UniworkChatTransport,
  request: UniworkTurnRequest,
  cb: StreamCallbacks,
  deps: UniworkStreamDeps = {},
): Promise<void> {
  const conversations = deps.conversations ?? uniworkConversations
  const session = request.sessionId ?? cb.sessionId
  let slice: UniworkTurnSlice
  try {
    slice = sliceUniworkTurn(request.messages)
  } catch (cause) {
    throw new UniworkError('protocol_error', { cause })
  }
  const tools = uniworkAllowedTools(request.tools, request.toolPolicy)
  const body = requestBody(slice, tools, request.scope)
  const start = conversations.begin(session, request.scope, slice.continuesRun)
  if (start.boundary) cb.onNotice?.({ kind: 'conversation-boundary', provider: 'uniwork' })
  // a tool-result turn without the run header is a 400 (API §3.7): the run is already gone
  if (slice.kind === 'tool-result' && !start.ids.runId) throw new UniworkError('run_expired')

  let ids = start.ids
  let waits = 0
  let resentAfterRunExpired = false
  for (;;) {
    if (cb.signal.aborted) throw abortError(cb.signal)
    const result = await attempt(transport, request.scope, body, ids, cb, (next) => {
      ids = conversations.update(session, next)
    })
    if (result.kind === 'done') return
    const error = result.error
    if (result.kind === 'rate-limited') {
      const decision = decideRateLimitWait(result.retryAfter, waits, Date.now())
      if (decision.kind === 'give-up') throw error
      waits++
      cb.onNotice?.({ kind: 'rate-limit-wait', seconds: decision.seconds, attempt: decision.attempt })
      cb.onActivity?.()
      await waitWithPings(decision.seconds, cb.signal, () => cb.onActivity?.())
      // the answer streamed so far (a terminal frame after content) is dropped before the resend
      cb.onTurnReset?.()
      continue
    }
    switch (error.code) {
      case 'conversation_expired':
        conversations.dropConversation(session)
        cb.onNotice?.({ kind: 'conversation-restarted' })
        throw error
      case 'run_expired':
        conversations.dropRun(session)
        ids = conversations.ids(session)
        // a question is asked again once as a new run; tool results cannot be (lead decision Q-1)
        if (slice.kind === 'question' && !resentAfterRunExpired) {
          resentAfterRunExpired = true
          continue
        }
        throw error
      case 'run_limit_reached':
        conversations.dropRun(session)
        throw error
      case 'access_revoked':
        conversations.dropConversation(session)
        throw error
      case 'office_capability_off':
        // off before the run started: hide UniWork AI instead of an error chip (EXPERIENCE › Cap-off)
        if (!ids.runId) cb.onNotice?.({ kind: 'uniwork-off' })
        throw error
      default:
        throw error
    }
  }
}

/** one request of the turn; resolves with what the turn loop does next */
async function attempt(
  transport: UniworkChatTransport,
  scope: UniworkScope,
  body: string,
  ids: UniworkTurnIds,
  cb: StreamCallbacks,
  onIds: (ids: UniworkTurnIds) => void,
): Promise<Attempt> {
  const wd = createStreamWatchdog(cb.signal)
  const onBytes = () => {
    wd.touch()
    cb.onActivity?.()
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(ids.conversationId ? { [UNIWORK_CONVERSATION_HEADER]: ids.conversationId } : {}),
    ...(ids.runId ? { [UNIWORK_RUN_HEADER]: ids.runId } : {}),
  }
  try {
    return await wd.guard(async (): Promise<Attempt> => {
      let response: Response
      try {
        response = await transport.post({ scope, headers, body, signal: wd.signal })
      } catch (cause) {
        if (wd.signal.aborted || cause instanceof UniworkError) throw cause
        throw new UniworkError('disconnected', { cause })
      }
      onBytes()
      onIds(readIds(response.headers))
      if (!response.ok) {
        const error = await uniworkErrorFromResponse(response)
        if (response.status === 429 && UNIWORK_RATE_LIMIT_CODES.has(error.code)) {
          return { kind: 'rate-limited', error, retryAfter: response.headers.get('Retry-After') }
        }
        return { kind: 'failed', error }
      }
      try {
        await consumeOpenAiCompatibleResponse(response, cb, onBytes, {
          onExtension: (ext) => readExtension(ext, cb),
          creditsNotice: false,
        })
        return { kind: 'done' }
      } catch (cause) {
        if (cause instanceof TerminalFrame) {
          const runId = ids.runId
          if (cause.terminal.code === 'ai_rate_limited') {
            const error = new UniworkError('ai_rate_limited', { status: 429, retryAfterSec: cause.terminal.retry_after, runId })
            return { kind: 'rate-limited', error, retryAfter: cause.terminal.retry_after }
          }
          const code = cause.terminal.code === 'ai_provider_timeout' ? 'ai_provider_timeout' : 'ai_provider_error'
          return { kind: 'failed', error: new UniworkError(code, { cause, runId }) }
        }
        if (wd.signal.aborted) throw cause
        // a broken read is a disconnect; a malformed answer is a provider error, never "(empty stream)"
        throw new UniworkError(isAiNetworkError(cause) ? 'disconnected' : 'ai_provider_error', { cause })
      }
    })
  } catch (cause) {
    if (cb.signal.aborted) throw abortError(cb.signal)
    if (cause instanceof AiTimeoutError) throw new UniworkError('ai_provider_timeout', { cause })
    throw cause
  }
}
