import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { WorkCreateTaskInput, WorkTask, WorkTaskStatus } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { settleWork, useWorkLoad } from './work-cache'
import { formatDay } from './work-home'
import { closedStatusKeys, groupTasksByDue, localIsoDate, type TaskDueGroup } from './work-tasks'
import {
  WorkNoWorkspace,
  WorkStaleNote,
  WorkToast,
  workLoadState,
  type WorkPaneProps,
} from './WorkErrorState'

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
 * grouped by due date (device-local today). Ticking a row sets its status
 * (optimistic, put back on failure); quick add creates a task; a title opens
 * the task on the web.
 */
export function WorkTasksPane({
  workspace,
  workspaceError,
  onReload,
}: WorkPaneProps): ReactElement {
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

  if (!workspace) return <WorkNoWorkspace error={workspaceError} onRetry={onReload} />
  const blocked = workLoadState(list)
  if (blocked) return blocked

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
    <div className="wb-work">
      {list.stale && list.updatedAt !== null ? (
        <WorkStaleNote at={list.updatedAt} onRetry={onReload} />
      ) : null}
      <form className="wb-work-quick" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('wbTasksQuickAdd')}
          aria-label={t('wbTasksQuickAdd')}
          disabled={adding}
        />
        <button type="submit" className="btn btn-primary" disabled={adding || !draft.trim()}>
          {t('wbTasksAdd')}
        </button>
      </form>
      {groups.length === 0 ? (
        <p className="wb-work-state">{t('wbTasksEmpty')}</p>
      ) : (
        <table className="wb-work-table">
          <thead>
            <tr>
              <th className="wb-work-check" />
              <th>{t('wbTasksColTitle')}</th>
              <th>{t('wbTasksColKey')}</th>
              <th>{t('wbTasksColStatus')}</th>
              <th>{t('wbTasksColDue')}</th>
            </tr>
          </thead>
          {groups.map(({ group, tasks: rows }) => (
            <tbody key={group}>
              <tr className={`wb-work-group is-${group}`}>
                <th colSpan={5} scope="colgroup">
                  {t(GROUP_LABEL[group])}
                </th>
              </tr>
              {rows.map((task) => {
                const done = closed.has(task.status)
                const day = task.due_date?.slice(0, 10)
                return (
                  <tr key={task.id} className={`wb-work-row${done ? ' is-done' : ''}`}>
                    <td className="wb-work-check">
                      <input
                        type="checkbox"
                        checked={done}
                        aria-label={t(done ? 'wbTasksReopen' : 'wbTasksMarkDone', {
                          title: task.title,
                        })}
                        onChange={(e) => void setDone(task, e.target.checked)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="wb-work-title"
                        title={t('wbWorkOpenOnWeb')}
                        onClick={() => openOnWeb(task)}
                      >
                        {task.title}
                      </button>
                    </td>
                    <td className="wb-work-muted">{task.identifier}</td>
                    <td>
                      <span className="wb-pill">{statusName.get(task.status) ?? task.status}</span>
                    </td>
                    <td>
                      {day ? (
                        <span
                          className={`wb-pill${day < today ? ' is-danger' : day === today ? ' is-warning' : ''}`}
                        >
                          {day === today
                            ? t('wbTasksGroupToday')
                            : formatDay(day, dateLocale, false)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>
      )}
      {failure ? (
        <WorkToast
          message={failure.message}
          onRetry={failure.retry}
          onDismiss={() => setFailure(null)}
        />
      ) : null}
    </div>
  )
}
