import { isUniworkRefusalErrorKey } from '@genoffice/ui'
import type { AiChatMessage } from './AiChatPanel'

/**
 * A failed agent run, as the chat shows it: the user's message is marked "not sent" (the loop
 * rolled it out of the model context) and the pending assistant bubble carries the error text.
 * The AI panel is the only surface that shows a run's error: the ribbon-row status, the status
 * bar and the shared toast stay quiet, so one failure is one message (visual round 2, R2-02).
 * `errorKey` is the S9 key the transport chose for the text (UniWork AI failures only).
 */
export function markRunFailed(
  chat: readonly AiChatMessage[],
  error: string,
  errorKey?: string,
): readonly AiChatMessage[] {
  const next = [...chat]
  for (let i = next.length - 1; i >= 0; i--) {
    const entry = next[i]!
    if (entry.role === 'user') {
      // a refused question (too long, rejected) is not a send failure: no "not sent" pill, no
      // retry; sending the same text again cannot help
      next[i] = isUniworkRefusalErrorKey(errorKey) ? entry : { ...entry, undelivered: true }
      break
    }
  }
  const last = next.at(-1)
  if (last?.role === 'assistant') {
    next[next.length - 1] = {
      ...last,
      // a stale wait announcement must not outlive the failed run
      status: '',
      text: error,
      errorKey,
      isError: true,
      streaming: false,
      tools: last.tools.filter((tl) => !tl.running),
    }
  }
  return next
}

/** the S9 keys of a UniWork AI turn the network failed: no network, or the connection dropped */
const NETWORK_ERROR_KEYS: ReadonlySet<string> = new Set(['aiErrOffline', 'aiErrDisconnected'])

/**
 * True when the fixed planner answers a failed run instead of its error: the UniWork AI call failed
 * for the network before the run touched the workbook. Offline while signed in, the availability
 * flag stays on until the next cloud read, so the run still went to UniWork AI (UNI-2309).
 */
export function plannerAnswersFailedRun(errorKey: string | undefined, ranTools: boolean): boolean {
  return !ranTools && errorKey !== undefined && NETWORK_ERROR_KEYS.has(errorKey)
}
