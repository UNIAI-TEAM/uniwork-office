import { aiChatFailureText } from './ai-chat-error-text'
import { aiTestFailureKindForText } from './ai-test-failure'
import { isAiNetworkError } from './network-error'
import { isAiOverloadedError } from './overload-error'
import { isUniworkError } from './uniwork/errors'
import { AiTimeoutError } from './watchdog'

/** an HTTP status marker or a JSON body: the text is a provider dump, not a message for people */
const RAW_DUMP_PATTERN = /\bHTTP \d{3}\b|^\s*[{[]|\{\s*"/

/** the error codes the chat renderers already translate into all 19 languages */
export type AiStreamErrorCode = 'timeout' | 'network' | 'overloaded'

export interface AiStreamErrorFields {
  /** what the chat panel prints (the product message, or the code's fallback text) */
  error: string
  errorCode?: AiStreamErrorCode
  /** the raw provider text, for the main process log */
  raw: string
  /** a UniWork AI failure: the server's code picks the message (uniworkErrorKey), errorCode stays unset */
  uniworkCode?: string
  /** with uniworkCode: the Retry-After seconds the server sent */
  retryAfterSec?: number
}

function rawText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The fields of a failed stream's `error` chunk. Timeouts, connectivity and
 * capacity failures keep the machine-readable code the renderers localize;
 * every other service failure (a 4xx/5xx dump) carries a finished product
 * message instead of the raw text. A plain
 * message that is not a provider dump (our own "no content" notes) is kept.
 */
export function aiStreamErrorFields(err: unknown, lang: string): AiStreamErrorFields {
  const raw = rawText(err)
  // before every text classifier: a UniWork AI code is never read as overloaded/network text
  if (isUniworkError(err)) {
    return {
      error: raw,
      raw,
      uniworkCode: err.code,
      ...(err.retryAfterSec !== undefined ? { retryAfterSec: err.retryAfterSec } : {}),
    }
  }
  if (err instanceof AiTimeoutError) return { error: raw, errorCode: 'timeout', raw }
  if (isAiNetworkError(err)) return { error: raw, errorCode: 'network', raw }
  if (isAiOverloadedError(err)) return { error: raw, errorCode: 'overloaded', raw }
  if (!RAW_DUMP_PATTERN.test(raw)) return { error: raw, raw }
  return { error: aiChatFailureText(aiTestFailureKindForText(raw, err), lang), raw }
}
