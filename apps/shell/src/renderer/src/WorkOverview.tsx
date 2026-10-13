import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type {
  UniworkWorkError,
  WorkHomeCounts,
  WorkHomeSource,
  WorkHomeSummary,
  WorkTask,
  WorkWebTarget,
} from '../../shared/uniwork-work-api'
import { FileBadge } from './FileBadge'
import { useI18n, type StringKey } from './locale'
import { MEETING_TINT, type Tint } from './module-tones'
import { docExtension, formatWhen } from './uniwork-docs-model'
import { openRecentEntry, openUniworkDocument } from './uniwork-open'
import { WbRowActions } from './WbRowActions'
import { CHECK_GLYPH, WorkbenchIcon } from './WorkbenchIcons'
import {
  buildHeadline,
  clock,
  dueState,
  formatDay,
  greetingKey,
  greetingName,
  HOME_REFRESH_MS,
  hourIn,
  inboxTarget,
  isQuiet,
  localDay,
  myWorkGroups,
  notificationKey,
  overdueDays,
  overviewView,
  useRecentDocuments,
  withTaskStatus,
  type MyWorkGroup,
} from './work-home'
import { settleWork, useWorkLoad } from './work-cache'
import {
  WorkErrorState,
  WorkNoWorkspace,
  WorkStaleNote,
  WorkStatePanel,
  WorkToast,
} from './WorkErrorState'

interface Props {
  /** null while the list loads */
  workspaces: readonly UniworkWorkspaceRef[] | null
  workspaceId: string | null
  workspaceError: UniworkWorkError | null
  refreshTick: number
  /** reload the workspace list and every server section (the top bar's Refresh) */
  onReload: () => void
  onCompose: () => void
  /** each summary on screen (null before one exists): the page redraws the tab counts on it */
  onSummary?: (summary: WorkHomeSummary | null) => void
}

const STATS: readonly {
  key: keyof WorkHomeCounts
  source: WorkHomeSource
  label: StringKey
  tone?: 'danger' | 'warning'
  section: string
  icon: 'tasks' | 'calendar' | 'inbox'
  tint?: Tint
}[] = [
  { key: 'open', source: 'tasks', label: 'wbOvStatOpen', section: 'wb-ov-mywork', icon: 'tasks' },
  {
    key: 'overdue',
    source: 'tasks',
    label: 'wbOvStatOverdue',
    tone: 'danger',
    section: 'wb-ov-mywork',
    icon: 'tasks',
  },
  {
    key: 'due_today',
    source: 'tasks',
    label: 'wbOvStatDueToday',
    tone: 'warning',
    section: 'wb-ov-mywork',
    icon: 'tasks',
  },
  {
    key: 'meetings_today',
    source: 'meetings',
    label: 'wbOvStatMeetingsToday',
    section: 'wb-ov-meetings',
    icon: 'calendar',
    tint: MEETING_TINT,
  },
  {
    key: 'unread',
    source: 'notifications',
    label: 'wbOvStatUnread',
    section: 'wb-ov-inbox',
    icon: 'inbox',
    tint: 'blue',
  },
]

const GROUP_LABEL: Record<MyWorkGroup, StringKey> = {
  overdue: 'wbTasksGroupOverdue',
  today: 'wbTasksGroupToday',
  upcoming: 'wbOvGroupUpcoming',
}

/** Tổng quan: the desktop window onto UniWork Home (spec §6.3, states §7). */
export function WorkOverview({
  workspaces,
  workspaceId,
  workspaceError,
  refreshTick,
  onReload,
  onCompose,
  onSummary,
}: Props): ReactElement {
  const { t, dateLocale } = useI18n()
  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null
  const wsId = workspace?.id ?? null
  const home = useWorkLoad<WorkHomeSummary>(
    wsId ? `home:${wsId}` : null,
    () => window.uniworkWork.homeSummary(wsId ?? ''),
    { refreshTick, intervalMs: HOME_REFRESH_MS },
  )
  const recents = useRecentDocuments(wsId, refreshTick)
  const [name, setName] = useState('')
  const [failedWrite, setFailedWrite] = useState<{ task: WorkTask; status: string } | null>(null)
  const view = overviewView({ workspaces, workspaceError, summary: home.value, error: home.error })
  const shown = view === 'ready' || view === 'stale' ? home.value : null
  const base = workspace ? { orgSlug: workspace.orgSlug, wsSlug: workspace.slug } : null

  useEffect(() => {
    void window.aiOffice.accountStatus().then(
      (status) => setName(status.profile?.displayName ?? ''),
      () => undefined,
    )
  }, [])

  // a ref, so an inline callback never re-fires the effect
  const onSummaryRef = useRef(onSummary)
  onSummaryRef.current = onSummary
  useEffect(() => {
    onSummaryRef.current?.(home.value)
  }, [home.value])

  const openWeb = (target: WorkWebTarget) => {
    void window.uniworkWork.openWeb(target).catch(() => false)
  }
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView?.({ block: 'start' })

  const setStatus = async (task: WorkTask, status: string) => {
    setFailedWrite(null)
    home.update((s) => withTaskStatus(s, task.id, status))
    const result = await settleWork(window.uniworkWork.setTaskStatus(task.id, status))
    if (result.ok) {
      home.reload() // counts, headline and the cache follow the server
      return
    }
    home.update((s) => withTaskStatus(s, task.id, task.status))
    setFailedWrite({ task, status })
  }

  const retryLine = (onRetry: () => void = home.reload) => (
    <p className="wb-ov-partial">
      {t('wbOvLoadFailed')} ·{' '}
      <button type="button" className="wb-link" onClick={onRetry}>
        {t('acctRetry')}
      </button>
    </p>
  )

  const header = (s: WorkHomeSummary): ReactNode => {
    const headline = buildHeadline(s)
    const liveId = headline.liveMeetingId
    const time: Record<string, string> = headline.at
      ? { time: clock(headline.at, dateLocale, s.timezone) }
      : {}
    return (
      <header className="wb-ov-head">
        <p className="wb-ov-date">{formatDay(s.today, dateLocale, true)}</p>
        <h2 className="wb-ov-greeting">
          {t(greetingKey(hourIn(s.timezone)), { name: greetingName(name) })}
        </h2>
        <div className="wb-ov-headline">
          <p>{t(headline.key, { ...headline.params, ...time })}</p>
          {liveId && base ? (
            <button
              type="button"
              className="wb-btn wb-btn-primary wb-btn-sm"
              onClick={() => openWeb({ kind: 'room', ...base, id: liveId })}
            >
              {t('wbOvJoin')}
            </button>
          ) : null}
        </div>
        {view === 'stale' && home.updatedAt !== null ? (
          <WorkStaleNote at={home.updatedAt} onRetry={onReload} />
        ) : null}
      </header>
    )
  }

  const stats = (s: WorkHomeSummary) => (
    <ul className="wb-ov-strip wb-block" aria-label={t('wbOvStatsLabel')}>
      {STATS.map((item) => {
        const value = s.counts[item.key]
        const top = (
          <span className="wb-ov-stat-top">
            <WorkbenchIcon id={item.icon} size={20} tint={item.tint} />
            <span className="wb-ov-stat-label">{t(item.label)}</span>
          </span>
        )
        return (
          <li key={item.key} className="wb-ov-stat">
            {value === null || s.partial.includes(item.source) ? (
              <div className="wb-ov-stat-body">
                {top}
                <span className="wb-ov-stat-value wb-num is-muted">—</span>
                <button type="button" className="wb-link" onClick={home.reload}>
                  {t('acctRetry')}
                </button>
              </div>
            ) : (
              <button type="button" className="wb-ov-stat-body" onClick={() => jump(item.section)}>
                {top}
                <span
                  className={`wb-ov-stat-value wb-num${value > 0 && item.tone ? ` is-${item.tone}` : ''}`}
                  data-testid={`wb-stat-${item.key}`}
                >
                  {value}
                </span>
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )

  const myWork = (s: WorkHomeSummary) => (
    <section id="wb-ov-mywork" className="wb-ov-card">
      <h3 className="wb-ov-card-title">{t('wbOvMyWork')}</h3>
      {s.partial.includes('tasks') ? (
        retryLine()
      ) : s.my_work.length === 0 ? (
        <p className="wb-ov-note">{t('wbOvMyWorkEmpty')}</p>
      ) : (
        <div className="wb-block">
          {myWorkGroups(s.my_work, s.today).map((group) => (
            <Fragment key={group.key}>
              <h4 className={`wb-group-head${group.key === 'overdue' ? ' is-overdue' : ''}`}>
                {t(GROUP_LABEL[group.key])} <span className="wb-num">{group.tasks.length}</span>
              </h4>
              <ul className="wb-ov-list">
                {group.tasks.map((task) => {
                  const done = task.status === 'done'
                  const due = dueState(task, s.today)
                  const open = () => base && openWeb({ kind: 'task', ...base, id: task.id })
                  return (
                    <li key={task.id} className={`wb-row${done ? ' is-done' : ''}`}>
                      <label className="wb-check">
                        <input
                          type="checkbox"
                          className="uw-sr-only"
                          checked={done}
                          aria-label={t('wbOvMarkDone', { title: task.title })}
                          onChange={() => void setStatus(task, done ? 'todo' : 'done')}
                        />
                        <span className="wb-check-box" aria-hidden="true">
                          {CHECK_GLYPH}
                        </span>
                      </label>
                      <button type="button" className="wb-ov-row-title" onClick={open}>
                        {task.title}
                      </button>
                      {task.identifier ? <span className="wb-mono">{task.identifier}</span> : null}
                      {due === 'overdue' ? (
                        <span className="wb-pill is-danger">
                          {t('wbOvDueOverdue', { count: overdueDays(s.today, task.due_date) })}
                        </span>
                      ) : due === 'today' ? (
                        <span className="wb-pill is-warning">{t('wbOvDueToday')}</span>
                      ) : due === 'later' && task.due_date ? (
                        <span className="wb-pill">
                          {t('wbOvDueOn', { date: formatDay(task.due_date, dateLocale, false) })}
                        </span>
                      ) : null}
                      <WbRowActions>
                        {/* pointer shortcut only: the title button is the keyboard and reader path */}
                        <button
                          type="button"
                          className="wb-btn wb-btn-ghost wb-btn-sm"
                          tabIndex={-1}
                          aria-hidden="true"
                          onClick={open}
                        >
                          {t('wbCommonOpen')} ↗
                        </button>
                      </WbRowActions>
                    </li>
                  )
                })}
              </ul>
            </Fragment>
          ))}
        </div>
      )}
    </section>
  )

  const meetings = (s: WorkHomeSummary) => (
    <section id="wb-ov-meetings" className="wb-ov-card">
      <h3 className="wb-ov-card-title">{t('wbOvMeetings')}</h3>
      {s.partial.includes('meetings') ? (
        retryLine()
      ) : s.upcoming_meetings.length === 0 ? (
        <p className="wb-ov-note">{t('wbOvMeetingsEmpty')}</p>
      ) : (
        <ul className="wb-ov-list wb-block">
          {s.upcoming_meetings.map((m) => {
            const live = m.status === 'IN_PROGRESS'
            const tomorrow = localDay(m.starts_at, s.timezone || 'UTC') !== s.today
            const minutes = Math.round((Date.parse(m.ends_at) - Date.parse(m.starts_at)) / 60_000)
            const sub = [
              live ? t('wbOvLive') : null,
              tomorrow ? t('wbOvTomorrow') : null,
              minutes > 0 ? t('wbOvMinutes', { count: minutes }) : null,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={m.id} className="wb-row">
                <span className="wb-mono wb-num wb-ov-time">
                  {clock(m.starts_at, dateLocale, s.timezone)}
                </span>
                <div className="wb-ov-meet">
                  <button
                    type="button"
                    className="wb-ov-row-title"
                    onClick={() => base && openWeb({ kind: 'meeting', ...base, id: m.id })}
                  >
                    {m.title}
                  </button>
                  {sub ? <span className="wb-ov-meet-sub">{sub}</span> : null}
                </div>
                {live ? (
                  <button
                    type="button"
                    className="wb-btn wb-btn-primary wb-btn-sm"
                    onClick={() => base && openWeb({ kind: 'room', ...base, id: m.id })}
                  >
                    {t('wbOvJoin')}
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )

  const inbox = (s: WorkHomeSummary) => (
    <section id="wb-ov-inbox" className="wb-ov-card">
      <h3 className="wb-ov-card-title">{t('wbOvInbox')}</h3>
      {s.partial.includes('notifications') ? (
        retryLine()
      ) : s.inbox.length === 0 ? (
        <p className="wb-ov-note">{t('wbOvInboxEmpty')}</p>
      ) : (
        <ul className="wb-ov-list wb-block">
          {s.inbox.map((n) => {
            const initial = (n.params.actor ?? '').trim().charAt(0).toUpperCase()
            return (
              <li key={n.id} className="wb-row">
                {initial ? (
                  <span className="wb-ov-avatar" aria-hidden="true">
                    {initial}
                  </span>
                ) : (
                  <WorkbenchIcon id="inbox" size={20} tint="blue" />
                )}
                <button
                  type="button"
                  className="wb-ov-row-title"
                  onClick={() => base && openWeb(inboxTarget(n, base))}
                >
                  {t(notificationKey(n.kind), n.params)}
                </button>
                <span className="wb-mono wb-num">{formatWhen(n.created_at, dateLocale)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )

  const recentStrip = (
    <section className="wb-ov-recents">
      <h3 className="wb-ov-card-title">{t('wbOvRecentDocs')}</h3>
      <ul className="wb-ov-recent-grid">
        {recents.docs.map((r) =>
          r.source === 'uniwork' ? (
            <li key={`u:${r.doc.id}`}>
              <button
                type="button"
                className="wb-ov-recent"
                onClick={() =>
                  void openUniworkDocument(
                    { documentId: r.doc.id, title: r.doc.title },
                    window.aiOffice,
                  )
                }
              >
                <FileBadge ext={docExtension(r.doc)} size={24} />
                <span className="wb-ov-recent-name">{r.doc.title}</span>
                <span className="wb-ov-recent-meta">{formatWhen(r.doc.updatedAt, dateLocale)}</span>
              </button>
            </li>
          ) : (
            <li key={`l:${r.entry.path}`}>
              <button
                type="button"
                className="wb-ov-recent"
                onClick={() => void openRecentEntry(r.entry, window.aiOffice)}
              >
                <FileBadge ext={r.entry.ext} size={24} />
                <span className="wb-ov-recent-name">{r.entry.name}</span>
                <span className="wb-ov-recent-meta">
                  {formatWhen(new Date(r.entry.mtimeMs).toISOString(), dateLocale)} ·{' '}
                  {t('wbOnThisDevice')}
                </span>
              </button>
            </li>
          ),
        )}
      </ul>
      {recents.cloudFailed ? retryLine(recents.reload) : null}
    </section>
  )

  return (
    <div className="wb-ov">
      {shown ? header(shown) : null}
      {view === 'loading' ? (
        <div className="wb-ov-skel" aria-hidden="true">
          <span className="wb-skel wb-skel-strip" />
          <span className="wb-skel wb-skel-row" />
          <span className="wb-skel wb-skel-row" />
          <span className="wb-skel wb-skel-row" />
        </div>
      ) : null}
      {view === 'signed-out' || view === 'forbidden' || view === 'unreachable' ? (
        <WorkErrorState state={workspaceError ?? home.error ?? 'offline'} onRetry={onReload} />
      ) : null}
      {view === 'no-workspace' ? <WorkNoWorkspace error={null} onRetry={onReload} /> : null}
      {shown && !isQuiet(shown) ? stats(shown) : null}
      {recents.docs.length > 0 || recents.cloudFailed ? recentStrip : null}
      {shown ? (
        isQuiet(shown) ? (
          <WorkStatePanel
            tone="gray"
            icon={<WorkbenchIcon id="desk" size={20} />}
            title={t('wbOvQuiet')}
            action={{ label: t('wbOvQuietAction'), onClick: onCompose, variant: 'secondary' }}
            role="status"
          />
        ) : (
          <div className="wb-ov-body">
            {myWork(shown)}
            <div className="wb-ov-aside">
              {meetings(shown)}
              {inbox(shown)}
            </div>
          </div>
        )
      ) : null}
      {failedWrite ? (
        <WorkToast
          message="wbOvTaskUpdateFailed"
          onRetry={() => void setStatus(failedWrite.task, failedWrite.status)}
          onDismiss={() => setFailedWrite(null)}
        />
      ) : null}
    </div>
  )
}
