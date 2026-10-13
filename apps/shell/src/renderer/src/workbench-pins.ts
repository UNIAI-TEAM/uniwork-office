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

import {
  wbStoreGetRaw,
  wbStoreRead,
  wbStoreRemove,
  wbStoreSetRaw,
  wbStoreWrite,
} from './workbench-store-client'
import { wbMediaDbName } from './workbench-bucket'

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

export interface WbCalendarItem {
  id: string
  date: string
  title: string
  done?: boolean
}

export type CalendarViewMode = 'list' | 'calendar'

export function readCalendarView(): CalendarViewMode {
  try {
    const raw = wbStoreGetRaw('uniwork.wb.calendar.view')
    if (raw === 'list' || raw === 'calendar') return raw
  } catch {
    /* ignore */
  }
  return 'calendar'
}

export function writeCalendarView(mode: CalendarViewMode): void {
  try {
    wbStoreSetRaw('uniwork.wb.calendar.view', mode)
  } catch {
    /* ignore */
  }
}

/** Personal task board — no approval workflow. */
export type WbTaskStatus = 'todo' | 'doing' | 'done' | 'cancelled'
export type WbTaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TasksViewId = 'list' | 'kanban' | 'calendar' | 'dashboard'

export interface WbTaskAttachmentMeta {
  id: string
  name: string
  mime?: string
  size: number
  addedAt: string
}

export interface WbTaskItem {
  id: string
  title: string
  /** Kept in sync with status === 'done' for Desk / legacy readers. */
  done: boolean
  status: WbTaskStatus
  priority: WbTaskPriority
  description?: string
  dueDate?: string
  startDate?: string
  tags?: string[]
  attachments?: WbTaskAttachmentMeta[]
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export function normalizeTaskItem(
  raw: Partial<WbTaskItem> & { id: string; title: string },
): WbTaskItem {
  const now = new Date().toISOString()
  const status: WbTaskStatus =
    raw.status === 'todo' ||
    raw.status === 'doing' ||
    raw.status === 'done' ||
    raw.status === 'cancelled'
      ? raw.status
      : raw.done
        ? 'done'
        : 'todo'
  const priority: WbTaskPriority =
    raw.priority === 'low' ||
    raw.priority === 'medium' ||
    raw.priority === 'high' ||
    raw.priority === 'urgent'
      ? raw.priority
      : 'medium'
  const done = status === 'done'
  return {
    id: raw.id,
    title: raw.title,
    done,
    status,
    priority,
    ...(raw.description?.trim() ? { description: raw.description.trim() } : {}),
    ...(raw.dueDate ? { dueDate: raw.dueDate } : {}),
    ...(raw.startDate ? { startDate: raw.startDate } : {}),
    ...(raw.tags?.length ? { tags: raw.tags } : {}),
    ...(raw.attachments?.length ? { attachments: raw.attachments } : {}),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    ...(done && (raw.completedAt || now) ? { completedAt: raw.completedAt || now } : {}),
  }
}

export function taskWithStatus(item: WbTaskItem, status: WbTaskStatus): WbTaskItem {
  const done = status === 'done'
  return {
    ...item,
    status,
    done,
    updatedAt: new Date().toISOString(),
    ...(done
      ? { completedAt: item.completedAt || new Date().toISOString() }
      : { completedAt: undefined }),
  }
}

function readJson<T>(key: string, fallback: T): T {
  return wbStoreRead(key, fallback)
}

function writeJson(key: string, value: unknown): void {
  wbStoreWrite(key, value)
}

export function readCalendar(practiceId: PracticeId): WbCalendarItem[] {
  return readJson(`uniwork.wb.calendar.${practiceId}`, [])
}

export function writeCalendar(practiceId: PracticeId, items: WbCalendarItem[]): void {
  writeJson(`uniwork.wb.calendar.${practiceId}`, items)
}

export function readTasks(practiceId: PracticeId): WbTaskItem[] {
  const raw = readJson<Partial<WbTaskItem>[]>(`uniwork.wb.tasks.${practiceId}`, [])
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is Partial<WbTaskItem> & { id: string; title: string } =>
      Boolean(t && typeof t.id === 'string' && typeof t.title === 'string'),
    )
    .map((t) => normalizeTaskItem(t))
}

export function writeTasks(practiceId: PracticeId, items: WbTaskItem[]): void {
  writeJson(
    `uniwork.wb.tasks.${practiceId}`,
    items.map((t) => normalizeTaskItem(t)),
  )
}

export function readTasksView(): TasksViewId {
  try {
    const raw = wbStoreGetRaw('uniwork.wb.tasks.view')
    if (raw === 'list' || raw === 'kanban' || raw === 'calendar' || raw === 'dashboard') return raw
  } catch {
    /* ignore */
  }
  return 'list'
}

export function writeTasksView(view: TasksViewId): void {
  try {
    wbStoreSetRaw('uniwork.wb.tasks.view', view)
  } catch {
    /* ignore */
  }
}

const TASK_MEDIA_DB = 'uniwork.wb.tasks.media'
const TASK_MEDIA_STORE = 'blobs'

function openTaskMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(wbMediaDbName(TASK_MEDIA_DB), 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(TASK_MEDIA_STORE)) {
        db.createObjectStore(TASK_MEDIA_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('task_media_open_failed'))
  })
}

export async function putTaskAttachmentBlob(id: string, blob: Blob): Promise<void> {
  const db = await openTaskMediaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TASK_MEDIA_STORE, 'readwrite')
    tx.objectStore(TASK_MEDIA_STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('task_media_put_failed'))
  })
  db.close()
}

export async function getTaskAttachmentBlob(id: string): Promise<Blob | null> {
  const db = await openTaskMediaDb()
  const value = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(TASK_MEDIA_STORE, 'readonly')
    const req = tx.objectStore(TASK_MEDIA_STORE).get(id)
    req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null)
    req.onerror = () => reject(req.error ?? new Error('task_media_get_failed'))
  })
  db.close()
  return value
}

export async function deleteTaskAttachmentBlob(id: string): Promise<void> {
  const db = await openTaskMediaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TASK_MEDIA_STORE, 'readwrite')
    tx.objectStore(TASK_MEDIA_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('task_media_delete_failed'))
  })
  db.close()
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

function stickyKey(practiceId: PracticeId): string {
  return `uniwork.wb.stickies.${practiceId}`
}

function legacyNotesKey(practiceId: PracticeId): string {
  return `uniwork.wb.notes.${practiceId}`
}

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

function migrateLegacyNotes(practiceId: PracticeId): WbStickyNote[] | null {
  try {
    const legacy = wbStoreGetRaw(legacyNotesKey(practiceId))
    if (legacy == null) return null
    const text = legacy.trim()
    wbStoreRemove(legacyNotesKey(practiceId))
    if (!text) return []
    const now = new Date().toISOString()
    return [
      normalizeStickyNote({
        id: `${Date.now().toString(36)}-legacy`,
        body: text,
        color: 'yellow',
        x: 12,
        y: 14,
        rotate: -2,
        z: 1,
        createdAt: now,
        updatedAt: now,
      }),
    ]
  } catch {
    return null
  }
}

export function readStickyNotes(practiceId: PracticeId): WbStickyNote[] {
  const key = stickyKey(practiceId)
  try {
    const raw = wbStoreGetRaw(key)
    if (raw == null) {
      const migrated = migrateLegacyNotes(practiceId)
      if (migrated) {
        writeStickyNotes(practiceId, migrated)
        return migrated
      }
      return []
    }
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

export function writeStickyNotes(practiceId: PracticeId, items: WbStickyNote[]): void {
  writeJson(
    stickyKey(practiceId),
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

export interface WbPersonalProfile {
  fullName: string
  org: string
  title: string
  phone: string
  email: string
  address: string
}

const DEFAULT_PERSONAL: WbPersonalProfile = {
  fullName: '',
  org: '',
  title: '',
  phone: '',
  email: '',
  address: '',
}

export function readForms(practiceId: PracticeId): WbFormItem[] {
  return readJson(`uniwork.wb.forms.${practiceId}`, [])
}

export function writeForms(practiceId: PracticeId, items: WbFormItem[]): void {
  writeJson(`uniwork.wb.forms.${practiceId}`, items)
}

export function readPersonal(): WbPersonalProfile {
  return { ...DEFAULT_PERSONAL, ...readJson('uniwork.wb.personal', {}) }
}

export function writePersonal(profile: WbPersonalProfile): void {
  writeJson('uniwork.wb.personal', profile)
}
