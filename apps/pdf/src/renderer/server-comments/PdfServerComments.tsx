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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  CollabComposer,
  CollabPanel,
  collabStrings,
  useCollabThreads,
  type CollabAnchorAdapter,
  type CollabController,
  type CollabHostState,
  type CollabNewThread,
} from '@genoffice/ui/collab'
import { createCommentsPoll } from '@genoffice/electron-utils/comments-poll'
import { createAnchorResend, type AnchorResend } from './anchor-resend'
import {
  createPdfCommentsSource,
  fallbackPdfCommentsContext,
  followPdfUniworkSaves,
  loadPdfCommentsContext,
  sendPdfAnchorMap,
  type PdfCommentsBridge,
  type PdfCommentsContext,
} from './pdf-comments-source'
import { makePdfAnchor, pointAnchorRect, type PdfAnchor } from './pdf-anchor'

export interface PdfServerCommentsOptions {
  bridge: PdfCommentsBridge
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
  /** the AI draft of the pending root composer, if any */
  aiDraft: { draftKey: string; text: string } | null
  /** the renderer's save of this document landed: queue the anchor re-send */
  saved(pageMap: ReadonlyMap<number, number>): void
}

/** the composer key `CollabPanel` gives a root thread at `anchor` */
export const rootDraftKey = (anchor: PdfAnchor): string => `root:${JSON.stringify(anchor)}`

export function usePdfServerComments(o: PdfServerCommentsOptions): PdfServerComments {
  const { bridge, path, lang, readOnly, adapter, open } = o
  const [context, setContext] = useState<PdfCommentsContext>(() =>
    fallbackPdfCommentsContext(path, readOnly),
  )
  const [aiDraft, setAiDraft] = useState<{ draftKey: string; text: string } | null>(null)

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

  const source = useMemo(() => createPdfCommentsSource(bridge, path), [bridge, path])
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
  const controller = useCollabThreads(source, host, { strings, adapter })
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
    const resend = createAnchorResend({
      roots: () => {
        const c = ctlRef.current
        return [...c.threads, ...c.resolved].map((t) => t.root)
      },
      send: (versionId, items) => sendPdfAnchorMap(bridge, path, versionId, items),
      onUpdated: () => void ctlRef.current.reload(),
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
  }, [bridge, path])

  const saved = useCallback((pageMap: ReadonlyMap<number, number>) => {
    resendRef.current?.saved(pageMap)
  }, [])

  const canStartThread =
    controller.state === 'ready' && controller.can.canWrite && context.versionId !== null
  const needsSave =
    controller.state === 'ready' && controller.can.canWrite && context.versionId === null

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

  // the AI label belongs to one pending root composer only
  const pendingKey = controller.newThread
    ? rootDraftKey(controller.newThread.anchor as PdfAnchor)
    : null
  useEffect(() => {
    if (aiDraft && aiDraft.draftKey !== pendingKey) setAiDraft(null)
  }, [aiDraft, pendingKey])

  return { controller, context, canStartThread, needsSave, startAt, aiDraft, saved }
}

export interface PdfCommentsPanelProps {
  comments: PdfServerComments
  /** the toggle's `aria-controls` target */
  id?: string
  lang: Lang
  onClose(): void
  /** the file's own notes, read-only */
  inFile?: { count: number; content: ReactNode }
  /** the line under the header while the open version is unknown: save the document first */
  saveFirst?: string
}

export function PdfCommentsPanel(p: PdfCommentsPanelProps) {
  const { comments, lang } = p
  const strings = useMemo(() => collabStrings(lang), [lang])
  const ai = comments.aiDraft
  return (
    <div className="pdf-server-comments" id={p.id}>
      <CollabPanel
        controller={comments.controller}
        strings={strings}
        onClose={p.onClose}
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
  inFile?: { count: number; content: ReactNode }
  panelId?: string
  /** shown under the panel while the open version is unknown ("save the document first") */
  saveFirstText: string
}

/** mounted for the whole time a bound document is open; the panel itself draws only while `open` */
export function PdfServerCommentsHost(p: PdfServerCommentsHostProps) {
  const { apiRef, onPendingAnchor, open, onClose, inFile, panelId, saveFirstText, ...opts } = p
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
  if (!open) return null
  return (
    <PdfCommentsPanel
      comments={comments}
      {...(panelId ? { id: panelId } : {})}
      lang={opts.lang}
      onClose={onClose}
      {...(inFile ? { inFile } : {})}
      {...(comments.needsSave ? { saveFirst: saveFirstText } : {})}
    />
  )
}
