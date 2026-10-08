import { describe, expect, it } from 'vitest'
import { answerMyAiLocally, type LocalAnswerSnapshot } from '../src/renderer/src/my-ai-local-answer'

const empty: LocalAnswerSnapshot = {
  tasks: [],
  calendar: [],
  notes: '',
  emails: [],
  recents: [],
}

describe('answerMyAiLocally', () => {
  const now = new Date('2026-10-08T08:00:00')

  it('answers today pulse from calendar + tasks (no LLM)', () => {
    const snap: LocalAnswerSnapshot = {
      ...empty,
      calendar: [
        { date: '2026-10-08', title: 'Họp khách A' },
        { date: '2026-10-09', title: 'Review' },
      ],
      tasks: [
        { title: 'Gửi báo giá', done: false },
        { title: 'Xong rồi', done: true },
      ],
      recents: [{ name: 'BaoGia.docx', ext: 'docx' }],
    }
    const r = answerMyAiLocally('Hôm nay có gì?', snap, true, now)
    expect(r.topic).toBe('pulse')
    expect(r.contextUsed).toBe(true)
    expect(r.text).toMatch(/Họp khách A/)
    expect(r.text).toMatch(/Gửi báo giá/)
    expect(r.text).not.toMatch(/Xong rồi/)
    expect(r.text).toMatch(/BaoGia/)
    expect(r.text).not.toMatch(/Token|Hub|bước/i)
  })

  it('lists open tasks', () => {
    const snap: LocalAnswerSnapshot = {
      ...empty,
      tasks: [{ title: 'Follow-up', done: false }],
    }
    const r = answerMyAiLocally('Việc đang mở là gì?', snap, true, now)
    expect(r.topic).toBe('tasks')
    expect(r.text).toMatch(/Follow-up/)
    expect(r.offerAi).toBe(false)
  })

  it('lists recent files', () => {
    const snap: LocalAnswerSnapshot = {
      ...empty,
      recents: [{ name: 'Q3.xlsx', ext: 'xlsx' }],
    }
    const r = answerMyAiLocally('File gần đây?', snap, true, now)
    expect(r.topic).toBe('recents')
    expect(r.text).toMatch(/Q3\.xlsx/)
  })

  it('soft-redirects off-topic without inventing facts', () => {
    const r = answerMyAiLocally('Ý nghĩa cuộc sống là gì?', empty, true, now)
    expect(r.topic).toBe('off_topic')
    expect(r.contextUsed).toBe(false)
    expect(r.offerAi).toBe(false)
    expect(r.text).toMatch(/UniWork|lịch|Word/i)
  })

  it('fallback offers AI for longer unclear questions', () => {
    const r = answerMyAiLocally('Giúp mình sắp xếp công việc tuần này theo ưu tiên', empty, true, now)
    expect(r.topic).toBe('fallback')
    expect(r.offerAi).toBe(true)
  })

  it('English today calendar', () => {
    const snap: LocalAnswerSnapshot = {
      ...empty,
      calendar: [{ date: '2026-10-08', title: 'Standup' }],
    }
    const r = answerMyAiLocally("What's on my calendar today?", snap, false, now)
    expect(r.topic).toBe('calendar')
    expect(r.text).toMatch(/Standup/)
  })
})
