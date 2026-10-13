import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import {
  DESK_CHART,
  DESK_WIDGETS,
  addDaysIso,
  daysFromToday,
  getDeskWidget,
  readDeskLayout,
  writeDeskLayout,
  type DeskWidgetId,
} from './workbench-desk'
import { readCalendar, readTasks } from './workbench-pins'
import {
  remindersEnabled,
  requestReminderPermission,
  setRemindersEnabled,
  startWorkbenchReminderLoop,
} from './workbench-reminders'

interface Props {
  practiceId: PracticeId
  vi: boolean
}

interface ReminderItem {
  id: string
  date: string
  title: string
  source: string
}

export function DeskPane({ practiceId, vi }: Props): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [layout, setLayout] = useState<DeskWidgetId[]>(() => readDeskLayout(practiceId))
  const [customOpen, setCustomOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const [notifyOn, setNotifyOn] = useState(() => remindersEnabled())

  useEffect(() => {
    setLayout(readDeskLayout(practiceId))
    setCustomOpen(false)
  }, [practiceId])

  useEffect(() => {
    if (!notifyOn) return
    return startWorkbenchReminderLoop(() => practiceId)
  }, [notifyOn, practiceId])

  const toggleNotify = async () => {
    if (notifyOn) {
      setRemindersEnabled(false)
      setNotifyOn(false)
      return
    }
    const ok = await requestReminderPermission()
    if (!ok) return
    setRemindersEnabled(true)
    setNotifyOn(true)
  }

  const persist = (next: DeskWidgetId[]) => {
    setLayout(next)
    writeDeskLayout(practiceId, next)
  }

  const data = useMemo(() => {
    void tick
    const L = (a: string, b: string) => (vi ? a : b)
    const calendar = readCalendar(practiceId)
    const tasks = readTasks(practiceId)
    const today = new Date()
    const todayIso = today.toISOString().slice(0, 10)

    const openTasks = tasks.filter((t) => !t.done)
    const doneTasks = tasks.filter((t) => t.done)
    const calendar7 = calendar.filter((c) => {
      if (c.done) return false
      const d = daysFromToday(c.date)
      return d >= 0 && d <= 7
    })

    const dayCounts = Array.from({ length: 14 }, (_, i) => {
      const iso = addDaysIso(today, i)
      return { iso, n: calendar.filter((c) => c.date === iso && !c.done).length }
    })

    const reminders: ReminderItem[] = []
    for (const c of calendar) {
      if (c.done) continue
      const d = daysFromToday(c.date)
      if (d < 0 || d > 21) continue
      reminders.push({
        id: `cal-${c.id}`,
        date: c.date,
        title: c.title,
        source: L('Lịch', 'Calendar'),
      })
    }
    for (const t of openTasks.slice(0, 8)) {
      reminders.push({
        id: `task-${t.id}`,
        date: todayIso,
        title: t.title,
        source: L('Việc', 'Tasks'),
      })
    }
    reminders.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))

    return {
      openTasks: openTasks.length,
      doneTasks: doneTasks.length,
      taskTotal: tasks.length,
      calendar7: calendar7.length,
      dayCounts,
      reminders: reminders.slice(0, 8),
    }
  }, [practiceId, vi, tick])

  const hidden = DESK_WIDGETS.filter((w) => !layout.includes(w.id))

  const move = (id: DeskWidgetId, dir: -1 | 1) => {
    const i = layout.indexOf(id)
    if (i < 0) return
    const j = i + dir
    if (j < 0 || j >= layout.length) return
    const next = [...layout]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    persist(next)
  }

  const remove = (id: DeskWidgetId) => persist(layout.filter((x) => x !== id))
  const add = (id: DeskWidgetId) => {
    if (layout.includes(id)) return
    persist([...layout, id])
  }
  const reset = () => persist(DESK_WIDGETS.filter((w) => w.defaultOn).map((w) => w.id))

  const now = new Date()
  const hour = now.getHours()
  const greet =
    hour < 12
      ? label('Chào buổi sáng', 'Good morning')
      : hour < 18
        ? label('Chào buổi chiều', 'Good afternoon')
        : label('Chào buổi tối', 'Good evening')
  const dateLine = now.toLocaleDateString(vi ? 'vi-VN' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const showPulse = layout.includes('kpi-strip')
  const gridIds = layout.filter((id) => id !== 'kpi-strip')
  const nextReminder = data.reminders[0]

  const widgetTone = (id: DeskWidgetId): string => {
    switch (id) {
      case 'reminders':
      case 'calendar-14d':
        return DESK_CHART.events
      case 'tasks-ring':
        return DESK_CHART.tasks
      default:
        return 'var(--accent)'
    }
  }

  return (
    <div className="wb-myspace">
      <header className="wb-ms-hero">
        <div className="wb-ms-hero-glow" aria-hidden />
        <div className="wb-ms-hero-copy">
          <p className="wb-ms-kicker">{label('Không gian của tôi', 'My Space')}</p>
          <h2 className="wb-ms-title">{greet}</h2>
          <p className="wb-ms-sub">
            {dateLine}
            {' · '}
            {label('Việc và lịch trong một khung nhìn', 'Tasks and calendar in one view')}
          </p>
          {nextReminder ? (
            <p className="wb-ms-next">
              <span>{label('Sắp tới', 'Up next')}</span>
              <strong>
                {nextReminder.date} — {nextReminder.title}
              </strong>
            </p>
          ) : (
            <p className="wb-ms-next is-quiet">
              {label('Chưa có nhắc gần.', 'No upcoming reminders.')}
            </p>
          )}
        </div>
        <div className="wb-ms-hero-actions">
          <button
            type="button"
            className={`btn btn-secondary${notifyOn ? ' is-active' : ''}`}
            onClick={() => void toggleNotify()}
            title={label(
              'Thông báo desktop khi việc đến hạn / lịch hôm nay (opt-in)',
              'Desktop alerts for due tasks / today’s calendar (opt-in)',
            )}
          >
            {notifyOn
              ? label('Nhắc: bật', 'Reminders: on')
              : label('Nhắc: tắt', 'Reminders: off')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setTick((t) => t + 1)}>
            {label('Làm mới', 'Refresh')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCustomOpen((o) => !o)}
          >
            {customOpen ? label('Xong', 'Done') : label('Tùy chỉnh', 'Customize')}
          </button>
        </div>
      </header>

      {showPulse ? (
        <div className="wb-ms-pulse" aria-label={label('Nhịp làm việc', 'Work pulse')}>
          <PulseChip
            label={label('Việc mở', 'Open tasks')}
            value={String(data.openTasks)}
            tone="tasks"
            delay={0}
          />
          <PulseChip
            label={label('Lịch 7 ngày', 'Calendar · 7d')}
            value={String(data.calendar7)}
            tone="events"
            delay={1}
          />
        </div>
      ) : null}

      {customOpen ? (
        <div className="wb-desk-customize wb-ms-customize">
          <div>
            <h3>{label('Đang hiện', 'Visible')}</h3>
            <ul className="wb-desk-customize-list">
              {layout.map((id, idx) => {
                const w = getDeskWidget(id)
                if (!w) return null
                return (
                  <li key={id}>
                    <div>
                      <strong>{vi ? w.labelVi : w.labelEn}</strong>
                      <span>{vi ? w.hintVi : w.hintEn}</span>
                    </div>
                    <div className="teacher-chip-row">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={idx === 0}
                        onClick={() => move(id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={idx === layout.length - 1}
                        onClick={() => move(id, 1)}
                      >
                        ↓
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => remove(id)}>
                        {label('Ẩn', 'Hide')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
          <div>
            <h3>{label('Thêm vào Không gian của tôi', 'Add to My Space')}</h3>
            <ul className="wb-desk-customize-list">
              {hidden.length === 0 ? (
                <li className="teacher-empty">{label('Đã thêm hết.', 'All widgets added.')}</li>
              ) : (
                hidden.map((w) => (
                  <li key={w.id}>
                    <div>
                      <strong>{vi ? w.labelVi : w.labelEn}</strong>
                      <span>{vi ? w.hintVi : w.hintEn}</span>
                    </div>
                    <button type="button" className="btn btn-primary" onClick={() => add(w.id)}>
                      {label('Thêm', 'Add')}
                    </button>
                  </li>
                ))
              )}
            </ul>
            <button type="button" className="btn btn-secondary" onClick={reset}>
              {label('Khôi phục mặc định', 'Reset defaults')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="wb-ms-bento">
        {gridIds.map((id, index) => {
          const def = getDeskWidget(id)
          const wide = def?.wide ? ' is-wide' : ''
          return (
            <article
              key={id}
              className={`wb-ms-card${wide}`}
              style={{
                ['--ms-i' as string]: String(index),
                ['--ms-tone' as string]: widgetTone(id),
              }}
            >
              <header className="wb-ms-card-head">
                <h3>{def ? (vi ? def.labelVi : def.labelEn) : id}</h3>
                {def ? <span>{vi ? def.hintVi : def.hintEn}</span> : null}
              </header>
              <div className="wb-ms-card-body">
                {id === 'reminders' &&
                  (data.reminders.length === 0 ? (
                    <p className="teacher-empty">
                      {label(
                        'Chưa có nhắc — thêm ở Lịch / Công việc.',
                        'No reminders — add in Calendar / Tasks.',
                      )}
                    </p>
                  ) : (
                    <ul className="wb-desk-reminders">
                      {data.reminders.map((r) => (
                        <li key={r.id}>
                          <span className="wb-desk-rem-date">{r.date}</span>
                          <strong>{r.title}</strong>
                          <span className="wb-desk-rem-src">{r.source}</span>
                        </li>
                      ))}
                    </ul>
                  ))}
                {id === 'tasks-ring' && (
                  <RingProgress
                    value={data.doneTasks}
                    total={data.taskTotal}
                    color={DESK_CHART.tasks}
                    caption={
                      data.taskTotal === 0
                        ? label('Chưa có việc — thêm ở tab Công việc.', 'No tasks yet — add in Tasks.')
                        : label(
                            `${data.doneTasks}/${data.taskTotal} hoàn thành`,
                            `${data.doneTasks}/${data.taskTotal} done`,
                          )
                    }
                  />
                )}
                {id === 'calendar-14d' && (
                  <DayDensityChart
                    days={data.dayCounts}
                    color={DESK_CHART.events}
                    empty={label('14 ngày tới chưa có mốc.', 'No items in the next 14 days.')}
                  />
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function PulseChip({
  label: lab,
  value,
  tone,
  delay,
}: {
  label: string
  value: string
  tone: 'tasks' | 'events'
  delay: number
}): ReactElement {
  return (
    <div
      className="wb-ms-pulse-chip"
      style={{ ['--wb-kpi' as string]: DESK_CHART[tone], ['--ms-i' as string]: String(delay) }}
    >
      <span>{lab}</span>
      <strong>{value}</strong>
    </div>
  )
}

function RingProgress({
  value,
  total,
  color,
  caption,
}: {
  value: number
  total: number
  color: string
  caption: string
}): ReactElement {
  const pct = total > 0 ? value / total : 0
  const r = 46
  const circ = 2 * Math.PI * r
  const len = pct * circ
  return (
    <div className="wb-desk-chart wb-desk-ring">
      <svg viewBox="0 0 120 120" className="wb-desk-svg" role="img">
        <circle cx="60" cy="60" r={r} fill="none" stroke={DESK_CHART.track} strokeWidth={12} />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={12}
          strokeDasharray={`${len} ${circ - len}`}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="64" textAnchor="middle" className="wb-desk-donut-value">
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <p className="teacher-hint">{caption}</p>
    </div>
  )
}

function DayDensityChart({
  days,
  color,
  empty,
}: {
  days: { iso: string; n: number }[]
  color: string
  empty: string
}): ReactElement {
  const max = Math.max(1, ...days.map((d) => d.n))
  const has = days.some((d) => d.n > 0)
  if (!has) return <p className="teacher-empty">{empty}</p>
  const w = 320
  const h = 100
  const pad = 8
  const bw = (w - pad * 2) / days.length - 3
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="wb-desk-svg" role="img">
      {days.map((d, i) => {
        const hh = (d.n / max) * (h - 28)
        const x = pad + i * ((w - pad * 2) / days.length)
        return (
          <g key={d.iso}>
            <rect
              x={x}
              y={h - 18 - hh}
              width={bw}
              height={Math.max(hh, d.n > 0 ? 4 : 0)}
              rx={3}
              fill={color}
              opacity={0.25 + (d.n / max) * 0.75}
            />
            {i % 2 === 0 ? (
              <text x={x + bw / 2} y={h - 4} textAnchor="middle" className="wb-desk-axis">
                {d.iso.slice(8)}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
