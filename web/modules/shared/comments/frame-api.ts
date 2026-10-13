/**
 * `window.uniworkComments` in a web frame (lane contract G8-12 §2 D2, §3.3): the same
 * `UniworkCommentsApi` shape the desktop editor preloads expose, backed by the frame protocol's
 * `comments.*` / `mentions.search` requests, so an editor renderer has one comments path on both
 * hosts. Every call resolves to the `CommentsReply` envelope (never rejects with a protocol
 * error); `path` is ignored: a frame shows one document.
 *
 * `context()` answers from `init` (`documentId`, `commentsLevel`, `user.id`) and the open file's
 * server version (./doc-version, updated by every landed save); `onSaved` fires after a landed
 * save; `onReveal` registers an editor owner with the frame's reveal router (./reveal-router).
 */
import {
  COMMENTS_BRIDGE_KEY,
  type CommentsContextResult,
  type CommentsReply,
  type CommentsRevealPayload,
  type CommentsSavedPayload,
  type UniworkCommentsApi,
} from '../../../../packages/electron-utils/src/comments-ipc'
import type { FramePort, PortSession } from '../../../docs/bridge/frame-port'
import {
  commentsAccess,
  toProtocolError,
  type CommentsLevel,
  type FrameRequestType,
  type FrameRequests,
} from '../../../docs/protocol/types'
import { frameDocVersion, type FrameDocVersion } from './doc-version'
import { frameRevealRouter, type RevealPort } from './reveal-router'

/** what the frame API needs from the frame client (the real client has it all) */
export type FrameCommentsClient = Pick<FramePort, 'whenInitialized' | 'request'> & RevealPort

export interface FrameCommentsHooks {
  /** the open document's version tracker; default: the frame page's `frameDocVersion` */
  version?: FrameDocVersion
}

/** the `init` fields the API reads (the real client's FrameSession has them all) */
type CommentsSession = PortSession & { commentsLevel?: CommentsLevel }

function isLevel(value: unknown): value is NonNullable<CommentsContextResult['level']> {
  return value === 'view' || value === 'edit' || value === 'manage'
}

async function envelope<T>(run: () => Promise<T>): Promise<CommentsReply<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (err) {
    return { ok: false, error: toProtocolError(err).toShape() }
  }
}

export function createFrameCommentsApi(
  client: FrameCommentsClient,
  hooks: FrameCommentsHooks = {},
): UniworkCommentsApi {
  const version = hooks.version ?? frameDocVersion
  const call = <K extends FrameRequestType>(
    type: K,
    payload: FrameRequests[K]['payload'],
  ): Promise<CommentsReply<FrameRequests[K]['result']>> =>
    envelope(() => client.request(type, payload))

  return {
    list: ({ kind, sinceToken }) =>
      call('comments.list', {
        ...(kind !== undefined ? { kind } : {}),
        ...(sinceToken !== undefined ? { since_token: sinceToken } : {}),
      }),
    create: ({ kind, parentId, body, anchor, baseVersionId }) =>
      call('comments.create', {
        kind,
        body,
        ...(parentId !== undefined ? { parent_id: parentId } : {}),
        ...(anchor !== undefined
          ? { anchor: anchor as FrameRequests['comments.create']['payload']['anchor'] }
          : {}),
        ...(baseVersionId !== undefined ? { base_version_id: baseVersionId } : {}),
      }),
    update: ({ commentId, body }) => call('comments.update', { comment_id: commentId, body }),
    remove: ({ commentId }) => call('comments.delete', { comment_id: commentId }),
    resolve: ({ commentId }) => call('comments.resolve', { comment_id: commentId }),
    reopen: ({ commentId }) => call('comments.reopen', { comment_id: commentId }),
    revisions: ({ commentId }) => call('comments.revisions', { comment_id: commentId }),
    anchors: ({ versionId, anchors }) =>
      call('comments.anchors', {
        version_id: versionId,
        anchors: anchors.map((a) => ({
          comment_id: a.commentId,
          anchor:
            a.anchor as FrameRequests['comments.anchors']['payload']['anchors'][number]['anchor'],
          state: a.state,
        })),
      }),
    searchMentions: ({ q, limit }) =>
      call('mentions.search', { q, ...(limit !== undefined ? { limit } : {}) }),
    context: () =>
      envelope(async (): Promise<CommentsContextResult> => {
        const session = (await client.whenInitialized()) as CommentsSession
        const userId = session.user?.id
        return {
          documentId: session.documentId,
          // the bridges note every open/save; before the first one, init's open payload
          versionId: version.current().versionId ?? session.open?.file.versionId ?? null,
          ...(isLevel(session.commentsLevel) ? { level: session.commentsLevel } : {}),
          ...(typeof userId === 'string' && userId ? { myUserId: userId } : {}),
        }
      }),
    onSaved: (handler: (payload: CommentsSavedPayload) => void) =>
      version.onSaved((saved) => handler(saved)),
    onReveal: (handler: (payload: CommentsRevealPayload) => unknown) =>
      // on the web the handler may answer boolean | Promise<boolean>: true = this panel owns the id
      frameRevealRouter(client).addEditor((commentId) =>
        handler({ path: version.current().path ?? '', commentId }),
      ),
  }
}

/**
 * Sets `window.uniworkComments` once `init` granted `comments` (effective capabilities); resolves
 * with the API, or null when the frame has no comments (nothing is installed, no request is sent).
 */
export async function installFrameComments(
  client: FrameCommentsClient,
  hooks: FrameCommentsHooks = {},
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): Promise<UniworkCommentsApi | null> {
  let session: PortSession
  try {
    session = await client.whenInitialized()
  } catch {
    return null
  }
  if (!commentsAccess({ capabilities: session.capabilities ?? {} }).enabled) return null
  const api = createFrameCommentsApi(client, hooks)
  target[COMMENTS_BRIDGE_KEY] = api
  return api
}
