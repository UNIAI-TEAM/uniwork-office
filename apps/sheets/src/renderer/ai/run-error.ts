import { aiNoticeKind } from '@genoffice/ai-provider/browser'
import type { AiChatMessage } from './AiChatPanel'

/**
 * A failed agent run, as the chat shows it: the user's message is marked "not sent" (the loop
 * rolled it out of the model context) and the pending assistant bubble carries the error text.
 * The AI panel is the only surface that shows a run's error: the ribbon-row status, the status
 * bar and the shared toast stay quiet, so one failure is one message (visual round 2, R2-02).
 */
export function markRunFailed(
  chat: readonly AiChatMessage[],
  error: string,
): readonly AiChatMessage[] {
  const next = [...chat]
  for (let i = next.length - 1; i >= 0; i--) {
    const entry = next[i]!
    if (entry.role === 'user') {
      // a setup state (no key / no model) is not a send failure: no "not sent" pill, no retry
      next[i] = aiNoticeKind(error) ? entry : { ...entry, undelivered: true }
      break
    }
  }
  const last = next.at(-1)
  if (last?.role === 'assistant') {
    next[next.length - 1] = {
      ...last,
      text: error,
      isError: true,
      streaming: false,
      tools: last.tools.filter((tl) => !tl.running),
    }
  }
  return next
}
