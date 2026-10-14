import { Fragment, useState } from 'react'
import type { ReactElement } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type {
  UniworkWorkError,
  WorkHomeSummary,
  WorkTask,
  WorkWebTarget,
} from '../../shared/uniwork-work-api'
import { docNotifications } from './desk-model'
import { useI18n, type StringKey } from './locale'
import { CHECK_GLYPH } from './WorkbenchIcons'
import {
  clock,
  dueState,
  formatDay,
  localDay,
  myWorkGroups,
  overdueDays,
  withTaskStatus,
  type OverviewView,
} from './work-home'
import { settleWork, type WorkLoad } from './work-cache'
import { WorkErrorState, WorkNoWorkspace, WorkStaleNote, WorkToast } from './WorkErrorState'

interface Props {
  home: WorkLoad<WorkHomeSummary>
  view: OverviewView
  workspace: UniworkWorkspaceRef | null
  workspaceError: UniworkWorkError | null
  /** reload the workspace list and every server section (the top bar's Refresh) */
  onReload: () => void
  onOpenTasks: () => void
}

const TODAY_TASKS = 6
const GROUP_LABEL: Record<'overdue' | 'today', StringKey> = {
  overdue: 'wbTasksGroupOverdue',
  today: 'wbTasksGroupToday',
}

/** The Desk's right column (office desk spec §3.4): the date, due tasks, meetings, other notifications. */
export function DeskToday({
  home,
  view,
  workspace,
  workspaceError,
  onReload,
  onOpenTasks,
}: Props): ReactElement {
  const { t, dateLocale } = useI18n()
  const [failedWrite, setFailedWrite] = useState<{ task: WorkTask; status: string } | null>(null)
  const shown = view === 'ready' || view === 'stale' ? home.value : null
  const base = workspace ? { orgSlug: workspace.orgSlug, wsSlug: workspace.slug } : null
  const today =
    shown?.today ??
    localDay(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone)

  const openWeb = (target: WorkWebTarget) => {
    void window.uniworkWork.openWeb(target).catch(() => false)
  }

  const setStatus = async (task: WorkTask, status: string) => {
    setFailedWrite(null)
    home.update((s) => withTaskStatus(s, task.id, status))
    const result = await settleWork(window.uniworkWork.setTaskStatus(task.id, status))
    if (result.ok) {
      home.reload() // counts and the cache follow the server
      return
    }
    home.update((s) => withTaskStatus(s, task.id, task.status))
    setFailedWrite({ task, status })
  }

  const retryLine = (
    <p className="wb-ov-partial">
      {t('wbOvLoadFailed')} ·{' '}
      <button type="button" className="wb-link" onClick={home.reload}>
        {t('acctRetry')}
      </button>
    </p>
  )

  const tasks = (s: WorkHomeSummary) => {
    if (s.partial.includes('tasks')) return retryLine
    let left = TODAY_TASKS
    const groups = myWorkGroups(s.my_work, s.today)
      .filter((g): g is { key: 'overdue' | 'today'; tasks: WorkTask[] } => g.key !== 'upcoming')
      .map((g) => {
        const listed = g.tasks.slice(0, left)
        left -= listed.length
        return { ...g, tasks: listed }
      })
      .filter((g) => g.tasks.length > 0)
    if (groups.length === 0) return <p className="wb-ov-note">{t('wbDeskTodayNoTasks')}</p>
    return (
      <div className="wb-block">
        {groups.map((group) => (
          <Fragment key={group.key}>
            <h4 className={`wb-group-head${group.key === 'overdue' ? ' is-overdue' : ''}`}>
              {t(GROUP_LABEL[group.key])} <span className="wb-num">{group.tasks.length}</span>
            </h4>
            <ul className="wb-ov-list">
              {group.tasks.map((task) => {
                const done = task.status === 'done'
                const due = dueState(task, s.today)
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
                    <button
                      type="button"
                      className="wb-ov-row-title"
                      onClick={() => base && openWeb({ kind: 'task', ...base, id: task.id })}
                    >
                      {task.title}
                    </button>
                    {due === 'overdue' ? (
                      <span className="wb-pill wb-num is-danger">
                        {t('wbOvDueOverdue', { count: overdueDays(s.today, task.due_date) })}
                      </span>
                    ) : due === 'today' ? (
                      <span className="wb-pill is-warning">{t('wbOvDueToday')}</span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Fragment>
        ))}
      </div>
    )
  }

  const meetings = (s: WorkHomeSummary) => (
    <section className="wb-ov-card">
      <h3 className="wb-ov-card-title">{t('wbOvMeetings')}</h3>
      {s.partial.includes('meetings') ? (
        retryLine
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
                  {sub ? <span className="wb-ov-meet-sub wb-num">{sub}</span> : null}
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

  const others = (s: WorkHomeSummary) => {
    // document comments and mentions sit in the tray; the rest live on the web inbox
    // the inbox is a capped preview; counts.unread is the true total when it loaded
    const unread =
      !s.partial.includes('notifications') && s.counts.unread !== null
        ? s.counts.unread
        : s.inbox.filter((x) => !x.read_at).length
    const n = Math.max(0, unread - docNotifications(s.inbox).length)
    return n > 0 && base ? (
      <p className="wb-ov-note">
        <button
          type="button"
          className="wb-link"
          onClick={() => openWeb({ kind: 'inbox', ...base })}
        >
          {t('wbDeskOtherNotifs', { count: n })} →
        </button>
      </p>
    ) : null
  }

  return (
    <aside className="wb-desk-side" aria-label={t('wbDeskToday')}>
      <header>
        <p className="wb-ov-date wb-num">{formatDay(today, dateLocale, true)}</p>
        <div className="wb-desk-head">
          <h3>{t('wbDeskToday')}</h3>
          {shown ? (
            <button type="button" className="wb-link" onClick={onOpenTasks}>
              {t('wbDeskAllTasks')} →
            </button>
          ) : null}
        </div>
        {view === 'stale' && home.updatedAt !== null ? (
          <WorkStaleNote at={home.updatedAt} onRetry={onReload} />
        ) : null}
      </header>
      {view === 'loading' ? (
        <div className="wb-ov-skel" aria-hidden="true">
          <span className="wb-skel wb-skel-row" />
          <span className="wb-skel wb-skel-row" />
        </div>
      ) : null}
      {view === 'signed-out' || view === 'forbidden' || view === 'unreachable' ? (
        <WorkErrorState state={workspaceError ?? home.error ?? 'offline'} onRetry={onReload} />
      ) : null}
      {view === 'no-workspace' ? <WorkNoWorkspace error={null} onRetry={onReload} /> : null}
      {shown ? (
        <>
          {tasks(shown)}
          {meetings(shown)}
          {others(shown)}
        </>
      ) : null}
      {failedWrite ? (
        <WorkToast
          message="wbOvTaskUpdateFailed"
          onRetry={() => void setStatus(failedWrite.task, failedWrite.status)}
          onDismiss={() => setFailedWrite(null)}
        />
      ) : null}
    </aside>
  )
}
