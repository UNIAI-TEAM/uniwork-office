/**
 * G8-12 (UNI-1407): the Docs comment panel in server mode (spine S12), built from the G8-20 kit.
 *
 * Mounted for the whole time a document is in server mode (not only while the panel shows): it owns
 * the kit controller, so the in-document highlights, the post-Save anchor map and `comments.reveal`
 * keep working with the panel closed. Threads come from `comments.*` (`kind = comment`) through
 * `window.uniworkComments`; a new root carries the selection's docx anchor + `base_version_id`.
 * Comments stored in the file are listed read-only in the kit's "in the file" slot (lane decision D4)
 * and never rewritten; server comments never touch the `comment` mark or `commentsDirty` (D3).
 * AI comment tools only fill composer drafts here (invariant 7, D5): no `comments.*` write.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { CommentInfo } from '@genoffice/docx-engine'
import type { Lang } from '@genoffice/i18n'
import {
  COMMENTS_REVEAL_WAIT_MS,
  CollabComposer,
  CollabPanel,
  collabStrings,
  formatCollabTime,
  useCollabThreads,
  type CollabComposerSlot,
  type CollabController,
  type CollabHostState,
  type CollabThreadView,
  announcePolite,
} from '@genoffice/ui/collab'
import '@genoffice/ui/collab.css'
import { createCommentsPoll } from '@genoffice/electron-utils/comments-poll'
import { displayCommentAuthor } from '../comment-author'
import { wordRangeAtCaret } from '../editor/comments'
import { pendingCommentPluginKey } from '../editor/decoration-extensions'
import type { DocxCodecOptions, PmRange } from './anchor-codec'
import { buildAnchorUpdates, syncAnchorsAfterSave } from './anchor-sync'
import { createServerAnchors, type ServerAnchors, type TrackedRoot } from './anchor-tracker'
import type { ServerMode } from './mode'
import { createUniworkCommentsSource } from './seam'

/** what the AI comment tools may do on a bound document: read, and fill drafts (never write) */
export interface ServerAiAccess {
  /** a server comment id (root or reply) */
  owns(id: string): boolean
  /** the server threads as comment infos (roots + replies), for read_comments */
  list(): CommentInfo[]
  /** a reply draft under the thread of `id`; false when the thread is gone */
  draftReply(id: string, text: string): boolean
  /** a new root draft anchored at `range`; false when the range holds no text */
  draftNew(range: PmRange, text: string): boolean
}

/** what App reaches through the handle ref while the host is mounted */
export interface ServerCommentsHandle {
  /** the editor's "Comment" command in server mode: open a root composer for the selection */
  startThread(): void
  ai: ServerAiAccess
}

/** web frame: the editor and the Discussion panel share one side column (lane contract §3.5) */
const FRAME_SIDE_PANEL_EVENT = 'uniwork:frame-side-panel'
const SIDE_PANEL_OWNER = 'editor'

export interface ServerCommentsHostProps {
  mode: ServerMode
  editor: Editor
  lang: Lang
  /** the panel is shown (the kit panel renders only then; the controller lives on) */
  panelOpen: boolean
  onOpenPanel(): void
  onClosePanel(): void
  /** one-line status for "select text first" */
  onStatus(text: string): void
  /** the translated "select the text to comment on first" line */
  selectTextMessage: string
  /** the translated "save first" line: no new root while the open version is unknown */
  saveFirstMessage: string
  /** comments stored in the file (shown read-only) */
  inFileComments: readonly CommentInfo[]
  /** the UI-language label of the neutral stored author "User" */
  neutralAuthor: string
  handleRef: { current: ServerCommentsHandle | null }
  codec?: DocxCodecOptions
}

function rootsOf(ctl: CollabController): TrackedRoot[] {
  return [...ctl.threads, ...ctl.resolved].map((t) => ({
    id: t.id,
    anchor: t.root.anchor,
    anchor_state: t.root.anchor_state,
    resolved: t.resolved,
    deleted: t.deleted,
  }))
}

function threadOf(ctl: CollabController, id: string): CollabThreadView | undefined {
  return [...ctl.threads, ...ctl.resolved].find(
    (t) => t.id === id || t.replies.some((r) => r.id === id),
  )
}

function InFileList(p: {
  comments: readonly CommentInfo[]
  neutralAuthor: string
  lang: Lang
  resolvedLabel: string
}) {
  const roots = p.comments.filter((c) => !c.parentId)
  const row = (c: CommentInfo, reply: boolean) => (
    <div key={c.id} className={reply ? 'collab-cm collab-cm--reply' : 'collab-cm'}>
      <div className="collab-cmh">
        <span className="collab-au">{displayCommentAuthor(c.author, p.neutralAuthor)}</span>
        {!reply && c.done && <span className="collab-badge">{p.resolvedLabel}</span>}
        <span className="collab-dt">{formatCollabTime(c.date, p.lang)}</span>
      </div>
      <div className="collab-bd">{c.text}</div>
    </div>
  )
  return (
    <ul role="list" className="collab-list">
      {roots.map((root) => (
        <li key={root.id} role="listitem" className="collab-thread">
          {row(root, false)}
          {p.comments.filter((c) => c.parentId === root.id).map((c) => row(c, true))}
        </li>
      ))}
    </ul>
  )
}

export function ServerCommentsHost(p: ServerCommentsHostProps) {
  const { mode, editor, lang, panelOpen } = p
  const source = useMemo(
    () => createUniworkCommentsSource(mode.api, mode.path, 'comment'),
    [mode.api, mode.path],
  )
  const platform = useMemo<CollabHostState['platform']>(
    () => (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? 'mac' : 'other'),
    [],
  )
  const host = useMemo<CollabHostState>(
    () => ({
      documentId: mode.documentId,
      kind: 'comment',
      level: mode.level,
      myUserId: mode.myUserId,
      lang,
      platform,
    }),
    [mode.documentId, mode.level, mode.myUserId, lang, platform],
  )
  const strings = useMemo(() => collabStrings(lang), [lang])

  // the anchor tracker lives as long as this document's server mode on this editor
  const [anchors, setAnchors] = useState<ServerAnchors | null>(null)
  const [adapterSeq, setAdapterSeq] = useState(0)
  const codecRef = useRef(p.codec)
  codecRef.current = p.codec
  useEffect(() => {
    const a = createServerAnchors(editor, {
      paraIdOf: (node) => codecRef.current?.paraIdOf?.(node),
      onAdapterChange: () => setAdapterSeq((n) => n + 1),
    })
    setAnchors(a)
    return () => {
      a.dispose()
      setAnchors(null)
    }
  }, [editor])
  // a new adapter object only when the located / lost set changed (kit: pass a stable adapter)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const adapter = useMemo(() => anchors?.adapter(), [anchors, adapterSeq])

  const ctl = useCollabThreads(source, host, { adapter, strings })
  const ctlRef = useRef(ctl)
  ctlRef.current = ctl

  // the latest server roots feed the tracker (new ids located once; known ids keep their live range)
  useEffect(() => {
    anchors?.syncThreads(rootsOf(ctl))
  }, [anchors, ctl.threads, ctl.resolved]) // eslint-disable-line react-hooks/exhaustive-deps

  // base_version_id of a new root: the version open at load, then the last Save receipt
  const versionRef = useRef<string | null>(mode.versionId)
  // mirrored in state so the "save first" line appears and goes away with it
  const [knownVersion, setKnownVersion] = useState<string | null>(mode.versionId)
  useEffect(() => {
    versionRef.current = mode.versionId
    setKnownVersion(mode.versionId)
  }, [mode.versionId])

  // after each Save receipt: one anchor map for every located (or lost) root
  const anchorsRef = useRef(anchors)
  anchorsRef.current = anchors
  useEffect(() => {
    return mode.api.onSaved((payload) => {
      if (payload.path && mode.path && payload.path !== mode.path) return
      versionRef.current = payload.versionId
      setKnownVersion(payload.versionId)
      const a = anchorsRef.current
      if (!a) return
      const updates = buildAnchorUpdates(a, rootsOf(ctlRef.current))
      void syncAnchorsAfterSave(source, payload.versionId, updates, () => {
        void ctlRef.current.reload()
      }).catch(() => {
        // a failed map is rebuilt from the live ranges at the next Save receipt
      })
    })
  }, [mode.api, mode.path, source])

  // desktop reload rule (addendum §4.7): focus + every 30 s while the panel is open and the tab visible
  // (the web frame reloads on `comments.changed` itself: no poll there)
  const pollRef = useRef<ReturnType<typeof createCommentsPoll> | null>(null)
  const inFrame = mode.frame === true
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
  }, [inFrame])
  useEffect(() => {
    pollRef.current?.setPanelOpen(panelOpen)
  }, [panelOpen, inFrame])

  // reveal: wait for the first list, then answer only for ids this panel owns
  const waitersRef = useRef<Array<(ok: boolean) => void>>([])
  useEffect(() => {
    if (ctl.state === 'loading') return
    const ok = ctl.state === 'ready'
    const waiters = waitersRef.current
    waitersRef.current = []
    for (const w of waiters) w(ok)
  }, [ctl.state])
  const loaded = useCallback((): Promise<boolean> => {
    const state = ctlRef.current.state
    if (state !== 'loading') return Promise.resolve(state === 'ready')
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waitersRef.current = waitersRef.current.filter((w) => w !== done)
        resolve(false)
      }, COMMENTS_REVEAL_WAIT_MS)
      const done = (ok: boolean) => {
        clearTimeout(timer)
        resolve(ok)
      }
      waitersRef.current.push(done)
    })
  }, [])
  const openRef = useRef(p.onOpenPanel)
  openRef.current = p.onOpenPanel
  useEffect(() => {
    return mode.api.onReveal(async ({ path, commentId, last }) => {
      // `last` is set by the web frame router only (it ignores paths); desktop never sets it
      const frame = last !== undefined
      if (!frame && path && mode.path && path !== mode.path) return false
      if (!(await loaded())) {
        // the frame router maps the typed error; the desktop preload ignores our return value
        if (frame) throw { code: 'not_ready', retryable: true }
        return false
      }
      if (!threadOf(ctlRef.current, commentId)) {
        // a miss is real only when no other owner is asked after this editor: show the S15 line
        if (last !== true) return false
        openRef.current()
        await ctlRef.current.reveal(commentId)
        return false
      }
      openRef.current()
      const r = await ctlRef.current.reveal(commentId)
      return r.revealed
    })
  }, [mode.api, mode.path, loaded])

  // one side panel at a time: announce open / close, close when another owner opens (harmless on desktop)
  const panelOpenRef = useRef(panelOpen)
  panelOpenRef.current = panelOpen
  const closeRef = useRef(p.onClosePanel)
  closeRef.current = p.onClosePanel
  const announcedRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (announcedRef.current === null && !panelOpen) return
    if (announcedRef.current === panelOpen) return
    announcedRef.current = panelOpen
    window.dispatchEvent(
      new CustomEvent(FRAME_SIDE_PANEL_EVENT, {
        detail: { owner: SIDE_PANEL_OWNER, open: panelOpen },
      }),
    )
  }, [panelOpen])
  useEffect(() => {
    const onOther = (event: Event) => {
      const detail = (event as CustomEvent<{ owner?: unknown; open?: unknown } | null>).detail
      if (detail?.open === true && detail.owner !== SIDE_PANEL_OWNER && panelOpenRef.current) {
        closeRef.current()
      }
    }
    window.addEventListener(FRAME_SIDE_PANEL_EVENT, onOther)
    return () => window.removeEventListener(FRAME_SIDE_PANEL_EVENT, onOther)
  }, [])

  // the picked range stays highlighted while the new-root composer is open
  const newThread = ctl.newThread
  useEffect(() => {
    if (newThread || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(pendingCommentPluginKey, null))
  }, [newThread, editor])

  // the new-comment composer sits in document order: bring it fully into view (Cancel / Send too)
  useEffect(() => {
    if (!newThread || !panelOpen) return
    document
      .querySelector('.docs-server-comments .collab-thread--new')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [newThread, panelOpen])

  /** AI-suggested texts by composer draft key, until sent or cancelled */
  const [aiDrafts, setAiDrafts] = useState<ReadonlyMap<string, string>>(new Map())
  const setAiDraft = useCallback((draftKey: string, text: string | null) => {
    setAiDrafts((prev) => {
      const next = new Map(prev)
      if (text === null) next.delete(draftKey)
      else next.set(draftKey, text)
      return next
    })
  }, [])

  const startAt = useCallback(
    (range: PmRange): boolean => {
      // a root comment needs base_version_id (OQ-C2): unknown until the first Save receipt
      if (!versionRef.current) return false
      const a = anchorsRef.current
      const anchor = a?.encode(range)
      if (!anchor) return false
      if (!editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr.setMeta(pendingCommentPluginKey, range))
      }
      ctlRef.current.startThread({
        anchor,
        base_version_id: versionRef.current,
      })
      openRef.current()
      return true
    },
    [editor],
  )

  const statusRef = useRef(p.onStatus)
  statusRef.current = p.onStatus
  const selectRef = useRef(p.selectTextMessage)
  selectRef.current = p.selectTextMessage
  const saveFirstRef = useRef(p.saveFirstMessage)
  saveFirstRef.current = p.saveFirstMessage

  p.handleRef.current = {
    startThread: () => {
      if (editor.isDestroyed) return
      if (!versionRef.current) {
        statusRef.current(saveFirstRef.current)
        announcePolite(saveFirstRef.current)
        openRef.current()
        return
      }
      let { from, to } = editor.state.selection
      if (from === to) {
        // Word anchors on the word under a collapsed caret, as the local composer does
        const word = wordRangeAtCaret(editor)
        if (!word) {
          statusRef.current(selectRef.current)
          return
        }
        ;({ from, to } = word)
      }
      if (!startAt({ from, to })) statusRef.current(selectRef.current)
    },
    ai: {
      owns: (id) => !!threadOf(ctlRef.current, id),
      list: () =>
        [...ctlRef.current.threads, ...ctlRef.current.resolved].flatMap((t) =>
          [t.root, ...t.replies]
            .filter((c) => !c.deleted_at)
            .map((c): CommentInfo => ({
              id: c.id,
              author: c.display_name || strings.collabFormerMember || '',
              date: c.created_at ?? '',
              text: c.body,
              ...(c.id !== t.id ? { parentId: t.id } : {}),
              ...(t.resolved && c.id === t.id ? { done: true } : {}),
            })),
        ),
      draftReply: (id, text) => {
        const thread = threadOf(ctlRef.current, id)
        if (!thread || thread.deleted) return false
        setAiDraft(`reply:${thread.id}`, text)
        openRef.current()
        void ctlRef.current.reveal(thread.id).catch(() => undefined)
        return true
      },
      draftNew: (range, text) => {
        const anchor = anchorsRef.current?.encode(range)
        if (!anchor || !startAt(range)) return false
        setAiDraft(`root:${JSON.stringify(anchor)}`, text)
        return true
      },
    },
  }
  useEffect(
    () => () => {
      p.handleRef.current = null
    },
    [p.handleRef],
  )

  if (!panelOpen) return null

  const renderComposer = (slot: CollabComposerSlot) => {
    const ai = aiDrafts.get(slot.draftKey)
    if (ai === undefined) return <CollabComposer {...slot} strings={strings} />
    return (
      <CollabComposer
        {...slot}
        strings={strings}
        initialBody={ai}
        aiDraft
        onSubmit={async (body) => {
          await slot.onSubmit(body)
          setAiDraft(slot.draftKey, null)
        }}
        onCancel={() => {
          setAiDraft(slot.draftKey, null)
          slot.onCancel()
        }}
      />
    )
  }

  const inFileCount = p.inFileComments.filter((c) => !c.parentId).length
  const needsSave = !knownVersion && mode.level !== 'view'
  return (
    <div className="comments-pane docs-server-comments">
      <CollabPanel
        className="docs-server-panel"
        controller={ctl}
        strings={strings}
        onClose={p.onClosePanel}
        renderComposer={renderComposer}
        inFile={
          inFileCount > 0
            ? {
                count: inFileCount,
                content: (
                  <InFileList
                    comments={p.inFileComments}
                    neutralAuthor={p.neutralAuthor}
                    lang={lang}
                    resolvedLabel={strings.collabResolved ?? ''}
                  />
                ),
              }
            : undefined
        }
      />
      {needsSave && (
        <p className="collab-pnote collab-pnote--warn docs-server-save-first">
          {p.saveFirstMessage}
        </p>
      )}
    </div>
  )
}
