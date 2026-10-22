/**
 * What the notices surfaces share (UNI-2079): when to refresh, one request at a time, the unread list
 * the Desk tray reads and the unread count on the Inbox tab. The Inbox pane itself pages and filters
 * the same server list (InboxPane.tsx).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  UniworkWorkError,
  WorkNotification,
  WorkUnreadCount,
} from '../../shared/uniwork-work-api'
import type { UniworkWorkResult } from '../../shared/uniwork-work-api'
import { settleWork } from './work-cache'

/** Dispatched on window after any write to the notices (read, unread, archive, mark all) */
export const NOTICES_CHANGED_EVENT = 'uniwork:notices-changed'
/** how often a visible window asks again, with no push channel to say something changed */
export const NOTICES_REFRESH_MS = 60_000
/** rows the tray and the Inbox page ask for at once */
export const NOTICES_PAGE = 30

/** an IPC call as a result: a rejection, or a bridge without the call, reads as offline */
export const callWork = <T>(call: () => Promise<UniworkWorkResult<T>>) =>
  settleWork((async () => call())())

/** ids per write call: the server takes at most 100 */
export const NOTICES_ID_BATCH = 100

/** a batch of ids as write calls: no id twice, at most NOTICES_ID_BATCH to a call */
export function idBatches(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)]
  const out: string[][] = []
  for (let i = 0; i < unique.length; i += NOTICES_ID_BATCH)
    out.push(unique.slice(i, i + NOTICES_ID_BATCH))
  return out
}

export function notifyNoticesChanged(): void {
  window.dispatchEvent(new Event(NOTICES_CHANGED_EVENT))
}

/**
 * Run `run` now, on window focus, when the window becomes visible, every minute while it is visible
 * and (with `bus`) when another surface changed a notice. `key` restarts it (another workspace);
 * `run` itself may change on every render.
 */
export function useNoticesRefresh(
  run: () => void,
  opts: { key?: string; enabled?: boolean; bus?: boolean } = {},
): void {
  const { key, enabled = true, bus = false } = opts
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (!enabled) return
    const go = () => runRef.current()
    const ifVisible = () => {
      if (document.visibilityState === 'visible') go()
    }
    go()
    window.addEventListener('focus', go)
    document.addEventListener('visibilitychange', ifVisible)
    if (bus) window.addEventListener(NOTICES_CHANGED_EVENT, go)
    const timer = window.setInterval(ifVisible, NOTICES_REFRESH_MS)
    return () => {
      window.removeEventListener('focus', go)
      document.removeEventListener('visibilitychange', ifVisible)
      window.removeEventListener(NOTICES_CHANGED_EVENT, go)
      window.clearInterval(timer)
    }
  }, [key, enabled, bus])
}

/**
 * One request at a time: triggers that arrive while `step` runs collapse into exactly one more run
 * after it, so a burst (focus, visibility, an action) never overlaps requests.
 */
export function createFlight(
  step: () => Promise<void>,
  alive: () => boolean = () => true,
): { trigger: () => void } {
  let busy = false
  let again = false
  return {
    trigger: () => {
      if (!alive()) return
      again = true
      if (busy) return
      busy = true
      void (async () => {
        try {
          while (again && alive()) {
            again = false
            await step()
          }
        } finally {
          busy = false
        }
      })()
    },
  }
}

/** true while the component that asked is mounted (a request that lands later is dropped) */
export function useAlive(): () => boolean {
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  return useCallback(() => alive.current, [])
}

export interface UnreadNotices {
  /** the unread notices of the workspace, newest first; null until the first answer */
  rows: WorkNotification[] | null
  /** the last load's failure (the rows on screen are kept) */
  error: UniworkWorkError | null
  /** a row the caller just marked read leaves the list at once */
  drop: (id: string) => void
  reload: () => void
}

/**
 * The workspace's unread notices (30 newest): the Desk tray's source and, through it, the Today
 * card's count. Refreshed like every notices surface, and after a write anywhere in the app.
 */
export function useUnreadNotices(opts: {
  workspaceId: string | null
  refreshTick?: number
}): UnreadNotices {
  const { workspaceId, refreshTick = 0 } = opts
  const [state, setState] = useState<{
    key: string | null
    rows: WorkNotification[] | null
    error: UniworkWorkError | null
  }>({ key: workspaceId, rows: null, error: null })
  // a drop (or another workspace) outdates a request that is already on its way
  const epoch = useRef(0)
  const keyRef = useRef(workspaceId)
  keyRef.current = workspaceId
  if (state.key !== workspaceId) {
    epoch.current++
    setState({ key: workspaceId, rows: null, error: null })
  }

  const alive = useAlive()
  const flight = useRef<ReturnType<typeof createFlight> | null>(null)
  if (flight.current === null) {
    flight.current = createFlight(async () => {
      const ws = keyRef.current
      if (!ws) return
      const mine = epoch.current
      const result = await callWork(() =>
        window.uniworkWork.listNotifications({
          workspaceId: ws,
          unread: true,
          limit: NOTICES_PAGE,
        }),
      )
      if (!alive() || mine !== epoch.current || ws !== keyRef.current) return
      setState((s) =>
        result.ok
          ? { key: ws, rows: result.value.notifications, error: null }
          : { ...s, error: result.error },
      )
    }, alive)
  }

  useNoticesRefresh(() => flight.current?.trigger(), {
    key: `${workspaceId}:${refreshTick}`,
    enabled: workspaceId !== null,
    bus: true,
  })

  const drop = useCallback((id: string) => {
    epoch.current++
    setState((s) => (s.rows ? { ...s, rows: s.rows.filter((n) => n.id !== id) } : s))
  }, [])
  const reload = useCallback(() => flight.current?.trigger(), [])
  return { rows: state.rows, error: state.error, drop, reload }
}

/**
 * The Inbox tab's badge for one workspace: its entry of by_workspace; with no entry the workspace
 * has none unread when the server lists others, and the total when it lists none at all (organization-level
 * rows count only in the total).
 */
export function inboxBadgeCount(count: WorkUnreadCount, workspaceId: string): number {
  const mine = count.by_workspace[workspaceId]
  if (typeof mine === 'number') return mine
  return Object.keys(count.by_workspace).length === 0 ? count.total : 0
}

/** The unread count of a workspace for the Inbox tab; null before an answer (a failed refresh keeps the last one). */
export function useInboxUnread(workspaceId: string | null): number | null {
  const [state, setState] = useState<{ key: string | null; n: number | null }>({
    key: workspaceId,
    n: null,
  })
  const keyRef = useRef(workspaceId)
  keyRef.current = workspaceId
  if (state.key !== workspaceId) setState({ key: workspaceId, n: null })

  const alive = useAlive()
  const flight = useRef<ReturnType<typeof createFlight> | null>(null)
  if (flight.current === null) {
    flight.current = createFlight(async () => {
      const ws = keyRef.current
      if (!ws) return
      const result = await callWork(() => window.uniworkWork.unreadCount())
      if (!alive() || !result.ok || ws !== keyRef.current) return
      setState({ key: ws, n: inboxBadgeCount(result.value, ws) })
    }, alive)
  }

  useNoticesRefresh(() => flight.current?.trigger(), {
    key: workspaceId ?? '',
    enabled: workspaceId !== null,
    bus: true,
  })
  return state.key === workspaceId ? state.n : null
}
