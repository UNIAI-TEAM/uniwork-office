import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import defaultBodyMannequin from './assets/health-body-mannequin-3d.jpg'
import {
  clearHealthBodyBlob,
  compressPetImage,
  getHealthBodyBlob,
  putHealthBodyBlob,
  readHealthBodyMeta,
  readHealthMetricGoals,
  readHealthMetrics,
  writeHealthBodyMeta,
  writeHealthMetricGoals,
  writeHealthMetrics,
  type WbHealthBodySource,
  type WbHealthMetric,
  type WbHealthMetricGoal,
} from './workbench-pins'

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

type MetricKey = Exclude<WbHealthMetric['metric'], 'other'>

const METRIC_META: Record<
  MetricKey,
  {
    labelVi: string
    labelEn: string
    unit: string
    color: string
    node: { cx: number; cy: number }
  }
> = {
  sleep: {
    labelVi: 'Giấc ngủ',
    labelEn: 'Sleep',
    unit: 'h',
    color: '#38BDF8',
    node: { cx: 100, cy: 36 },
  },
  hr: {
    labelVi: 'Nhịp tim',
    labelEn: 'Heart rate',
    unit: 'bpm',
    color: '#FB7185',
    node: { cx: 88, cy: 128 },
  },
  bp: {
    labelVi: 'Huyết áp',
    labelEn: 'Blood pressure',
    unit: 'mmHg',
    color: '#FB923C',
    node: { cx: 118, cy: 128 },
  },
  weight: {
    labelVi: 'Cân nặng',
    labelEn: 'Weight',
    unit: 'kg',
    color: '#34D399',
    node: { cx: 100, cy: 168 },
  },
  bmi: {
    labelVi: 'BMI',
    labelEn: 'BMI',
    unit: '',
    color: '#2DD4BF',
    node: { cx: 100, cy: 198 },
  },
  glucose: {
    labelVi: 'Đường huyết',
    labelEn: 'Glucose',
    unit: 'mmol/L',
    color: '#FBBF24',
    node: { cx: 42, cy: 186 },
  },
  steps: {
    labelVi: 'Bước chân',
    labelEn: 'Steps',
    unit: '',
    color: '#60A5FA',
    node: { cx: 100, cy: 278 },
  },
}

const METRIC_KEYS: MetricKey[] = ['hr', 'sleep', 'steps', 'weight', 'bp', 'bmi', 'glucose']

function latestByMetric(items: WbHealthMetric[]): Partial<Record<MetricKey, WbHealthMetric>> {
  const map: Partial<Record<MetricKey, WbHealthMetric>> = {}
  for (const it of items) {
    if (it.metric === 'other') continue
    if (!map[it.metric]) map[it.metric] = it
  }
  return map
}

function numVal(v: string | undefined): number | null {
  if (!v) return null
  const n = Number(String(v).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : null
}

function goalPct(current: string | undefined, target: string): number {
  const c = numVal(current)
  const t = numVal(target)
  if (c == null || t == null || t <= 0) return 0
  if (c <= t) return Math.min(100, Math.round((c / t) * 100))
  return Math.min(100, Math.round((t / c) * 100))
}

function seriesForMetric(items: WbHealthMetric[], metric: MetricKey, n = 10): number[] {
  const vals = items
    .filter((i) => i.metric === metric)
    .slice(0, n)
    .map((i) => numVal(i.value))
    .filter((x): x is number => x != null)
    .reverse()
  return vals
}

export function HealthMetricsViz({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbHealthMetric[]>(() => readHealthMetrics())
  const [goals, setGoals] = useState<WbHealthMetricGoal[]>(() => readHealthMetricGoals())
  const [active, setActive] = useState<MetricKey>('hr')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [goalTarget, setGoalTarget] = useState(
    () => readHealthMetricGoals().find((g) => g.metric === 'hr')?.target ?? '',
  )

  const latest = useMemo(() => latestByMetric(items), [items])
  const meta = METRIC_META[active]
  const trend = useMemo(() => seriesForMetric(items, active, 12), [items, active])

  const persistMetrics = (next: WbHealthMetric[]) => {
    setItems(next)
    writeHealthMetrics(next)
  }
  const persistGoals = (next: WbHealthMetricGoal[]) => {
    setGoals(next)
    writeHealthMetricGoals(next)
  }

  const selectMetric = (m: MetricKey) => {
    setActive(m)
    setGoalTarget(goals.find((g) => g.metric === m)?.target ?? '')
    setValue('')
  }

  const saveMetric = () => {
    const v = value.trim()
    if (!v || !date) return
    persistMetrics(
      [
        {
          id: newId(),
          date,
          metric: active,
          value: v,
          ...(meta.unit ? { unit: meta.unit } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        ...items,
      ].sort((a, b) => b.date.localeCompare(a.date)),
    )
    setValue('')
    setNote('')
  }

  const saveGoal = () => {
    const t = goalTarget.trim()
    if (!t) return
    persistGoals([
      { id: newId(), metric: active, target: t, ...(meta.unit ? { unit: meta.unit } : {}) },
      ...goals.filter((g) => g.metric !== active),
    ])
  }

  const gaugeMetrics: MetricKey[] = ['hr', 'sleep', 'steps', 'weight']

  return (
    <div className="wb-hdash">
      <div className="wb-hdash-top">
        <p className="teacher-hint">
          {label(
            'Dashboard chỉ số — giai đoạn này nhập thủ công. Giao diện kết nối Apple Watch / đồng hồ sức khoẻ đã sẵn, bật khi có mạng.',
            'Metrics dashboard — manual entry for now. Apple Watch / wearables UI is ready for when network sync is available.',
          )}
        </p>
        <DeviceConnectStrip vi={vi} />
      </div>

      <div className="wb-hdash-gauges">
        {gaugeMetrics.map((m) => {
          const mm = METRIC_META[m]
          const cur = latest[m]
          const goal = goals.find((g) => g.metric === m)
          const pct = goal ? goalPct(cur?.value, goal.target) : cur ? 72 : 0
          return (
            <button
              key={m}
              type="button"
              className={`wb-hdash-gauge${active === m ? ' is-active' : ''}`}
              style={{ ['--hm' as string]: mm.color }}
              onClick={() => selectMetric(m)}
            >
              <svg viewBox="0 0 72 72" className="wb-hdash-gauge-svg" aria-hidden>
                <circle cx="36" cy="36" r="28" className="wb-hdash-gauge-track" />
                <circle
                  cx="36"
                  cy="36"
                  r="28"
                  className="wb-hdash-gauge-fill"
                  strokeDasharray={`${(pct / 100) * 176} 176`}
                  transform="rotate(-90 36 36)"
                />
                {m === 'hr' ? (
                  <path
                    d="M36 44c-8-6-12-10-12-15a7 7 0 0 1 12-5 7 7 0 0 1 12 5c0 5-4 9-12 15z"
                    fill="var(--hm)"
                    opacity="0.95"
                  />
                ) : (
                  <text x="36" y="40" textAnchor="middle" className="wb-hdash-gauge-center">
                    {cur?.value ?? '—'}
                  </text>
                )}
              </svg>
              <div>
                <strong>{vi ? mm.labelVi : mm.labelEn}</strong>
                <span>
                  {cur
                    ? `${cur.value}${mm.unit ? ` ${mm.unit}` : ''}`
                    : label('Chưa có', 'No data')}
                  {goal ? ` · ${label('MT', 'Goal')} ${goal.target}` : ''}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="wb-hdash-main">
        <div className="wb-hdash-charts">
          <section className="wb-hdash-card">
            <header>
              <h3>
                {vi ? meta.labelVi : meta.labelEn} · {label('Xu hướng', 'Trend')}
              </h3>
              <span style={{ color: meta.color }}>
                {latest[active]?.value ?? '—'}
                {meta.unit ? ` ${meta.unit}` : ''}
              </span>
            </header>
            <BarTrend values={trend} color={meta.color} empty={label('Chưa đủ dữ liệu', 'Not enough data')} />
          </section>
          <section className="wb-hdash-card">
            <header>
              <h3>{label('Sóng hoạt động', 'Activity wave')}</h3>
            </header>
            <AreaWave
              values={trend.length ? trend : [2, 4, 3, 6, 5, 7, 4, 8, 6, 5]}
              color={meta.color}
              muted={!trend.length}
            />
          </section>
          <section className="wb-hdash-card wb-hdash-entry">
            <header>
              <h3>{label('Nhập thủ công', 'Manual entry')}</h3>
              <span className="wb-hdash-badge">{label('Giai đoạn 1', 'Phase 1')}</span>
            </header>
            <div className="wb-module-form wb-hm-form">
              <label>
                <span>{label('Ngày', 'Date')}</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                <span>
                  {label('Giá trị', 'Value')}
                  {meta.unit ? ` (${meta.unit})` : ''}
                </span>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={active === 'bp' ? '120/80' : active === 'hr' ? '72' : ''}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveMetric()
                  }}
                />
              </label>
              <label className="teacher-form-wide">
                <span>{label('Ghi chú', 'Note')}</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <label className="teacher-form-wide">
                <span>{label('Mục tiêu chỉ số', 'Metric goal')}</span>
                <input
                  value={goalTarget}
                  onChange={(e) => setGoalTarget(e.target.value)}
                  placeholder={label('VD: 70 bpm / 8h / 10000', 'e.g. 70 bpm / 8h / 10000')}
                />
              </label>
              <div className="teacher-chip-row">
                <button type="button" className="btn btn-primary" onClick={saveMetric}>
                  {label('Lưu chỉ số', 'Save reading')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={saveGoal}>
                  {label('Đặt mục tiêu', 'Set goal')}
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="wb-hdash-right">
          <div className="wb-hdash-body-card">
            <DashboardBody active={active} onSelect={selectMetric} vi={vi} latest={latest} />
          </div>
          <ul className="wb-hdash-side">
            {METRIC_KEYS.map((m) => {
              const mm = METRIC_META[m]
              const cur = latest[m]
              const has = Boolean(cur)
              return (
                <li key={m}>
                  <button
                    type="button"
                    className={`wb-hdash-side-item${active === m ? ' is-active' : ''}`}
                    style={{ ['--hm' as string]: mm.color }}
                    onClick={() => selectMetric(m)}
                  >
                    <i className={`wb-hdash-status${has ? ' is-ok' : ''}`} />
                    <div>
                      <strong>{vi ? mm.labelVi : mm.labelEn}</strong>
                      <span>
                        {cur
                          ? `${cur.value}${mm.unit ? ` ${mm.unit}` : ''} · ${cur.date}`
                          : label('Chạm hình / nhập tay', 'Tap body / enter')}
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}

function DeviceConnectStrip({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  return (
    <div className="wb-hdash-devices" aria-label={label('Nhập thủ công', 'Manual entry')}>
      <div className="wb-hdash-device-main">
        <span className="wb-hdash-device-pulse" aria-hidden />
        <div>
          <strong>{label('Chỉ nhập thủ công', 'Manual entry only')}</strong>
          <span>
            {label(
              'Số liệu sức khoẻ lưu trên máy. Đồng bộ Apple Watch / wearables chưa có trong bản này.',
              'Health metrics stay on this device. Apple Watch / wearable sync is not available in this build.',
            )}
          </span>
        </div>
      </div>
      <div className="wb-hdash-device-actions">
        <span className="wb-hdash-badge wb-hdash-badge-muted">
          {label('Offline · thủ công', 'Offline · manual')}
        </span>
      </div>
    </div>
  )
}

function BarTrend({
  values,
  color,
  empty,
}: {
  values: number[]
  color: string
  empty: string
}): ReactElement {
  if (values.length < 2) return <p className="teacher-empty">{empty}</p>
  const max = Math.max(...values, 1)
  const w = 320
  const h = 96
  const gap = 4
  const bw = (w - gap * (values.length - 1)) / values.length
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="wb-hdash-chart-svg" role="img">
      {values.map((v, i) => {
        const hh = (v / max) * (h - 8)
        const colors = [color, '#FB7185', '#2DD4BF', '#FB923C']
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={h - hh}
            width={bw}
            height={Math.max(3, hh)}
            rx={3}
            fill={colors[i % colors.length]}
            opacity={0.85 + (i / values.length) * 0.15}
          />
        )
      })}
    </svg>
  )
}

function AreaWave({
  values,
  color,
  muted,
}: {
  values: number[]
  color: string
  muted?: boolean
}): ReactElement {
  const w = 320
  const h = 72
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w
    const y = h - ((v - min) / span) * (h - 10) - 4
    return `${x},${y}`
  })
  const line = pts.join(' ')
  const area = `0,${h} ${line} ${w},${h}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="wb-hdash-chart-svg" role="img" opacity={muted ? 0.45 : 1}>
      <polygon points={area} fill={color} opacity="0.22" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  )
}

function DashboardBody({
  active,
  onSelect,
  vi,
  latest,
}: {
  active: MetricKey
  onSelect: (m: MetricKey) => void
  vi: boolean
  latest: Partial<Record<MetricKey, WbHealthMetric>>
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const uploadRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [customSrc, setCustomSrc] = useState<string | null>(null)
  const [bodySource, setBodySource] = useState<WbHealthBodySource>('default')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    const meta = readHealthBodyMeta()
    if (!meta) {
      setCustomSrc(null)
      setBodySource('default')
      return
    }
    void getHealthBodyBlob().then((data) => {
      if (cancelled) return
      if (data) {
        setCustomSrc(data)
        setBodySource(meta.source)
      } else {
        setCustomSrc(null)
        setBodySource('default')
        writeHealthBodyMeta(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const saveCustom = async (files: FileList | null, source: 'upload' | 'camera') => {
    if (!files?.length) return
    const file = files[0]
    if (!file?.type.startsWith('image/')) return
    setBusy(true)
    setErr('')
    try {
      const dataUrl = await compressPetImage(file, 720, 0.82)
      await putHealthBodyBlob(dataUrl)
      const meta = { source, updatedAt: new Date().toISOString() }
      writeHealthBodyMeta(meta)
      setCustomSrc(dataUrl)
      setBodySource(source)
    } catch {
      setErr(
        label(
          'Không lưu được ảnh trên máy. Thử ảnh nhỏ hơn.',
          'Could not save photo on this device. Try a smaller image.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  const resetDefault = async () => {
    setBusy(true)
    setErr('')
    try {
      await clearHealthBodyBlob()
      writeHealthBodyMeta(null)
      setCustomSrc(null)
      setBodySource('default')
    } catch {
      setErr(label('Không xoá được ảnh tuỳ chỉnh.', 'Could not clear custom photo.'))
    } finally {
      setBusy(false)
    }
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>, source: 'upload' | 'camera') => {
    const files = e.target.files
    e.target.value = ''
    void saveCustom(files, source)
  }

  const photoSrc = customSrc || defaultBodyMannequin

  return (
    <div className="wb-hdash-body-wrap">
      <div className="wb-hdash-body-stage">
        <img
          className="wb-hdash-body-photo"
          src={photoSrc}
          alt={
            bodySource === 'default'
              ? label('Mô hình cơ thể 3D chuẩn y khoa', 'Medical 3D body mannequin')
              : label('Ảnh cơ thể của bạn (lưu trên máy)', 'Your body photo (stored on device)')
          }
          draggable={false}
        />
        <svg
          className="wb-hdash-body-nodes"
          viewBox="0 0 200 360"
          role="img"
          aria-label={vi ? 'Điểm chỉ số trên cơ thể' : 'Body metric nodes'}
        >
          {METRIC_KEYS.map((m) => {
            const mm = METRIC_META[m]
            const on = active === m
            const has = Boolean(latest[m])
            return (
              <g
                key={m}
                className="wb-hdash-node"
                onClick={() => onSelect(m)}
                style={{ cursor: 'pointer' }}
              >
                <title>{vi ? mm.labelVi : mm.labelEn}</title>
                <circle
                  cx={mm.node.cx}
                  cy={mm.node.cy}
                  r={on ? 11 : 8}
                  fill={mm.color}
                  opacity={on ? 1 : has ? 0.9 : 0.55}
                />
                <circle
                  cx={mm.node.cx}
                  cy={mm.node.cy}
                  r={on ? 18 : 14}
                  fill="none"
                  stroke={mm.color}
                  strokeWidth={on ? 2.5 : 1.5}
                  opacity={on ? 0.95 : 0.4}
                />
              </g>
            )
          })}
        </svg>
      </div>

      <div className="wb-hdash-body-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
        >
          {label('📷 Chụp ảnh', '📷 Camera')}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => uploadRef.current?.click()}
        >
          {label('📁 Tải ảnh lên', '📁 Upload')}
        </button>
        {bodySource !== 'default' ? (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void resetDefault()}>
            {label('Mô hình mặc định', 'Default model')}
          </button>
        ) : null}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="user"
          hidden
          onChange={(e) => onFile(e, 'camera')}
        />
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onFile(e, 'upload')}
        />
      </div>

      {err ? <p className="wb-pets-err">{err}</p> : null}
      <p className="wb-hdash-body-cap">
        {bodySource === 'default'
          ? label(
              'Mô hình 3D y khoa mặc định · chạm nút chỉ số · ảnh tuỳ chỉnh lưu trên máy.',
              'Default medical 3D model · tap metric nodes · custom photos stay on-device.',
            )
          : label(
              'Ảnh của bạn (IndexedDB trên máy) · chạm nút để chọn chỉ số.',
              'Your photo (on-device IndexedDB) · tap nodes to select a metric.',
            )}
      </p>
    </div>
  )
}
