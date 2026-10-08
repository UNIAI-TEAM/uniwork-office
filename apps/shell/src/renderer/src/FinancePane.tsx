import { useState } from 'react'
import type { ReactElement } from 'react'
import {
  readFinance,
  readFinanceGoals,
  readFinanceInvest,
  readFinanceSubTab,
  writeFinance,
  writeFinanceGoals,
  writeFinanceInvest,
  writeFinanceSubTab,
  type FinanceSubTabId,
  type WbFinanceGoal,
  type WbFinanceInvest,
  type WbFinanceItem,
} from './workbench-pins'
import { WbDeleteBtn, WbEditBtn, WbRowActions } from './WbRowActions'

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const SUB_TABS: { id: FinanceSubTabId; labelVi: string; labelEn: string }[] = [
  { id: 'goals', labelVi: 'Mục tiêu tài chính', labelEn: 'Goals' },
  { id: 'spending', labelVi: 'Chi tiêu cá nhân', labelEn: 'Spending' },
  { id: 'invest', labelVi: 'Đầu tư tài chính', labelEn: 'Investing' },
]

function money(n: number, vi: boolean): string {
  return n.toLocaleString(vi ? 'vi-VN' : 'en-US', { maximumFractionDigits: 0 })
}

export function FinancePane({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [sub, setSub] = useState<FinanceSubTabId>(() => readFinanceSubTab())

  const select = (id: FinanceSubTabId) => {
    setSub(id)
    writeFinanceSubTab(id)
  }

  return (
    <div className="wb-finance">
      <p className="teacher-hint">
        {label(
          'Toàn trình tài chính cá nhân offline: đặt mục tiêu → giám sát thu/chi → đầu tư tích luỹ tài sản.',
          'Full personal-finance loop offline: set goals → track income/spend → invest and accumulate.',
        )}
      </p>
      <nav className="wb-subtabs" aria-label={label('Tab con Tài chính', 'Finance sub-tabs')}>
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
      {sub === 'goals' && <GoalsSub vi={vi} />}
      {sub === 'spending' && <SpendingSub vi={vi} />}
      {sub === 'invest' && <InvestSub vi={vi} />}
    </div>
  )
}

function GoalsSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbFinanceGoal[]>(() => readFinanceGoals())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [currentAmount, setCurrentAmount] = useState('0')
  const [deadline, setDeadline] = useState('')
  const [note, setNote] = useState('')

  const persist = (next: WbFinanceGoal[]) => {
    setItems(next)
    writeFinanceGoals(next)
  }

  const clearForm = () => {
    setEditingId(null)
    setTitle('')
    setTargetAmount('')
    setCurrentAmount('0')
    setDeadline('')
    setNote('')
  }

  const startEdit = (g: WbFinanceGoal) => {
    setEditingId(g.id)
    setTitle(g.title)
    setTargetAmount(String(g.targetAmount))
    setCurrentAmount(String(g.currentAmount))
    setDeadline(g.deadline ?? '')
    setNote(g.note ?? '')
  }

  const save = () => {
    const t = title.trim()
    const target = Number(targetAmount)
    const current = Number(currentAmount || '0')
    if (!t || !Number.isFinite(target) || target <= 0 || !Number.isFinite(current) || current < 0) {
      return
    }
    const row: WbFinanceGoal = {
      id: editingId ?? newId(),
      title: t,
      targetAmount: target,
      currentAmount: current,
      done: current >= target,
      ...(deadline ? { deadline } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    if (editingId) {
      persist(items.map((x) => (x.id === editingId ? row : x)))
    } else {
      persist([row, ...items])
    }
    clearForm()
  }

  const bump = (id: string, delta: number) => {
    persist(
      items.map((g) => {
        if (g.id !== id) return g
        const next = Math.max(0, Math.round((g.currentAmount + delta) * 100) / 100)
        return { ...g, currentAmount: next, done: next >= g.targetAmount }
      }),
    )
  }

  const openGoals = items.filter((g) => !g.done)
  const totalTarget = openGoals.reduce((s, g) => s + g.targetAmount, 0)
  const totalCurrent = openGoals.reduce((s, g) => s + g.currentAmount, 0)

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Đặt mục tiêu tiết kiệm / mua sắm lớn / quỹ khẩn — theo dõi tiến độ góp dần.',
          'Set savings / big-purchase / emergency-fund goals — track progress over time.',
        )}
      </p>
      <div className="wb-finance-summary">
        <span>
          {label('Đang góp:', 'In progress:')}{' '}
          <strong>
            {money(totalCurrent, vi)} / {money(totalTarget, vi)}
          </strong>
        </span>
        <span>
          {label('Mục tiêu mở:', 'Open goals:')} <strong>{openGoals.length}</strong>
        </span>
      </div>
      <div className="wb-module-form">
        <label className="teacher-form-wide">
          <span>{label('Tên mục tiêu', 'Goal name')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label('VD: Quỹ khẩn cấp 6 tháng', 'e.g. 6-month emergency fund')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
        </label>
        <label>
          <span>{label('Số cần đạt', 'Target')}</span>
          <input
            inputMode="decimal"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            placeholder="0"
          />
        </label>
        <label>
          <span>{label('Đã có', 'Saved so far')}</span>
          <input
            inputMode="decimal"
            value={currentAmount}
            onChange={(e) => setCurrentAmount(e.target.value)}
          />
        </label>
        <label>
          <span>{label('Hạn', 'Deadline')}</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="teacher-chip-row">
          <button type="button" className="btn btn-primary" onClick={save}>
            {editingId ? label('Lưu mục tiêu', 'Save goal') : label('Thêm mục tiêu', 'Add goal')}
          </button>
          {editingId ? (
            <button type="button" className="btn btn-secondary" onClick={clearForm}>
              {label('Huỷ sửa', 'Cancel edit')}
            </button>
          ) : null}
        </div>
      </div>
      <ul className="wb-module-list">
        {items.length === 0 ? (
          <li className="teacher-empty">{label('Chưa có mục tiêu.', 'No goals yet.')}</li>
        ) : (
          items.map((g) => {
            const pct = Math.min(100, Math.round((g.currentAmount / Math.max(1, g.targetAmount)) * 100))
            return (
              <li key={g.id} className={`wb-module-row wb-finance-goal-row${g.done ? ' is-done' : ''}`}>
                <div className="wb-growth-main">
                  <strong>
                    {g.title}
                    {g.done ? ` · ${label('Đạt', 'Done')}` : ''}
                  </strong>
                  <span>
                    {money(g.currentAmount, vi)} / {money(g.targetAmount, vi)}
                    {g.deadline ? ` · ${label('Hạn', 'Due')} ${g.deadline}` : ''}
                  </span>
                  {g.note ? <span>{g.note}</span> : null}
                  <div className="wb-desk-bar-track" aria-hidden>
                    <div
                      className="wb-desk-bar-fill"
                      style={{ width: `${pct}%`, background: 'var(--accent)' }}
                    />
                  </div>
                  <span className="teacher-hint">{pct}%</span>
                </div>
                <WbRowActions>
                  <WbEditBtn label={label('Sửa', 'Edit')} onClick={() => startEdit(g)} />
                  <button type="button" className="wb-row-chip" onClick={() => bump(g.id, 500_000)}>
                    +500k
                  </button>
                  <button type="button" className="wb-row-chip" onClick={() => bump(g.id, 1_000_000)}>
                    +1tr
                  </button>
                  <WbDeleteBtn
                    label={label('Xóa', 'Delete')}
                    onClick={() => {
                      if (editingId === g.id) clearForm()
                      persist(items.filter((x) => x.id !== g.id))
                    }}
                  />
                </WbRowActions>
              </li>
            )
          })
        )}
      </ul>
    </>
  )
}

function SpendingSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbFinanceItem[]>(() => readFinance())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [kind, setKind] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [itemLabel, setItemLabel] = useState('')
  const [category, setCategory] = useState<NonNullable<WbFinanceItem['category']>>('living')

  const persist = (next: WbFinanceItem[]) => {
    setItems(next)
    writeFinance(next)
  }

  const catLabel = (c: NonNullable<WbFinanceItem['category']>) => {
    switch (c) {
      case 'living':
        return label('Sinh hoạt', 'Living')
      case 'food':
        return label('Ăn uống', 'Food')
      case 'transport':
        return label('Di chuyển', 'Transport')
      case 'bills':
        return label('Hoá đơn', 'Bills')
      case 'fun':
        return label('Giải trí', 'Fun')
      case 'health':
        return label('Sức khoẻ', 'Health')
      default:
        return label('Khác', 'Other')
    }
  }

  const clearForm = () => {
    setEditingId(null)
    setDate(new Date().toISOString().slice(0, 10))
    setKind('expense')
    setAmount('')
    setItemLabel('')
    setCategory('living')
  }

  const startEdit = (it: WbFinanceItem) => {
    setEditingId(it.id)
    setDate(it.date)
    setKind(it.kind)
    setAmount(String(it.amount))
    setItemLabel(it.label)
    setCategory(it.category ?? 'living')
  }

  const save = () => {
    const n = Number(amount)
    const t = itemLabel.trim()
    if (!t || !Number.isFinite(n) || n <= 0 || !date) return
    const row: WbFinanceItem = {
      id: editingId ?? newId(),
      date,
      kind,
      amount: Math.round(n * 100) / 100,
      label: t,
      ...(kind === 'expense' ? { category } : {}),
    }
    const next = editingId
      ? items.map((x) => (x.id === editingId ? row : x))
      : [row, ...items]
    persist(next.sort((a, b) => b.date.localeCompare(a.date)))
    clearForm()
  }

  const month = new Date().toISOString().slice(0, 7)
  const monthItems = items.filter((i) => i.date.startsWith(month))
  const income = monthItems.filter((i) => i.kind === 'income').reduce((s, i) => s + i.amount, 0)
  const expense = monthItems.filter((i) => i.kind === 'expense').reduce((s, i) => s + i.amount, 0)

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Giám sát thu / chi cá nhân theo tháng — gắn danh mục để xem cấu trúc chi.',
          'Monitor personal income / spend by month — categorize expenses.',
        )}
      </p>
      <div className="wb-finance-summary">
        <span>
          {label('Thu tháng', 'Month in')}: <strong>{money(income, vi)}</strong>
        </span>
        <span>
          {label('Chi tháng', 'Month out')}: <strong>{money(expense, vi)}</strong>
        </span>
        <span>
          {label('Còn lại', 'Left')}: <strong>{money(income - expense, vi)}</strong>
        </span>
      </div>
      <div className="wb-module-form">
        <label>
          <span>{label('Ngày', 'Date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>{label('Loại', 'Type')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'income' | 'expense')}>
            <option value="expense">{label('Chi', 'Expense')}</option>
            <option value="income">{label('Thu', 'Income')}</option>
          </select>
        </label>
        {kind === 'expense' ? (
          <label>
            <span>{label('Danh mục', 'Category')}</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as NonNullable<WbFinanceItem['category']>)}
            >
              <option value="living">{label('Sinh hoạt', 'Living')}</option>
              <option value="food">{label('Ăn uống', 'Food')}</option>
              <option value="transport">{label('Di chuyển', 'Transport')}</option>
              <option value="bills">{label('Hoá đơn', 'Bills')}</option>
              <option value="fun">{label('Giải trí', 'Fun')}</option>
              <option value="health">{label('Sức khoẻ', 'Health')}</option>
              <option value="other">{label('Khác', 'Other')}</option>
            </select>
          </label>
        ) : null}
        <label>
          <span>{label('Số tiền', 'Amount')}</span>
          <input
            type="number"
            min={0}
            step="1000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Nội dung', 'Label')}</span>
          <input
            value={itemLabel}
            onChange={(e) => setItemLabel(e.target.value)}
            placeholder={label('VD: Xăng xe', 'e.g. Fuel')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
        </label>
        <div className="teacher-chip-row">
          <button type="button" className="btn btn-primary" onClick={save}>
            {editingId ? label('Lưu giao dịch', 'Save entry') : label('Thêm giao dịch', 'Add entry')}
          </button>
          {editingId ? (
            <button type="button" className="btn btn-secondary" onClick={clearForm}>
              {label('Huỷ sửa', 'Cancel edit')}
            </button>
          ) : null}
        </div>
      </div>
      <ul className="wb-module-list">
        {items.length === 0 ? (
          <li className="teacher-empty">{label('Chưa có giao dịch.', 'No entries yet.')}</li>
        ) : (
          items.map((it) => (
            <li key={it.id} className="wb-module-row">
              <div className="wb-module-meta">
                <strong>
                  {it.date} · {it.kind === 'income' ? label('Thu', 'In') : label('Chi', 'Out')} ·{' '}
                  {money(it.amount, vi)}
                </strong>
                <span>
                  {it.label}
                  {it.kind === 'expense' && it.category ? ` · ${catLabel(it.category)}` : ''}
                </span>
              </div>
              <WbRowActions>
                <WbEditBtn label={label('Sửa', 'Edit')} onClick={() => startEdit(it)} />
                <WbDeleteBtn
                  label={label('Xóa', 'Delete')}
                  onClick={() => {
                    if (editingId === it.id) clearForm()
                    persist(items.filter((x) => x.id !== it.id))
                  }}
                />
              </WbRowActions>
            </li>
          ))
        )}
      </ul>
    </>
  )
}

function InvestSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbFinanceInvest[]>(() => readFinanceInvest())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<WbFinanceInvest['kind']>('savings')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')

  const persist = (next: WbFinanceInvest[]) => {
    setItems(next)
    writeFinanceInvest(next)
  }

  const kindLabel = (k: WbFinanceInvest['kind']) => {
    switch (k) {
      case 'stock':
        return label('Cổ phiếu', 'Stocks')
      case 'fund':
        return label('Quỹ / ETF', 'Funds / ETF')
      case 'bond':
        return label('Trái phiếu', 'Bonds')
      case 'crypto':
        return label('Crypto', 'Crypto')
      case 'savings':
        return label('Tiết kiệm', 'Savings')
      case 'gold':
        return label('Vàng', 'Gold')
      case 'realestate':
        return label('Bất động sản', 'Real estate')
      default:
        return label('Khác', 'Other')
    }
  }

  const clearForm = () => {
    setEditingId(null)
    setName('')
    setKind('savings')
    setAmount('')
    setDate(new Date().toISOString().slice(0, 10))
    setNote('')
  }

  const startEdit = (it: WbFinanceInvest) => {
    setEditingId(it.id)
    setName(it.name)
    setKind(it.kind)
    setAmount(String(it.amount))
    setDate(it.date)
    setNote(it.note ?? '')
  }

  const save = () => {
    const n = name.trim()
    const a = Number(amount)
    if (!n || !date || !Number.isFinite(a) || a <= 0) return
    const row: WbFinanceInvest = {
      id: editingId ?? newId(),
      name: n,
      kind,
      amount: Math.round(a * 100) / 100,
      date,
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    const next = editingId
      ? items.map((x) => (x.id === editingId ? row : x))
      : [row, ...items]
    persist(next.sort((x, y) => y.date.localeCompare(x.date)))
    clearForm()
  }

  const total = items.reduce((s, i) => s + i.amount, 0)
  const byKind = new Map<WbFinanceInvest['kind'], number>()
  for (const it of items) {
    byKind.set(it.kind, (byKind.get(it.kind) ?? 0) + it.amount)
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Ghi nhận đầu tư / tích luỹ: tiết kiệm, cổ phiếu, quỹ, vàng, BĐS… (giá trị nắm giữ trên máy).',
          'Log investments / accumulation: savings, stocks, funds, gold, real estate… (on-device holdings).',
        )}
      </p>
      <div className="wb-finance-summary">
        <span>
          {label('Tổng nắm giữ:', 'Total holdings:')} <strong>{money(total, vi)}</strong>
        </span>
        <span>
          {label('Danh mục:', 'Positions:')} <strong>{items.length}</strong>
        </span>
      </div>
      {byKind.size > 0 ? (
        <ul className="wb-desk-bars wb-finance-alloc">
          {[...byKind.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <li key={k}>
                <div className="wb-desk-bar-meta">
                  <strong>{kindLabel(k)}</strong>
                  <span>
                    {money(v, vi)} · {total > 0 ? Math.round((v / total) * 100) : 0}%
                  </span>
                </div>
                <div className="wb-desk-bar-track">
                  <div
                    className="wb-desk-bar-fill"
                    style={{
                      width: `${total > 0 ? (v / total) * 100 : 0}%`,
                      background: 'var(--accent)',
                    }}
                  />
                </div>
              </li>
            ))}
        </ul>
      ) : null}
      <div className="wb-module-form">
        <label className="teacher-form-wide">
          <span>{label('Tên tài sản / mã', 'Asset / ticker')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={label('VD: Tiết kiệm Sacombank / FUEVFVND', 'e.g. High-yield savings / VOO')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
        </label>
        <label>
          <span>{label('Loại', 'Type')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as WbFinanceInvest['kind'])}>
            <option value="savings">{label('Tiết kiệm', 'Savings')}</option>
            <option value="stock">{label('Cổ phiếu', 'Stocks')}</option>
            <option value="fund">{label('Quỹ / ETF', 'Funds / ETF')}</option>
            <option value="bond">{label('Trái phiếu', 'Bonds')}</option>
            <option value="gold">{label('Vàng', 'Gold')}</option>
            <option value="crypto">{label('Crypto', 'Crypto')}</option>
            <option value="realestate">{label('Bất động sản', 'Real estate')}</option>
            <option value="other">{label('Khác', 'Other')}</option>
          </select>
        </label>
        <label>
          <span>{label('Giá trị', 'Amount')}</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          <span>{label('Ngày ghi', 'As of')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="teacher-chip-row">
          <button type="button" className="btn btn-primary" onClick={save}>
            {editingId ? label('Lưu vị thế', 'Save holding') : label('Thêm vị thế', 'Add holding')}
          </button>
          {editingId ? (
            <button type="button" className="btn btn-secondary" onClick={clearForm}>
              {label('Huỷ sửa', 'Cancel edit')}
            </button>
          ) : null}
        </div>
      </div>
      <ul className="wb-module-list">
        {items.length === 0 ? (
          <li className="teacher-empty">{label('Chưa có khoản đầu tư.', 'No investments yet.')}</li>
        ) : (
          items.map((it) => (
            <li key={it.id} className="wb-module-row">
              <div className="wb-module-meta">
                <strong>
                  {it.name} · {money(it.amount, vi)}
                </strong>
                <span>
                  {kindLabel(it.kind)} · {it.date}
                </span>
                {it.note ? <span>{it.note}</span> : null}
              </div>
              <WbRowActions>
                <WbEditBtn label={label('Sửa', 'Edit')} onClick={() => startEdit(it)} />
                <WbDeleteBtn
                  label={label('Xóa', 'Delete')}
                  onClick={() => {
                    if (editingId === it.id) clearForm()
                    persist(items.filter((x) => x.id !== it.id))
                  }}
                />
              </WbRowActions>
            </li>
          ))
        )}
      </ul>
    </>
  )
}
