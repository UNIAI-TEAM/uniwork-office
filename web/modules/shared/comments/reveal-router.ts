/**
 * The frame's one `comments.reveal` handler (lane contract G8-12 §3.3, contract-collab §10).
 *
 * A frame may show two comment panels: the G8-11 Discussion panel and the editor's own S12 panel.
 * The host sends one `comments.reveal` per id, so exactly one handler is registered with the port
 * (which already holds a reveal until the first successful `comments.list`, at most
 * COMMENTS_REVEAL_WAIT_MS, then `not_ready`) and it asks the owners in turn:
 *
 * 1. the Discussion panel (its controller knows discussion posts and their replies);
 * 2. the editor panels (`window.uniworkComments.onReveal` handlers, which on the web answer
 *    `boolean | Promise<boolean>`: true = this panel owns the id and revealed it).
 *
 * The first owner that answers true wins and nobody else is asked. `revealed: false` only when no
 * owner has the id. The S15 line is shown by the last owner asked: the Discussion panel gets
 * `{ last: true }` when no editor handler is registered (Markdown / HTML), and an editor panel
 * shows its own S15 line on a miss. So exactly one panel reacts.
 */
import type { CommentsRevealPayload, CommentsRevealResult } from '../../../docs/protocol/types'

/** the Discussion panel's owner; `last`: no editor owner follows, a miss shows the S15 line here */
export type DiscussionRevealOwner = (commentId: string, ctx: { last: boolean }) => Promise<boolean>

/** an editor panel's owner (the `onReveal` handler); anything but `true` reads as "not mine" */
export type EditorRevealOwner = (commentId: string) => unknown

/** the port slice the router registers with (the real frame client has it) */
export interface RevealPort {
  handleCommentsReveal?(
    handler: (
      payload: CommentsRevealPayload,
      ctx: { signal: AbortSignal },
    ) => CommentsRevealResult | Promise<CommentsRevealResult>,
  ): () => void
}

export interface FrameRevealRouter {
  /** the Discussion panel's owner (one per frame); returns the release */
  setDiscussion(owner: DiscussionRevealOwner): () => void
  /** an editor panel's owner; returns the release */
  addEditor(owner: EditorRevealOwner): () => void
}

interface RouterState {
  discussion: DiscussionRevealOwner | null
  editors: EditorRevealOwner[]
  off: (() => void) | null
}

const routers = new WeakMap<RevealPort, FrameRevealRouter>()

/** the router of `port`, created on first use; it registers with the port only while it has an owner */
export function frameRevealRouter(port: RevealPort): FrameRevealRouter {
  const known = routers.get(port)
  if (known) return known
  const state: RouterState = { discussion: null, editors: [], off: null }

  const answer = async (commentId: string): Promise<CommentsRevealResult> => {
    const editors = [...state.editors]
    const discussion = state.discussion
    if (discussion && (await discussion(commentId, { last: editors.length === 0 }))) {
      return { revealed: true }
    }
    for (const editor of editors) {
      if ((await editor(commentId)) === true) return { revealed: true }
    }
    return { revealed: false }
  }

  const sync = (): void => {
    const wanted = state.discussion !== null || state.editors.length > 0
    if (wanted && !state.off) {
      state.off = port.handleCommentsReveal?.(({ comment_id }) => answer(comment_id)) ?? null
    } else if (!wanted && state.off) {
      state.off()
      state.off = null
    }
  }

  const router: FrameRevealRouter = {
    setDiscussion(owner) {
      state.discussion = owner
      sync()
      return () => {
        if (state.discussion !== owner) return
        state.discussion = null
        sync()
      }
    },
    addEditor(owner) {
      state.editors.push(owner)
      sync()
      let released = false
      return () => {
        if (released) return
        released = true
        state.editors = state.editors.filter((o) => o !== owner)
        sync()
      }
    },
  }
  routers.set(port, router)
  return router
}
