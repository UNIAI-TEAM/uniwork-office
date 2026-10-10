/**
 * Local stand-in for the UniWork documents server, composed on top of the
 * desktop-auth stub (same origin, same bearer tokens). It replays the contract
 * the shell uses for UniWork documents:
 *
 *   GET  /orgs/{org}/workspaces
 *   GET  /workspaces/{ws}/documents[/recent]       (kind=file, q, cursor, limit)
 *   GET  /documents/{id}                           (detail with `file`)
 *   GET  /documents/{id}/download[?version=N]      (bytes)
 *   POST /documents/{id}/uploads                   (multipart `file`, Idempotency-Key)
 *   POST /documents/{id}/versions/commit           ({upload_id, base_revision}, same key)
 *   POST /office/sessions/exchange                 (single-use ticket, device match)
 *
 * Shapes follow the server SDOs (`handler/dto/sdo/{document,office_launch}.go`);
 * revisions are decimal strings. A stale `base_revision` answers 409
 * `document_version_conflict` with `fields.current_revision`; a replayed
 * Idempotency-Key returns the stored answer and never creates a second version.
 * Knobs simulate a web edit, a view-only grant, a dropped connection and a
 * lost commit response.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import {
  STUB_ACCOUNT,
  STUB_CLIENT_ID,
  STUB_DEPLOYMENT_ID,
  STUB_ORG,
  startUniworkAuthStub,
  type StubRouteContext,
  type UniworkAuthStub,
} from './uniwork-auth-stub'

export const STUB_WORKSPACE = { id: 'ws_e2e_01', name: 'Engineering notes' }
/** the 120 s lifetime of a launch ticket */
const TICKET_TTL_MS = 120_000

export type StubAccessLevel = 'view' | 'comment' | 'edit' | 'manage'

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  md: 'text/markdown',
  html: 'text/html',
}

export interface StubDocumentInit {
  /** file name, also the title (the extension decides the format) */
  filename: string
  bytes: Buffer
  workspaceId?: string
  myLevel?: StubAccessLevel
  id?: string
}

interface StubVersion {
  version: number
  revision: number
  bytes: Buffer
  checksum: string
}

interface StubDocument {
  id: string
  workspaceId: string
  title: string
  filename: string
  myLevel: StubAccessLevel
  revision: number
  versions: StubVersion[]
  updatedAt: string
}

export interface StubDocumentState {
  id: string
  revision: string
  version: number
  checksum: string
  bytes: Buffer
  myLevel: StubAccessLevel
}

/** one request the documents routes answered (or dropped) */
export interface StubCall {
  method: string
  /** path below `/api/v1`, query not included */
  route: string
  idempotencyKey?: string
  status: number | 'dropped'
  /** commit calls: the body's base revision */
  baseRevision?: string
  /** upload calls: sha256 of the uploaded bytes */
  checksum?: string
}

export type CommitDrop = 'before' | 'after'

export interface UniworkDocumentsStub extends UniworkAuthStub {
  addDocument(init: StubDocumentInit): StubDocumentState
  state(documentId: string): StubDocumentState
  /** a save made elsewhere (the web editor): revision and version advance, bytes optionally change */
  bumpRevision(documentId: string, bytes?: Buffer): StubDocumentState
  /** the caller's access to a document, as the server reports it */
  setAccess(documentId: string, level: StubAccessLevel): void
  /**
   * The next commit never gets an answer: the connection is cut before the
   * server acts ('before', nothing committed) or after it committed ('after',
   * the response is lost).
   */
  failNextCommit(mode?: CommitDrop): void
  /** every documents-route request so far, oldest first */
  calls(): StubCall[]
  uploads(documentId?: string): StubCall[]
  commits(documentId?: string): StubCall[]
  /** documents-route request count; `.length` of a before/after snapshot shows nothing was sent */
  callCount(): number
  /** a launch ticket for the web "Open in desktop app" link */
  issueTicket(
    documentId: string,
    options?: { operation?: 'view' | 'edit'; version?: number; ageMs?: number },
  ): { ticket: string; url: string }
  /** how many exchange calls carried this ticket */
  exchangeAttempts(ticket: string): number
}

interface Ticket {
  documentId: string
  operation: 'view' | 'edit'
  version: number
  issuedAt: number
  redeemed: boolean
  attempts: number
}

interface StoredUpload {
  uploadId: string
  documentId: string
  bytes: Buffer
  checksum: string
}

interface StoredCommit {
  fingerprint: string
  status: number
  body: unknown
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const ulid = (prefix: string): string => `${prefix}_${randomBytes(9).toString('hex')}`

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** the `file` part of a multipart/form-data body (binary safe) */
function multipartFile(body: Buffer, contentType: string): Buffer | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  const marker = boundary ? Buffer.from(`--${boundary[1] ?? boundary[2]}`) : null
  if (!marker) return null
  let at = body.indexOf(marker)
  while (at >= 0) {
    const start = at + marker.length
    const next = body.indexOf(marker, start)
    if (next < 0) return null
    const part = body.subarray(start, next)
    const split = part.indexOf('\r\n\r\n')
    if (split >= 0) {
      const head = part.subarray(0, split).toString('latin1')
      if (/name="file"/i.test(head)) {
        // content runs to the CRLF that precedes the next boundary
        return Buffer.from(part.subarray(split + 4, part.length - 2))
      }
    }
    at = next
  }
  return null
}

export async function startUniworkDocumentsStub(): Promise<UniworkDocumentsStub> {
  const documents = new Map<string, StubDocument>()
  const tickets = new Map<string, Ticket>()
  const uploads = new Map<string, StoredUpload>()
  const uploadByKey = new Map<string, StoredUpload>()
  const commitByKey = new Map<string, StoredCommit>()
  const calls: StubCall[] = []
  let dropNextCommit: CommitDrop | null = null

  const latest = (doc: StubDocument): StubVersion => doc.versions[doc.versions.length - 1]!

  const stateOf = (doc: StubDocument): StubDocumentState => ({
    id: doc.id,
    revision: String(doc.revision),
    version: latest(doc).version,
    checksum: latest(doc).checksum,
    bytes: latest(doc).bytes,
    myLevel: doc.myLevel,
  })

  const fileDto = (doc: StubDocument, version: StubVersion) => ({
    file_id: `file_${doc.id}_${version.version}`,
    version_id: `ver_${doc.id}_${version.version}`,
    version: version.version,
    filename: doc.filename,
    mime_type: MIME[extensionOf(doc.filename)] ?? 'application/octet-stream',
    size_bytes: version.bytes.length,
    checksum_sha256: version.checksum,
  })

  const documentDto = (doc: StubDocument) => ({
    id: doc.id,
    organization_id: STUB_ORG.id,
    workspace_id: doc.workspaceId,
    kind: 'file',
    title: doc.title,
    visibility: 'workspace',
    revision: String(doc.revision),
    current_version: latest(doc).version,
    position: 0,
    my_level: doc.myLevel,
    via: 'member',
    file: fileDto(doc, latest(doc)),
    created_by: STUB_ACCOUNT.id,
    created_by_kind: 'human',
    updated_by: STUB_ACCOUNT.id,
    updated_by_kind: 'human',
    created_at: '2026-10-01T09:00:00Z',
    updated_at: doc.updatedAt,
  })

  const summaryDto = (doc: StubDocument) => {
    const { file: _file, ...rest } = documentDto(doc)
    return rest
  }

  const envelope = (code: string, fields?: Record<string, unknown>) => ({
    error: { code, message: code, ...(fields ? { fields } : {}) },
  })

  const log = (ctx: StubRouteContext, call: Omit<StubCall, 'method' | 'route'>): void => {
    calls.push({ method: ctx.req.method ?? '', route: ctx.route.split('?')[0]!, ...call })
  }

  function bytesResponse(res: ServerResponse, doc: StubDocument, version: StubVersion): void {
    res.writeHead(200, {
      'Content-Type': MIME[extensionOf(doc.filename)] ?? 'application/octet-stream',
      'Content-Length': String(version.bytes.length),
      'Content-Disposition': `attachment; filename="${doc.filename}"`,
      'Cache-Control': 'no-store',
    })
    res.end(version.bytes)
  }

  async function documentsRoute(ctx: StubRouteContext): Promise<boolean> {
    const { req, res, route, url } = ctx
    const method = req.method ?? ''
    const idem = req.headers['idempotency-key']
    const idempotencyKey = typeof idem === 'string' ? idem : undefined

    let m = /^\/orgs\/([^/]+)\/workspaces$/.exec(route)
    if (m && method === 'GET') {
      log(ctx, { status: 200 })
      if (m[1] !== STUB_ORG.id) {
        ctx.send(404, envelope('not_found'))
        return true
      }
      ctx.send(200, {
        workspaces: [
          { id: STUB_WORKSPACE.id, name: STUB_WORKSPACE.name, organization_id: STUB_ORG.id },
        ],
      })
      return true
    }

    m = /^\/workspaces\/([^/]+)\/documents(\/recent)?$/.exec(route)
    if (m && method === 'GET') {
      const query = (url.searchParams.get('q') ?? '').toLowerCase()
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50))
      const offset = Number(url.searchParams.get('cursor')) || 0
      const rows = [...documents.values()]
        .filter((d) => d.workspaceId === m![1] && d.title.toLowerCase().includes(query))
        .reverse()
      const page = rows.slice(offset, offset + limit)
      log(ctx, { status: 200 })
      ctx.send(200, {
        documents: page.map(summaryDto),
        next_cursor: offset + limit < rows.length ? String(offset + limit) : null,
      })
      return true
    }

    m = /^\/documents\/([^/]+)(\/download|\/uploads|\/versions\/commit)?$/.exec(route)
    if (m) {
      const doc = documents.get(m[1]!)
      const tail = m[2] ?? ''

      if (method === 'GET' && tail === '') {
        if (!doc) {
          log(ctx, { status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        log(ctx, { status: 200 })
        ctx.send(200, { document: documentDto(doc) })
        return true
      }

      if (method === 'GET' && tail === '/download') {
        const wanted = Number(url.searchParams.get('version')) || 0
        const version =
          doc && (wanted > 0 ? doc.versions.find((v) => v.version === wanted) : latest(doc))
        if (!doc || !version) {
          log(ctx, { status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        log(ctx, { status: 200 })
        bytesResponse(res, doc, version)
        return true
      }

      if (method === 'POST' && tail === '/uploads') {
        const body = await ctx.readBody()
        const file = multipartFile(body, String(req.headers['content-type'] ?? ''))
        const base: Omit<StubCall, 'method' | 'route' | 'status'> = {
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(file ? { checksum: sha256(file) } : {}),
        }
        if (!doc) {
          log(ctx, { ...base, status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        if (!file || !idempotencyKey) {
          log(ctx, { ...base, status: 400 })
          ctx.send(400, envelope('invalid_request'))
          return true
        }
        if (doc.myLevel !== 'edit' && doc.myLevel !== 'manage') {
          log(ctx, { ...base, status: 403 })
          ctx.send(403, envelope('forbidden'))
          return true
        }
        const checksum = sha256(file)
        const known = uploadByKey.get(`${doc.id}:${idempotencyKey}`)
        if (known && known.checksum !== checksum) {
          log(ctx, { ...base, status: 409 })
          ctx.send(409, envelope('idempotency_payload_mismatch'))
          return true
        }
        const stored: StoredUpload = known ?? {
          uploadId: ulid('upl'),
          documentId: doc.id,
          bytes: file,
          checksum,
        }
        uploads.set(stored.uploadId, stored)
        uploadByKey.set(`${doc.id}:${idempotencyKey}`, stored)
        log(ctx, { ...base, status: 200 })
        ctx.send(200, {
          upload_id: stored.uploadId,
          checksum_sha256: checksum,
          size_bytes: file.length,
          claim_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        })
        return true
      }

      if (method === 'POST' && tail === '/versions/commit') {
        const raw = await ctx.readBody()
        let body: { upload_id?: unknown; base_revision?: unknown } = {}
        try {
          body = JSON.parse(raw.toString('utf8')) as typeof body
        } catch {
          body = {}
        }
        const baseRevision = typeof body.base_revision === 'string' ? body.base_revision : undefined
        const base: Omit<StubCall, 'method' | 'route' | 'status'> = {
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(baseRevision ? { baseRevision } : {}),
        }
        const dropMode = dropNextCommit
        if (dropMode === 'before') {
          dropNextCommit = null
          log(ctx, { ...base, status: 'dropped' })
          req.socket.destroy()
          return true
        }
        if (!doc) {
          log(ctx, { ...base, status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        const upload = typeof body.upload_id === 'string' ? uploads.get(body.upload_id) : undefined
        if (
          !idempotencyKey ||
          !upload ||
          upload.documentId !== doc.id ||
          typeof body.base_revision !== 'string' ||
          !/^\d{1,30}$/.test(body.base_revision)
        ) {
          log(ctx, { ...base, status: 400 })
          ctx.send(400, envelope('invalid_request'))
          return true
        }
        const fingerprint = `${upload.checksum}:${body.base_revision}`
        const replay = commitByKey.get(`${doc.id}:${idempotencyKey}`)
        if (replay) {
          if (replay.fingerprint !== fingerprint) {
            log(ctx, { ...base, status: 409 })
            ctx.send(409, envelope('idempotency_payload_mismatch'))
            return true
          }
          // the stored answer, whatever the document is now
          log(ctx, { ...base, status: replay.status })
          if (dropMode === 'after') {
            dropNextCommit = null
            req.socket.destroy()
            return true
          }
          ctx.send(replay.status, replay.body)
          return true
        }
        if (doc.myLevel !== 'edit' && doc.myLevel !== 'manage') {
          log(ctx, { ...base, status: 403 })
          ctx.send(403, envelope('forbidden'))
          return true
        }
        if (String(doc.revision) !== body.base_revision) {
          log(ctx, { ...base, status: 409 })
          ctx.send(
            409,
            envelope('document_version_conflict', { current_revision: String(doc.revision) }),
          )
          return true
        }
        doc.revision += 1
        const version: StubVersion = {
          version: latest(doc).version + 1,
          revision: doc.revision,
          bytes: upload.bytes,
          checksum: upload.checksum,
        }
        doc.versions.push(version)
        doc.updatedAt = new Date().toISOString()
        const answer = {
          document: documentDto(doc),
          version: {
            id: `ver_${doc.id}_${version.version}`,
            document_id: doc.id,
            version: version.version,
            kind: 'file',
            reason: 'upload',
            file_id: `file_${doc.id}_${version.version}`,
            mime_type: MIME[extensionOf(doc.filename)] ?? 'application/octet-stream',
            size_bytes: version.bytes.length,
            checksum_sha256: version.checksum,
            created_by: STUB_ACCOUNT.id,
            created_by_kind: 'human',
            created_at: doc.updatedAt,
          },
        }
        commitByKey.set(`${doc.id}:${idempotencyKey}`, { fingerprint, status: 200, body: answer })
        log(ctx, { ...base, status: 200 })
        if (dropMode === 'after') {
          // committed, but the response never arrives
          dropNextCommit = null
          req.socket.destroy()
          return true
        }
        ctx.send(200, answer)
        return true
      }
    }

    if (method === 'POST' && route === '/office/sessions/exchange') {
      const raw = await ctx.readBody()
      let body: Record<string, unknown>
      try {
        body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
      } catch {
        body = {}
      }
      const ticket =
        typeof body.launch_ticket === 'string' ? tickets.get(body.launch_ticket) : undefined
      if (ticket) ticket.attempts += 1
      const expired = !!ticket && Date.now() - ticket.issuedAt > TICKET_TTL_MS
      if (!ticket || ticket.redeemed || expired) {
        // unknown, expired and already-consumed tickets look the same (404)
        log(ctx, { status: 404 })
        ctx.send(404, envelope('not_found'))
        return true
      }
      const doc = documents.get(ticket.documentId)
      if (
        !doc ||
        body.client_id !== STUB_CLIENT_ID ||
        body.deployment_id !== STUB_DEPLOYMENT_ID ||
        body.device_session_id !== ctx.deviceSessionId()
      ) {
        log(ctx, { status: 403 })
        ctx.send(403, envelope('forbidden'))
        return true
      }
      ticket.redeemed = true
      const downloadPath = `/api/v1/documents/${doc.id}/download${ticket.version > 0 ? `?version=${ticket.version}` : ''}`
      log(ctx, { status: 200 })
      ctx.send(200, {
        receipt_id: ulid('rcpt'),
        redeemed_at: new Date().toISOString(),
        document: {
          id: doc.id,
          organization_id: STUB_ORG.id,
          workspace_id: doc.workspaceId,
          title: doc.title,
          kind: 'file',
          operation: ticket.operation,
          version: ticket.version,
          revision: String(
            ticket.version > 0
              ? (doc.versions.find((v) => v.version === ticket.version)?.revision ?? doc.revision)
              : doc.revision,
          ),
          download_path: downloadPath,
        },
      })
      return true
    }
    return false
  }

  const base = await startUniworkAuthStub({ extend: documentsRoute })

  const need = (documentId: string): StubDocument => {
    const doc = documents.get(documentId)
    if (!doc) throw new Error(`no stub document ${documentId}`)
    return doc
  }

  return {
    ...base,
    addDocument(init) {
      const id = init.id ?? ulid('doc')
      const doc: StubDocument = {
        id,
        workspaceId: init.workspaceId ?? STUB_WORKSPACE.id,
        title: init.filename,
        filename: init.filename,
        myLevel: init.myLevel ?? 'edit',
        revision: 41,
        versions: [{ version: 3, revision: 41, bytes: init.bytes, checksum: sha256(init.bytes) }],
        updatedAt: '2026-10-08T09:00:00Z',
      }
      documents.set(id, doc)
      return stateOf(doc)
    },
    state: (documentId) => stateOf(need(documentId)),
    bumpRevision(documentId, bytes) {
      const doc = need(documentId)
      const content = bytes ?? latest(doc).bytes
      doc.revision += 1
      doc.versions.push({
        version: latest(doc).version + 1,
        revision: doc.revision,
        bytes: content,
        checksum: sha256(content),
      })
      doc.updatedAt = new Date().toISOString()
      return stateOf(doc)
    },
    setAccess(documentId, level) {
      need(documentId).myLevel = level
    },
    failNextCommit(mode = 'before') {
      dropNextCommit = mode
    },
    calls: () => [...calls],
    uploads: (documentId) =>
      calls.filter(
        (c) =>
          c.method === 'POST' &&
          /^\/documents\/[^/]+\/uploads$/.test(c.route) &&
          (!documentId || c.route === `/documents/${documentId}/uploads`),
      ),
    commits: (documentId) =>
      calls.filter(
        (c) =>
          c.method === 'POST' &&
          /^\/documents\/[^/]+\/versions\/commit$/.test(c.route) &&
          (!documentId || c.route === `/documents/${documentId}/versions/commit`),
      ),
    callCount: () => calls.length,
    issueTicket(documentId, options = {}) {
      need(documentId)
      const ticket = `ticket_${randomBytes(30).toString('base64url')}`
      tickets.set(ticket, {
        documentId,
        operation: options.operation ?? 'edit',
        version: options.version ?? 0,
        issuedAt: Date.now() - (options.ageMs ?? 0),
        redeemed: false,
        attempts: 0,
      })
      return { ticket, url: `uniwork-office-dev://open?ticket=${ticket}` }
    },
    exchangeAttempts: (ticket) => tickets.get(ticket)?.attempts ?? 0,
  }
}
