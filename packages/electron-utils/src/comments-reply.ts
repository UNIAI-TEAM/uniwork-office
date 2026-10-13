/**
 * Renderer half of the UniWork comments envelope (R1-1). The preload resolves
 * to the raw `CommentsReply<T>` data, because Electron's contextBridge clones
 * every value crossing it and reduces a thrown Error to `{ name, message,
 * stack }`: a `DocsProtocolError` rehydrated in the preload realm would reach
 * the renderer stripped of `details.code`, `retryable` and `status`. Renderer
 * code unwraps the envelope here, in its own realm, so `instanceof
 * DocsProtocolError` holds and the §9 mapping (409 `comment_deleted` ->
 * `conflict` + `details.code`, keep the draft, no reload) survives.
 *
 * Never imported by a preload: that is the code path R1-1 removed.
 */
import { DocsProtocolError, isProtocolErrorShape } from '../../../web/docs/protocol/types'
import type { CommentsReply } from './comments-ipc'

/** the reply's value, or its protocol error thrown in the caller's realm */
export function unwrapCommentsReply<T>(reply: CommentsReply<T>): T {
  if (reply !== null && typeof reply === 'object' && reply.ok === true) return reply.value
  const error = (reply as { error?: unknown } | null | undefined)?.error
  throw new DocsProtocolError(
    isProtocolErrorShape(error)
      ? error
      : { code: 'internal', message: 'comments: malformed IPC reply' },
  )
}
