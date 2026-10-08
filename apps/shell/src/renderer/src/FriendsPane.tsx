import { useState } from 'react'
import type { ReactElement } from 'react'
import {
  readFriendAnniversaries,
  readFriendEvents,
  readFriends,
  readFriendsSubTab,
  writeFriendAnniversaries,
  writeFriendEvents,
  writeFriends,
  writeFriendsSubTab,
  type FriendsSubTabId,
  type WbFriend,
  type WbFriendAnniversary,
  type WbFriendEvent,
} from './workbench-pins'
import { WbDeleteBtn, WbEditBtn, WbRowActions } from './WbRowActions'

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const SUB_TABS: {
  id: FriendsSubTabId
  labelVi: string
  labelEn: string
}[] = [
  { id: 'people', labelVi: 'Thông tin bạn bè', labelEn: 'Friends' },
  { id: 'events', labelVi: 'Sự kiện quan trọng', labelEn: 'Events' },
  { id: 'anniversaries', labelVi: 'Kỷ niệm', labelEn: 'Anniversaries' },
]

export function FriendsPane({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [sub, setSub] = useState<FriendsSubTabId>(() => readFriendsSubTab())

  const select = (id: FriendsSubTabId) => {
    setSub(id)
    writeFriendsSubTab(id)
  }

  return (
    <div className="wb-friends">
      <p className="teacher-hint">
        {label(
          'Quản lý bạn bè trên máy — hồ sơ, sự kiện quan trọng và kỷ niệm (sinh nhật, ngày quen…).',
          'On-device friends space — profiles, important events, and anniversaries.',
        )}
      </p>
      <nav className="wb-subtabs" aria-label={label('Tab con Bạn bè', 'Friends sub-tabs')}>
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
      {sub === 'people' && <PeopleSub vi={vi} />}
      {sub === 'events' && <EventsSub vi={vi} />}
      {sub === 'anniversaries' && <AnniversariesSub vi={vi} />}
    </div>
  )
}

function PeopleSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbFriend[]>(() => readFriends())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [howMet, setHowMet] = useState('')
  const [birthday, setBirthday] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [social, setSocial] = useState('')
  const [note, setNote] = useState('')

  const persist = (next: WbFriend[]) => {
    setItems(next)
    writeFriends(next)
  }

  const clearForm = () => {
    setEditingId(null)
    setName('')
    setNickname('')
    setHowMet('')
    setBirthday('')
    setPhone('')
    setEmail('')
    setSocial('')
    setNote('')
  }

  const startEdit = (it: WbFriend) => {
    setEditingId(it.id)
    setName(it.name)
    setNickname(it.nickname ?? '')
    setHowMet(it.howMet ?? '')
    setBirthday(it.birthday ?? '')
    setPhone(it.phone ?? '')
    setEmail(it.email ?? '')
    setSocial(it.social ?? '')
    setNote(it.note ?? '')
  }

  const save = () => {
    const n = name.trim()
    if (!n) return
    const row: WbFriend = {
      id: editingId ?? newId(),
      name: n,
      ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
      ...(howMet.trim() ? { howMet: howMet.trim() } : {}),
      ...(birthday ? { birthday } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(social.trim() ? { social: social.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    if (editingId) {
      persist(items.map((x) => (x.id === editingId ? row : x)))
    } else {
      persist([row, ...items])
    }
    clearForm()
  }

  const remove = (id: string) => {
    if (editingId === id) clearForm()
    persist(items.filter((x) => x.id !== id))
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Danh bạ bạn bè — liên hệ, sinh nhật, cách quen biết, mạng xã hội.',
          'Friend directory — contacts, birthdays, how you met, social handles.',
        )}
      </p>
      <div className="wb-module-form">
        <label>
          <span>{label('Họ tên', 'Name')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={label('VD: Trần Minh', 'e.g. Minh Tran')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
        </label>
        <label>
          <span>{label('Biệt danh', 'Nickname')}</span>
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </label>
        <label>
          <span>{label('Quen qua', 'How met')}</span>
          <input
            value={howMet}
            onChange={(e) => setHowMet(e.target.value)}
            placeholder={label('VD: Đại học / công ty…', 'e.g. College / work…')}
          />
        </label>
        <label>
          <span>{label('Sinh nhật', 'Birthday')}</span>
          <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        </label>
        <label>
          <span>{label('Điện thoại', 'Phone')}</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Mạng xã hội / Zalo', 'Social / chat')}</span>
          <input value={social} onChange={(e) => setSocial(e.target.value)} />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={label('Sở thích, món quà hay…', 'Interests, gift ideas…')}
          />
        </label>
        <div className="teacher-chip-row">
          <button type="button" className="btn btn-primary" onClick={save}>
            {editingId ? label('Lưu bạn', 'Save friend') : label('Thêm bạn', 'Add friend')}
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
          <li className="teacher-empty">{label('Chưa có bạn bè.', 'No friends yet.')}</li>
        ) : (
          items.map((it) => (
            <li key={it.id} className="wb-module-row">
              <div className="wb-module-meta">
                <strong>{it.nickname ? `${it.name} (${it.nickname})` : it.name}</strong>
                <span>
                  {[
                    it.howMet,
                    it.birthday ? `${label('SN', 'BD')}: ${it.birthday}` : null,
                    it.phone,
                    it.email,
                    it.social,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {it.note ? <span>{it.note}</span> : null}
              </div>
              <WbRowActions>
                <WbEditBtn label={label('Sửa', 'Edit')} onClick={() => startEdit(it)} />
                <WbDeleteBtn label={label('Xóa', 'Delete')} onClick={() => remove(it.id)} />
              </WbRowActions>
            </li>
          ))
        )}
      </ul>
    </>
  )
}

function EventsSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbFriendEvent[]>(() => readFriendEvents())
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [title, setTitle] = useState('')
  const [friendName, setFriendName] = useState('')
  const [kind, setKind] = useState<WbFriendEvent['kind']>('meetup')
  const [note, setNote] = useState('')

  const persist = (next: WbFriendEvent[]) => {
    setItems(next)
    writeFriendEvents(next)
  }

  const kindLabel = (k: WbFriendEvent['kind']) => {
    switch (k) {
      case 'meetup':
        return label('Gặp mặt', 'Meetup')
      case 'party':
        return label('Tiệc / sinh nhật', 'Party')
      case 'trip':
        return label('Du lịch cùng', 'Trip')
      case 'gift':
        return label('Quà / lời chúc', 'Gift')
      default:
        return label('Khác', 'Other')
    }
  }

  const add = () => {
    const t = title.trim()
    if (!t || !date) return
    persist(
      [
        {
          id: newId(),
          date,
          title: t,
          kind,
          done: false,
          ...(friendName.trim() ? { friendName: friendName.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        ...items,
      ].sort((a, b) => b.date.localeCompare(a.date)),
    )
    setTitle('')
    setFriendName('')
    setNote('')
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Sự kiện quan trọng với bạn bè — họp mặt, tiệc, chuyến đi, quà tặng.',
          'Important friend events — meetups, parties, trips, gifts.',
        )}
      </p>
      <div className="wb-module-form">
        <label>
          <span>{label('Ngày', 'Date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>{label('Loại', 'Kind')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as WbFriendEvent['kind'])}>
            <option value="meetup">{label('Gặp mặt', 'Meetup')}</option>
            <option value="party">{label('Tiệc / sinh nhật', 'Party')}</option>
            <option value="trip">{label('Du lịch cùng', 'Trip')}</option>
            <option value="gift">{label('Quà / lời chúc', 'Gift')}</option>
            <option value="other">{label('Khác', 'Other')}</option>
          </select>
        </label>
        <label>
          <span>{label('Bạn bè', 'Friend')}</span>
          <input
            value={friendName}
            onChange={(e) => setFriendName(e.target.value)}
            placeholder={label('VD: Minh, Lan…', 'e.g. Minh, Lan…')}
            list="wb-friends-names"
          />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Sự kiện', 'Event')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label('VD: Ăn tối tái ngộ', 'e.g. Reunion dinner')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          {label('Thêm sự kiện', 'Add event')}
        </button>
      </div>
      <FriendNameDatalist />
      <ul className="wb-module-list">
        {items.length === 0 ? (
          <li className="teacher-empty">{label('Chưa có sự kiện.', 'No events yet.')}</li>
        ) : (
          items.map((it) => (
            <li key={it.id} className={`wb-module-row${it.done ? ' is-done' : ''}`}>
              <label className="wb-task-check">
                <input
                  type="checkbox"
                  checked={it.done}
                  onChange={() =>
                    persist(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))
                  }
                />
                <div>
                  <strong>
                    {it.date} · {kindLabel(it.kind)}
                    {it.friendName ? ` · ${it.friendName}` : ''}
                  </strong>
                  <span>{it.title}</span>
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

function AnniversariesSub({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbFriendAnniversary[]>(() => readFriendAnniversaries())
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [title, setTitle] = useState('')
  const [friendName, setFriendName] = useState('')
  const [kind, setKind] = useState<WbFriendAnniversary['kind']>('birthday')
  const [recurYearly, setRecurYearly] = useState(true)
  const [note, setNote] = useState('')

  const persist = (next: WbFriendAnniversary[]) => {
    setItems(next)
    writeFriendAnniversaries(next)
  }

  const kindLabel = (k: WbFriendAnniversary['kind']) => {
    switch (k) {
      case 'friendship':
        return label('Tình bạn', 'Friendship')
      case 'birthday':
        return label('Sinh nhật', 'Birthday')
      case 'met':
        return label('Ngày quen', 'Day we met')
      default:
        return label('Khác', 'Other')
    }
  }

  const add = () => {
    const t = title.trim()
    if (!t || !date) return
    persist(
      [
        {
          id: newId(),
          date,
          title: t,
          kind,
          recurYearly,
          ...(friendName.trim() ? { friendName: friendName.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        ...items,
      ].sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5))),
    )
    setTitle('')
    setFriendName('')
    setNote('')
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Kỷ niệm với bạn bè — sinh nhật, ngày quen, mốc tình bạn (có thể lặp hàng năm).',
          'Friend anniversaries — birthdays, day you met, friendship milestones (optional yearly).',
        )}
      </p>
      <div className="wb-module-form">
        <label>
          <span>{label('Ngày', 'Date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>{label('Loại', 'Kind')}</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as WbFriendAnniversary['kind'])}
          >
            <option value="birthday">{label('Sinh nhật', 'Birthday')}</option>
            <option value="met">{label('Ngày quen', 'Day we met')}</option>
            <option value="friendship">{label('Tình bạn', 'Friendship')}</option>
            <option value="other">{label('Khác', 'Other')}</option>
          </select>
        </label>
        <label>
          <span>{label('Bạn bè', 'Friend')}</span>
          <input
            value={friendName}
            onChange={(e) => setFriendName(e.target.value)}
            list="wb-friends-names"
          />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Tiêu đề', 'Title')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label('VD: Sinh nhật Minh', "e.g. Minh's birthday")}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
        </label>
        <label className="wb-family-check">
          <input
            type="checkbox"
            checked={recurYearly}
            onChange={(e) => setRecurYearly(e.target.checked)}
          />
          <span>{label('Lặp hàng năm', 'Repeat yearly')}</span>
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          {label('Thêm kỷ niệm', 'Add anniversary')}
        </button>
      </div>
      <FriendNameDatalist />
      <ItemList
        empty={label('Chưa có kỷ niệm.', 'No anniversaries yet.')}
        items={items.map((it) => ({
          id: it.id,
          title: `${it.title} · ${kindLabel(it.kind)}`,
          meta: [
            it.date,
            it.friendName,
            it.recurYearly ? label('Hàng năm', 'Yearly') : label('Một lần', 'Once'),
          ]
            .filter(Boolean)
            .join(' · '),
          note: it.note,
        }))}
        onDelete={(id) => persist(items.filter((x) => x.id !== id))}
        vi={vi}
      />
    </>
  )
}

function FriendNameDatalist(): ReactElement {
  const names = readFriends().map((f) => f.name)
  return (
    <datalist id="wb-friends-names">
      {names.map((n) => (
        <option key={n} value={n} />
      ))}
    </datalist>
  )
}

function ItemList({
  items,
  empty,
  onDelete,
  vi,
}: {
  items: { id: string; title: string; meta?: string; note?: string }[]
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
            <div>
              <strong>{it.title}</strong>
              {it.meta ? <span>{it.meta}</span> : null}
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
