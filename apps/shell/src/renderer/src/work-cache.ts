/**
 * Shared data layer of the Workbench server tabs (Overview, Tasks, Calendar,
 * Profile): the last server answer per key, kept in memory for this window
 * under the current Workbench bucket (deployment + account + org), and one
 * loader hook with the refresh rules of spec §5.5 and the states of §7.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type {
  UniworkWorkError,
  UniworkWorkResult,
  WorkCalendarEvent,
  WorkTask,
  WorkTaskStatus,
} from '../../shared/uniwork-work-api'
import {
  pickActiveWorkspace,
  readActiveWorkspaceId,
  type WorkspaceListState,
} from './active-workspace'
import { agendaRange, groupAgenda } from './work-calendar'
import { closedStatusKeys, localIsoDate } from './work-tasks'
import { currentWorkbenchBucket, isWorkbenchBucketCleared } from './workbench-bucket'

/** Dispatched on window by the Workbench Refresh button; the server tabs reload on it. */
export const WB_REFRESH_EVENT = 'uniwork:wb-refresh'

const entries = new Map<string, { value: unknown; at: number }>()

/**
 * Where an answer for `key` belongs: take it BEFORE the call, so a late answer
 * lands in the bucket it was asked from. Null while no bucket is loaded.
 */
export function workCacheSlot(key: string): string | null {
  return isWorkbenchBucketCleared() ? null : `${currentWorkbenchBucket()}\n${key}`
}

export function cacheWork(slot: string | null, value: unknown): void {
  // between an account change and the next bucket load nothing is kept
  if (slot === null || isWorkbenchBucketCleared()) return
  entries.set(slot, { value, at: Date.now() })
}

/** the last answer for `key` in the current bucket; null when never loaded (never [] or 0) */
export function cachedWork<T>(key: string): { value: T; at: number } | null {
  const slot = workCacheSlot(key)
  const hit = slot === null ? undefined : entries.get(slot)
  return (hit as { value: T; at: number } | undefined) ?? null
}

/** a rejected IPC call reads as offline (the preload already maps malformed replies) */
export async function settleWork<T>(
  call: Promise<UniworkWorkResult<T>>,
): Promise<UniworkWorkResult<T>> {
  try {
    return await call
  } catch {
    return { ok: false, error: 'offline' }
  }
}

export interface WorkLoad<T> {
  /** the answer on screen (the cached one at first); null until one exists */
  value: T | null
  /** when `value` was loaded (ms); null before any answer */
  updatedAt: number | null
  /** error of the last reload; the value on screen is kept */
  error: UniworkWorkError | null
  /** a kept value after an offline or server failure: show "Updated at HH:mm" */
  stale: boolean
  reload: () => void
  /** optimistic edit of the value on screen; the cache keeps server truth */
  update: (edit: (value: T) => T) => void
}

interface LoadState<T> {
  key: string | null
  value: T | null
  updatedAt: number | null
  error: UniworkWorkError | null
}

function fromCache<T>(key: string | null): LoadState<T> {
  const hit = key ? cachedWork<T>(key) : null
  return { key, value: hit?.value ?? null, updatedAt: hit?.at ?? null, error: null }
}

/**
 * Load `key` with `fetch`: on mount and key change, on window focus, on Refresh,
 * and every `intervalMs` while the window is visible. A caller that passes
 * `refreshTick` gets Refresh through it instead of WB_REFRESH_EVENT, because
 * PracticeHome bumps the tick in the same click that fires the event. A late
 * answer for an older key never lands, and a failure keeps the value on screen.
 */
export function useWorkLoad<T>(
  key: string | null,
  fetch: () => Promise<UniworkWorkResult<T>>,
  opts: { refreshTick?: number; intervalMs?: number } = {},
): WorkLoad<T> {
  const { refreshTick, intervalMs } = opts
  const tickDriven = refreshTick !== undefined
  const [state, setState] = useState<LoadState<T>>(() => fromCache<T>(key))
  const fetchRef = useRef(fetch)
  fetchRef.current = fetch
  const seq = useRef(0)

  // a new key starts from its own cache, never from the previous key's rows
  if (state.key !== key) setState(fromCache<T>(key))

  const reload = useCallback(() => {
    const mine = ++seq.current
    if (!key) return
    const slot = workCacheSlot(key)
    void settleWork(fetchRef.current()).then((result) => {
      if (mine !== seq.current) return // a newer load, another key, or unmounted
      if (result.ok) {
        cacheWork(slot, result.value)
        setState({ key, value: result.value, updatedAt: Date.now(), error: null })
      } else {
        setState((s) => ({ ...s, error: result.error }))
      }
    })
  }, [key])

  useEffect(() => {
    reload()
  }, [reload, refreshTick])

  useEffect(() => {
    const onRefresh = () => reload()
    window.addEventListener('focus', onRefresh)
    if (!tickDriven) window.addEventListener(WB_REFRESH_EVENT, onRefresh)
    const timer = intervalMs
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') reload()
        }, intervalMs)
      : undefined
    return () => {
      window.removeEventListener('focus', onRefresh)
      window.removeEventListener(WB_REFRESH_EVENT, onRefresh)
      window.clearInterval(timer)
      seq.current++ // re-keyed or unmounted: an answer still on its way is dropped
    }
  }, [reload, intervalMs, tickDriven])

  const update = useCallback((edit: (value: T) => T) => {
    setState((s) => (s.value === null ? s : { ...s, value: edit(s.value) }))
  }, [])

  const stale = state.value !== null && (state.error === 'offline' || state.error === 'server')
  return {
    value: state.value,
    updatedAt: state.updatedAt,
    error: state.error,
    stale,
    reload,
    update,
  }
}

/**
 * The Workbench's starting list: PracticeHome remounts on every return to the
 * Workbench, so it starts from the cached list (null = loading when none) and an
 * offline re-entry keeps showing the cached tabs instead of the error state.
 */
export function cachedWorkspaceListState(): WorkspaceListState {
  const listed = cachedWork<UniworkWorkspaceRef[]>('workspaces')
  return {
    workspaces: listed?.value ?? null,
    workspaceId: listed ? pickActiveWorkspace(listed.value, readActiveWorkspaceId()) : null,
    workspaceError: null,
  }
}

/** The workspace My AI reads, as agentWorkspaceId picks it: the stored one while listed, else the first listed. */
function cachedActiveWorkspaceId(): string | null {
  const listed = cachedWork<UniworkWorkspaceRef[]>('workspaces')?.value
  const stored = readActiveWorkspaceId()
  return listed ? pickActiveWorkspace(listed, stored) : stored
}

/** Open tasks of that workspace from the last load (My AI grounding); null when they were never loaded. */
export function cachedOpenTasks(): WorkTask[] | null {
  const ws = cachedActiveWorkspaceId()
  const tasks = ws ? cachedWork<WorkTask[]>(`tasks:${ws}`)?.value : undefined
  if (!tasks) return null
  const closed = closedStatusKeys(cachedWork<WorkTaskStatus[]>(`taskStatuses:${ws}`)?.value ?? [])
  return tasks.filter((x) => !closed.has(x.status))
}

/** The agenda My AI reads, as the Calendar tab shows it (day + title); null when it was never loaded. */
export function cachedAgendaItems(): { date: string; title: string }[] | null {
  const ws = cachedActiveWorkspaceId()
  const events = ws ? cachedWork<WorkCalendarEvent[]>(`calendar:${ws}`)?.value : undefined
  if (!events) return null
  const { from, to } = agendaRange(localIsoDate(new Date()))
  return groupAgenda(events, from, to).flatMap((d) =>
    d.events.map((e) => ({ date: d.day, title: e.title })),
  )
}
