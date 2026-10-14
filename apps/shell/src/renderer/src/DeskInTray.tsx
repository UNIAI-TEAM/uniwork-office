import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { RecentEntry, UniworkDocStatus, UniworkDocSummary } from '../../shared/home-api'
import type { WorkHomeSummary } from '../../shared/uniwork-work-api'
import {
  docNotifications,
  freshShared,
  initials,
  inTrayRows,
  syncProblems,
  type InTrayRow,
} from './desk-model'
import { FileBadge } from './FileBadge'
import { useI18n, type StringKey } from './locale'
import { docExtension, formatWhen } from './uniwork-docs-model'
import { openUniworkDocument } from './uniwork-open'
import { WorkbenchIcon } from './WorkbenchIcons'
import { notificationKey, type OverviewView } from './work-home'
import type { WorkLoad } from './work-cache'
import { WorkSkeleton, WorkStatePanel, WorkspacePickerContext } from './WorkErrorState'

const TRAY_ROWS = 8
/** working copies whose sync state is asked for (one stat each in main) */
const SYNC_PROBES = 20

interface Props {
  home: WorkLoad<WorkHomeSummary>
  /** a workspace is selected: the server sources can load */
  signedIn: boolean
  /** the page's server state: which note an empty tray shows */
  view: OverviewView
  /** this device's recents as listed (working copies included) */
  local: readonly RecentEntry[]
  /** reload the workspace list and every server section (the top bar's Refresh) */
  onReload?: () => void
  /** bumped by the top bar's Refresh: "Shared with you" reloads too */
  refreshTick?: number
}

/** "Cần bạn xử lý" (office desk spec §3.1): sync problems, comments and mentions, new shares. */
export function DeskInTray({
  home,
  signedIn,
  view,
  local,
  onReload,
  refreshTick,
}: Props): ReactElement {
  const { t, dateLocale } = useI18n()
  const pickWorkspace = useContext(WorkspacePickerContext)
  const titleId = useId()
  const [shared, setShared] = useState<UniworkDocSummary[]>([])
  const [statuses, setStatuses] = useState<Record<string, UniworkDocStatus>>({})
  const [expanded, setExpanded] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!signedIn) {
      setShared([])
      return
    }
    let live = true
    void window.aiOffice.uniworkListSharedWithMe({ limit: 20 }).then(
      (r) => {
        if (live) setShared(r.ok ? r.value.documents : [])
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [signedIn, refreshTick])

  const bound = useMemo(
    () =>
      local
        .filter((e) => e.uniwork)
        .slice(0, SYNC_PROBES)
        .map((e) => e.path),
    [local],
  )
  const boundKey = bound.join('\n')
  useEffect(() => {
    const paths = boundKey ? boundKey.split('\n') : []
    let live = true
    // paths an event updated while the probes ran: the event is newer than the probe
    const touched = new Set<string>()
    void Promise.all(paths.map((p) => window.aiOffice.uniworkDocStatus(p).catch(() => null))).then(
      (list) => {
        if (!live) return
        const fresh = Object.fromEntries(list.flatMap((s) => (s ? [[s.path, s]] : [])))
        setStatuses((m) => ({
          ...fresh,
          ...Object.fromEntries(Object.entries(m).filter(([p]) => touched.has(p))),
        }))
      },
    )
    const off = window.aiOffice.onUniworkDocStatus((s) => {
      if (!paths.includes(s.path)) return
      touched.add(s.path)
      setStatuses((m) => ({ ...m, [s.path]: s }))
    })
    return () => {
      live = false
      off()
    }
  }, [boundKey])

  // "Show more" removes itself: focus goes on to the first row it revealed
  useEffect(() => {
    if (expanded)
      listRef.current?.querySelectorAll<HTMLButtonElement>('.wb-desk-row-title')[TRAY_ROWS]?.focus()
  }, [expanded])

  const rows = inTrayRows({
    notes: home.value ? docNotifications(home.value.inbox) : [],
    shared: freshShared(shared, local, Date.now()),
    sync: syncProblems(Object.values(statuses)),
  })
  const visible = expanded ? rows : rows.slice(0, TRAY_ROWS)

  const openNote = async (id: string, documentId: string, title: string) => {
    // a failed open keeps the reminder
    if (!(await openUniworkDocument({ documentId, title }, window.aiOffice))) return
    const r = await window.uniworkWork.markNotificationsRead([id]).catch(() => null)
    // a refusal is quiet: the row comes back with the next summary
    if (r?.ok)
      home.update((s) => ({
        ...s,
        inbox: s.inbox.filter((n) => n.id !== id),
        counts: {
          ...s.counts,
          unread: s.counts.unread === null ? null : Math.max(0, s.counts.unread - 1),
        },
      }))
  }

  const describe = (
    r: InTrayRow,
  ): {
    key: string
    icon: ReactNode
    title: string
    sub: string
    pill: { tone: 'danger' | 'info' | 'neutral'; label: StringKey }
    at: string
    /** a sync problem's visible next step; other rows show their time */
    resolve: boolean
    open: () => void
  } => {
    if (r.kind === 'note') {
      const n = r.note
      const title = n.params.document ?? ''
      const actor = n.params.actor ?? ''
      return {
        key: `n:${n.id}`,
        icon: actor ? (
          <span className="wb-desk-avatar" aria-hidden="true">
            {initials(actor)}
          </span>
        ) : (
          <WorkbenchIcon id="inbox" size={28} tint="blue" />
        ),
        title,
        sub: t(notificationKey(n.kind), n.params),
        pill: {
          tone: 'info',
          label: n.kind === 'document_mentioned' ? 'wbDeskPillMention' : 'wbDeskPillComment',
        },
        at: n.created_at,
        resolve: false,
        open: () => void openNote(n.id, n.resource_id, title),
      }
    }
    if (r.kind === 'shared') {
      const d = r.doc
      return {
        key: `s:${d.id}`,
        icon: <FileBadge ext={docExtension(d)} size={24} />,
        title: d.title,
        sub: [t('wbDeskReasonShared'), d.workspaceName].filter(Boolean).join(' · '),
        pill: { tone: 'neutral', label: 'wbDeskPillShared' },
        at: d.updatedAt,
        resolve: false,
        open: () => void openUniworkDocument({ documentId: d.id, title: d.title }, window.aiOffice),
      }
    }
    const s = r.status
    const conflict = s.state === 'conflict'
    return {
      key: `y:${s.path}`,
      icon: <FileBadge ext={s.format} size={24} />,
      title: s.title,
      sub: t(conflict ? 'wbDeskReasonConflict' : 'wbDeskReasonSync'),
      pill: { tone: 'danger', label: conflict ? 'wbDeskPillConflict' : 'wbDeskPillSync' },
      at: s.lastSavedAt ?? '',
      resolve: true,
      open: () =>
        void openUniworkDocument({ documentId: s.documentId, title: s.title }, window.aiOffice),
    }
  }

  // an empty tray only says "nothing waiting" when the notifications really loaded;
  // signed out, offline or locked out, the Desk banner (or Today) already says why
  const empty = (): ReactNode => {
    if (view === 'loading') return <WorkSkeleton rows={2} />
    if (view === 'forbidden' && pickWorkspace)
      return (
        <p className="wb-ov-note">
          {t('wbDeskNoServerData')} ·{' '}
          <button type="button" className="wb-link" onClick={pickWorkspace}>
            {t('wbOvPickWorkspace')}
          </button>
        </p>
      )
    if (view === 'signed-out' || view === 'unreachable' || view === 'forbidden')
      return <p className="wb-ov-note">{t('wbDeskNoServerData')}</p>
    if (view === 'no-workspace') return <p className="wb-ov-note">{t('wbOvNoWorkspaceTitle')}</p>
    if (home.error || home.value?.partial.includes('notifications'))
      return (
        <p className="wb-ov-partial">
          {t('wbOvLoadFailed')} ·{' '}
          <button type="button" className="wb-link" onClick={onReload ?? home.reload}>
            {t('acctRetry')}
          </button>
        </p>
      )
    return (
      <WorkStatePanel
        tone="gray"
        icon={<WorkbenchIcon id="inbox" size={20} />}
        title={t('wbDeskInTrayEmpty')}
        role="status"
        compact
      />
    )
  }

  return (
    <section className="wb-desk-card wb-block" aria-labelledby={titleId}>
      <div className="wb-desk-head">
        <h3 id={titleId}>{t('wbDeskInTray')}</h3>
        {rows.length > 0 ? <span className="wb-desk-count wb-num">{rows.length}</span> : null}
      </div>
      {rows.length === 0 ? (
        empty()
      ) : (
        <ul ref={listRef} className="wb-ov-list">
          {visible.map((r) => {
            const d = describe(r)
            return (
              <li key={d.key} className="wb-row wb-desk-row">
                {d.icon}
                <span className="wb-desk-row-main">
                  <button type="button" className="wb-row-title wb-desk-row-title" onClick={d.open}>
                    {d.title}
                  </button>
                  {d.sub ? <span className="wb-desk-reason">{d.sub}</span> : null}
                </span>
                <span className={`wb-pill${d.pill.tone === 'neutral' ? '' : ` is-${d.pill.tone}`}`}>
                  {t(d.pill.label)}
                </span>
                {d.resolve ? (
                  <button
                    type="button"
                    className="wb-btn wb-btn-secondary wb-btn-sm wb-desk-row-act"
                    onClick={d.open}
                  >
                    {t('wbDeskResolve')}
                  </button>
                ) : (
                  <span className="wb-desk-when wb-num">
                    {d.at ? formatWhen(d.at, dateLocale) : null}
                  </span>
                )}
              </li>
            )
          })}
          {rows.length > visible.length ? (
            <li className="wb-row">
              <button type="button" className="wb-link" onClick={() => setExpanded(true)}>
                {t('wbDeskMore', { count: rows.length - visible.length })}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  )
}
