import { useId } from 'react'
import type { ReactElement } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { WorkHomeSummary, WorkTask, WorkWebTarget } from '../../shared/uniwork-work-api'
import { docNotifications } from './desk-model'
import { useI18n } from './locale'
import { CHECK_GLYPH, WbGlyph } from './WorkbenchIcons'
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
import { WorkErrorState, WorkNoWorkspace, WorkSkeleton, WorkStaleNote } from './WorkErrorState'
import { useWbToast } from './WbToastHost'

interface Props {
  home: WorkLoad<WorkHomeSummary>
  view: OverviewView
  workspace: UniworkWorkspaceRef | null
  /** reload the workspace list and every server section (the top bar's Refresh) */
  onReload: () => void
  onOpenTasks: () => void
}

const TODAY_TASKS = 6

/** The Desk's Today card (redesign spec 4.1): the date, due tasks, meetings, other notifications. */
export function DeskToday({ home, view, workspace, onReload, onOpenTasks }: Props): ReactElement {
  const { t, dateLocale } = useI18n()
  const toasts = useWbToast()
  const titleId = useId()
  const shown = view === 'ready' || view === 'stale' ? home.value : null
  const base = workspace ? { orgSlug: workspace.orgSlug, wsSlug: workspace.slug } : null
  const today =
    shown?.today ??
    localDay(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone)

  const openWeb = (target: WorkWebTarget) => {
    void window.uniworkWork.openWeb(target).catch(() => false)
  }

  const setStatus = async (task: WorkTask, status: string) => {
    toasts.dismiss('desk-today-write')
    home.update((s) => withTaskStatus(s, task.id, status))
    const result = await settleWork(window.uniworkWork.setTaskStatus(task.id, status))
    if (result.ok) {
      home.reload() // counts and the cache follow the server
      return
    }
    home.update((s) => withTaskStatus(s, task.id, task.status))
    toasts.show({
      id: 'desk-today-write',
      message: { key: 'wbOvTaskUpdateFailed' },
      tone: 'alert',
      actions: [{ label: 'acctRetry', onClick: () => void setStatus(task, status) }],
    })
  }

  const retryLine = (
    <p className="wb-ov-partial wb-desk-today-pad">
      {t('wbOvLoadFailed')} ·{' '}
      <button type="button" className="wb-link" onClick={home.reload}>
        {t('acctRetry')}
      </button>
    </p>
  )

  const tasks = (s: WorkHomeSummary) => {
    if (s.partial.includes('tasks')) return retryLine
    // overdue first, then due today: each row's pill says which
    const due = myWorkGroups(s.my_work, s.today)
      .filter((g) => g.key !== 'upcoming')
      .flatMap((g) => g.tasks)
      .slice(0, TODAY_TASKS)
    if (due.length === 0)
      return <p className="wb-ov-note wb-desk-today-pad">{t('wbDeskTodayNoTasks')}</p>
    return (
      <ul className="wb-ov-list">
        {due.map((task) => {
          const done = task.status === 'done'
          const state = dueState(task, s.today)
          return (
            <li key={task.id} className={`wb-row wb-desk-today-row${done ? ' is-done' : ''}`}>
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
                className="wb-row-title"
                onClick={() => base && openWeb({ kind: 'task', ...base, id: task.id })}
              >
                {task.title}
              </button>
              {state === 'overdue' ? (
                <span className="wb-pill wb-num is-danger">
                  {t('wbOvDueOverdue', { count: overdueDays(s.today, task.due_date) })}
                </span>
              ) : state === 'today' ? (
                <span className="wb-pill is-warning">{t('wbOvDueToday')}</span>
              ) : null}
            </li>
          )
        })}
      </ul>
    )
  }

  const meetings = (s: WorkHomeSummary) => {
    if (s.partial.includes('meetings')) return retryLine
    if (s.upcoming_meetings.length === 0)
      return <p className="wb-ov-note wb-desk-today-pad">{t('wbOvMeetingsEmpty')}</p>
    return (
      <ul className="wb-ov-list">
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
            <li key={m.id} className="wb-row wb-desk-today-row is-meeting">
              <span className="wb-num wb-ov-time">
                {clock(m.starts_at, dateLocale, s.timezone)}
              </span>
              <div className="wb-ov-meet">
                <button
                  type="button"
                  className="wb-row-title"
                  onClick={() => base && openWeb({ kind: 'meeting', ...base, id: m.id })}
                >
                  {m.title}
                </button>
                {sub ? (
                  <span className={`wb-row-sub wb-num${live ? ' is-live' : ''}`}>{sub}</span>
                ) : null}
              </div>
              {live ? (
                <button
                  type="button"
                  className="wb-btn wb-btn-secondary wb-btn-sm"
                  onClick={() => base && openWeb({ kind: 'room', ...base, id: m.id })}
                >
                  <WbGlyph id="video" size={14} />
                  {t('wbOvJoin')}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    )
  }

  const others = (s: WorkHomeSummary) => {
    // document comments and mentions sit in the tray; the rest live on the web inbox
    // the inbox is a capped preview; counts.unread is the true total when it loaded
    const unread =
      !s.partial.includes('notifications') && s.counts.unread !== null
        ? s.counts.unread
        : s.inbox.filter((x) => !x.read_at).length
    const n = Math.max(0, unread - docNotifications(s.inbox).length)
    return n > 0 && base ? (
      <div className="wb-desk-today-foot">
        <WbGlyph id="bell" />
        <button
          type="button"
          className="wb-link"
          onClick={() => openWeb({ kind: 'inbox', ...base })}
        >
          {t('wbDeskOtherNotifs', { count: n })}
        </button>
      </div>
    ) : null
  }

  return (
    <aside className="wb-desk-today wb-block" aria-labelledby={titleId}>
      <div className="wb-desk-head">
        <h3 id={titleId}>{t('wbDeskToday')}</h3>
        <span className="wb-desk-head-note wb-desk-head-end wb-num">
          {formatDay(today, dateLocale, true)}
        </span>
      </div>
      {view === 'stale' && home.updatedAt !== null ? (
        <div className="wb-desk-today-pad">
          <WorkStaleNote at={home.updatedAt} onRetry={onReload} />
        </div>
      ) : null}
      {view === 'loading' ? <WorkSkeleton rows={2} /> : null}
      {/* signed out or offline: the Desk banner above says why and offers the way back */}
      {view === 'signed-out' || view === 'unreachable' ? (
        <p className="wb-ov-note wb-desk-today-pad">{t('wbDeskNoServerData')}</p>
      ) : null}
      {view === 'forbidden' ? (
        <WorkErrorState state="forbidden" onRetry={onReload} compact />
      ) : null}
      {view === 'no-workspace' ? <WorkNoWorkspace error={null} onRetry={onReload} compact /> : null}
      {shown ? (
        <>
          <h4 className="wb-desk-sublabel">{t('wbDeskDueTasks')}</h4>
          {tasks(shown)}
          <p className="wb-desk-today-pad wb-desk-today-more">
            <button type="button" className="wb-link" onClick={onOpenTasks}>
              {t('wbDeskAllTasks')}
            </button>
          </p>
          <h4 className="wb-desk-sublabel is-split">{t('wbDeskMeetings')}</h4>
          {meetings(shown)}
          {others(shown)}
        </>
      ) : null}
    </aside>
  )
}
