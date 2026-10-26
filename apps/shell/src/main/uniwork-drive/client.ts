import type {
  DriveConnection,
  DriveFileDetail,
  DriveFileListPage,
  DriveFileListQuery,
  DriveFileTarget,
  DriveHistoryEvent,
} from '../../shared/uniwork-drive-api'
import {
  METADATA_TIMEOUT_MS,
  createUniworkSend,
  uniworkId,
  type UniworkDocsClientOptions,
} from '../uniwork-docs/client'
import { UniworkDocError } from '../uniwork-docs/errors'
import {
  parseDriveConnectionList,
  parseDriveFileList,
  parseDriveHistoryList,
  parseDriveStatus,
  parseOneDriveFile,
} from './parse'

/**
 * Main-process client for the UniWork Google Drive routes (UNI-2194, D1).
 * Uses `createUniworkSend` (API origin + `/api/v1` only, no redirects, no
 * cache, bearer token inside `authorized` only). Throws `UniworkDocError`;
 * `wiring.ts` converts it into `UniworkDriveResult`.
 */

export interface UniworkDriveClient {
  listConnections(workspaceId: string): Promise<DriveConnection[]>
  listFiles(query: DriveFileListQuery): Promise<DriveFileListPage>
  getFile(input: DriveFileTarget): Promise<DriveFileDetail>
  unlink(input: DriveFileTarget): Promise<null>
  getHistory(input: DriveFileTarget): Promise<DriveHistoryEvent[]>
}

export const DRIVE_FILES_PAGE_DEFAULT = 50
export const DRIVE_FILES_PAGE_MAX = 100
export const DRIVE_CURSOR_MAX = 512

function refuse(): never {
  throw new UniworkDocError('server_error')
}

function recordArg(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  return value as Record<string, unknown>
}

export function createUniworkDriveClient(options: UniworkDocsClientOptions): UniworkDriveClient {
  const send = createUniworkSend(options)
  const timeoutMs = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const read = (response: Response): Promise<unknown> => response.json()
  const get = (route: string, query?: URLSearchParams) =>
    send({ method: 'GET', route, query, timeoutMs, read })

  return {
    async listConnections(workspaceId) {
      const ws = uniworkId(workspaceId)
      return parseDriveConnectionList(await get(`/workspaces/${ws}/drive-connections`))
    },

    async listFiles(q) {
      const r = recordArg(q)
      const ws = uniworkId(r.workspaceId as string)
      const params = new URLSearchParams()

      if (r.connectionId !== undefined && r.connectionId !== null && r.connectionId !== '') {
        if (typeof r.connectionId !== 'string') refuse()
        uniworkId(r.connectionId)
        params.set('connection_id', r.connectionId)
      }

      if (r.cursor !== undefined && r.cursor !== null && r.cursor !== '') {
        if (typeof r.cursor !== 'string' || r.cursor.length > DRIVE_CURSOR_MAX) refuse()
        params.set('cursor', r.cursor)
      }

      if (r.limit !== undefined && r.limit !== null) {
        if (typeof r.limit !== 'number' || !Number.isFinite(r.limit) || r.limit < 1) refuse()
        const clamped = Math.min(DRIVE_FILES_PAGE_MAX, Math.max(1, Math.trunc(r.limit)))
        params.set('limit', String(clamped))
      } else {
        params.set('limit', String(DRIVE_FILES_PAGE_DEFAULT))
      }

      return parseDriveFileList(await get(`/workspaces/${ws}/drive-files`, params))
    },

    async getFile(input) {
      const r = recordArg(input)
      const ws = uniworkId(r.workspaceId as string)
      const fileId = uniworkId(r.driveFileId as string)
      return parseOneDriveFile(await get(`/workspaces/${ws}/drive-files/${fileId}`))
    },

    async unlink(input) {
      const r = recordArg(input)
      const ws = uniworkId(r.workspaceId as string)
      const fileId = uniworkId(r.driveFileId as string)
      const raw = await send({
        method: 'DELETE',
        route: `/workspaces/${ws}/drive-files/${fileId}`,
        timeoutMs,
        read,
      })
      return parseDriveStatus(raw)
    },

    async getHistory(input) {
      const r = recordArg(input)
      const ws = uniworkId(r.workspaceId as string)
      const fileId = uniworkId(r.driveFileId as string)
      return parseDriveHistoryList(
        await get(`/workspaces/${ws}/resources/drive_file/${fileId}/history`),
      )
    },
  }
}
