import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type {
  WorkCreateTaskInput,
  WorkTask,
  WorkTaskStatus,
  WorkWebTarget,
} from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { MODULE_TONES } from './module-tones'
import { settleWork, useWorkLoad } from './work-cache'
import { formatDay } from './work-home'
import { closedStatusKeys, groupTasksByDue, localIsoDate, type TaskDueGroup } from './work-tasks'
import { CHECK_GLYPH, WbGlyph, WorkbenchIcon } from './WorkbenchIcons'
import {
  WorkNoWorkspace,
  WorkStaleNote,
  WorkStatePanel,
  workLoadState,
  type WorkPaneProps,
} from './WorkErrorState'
import { WorkToolbar, type WorkToolbarProps } from './WorkToolbar'
import { useWbToast } from './WbToastHost'

const GROUP_LABEL: Record<TaskDueGroup, StringKey> = {
  overdue: 'wbTasksGroupOverdue',
  today: 'wbTasksGroupToday',
  week: 'wbTasksGroupWeek',
  later: 'wbTasksGroupLater',
  none: 'wbTasksGroupNone',
}

/** the status pill's signal by catalogue category (spec 1.5); the rest stay neutral */
const STATUS_TONE: Record<string, string> = {
  in_progress: 'is-info',
  in_review: 'is-info',
  done: 'is-success',
}

/** the one toast slot of this tab: a refused write, whose Retry repeats the same request */
const WRITE_TOAST = 'tasks-write'

/**
 * Tasks tab: the signed-in user's UniWork tasks in the active workspace,
 * grouped by due date (device-local today) in one card (redesign spec 4.2):
 * quick add (Enter, no button), a column header, then aligned grid rows.
 * Ticking a row sets its status (optimistic, put back on failure) and the row
 * stays, struck through, until the next load; a title opens the task on the web.
 */
export function WorkTasksPane({
  workspace,
  workspaceError,
  onReload,
  head,
  onWritten,
}: WorkPaneProps & {
  /** the tab toolbar, drawn here so its summary can count the loaded list (WorkbenchModulePane passes it) */
  head?: WorkToolbarProps
  /** a write landed: the tab counts (Overview summary) are stale */
  onWritten?: () => void
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
  const toasts = useWbToast()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  // Enter on an empty name: the error sits at the field
  const [missing, setMissing] = useState(false)
  const errorId = useId()

  useEffect(() => {
    setTouched(new Set())
  }, [list.updatedAt])
  useEffect(() => {
    toasts.dismiss(WRITE_TOAST)
  }, [wsId, toasts])

  const closed = useMemo(() => closedStatusKeys(catalogue.value ?? []), [catalogue.value])
  const statusName = useMemo(
    () => new Map((catalogue.value ?? []).map((s) => [s.key, s.name])),
    [catalogue.value],
  )
  // a key missing from the catalogue falls back to itself (the built-in keys match their category)
  const statusCategory = useMemo(
    () => new Map((catalogue.value ?? []).map((s) => [s.key, s.category])),
    [catalogue.value],
  )

  const setRowStatus = (id: string, status: string) =>
    list.update((rows) => rows.map((x) => (x.id === id ? { ...x, status } : x)))

  const setDone = async (task: WorkTask, done: boolean): Promise<void> => {
    const next = done ? 'done' : 'todo'
    toasts.dismiss(WRITE_TOAST)
    setTouched((cur) => new Set(cur).add(task.id))
    setRowStatus(task.id, next)
    const r = await settleWork(window.uniworkWork.setTaskStatus(task.id, next))
    if (r.ok) {
      list.update((rows) => rows.map((x) => (x.id === task.id ? r.value : x)))
      onWritten?.()
      return
    }
    setRowStatus(task.id, task.status)
    failed('wbTasksSaveFailed', () => void setDone(task, done))
  }

  const failed = (message: StringKey, retry: () => void) =>
    toasts.show({
      id: WRITE_TOAST,
      message: { key: message },
      tone: 'alert',
      actions: [{ label: 'acctRetry', onClick: retry }],
    })

  const create = async (input: WorkCreateTaskInput): Promise<void> => {
    toasts.dismiss(WRITE_TOAST)
    setAdding(true)
    const r = await settleWork(window.uniworkWork.createTask(input))
    setAdding(false)
    if (input.workspaceId !== wsRef.current) return
    if (r.ok) {
      setDraft('')
      list.update((rows) => [r.value, ...rows])
      onWritten?.()
      return
    }
    // Retry sends the same Idempotency-Key: a lost answer never creates a second task
    failed('wbTasksAddFailed', () => void create(input))
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const title = draft.trim()
    if (!wsId || adding) return
    // no Add button: Enter submits, and an empty name says so at the field
    if (!title) return setMissing(true)
    void create({ workspaceId: wsId, title, idempotencyKey: crypto.randomUUID() })
  }

  const today = localIsoDate(new Date())
  const open = (list.value ?? []).filter((x) => !closed.has(x.status))
  // the same date rules as the list's groups, so the summary cannot drift from it
  const count = (g: TaskDueGroup) =>
    groupTasksByDue(open, today).find((x) => x.group === g)?.tasks.length ?? 0
  const overdue = count('overdue')
  const dueToday = count('today')
  // a real count once the list loaded (spec 4.2: "6 open · 1 overdue · 2 due today"), else the hint
  const summary = list.value ? (
    <>
      <strong>{t('wbTasksOpenCount', { count: open.length })}</strong>
      {overdue > 0 ? ` · ${t('wbTasksOverdueCount', { count: overdue })}` : null}
      {dueToday > 0 ? ` · ${t('wbTasksDueTodayCount', { count: dueToday })}` : null}
    </>
  ) : (
    head?.summary
  )
  const openWeb = (target: WorkWebTarget) =>
    void window.uniworkWork.openWeb(target).catch(() => false)
  const actions = workspace ? (
    <button
      type="button"
      className="wb-btn wb-btn-ghost wb-btn-sm"
      onClick={() =>
        openWeb({ kind: 'my-tasks', orgSlug: workspace.orgSlug, wsSlug: workspace.slug })
      }
    >
      {t('wbWorkOpenOnWeb')}
      <WbGlyph id="external" size={14} />
    </button>
  ) : undefined
  const header = head ? <WorkToolbar {...head} summary={summary} actions={actions} /> : null

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

  const groups = groupTasksByDue(
    (list.value ?? []).filter((x) => !closed.has(x.status) || touched.has(x.id)),
    today,
  )
  const openTask = (task: WorkTask) =>
    openWeb({ kind: 'task', orgSlug: workspace.orgSlug, wsSlug: workspace.slug, id: task.id })

  return (
    <>
      {header}
      <div className="wb-work">
        {list.stale && list.updatedAt !== null ? (
          <WorkStaleNote at={list.updatedAt} onRetry={onReload} />
        ) : null}
        <section className="wb-block wb-tasks" aria-label={head?.title}>
          <form className="wb-work-quick" onSubmit={submit}>
            <span className="wb-work-quick-plus" aria-hidden="true">
              <WbGlyph id="plus" size={10} />
            </span>
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setMissing(false)
              }}
              placeholder={t('wbTasksQuickAddHint')}
              aria-label={t('wbTasksQuickAdd')}
              aria-invalid={missing || undefined}
              aria-describedby={missing ? errorId : undefined}
              // read-only, not disabled: focus stays for the next task
              readOnly={adding}
              aria-busy={adding || undefined}
            />
            <kbd className="wb-kbd" aria-hidden="true">
              ↵
            </kbd>
            {missing ? (
              <p className="wb-work-quick-error" id={errorId} role="alert">
                {t('wbTasksTitleRequired')}
              </p>
            ) : null}
          </form>
          {groups.length > 0 ? (
            <div className="wb-work-cols" aria-hidden="true">
              <span />
              <span>{t('wbTasksColTask')}</span>
              <span>{t('wbTasksColId')}</span>
              <span>{t('wbTasksColStatus')}</span>
              <span>{t('wbTasksColDue')}</span>
              <span />
            </div>
          ) : (
            <WorkStatePanel
              compact
              tone={MODULE_TONES.tasks}
              icon={<WorkbenchIcon id="tasks" size={20} />}
              title={t('wbTasksEmpty')}
            />
          )}
          {groups.map(({ group, tasks: rows }) => (
            <section key={group} className="wb-work-group">
              <h3 className={`wb-group-head${group === 'overdue' ? ' is-overdue' : ''}`}>
                {t(GROUP_LABEL[group])} <span className="wb-num">{rows.length}</span>
              </h3>
              <ul>
                {rows.map((task) => {
                  const done = closed.has(task.status)
                  const day = task.due_date?.slice(0, 10)
                  const tone = STATUS_TONE[statusCategory.get(task.status) ?? task.status]
                  const dueTone =
                    !day || done
                      ? ''
                      : day < today
                        ? ' is-danger'
                        : day === today
                          ? ' is-warning'
                          : ''
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
                        className="wb-row-title"
                        title={t('wbWorkOpenOnWeb')}
                        onClick={() => openTask(task)}
                      >
                        {task.title}
                      </button>
                      <span className="wb-mono">{task.identifier}</span>
                      <span className={`wb-pill${tone ? ` ${tone}` : ''}`}>
                        <span className="wb-pill-dot" aria-hidden="true" />
                        {statusName.get(task.status) ?? task.status}
                      </span>
                      {day ? (
                        <span className={`wb-pill wb-num${dueTone}`}>
                          {day === today
                            ? t('wbTasksGroupToday')
                            : formatDay(day, dateLocale, false)}
                        </span>
                      ) : (
                        <span />
                      )}
                      <span className="wb-row-actions">
                        <button
                          type="button"
                          className="wb-icon-btn"
                          aria-label={`${t('wbWorkOpenOnWeb')}: ${task.title}`}
                          title={t('wbWorkOpenOnWeb')}
                          onClick={() => openTask(task)}
                        >
                          <WbGlyph id="external" size={16} />
                        </button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </section>
      </div>
    </>
  )
}
