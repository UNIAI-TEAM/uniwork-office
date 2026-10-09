import { useCallback, useEffect, useRef, useState } from 'react'
import type { TabSummary } from '../../shared/tabs-api'
import type { UniworkDocStatus } from '../../shared/home-api'
import { useI18n } from './locale'
import { useAccount } from './account-model'
import { onUniworkNotice } from './uniwork-notice-bus'
import {
  chipCopy,
  chipModelOf,
  launchNoticeOf,
  pathKey,
  type ChipActionKind,
  type LaunchNotice,
} from './uniwork-docs-model'

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
  return { statusOf, apply }
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

/** Saved / Unsaved / Saving / View only / Offline / Sign in / Conflict / Blocked / Error for the active tab */
export function UniworkStatusChip({
  status,
  onStatus,
}: {
  status: UniworkDocStatus
  onStatus: (status: UniworkDocStatus) => void
}) {
  const { t, dateLocale } = useI18n()
  const account = useAccount()
  const [busy, setBusy] = useState(false)
  const accountOk = account.view === 'signed-in' || account.view === 'refreshing'
  const model = chipModelOf(status, { needsSignIn: !accountOk })
  const { label, tip } = chipCopy(model, t, dateLocale)

  const run = (kind: ChipActionKind) => {
    if (kind === 'sign-in') {
      account.signIn()
      return
    }
    setBusy(true)
    const call =
      kind === 'retry'
        ? window.aiOffice.uniworkSave(status.path)
        : window.aiOffice.uniworkResolveConflict(status.path)
    void call
      .then((next) => {
        if (next) onStatus(next)
      })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }

  return (
    <div className="uw-pill" data-tone={model.tone} data-state={status.state} title={tip}>
      <span className="uw-pill-status" role="status">
        {model.tone === 'busy' ? <Spinner /> : <span className="uw-pill-dot" aria-hidden="true" />}
        <span className="uw-pill-label">{label}</span>
      </span>
      {model.action && (
        <button
          type="button"
          className="uw-pill-action"
          disabled={busy}
          onClick={() => run(model.action!.kind)}
        >
          {t(model.action.labelKey)}
        </button>
      )}
    </div>
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
export function UniworkNotice() {
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

  return notice ? <NoticePill notice={notice} onDismiss={() => setNotice(null)} /> : null
}
