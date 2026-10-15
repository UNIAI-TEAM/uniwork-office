import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { TabSummary } from '../../shared/tabs-api'
import type { UniworkDocStatus } from '../../shared/home-api'
import { asSyncCenterSnapshot } from '../../shared/sync-center'
import { useI18n, type StringKey } from './locale'
import { useAccount } from './account-model'
import { onLocalRename, onUniworkNotice } from './uniwork-notice-bus'
import { onDocRenamed } from './uniwork-library-api'
import {
  DISCUSSION_PANEL_ID,
  DISCUSSION_TOGGLE_ID,
  discussionBridge,
  discussionTargetOf,
  setDiscussionOpen,
  useDiscussionOpen,
} from './discussion-panel-model'
import { collabStrings } from '@genoffice/ui/collab'
import { showsProfile } from './account-model'
import {
  chipCopy,
  chipModelOf,
  launchNoticeOf,
  pathKey,
  remoteBarModelOf,
  type ChipActionKind,
  type LaunchNotice,
  type RemoteBarAction,
} from './uniwork-docs-model'
import { UniworkConflictHost } from './UniworkConflictDialog'
import { UniworkQueuePopover } from './UniworkQueuePopover'
import { findQueueRow, isQueuePopoverState, type QueuePopoverOpener } from './queue-popover-model'
import { announce } from './uniwork-live'

/**
 * UniWork pieces of the tab strip. The strip is shell DOM that stays visible
 * above the editor views, so this is where a bound document's save state and
 * the "opening from UniWork" progress can be seen whatever tab is active.
 */

function Spinner() {
  return (
    <svg className="uw-spinner" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeDasharray="26"
        strokeDashoffset="18"
        strokeLinecap="round"
      />
    </svg>
  )
}

export interface UniworkStatuses {
  /** the UniWork status of the document behind this path; null for a plain local file */
  statusOf(path: string | undefined): UniworkDocStatus | null
  /** the status of this path was read (null then means a plain local file, not "not read yet") */
  isKnown(path: string | undefined): boolean
  /** take a status main just answered with (after Retry / Resolve) */
  apply(status: UniworkDocStatus): void
}

/**
 * Status of every open tab's document, from main: read once per path, then
 * kept current by the pushed changes. A push always wins over a read that was
 * already in flight (the read may describe an older moment).
 */
export function useUniworkStatuses(tabs: TabSummary[]): UniworkStatuses {
  const [byPath, setByPath] = useState<ReadonlyMap<string, UniworkDocStatus | null>>(new Map())
  const mapRef = useRef(byPath)
  mapRef.current = byPath
  /** bumped by every push for a path; a read started before it is dropped */
  const pushes = useRef(new Map<string, number>())
  const anyPush = useRef(0)

  const apply = useCallback((status: UniworkDocStatus) => {
    const key = pathKey(status.path)
    pushes.current.set(key, (pushes.current.get(key) ?? 0) + 1)
    anyPush.current++
    setByPath((prev) => new Map(prev).set(key, status))
  }, [])

  useEffect(() => window.aiOffice.onUniworkDocStatus(apply), [apply])

  const paths = tabs.flatMap((tab) => (tab.filePath ? [tab.filePath] : []))
  const pathsKey = paths.map(pathKey).join('\n')
  const activePath = tabs.find((tab) => tab.active)?.filePath

  useEffect(() => {
    const wanted = new Set(pathsKey ? pathsKey.split('\n') : [])
    setByPath((prev) => {
      if (![...prev.keys()].some((key) => !wanted.has(key))) return prev
      return new Map([...prev].filter(([key]) => wanted.has(key)))
    })
    for (const path of paths) {
      const key = pathKey(path)
      if (mapRef.current.has(key)) continue
      const seen = pushes.current.get(key) ?? 0
      void window.aiOffice
        .uniworkDocStatus(path)
        .then((status) => {
          if ((pushes.current.get(key) ?? 0) !== seen) return
          setByPath((prev) => (prev.has(key) ? prev : new Map(prev).set(key, status)))
        })
        .catch(() => undefined)
    }
    // the paths are compared through their key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey])

  // the active tab's state is read again when the tab changes (main's view of "active")
  useEffect(() => {
    if (!activePath) return
    const seen = anyPush.current
    void window.aiOffice
      .uniworkActiveDocStatus()
      .then((status) => {
        if (status && anyPush.current === seen) apply(status)
      })
      .catch(() => undefined)
  }, [activePath, apply])

  const statusOf = useCallback(
    (path: string | undefined) => (path ? (byPath.get(pathKey(path)) ?? null) : null),
    [byPath],
  )
  const isKnown = useCallback(
    (path: string | undefined) => (path ? byPath.has(pathKey(path)) : false),
    [byPath],
  )
  return { statusOf, isKnown, apply }
}

/** small marker on the tab icon of a UniWork document */
export function UniworkTabMarker({ status }: { status: UniworkDocStatus }) {
  const { t } = useI18n()
  const model = chipModelOf(status)
  return (
    <span
      className="uw-tab-marker"
      data-tone={model.tone}
      role="img"
      aria-label={t('uwTabMarker')}
      title={t('uwTabMarker')}
    />
  )
}

/** save states in which the waiting save has a time worth showing in the tooltip */
const QUEUED_STATES: ReadonlySet<UniworkDocStatus['state']> = new Set([
  'queued',
  'paused_offline',
  'paused_user',
])

/** when the waiting save was made: the sync center row of this document (G5-10), none without it */
function useQueuedAt(status: UniworkDocStatus): string | undefined {
  const [savedAt, setSavedAt] = useState<string | undefined>(undefined)
  const wanted = QUEUED_STATES.has(status.state)
  const documentId = status.documentId
  useEffect(() => {
    const api = window.uniworkSyncCenter
    if (!wanted || !api) {
      setSavedAt(undefined)
      return
    }
    let live = true
    const take = (value: unknown) => {
      if (live) setSavedAt(findQueueRow(asSyncCenterSnapshot(value), documentId)?.savedAt)
    }
    void api
      .getSnapshot()
      .then(take)
      .catch(() => undefined)
    const unsubscribe = api.subscribe(take)
    return () => {
      live = false
      unsubscribe()
    }
  }, [wanted, documentId])
  return savedAt
}

/** the states whose arrival is said to a screen reader at once (EXPERIENCE: blocked, failed, conflict) */
function isUrgent(status: UniworkDocStatus, labelKey: StringKey): boolean {
  return status.state === 'failed' || labelKey === 'uwChipBlocked' || labelKey === 'uwChipConflict'
}

/**
 * Saved / Unsaved / Saving / Queued / Blocked / Error ... for the active tab (Save pill, S1).
 *
 * One reading channel: the label is plain text, the explanation is the tooltip node (hover and
 * focus) that the button, or the pill itself when it has no button, points at through
 * aria-describedby, and a change of the pill is said once through the window live host. The
 * queue states open the queue popover (S4); so does Ctrl/Cmd+S on a waiting save (main pushes
 * the request, the chip of the active document opens it).
 */
export function UniworkStatusChip({
  status,
  onStatus,
}: {
  status: UniworkDocStatus
  onStatus: (status: UniworkDocStatus) => void
}) {
  const { t, dateLocale } = useI18n()
  const account = useAccount()
  const tipId = useId()
  const [busy, setBusy] = useState(false)
  const [popover, setPopover] = useState<QueuePopoverOpener | null>(null)
  const [ctrlS, setCtrlS] = useState(0)
  const [tipDismissed, setTipDismissed] = useState(false)
  const groupRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const accountOk = account.view === 'signed-in' || account.view === 'refreshing'
  const queuedAt = useQueuedAt(status)
  const model = chipModelOf(status, { needsSignIn: !accountOk, queuedAt })
  const { label, tip } = chipCopy(model, t, dateLocale)
  const action = model.action

  // the button never leaves while focus is on it without the pill taking the focus first (a
  // callback ref runs before the node is removed; focus dropped to <body> would lose the place)
  const setButton = useCallback((el: HTMLButtonElement | null) => {
    const previous = buttonRef.current
    buttonRef.current = el
    if (!el && previous && document.activeElement === previous) groupRef.current?.focus()
  }, [])

  // one sentence per change of this document's pill, none when the pill first shows (a tab
  // switch mounts another chip: the chip is keyed by path)
  const signature = `${status.path}\n${model.labelKey}\n${model.reasonKey ?? ''}\n${status.state}`
  const lastSignature = useRef(signature)
  const labelRef = useRef(label)
  labelRef.current = label
  useEffect(() => {
    if (lastSignature.current === signature) return
    const samePath = lastSignature.current.split('\n')[0] === status.path
    lastSignature.current = signature
    if (!samePath) return
    announce(t('uwSyncRowAnnounce', { doc: status.title, state: labelRef.current }), {
      assertive: isUrgent(status, model.labelKey),
    })
    // t is not referentially stable (CLAUDE.md): the key is the dependency, the text is made now
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Ctrl/Cmd+S on a document with a waiting save: main asks for the popover (a conflict opens the
  // resolve choice instead). This chip only exists for the active tab, so another path is ignored.
  useEffect(
    () =>
      window.aiOffice.onUniworkQueuePopover((request) => {
        if (pathKey(request.path) === pathKey(status.path)) setCtrlS((n) => n + 1)
      }),
    [status.path],
  )
  const statusRef = useRef(status)
  statusRef.current = status
  useEffect(() => {
    if (ctrlS === 0) return
    const current = statusRef.current
    if (current.state === 'conflict') {
      setBusy(true)
      void window.aiOffice
        .uniworkResolveConflict(current.path)
        .then((next) => {
          if (next) onStatus(next)
        })
        .catch(() => undefined)
        .finally(() => setBusy(false))
      return
    }
    // a status that settled in between (no waiting save any more) has nothing to say
    if (isQueuePopoverState(current)) setPopover('ctrl-s')
    // only a new request counts, not a changed onStatus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrlS])

  // the tooltip hides on Esc without moving focus, and comes back with the next hover / focus
  const showTip = () => setTipDismissed(false)

  const run = (kind: ChipActionKind) => {
    if (busy) return
    if (kind === 'sign-in') {
      account.signIn()
      return
    }
    if (kind === 'view-queue' || kind === 'details') {
      setPopover((open) => (open === 'pill' ? null : 'pill'))
      return
    }
    if (kind === 'stop-ai') {
      // the AI run a save waits for has no owner in main yet (`saveWait` is never set): nothing to stop
      return
    }
    setBusy(true)
    const call =
      kind === 'retry'
        ? window.aiOffice.uniworkSave(status.path)
        : kind === 'reload'
          ? window.aiOffice.uniworkRemoteAction(status.path, 'reload')
          : window.aiOffice.uniworkResolveConflict(status.path)
    void call
      .then((next) => {
        if (next) onStatus(next)
      })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }

  // the pill group is the keyboard stop only when it has no button to carry the description
  const describedHere = !action
  return (
    <>
      <div
        ref={groupRef}
        className="uw-pill"
        role="group"
        aria-label={t('uwChipAria')}
        data-tone={model.tone}
        data-state={status.state}
        data-tip-dismissed={tipDismissed ? '' : undefined}
        tabIndex={describedHere ? 0 : -1}
        aria-describedby={describedHere ? tipId : undefined}
        onMouseEnter={showTip}
        onFocus={showTip}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !popover) setTipDismissed(true)
        }}
      >
        <span id={tipId} className="uw-pill-tip" role="tooltip">
          <span className="uw-pill-tip-label" aria-hidden="true">
            {label}
          </span>
          {tip}
        </span>
        <span className="uw-pill-status">
          {model.tone === 'busy' ? (
            <Spinner />
          ) : (
            <span className="uw-pill-dot" aria-hidden="true" />
          )}
          <span className="uw-pill-label">{label}</span>
        </span>
        {action && (
          <button
            ref={setButton}
            type="button"
            className="uw-pill-action"
            aria-disabled={busy ? 'true' : undefined}
            aria-describedby={tipId}
            aria-expanded={
              action.kind === 'view-queue' || action.kind === 'details'
                ? popover === 'pill'
                : undefined
            }
            onClick={() => run(action.kind)}
          >
            {t(action.labelKey)}
          </button>
        )}
      </div>
      {popover && (
        <UniworkQueuePopover
          status={status}
          opener={popover}
          anchorEl={groupRef.current}
          openerEl={popover === 'pill' ? buttonRef.current : null}
          onClose={() => setPopover(null)}
          onSignIn={() => account.signIn()}
          onFocusEditor={() => window.aiOfficeTabs?.focusActive()}
        />
      )}
    </>
  )
}

function NoticePill({ notice, onDismiss }: { notice: LaunchNotice; onDismiss: () => void }) {
  const { t } = useI18n()
  const account = useAccount()
  return (
    <div
      className="uw-pill uw-notice"
      data-tone={notice.tone}
      title={t(notice.messageKey, notice.params)}
    >
      <span className="uw-pill-status" role={notice.tone === 'error' ? 'alert' : 'status'}>
        {notice.tone === 'busy' ? <Spinner /> : <span className="uw-pill-dot" aria-hidden="true" />}
        <span className="uw-pill-label">{t(notice.messageKey, notice.params)}</span>
      </span>
      {notice.signIn && (
        <button type="button" className="uw-pill-action" onClick={() => account.signIn()}>
          {t('acctSignIn')}
        </button>
      )}
      {notice.tone !== 'busy' && (
        <button
          type="button"
          className="uw-pill-close"
          aria-label={t('uwLaunchDismiss')}
          onClick={onDismiss}
        >
          <svg width="10" height="10" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M3 3l8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}

/** "Opening from UniWork…", the sign-in prompt and failures of an open (web launch or recent) */
export function UniworkNotice({ openDocumentIds }: { openDocumentIds: ReadonlySet<string> }) {
  const [notice, setNotice] = useState<LaunchNotice | null>(null)

  useEffect(() => {
    const show = (event: Parameters<typeof launchNoticeOf>[0]) => setNotice(launchNoticeOf(event))
    const offLaunch = window.aiOffice.onUniworkLaunch(show)
    const offBus = onUniworkNotice(show)
    return () => {
      offLaunch()
      offBus()
    }
  }, [])

  useEffect(() => {
    if (!notice?.autoHideMs) return
    const timer = window.setTimeout(() => setNotice(null), notice.autoHideMs)
    return () => window.clearTimeout(timer)
  }, [notice])

  return (
    <>
      {notice && <NoticePill notice={notice} onDismiss={() => setNotice(null)} />}
      <RenamedAnnouncer openDocumentIds={openDocumentIds} />
      <UniworkConflictHost />
    </>
  )
}

/**
 * Polite announcement of a document's new name: a rename the person just made
 * in the library, or one from elsewhere for a document open in a tab (main
 * refreshed its metadata; the tab title follows from main). A feed push for a
 * document that is not open stays silent. The live region is always in the DOM
 * so screen readers pick changes up.
 */
function RenamedAnnouncer({ openDocumentIds }: { openDocumentIds: ReadonlySet<string> }) {
  const { t } = useI18n()
  const [name, setName] = useState<{ title: string; n: number } | null>(null)
  const openRef = useRef(openDocumentIds)
  openRef.current = openDocumentIds
  useEffect(() => {
    const say = (title: string) => setName((prev) => ({ title, n: (prev?.n ?? 0) + 1 }))
    const offFeed = onDocRenamed(({ documentId, title }) => {
      if (openRef.current.has(documentId)) say(title)
    })
    const offLocal = onLocalRename(say)
    return () => {
      offFeed()
      offLocal()
    }
  }, [])
  return (
    <span className="uw-sr-only" role="status" aria-live="polite">
      {name ? <span key={name.n}>{t('uwDocRenamedAnnounce', { name: name.title })}</span> : null}
    </span>
  )
}

/**
 * "Discussion" button of the tab strip: shown only for a UniWork document while signed in. A plain
 * local file (and a signed-out desktop) has no Discussion, so no button.
 */
export function DiscussionToggle({ status }: { status: UniworkDocStatus }) {
  const { lang } = useI18n()
  const account = useAccount()
  const open = useDiscussionOpen()
  const bridge = discussionBridge()
  if (!discussionTargetOf(status, showsProfile(account.view, account.status), bridge)) return null
  const label = collabStrings(lang).collabDiscussion
  return (
    <button
      type="button"
      id={DISCUSSION_TOGGLE_ID}
      className="uw-discussion-toggle"
      aria-expanded={open}
      aria-controls={open ? DISCUSSION_PANEL_ID : undefined}
      data-open={open ? 'true' : undefined}
      onClick={() => setDiscussionOpen(!open)}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span className="uw-discussion-toggle-label">{label}</span>
    </button>
  )
}

// ── S6 new-version bar ──────────────────────────────────

/** one signature per bar state: a newer revision (another version) is a different bar */
function remoteSignature(status: UniworkDocStatus | null): string | null {
  if (status?.lockWhileOpen) return JSON.stringify(status.lockWhileOpen)
  return status?.remote ? JSON.stringify(status.remote) : null
}

/**
 * The identity of the notice a user closed or put off. A newer revision is the same notice
 * whatever it waits for (a commit in flight, a stuck one) and whether it is dirty or AI: only a
 * higher version is a new one. Every other kind is its whole state.
 */
function remoteNoticeKey(status: UniworkDocStatus | null): string | null {
  // a lock while open is its mode: the sentence changes with it, not with the lock's reason
  if (status?.lockWhileOpen) return `lock-while-open\n${status.lockWhileOpen.mode}`
  const remote = status?.remote
  if (!remote) return null
  if (remote.kind === 'newer-dirty' || remote.kind === 'newer-ai') return `newer\n${remote.version}`
  return JSON.stringify(remote)
}

interface RemoteSay {
  key: StringKey
  params: Record<string, string | number>
  assertive: boolean
  n: number
}

/**
 * The bar under the tab strip for the ACTIVE tab's document (one bar, never stacked; a second
 * notice replaces its version). The sentence on screen is not live: it is read once through
 * the window-level live nodes below, polite for a newer version, alert for the error kinds.
 * `Later` / `Close` hide the bar here at once and tell main; a bar that main later replaces
 * with another notice (a newer version, another kind) shows again.
 */
export function UniworkRemoteBar({
  status,
  onStatus,
}: {
  status: UniworkDocStatus | null
  onStatus: (status: UniworkDocStatus) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const model = status ? remoteBarModelOf(status) : null
  const path = status ? pathKey(status.path) : null
  const signature = remoteSignature(status)
  const noticeKey = remoteNoticeKey(status)
  // paths whose current notice was closed / put off, with the notice's identity
  const [hidden, setHidden] = useState<ReadonlyMap<string, string>>(new Map())
  const hiddenHere = path !== null && noticeKey !== null && hidden.get(path) === noticeKey
  const visible = Boolean(model) && !hiddenHere
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState<RemoteSay | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const heightRef = useRef(0)

  const hide = useCallback(() => {
    if (path === null || noticeKey === null) return
    setHidden((prev) => new Map(prev).set(path, noticeKey))
  }, [path, noticeKey])

  const act = useCallback(
    (kind: RemoteBarAction['kind']) => {
      if (!status) return
      if (kind === 'later' || kind === 'close') hide()
      setBusy(true)
      void window.aiOffice
        .uniworkRemoteAction(status.path, kind)
        .then((next) => {
          if (next) onStatus(next)
        })
        .catch(() => undefined)
        .finally(() => setBusy(false))
    },
    [status, hide, onStatus],
  )

  // a closed bar is forgotten once the document has no bar, or another notice
  useEffect(() => {
    if (path === null || hidden.get(path) === undefined || hidden.get(path) === noticeKey) return
    setHidden((prev) => {
      const next = new Map(prev)
      next.delete(path)
      return next
    })
  }, [path, noticeKey, hidden])

  // announced once per notice of a document: coming back to a tab does not say it again, a bar
  // that went away (no remote) and returns does, and a hidden bar leaves no stale sentence behind
  const announced = useRef(new Map<string, string>())
  const shownKey = visible && model && path ? `${path}\n${signature}` : null
  const announceKey = visible && model && path && noticeKey ? `${path}\n${noticeKey}` : null
  const modelRef = useRef(model)
  modelRef.current = model
  useEffect(() => {
    if (path !== null && model === null) announced.current.delete(path)
  }, [path, model])
  useEffect(() => {
    const current = modelRef.current
    if (!announceKey || !current || path === null || noticeKey === null) {
      setSay(null)
      return
    }
    if (announced.current.get(path) === noticeKey) return
    announced.current.set(path, noticeKey)
    setSay((prev) => ({
      key: current.messageKey,
      params: current.params,
      assertive: current.tone === 'error',
      n: (prev?.n ?? 0) + 1,
    }))
  }, [announceKey, path, noticeKey])

  // an information bar hides itself unless the pointer or the focus is in it; leaving restarts the 8 s
  const autoHideMs = visible ? model?.autoHideMs : undefined
  const actRef = useRef(act)
  actRef.current = act
  useEffect(() => {
    if (!autoHideMs || hovered || focused || busy) return
    const timer = window.setTimeout(() => actRef.current('close'), autoHideMs)
    return () => window.clearTimeout(timer)
  }, [autoHideMs, hovered, focused, busy, shownKey])
  useEffect(() => {
    if (!visible) {
      setHovered(false)
      setFocused(false)
    }
  }, [visible])

  // main moves the active editor view down by the bar's unscaled CSS-px height (main multiplies by
  // the interface scale): 0 when there is no bar or no document tab
  const report = useCallback((px: number) => {
    try {
      void Promise.resolve(window.aiOffice.uniworkSetBarInset(px)).catch(() => undefined)
    } catch {
      // a host without the channel has no inset to move
    }
  }, [])
  useEffect(() => {
    const bar = barRef.current
    if (!visible || !bar) {
      heightRef.current = 0
      report(0)
      return
    }
    const cssHeight = () => {
      const rawScale = Number.parseFloat(
        getComputedStyle(bar).getPropertyValue('--ui-scale') ||
          document.documentElement.style.getPropertyValue('--ui-scale'),
      )
      const scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1
      return Math.ceil(bar.getBoundingClientRect().height / scale)
    }
    const measure = () => {
      const px = cssHeight()
      if (px === heightRef.current) return
      heightRef.current = px
      report(px)
    }
    heightRef.current = cssHeight()
    report(heightRef.current)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    return () => observer.disconnect()
    // a tab switch sends the height again (the view that becomes active needs it)
  }, [visible, path, shownKey, report])
  useEffect(() => () => report(0), [report])

  const messageId = `${id}-msg`
  const reasonId = `${id}-reason`
  const reasonKey = model?.actions.find((a) => a.disabledReasonKey)?.disabledReasonKey
  const showReason = Boolean(reasonKey) && reasonKey !== model?.messageKey

  return (
    <>
      {visible && model && (
        <div
          ref={barRef}
          className="uw-remote-bar"
          role="region"
          aria-label={t(model.regionKey)}
          aria-busy={busy ? 'true' : undefined}
          data-tone={model.tone}
          data-kind={status?.lockWhileOpen ? 'lock-while-open' : status?.remote?.kind}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
          }}
        >
          <span className="uw-remote-dot" aria-hidden="true" />
          <div className="uw-remote-text">
            <p id={messageId} className="uw-remote-message">
              {t(model.messageKey, model.params)}
            </p>
            {showReason && reasonKey && (
              <p id={reasonId} className="uw-remote-reason">
                {t(reasonKey)}
              </p>
            )}
          </div>
          {model.actions.length > 0 && (
            <div className="uw-remote-actions">
              {model.actions.map((action) => {
                const blocked = Boolean(action.disabledReasonKey)
                return (
                  <button
                    key={action.kind}
                    type="button"
                    className="uw-remote-action"
                    data-action={action.kind}
                    aria-disabled={blocked || busy ? 'true' : undefined}
                    aria-describedby={
                      action.disabledReasonKey
                        ? action.disabledReasonKey === model.messageKey
                          ? messageId
                          : reasonId
                        : undefined
                    }
                    onClick={() => {
                      if (blocked || busy) return
                      act(action.kind)
                    }}
                  >
                    {t(action.labelKey)}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      {/* window-level live nodes: always in the DOM so a screen reader picks the change up */}
      <span className="uw-sr-only" role="status" aria-live="polite">
        {say && !say.assertive ? <span key={say.n}>{t(say.key, say.params)}</span> : null}
      </span>
      <span className="uw-sr-only" role="alert">
        {say?.assertive ? <span key={say.n}>{t(say.key, say.params)}</span> : null}
      </span>
    </>
  )
}
