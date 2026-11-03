/**
 * A one-shot writer under UniWork AI in the frame (the writer route, UNI-2276): the shared reader
 * (ai-provider `streamUniworkWriter`) over the frame client's `uniwork/write`, mapped to the
 * panel's chunks. The desktop runs the same reader in the shell main process (UNI-2326).
 */
import type { WriterCall } from '@genoffice/agent-core'
import { isAiNetworkError } from '../../../../packages/ai-provider/src/network-error'
import type { AiStreamChunk, AiStreamRequest } from '../../../../packages/ai-provider/src/types'
import type { UniworkConversations } from '../../../../packages/ai-provider/src/uniwork/conversation'
import { streamUniworkWriter } from '../../../../packages/ai-provider/src/uniwork/writer'
import type { AiWebClient } from './client'
import { asUniworkFailure, type UniworkFailure } from './errors'

export { writerLang } from '../../../../packages/ai-provider/src/uniwork/writer'

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
  const { requestId } = request
  // the transport watchdog was armed when the request started: the first ping is due 5 s later
  let lastPing = Date.now()
  const ping = (): void => {
    const now = Date.now()
    if (now - lastPing < 5_000) return
    lastPing = now
    emit({ requestId, type: 'ping' })
  }
  try {
    const { stopReason } = await streamUniworkWriter(
      {
        post: deps.write,
        lang: deps.lang(),
        signal: deps.signal,
        ...(deps.conversations ? { conversations: deps.conversations } : {}),
      },
      request,
      { onDelta: (text) => emit({ requestId, type: 'delta', text }), onActivity: ping },
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
    const failure = uniworkFailureOf(err) ?? { code: 'ai_provider_error' }
    emit({
      requestId,
      type: 'error',
      error: deps.describeFailure(failure),
      uniworkCode: failure.code,
      ...(failure.retryAfterSec !== undefined ? { retryAfterSec: failure.retryAfterSec } : {}),
    })
  }
}
