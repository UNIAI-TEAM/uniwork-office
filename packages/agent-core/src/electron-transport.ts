import type {
  AgentStreamRequest,
  AgentTokenUsage,
  AgentToolCall,
  AgentToolDef,
  AgentTransport,
  AgentMessage,
  AgentStreamNotice,
  AgentRequestPurpose,
} from './types'
import { createAiRunTracker, type AiRunTracker } from './ai-run-tracker'

/**
 * One streamed chunk pushed back over an Electron IPC bridge. Structurally
 * identical to ai-provider's AiStreamChunk; declared here so this package
 * stays dependency-free.
 */
export interface IpcStreamChunk {
  requestId: string
  /** 'ping' = wire-level keepalive; re-arms the silence watchdog and carries no payload;
   * 'reasoning' = model thinking delta (text carries it) */
  type:
    'delta' | 'reasoning' | 'tool-call' | 'usage' | 'done' | 'error' | 'ping' | 'notice' | 'reset'
  text?: string
  toolCall?: AgentToolCall
  /** 'notice' only: the non-fatal turn notice (UniWork AI) */
  notice?: AgentStreamNotice
  error?: string
  /** machine-readable error cause; maps to the localized timeout/credits/network/overloaded message */
  errorCode?: 'timeout' | 'credits' | 'network' | 'overloaded'
  /** a UniWork AI failure: the server's `code` decides the message, never the text or errorCode */
  uniworkCode?: string
  /** with uniworkCode: seconds the server asked to wait (Retry-After), when it sent one */
  retryAfterSec?: number
  /** normalized stop reason on 'done' ('max_tokens' = cut off by the token limit) */
  stopReason?: string
  /** the server's run id of this turn (UniWork AI `X-UniWork-AI-Run`), on the chunk after it is known */
  runId?: string
  /** tokens the provider billed for this turn, carried on 'usage' (always sent before 'done') */
  usage?: AgentTokenUsage
}

/** The request forwarded to the main process to start one streaming turn. */
export interface IpcStreamStart<S> {
  requestId: string
  /** Stable for the lifetime of one renderer-side transport. Providers with
   * native conversations can reuse it across the tool loop and follow-ups. */
  sessionId: string
  settings: S
  system: string
  messages: AgentMessage[]
  tools: AgentToolDef[]
  /** not an agent turn (the loop's summary, a one-shot writer); absent for agent turns */
  purpose?: AgentRequestPurpose
}

/**
 * Renderer-side silence watchdog: the main process re-arms it with keepalive
 * pings on wire activity, so firing means the turn is dead (main-process stall,
 * lost chunks) and the run must fail instead of leaving the UI busy forever.
 * Longer than the main-process idle timeout (180s) so that one (localized) wins.
 */
export const IPC_STREAM_SILENCE_TIMEOUT_MS = 240_000

export interface IpcTransportOptions<S> {
  /** subscribe to stream chunks; returns the unsubscribe function */
  onStream(listener: (chunk: IpcStreamChunk) => void): () => void
  /** forward the start request to the main process; a returned promise reports handler failure */
  start(request: IpcStreamStart<S>): void | Promise<unknown>
  /** abort the in-flight turn in the main process */
  cancel(requestId: string): void
  getSettings(): S
  /** localized fallback when an error chunk carries no message */
  unknownErrorText(): string
  /** localized message for timeouts (errorCode 'timeout' and the silence watchdog) */
  timeoutErrorText?(): string
  /** localized message for exhausted credits (errorCode 'credits') */
  creditsErrorText?(): string
  /** localized message for network connectivity failures (errorCode 'network') */
  networkErrorText?(): string
  /** localized message for capacity/rate-limit failures (errorCode 'overloaded') */
  overloadedErrorText?(): string
  /**
   * localized message + its S9 key for a UniWork AI failure, chosen by the server's `code` (never
   * by the error text); undefined falls back to the chunk's own text. `retryAfterSec` is the
   * Retry-After the server sent, when it did.
   */
  uniworkError?(
    code: string,
    retryAfterSec?: number,
  ): { text: string; errorKey: string } | undefined
  /** the AI turn tracker the stream reports to; default: the window's shared one (see desktopAiRun) */
  aiRun?: AiRunTracker
}

/** the narrow slice of the preload's window.uniworkAiRun bridge used here (agent-core imports no Electron types) */
interface AiRunWindowBridge {
  reportAiRun?(report: { state: 'running' | 'idle'; runId?: string }): void
}

/**
 * The renderer's one tracker for window.uniworkAiRun.reportAiRun: every AI turn of every provider
 * reports through it, so the shell sees `running` at the first stream and exactly one `idle` after
 * the last. Without the bridge (web frame, tests, an older preload) it reports nothing.
 */
export const desktopAiRun: AiRunTracker = createAiRunTracker({
  report: (payload) => {
    const bridge = (globalThis as { window?: { uniworkAiRun?: AiRunWindowBridge } }).window
      ?.uniworkAiRun
    bridge?.reportAiRun?.({
      state: payload.state,
      ...(payload.run_id !== undefined ? { runId: payload.run_id } : {}),
    })
  },
})

/**
 * AgentTransport over an Electron IPC bridge: the main process talks to the
 * LLM providers (avoids renderer CORS) and streams chunks back per requestId.
 * Each app wires in its own preload bridge and i18n via the options.
 */
export function createIpcTransport<S>(options: IpcTransportOptions<S>): AgentTransport {
  const timeoutText = () => options.timeoutErrorText?.() ?? options.unknownErrorText()
  const sessionId = crypto.randomUUID()
  const aiRun = options.aiRun ?? desktopAiRun
  return {
    stream(request: AgentStreamRequest, cb) {
      const requestId = crypto.randomUUID()
      let settled = false
      let silenceTimer: ReturnType<typeof setTimeout> | undefined
      const settle = () => {
        settled = true
        clearTimeout(silenceTimer)
        unsubscribe()
        // every ending path (done, error, stop, watchdog, rejected start) lands here: one idle
        aiRun.end(requestId)
      }
      const fail = (error: string, errorKey?: string) => {
        if (settled) return
        settle()
        cb.onError(error, errorKey)
      }
      const armSilence = () => {
        clearTimeout(silenceTimer)
        silenceTimer = setTimeout(() => {
          options.cancel(requestId)
          fail(timeoutText())
        }, IPC_STREAM_SILENCE_TIMEOUT_MS)
      }
      const unsubscribe = options.onStream((chunk) => {
        if (chunk.requestId !== requestId || settled) return
        // the shell main process read the server's run id: aiRun reports it instead of the local one
        if (chunk.runId) aiRun.setRunId(chunk.runId)
        if (chunk.type === 'ping') {
          armSilence()
        } else if (chunk.type === 'delta') {
          armSilence()
          cb.onDelta(chunk.text ?? '')
        } else if (chunk.type === 'reasoning') {
          armSilence()
          if (chunk.text) cb.onReasoning?.(chunk.text)
        } else if (chunk.type === 'tool-call') {
          armSilence()
          if (chunk.toolCall) cb.onToolCall(chunk.toolCall)
        } else if (chunk.type === 'notice') {
          // a wait or a restart is traffic too: the watchdog stays armed through a Retry-After wait
          armSilence()
          if (chunk.notice) cb.onNotice?.(chunk.notice)
        } else if (chunk.type === 'reset') {
          armSilence()
          cb.onTurnReset?.()
        } else if (chunk.type === 'usage') {
          armSilence()
          if (chunk.usage) cb.onUsage?.(chunk.usage)
        } else if (chunk.type === 'done') {
          settle()
          if (chunk.stopReason) cb.onStopReason?.(chunk.stopReason)
          cb.onDone()
        } else if (chunk.type === 'error') {
          const uniwork =
            chunk.uniworkCode !== undefined
              ? options.uniworkError?.(chunk.uniworkCode, chunk.retryAfterSec)
              : undefined
          settle()
          cb.onError(
            chunk.uniworkCode !== undefined
              ? (uniwork?.text ?? chunk.error ?? options.unknownErrorText())
              : chunk.errorCode === 'timeout'
                ? timeoutText()
                : chunk.errorCode === 'credits'
                  ? (options.creditsErrorText?.() ?? chunk.error ?? options.unknownErrorText())
                  : chunk.errorCode === 'network'
                    ? (options.networkErrorText?.() ?? chunk.error ?? options.unknownErrorText())
                    : chunk.errorCode === 'overloaded'
                      ? (options.overloadedErrorText?.() ??
                        chunk.error ??
                        options.unknownErrorText())
                      : (chunk.error ?? options.unknownErrorText()),
            uniwork?.errorKey,
          )
        } else {
          // A chunk kind this build predates must not kill the run; traffic proves it is alive.
          armSilence()
        }
      })
      armSilence()
      aiRun.begin(requestId, () => options.cancel(requestId))
      try {
        // a rejected/thrown start would otherwise leave the run pending until the watchdog
        Promise.resolve(
          options.start({
            requestId,
            sessionId,
            settings: options.getSettings(),
            system: request.system,
            messages: request.messages,
            tools: request.tools,
            ...(request.purpose ? { purpose: request.purpose } : {}),
          }),
        ).catch((err: unknown) => {
          fail(err instanceof Error ? err.message : options.unknownErrorText())
        })
      } catch (err) {
        fail(err instanceof Error ? err.message : options.unknownErrorText())
      }
      return { cancel: () => options.cancel(requestId) }
    },
  }
}
