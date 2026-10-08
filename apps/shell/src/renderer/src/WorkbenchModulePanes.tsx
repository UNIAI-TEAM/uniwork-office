import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { getWorkbenchModule, type PracticeId, type WorkbenchModuleId } from '@uniwork/practice-core'
import { CalendarPane } from './CalendarPane'
import { DeskPane } from './DeskPane'
import { FamilyPane } from './FamilyPane'
import { FinancePane } from './FinancePane'
import { FriendsPane } from './FriendsPane'
import { HealthPane } from './HealthPane'
import { EmailPane } from './EmailPane'
import { NotesPane } from './NotesPane'
import { PetsPane } from './PetsPane'
import { TasksPane } from './TasksPane'
import {
  WbDeleteBtn,
  WbDraftBtn,
  WbEditBtn,
  WbExpandBtn,
  WbFileBtn,
  WbMailBtn,
  WbRowActions,
} from './WbRowActions'
import {
  createEmailDraft,
  pinModule,
  readClients,
  readContracts,
  readEvents,
  defaultTravelChecklist,
  readForms,
  readGrowth,
  readMatters,
  readPersonal,
  readTravel,
  writeClients,
  writeContracts,
  writeEvents,
  writeForms,
  writeGrowth,
  writeMatters,
  writePersonal,
  writeTravel,
  type WbClientItem,
  type WbContractItem,
  type WbEventItem,
  type WbFormItem,
  type WbGrowthItem,
  type WbMatterItem,
  type WbPersonalProfile,
  type WbTravelTrip,
} from './workbench-pins'

interface Props {
  moduleId: WorkbenchModuleId
  practiceId: PracticeId
  vi: boolean
  contextTitle?: string | null
  /** Selected Tri thức pack — Soạn from modules joins Tài liệu on first save. */
  packId?: string | null
  onPackLinked?: () => void
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function WorkbenchModulePane({
  moduleId,
  practiceId,
  vi,
  contextTitle,
  packId = null,
  onPackLinked,
}: Props): ReactElement {
  const mod = getWorkbenchModule(moduleId)
  const label = (a: string, b: string) => (vi ? a : b)

  if (!mod) {
    return <p className="teacher-empty">{label('Module không tồn tại.', 'Unknown module.')}</p>
  }

  const hideChrome = moduleId === 'desk' || moduleId === 'notes' || moduleId === 'email'

  return (
    <section
      className={`teacher-panel teacher-detail${hideChrome ? ' is-immersive' : ''}`}
      aria-label={vi ? mod.labelVi : mod.labelEn}
    >
      {!hideChrome && (
        <>
          <h2>{vi ? mod.labelVi : mod.labelEn}</h2>
          <p className="teacher-hint">
            {vi ? mod.hintVi : mod.hintEn}
            {contextTitle ? ` · ${contextTitle}` : ''}
          </p>
        </>
      )}
      {moduleId === 'desk' && <DeskPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'calendar' && <CalendarPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'tasks' && <TasksPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'notes' && <NotesPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'email' && <EmailPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'assistant' && <AssistantPane vi={vi} packId={packId} />}
      {moduleId === 'forms' && (
        <FormsPane practiceId={practiceId} vi={vi} packId={packId} onPackLinked={onPackLinked} />
      )}
      {moduleId === 'personal' && <PersonalPane vi={vi} />}
      {moduleId === 'personal-finance' && <FinancePane vi={vi} />}
      {moduleId === 'events' && <EventsPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'health' && <HealthPane vi={vi} />}
      {moduleId === 'self-growth' && <GrowthPane vi={vi} />}
      {moduleId === 'family' && <FamilyPane vi={vi} />}
      {moduleId === 'friends' && <FriendsPane vi={vi} />}
      {moduleId === 'pets' && <PetsPane vi={vi} />}
      {moduleId === 'travel' && (
        <TravelPane vi={vi} packId={packId} onPackLinked={onPackLinked} />
      )}
      {moduleId === 'clients' && <ClientsPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'contracts' && (
        <ContractsPane practiceId={practiceId} vi={vi} packId={packId} onPackLinked={onPackLinked} />
      )}
      {moduleId === 'matters' && (
        <MattersPane practiceId={practiceId} vi={vi} packId={packId} onPackLinked={onPackLinked} />
      )}
    </section>
  )
}

function AssistantPane({ vi, packId }: { vi: boolean; packId?: string | null }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  return (
    <div className="wb-assistant">
      <p>
        {label(
          'Trợ lý trên Home là “Trợ lý của bạn” (My AI). Trong Docs / Slides / Sheets dùng panel uniAI của tab đang mở.',
          'Home assistant is My AI. Inside Docs / Slides / Sheets use that tab’s uniAI panel.',
        )}
      </p>
      <p className="teacher-hint">
        {label(
          'Cách dùng: mở My AI để điều phối Workbench / file; hoặc Skills → chạy kỹ năng (có xác nhận Token).',
          'How: open My AI to orchestrate Workbench / files; or Skills → run a skill (Token confirm).',
        )}
      </p>
      {packId ? (
        <p className="teacher-hint">
          {label(
            'Đang chọn gói — file lưu lần đầu sẽ vào Tài liệu của gói.',
            'A pack is selected — first save joins that pack’s Materials.',
          )}
        </p>
      ) : (
        <p className="teacher-hint">
          {label(
            'Chọn gói ở Tri thức trước nếu muốn lưu vào Tài liệu.',
            'Select a Knowledge pack first to save into Materials.',
          )}
        </p>
      )}
      <div className="teacher-chip-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => window.dispatchEvent(new Event('uniwork:open-my-ai'))}
        >
          {label('Mở Trợ lý của bạn', 'Open My AI')}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void window.aiOffice.newDoc?.(packId ? { projectId: packId } : undefined)}
        >
          {label('Mở Docs + uniAI', 'Open Docs + uniAI')}
        </button>
      </div>
    </div>
  )
}

function FormsPane({
  practiceId,
  vi,
  packId,
  onPackLinked,
}: {
  practiceId: PracticeId
  vi: boolean
  packId?: string | null
  onPackLinked?: () => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbFormItem[]>(() => readForms(practiceId))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [draftFile, setDraftFile] = useState<{
    filePath: string
    fileName: string
    fileExt: string
  } | null>(null)
  const [uploadNotice, setUploadNotice] = useState<string | null>(null)

  useEffect(() => {
    setItems(readForms(practiceId))
    setEditingId(null)
    setTitle('')
    setNote('')
    setDraftFile(null)
  }, [practiceId])

  const persist = (next: WbFormItem[]) => {
    setItems(next)
    writeForms(practiceId, next)
  }

  const clearForm = () => {
    setEditingId(null)
    setTitle('')
    setNote('')
    setDraftFile(null)
  }

  const startEdit = (it: WbFormItem) => {
    setEditingId(it.id)
    setTitle(it.title)
    setNote(it.note ?? '')
    setDraftFile(
      it.filePath
        ? {
            filePath: it.filePath,
            fileName: it.fileName || it.filePath.split(/[\\/]/).pop() || it.title,
            fileExt: it.fileExt || '',
          }
        : null,
    )
  }

  const pickTemplateFile = async () => {
    const result = (await window.aiOffice.pickAttachments?.()) ?? null
    if (!result) return
    const accepted = result.accepted[0]
    if (!accepted) {
      setUploadNotice(
        result.rejected[0] ||
          label('Không chọn được file hỗ trợ.', 'No supported file selected.'),
      )
      window.setTimeout(() => setUploadNotice(null), 4000)
      return
    }
    setDraftFile({
      filePath: accepted.path,
      fileName: accepted.name,
      fileExt: accepted.ext,
    })
    if (!title.trim()) {
      setTitle(accepted.name.replace(/\.[^.]+$/, ''))
    }
    setUploadNotice(null)
  }

  const save = () => {
    const t = title.trim() || draftFile?.fileName.replace(/\.[^.]+$/, '') || ''
    if (!t) return
    const existing = editingId ? items.find((x) => x.id === editingId) : undefined
    const row: WbFormItem = {
      id: editingId ?? newId(),
      title: t,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(existing?.linkedProjectId
        ? { linkedProjectId: existing.linkedProjectId }
        : packId
          ? { linkedProjectId: packId }
          : {}),
      ...(draftFile
        ? {
            filePath: draftFile.filePath,
            fileName: draftFile.fileName,
            ...(draftFile.fileExt ? { fileExt: draftFile.fileExt } : {}),
          }
        : {}),
      ...(existing?.templateId ? { templateId: existing.templateId } : {}),
    }
    if (editingId) {
      persist(items.map((x) => (x.id === editingId ? row : x)))
    } else {
      persist([row, ...items])
    }
    clearForm()
  }

  const openForm = async (item: WbFormItem) => {
    const targetPack = packId ?? item.linkedProjectId
    if (!targetPack) return
    const profile = readPersonal()
    const metaLines = [
      profile.fullName ? `<p><strong>Họ tên:</strong> ${escapeHtml(profile.fullName)}</p>` : '',
      profile.org ? `<p><strong>Đơn vị:</strong> ${escapeHtml(profile.org)}</p>` : '',
      profile.title ? `<p><strong>Chức danh:</strong> ${escapeHtml(profile.title)}</p>` : '',
    ]
      .filter(Boolean)
      .join('')
    const fileHint = item.fileName
      ? `<p><em>${vi ? 'Mẫu gốc' : 'Source template'}: ${escapeHtml(item.fileName)}</em></p>`
      : ''
    const html = `
      <h1>${escapeHtml(item.title)}</h1>
      ${item.note ? `<p><em>${escapeHtml(item.note)}</em></p>` : ''}
      ${fileHint}
      ${metaLines}
      <h2>${vi ? 'Nội dung' : 'Content'}</h2>
      <p></p>
    `.trim()
    await window.aiOffice.newDoc({
      projectId: targetPack,
      aiContent: { title: item.title, html },
    })
    if (!item.linkedProjectId || item.linkedProjectId !== targetPack) {
      persist(items.map((x) => (x.id === item.id ? { ...x, linkedProjectId: targetPack } : x)))
    }
    onPackLinked?.()
  }

  const openTemplateFile = async (item: WbFormItem) => {
    if (!item.filePath) return
    await window.aiOffice.openPath?.(item.filePath)
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Tải file mẫu (Word/PDF/Excel…) vào thư viện — My AI có thể điền theo mẫu thật. “Soạn” seed Docs vào gói đang chọn; “Mở file” mở mẫu gốc.',
          'Upload a template file (Word/PDF/Excel…) — My AI can fill from the real form. “Draft” seeds Docs into the selected pack; “Open file” opens the source template.',
        )}
      </p>
      {!packId ? (
        <p className="teacher-hint">
          {label('Chọn gói ở Tri thức trước khi Soạn.', 'Select a Knowledge pack before drafting.')}
        </p>
      ) : null}
      <div className="wb-module-form">
        <label className="teacher-form-wide">
          <span>{label('Tên biểu mẫu', 'Form title')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label('VD: Đơn xin nghỉ phép', 'e.g. Leave request')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú (tuỳ chọn)', 'Note (optional)')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="teacher-chip-row">
          <button type="button" className="btn btn-secondary" onClick={() => void pickTemplateFile()}>
            {draftFile
              ? label('Đổi file mẫu…', 'Replace template file…')
              : label('Tải file mẫu…', 'Upload template file…')}
          </button>
          {draftFile ? (
            <button type="button" className="btn btn-secondary" onClick={() => setDraftFile(null)}>
              {label('Bỏ file', 'Clear file')}
            </button>
          ) : null}
        </div>
        {draftFile ? (
          <p className="teacher-hint">
            {label('File mẫu:', 'Template file:')} {draftFile.fileName}
          </p>
        ) : null}
        {uploadNotice ? <p className="teacher-hint">{uploadNotice}</p> : null}
        <div className="teacher-chip-row">
          <button type="button" className="btn btn-primary" onClick={save}>
            {editingId ? label('Lưu biểu mẫu', 'Save form') : label('Thêm vào thư viện', 'Add to library')}
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
          <li className="teacher-empty">{label('Chưa có biểu mẫu.', 'No forms yet.')}</li>
        ) : (
          items.map((it) => {
            const canOpen = Boolean(packId ?? it.linkedProjectId)
            return (
              <li key={it.id} className="wb-module-row">
                <div className="wb-module-meta">
                  <strong>{it.title}</strong>
                  {it.note ? <span>{it.note}</span> : null}
                  {it.fileName ? (
                    <span className="teacher-hint">
                      {label('File:', 'File:')} {it.fileName}
                    </span>
                  ) : null}
                  {it.linkedProjectId ? (
                    <span className="teacher-hint">
                      {label('Đã gắn gói Tài liệu', 'Linked to Materials pack')}
                    </span>
                  ) : null}
                </div>
                <WbRowActions>
                  <WbEditBtn label={label('Sửa', 'Edit')} onClick={() => startEdit(it)} />
                  {it.filePath ? (
                    <WbFileBtn
                      label={label('Mở file', 'Open file')}
                      onClick={() => void openTemplateFile(it)}
                    />
                  ) : null}
                  <WbDraftBtn
                    label={label('Soạn', 'Draft')}
                    disabled={!canOpen}
                    title={
                      canOpen
                        ? label('Soạn', 'Draft')
                        : label('Chọn gói ở Tri thức trước', 'Select a Knowledge pack first')
                    }
                    onClick={() => void openForm(it)}
                  />
                  <WbDeleteBtn
                    label={label('Xóa', 'Delete')}
                    onClick={() => {
                      if (editingId === it.id) clearForm()
                      persist(items.filter((x) => x.id !== it.id))
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

function PersonalPane({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [profile, setProfile] = useState<WbPersonalProfile>(() => readPersonal())
  const [saved, setSaved] = useState(false)

  const setField = (key: keyof WbPersonalProfile, value: string) => {
    setProfile((p) => ({ ...p, [key]: value }))
    setSaved(false)
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Hồ sơ dùng chung mọi vai trò — Biểu mẫu có thể ghép tự động khi mở.',
          'Shared across all roles — Forms can merge this when opening.',
        )}
      </p>
      <div className="teacher-form">
        {(
          [
            ['fullName', 'Họ và tên', 'Full name'],
            ['title', 'Chức danh', 'Job title'],
            ['org', 'Đơn vị / trường', 'Organization'],
            ['phone', 'Điện thoại', 'Phone'],
            ['email', 'Email', 'Email'],
            ['address', 'Địa chỉ', 'Address'],
          ] as const
        ).map(([key, viLabel, enLabel]) => (
          <label key={key} className={key === 'address' ? 'teacher-form-wide' : undefined}>
            <span>{vi ? viLabel : enLabel}</span>
            <input value={profile[key]} onChange={(e) => setField(key, e.target.value)} />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          writePersonal(profile)
          setSaved(true)
        }}
      >
        {label('Lưu hồ sơ', 'Save profile')}
      </button>
      {saved ? <p className="teacher-hint">{label('Đã lưu.', 'Saved.')}</p> : null}
    </>
  )
}

function EventsPane({ practiceId, vi }: { practiceId: PracticeId; vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbEventItem[]>(() => readEvents(practiceId))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState('')
  const [title, setTitle] = useState('')
  const [place, setPlace] = useState('')

  useEffect(() => {
    setItems(readEvents(practiceId))
    setEditingId(null)
    setTitle('')
    setTime('')
    setPlace('')
  }, [practiceId])

  const persist = (next: WbEventItem[]) => {
    setItems(next)
    writeEvents(practiceId, next)
  }

  const clearForm = () => {
    setEditingId(null)
    setTitle('')
    setTime('')
    setPlace('')
    setDate(new Date().toISOString().slice(0, 10))
  }

  const startEdit = (it: WbEventItem) => {
    setEditingId(it.id)
    setDate(it.date)
    setTime(it.time ?? '')
    setTitle(it.title)
    setPlace(it.place ?? '')
  }

  const save = () => {
    const t = title.trim()
    if (!t || !date) return
    const row: WbEventItem = {
      id: editingId ?? newId(),
      date,
      title: t,
      ...(time.trim() ? { time: time.trim() } : {}),
      ...(place.trim() ? { place: place.trim() } : {}),
    }
    const sorted = (list: WbEventItem[]) =>
      [...list].sort((a, b) =>
        `${a.date}${a.time ?? ''}`.localeCompare(`${b.date}${b.time ?? ''}`),
      )
    if (editingId) {
      persist(sorted(items.map((x) => (x.id === editingId ? row : x))))
    } else {
      persist(sorted([row, ...items]))
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
          'Sự kiện theo vai trò (họp, hội thảo, deadline công khai) — khác Lịch mốc hạn nội bộ.',
          'Role events (meetings, talks) — distinct from internal Calendar deadlines.',
        )}
      </p>
      <div className="wb-module-form">
        <label>
          <span>{label('Ngày', 'Date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>{label('Giờ', 'Time')}</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Tên sự kiện', 'Event title')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label('VD: Họp phụ huynh khối 6', 'e.g. Grade 6 parent meeting')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Địa điểm (tuỳ chọn)', 'Place (optional)')}</span>
          <input value={place} onChange={(e) => setPlace(e.target.value)} />
        </label>
        <div className="teacher-chip-row">
          <button type="button" className="btn btn-primary" onClick={save}>
            {editingId ? label('Lưu sự kiện', 'Save event') : label('Thêm sự kiện', 'Add event')}
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
          <li className="teacher-empty">{label('Chưa có sự kiện.', 'No events yet.')}</li>
        ) : (
          items.map((it) => (
            <li key={it.id} className="wb-module-row">
              <div className="wb-module-meta">
                <strong>
                  {it.date}
                  {it.time ? ` · ${it.time}` : ''}
                </strong>
                <span>{it.title}</span>
                {it.place ? <span>{it.place}</span> : null}
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

function GrowthPane({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbGrowthItem[]>(() => readGrowth())
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')

  const persist = (next: WbGrowthItem[]) => {
    setItems(next)
    writeGrowth(next)
  }

  const add = () => {
    const t = title.trim()
    if (!t) return
    persist([
      {
        id: newId(),
        title: t,
        progress: 0,
        done: false,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      ...items,
    ])
    setTitle('')
    setNote('')
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Mục tiêu phát triển bản thân (học kỹ năng, đọc sách, chứng chỉ…) — theo dõi tiến độ trên máy.',
          'Self-growth goals (skills, reading, certs…) — track progress on device.',
        )}
      </p>
      <div className="wb-module-form">
        <label className="teacher-form-wide">
          <span>{label('Mục tiêu', 'Goal')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label('VD: Học tiếng Anh B1', 'e.g. Reach English B1')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú (tuỳ chọn)', 'Note (optional)')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          {label('Thêm mục tiêu', 'Add goal')}
        </button>
      </div>
      <ul className="wb-module-list">
        {items.length === 0 ? (
          <li className="teacher-empty">{label('Chưa có mục tiêu.', 'No goals yet.')}</li>
        ) : (
          items.map((it) => (
            <li key={it.id} className={`wb-module-row${it.done ? ' is-done' : ''}`}>
              <div className="wb-growth-main">
                <label className="wb-task-check">
                  <input
                    type="checkbox"
                    checked={it.done}
                    onChange={() =>
                      persist(
                        items.map((x) =>
                          x.id === it.id ? { ...x, done: !x.done, progress: !x.done ? 100 : x.progress } : x,
                        ),
                      )
                    }
                  />
                  <span>{it.title}</span>
                </label>
                {it.note ? <span className="teacher-hint">{it.note}</span> : null}
                <label className="wb-growth-progress">
                  <span>
                    {label('Tiến độ', 'Progress')}: {it.progress}%
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={it.progress}
                    onChange={(e) => {
                      const progress = Number(e.target.value)
                      persist(
                        items.map((x) =>
                          x.id === it.id ? { ...x, progress, done: progress >= 100 } : x,
                        ),
                      )
                    }}
                  />
                </label>
              </div>
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

function TravelPane({
  vi,
  packId,
  onPackLinked,
}: {
  vi: boolean
  packId?: string | null
  onPackLinked?: () => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbTravelTrip[]>(() => readTravel())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [destination, setDestination] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [status, setStatus] = useState<WbTravelTrip['status']>('planning')
  const [note, setNote] = useState('')
  const [checkDraft, setCheckDraft] = useState('')

  const persist = (next: WbTravelTrip[]) => {
    setItems(next)
    writeTravel(next)
  }

  const statusLabel = (s: WbTravelTrip['status']) => {
    switch (s) {
      case 'planning':
        return label('Đang chuẩn bị', 'Planning')
      case 'booked':
        return label('Đã đặt', 'Booked')
      case 'ongoing':
        return label('Đang đi', 'On trip')
      default:
        return label('Đã xong', 'Done')
    }
  }

  const add = () => {
    const t = title.trim()
    const dest = destination.trim()
    if (!t || !dest) return
    const trip: WbTravelTrip = {
      id: newId(),
      title: t,
      destination: dest,
      status,
      checklist: defaultTravelChecklist(vi),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(packId ? { linkedProjectId: packId } : {}),
    }
    persist([trip, ...items])
    setExpandedId(trip.id)
    setTitle('')
    setDestination('')
    setStartDate('')
    setEndDate('')
    setNote('')
    setStatus('planning')
  }

  const updateTrip = (id: string, patch: Partial<WbTravelTrip>) => {
    persist(items.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  const toggleCheck = (tripId: string, checkId: string) => {
    persist(
      items.map((t) =>
        t.id !== tripId
          ? t
          : {
              ...t,
              checklist: t.checklist.map((c) =>
                c.id === checkId ? { ...c, done: !c.done } : c,
              ),
            },
      ),
    )
  }

  const addCheck = (tripId: string) => {
    const text = checkDraft.trim()
    if (!text) return
    persist(
      items.map((t) =>
        t.id !== tripId
          ? t
          : {
              ...t,
              checklist: [...t.checklist, { id: newId(), text, done: false }],
            },
      ),
    )
    setCheckDraft('')
  }

  const openItineraryDoc = async (trip: WbTravelTrip) => {
    const targetPack = packId ?? trip.linkedProjectId
    const checks = trip.checklist
      .map((c) => `<li>${c.done ? '☑' : '☐'} ${escapeHtml(c.text)}</li>`)
      .join('')
    const html = `
      <h1>${escapeHtml(trip.title)}</h1>
      <p><em>${label('Hành trình du lịch', 'Travel itinerary')}</em></p>
      <p><strong>${label('Điểm đến', 'Destination')}:</strong> ${escapeHtml(trip.destination)}</p>
      <p><strong>${label('Thời gian', 'Dates')}:</strong> ${escapeHtml(trip.startDate ?? '…')} → ${escapeHtml(trip.endDate ?? '…')}</p>
      <p><strong>${label('Trạng thái', 'Status')}:</strong> ${escapeHtml(statusLabel(trip.status))}</p>
      ${trip.note ? `<p><em>${escapeHtml(trip.note)}</em></p>` : ''}
      <h2>${label('Checklist chuẩn bị', 'Prep checklist')}</h2>
      <ul>${checks || '<li></li>'}</ul>
      <h2>${label('Lịch trình / nhật ký', 'Itinerary / journal')}</h2>
      ${trip.itinerary ? `<p>${escapeHtml(trip.itinerary).replace(/\n/g, '<br/>')}</p>` : '<p></p>'}
      <h2>${label('Ngày 1', 'Day 1')}</h2>
      <ul><li></li><li></li></ul>
      <h2>${label('Ngày 2', 'Day 2')}</h2>
      <ul><li></li><li></li></ul>
    `.trim()
    await window.aiOffice.newDoc({
      ...(targetPack ? { projectId: targetPack } : {}),
      aiContent: { title: trip.title, html },
    })
    if (targetPack && trip.linkedProjectId !== targetPack) {
      updateTrip(trip.id, { linkedProjectId: targetPack })
    }
    onPackLinked?.()
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Quản lý chuyến đi offline: checklist chuẩn bị, lưu hành trình, soạn Docs (gắn gói Tài liệu nếu đã chọn).',
          'Manage trips offline: prep checklist, save itineraries, draft Docs (links to Materials pack when selected).',
        )}
      </p>
      <div className="wb-module-form">
        <label className="teacher-form-wide">
          <span>{label('Tên chuyến', 'Trip name')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label('VD: Đà Lạt 3N2Đ', 'e.g. Da Lat weekend')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
        </label>
        <label>
          <span>{label('Điểm đến', 'Destination')}</span>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={label('VD: Đà Lạt', 'e.g. Da Lat')}
          />
        </label>
        <label>
          <span>{label('Trạng thái', 'Status')}</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as WbTravelTrip['status'])}
          >
            <option value="planning">{label('Đang chuẩn bị', 'Planning')}</option>
            <option value="booked">{label('Đã đặt', 'Booked')}</option>
            <option value="ongoing">{label('Đang đi', 'On trip')}</option>
            <option value="done">{label('Đã xong', 'Done')}</option>
          </select>
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
          <span>{label('Ghi chú', 'Note')}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={label('Bạn bè đi cùng / ngân sách…', 'Companions / budget…')}
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          {label('Thêm chuyến đi', 'Add trip')}
        </button>
      </div>
      <ul className="wb-module-list">
        {items.length === 0 ? (
          <li className="teacher-empty">{label('Chưa có chuyến đi.', 'No trips yet.')}</li>
        ) : (
          items.map((it) => {
            const doneN = it.checklist.filter((c) => c.done).length
            const open = expandedId === it.id
            return (
              <li key={it.id} className="wb-module-row wb-travel-row">
                <div className="wb-module-meta">
                  <strong>
                    {it.title} · {statusLabel(it.status)}
                  </strong>
                  <span>
                    {[
                      it.destination,
                      it.startDate && it.endDate
                        ? `${it.startDate} → ${it.endDate}`
                        : it.startDate || it.endDate,
                      `${doneN}/${it.checklist.length} ${label('chuẩn bị', 'prep')}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {it.note ? <span>{it.note}</span> : null}
                </div>
                <WbRowActions>
                  <WbExpandBtn
                    label={open ? label('Thu gọn', 'Collapse') : label('Chi tiết', 'Details')}
                    open={open}
                    onClick={() => setExpandedId(open ? null : it.id)}
                  />
                  <WbDraftBtn
                    label={label('Soạn hành trình', 'Draft itinerary')}
                    onClick={() => void openItineraryDoc(it)}
                  />
                  <WbDeleteBtn
                    label={label('Xóa', 'Delete')}
                    onClick={() => {
                      persist(items.filter((x) => x.id !== it.id))
                      if (expandedId === it.id) setExpandedId(null)
                    }}
                  />
                </WbRowActions>
                {open ? (
                  <div className="wb-travel-detail">
                    <label>
                      <span>{label('Trạng thái', 'Status')}</span>
                      <select
                        value={it.status}
                        onChange={(e) =>
                          updateTrip(it.id, { status: e.target.value as WbTravelTrip['status'] })
                        }
                      >
                        <option value="planning">{label('Đang chuẩn bị', 'Planning')}</option>
                        <option value="booked">{label('Đã đặt', 'Booked')}</option>
                        <option value="ongoing">{label('Đang đi', 'On trip')}</option>
                        <option value="done">{label('Đã xong', 'Done')}</option>
                      </select>
                    </label>
                    <h4>{label('Checklist chuẩn bị', 'Prep checklist')}</h4>
                    <ul className="wb-travel-checks">
                      {it.checklist.map((c) => (
                        <li key={c.id} className={c.done ? 'is-done' : ''}>
                          <label className="wb-task-check">
                            <input
                              type="checkbox"
                              checked={c.done}
                              onChange={() => toggleCheck(it.id, c.id)}
                            />
                            <span>{c.text}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="wb-module-form wb-travel-check-add">
                      <label className="teacher-form-wide">
                        <span>{label('Thêm việc chuẩn bị', 'Add prep item')}</span>
                        <input
                          value={expandedId === it.id ? checkDraft : ''}
                          onChange={(e) => setCheckDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') addCheck(it.id)
                          }}
                          placeholder={label('VD: Đặt xe sân bay', 'e.g. Airport transfer')}
                        />
                      </label>
                      <button type="button" className="btn btn-secondary" onClick={() => addCheck(it.id)}>
                        {label('Thêm', 'Add')}
                      </button>
                    </div>
                    <label className="teacher-form-wide">
                      <span>{label('Hành trình / nhật ký', 'Itinerary / journal')}</span>
                      <textarea
                        rows={4}
                        value={it.itinerary ?? ''}
                        onChange={(e) => updateTrip(it.id, { itinerary: e.target.value })}
                        placeholder={label(
                          'Ngày 1: …\nNgày 2: …\nGhi chú địa điểm, đặt bàn…',
                          'Day 1: …\nDay 2: …\nPlaces, reservations…',
                        )}
                      />
                    </label>
                  </div>
                ) : null}
              </li>
            )
          })
        )}
      </ul>
    </>
  )
}

function ClientsPane({ practiceId, vi }: { practiceId: PracticeId; vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbClientItem[]>(() => readClients(practiceId))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    setItems(readClients(practiceId))
    setEditingId(null)
  }, [practiceId])

  const persist = (next: WbClientItem[]) => {
    setItems(next)
    writeClients(practiceId, next)
  }

  const clearForm = () => {
    setEditingId(null)
    setName('')
    setContact('')
    setPhone('')
    setEmail('')
    setNote('')
  }

  const startEdit = (it: WbClientItem) => {
    setEditingId(it.id)
    setName(it.name)
    setContact(it.contact ?? '')
    setPhone(it.phone ?? '')
    setEmail(it.email ?? '')
    setNote(it.note ?? '')
  }

  const save = () => {
    const n = name.trim()
    if (!n) return
    const row: WbClientItem = {
      id: editingId ?? newId(),
      name: n,
      ...(contact.trim() ? { contact: contact.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    if (editingId) {
      persist(items.map((x) => (x.id === editingId ? row : x)))
    } else {
      persist([row, ...items])
    }
    clearForm()
  }

  const composeEmail = (it: WbClientItem) => {
    pinModule(practiceId, 'email')
    window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
    createEmailDraft(practiceId, {
      to: it.email || undefined,
      subject: label(`Liên hệ ${it.name}`, `Contact ${it.name}`),
      body: label(
        `Xin chào${it.contact ? ` ${it.contact}` : ''},\n\n`,
        `Hello${it.contact ? ` ${it.contact}` : ''},\n\n`,
      ),
    })
    window.dispatchEvent(
      new CustomEvent('uniwork:wb-open-module', { detail: { moduleId: 'email' } }),
    )
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Danh bạ khách hàng / đối tác theo vai trò — lưu trên máy. “Soạn email” tạo nháp trong tab Email (chưa gửi SMTP).',
          'Client / partner directory for this role — on device. “Draft email” creates a local Email-tab draft (no SMTP yet).',
        )}
      </p>
      <div className="wb-module-form">
        <label>
          <span>{label('Tên KH / tổ chức', 'Client / org')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={label('VD: Công ty ABC', 'e.g. ABC Co.')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
        </label>
        <label>
          <span>{label('Người liên hệ', 'Contact person')}</span>
          <input value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>
        <label>
          <span>{label('Điện thoại', 'Phone')}</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          <span>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="teacher-chip-row">
          <button type="button" className="btn btn-primary" onClick={save}>
            {editingId
              ? label('Lưu khách hàng', 'Save client')
              : label('Thêm khách hàng', 'Add client')}
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
          <li className="teacher-empty">{label('Chưa có khách hàng.', 'No clients yet.')}</li>
        ) : (
          items.map((it) => (
            <li key={it.id} className="wb-module-row">
              <div className="wb-module-meta">
                <strong>{it.name}</strong>
                <span>
                  {[it.contact, it.phone, it.email].filter(Boolean).join(' · ')}
                </span>
                {it.note ? <span>{it.note}</span> : null}
              </div>
              <WbRowActions>
                <WbEditBtn label={label('Sửa', 'Edit')} onClick={() => startEdit(it)} />
                <WbMailBtn
                  label={label('Soạn email', 'Draft email')}
                  onClick={() => composeEmail(it)}
                />
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

function ContractsPane({
  practiceId,
  vi,
  packId,
  onPackLinked,
}: {
  practiceId: PracticeId
  vi: boolean
  packId?: string | null
  onPackLinked?: () => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbContractItem[]>(() => readContracts(practiceId))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [party, setParty] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [status, setStatus] = useState<WbContractItem['status']>('draft')
  const [note, setNote] = useState('')

  useEffect(() => {
    setItems(readContracts(practiceId))
    setEditingId(null)
  }, [practiceId])

  const persist = (next: WbContractItem[]) => {
    setItems(next)
    writeContracts(practiceId, next)
  }

  const statusLabel = (s: WbContractItem['status']) => {
    switch (s) {
      case 'draft':
        return label('Nháp', 'Draft')
      case 'active':
        return label('Hiệu lực', 'Active')
      case 'expired':
        return label('Hết hạn', 'Expired')
      default:
        return label('Khác', 'Other')
    }
  }

  const clearForm = () => {
    setEditingId(null)
    setTitle('')
    setParty('')
    setStartDate('')
    setEndDate('')
    setNote('')
    setStatus('draft')
  }

  const startEdit = (it: WbContractItem) => {
    setEditingId(it.id)
    setTitle(it.title)
    setParty(it.party ?? '')
    setStartDate(it.startDate ?? '')
    setEndDate(it.endDate ?? '')
    setStatus(it.status)
    setNote(it.note ?? '')
  }

  const save = () => {
    const t = title.trim()
    if (!t) return
    const existing = editingId ? items.find((x) => x.id === editingId) : undefined
    const row: WbContractItem = {
      id: editingId ?? newId(),
      title: t,
      status,
      ...(party.trim() ? { party: party.trim() } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(existing?.linkedProjectId
        ? { linkedProjectId: existing.linkedProjectId }
        : packId
          ? { linkedProjectId: packId }
          : {}),
    }
    if (editingId) {
      persist(items.map((x) => (x.id === editingId ? row : x)))
    } else {
      persist([row, ...items])
    }
    clearForm()
  }

  const openDraft = async (item: WbContractItem) => {
    const targetPack = packId ?? item.linkedProjectId
    if (!targetPack) return
    const html = `
      <h1>${escapeHtml(item.title)}</h1>
      <p><strong>${vi ? 'Bên liên quan' : 'Party'}:</strong> ${escapeHtml(item.party ?? '…')}</p>
      <p><strong>${vi ? 'Hiệu lực' : 'Term'}:</strong> ${escapeHtml(item.startDate ?? '…')} → ${escapeHtml(item.endDate ?? '…')}</p>
      <p><strong>${vi ? 'Trạng thái' : 'Status'}:</strong> ${escapeHtml(statusLabel(item.status))}</p>
      ${item.note ? `<p><em>${escapeHtml(item.note)}</em></p>` : ''}
      <h2>${vi ? 'Điều khoản chính' : 'Key terms'}</h2>
      <ol><li></li><li></li><li></li></ol>
    `.trim()
    await window.aiOffice.newDoc({
      projectId: targetPack,
      aiContent: { title: item.title, html },
    })
    if (!item.linkedProjectId || item.linkedProjectId !== targetPack) {
      persist(items.map((x) => (x.id === item.id ? { ...x, linkedProjectId: targetPack } : x)))
    }
    onPackLinked?.()
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Theo dõi hợp đồng theo vai trò. Soạn Docs vào gói đang chọn — lưu file để thấy ở Tài liệu.',
          'Track contracts for this role. Draft Docs into the selected pack — save to appear under Materials.',
        )}
      </p>
      {!packId ? (
        <p className="teacher-hint">
          {label('Chọn gói ở Tri thức trước khi Soạn.', 'Select a Knowledge pack before drafting.')}
        </p>
      ) : null}
      <div className="wb-module-form">
        <label className="teacher-form-wide">
          <span>{label('Tên hợp đồng', 'Contract title')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label('VD: HĐ thuê văn phòng', 'e.g. Office lease')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
        </label>
        <label>
          <span>{label('Bên / KH', 'Party / client')}</span>
          <input value={party} onChange={(e) => setParty(e.target.value)} />
        </label>
        <label>
          <span>{label('Trạng thái', 'Status')}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as WbContractItem['status'])}>
            <option value="draft">{label('Nháp', 'Draft')}</option>
            <option value="active">{label('Hiệu lực', 'Active')}</option>
            <option value="expired">{label('Hết hạn', 'Expired')}</option>
            <option value="other">{label('Khác', 'Other')}</option>
          </select>
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
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="teacher-chip-row">
          <button type="button" className="btn btn-primary" onClick={save}>
            {editingId ? label('Lưu hợp đồng', 'Save contract') : label('Thêm hợp đồng', 'Add contract')}
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
          <li className="teacher-empty">{label('Chưa có hợp đồng.', 'No contracts yet.')}</li>
        ) : (
          items.map((it) => {
            const canOpen = Boolean(packId ?? it.linkedProjectId)
            return (
              <li key={it.id} className="wb-module-row">
                <div className="wb-module-meta">
                  <strong>
                    {it.title} · {statusLabel(it.status)}
                  </strong>
                  <span>
                    {[it.party, it.startDate && it.endDate ? `${it.startDate} → ${it.endDate}` : it.endDate]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {it.note ? <span>{it.note}</span> : null}
                  {it.linkedProjectId ? (
                    <span className="teacher-hint">
                      {label('Đã gắn gói Tài liệu', 'Linked to Materials pack')}
                    </span>
                  ) : null}
                </div>
                <WbRowActions>
                  <WbEditBtn label={label('Sửa', 'Edit')} onClick={() => startEdit(it)} />
                  <WbDraftBtn
                    label={label('Soạn', 'Draft')}
                    disabled={!canOpen}
                    title={
                      canOpen
                        ? label('Soạn', 'Draft')
                        : label('Chọn gói ở Tri thức trước', 'Select a Knowledge pack first')
                    }
                    onClick={() => void openDraft(it)}
                  />
                  <WbDeleteBtn
                    label={label('Xóa', 'Delete')}
                    onClick={() => {
                      if (editingId === it.id) clearForm()
                      persist(items.filter((x) => x.id !== it.id))
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

function MattersPane({
  practiceId,
  vi,
  packId,
  onPackLinked,
}: {
  practiceId: PracticeId
  vi: boolean
  packId?: string | null
  onPackLinked?: () => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [items, setItems] = useState<WbMatterItem[]>(() => readMatters(practiceId))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [client, setClient] = useState('')
  const [matterType, setMatterType] = useState(vi ? 'Hợp đồng' : 'Contract')
  const [status, setStatus] = useState<WbMatterItem['status']>('open')
  const [nextDate, setNextDate] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    setItems(readMatters(practiceId))
    setEditingId(null)
  }, [practiceId])

  const persist = (next: WbMatterItem[]) => {
    setItems(next)
    writeMatters(practiceId, next)
  }

  const statusLabel = (s: WbMatterItem['status']) => {
    switch (s) {
      case 'open':
        return label('Đang xử lý', 'Open')
      case 'pending':
        return label('Chờ', 'Pending')
      default:
        return label('Đã đóng', 'Closed')
    }
  }

  const clearForm = () => {
    setEditingId(null)
    setTitle('')
    setClient('')
    setMatterType(vi ? 'Hợp đồng' : 'Contract')
    setNextDate('')
    setNote('')
    setStatus('open')
  }

  const startEdit = (it: WbMatterItem) => {
    setEditingId(it.id)
    setTitle(it.title)
    setClient(it.client ?? '')
    setMatterType(it.matterType ?? (vi ? 'Hợp đồng' : 'Contract'))
    setStatus(it.status)
    setNextDate(it.nextDate ?? '')
    setNote(it.note ?? '')
  }

  const save = () => {
    const t = title.trim()
    if (!t) return
    const existing = editingId ? items.find((x) => x.id === editingId) : undefined
    const row: WbMatterItem = {
      id: editingId ?? newId(),
      title: t,
      status,
      ...(client.trim() ? { client: client.trim() } : {}),
      ...(matterType.trim() ? { matterType: matterType.trim() } : {}),
      ...(nextDate ? { nextDate } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(existing?.linkedProjectId
        ? { linkedProjectId: existing.linkedProjectId }
        : packId
          ? { linkedProjectId: packId }
          : {}),
    }
    if (editingId) {
      persist(items.map((x) => (x.id === editingId ? row : x)))
    } else {
      persist([row, ...items])
    }
    clearForm()
  }

  const openBrief = async (item: WbMatterItem) => {
    const targetPack = packId ?? item.linkedProjectId
    if (!targetPack) return
    const html = `
      <h1>${escapeHtml(item.title)}</h1>
      <p><em>${vi ? 'Vụ việc pháp lý' : 'Legal matter'}</em></p>
      <p><strong>${vi ? 'Khách hàng' : 'Client'}:</strong> ${escapeHtml(item.client ?? '…')}</p>
      <p><strong>${vi ? 'Loại việc' : 'Type'}:</strong> ${escapeHtml(item.matterType ?? '…')}</p>
      <p><strong>${vi ? 'Trạng thái' : 'Status'}:</strong> ${escapeHtml(statusLabel(item.status))}</p>
      <p><strong>${vi ? 'Mốc tiếp theo' : 'Next date'}:</strong> ${escapeHtml(item.nextDate ?? '…')}</p>
      ${item.note ? `<p><em>${escapeHtml(item.note)}</em></p>` : ''}
      <h2>${vi ? 'Sự kiện / yêu cầu' : 'Facts / asks'}</h2>
      <ul><li></li><li></li></ul>
      <h2>${vi ? 'Điểm pháp lý' : 'Legal points'}</h2>
      <ul><li></li><li></li></ul>
      <h2>${vi ? 'Việc cần làm' : 'Next actions'}</h2>
      <ol><li></li><li></li></ol>
    `.trim()
    await window.aiOffice.newDoc({
      projectId: targetPack,
      aiContent: { title: item.title, html },
    })
    if (!item.linkedProjectId || item.linkedProjectId !== targetPack) {
      persist(items.map((x) => (x.id === item.id ? { ...x, linkedProjectId: targetPack } : x)))
    }
    onPackLinked?.()
  }

  return (
    <>
      <p className="teacher-hint">
        {label(
          'Dành cho Luật sư / Pháp lý: theo dõi vụ việc. Tóm tắt Docs vào gói đang chọn — lưu file để thấy ở Tài liệu.',
          'For legal counsel: track matters. Brief Docs into the selected pack — save to appear under Materials.',
        )}
      </p>
      {!packId ? (
        <p className="teacher-hint">
          {label('Chọn gói ở Tri thức trước khi Soạn.', 'Select a Knowledge pack before drafting.')}
        </p>
      ) : null}
      <div className="wb-module-form">
        <label className="teacher-form-wide">
          <span>{label('Tên vụ / hồ sơ', 'Matter title')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label('VD: Tranh chấp HĐ mua bán', 'e.g. Sales contract dispute')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
        </label>
        <label>
          <span>{label('Khách hàng', 'Client')}</span>
          <input value={client} onChange={(e) => setClient(e.target.value)} />
        </label>
        <label>
          <span>{label('Loại việc', 'Type')}</span>
          <select value={matterType} onChange={(e) => setMatterType(e.target.value)}>
            {(vi
              ? ['Hợp đồng', 'Tranh chấp', 'Tư vấn', 'Tuân thủ', 'SHTT', 'Khác']
              : ['Contract', 'Dispute', 'Advisory', 'Compliance', 'IP', 'Other']
            ).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{label('Trạng thái', 'Status')}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as WbMatterItem['status'])}>
            <option value="open">{label('Đang xử lý', 'Open')}</option>
            <option value="pending">{label('Chờ', 'Pending')}</option>
            <option value="closed">{label('Đã đóng', 'Closed')}</option>
          </select>
        </label>
        <label>
          <span>{label('Mốc tiếp theo', 'Next date')}</span>
          <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
        </label>
        <label className="teacher-form-wide">
          <span>{label('Ghi chú', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="teacher-chip-row">
          <button type="button" className="btn btn-primary" onClick={save}>
            {editingId ? label('Lưu vụ việc', 'Save matter') : label('Thêm vụ việc', 'Add matter')}
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
          <li className="teacher-empty">{label('Chưa có vụ việc.', 'No matters yet.')}</li>
        ) : (
          items.map((it) => {
            const canOpen = Boolean(packId ?? it.linkedProjectId)
            return (
              <li key={it.id} className="wb-module-row">
                <div className="wb-module-meta">
                  <strong>
                    {it.title} · {statusLabel(it.status)}
                  </strong>
                  <span>
                    {[it.client, it.matterType, it.nextDate ? `${label('Mốc', 'Next')}: ${it.nextDate}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {it.note ? <span>{it.note}</span> : null}
                  {it.linkedProjectId ? (
                    <span className="teacher-hint">
                      {label('Đã gắn gói Tài liệu', 'Linked to Materials pack')}
                    </span>
                  ) : null}
                </div>
                <WbRowActions>
                  <WbEditBtn label={label('Sửa', 'Edit')} onClick={() => startEdit(it)} />
                  <WbDraftBtn
                    label={label('Tóm tắt', 'Brief')}
                    disabled={!canOpen}
                    title={
                      canOpen
                        ? label('Tóm tắt', 'Brief')
                        : label('Chọn gói ở Tri thức trước', 'Select a Knowledge pack first')
                    }
                    onClick={() => void openBrief(it)}
                  />
                  <WbDeleteBtn
                    label={label('Xóa', 'Delete')}
                    onClick={() => {
                      if (editingId === it.id) clearForm()
                      persist(items.filter((x) => x.id !== it.id))
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
