import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { WorkCreateTaskInput, WorkTask, WorkTaskStatus } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { MODULE_TONES } from './module-tones'
import { settleWork, useWorkLoad } from './work-cache'
import { formatDay } from './work-home'
import { closedStatusKeys, groupTasksByDue, localIsoDate, type TaskDueGroup } from './work-tasks'
import { CHECK_GLYPH, WorkbenchIcon } from './WorkbenchIcons'
import {
  WorkNoWorkspace,
  WorkStaleNote,
  WorkStatePanel,
  WorkToast,
  workLoadState,
  type WorkPaneProps,
} from './WorkErrorState'
import { WorkPaneHeader, type WorkPaneHeaderProps } from './WorkPaneHeader'

const GROUP_LABEL: Record<TaskDueGroup, StringKey> = {
  overdue: 'wbTasksGroupOverdue',
  today: 'wbTasksGroupToday',
  week: 'wbTasksGroupWeek',
  later: 'wbTasksGroupLater',
  none: 'wbTasksGroupNone',
}

/** A write the server refused: a toast whose Retry repeats the same request (spec §7). */
interface WriteFailure {
  message: StringKey
  retry: () => void
}

/**
 * Tasks tab: the signed-in user's UniWork tasks in the active workspace,
 * grouped by due date (device-local today) in one list block whose first row
 * is quick add. Ticking a row sets its status (optimistic, put back on
 * failure); a title opens the task on the web.
 */
export function WorkTasksPane({
  workspace,
  workspaceError,
  onReload,
  head,
}: WorkPaneProps & {
  /** the tab header, drawn here so its aside can count the loaded list (WorkbenchModulePane passes it) */
  head?: Omit<WorkPaneHeaderProps, 'aside'>
}): ReactElement {
  const { t, dateLocale } = useI18n()
  const wsId = workspace?.id ?? null
  const wsRef = useRef(wsId)
  wsRef.current = wsId
  const list = useWorkLoad<WorkTask[]>(wsId ? `tasks:${wsId}` : null, () =>
    window.uniworkWork.myTasks(wsId ?? ''),
  )
  // the catalogue only names statuses: rows still show (by key) while it is missing
  const catalogue = useWorkLoad<WorkTaskStatus[]>(wsId ? `taskStatuses:${wsId}` : null, () =>
    window.uniworkWork.taskStatuses(wsId ?? ''),
  )
  // ticked this session: stays listed (dimmed) until the next load, like the web
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const [failure, setFailure] = useState<WriteFailure | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    setTouched(new Set())
  }, [list.updatedAt])
  useEffect(() => {
    setFailure(null)
  }, [wsId])

  const closed = useMemo(() => closedStatusKeys(catalogue.value ?? []), [catalogue.value])
  const statusName = useMemo(
    () => new Map((catalogue.value ?? []).map((s) => [s.key, s.name])),
    [catalogue.value],
  )

  const setRowStatus = (id: string, status: string) =>
    list.update((rows) => rows.map((x) => (x.id === id ? { ...x, status } : x)))

  const setDone = async (task: WorkTask, done: boolean): Promise<void> => {
    const next = done ? 'done' : 'todo'
    setFailure(null)
    setTouched((cur) => new Set(cur).add(task.id))
    setRowStatus(task.id, next)
    const r = await settleWork(window.uniworkWork.setTaskStatus(task.id, next))
    if (r.ok) {
      list.update((rows) => rows.map((x) => (x.id === task.id ? r.value : x)))
      return
    }
    setRowStatus(task.id, task.status)
    setFailure({ message: 'wbTasksSaveFailed', retry: () => void setDone(task, done) })
  }

  const create = async (input: WorkCreateTaskInput): Promise<void> => {
    setFailure(null)
    setAdding(true)
    const r = await settleWork(window.uniworkWork.createTask(input))
    setAdding(false)
    if (input.workspaceId !== wsRef.current) return
    if (r.ok) {
      setDraft('')
      list.update((rows) => [r.value, ...rows])
      return
    }
    // Retry sends the same Idempotency-Key: a lost answer never creates a second task
    setFailure({ message: 'wbTasksAddFailed', retry: () => void create(input) })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const title = draft.trim()
    if (!wsId || !title || adding) return
    void create({ workspaceId: wsId, title, idempotencyKey: crypto.randomUUID() })
  }

  const openCount = (list.value ?? []).filter((x) => !closed.has(x.status)).length
  const header = head ? (
    <WorkPaneHeader
      {...head}
      aside={
        list.value ? (
          <span className="wb-num">{t('wbTasksOpenCount', { count: openCount })}</span>
        ) : undefined
      }
    />
  ) : null

  if (!workspace) {
    return (
      <>
        {header}
        <WorkNoWorkspace error={workspaceError} onRetry={onReload} />
      </>
    )
  }
  const blocked = workLoadState(list)
  if (blocked) {
    return (
      <>
        {header}
        {blocked}
      </>
    )
  }

  const today = localIsoDate(new Date())
  const groups = groupTasksByDue(
    (list.value ?? []).filter((x) => !closed.has(x.status) || touched.has(x.id)),
    today,
  )
  const openOnWeb = (task: WorkTask) =>
    void window.uniworkWork
      .openWeb({ kind: 'task', orgSlug: workspace.orgSlug, wsSlug: workspace.slug, id: task.id })
      .catch(() => false)

  return (
    <>
      {header}
      <div className="wb-work">
        {list.stale && list.updatedAt !== null ? (
          <WorkStaleNote at={list.updatedAt} onRetry={onReload} />
        ) : null}
        <div className="wb-block">
          <form className="wb-row wb-work-quick" onSubmit={submit}>
            <span className="wb-work-quick-plus" aria-hidden="true">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M5 1.5v7M1.5 5h7"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('wbTasksQuickAdd')}
              aria-label={t('wbTasksQuickAdd')}
              disabled={adding}
            />
            <button
              type="submit"
              className="wb-btn wb-btn-primary wb-btn-sm"
              disabled={adding || !draft.trim()}
            >
              {t('wbTasksAdd')}
            </button>
          </form>
          {groups.map(({ group, tasks: rows }) => (
            <section key={group} className="wb-work-group">
              <h3 className={`wb-group-head${group === 'overdue' ? ' is-overdue' : ''}`}>
                {t(GROUP_LABEL[group])} <span className="wb-num">{rows.length}</span>
              </h3>
              <ul>
                {rows.map((task) => {
                  const done = closed.has(task.status)
                  const day = task.due_date?.slice(0, 10)
                  return (
                    <li key={task.id} className={`wb-row wb-work-row${done ? ' is-done' : ''}`}>
                      <label className="wb-check">
                        <input
                          type="checkbox"
                          className="uw-sr-only"
                          checked={done}
                          aria-label={t(done ? 'wbTasksReopen' : 'wbTasksMarkDone', {
                            title: task.title,
                          })}
                          onChange={(e) => void setDone(task, e.target.checked)}
                        />
                        <span className="wb-check-box" aria-hidden="true">
                          {CHECK_GLYPH}
                        </span>
                      </label>
                      <button
                        type="button"
                        className="wb-work-title"
                        title={t('wbWorkOpenOnWeb')}
                        onClick={() => openOnWeb(task)}
                      >
                        {task.title}
                      </button>
                      <span className="wb-mono">{task.identifier}</span>
                      <span className="wb-pill is-status">
                        {statusName.get(task.status) ?? task.status}
                      </span>
                      {day ? (
                        <span
                          className={`wb-pill wb-num${day < today ? ' is-danger' : day === today ? ' is-warning' : ''}`}
                        >
                          {day === today
                            ? t('wbTasksGroupToday')
                            : formatDay(day, dateLocale, false)}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
        {groups.length === 0 ? (
          <WorkStatePanel
            tone={MODULE_TONES.tasks}
            icon={<WorkbenchIcon id="tasks" size={20} />}
            title={t('wbTasksEmpty')}
          />
        ) : null}
        {failure ? (
          <WorkToast
            message={failure.message}
            onRetry={failure.retry}
            onDismiss={() => setFailure(null)}
          />
        ) : null}
      </div>
    </>
  )
}
