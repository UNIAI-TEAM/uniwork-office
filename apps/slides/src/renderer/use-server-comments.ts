/**
 * G8-14: the server-comments controller of a bound presentation. App keeps it mounted for the whole
 * life of a bound document (not only while the pane is open), so the post-save anchor round and a
 * launch-ticket reveal work with the pane closed; the pane only renders it.
 *
 * - poll: focus + 30 s, only while the window is visible and the pane is open (comments-poll.ts);
 * - reveal: the shell's `comments.reveal` push for this path opens the pane, goes to the slide
 *   (+ selects the object) and focuses the thread (the kit holds it until the first list);
 * - save: after the save receipt (`window.uniworkComments.onSaved`, for this path, carrying the new
 *   version) every live anchored thread is re-sent with its slide's new position, or `lost` when the
 *   slide is gone; a version the server rejects keeps the shown anchors and retries at the next Save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  collabStrings,
  createUniworkCommentsSource,
  sendAnchorMap,
  useCollabThreads,
  type CollabController,
  type CollabHostState,
} from '@genoffice/ui/collab'
import { createCommentsPoll } from '@genoffice/electron-utils/comments-poll'
import type { UniworkCommentsApi } from '@genoffice/electron-utils/comments-ipc'
import {
  createSlideTracker,
  createSlidesAnchorAdapter,
  anchorUpdatesAfterSave,
  pptxAnchorFor,
  slideIdOf,
  type SlideIdentity,
  type SlidesCommentsContext,
} from './server-comments'

export interface ServerCommentsOptions {
  bridge: UniworkCommentsApi
  /** the working-copy path every bridge call names */
  path: string
  context: SlidesCommentsContext
  lang: Lang
  slides: readonly SlideIdentity[]
  /** the pane is shown */
  open: boolean
  /** show slide `index`, select the object with that source id */
  goTo(index: number, sourceId?: string): void
  /** a reveal asks for the pane */
  onOpen(): void
}

export interface ServerComments {
  controller: CollabController
  /** the version a new thread is based on; null: unknown, new threads are unavailable */
  versionId: string | null
  /** opens a new thread on slide `index` (+ object); false when the anchor or the version is missing */
  startThread(index: number, objectId?: string): boolean
}

export function useServerComments(o: ServerCommentsOptions): ServerComments {
  const { bridge, path, context, lang, slides, open } = o
  const optsRef = useRef(o)
  optsRef.current = o
  const slidesRef = useRef(slides)
  slidesRef.current = slides
  const [versionId, setVersionId] = useState(context.versionId)
  useEffect(() => setVersionId(context.versionId), [context.versionId])
  const versionRef = useRef(versionId)
  versionRef.current = versionId

  const source = useMemo(() => createUniworkCommentsSource(bridge, path, 'comment'), [bridge, path])
  const platform = useMemo<CollabHostState['platform']>(
    () => (/mac/i.test(navigator.platform) ? 'mac' : 'other'),
    [],
  )
  const host = useMemo<CollabHostState>(
    () => ({
      documentId: context.documentId,
      kind: 'comment',
      level: context.level,
      myUserId: context.myUserId,
      lang,
      platform,
    }),
    [context.documentId, context.level, context.myUserId, lang, platform],
  )
  const strings = useMemo(() => collabStrings(lang), [lang])
  // which slide ids were given to another slide since the last settled round (p:sldId reuse)
  const tracker = useMemo(() => createSlideTracker(), [path])
  tracker.observe(slides)
  // the roots the server holds as lost, by anchor object (the kit hands the adapter that same object)
  const lostRef = useRef(new WeakSet<object>())
  // rebuilt when the slide order changes, so a reorder re-sorts the list (the kit memoises on it)
  const slideOrder = slides.map((s) => slideIdOf(s) ?? '').join('\n')
  const adapter = useMemo(
    () =>
      createSlidesAnchorAdapter({
        slides: () => slidesRef.current,
        isLost: (anchor) => lostRef.current.has(anchor),
        isReplaced: (anchor) => tracker.replacedAt(anchor.slide_id) !== undefined,
        goTo: (index, sourceId) => optsRef.current.goTo(index, sourceId),
      }),
    // the deck is read through the ref; only its order decides a new adapter
    [slideOrder, tracker],
  )
  // "View in version N" of a lost thread: the desktop shell opens that version read-only; the web
  // frame's port has no such method, so the kit gets no handler and the action does not show
  const onViewVersion = useMemo(() => {
    const openVersion = bridge.openVersion?.bind(bridge)
    return openVersion
      ? ({ commentId, versionNo }: { commentId: string; versionNo: number }) =>
          openVersion({ path, commentId, versionNo })
      : undefined
  }, [bridge, path])
  const controller = useCollabThreads(source, host, {
    adapter,
    strings,
    openVersionId: versionId ?? undefined,
    ...(onViewVersion ? { onViewVersion } : {}),
  })
  const ctlRef = useRef(controller)
  ctlRef.current = controller
  const lost = new WeakSet<object>()
  for (const t of [...controller.threads, ...controller.resolved]) {
    // lost stays lost, except in the version it was last anchored on (UNI-2033: the read-only copy
    // of that version), where its anchor still names a real slide
    const here = !!versionId && t.root.anchor_version_id === versionId
    if (t.root.anchor && t.root.anchor_state === 'lost' && !here) lost.add(t.root.anchor)
  }
  lostRef.current = lost

  // 30 s + focus while visible and open; the kit keeps the list token, the scheduler only times reloads
  // (the web frame reloads on its own `comments.changed`: no poll there, as in docs/sheets)
  const pollRef = useRef<ReturnType<typeof createCommentsPoll> | null>(null)
  const inFrame = context.frame === true
  useEffect(() => {
    if (inFrame) return
    const poll = createCommentsPoll({
      fetch: async () => {
        await ctlRef.current.reload()
        return { unchanged: true, listToken: '' }
      },
      onChanged: () => undefined,
    })
    pollRef.current = poll
    poll.setVisible(document.visibilityState === 'visible')
    const onFocus = () => poll.reload()
    const onVisibility = () => poll.setVisible(document.visibilityState === 'visible')
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      poll.dispose()
      pollRef.current = null
    }
  }, [source, inFrame])
  useEffect(() => {
    pollRef.current?.setPanelOpen(open)
  }, [open, source, inFrame])

  // the shell's reveal for this window's document
  useEffect(
    () =>
      bridge.onReveal((payload) => {
        if (payload.path !== path) return
        optsRef.current.onOpen()
        // held by the kit until the first list; a late list rejects not_ready (the pane shows its state)
        void ctlRef.current.reveal(payload.commentId).catch(() => undefined)
      }),
    [bridge, path],
  )

  // after the save receipt: the new version is the base of new threads, and every anchor follows its slide.
  // The map is built from a fresh list (with the pane closed nothing else lists, so a row made since the
  // first list would be missed; a list that is still loading is joined). Rounds are serialized: one in
  // flight, the newest receipt waits as the single pending version and replaces an older one.
  useEffect(() => {
    let disposed = false
    const round: { running: boolean; pending: string | null } = { running: false, pending: null }
    const runRound = async (queued: string) => {
      const comments = await ctlRef.current.freshComments()
      if (disposed) return
      // a receipt that landed while the list was loading supersedes this one
      const versionId = round.pending ?? queued
      round.pending = null
      // what this round covers: a slide replaced while it is in flight is for the next round
      const marks = tracker.snapshot()
      const updates = anchorUpdatesAfterSave(comments, slidesRef.current, (id) =>
        tracker.replacedAt(id),
      )
      try {
        const res = await sendAnchorMap(source, versionId, updates)
        if (res.outcome !== 'synced') return
        // the server holds the lost threads now: a reused id can no longer pull them onto its slide
        tracker.settle(marks)
        // contract §2.6: a round that changed rows is followed by a full reload
        if (res.updated.length > 0) void ctlRef.current.reload()
      } catch {
        // offline / server error: the shown anchors stay; the next save sends the map again
      }
    }
    const drain = async () => {
      round.running = true
      try {
        while (round.pending !== null && !disposed) {
          const queued = round.pending
          round.pending = null
          await runRound(queued)
        }
      } finally {
        round.running = false
      }
    }
    const off = bridge.onSaved((receipt) => {
      if (receipt?.path !== path) return
      if (typeof receipt.versionId !== 'string' || receipt.versionId === '') return
      setVersionId(receipt.versionId)
      round.pending = receipt.versionId
      if (!round.running) void drain()
    })
    return () => {
      disposed = true
      off()
    }
  }, [bridge, path, source, tracker])

  const startThread = useCallback((index: number, objectId?: string): boolean => {
    if (!ctlRef.current.can.canWrite) return false
    const base = versionRef.current
    const anchor = pptxAnchorFor(slidesRef.current, index, objectId)
    if (!anchor || !base) return false
    ctlRef.current.startThread({ anchor, base_version_id: base })
    return true
  }, [])

  return { controller, versionId, startThread }
}
