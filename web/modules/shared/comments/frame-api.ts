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
  type MentionsSearchInput,
  type UniworkCommentsApi,
} from '../../../../packages/electron-utils/src/comments-ipc'
import type { FramePort, PortSession } from '../../../docs/bridge/frame-port'
import {
  commentsAccess,
  isReadOnlyProfile,
  toProtocolError,
  type CommentsLevel,
  type FrameRequestType,
  type FrameRequests,
} from '../../../docs/protocol/types'
import { frameDocVersion, type FrameDocVersion } from './doc-version'
import { frameMentionAccess } from './mention-access'
import { frameRevealRouter, type RevealPort } from './reveal-router'

/** what the frame API needs from the frame client (the real client has it all) */
export type FrameCommentsClient = Pick<FramePort, 'whenInitialized' | 'request'> & RevealPort

export interface FrameCommentsHooks {
  /** the open document's version tracker; default: the frame page's `frameDocVersion` */
  version?: FrameDocVersion
  /**
   * the initialized session: G8-18 reads the effective `commentsShareView` capability and the
   * caller's level from it. Absent (unit tests, a client without `init` yet): no share action and
   * no `include: 'no_access'`.
   */
  session?: CommentsSession
}

/** G8-18 additions to the mention search input: the desktop shape never carries `include` */
export type FrameMentionsSearchInput = MentionsSearchInput & { include?: 'no_access' }

/**
 * G8-18 extras of the frame bridge: the editor's source adapter reads them off `window.uniworkComments`
 * (`createUniworkCommentsSource`). `shareView` exists only with the effective `commentsShareView`
 * capability, so the editor offers the action exactly when the host allows it.
 */
export interface FrameCommentsExtras {
  /** true when `mentions.search` may ask for `include: 'no_access'` (see ./mention-access) */
  canListMembers?: boolean
  /** `comments.shareView`: grant `view` to a mentioned user (the host fixes the level) */
  shareView?(input: { path?: string; userId: string }): Promise<CommentsReply<{ ok: true }>>
}

/**
 * what `installFrameComments` publishes: the comments API plus `noEditor`, which the editor calls
 * when it ends without a server mode (the reveal router then stops waiting for its owner)
 */
export type FrameCommentsApi = UniworkCommentsApi & FrameCommentsExtras & { noEditor(): void }

/** the `init` fields the API reads (the real client's FrameSession has them all) */
export type CommentsSession = PortSession & { commentsLevel?: CommentsLevel }

function isLevel(value: unknown): value is NonNullable<CommentsContextResult['level']> {
  return value === 'view' || value === 'comment' || value === 'edit' || value === 'manage'
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
): UniworkCommentsApi & FrameCommentsExtras {
  const version = hooks.version ?? frameDocVersion
  const mention = hooks.session ? frameMentionAccess(hooks.session) : null
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
    searchMentions: ({ q, limit, include }: FrameMentionsSearchInput) =>
      call('mentions.search', {
        q,
        ...(limit !== undefined ? { limit } : {}),
        ...(include !== undefined ? { include } : {}),
      }),
    ...(mention ? { canListMembers: mention.canListMembers } : {}),
    ...(mention?.commentsShareView
      ? {
          shareView: ({ userId }: { userId: string }) =>
            call('comments.shareView', { user_id: userId }),
        }
      : {}),
    context: () =>
      envelope(async (): Promise<CommentsContextResult> => {
        const session = (await client.whenInitialized()) as CommentsSession
        const userId = session.user?.id
        return {
          documentId: session.documentId,
          // the bridges note every open/save; before the first one, init's open payload
          versionId: version.current().versionId ?? session.open?.file.versionId ?? null,
          ...(isReadOnlyProfile(session)
            ? { level: 'view' as const }
            : isLevel(session.commentsLevel)
              ? { level: session.commentsLevel }
              : {}),
          ...(typeof userId === 'string' && userId ? { myUserId: userId } : {}),
          frame: true,
        }
      }),
    onSaved: (handler: (payload: CommentsSavedPayload) => void) =>
      version.onSaved((saved) => handler(saved)),
    onReveal: (handler: (payload: CommentsRevealPayload) => unknown) =>
      // on the web the handler may answer boolean | Promise<boolean>: true = this panel owns the id
      // `last` is always set here (desktop pushes never carry it): the editor shows its S15 line on a miss only then
      frameRevealRouter(client).addEditor((commentId, { last }) =>
        handler({ path: version.current().path ?? '', commentId, last }),
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
): Promise<FrameCommentsApi | null> {
  let session: CommentsSession
  try {
    session = (await client.whenInitialized()) as CommentsSession
  } catch {
    return null
  }
  if (
    !commentsAccess({ capabilities: session.capabilities ?? {}, profile: session.profile }).enabled
  )
    return null
  // the editor serving the anchored comments registers its onReveal owner later: the reveal router
  // waits for it instead of answering revealed:false for an id the editor owns; an editor that ends
  // without a server mode says so through `noEditor` and the wait is released (idempotent)
  const noEditor = frameRevealRouter(client).expectEditor()
  const api: FrameCommentsApi = {
    ...createFrameCommentsApi(client, { session, ...hooks }),
    noEditor,
  }
  target[COMMENTS_BRIDGE_KEY] = api
  return api
}
