import { isAiNetworkError } from './network-error'

/**
 * Why an AI request failed, as a code the renderer turns into a product message in
 * the UI language (`ai-chat-error-text.ts`). The raw service text ("HTTP 401: {...}")
 * stays in the main process log. A UniWork AI failure never gets here: its server code
 * picks the message (`ai-chat-error.ts`).
 */
export type AiTestFailureKind = 'invalid_key' | 'network' | 'limit' | 'unavailable' | 'failed'

/** an HTTP status from the AI service */
export function aiTestFailureKindForStatus(status: number): AiTestFailureKind {
  if (status === 401 || status === 403) return 'invalid_key'
  if (status === 402 || status === 429) return 'limit'
  if (status === 408 || status >= 500) return 'unavailable'
  return 'failed'
}

/** a thrown error or a raw result text: a status in it ("HTTP 401: ...") or a transport failure */
export function aiTestFailureKindForText(text: string, error?: unknown): AiTestFailureKind {
  const status = /\bHTTP (\d{3})\b/.exec(text)?.[1]
  if (status) return aiTestFailureKindForStatus(Number(status))
  if (isAiNetworkError(error ?? text)) return 'network'
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'network'
  }
  return 'failed'
}
