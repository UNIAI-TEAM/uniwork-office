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

export function normalizeTaskItem(raw: Partial<WbTaskItem> & { id: string; title: string }): WbTaskItem {
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

/** Guard re-entrant dual-write between Calendar ↔ Events. */
let calendarEventsSyncing = false

export function readCalendar(practiceId: PracticeId): WbCalendarItem[] {
  return readJson(`uniwork.wb.calendar.${practiceId}`, [])
}

export function writeCalendar(practiceId: PracticeId, items: WbCalendarItem[]): void {
  writeJson(`uniwork.wb.calendar.${practiceId}`, items)
  if (calendarEventsSyncing) return
  calendarEventsSyncing = true
  try {
    const events = readJson<WbEventItem[]>(`uniwork.wb.events.${practiceId}`, [])
    const map = new Map(events.map((e) => [e.id, e]))
    for (const c of items) {
      const prev = map.get(c.id)
      map.set(c.id, {
        id: c.id,
        date: c.date,
        title: c.title,
        ...(prev?.time ? { time: prev.time } : {}),
        ...(prev?.place ? { place: prev.place } : {}),
      })
    }
    writeJson(`uniwork.wb.events.${practiceId}`, [...map.values()])
  } finally {
    calendarEventsSyncing = false
  }
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
    const req = indexedDB.open(TASK_MEDIA_DB, 1)
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
    rotate: typeof raw.rotate === 'number' && Number.isFinite(raw.rotate) ? Math.max(-8, Math.min(8, raw.rotate)) : 0,
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
  const joined = existing.map((n) => n.body.trim()).filter(Boolean).join('\n\n')
  if (joined === body) return
  if (body.startsWith(joined) && joined) {
    const appended = body.slice(joined.length).trim()
    if (appended) createStickyNote(practiceId, appended)
    return
  }
  createStickyNote(practiceId, body)
}

export type WbEmailFolder = 'inbox' | 'drafts' | 'sent' | 'archive'

export interface WbEmailMessage {
  id: string
  folder: WbEmailFolder
  from: string
  to: string
  cc?: string
  subject: string
  body: string
  starred?: boolean
  unread?: boolean
  /** Sample rows until real mailbox sync ships */
  demo?: boolean
  createdAt: string
  updatedAt: string
}

function emailKey(practiceId: PracticeId): string {
  return `uniwork.wb.email.${practiceId}`
}

function isEmailFolder(v: unknown): v is WbEmailFolder {
  return v === 'inbox' || v === 'drafts' || v === 'sent' || v === 'archive'
}

export function normalizeEmailMessage(
  raw: Partial<WbEmailMessage> & { id: string },
): WbEmailMessage {
  const now = new Date().toISOString()
  return {
    id: raw.id,
    folder: isEmailFolder(raw.folder) ? raw.folder : 'drafts',
    from: typeof raw.from === 'string' ? raw.from : '',
    to: typeof raw.to === 'string' ? raw.to : '',
    ...(typeof raw.cc === 'string' && raw.cc.trim() ? { cc: raw.cc.trim() } : {}),
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    body: typeof raw.body === 'string' ? raw.body : '',
    ...(raw.starred ? { starred: true } : {}),
    ...(raw.unread ? { unread: true } : {}),
    ...(raw.demo ? { demo: true } : {}),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  }
}

function seedDemoEmails(practiceId: PracticeId): WbEmailMessage[] {
  const now = Date.now()
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString()
  return [
    normalizeEmailMessage({
      id: `${practiceId}-demo-1`,
      folder: 'inbox',
      from: 'team@uniwork.local',
      to: 'me@local',
      subject: 'Chào mừng bạn đến Tab Email (MVP)',
      body:
        'Đây là thư mẫu trên máy — chưa đồng bộ hộp thư thật.\n\nBạn có thể soạn nháp, dùng AI chỉnh giọng văn, và lưu Sent cục bộ. Kết nối Gmail/Outlook sẽ có ở bước sau.',
      unread: true,
      demo: true,
      createdAt: iso(3600_000),
      updatedAt: iso(3600_000),
    }),
    normalizeEmailMessage({
      id: `${practiceId}-demo-2`,
      folder: 'inbox',
      from: 'notes@uniwork.local',
      to: 'me@local',
      subject: 'Gợi ý: biến email thành việc cần làm',
      body:
        'Mở một thư → “Tạo việc” để đẩy sang tab Công việc.\n\nMVP tập trung soạn thảo + AI; inbox thật sẽ đến khi kết nối tài khoản.',
      unread: true,
      starred: true,
      demo: true,
      createdAt: iso(7200_000),
      updatedAt: iso(7200_000),
    }),
  ]
}

export function readEmails(practiceId: PracticeId): WbEmailMessage[] {
  const key = emailKey(practiceId)
  try {
    const raw = wbStoreGetRaw(key)
    if (raw == null) {
      const seeded = seedDemoEmails(practiceId)
      writeEmails(practiceId, seeded)
      return seeded
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((m): m is Partial<WbEmailMessage> & { id: string } =>
        Boolean(m && typeof (m as { id?: unknown }).id === 'string'),
      )
      .map((m) => normalizeEmailMessage(m))
  } catch {
    return []
  }
}

export function writeEmails(practiceId: PracticeId, items: WbEmailMessage[]): void {
  writeJson(
    emailKey(practiceId),
    items.map((m) => normalizeEmailMessage(m)),
  )
}

export function createEmailDraft(
  practiceId: PracticeId,
  input?: Partial<Pick<WbEmailMessage, 'to' | 'cc' | 'subject' | 'body' | 'from'>>,
): WbEmailMessage {
  const existing = readEmails(practiceId)
  const now = new Date().toISOString()
  const draft = normalizeEmailMessage({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    folder: 'drafts',
    from: input?.from ?? 'me@local',
    to: input?.to ?? '',
    cc: input?.cc,
    subject: input?.subject ?? '',
    body: input?.body ?? '',
    createdAt: now,
    updatedAt: now,
  })
  writeEmails(practiceId, [draft, ...existing])
  return draft
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

export interface WbFinanceItem {
  id: string
  date: string
  kind: 'income' | 'expense'
  amount: number
  label: string
  category?: 'living' | 'food' | 'transport' | 'bills' | 'fun' | 'health' | 'other'
}

/** Sub-tabs inside Tài chính cá nhân */
export type FinanceSubTabId = 'goals' | 'spending' | 'invest'

export function readFinanceSubTab(): FinanceSubTabId {
  try {
    const raw = wbStoreGetRaw('uniwork.wb.finance.subtab')
    if (raw === 'goals' || raw === 'spending' || raw === 'invest') return raw
  } catch {
    /* ignore */
  }
  return 'goals'
}

export function writeFinanceSubTab(id: FinanceSubTabId): void {
  try {
    wbStoreSetRaw('uniwork.wb.finance.subtab', id)
  } catch {
    /* ignore */
  }
}

/** Mục tiêu tài chính */
export interface WbFinanceGoal {
  id: string
  title: string
  targetAmount: number
  currentAmount: number
  deadline?: string
  note?: string
  done: boolean
}

export function readFinanceGoals(): WbFinanceGoal[] {
  return readJson('uniwork.wb.finance.goals', [])
}

export function writeFinanceGoals(items: WbFinanceGoal[]): void {
  writeJson('uniwork.wb.finance.goals', items)
}

/** Đầu tư / tích luỹ tài sản */
export interface WbFinanceInvest {
  id: string
  name: string
  kind: 'stock' | 'fund' | 'bond' | 'crypto' | 'savings' | 'gold' | 'realestate' | 'other'
  amount: number
  date: string
  note?: string
}

export function readFinanceInvest(): WbFinanceInvest[] {
  return readJson('uniwork.wb.finance.invest', [])
}

export function writeFinanceInvest(items: WbFinanceInvest[]): void {
  writeJson('uniwork.wb.finance.invest', items)
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

export function readFinance(): WbFinanceItem[] {
  return readJson('uniwork.wb.finance', [])
}

export function writeFinance(items: WbFinanceItem[]): void {
  writeJson('uniwork.wb.finance', items)
}

export interface WbEventItem {
  id: string
  date: string
  time?: string
  title: string
  place?: string
}

export interface WbHealthItem {
  id: string
  date: string
  kind: 'sleep' | 'exercise' | 'checkup' | 'other'
  note: string
  value?: string
}

/** Sub-tabs inside Sức khoẻ */
export type HealthSubTabId =
  | 'metrics'
  | 'running'
  | 'yoga'
  | 'sports'
  | 'diet'
  | 'fasting'
  | 'veg'

export function readHealthSubTab(): HealthSubTabId {
  try {
    const raw = wbStoreGetRaw('uniwork.wb.health.subtab')
    const ok: HealthSubTabId[] = [
      'metrics',
      'running',
      'yoga',
      'sports',
      'diet',
      'fasting',
      'veg',
    ]
    if (raw && (ok as string[]).includes(raw)) return raw as HealthSubTabId
  } catch {
    /* ignore */
  }
  return 'metrics'
}

export function writeHealthSubTab(id: HealthSubTabId): void {
  try {
    wbStoreSetRaw('uniwork.wb.health.subtab', id)
  } catch {
    /* ignore */
  }
}

export function readHealth(): WbHealthItem[] {
  return readJson('uniwork.wb.health', [])
}

export function writeHealth(items: WbHealthItem[]): void {
  writeJson('uniwork.wb.health', items)
}

export interface WbHealthMetric {
  id: string
  date: string
  metric: 'weight' | 'bmi' | 'bp' | 'hr' | 'sleep' | 'steps' | 'glucose' | 'other'
  value: string
  unit?: string
  note?: string
}

export function readHealthMetrics(): WbHealthMetric[] {
  return readJson('uniwork.wb.health.metrics', [])
}

export function writeHealthMetrics(items: WbHealthMetric[]): void {
  writeJson('uniwork.wb.health.metrics', items)
}

/** Mục tiêu chỉ số sức khoẻ (cân nặng, bước, ngủ…) */
export interface WbHealthMetricGoal {
  id: string
  metric: WbHealthMetric['metric']
  target: string
  unit?: string
  note?: string
}

export function readHealthMetricGoals(): WbHealthMetricGoal[] {
  return readJson('uniwork.wb.health.metricGoals', [])
}

export function writeHealthMetricGoals(items: WbHealthMetricGoal[]): void {
  writeJson('uniwork.wb.health.metricGoals', items)
}

/** Custom body figure for health metrics (photo blob in IndexedDB; default = bundled mannequin). */
export type WbHealthBodySource = 'default' | 'upload' | 'camera'

export interface WbHealthBodyMeta {
  source: WbHealthBodySource
  updatedAt: string
}

const HEALTH_BODY_DB = 'uniwork.wb.health.media'
const HEALTH_BODY_STORE = 'blobs'
const HEALTH_BODY_BLOB_KEY = 'body-figure'
const HEALTH_BODY_META_KEY = 'uniwork.wb.health.bodyMeta'

function openHealthMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HEALTH_BODY_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(HEALTH_BODY_STORE)) {
        db.createObjectStore(HEALTH_BODY_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('health_media_idb_open_failed'))
  })
}

export function readHealthBodyMeta(): WbHealthBodyMeta | null {
  try {
    const raw = wbStoreGetRaw(HEALTH_BODY_META_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as WbHealthBodyMeta
    if (parsed?.source === 'upload' || parsed?.source === 'camera') return parsed
  } catch {
    /* ignore */
  }
  return null
}

export function writeHealthBodyMeta(meta: WbHealthBodyMeta | null): void {
  try {
    if (!meta) wbStoreRemove(HEALTH_BODY_META_KEY)
    else wbStoreSetRaw(HEALTH_BODY_META_KEY, JSON.stringify(meta))
  } catch {
    /* ignore */
  }
}

export async function putHealthBodyBlob(dataUrl: string): Promise<void> {
  const db = await openHealthMediaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HEALTH_BODY_STORE, 'readwrite')
    tx.objectStore(HEALTH_BODY_STORE).put(dataUrl, HEALTH_BODY_BLOB_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('health_media_idb_put_failed'))
  })
  db.close()
}

export async function getHealthBodyBlob(): Promise<string | null> {
  const db = await openHealthMediaDb()
  const value = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(HEALTH_BODY_STORE, 'readonly')
    const req = tx.objectStore(HEALTH_BODY_STORE).get(HEALTH_BODY_BLOB_KEY)
    req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null)
    req.onerror = () => reject(req.error ?? new Error('health_media_idb_get_failed'))
  })
  db.close()
  return value
}

export async function clearHealthBodyBlob(): Promise<void> {
  const db = await openHealthMediaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HEALTH_BODY_STORE, 'readwrite')
    tx.objectStore(HEALTH_BODY_STORE).delete(HEALTH_BODY_BLOB_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('health_media_idb_delete_failed'))
  })
  db.close()
}

export interface WbHealthRun {
  id: string
  date: string
  distanceKm: number
  durationMin: number
  pace?: string
  note?: string
}

export function readHealthRuns(): WbHealthRun[] {
  return readJson('uniwork.wb.health.runs', [])
}

export function writeHealthRuns(items: WbHealthRun[]): void {
  writeJson('uniwork.wb.health.runs', items)
}

export interface WbHealthYoga {
  id: string
  date: string
  style: string
  durationMin: number
  intensity: 'easy' | 'moderate' | 'hard'
  note?: string
}

export function readHealthYoga(): WbHealthYoga[] {
  return readJson('uniwork.wb.health.yoga', [])
}

export function writeHealthYoga(items: WbHealthYoga[]): void {
  writeJson('uniwork.wb.health.yoga', items)
}

export interface WbHealthSport {
  id: string
  date: string
  sport: string
  durationMin: number
  note?: string
}

export function readHealthSports(): WbHealthSport[] {
  return readJson('uniwork.wb.health.sports', [])
}

export function writeHealthSports(items: WbHealthSport[]): void {
  writeJson('uniwork.wb.health.sports', items)
}

export interface WbHealthDietPlan {
  id: string
  title: string
  goal?: string
  startDate: string
  endDate?: string
  dailyKcal?: number
  note?: string
  active: boolean
}

export function readHealthDiets(): WbHealthDietPlan[] {
  return readJson('uniwork.wb.health.diets', [])
}

export function writeHealthDiets(items: WbHealthDietPlan[]): void {
  writeJson('uniwork.wb.health.diets', items)
}

export interface WbHealthFasting {
  id: string
  date: string
  protocol: '16:8' | '18:6' | '20:4' | 'OMAD' | '5:2' | 'other'
  fastStart?: string
  fastEnd?: string
  completed: boolean
  note?: string
}

export function readHealthFasting(): WbHealthFasting[] {
  return readJson('uniwork.wb.health.fasting', [])
}

export function writeHealthFasting(items: WbHealthFasting[]): void {
  writeJson('uniwork.wb.health.fasting', items)
}

export interface WbHealthVeg {
  id: string
  date: string
  mode: 'vegetarian' | 'vegan' | 'flexitarian' | 'other'
  meals?: string
  note?: string
  ok: boolean
}

export function readHealthVeg(): WbHealthVeg[] {
  return readJson('uniwork.wb.health.veg', [])
}

export function writeHealthVeg(items: WbHealthVeg[]): void {
  writeJson('uniwork.wb.health.veg', items)
}

/** Aggregated counts for Desk health widget (legacy + new logs). */
export function healthDeskCounts(): {
  exercise: number
  sleep: number
  checkup: number
  other: number
} {
  const legacy = readHealth()
  const metrics = readHealthMetrics()
  const runs = readHealthRuns()
  const yoga = readHealthYoga()
  const sports = readHealthSports()
  return {
    exercise:
      legacy.filter((h) => h.kind === 'exercise').length +
      runs.length +
      yoga.length +
      sports.length,
    sleep:
      legacy.filter((h) => h.kind === 'sleep').length +
      metrics.filter((m) => m.metric === 'sleep').length,
    checkup:
      legacy.filter((h) => h.kind === 'checkup').length +
      metrics.filter((m) => m.metric !== 'sleep' && m.metric !== 'steps' && m.metric !== 'other')
        .length,
    other:
      legacy.filter((h) => h.kind === 'other').length +
      metrics.filter((m) => m.metric === 'other' || m.metric === 'steps').length +
      readHealthDiets().length +
      readHealthFasting().length +
      readHealthVeg().length,
  }
}

export interface WbGrowthItem {
  id: string
  title: string
  progress: number
  note?: string
  done: boolean
}

export function readEvents(practiceId: PracticeId): WbEventItem[] {
  return readJson(`uniwork.wb.events.${practiceId}`, [])
}

export function writeEvents(practiceId: PracticeId, items: WbEventItem[]): void {
  writeJson(`uniwork.wb.events.${practiceId}`, items)
  if (calendarEventsSyncing) return
  calendarEventsSyncing = true
  try {
    const cal = readJson<WbCalendarItem[]>(`uniwork.wb.calendar.${practiceId}`, [])
    const map = new Map(cal.map((c) => [c.id, c]))
    for (const e of items) {
      const prev = map.get(e.id)
      map.set(e.id, {
        id: e.id,
        date: e.date,
        title: e.title,
        ...(prev?.done !== undefined ? { done: prev.done } : {}),
      })
    }
    writeJson(`uniwork.wb.calendar.${practiceId}`, [...map.values()])
  } finally {
    calendarEventsSyncing = false
  }
}

export function readGrowth(): WbGrowthItem[] {
  return readJson('uniwork.wb.growth', [])
}

export function writeGrowth(items: WbGrowthItem[]): void {
  writeJson('uniwork.wb.growth', items)
}

export interface WbFamilyMember {
  id: string
  name: string
  relation: string
  birthday?: string
  phone?: string
  note?: string
}

/** Sub-tabs inside Gia đình tôi */
export type FamilySubTabId =
  | 'members'
  | 'parenting'
  | 'meds'
  | 'shopping'
  | 'tree'
  | 'milestones'

export function readFamilySubTab(): FamilySubTabId {
  try {
    const raw = wbStoreGetRaw('uniwork.wb.family.subtab')
    const ok: FamilySubTabId[] = [
      'members',
      'parenting',
      'meds',
      'shopping',
      'tree',
      'milestones',
    ]
    if (raw && (ok as string[]).includes(raw)) return raw as FamilySubTabId
  } catch {
    /* ignore */
  }
  return 'members'
}

export function writeFamilySubTab(id: FamilySubTabId): void {
  try {
    wbStoreSetRaw('uniwork.wb.family.subtab', id)
  } catch {
    /* ignore */
  }
}

export function readFamily(): WbFamilyMember[] {
  return readJson('uniwork.wb.family', [])
}

export function writeFamily(items: WbFamilyMember[]): void {
  writeJson('uniwork.wb.family', items)
}

/** Đồng hành cùng con — hoạt động / học tập / quan tâm */
export interface WbFamilyParentingItem {
  id: string
  date: string
  childName: string
  title: string
  kind: 'study' | 'health' | 'activity' | 'talk' | 'other'
  note?: string
  done: boolean
}

export function readFamilyParenting(): WbFamilyParentingItem[] {
  return readJson('uniwork.wb.family.parenting', [])
}

export function writeFamilyParenting(items: WbFamilyParentingItem[]): void {
  writeJson('uniwork.wb.family.parenting', items)
}

/** Nhắc thuốc trong gia đình */
export interface WbFamilyMedItem {
  id: string
  person: string
  medicine: string
  dose?: string
  schedule: string
  startDate?: string
  endDate?: string
  note?: string
  active: boolean
}

export function readFamilyMeds(): WbFamilyMedItem[] {
  return readJson('uniwork.wb.family.meds', [])
}

export function writeFamilyMeds(items: WbFamilyMedItem[]): void {
  writeJson('uniwork.wb.family.meds', items)
}

/** Chi tiêu / mua sắm gia đình */
export interface WbFamilyShopItem {
  id: string
  date: string
  title: string
  amount: number
  category: 'food' | 'kids' | 'home' | 'health' | 'gift' | 'other'
  note?: string
}

export function readFamilyShopping(): WbFamilyShopItem[] {
  return readJson('uniwork.wb.family.shopping', [])
}

export function writeFamilyShopping(items: WbFamilyShopItem[]): void {
  writeJson('uniwork.wb.family.shopping', items)
}

/** Gia phả — thành viên trên cây */
export interface WbFamilyTreeNode {
  id: string
  name: string
  generation: number
  side: 'paternal' | 'maternal' | 'self' | 'spouse' | 'other'
  /** Up to two parent node ids (links for the visual tree). */
  parentIds?: string[]
  /** Optional spouse link (pair rendered side-by-side). */
  spouseId?: string
  parentNames?: string
  birthYear?: string
  note?: string
  gender?: 'm' | 'f' | 'x'
}

export function readFamilyTree(): WbFamilyTreeNode[] {
  return readJson('uniwork.wb.family.tree', [])
}

export function writeFamilyTree(items: WbFamilyTreeNode[]): void {
  writeJson('uniwork.wb.family.tree', items)
}

/** Cột mốc kỷ niệm */
export interface WbFamilyMilestone {
  id: string
  date: string
  title: string
  kind: 'birthday' | 'wedding' | 'memorial' | 'achievement' | 'other'
  people?: string
  note?: string
  recurYearly: boolean
}

export function readFamilyMilestones(): WbFamilyMilestone[] {
  return readJson('uniwork.wb.family.milestones', [])
}

export function writeFamilyMilestones(items: WbFamilyMilestone[]): void {
  writeJson('uniwork.wb.family.milestones', items)
}

/** Sub-tabs inside Bạn bè */
export type FriendsSubTabId = 'people' | 'events' | 'anniversaries'

export interface WbFriend {
  id: string
  name: string
  nickname?: string
  howMet?: string
  birthday?: string
  phone?: string
  email?: string
  social?: string
  note?: string
}

export interface WbFriendEvent {
  id: string
  date: string
  title: string
  friendName?: string
  kind: 'meetup' | 'party' | 'trip' | 'gift' | 'other'
  note?: string
  done: boolean
}

export interface WbFriendAnniversary {
  id: string
  date: string
  title: string
  friendName?: string
  kind: 'friendship' | 'birthday' | 'met' | 'other'
  note?: string
  recurYearly: boolean
}

export function readFriendsSubTab(): FriendsSubTabId {
  try {
    const raw = wbStoreGetRaw('uniwork.wb.friends.subtab')
    const ok: FriendsSubTabId[] = ['people', 'events', 'anniversaries']
    if (raw && (ok as string[]).includes(raw)) return raw as FriendsSubTabId
  } catch {
    /* ignore */
  }
  return 'people'
}

export function writeFriendsSubTab(id: FriendsSubTabId): void {
  try {
    wbStoreSetRaw('uniwork.wb.friends.subtab', id)
  } catch {
    /* ignore */
  }
}

export function readFriends(): WbFriend[] {
  return readJson('uniwork.wb.friends', [])
}

export function writeFriends(items: WbFriend[]): void {
  writeJson('uniwork.wb.friends', items)
}

export function readFriendEvents(): WbFriendEvent[] {
  return readJson('uniwork.wb.friends.events', [])
}

export function writeFriendEvents(items: WbFriendEvent[]): void {
  writeJson('uniwork.wb.friends.events', items)
}

export function readFriendAnniversaries(): WbFriendAnniversary[] {
  return readJson('uniwork.wb.friends.anniversaries', [])
}

export function writeFriendAnniversaries(items: WbFriendAnniversary[]): void {
  writeJson('uniwork.wb.friends.anniversaries', items)
}

/** ── Pets (on-device profiles + photo album via IndexedDB) ─ */

export type PetsSubTabId = 'roster' | 'gallery' | 'care'

export type WbPetSpecies = 'dog' | 'cat' | 'bird' | 'fish' | 'rabbit' | 'other'

export type WbPetCareKind =
  | 'feed'
  | 'walk'
  | 'bath'
  | 'groom'
  | 'meds'
  | 'vet'
  | 'play'
  | 'other'

export type WbPetCareStatus = 'planned' | 'done' | 'skipped'

export interface WbPet {
  id: string
  name: string
  species: WbPetSpecies
  breed?: string
  birthday?: string
  sex?: 'male' | 'female' | 'unknown'
  color?: string
  notes?: string
  /** Photo id used as avatar (blob in IndexedDB). */
  avatarPhotoId?: string
  createdAt: string
}

export interface WbPetPhotoMeta {
  id: string
  petId: string
  caption?: string
  takenAt: string
  source: 'upload' | 'camera'
}

/** Scheduled care activity + optional result log (on-device). */
export interface WbPetCareItem {
  id: string
  petId: string
  kind: WbPetCareKind
  /** Optional free-text title; kind covers the category. */
  title?: string
  /** Local calendar date YYYY-MM-DD */
  scheduledDate: string
  /** Optional local time HH:mm */
  scheduledTime?: string
  status: WbPetCareStatus
  /** Plan / reminder note */
  note?: string
  /** Outcome when marked done or skipped */
  result?: string
  completedAt?: string
  createdAt: string
}

const PETS_DB = 'uniwork.wb.pets.media'
const PETS_STORE = 'photos'

function openPetsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PETS_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PETS_STORE)) {
        db.createObjectStore(PETS_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('pets_idb_open_failed'))
  })
}

export async function putPetPhotoBlob(id: string, dataUrl: string): Promise<void> {
  const db = await openPetsDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PETS_STORE, 'readwrite')
    tx.objectStore(PETS_STORE).put(dataUrl, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('pets_idb_put_failed'))
  })
  db.close()
}

export async function getPetPhotoBlob(id: string): Promise<string | null> {
  const db = await openPetsDb()
  const value = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(PETS_STORE, 'readonly')
    const req = tx.objectStore(PETS_STORE).get(id)
    req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null)
    req.onerror = () => reject(req.error ?? new Error('pets_idb_get_failed'))
  })
  db.close()
  return value
}

export async function deletePetPhotoBlob(id: string): Promise<void> {
  const db = await openPetsDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PETS_STORE, 'readwrite')
    tx.objectStore(PETS_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('pets_idb_delete_failed'))
  })
  db.close()
}

export function readPetsSubTab(): PetsSubTabId {
  try {
    const raw = wbStoreGetRaw('uniwork.wb.pets.subtab')
    if (raw === 'roster' || raw === 'gallery' || raw === 'care') return raw
  } catch {
    /* ignore */
  }
  return 'roster'
}

export function writePetsSubTab(id: PetsSubTabId): void {
  try {
    wbStoreSetRaw('uniwork.wb.pets.subtab', id)
  } catch {
    /* ignore */
  }
}

export function readPets(): WbPet[] {
  return readJson('uniwork.wb.pets', [])
}

export function writePets(items: WbPet[]): void {
  writeJson('uniwork.wb.pets', items)
}

export function readPetPhotos(): WbPetPhotoMeta[] {
  return readJson('uniwork.wb.pets.photos', [])
}

export function writePetPhotos(items: WbPetPhotoMeta[]): void {
  writeJson('uniwork.wb.pets.photos', items)
}

export function readPetCare(): WbPetCareItem[] {
  return readJson('uniwork.wb.pets.care', [])
}

export function writePetCare(items: WbPetCareItem[]): void {
  writeJson('uniwork.wb.pets.care', items)
}

/**
 * Resize/compress an image File to a JPEG data URL for on-device storage.
 * Keeps albums usable within browser storage quotas.
 */
export function compressPetImage(file: File, maxEdge = 960, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas_unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      try {
        resolve(canvas.toDataURL('image/jpeg', quality))
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image_load_failed'))
    }
    img.src = url
  })
}

export interface WbTravelCheckItem {
  id: string
  text: string
  done: boolean
}

export interface WbTravelTrip {
  id: string
  title: string
  destination: string
  startDate?: string
  endDate?: string
  status: 'planning' | 'booked' | 'ongoing' | 'done'
  note?: string
  /** Packing / prep checklist */
  checklist: WbTravelCheckItem[]
  /** Free-form itinerary / nhật ký hành trình */
  itinerary?: string
  linkedProjectId?: string
}

export function defaultTravelChecklist(vi: boolean): WbTravelCheckItem[] {
  const texts = vi
    ? [
        'Hộ chiếu / CCCD còn hạn',
        'Vé máy bay / tàu',
        'Khách sạn / chỗ ở',
        'Bảo hiểm du lịch',
        'Đổi tiền / thẻ',
        'Sạc / ổ chuyển',
        'Thuốc / đồ cá nhân',
        'Offline map / eSIM',
      ]
    : [
        'Passport / ID valid',
        'Flights / trains',
        'Hotel / stay',
        'Travel insurance',
        'Cash / cards',
        'Chargers / adapter',
        'Meds / personal items',
        'Offline maps / eSIM',
      ]
  return texts.map((text, i) => ({
    id: `prep-${i}-${Date.now().toString(36)}`,
    text,
    done: false,
  }))
}

export function readTravel(): WbTravelTrip[] {
  return readJson('uniwork.wb.travel', [])
}

export function writeTravel(items: WbTravelTrip[]): void {
  writeJson('uniwork.wb.travel', items)
}

export interface WbClientItem {
  id: string
  name: string
  contact?: string
  phone?: string
  email?: string
  note?: string
}

export interface WbContractItem {
  id: string
  title: string
  party?: string
  startDate?: string
  endDate?: string
  status: 'draft' | 'active' | 'expired' | 'other'
  note?: string
  /** Pack id — first save of Soạn joins this pack's Tài liệu. */
  linkedProjectId?: string
}

export interface WbMatterItem {
  id: string
  title: string
  client?: string
  matterType?: string
  status: 'open' | 'pending' | 'closed'
  nextDate?: string
  note?: string
  /** Pack id — first save of Tóm tắt joins this pack's Tài liệu. */
  linkedProjectId?: string
}

export function readClients(practiceId: PracticeId): WbClientItem[] {
  return readJson(`uniwork.wb.clients.${practiceId}`, [])
}

export function writeClients(practiceId: PracticeId, items: WbClientItem[]): void {
  writeJson(`uniwork.wb.clients.${practiceId}`, items)
}

export function readContracts(practiceId: PracticeId): WbContractItem[] {
  return readJson(`uniwork.wb.contracts.${practiceId}`, [])
}

export function writeContracts(practiceId: PracticeId, items: WbContractItem[]): void {
  writeJson(`uniwork.wb.contracts.${practiceId}`, items)
}

export function readMatters(practiceId: PracticeId): WbMatterItem[] {
  return readJson(`uniwork.wb.matters.${practiceId}`, [])
}

export function writeMatters(practiceId: PracticeId, items: WbMatterItem[]): void {
  writeJson(`uniwork.wb.matters.${practiceId}`, items)
}
