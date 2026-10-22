import {
  ASKUNI_MAX_RETRY_AFTER_SEC,
  ASKUNI_V2_NOTICES,
  type AskUniCitation,
  type AskUniMessage,
  type AskUniStreamEvent,
  type AskUniStreamRequest,
  type AskUniStreamUsage,
  type AskUniV2ErrorCode,
  type AskUniV2Notice,
} from '../../shared/askuni-api'
import { createUniworkSend, type UniworkDocsClientOptions } from '../uniwork-docs/client'
import { UniworkDocError } from '../uniwork-docs/errors'
import { ASKUNI_MAX_CITATIONS, askUniCodeOfError, parseCitation } from './client'

/**
 * Ask UNI v2 in the shell main process: `POST /workspaces/{ws}/ai/ask/stream`
 * through the same hardened request as P1 (device bearer added in main only,
 * one refresh on a 401, no redirects), read as server-sent events. Every
 * frame is validated and bounded here, at the trust boundary; an unknown
 * event or a malformed frame is dropped. No reconnect (the web has none).
 * Nothing here logs the question, the answer or the token, and nothing
 * throws: the stream always ends in exactly one terminal (done | error).
 */

/** an event as the client emits it; the service adds the requestId */
export type AskUniStreamPayload = AskUniStreamEvent extends infer E
  ? E extends AskUniStreamEvent
    ? Omit<E, 'requestId'>
    : never
  : never
export type AskUniStreamTerminal = Extract<AskUniStreamPayload, { type: 'done' | 'error' }>

export interface AskUniStreamClient {
  /** emits the non-terminal events through onEvent and resolves with the terminal one */
  stream(
    req: AskUniStreamRequest,
    opts: { signal: AbortSignal; onEvent(ev: AskUniStreamPayload): void },
  ): Promise<AskUniStreamTerminal>
}

/** no byte for this long (the server pings every 15 s) -> provider_timeout */
export const ASKUNI_STREAM_IDLE_MS = 45_000
/** the whole exchange, however lively: a run never legitimately takes this long */
const STREAM_CEILING_MS = 10 * 60_000
const ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_CONTENT = 20_000
const MAX_TOOL = 64
const MAX_COUNT_KEYS = 20
const MAX_COUNT_KEY = 32
/** a frame never needs this much; a server that sends no blank line is cut off */
const MAX_BUFFER = 1_000_000

/** the server's `ai_*` codes that have their own v2 code (errors.go) */
const SERVER_CODES: Record<string, AskUniV2ErrorCode> = {
  ai_provider_error: 'provider_error',
  ai_provider_timeout: 'provider_timeout',
  ai_cancelled: 'cancelled',
  ai_output_invalid: 'output_invalid',
  ai_refused: 'refused',
  ai_tool_not_allowed: 'tool_not_allowed',
  ai_quota_exceeded: 'quota',
  ai_rate_limited: 'rate_limited',
  ai_disabled: 'disabled',
  ai_context_forbidden: 'forbidden',
}

/** a failed call -> the v2 code: the P1 map plus the gateway codes (REST and lookups use this one) */
export function askUniV2CodeOfError(error: unknown): AskUniV2ErrorCode {
  if (
    error instanceof UniworkDocError &&
    error.serverCode &&
    Object.hasOwn(SERVER_CODES, error.serverCode)
  ) {
    return SERVER_CODES[error.serverCode]
  }
  return askUniCodeOfError(error)
}

/** the stream's failure: our own idle deadline is provider_timeout, a metadata timeout is not */
function failure(error: unknown): AskUniStreamTerminal {
  const code =
    error instanceof UniworkDocError && error.code === 'timeout'
      ? 'provider_timeout'
      : askUniV2CodeOfError(error)
  if (
    code === 'rate_limited' &&
    error instanceof UniworkDocError &&
    error.retryAfterMs !== undefined
  ) {
    return {
      type: 'error',
      code,
      retryAfterSeconds: Math.min(ASKUNI_MAX_RETRY_AFTER_SEC, Math.ceil(error.retryAfterMs / 1000)),
    }
  }
  return { type: 'error', code }
}

/**
 * The SSE framing: frames end on a blank line, `event:` / `data:` fields,
 * `:` comments (the server's pings) ignored, multi-line data joined with a
 * newline, CRLF accepted, UTF-8 decoded across chunk borders. A frame
 * without an event name or data is dropped, and so is an unterminated tail.
 */
export function createSseParser(onFrame: (name: string, data: string) => void): {
  push(chunk: Uint8Array): void
  end(): void
} {
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (frame: string) => {
    let name = ''
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue
      const i = line.indexOf(':')
      const field = i < 0 ? line : line.slice(0, i)
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '')
      if (field === 'event') name = value
      else if (field === 'data') data.push(value)
    }
    if (name && data.length > 0) onFrame(name, data.join('\n'))
  }

  return {
    push(chunk) {
      buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n')
      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        dispatch(frame)
      }
      if (buffer.length > MAX_BUFFER) throw new UniworkDocError('malformed_response')
    },
    end() {
      buffer = ''
    },
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const citationsOf = (raw: unknown): AskUniCitation[] =>
  Array.isArray(raw)
    ? raw
        .map(parseCitation)
        .filter((c): c is AskUniCitation => c !== null)
        .slice(0, ASKUNI_MAX_CITATIONS)
    : []

/** a server message (stream `done`, the messages route) -> the contract's, bounded; null drops it */
export function parseMessage(raw: unknown): AskUniMessage | null {
  if (!isObj(raw)) return null
  if (typeof raw.id !== 'string' || !ID.test(raw.id) || typeof raw.content !== 'string') return null
  return {
    id: raw.id,
    role: raw.role === 'user' ? 'user' : 'assistant',
    content: raw.content.slice(0, MAX_CONTENT),
    citations: citationsOf(raw.citations),
    ...(typeof raw.notice === 'string' && ASKUNI_V2_NOTICES.has(raw.notice)
      ? { notice: raw.notice as AskUniV2Notice }
      : {}),
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
  }
}

function parseUsage(raw: unknown): AskUniStreamUsage | undefined {
  if (!isObj(raw)) return undefined
  const n = (v: unknown): number => (isCount(v) ? Math.floor(v) : 0)
  return {
    inputTokens: n(raw.input_tokens),
    outputTokens: n(raw.output_tokens),
    cacheReadTokens: n(raw.cache_read_tokens),
    cacheWriteTokens: n(raw.cache_write_tokens),
  }
}

/** one frame's data -> its event, bounded; null drops it. `budget` is the delta text left */
function parseFrame(
  name: string,
  data: string,
  budget: { left: number },
): AskUniStreamPayload | null {
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return null
  }
  if (!isObj(raw)) return null
  switch (name) {
    case 'run': {
      const runId = typeof raw.run_id === 'string' ? raw.run_id : ''
      if (typeof raw.conversation_id !== 'string' || !ID.test(raw.conversation_id)) return null
      if (runId !== '' && !ID.test(runId)) return null
      return { type: 'run', runId, conversationId: raw.conversation_id }
    }
    case 'step': {
      if (!isCount(raw.round) || (raw.phase !== 'tool' && raw.phase !== 'retry')) return null
      const counts: Record<string, number> = {}
      if (isObj(raw.counts)) {
        for (const [key, value] of Object.entries(raw.counts)) {
          if (Object.keys(counts).length >= MAX_COUNT_KEYS) break
          if (isCount(value) && key.length <= MAX_COUNT_KEY) counts[key] = Math.floor(value)
        }
      }
      return {
        type: 'step',
        round: Math.floor(raw.round),
        phase: raw.phase,
        tool: typeof raw.tool === 'string' ? raw.tool.slice(0, MAX_TOOL) : '',
        counts,
      }
    }
    case 'delta': {
      if (typeof raw.text !== 'string' || budget.left <= 0) return null
      const text = raw.text.slice(0, budget.left)
      budget.left -= text.length
      return text ? { type: 'delta', text } : null
    }
    case 'citations':
      return Array.isArray(raw.citations)
        ? { type: 'citations', citations: citationsOf(raw.citations) }
        : null
    case 'done': {
      const message = parseMessage(raw.message)
      if (!message) return null
      const usage = parseUsage(raw.usage)
      return { type: 'done', message, ...(usage ? { usage } : {}) }
    }
    case 'error': {
      if (typeof raw.code !== 'string') return null
      return {
        type: 'error',
        code: Object.hasOwn(SERVER_CODES, raw.code) ? SERVER_CODES[raw.code] : 'error',
      }
    }
    default:
      return null
  }
}

/** the request body in the server's field names (AskUniSDI); absent optionals stay out */
function bodyOf(req: AskUniStreamRequest): Record<string, unknown> {
  return {
    conversation_id: req.conversationId ?? '',
    question: req.question,
    locale: req.locale,
    ...(req.focus ? { focus: { kind: req.focus.kind, id: req.focus.id } } : {}),
    ...(req.mentions?.length
      ? { mentions: req.mentions.map((m) => ({ kind: m.kind, id: m.id })) }
      : {}),
    ...(req.model !== undefined ? { model: req.model } : {}),
    ...(req.effort !== undefined ? { effort: req.effort } : {}),
  }
}

const CANCELLED: AskUniStreamTerminal = { type: 'error', code: 'cancelled' }

export function createAskUniStreamClient(
  options: UniworkDocsClientOptions & { idleMs?: number },
): AskUniStreamClient {
  const send = createUniworkSend(options)
  const idleMs = options.idleMs ?? ASKUNI_STREAM_IDLE_MS

  return {
    async stream(req, { signal, onEvent }) {
      if (signal.aborted) return CANCELLED
      try {
        return await send<AskUniStreamTerminal>({
          method: 'POST',
          route: `/workspaces/${encodeURIComponent(req.workspaceId)}/ai/ask/stream`,
          // a raw body carries its own Accept; a Blob can be sent again after a refresh
          raw: {
            body: new Blob([JSON.stringify(bodyOf(req))]),
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          },
          signal,
          timeoutMs: idleMs,
          idle: { ceilingMs: STREAM_CEILING_MS },
          read: (response, progress) => readEvents(response, signal, onEvent, progress, idleMs),
        })
      } catch (error) {
        return signal.aborted ? CANCELLED : failure(error)
      }
    },
  }
}

async function readEvents(
  response: Response,
  signal: AbortSignal,
  onEvent: (ev: AskUniStreamPayload) => void,
  progress: (() => void) | undefined,
  idleMs: number,
): Promise<AskUniStreamTerminal> {
  const type = response.headers.get('Content-Type') ?? ''
  if (!type.startsWith('text/event-stream') || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    return { type: 'error', code: 'error' }
  }
  const reader = response.body.getReader()
  // once accepted, the send path no longer aborts the fetch on the caller's
  // signal: cancelling the reader wakes a read() waiting on a quiet stream
  const onAbort = () => void reader.cancel().catch(() => undefined)
  signal.addEventListener('abort', onAbort, { once: true })
  // the idle deadline of the body itself, whatever the transport does with its own
  let idle = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      idle = true
      void reader.cancel().catch(() => undefined)
    }, idleMs)
  }
  arm()
  const budget = { left: MAX_CONTENT }
  let terminal: AskUniStreamTerminal | null = null
  const parser = createSseParser((name, data) => {
    if (terminal || signal.aborted) return
    const event = parseFrame(name, data, budget)
    if (!event) return
    if (event.type === 'done' || event.type === 'error') terminal = event
    else onEvent(event)
  })
  try {
    for (;;) {
      if (signal.aborted) return CANCELLED
      const { done, value } = await reader.read()
      if (signal.aborted) return CANCELLED
      if (idle) return { type: 'error', code: 'provider_timeout' }
      if (done) break
      arm()
      progress?.()
      parser.push(value)
      if (terminal) break
    }
    parser.end()
    return terminal ?? { type: 'error', code: 'stream_ended' }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    void reader.cancel().catch(() => undefined)
  }
}
