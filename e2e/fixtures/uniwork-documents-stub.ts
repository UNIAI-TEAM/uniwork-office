/**
 * Local stand-in for the UniWork documents server, composed on top of the
 * desktop-auth stub (same origin, same bearer tokens). It replays the contract
 * the shell uses for UniWork documents:
 *
 *   GET  /orgs/{org}/workspaces
 *   GET  /workspaces/{ws}/documents[/recent]       (kind=file, q, cursor, limit)
 *   POST /workspaces/{ws}/documents/files/blank    ({format, title, parent_id}, Idempotency-Key)
 *   POST /workspaces/{ws}/documents/files          (multipart parent_id, title, file, Idempotency-Key)
 *   GET  /documents/{id}                           (detail with `file`)
 *   GET  /documents/{id}/download[?version=N]      (bytes)
 *   POST /documents/{id}/uploads                   (multipart `file`, Idempotency-Key)
 *   POST /documents/{id}/versions/commit           ({upload_id, base_revision}, same key)
 *   POST /documents/{id}/copies                    ({consent:"copy", title, parent_id}, Idempotency-Key)
 *   GET  /documents/{id}/versions/commit           (the commit-intent lookup, Idempotency-Key)
 *   POST /documents/{id}/archive                   (the only way a document leaves the lists; like
 *                                                   the server's pristine-copy cleanup it is refused
 *                                                   with 403 once the document has a version 2)
 *   POST /office/sessions/exchange                 (single-use ticket, device match)
 *   GET  /workspaces/{ws}/home                     (uniwork-work-stub.ts)
 *
 * Shapes follow the server SDOs (`handler/dto/sdo/{document,office_launch}.go`);
 * revisions are decimal strings. A stale `base_revision` answers 409
 * `document_version_conflict` with `fields.current_revision`; a replayed
 * Idempotency-Key returns the stored answer and never creates a second version.
 * Knobs simulate a web edit, a view-only grant, a dropped connection and a
 * lost commit response.
 */
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import {
  STUB_ACCOUNT,
  STUB_CLIENT_ID,
  STUB_DEPLOYMENT_ID,
  STUB_ORG,
  startUniworkAuthStub,
  type StubRouteContext,
  type UniworkAuthStub,
} from './uniwork-auth-stub'
import { workRoute } from './uniwork-work-stub'

export const STUB_WORKSPACE = { id: 'ws_e2e_01', name: 'Engineering notes', slug: 'engineering' }
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
  parentId?: string | null
}

export interface StubFolderInit {
  title: string
  parentId?: string | null
  workspaceId?: string
  myLevel?: StubAccessLevel
  id?: string
  position?: number
}

export interface StubFolderState {
  id: string
  workspaceId: string
  title: string
  parentId: string | null
  revision: string
  myLevel: StubAccessLevel
  archived: boolean
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
  kind: 'file' | 'folder'
  title: string
  filename: string
  myLevel: StubAccessLevel
  revision: number
  position: number
  versions: StubVersion[]
  updatedAt: string
  /** G5-12 / FD-11: the folder or page holding the document (null = root) */
  parentId: string | null
  /** G5-12: the source of a copy made through `/copies` */
  copiedFrom?: string
  /** G5-12: set by `/archive` */
  archivedAt?: string
}

/** G5-12: one copy the stub made */
export interface StubCopyState {
  id: string
  title: string
  parentId: string | null
  archived: boolean
  state: StubDocumentState
}

export interface StubDocumentState {
  id: string
  title: string
  parentId: string | null
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
  addFolder(init: StubFolderInit): StubFolderState
  state(documentId: string): StubDocumentState
  documents(workspaceId?: string): StubDocumentState[]
  folderState(folderId: string): StubFolderState
  folders(workspaceId?: string): StubFolderState[]
  /** enables `/orgs/{org}/office/capabilities` (`sync_feed: true`) and `/workspaces/{ws}/documents/changes` */
  enableFeed(enabled?: boolean): void
  /** simulates a move on the web and appends an upsert to the change feed */
  webMove(
    id: string,
    parentId: string | null,
  ): { id: string; title: string; parentId: string | null; revision: string }
  /** simulates a rename on the web and appends an upsert to the change feed */
  webRename(
    id: string,
    title: string,
  ): { id: string; title: string; parentId: string | null; revision: string }
  /** simulates archiving on the web and appends an archived upsert to the change feed */
  webArchive(id: string): { id: string; archived: boolean; revision: string }
  /** simulates restoring an archived item on the web and appends an unarchived upsert to the change feed */
  webRestore(id: string): { id: string; archived: boolean; revision: string }
  /** a save made elsewhere (the web editor): revision and version advance, bytes optionally change */
  bumpRevision(documentId: string, bytes?: Buffer): StubDocumentState
  /** the caller's access to a document, as the server reports it */
  setAccess(documentId: string, level: StubAccessLevel): void
  /**
   * The next commit never gets an answer: the connection is cut before the
   * server acts ('before', nothing committed) or after it committed ('after',
   * the response is lost).
   */
  failNextCommit(mode?: CommitDrop, count?: number): void
  /**
   * The next commits are cut one per entry, in order (BE-12-202: the first
   * lands with its answer lost, the retry is cut before the server acts).
   */
  failCommitsInOrder(modes: CommitDrop[]): void
  /**
   * The next `count` commits on a document made through `/copies` answer a 5xx
   * (G5-12: the copy's step 2 fails and the app archives the copy).
   */
  failCopyCommits(count: number): void
  /**
   * `/copies` answers 403 `workspace_seat_required` while on: the server's rule
   * for a caller who is not a member of the source document's workspace (G5-12
   * no-seat, BE-12-201).
   */
  denyCopies(denied?: boolean): void
  /** the copies made from a document, oldest first */
  copiesOf(sourceId: string): StubCopyState[]
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

interface FeedEvent {
  change_kind: 'upsert' | 'removal'
  document_id: string
  kind: 'file' | 'folder'
  revision: string
  current_version: number
  version_id: string | null
  archived: boolean
  /** the server's removal reason; always empty on an upsert (this stub sends upserts only) */
  removal: ''
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const ulid = (prefix: string): string => `${prefix}_${randomBytes(9).toString('hex')}`

let cachedBlankDocx: Buffer | null = null
function blankDocxBytes(): Buffer {
  if (!cachedBlankDocx) {
    try {
      cachedBlankDocx = readFileSync(resolve(__dirname, '../../fixtures/generated/simple.docx'))
    } catch {
      cachedBlankDocx = Buffer.alloc(0)
    }
  }
  return cachedBlankDocx
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** parses text fields and the `file` part of a multipart/form-data body (binary safe) */
function multipartForm(
  body: Buffer,
  contentType: string,
): { fields: Record<string, string>; file: { filename: string; bytes: Buffer } | null } | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  const marker = boundary ? Buffer.from(`--${boundary[1] ?? boundary[2]}`) : null
  if (!marker) return null
  const fields: Record<string, string> = {}
  let file: { filename: string; bytes: Buffer } | null = null
  let at = body.indexOf(marker)
  while (at >= 0) {
    const start = at + marker.length
    const next = body.indexOf(marker, start)
    if (next < 0) break
    const part = body.subarray(start, next)
    const split = part.indexOf('\r\n\r\n')
    if (split >= 0) {
      const head = part.subarray(0, split).toString('utf8')
      // content runs to the CRLF that precedes the next boundary
      const content = Buffer.from(part.subarray(split + 4, part.length - 2))
      const nameMatch = /name="([^"]+)"/i.exec(head)
      const fieldName = nameMatch?.[1]
      if (fieldName === 'file') {
        const filenameMatch = /filename="([^"]*)"/i.exec(head)
        file = { filename: filenameMatch?.[1] ?? '', bytes: content }
      } else if (fieldName) {
        fields[fieldName] = content.toString('utf8')
      }
    }
    at = next
  }
  return { fields, file }
}

/** the `file` part of a multipart/form-data body (binary safe) */
function multipartFile(body: Buffer, contentType: string): Buffer | null {
  return multipartForm(body, contentType)?.file?.bytes ?? null
}

export async function startUniworkDocumentsStub(
  options: { feed?: boolean } = {},
): Promise<UniworkDocumentsStub> {
  const documents = new Map<string, StubDocument>()
  const tickets = new Map<string, Ticket>()
  const uploads = new Map<string, StoredUpload>()
  const uploadByKey = new Map<string, StoredUpload>()
  const commitByKey = new Map<string, StoredCommit>()
  const folderByKey = new Map<string, string>()
  const blankByKey = new Map<string, string>()
  const fileByKey = new Map<string, string>()
  const feedLog: FeedEvent[] = []
  let feedEnabled = Boolean(options.feed)
  const calls: StubCall[] = []
  /** the pending commit drops, one per commit, oldest first */
  let commitDrops: CommitDrop[] = []
  const consumeDrop = () => {
    commitDrops.shift()
  }
  /** G5-12: `/copies` answers 403 workspace_seat_required (the caller is no member of the source's workspace) */
  let copiesDenied = false
  let copyCommitFailures = 0
  const copyByKey = new Map<string, string>()

  const latest = (doc: StubDocument): StubVersion => doc.versions[doc.versions.length - 1]!

  const stateOf = (doc: StubDocument): StubDocumentState => ({
    id: doc.id,
    title: doc.title,
    parentId: doc.parentId,
    revision: String(doc.revision),
    version: latest(doc).version,
    checksum: latest(doc).checksum,
    bytes: latest(doc).bytes,
    myLevel: doc.myLevel,
  })

  const folderStateOf = (doc: StubDocument): StubFolderState => ({
    id: doc.id,
    workspaceId: doc.workspaceId,
    title: doc.title,
    parentId: doc.parentId,
    revision: String(doc.revision),
    myLevel: doc.myLevel,
    archived: Boolean(doc.archivedAt),
  })

  const recordFeedUpsert = (doc: StubDocument): void => {
    feedLog.push({
      change_kind: 'upsert',
      document_id: doc.id,
      kind: doc.kind,
      revision: String(doc.revision),
      current_version: doc.kind === 'file' ? latest(doc).version : 0,
      version_id: doc.kind === 'file' ? `ver_${doc.id}_${latest(doc).version}` : null,
      archived: Boolean(doc.archivedAt),
      removal: '',
    })
  }

  const ancestorsOf = (doc: StubDocument): Array<{ id: string; title: string }> => {
    const chain: Array<{ id: string; title: string }> = []
    const visited = new Set<string>([doc.id])
    let curId = doc.parentId
    while (curId) {
      if (visited.has(curId)) break
      visited.add(curId)
      const parent = documents.get(curId)
      if (!parent) break
      chain.unshift({ id: parent.id, title: parent.title })
      curId = parent.parentId
    }
    return chain
  }

  const isLiveInTree = (doc: StubDocument): boolean => {
    if (doc.archivedAt) return false
    const visited = new Set<string>([doc.id])
    let curId = doc.parentId
    while (curId) {
      if (visited.has(curId)) return false
      visited.add(curId)
      const parent = documents.get(curId)
      if (!parent || parent.archivedAt || parent.kind !== 'folder') return false
      curId = parent.parentId
    }
    return true
  }

  const hasSiblingCollision = (
    workspaceId: string,
    parentId: string | null,
    kind: 'file' | 'folder',
    title: string,
    excludeId?: string,
  ): boolean => {
    const key = title.normalize('NFC').trim().toLowerCase()
    for (const d of documents.values()) {
      if (
        d.id !== excludeId &&
        d.workspaceId === workspaceId &&
        !d.archivedAt &&
        d.parentId === parentId &&
        d.kind === kind &&
        d.title.normalize('NFC').trim().toLowerCase() === key
      ) {
        return true
      }
    }
    return false
  }

  /** only folders collide on a name (FD-D10): a document may share its name with a sibling */
  const resolveMoveTitle = (
    doc: StubDocument,
    targetParentId: string | null,
  ): { ok: true; title: string } | { ok: false } => {
    if (
      doc.kind !== 'folder' ||
      targetParentId === doc.parentId ||
      !hasSiblingCollision(doc.workspaceId, targetParentId, 'folder', doc.title, doc.id)
    ) {
      return { ok: true, title: doc.title }
    }
    for (const n of [2, 3, 4]) {
      const candidate = `${doc.title} (${n})`
      if (!hasSiblingCollision(doc.workspaceId, targetParentId, 'folder', candidate, doc.id)) {
        return { ok: true, title: candidate }
      }
    }
    return { ok: false }
  }

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
    kind: doc.kind,
    title: doc.title,
    visibility: 'workspace',
    parent_id: doc.parentId,
    path: ancestorsOf(doc),
    ...(doc.archivedAt ? { archived_at: doc.archivedAt } : {}),
    revision: String(doc.revision),
    ...(doc.kind === 'file'
      ? {
          current_version: latest(doc).version,
          file: fileDto(doc, latest(doc)),
        }
      : {}),
    position: doc.position,
    my_level: doc.myLevel,
    via: 'member',
    created_by: STUB_ACCOUNT.id,
    created_by_kind: 'human',
    updated_by: STUB_ACCOUNT.id,
    updated_by_kind: 'human',
    created_at: '2026-10-01T09:00:00Z',
    updated_at: doc.updatedAt,
  })

  const summaryDto = (doc: StubDocument, withPath = false) => {
    const dto = documentDto(doc)
    const { file: _file, path, ...rest } = dto as typeof dto & { file?: unknown }
    return withPath ? { ...rest, path } : rest
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

    let m = /^\/orgs\/([^/]+)\/office\/capabilities$/.exec(route)
    if (m && method === 'GET') {
      if (!feedEnabled) return false
      if (m[1] !== STUB_ORG.id) {
        ctx.send(404, envelope('not_found'))
        return true
      }
      ctx.send(200, {
        sync_feed: true,
        sync_write: true,
        offline_library: false,
        ai_uniwork: false,
        ai_uniwork_formats: [],
        ttl_seconds: 300,
      })
      return true
    }

    m = /^\/workspaces\/([^/]+)\/documents\/changes$/.exec(route)
    if (m && method === 'GET') {
      if (!feedEnabled) return false
      const wsId = m[1]!
      if (wsId !== STUB_WORKSPACE.id) {
        ctx.send(404, envelope('not_found'))
        return true
      }
      const cursor = url.searchParams.get('cursor')
      const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
      if (!cursor) {
        const items = [...documents.values()].filter(
          (d) => d.workspaceId === wsId && isLiveInTree(d),
        )
        ctx.send(200, {
          phase: 'snapshot',
          changes: items.map((d) => ({
            document_id: d.id,
            kind: d.kind,
            revision: String(d.revision),
            current_version: d.kind === 'file' ? latest(d).version : 0,
            version_id: d.kind === 'file' ? `ver_${d.id}_${latest(d).version}` : null,
          })),
          has_more: false,
          next_cursor: `cur_${feedLog.length}`,
          expires_at: expiresAt,
        })
        return true
      }
      const idx = Number(cursor.replace(/^cur_/, '')) || 0
      const events = feedLog.slice(idx)
      ctx.send(200, {
        phase: 'feed',
        changes: [],
        feed: events,
        has_more: false,
        next_cursor: `cur_${feedLog.length}`,
        expires_at: expiresAt,
      })
      return true
    }

    m = /^\/orgs\/([^/]+)\/workspaces$/.exec(route)
    if (m && method === 'GET') {
      log(ctx, { status: 200 })
      if (m[1] !== STUB_ORG.id) {
        ctx.send(404, envelope('not_found'))
        return true
      }
      ctx.send(200, {
        workspaces: [
          {
            id: STUB_WORKSPACE.id,
            name: STUB_WORKSPACE.name,
            slug: STUB_WORKSPACE.slug,
            organization_id: STUB_ORG.id,
            organization_slug: STUB_ORG.slug,
          },
        ],
      })
      return true
    }

    m = /^\/workspaces\/([^/]+)\/documents\/tree$/.exec(route)
    if (m && method === 'GET') {
      const wsId = m[1]!
      const foldersInWs = [...documents.values()].filter(
        (d) => d.workspaceId === wsId && d.kind === 'folder' && isLiveInTree(d),
      )
      type TreeNodeDto = {
        id: string
        parent_id: string | null
        title: string
        kind: 'folder'
        position: number
        children: TreeNodeDto[]
      }
      const buildChildren = (parentId: string | null): TreeNodeDto[] =>
        foldersInWs
          .filter((f) => f.parentId === parentId)
          .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
          .map((f) => ({
            id: f.id,
            parent_id: f.parentId,
            title: f.title,
            kind: 'folder',
            position: f.position,
            children: buildChildren(f.id),
          }))
      log(ctx, { status: 200 })
      ctx.send(200, { documents: buildChildren(null) })
      return true
    }

    m = /^\/workspaces\/([^/]+)\/documents$/.exec(route)
    if (m && method === 'POST') {
      const wsId = m[1]!
      const raw = await ctx.readBody()
      let body: { kind?: unknown; title?: unknown; parent_id?: unknown } = {}
      try {
        body = JSON.parse(raw.toString('utf8')) as typeof body
      } catch {
        body = {}
      }
      const base: Omit<StubCall, 'method' | 'route' | 'status'> = {
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }
      const title = typeof body.title === 'string' ? body.title.normalize('NFC').trim() : ''
      if (body.kind !== 'folder' || !title || title.length > 255) {
        log(ctx, { ...base, status: 400 })
        ctx.send(400, envelope('invalid_request'))
        return true
      }
      if (idempotencyKey) {
        const replayedId = folderByKey.get(`${wsId}:${idempotencyKey}`)
        const replayed = replayedId ? documents.get(replayedId) : undefined
        if (replayed) {
          log(ctx, { ...base, status: 201 })
          ctx.send(201, { document: documentDto(replayed) })
          return true
        }
      }
      const parentId =
        typeof body.parent_id === 'string' && body.parent_id.length > 0 ? body.parent_id : null
      if (parentId !== null) {
        const parent = documents.get(parentId)
        if (!parent || parent.workspaceId !== wsId || !isLiveInTree(parent)) {
          log(ctx, { ...base, status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        if (parent.kind !== 'folder') {
          log(ctx, { ...base, status: 422 })
          ctx.send(422, envelope('document_parent_kind'))
          return true
        }
        if (ancestorsOf(parent).length + 2 > 20) {
          log(ctx, { ...base, status: 422 })
          ctx.send(422, envelope('document_too_deep'))
          return true
        }
      }
      if (hasSiblingCollision(wsId, parentId, 'folder', title)) {
        log(ctx, { ...base, status: 409 })
        ctx.send(409, envelope('folder_name_taken'))
        return true
      }
      const folder: StubDocument = {
        id: ulid('fold'),
        workspaceId: wsId,
        kind: 'folder',
        title,
        filename: title,
        myLevel: 'edit',
        revision: 1,
        position: 0,
        versions: [],
        updatedAt: new Date().toISOString(),
        parentId,
      }
      documents.set(folder.id, folder)
      recordFeedUpsert(folder)
      if (idempotencyKey) folderByKey.set(`${wsId}:${idempotencyKey}`, folder.id)
      log(ctx, { ...base, status: 201 })
      ctx.send(201, { document: documentDto(folder) })
      return true
    }

    m = /^\/workspaces\/([^/]+)\/documents\/files\/blank$/.exec(route)
    if (m && method === 'POST') {
      const wsId = m[1]!
      const raw = await ctx.readBody()
      let body: { format?: unknown; title?: unknown; parent_id?: unknown } = {}
      try {
        body = JSON.parse(raw.toString('utf8')) as typeof body
      } catch {
        body = {}
      }
      const base: Omit<StubCall, 'method' | 'route' | 'status'> = {
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }
      const format =
        body.format === 'docx' || body.format === 'xlsx' || body.format === 'pptx'
          ? body.format
          : null
      const title = typeof body.title === 'string' ? body.title.normalize('NFC').trim() : ''
      if (!format || !title || title.length > 500 || !idempotencyKey) {
        log(ctx, { ...base, status: 400 })
        ctx.send(400, envelope('invalid_request'))
        return true
      }
      const replayedId = blankByKey.get(`${wsId}:${idempotencyKey}`)
      const replayed = replayedId ? documents.get(replayedId) : undefined
      if (replayed) {
        log(ctx, { ...base, status: 201 })
        ctx.send(201, { document: documentDto(replayed) })
        return true
      }
      const parentId =
        typeof body.parent_id === 'string' && body.parent_id.length > 0 ? body.parent_id : null
      if (parentId !== null) {
        const parent = documents.get(parentId)
        if (!parent || parent.workspaceId !== wsId || !isLiveInTree(parent)) {
          log(ctx, { ...base, status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        if (parent.kind !== 'folder') {
          log(ctx, { ...base, status: 422 })
          ctx.send(422, envelope('document_parent_kind'))
          return true
        }
      }
      const filename = title.toLowerCase().endsWith(`.${format}`) ? title : `${title}.${format}`
      const bytes = format === 'docx' ? blankDocxBytes() : Buffer.alloc(0)
      const doc: StubDocument = {
        id: ulid('doc'),
        workspaceId: wsId,
        kind: 'file',
        title,
        filename,
        myLevel: 'edit',
        revision: 1,
        position: 0,
        versions: [{ version: 1, revision: 1, bytes, checksum: sha256(bytes) }],
        updatedAt: new Date().toISOString(),
        parentId,
      }
      documents.set(doc.id, doc)
      recordFeedUpsert(doc)
      blankByKey.set(`${wsId}:${idempotencyKey}`, doc.id)
      log(ctx, { ...base, status: 201 })
      ctx.send(201, { document: documentDto(doc) })
      return true
    }

    m = /^\/workspaces\/([^/]+)\/documents\/files$/.exec(route)
    if (m && method === 'POST') {
      const wsId = m[1]!
      const raw = await ctx.readBody()
      const parsed = multipartForm(raw, String(req.headers['content-type'] ?? ''))
      const file = parsed?.file ?? null
      const base: Omit<StubCall, 'method' | 'route' | 'status'> = {
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(file ? { checksum: sha256(file.bytes) } : {}),
      }
      const rawTitle = parsed?.fields.title ?? file?.filename ?? ''
      const title = rawTitle.normalize('NFC').trim()
      if (!file || !title || title.length > 500 || !idempotencyKey) {
        log(ctx, { ...base, status: 400 })
        ctx.send(400, envelope('invalid_request'))
        return true
      }
      const replayedId = fileByKey.get(`${wsId}:${idempotencyKey}`)
      const replayed = replayedId ? documents.get(replayedId) : undefined
      if (replayed) {
        log(ctx, { ...base, status: 201 })
        ctx.send(201, { document: documentDto(replayed) })
        return true
      }
      const rawParent = parsed?.fields.parent_id ?? ''
      const parentId = rawParent.length > 0 ? rawParent : null
      if (parentId !== null) {
        const parent = documents.get(parentId)
        if (!parent || parent.workspaceId !== wsId || !isLiveInTree(parent)) {
          log(ctx, { ...base, status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        if (parent.kind !== 'folder') {
          log(ctx, { ...base, status: 422 })
          ctx.send(422, envelope('document_parent_kind'))
          return true
        }
      }
      const filename = file.filename || title
      const doc: StubDocument = {
        id: ulid('doc'),
        workspaceId: wsId,
        kind: 'file',
        title,
        filename,
        myLevel: 'edit',
        revision: 1,
        position: 0,
        versions: [{ version: 1, revision: 1, bytes: file.bytes, checksum: sha256(file.bytes) }],
        updatedAt: new Date().toISOString(),
        parentId,
      }
      documents.set(doc.id, doc)
      recordFeedUpsert(doc)
      fileByKey.set(`${wsId}:${idempotencyKey}`, doc.id)
      log(ctx, { ...base, status: 201 })
      ctx.send(201, { document: documentDto(doc) })
      return true
    }

    m = /^\/workspaces\/([^/]+)\/documents(\/recent)?$/.exec(route)
    if (m && method === 'GET') {
      const wsId = m[1]!
      const isRecent = Boolean(m[2])
      const query = (url.searchParams.get('q') ?? '').toLowerCase()
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50))
      const offset = Number(url.searchParams.get('cursor')) || 0

      if (!isRecent && url.searchParams.has('parent_id')) {
        const rawParent = url.searchParams.get('parent_id') ?? ''
        const targetParentId = rawParent === '' ? null : rawParent
        if (targetParentId !== null) {
          const parent = documents.get(targetParentId)
          if (
            !parent ||
            parent.workspaceId !== wsId ||
            parent.kind !== 'folder' ||
            !isLiveInTree(parent)
          ) {
            log(ctx, { status: 404 })
            ctx.send(404, envelope('not_found'))
            return true
          }
        }
        const rows = [...documents.values()]
          .filter((d) => d.workspaceId === wsId && isLiveInTree(d) && d.parentId === targetParentId)
          .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
            return a.position - b.position || a.title.localeCompare(b.title)
          })
        const page = rows.slice(offset, offset + limit)
        log(ctx, { status: 200 })
        ctx.send(200, {
          documents: page.map((d) => summaryDto(d)),
          next_cursor: offset + limit < rows.length ? String(offset + limit) : null,
        })
        return true
      }

      if (!isRecent && url.searchParams.get('match') === 'title') {
        const kindParam = url.searchParams.get('kind')
        const rows = [...documents.values()].filter((d) => {
          if (d.workspaceId !== wsId || !isLiveInTree(d)) return false
          if (kindParam === 'folder' && d.kind !== 'folder') return false
          if (kindParam === 'document' && d.kind === 'folder') return false
          return d.title.toLowerCase().includes(query)
        })
        const page = rows.slice(offset, offset + limit)
        log(ctx, { status: 200 })
        ctx.send(200, {
          documents: page.map((d) => summaryDto(d, true)),
          next_cursor: offset + limit < rows.length ? String(offset + limit) : null,
        })
        return true
      }

      const rows = [...documents.values()]
        .filter(
          (d) =>
            d.workspaceId === wsId &&
            d.kind === 'file' &&
            !d.archivedAt &&
            d.title.toLowerCase().includes(query),
        )
        .reverse()
      const page = rows.slice(offset, offset + limit)
      log(ctx, { status: 200 })
      ctx.send(200, {
        documents: page.map((d) => summaryDto(d)),
        next_cursor: offset + limit < rows.length ? String(offset + limit) : null,
      })
      return true
    }

    m =
      /^\/documents\/([^/]+)(\/download|\/uploads|\/versions\/commit|\/copies|\/archive|\/move)?$/.exec(
        route,
      )
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

      if (method === 'PATCH' && tail === '') {
        const raw = await ctx.readBody()
        let body: { revision?: unknown; title?: unknown } = {}
        try {
          body = JSON.parse(raw.toString('utf8')) as typeof body
        } catch {
          body = {}
        }
        const base: Omit<StubCall, 'method' | 'route' | 'status'> = {
          ...(idempotencyKey ? { idempotencyKey } : {}),
        }
        if (!doc || !isLiveInTree(doc)) {
          log(ctx, { ...base, status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        if (doc.myLevel !== 'edit' && doc.myLevel !== 'manage') {
          log(ctx, { ...base, status: 403 })
          ctx.send(403, envelope('forbidden'))
          return true
        }
        const title = typeof body.title === 'string' ? body.title.normalize('NFC').trim() : ''
        // folder 1-255, page/file 1-500 (contract section 2)
        const maxTitle = doc.kind === 'folder' ? 255 : 500
        if (!title || title.length > maxTitle || typeof body.revision !== 'string') {
          log(ctx, { ...base, status: 400 })
          ctx.send(400, envelope('invalid_request'))
          return true
        }
        if (String(doc.revision) !== body.revision) {
          log(ctx, { ...base, status: 409 })
          ctx.send(409, envelope('revision_conflict', { current_revision: String(doc.revision) }))
          return true
        }
        if (
          doc.kind === 'folder' &&
          hasSiblingCollision(doc.workspaceId, doc.parentId, 'folder', title, doc.id)
        ) {
          log(ctx, { ...base, status: 409 })
          ctx.send(409, envelope('folder_name_taken'))
          return true
        }
        doc.title = title
        if (doc.kind === 'file') doc.filename = title
        doc.revision += 1
        doc.updatedAt = new Date().toISOString()
        recordFeedUpsert(doc)
        log(ctx, { ...base, status: 200 })
        ctx.send(200, { document: documentDto(doc) })
        return true
      }

      if (method === 'POST' && tail === '/move') {
        const raw = await ctx.readBody()
        let body: { parent_id?: unknown; revision?: unknown } = {}
        try {
          body = JSON.parse(raw.toString('utf8')) as typeof body
        } catch {
          body = {}
        }
        const base: Omit<StubCall, 'method' | 'route' | 'status'> = {
          ...(idempotencyKey ? { idempotencyKey } : {}),
        }
        if (!doc || !isLiveInTree(doc)) {
          log(ctx, { ...base, status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        if (doc.myLevel !== 'edit' && doc.myLevel !== 'manage') {
          log(ctx, { ...base, status: 403 })
          ctx.send(403, envelope('forbidden'))
          return true
        }
        if (typeof body.revision !== 'string') {
          log(ctx, { ...base, status: 400 })
          ctx.send(400, envelope('invalid_request'))
          return true
        }
        if (String(doc.revision) !== body.revision) {
          log(ctx, { ...base, status: 409 })
          ctx.send(409, envelope('revision_conflict', { current_revision: String(doc.revision) }))
          return true
        }
        const targetParentId =
          typeof body.parent_id === 'string' && body.parent_id.length > 0 ? body.parent_id : null
        if (targetParentId !== null) {
          const target = documents.get(targetParentId)
          if (!target || target.workspaceId !== doc.workspaceId || !isLiveInTree(target)) {
            log(ctx, { ...base, status: 404 })
            ctx.send(404, envelope('not_found'))
            return true
          }
          if (target.kind !== 'folder') {
            log(ctx, { ...base, status: 422 })
            ctx.send(422, envelope('document_parent_kind'))
            return true
          }
          if (
            doc.kind === 'folder' &&
            (targetParentId === doc.id || ancestorsOf(target).some((a) => a.id === doc.id))
          ) {
            log(ctx, { ...base, status: 422 })
            ctx.send(422, envelope('document_cycle'))
            return true
          }
        }
        const resolved = resolveMoveTitle(doc, targetParentId)
        if (!resolved.ok) {
          log(ctx, { ...base, status: 409 })
          ctx.send(409, envelope('folder_name_taken'))
          return true
        }
        doc.parentId = targetParentId
        doc.title = resolved.title
        if (doc.kind === 'file') doc.filename = resolved.title
        doc.revision += 1
        doc.updatedAt = new Date().toISOString()
        recordFeedUpsert(doc)
        log(ctx, { ...base, status: 200 })
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

      if (method === 'POST' && tail === '/copies') {
        const raw = await ctx.readBody()
        let body: { consent?: unknown; title?: unknown; parent_id?: unknown } = {}
        try {
          body = JSON.parse(raw.toString('utf8')) as typeof body
        } catch {
          body = {}
        }
        const base: Omit<StubCall, 'method' | 'route' | 'status'> = {
          ...(idempotencyKey ? { idempotencyKey } : {}),
        }
        if (!doc) {
          log(ctx, { ...base, status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        if (doc.myLevel !== 'edit' && doc.myLevel !== 'manage') {
          log(ctx, { ...base, status: 403 })
          ctx.send(403, envelope('forbidden'))
          return true
        }
        // BE-12-201: the seat refusal has its own code; a plain `forbidden` is never "no seat"
        if (copiesDenied) {
          log(ctx, { ...base, status: 403 })
          ctx.send(403, envelope('workspace_seat_required'))
          return true
        }
        if (body.consent !== 'copy') {
          log(ctx, { ...base, status: 409 })
          ctx.send(409, envelope('copy_consent_required'))
          return true
        }
        if (!idempotencyKey) {
          log(ctx, { ...base, status: 400 })
          ctx.send(400, envelope('invalid_request'))
          return true
        }
        const known = documents.get(copyByKey.get(`${doc.id}:${idempotencyKey}`) ?? '')
        const title =
          typeof body.title === 'string' && body.title ? body.title : `${doc.title} (copy)`
        const copy: StubDocument = known ?? {
          id: ulid('doc'),
          workspaceId: doc.workspaceId,
          kind: 'file',
          title,
          filename: title,
          myLevel: doc.myLevel,
          // the copy starts as the source's head bytes: version 1, revision 1
          revision: 1,
          position: 0,
          versions: [
            { version: 1, revision: 1, bytes: latest(doc).bytes, checksum: latest(doc).checksum },
          ],
          updatedAt: new Date().toISOString(),
          parentId: typeof body.parent_id === 'string' ? body.parent_id : null,
          copiedFrom: doc.id,
        }
        documents.set(copy.id, copy)
        copyByKey.set(`${doc.id}:${idempotencyKey}`, copy.id)
        log(ctx, { ...base, status: 201 })
        ctx.send(201, { document: documentDto(copy) })
        return true
      }

      if (method === 'POST' && tail === '/archive') {
        if (!doc) {
          log(ctx, { status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        // the server's pristineCopyCleanup: a creator with edit may only archive a copy that
        // still holds version 1; once the person's bytes landed (version 2) it is refused
        if (doc.versions.length > 1 && doc.myLevel !== 'manage') {
          log(ctx, { ...(idempotencyKey ? { idempotencyKey } : {}), status: 403 })
          ctx.send(403, envelope('forbidden'))
          return true
        }
        doc.archivedAt ??= new Date().toISOString()
        log(ctx, { ...(idempotencyKey ? { idempotencyKey } : {}), status: 200 })
        ctx.send(200, { document: documentDto(doc) })
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

      if (method === 'GET' && tail === '/versions/commit') {
        // the commit-intent lookup: what became of the commit made with this key
        const stored = doc ? commitByKey.get(`${doc.id}:${idempotencyKey ?? ''}`) : undefined
        if (!doc || !idempotencyKey) {
          log(ctx, { ...(idempotencyKey ? { idempotencyKey } : {}), status: doc ? 400 : 404 })
          ctx.send(doc ? 400 : 404, envelope(doc ? 'invalid_request' : 'not_found'))
          return true
        }
        log(ctx, { idempotencyKey, status: 200 })
        if (!stored) {
          ctx.send(200, { outcome: 'not_committed' })
          return true
        }
        const committed = stored.body as {
          document: { revision: string }
          version: { id: string; version: number }
        }
        ctx.send(200, {
          outcome: 'committed',
          version_id: committed.version.id,
          version: committed.version.version,
          revision: committed.document.revision,
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
        const dropMode = commitDrops[0] ?? null
        if (dropMode === 'before') {
          consumeDrop()
          log(ctx, { ...base, status: 'dropped' })
          req.socket.destroy()
          return true
        }
        if (!doc) {
          log(ctx, { ...base, status: 404 })
          ctx.send(404, envelope('not_found'))
          return true
        }
        if (doc.copiedFrom && copyCommitFailures > 0) {
          copyCommitFailures -= 1
          log(ctx, { ...base, status: 503 })
          ctx.send(503, envelope('unavailable'))
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
            consumeDrop()
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
          consumeDrop()
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

  const base = await startUniworkAuthStub({
    extend: async (ctx) => (await documentsRoute(ctx)) || workRoute(ctx),
  })

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
        kind: 'file',
        title: init.filename,
        filename: init.filename,
        myLevel: init.myLevel ?? 'edit',
        revision: 41,
        position: 0,
        versions: [{ version: 3, revision: 41, bytes: init.bytes, checksum: sha256(init.bytes) }],
        updatedAt: '2026-10-08T09:00:00Z',
        parentId: init.parentId ?? null,
      }
      documents.set(id, doc)
      recordFeedUpsert(doc)
      return stateOf(doc)
    },
    addFolder(init) {
      const id = init.id ?? ulid('fold')
      const title = init.title.normalize('NFC').trim()
      const folder: StubDocument = {
        id,
        workspaceId: init.workspaceId ?? STUB_WORKSPACE.id,
        kind: 'folder',
        title,
        filename: title,
        myLevel: init.myLevel ?? 'edit',
        revision: 1,
        position: init.position ?? 0,
        versions: [],
        updatedAt: '2026-10-08T09:00:00Z',
        parentId: init.parentId ?? null,
      }
      documents.set(id, folder)
      recordFeedUpsert(folder)
      return folderStateOf(folder)
    },
    state: (documentId) => stateOf(need(documentId)),
    documents: (workspaceId = STUB_WORKSPACE.id) =>
      [...documents.values()]
        .filter((d) => d.workspaceId === workspaceId && d.kind === 'file')
        .map(stateOf),
    folderState: (folderId) => folderStateOf(need(folderId)),
    folders: (workspaceId = STUB_WORKSPACE.id) =>
      [...documents.values()]
        .filter((d) => d.workspaceId === workspaceId && d.kind === 'folder')
        .map(folderStateOf),
    enableFeed(enabled = true) {
      feedEnabled = enabled
    },
    webMove(id, parentId) {
      const doc = need(id)
      const resolved = resolveMoveTitle(doc, parentId)
      if (!resolved.ok) throw new Error(`stub webMove collision exhausted for ${id}`)
      doc.parentId = parentId
      doc.title = resolved.title
      if (doc.kind === 'file') doc.filename = resolved.title
      doc.revision += 1
      doc.updatedAt = new Date().toISOString()
      recordFeedUpsert(doc)
      return {
        id: doc.id,
        title: doc.title,
        parentId: doc.parentId,
        revision: String(doc.revision),
      }
    },
    webRename(id, title) {
      const doc = need(id)
      const clean = title.normalize('NFC').trim()
      doc.title = clean
      if (doc.kind === 'file') doc.filename = clean
      doc.revision += 1
      doc.updatedAt = new Date().toISOString()
      recordFeedUpsert(doc)
      return {
        id: doc.id,
        title: doc.title,
        parentId: doc.parentId,
        revision: String(doc.revision),
      }
    },
    webArchive(id) {
      const doc = need(id)
      doc.archivedAt = new Date().toISOString()
      doc.revision += 1
      doc.updatedAt = doc.archivedAt
      recordFeedUpsert(doc)
      return {
        id: doc.id,
        archived: true,
        revision: String(doc.revision),
      }
    },
    webRestore(id) {
      const doc = need(id)
      delete doc.archivedAt
      doc.revision += 1
      doc.updatedAt = new Date().toISOString()
      recordFeedUpsert(doc)
      return {
        id: doc.id,
        archived: false,
        revision: String(doc.revision),
      }
    },
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
      recordFeedUpsert(doc)
      return stateOf(doc)
    },
    setAccess(documentId, level) {
      need(documentId).myLevel = level
    },
    failNextCommit(mode = 'before', count = 1) {
      commitDrops = Array.from({ length: count }, () => mode)
    },
    failCommitsInOrder(modes) {
      commitDrops = [...modes]
    },
    denyCopies(denied = true) {
      copiesDenied = denied
    },
    failCopyCommits(count) {
      copyCommitFailures = count
    },
    copiesOf: (sourceId) =>
      [...documents.values()]
        .filter((d) => d.copiedFrom === sourceId)
        .map((d) => ({
          id: d.id,
          title: d.title,
          parentId: d.parentId,
          archived: !!d.archivedAt,
          state: stateOf(d),
        })),
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
