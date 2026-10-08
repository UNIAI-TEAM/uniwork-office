import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import {
  createEmailDraft,
  normalizeEmailMessage,
  normalizeTaskItem,
  readEmails,
  readPersonal,
  readTasks,
  writeEmails,
  writeTasks,
  type WbEmailFolder,
  type WbEmailMessage,
} from './workbench-pins'

type AiAssistId = 'polish' | 'shorter' | 'formal' | 'friendly' | 'followup' | 'vi' | 'en'

const FOLDERS: { id: WbEmailFolder; labelVi: string; labelEn: string }[] = [
  { id: 'inbox', labelVi: 'Hộp thư', labelEn: 'Inbox' },
  { id: 'drafts', labelVi: 'Nháp', labelEn: 'Drafts' },
  { id: 'sent', labelVi: 'Đã gửi', labelEn: 'Sent' },
  { id: 'archive', labelVi: 'Lưu trữ', labelEn: 'Archive' },
]

const AI_ACTIONS: { id: AiAssistId; labelVi: string; labelEn: string }[] = [
  { id: 'polish', labelVi: 'Chỉnh mượt', labelEn: 'Polish' },
  { id: 'shorter', labelVi: 'Rút gọn', labelEn: 'Shorter' },
  { id: 'formal', labelVi: 'Trang trọng', labelEn: 'Formal' },
  { id: 'friendly', labelVi: 'Thân thiện', labelEn: 'Friendly' },
  { id: 'followup', labelVi: 'Follow-up', labelEn: 'Follow-up' },
  { id: 'vi', labelVi: 'Tiếng Việt', labelEn: 'Vietnamese' },
  { id: 'en', labelVi: 'English', labelEn: 'English' },
]

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function aiSystemPrompt(action: AiAssistId, vi: boolean): string {
  const base = vi
    ? 'Bạn là trợ lý soạn email chuyên nghiệp. Chỉ trả về nội dung email đã chỉnh (có thể kèm subject dòng đầu nếu cần), không giải thích.'
    : 'You are a professional email writing assistant. Return only the revised email body (subject line optional), no commentary.'
  const map: Record<AiAssistId, string> = {
    polish: vi ? 'Chỉnh lại cho mạch lạc, lịch sự, rõ ý.' : 'Polish for clarity, courtesy, and flow.',
    shorter: vi ? 'Rút gọn còn khoảng 60% độ dài, giữ ý chính.' : 'Cut to ~60% length, keep the point.',
    formal: vi ? 'Viết giọng trang trọng, phù hợp công việc.' : 'Rewrite in a formal business tone.',
    friendly: vi ? 'Viết giọng thân thiện, ấm nhưng vẫn chuyên nghiệp.' : 'Rewrite in a warm, friendly professional tone.',
    followup: vi
      ? 'Viết email follow-up lịch sự nhắc việc / chờ phản hồi.'
      : 'Write a polite follow-up email requesting a response.',
    vi: 'Rewrite the email in natural Vietnamese.',
    en: 'Rewrite the email in clear professional English.',
  }
  return `${base}\nTask: ${map[action]}`
}

export function EmailPane({ practiceId, vi }: { practiceId: PracticeId; vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const profile = readPersonal()
  const [items, setItems] = useState<WbEmailMessage[]>(() => readEmails(practiceId))
  const [folder, setFolder] = useState<WbEmailFolder>('inbox')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setItems(readEmails(practiceId))
    setSelectedId(null)
    setComposing(false)
    setAiError(null)
    setNotice(null)
  }, [practiceId])

  const persist = (next: WbEmailMessage[]) => {
    const normalized = next.map((m) => normalizeEmailMessage(m))
    setItems(normalized)
    writeEmails(practiceId, normalized)
  }

  const visible = useMemo(
    () =>
      items
        .filter((m) => m.folder === folder)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [items, folder],
  )

  const selected = items.find((m) => m.id === selectedId) ?? null
  const editable = Boolean(selected && (selected.folder === 'drafts' || composing))

  const counts = useMemo(() => {
    const c: Record<WbEmailFolder, number> = { inbox: 0, drafts: 0, sent: 0, archive: 0 }
    for (const m of items) c[m.folder] += 1
    return c
  }, [items])

  const startCompose = (seed?: Partial<WbEmailMessage>) => {
    const draft = createEmailDraft(practiceId, {
      from: profile.email || 'me@local',
      to: seed?.to,
      subject: seed?.subject,
      body: seed?.body,
    })
    setItems(readEmails(practiceId))
    setFolder('drafts')
    setSelectedId(draft.id)
    setComposing(true)
    setNotice(null)
  }

  const updateSelected = (patch: Partial<WbEmailMessage>) => {
    if (!selected) return
    persist(
      items.map((m) =>
        m.id === selected.id
          ? normalizeEmailMessage({ ...m, ...patch, updatedAt: new Date().toISOString() })
          : m,
      ),
    )
  }

  const markRead = (id: string) => {
    persist(items.map((m) => (m.id === id ? { ...m, unread: false } : m)))
  }

  const moveTo = (id: string, nextFolder: WbEmailFolder) => {
    persist(
      items.map((m) =>
        m.id === id
          ? normalizeEmailMessage({
              ...m,
              folder: nextFolder,
              unread: false,
              updatedAt: new Date().toISOString(),
            })
          : m,
      ),
    )
    if (nextFolder !== folder) setSelectedId(null)
  }

  const removeMessage = (id: string) => {
    persist(items.filter((m) => m.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const sendLocal = () => {
    if (!selected) return
    if (!selected.to.trim() || !selected.subject.trim()) {
      setNotice(label('Cần người nhận và tiêu đề trước khi gửi.', 'Add recipient and subject before sending.'))
      return
    }
    persist(
      items.map((m) =>
        m.id === selected.id
          ? normalizeEmailMessage({
              ...m,
              folder: 'sent',
              unread: false,
              demo: false,
              updatedAt: new Date().toISOString(),
            })
          : m,
      ),
    )
    setFolder('sent')
    setComposing(false)
    setNotice(
      label(
        'Đã lưu vào Đã gửi (cục bộ) — chưa gửi qua máy chủ email thật.',
        'Saved to Sent (local) — not delivered through a real mail server yet.',
      ),
    )
  }

  const createTaskFromMail = () => {
    if (!selected) return
    const now = new Date().toISOString()
    const title = selected.subject.trim() || label('Việc từ email', 'Task from email')
    const note = [
      selected.from ? `From: ${selected.from}` : '',
      selected.to ? `To: ${selected.to}` : '',
      '',
      selected.body,
    ]
      .filter(Boolean)
      .join('\n')
    writeTasks(practiceId, [
      normalizeTaskItem({
        id: newId(),
        title,
        status: 'todo',
        priority: 'medium',
        done: false,
        description: note,
        createdAt: now,
        updatedAt: now,
      }),
      ...readTasks(practiceId),
    ])
    setNotice(label('Đã tạo việc trong tab Công việc.', 'Created a task in Tasks.'))
  }

  const runAi = async (action: AiAssistId) => {
    if (!selected) return
    setAiBusy(true)
    setAiError(null)
    try {
      const api = window.aiOffice
      if (!api?.aiChat || !api.getAiSettings) {
        throw new Error(label('AI chưa sẵn sàng trên máy này.', 'AI is not available on this device.'))
      }
      const settings = await api.getAiSettings()
      const user = [
        selected.subject ? `Subject: ${selected.subject}` : '',
        selected.to ? `To: ${selected.to}` : '',
        '',
        selected.body || label('(nội dung trống — hãy soạn giúp tôi một email ngắn)', '(empty body — draft a short email for me)'),
      ]
        .filter(Boolean)
        .join('\n')
      const res = await api.aiChat({
        settings,
        system: aiSystemPrompt(action, vi),
        user,
      })
      if (!res.ok || !res.content?.trim()) {
        throw new Error(res.error || label('AI không trả về nội dung.', 'AI returned no content.'))
      }
      let subject = selected.subject
      let body = res.content.trim()
      const subjMatch = /^(?:Subject|Tiêu đề)\s*:\s*(.+)\n+/i.exec(body)
      if (subjMatch) {
        subject = subjMatch[1].trim()
        body = body.slice(subjMatch[0].length).trim()
      }
      if (selected.folder !== 'drafts') {
        startCompose({
          to: selected.from || selected.to,
          subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
          body,
        })
      } else {
        updateSelected({ subject, body })
        setComposing(true)
      }
      setNotice(label('AI đã cập nhật nội dung thư.', 'AI updated the email draft.'))
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div className="wb-email">
      <header className="wb-email-hero">
        <div>
          <strong>{label('Email (MVP)', 'Email (MVP)')}</strong>
          <p>
            {label(
              'Soạn nháp, dùng AI chỉnh thư, quản lý cục bộ trên máy. Kết nối Gmail/Outlook sẽ có ở bước tiếp.',
              'Draft, AI-polish, and manage mail locally. Gmail/Outlook sync comes next.',
            )}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => startCompose()}>
          {label('Soạn thư', 'Compose')}
        </button>
      </header>

      <aside className="wb-email-connect" aria-label={label('Kết nối email', 'Connect email')}>
        <div>
          <strong>{label('Kết nối hộp thư', 'Connect mailbox')}</strong>
          <span>
            {label(
              'Gmail / Outlook OAuth — sắp có. Hiện tại dùng nháp + AI trên máy.',
              'Gmail / Outlook OAuth — coming soon. Drafts + on-device AI for now.',
            )}
          </span>
        </div>
        <button
          type="button"
          className="btn"
          disabled
          title={label(
            'OAuth Gmail/Outlook chưa có — hiện chỉ hộp thư local trên máy',
            'Gmail/Outlook OAuth not available — local mailbox only',
          )}
        >
          {label('Kết nối hộp thư (chưa hỗ trợ)', 'Connect mailbox (unsupported)')}
        </button>
      </aside>

      <div className="wb-email-shell">
        <nav className="wb-email-folders" aria-label={label('Thư mục', 'Folders')}>
          {FOLDERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`wb-email-folder${folder === f.id ? ' is-active' : ''}`}
              onClick={() => {
                setFolder(f.id)
                setSelectedId(null)
                setComposing(false)
              }}
            >
              <span>{vi ? f.labelVi : f.labelEn}</span>
              <em>{counts[f.id]}</em>
            </button>
          ))}
        </nav>

        <div className="wb-email-list" role="list">
          {visible.length === 0 ? (
            <div className="wb-email-empty">
              <p>
                {label('Thư mục trống.', 'This folder is empty.')}
              </p>
              {folder === 'drafts' || folder === 'inbox' ? (
                <button type="button" className="btn btn-primary" onClick={() => startCompose()}>
                  {label('Soạn thư mới', 'New draft')}
                </button>
              ) : null}
            </div>
          ) : (
            visible.map((m) => (
              <button
                key={m.id}
                type="button"
                role="listitem"
                className={`wb-email-row${selectedId === m.id ? ' is-selected' : ''}${m.unread ? ' is-unread' : ''}`}
                onClick={() => {
                  setSelectedId(m.id)
                  setComposing(m.folder === 'drafts')
                  if (m.unread) markRead(m.id)
                }}
              >
                <div className="wb-email-row-top">
                  <strong>{folder === 'sent' || folder === 'drafts' ? m.to || '—' : m.from || '—'}</strong>
                  <time>{m.updatedAt.slice(0, 10)}</time>
                </div>
                <span className="wb-email-row-subject">
                  {m.starred ? '★ ' : ''}
                  {m.subject || label('(Không tiêu đề)', '(No subject)')}
                </span>
                <span className="wb-email-row-preview">{m.body.replace(/\s+/g, ' ').slice(0, 90)}</span>
                {m.demo ? <i className="wb-email-demo">{label('Mẫu', 'Demo')}</i> : null}
              </button>
            ))
          )}
        </div>

        <section className="wb-email-detail" aria-label={label('Chi tiết thư', 'Message detail')}>
          {!selected ? (
            <div className="wb-email-empty">
              <p>{label('Chọn một thư hoặc soạn thư mới.', 'Select a message or compose a new one.')}</p>
            </div>
          ) : (
            <>
              <div className="wb-email-detail-head">
                {editable ? (
                  <input
                    className="wb-email-subject-input"
                    value={selected.subject}
                    onChange={(e) => updateSelected({ subject: e.target.value })}
                    placeholder={label('Tiêu đề', 'Subject')}
                  />
                ) : (
                  <h3>{selected.subject || label('(Không tiêu đề)', '(No subject)')}</h3>
                )}
                <div className="wb-email-meta-grid">
                  <label>
                    <span>From</span>
                    {editable ? (
                      <input
                        value={selected.from}
                        onChange={(e) => updateSelected({ from: e.target.value })}
                      />
                    ) : (
                      <strong>{selected.from || '—'}</strong>
                    )}
                  </label>
                  <label>
                    <span>To</span>
                    {editable ? (
                      <input
                        value={selected.to}
                        onChange={(e) => updateSelected({ to: e.target.value })}
                        placeholder="name@example.com"
                      />
                    ) : (
                      <strong>{selected.to || '—'}</strong>
                    )}
                  </label>
                  <label>
                    <span>Cc</span>
                    {editable ? (
                      <input
                        value={selected.cc ?? ''}
                        onChange={(e) => updateSelected({ cc: e.target.value })}
                      />
                    ) : (
                      <strong>{selected.cc || '—'}</strong>
                    )}
                  </label>
                </div>
              </div>

              {editable ? (
                <textarea
                  className="wb-email-body-input"
                  value={selected.body}
                  onChange={(e) => updateSelected({ body: e.target.value })}
                  placeholder={label('Nội dung thư…', 'Write your email…')}
                  rows={14}
                />
              ) : (
                <pre className="wb-email-body-view">{selected.body || '—'}</pre>
              )}

              <div className="wb-email-ai">
                <div className="wb-email-ai-head">
                  <strong>{label('AI hỗ trợ soạn', 'AI writing assist')}</strong>
                  <span>
                    {label(
                      'Dùng nhà cung cấp AI đã cấu hình trong Settings.',
                      'Uses the AI provider configured in Settings.',
                    )}
                  </span>
                </div>
                <div className="wb-email-ai-actions">
                  {AI_ACTIONS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="wb-email-ai-chip"
                      disabled={aiBusy}
                      onClick={() => void runAi(a.id)}
                    >
                      {vi ? a.labelVi : a.labelEn}
                    </button>
                  ))}
                </div>
                {aiBusy ? (
                  <p className="wb-email-ai-status">{label('Đang gọi AI…', 'Calling AI…')}</p>
                ) : null}
                {aiError ? <p className="wb-email-ai-error">{aiError}</p> : null}
              </div>

              <div className="wb-email-actions">
                {selected.folder === 'drafts' ? (
                  <button type="button" className="btn btn-primary" onClick={sendLocal}>
                    {label('Gửi (cục bộ)', 'Send (local)')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() =>
                      startCompose({
                        to: selected.from || selected.to,
                        subject: selected.subject.startsWith('Re:')
                          ? selected.subject
                          : `Re: ${selected.subject}`,
                        body: `\n\n---\n${selected.body}`,
                      })
                    }
                  >
                    {label('Trả lời (nháp)', 'Reply (draft)')}
                  </button>
                )}
                <button type="button" className="btn" onClick={createTaskFromMail}>
                  {label('Tạo việc', 'Create task')}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => updateSelected({ starred: !selected.starred })}
                >
                  {selected.starred ? label('Bỏ sao', 'Unstar') : label('Gắn sao', 'Star')}
                </button>
                {selected.folder !== 'archive' ? (
                  <button type="button" className="btn" onClick={() => moveTo(selected.id, 'archive')}>
                    {label('Lưu trữ', 'Archive')}
                  </button>
                ) : (
                  <button type="button" className="btn" onClick={() => moveTo(selected.id, 'inbox')}>
                    {label('Về Inbox', 'Move to Inbox')}
                  </button>
                )}
                <button type="button" className="btn" onClick={() => removeMessage(selected.id)}>
                  {label('Xoá', 'Delete')}
                </button>
              </div>
              {notice ? <p className="wb-email-notice">{notice}</p> : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
