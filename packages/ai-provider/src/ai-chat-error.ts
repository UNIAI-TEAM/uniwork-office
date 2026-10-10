import { aiChatFailureText } from './ai-chat-error-text'
import {
  aiTestFailureKindForChat,
  aiTestFailureKindForText,
  type AiTestFailureKind,
} from './ai-test-failure'
import { isAiNetworkError } from './network-error'
import { isAiOverloadedError } from './overload-error'
import { AiCreditsError } from './protocols/shared'
import type { AiChatResponse } from './types'
import { AiTimeoutError } from './watchdog'

/** an HTTP status marker or a JSON body: the text is a provider dump, not a message for people */
const RAW_DUMP_PATTERN = /\bHTTP \d{3}\b|^\s*[{[]|\{\s*"/

/** the error codes the chat renderers already translate into all 19 languages */
export type AiStreamErrorCode = 'timeout' | 'credits' | 'network' | 'overloaded'

export interface AiStreamErrorFields {
  /** what the chat panel prints (the product message, or the code's fallback text) */
  error: string
  errorCode?: AiStreamErrorCode
  /** the raw provider text, for the main process log */
  raw: string
}

function rawText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The fields of a failed stream's `error` chunk. Timeouts, exhausted credits,
 * connectivity and capacity failures keep the machine-readable code the
 * renderers localize; every other provider failure (a rejected key, a 4xx/5xx
 * dump) carries a finished product message instead of the raw text. A plain
 * message that is not a provider dump (our own "no content" notes) is kept.
 */
export function aiStreamErrorFields(err: unknown, lang: string): AiStreamErrorFields {
  const raw = rawText(err)
  if (err instanceof AiTimeoutError) return { error: raw, errorCode: 'timeout', raw }
  if (err instanceof AiCreditsError) return { error: raw, errorCode: 'credits', raw }
  if (isAiNetworkError(err)) return { error: raw, errorCode: 'network', raw }
  if (isAiOverloadedError(err)) return { error: raw, errorCode: 'overloaded', raw }
  if (!RAW_DUMP_PATTERN.test(raw)) return { error: raw, raw }
  return { error: aiChatFailureText(aiTestFailureKindForText(raw, err), lang), raw }
}

export interface AiChatFailure {
  /** the product message shown to the user */
  error: string
  /** why it failed, for the Settings pill and callers that branch on it */
  errorKind: AiTestFailureKind
  /** the raw provider text, for the main process log */
  raw: string
}

function oneShotFailure(
  raw: string,
  errorKind: AiTestFailureKind,
  lang: string,
  busyText: string,
  busy: boolean,
): AiChatFailure {
  if (busy) return { error: busyText, errorKind: 'unavailable', raw }
  // a plain message of ours ("returned an empty response") reads fine as it is
  const plain = errorKind === 'failed' && raw !== '' && !RAW_DUMP_PATTERN.test(raw)
  return { error: plain ? raw : aiChatFailureText(errorKind, lang), errorKind, raw }
}

/**
 * A failed one-shot chat result (`chatForProvider` answers HTTP failures as
 * `ok: false` with the raw body) as a product message. `busyText` is the app's
 * own localized "service busy" line for capacity failures (it has all 19
 * languages); every other failure reads from the table above.
 */
export function aiChatFailure(
  result: AiChatResponse,
  lang: string,
  busyText: string,
): AiChatFailure {
  const raw = result.error ?? ''
  return oneShotFailure(
    raw,
    aiTestFailureKindForChat(result),
    lang,
    busyText,
    isAiOverloadedError(raw),
  )
}

/** the same for a one-shot chat that threw */
export function aiChatFailureFromError(
  err: unknown,
  lang: string,
  busyText: string,
): AiChatFailure {
  const raw = rawText(err)
  const kind = err instanceof AiTimeoutError ? 'network' : aiTestFailureKindForText(raw, err)
  return oneShotFailure(raw, kind, lang, busyText, isAiOverloadedError(err))
}
