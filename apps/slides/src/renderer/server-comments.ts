/**
 * G8-14: server comments for a bound UniWork presentation (spine S12, addendum §4.3).
 *
 * Pure adapter between the deck the renderer holds and the shared collab kit (`@genoffice/ui/collab`):
 * - the pptx anchor `{format: 'pptx', v: 1, slide_id, slide_index, object_id?}`; `slide_id` is the
 *   slide's stable identity, so a reorder moves the thread with its slide and a deleted slide makes it
 *   `lost` (the discussion stays);
 * - the `CollabAnchorAdapter` (order by the slide's current position, locate, go to);
 * - the anchor map sent with `comments.anchors` after a save receipt;
 * - the `CollabSource` over `window.uniworkComments` (the preload bridge, envelope unwrapped here).
 *
 * The file's own comments (p:cm) are never touched by this path: server comments are not written into
 * the pptx, so Save leaves the original comment parts byte-identical.
 */
import type {
  CollabAnchor,
  CollabAnchorAdapter,
  CollabComment,
  CollabLevel,
  CollabSource,
} from '@genoffice/ui/collab'
import { unwrapCommentsReply } from '@genoffice/electron-utils/comments-reply'
import {
  COMMENTS_BRIDGE_KEY,
  type CommentsReply,
  type UniworkCommentsApi,
} from '@genoffice/electron-utils/comments-ipc'

/** the slide fields the adapter reads (a `RenderSlide` carries them) */
export interface SlideIdentity {
  /** `p:sldId/@id` when the render tree carries it */
  sldId?: string
  /** `ppt/slides/slideN.xml`: stable across insert / delete / reorder and across Save */
  partPath?: string
  nodes?: ReadonlyArray<{ sourceId: string; durableId?: string }>
}

export interface PptxAnchor extends CollabAnchor {
  format: 'pptx'
  v: 1
  slide_id: string
  slide_index: number
  object_id?: string
}

/** the stable id an anchor names a slide by (undefined: the slide has no identity yet) */
export function slideIdOf(slide: SlideIdentity | undefined): string | undefined {
  if (!slide) return undefined
  if (typeof slide.sldId === 'string' && slide.sldId !== '') return slide.sldId
  if (typeof slide.partPath === 'string' && slide.partPath !== '') return slide.partPath
  return undefined
}

export function isPptxAnchor(a: unknown): a is PptxAnchor {
  if (!a || typeof a !== 'object') return false
  const x = a as Record<string, unknown>
  return (
    x.format === 'pptx' &&
    typeof x.slide_id === 'string' &&
    x.slide_id !== '' &&
    typeof x.slide_index === 'number' &&
    Number.isInteger(x.slide_index) &&
    x.slide_index >= 0
  )
}

/** the anchor of slide `index` (and of one object on it, by its durable id); null without identity */
export function pptxAnchorFor(
  slides: readonly SlideIdentity[],
  index: number,
  objectId?: string,
): PptxAnchor | null {
  const slideId = slideIdOf(slides[index])
  if (slideId === undefined) return null
  return {
    format: 'pptx',
    v: 1,
    slide_id: slideId,
    slide_index: index,
    ...(objectId ? { object_id: objectId } : {}),
  }
}

/** the slide's current position, -1 when the deck no longer has it */
export function slidePositionOf(slides: readonly SlideIdentity[], anchor: PptxAnchor): number {
  return slides.findIndex((s) => slideIdOf(s) === anchor.slide_id)
}

/** the durable id of the one selected object, when exactly one is selected and it has one */
export function selectedObjectId(
  slide: SlideIdentity | undefined,
  selectedSourceIds: readonly string[],
): string | undefined {
  if (!slide?.nodes || selectedSourceIds.length !== 1) return undefined
  return slide.nodes.find((n) => n.sourceId === selectedSourceIds[0])?.durableId || undefined
}

export interface SlidesAnchorNav {
  /** the deck as the renderer holds it now */
  slides(): readonly SlideIdentity[]
  /** show slide `index`; select the object with this source id when given */
  goTo(index: number, sourceId?: string): void
}

/**
 * The kit's anchor adapter: order = the slide's current position (a reorder re-sorts the list),
 * located = the deck still has that slide, goTo = that slide (+ the object when it still exists).
 * Pass a stable object to the kit: build it once per deck view (`useMemo`).
 */
export function createSlidesAnchorAdapter(nav: SlidesAnchorNav): CollabAnchorAdapter {
  return {
    order(anchor) {
      if (!isPptxAnchor(anchor)) return Number.MAX_SAFE_INTEGER
      const at = slidePositionOf(nav.slides(), anchor)
      return at >= 0 ? at : anchor.slide_index
    },
    locate(anchor) {
      return isPptxAnchor(anchor) && slidePositionOf(nav.slides(), anchor) >= 0
    },
    goTo(anchor) {
      if (!isPptxAnchor(anchor)) return
      const slides = nav.slides()
      const at = slidePositionOf(slides, anchor)
      if (at < 0) return
      const node = anchor.object_id
        ? slides[at]?.nodes?.find((n) => n.durableId === anchor.object_id)
        : undefined
      nav.goTo(at, node?.sourceId)
    },
  }
}

export interface AnchorUpdate {
  commentId: string
  anchor: PptxAnchor
  state: 'exact' | 'lost'
}

/**
 * The `comments.anchors` round after a save: every live root comment with a pptx anchor gets its
 * slide's new position (`exact`), or keeps its old anchor as `lost` when the slide is gone.
 * Replies, discussion posts and tombstones carry no anchor of their own and are skipped.
 */
export function anchorUpdatesAfterSave(
  comments: readonly CollabComment[],
  slides: readonly SlideIdentity[],
): AnchorUpdate[] {
  const out: AnchorUpdate[] = []
  for (const c of comments) {
    if (c.parent_id || c.deleted_at || (c.kind !== undefined && c.kind !== 'comment')) continue
    const anchor = c.anchor
    if (!isPptxAnchor(anchor)) continue
    const at = slidePositionOf(slides, anchor)
    if (at < 0) {
      out.push({ commentId: c.id, anchor, state: 'lost' })
      continue
    }
    const next: PptxAnchor = { ...anchor, slide_index: at }
    // an object deleted from a live slide: the thread stays on the slide, without the object
    if (next.object_id && !slides[at]?.nodes?.some((n) => n.durableId === next.object_id)) {
      delete next.object_id
    }
    out.push({ commentId: c.id, anchor: next, state: 'exact' })
  }
  return out
}

/* ---- the host side: bridge, document context ---- */

/** the typed accessor: null when this build's preload has no bridge (local file behaviour then) */
export function commentsBridge(): UniworkCommentsApi | null {
  const w = window as unknown as Record<string, UniworkCommentsApi | undefined>
  return w[COMMENTS_BRIDGE_KEY] ?? null
}

/**
 * Server mode needs a bound working copy AND the shell's bridge; anything else (a local file, a
 * signed-out / standalone build) keeps the local pane and its p:cm behaviour unchanged.
 */
export function wantsServerComments(
  path: string | null | undefined,
  bound: boolean,
  bridge: UniworkCommentsApi | null,
): boolean {
  return !!path && bound && bridge !== null
}

/**
 * What the editor needs to know about a bound document. The fields beyond `documentId` come from the
 * shell: `versionId` is the version the editor has open (or just saved) and is required to start a
 * new anchored thread (`base_version_id`); `userId` lets the panel recognise "mine"; `level` is the
 * caller's document level.
 */
export interface SlidesCommentsContext {
  documentId: string
  versionId?: string
  userId?: string
  level?: CollabLevel
}

/**
 * The optional preload surface the shell provides for this (contract; absent in builds whose main
 * process does not serve it yet). `onUniworkSaved` fires after the commit receipt of a Save.
 */
export interface SlidesCommentsContextApi {
  uniworkCommentsContext?(): Promise<SlidesCommentsContext | null>
  onUniworkSaved?(handler: (receipt: { versionId: string }) => void): () => void
}

/**
 * The context for a bound `path`. Without the shell's context call the editor falls back to what
 * it does know: the path as the key, `view` for a read-only copy, `edit` otherwise, no version and
 * no user id (new threads and own-comment edits stay unavailable, everything else works).
 */
export async function loadCommentsContext(
  api: SlidesCommentsContextApi | undefined,
  path: string,
  readOnly: boolean,
): Promise<SlidesCommentsContext> {
  const fallback: SlidesCommentsContext = {
    documentId: path,
    level: readOnly ? 'view' : 'edit',
  }
  const ctx = await Promise.resolve(api?.uniworkCommentsContext?.()).then(
    (c) => c ?? null,
    () => null,
  )
  if (!ctx || typeof ctx.documentId !== 'string' || ctx.documentId === '') return fallback
  return {
    documentId: ctx.documentId,
    ...(typeof ctx.versionId === 'string' && ctx.versionId !== ''
      ? { versionId: ctx.versionId }
      : {}),
    ...(typeof ctx.userId === 'string' && ctx.userId !== '' ? { userId: ctx.userId } : {}),
    // a read-only copy never writes, whatever the context says
    level: readOnly ? 'view' : (ctx.level ?? 'edit'),
  }
}

/**
 * The kit's `CollabSource` over the bridge for the comment kind (snake_case kit <-> camelCase IPC).
 * Each call unwraps the envelope in this realm, so a failure rejects with the protocol error
 * (`code`, `details.code`, `retryable`) the kit maps to panel states.
 */
export function createSlidesCommentSource(bridge: UniworkCommentsApi, path: string): CollabSource {
  const value = <T>(reply: Promise<CommentsReply<T>>): Promise<T> =>
    reply.then((r) => unwrapCommentsReply(r))
  return {
    list: (p) =>
      value(
        bridge.list({
          path,
          kind: p.kind ?? 'comment',
          ...(p.since_token ? { sinceToken: p.since_token } : {}),
        }),
      ),
    create: (p) =>
      value(
        bridge.create({
          path,
          kind: p.kind,
          body: p.body,
          ...(p.parent_id ? { parentId: p.parent_id } : {}),
          ...(p.anchor ? { anchor: p.anchor } : {}),
          ...(p.base_version_id ? { baseVersionId: p.base_version_id } : {}),
        }),
      ),
    update: (p) => value(bridge.update({ path, commentId: p.comment_id, body: p.body })),
    remove: (p) => value(bridge.remove({ path, commentId: p.comment_id })),
    resolve: (p) => value(bridge.resolve({ path, commentId: p.comment_id })),
    reopen: (p) => value(bridge.reopen({ path, commentId: p.comment_id })),
    revisions: (p) => value(bridge.revisions({ path, commentId: p.comment_id })),
    searchMentions: (p) =>
      value(
        bridge.searchMentions({
          path,
          q: p.q,
          ...(p.limit !== undefined ? { limit: p.limit } : {}),
        }),
      ),
  }
}

/**
 * Sends the post-save anchor round (contract §2.6): only after the save receipt, with the receipt's
 * version. Returns true when the server changed rows (the caller then reloads the full list).
 * An empty round sends nothing.
 */
export async function sendAnchorsAfterSave(
  bridge: UniworkCommentsApi,
  path: string,
  versionId: string,
  comments: readonly CollabComment[],
  slides: readonly SlideIdentity[],
): Promise<boolean> {
  const anchors = anchorUpdatesAfterSave(comments, slides)
  if (anchors.length === 0) return false
  // the IPC caps one round at 500 anchors; send in slices so a large deck keeps every thread
  let changed = false
  for (let i = 0; i < anchors.length; i += 500) {
    const res = unwrapCommentsReply(
      await bridge.anchors({
        path,
        versionId,
        anchors: anchors.slice(i, i + 500).map((a) => ({ ...a, anchor: { ...a.anchor } })),
      }),
    )
    if (res.updated.length > 0) changed = true
  }
  return changed
}
