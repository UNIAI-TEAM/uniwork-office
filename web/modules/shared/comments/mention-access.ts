/**
 * G8-18: what the frame's mention UI may do, read from the `init` session in one place so the
 * editor bridge (`window.uniworkComments`) and the Discussion panel agree.
 *
 * - `commentsShareView`: the EFFECTIVE `commentsShareView` capability (frame claim AND host grant).
 *   The D host grants it only to a caller who may share on a writable page; without it the frame
 *   never offers "Share view access" and never sends `comments.shareView`.
 * - `canListMembers`: whether `mentions.search` may carry `include: 'no_access'`. The init payload has
 *   no dedicated flag (the protocol shape is not ours to change here), so it is derived from what
 *   the host already says about the caller: a manage level, or a granted `commentsShareView` (the
 *   host grants that to a manage caller only). The server ignores `include` for a caller who may not
 *   list members, so a wrong "no" only hides the pre-send badge (the post-send notice still covers
 *   it) and a wrong "yes" is harmless.
 */
import type { Capabilities, CommentsLevel } from '../../../docs/protocol/types'

export interface FrameMentionAccess {
  commentsShareView: boolean
  canListMembers: boolean
}

export function frameMentionAccess(session: {
  capabilities?: Capabilities
  commentsLevel?: CommentsLevel
}): FrameMentionAccess {
  const commentsShareView =
    session.capabilities?.comments === true && session.capabilities.commentsShareView === true
  return {
    commentsShareView,
    canListMembers: commentsShareView || session.commentsLevel === 'manage',
  }
}
