import type { IpcMain } from 'electron'
import {
  UNIWORK_WORK_CHANNELS,
  workErrorOfDocCode,
  type UniworkWorkResult,
  type WorkCreateTaskInput,
} from '../../shared/uniwork-work-api'
import type { DeploymentProfile } from '../uniwork-auth/deployment'
import type { FetchLike } from '../uniwork-docs/client'
import { UniworkDocError } from '../uniwork-docs/errors'
import { createUniworkWorkClient, type UniworkWorkClient } from './client'

/**
 * IPC for window.uniworkWork. Every handler answers a UniworkWorkResult (or a
 * boolean for openWeb) and never throws; the token stays in main. Free of
 * Electron at runtime: index.ts passes the auth module and shell.openExternal.
 */

export interface UniworkWorkDeps {
  profile(): DeploymentProfile | null
  identity(): { accountId: string } | null
  org(): { id: string; slug: string } | null
  authorized<T>(call: (token: string) => Promise<T>): Promise<T>
  openExternal(url: string): Promise<void>
  fetch?: FetchLike
}

const SLUG = /^[A-Za-z0-9_-]{1,128}$/

/** the web path of a renderer target (uniwork:packages/core/paths/paths.ts), or null */
function webPathOf(target: unknown): string | null {
  if (!target || typeof target !== 'object') return null
  const t = target as Record<string, unknown>
  if (t.kind === 'onboarding') return '/onboarding'
  const ok = (value: unknown): value is string => typeof value === 'string' && SLUG.test(value)
  if (!ok(t.orgSlug) || !ok(t.wsSlug)) return null
  const base = `/${t.orgSlug}/${t.wsSlug}`
  switch (t.kind) {
    case 'my-tasks':
    case 'calendar':
    case 'inbox':
    case 'tasks':
      return `${base}/${t.kind}`
  }
  if (!ok(t.id)) return null
  switch (t.kind) {
    case 'task':
      return `${base}/tasks/${t.id}`
    case 'meeting':
      return `${base}/meetings/${t.id}`
    case 'room':
      return `${base}/meetings/${t.id}/room`
    case 'person':
      return `${base}/people/${t.id}`
    case 'document':
      return `${base}/documents/${t.id}`
    default:
      return null
  }
}

/** Registers the uniwork-work:* handlers. Main-process code: rebuild the shell after a change. */
export function registerUniworkWork(ipcMain: IpcMain, deps: UniworkWorkDeps): void {
  let cached: { origin: string; client: UniworkWorkClient } | null = null
  /** the client for the current profile origin (rebuilt when the origin changes) */
  const api = (): UniworkWorkClient => {
    const profile = deps.profile()
    if (!profile) throw new UniworkDocError('not_signed_in')
    if (cached?.origin !== profile.apiOrigin) {
      cached = {
        origin: profile.apiOrigin,
        client: createUniworkWorkClient({
          apiOrigin: profile.apiOrigin,
          authorized: (call) => deps.authorized(call),
          isSignedIn: () => deps.identity() !== null,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
        }),
      }
    }
    return cached.client
  }
  const handle = <T>(channel: string, run: (...args: unknown[]) => Promise<T>): void => {
    ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<UniworkWorkResult<T>> => {
      try {
        return { ok: true, value: await run(...args) }
      } catch (error) {
        const code = error instanceof UniworkDocError ? error.code : 'server_error'
        return { ok: false, error: workErrorOfDocCode(code) }
      }
    })
  }
  // ids from the renderer: anything but a string fails the client's id check
  const str = (value: unknown): string => (typeof value === 'string' ? value : '')
  const C = UNIWORK_WORK_CHANNELS

  handle(C.homeSummary, (ws) => api().homeSummary(str(ws)))
  handle(C.myTasks, (ws) => api().myTasks(str(ws)))
  handle(C.taskStatuses, (ws) => api().taskStatuses(str(ws)))
  handle(C.setTaskStatus, (taskId, status) => api().setTaskStatus(str(taskId), str(status)))
  handle(C.markNotificationsRead, (ids) =>
    api().markNotificationsRead(Array.isArray(ids) ? ids.map(str) : []),
  )
  handle(C.createTask, (input) => api().createTask(input as WorkCreateTaskInput))
  handle(C.calendarEvents, (input) =>
    api().calendarEvents(input as { workspaceId: string; from: string; to: string }),
  )
  handle(C.myProfile, async () => {
    const who = deps.identity()
    if (!who) throw new UniworkDocError('not_signed_in')
    const org = deps.org()
    // signed in, but no org selected yet: there is no directory to read
    if (!org?.slug) throw new UniworkDocError('server_error')
    return api().person(org.slug, who.accountId)
  })
  /** the full URL of a renderer target, or null (no profile, a bad target, an unparsable origin) */
  const webUrlOf = (target: unknown): string | null => {
    const profile = deps.profile()
    const path = webPathOf(target)
    if (!profile || !path) return null
    try {
      // shortcut: web origin = API origin (true on the prod edge); dev web runs elsewhere. Upgrade when the server exposes a web origin (C6).
      return `${new URL(profile.apiOrigin).origin}${path}`
    } catch {
      return null
    }
  }
  ipcMain.handle(C.openWeb, async (_event, target: unknown): Promise<boolean> => {
    const url = webUrlOf(target)
    if (!url) return false
    try {
      await deps.openExternal(url)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle(C.webUrl, (_event, target: unknown): string | null => webUrlOf(target))
}
