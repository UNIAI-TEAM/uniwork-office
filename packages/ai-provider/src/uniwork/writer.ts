/**
 * A one-shot writer under UniWork AI (the writer route, UNI-2276; the desktop routes, UNI-2326):
 * the Office editors' writers (a Word or Markdown document, an HTML page and its brief, a deck's
 * style, outline and pages) run inside the turn that called them. The server owns the prompts, so
 * only `{kind, lang, input}` goes out, with the turn's conversation and run headers; a writer call
 * never opens a run. Both hosts read the answer here: the web frame posts to its frame route, the
 * shell main process to the document (R3) or organization (R1) route, each adding its own auth.
 *
 * The reply is the chat route's SSE (OpenAI-style deltas, then `[DONE]`). A failure after the
 * first delta arrives as one `x_uniwork.terminal` chunk: it ends the write as an error after the
 * deltas already emitted, so `streamText` reports it partial, never complete.
 */
import type { WriterCall } from '@genoffice/agent-core'
import { consumeOpenAiCompatibleResponse } from '../protocols/openai-sse'
import { uniworkConversations, type UniworkConversations } from './conversation'
import { UniworkError, uniworkErrorFromResponse } from './errors'
import { UNIWORK_CONVERSATION_HEADER, UNIWORK_RUN_HEADER } from './types'

/** the writer route takes vi or en: a Vietnamese UI writes Vietnamese, every other one English */
export function writerLang(lang: string): 'vi' | 'en' {
  return /^vi(?:-|$)/i.test(lang) ? 'vi' : 'en'
}

export interface UniworkWriterDeps {
  /** one POST of the writer route, auth added by the host; resolves RAW (non-2xx included) */
  post(body: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response>
  /** the module's UI language (the one its AI language directive follows) */
  lang: string
  signal: AbortSignal
  /** the id store; the process-wide one by default */
  conversations?: UniworkConversations
}

export interface UniworkWriterCallbacks {
  onDelta(text: string): void
  /** bytes arrived (keepalive for the renderer's silence watchdog) */
  onActivity?(): void
}

/**
 * Runs one writer call and resolves with its stop reason. Rejects with a `UniworkError` for the
 * server's code (`unsupported` before any request when no turn's run is open), or with whatever
 * the host's post rejected with (offline, a broken connection, an abort).
 */
export async function streamUniworkWriter(
  deps: UniworkWriterDeps,
  request: { sessionId?: string | undefined; writer: WriterCall },
  cb: UniworkWriterCallbacks,
): Promise<{ stopReason?: string }> {
  const conversations = deps.conversations ?? uniworkConversations
  const ids = conversations.ids(request.sessionId)
  // a writer belongs to the run of the turn that called it; without one nothing is sent
  if (!ids.runId) throw new UniworkError('unsupported')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    [UNIWORK_RUN_HEADER]: ids.runId,
    ...(ids.conversationId ? { [UNIWORK_CONVERSATION_HEADER]: ids.conversationId } : {}),
  }
  const body = JSON.stringify({
    kind: request.writer.kind,
    lang: writerLang(deps.lang),
    input: request.writer.input,
  })
  let stopReason: string | undefined
  try {
    const res = await deps.post(body, headers, deps.signal)
    if (!res.ok) throw await uniworkErrorFromResponse(res)
    await consumeOpenAiCompatibleResponse(
      res,
      {
        signal: deps.signal,
        onDelta: cb.onDelta,
        onToolCall: () => undefined,
        onStopReason: (reason) => {
          stopReason = reason
        },
      },
      () => cb.onActivity?.(),
      {
        // a terminal frame ends the read: the write stops where it is, as a failure
        onExtension: (ext) => {
          const terminal = (ext as { terminal?: unknown } | null)?.terminal
          if (!terminal || typeof terminal !== 'object') return
          // the server's code is passed on as it came (ai_cancelled is not in the chat union);
          // a terminal without a readable one still ends the write as a failure
          const code = (terminal as { code?: unknown }).code
          throw new UniworkError(
            (typeof code === 'string' && code ? code : 'ai_provider_error') as UniworkError['code'],
          )
        },
      },
    )
  } catch (err) {
    // a lost session may come back as another account: nothing of this one is sent again
    if (!deps.signal.aborted && err instanceof UniworkError && err.code === 'session_expired') {
      conversations.clear()
    }
    throw err
  }
  return stopReason === undefined ? {} : { stopReason }
}
