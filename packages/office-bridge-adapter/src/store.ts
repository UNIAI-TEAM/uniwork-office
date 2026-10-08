import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  LAUNCH_TOKEN_TTL_MS,
  LIVE_OFFICE_PATHS,
  OFFICE_MIME_BY_EXT,
  OFFICE_SESSION_CREDENTIAL_TTL_MS,
  SUPPORTED_OFFICE_EXTENSIONS,
  type OfficeAuditEvent,
  type OfficeOutboxEvent,
  type OfficePermission,
  type OfficeSessionStatus,
  type SupportedOfficeExtension,
} from '@uniwork/office-bridge-contracts'
import type {
  OfficeLaunchExchangeResponse,
  OfficeSaveCompleteResponse,
  OfficeSavePrepareResponse,
  OfficeSessionCreateResponse,
} from '@uniwork/office-bridge-contracts'

export class AdapterError extends Error {
  readonly status: number
  readonly code: string
  readonly extra?: Record<string, unknown>

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.name = 'AdapterError'
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export interface Membership {
  userId: string
  tenantId: string
  workspaceId: string
}

export interface WorkProductRecord {
  id: string
  tenantId: string
  workspaceId: string
  title: string
  fileName: string
  extension: SupportedOfficeExtension
  deleted: boolean
  latestVersionId: string
  latestVersionNumber: number
}

export interface VersionRecord {
  id: string
  workProductId: string
  versionNumber: number
  checksumSha256: string
  size: number
  bytes: Uint8Array
  createdAt: string
}

export interface OfficeSessionRecord {
  id: string
  tenantId: string
  workspaceId: string
  userId: string
  workProductId: string
  workProductVersionId: string
  fileId: string
  launchTokenHash: string | null
  sessionCredentialHash: string | null
  status: OfficeSessionStatus
  expiresAt: number
  credentialExpiresAt: number | null
  createdAt: number
  openedAt: number | null
  closedAt: number | null
  rowVersion: number
  permissions: OfficePermission[]
}

interface PendingUpload {
  saveOperationId: string
  idempotencyKey: string
  sessionId: string
  baseVersion: number
  uploadTokenHash: string
  bytes: Uint8Array | null
  expiresAt: number
}

interface CompletedSave {
  saveOperationId: string
  idempotencyKey: string
  result: OfficeSaveCompleteResponse
}

export interface AuditRecord {
  type: OfficeAuditEvent
  at: string
  actorUserId?: string
  tenantId?: string
  sessionId?: string
  workProductId?: string
  versionId?: string
}

export interface OutboxRecord {
  type: OfficeOutboxEvent
  at: string
  workProductId: string
  versionId: string
  versionNumber: number
}

export interface AdapterMetrics {
  session_create_count: number
  session_exchange_success: number
  session_exchange_failure: number
  download_success: number
  download_failure: number
  save_success: number
  save_failure: number
  version_conflict_count: number
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function token(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`
}

function isSupportedExt(ext: string): ext is SupportedOfficeExtension {
  return (SUPPORTED_OFFICE_EXTENSIONS as readonly string[]).includes(ext)
}

export function createOfficeBridgeStore(now: () => number = () => Date.now()) {
  const memberships: Membership[] = []
  const users = new Map<string, { id: string; token: string }>()
  const workProducts = new Map<string, WorkProductRecord>()
  const versions = new Map<string, VersionRecord>()
  const sessions = new Map<string, OfficeSessionRecord>()
  const pendingUploads = new Map<string, PendingUpload>()
  const pendingByIdempotency = new Map<string, string>()
  const completedSaves = new Map<string, CompletedSave>()
  const completedByIdempotency = new Map<string, string>()
  const audit: AuditRecord[] = []
  const outbox: OutboxRecord[] = []
  const metrics: AdapterMetrics = {
    session_create_count: 0,
    session_exchange_success: 0,
    session_exchange_failure: 0,
    download_success: 0,
    download_failure: 0,
    save_success: 0,
    save_failure: 0,
    version_conflict_count: 0,
  }

  function emitAudit(event: AuditRecord): void {
    audit.push(event)
  }

  function userFromBearer(header: string | undefined): { id: string } {
    if (!header?.startsWith('Bearer ')) {
      throw new AdapterError(401, 'UNAUTHENTICATED', 'missing user credential')
    }
    const raw = header.slice('Bearer '.length).trim()
    for (const user of users.values()) {
      if (user.token === raw) return { id: user.id }
    }
    throw new AdapterError(401, 'UNAUTHENTICATED', 'invalid user credential')
  }

  function sessionFromBearer(header: string | undefined): OfficeSessionRecord {
    if (!header?.startsWith('Bearer ')) {
      throw new AdapterError(401, 'UNAUTHENTICATED', 'missing office credential')
    }
    const raw = header.slice('Bearer '.length).trim()
    const hash = sha256Hex(raw)
    for (const session of sessions.values()) {
      if (session.sessionCredentialHash === hash) {
        if (session.status === 'REVOKED') {
          throw new AdapterError(403, 'SESSION_REVOKED', 'session revoked')
        }
        if ((session.credentialExpiresAt ?? 0) < now() || session.expiresAt < now()) {
          session.status = 'EXPIRED'
          throw new AdapterError(401, 'EXPIRED', 'session expired')
        }
        return session
      }
    }
    throw new AdapterError(401, 'UNAUTHENTICATED', 'invalid office credential')
  }

  function assertMembership(userId: string, tenantId: string, workspaceId: string): void {
    const ok = memberships.some(
      (m) => m.userId === userId && m.tenantId === tenantId && m.workspaceId === workspaceId,
    )
    if (!ok) throw new AdapterError(404, 'NOT_FOUND', 'not found')
  }

  function liveEndpoints(): OfficeLaunchExchangeResponse['endpoints'] {
    return {
      download: LIVE_OFFICE_PATHS.download,
      savePrepare: LIVE_OFFICE_PATHS.savePrepare,
      saveComplete: LIVE_OFFICE_PATHS.saveComplete,
    }
  }

  function documentFor(session: OfficeSessionRecord): OfficeLaunchExchangeResponse['document'] {
    const wp = workProducts.get(session.workProductId)
    if (!wp) throw new AdapterError(404, 'NOT_FOUND', 'not found')
    return {
      id: wp.id,
      title: wp.title,
      fileName: wp.fileName,
      mimeType: OFFICE_MIME_BY_EXT[wp.extension],
      baseVersion: wp.latestVersionNumber,
    }
  }

  function prepareResponse(pending: PendingUpload, uploadToken: string, wp: WorkProductRecord): OfficeSavePrepareResponse {
    return {
      saveOperationId: pending.saveOperationId,
      baseVersion: wp.latestVersionNumber,
      nextVersion: wp.latestVersionNumber + 1,
      upload: {
        url: '/api/office/upload',
        token: uploadToken,
        method: 'PUT',
      },
    }
  }

  return {
    now,
    audit,
    outbox,
    metrics,
    addUser(id: string): { id: string; token: string } {
      const user = { id, token: token('ut_') }
      users.set(id, user)
      return user
    },
    addMembership(row: Membership): void {
      memberships.push(row)
    },
    removeMembership(userId: string, workspaceId: string): void {
      const idx = memberships.findIndex((m) => m.userId === userId && m.workspaceId === workspaceId)
      if (idx >= 0) memberships.splice(idx, 1)
    },
    addWorkProduct(opts: {
      tenantId: string
      workspaceId: string
      title: string
      fileName: string
      bytes: Uint8Array
    }): WorkProductRecord {
      const ext = opts.fileName.split('.').pop()?.toLowerCase() ?? ''
      if (!isSupportedExt(ext)) {
        throw new AdapterError(400, 'UNSUPPORTED_FORMAT', 'unsupported format')
      }
      const versionId = randomUUID()
      const wpId = randomUUID()
      const checksumSha256 = sha256Hex(opts.bytes)
      versions.set(versionId, {
        id: versionId,
        workProductId: wpId,
        versionNumber: 1,
        checksumSha256,
        size: opts.bytes.byteLength,
        bytes: opts.bytes,
        createdAt: new Date(now()).toISOString(),
      })
      const wp: WorkProductRecord = {
        id: wpId,
        tenantId: opts.tenantId,
        workspaceId: opts.workspaceId,
        title: opts.title,
        fileName: opts.fileName,
        extension: ext,
        deleted: false,
        latestVersionId: versionId,
        latestVersionNumber: 1,
      }
      workProducts.set(wpId, wp)
      return wp
    },
    getWorkProduct(id: string): WorkProductRecord | undefined {
      return workProducts.get(id)
    },
    getVersion(id: string): VersionRecord | undefined {
      return versions.get(id)
    },
    revokeSession(id: string): void {
      const session = sessions.get(id)
      if (session) session.status = 'REVOKED'
    },
    expireLaunch(id: string): void {
      const session = sessions.get(id)
      if (session) session.expiresAt = now() - 1
    },
    listVersions(workProductId: string): VersionRecord[] {
      return [...versions.values()]
        .filter((v) => v.workProductId === workProductId)
        .sort((a, b) => a.versionNumber - b.versionNumber)
    },

    createSession(authHeader: string | undefined, documentId: string): OfficeSessionCreateResponse {
      const user = userFromBearer(authHeader)
      const wp = workProducts.get(documentId)
      if (!wp || wp.deleted) throw new AdapterError(404, 'NOT_FOUND', 'not found')
      assertMembership(user.id, wp.tenantId, wp.workspaceId)
      if (!isSupportedExt(wp.extension)) {
        throw new AdapterError(400, 'UNSUPPORTED_FORMAT', 'unsupported format')
      }
      const launchToken = token('olt_')
      const sessionId = randomUUID()
      const expiresAt = now() + LAUNCH_TOKEN_TTL_MS
      sessions.set(sessionId, {
        id: sessionId,
        tenantId: wp.tenantId,
        workspaceId: wp.workspaceId,
        userId: user.id,
        workProductId: wp.id,
        workProductVersionId: wp.latestVersionId,
        fileId: wp.latestVersionId,
        launchTokenHash: sha256Hex(launchToken),
        sessionCredentialHash: null,
        status: 'CREATED',
        expiresAt,
        credentialExpiresAt: null,
        createdAt: now(),
        openedAt: null,
        closedAt: null,
        rowVersion: 1,
        permissions: ['READ', 'SAVE_NEW_VERSION'],
      })
      metrics.session_create_count += 1
      emitAudit({
        type: 'OFFICE_SESSION_CREATED',
        at: new Date(now()).toISOString(),
        actorUserId: user.id,
        tenantId: wp.tenantId,
        sessionId,
        workProductId: wp.id,
      })
      return {
        sessionId,
        launchUrl: `uniwork://office/open?token=${launchToken}`,
        expiresAt: new Date(expiresAt).toISOString(),
        baseVersion: wp.latestVersionNumber,
        fileName: wp.fileName,
        format: wp.extension,
      }
    },

    exchange(launchToken: string): OfficeLaunchExchangeResponse {
      try {
        if (!launchToken || launchToken.length < 16) {
          throw new AdapterError(400, 'INVALID_REQUEST', 'invalid token')
        }
        const hash = sha256Hex(launchToken)
        const session = [...sessions.values()].find((s) => s.launchTokenHash === hash)
        if (!session) throw new AdapterError(401, 'UNAUTHENTICATED', 'invalid token')
        if (session.status === 'REVOKED') throw new AdapterError(403, 'SESSION_REVOKED', 'session revoked')
        if (session.expiresAt < now()) {
          session.status = 'EXPIRED'
          throw new AdapterError(401, 'EXPIRED', 'expired')
        }
        if (session.status !== 'CREATED') {
          throw new AdapterError(401, 'TOKEN_REPLAY', 'token already used')
        }
        const wp = workProducts.get(session.workProductId)
        if (!wp || wp.deleted) throw new AdapterError(404, 'NOT_FOUND', 'not found')
        assertMembership(session.userId, session.tenantId, session.workspaceId)
        const sessionToken = token('ost_')
        session.sessionCredentialHash = sha256Hex(sessionToken)
        session.status = 'EXCHANGED'
        session.credentialExpiresAt = now() + OFFICE_SESSION_CREDENTIAL_TTL_MS
        session.rowVersion += 1
        metrics.session_exchange_success += 1
        const document = documentFor(session)
        return {
          sessionId: session.id,
          sessionToken,
          expiresAt: new Date(session.credentialExpiresAt).toISOString(),
          document,
          endpoints: liveEndpoints(),
          descriptor: {
            sessionId: session.id,
            workProductId: wp.id,
            workProductTitle: wp.title,
            versionId: '',
            versionNumber: document.baseVersion,
            fileName: wp.fileName,
            mimeType: document.mimeType,
            extension: wp.extension,
            size: versions.get(wp.latestVersionId)?.size ?? 0,
            checksumSha256: '',
            readOnly: wp.extension === 'pdf',
            canDownload: true,
            canSaveNewVersion: wp.extension !== 'pdf',
          },
        }
      } catch (err) {
        metrics.session_exchange_failure += 1
        throw err
      }
    },

    download(authHeader: string | undefined): { bytes: Uint8Array; mimeType: string } {
      try {
        const session = sessionFromBearer(authHeader)
        assertMembership(session.userId, session.tenantId, session.workspaceId)
        const wp = workProducts.get(session.workProductId)
        const ver = versions.get(session.workProductVersionId)
        if (!wp || !ver) throw new AdapterError(404, 'NOT_FOUND', 'not found')
        session.status = 'OPEN'
        session.openedAt = now()
        metrics.download_success += 1
        emitAudit({
          type: 'OFFICE_DOCUMENT_OPENED',
          at: new Date(now()).toISOString(),
          actorUserId: session.userId,
          tenantId: session.tenantId,
          sessionId: session.id,
          workProductId: wp.id,
          versionId: ver.id,
        })
        return { bytes: ver.bytes, mimeType: OFFICE_MIME_BY_EXT[wp.extension] }
      } catch (err) {
        metrics.download_failure += 1
        throw err
      }
    },

    prepareSave(
      authHeader: string | undefined,
      body: { idempotencyKey: string; baseVersion: number; sessionId: string },
    ): OfficeSavePrepareResponse {
      const session = sessionFromBearer(authHeader)
      if (session.id !== body.sessionId) throw new AdapterError(404, 'NOT_FOUND', 'not found')
      if (!session.permissions.includes('SAVE_NEW_VERSION')) {
        throw new AdapterError(403, 'SAVE_DENIED', 'save denied')
      }
      assertMembership(session.userId, session.tenantId, session.workspaceId)
      const wp = workProducts.get(session.workProductId)
      if (!wp || wp.deleted) throw new AdapterError(404, 'NOT_FOUND', 'not found')

      const completedId = completedByIdempotency.get(body.idempotencyKey)
      if (completedId) {
        const completed = completedSaves.get(completedId)
        if (completed) {
          const uploadToken = token('upl_')
          const pending: PendingUpload = {
            saveOperationId: completed.saveOperationId,
            idempotencyKey: body.idempotencyKey,
            sessionId: session.id,
            baseVersion: wp.latestVersionNumber,
            uploadTokenHash: sha256Hex(uploadToken),
            bytes: null,
            expiresAt: now() + 15 * 60_000,
          }
          pendingUploads.set(completed.saveOperationId, pending)
          return prepareResponse(pending, uploadToken, wp)
        }
      }

      const existingId = pendingByIdempotency.get(body.idempotencyKey)
      if (existingId) {
        const existing = pendingUploads.get(existingId)
        if (existing && existing.sessionId === session.id) {
          const uploadToken = token('upl_')
          existing.uploadTokenHash = sha256Hex(uploadToken)
          existing.expiresAt = now() + 15 * 60_000
          return prepareResponse(existing, uploadToken, wp)
        }
      }

      if (wp.latestVersionNumber !== body.baseVersion) {
        metrics.version_conflict_count += 1
        throw new AdapterError(400, 'VERSION_CONFLICT', 'version conflict', {
          error: 'VERSION_CONFLICT',
          baseVersion: body.baseVersion,
          latestVersion: wp.latestVersionNumber,
        })
      }
      session.status = 'SAVING'
      const saveOperationId = randomUUID()
      const uploadToken = token('upl_')
      const pending: PendingUpload = {
        saveOperationId,
        idempotencyKey: body.idempotencyKey,
        sessionId: session.id,
        baseVersion: body.baseVersion,
        uploadTokenHash: sha256Hex(uploadToken),
        bytes: null,
        expiresAt: now() + 15 * 60_000,
      }
      pendingUploads.set(saveOperationId, pending)
      pendingByIdempotency.set(body.idempotencyKey, saveOperationId)
      emitAudit({
        type: 'OFFICE_SAVE_STARTED',
        at: new Date(now()).toISOString(),
        actorUserId: session.userId,
        tenantId: session.tenantId,
        sessionId: session.id,
        workProductId: wp.id,
      })
      return prepareResponse(pending, uploadToken, wp)
    },

    upload(authHeader: string | undefined, bytes: Uint8Array): void {
      if (!authHeader?.startsWith('Bearer ')) {
        throw new AdapterError(401, 'UNAUTHENTICATED', 'missing upload credential')
      }
      const raw = authHeader.slice('Bearer '.length).trim()
      const hash = sha256Hex(raw)
      const pending = [...pendingUploads.values()].find((p) => p.uploadTokenHash === hash)
      if (!pending) throw new AdapterError(400, 'INVALID_REQUEST', 'no pending upload')
      pending.bytes = bytes
    },

    completeSave(
      authHeader: string | undefined,
      body: { sessionId: string; saveOperationId: string; idempotencyKey: string },
    ): OfficeSaveCompleteResponse {
      const session = sessionFromBearer(authHeader)
      if (session.id !== body.sessionId) throw new AdapterError(404, 'NOT_FOUND', 'not found')
      if (!session.permissions.includes('SAVE_NEW_VERSION')) {
        metrics.save_failure += 1
        throw new AdapterError(403, 'SAVE_DENIED', 'save denied')
      }
      const replay = completedSaves.get(body.saveOperationId)
      if (replay) return { ...replay.result, idempotentReplay: true }
      try {
        assertMembership(session.userId, session.tenantId, session.workspaceId)
        const wp = workProducts.get(session.workProductId)
        if (!wp || wp.deleted) throw new AdapterError(404, 'NOT_FOUND', 'not found')
        const pending = pendingUploads.get(body.saveOperationId)
        if (!pending || pending.sessionId !== session.id || pending.idempotencyKey !== body.idempotencyKey) {
          throw new AdapterError(400, 'UPLOAD_NOT_FOUND', 'upload not found')
        }
        if (!pending.bytes) throw new AdapterError(400, 'UPLOAD_NOT_FOUND', 'upload not found')
        if (wp.latestVersionNumber !== pending.baseVersion) {
          metrics.version_conflict_count += 1
          throw new AdapterError(400, 'VERSION_CONFLICT', 'version conflict', {
            error: 'VERSION_CONFLICT',
            baseVersion: pending.baseVersion,
            latestVersion: wp.latestVersionNumber,
          })
        }
        const checksum = sha256Hex(pending.bytes)
        const versionId = randomUUID()
        const versionNumber = wp.latestVersionNumber + 1
        const createdAt = new Date(now()).toISOString()
        versions.set(versionId, {
          id: versionId,
          workProductId: wp.id,
          versionNumber,
          checksumSha256: checksum,
          size: pending.bytes.byteLength,
          bytes: pending.bytes,
          createdAt,
        })
        wp.latestVersionId = versionId
        wp.latestVersionNumber = versionNumber
        session.workProductVersionId = versionId
        session.status = 'SAVED'
        session.rowVersion += 1
        pendingUploads.delete(body.saveOperationId)
        pendingByIdempotency.delete(body.idempotencyKey)
        const result: OfficeSaveCompleteResponse = {
          documentId: wp.id,
          versionId,
          version: versionNumber,
          versionNumber,
          createdAt,
          idempotentReplay: false,
        }
        completedSaves.set(body.saveOperationId, {
          saveOperationId: body.saveOperationId,
          idempotencyKey: body.idempotencyKey,
          result,
        })
        completedByIdempotency.set(body.idempotencyKey, body.saveOperationId)
        metrics.save_success += 1
        emitAudit({
          type: 'WORK_PRODUCT_VERSION_CREATED',
          at: new Date(now()).toISOString(),
          actorUserId: session.userId,
          tenantId: session.tenantId,
          sessionId: session.id,
          workProductId: wp.id,
          versionId,
        })
        emitAudit({
          type: 'OFFICE_SAVE_COMPLETED',
          at: new Date(now()).toISOString(),
          actorUserId: session.userId,
          tenantId: session.tenantId,
          sessionId: session.id,
          workProductId: wp.id,
          versionId,
        })
        outbox.push({
          type: 'WORK_PRODUCT_VERSION_CREATED',
          at: createdAt,
          workProductId: wp.id,
          versionId,
          versionNumber,
        })
        return result
      } catch (err) {
        metrics.save_failure += 1
        emitAudit({
          type: 'OFFICE_SESSION_FAILED',
          at: new Date(now()).toISOString(),
          sessionId: body.sessionId,
        })
        throw err
      }
    },

    close(authHeader: string | undefined, sessionId: string): void {
      const session = sessionFromBearer(authHeader)
      if (session.id !== sessionId) throw new AdapterError(404, 'NOT_FOUND', 'not found')
      session.status = 'CLOSED'
      session.closedAt = now()
      emitAudit({
        type: 'OFFICE_SESSION_CLOSED',
        at: new Date(now()).toISOString(),
        actorUserId: session.userId,
        tenantId: session.tenantId,
        sessionId: session.id,
        workProductId: session.workProductId,
      })
    },
  }
}

export type OfficeBridgeStore = ReturnType<typeof createOfficeBridgeStore>
