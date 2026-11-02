/**
 * Reads an OK chat-completions answer (an SSE stream or a complete JSON body) into the stream
 * callbacks. UniWork AI answers in this wire shape: the turn adapter (../uniwork/protocol.ts) and
 * the web frame's one-shot writer read it here.
 */
import type { AgentToolCall } from '@genoffice/agent-core'
import { httpBodyDetail } from '../http-error'
import type { AiTokenUsage } from '../types'
import {
  jsonBodyInsteadOfSse,
  openAiContentText,
  parseToolInput,
  sseErrorText,
  sseDataEvents,
  throwIfToolCountOverBudget,
  throwIfToolJsonOverBudget,
  usageCount,
  type StreamCallbacks,
} from './shared'

/** Emits a complete (non-streamed) chat completion delivered as a plain JSON body. */
function emitOpenAiJsonMessage(
  bodyText: string,
  cb: StreamCallbacks,
  onExtension?: (extension: unknown) => void,
): void {
  let msg: {
    x_uniwork?: unknown
    choices?: Array<{
      message?: {
        content?: unknown
        reasoning_content?: string
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
      }
      finish_reason?: string | null
    }>
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
    error?: { message?: string } | string
  }
  try {
    msg = JSON.parse(bodyText) as typeof msg
  } catch {
    throw new Error(`The model returned an unparseable JSON body: ${httpBodyDetail(bodyText)}`)
  }
  if (msg.error) throw new Error(sseErrorText(msg.error, 'Model error'))
  if (msg.x_uniwork !== undefined) onExtension?.(msg.x_uniwork)
  const choice = msg.choices?.[0]
  let emitted = false
  if (choice?.message?.reasoning_content) {
    emitted = true
    cb.onReasoningDelta?.(choice.message.reasoning_content)
  }
  if (choice?.message?.content) {
    // A gateway may answer with `content` as an array of parts; concatenated raw it
    // reaches the loop as "[object Object]", so flatten it first.
    const text = openAiContentText(choice.message.content)
    if (text) {
      emitted = true
      cb.onDelta(text)
    }
  }
  const toolCalls: AgentToolCall[] = []
  for (const tc of choice?.message?.tool_calls ?? []) {
    if (!tc.function?.name) continue
    // A complete JSON body carries the whole turn at once, so the per-turn tool
    // budget of the streamed path has to be applied here as well
    throwIfToolCountOverBudget(toolCalls.length + 1, 'openai-compatible')
    emitted = true
    const { input, error } = parseToolInput(tc.function.arguments ?? '')
    toolCalls.push({
      id: tc.id ?? crypto.randomUUID(),
      name: tc.function.name,
      input,
      inputError: error,
    })
  }
  // a 'length' finish may have cut off the last tool call's arguments
  const lastTool = toolCalls.at(-1)
  if (choice?.finish_reason === 'length' && lastTool) lastTool.truncated = true
  for (const call of toolCalls) cb.onToolCall(call)
  if (!emitted) throw new Error(`The model returned no content: ${httpBodyDetail(bodyText)}`)
  if (choice?.finish_reason === 'length') cb.onStopReason?.('max_tokens')
  const jsonUsage = msg.usage as
    { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined
  if (jsonUsage) {
    const usage: AiTokenUsage = {}
    const input = usageCount(jsonUsage.prompt_tokens)
    const output = usageCount(jsonUsage.completion_tokens)
    if (input !== undefined) usage.inputTokens = input
    if (output !== undefined) usage.outputTokens = output
    if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) cb.onUsage?.(usage)
  }
}

/** How a successful chat-completions answer is read. */
export interface ConsumeOpenAiResponseOptions {
  /**
   * The UniWork AI `x_uniwork` object, from the JSON body or any SSE chunk
   * that carries it (before that chunk's choices). Throwing ends the read.
   */
  onExtension?: ((extension: unknown) => void) | undefined
}

/**
 * Reads an OK chat-completions response, a JSON body or an SSE stream (one
 * complete chunk or many deltas alike), into the stream callbacks.
 */
export async function consumeOpenAiCompatibleResponse(
  response: Response,
  cb: StreamCallbacks,
  onBytes: () => void,
  options: ConsumeOpenAiResponseOptions = {},
): Promise<void> {
  const jsonBody = await jsonBodyInsteadOfSse(response, onBytes)
  // UniWork AI reports credits by status and code only: the answer text is never scanned for them
  if (jsonBody !== null) return emitOpenAiJsonMessage(jsonBody, cb, options.onExtension)
  // tool call arguments stream in fragments keyed by index
  const pendingTools = new Map<number, { id: string; name: string; json: string }>()
  let stopReason: string | undefined
  let abnormalFinish: string | undefined
  let sawFinish = false
  let sawDone = false
  let emitted = false
  let turnUsage: AiTokenUsage | undefined
  const flushTools = () => {
    const entries = [...pendingTools.entries()].sort(([a], [b]) => a - b)
    const lastIndex = entries.at(-1)?.[0]
    for (const [index, pending] of entries) {
      if (pending.name) {
        const { input, error } = parseToolInput(pending.json)
        emitted = true
        cb.onToolCall({
          id: pending.id,
          name: pending.name,
          input,
          inputError: error,
          // a 'length' finish cuts off the last streaming tool's arguments
          ...(stopReason === 'max_tokens' && index === lastIndex ? { truncated: true } : {}),
        })
      }
    }
    pendingTools.clear()
  }
  if (!response.body) throw new Error('The model returned no content (empty stream)')
  for await (const sse of sseDataEvents(response.body, onBytes)) {
    if (sse.raw === '[DONE]') {
      sawDone = true
      break
    }
    // A truncated frame or a non-JSON keep-alive from a proxy skips that event
    // rather than killing the turn.
    if (sse.json === undefined) continue
    const event = sse.json as {
      x_uniwork?: unknown
      choices?: Array<{
        delta?: {
          content?: unknown
          /** DeepSeek/MiniMax native and LiteLLM-normalized thinking stream; OpenRouter uses `reasoning` */
          reasoning_content?: string
          reasoning?: string
          tool_calls?: Array<{
            index: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
        finish_reason?: string | null
      }>
      /** usage chunk (requested via stream_options): empty choices + the counts */
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
      error?: { message?: string } | string
    }
    if (event.error) throw new Error(sseErrorText(event.error, 'Model stream error'))
    // before the choices: an end-of-stream frame must stop the turn before anything else is emitted
    if (event.x_uniwork !== undefined) options.onExtension?.(event.x_uniwork)
    // The usage chunk arrives with empty choices right before [DONE]; some
    // providers (DeepSeek et al) attach usage to the last content chunk instead.
    if (event.usage) {
      const usage: AiTokenUsage = {}
      const input = usageCount(event.usage.prompt_tokens)
      const output = usageCount(event.usage.completion_tokens)
      if (input !== undefined) usage.inputTokens = input
      if (output !== undefined) usage.outputTokens = output
      if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
        turnUsage = usage
      }
    }
    const choice = event.choices?.[0]
    if (!choice) continue
    const reasoning = choice.delta?.reasoning_content ?? choice.delta?.reasoning
    if (typeof reasoning === 'string' && reasoning) {
      emitted = true
      cb.onReasoningDelta?.(reasoning)
    }
    if (choice.delta?.content) {
      // Same array-of-parts shape as the JSON body path above.
      const text = openAiContentText(choice.delta.content)
      if (text) {
        emitted = true
        cb.onDelta(text)
      }
    }
    for (const tc of choice.delta?.tool_calls ?? []) {
      if (!pendingTools.has(tc.index)) {
        throwIfToolCountOverBudget(pendingTools.size + 1, 'openai-compatible')
      }
      const pending = pendingTools.get(tc.index) ?? {
        id: tc.id ?? crypto.randomUUID(),
        name: '',
        json: '',
      }
      if (tc.id) pending.id = tc.id
      // Spec-compliant servers send the name once, but some local/proxy
      // servers resend the full (or growing) name on every delta; naive
      // concatenation then yields "read_fileread_file" and every call fails
      // as an unknown tool. Treat a delta that extends the accumulated name
      // as a resend, anything else as a fragment to append.
      if (tc.function?.name) {
        pending.name = tc.function.name.startsWith(pending.name)
          ? tc.function.name
          : pending.name + tc.function.name
      }
      if (tc.function?.arguments) {
        pending.json += tc.function.arguments
        throwIfToolJsonOverBudget(pending.json.length, 'openai-compatible')
      }
      pendingTools.set(tc.index, pending)
    }
    if (choice.finish_reason) {
      sawFinish = true
      if (choice.finish_reason === 'length') stopReason = 'max_tokens'
      else if (choice.finish_reason !== 'stop' && choice.finish_reason !== 'tool_calls') {
        abnormalFinish = choice.finish_reason
      }
      flushTools()
    }
  }
  // No finish and no [DONE] with half-received arguments: the connection dropped
  if (!sawFinish && !sawDone) {
    const broken = [...pendingTools.values()].filter((p) => p.name && parseToolInput(p.json).error)
    if (broken.length > 0) {
      const received = broken.reduce((n, p) => n + p.json.length, 0)
      throw new Error(
        `The model stream closed while sending tool arguments (${received} chars received); the connection was dropped. ` +
          'If this recurs on a large request (e.g. generating a whole document), ask for the output in several smaller parts.',
      )
    }
  }
  flushTools()
  if (!sawFinish && !sawDone && emitted) {
    throw new Error('The model stream ended before a finish_reason or [DONE] marker')
  }
  // e.g. finish_reason=content_filter with no output, or a stream with no
  // message framing at all (gateway soft-failure) — surface both instead of an
  // empty success; a genuine empty turn still carries finish_reason=stop
  if (!emitted && abnormalFinish) {
    throw new Error(`The model returned no content (finish_reason=${abnormalFinish})`)
  }
  if (!emitted && !sawFinish) {
    throw new Error('The model returned no content (empty stream)')
  }
  if (stopReason) cb.onStopReason?.(stopReason)
  if (turnUsage) cb.onUsage?.(turnUsage)
}
