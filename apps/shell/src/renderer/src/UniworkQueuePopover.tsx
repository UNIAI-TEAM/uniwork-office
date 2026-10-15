import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { UniworkDocStatus } from '../../shared/home-api'
import {
  asSyncCenterSnapshot,
  type SyncCenterActionResult,
  type SyncCenterRow,
} from '../../shared/sync-center'
import { useI18n, type StringKey } from './locale'
import {
  QUEUE_BAND_SETTLE_MS,
  QUEUE_DRAFT_CAP,
  findQueueRow,
  formatQueueTime,
  isQueuePopoverState,
  popoverLeftOf,
  queuePopoverModelOf,
  type PopoverAction,
  type PopoverActionId,
  type PopoverLine,
  type QueuePopoverOpener,
} from './queue-popover-model'
import { announce } from './uniwork-live'
import {
  popoverRoomOf,
  setTopInsetPart,
  uiScaleOf,
  unscaledHeightOf,
  useTopInsetPart,
} from './uniwork-top-inset'
import './queue-popover.css'

/**
 * Queue popover (S4): what the save pill's "View queue" / "Details" button, a blocked reason's
 * button, or Ctrl/Cmd+S on a document with a waiting save opens. A non-modal dialog under the pill:
 * no focus trap, no inert, Esc or a click outside closes it. The active editor view covers the
 * window below the tab strip, so the popover lives in a band of its own right under the strip
 * (and under the S6 bar when there is one): its height is added to the top inset while it is
 * open and the editor moves down by it. Rows and the cancel / save-again calls
 * come from the sync center (`window.uniworkSyncCenter`); without it the popover still opens and
 * only offers "Open sync center".
 */

export interface UniworkQueuePopoverProps {
  status: UniworkDocStatus
  opener: QueuePopoverOpener
  /** the pill group: focus returns here when the opener button is gone */
  anchorEl: HTMLElement | null
  /** the pill button that opened it (null when Ctrl/Cmd+S did); a click on it is the parent's toggle */
  openerEl: HTMLElement | null
  onClose: () => void
  /** the blocked reason's sign-in buttons */
  onSignIn: () => void
  /** Esc / close after a Ctrl/Cmd+S opening hands focus back to the editor */
  onFocusEditor?: () => void
}

/**
 * esc / action: focus goes back to where the popover came from (the pill button, else the pill;
 * the editor after a Ctrl/Cmd+S opening). handoff: an action that opens another surface which takes
 * the focus (the sync center). state: back to the pill only if focus was inside. outside: the
 * click put focus where it wanted.
 */
type CloseKind = 'esc' | 'state' | 'outside' | 'action' | 'handoff'

/** the sync-center row of one document, kept current by the pushed snapshots */
function useQueueRow(documentId: string): { row: SyncCenterRow | undefined; settled: boolean } {
  const [row, setRow] = useState<SyncCenterRow | undefined>(undefined)
  const [settled, setSettled] = useState(() => !window.uniworkSyncCenter)
  useEffect(() => {
    const api = window.uniworkSyncCenter
    if (!api) {
      setRow(undefined)
      setSettled(true)
      return
    }
    let live = true
    const take = (value: unknown) => {
      if (live) setRow(findQueueRow(asSyncCenterSnapshot(value), documentId))
    }
    void api
      .getSnapshot()
      .then(take)
      .catch(() => undefined)
      .finally(() => {
        if (live) setSettled(true)
      })
    const unsubscribe = api.subscribe(take)
    return () => {
      live = false
      unsubscribe()
    }
  }, [documentId])
  return { row, settled }
}

function actionErrorKey(result: Extract<SyncCenterActionResult, { ok: false }>): StringKey {
  if (result.code === 'draft_cap') return 'uwConflictDraftCapReached'
  if (result.code === 'store_full') return 'uwQueueFull'
  return 'uwSyncActionFailed'
}

export function UniworkQueuePopover({
  status,
  opener,
  anchorEl,
  openerEl,
  onClose,
  onSignIn,
  onFocusEditor,
}: UniworkQueuePopoverProps) {
  const { t, dateLocale } = useI18n()
  const { row, settled } = useQueueRow(status.documentId)
  const model = queuePopoverModelOf(status, row, opener)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closedRef = useRef(false)
  const mountedRef = useRef(true)
  const announcedRef = useRef(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<StringKey | null>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const barPx = useTopInsetPart('bar')
  // the band never asks for more than main will give: the bar plus the band stay within the cap,
  // and a taller text scrolls inside the dialog (the action row stays outside the scroll area)
  const room = popoverRoomOf(barPx)
  const [scrolls, setScrolls] = useState(false)
  // the dialog's left edge in the band's unscaled px; null until it is first placed (before paint)
  const [left, setLeft] = useState<number | null>(null)
  const lineId = useId()
  const confirmId = useId()

  const lineText = useCallback(
    (line: PopoverLine): string =>
      t(line.key, {
        time: line.time === undefined ? '—' : formatQueueTime(line.time, dateLocale),
        base: line.base ?? '—',
        reason: line.reasonKey ? t(line.reasonKey) : '',
        cap: QUEUE_DRAFT_CAP,
      }),
    [t, dateLocale],
  )
  const line1Text = lineText(model.line1)

  // keep the newest callbacks reachable from the long-lived listeners
  const live = useRef({ onClose, onFocusEditor, openerEl, anchorEl, opener, confirming })
  useLayoutEffect(() => {
    live.current = { onClose, onFocusEditor, openerEl, anchorEl, opener, confirming }
  })

  // the dialog's x follows the pill: right-aligned to its right edge, inside the window. The band spans
  // the window, the rects are window px and the band lays out in unscaled px (interface scale)
  const place = useCallback(() => {
    const dialog = dialogRef.current
    const band = bandRef.current
    if (!dialog || !band) return
    const scale = uiScaleOf(dialog)
    const bandWidth = band.getBoundingClientRect().width
    const next = popoverLeftOf({
      pillRight: (live.current.anchorEl?.getBoundingClientRect().right ?? Number.NaN) / scale,
      width: dialog.getBoundingClientRect().width / scale,
      windowWidth: (bandWidth > 0 ? bandWidth : window.innerWidth) / scale,
    })
    setLeft((prev) => (prev === next ? prev : next))
  }, [])
  // after every render: the pill may have moved since (a variant, a tab, a longer line)
  useLayoutEffect(place)
  useEffect(() => {
    window.addEventListener('resize', place)
    const sized = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    if (anchorEl) sized?.observe(anchorEl)
    if (dialogRef.current) sized?.observe(dialogRef.current)
    return () => {
      window.removeEventListener('resize', place)
      sized?.disconnect()
    }
  }, [place, anchorEl])

  const close = useCallback((kind: CloseKind) => {
    if (closedRef.current) return
    closedRef.current = true
    const cur = live.current
    const inside = dialogRef.current?.contains(document.activeElement) ?? false
    // an action that closes it also leaves focus inside the dialog about to unmount: never to <body>
    if (kind === 'esc' || ((kind === 'state' || kind === 'action') && inside)) {
      if (kind !== 'state' && cur.opener === 'ctrl-s') {
        cur.onFocusEditor?.()
      } else {
        const target = cur.openerEl?.isConnected ? cur.openerEl : cur.anchorEl
        target?.focus()
      }
    }
    cur.onClose()
  }, [])

  useEffect(() => {
    mountedRef.current = true
    dialogRef.current?.focus()
    return () => {
      mountedRef.current = false
    }
  }, [])

  // line 1 goes to the window's polite node once, when the row lookup has settled
  useEffect(() => {
    if (!settled || announcedRef.current) return
    announcedRef.current = true
    announce(line1Text)
  }, [settled, line1Text])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // the top-most popup first: Esc backs out of the cancel confirmation, a second one closes
      if (live.current.confirming) {
        setConfirming(false)
        return
      }
      close('esc')
    }
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null
      if (!target) return
      if (dialogRef.current?.contains(target)) return
      if (live.current.openerEl?.contains(target)) return
      close('outside')
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [close])

  // the save settled, or another document became the active one
  const stillShown = isQueuePopoverState(status)
  useEffect(() => {
    if (!stillShown) close('state')
  }, [stillShown, close])
  const pathRef = useRef(status.path)
  useEffect(() => {
    if (pathRef.current !== status.path) close('outside')
  }, [status.path, close])

  // the row decides line 1 and so the band height: wait for it (or the cap) before the band joins
  // the top inset, so the editor view moves once on open instead of once per line-1 variant
  const [capped, setCapped] = useState(false)
  useEffect(() => {
    if (settled) return
    const timer = setTimeout(() => setCapped(true), QUEUE_BAND_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [settled])
  const bandReady = settled || capped
  const roomRef = useRef(room)
  useLayoutEffect(() => {
    roomRef.current = room
  })

  // the band's height joins the top inset while it is open; closing gives the editor the room back
  useLayoutEffect(() => {
    const band = bandRef.current
    if (!band || !bandReady) return
    const measure = () => {
      setTopInsetPart('popover', Math.min(unscaledHeightOf(band), roomRef.current))
      const body = bodyRef.current
      setScrolls(body ? body.scrollHeight > body.clientHeight : false)
    }
    measure()
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      observer.observe(band)
      // the band can sit at its cap while the text shrinks inside it: the body is what changes
      if (bodyRef.current) observer.observe(bodyRef.current)
    }
    return () => observer?.disconnect()
  }, [bandReady])
  // the bar growing or shrinking moves the cap: measure again against the new room
  useLayoutEffect(() => {
    const band = bandRef.current
    if (!band || !bandReady) return
    setTopInsetPart('popover', Math.min(unscaledHeightOf(band), room))
  }, [bandReady, room])
  useLayoutEffect(() => () => setTopInsetPart('popover', 0), [])

  const wasConfirming = useRef(false)
  useEffect(() => {
    const root = dialogRef.current
    if (confirming) {
      root?.querySelector<HTMLElement>('[data-popover-back]')?.focus()
    } else if (wasConfirming.current) {
      root?.querySelector<HTMLElement>('[data-popover-action="cancel"]')?.focus()
    }
    wasConfirming.current = confirming
  }, [confirming])

  /** run a sync-center call; a refusal says why (assertive) and keeps the popover as it was */
  const call = async (name: string, run: () => Promise<SyncCenterActionResult>) => {
    if (busy !== null) return
    setBusy(name)
    setError(null)
    let result: SyncCenterActionResult
    try {
      result = await run()
    } catch {
      result = { ok: false, code: 'other' }
    }
    if (!mountedRef.current) return
    setBusy(null)
    if (result.ok) {
      if (name === 'cancel') announce(t('uwQueueCancelled'))
      close('action')
      return
    }
    const key = actionErrorKey(result)
    setError(key)
    announce(t(key, { cap: QUEUE_DRAFT_CAP }), { assertive: true })
  }

  const runAction = (id: PopoverActionId) => {
    const api = window.uniworkSyncCenter
    switch (id) {
      case 'sign-in':
      case 'sign-in-again':
        onSignIn()
        close('action')
        return
      case 'recheck':
        if (api && row) void call(id, () => api.recheck(row.id))
        return
      case 'save-again':
        if (api && row) void call(id, () => api.saveAgain(row.id))
        return
      case 'cancel':
        if (busy === null) setConfirming(true)
        return
      case 'open-center':
        window.dispatchEvent(
          new CustomEvent('uniwork:open-settings', { detail: { section: 'sync' } }),
        )
        close('handoff')
        return
    }
  }

  const goCancel = () => {
    const api = window.uniworkSyncCenter
    if (api && row) void call('cancel', () => api.cancelSave(row.id))
  }

  const actionButton = (action: PopoverAction) => (
    <button
      key={action.id}
      type="button"
      className="uw-queue-pop-btn"
      data-popover-action={action.id}
      aria-disabled={busy === action.id ? 'true' : undefined}
      onClick={() => runAction(action.id)}
    >
      {t(action.labelKey)}
    </button>
  )

  return (
    <div
      ref={bandRef}
      className="uw-queue-band"
      data-uw-queue-band=""
      style={
        {
          top: `calc(var(--tab-bar-height, 40px) + ${barPx}px)`,
          '--uw-queue-room': `${room}px`,
        } as CSSProperties
      }
    >
      <div
        ref={dialogRef}
        className="uw-queue-pop"
        role="dialog"
        tabIndex={-1}
        aria-labelledby={lineId}
        style={left === null ? undefined : { marginLeft: `${left}px` }}
      >
        <div
          ref={bodyRef}
          className="uw-queue-pop-body"
          // a body that scrolls is a keyboard stop (arrow keys scroll it); one that fits is not
          {...(scrolls ? { role: 'group', tabIndex: 0, 'aria-labelledby': lineId } : {})}
        >
          <p id={lineId} className="uw-queue-pop-line">
            {line1Text}
          </p>
          {model.line2 && (
            <p className="uw-queue-pop-line uw-queue-pop-sub">{lineText(model.line2)}</p>
          )}
          {model.line3 && (
            <p className="uw-queue-pop-line uw-queue-pop-sub">{lineText(model.line3)}</p>
          )}
          {error && <p className="uw-queue-pop-error">{t(error, { cap: QUEUE_DRAFT_CAP })}</p>}
          {confirming && (
            <p id={confirmId} className="uw-queue-pop-line">
              {t('uwQueueCancelConfirm')}
            </p>
          )}
        </div>
        {confirming ? (
          <div className="uw-queue-pop-actions">
            <button
              type="button"
              className="uw-queue-pop-btn uw-queue-pop-danger"
              aria-describedby={confirmId}
              aria-disabled={busy === 'cancel' ? 'true' : undefined}
              onClick={goCancel}
            >
              {t('uwQueueCancelGo')}
            </button>
            <button
              type="button"
              className="uw-queue-pop-btn"
              data-popover-back=""
              aria-describedby={confirmId}
              onClick={() => setConfirming(false)}
            >
              {t('uwActBack')}
            </button>
          </div>
        ) : (
          <div className="uw-queue-pop-actions">{model.actions.map(actionButton)}</div>
        )}
      </div>
    </div>
  )
}
