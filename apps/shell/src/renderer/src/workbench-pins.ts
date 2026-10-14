import {
  defaultPinnedModules,
  ensureCorePinnedModules,
  isCorePinnedModule,
  isPracticePillarId,
  isWorkbenchModuleId,
  type PracticeId,
  type PracticePillarId,
  type WorkbenchModuleId,
} from '@uniwork/practice-core'

import { wbStoreGetRaw, wbStoreRead, wbStoreSetRaw, wbStoreWrite } from './workbench-store-client'

const PINS_PREFIX = 'uniwork.wb.pins.'
const PILLAR_PINS_PREFIX = 'uniwork.wb.pillarPins.'

/** Pillars (Knowledge / Materials / Skills / Compose) are opt-in via Tab + — none pinned by default. */
export function defaultPinnedPillars(): PracticePillarId[] {
  return []
}

export function readPinnedPillars(practiceId: PracticeId): PracticePillarId[] {
  try {
    const raw = wbStoreGetRaw(PILLAR_PINS_PREFIX + practiceId)
    if (raw === null) return defaultPinnedPillars()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaultPinnedPillars()
    return parsed.filter(isPracticePillarId)
  } catch {
    return defaultPinnedPillars()
  }
}

export function writePinnedPillars(practiceId: PracticeId, pins: PracticePillarId[]): void {
  try {
    wbStoreSetRaw(PILLAR_PINS_PREFIX + practiceId, JSON.stringify(pins))
  } catch {
    /* ignore quota */
  }
}

export function pinPillar(practiceId: PracticeId, id: PracticePillarId): PracticePillarId[] {
  const cur = readPinnedPillars(practiceId)
  if (cur.includes(id)) return cur
  const next = [...cur, id]
  writePinnedPillars(practiceId, next)
  return next
}

export function unpinPillar(practiceId: PracticeId, id: PracticePillarId): PracticePillarId[] {
  const next = readPinnedPillars(practiceId).filter((x) => x !== id)
  writePinnedPillars(practiceId, next)
  return next
}

export function readPinnedModules(practiceId: PracticeId): WorkbenchModuleId[] {
  try {
    const raw = wbStoreGetRaw(PINS_PREFIX + practiceId)
    if (raw === null) return defaultPinnedModules(practiceId)
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaultPinnedModules(practiceId)
    return ensureCorePinnedModules(parsed.filter(isWorkbenchModuleId))
  } catch {
    return defaultPinnedModules(practiceId)
  }
}

export function writePinnedModules(practiceId: PracticeId, pins: WorkbenchModuleId[]): void {
  try {
    wbStoreSetRaw(PINS_PREFIX + practiceId, JSON.stringify(ensureCorePinnedModules(pins)))
  } catch {
    /* ignore quota */
  }
}

export function pinModule(practiceId: PracticeId, id: WorkbenchModuleId): WorkbenchModuleId[] {
  const cur = readPinnedModules(practiceId)
  if (cur.includes(id)) return cur
  const next = ensureCorePinnedModules([...cur, id])
  writePinnedModules(practiceId, next)
  return next
}

export function unpinModule(practiceId: PracticeId, id: WorkbenchModuleId): WorkbenchModuleId[] {
  // Core tabs (My Space / Tasks / Calendar / Forms) stay pinned
  if (isCorePinnedModule(id)) return readPinnedModules(practiceId)
  const next = ensureCorePinnedModules(readPinnedModules(practiceId).filter((x) => x !== id))
  writePinnedModules(practiceId, next)
  return next
}

/** Reorder pinned module tabs (drag-and-drop). Returns next pins. */
export function reorderPinnedModules(
  practiceId: PracticeId,
  fromId: WorkbenchModuleId,
  toId: WorkbenchModuleId,
): WorkbenchModuleId[] {
  if (fromId === toId) return readPinnedModules(practiceId)
  const cur = readPinnedModules(practiceId)
  const from = cur.indexOf(fromId)
  const to = cur.indexOf(toId)
  if (from < 0 || to < 0) return cur
  const next = [...cur]
  const [item] = next.splice(from, 1)
  if (!item) return cur
  next.splice(to, 0, item)
  writePinnedModules(practiceId, next)
  return next
}

// ── Lightweight local module data (per practice) ───────────

function readJson<T>(key: string, fallback: T): T {
  return wbStoreRead(key, fallback)
}

function writeJson(key: string, value: unknown): void {
  wbStoreWrite(key, value)
}

export type WbStickyColor = 'yellow' | 'peach' | 'mint' | 'sky' | 'lilac' | 'rose'

export const STICKY_COLORS: readonly WbStickyColor[] = [
  'yellow',
  'peach',
  'mint',
  'sky',
  'lilac',
  'rose',
]

export interface WbStickyNote {
  id: string
  body: string
  color: WbStickyColor
  /** Board position 0–100 (%) */
  x: number
  y: number
  /** Slight tilt in degrees */
  rotate: number
  z: number
  createdAt: string
  updatedAt: string
}

/** Notes and forms belong to the user, not the role (spec 5.6): one list per Workbench bucket. */
const STICKIES_KEY = 'uniwork.wb.stickies'
const FORMS_KEY = 'uniwork.wb.forms'

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 8
  return Math.min(88, Math.max(2, n))
}

function isStickyColor(v: unknown): v is WbStickyColor {
  return typeof v === 'string' && (STICKY_COLORS as readonly string[]).includes(v)
}

export function normalizeStickyNote(raw: Partial<WbStickyNote> & { id: string }): WbStickyNote {
  const now = new Date().toISOString()
  return {
    id: raw.id,
    body: typeof raw.body === 'string' ? raw.body : '',
    color: isStickyColor(raw.color) ? raw.color : 'yellow',
    x: clampPct(typeof raw.x === 'number' ? raw.x : 8),
    y: clampPct(typeof raw.y === 'number' ? raw.y : 8),
    rotate:
      typeof raw.rotate === 'number' && Number.isFinite(raw.rotate)
        ? Math.max(-8, Math.min(8, raw.rotate))
        : 0,
    z: typeof raw.z === 'number' && Number.isFinite(raw.z) ? raw.z : 1,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  }
}

export function readStickyNotes(_practiceId: PracticeId): WbStickyNote[] {
  try {
    const raw = wbStoreGetRaw(STICKIES_KEY)
    if (raw == null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((n): n is Partial<WbStickyNote> & { id: string } =>
        Boolean(n && typeof (n as { id?: unknown }).id === 'string'),
      )
      .map((n) => normalizeStickyNote(n))
  } catch {
    return []
  }
}

export function writeStickyNotes(_practiceId: PracticeId, items: WbStickyNote[]): void {
  writeJson(
    STICKIES_KEY,
    items.map((n) => normalizeStickyNote(n)),
  )
}

export function createStickyNote(
  practiceId: PracticeId,
  body: string,
  color?: WbStickyColor,
): WbStickyNote {
  const existing = readStickyNotes(practiceId)
  const now = new Date().toISOString()
  const idx = existing.length
  const note = normalizeStickyNote({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    body,
    color: color ?? STICKY_COLORS[idx % STICKY_COLORS.length],
    x: 8 + ((idx * 11) % 62),
    y: 10 + ((idx * 13) % 48),
    rotate: ((idx % 5) - 2) * 1.6,
    z: (existing.reduce((m, n) => Math.max(m, n.z), 0) || 0) + 1,
    createdAt: now,
    updatedAt: now,
  })
  writeStickyNotes(practiceId, [note, ...existing])
  return note
}

/** Plain-text join for AI context / legacy callers. */
export function readNotes(practiceId: PracticeId): string {
  return readStickyNotes(practiceId)
    .map((n) => n.body.trim())
    .filter(Boolean)
    .join('\n\n')
}

/** Append as a new sticky note (legacy write path). */
export function writeNotes(practiceId: PracticeId, text: string): void {
  const body = text.trim()
  if (!body) return
  const existing = readStickyNotes(practiceId)
  const joined = existing
    .map((n) => n.body.trim())
    .filter(Boolean)
    .join('\n\n')
  if (joined === body) return
  if (body.startsWith(joined) && joined) {
    const appended = body.slice(joined.length).trim()
    if (appended) createStickyNote(practiceId, appended)
    return
  }
  createStickyNote(practiceId, body)
}

export interface WbFormItem {
  id: string
  title: string
  note?: string
  /** Practice / education pack this form draft is linked into (Tài liệu). */
  linkedProjectId?: string
  /** Absolute path to an uploaded template file (docx/pdf/xlsx/…). */
  filePath?: string
  fileName?: string
  /** lowercased extension without the dot */
  fileExt?: string
  /** Optional link to a built-in My AI practice template id (slot schema). */
  templateId?: string
}

export function readForms(_practiceId: PracticeId): WbFormItem[] {
  return readJson(FORMS_KEY, [])
}

export function writeForms(_practiceId: PracticeId, items: WbFormItem[]): void {
  writeJson(FORMS_KEY, items)
}
