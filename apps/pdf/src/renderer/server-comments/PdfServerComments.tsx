/**
 * G8-15 (UNI-1410): the S12 server-comments panel of a bound PDF.
 *
 * `usePdfServerComments` owns the kit controller (`useCollabThreads`) for the
 * whole time the document is in server mode, so a `comments.reveal` and the
 * anchor re-send after a Save work while the panel is closed; it reloads on
 * window focus and every 30 s only while the panel is open and the window is
 * visible (contract §4.7, `comments-poll`). `PdfCommentsPanel` renders the
 * kit's `CollabPanel` with the file's own notes in the read-only "Comments in
 * the file" section.
 *
 * Invariant 7: an AI suggestion only pre-fills a composer (`aiDraft`); nothing
 * here calls `comments.create` before the user presses Send.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  AvatarSourceProvider,
  CollabComposer,
  CollabPanel,
  collabStrings,
  createUniworkCommentsSource,
  loadDraft,
  sendAnchorMap,
  useCollabThreads,
  useFrameAvatarSource,
  type CollabActions,
  type CollabAnchorAdapter,
  type CollabController,
  type CollabHostState,
  type CollabNewThread,
} from '@genoffice/ui/collab'
import { createCommentsPoll } from '@genoffice/electron-utils/comments-poll'
import type { UniworkCommentsApi } from '@genoffice/electron-utils/comments-ipc'
import { createAnchorResend, type AnchorResend } from './anchor-resend'
import { withLayoutShift } from './pdf-adapter'
import {
  fallbackPdfCommentsContext,
  followPdfUniworkSaves,
  loadPdfCommentsContext,
  type PdfCommentsContext,
} from './pdf-comments-context'
import { makePdfAnchor, pointAnchorRect, type PdfAnchor } from './pdf-anchor'

export interface PdfServerCommentsOptions {
  /** `window.uniworkComments` as the preload (or the web frame bridge) exposes it */
  bridge: UniworkCommentsApi
  /** the working copy the editor shows */
  path: string
  lang: Lang
  /** the document is a view-only copy */
  readOnly: boolean
  adapter: CollabAnchorAdapter
  /** the panel is open (polling runs only then) */
  open: boolean
  /** a reveal arrived for this document: the host opens the panel */
  onRevealRequest(): void
}

export interface PdfServerComments {
  controller: CollabController
  context: PdfCommentsContext
  /** a new anchored thread can start: the version it is written against is known */
  canStartThread: boolean
  /** the user may write but the open version is unknown (`versionId` null): ask to save first */
  needsSave: boolean
  /** open the root composer at a point placement (the note tool click), optionally pre-filled by AI */
  startAt(page: number, at: readonly [number, number], aiText?: string): boolean
  /** drop the pending new-thread composer when nothing was typed (no draft text, no AI draft);
      true when it was dropped, false when there was none or it holds text or an AI draft */
  cancelEmptyThread(): boolean
  /** the AI draft of the pending root composer, if any */
  aiDraft: { draftKey: string; text: string } | null
  /** the renderer's save of this document landed: queue the anchor re-send */
  saved(pageMap: ReadonlyMap<number, number>): void
}

/** the composer key `CollabPanel` gives a root thread at `anchor` */
export const rootDraftKey = (anchor: PdfAnchor): string => `root:${JSON.stringify(anchor)}`

export function usePdfServerComments(o: PdfServerCommentsOptions): PdfServerComments {
  const { bridge, path, lang, readOnly, open } = o
  // pages the server's anchors still count in an older layout (a refused anchor send): shown stale
  const [shift, setShift] = useState<ReadonlyMap<number, number> | null>(null)
  const adapter = useMemo(() => withLayoutShift(o.adapter, shift), [o.adapter, shift])
  const [context, setContext] = useState<PdfCommentsContext>(() =>
    fallbackPdfCommentsContext(path, readOnly),
  )
  const [aiDraft, setAiDraft] = useState<{ draftKey: string; text: string } | null>(null)
  const aiDraftRef = useRef(aiDraft)
  aiDraftRef.current = aiDraft

  useEffect(() => {
    let live = true
    setContext(fallbackPdfCommentsContext(path, readOnly))
    void loadPdfCommentsContext(bridge, path, readOnly).then((c) => {
      if (live) setContext(c)
    })
    return () => {
      live = false
    }
  }, [bridge, path, readOnly])

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
  // "View in version N" of a lost thread: the desktop shell opens that version read-only; a bridge
  // without it (the web frame's port) gives the kit no handler, so the action does not show
  const onViewVersion = useMemo(() => {
    const openVersion = bridge.openVersion?.bind(bridge)
    return openVersion
      ? ({ commentId, versionNo }: { commentId: string; versionNo: number }) =>
          openVersion({ path, commentId, versionNo })
      : undefined
  }, [bridge, path])
  const controller = useCollabThreads(source, host, {
    strings,
    adapter,
    openVersionId: context.versionId ?? undefined,
    ...(onViewVersion ? { onViewVersion } : {}),
  })
  const ctlRef = useRef(controller)
  ctlRef.current = controller
  const onRevealRef = useRef(o.onRevealRequest)
  onRevealRef.current = o.onRevealRequest

  // 30 s + focus, only while the window is visible and the panel is open; the kit keeps the token
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
  }, [path])
  useEffect(() => {
    pollRef.current?.setPanelOpen(open)
  }, [open, path])

  // comments.reveal from a launch ticket: only this editor's comment ids; a Discussion post is the shell's
  useEffect(() => {
    return bridge.onReveal((payload) => {
      if (payload.path !== path) return
      const id = payload.commentId
      void (async () => {
        try {
          const discussion = await source.list({ kind: 'discussion' })
          if (discussion.comments.some((c) => c.id === id)) return
        } catch {
          // the comment list answers for itself below
        }
        onRevealRef.current()
        await ctlRef.current.reveal(id).catch(() => undefined)
      })()
    })
  }, [bridge, source, path])

  // the anchor re-send after a Save (contract §2.6): page map from the save, version from the receipt
  const resendRef = useRef<AnchorResend | null>(null)
  useEffect(() => {
    setShift(null)
    const resend = createAnchorResend({
      // a fresh list: with the pane closed nothing else lists after the first one
      roots: async () =>
        (await ctlRef.current.freshComments()).filter((c) => !c.parent_id && !c.deleted_at),
      send: (versionId, items) => sendAnchorMap(source, versionId, items),
      onUpdated: () => void ctlRef.current.reload(),
      onShift: setShift,
    })
    resendRef.current = resend
    const off = followPdfUniworkSaves(bridge, path, (versionId) => {
      // the saved version is what the editor has open now: new threads anchor against it
      setContext((c) => ({ ...c, versionId }))
      resend.receipt(versionId)
    })
    return () => {
      off()
      resend.dispose()
      resendRef.current = null
    }
  }, [bridge, path, source])

  const saved = useCallback((pageMap: ReadonlyMap<number, number>) => {
    resendRef.current?.saved(pageMap)
  }, [])

  const canStartThread =
    controller.state === 'ready' && controller.can.canWrite && context.versionId !== null
  // "save first" only makes sense when a receipt can still arrive: an older preload without the
  // context / saved seam never sends one, so that case keeps the generic unavailable line
  const hasSeam = typeof bridge.context === 'function' && typeof bridge.onSaved === 'function'
  const needsSave =
    hasSeam && controller.state === 'ready' && controller.can.canWrite && context.versionId === null

  const startAt = useCallback(
    (page: number, at: readonly [number, number], aiText?: string): boolean => {
      const c = ctlRef.current
      const versionId = context.versionId
      if (c.state !== 'ready' || !c.can.canWrite || versionId === null) return false
      const anchor = makePdfAnchor(page, pointAnchorRect(at))
      const next: CollabNewThread = { anchor, base_version_id: versionId }
      setAiDraft(aiText ? { draftKey: rootDraftKey(anchor), text: aiText } : null)
      c.startThread(next)
      return true
    },
    [context.versionId],
  )

  const documentIdRef = useRef(context.documentId)
  documentIdRef.current = context.documentId
  const cancelEmptyThread = useCallback((): boolean => {
    const c = ctlRef.current
    if (!c.newThread) return false
    const draftKey = rootDraftKey(c.newThread.anchor as PdfAnchor)
    if (aiDraftRef.current?.draftKey === draftKey) return false
    if (loadDraft({ documentId: documentIdRef.current, threadKey: draftKey })) return false
    c.cancelThread()
    return true
  }, [])

  // the AI label belongs to one pending root composer only
  const pendingKey = controller.newThread
    ? rootDraftKey(controller.newThread.anchor as PdfAnchor)
    : null
  useEffect(() => {
    if (aiDraft && aiDraft.draftKey !== pendingKey) setAiDraft(null)
  }, [aiDraft, pendingKey])

  return {
    controller,
    context,
    canStartThread,
    needsSave,
    startAt,
    cancelEmptyThread,
    aiDraft,
    saved,
  }
}

export interface PdfCommentsPanelProps {
  comments: PdfServerComments
  /** the toggle's `aria-controls` target */
  id?: string
  lang: Lang
  onClose(): void
  /** the control that opened the panel or the composer takes the focus back (Discard, Esc) */
  onFocusOpener?(): void
  /** the file's own notes, read-only */
  inFile?: { count: number; content: ReactNode }
  /** the line under the header while the open version is unknown: save the document first */
  saveFirst?: string
}

export function PdfCommentsPanel(p: PdfCommentsPanelProps) {
  const { comments, lang, onClose } = p
  const strings = useMemo(() => collabStrings(lang), [lang])
  const ai = comments.aiDraft
  const baseCtl = comments.controller
  const baseRef = useRef(baseCtl)
  baseRef.current = baseCtl
  const panelRef = useRef<HTMLDivElement>(null)
  const focusOpenerRef = useRef(p.onFocusOpener)
  focusOpenerRef.current = p.onFocusOpener

  // After Send of a NEW thread the composer unmounts with the focus in it: the focus goes to the
  // panel title at once (the list reloads later), then to the new thread's heading once it is listed.
  const [sent, setSent] = useState<ReadonlySet<string> | null>(null)
  const create: CollabActions['create'] = async (body, np) => {
    const b = baseRef.current
    const before = new Set([...b.threads, ...b.resolved].map((th) => th.id))
    const created = await b.actions.create(body, np)
    if (!np?.anchor) return created
    const active = document.activeElement
    if (!active || active === document.body || panelRef.current?.contains(active)) {
      panelRef.current?.querySelector<HTMLElement>('.collab-title')?.focus()
      setSent(before)
    }
    return created
  }
  // Discard / Cancel of a new thread: the composer takes the focus with it, so it goes back to the opener
  const cancelThread = () => {
    baseRef.current.cancelThread()
    focusOpenerRef.current?.()
  }
  const ctl = { ...baseCtl, cancelThread, actions: { ...baseCtl.actions, create } }

  useEffect(() => {
    if (!sent) return
    const mine = [...baseCtl.threads, ...baseCtl.resolved].find(
      (th) => !sent.has(th.id) && th.root.author_id === baseCtl.host.myUserId,
    )
    const active = document.activeElement
    const free =
      !active ||
      active === document.body ||
      active === panelRef.current?.querySelector('.collab-title')
    if (!mine || !free) return
    const heading = panelRef.current?.querySelector<HTMLElement>(
      `[data-thread-id="${mine.id.replace(/["\\]/g, '\\$&')}"] [data-thread-heading]`,
    )
    if (!heading) return
    heading.focus()
    heading.scrollIntoView?.({ block: 'center' })
    setSent(null)
  }, [sent, baseCtl])
  // a thread that never shows up (someone else's Save raced, a failed reload) stops waiting
  useEffect(() => {
    if (!sent) return
    const timer = window.setTimeout(() => setSent(null), 5000)
    return () => window.clearTimeout(timer)
  }, [sent])

  // Esc: the kit consumes it in a dirty composer, an edit box, a menu and a dialog; an EMPTY
  // new-thread composer lets it fall through. It is dropped (with its page frame) and the panel closes.
  // An unedited AI draft is not dirty to the kit either, but it is not empty: it stays untouched.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return
    if (!baseRef.current.newThread || !(e.target as HTMLElement).closest('.collab-thread--new'))
      return
    if (!comments.cancelEmptyThread()) return
    e.preventDefault()
    e.stopPropagation()
    onClose()
    focusOpenerRef.current?.()
  }

  return (
    <div className="pdf-server-comments" id={p.id} ref={panelRef} onKeyDown={onKeyDown}>
      <CollabPanel
        controller={ctl}
        strings={strings}
        onClose={onClose}
        {...(p.inFile ? { inFile: p.inFile } : {})}
        renderComposer={(slot) => {
          const suggested = ai && slot.draftKey === ai.draftKey ? ai.text : undefined
          return (
            <CollabComposer
              {...slot}
              strings={strings}
              {...(suggested !== undefined ? { initialBody: suggested, aiDraft: true } : {})}
            />
          )
        }}
      />
      {p.saveFirst && <p className="pdf-server-comments-note">{p.saveFirst}</p>}
    </div>
  )
}

export interface PdfServerCommentsHostProps extends Omit<PdfServerCommentsOptions, 'open'> {
  open: boolean
  onClose(): void
  /** App's handle on the live controller: start a thread, report a save */
  apiRef: { current: PdfServerComments | null }
  /** the pending new thread's anchor (null when none): App frames it on the page */
  onPendingAnchor(anchor: PdfAnchor | null): void
  /** the control that opened the panel / the composer (Note tool, Comments button) takes the focus */
  onFocusOpener?(): void
  inFile?: { count: number; content: ReactNode }
  panelId?: string
  /** shown under the panel while the open version is unknown ("save the document first") */
  saveFirstText: string
}

/** mounted for the whole time a bound document is open; the panel itself draws only while `open` */
export function PdfServerCommentsHost(p: PdfServerCommentsHostProps) {
  const {
    apiRef,
    onPendingAnchor,
    onFocusOpener,
    open,
    onClose,
    inFile,
    panelId,
    saveFirstText,
    ...opts
  } = p
  const avatars = useFrameAvatarSource()
  const comments = usePdfServerComments({ ...opts, open })
  apiRef.current = comments
  useEffect(
    () => () => {
      apiRef.current = null
    },
    [apiRef],
  )
  const pending = (comments.controller.newThread?.anchor as PdfAnchor | undefined) ?? null
  const pendingKey = pending ? JSON.stringify(pending) : ''
  const onPendingRef = useRef(onPendingAnchor)
  onPendingRef.current = onPendingAnchor
  useEffect(() => {
    onPendingRef.current(pendingKey ? (JSON.parse(pendingKey) as PdfAnchor) : null)
  }, [pendingKey])
  // closing the panel drops an empty pending composer (and with it the dashed frame on the page);
  // a draft with text stays and comes back with the panel
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current && !open) comments.cancelEmptyThread()
    wasOpen.current = open
  }, [open, comments])
  if (!open) return null
  return (
    <AvatarSourceProvider value={avatars}>
      <PdfCommentsPanel
        comments={comments}
        {...(panelId ? { id: panelId } : {})}
        lang={opts.lang}
        onClose={onClose}
        {...(onFocusOpener ? { onFocusOpener } : {})}
        {...(inFile ? { inFile } : {})}
        {...(comments.needsSave ? { saveFirst: saveFirstText } : {})}
      />
    </AvatarSourceProvider>
  )
}
