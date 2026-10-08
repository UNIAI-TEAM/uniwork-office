/**
 * Local Context Manager — packages on-device snapshots for Agent Intents.
 * Hub Token / PWA only receive this pack (budget-capped), never raw vault dumps.
 */
import {
  actionDef,
  labelForTarget,
  tabIdForTarget,
  type AgentIntent,
  type PracticeId,
  type WorkbenchModuleId,
} from '@uniwork/practice-core'
import {
  healthDeskCounts,
  readCalendar,
  readEvents,
  readFinance,
  readEmails,
  readNotes,
  readTasks,
} from './workbench-pins'

const MAX_PACK_CHARS = 6_000
const MAX_LIST = 8

export interface ContextChunk {
  id: string
  source: string
  text: string
}

export interface ContextPack {
  intentId: string
  tabId: string
  targetLabel: string
  actionLabel: string
  summary: string
  chunks: ContextChunk[]
  /** UTF-16 length proxy for UI / egress budget */
  charCount: number
  builtAt: string
}

function clip(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function packChunks(chunks: ContextChunk[]): ContextChunk[] {
  const out: ContextChunk[] = []
  let used = 0
  for (const c of chunks) {
    const room = MAX_PACK_CHARS - used
    if (room < 40) break
    const text = clip(c.text, room)
    out.push({ ...c, text })
    used += text.length
  }
  return out
}

function moduleContext(practiceId: PracticeId, moduleId: WorkbenchModuleId): ContextChunk[] {
  const chunks: ContextChunk[] = []
  if (moduleId === 'tasks') {
    const open = readTasks(practiceId).filter((t) => !t.done).slice(0, MAX_LIST)
    chunks.push({
      id: 'tasks-open',
      source: 'local:tasks',
      text: open.length
        ? `Open tasks (${open.length}): ${open.map((t) => t.title).join('; ')}`
        : 'No open tasks.',
    })
  } else if (moduleId === 'calendar') {
    const items = readCalendar(practiceId).slice(0, MAX_LIST)
    chunks.push({
      id: 'calendar',
      source: 'local:calendar',
      text: items.length
        ? `Calendar: ${items.map((i) => `${i.date} ${i.title}`).join('; ')}`
        : 'Calendar empty.',
    })
  } else if (moduleId === 'notes') {
    const text = readNotes(practiceId)
    chunks.push({
      id: 'notes',
      source: 'local:notes',
      text: clip(text ? `Sticky notes:\n${text}` : 'Notes board empty.', 1_500),
    })
  } else if (moduleId === 'email') {
    const mails = readEmails(practiceId).slice(0, MAX_LIST)
    chunks.push({
      id: 'email',
      source: 'local:email',
      text: mails.length
        ? `Email (${mails.length}): ${mails
            .map((m) => `[${m.folder}] ${m.subject || '(no subject)'} → ${m.to || m.from}`)
            .join('; ')}`
        : 'Email mailbox empty.',
    })
  } else if (moduleId === 'events') {
    const items = readEvents(practiceId).slice(0, MAX_LIST)
    chunks.push({
      id: 'events',
      source: 'local:events',
      text: items.length
        ? `Events: ${items.map((i) => `${i.date ?? ''} ${i.title}`).join('; ')}`
        : 'No events.',
    })
  } else if (moduleId === 'personal-finance') {
    const items = readFinance().slice(-MAX_LIST)
    const sum = items.reduce(
      (a, x) => a + (x.kind === 'income' ? x.amount : -x.amount),
      0,
    )
    chunks.push({
      id: 'finance',
      source: 'local:finance',
      text: `Recent finance (${items.length} rows), net≈${Math.round(sum)}: ${items
        .map((i) => `${i.kind} ${i.amount} ${i.label}`)
        .join('; ')}`,
    })
  } else if (moduleId === 'health') {
    const c = healthDeskCounts()
    chunks.push({
      id: 'health',
      source: 'local:health',
      text: `Health desk counts: exercise=${c.exercise} sleep=${c.sleep} checkup=${c.checkup} other=${c.other}`,
    })
  } else if (moduleId === 'desk') {
    const tasks = readTasks(practiceId).filter((t) => !t.done).length
    const events = readEvents(practiceId).length
    chunks.push({
      id: 'desk',
      source: 'local:desk',
      text: `My Space pulse: openTasks=${tasks}, events=${events}`,
    })
  } else {
    chunks.push({
      id: 'tab',
      source: `local:${moduleId}`,
      text: `Active tab scope: ${moduleId}. Use on-device tools for details.`,
    })
  }
  return chunks
}

export interface MyAiContextPack {
  practiceId: PracticeId
  chunks: ContextChunk[]
  charCount: number
  builtAt: string
  /** Single string for aiChat system / user grounding */
  plainText: string
}

export interface MyAiRecentHint {
  name: string
  ext: string
  mtimeMs: number
}

/**
 * Desk-wide snapshot for My AI chat turns (no AgentIntent required).
 * Local-only; budget-capped before any Hub call.
 */
export function buildMyAiContextPack(
  practiceId: PracticeId,
  opts?: { recents?: readonly MyAiRecentHint[]; vi?: boolean },
): MyAiContextPack {
  const vi = opts?.vi !== false
  const chunks: ContextChunk[] = []

  const openTasks = readTasks(practiceId).filter((t) => !t.done).slice(0, MAX_LIST)
  chunks.push({
    id: 'tasks-open',
    source: 'local:tasks',
    text: openTasks.length
      ? vi
        ? `Việc đang mở (${openTasks.length}): ${openTasks.map((t) => t.title).join('; ')}`
        : `Open tasks (${openTasks.length}): ${openTasks.map((t) => t.title).join('; ')}`
      : vi
        ? 'Không có việc đang mở.'
        : 'No open tasks.',
  })

  const notes = readNotes(practiceId)
  chunks.push({
    id: 'notes',
    source: 'local:notes',
    text: clip(
      notes
        ? vi
          ? `Ghi chú:\n${notes}`
          : `Notes:\n${notes}`
        : vi
          ? 'Bảng ghi chú trống.'
          : 'Notes board empty.',
      1_200,
    ),
  })

  const mails = readEmails(practiceId).slice(0, MAX_LIST)
  chunks.push({
    id: 'email',
    source: 'local:email',
    text: mails.length
      ? vi
        ? `Email (${mails.length}): ${mails
            .map((m) => `[${m.folder}] ${m.subject || '(không tiêu đề)'} → ${m.to || m.from}`)
            .join('; ')}`
        : `Email (${mails.length}): ${mails
            .map((m) => `[${m.folder}] ${m.subject || '(no subject)'} → ${m.to || m.from}`)
            .join('; ')}`
      : vi
        ? 'Hộp thư trống.'
        : 'Email mailbox empty.',
  })

  const cal = readCalendar(practiceId).slice(0, MAX_LIST)
  chunks.push({
    id: 'calendar',
    source: 'local:calendar',
    text: cal.length
      ? vi
        ? `Lịch: ${cal.map((i) => `${i.date} ${i.title}`).join('; ')}`
        : `Calendar: ${cal.map((i) => `${i.date} ${i.title}`).join('; ')}`
      : vi
        ? 'Lịch trống.'
        : 'Calendar empty.',
  })

  const recents = opts?.recents?.slice(0, MAX_LIST) ?? []
  if (recents.length) {
    chunks.push({
      id: 'recents',
      source: 'local:recents',
      text: vi
        ? `File gần đây: ${recents.map((e) => `${e.name} (.${e.ext})`).join('; ')}`
        : `Recent files: ${recents.map((e) => `${e.name} (.${e.ext})`).join('; ')}`,
    })
  }

  chunks.push({
    id: 'practice',
    source: 'local:practice',
    text: vi ? `Practice đang chọn: ${practiceId}` : `Active practice: ${practiceId}`,
  })

  const packed = packChunks(chunks)
  const plainText = packed.map((c) => `[${c.source}] ${c.text}`).join('\n')
  return {
    practiceId,
    chunks: packed,
    charCount: plainText.length,
    builtAt: new Date().toISOString(),
    plainText,
  }
}

/** Build a budget-capped context pack for Hub / preview UI. */
export function buildContextPack(
  intent: AgentIntent,
  practiceId: PracticeId,
  vi: boolean,
): ContextPack {
  const tabId = tabIdForTarget(intent.target)
  const chunks: ContextChunk[] = [
    {
      id: 'intent',
      source: 'intent',
      text: clip(
        [
          `Intent ${intent.intentId}`,
          `source=${intent.source}`,
          `scope=${intent.scope}`,
          intent.text ? `user: ${intent.text}` : '',
        ]
          .filter(Boolean)
          .join(' | '),
        800,
      ),
    },
  ]

  if (intent.target.kind === 'module') {
    chunks.push(...moduleContext(practiceId, intent.target.id))
  } else if (intent.target.kind === 'pillar') {
    chunks.push({
      id: 'pillar',
      source: `pillar:${intent.target.id}`,
      text: `Workbench pillar ${intent.target.id}. Pack library / skills stay on device.`,
    })
  } else {
    chunks.push({
      id: 'skill-domain',
      source: `skill-domain:${intent.target.id}`,
      text: `Skills domain ${intent.target.id}.`,
    })
  }

  const packed = packChunks(chunks)
  const charCount = packed.reduce((n, c) => n + c.text.length, 0)
  return {
    intentId: intent.intentId,
    tabId,
    targetLabel: labelForTarget(intent.target, vi),
    actionLabel: vi ? actionDef(intent.action).labelVi : actionDef(intent.action).labelEn,
    summary: intent.summary,
    chunks: packed,
    charCount,
    builtAt: new Date().toISOString(),
  }
}
