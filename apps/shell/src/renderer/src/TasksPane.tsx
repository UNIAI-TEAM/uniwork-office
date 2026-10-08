import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import {
  deleteTaskAttachmentBlob,
  getTaskAttachmentBlob,
  normalizeTaskItem,
  putTaskAttachmentBlob,
  readTasks,
  readTasksView,
  taskWithStatus,
  writeTasks,
  writeTasksView,
  type TasksViewId,
  type WbTaskAttachmentMeta,
  type WbTaskItem,
  type WbTaskPriority,
  type WbTaskStatus,
} from './workbench-pins'

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const VIEWS: { id: TasksViewId; labelVi: string; labelEn: string }[] = [
  { id: 'list', labelVi: 'Danh sách', labelEn: 'List' },
  { id: 'kanban', labelVi: 'Kanban', labelEn: 'Kanban' },
  { id: 'calendar', labelVi: 'Lịch', labelEn: 'Calendar' },
  { id: 'dashboard', labelVi: 'Dashboard', labelEn: 'Dashboard' },
]

const STATUSES: { id: WbTaskStatus; labelVi: string; labelEn: string }[] = [
  { id: 'todo', labelVi: 'Cần làm', labelEn: 'To do' },
  { id: 'doing', labelVi: 'Đang làm', labelEn: 'Doing' },
  { id: 'done', labelVi: 'Hoàn thành', labelEn: 'Done' },
  { id: 'cancelled', labelVi: 'Huỷ', labelEn: 'Cancelled' },
]

const PRIORITIES: { id: WbTaskPriority; labelVi: string; labelEn: string }[] = [
  { id: 'low', labelVi: 'Thấp', labelEn: 'Low' },
  { id: 'medium', labelVi: 'Vừa', labelEn: 'Medium' },
  { id: 'high', labelVi: 'Cao', labelEn: 'High' },
  { id: 'urgent', labelVi: 'Gấp', labelEn: 'Urgent' },
]

function statusLabel(id: WbTaskStatus, vi: boolean) {
  const s = STATUSES.find((x) => x.id === id)!
  return vi ? s.labelVi : s.labelEn
}

function priorityLabel(id: WbTaskPriority, vi: boolean) {
  const p = PRIORITIES.find((x) => x.id === id)!
  return vi ? p.labelVi : p.labelEn
}

export function TasksPane({ practiceId, vi }: { practiceId: PracticeId; vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbTaskItem[]>(() => readTasks(practiceId))
  const [view, setView] = useState<TasksViewId>(() => readTasksView())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('open')
  const [draft, setDraft] = useState('')
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  useEffect(() => {
    setItems(readTasks(practiceId))
    setSelectedId(null)
  }, [practiceId])

  const persist = (next: WbTaskItem[]) => {
    const normalized = next.map((t) => normalizeTaskItem(t))
    setItems(normalized)
    writeTasks(practiceId, normalized)
  }

  const selectView = (id: TasksViewId) => {
    setView(id)
    writeTasksView(id)
    if (id !== 'list' && id !== 'kanban') setSelectedId(null)
  }

  const selected = items.find((t) => t.id === selectedId) ?? null

  const visible = useMemo(() => {
    return items.filter((t) => {
      if (filter === 'open') return t.status === 'todo' || t.status === 'doing'
      if (filter === 'done') return t.status === 'done'
      return true
    })
  }, [items, filter])

  const addQuick = () => {
    const title = draft.trim()
    if (!title) return
    const now = new Date().toISOString()
    const task = normalizeTaskItem({
      id: newId(),
      title,
      status: 'todo',
      priority: 'medium',
      done: false,
      dueDate: todayIso(),
      createdAt: now,
      updatedAt: now,
    })
    persist([task, ...items])
    setDraft('')
    setSelectedId(task.id)
  }

  const updateTask = (next: WbTaskItem) => {
    persist(items.map((t) => (t.id === next.id ? normalizeTaskItem({ ...next, updatedAt: new Date().toISOString() }) : t)))
  }

  const removeTask = async (id: string) => {
    const doomed = items.find((t) => t.id === id)
    for (const att of doomed?.attachments ?? []) {
      try {
        await deleteTaskAttachmentBlob(att.id)
      } catch {
        /* ignore */
      }
    }
    persist(items.filter((t) => t.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <div className="wb-tasks">
      <header className="wb-tasks-hero">
        <div>
          <strong>{label('Công việc của tôi', 'My tasks')}</strong>
          <p>
            {label(
              'Tự quản trị việc cá nhân trên máy này — không cần phê duyệt.',
              'Personal self-managed board on this device — no approvals.',
            )}
          </p>
        </div>
        <div className="wb-tasks-hero-stats" aria-hidden="true">
          <span>{items.filter((t) => t.status === 'todo' || t.status === 'doing').length}</span>
          <small>{label('đang mở', 'open')}</small>
        </div>
      </header>

      <div className="wb-tasks-toolbar">
        <nav className="wb-subtabs" aria-label={label('Chế độ xem', 'Views')}>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`wb-subtab${view === v.id ? ' active' : ''}`}
              onClick={() => selectView(v.id)}
            >
              {vi ? v.labelVi : v.labelEn}
            </button>
          ))}
        </nav>
        {view !== 'dashboard' ? (
          <div className="wb-tasks-filters" role="group">
            {(
              [
                ['open', 'Đang mở', 'Open'],
                ['done', 'Xong', 'Done'],
                ['all', 'Tất cả', 'All'],
              ] as const
            ).map(([id, a, b]) => (
              <button
                key={id}
                type="button"
                className={`wb-subtab${filter === id ? ' active' : ''}`}
                onClick={() => setFilter(id)}
              >
                {vi ? a : b}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {view !== 'dashboard' && view !== 'calendar' ? (
        <div className="wb-tasks-quick">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={label('Thêm việc nhanh… Enter để lưu', 'Quick add… press Enter')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addQuick()
            }}
          />
          <button type="button" className="btn btn-primary" onClick={addQuick} disabled={!draft.trim()}>
            {label('Thêm', 'Add')}
          </button>
        </div>
      ) : null}

      <div className={`wb-tasks-body${selected && (view === 'list' || view === 'kanban') ? ' has-detail' : ''}`}>
        <div className="wb-tasks-main">
          {view === 'list' && (
            <ListView
              vi={vi}
              items={visible}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onToggle={(id) => {
                const t = items.find((x) => x.id === id)
                if (!t) return
                updateTask(taskWithStatus(t, t.status === 'done' ? 'todo' : 'done'))
              }}
              onDelete={(id) => void removeTask(id)}
            />
          )}
          {view === 'kanban' && (
            <KanbanView
              vi={vi}
              items={visible}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDropStatus={(id, status) => {
                const t = items.find((x) => x.id === id)
                if (!t) return
                updateTask(taskWithStatus(t, status))
              }}
            />
          )}
          {view === 'calendar' && (
            <CalendarView
              vi={vi}
              items={items}
              month={calMonth}
              onMonthChange={setCalMonth}
              onSelect={(id) => {
                setSelectedId(id)
                setView('list')
                writeTasksView('list')
              }}
              onAddForDate={(date) => {
                const now = new Date().toISOString()
                const task = normalizeTaskItem({
                  id: newId(),
                  title: vi ? 'Việc mới' : 'New task',
                  status: 'todo',
                  priority: 'medium',
                  done: false,
                  dueDate: date,
                  createdAt: now,
                  updatedAt: now,
                })
                persist([task, ...items])
                setSelectedId(task.id)
                setView('list')
                writeTasksView('list')
              }}
            />
          )}
          {view === 'dashboard' && <DashboardView vi={vi} items={items} />}
        </div>

        {selected && (view === 'list' || view === 'kanban') ? (
          <TaskDetail
            vi={vi}
            task={selected}
            onClose={() => setSelectedId(null)}
            onChange={updateTask}
            onDelete={() => void removeTask(selected.id)}
          />
        ) : null}
      </div>
    </div>
  )
}

function ListView({
  vi,
  items,
  selectedId,
  onSelect,
  onToggle,
  onDelete,
}: {
  vi: boolean
  items: WbTaskItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onDelete: (id: string) => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  if (items.length === 0) {
    return (
      <div className="wb-tasks-empty">
        <span aria-hidden="true">✓</span>
        <p>{label('Chưa có việc phù hợp bộ lọc. Thêm việc mới phía trên.', 'No tasks for this filter. Add one above.')}</p>
      </div>
    )
  }
  return (
    <ul className="wb-tasks-list">
      {items.map((it) => (
        <li key={it.id} className={`wb-tasks-list-row${selectedId === it.id ? ' is-selected' : ''}${it.done ? ' is-done' : ''}`}>
          <label className="wb-tasks-check">
            <input type="checkbox" checked={it.done} onChange={() => onToggle(it.id)} />
          </label>
          <button type="button" className="wb-tasks-list-main" onClick={() => onSelect(it.id)}>
            <strong>{it.title}</strong>
            <span>
              <i className={`wb-tasks-pri is-${it.priority}`} />
              {priorityLabel(it.priority, vi)}
              {' · '}
              {statusLabel(it.status, vi)}
              {it.dueDate ? ` · ${it.dueDate}` : ''}
              {it.attachments?.length ? ` · ${it.attachments.length} ${label('tệp', 'files')}` : ''}
            </span>
          </button>
          <button
            type="button"
            className="wb-tasks-icon-btn"
            aria-label={label('Xoá', 'Delete')}
            onClick={() => {
              if (window.confirm(label(`Xoá «${it.title}»?`, `Delete “${it.title}”?`))) onDelete(it.id)
            }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}

function KanbanView({
  vi,
  items,
  selectedId,
  onSelect,
  onDropStatus,
}: {
  vi: boolean
  items: WbTaskItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDropStatus: (id: string, status: WbTaskStatus) => void
}): ReactElement {
  const cols = STATUSES.filter((s) => s.id !== 'cancelled')
  return (
    <div className="wb-tasks-kanban">
      {cols.map((col) => {
        const colItems = items.filter((t) => t.status === col.id)
        return (
          <section
            key={col.id}
            className="wb-tasks-col"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/task-id')
              if (id) onDropStatus(id, col.id)
            }}
          >
            <header>
              <strong>{vi ? col.labelVi : col.labelEn}</strong>
              <span>{colItems.length}</span>
            </header>
            <div className="wb-tasks-col-body">
              {colItems.map((it) => (
                <article
                  key={it.id}
                  className={`wb-tasks-card${selectedId === it.id ? ' is-selected' : ''}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/task-id', it.id)}
                  onClick={() => onSelect(it.id)}
                >
                  <strong>{it.title}</strong>
                  <span>
                    <i className={`wb-tasks-pri is-${it.priority}`} />
                    {it.dueDate || priorityLabel(it.priority, vi)}
                  </span>
                </article>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function CalendarView({
  vi,
  items,
  month,
  onMonthChange,
  onSelect,
  onAddForDate,
}: {
  vi: boolean
  items: WbTaskItem[]
  month: Date
  onMonthChange: (d: Date) => void
  onSelect: (id: string) => void
  onAddForDate: (date: string) => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const y = month.getFullYear()
  const m = month.getMonth()
  const firstDow = new Date(y, m, 1).getDay()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const today = todayIso()
  const locale = vi ? 'vi-VN' : 'en-US'
  const title = month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const dows = vi
    ? ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const byDate = useMemo(() => {
    const map = new Map<string, WbTaskItem[]>()
    for (const t of items) {
      const key = t.dueDate || t.startDate
      if (!key) continue
      const list = map.get(key) ?? []
      list.push(t)
      map.set(key, list)
    }
    return map
  }, [items])

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className="wb-tasks-cal">
      <div className="wb-tasks-cal-head">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onMonthChange(new Date(y, m - 1, 1))}
        >
          ←
        </button>
        <h3>{title}</h3>
        <div className="wb-tasks-cal-head-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onMonthChange(new Date())}
          >
            {label('Hôm nay', 'Today')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onMonthChange(new Date(y, m + 1, 1))}
          >
            →
          </button>
        </div>
      </div>
      <div className="wb-tasks-cal-grid">
        {dows.map((d) => (
          <div key={d} className="wb-tasks-cal-dow">
            {d}
          </div>
        ))}
        {cells.map((day, idx) => {
          if (day == null) return <div key={`e-${idx}`} className="wb-tasks-cal-cell is-empty" />
          const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const dayTasks = byDate.get(date) ?? []
          const isToday = date === today
          return (
            <div
              key={date}
              className={`wb-tasks-cal-cell${isToday ? ' is-today' : ''}${dayTasks.length ? ' has-tasks' : ''}`}
            >
              <div className="wb-tasks-cal-cell-top">
                <span className="wb-tasks-cal-daynum">{day}</span>
                <button
                  type="button"
                  className="wb-tasks-cal-add"
                  title={label('Thêm việc', 'Add task')}
                  onClick={() => onAddForDate(date)}
                >
                  +
                </button>
              </div>
              <div className="wb-tasks-cal-chips">
                {dayTasks.slice(0, 3).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`wb-tasks-cal-chip is-${t.status} is-${t.priority}`}
                    onClick={() => onSelect(t.id)}
                  >
                    {t.title}
                  </button>
                ))}
                {dayTasks.length > 3 ? (
                  <span className="wb-tasks-cal-more">+{dayTasks.length - 3}</span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DashboardView({ vi, items }: { vi: boolean; items: WbTaskItem[] }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const open = items.filter((t) => t.status === 'todo' || t.status === 'doing')
  const done = items.filter((t) => t.status === 'done')
  const overdue = open.filter((t) => t.dueDate && t.dueDate < todayIso())
  const byStatus = STATUSES.map((s) => ({
    ...s,
    n: items.filter((t) => t.status === s.id).length,
  }))
  const byPri = PRIORITIES.map((p) => ({
    ...p,
    n: open.filter((t) => t.priority === p.id).length,
  }))
  const maxStatus = Math.max(1, ...byStatus.map((s) => s.n))
  const weekDone = done.filter((t) => {
    if (!t.completedAt) return false
    const d = Date.now() - Date.parse(t.completedAt)
    return d >= 0 && d < 7 * 24 * 60 * 60 * 1000
  }).length

  return (
    <div className="wb-tasks-dash">
      <div className="wb-tasks-dash-kpis">
        <article>
          <span>{label('Đang mở', 'Open')}</span>
          <strong>{open.length}</strong>
        </article>
        <article>
          <span>{label('Hoàn thành', 'Done')}</span>
          <strong>{done.length}</strong>
        </article>
        <article className={overdue.length ? 'is-warn' : ''}>
          <span>{label('Quá hạn', 'Overdue')}</span>
          <strong>{overdue.length}</strong>
        </article>
        <article>
          <span>{label('Xong 7 ngày', 'Done (7d)')}</span>
          <strong>{weekDone}</strong>
        </article>
      </div>

      <div className="wb-tasks-dash-charts">
        <section className="wb-tasks-dash-card">
          <header>
            <h4>{label('Theo trạng thái', 'By status')}</h4>
          </header>
          <div className="wb-tasks-bars">
            {byStatus.map((s) => (
              <div key={s.id} className="wb-tasks-bar-row">
                <span>{vi ? s.labelVi : s.labelEn}</span>
                <div className="wb-tasks-bar-track">
                  <i style={{ width: `${(s.n / maxStatus) * 100}%` }} className={`is-${s.id}`} />
                </div>
                <em>{s.n}</em>
              </div>
            ))}
          </div>
        </section>
        <section className="wb-tasks-dash-card">
          <header>
            <h4>{label('Ưu tiên (việc mở)', 'Priority (open)')}</h4>
          </header>
          <svg viewBox="0 0 200 120" className="wb-tasks-donut" role="img">
            {(() => {
              const total = Math.max(1, byPri.reduce((a, b) => a + b.n, 0))
              const colors = ['#94a3b8', '#38bdf8', '#fbbf24', '#fb7185']
              let angle = -Math.PI / 2
              const cx = 60
              const cy = 60
              const r = 40
              return (
                <>
                  {byPri.map((p, i) => {
                    const slice = (p.n / total) * Math.PI * 2
                    const x1 = cx + r * Math.cos(angle)
                    const y1 = cy + r * Math.sin(angle)
                    angle += slice
                    const x2 = cx + r * Math.cos(angle)
                    const y2 = cy + r * Math.sin(angle)
                    const large = slice > Math.PI ? 1 : 0
                    if (p.n === 0) return null
                    return (
                      <path
                        key={p.id}
                        d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
                        fill={colors[i]}
                        opacity={0.9}
                      />
                    )
                  })}
                  <circle cx={cx} cy={cy} r={22} fill="var(--surface)" />
                  <text x={cx} y={cy + 4} textAnchor="middle" fill="var(--text)" fontSize="12" fontWeight="700">
                    {open.length}
                  </text>
                  {byPri.map((p, i) => (
                    <g key={`l-${p.id}`}>
                      <rect x={120} y={18 + i * 22} width={10} height={10} rx={2} fill={colors[i]} />
                      <text x={136} y={27 + i * 22} fill="var(--text-secondary)" fontSize="10">
                        {(vi ? p.labelVi : p.labelEn) + ` (${p.n})`}
                      </text>
                    </g>
                  ))}
                </>
              )
            })()}
          </svg>
        </section>
      </div>
    </div>
  )
}

function TaskDetail({
  vi,
  task,
  onClose,
  onChange,
  onDelete,
}: {
  vi: boolean
  task: WbTaskItem
  onClose: () => void
  onChange: (t: WbTaskItem) => void
  onDelete: () => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const patch = (partial: Partial<WbTaskItem>) => {
    onChange(normalizeTaskItem({ ...task, ...partial, updatedAt: new Date().toISOString() }))
  }

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    e.target.value = ''
    if (!files?.length) return
    setBusy(true)
    setErr('')
    try {
      const added: WbTaskAttachmentMeta[] = []
      for (const file of Array.from(files)) {
        const id = newId()
        await putTaskAttachmentBlob(id, file)
        added.push({
          id,
          name: file.name,
          mime: file.type || undefined,
          size: file.size,
          addedAt: new Date().toISOString(),
        })
      }
      patch({ attachments: [...added, ...(task.attachments ?? [])] })
    } catch {
      setErr(label('Không lưu được tệp trên máy.', 'Could not save file on device.'))
    } finally {
      setBusy(false)
    }
  }

  const openAtt = async (att: WbTaskAttachmentMeta) => {
    const blob = await getTaskAttachmentBlob(att.id)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const removeAtt = async (id: string) => {
    try {
      await deleteTaskAttachmentBlob(id)
    } catch {
      /* ignore */
    }
    patch({ attachments: (task.attachments ?? []).filter((a) => a.id !== id) })
  }

  return (
    <aside className="wb-tasks-detail">
      <button type="button" className="wb-tasks-detail-close" onClick={onClose}>
        {label('Đóng', 'Close')}
      </button>
      <input
        className="wb-tasks-detail-title"
        value={task.title}
        onChange={(e) => patch({ title: e.target.value })}
      />
      <div className="wb-tasks-detail-grid">
        <label>
          <span>{label('Trạng thái', 'Status')}</span>
          <select
            value={task.status}
            onChange={(e) => onChange(taskWithStatus(task, e.target.value as WbTaskStatus))}
          >
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {vi ? s.labelVi : s.labelEn}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{label('Ưu tiên', 'Priority')}</span>
          <select
            value={task.priority}
            onChange={(e) => patch({ priority: e.target.value as WbTaskPriority })}
          >
            {PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {vi ? p.labelVi : p.labelEn}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{label('Hạn', 'Due')}</span>
          <input
            type="date"
            value={task.dueDate ?? ''}
            onChange={(e) => patch({ dueDate: e.target.value || undefined })}
          />
        </label>
        <label>
          <span>{label('Bắt đầu', 'Start')}</span>
          <input
            type="date"
            value={task.startDate ?? ''}
            onChange={(e) => patch({ startDate: e.target.value || undefined })}
          />
        </label>
      </div>
      <label className="wb-tasks-detail-desc">
        <span>{label('Mô tả', 'Description')}</span>
        <textarea
          rows={4}
          value={task.description ?? ''}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder={label('Ghi chú, checklist…', 'Notes, checklist…')}
        />
      </label>

      <div className="wb-tasks-files">
        <div className="wb-tasks-files-head">
          <strong>{label('Tài liệu công việc', 'Work files')}</strong>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {label('Tải lên', 'Upload')}
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => void onFiles(e)} />
        </div>
        <p className="teacher-hint">
          {label('Lưu trên máy (IndexedDB) — không tải lên đám mây.', 'Stored on-device (IndexedDB) — not uploaded to the cloud.')}
        </p>
        {err ? <p className="wb-pets-err">{err}</p> : null}
        {(task.attachments ?? []).length === 0 ? (
          <p className="wb-tasks-files-empty">{label('Chưa có tệp.', 'No files yet.')}</p>
        ) : (
          <ul className="wb-tasks-file-list">
            {(task.attachments ?? []).map((att) => (
              <li key={att.id}>
                <button type="button" className="wb-tasks-file-open" onClick={() => void openAtt(att)}>
                  <strong>{att.name}</strong>
                  <span>{Math.max(1, Math.round(att.size / 1024))} KB</span>
                </button>
                <button type="button" className="wb-tasks-icon-btn" onClick={() => void removeAtt(att.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          if (window.confirm(label('Xoá việc này?', 'Delete this task?'))) onDelete()
        }}
      >
        {label('Xoá việc', 'Delete task')}
      </button>
    </aside>
  )
}
