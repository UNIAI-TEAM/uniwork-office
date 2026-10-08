import { LIVE_OFFICE_PATHS } from '@uniwork/office-bridge-contracts'
import type {
  OfficeErrorBody,
  OfficeFileDescriptor,
  OfficeLaunchExchangeResponse,
  OfficeSaveCompleteResponse,
  OfficeSavePrepareResponse,
  OfficeSessionCreateResponse,
  OfficeSessionEndpoints,
  OfficeVersionConflict,
  SupportedOfficeExtension,
} from '@uniwork/office-bridge-contracts'
import {
  OFFICE_MIME_BY_EXT,
  mimeForExtension,
  officeLaunchExchangeRequestSchema,
  officeSaveCompleteRequestSchema,
  officeSavePrepareRequestSchema,
  officeSessionCreateRequestSchema,
} from '@uniwork/office-bridge-contracts'
import { assertSafeApiOrigin } from './origin'

export class OfficeBridgeApiError extends Error {
  readonly status: number
  readonly code: string
  readonly conflict?: OfficeVersionConflict

  constructor(status: number, code: string, message: string, conflict?: OfficeVersionConflict) {
    super(message)
    this.name = 'OfficeBridgeApiError'
    this.status = status
    this.code = code
    this.conflict = conflict
  }
}

export interface OfficeBridgeClient {
  origin: string
  createSession(userBearer: string, documentId: string): Promise<OfficeSessionCreateResponse>
  exchange(token: string): Promise<OfficeLaunchExchangeResponse>
  downloadContent(sessionToken: string, downloadUrl?: string): Promise<Uint8Array>
  prepareSave(
    sessionToken: string,
    body: { idempotencyKey: string; baseVersion: number; sessionId: string },
    savePrepareUrl?: string,
  ): Promise<OfficeSavePrepareResponse>
  upload(uploadUrl: string, uploadToken: string, bytes: Uint8Array): Promise<void>
  completeSave(
    sessionToken: string,
    body: { sessionId: string; saveOperationId: string; idempotencyKey: string },
    saveCompleteUrl?: string,
  ): Promise<OfficeSaveCompleteResponse>
}

const CODE_ALIASES: Record<string, string> = {
  UNAUTHORIZED: 'UNAUTHENTICATED',
  BAD_REQUEST: 'INVALID_REQUEST',
  TOKEN_EXPIRED: 'EXPIRED',
  PERMISSION_DENIED: 'FORBIDDEN',
}

function normalizeErrorCode(code: string): string {
  return CODE_ALIASES[code] ?? code
}

function errorCodeFromBody(body: unknown): { code: string; message: string; rest: Record<string, unknown> } {
  if (!body || typeof body !== 'object') {
    return { code: 'INTERNAL', message: 'http_error', rest: {} }
  }
  const rec = body as Record<string, unknown>
  const err = rec.error
  if (typeof err === 'string') {
    return { code: normalizeErrorCode(err), message: `http_error`, rest: rec }
  }
  if (err && typeof err === 'object') {
    const nested = err as { code?: string; message?: string }
    return {
      code: normalizeErrorCode(nested.code ?? 'INTERNAL'),
      message: nested.message ?? 'http_error',
      rest: rec,
    }
  }
  return { code: 'INTERNAL', message: 'http_error', rest: rec }
}

function conflictFromBody(body: Record<string, unknown>): OfficeVersionConflict {
  return {
    code: 'VERSION_CONFLICT',
    currentVersionId: typeof body.currentVersionId === 'string' ? body.currentVersionId : '',
    currentVersionNumber:
      typeof body.latestVersion === 'number'
        ? body.latestVersion
        : typeof body.currentVersionNumber === 'number'
          ? body.currentVersionNumber
          : 0,
    baseVersionId:
      typeof body.baseVersion === 'number' || typeof body.baseVersion === 'string'
        ? String(body.baseVersion)
        : typeof body.baseVersionId === 'string'
          ? body.baseVersionId
          : '',
  }
}

function throwIfErrorStatus(status: number, body: unknown): void {
  const parsed = errorCodeFromBody(body)
  if (parsed.code === 'VERSION_CONFLICT' || status === 409) {
    throw new OfficeBridgeApiError(
      status,
      'VERSION_CONFLICT',
      parsed.message,
      conflictFromBody(parsed.rest),
    )
  }
  throw new OfficeBridgeApiError(status, parsed.code, parsed.message)
}

function resolveEndpoint(origin: string, value: string | undefined, fallback: string): string {
  const raw = (value && value.trim()) || fallback
  if (/^https?:\/\//i.test(raw)) return raw
  const path = raw.startsWith('/') ? raw : `/${raw}`
  return `${origin}${path}`
}

function extensionFromFileName(fileName: string): SupportedOfficeExtension | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx' || ext === 'pdf') return ext
  return null
}

function normalizeExchange(body: Record<string, unknown>, origin: string): OfficeLaunchExchangeResponse {
  const sessionId = String(body.sessionId ?? '')
  const sessionToken = String(body.sessionToken ?? '')
  if (!sessionId || !sessionToken) {
    throw new OfficeBridgeApiError(500, 'INTERNAL', 'exchange_missing_session')
  }
  const documentRaw = (body.document && typeof body.document === 'object'
    ? body.document
    : {}) as Record<string, unknown>
  const endpointsRaw = (body.endpoints && typeof body.endpoints === 'object'
    ? body.endpoints
    : {}) as Record<string, unknown>
  const fileName = String(documentRaw.fileName ?? 'document')
  const extension = extensionFromFileName(fileName)
  if (!extension) {
    throw new OfficeBridgeApiError(400, 'UNSUPPORTED_FORMAT', 'unsupported format')
  }
  const mimeType =
    String(documentRaw.mimeType ?? '') || mimeForExtension(extension) || OFFICE_MIME_BY_EXT[extension]
  const baseVersion =
    typeof documentRaw.baseVersion === 'number' ? documentRaw.baseVersion : 1
  const title = String(documentRaw.title ?? fileName)
  const documentId = String(documentRaw.id ?? '')
  const endpoints: OfficeSessionEndpoints = {
    download: resolveEndpoint(origin, String(endpointsRaw.download ?? ''), LIVE_OFFICE_PATHS.download),
    savePrepare: resolveEndpoint(
      origin,
      String(endpointsRaw.savePrepare ?? ''),
      LIVE_OFFICE_PATHS.savePrepare,
    ),
    saveComplete: resolveEndpoint(
      origin,
      String(endpointsRaw.saveComplete ?? ''),
      LIVE_OFFICE_PATHS.saveComplete,
    ),
  }
  const canSave = extension !== 'pdf'
  const descriptor: OfficeFileDescriptor = {
    sessionId,
    workProductId: documentId,
    workProductTitle: title,
    versionId: '',
    versionNumber: baseVersion,
    fileName,
    mimeType,
    extension,
    size: 0,
    checksumSha256: '',
    readOnly: !canSave,
    canDownload: true,
    canSaveNewVersion: canSave,
  }
  return {
    sessionId,
    sessionToken,
    expiresAt: String(body.expiresAt ?? ''),
    document: {
      id: documentId,
      title,
      fileName,
      mimeType,
      baseVersion,
    },
    endpoints,
    descriptor,
  }
}

function normalizePrepare(body: Record<string, unknown>): OfficeSavePrepareResponse {
  const uploadRaw = (body.upload && typeof body.upload === 'object' ? body.upload : {}) as Record<
    string,
    unknown
  >
  const saveOperationId = String(body.saveOperationId ?? '')
  const url = String(uploadRaw.url ?? '')
  const token = String(uploadRaw.token ?? '')
  if (!saveOperationId || !url || !token) {
    throw new OfficeBridgeApiError(500, 'INTERNAL', 'prepare_missing_upload')
  }
  return {
    saveOperationId,
    baseVersion: typeof body.baseVersion === 'number' ? body.baseVersion : 0,
    nextVersion: typeof body.nextVersion === 'number' ? body.nextVersion : 0,
    upload: {
      url,
      token,
      method: String(uploadRaw.method ?? 'PUT'),
    },
  }
}

function normalizeComplete(body: Record<string, unknown>): OfficeSaveCompleteResponse {
  const version =
    typeof body.version === 'number'
      ? body.version
      : typeof body.versionNumber === 'number'
        ? body.versionNumber
        : 0
  return {
    documentId: String(body.documentId ?? body.workProductId ?? ''),
    versionId: String(body.versionId ?? ''),
    version,
    versionNumber: version,
    createdAt: String(body.createdAt ?? ''),
    idempotentReplay: body.idempotentReplay === true,
  }
}

export function createOfficeBridgeClient(originRaw: string): OfficeBridgeClient {
  const origin = assertSafeApiOrigin(originRaw)

  async function json<T>(
    url: string,
    init: RequestInit & { sessionBearer?: string; userBearer?: string },
  ): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body && !headers.has('Content-Type') && !(init.body instanceof Uint8Array)) {
      headers.set('Content-Type', 'application/json')
    }
    if (init.sessionBearer) {
      headers.set('Authorization', `Bearer ${init.sessionBearer}`)
    }
    if (init.userBearer) {
      headers.set('Authorization', `Bearer ${init.userBearer}`)
    }
    const { sessionBearer: _s, userBearer: _u, ...rest } = init
    const res = await fetch(url, { ...rest, headers })
    if (!res.ok) {
      let body: unknown = undefined
      try {
        body = await res.json()
      } catch {
        // non-JSON error body
      }
      throwIfErrorStatus(res.status, body as OfficeErrorBody)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  return {
    origin,
    async createSession(userBearer, documentId) {
      const parsed = officeSessionCreateRequestSchema.parse({ documentId })
      return json<OfficeSessionCreateResponse>(`${origin}/api/office/sessions`, {
        method: 'POST',
        userBearer,
        body: JSON.stringify(parsed),
      })
    },
    async exchange(token) {
      const parsed = officeLaunchExchangeRequestSchema.parse({ token })
      const raw = await json<Record<string, unknown>>(`${origin}/api/office/sessions/exchange`, {
        method: 'POST',
        body: JSON.stringify(parsed),
      })
      return normalizeExchange(raw, origin)
    },
    async downloadContent(sessionToken, downloadUrl) {
      const url = resolveEndpoint(origin, downloadUrl, LIVE_OFFICE_PATHS.download)
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          Accept: 'application/octet-stream',
        },
      })
      if (!res.ok) {
        let body: unknown = undefined
        try {
          body = await res.json()
        } catch {
          // binary error body
        }
        throwIfErrorStatus(res.status, body)
      }
      return new Uint8Array(await res.arrayBuffer())
    },
    async prepareSave(sessionToken, body, savePrepareUrl) {
      const parsed = officeSavePrepareRequestSchema.parse(body)
      const url = resolveEndpoint(origin, savePrepareUrl, LIVE_OFFICE_PATHS.savePrepare)
      const raw = await json<Record<string, unknown>>(url, {
        method: 'POST',
        sessionBearer: sessionToken,
        body: JSON.stringify(parsed),
      })
      return normalizePrepare(raw)
    },
    async upload(uploadUrl, uploadToken, bytes) {
      const url = resolveEndpoint(origin, uploadUrl, uploadUrl)
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${uploadToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: Buffer.from(bytes),
      })
      if (!res.ok) {
        throw new OfficeBridgeApiError(res.status, 'UPLOAD_INCOMPLETE', `upload_failed_${res.status}`)
      }
    },
    async completeSave(sessionToken, body, saveCompleteUrl) {
      const parsed = officeSaveCompleteRequestSchema.parse(body)
      const url = resolveEndpoint(origin, saveCompleteUrl, LIVE_OFFICE_PATHS.saveComplete)
      const raw = await json<Record<string, unknown>>(url, {
        method: 'POST',
        sessionBearer: sessionToken,
        body: JSON.stringify(parsed),
      })
      return normalizeComplete(raw)
    },
  }
}

export type { OfficeFileDescriptor }
