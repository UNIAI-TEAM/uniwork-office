/**
 * Opt-in desktop notifications for Workbench due items (tasks / calendar today).
 */
import type { PracticeId } from '@uniwork/practice-core'
import { readCalendar, readTasks } from './workbench-pins'
import { wbStoreGetRaw, wbStoreSetRaw } from './workbench-store-client'

const PREF_KEY = 'uniwork.wb.reminders.enabled'
const FIRED_KEY = 'uniwork.wb.reminders.fired.v1'
const CHECK_MS = 60_000

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function remindersEnabled(): boolean {
  return wbStoreGetRaw(PREF_KEY) === '1'
}

export function setRemindersEnabled(on: boolean): void {
  wbStoreSetRaw(PREF_KEY, on ? '1' : '0')
}

function firedSet(): Set<string> {
  try {
    const raw = wbStoreGetRaw(FIRED_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function markFired(key: string): void {
  const set = firedSet()
  set.add(key)
  wbStoreSetRaw(FIRED_KEY, JSON.stringify([...set].slice(-200)))
}

export async function requestReminderPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const res = await Notification.requestPermission()
  return res === 'granted'
}

export function checkWorkbenchReminders(practiceId: PracticeId): void {
  if (!remindersEnabled()) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const day = todayIso()
  const fired = firedSet()

  for (const t of readTasks(practiceId)) {
    if (t.done || t.status === 'done') continue
    const due = t.dueDate?.slice(0, 10)
    if (!due || due > day) continue
    const key = `task:${practiceId}:${t.id}:${due}`
    if (fired.has(key)) continue
    new Notification('UniWork · Task due', { body: t.title, tag: key })
    markFired(key)
  }

  for (const c of readCalendar(practiceId)) {
    if (c.date !== day) continue
    const key = `cal:${practiceId}:${c.id}:${c.date}`
    if (fired.has(key)) continue
    new Notification('UniWork · Calendar today', { body: c.title, tag: key })
    markFired(key)
  }
}

/** Start polling; returns stop function. */
export function startWorkbenchReminderLoop(getPracticeId: () => PracticeId | null): () => void {
  const tick = () => {
    const id = getPracticeId()
    if (id) checkWorkbenchReminders(id)
  }
  tick()
  const handle = window.setInterval(tick, CHECK_MS)
  return () => window.clearInterval(handle)
}
