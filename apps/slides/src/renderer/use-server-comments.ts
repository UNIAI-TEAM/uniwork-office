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
  useCollabThreads,
  type CollabController,
  type CollabHostState,
} from '@genoffice/ui/collab'
import { createCommentsPoll } from '@genoffice/electron-utils/comments-poll'
import type { UniworkCommentsSeamApi } from './comments-seam'
import {
  createSlideTracker,
  createSlidesAnchorAdapter,
  createSlidesCommentSource,
  pptxAnchorFor,
  sendAnchorsAfterSave,
  slideIdOf,
  type SlideIdentity,
  type SlidesCommentsContext,
} from './server-comments'

export interface ServerCommentsOptions {
  bridge: UniworkCommentsSeamApi
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

  const source = useMemo(() => createSlidesCommentSource(bridge, path), [bridge, path])
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
  const controller = useCollabThreads(source, host, { adapter, strings })
  const ctlRef = useRef(controller)
  ctlRef.current = controller
  const lost = new WeakSet<object>()
  for (const t of [...controller.threads, ...controller.resolved]) {
    if (t.root.anchor && t.root.anchor_state === 'lost') lost.add(t.root.anchor)
  }
  lostRef.current = lost

  // 30 s + focus while visible and open; the kit keeps the list token, the scheduler only times reloads
  const pollRef = useRef<ReturnType<typeof createCommentsPoll> | null>(null)
  useEffect(() => {
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
  }, [source])
  useEffect(() => {
    pollRef.current?.setPanelOpen(open)
  }, [open, source])

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
  // A receipt that lands while the list is not ready waits here (the latest one wins) and runs once it is.
  const pendingRound = useRef<string | null>(null)
  const runRound = useCallback(
    (round: string) => {
      const ctl = ctlRef.current
      const roots = [...ctl.threads, ...ctl.resolved].filter((t) => !t.deleted).map((t) => t.root)
      void sendAnchorsAfterSave(bridge, path, round, roots, slidesRef.current, (id) =>
        tracker.replacedAt(id),
      ).then(
        (res) => {
          if (res.outcome !== 'synced') return
          // the server holds the lost threads now: a reused id can no longer pull them onto its slide
          tracker.settle()
          // contract §2.6: a round that changed rows is followed by a full reload
          if (res.updated.length > 0) void ctlRef.current.reload()
        },
        // offline / server error: the shown anchors stay; the next save sends the map again
        () => undefined,
      )
    },
    [bridge, path, tracker],
  )
  useEffect(
    () =>
      bridge.onSaved((receipt) => {
        if (receipt?.path !== path) return
        if (typeof receipt.versionId !== 'string' || receipt.versionId === '') return
        setVersionId(receipt.versionId)
        if (ctlRef.current.state !== 'ready') {
          pendingRound.current = receipt.versionId
          return
        }
        pendingRound.current = null
        runRound(receipt.versionId)
      }),
    [bridge, path, runRound],
  )
  const ready = controller.state === 'ready'
  useEffect(() => {
    const round = pendingRound.current
    if (!ready || round === null) return
    pendingRound.current = null
    runRound(round)
  }, [ready, runRound])

  const startThread = useCallback((index: number, objectId?: string): boolean => {
    const base = versionRef.current
    const anchor = pptxAnchorFor(slidesRef.current, index, objectId)
    if (!anchor || !base) return false
    ctlRef.current.startThread({ anchor, base_version_id: base })
    return true
  }, [])

  return { controller, versionId, startThread }
}
