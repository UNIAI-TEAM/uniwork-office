import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import {
  DESK_CHART,
  DESK_WIDGETS,
  addDaysIso,
  daysFromToday,
  formatMonthShort,
  getDeskWidget,
  lastNMonthKeys,
  monthKey,
  readDeskLayout,
  writeDeskLayout,
  type DeskWidgetId,
} from './workbench-desk'
import {
  readCalendar,
  readClients,
  readContracts,
  readEvents,
  healthDeskCounts,
  readFamily,
  readFinance,
  readGrowth,
  readMatters,
  readTasks,
} from './workbench-pins'
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
    const events = readEvents(practiceId)
    const finance = readFinance()
    const healthCounts = healthDeskCounts()
    const growth = readGrowth()
    const family = readFamily()
    const clients = readClients(practiceId)
    const contracts = readContracts(practiceId)
    const matters = readMatters(practiceId)
    const today = new Date()
    const todayIso = today.toISOString().slice(0, 10)
    const month = monthKey(today)

    const openTasks = tasks.filter((t) => !t.done)
    const doneTasks = tasks.filter((t) => t.done)
    const monthIncome = finance
      .filter((f) => f.kind === 'income' && monthKey(f.date) === month)
      .reduce((s, f) => s + f.amount, 0)
    const monthExpense = finance
      .filter((f) => f.kind === 'expense' && monthKey(f.date) === month)
      .reduce((s, f) => s + f.amount, 0)
    const events7 = events.filter((e) => {
      const d = daysFromToday(e.date)
      return d >= 0 && d <= 7
    })

    const months = lastNMonthKeys(6, today)
    const financeBars = months.map((mk) => ({
      key: mk,
      income: finance
        .filter((f) => f.kind === 'income' && monthKey(f.date) === mk)
        .reduce((s, f) => s + f.amount, 0),
      expense: finance
        .filter((f) => f.kind === 'expense' && monthKey(f.date) === mk)
        .reduce((s, f) => s + f.amount, 0),
    }))

    const expenseByLabel = new Map<string, number>()
    for (const f of finance) {
      if (f.kind !== 'expense' || monthKey(f.date) !== month) continue
      const k = f.label.trim() || L('Khác', 'Other')
      expenseByLabel.set(k, (expenseByLabel.get(k) ?? 0) + f.amount)
    }
    const donut = [...expenseByLabel.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }))

    const dayCounts = Array.from({ length: 14 }, (_, i) => {
      const iso = addDaysIso(today, i)
      const n =
        calendar.filter((c) => c.date === iso && !c.done).length +
        events.filter((e) => e.date === iso).length +
        matters.filter((m) => m.nextDate === iso && m.status !== 'closed').length +
        contracts.filter((c) => c.endDate === iso).length
      return { iso, n }
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
    for (const e of events) {
      const d = daysFromToday(e.date)
      if (d < 0 || d > 21) continue
      reminders.push({
        id: `ev-${e.id}`,
        date: e.date,
        title: e.title,
        source: L('Sự kiện', 'Events'),
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
    for (const m of matters) {
      if (!m.nextDate || m.status === 'closed') continue
      const d = daysFromToday(m.nextDate)
      if (d < 0 || d > 30) continue
      reminders.push({
        id: `mat-${m.id}`,
        date: m.nextDate,
        title: m.title,
        source: L('Vụ việc', 'Matters'),
      })
    }
    for (const c of contracts) {
      if (!c.endDate || c.status === 'expired') continue
      const d = daysFromToday(c.endDate)
      if (d < 0 || d > 45) continue
      reminders.push({
        id: `ctr-${c.id}`,
        date: c.endDate,
        title: c.title,
        source: L('Hợp đồng', 'Contracts'),
      })
    }
    reminders.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))

    const healthKinds = [
      {
        id: 'exercise' as const,
        label: L('Vận động', 'Exercise'),
        color: DESK_CHART.tasks,
        count: healthCounts.exercise,
      },
      {
        id: 'sleep' as const,
        label: L('Ngủ', 'Sleep'),
        color: DESK_CHART.legal,
        count: healthCounts.sleep,
      },
      {
        id: 'checkup' as const,
        label: L('Chỉ số', 'Metrics'),
        color: DESK_CHART.health,
        count: healthCounts.checkup,
      },
      {
        id: 'other' as const,
        label: L('Chế độ ăn / IF', 'Diet / IF'),
        color: DESK_CHART.muted,
        count: healthCounts.other,
      },
    ]

    const familySoon = family
      .filter((f) => f.birthday)
      .map((f) => {
        const bd = f.birthday!
        const thisYear = `${today.getFullYear()}-${bd.slice(5, 10)}`
        let next = thisYear
        if (daysFromToday(thisYear) < 0) next = `${today.getFullYear() + 1}-${bd.slice(5, 10)}`
        return { ...f, next }
      })
      .filter((f) => daysFromToday(f.next) <= 60)
      .sort((a, b) => a.next.localeCompare(b.next))

    const contractCounts = {
      draft: contracts.filter((c) => c.status === 'draft').length,
      active: contracts.filter((c) => c.status === 'active').length,
      expired: contracts.filter((c) => c.status === 'expired').length,
      other: contracts.filter((c) => c.status === 'other').length,
    }
    const matterCounts = {
      open: matters.filter((m) => m.status === 'open').length,
      pending: matters.filter((m) => m.status === 'pending').length,
      closed: matters.filter((m) => m.status === 'closed').length,
    }

    return {
      openTasks: openTasks.length,
      doneTasks: doneTasks.length,
      taskTotal: tasks.length,
      events7: events7.length,
      monthIncome,
      monthExpense,
      financeBars,
      donut,
      dayCounts,
      reminders: reminders.slice(0, 8),
      growth: growth.filter((g) => !g.done).slice(0, 6),
      healthKinds,
      eventsUpcoming: events
        .filter((e) => daysFromToday(e.date) >= 0)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 6),
      familySoon,
      clients,
      contractCounts,
      matterCounts,
      contractsOpen: contracts.filter((c) => c.status === 'active' || c.status === 'draft').length,
      mattersOpen: matters.filter((m) => m.status !== 'closed').length,
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

  const money = (n: number) =>
    n.toLocaleString(vi ? 'vi-VN' : 'en-US', { maximumFractionDigits: 0 })

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
      case 'events-upcoming':
        return DESK_CHART.events
      case 'finance-bar':
      case 'finance-donut':
        return DESK_CHART.income
      case 'tasks-ring':
        return DESK_CHART.tasks
      case 'growth-bars':
        return DESK_CHART.growth
      case 'health-dots':
        return DESK_CHART.health
      case 'family-upcoming':
        return DESK_CHART.family
      case 'clients-kpi':
        return DESK_CHART.clients
      case 'contracts-status':
        return DESK_CHART.legal
      case 'matters-status':
        return DESK_CHART.matter
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
            {label(
              'Việc làm và đời sống trong một khung nhìn',
              'Work and life in one view',
            )}
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
              {label('Chưa có nhắc gần — không gian đang trống trải.', 'No upcoming reminders — your space is clear.')}
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
        <div className="wb-ms-pulse" aria-label={label('Nhịp sống nhanh', 'Life pulse')}>
          <PulseChip
            label={label('Việc mở', 'Open tasks')}
            value={String(data.openTasks)}
            tone="tasks"
            delay={0}
          />
          <PulseChip
            label={label('Sự kiện 7 ngày', 'Events · 7d')}
            value={String(data.events7)}
            tone="events"
            delay={1}
          />
          <PulseChip
            label={label('Thu tháng', 'Income')}
            value={money(data.monthIncome)}
            tone="income"
            delay={2}
          />
          <PulseChip
            label={label('Chi tháng', 'Expense')}
            value={money(data.monthExpense)}
            tone="expense"
            delay={3}
          />
          {(layout.includes('contracts-status') || layout.includes('matters-status')) && (
            <>
              <PulseChip
                label={label('Hợp đồng', 'Contracts')}
                value={String(data.contractsOpen)}
                tone="legal"
                delay={4}
              />
              <PulseChip
                label={label('Vụ mở', 'Matters')}
                value={String(data.mattersOpen)}
                tone="matter"
                delay={5}
              />
            </>
          )}
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
            <p className="teacher-hint">
              {label(
                'Tuỳ chọn: sự kiện, gia đình, khách hàng, hợp đồng, vụ việc.',
                'Optional: events, family, clients, contracts, matters.',
              )}
            </p>
            <ul className="wb-desk-customize-list">
              {hidden.length === 0 ? (
                <li className="teacher-empty">{label('Đã thêm hết.', 'All widgets added.')}</li>
              ) : (
                hidden.map((w) => (
                  <li key={w.id}>
                    <div>
                      <strong>{vi ? w.labelVi : w.labelEn}</strong>
                      <span>
                        {vi ? w.hintVi : w.hintEn}
                        {w.group === 'extra' ? ` · ${label('Tuỳ chọn', 'Optional')}` : ''}
                      </span>
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
                        'Chưa có nhắc — thêm ở Lịch / Công việc / Sự kiện.',
                        'No reminders — add in Calendar / Tasks / Events.',
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
                {id === 'finance-bar' && (
                  <GroupedBarChart
                    rows={data.financeBars.map((r) => ({
                      label: formatMonthShort(r.key, vi),
                      a: r.income,
                      b: r.expense,
                    }))}
                    aLabel={label('Thu', 'In')}
                    bLabel={label('Chi', 'Out')}
                    aColor={DESK_CHART.income}
                    bColor={DESK_CHART.expense}
                    empty={label('Chưa có giao dịch tài chính.', 'No finance entries yet.')}
                  />
                )}
                {id === 'finance-donut' && (
                  <DonutChart
                    slices={data.donut}
                    empty={label('Chưa có chi trong tháng.', 'No expenses this month.')}
                    centerLabel={label('Chi', 'Out')}
                    centerValue={money(data.monthExpense)}
                  />
                )}
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
                {id === 'growth-bars' &&
                  (data.growth.length === 0 ? (
                    <p className="teacher-empty">
                      {label(
                        'Chưa có mục tiêu — thêm ở Phát triển bản thân.',
                        'No goals — add in Self-growth.',
                      )}
                    </p>
                  ) : (
                    <ul className="wb-desk-bars">
                      {data.growth.map((g) => (
                        <li key={g.id}>
                          <div className="wb-desk-bar-meta">
                            <strong>{g.title}</strong>
                            <span>{g.progress}%</span>
                          </div>
                          <div className="wb-desk-bar-track">
                            <div
                              className="wb-desk-bar-fill"
                              style={{
                                width: `${Math.min(100, Math.max(0, g.progress))}%`,
                                background: DESK_CHART.growth,
                              }}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ))}
                {id === 'health-dots' && (
                  <HealthDots
                    kinds={data.healthKinds}
                    empty={label('Chưa ghi nhận SK.', 'No health entries.')}
                  />
                )}
                {id === 'events-upcoming' &&
                  (data.eventsUpcoming.length === 0 ? (
                    <p className="teacher-empty">{label('Chưa có sự kiện.', 'No upcoming events.')}</p>
                  ) : (
                    <ul className="wb-desk-reminders">
                      {data.eventsUpcoming.map((e) => (
                        <li key={e.id}>
                          <span className="wb-desk-rem-date">{e.date}</span>
                          <strong>{e.title}</strong>
                          <span className="wb-desk-rem-src">{e.place ?? e.time ?? ''}</span>
                        </li>
                      ))}
                    </ul>
                  ))}
                {id === 'family-upcoming' &&
                  (data.familySoon.length === 0 ? (
                    <p className="teacher-empty">
                      {label(
                        'Chưa có sinh nhật sắp tới / chưa nhập ngày sinh.',
                        'No upcoming birthdays.',
                      )}
                    </p>
                  ) : (
                    <ul className="wb-desk-reminders">
                      {data.familySoon.map((f) => (
                        <li key={f.id}>
                          <span className="wb-desk-rem-date">{f.next}</span>
                          <strong>{f.name}</strong>
                          <span className="wb-desk-rem-src">{f.relation}</span>
                        </li>
                      ))}
                    </ul>
                  ))}
                {id === 'clients-kpi' && (
                  <div className="wb-desk-kpis">
                    <Kpi
                      label={label('Tổng KH', 'Clients')}
                      value={String(data.clients.length)}
                      tone="clients"
                    />
                    <div className="wb-desk-mini-list">
                      {data.clients.slice(0, 4).map((c) => (
                        <div key={c.id}>
                          <strong>{c.name}</strong>
                          <span>{c.contact ?? c.phone ?? c.email ?? '—'}</span>
                        </div>
                      ))}
                      {data.clients.length === 0 ? (
                        <p className="teacher-empty">{label('Chưa có KH.', 'No clients.')}</p>
                      ) : null}
                    </div>
                  </div>
                )}
                {id === 'contracts-status' && (
                  <StatusBars
                    rows={[
                      {
                        label: label('Nháp', 'Draft'),
                        value: data.contractCounts.draft,
                        color: DESK_CHART.muted,
                      },
                      {
                        label: label('Hiệu lực', 'Active'),
                        value: data.contractCounts.active,
                        color: DESK_CHART.income,
                      },
                      {
                        label: label('Hết hạn', 'Expired'),
                        value: data.contractCounts.expired,
                        color: DESK_CHART.expense,
                      },
                      {
                        label: label('Khác', 'Other'),
                        value: data.contractCounts.other,
                        color: DESK_CHART.legal,
                      },
                    ]}
                    empty={label('Chưa có hợp đồng.', 'No contracts.')}
                  />
                )}
                {id === 'matters-status' && (
                  <StatusBars
                    rows={[
                      {
                        label: label('Đang xử lý', 'Open'),
                        value: data.matterCounts.open,
                        color: DESK_CHART.matter,
                      },
                      {
                        label: label('Chờ', 'Pending'),
                        value: data.matterCounts.pending,
                        color: DESK_CHART.events,
                      },
                      {
                        label: label('Đã đóng', 'Closed'),
                        value: data.matterCounts.closed,
                        color: DESK_CHART.muted,
                      },
                    ]}
                    empty={label('Chưa có vụ việc.', 'No matters.')}
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
  tone: keyof typeof DESK_CHART | 'income' | 'expense' | 'tasks' | 'events' | 'legal' | 'matter'
  delay: number
}): ReactElement {
  const color =
    tone in DESK_CHART ? String(DESK_CHART[tone as keyof typeof DESK_CHART]) : DESK_CHART.tasks
  return (
    <div
      className="wb-ms-pulse-chip"
      style={{ ['--wb-kpi' as string]: color, ['--ms-i' as string]: String(delay) }}
    >
      <span>{lab}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Kpi({
  label: lab,
  value,
  tone,
}: {
  label: string
  value: string
  tone: keyof typeof DESK_CHART | 'income' | 'expense' | 'tasks' | 'events' | 'legal' | 'matter' | 'clients'
}): ReactElement {
  const color =
    tone in DESK_CHART ? String(DESK_CHART[tone as keyof typeof DESK_CHART]) : DESK_CHART.tasks
  return (
    <div className="wb-desk-kpi" style={{ ['--wb-kpi' as string]: color }}>
      <span>{lab}</span>
      <strong>{value}</strong>
    </div>
  )
}

function GroupedBarChart({
  rows,
  aLabel,
  bLabel,
  aColor,
  bColor,
  empty,
}: {
  rows: { label: string; a: number; b: number }[]
  aLabel: string
  bLabel: string
  aColor: string
  bColor: string
  empty: string
}): ReactElement {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]))
  const has = rows.some((r) => r.a > 0 || r.b > 0)
  if (!has) return <p className="teacher-empty">{empty}</p>
  const w = 320
  const h = 140
  const pad = 20
  const gap = 10
  const groupW = (w - pad * 2) / rows.length
  return (
    <div className="wb-desk-chart">
      <svg viewBox={`0 0 ${w} ${h}`} className="wb-desk-svg" role="img">
        {rows.map((r, i) => {
          const x0 = pad + i * groupW
          const bw = (groupW - gap) / 2
          const ha = (r.a / max) * (h - 36)
          const hb = (r.b / max) * (h - 36)
          return (
            <g key={r.label}>
              <rect
                x={x0}
                y={h - 22 - ha}
                width={bw}
                height={ha}
                rx={4}
                fill={aColor}
                opacity={0.92}
              />
              <rect
                x={x0 + bw + 3}
                y={h - 22 - hb}
                width={bw}
                height={hb}
                rx={4}
                fill={bColor}
                opacity={0.92}
              />
              <text x={x0 + groupW / 2 - gap / 2} y={h - 6} textAnchor="middle" className="wb-desk-axis">
                {r.label}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="wb-desk-legend">
        <span>
          <i style={{ background: aColor }} />
          {aLabel}
        </span>
        <span>
          <i style={{ background: bColor }} />
          {bLabel}
        </span>
      </div>
    </div>
  )
}

function DonutChart({
  slices,
  empty,
  centerLabel,
  centerValue,
}: {
  slices: { name: string; value: number }[]
  empty: string
  centerLabel: string
  centerValue: string
}): ReactElement {
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (total <= 0) return <p className="teacher-empty">{empty}</p>
  const r = 42
  const cx = 60
  const cy = 60
  const circ = 2 * Math.PI * r
  let offset = 0
  const arcs = slices.map((s, i) => {
    const len = (s.value / total) * circ
    const dash = `${len} ${circ - len}`
    const el = (
      <circle
        key={s.name}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={DESK_CHART.series[i % DESK_CHART.series.length]}
        strokeWidth={16}
        strokeDasharray={dash}
        strokeDashoffset={-offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        strokeLinecap="butt"
      />
    )
    offset += len
    return el
  })
  return (
    <div className="wb-desk-chart wb-desk-donut-wrap">
      <svg viewBox="0 0 120 120" className="wb-desk-svg wb-desk-donut" role="img">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={DESK_CHART.track} strokeWidth={16} />
        {arcs}
        <text x={cx} y={cy - 4} textAnchor="middle" className="wb-desk-donut-label">
          {centerLabel}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="wb-desk-donut-value">
          {centerValue}
        </text>
      </svg>
      <ul className="wb-desk-legend-list">
        {slices.map((s, i) => (
          <li key={s.name}>
            <i style={{ background: DESK_CHART.series[i % DESK_CHART.series.length] }} />
            <span>{s.name}</span>
            <em>{Math.round((s.value / total) * 100)}%</em>
          </li>
        ))}
      </ul>
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

function HealthDots({
  kinds,
  empty,
}: {
  kinds: { id: string; label: string; color: string; count: number }[]
  empty: string
}): ReactElement {
  const total = kinds.reduce((s, k) => s + k.count, 0)
  if (total === 0) return <p className="teacher-empty">{empty}</p>
  return (
    <ul className="wb-desk-health">
      {kinds.map((k) => (
        <li key={k.id}>
          <span className="wb-desk-health-label">{k.label}</span>
          <span className="wb-desk-health-dots" aria-hidden>
            {Array.from({ length: Math.min(12, k.count) }, (_, i) => (
              <i key={i} style={{ background: k.color }} />
            ))}
            {k.count > 12 ? <em>+{k.count - 12}</em> : null}
          </span>
          <strong>{k.count}</strong>
        </li>
      ))}
    </ul>
  )
}

function StatusBars({
  rows,
  empty,
}: {
  rows: { label: string; value: number; color: string }[]
  empty: string
}): ReactElement {
  const max = Math.max(1, ...rows.map((r) => r.value))
  const total = rows.reduce((s, r) => s + r.value, 0)
  if (total === 0) return <p className="teacher-empty">{empty}</p>
  return (
    <ul className="wb-desk-bars">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="wb-desk-bar-meta">
            <strong>{r.label}</strong>
            <span>{r.value}</span>
          </div>
          <div className="wb-desk-bar-track">
            <div
              className="wb-desk-bar-fill"
              style={{ width: `${(r.value / max) * 100}%`, background: r.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
