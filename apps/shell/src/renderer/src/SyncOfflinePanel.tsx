import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  OfflineFailure,
  OfflineLibrarySnapshot,
  OfflineResult,
  OfflineRowView,
  OfflineUnpinResult,
  UniworkOfflineLibraryApi,
} from '../../shared/offline-library'
import { useI18n } from './locale'
import {
  OFFLINE_CALLS,
  formatUsageBytes,
  offlineFailureCopy,
  offlineRowModel,
  readyTransitions,
  type OfflineAction,
  type OfflineActionId,
  type OfflineRowModel,
} from './offline-library-model'
import { formatBytes, type SyncLine } from './sync-center-model'
import { UniworkOpenDialog } from './UniworkOpenDialog'
import { WbMenuButton } from './WbMenu'

export type OfflineApi = Partial<UniworkOfflineLibraryApi>

/**
 * S3 tab "Dùng khi không có mạng" (G5-05u): the tabpanel's content. Usage
 * header (`uwOfflineUsage` + "Thêm tài liệu…") above one table of S3 rows, in
 * the S2 table's look. Main owns every state; this panel sends intents only
 * (pin / unpin / cancel / download / open / open folder) and reads the
 * projection. The offline copy is view-only: no row offers editing it.
 */
export function SyncOfflinePanel({
  base,
  offline,
  signedOut,
  narrow,
  api,
  fmt,
  setLive,
  onSignIn,
  onSwitchAccount,
  accountView,
}: {
  /** the pane's id base */
  base: string
  offline: OfflineLibrarySnapshot
  signedOut: boolean
  narrow: boolean
  api: OfflineApi | undefined
  fmt: (line: SyncLine) => string
  /** the pane's polite live node */
  setLive: (text: string) => void
  onSignIn?: () => void
  onSwitchAccount?: () => void
  accountView: 'signed-in' | 'session-expired'
}): ReactElement {
  const { t, dateLocale } = useI18n()
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const busyRef = useRef<Set<string>>(new Set())
  /** the row whose unpin main answered `needs_confirm`, and where focus goes back to */
  const [confirm, setConfirm] = useState<{ documentId: string; from: 'unpin' | 'more' } | null>(
    null,
  )
  const [focusAfter, setFocusAfter] = useState<{ documentId: string; from: string } | null>(null)
  /** the last refusal shown in the panel (cap reached): visible text, also read once */
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const backRef = useRef<HTMLButtonElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  // "Sẵn sàng offline: {doc}" once per row that reaches ready (polite, never the first snapshot)
  const lastStates = useRef<Map<string, OfflineRowView['state']> | null>(null)
  useEffect(() => {
    const ready = readyTransitions(lastStates.current, offline.rows)
    lastStates.current = new Map(offline.rows.map((r) => [r.documentId, r.state]))
    if (ready.length > 0) {
      setLive(ready.map((r) => t('uwOfflineReadyAnnounce', { doc: r.name })).join(' '))
    }
    // `t` is not stable (CLAUDE.md): the announcement reads the current one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline.rows, setLive])

  // a confirm whose row is gone or lost its Bỏ ghim closes
  useEffect(() => {
    if (!confirm) return
    const row = offline.rows.find((r) => r.documentId === confirm.documentId)
    const still =
      row &&
      offlineRowModel(row, { capabilityOn: offline.capabilityOn }).actions.some(
        (a) => a.id === 'unpin',
      )
    if (still) return
    const hadFocus = Boolean(document.activeElement?.closest('.sc-confirm'))
    setConfirm(null)
    if (hadFocus) setFocusAfter({ documentId: confirm.documentId, from: confirm.from })
  }, [offline, confirm])

  useEffect(() => {
    if (confirm) backRef.current?.focus()
  }, [confirm])

  useLayoutEffect(() => {
    if (!focusAfter) return
    const rowEl = Array.from(
      tableRef.current?.querySelectorAll<HTMLElement>('tr[data-row-id]') ?? [],
    ).find((el) => el.dataset.rowId === focusAfter.documentId)
    const target =
      focusAfter.from === 'more'
        ? rowEl?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
        : rowEl?.querySelector<HTMLElement>(`[data-action="${focusAfter.from}"]`)
    ;(target ?? tableRef.current?.closest<HTMLElement>('[role="tabpanel"]'))?.focus()
    setFocusAfter(null)
  }, [focusAfter])

  const failed = (doc: string, failure: OfflineFailure) => {
    const copy = offlineFailureCopy(failure, dateLocale)
    const text = t(copy.key, copy.params)
    if (failure.code === 'offline_cap_reached') {
      setNotice(text)
      setLive(text)
      return
    }
    setLive(t('uwSyncRowAnnounce', { doc, state: text }))
  }

  const call = (
    id: OfflineActionId,
    documentId: string,
    confirmed = false,
  ): Promise<OfflineResult | OfflineUnpinResult> => {
    const none = Promise.resolve<OfflineResult>({ ok: false, code: 'unknown' })
    switch (id) {
      case 'open':
        return api?.offlineOpen?.(documentId) ?? none
      case 'unpin':
        return api?.offlineUnpin?.(documentId, confirmed ? { confirmed: true } : undefined) ?? none
      case 'cancelDownload':
        return api?.offlineCancel?.(documentId) ?? none
      case 'openFolder':
        return api?.offlineOpenFolder?.() ?? none
      default:
        // Tải ngay / Thử lại / Kết nối lại / Kiểm tra lại: main downloads (and renews) the pin again
        return api?.offlineDownloadNow?.(documentId) ?? none
    }
  }

  const run = async (
    row: OfflineRowView,
    id: OfflineActionId,
    from: 'unpin' | 'more',
    confirmed = false,
  ) => {
    const key = row.documentId
    if (busyRef.current.has(key)) return
    busyRef.current.add(key)
    setBusy(new Set(busyRef.current))
    setNotice(null)
    let result: OfflineResult | OfflineUnpinResult
    try {
      result = await call(id, row.documentId, confirmed)
    } catch {
      result = { ok: false, code: 'unknown' }
    }
    busyRef.current.delete(key)
    setBusy(new Set(busyRef.current))
    if (result.ok) return
    // the document still has drafts or queued saves: ask before the copy goes (never deletes them)
    if (id === 'unpin' && result.code === 'needs_confirm' && !confirmed) {
      setConfirm({ documentId: row.documentId, from })
      return
    }
    // a refused open names its S11 lock: main shows the panel, nothing more to say here
    if (id === 'open' && result.lockReason) return
    failed(row.name, result)
  }

  const activate = (row: OfflineRowView, a: OfflineAction, from: 'unpin' | 'more') => {
    if (a.id === 'signIn' || a.id === 'signInAgain') return onSignIn?.()
    if (a.id === 'switchAccount') return onSwitchAccount?.()
    if (a.id === 'retryKeystore') {
      void Promise.resolve(window.aiOffice?.accountRetry?.()).catch(() => undefined)
      return
    }
    if (OFFLINE_CALLS.has(a.id)) void run(row, a.id, a.id === 'unpin' ? from : 'more')
  }

  const closeConfirm = () => {
    if (!confirm) return
    setFocusAfter({ documentId: confirm.documentId, from: confirm.from })
    setConfirm(null)
  }

  const goConfirm = async (row: OfflineRowView) => {
    if (!confirm || busyRef.current.has(row.documentId)) return
    const { from } = confirm
    await run(row, 'unpin', from, true)
    setConfirm((cur) => (cur?.documentId === row.documentId ? null : cur))
    setFocusAfter({ documentId: row.documentId, from })
  }

  /** "Thêm tài liệu…" in pin mode: a chosen document is pinned, not opened; the dialog stays */
  const pinChosen = async (doc: {
    id: string
    title: string
    workspaceId: string
  }): Promise<string | null> => {
    setNotice(null)
    let result: OfflineResult
    try {
      result = (await api?.offlinePin?.({ documentId: doc.id, workspaceId: doc.workspaceId })) ?? {
        ok: false,
        code: 'unknown',
      }
    } catch {
      result = { ok: false, code: 'unknown' }
    }
    if (result.ok) return null
    const copy = offlineFailureCopy(result, dateLocale)
    const text = t(copy.key, copy.params)
    if (result.code === 'offline_cap_reached') setNotice(text)
    return text
  }

  const renderActions = (row: OfflineRowView, model: OfflineRowModel) => {
    const rowBusy = busy.has(row.documentId)
    if (confirm?.documentId === row.documentId) {
      const sentence = `${base}-off-confirm-${row.documentId}`
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
            {t('uwOfflineUnpinConfirm')}
          </span>
          <button
            type="button"
            className="set-btn danger sc-act"
            aria-describedby={sentence}
            aria-disabled={rowBusy || undefined}
            onClick={() => void goConfirm(row)}
          >
            {t('uwOfflineUnpinShort')}
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
    const button = (a: OfflineAction) => (
      <span key={a.id} className="sc-act-wrap">
        <button
          type="button"
          className="set-btn sc-act"
          data-action={a.id}
          aria-disabled={rowBusy && OFFLINE_CALLS.has(a.id) ? true : undefined}
          onClick={() => activate(row, a, 'unpin')}
        >
          {t(a.labelKey)}
        </button>
      </span>
    )
    if (!narrow || model.actions.length <= 1) return model.actions.map(button)
    const [first, ...rest] = model.actions
    return (
      <>
        {button(first!)}
        <WbMenuButton
          label={t('uwSyncMoreActions', { doc: row.name })}
          items={rest.map((a) => ({
            label: t(a.labelKey),
            disabled: rowBusy && OFFLINE_CALLS.has(a.id),
            onSelect: () => activate(row, a, 'more'),
          }))}
        />
      </>
    )
  }

  const renderRow = (row: OfflineRowView) => {
    const model = offlineRowModel(row, { capabilityOn: offline.capabilityOn })
    const docId = `${base}-off-doc-${row.documentId}`
    const openable = model.actions.some((a) => a.id === 'open')
    const determinate = Boolean(model.progress && model.progress.total > 0)
    return (
      <tr
        key={row.documentId}
        data-row-id={row.documentId}
        className="sc-row"
        aria-label={t('uwSyncRowAnnounce', { doc: row.name, state: t(model.badge.key) })}
      >
        <th scope="row" className="sc-doc" id={docId}>
          {openable ? (
            <button
              type="button"
              className="sc-doc-btn"
              onClick={() => void run(row, 'open', 'more')}
            >
              {row.name}
            </button>
          ) : (
            <span className="sc-doc-text">{row.name}</span>
          )}
        </th>
        <td className="sc-state">
          <span className="sc-badge" data-tone={model.badge.tone}>
            {t(model.badge.key)}
          </span>
        </td>
        <td className="sc-detail">
          <span className="sc-sub">
            {model.progress && !determinate
              ? model.progress.done > 0
                ? formatBytes(model.progress.done, dateLocale)
                : ''
              : fmt(model.sub)}
          </span>
          {model.progress && (
            <span
              className="sc-progress"
              role="progressbar"
              aria-labelledby={docId}
              aria-valuemin={determinate ? 0 : undefined}
              aria-valuemax={determinate ? model.progress.total : undefined}
              aria-valuenow={determinate ? model.progress.done : undefined}
              aria-valuetext={
                determinate
                  ? t('uwOfflineRowProgressAria', {
                      done: formatBytes(model.progress.done, dateLocale),
                      total: formatBytes(model.progress.total, dateLocale),
                    })
                  : undefined
              }
            >
              <span
                className="sc-progress-fill"
                style={{
                  width: `${determinate ? Math.min(100, (model.progress.done / model.progress.total) * 100) : 0}%`,
                }}
              />
            </span>
          )}
        </td>
        <td className="sc-actions">{renderActions(row, model)}</td>
      </tr>
    )
  }

  // signed out: the number of kept items only, never a document name
  if (signedOut) {
    return (
      <p className="sc-empty">
        {t('uwSyncSignedOut', { count: offline.signedOutLockedCount ?? 0 })}
      </p>
    )
  }

  return (
    <div ref={tableRef}>
      <div className="sc-usage">
        <span className="sc-usage-text">
          {t('uwOfflineUsage', {
            used: formatUsageBytes(offline.quota.usedBytes, dateLocale),
            cap: formatUsageBytes(offline.quota.maxBytes, dateLocale),
          })}
        </span>
        {offline.capabilityOn && (
          <button
            type="button"
            className="set-btn"
            aria-haspopup="dialog"
            onClick={() => setAdding(true)}
          >
            {t('uwOfflineAdd')}
          </button>
        )}
      </div>
      {notice && <p className="sc-notice">{notice}</p>}
      {offline.rows.length === 0 ? (
        <p className="sc-empty">{t('uwOfflineEmpty')}</p>
      ) : (
        <div className="sc-table-wrap">
          <table className="sc-table">
            <caption className="sc-caption">{t('uwSyncTabOffline')}</caption>
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
            <tbody>{offline.rows.map(renderRow)}</tbody>
          </table>
        </div>
      )}
      {adding && (
        <UniworkOpenDialog
          onClose={() => setAdding(false)}
          accountView={accountView}
          onSignIn={() => onSignIn?.()}
          onPick={pinChosen}
        />
      )}
    </div>
  )
}
