/**
 * G8-14: server comments for a bound UniWork presentation (spine S12, addendum §4.3).
 *
 * Pure adapter between the deck the renderer holds and the shared collab kit (`@genoffice/ui/collab`):
 * - the pptx anchor `{format: 'pptx', v: 1, slide_id, slide_index, object_id?}`; `slide_id` is the
 *   slide's stable identity, so a reorder moves the thread with its slide and a deleted slide makes it
 *   `lost` (the discussion stays);
 * - the `CollabAnchorAdapter` (order by the slide's current position, locate, go to);
 * - the anchor map sent with `comments.anchors` after a save receipt (chunks of 500, merged);
 * - the `CollabSource` over `window.uniworkComments` (the preload bridge, envelope unwrapped here);
 * - the document context: `window.uniworkComments.context({path})` (G8-12 seam, see ./comments-seam).
 *
 * The file's own comments (p:cm) are never touched by this path: server comments are not written into
 * the pptx, so Save leaves the original comment parts byte-identical.
 */
import type {
  CollabAnchor,
  CollabAnchorAdapter,
  CollabAnchorUpdate,
  CollabComment,
} from '@genoffice/ui/collab'
import {
  COMMENTS_BRIDGE_KEY,
  type CommentsContextResult,
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

/** what a slide looked like when last seen: a slide that comes back unchanged (undo) is the same slide */
function signatureOf(slide: SlideIdentity): string {
  const nodes = (slide.nodes ?? []).map((n) => `${n.sourceId}~${n.durableId ?? ''}`)
  return `${slide.partPath ?? ''}|${nodes.join(',')}`
}

/**
 * Per open session: which slide ids were handed to a different slide since the last settled round.
 * `nextSlideId` is max(current ids)+1, so deleting the last slide and adding another gives the new
 * slide the old id (and the same part name); the id alone cannot tell them apart. The tracker watches
 * the deck: an id that left and comes back unchanged (undo / redo) is the same slide, an id that
 * comes back as something else is a different slide, and a thread anchored to the old one must not
 * follow it (contract-collab: lost stays lost).
 */
export interface SlideTracker {
  /** feed the deck as shown now (idempotent for the same deck) */
  observe(slides: readonly SlideIdentity[]): void
  /** when (ms) the id was first given to another slide since the last settle; undefined: not reused */
  replacedAt(slideId: string): number | undefined
  /** the marks as they stand now: a round settles exactly these, not what lands while it is in flight */
  snapshot(): SlideTrackerMarks
  /** a round reached the server: the old threads are lost there now, forget the reuse marks it covered */
  settle(marks?: SlideTrackerMarks): void
}

export interface SlideTrackerMarks {
  replaced: readonly string[]
  gone: readonly string[]
}

export function createSlideTracker(now: () => number = Date.now): SlideTracker {
  let last = new Map<string, string>()
  const gone = new Map<string, string>()
  const replaced = new Map<string, number>()
  return {
    observe(slides) {
      const cur = new Map<string, string>()
      for (const s of slides) {
        const id = slideIdOf(s)
        if (id !== undefined) cur.set(id, signatureOf(s))
      }
      for (const [id, sig] of last) if (!cur.has(id)) gone.set(id, sig)
      for (const [id, sig] of cur) {
        const was = gone.get(id)
        if (was === undefined) continue
        gone.delete(id)
        if (was !== sig && !replaced.has(id)) replaced.set(id, now())
      }
      last = cur
    },
    replacedAt: (slideId) => replaced.get(slideId),
    snapshot: () => ({ replaced: [...replaced.keys()], gone: [...gone.keys()] }),
    settle(marks) {
      if (!marks) {
        gone.clear()
        replaced.clear()
        return
      }
      for (const id of marks.gone) gone.delete(id)
      for (const id of marks.replaced) replaced.delete(id)
    },
  }
}

export interface SlidesAnchorNav {
  /** the deck as the renderer holds it now */
  slides(): readonly SlideIdentity[]
  /** true when the thread of this anchor object is `lost` on the server: it never follows a slide */
  isLost?(anchor: CollabAnchor): boolean
  /** true when the anchor's slide id now names a different slide (id reuse before Save) */
  isReplaced?(anchor: PptxAnchor): boolean
  /** show slide `index`; select the object with this source id when given */
  goTo(index: number, sourceId?: string): void
}

/**
 * The kit's anchor adapter: order = the slide's current position (a reorder re-sorts the list),
 * located = the deck still has that slide, goTo = that slide (+ the object when it still exists).
 * Pass a stable object to the kit: build it once per deck view (`useMemo`).
 */
export function createSlidesAnchorAdapter(nav: SlidesAnchorNav): CollabAnchorAdapter {
  // a lost thread, or one whose slide id now names another slide, is not on any slide of the deck
  const locatedAt = (anchor: PptxAnchor): number =>
    nav.isLost?.(anchor) || nav.isReplaced?.(anchor) ? -1 : slidePositionOf(nav.slides(), anchor)
  return {
    order(anchor) {
      if (!isPptxAnchor(anchor)) return Number.MAX_SAFE_INTEGER
      const at = locatedAt(anchor)
      return at >= 0 ? at : anchor.slide_index
    },
    locate(anchor) {
      return isPptxAnchor(anchor) && locatedAt(anchor) >= 0
    },
    goTo(anchor) {
      if (!isPptxAnchor(anchor)) return
      const slides = nav.slides()
      const at = locatedAt(anchor)
      if (at < 0) return
      const node = anchor.object_id
        ? slides[at]?.nodes?.find((n) => n.durableId === anchor.object_id)
        : undefined
      nav.goTo(at, node?.sourceId)
    },
  }
}

/**
 * The `comments.anchors` round after a save: every live root comment with a pptx anchor gets its
 * slide's new position (`exact`), or keeps its old anchor as `lost` when the slide is gone (or its
 * id was reused by another slide: `replacedAt`, for roots created before the reuse).
 * A root the server already holds as `lost` is skipped: lost stays lost (contract-collab), so it
 * can never re-bind to a new slide that reuses the p:sldId; the server keeps its old anchor.
 * Replies, discussion posts and tombstones carry no anchor of their own and are skipped.
 */
export function anchorUpdatesAfterSave(
  comments: readonly CollabComment[],
  slides: readonly SlideIdentity[],
  replacedAt?: (slideId: string) => number | undefined,
): CollabAnchorUpdate[] {
  const out: CollabAnchorUpdate[] = []
  for (const c of comments) {
    if (c.parent_id || c.deleted_at || (c.kind !== undefined && c.kind !== 'comment')) continue
    const anchor = c.anchor
    if (!isPptxAnchor(anchor)) continue
    if (c.anchor_state === 'lost') continue
    const since = replacedAt?.(anchor.slide_id)
    const created = c.created_at ? Date.parse(c.created_at) : Number.NaN
    // a thread older than the id's reuse belongs to the slide that is gone; a newer one to the new slide
    const reused = since !== undefined && !(created >= since)
    const at = reused ? -1 : slidePositionOf(slides, anchor)
    if (at < 0) {
      out.push({ comment_id: c.id, anchor, state: 'lost' })
      continue
    }
    const next: PptxAnchor = { ...anchor, slide_index: at }
    // an object deleted from a live slide: the thread stays on the slide, without the object
    if (next.object_id && !slides[at]?.nodes?.some((n) => n.durableId === next.object_id)) {
      delete next.object_id
    }
    out.push({ comment_id: c.id, anchor: next, state: 'exact' })
  }
  return out
}

/* ---- the host side: bridge, document context ---- */

/**
 * The typed accessor: null when this build's preload has no bridge, or a shell that does not serve
 * the G8-12 context / saved calls (local file behaviour then).
 */
export function commentsBridge(): UniworkCommentsApi | null {
  const w = window as unknown as Record<string, Partial<UniworkCommentsApi> | undefined>
  const api = w[COMMENTS_BRIDGE_KEY]
  if (!api || typeof api.context !== 'function' || typeof api.onSaved !== 'function') return null
  return api as UniworkCommentsApi
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
 * What the editor knows about a bound document: the seam's `CommentsContextResult`. `versionId` is
 * the version the editor has open (or just saved); null = unknown, so no new anchored thread can
 * start (`base_version_id`). `myUserId` lets the panel recognise "mine"; `level` undefined = the
 * own-comments-only rule.
 */
export type SlidesCommentsContext = CommentsContextResult

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 128
}

/**
 * The context of the bound `path`, or null when the shell gives none (an error envelope such as an
 * unbound copy's `not_found`, a failed call, a malformed answer): no server context, local pane.
 * A read-only copy never writes, whatever the context says.
 */
export async function loadCommentsContext(
  bridge: Pick<UniworkCommentsApi, 'context'>,
  path: string,
  readOnly: boolean,
): Promise<SlidesCommentsContext | null> {
  let value: unknown
  try {
    const reply = await bridge.context({ path })
    value = reply && reply.ok ? reply.value : null
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!isId(v.documentId)) return null
  if (v.versionId !== null && !isId(v.versionId)) return null
  const level =
    v.level === 'view' || v.level === 'edit' || v.level === 'manage' ? v.level : undefined
  return {
    documentId: v.documentId,
    versionId: v.versionId,
    ...(readOnly ? { level: 'view' as const } : level ? { level } : {}),
    ...(isId(v.myUserId) ? { myUserId: v.myUserId } : {}),
  }
}
