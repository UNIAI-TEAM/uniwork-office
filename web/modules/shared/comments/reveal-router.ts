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
 *
 * A module that serves anchored comments (`installFrameComments`) marks an editor as expected
 * (`expectEditor`). The editor registers late (after init, the parse and the host mount), so while
 * one is expected and none has registered the router asks Discussion with `last: false`, and when
 * Discussion does not own the id it waits for the first `addEditor` for at most
 * COMMENTS_REVEAL_WAIT_MS, then answers the typed retryable `not_ready` (never `revealed:false`:
 * contract-collab §10 rule 2). The budget starts when the handler runs, i.e. after the port's own
 * wait for the first list, so the two waits add up at worst.
 */
import {
  COMMENTS_REVEAL_WAIT_MS,
  DocsProtocolError,
  type CommentsRevealPayload,
  type CommentsRevealResult,
} from '../../../docs/protocol/types'

/** the Discussion panel's owner; `last`: no editor owner follows, a miss shows the S15 line here */
export type DiscussionRevealOwner = (commentId: string, ctx: { last: boolean }) => Promise<boolean>

/** an editor panel's owner (the `onReveal` handler); anything but `true` reads as "not mine" */
/** `last`: no other owner is asked after this one, so a miss is shown by this panel (S15) */
export type EditorRevealOwner = (commentId: string, ctx: { last: boolean }) => unknown

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
  /** the module will register an editor owner later (anchored comments); returns the release */
  expectEditor(): () => void
}

interface RouterState {
  discussion: DiscussionRevealOwner | null
  editors: EditorRevealOwner[]
  /** how many `expectEditor` marks are live */
  expected: number
  /** reveals waiting for the first editor owner */
  waiters: Set<() => void>
  off: (() => void) | null
}

const routers = new WeakMap<RevealPort, FrameRevealRouter>()

/** the router of `port`, created on first use; it registers with the port only while it has an owner */
export function frameRevealRouter(port: RevealPort): FrameRevealRouter {
  const known = routers.get(port)
  if (known) return known
  const state: RouterState = {
    discussion: null,
    editors: [],
    expected: 0,
    waiters: new Set(),
    off: null,
  }

  /** resolves with the registered editors once one exists (or none are expected any more) */
  const whenEditor = (signal: AbortSignal): Promise<EditorRevealOwner[]> =>
    new Promise((resolve, reject) => {
      const wake = (): void => {
        if (state.editors.length > 0 || state.expected === 0) {
          settle()
          resolve([...state.editors])
        }
      }
      const timer = setTimeout(() => {
        settle()
        reject(
          new DocsProtocolError({
            code: 'not_ready',
            message: `comments.reveal before the editor registered: no editor after ${COMMENTS_REVEAL_WAIT_MS} ms`,
            retryable: true,
          }),
        )
      }, COMMENTS_REVEAL_WAIT_MS)
      const onAbort = (): void => {
        settle()
        reject(new DocsProtocolError({ code: 'cancelled', message: 'comments.reveal cancelled' }))
      }
      const settle = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        state.waiters.delete(wake)
      }
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
      state.waiters.add(wake)
    })

  const wakeWaiters = (): void => {
    for (const wake of [...state.waiters]) wake()
  }

  const answer = async (commentId: string, signal: AbortSignal): Promise<CommentsRevealResult> => {
    let editors = [...state.editors]
    const waitForEditor = editors.length === 0 && state.expected > 0
    const discussion = state.discussion
    if (
      discussion &&
      (await discussion(commentId, { last: editors.length === 0 && !waitForEditor }))
    ) {
      return { revealed: true }
    }
    if (waitForEditor)
      editors = state.editors.length > 0 ? [...state.editors] : await whenEditor(signal)
    for (const [i, editor] of editors.entries()) {
      if ((await editor(commentId, { last: i === editors.length - 1 })) === true) {
        return { revealed: true }
      }
    }
    return { revealed: false }
  }

  const sync = (): void => {
    const wanted = state.discussion !== null || state.editors.length > 0 || state.expected > 0
    if (wanted && !state.off) {
      state.off =
        port.handleCommentsReveal?.(({ comment_id }, { signal }) => answer(comment_id, signal)) ??
        null
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
      wakeWaiters()
      let released = false
      return () => {
        if (released) return
        released = true
        state.editors = state.editors.filter((o) => o !== owner)
        sync()
      }
    },
    expectEditor() {
      state.expected += 1
      sync()
      let released = false
      return () => {
        if (released) return
        released = true
        state.expected -= 1
        sync()
        wakeWaiters()
      }
    },
  }
  routers.set(port, router)
  return router
}
