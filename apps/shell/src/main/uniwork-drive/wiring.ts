import type { IpcMain } from 'electron'
import {
  UNIWORK_DRIVE_CHANNELS,
  driveErrorOfDocError,
  type DriveFileListQuery,
  type DriveFileTarget,
  type UniworkDriveResult,
} from '../../shared/uniwork-drive-api'
import type { DeploymentProfile } from '../uniwork-auth/deployment'
import type { FetchLike } from '../uniwork-docs/client'
import { UniworkDocError } from '../uniwork-docs/errors'
import type { CapabilityRead } from '../uniwork-sync/capability/cache'
import { createUniworkDriveClient, type UniworkDriveClient } from './client'

/**
 * IPC for `window.uniworkDrive` (and `window.aiOffice.uniworkDrive*`).
 * Every handler answers a `UniworkDriveResult` and never throws; the UniWork
 * session token stays in main. `open-on-google` fetches `open_url` from the
 * server in main, verifies `https:` on `docs.google.com` or `drive.google.com`
 * with no userinfo or port, and calls `openExternal`.
 */

export interface UniworkDriveDeps {
  profile(): DeploymentProfile | null
  identity(): { accountId: string } | null
  org(): { id: string; slug: string } | null
  authorized<T>(call: (token: string) => Promise<T>): Promise<T>
  openExternal(url: string): Promise<void>
  capability(orgId: string): Promise<CapabilityRead>
  /** workspace member names (userId → display name); the activity rows take the actor name from it */
  memberNames?(workspaceId: string): Promise<ReadonlyMap<string, string>>
  fetch?: FetchLike
}

const SLUG = /^[A-Za-z0-9_-]{1,128}$/
const ALLOWED_GOOGLE_HOSTS: Record<string, true> = {
  'docs.google.com': true,
  'drive.google.com': true,
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && SLUG.test(value)
}

function checkTarget(input: unknown): DriveFileTarget {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new UniworkDocError('server_error')
  }
  const { workspaceId, driveFileId } = input as Record<string, unknown>
  if (!isValidId(workspaceId) || !isValidId(driveFileId)) {
    throw new UniworkDocError('server_error')
  }
  return { workspaceId, driveFileId }
}

/**
 * Validates that `rawUrl` is a well-formed `https:` URL whose host is
 * `docs.google.com` or `drive.google.com`, with no userinfo (`username` or
 * `password`), no explicit port (`parsed.port === ''`), and no IP/lookalike
 * tricks (`parsed.host === parsed.hostname`). Returns the canonical URL string
 * or `null` when refused.
 */
export function safeGoogleDriveOpenUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null
  // Reject raw userinfo, explicit ports, or backslash tricks before WHATWG normalization
  const authorityMatch = /^https:\/\/([^/?#]*)/i.exec(trimmed)
  if (!authorityMatch) return null
  const rawAuthority = authorityMatch[1] ?? ''
  if (!ALLOWED_GOOGLE_HOSTS[rawAuthority.toLowerCase()]) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.username !== '' || parsed.password !== '') return null
  if (parsed.port !== '') return null
  const hostname = parsed.hostname.toLowerCase()
  if (parsed.host.toLowerCase() !== hostname) return null
  if (!ALLOWED_GOOGLE_HOSTS[hostname]) return null
  return parsed.toString()
}

/** Registers the `uniwork-drive:*` IPC handlers. Rebuild the shell after changing main code. */
export function registerUniworkDrive(ipcMain: IpcMain, deps: UniworkDriveDeps): void {
  let cached: { origin: string; client: UniworkDriveClient } | null = null

  const api = (): UniworkDriveClient => {
    const profile = deps.profile()
    if (!profile) throw new UniworkDocError('not_signed_in')
    if (cached?.origin !== profile.apiOrigin) {
      cached = {
        origin: profile.apiOrigin,
        client: createUniworkDriveClient({
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
    ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<UniworkDriveResult<T>> => {
      try {
        return { ok: true, value: await run(...args) }
      } catch (error) {
        if (error instanceof UniworkDocError) {
          return {
            ok: false,
            error: driveErrorOfDocError(error.code, error.serverCode),
          }
        }
        return { ok: false, error: 'server_error' }
      }
    })
  }

  const C = UNIWORK_DRIVE_CHANNELS

  ipcMain.handle(C.isAvailable, async (): Promise<boolean> => {
    try {
      if (!deps.profile() || !deps.identity()) return false
      const org = deps.org()
      if (!org || !org.id) return false
      const cap = await deps.capability(org.id)
      return cap.capabilities.drive_connector === true
    } catch {
      return false
    }
  })

  handle(C.listConnections, async (workspaceId) => {
    if (!isValidId(workspaceId)) throw new UniworkDocError('server_error')
    return api().listConnections(workspaceId)
  })

  handle(C.listFiles, async (query) => {
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
      throw new UniworkDocError('server_error')
    }
    const q = query as Record<string, unknown>
    if (!isValidId(q.workspaceId)) throw new UniworkDocError('server_error')
    if (q.connectionId !== undefined && q.connectionId !== null && q.connectionId !== '') {
      if (!isValidId(q.connectionId)) throw new UniworkDocError('server_error')
    }
    if (q.cursor !== undefined && q.cursor !== null && typeof q.cursor !== 'string') {
      throw new UniworkDocError('server_error')
    }
    if (q.limit !== undefined && q.limit !== null && typeof q.limit !== 'number') {
      throw new UniworkDocError('server_error')
    }
    return api().listFiles(query as DriveFileListQuery)
  })

  handle(C.getFile, async (input) => api().getFile(checkTarget(input)))

  handle(C.unlink, async (input) => api().unlink(checkTarget(input)))

  handle(C.openOnGoogle, async (input) => {
    const target = checkTarget(input)
    const file = await api().getFile(target)
    const safeUrl = safeGoogleDriveOpenUrl(file.openUrl)
    if (!safeUrl) throw new UniworkDocError('server_error')
    try {
      await deps.openExternal(safeUrl)
    } catch {
      throw new UniworkDocError('server_error')
    }
    return null
  })

  handle(C.getHistory, async (input) => {
    const target = checkTarget(input)
    // the member lookup starts with the history read; its failure must not fail the call: the rows just stay unnamed
    const lookup = Promise.resolve(deps.memberNames?.(target.workspaceId)).catch(() => undefined)
    const events = await api().getHistory(target)
    const names = await lookup
    if (!names || names.size === 0) return events
    return events.map((event) => {
      // only a person is looked up; an agent/system actor id is never shown as a member
      const isPerson =
        event.actorKind === '' || event.actorKind === 'human' || event.actorKind === 'user'
      const actorName = isPerson ? names.get(event.actorId)?.trim() : undefined
      return actorName ? { ...event, actorName } : event
    })
  })
}
