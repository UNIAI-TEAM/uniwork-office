/**
 * aiStream / aiChat in the frame (the desktop runs them in the main process, e.g.
 * apps/slides/src/main/ai-ipc.ts `ai:stream`), with the same AiStreamChunk sequence (delta /
 * reasoning / tool-call / ping, then one done or error).
 *
 * UniWork AI is the only AI of the frame (UNI-2289): every turn is a UniWork AI turn, whatever
 * provider the renderer's settings still name, and no vendor protocol runs here. The ai-provider
 * adapter (`streamUniwork`) runs one agent turn per request over the frame transport below
 * (`client.uniworkChat`, the frame route), and its notices / turn reset / failures are mapped to the
 * same chunk sequence the panel already reads.
 */
import type { StreamCallbacks } from '../../../../packages/ai-provider/src/protocols/shared'
import type {
  AiChatResponse,
  AiSettings,
  AiStreamChunk,
  AiStreamRequest,
} from '../../../../packages/ai-provider/src/types'
import { uniworkConversations } from '../../../../packages/ai-provider/src/uniwork/conversation'
import { streamUniwork } from '../../../../packages/ai-provider/src/uniwork/protocol'
import {
  UNIWORK_RUN_HEADER,
  type UniworkChatTransport,
  type UniworkScope,
} from '../../../../packages/ai-provider/src/uniwork/types'
import type { AiRunTracker } from '../ai-run'
import type { AiWebClient } from './client'
import {
  UNIWORK_HANDOFF_HEADER,
  UNIWORK_HANDOFF_REMAINING_HEADER,
  type AiHandoff,
  type AiHandoffStream,
} from './handoff'
import type { UniworkFailure } from './errors'
import { runUniworkWriter, uniworkFailureOf } from './writer'

/** the tracker as the UniWork AI turn uses it: it may also take the run id the server issued */
export type UniworkRunTracker = AiRunTracker & { setRunId?(runId: string): void }

/** what a UniWork AI turn needs from the frame session (absent = no UniWork AI) */
export interface UniworkStreamDeps {
  /** the frame route scope of this document and module; null = UniWork AI is not available here */
  scope(): UniworkScope | null
  /** the cloud tools (search, images, media) are granted: they may go out with the turn */
  cloudTools(): boolean
  /** the localized text of a failed turn (aiErr* / aiUniworkOff) */
  describeFailure(failure: UniworkFailure): string
  /** UniWork AI is off for this organization or format (before any run): hide the entry */
  onOff(): void
  /** the module's UI language: a writer call asks for vi or en (default: en) */
  lang?(): string
  /** test seam: the adapter (default: ai-provider `streamUniwork`) */
  stream?: typeof streamUniwork
}

export interface StreamDeps {
  client: Partial<Pick<AiWebClient, 'uniworkChat' | 'uniworkWrite'>>
  /** the frame's AI turn state: a chat stream is a running turn until it ends (X-02 `aiRun`, S6) */
  aiRun?: UniworkRunTracker
  uniwork?: UniworkStreamDeps
  /** the job the host handed over (`ai.start`): its header on a UniWork AI question, the turn outcome */
  handoff?: Pick<AiHandoff, 'stream' | 'answered' | 'ended'>
}

/** what the handoff needs of a stream's history: its question's own words, or tool results */
function handoffTurn(messages: AiStreamRequest['messages']): AiHandoffStream {
  const last = messages.at(-1)
  return {
    words: last?.role === 'user' ? (last.instruction ?? last.text) : null,
    uniwork: true,
  }
}

export interface WebAiStreams {
  aiStream(request: AiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void
  aiChat(request: { settings: AiSettings; system: string; user: string }): Promise<AiChatResponse>
}

export function createWebAiStreams(deps: StreamDeps): WebAiStreams {
  const listeners = new Set<(chunk: AiStreamChunk) => void>()
  const active = new Map<string, AbortController>()

  const emit = (chunk: AiStreamChunk): void => {
    for (const listener of [...listeners]) {
      try {
        listener(chunk)
      } catch (err) {
        console.error('[web-ai] onAiStream listener threw', err)
      }
    }
  }

  /** a UniWork AI turn: the adapter over the frame transport, mapped to the panel's chunks */
  async function uniworkTurn(request: AiStreamRequest): Promise<void> {
    const { requestId, messages } = request
    const uniwork = deps.uniwork
    const chat = deps.client.uniworkChat
    const write = deps.client.uniworkWrite
    // a one-shot that names its writer runs on the writer route, inside the turn that called it
    const writer = request.purpose === 'one-shot' && write ? request.writer : undefined
    if (request.purpose && !writer) {
      // the loop's context summary and the other one-shots are not the user's question: the
      // server keeps the conversation, so they never go out (the loop folds old turns mechanically)
      const failure: UniworkFailure = { code: 'unsupported' }
      emit({
        requestId,
        type: 'error',
        error: uniwork?.describeFailure(failure) ?? 'UniWork AI does not take this request.',
        uniworkCode: failure.code,
      })
      return
    }
    const scope = uniwork?.scope() ?? null
    if (!uniwork || !chat || !scope) {
      // not available in this frame (grant off, format off): hidden, never an error chip. The turn
      // ends quietly after the note (EXPERIENCE: no error bubble, no Retry for a provider that is gone)
      uniwork?.onOff()
      emit({ requestId, type: 'notice', notice: { kind: 'uniwork-off' } })
      emit({ requestId, type: 'done' })
      return
    }
    const controller = new AbortController()
    active.set(requestId, controller)
    deps.aiRun?.begin(requestId, () => controller.abort())
    if (writer && write) {
      try {
        await runUniworkWriter(
          {
            write,
            lang: () => uniwork.lang?.() ?? 'en',
            describeFailure: uniwork.describeFailure,
            signal: controller.signal,
          },
          { ...request, writer },
          emit,
        )
      } finally {
        active.delete(requestId)
        deps.aiRun?.end(requestId)
      }
      return
    }
    // a question (never tool results) may run the handed-over job: every post of this turn is that
    // question, its run_expired / 429 resends included, so each carries the id
    const handoffId = deps.handoff?.stream(handoffTurn(messages)) ?? null
    const transport: UniworkChatTransport = {
      post: async (req) => {
        const headers = handoffId
          ? { ...req.headers, [UNIWORK_HANDOFF_HEADER]: handoffId }
          : req.headers
        const res = await chat({ headers, body: req.body, signal: req.signal })
        if (handoffId) {
          deps.handoff?.answered(
            handoffId,
            res.ok,
            res.headers.get(UNIWORK_HANDOFF_REMAINING_HEADER),
          )
        }
        // the run id of the turn is the one the server issued, as soon as a response carries it
        const runId = res.headers.get(UNIWORK_RUN_HEADER)
        if (runId) deps.aiRun?.setRunId?.(runId)
        return res
      },
    }
    let lastPing = 0
    const ping = (): void => {
      const now = Date.now()
      if (now - lastPing < 5_000) return
      lastPing = now
      emit({ requestId, type: 'ping' })
    }
    let stopReason: string | undefined
    let failed = false
    let toolCalls = 0
    let off = false
    // the adapter sent `uniwork-off` (a 403 before any run id): the note is the whole answer
    let offNoticed = false
    const cb: StreamCallbacks = {
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      signal: controller.signal,
      onDelta: (text) => emit({ requestId, type: 'delta', text }),
      onReasoningDelta: (text) => emit({ requestId, type: 'reasoning', text }),
      onToolCall: (toolCall) => {
        toolCalls++
        emit({ requestId, type: 'tool-call', toolCall })
      },
      onActivity: ping,
      onStopReason: (reason) => {
        stopReason = reason
      },
      onNotice: (notice) => {
        if (notice.kind === 'uniwork-off') {
          offNoticed = true
          if (!off) {
            off = true
            uniwork.onOff()
          }
        }
        emit({ requestId, type: 'notice', notice })
      },
      onTurnReset: () => {
        toolCalls = 0
        emit({ requestId, type: 'reset' })
      },
    }
    try {
      await (uniwork.stream ?? streamUniwork)(
        transport,
        {
          scope,
          messages,
          tools: request.tools ?? [],
          toolPolicy: { cloudTools: uniwork.cloudTools() },
        },
        cb,
      )
      emit(
        stopReason === undefined
          ? { requestId, type: 'done' }
          : { requestId, type: 'done', stopReason },
      )
    } catch (err) {
      failed = true
      if (controller.signal.aborted) {
        emit({ requestId, type: 'done' })
        return
      }
      const failure = uniworkFailureOf(err)
      // a lost session may come back as another account: nothing of this one is sent again
      if (failure?.code === 'session_expired') uniworkConversations.clear()
      if (failure?.code === 'office_capability_off' && !off) {
        off = true
        uniwork.onOff()
      }
      if (failure?.code === 'office_capability_off' && offNoticed) {
        // off before a run id: the note was shown, the turn just ends (no error chunk, no Retry)
        emit({ requestId, type: 'done' })
        return
      }
      emit({
        requestId,
        type: 'error',
        error: failure
          ? uniwork.describeFailure(failure)
          : err instanceof Error
            ? err.message
            : String(err),
        ...(failure ? { uniworkCode: failure.code } : {}),
        ...(failure?.retryAfterSec !== undefined ? { retryAfterSec: failure.retryAfterSec } : {}),
      })
    } finally {
      active.delete(requestId)
      // before end(): the run may go idle inside it
      deps.handoff?.ended({ failed, openToolCalls: toolCalls > 0 })
      deps.aiRun?.end(requestId)
    }
  }

  /**
   * UniWork AI only: no one-shot chat route, so a one-shot answers with the failure text and sends
   * nothing (no editor panel calls aiChat on the web)
   */
  async function aiChat(): Promise<AiChatResponse> {
    return {
      ok: false,
      error:
        deps.uniwork?.describeFailure({ code: 'ai_disabled' }) ?? 'UniWork AI is not available',
    }
  }

  return {
    aiStream: uniworkTurn,
    aiStreamCancel: async (requestId) => {
      active.get(requestId)?.abort()
    },
    onAiStream: (handler) => {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    },
    aiChat,
  }
}
