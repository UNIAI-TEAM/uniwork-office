import { UniworkDocError } from '../uniwork-docs/errors'
import {
  createUniworkSend,
  uniworkId,
  type UniworkDocsClientOptions,
} from '../uniwork-docs/client'

/**
 * R1-R4 of the document edit lock (UNI-1645 EL-1(b)). Uses the same send
 * envelope as the documents client (errors.ts parses 423 / 409 edit_lock_lost).
 */

export interface EditLockTenure {
  lockId: string
  documentId: string
  holderId: string
  client: string
  acquiredAt: string
  expiresAt: string
  heartbeatIntervalMs: number
  ttlMs: number
  serverTime: string
  offlineHoldUntil?: string | null
}

export interface EditLockSummary {
  holderName: string | null
  since: string | null
  expiresAt: string | null
  heldByMe: boolean
  offlineHoldUntil?: string
}

export interface EditLockState {
  lock: EditLockSummary | null
  serverTime: string
}

export interface EditLockHeartbeat {
  lockId: string
  expiresAt: string
  serverTime: string
  offlineHoldUntil?: string | null
}

export interface UniworkEditLockClient {
  getState(documentId: string): Promise<EditLockState>
  acquire(input: {
    documentId: string
    editorId: string
    moveFromSelf?: boolean
  }): Promise<EditLockTenure>
  heartbeat(input: { documentId: string; lockId: string }): Promise<EditLockHeartbeat>
  release(input: { documentId: string; lockId: string }): Promise<void>
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UniworkDocError('malformed_response')
  }
  return value as Record<string, unknown>
}

function str(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new UniworkDocError('malformed_response')
  }
  return value
}

function optStr(value: unknown, max = 256): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : null
}

function posInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function parseTenure(raw: unknown): EditLockTenure {
  const row = record(raw)
  const offline = optStr(row.offline_hold_until, 64)
  return {
    lockId: str(row.lock_id, 128),
    documentId: str(row.document_id, 128),
    holderId: str(row.holder_id, 128),
    client: typeof row.client === 'string' ? row.client : 'desktop',
    acquiredAt: str(row.acquired_at, 64),
    expiresAt: str(row.expires_at, 64),
    heartbeatIntervalMs: posInt(row.heartbeat_interval_ms, 30_000),
    ttlMs: posInt(row.ttl_ms, 120_000),
    serverTime: str(row.server_time, 64),
    ...(offline ? { offlineHoldUntil: offline } : {}),
  }
}

function parseSummary(raw: unknown): EditLockSummary {
  const row = record(raw)
  const offline = optStr(row.offline_hold_until, 64)
  return {
    holderName: optStr(row.holder_name, 256),
    since: optStr(row.since, 64),
    expiresAt: optStr(row.expires_at, 64),
    heldByMe: row.held_by_me === true,
    ...(offline ? { offlineHoldUntil: offline } : {}),
  }
}

function parseState(raw: unknown): EditLockState {
  const row = record(raw)
  return {
    lock: row.lock == null ? null : parseSummary(row.lock),
    serverTime: typeof row.server_time === 'string' ? row.server_time : '',
  }
}

function parseHeartbeat(raw: unknown): EditLockHeartbeat {
  const row = record(raw)
  const offline = optStr(row.offline_hold_until, 64)
  return {
    lockId: str(row.lock_id, 128),
    expiresAt: str(row.expires_at, 64),
    serverTime: typeof row.server_time === 'string' ? row.server_time : '',
    ...(offline ? { offlineHoldUntil: offline } : {}),
  }
}

export function createUniworkEditLockClient(
  options: UniworkDocsClientOptions,
): UniworkEditLockClient {
  const send = createUniworkSend(options)
  const timeoutMs = options.metadataTimeoutMs ?? 30_000
  const json = (response: Response): Promise<unknown> => response.json()
  const id = uniworkId

  return {
    async getState(documentId) {
      const raw = await send({
        method: 'GET',
        route: `/documents/${id(documentId)}/edit-lock`,
        timeoutMs,
        read: json,
      })
      return parseState(raw)
    },

    async acquire(input) {
      const raw = await send({
        method: 'POST',
        route: `/documents/${id(input.documentId)}/edit-lock`,
        json: {
          editor_id: input.editorId,
          client: 'desktop',
          ...(input.moveFromSelf ? { move_from_self: true } : {}),
        },
        timeoutMs,
        read: json,
      })
      return parseTenure(raw)
    },

    async heartbeat(input) {
      const raw = await send({
        method: 'POST',
        route: `/documents/${id(input.documentId)}/edit-lock/${id(input.lockId)}/heartbeat`,
        timeoutMs,
        read: json,
      })
      return parseHeartbeat(raw)
    },

    async release(input) {
      await send({
        method: 'DELETE',
        route: `/documents/${id(input.documentId)}/edit-lock/${id(input.lockId)}`,
        timeoutMs,
        read: async () => undefined,
      })
    },
  }
}
