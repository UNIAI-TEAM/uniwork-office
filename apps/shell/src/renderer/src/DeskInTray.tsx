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
import { DocPickerList } from './doclist/PickerList'
import { useI18n, type StringKey } from './locale'
import { openUniworkDocument } from './uniwork-open'
import { WorkbenchIcon } from './WorkbenchIcons'
import { notificationKey, type OverviewView } from './work-home'
import type { WorkLoad } from './work-cache'
import { WorkSkeleton, WorkStatePanel, WorkspacePickerContext } from './WorkErrorState'

/** px the picker keeps clear at a row's end: the pill (and, on a sync problem, Resolve) */
const TRAIL_PILL = 128
const TRAIL_RESOLVE = 232

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
  const { t } = useI18n()
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
    /** the row as the picker list's document: its date, editor and file type */
    doc: UniworkDocSummary
    /** what stands in for the file badge (a person or the inbox mark); null = the file's badge */
    icon: ReactNode | null
    title: string
    sub: string
    pill: { tone: 'danger' | 'info' | 'neutral'; label: StringKey }
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
        // a notification names a document but not its type: the person (or the inbox mark) is the icon
        doc: { id: `n:${n.id}`, workspaceId: '', title, format: null, updatedAt: n.created_at },
        icon: actor ? (
          <span className="wb-desk-avatar" aria-hidden="true">
            {initials(actor)}
          </span>
        ) : (
          <WorkbenchIcon id="inbox" size={24} tint="blue" />
        ),
        title,
        sub: t(notificationKey(n.kind), n.params),
        pill: {
          tone: 'info',
          label: n.kind === 'document_mentioned' ? 'wbDeskPillMention' : 'wbDeskPillComment',
        },
        resolve: false,
        open: () => void openNote(n.id, n.resource_id, title),
      }
    }
    if (r.kind === 'shared') {
      const d = r.doc
      return {
        key: `s:${d.id}`,
        doc: d,
        icon: null,
        title: d.title,
        sub: [t('wbDeskReasonShared'), d.workspaceName].filter(Boolean).join(' · '),
        pill: { tone: 'neutral', label: 'wbDeskPillShared' },
        resolve: false,
        open: () => void openUniworkDocument({ documentId: d.id, title: d.title }, window.aiOffice),
      }
    }
    const s = r.status
    const conflict = s.state === 'conflict'
    return {
      key: `y:${s.path}`,
      doc: {
        id: `y:${s.path}`,
        workspaceId: s.workspaceId,
        title: s.title,
        format: s.format as UniworkDocSummary['format'],
        updatedAt: s.lastSavedAt ?? '',
      },
      icon: null,
      title: s.title,
      sub: t(conflict ? 'wbDeskReasonConflict' : 'wbDeskReasonSync'),
      pill: { tone: 'danger', label: conflict ? 'wbDeskPillConflict' : 'wbDeskPillSync' },
      resolve: true,
      open: () =>
        void openUniworkDocument({ documentId: s.documentId, title: s.title }, window.aiOffice),
    }
  }

  const described = visible.map(describe)
  const byId = new Map(described.map((d) => [d.doc.id, d]))

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
        <>
          <DocPickerList
            docs={described.map((d) => d.doc)}
            label={t('wbDeskInTray')}
            activeId={null}
            semantics="list"
            listRef={listRef}
            reserve={described.some((d) => d.resolve) ? TRAIL_RESOLVE : TRAIL_PILL}
            iconFor={(doc) => byId.get(doc.id)?.icon ?? null}
            sublineFor={(doc) => {
              const sub = byId.get(doc.id)?.sub
              return sub ? { short: sub, full: sub } : null
            }}
            nameFor={(doc) => {
              const d = byId.get(doc.id)
              if (!d) return null
              return (
                <button
                  type="button"
                  id={`${titleId}-row${described.indexOf(d)}`}
                  className="wb-row-title wb-desk-row-title"
                >
                  {d.title}
                </button>
              )
            }}
            // the whole row opens (the title button's click bubbles here, so it opens once)
            optionProps={(doc) => ({ onClick: byId.get(doc.id)?.open })}
            trailing={(doc) => {
              const d = byId.get(doc.id)
              if (!d) return null
              return (
                <span className="wb-desk-trail">
                  <span
                    className={`wb-pill${d.pill.tone === 'neutral' ? '' : ` is-${d.pill.tone}`}`}
                  >
                    {t(d.pill.label)}
                  </span>
                  {d.resolve ? (
                    <button
                      type="button"
                      className="wb-btn wb-btn-secondary wb-btn-sm wb-desk-row-act"
                      aria-describedby={`${titleId}-row${described.indexOf(d)}`}
                      onClick={d.open}
                    >
                      {t('wbDeskResolve')}
                    </button>
                  ) : null}
                </span>
              )
            }}
          />
          {rows.length > visible.length ? (
            <div className="wb-desk-more">
              <button type="button" className="wb-link" onClick={() => setExpanded(true)}>
                {t('wbDeskMore', { count: rows.length - visible.length })}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
