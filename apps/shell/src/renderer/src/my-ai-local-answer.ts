/**
 * Local Q&A for My AI — answer from on-device Workbench / recents.
 * No Hub / Token. LLM only when the user later taps “Clarify with AI”.
 */
import type { PracticeId } from '@uniwork/practice-core'
import type { MyAiRecentHint } from './context-manager'
import { readCalendar, readEmails, readNotes, readTasks } from './workbench-pins'

export type LocalAnswerTopic =
  | 'calendar'
  | 'tasks'
  | 'recents'
  | 'notes'
  | 'email'
  | 'pulse'
  | 'off_topic'
  | 'fallback'

export interface LocalAnswer {
  text: string
  topic: LocalAnswerTopic
  /** Offer Hub AI clarify (Settings model / Token) */
  offerAi: boolean
  contextUsed: boolean
}

export interface LocalAnswerSnapshot {
  tasks: { title: string; done: boolean }[]
  calendar: { date: string; title: string }[]
  notes: string
  emails: { subject: string; folder: string; to?: string; from?: string }[]
  recents: { name: string; ext: string }[]
}

function todayIsoLocal(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function tomorrowIsoLocal(now = new Date()): string {
  const t = new Date(now)
  t.setDate(t.getDate() + 1)
  return todayIsoLocal(t)
}

function bullets(items: string[], emptyVi: string, emptyEn: string, vi: boolean): string {
  if (items.length === 0) return vi ? emptyVi : emptyEn
  return items.map((t) => `• ${t}`).join('\n')
}

function looksOffTopic(lower: string): boolean {
  return /(?:ý nghĩa cuộc sống|meaning of life|triết học|philosophy|kể chuyện cười|tell (?:me )?a joke|thời tiết|weather|bóng đá|crypto tip|chứng khoán hôm nay)/i.test(
    lower,
  )
}

function wantsCalendar(lower: string): boolean {
  return /(?:lịch|lich|calendar|schedule|cuộc họp|cuoc hop|meeting|sự kiện|su kien|hôm nay|hom nay|ngày mai|ngay mai|today|tomorrow)/i.test(
    lower,
  )
}

function wantsTasks(lower: string): boolean {
  // Listing open work — not “help me prioritize / plan my week” (that stays fallback + AI offer)
  if (/(?:sắp xếp|sap xep|ưu tiên|uu tien|priorit|kế hoạch tuần|ke hoach tuan)/i.test(lower)) {
    return false
  }
  return /(?:việc đang|viec dang|việc mở|viec mo|việc chưa|open tasks?|todo list|danh sách việc|danh sach viec|có việc gì|co viec gi)/i.test(
    lower,
  ) ||
    (/(?:công việc|cong viec|\btasks?\b|\btodos?\b)/i.test(lower) &&
      /(?:đang mở|dang mo|open|chưa xong|chua xong|còn lại|con lai|\?)/i.test(lower))
}

function wantsRecents(lower: string): boolean {
  return /(?:file gần đây|file gan day|tài liệu gần|tai lieu gan|recent files?|mới mở|moi mo)/i.test(
    lower,
  )
}

function wantsNotes(lower: string): boolean {
  return /(?:ghi chú|ghi chu|\bnotes?\b|sticky)/i.test(lower)
}

function wantsEmail(lower: string): boolean {
  return /(?:\bemail\b|hộp thư|hop thu|thư đến|thu den|mailbox)/i.test(lower)
}

function wantsPulse(lower: string): boolean {
  return /(?:hôm nay có gì|hom nay co gi|đang có gì|dang co gi|tình hình|tinh hinh|what's on|whats on|what do i have|overview|tổng quan|tong quan)/i.test(
    lower,
  )
}

function isQuestiony(lower: string): boolean {
  return (
    /\?$/.test(lower.trim()) ||
    /(?:có gì|co gi|gì vậy|gi vay|bao nhiêu|bao nhieu|liệt kê|liet ke|cho (?:tôi|toi) biết|cho biet|what|how many|show me|list|tell me)/i.test(
      lower,
    )
  )
}

/**
 * Pure local answer from a snapshot (unit-test friendly).
 */
export function answerMyAiLocally(
  userText: string,
  snap: LocalAnswerSnapshot,
  vi: boolean,
  now = new Date(),
): LocalAnswer {
  const raw = userText.trim()
  const lower = raw.toLowerCase()

  if (!raw) {
    return {
      text: vi
        ? 'Bạn cần gì nào? Mình xem giúp lịch, việc đang mở, file gần đây — hoặc soạn Word / thêm việc giúp bạn.'
        : 'What do you need? I can check today’s calendar, open tasks, recent files — or draft Word / add a task for you.',
      topic: 'fallback',
      offerAi: false,
      contextUsed: false,
    }
  }

  if (looksOffTopic(lower)) {
    return {
      text: vi
        ? 'Phần này mình chưa giỏi lắm — mình hỗ trợ tốt hơn với việc trên UniWork: lịch, việc, file, soạn Word… Bạn muốn thử hướng nào?'
        : 'That’s a bit outside what I’m best at — I’m stronger with UniWork work: calendar, tasks, files, drafting Word… What should we try?',
      topic: 'off_topic',
      offerAi: false,
      contextUsed: false,
    }
  }

  const openTasks = snap.tasks.filter((t) => !t.done).map((t) => t.title)
  const today = todayIsoLocal(now)
  const tomorrow = tomorrowIsoLocal(now)
  const calToday = snap.calendar.filter((c) => c.date === today).map((c) => c.title)
  const calTomorrow = snap.calendar.filter((c) => c.date === tomorrow).map((c) => c.title)
  const calAll = snap.calendar.slice(0, 8).map((c) => `${c.date} — ${c.title}`)
  const recentLines = snap.recents.slice(0, 6).map((e) => `${e.name} (.${e.ext})`)
  const notePreview = snap.notes.trim()
  const mailLines = snap.emails.slice(0, 5).map((m) => {
    const sub = m.subject?.trim() || (vi ? '(không tiêu đề)' : '(no subject)')
    return `[${m.folder}] ${sub}`
  })

  const calendarFocused = /(?:calendar|lịch|lich|cuộc họp|cuoc hop|meeting|sự kiện|su kien)/i.test(
    lower,
  )

  // Calendar-only questions before broad pulse (“what's on today?”)
  if (
    wantsCalendar(lower) &&
    calendarFocused &&
    (isQuestiony(lower) || /hôm nay|hom nay|ngày mai|ngay mai|today|tomorrow/i.test(lower))
  ) {
    const focusTomorrow = /ngày mai|ngay mai|tomorrow/i.test(lower)
    if (focusTomorrow) {
      return {
        text: [
          vi ? `Ngày mai (${tomorrow}):` : `Tomorrow (${tomorrow}):`,
          bullets(calTomorrow, '• Chưa có sự kiện.', '• No events.', vi),
        ].join('\n'),
        topic: 'calendar',
        offerAi: false,
        contextUsed: true,
      }
    }
    if (/hôm nay|hom nay|today/i.test(lower) || wantsPulse(lower)) {
      return {
        text: [
          vi ? `Lịch hôm nay (${today}):` : `Today’s calendar (${today}):`,
          bullets(calToday, '• Chưa có sự kiện.', '• No events.', vi),
        ].join('\n'),
        topic: 'calendar',
        offerAi: false,
        contextUsed: true,
      }
    }
    return {
      text: [
        vi ? 'Lịch gần đây:' : 'Upcoming calendar:',
        bullets(calAll, '• Lịch trống.', '• Calendar empty.', vi),
      ].join('\n'),
      topic: 'calendar',
      offerAi: false,
      contextUsed: true,
    }
  }

  if (wantsPulse(lower) || (isQuestiony(lower) && wantsCalendar(lower) && wantsTasks(lower))) {
    const parts: string[] = []
    parts.push(
      vi ? `Hôm nay (${today}):` : `Today (${today}):`,
      bullets(calToday, '• Chưa có sự kiện trên lịch.', '• No calendar events.', vi),
    )
    parts.push(
      '',
      vi ? 'Việc đang mở:' : 'Open tasks:',
      bullets(openTasks, '• Không có việc đang mở.', '• No open tasks.', vi),
    )
    if (recentLines.length > 0) {
      parts.push(
        '',
        vi ? 'File gần đây:' : 'Recent files:',
        ...recentLines.map((l) => `• ${l}`),
      )
    }
    return {
      text: parts.join('\n'),
      topic: 'pulse',
      offerAi: raw.length >= 8,
      contextUsed: true,
    }
  }

  if (wantsTasks(lower)) {
    return {
      text: [
        vi ? 'Việc đang mở:' : 'Open tasks:',
        bullets(openTasks, '• Không có việc đang mở.', '• No open tasks.', vi),
      ].join('\n'),
      topic: 'tasks',
      offerAi: false,
      contextUsed: true,
    }
  }

  if (wantsRecents(lower)) {
    return {
      text: [
        vi ? 'File gần đây:' : 'Recent files:',
        bullets(recentLines, '• Chưa có file gần đây.', '• No recent files.', vi),
      ].join('\n'),
      topic: 'recents',
      offerAi: false,
      contextUsed: true,
    }
  }

  if (wantsNotes(lower)) {
    const body = notePreview
      ? notePreview.length > 400
        ? `${notePreview.slice(0, 399)}…`
        : notePreview
      : vi
        ? 'Bảng ghi chú trống.'
        : 'Notes board empty.'
    return {
      text: vi ? `Ghi chú:\n${body}` : `Notes:\n${body}`,
      topic: 'notes',
      offerAi: notePreview.length > 80,
      contextUsed: true,
    }
  }

  if (wantsEmail(lower)) {
    return {
      text: [
        vi ? 'Email gần đây:' : 'Recent email:',
        bullets(mailLines, '• Hộp thư trống.', '• Mailbox empty.', vi),
      ].join('\n'),
      topic: 'email',
      offerAi: false,
      contextUsed: true,
    }
  }

  // Soft fallback: short redirect + tiny pulse (not a system hint dump)
  const pulseBits: string[] = []
  if (calToday.length > 0) {
    pulseBits.push(
      vi
        ? `Hôm nay: ${calToday.slice(0, 3).join('; ')}`
        : `Today: ${calToday.slice(0, 3).join('; ')}`,
    )
  }
  if (openTasks.length > 0) {
    pulseBits.push(
      vi
        ? `Việc mở: ${openTasks.slice(0, 3).join('; ')}`
        : `Open tasks: ${openTasks.slice(0, 3).join('; ')}`,
    )
  }
  const head = vi
    ? 'Mình chưa chắc ý bạn — mình xem giúp lịch, việc đang mở hay file gần đây; cũng có thể soạn Word hoặc thêm việc nếu bạn muốn.'
    : 'I’m not sure what you need yet — I can check calendar, open tasks, or recent files; or draft Word / add a task if you’d like.'
  const text =
    pulseBits.length > 0
      ? `${head}\n\n${pulseBits.map((b) => `• ${b}`).join('\n')}`
      : head

  return {
    text,
    topic: 'fallback',
    offerAi: isQuestiony(lower) || raw.length >= 12,
    contextUsed: pulseBits.length > 0,
  }
}

/** Build snapshot from Workbench + optional recents (renderer). */
export function buildLocalAnswerSnapshot(
  practiceId: PracticeId,
  recents?: readonly MyAiRecentHint[],
): LocalAnswerSnapshot {
  return {
    tasks: readTasks(practiceId).map((t) => ({ title: t.title, done: t.done })),
    calendar: readCalendar(practiceId).map((c) => ({ date: c.date, title: c.title })),
    notes: readNotes(practiceId) || '',
    emails: readEmails(practiceId).map((m) => ({
      subject: m.subject || '',
      folder: m.folder,
      to: m.to,
      from: m.from,
    })),
    recents: (recents ?? []).map((e) => ({ name: e.name, ext: e.ext })),
  }
}
