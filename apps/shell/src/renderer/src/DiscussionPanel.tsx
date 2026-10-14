import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  CollabComposer,
  CollabPanel,
  collabStrings,
  useCollabThreads,
  type CollabHostState,
} from '@genoffice/ui/collab'
import { createCommentsPoll } from '@genoffice/electron-utils/comments-poll'
import type { UniworkDiscussionApi } from '@genoffice/electron-utils/comments-ipc'
import type { TabSummary } from '../../shared/tabs-api'
import { showsProfile, useAccount } from './account-model'
import {
  DISCUSSION_PANEL_ID,
  DISCUSSION_TOGGLE_ID,
  DISCUSSION_PANEL_LIMITS,
  DISCUSSION_WIDTH_DEFAULT,
  DISCUSSION_WIDTH_STEP,
  clampDiscussionPanelWidth,
  createDiscussionSource,
  discussionBridge,
  discussionTargetOf,
  isDiscussionComment,
  requestedDiscussionWidth,
  setDiscussionOpen,
  useDiscussionOpen,
  type DiscussionTarget,
} from './discussion-panel-model'
import { useI18n } from './locale'
import { useUniworkStatuses } from './UniworkChrome'

/**
 * S13 for the desktop: one Discussion panel in the shell for every editor tab (docs, sheets, slides,
 * pdf, markdown, html). The editors are WebContentsViews painted above all shell DOM, so main narrows
 * the active view by the panel width (`setPanel`) and the panel draws in the strip that frees up.
 * It follows the active tab (re-keyed by document), and a local file has no panel at all.
 */

const WIDTH_STORAGE_KEY = 'uw-discussion-width'

function loadWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY))
    return stored > 0 ? requestedDiscussionWidth(stored) : DISCUSSION_WIDTH_DEFAULT
  } catch {
    return DISCUSSION_WIDTH_DEFAULT
  }
}

function saveWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width))
  } catch {
    // storage can be blocked; the width then lasts for this session only
  }
}

/** a reveal whose id is known to be a Discussion post, waiting for the panel body of its document */
interface PendingReveal {
  id: string
  path: string
}

interface BodyProps {
  bridge: UniworkDiscussionApi
  target: DiscussionTarget
  lang: Lang
  myUserId: string | undefined
  pending: PendingReveal | null
  onPendingDone(): void
  /** the live panel's reveal, for a reveal that arrives while the panel is already open */
  revealRef: { current: ((id: string) => Promise<unknown>) | null }
  onClose(): void
}

/** the kit panel for one document; the parent re-keys it by document id so no list leaks across tabs */
function DiscussionBody(p: BodyProps) {
  const { bridge, target, lang, myUserId, pending, onPendingDone, revealRef, onClose } = p
  const source = useMemo(() => createDiscussionSource(bridge, target.path), [bridge, target.path])
  const platform = useMemo<CollabHostState['platform']>(
    () => (/mac/i.test(navigator.platform) ? 'mac' : 'other'),
    [],
  )
  const host = useMemo<CollabHostState>(
    () => ({
      documentId: target.documentId,
      kind: 'discussion',
      level: target.level,
      myUserId,
      lang,
      platform,
    }),
    [target.documentId, target.level, myUserId, lang, platform],
  )
  const strings = useMemo(() => collabStrings(lang), [lang])
  const ctl = useCollabThreads(source, host, { strings })
  const ctlRef = useRef(ctl)
  ctlRef.current = ctl

  // 30 s + focus, only while the window is visible and the panel is open (comments-poll.ts); the
  // kit controller keeps its own list token, so the scheduler only decides *when* to reload
  useEffect(() => {
    const poll = createCommentsPoll({
      fetch: async () => {
        await ctlRef.current.reload()
        return { unchanged: true, listToken: '' }
      },
      onChanged: () => undefined,
    })
    poll.setVisible(document.visibilityState === 'visible')
    poll.setPanelOpen(true)
    const onFocus = () => poll.reload()
    const onVisibility = () => poll.setVisible(document.visibilityState === 'visible')
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      poll.dispose()
    }
  }, [])

  useEffect(() => {
    revealRef.current = (id) => ctlRef.current.reveal(id)
    return () => {
      revealRef.current = null
    }
  }, [revealRef])

  useEffect(() => {
    if (!pending || pending.path !== target.path) return
    // held by the controller until the first list; a late list rejects not_ready, nothing to show then
    void ctlRef.current
      .reveal(pending.id)
      .catch(() => undefined)
      .finally(onPendingDone)
    // one reveal per pending id; the callbacks are stable enough for that
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id, pending?.path])

  return (
    <CollabPanel
      controller={ctl}
      strings={strings}
      onClose={onClose}
      renderComposer={(slot) => <CollabComposer {...slot} strings={strings} />}
    />
  )
}

export function DiscussionPanel() {
  const { lang, t } = useI18n()
  const account = useAccount()
  const [tabs, setTabs] = useState<TabSummary[]>([])
  const uniwork = useUniworkStatuses(tabs)
  const open = useDiscussionOpen()
  // what the person asked for; the window decides how much of it fits (same function as main)
  const [requested, setRequested] = useState(loadWidth)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [pending, setPending] = useState<PendingReveal | null>(null)
  const bridge = discussionBridge()

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    void window.aiOfficeTabs.list().then(setTabs)
    return window.aiOfficeTabs.onChanged(setTabs)
  }, [])

  const activePath = tabs.find((tab) => tab.active)?.filePath
  const status = uniwork.statusOf(activePath)
  const signedIn = showsProfile(account.view, account.status)
  const target = discussionTargetOf(status, signedIn, bridge)
  // a path whose status is not read yet is "unknown", not "local": the panel waits instead of closing
  const settled = !activePath || uniwork.isKnown(activePath)
  const width = clampDiscussionPanelWidth(requested, viewport)
  // a window too narrow to keep the editor usable has no room for the panel (main takes 0 as well)
  const shown = open && (target !== null || !settled) && width > 0

  const targetRef = useRef(target)
  targetRef.current = target
  const shownRef = useRef(shown)
  shownRef.current = shown
  const revealRef = useRef<BodyProps['revealRef']['current']>(null)

  // closes itself when the active tab is not a bound document (or its owner signed out)
  useEffect(() => {
    if (open && settled && !target) setDiscussionOpen(false)
  }, [open, settled, target])

  // main narrows / restores the active editor view; the first closed state needs no message
  const sentRef = useRef<{ open: boolean; width: number } | null>(null)
  useEffect(() => {
    if (!bridge) return
    const next = { open: shown, width }
    const last = sentRef.current
    if (!last && !next.open) return
    if (last && last.open === next.open && (!next.open || last.width === next.width)) return
    sentRef.current = next
    bridge.setPanel(next)
  }, [bridge, shown, width])
  useEffect(
    () => () => {
      if (sentRef.current?.open) discussionBridge()?.setPanel({ open: false, width: 0 })
    },
    [],
  )

  const path = target?.path
  useEffect(() => {
    if (!bridge || !path) return
    return bridge.onReveal(path, (commentId) => {
      if (shownRef.current && revealRef.current) {
        void revealRef.current(commentId)?.catch(() => undefined)
        return
      }
      // closed: only a Discussion post opens the panel; any other id is the editor panel's
      const current = targetRef.current
      if (!current || current.path !== path) return
      void isDiscussionComment(createDiscussionSource(bridge, path), commentId).then((yes) => {
        if (!yes || targetRef.current?.path !== path) return
        setPending({ id: commentId, path })
        setDiscussionOpen(true)
      })
    })
  }, [bridge, path])

  const close = useCallback(() => {
    setDiscussionOpen(false)
    document.getElementById(DISCUSSION_TOGGLE_ID)?.focus()
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent) => {
    // the kit consumes Esc for its picker, composer, menus and dialogs; what is left closes the panel
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    close()
  }

  const resize = (next: number) => {
    const wanted = requestedDiscussionWidth(next)
    setRequested(wanted)
    saveWidth(wanted)
  }
  const dragRef = useRef<number | null>(null)
  const onHandleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = event.pointerId
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== event.pointerId) return
    // the panel hugs the right edge, so its width is the distance from the pointer to that edge
    resize(viewport - event.clientX)
  }
  const onHandleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current === event.pointerId) dragRef.current = null
  }
  const onHandleKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') resize(requested + DISCUSSION_WIDTH_STEP)
    else if (event.key === 'ArrowRight') resize(requested - DISCUSSION_WIDTH_STEP)
    else if (event.key === 'Home') resize(DISCUSSION_PANEL_LIMITS.min)
    else if (event.key === 'End') resize(DISCUSSION_PANEL_LIMITS.max)
    else return
    event.preventDefault()
  }

  if (!shown) return null

  return (
    <div
      id={DISCUSSION_PANEL_ID}
      className="uw-discussion"
      style={{ '--uw-discussion-width': `${width}px` } as CSSProperties}
      onKeyDown={onKeyDown}
      aria-busy={target ? undefined : true}
    >
      <div
        className="uw-discussion-handle"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={DISCUSSION_PANEL_LIMITS.min}
        aria-valuemax={DISCUSSION_PANEL_LIMITS.max}
        aria-valuenow={width}
        aria-controls={DISCUSSION_PANEL_ID}
        aria-label={t('discussionResizeLabel')}
        tabIndex={0}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        onKeyDown={onHandleKey}
      />
      <div className="uw-discussion-body">
        {target && bridge && (
          <DiscussionBody
            key={target.documentId}
            bridge={bridge}
            target={target}
            lang={lang}
            myUserId={account.status?.profile?.accountId}
            pending={pending}
            onPendingDone={() => setPending(null)}
            revealRef={revealRef}
            onClose={close}
          />
        )}
      </div>
    </div>
  )
}
