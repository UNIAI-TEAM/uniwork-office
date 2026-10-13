import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { getWorkbenchModule, type PracticeId, type WorkbenchModuleId } from '@uniwork/practice-core'
import type { UniworkWorkError } from '../../shared/uniwork-work-api'
import { CalendarPane } from './CalendarPane'
import { DeskPane } from './DeskPane'
import { NotesPane } from './NotesPane'
import { TasksPane } from './TasksPane'
import { WbDeleteBtn, WbDraftBtn, WbEditBtn, WbFileBtn, WbRowActions } from './WbRowActions'
import {
  readForms,
  readPersonal,
  writeForms,
  writePersonal,
  type WbFormItem,
  type WbPersonalProfile,
} from './workbench-pins'

interface Props {
  moduleId: WorkbenchModuleId
  practiceId: PracticeId
  vi: boolean
  contextTitle?: string | null
  /** Selected Tri thức pack — Soạn from modules joins Tài liệu on first save. */
  packId?: string | null
  onPackLinked?: () => void
  /** why the workspace list failed (the last good list stays); server tabs show it instead of "no workspace" */
  workspaceError: UniworkWorkError | null
  /** the top bar's Refresh: re-lists workspaces and reloads every server tab */
  onReload: () => void
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
    return <p className="wb-empty">{label('Module không tồn tại.', 'Unknown module.')}</p>
  }

  const hideChrome = moduleId === 'desk' || moduleId === 'notes'

  return (
    <section
      className={`wb-panel wb-detail${hideChrome ? ' is-immersive' : ''}`}
      aria-label={vi ? mod.labelVi : mod.labelEn}
    >
      {!hideChrome && (
        <>
          <h2>{vi ? mod.labelVi : mod.labelEn}</h2>
          <p className="wb-hint">
            {vi ? mod.hintVi : mod.hintEn}
            {contextTitle ? ` · ${contextTitle}` : ''}
          </p>
        </>
      )}
      {moduleId === 'desk' && <DeskPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'calendar' && <CalendarPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'tasks' && <TasksPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'notes' && <NotesPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'forms' && (
        <FormsPane practiceId={practiceId} vi={vi} packId={packId} onPackLinked={onPackLinked} />
      )}
      {moduleId === 'personal' && <PersonalPane vi={vi} />}
    </section>
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
        result.rejected[0] || label('Không chọn được file hỗ trợ.', 'No supported file selected.'),
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
      <p className="wb-hint">
        {label(
          'Tải file mẫu (Word/PDF/Excel…) vào thư viện — My AI có thể điền theo mẫu thật. “Soạn” seed Docs vào gói đang chọn; “Mở file” mở mẫu gốc.',
          'Upload a template file (Word/PDF/Excel…) — My AI can fill from the real form. “Draft” seeds Docs into the selected pack; “Open file” opens the source template.',
        )}
      </p>
      {!packId ? (
        <p className="wb-hint">
          {label('Chọn gói ở Tri thức trước khi Soạn.', 'Select a Knowledge pack before drafting.')}
        </p>
      ) : null}
      <div className="wb-module-form">
        <label className="wb-form-wide">
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
        <label className="wb-form-wide">
          <span>{label('Ghi chú (tuỳ chọn)', 'Note (optional)')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="wb-chip-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void pickTemplateFile()}
          >
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
          <p className="wb-hint">
            {label('File mẫu:', 'Template file:')} {draftFile.fileName}
          </p>
        ) : null}
        {uploadNotice ? <p className="wb-hint">{uploadNotice}</p> : null}
        <div className="wb-chip-row">
          <button type="button" className="btn btn-primary" onClick={save}>
            {editingId
              ? label('Lưu biểu mẫu', 'Save form')
              : label('Thêm vào thư viện', 'Add to library')}
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
          <li className="wb-empty">{label('Chưa có biểu mẫu.', 'No forms yet.')}</li>
        ) : (
          items.map((it) => {
            const canOpen = Boolean(packId ?? it.linkedProjectId)
            return (
              <li key={it.id} className="wb-module-row">
                <div className="wb-module-meta">
                  <strong>{it.title}</strong>
                  {it.note ? <span>{it.note}</span> : null}
                  {it.fileName ? (
                    <span className="wb-hint">
                      {label('File:', 'File:')} {it.fileName}
                    </span>
                  ) : null}
                  {it.linkedProjectId ? (
                    <span className="wb-hint">
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
      <p className="wb-hint">
        {label(
          'Hồ sơ dùng chung mọi vai trò — Biểu mẫu có thể ghép tự động khi mở.',
          'Shared across all roles — Forms can merge this when opening.',
        )}
      </p>
      <div className="wb-form">
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
          <label key={key} className={key === 'address' ? 'wb-form-wide' : undefined}>
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
      {saved ? <p className="wb-hint">{label('Đã lưu.', 'Saved.')}</p> : null}
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
