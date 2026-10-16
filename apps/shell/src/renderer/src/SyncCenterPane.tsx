import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, RefObject } from 'react'
import { formatSizeMB } from '../../shared/size-format'
import type {
  SyncCenterActionResult,
  SyncCenterRow,
  SyncCenterSnapshot,
  SyncCenterTabId,
  UniworkSyncCenterApi,
} from '../../shared/sync-center'
import { useI18n } from './locale'
import { WbMenuButton } from './WbMenu'
import {
  DRAFT_CAP,
  SYNC_TABS,
  actionErrorKey,
  formatBytes,
  formatTime,
  headerLine,
  resolveHeaderStatus,
  rowView,
  type SyncLine,
  type SyncRowAction,
  type SyncRowActionId,
  type SyncRowView,
} from './sync-center-model'
import './sync-center.css'

/** below this width the center is one column and a row keeps only its first action visible */
const NARROW_WIDTH = 640

/** the actions that only open or close a line under the row (no call to main) */
const DISCLOSURES: ReadonlySet<SyncRowActionId> = new Set(['guide', 'details'])

/** the actions that change a row's saved state: one runs per row at a time */
const STATE_CHANGING: ReadonlySet<SyncRowActionId> = new Set([
  'sendNow',
  'cancelSave',
  'discardSave',
  'discardDraft',
  'saveAgain',
  'recheck',
])

/** busy keys are `${rowId}:${actionId}`; the rows with a state-changing action running */
function busyRowIds(keys: Iterable<string>): Set<string> {
  const rows = new Set<string>()
  for (const k of keys) {
    const at = k.lastIndexOf(':')
    if (STATE_CHANGING.has(k.slice(at + 1) as SyncRowActionId)) rows.add(k.slice(0, at))
  }
  return rows
}

/** width of the pane from a ResizeObserver; a 0 width (not laid out) keeps the wide layout */
function useNarrow(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0
      if (width > 0) setNarrow(width < NARROW_WIDTH)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return narrow
}

/** which row action has its in-row Discard confirm open, and where focus goes back to */
interface ConfirmState {
  rowId: string
  action: SyncRowAction
  /** the action's own button, or the row's "…" trigger when it came from the menu */
  from: SyncRowActionId | 'more'
}

/**
 * S2 Sync center (G5-10): Sync header + status line, the Sync tab tablist and one
 * table of Sync rows per tab. Main owns every state; this pane reads the snapshot
 * and calls `window.uniworkSyncCenter`. Sign-out reuses the account's own flow
 * (`onSignOut`); the G5-11 Sign-out prompt is wired by a follow-up.
 */
export function SyncCenterPane({
  api = window.uniworkSyncCenter,
  onSignIn,
  onSignOut,
  onSwitchAccount,
}: {
  api?: UniworkSyncCenterApi
  /** "Đăng nhập" / "Đăng nhập lại" */
  onSignIn?: () => void
  /** "Đăng xuất" on the account line */
  onSignOut?: () => void
  /** "Chuyển tài khoản" (blocked `foreign_account`) */
  onSwitchAccount?: () => void
}): ReactElement {
  const { t, dateLocale } = useI18n()
  const base = useId()
  const rootRef = useRef<HTMLElement>(null)
  const narrow = useNarrow(rootRef)
  const [snap, setSnapState] = useState<SyncCenterSnapshot | null>(null)
  // focus inside an open confirm is read before the snapshot's render can remove its row
  const focusInConfirm = useRef(false)
  const setSnap = useCallback((next: SyncCenterSnapshot) => {
    if (document.activeElement?.closest('.sc-confirm')) focusInConfirm.current = true
    setSnapState(next)
  }, [])
  const [loadFailed, setLoadFailed] = useState(false)
  const [tab, setTab] = useState<SyncCenterTabId | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  /** `${rowId}:${guide|details}` whose explanation line is open */
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const busyRef = useRef<Set<string>>(new Set())
  const [live, setLiveState] = useState({ text: '', seq: 0 })
  // a new seq remounts the live child, so the same message twice in a row is read twice
  const setLive = useCallback(
    (text: string) => setLiveState((cur) => ({ text, seq: cur.seq + 1 })),
    [],
  )
  const confirmRef = useRef<ConfirmState | null>(null)
  confirmRef.current = confirm
  const [focusAfter, setFocusAfter] = useState<{ rowId: string; from: string } | null>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const panelRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)

  const read = useCallback(() => {
    if (!api) {
      setLoadFailed(true)
      return Promise.resolve()
    }
    return api.getSnapshot().then(
      (next) => {
        setLoadFailed(false)
        setSnap(next)
      },
      () => setLoadFailed(true),
    )
  }, [api, setSnap])

  useEffect(() => {
    if (!api) {
      setLoadFailed(true)
      return
    }
    let alive = true
    void api.getSnapshot().then(
      (next) => {
        if (!alive) return
        setLoadFailed(false)
        setSnap(next)
      },
      () => alive && setLoadFailed(true),
    )
    const off = api.subscribe((next) => {
      if (!alive) return
      setLoadFailed(false)
      setSnap(next)
    })
    return () => {
      alive = false
      off()
    }
  }, [api, setSnap])

  // the default tab is chosen once, from the first snapshot; later pushes keep the user's tab
  useEffect(() => {
    if (snap && tab === null) setTab(snap.defaultTab)
  }, [snap, tab])

  const fmt = (line: SyncLine): string => {
    const params: Record<string, string | number> = { ...line.params }
    const nestedParams =
      line.reasonMaxBytes !== undefined
        ? { max: formatSizeMB(line.reasonMaxBytes, dateLocale, 'exact') }
        : undefined
    for (const [k, v] of Object.entries(line.keyParams ?? {})) params[k] = t(v, nestedParams)
    for (const [k, v] of Object.entries(line.timeParams ?? {}))
      params[k] = formatTime(v, dateLocale)
    for (const [k, v] of Object.entries(line.sizeParams ?? {}))
      params[k] = formatBytes(v, dateLocale)
    return t(line.key, params)
  }

  const header = snap?.header
  const status = header ? resolveHeaderStatus(header) : null
  const line = header ? headerLine(header, snap?.signedOut) : null
  const lineText = line ? fmt(line) : ''
  const lineKey = line?.key ?? null

  // the status line is visible copy (not live): a change of status after the first one is read
  // once, politely. The status key is compared, not the text, which carries the last sync time.
  const lastLine = useRef<string | null>(null)
  const lineTextRef = useRef(lineText)
  lineTextRef.current = lineText
  useEffect(() => {
    if (!lineKey) return
    if (lastLine.current !== null && lastLine.current !== lineKey) setLive(lineTextRef.current)
    lastLine.current = lineKey
  }, [lineKey, setLive])

  function titleOf(r: SyncCenterRow, view: SyncRowView): string {
    return view.hideTitle ? t('uwLockForeignTitle') : r.title
  }

  // each row's badge and its "{doc}: {state}" line, derived from the snapshot
  const rowStates = new Map<string, { badge: string; text: string }>()
  for (const list of snap ? Object.values(snap.tabs) : []) {
    for (const r of list) {
      const view = rowView(r, { online: snap?.header.online ?? true })
      rowStates.set(r.id, {
        badge: view.badge.key,
        text: t('uwSyncRowAnnounce', { doc: titleOf(r, view), state: t(view.badge.key) }),
      })
    }
  }
  const rowStatesRef = useRef(rowStates)
  rowStatesRef.current = rowStates
  // a row the user did not act on that changed state is read once, politely
  const lastStates = useRef<Map<string, string> | null>(null)
  const actedOn = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!snap) return
    const now = rowStatesRef.current
    const before = lastStates.current
    lastStates.current = new Map(Array.from(now, ([id, s]) => [id, s.badge]))
    if (!before) return
    let changed: string | null = null
    for (const [id, s] of now) {
      const was = before.get(id)
      if (was === undefined || was === s.badge) continue
      if (actedOn.current.has(id)) continue
      changed ??= s.text
    }
    // the user's own acted-on marks end with this snapshot, except for a call still in flight
    const inFlight = busyRowIds(busyRef.current)
    for (const id of Array.from(actedOn.current)) if (!inFlight.has(id)) actedOn.current.delete(id)
    if (changed) setLive(changed)
  }, [snap, setLive])

  // an open confirm is for the row and action the user saw: a pushed snapshot that removes the
  // row or drops that action closes it (focus moves only if it was inside the confirm)
  useEffect(() => {
    const hadFocus = focusInConfirm.current
    focusInConfirm.current = false
    const open = confirmRef.current
    if (!snap || !open) return
    const current = Object.values(snap.tabs)
      .flat()
      .find((r) => r.id === open.rowId)
    const still =
      current &&
      rowView(current, { online: snap.header.online }).actions.some((a) => a.id === open.action.id)
    if (still) return
    setConfirm(null)
    if (hadFocus) setFocusAfter({ rowId: open.rowId, from: open.from })
  }, [snap])

  // focus back after an in-row confirm closes: its trigger, or the panel when the row is gone
  useLayoutEffect(() => {
    if (!focusAfter) return
    const rowEl = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('tr[data-row-id]') ?? [],
    ).find((el) => el.dataset.rowId === focusAfter.rowId)
    const target =
      focusAfter.from === 'more'
        ? rowEl?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
        : rowEl?.querySelector<HTMLElement>(`[data-action="${focusAfter.from}"]`)
    ;(target ?? panelRef.current)?.focus()
    setFocusAfter(null)
  }, [focusAfter])

  useEffect(() => {
    if (confirm) backRef.current?.focus()
  }, [confirm])

  const call = (id: SyncRowActionId, rowId: string): Promise<SyncCenterActionResult> => {
    if (!api) return Promise.resolve({ ok: false, code: 'other' })
    switch (id) {
      case 'sendNow':
        return api.sendNow(rowId)
      case 'cancelSave':
        return api.cancelSave(rowId)
      case 'copySupport':
        return api.copySupportCode(rowId)
      case 'downloadMine':
        return api.saveMyCopy(rowId)
      case 'discardSave':
        return api.discardSave(rowId)
      case 'open':
      case 'openToResolve':
        return api.openDocument(rowId)
      case 'openDraft':
        return api.openDraft(rowId)
      case 'discardDraft':
        return api.discardDraft(rowId)
      case 'saveAgain':
        return api.saveAgain(rowId)
      default:
        // Kiểm tra lại / Kết nối lại / Thử lại: main re-verifies (and re-dispatches) the intent
        return api.recheck(rowId)
    }
  }

  const successCopy = (id: SyncRowActionId, doc: string): string | null => {
    if (id === 'cancelSave') return t('uwQueueCancelled')
    if (id === 'copySupport') return t('uwSyncRowAnnounce', { doc, state: t('setMcpCopied') })
    if (id === 'discardSave') return t('uwSyncRowAnnounce', { doc, state: t('uwBadgeKeptDraft') })
    return null
  }

  /** runs one row action against main; the outcome goes to the polite live node */
  const runAction = async (r: SyncCenterRow, view: SyncRowView, a: SyncRowAction) => {
    const key = `${r.id}:${a.id}`
    if (busyRef.current.has(key)) return
    // one state-changing action per row at a time: main would race two of them
    if (busyRowIds(busyRef.current).has(r.id)) return
    busyRef.current.add(key)
    setBusy(new Set(busyRef.current))
    // only a state change is the user's own: copy, download and open leave the badge alone
    if (STATE_CHANGING.has(a.id)) actedOn.current.add(r.id)
    const doc = titleOf(r, view)
    let result: SyncCenterActionResult
    try {
      result = await call(a.id, r.id)
    } catch {
      result = { ok: false, code: 'other' }
    }
    busyRef.current.delete(key)
    setBusy(new Set(busyRef.current))
    // a refused or failed call changed nothing: the row's next real change is still announced
    if (!result.ok) actedOn.current.delete(r.id)
    if (result.ok) {
      const done = successCopy(a.id, doc)
      if (done) setLive(done)
    } else {
      setLive(
        t('uwSyncRowAnnounce', { doc, state: t(actionErrorKey(result.code), { cap: DRAFT_CAP }) }),
      )
    }
  }

  const activate = (
    r: SyncCenterRow,
    view: SyncRowView,
    a: SyncRowAction,
    from: SyncRowActionId | 'more',
  ) => {
    if (a.unavailableKey) return
    if (a.id === 'signIn' || a.id === 'signInAgain') return onSignIn?.()
    if (a.id === 'switchAccount') return onSwitchAccount?.()
    if (DISCLOSURES.has(a.id)) {
      const k = `${r.id}:${a.id}`
      setExpanded((cur) => (cur === k ? null : k))
      return
    }
    // the row has a state-changing call in flight: nothing else of it starts (no confirm either)
    if (busyRowIds(busyRef.current).has(r.id)) return
    if (a.confirm) {
      setConfirm({ rowId: r.id, action: a, from })
      return
    }
    void runAction(r, view, a)
  }

  const closeConfirm = () => {
    if (!confirm) return
    setFocusAfter({ rowId: confirm.rowId, from: confirm.from })
    setConfirm(null)
  }

  const goConfirm = async (r: SyncCenterRow, view: SyncRowView) => {
    if (!confirm) return
    const { action, from } = confirm
    // a repeat click while the call runs does nothing (Go is only aria-disabled)
    if (busyRowIds(busyRef.current).has(r.id)) return
    await runAction(r, view, action)
    // only this row's confirm closes: another row's may have opened while the call ran
    if (confirmRef.current?.rowId !== r.id) return
    setConfirm(null)
    setFocusAfter({ rowId: r.id, from })
  }

  const syncNow = () => {
    if (!api || !header) return
    // a feed stopped on refused resyncs is restarted by this click, offline or not
    if (!header.online && !header.resyncFailed) {
      setLive(t('uwSyncNowOffline'))
      return
    }
    void api.syncNow().then(
      (res) => !res.ok && setLive(t(actionErrorKey(res.code), { cap: DRAFT_CAP })),
      () => setLive(t('uwSyncActionFailed')),
    )
  }

  const togglePause = () => {
    if (!api || !header) return
    void api.setSendingPaused(!header.paused).then(
      (res) => !res.ok && setLive(t(actionErrorKey(res.code), { cap: DRAFT_CAP })),
      () => setLive(t('uwSyncActionFailed')),
    )
  }

  const [retrying, setRetrying] = useState(false)
  const retryStore = () => {
    if (retrying) return
    setRetrying(true)
    void (api?.retryStore() ?? Promise.resolve({ ok: false, code: 'other' } as const))
      .catch(() => undefined)
      .then(read)
      .finally(() => setRetrying(false))
  }

  const tabIndexOf = (id: SyncCenterTabId) => SYNC_TABS.findIndex((d) => d.id === id)
  const selectTab = (i: number) => {
    const n = SYNC_TABS.length
    const next = SYNC_TABS[(i + n) % n]!
    setTab(next.id)
    setConfirm(null)
    tabRefs.current[(i + n) % n]?.focus()
  }
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabIndexOf(tab ?? 'attention')
    if (e.key === 'ArrowRight') selectTab(at + 1)
    else if (e.key === 'ArrowLeft') selectTab(at - 1)
    else if (e.key === 'Home') selectTab(0)
    else if (e.key === 'End') selectTab(SYNC_TABS.length - 1)
    else return
    e.preventDefault()
  }

  const title = (
    <h3 className="set-pane-title" id={`${base}-title`}>
      {t('uwSyncTitle')}
    </h3>
  )
  const liveNode = (
    <div className="uw-sr-only" role="status">
      <span key={live.seq}>{live.text}</span>
    </div>
  )

  // priority 1: the store needs a newer app, the S11 panel replaces the whole center
  if (snap && status === 'store_newer') {
    return (
      <section className="sc" ref={rootRef} aria-labelledby={`${base}-title`}>
        {title}
        <div className="sc-lock" role="region" aria-labelledby={`${base}-lock`}>
          <h4 className="sc-lock-title" id={`${base}-lock`}>
            {t('uwLockNewerStoreTitle')}
          </h4>
          <p className="sc-lock-body">{t('uwLockNewerStore')}</p>
        </div>
        {liveNode}
      </section>
    )
  }

  const busyRows = busyRowIds(busy)
  const signedOut = status === 'signed_out'
  // "Đồng bộ ngay" is the only way out of a stopped feed (header 7), so it never reads as offline then
  const offline = header ? !header.online && !header.resyncFailed : false
  const nowReason = `${base}-now-reason`

  const renderActions = (r: SyncCenterRow, view: SyncRowView) => {
    if (confirm?.rowId === r.id) {
      const sentence = `${base}-confirm-${r.id}`
      return (
        <div
          className="sc-confirm"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            closeConfirm()
          }}
        >
          <span id={sentence} className="sc-confirm-text">
            {t(confirm.action.confirm!.sentenceKey)}
          </span>
          <button
            type="button"
            className="set-btn danger sc-act"
            aria-describedby={sentence}
            aria-disabled={busyRows.has(r.id) || undefined}
            onClick={() => void goConfirm(r, view)}
          >
            {t(confirm.action.confirm!.goKey)}
          </button>
          <button
            type="button"
            className="sc-link"
            aria-describedby={sentence}
            ref={backRef}
            onClick={closeConfirm}
          >
            {t('uwActBack')}
          </button>
        </div>
      )
    }
    const button = (a: SyncRowAction) => {
      const reasonId = a.unavailableKey ? `${base}-why-${r.id}-${a.id}` : undefined
      const running = busy.has(`${r.id}:${a.id}`)
      const disclosure = DISCLOSURES.has(a.id)
      const rowBusy = busyRows.has(r.id) && !disclosure
      return (
        <span key={a.id} className="sc-act-wrap">
          <button
            type="button"
            className={`set-btn sc-act${a.primary ? ' primary' : ''}${a.confirm ? ' sc-act-danger' : ''}`}
            data-action={a.id}
            aria-disabled={a.unavailableKey || running || rowBusy ? true : undefined}
            aria-busy={running || undefined}
            aria-describedby={reasonId}
            aria-expanded={disclosure ? expanded === `${r.id}:${a.id}` : undefined}
            onClick={() => activate(r, view, a, a.id)}
          >
            {t(a.labelKey)}
          </button>
          {reasonId && (
            <span id={reasonId} className="uw-sr-only">
              {t(a.unavailableKey!)}
            </span>
          )}
        </span>
      )
    }
    if (!narrow || view.actions.length <= 1) return view.actions.map(button)
    const [first, ...rest] = view.actions
    return (
      <>
        {button(first!)}
        <WbMenuButton
          label={t('uwSyncMoreActions', { doc: titleOf(r, view) })}
          items={rest.map((a) => ({
            label: t(a.labelKey),
            danger: Boolean(a.confirm),
            disabled: Boolean(a.unavailableKey) || (busyRows.has(r.id) && !DISCLOSURES.has(a.id)),
            hint: a.unavailableKey ? t(a.unavailableKey) : undefined,
            onSelect: () => activate(r, view, a, 'more'),
          }))}
        />
      </>
    )
  }

  const renderRow = (r: SyncCenterRow) => {
    const view = rowView(r, { online: snap?.header.online ?? true })
    const doc = titleOf(r, view)
    const docId = `${base}-doc-${r.id}`
    const open = view.hideTitle ? null : view.opens
    const disclosure = expanded?.startsWith(`${r.id}:`) ? expanded.slice(r.id.length + 1) : null
    return (
      <tr
        key={r.id}
        data-row-id={r.id}
        className="sc-row"
        aria-label={t('uwSyncRowAnnounce', { doc, state: t(view.badge.key) })}
      >
        <th scope="row" className="sc-doc" id={docId}>
          {open ? (
            <button
              type="button"
              className="sc-doc-btn"
              onClick={() =>
                void runAction(r, view, {
                  id: open === 'draft' ? 'openDraft' : 'open',
                  labelKey: 'uwActOpen',
                })
              }
            >
              {doc}
            </button>
          ) : (
            <span className="sc-doc-text">{doc}</span>
          )}
        </th>
        <td className="sc-state">
          <span className="sc-badge" data-tone={view.badge.tone}>
            {t(view.badge.key)}
          </span>
        </td>
        <td className="sc-detail">
          <span className="sc-sub">{fmt(view.sub)}</span>
          {view.progress && (
            <span
              className="sc-progress"
              role="progressbar"
              aria-labelledby={docId}
              aria-valuemin={0}
              aria-valuemax={view.progress.total}
              aria-valuenow={view.progress.done}
              aria-valuetext={t('uwOfflineRowProgressAria', {
                done: formatBytes(view.progress.done, dateLocale),
                total: formatBytes(view.progress.total, dateLocale),
              })}
            >
              <span
                className="sc-progress-fill"
                style={{
                  width: `${view.progress.total > 0 ? Math.min(100, (view.progress.done / view.progress.total) * 100) : 0}%`,
                }}
              />
            </span>
          )}
          {disclosure === 'guide' && <span className="sc-more-text">{t('uwTipReconciling')}</span>}
          {disclosure === 'details' && (
            <span className="sc-more-text">
              {fmt({
                key: 'uwTipFailed',
                keyParams: view.sub.keyParams,
                reasonMaxBytes: view.sub.reasonMaxBytes,
              })}
            </span>
          )}
        </td>
        <td className="sc-actions">{renderActions(r, view)}</td>
      </tr>
    )
  }

  // an unreadable queue: only the notice + Thử lại under the title, no "connected" claim or sync controls
  const storeFailed = loadFailed || Boolean(snap?.storeError)

  const renderBody = () => {
    if (storeFailed) {
      return (
        <div className="sc-store-error">
          <p>{t('uwSyncStoreError')}</p>
          <button
            type="button"
            className="set-btn"
            aria-disabled={retrying || undefined}
            aria-busy={retrying || undefined}
            onClick={retryStore}
          >
            {t('uwActRetry')}
          </button>
        </div>
      )
    }
    if (!snap) {
      return (
        <div className="sc-skeleton" aria-busy="true">
          <span className="uw-sr-only">{t('wbLoading')}</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="sc-skeleton-row" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      )
    }
    // signed out: only the locked count (in the status line), never a document name
    if (signedOut) return null
    const current = SYNC_TABS.find((d) => d.id === tab) ?? SYNC_TABS[0]!
    const rows = snap.tabs[current.id]
    const panelId = `${base}-panel-${current.id}`
    return (
      <>
        <div className="sc-tabs" role="tablist" aria-label={t('uwSyncTitle')} onKeyDown={onTabKey}>
          {SYNC_TABS.map((d, i) => {
            const selected = d.id === current.id
            const count = snap.tabs[d.id].length
            return (
              <button
                key={d.id}
                ref={(el) => {
                  tabRefs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`${base}-tab-${d.id}`}
                className="sc-tab"
                aria-selected={selected}
                aria-controls={selected ? panelId : undefined}
                aria-label={t('uwSyncTabCount', { label: t(d.labelKey), count })}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(i)}
              >
                {t(d.labelKey)}
                <span className="sc-tab-count" aria-hidden="true">
                  {count}
                </span>
              </button>
            )
          })}
        </div>
        <div
          className="sc-panel"
          role="tabpanel"
          id={panelId}
          aria-labelledby={`${base}-tab-${current.id}`}
          tabIndex={-1}
          ref={panelRef}
        >
          {rows.length === 0 ? (
            <p className="sc-empty">{t(current.emptyKey)}</p>
          ) : (
            <table className="sc-table">
              <caption className="sc-caption">{t(current.labelKey)}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sc-col sc-col-doc">
                    {t('uwSyncColDoc')}
                  </th>
                  <th scope="col" className="sc-col sc-col-state">
                    {t('uwSyncColState')}
                  </th>
                  <th scope="col" className="sc-col sc-col-detail">
                    {t('uwSyncColDetail')}
                  </th>
                  <th scope="col" className="sc-col sc-col-actions">
                    <span className="sc-col-hidden">{t('uwSyncColActions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>{rows.map(renderRow)}</tbody>
            </table>
          )}
        </div>
      </>
    )
  }

  return (
    <section
      className={`sc${narrow ? ' is-narrow' : ''}`}
      ref={rootRef}
      aria-labelledby={`${base}-title`}
    >
      {title}
      {header && line && !storeFailed && (
        <div className="sc-header">
          {!signedOut && header.account && (
            <div className="sc-account">
              <span className="sc-account-name">{header.account.name}</span>
              {header.org && <span className="sc-account-org">{header.org.name}</span>}
              {header.storeBudget && (
                <span className="sc-budget">
                  {t('uwSyncStoreBudget', {
                    used: formatBytes(header.storeBudget.used, dateLocale),
                    cap: formatBytes(header.storeBudget.cap, dateLocale),
                  })}
                </span>
              )}
              {onSignOut && (
                <button type="button" className="sc-link" onClick={onSignOut}>
                  {t('uwSignOutGo')}
                </button>
              )}
            </div>
          )}
          <p className="sc-status-line" data-tone={line.tone}>
            <span>{lineText}</span>
            {line.action && (
              <button type="button" className="set-btn primary" onClick={() => onSignIn?.()}>
                {t(line.action === 'signIn' ? 'uwActSignIn' : 'uwActSignInAgain')}
              </button>
            )}
          </p>
          {header.otherOrgHasIntents && (
            <p className="sc-other-org">
              {t('uwSyncOtherOrg', { count: header.otherOrgCount ?? 0 })}
            </p>
          )}
          {!signedOut && (
            <div className="sc-controls">
              <button
                type="button"
                className="set-btn"
                aria-disabled={offline || undefined}
                aria-describedby={offline ? nowReason : undefined}
                onClick={syncNow}
              >
                {t('uwSyncNow')}
              </button>
              <button type="button" className="set-btn" onClick={togglePause}>
                {t(header.paused ? 'uwSyncResume' : 'uwSyncPause')}
              </button>
              {offline && (
                <span id={nowReason} className="sc-reason">
                  {t('uwSyncNowOffline')}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {renderBody()}
      {liveNode}
    </section>
  )
}
