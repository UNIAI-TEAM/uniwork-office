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
import { readNotes } from './workbench-pins'
import { cachedAgendaItems, cachedOpenTasks } from './work-cache'

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
    const open = cachedOpenTasks()?.slice(0, MAX_LIST) ?? null
    chunks.push({
      id: 'tasks-open',
      source: 'uniwork:tasks',
      text:
        open === null
          ? 'Open tasks: not loaded from UniWork yet.'
          : open.length
            ? `Open tasks (${open.length}): ${open.map((t) => t.title).join('; ')}`
            : 'No open tasks.',
    })
  } else if (moduleId === 'calendar') {
    const items = cachedAgendaItems()?.slice(0, MAX_LIST) ?? null
    chunks.push({
      id: 'calendar',
      source: 'uniwork:calendar',
      text:
        items === null
          ? 'Calendar: not loaded from UniWork yet.'
          : items.length
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
  } else if (moduleId === 'desk') {
    const open = cachedOpenTasks()
    chunks.push({
      id: 'desk',
      source: 'uniwork:desk',
      text:
        open === null
          ? 'Overview pulse: open tasks not loaded from UniWork yet.'
          : `Overview pulse: openTasks=${open.length}`,
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
