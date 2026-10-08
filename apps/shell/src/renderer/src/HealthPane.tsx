import { useState } from 'react'
import type { ReactElement } from 'react'
import { HealthMetricsViz } from './HealthMetricsViz'
import {
  readHealthDiets,
  readHealthFasting,
  readHealthRuns,
  readHealthSports,
  readHealthSubTab,
  readHealthVeg,
  readHealthYoga,
  writeHealthDiets,
  writeHealthFasting,
  writeHealthRuns,
  writeHealthSports,
  writeHealthSubTab,
  writeHealthVeg,
  writeHealthYoga,
  type HealthSubTabId,
  type WbHealthDietPlan,
  type WbHealthFasting,
  type WbHealthRun,
  type WbHealthSport,
  type WbHealthVeg,
  type WbHealthYoga,
} from './workbench-pins'
import { WbDeleteBtn, WbRowActions } from './WbRowActions'

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const SUB_TABS: { id: HealthSubTabId; labelVi: string; labelEn: string }[] = [
  { id: 'metrics', labelVi: 'Chỉ số sức khoẻ', labelEn: 'Metrics' },
  { id: 'running', labelVi: 'Chạy bộ', labelEn: 'Running' },
  { id: 'yoga', labelVi: 'Yoga', labelEn: 'Yoga' },
  { id: 'sports', labelVi: 'Thể dục / Thể thao', labelEn: 'Sports' },
  { id: 'diet', labelVi: 'Chương trình ăn kiêng', labelEn: 'Diet plan' },
  { id: 'fasting', labelVi: 'Nhịn ăn gián đoạn', labelEn: 'Intermittent fasting' },
  { id: 'veg', labelVi: 'Ăn chay', labelEn: 'Plant-based' },
]

export function HealthPane({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [sub, setSub] = useState<HealthSubTabId>(() => readHealthSubTab())

  const select = (id: HealthSubTabId) => {
    setSub(id)
    writeHealthSubTab(id)
  }

  return (
    <div className="wb-health">
      <p className="teacher-hint">
        {label(
          'Quản lý sức khoẻ offline: chỉ số, chạy bộ, yoga, thể thao, ăn kiêng, nhịn ăn gián đoạn và ăn chay — lập kế hoạch & theo dõi trên máy.',
          'On-device health: metrics, running, yoga, sports, diet, intermittent fasting, and plant-based — plan and track locally.',
        )}
      </p>
      <nav className="wb-subtabs" aria-label={label('Tab con Sức khoẻ', 'Health sub-tabs')}>
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`wb-subtab${sub === t.id ? ' active' : ''}`}
            onClick={() => select(t.id)}
          >
            {vi ? t.labelVi : t.labelEn}
          </button>
        ))}
      </nav>
      {sub === 'metrics' && <HealthMetricsViz vi={vi} />}
      {sub === 'running' && <RunningSub vi={vi} />}
      {sub === 'yoga' && <YogaSub vi={vi} />}
      {sub === 'sports' && <SportsSub vi={vi} />}
      {sub === 'diet' && <DietSub vi={vi} />}
      {sub === 'fasting' && <FastingSub vi={vi} />}
      {sub === 'veg' && <VegSub vi={vi} />}
    </div>
  )
}

function RunningSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbHealthRun[]>(() => readHealthRuns())
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [distanceKm, setDistanceKm] = useState('')
  const [durationMin, setDurationMin] = useState('')
  const [pace, setPace] = useState('')
  const [note, setNote] = useState('')

  const persist = (next: WbHealthRun[]) => {
    setItems(next)
    writeHealthRuns(next)
  }

  const weekKm = items
    .filter((r) => {
      const d = daysAgo(r.date)
      return d >= 0 && d < 7
    })
    .reduce((s, r) => s + r.distanceKm, 0)

  const add = () => {
    const dist = Number(distanceKm)
    const dur = Number(durationMin)
    if (!date || !Number.isFinite(dist) || dist <= 0 || !Number.isFinite(dur) || dur <= 0) return
    let autoPace = pace.trim()
    if (!autoPace && dist > 0) {
      const minPerKm = dur / dist
      const mm = Math.floor(minPerKm)
      const ss = Math.round((minPerKm - mm) * 60)
      autoPace = `${mm}'${String(ss).padStart(2, '0')}"/km`
    }
    persist(
      [
        {
          id: newId(),
          date,
          distanceKm: dist,
          durationMin: dur,
          ...(autoPace ? { pace: autoPace } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        ...items,
      ].sort((a, b) => b.date.localeCompare(a.date)),
    )
    setDistanceKm('')
    setDurationMin('')
    setPace('')
    setNote('')
  }

  return (
    <>
      <p className="teacher-hint">
        {label('Nhật ký chạy bộ — khoảng cách, thời gian, pace.', 'Running log — distance, time, pace.')}
      </p>
      <div className="wb-finance-summary">
        <span>
          {label('7 ngày gần đây:', 'Last 7 days:')}{' '}
          <strong>
            {weekKm.toLocaleString(vi ? 'vi-VN' : 'en-US', { maximumFractionDigits: 1 })} km
          </strong>
        </span>
      </div>
      <div className="wb-module-form">
        <label>
          <span>{label('Ngày', 'Date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>{label('Km', 'Km')}</span>
          <input inputMode="decimal" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} />
        </label>
        <label>
          <span>{label('Phút', 'Minutes')}</span>
          <input inputMode="numeric" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
        </label>
        <label>
          <span>{label('Pace (tuỳ chọn)', 'Pace (optional)')}</span>
          <input value={pace} onChange={(e) => setPace(e.target.value)} placeholder="5'30&quot;/km" />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          {label('Thêm buổi chạy', 'Add run')}
        </button>
      </div>
      <SimpleList
        vi={vi}
        empty={label('Chưa có buổi chạy.', 'No runs yet.')}
        items={items.map((it) => ({
          id: it.id,
          title: `${it.date} · ${it.distanceKm} km · ${it.durationMin} ${label('phút', 'min')}${
            it.pace ? ` · ${it.pace}` : ''
          }`,
          note: it.note,
        }))}
        onDelete={(id) => persist(items.filter((x) => x.id !== id))}
      />
    </>
  )
}

function YogaSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbHealthYoga[]>(() => readHealthYoga())
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [style, setStyle] = useState(vi ? 'Hatha' : 'Hatha')
  const [durationMin, setDurationMin] = useState('30')
  const [intensity, setIntensity] = useState<WbHealthYoga['intensity']>('moderate')
  const [note, setNote] = useState('')

  const persist = (next: WbHealthYoga[]) => {
    setItems(next)
    writeHealthYoga(next)
  }

  const intensityLabel = (i: WbHealthYoga['intensity']) => {
    switch (i) {
      case 'easy':
        return label('Nhẹ', 'Easy')
      case 'hard':
        return label('Nặng', 'Hard')
      default:
        return label('Vừa', 'Moderate')
    }
  }

  const add = () => {
    const s = style.trim()
    const d = Number(durationMin)
    if (!s || !date || !Number.isFinite(d) || d <= 0) return
    persist(
      [
        {
          id: newId(),
          date,
          style: s,
          durationMin: d,
          intensity,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        ...items,
      ].sort((a, b) => b.date.localeCompare(a.date)),
    )
    setNote('')
  }

  return (
    <>
      <p className="teacher-hint">
        {label('Theo dõi buổi yoga / thiền động — phong cách, thời lượng, cường độ.', 'Track yoga sessions — style, duration, intensity.')}
      </p>
      <div className="wb-module-form">
        <label>
          <span>{label('Ngày', 'Date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>{label('Phong cách', 'Style')}</span>
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            {(vi
              ? ['Hatha', 'Vinyasa', 'Yin', 'Ashtanga', 'Restorative', 'Khác']
              : ['Hatha', 'Vinyasa', 'Yin', 'Ashtanga', 'Restorative', 'Other']
            ).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{label('Phút', 'Minutes')}</span>
          <input inputMode="numeric" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
        </label>
        <label>
          <span>{label('Cường độ', 'Intensity')}</span>
          <select
            value={intensity}
            onChange={(e) => setIntensity(e.target.value as WbHealthYoga['intensity'])}
          >
            <option value="easy">{label('Nhẹ', 'Easy')}</option>
            <option value="moderate">{label('Vừa', 'Moderate')}</option>
            <option value="hard">{label('Nặng', 'Hard')}</option>
          </select>
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          {label('Thêm buổi yoga', 'Add session')}
        </button>
      </div>
      <SimpleList
        vi={vi}
        empty={label('Chưa có buổi yoga.', 'No yoga sessions yet.')}
        items={items.map((it) => ({
          id: it.id,
          title: `${it.date} · ${it.style} · ${it.durationMin} ${label('phút', 'min')} · ${intensityLabel(it.intensity)}`,
          note: it.note,
        }))}
        onDelete={(id) => persist(items.filter((x) => x.id !== id))}
      />
    </>
  )
}

function SportsSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbHealthSport[]>(() => readHealthSports())
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [sport, setSport] = useState(vi ? 'Gym' : 'Gym')
  const [durationMin, setDurationMin] = useState('45')
  const [note, setNote] = useState('')

  const persist = (next: WbHealthSport[]) => {
    setItems(next)
    writeHealthSports(next)
  }

  const add = () => {
    const s = sport.trim()
    const d = Number(durationMin)
    if (!s || !date || !Number.isFinite(d) || d <= 0) return
    persist(
      [
        {
          id: newId(),
          date,
          sport: s,
          durationMin: d,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        ...items,
      ].sort((a, b) => b.date.localeCompare(a.date)),
    )
    setNote('')
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Thể dục / thể thao chung: gym, bơi, bóng đá, đạp xe…',
          'General exercise / sports: gym, swim, football, cycling…',
        )}
      </p>
      <div className="wb-module-form">
        <label>
          <span>{label('Ngày', 'Date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>{label('Môn / hoạt động', 'Sport / activity')}</span>
          <input
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            list="wb-health-sports"
            placeholder={label('VD: Bơi / Cầu lông', 'e.g. Swim / Badminton')}
          />
          <datalist id="wb-health-sports">
            {(vi
              ? ['Gym', 'Bơi', 'Đạp xe', 'Bóng đá', 'Cầu lông', 'Tennis', 'Đi bộ', 'Khác']
              : ['Gym', 'Swim', 'Cycling', 'Football', 'Badminton', 'Tennis', 'Walk', 'Other']
            ).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label>
          <span>{label('Phút', 'Minutes')}</span>
          <input inputMode="numeric" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          {label('Thêm buổi tập', 'Add workout')}
        </button>
      </div>
      <SimpleList
        vi={vi}
        empty={label('Chưa có buổi tập.', 'No workouts yet.')}
        items={items.map((it) => ({
          id: it.id,
          title: `${it.date} · ${it.sport} · ${it.durationMin} ${label('phút', 'min')}`,
          note: it.note,
        }))}
        onDelete={(id) => persist(items.filter((x) => x.id !== id))}
      />
    </>
  )
}

function DietSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbHealthDietPlan[]>(() => readHealthDiets())
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState('')
  const [dailyKcal, setDailyKcal] = useState('')
  const [note, setNote] = useState('')

  const persist = (next: WbHealthDietPlan[]) => {
    setItems(next)
    writeHealthDiets(next)
  }

  const add = () => {
    const t = title.trim()
    if (!t || !startDate) return
    const kcal = dailyKcal.trim() ? Number(dailyKcal) : undefined
    persist([
      {
        id: newId(),
        title: t,
        startDate,
        active: true,
        ...(goal.trim() ? { goal: goal.trim() } : {}),
        ...(endDate ? { endDate } : {}),
        ...(kcal !== undefined && Number.isFinite(kcal) ? { dailyKcal: kcal } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      ...items,
    ])
    setTitle('')
    setGoal('')
    setDailyKcal('')
    setNote('')
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Lập và theo dõi chương trình ăn kiêng (mục tiêu, kcal/ngày, thời hạn).',
          'Plan and track diet programs (goal, daily kcal, dates).',
        )}
      </p>
      <div className="wb-module-form">
        <label className="teacher-form-wide">
          <span>{label('Tên chương trình', 'Program name')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label('VD: Cut 4 tuần', 'e.g. 4-week cut')}
          />
        </label>
        <label>
          <span>{label('Mục tiêu', 'Goal')}</span>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={label('VD: −3 kg', 'e.g. −3 kg')}
          />
        </label>
        <label>
          <span>{label('Kcal / ngày', 'Kcal / day')}</span>
          <input inputMode="numeric" value={dailyKcal} onChange={(e) => setDailyKcal(e.target.value)} />
        </label>
        <label>
          <span>{label('Bắt đầu', 'Start')}</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          <span>{label('Kết thúc', 'End')}</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú / thực đơn gợi ý', 'Notes / meal ideas')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          {label('Thêm chương trình', 'Add plan')}
        </button>
      </div>
      <ul className="wb-module-list">
        {items.length === 0 ? (
          <li className="teacher-empty">{label('Chưa có chương trình.', 'No diet plans yet.')}</li>
        ) : (
          items.map((it) => (
            <li key={it.id} className={`wb-module-row${!it.active ? ' is-done' : ''}`}>
              <div className="wb-module-meta">
                <strong>
                  {it.title}
                  {it.goal ? ` · ${it.goal}` : ''}
                  {it.dailyKcal ? ` · ${it.dailyKcal} kcal` : ''}
                </strong>
                <span>
                  {[
                    `${it.startDate}${it.endDate ? ` → ${it.endDate}` : ''}`,
                    it.active ? label('Đang chạy', 'Active') : label('Tạm dừng', 'Paused'),
                  ].join(' · ')}
                </span>
                {it.note ? <span>{it.note}</span> : null}
              </div>
              <WbRowActions>
                <button
                  type="button"
                  className="wb-row-chip"
                  onClick={() =>
                    persist(items.map((x) => (x.id === it.id ? { ...x, active: !x.active } : x)))
                  }
                >
                  {it.active ? label('Tạm dừng', 'Pause') : label('Bật lại', 'Resume')}
                </button>
                <WbDeleteBtn
                  label={label('Xóa', 'Delete')}
                  onClick={() => persist(items.filter((x) => x.id !== it.id))}
                />
              </WbRowActions>
            </li>
          ))
        )}
      </ul>
    </>
  )
}

function FastingSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbHealthFasting[]>(() => readHealthFasting())
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [protocol, setProtocol] = useState<WbHealthFasting['protocol']>('16:8')
  const [fastStart, setFastStart] = useState('20:00')
  const [fastEnd, setFastEnd] = useState('12:00')
  const [note, setNote] = useState('')

  const persist = (next: WbHealthFasting[]) => {
    setItems(next)
    writeHealthFasting(next)
  }

  const add = () => {
    if (!date) return
    persist(
      [
        {
          id: newId(),
          date,
          protocol,
          completed: false,
          ...(fastStart.trim() ? { fastStart: fastStart.trim() } : {}),
          ...(fastEnd.trim() ? { fastEnd: fastEnd.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        ...items,
      ].sort((a, b) => b.date.localeCompare(a.date)),
    )
    setNote('')
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Nhịn ăn gián đoạn: chọn protocol (16:8, 18:6…) và đánh dấu hoàn thành ngày.',
          'Intermittent fasting: pick a protocol (16:8, 18:6…) and mark day complete.',
        )}
      </p>
      <div className="wb-module-form">
        <label>
          <span>{label('Ngày', 'Date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>{label('Protocol', 'Protocol')}</span>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as WbHealthFasting['protocol'])}
          >
            {(['16:8', '18:6', '20:4', 'OMAD', '5:2', 'other'] as const).map((p) => (
              <option key={p} value={p}>
                {p === 'other' ? label('Khác', 'Other') : p}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{label('Bắt đầu nhịn', 'Fast start')}</span>
          <input type="time" value={fastStart} onChange={(e) => setFastStart(e.target.value)} />
        </label>
        <label>
          <span>{label('Kết thúc nhịn', 'Fast end')}</span>
          <input type="time" value={fastEnd} onChange={(e) => setFastEnd(e.target.value)} />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          {label('Thêm ngày IF', 'Add IF day')}
        </button>
      </div>
      <ul className="wb-module-list">
        {items.length === 0 ? (
          <li className="teacher-empty">{label('Chưa có nhật ký IF.', 'No fasting logs yet.')}</li>
        ) : (
          items.map((it) => (
            <li key={it.id} className={`wb-module-row${it.completed ? ' is-done' : ''}`}>
              <label className="wb-task-check">
                <input
                  type="checkbox"
                  checked={it.completed}
                  onChange={() =>
                    persist(
                      items.map((x) =>
                        x.id === it.id ? { ...x, completed: !x.completed } : x,
                      ),
                    )
                  }
                />
                <div>
                  <strong>
                    {it.date} · {it.protocol}
                    {it.fastStart && it.fastEnd ? ` · ${it.fastStart} → ${it.fastEnd}` : ''}
                  </strong>
                  {it.note ? <span>{it.note}</span> : null}
                </div>
              </label>
              <WbRowActions>
                <WbDeleteBtn
                  label={label('Xóa', 'Delete')}
                  onClick={() => persist(items.filter((x) => x.id !== it.id))}
                />
              </WbRowActions>
            </li>
          ))
        )}
      </ul>
    </>
  )
}

function VegSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbHealthVeg[]>(() => readHealthVeg())
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [mode, setMode] = useState<WbHealthVeg['mode']>('vegetarian')
  const [meals, setMeals] = useState('')
  const [note, setNote] = useState('')

  const persist = (next: WbHealthVeg[]) => {
    setItems(next)
    writeHealthVeg(next)
  }

  const modeLabel = (m: WbHealthVeg['mode']) => {
    switch (m) {
      case 'vegetarian':
        return label('Ăn chay (có trứng/sữa)', 'Vegetarian')
      case 'vegan':
        return label('Thuần chay', 'Vegan')
      case 'flexitarian':
        return label('Linh hoạt', 'Flexitarian')
      default:
        return label('Khác', 'Other')
    }
  }

  const add = () => {
    if (!date) return
    persist(
      [
        {
          id: newId(),
          date,
          mode,
          ok: true,
          ...(meals.trim() ? { meals: meals.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        ...items,
      ].sort((a, b) => b.date.localeCompare(a.date)),
    )
    setMeals('')
    setNote('')
  }

  const weekOk = items.filter((i) => {
    const d = daysAgo(i.date)
    return d >= 0 && d < 7 && i.ok
  }).length

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Theo dõi ngày ăn chay / thuần chay — ghi bữa và mức độ giữ vững.',
          'Track vegetarian / vegan days — log meals and how well you stuck to it.',
        )}
      </p>
      <div className="wb-finance-summary">
        <span>
          {label('Ngày giữ vững (7 ngày):', 'On-plan days (7d):')} <strong>{weekOk}</strong>
        </span>
      </div>
      <div className="wb-module-form">
        <label>
          <span>{label('Ngày', 'Date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>{label('Chế độ', 'Mode')}</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as WbHealthVeg['mode'])}>
            <option value="vegetarian">{label('Ăn chay', 'Vegetarian')}</option>
            <option value="vegan">{label('Thuần chay', 'Vegan')}</option>
            <option value="flexitarian">{label('Linh hoạt', 'Flexitarian')}</option>
            <option value="other">{label('Khác', 'Other')}</option>
          </select>
        </label>
        <label className="teacher-form-wide">
          <span>{label('Bữa ăn', 'Meals')}</span>
          <input
            value={meals}
            onChange={(e) => setMeals(e.target.value)}
            placeholder={label('VD: Phở chay · Salad · Đậu hũ', 'e.g. Veg pho · Salad · Tofu')}
          />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          {label('Thêm ngày', 'Add day')}
        </button>
      </div>
      <ul className="wb-module-list">
        {items.length === 0 ? (
          <li className="teacher-empty">{label('Chưa có nhật ký ăn chay.', 'No plant-based logs yet.')}</li>
        ) : (
          items.map((it) => (
            <li key={it.id} className={`wb-module-row${!it.ok ? ' is-done' : ''}`}>
              <label className="wb-task-check">
                <input
                  type="checkbox"
                  checked={it.ok}
                  onChange={() =>
                    persist(items.map((x) => (x.id === it.id ? { ...x, ok: !x.ok } : x)))
                  }
                />
                <div>
                  <strong>
                    {it.date} · {modeLabel(it.mode)}
                    {it.ok ? '' : ` · ${label('Lệch kế hoạch', 'Off plan')}`}
                  </strong>
                  {it.meals ? <span>{it.meals}</span> : null}
                  {it.note ? <span>{it.note}</span> : null}
                </div>
              </label>
              <WbRowActions>
                <WbDeleteBtn
                  label={label('Xóa', 'Delete')}
                  onClick={() => persist(items.filter((x) => x.id !== it.id))}
                />
              </WbRowActions>
            </li>
          ))
        )}
      </ul>
    </>
  )
}

function SimpleList({
  items,
  empty,
  onDelete,
  vi,
}: {
  items: { id: string; title: string; note?: string }[]
  empty: string
  onDelete: (id: string) => void
  vi: boolean
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  return (
    <ul className="wb-module-list">
      {items.length === 0 ? (
        <li className="teacher-empty">{empty}</li>
      ) : (
        items.map((it) => (
          <li key={it.id} className="wb-module-row">
            <div className="wb-module-meta">
              <strong>{it.title}</strong>
              {it.note ? <span>{it.note}</span> : null}
            </div>
            <WbRowActions>
              <WbDeleteBtn label={label('Xóa', 'Delete')} onClick={() => onDelete(it.id)} />
            </WbRowActions>
          </li>
        ))
      )}
    </ul>
  )
}

function daysAgo(isoDate: string): number {
  const a = new Date()
  a.setHours(12, 0, 0, 0)
  const b = new Date(isoDate.slice(0, 10) + 'T12:00:00')
  return Math.round((a.getTime() - b.getTime()) / 86_400_000)
}
