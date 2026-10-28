/**
 * A one-shot writer under UniWork AI (the writer route, UNI-2276): the Office editors' writers
 * (a Word or Markdown document, an HTML page and its brief, a deck's style, outline and pages)
 * run inside the turn that called them. The server owns the prompts, so only `{kind, lang, input}`
 * goes out, with the turn's conversation and run headers; a writer call never opens a run.
 *
 * The reply is the chat route's SSE (OpenAI-style deltas, then `[DONE]`). A failure after the
 * first delta arrives as one `x_uniwork.terminal` chunk: it ends the write as an error after the
 * deltas already emitted, so `streamText` reports it partial, never complete.
 */
import type { WriterCall } from '@genoffice/agent-core'
import { isAiNetworkError } from '../../../../packages/ai-provider/src/network-error'
import { consumeOpenAiCompatibleResponse } from '../../../../packages/ai-provider/src/protocols/openai-compatible'
import type { AiStreamChunk, AiStreamRequest } from '../../../../packages/ai-provider/src/types'
import {
  uniworkConversations,
  type UniworkConversations,
} from '../../../../packages/ai-provider/src/uniwork/conversation'
import {
  UniworkError,
  uniworkErrorFromResponse,
} from '../../../../packages/ai-provider/src/uniwork/errors'
import {
  UNIWORK_CONVERSATION_HEADER,
  UNIWORK_RUN_HEADER,
} from '../../../../packages/ai-provider/src/uniwork/types'
import type { AiWebClient } from './client'
import { asUniworkFailure, type UniworkFailure } from './errors'

export interface UniworkWriterDeps {
  write: AiWebClient['uniworkWrite']
  /** the module's UI language (the one its AI language directive follows) */
  lang(): string
  /** the localized text of a failed write (aiErr*) */
  describeFailure(failure: UniworkFailure): string
  signal: AbortSignal
  /** the id store; the process-wide one by default */
  conversations?: UniworkConversations
}

/** the writer route takes vi or en: a Vietnamese UI writes Vietnamese, every other one English */
export function writerLang(lang: string): 'vi' | 'en' {
  return /^vi(?:-|$)/i.test(lang) ? 'vi' : 'en'
}

/** a failed UniWork AI request: the server's code, or the connection that broke */
export function uniworkFailureOf(err: unknown): UniworkFailure | undefined {
  return (
    asUniworkFailure(err) ??
    (isAiNetworkError(err)
      ? {
          code:
            typeof navigator !== 'undefined' && navigator.onLine === false
              ? 'offline'
              : 'disconnected',
        }
      : undefined)
  )
}

export async function runUniworkWriter(
  deps: UniworkWriterDeps,
  request: AiStreamRequest & { writer: WriterCall },
  emit: (chunk: AiStreamChunk) => void,
): Promise<void> {
  const { requestId, writer } = request
  const fail = (failure: UniworkFailure): void =>
    emit({
      requestId,
      type: 'error',
      error: deps.describeFailure(failure),
      uniworkCode: failure.code,
      ...(failure.retryAfterSec !== undefined ? { retryAfterSec: failure.retryAfterSec } : {}),
    })
  const ids = (deps.conversations ?? uniworkConversations).ids(request.sessionId)
  // a writer belongs to the run of the turn that called it; without one nothing is sent
  if (!ids.runId) {
    fail({ code: 'unsupported' })
    return
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    [UNIWORK_RUN_HEADER]: ids.runId,
    ...(ids.conversationId ? { [UNIWORK_CONVERSATION_HEADER]: ids.conversationId } : {}),
  }
  const body = JSON.stringify({
    kind: writer.kind,
    lang: writerLang(deps.lang()),
    input: writer.input,
  })
  // the transport watchdog was armed when the request started: the first ping is due 5 s later
  let lastPing = Date.now()
  const ping = (): void => {
    const now = Date.now()
    if (now - lastPing < 5_000) return
    lastPing = now
    emit({ requestId, type: 'ping' })
  }
  let stopReason: string | undefined
  try {
    const res = await deps.write(body, headers, deps.signal)
    if (!res.ok) throw await uniworkErrorFromResponse(res)
    await consumeOpenAiCompatibleResponse(
      res,
      {
        signal: deps.signal,
        onDelta: (text) => emit({ requestId, type: 'delta', text }),
        onToolCall: () => undefined,
        onStopReason: (reason) => {
          stopReason = reason
        },
      },
      ping,
      {
        // a terminal frame ends the read: the write stops where it is, as a failure
        onExtension: (ext) => {
          const code = (ext as { terminal?: { code?: unknown } } | null)?.terminal?.code
          // the server's code is passed on as it came (ai_cancelled is not in the chat union)
          if (typeof code === 'string') throw new UniworkError(code as UniworkError['code'])
        },
        creditsNotice: false,
      },
    )
    emit(
      stopReason === undefined
        ? { requestId, type: 'done' }
        : { requestId, type: 'done', stopReason },
    )
  } catch (err) {
    if (deps.signal.aborted) {
      emit({ requestId, type: 'done' })
      return
    }
    // a malformed answer is a provider error, never an empty success
    fail(uniworkFailureOf(err) ?? { code: 'ai_provider_error' })
  }
}
