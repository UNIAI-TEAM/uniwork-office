import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocSummary, UniworkDocStatus } from '../src/shared/home-api'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import {
  BINDING_FILE,
  INTENT_PAYLOAD_FILE,
  LAST_OWNER_FILE,
} from '../src/main/uniwork-docs/binding-store'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { UPLOAD_EXTENSIONS } from '../src/main/uniwork-docs/formats'
import {
  TREE_CHANGED_WINDOW_MS,
  createTreeChangedCoalescer,
} from '../src/main/uniwork-docs/tree-changed'
import {
  createSyncStoreAccess,
  SYNC_STORE_REGISTRATIONS,
  type SyncStoreAccess,
} from '../src/main/uniwork-sync/session-store'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * G8-17 S18: create a blank document, upload a file, rename, archive / restore
 * — the main-process half. The D routes are the ones contract-G8-17-ipc.md §4
 * cites; these tests drive the real HTTP client against a small fake server and
 * assert the calls, the one-document rule, the `my_level` gate and the name
 * errors the renderer shows at the field.
 */

const ORIGIN = 'https://uniwork.example'
const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const TOKEN = 'tok'
const WS = 'ws_1'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string) => json(status, { error: { code, message: 'x' } })
const enc = (text: string) => new TextEncoder().encode(text)

/**
 * R2-1: an upload must be cancellable while its file is still being stat'ed, so
 * the service registers the upload's AbortController before that await. The
 * test below holds `stat` open to land the Cancel inside it; with the gate
 * unset this mock is the real module.
 */
const statGate = vi.hoisted(() => ({
  held: null as Promise<void> | null,
  entered: null as (() => void) | null,
}))

/**
 * S01-R4-1: size can also change between the stat and the read, and the buffer
 * is what actually leaves. A test names the one path whose read is held open -
 * the gate matches on the path, so a binding or working-copy read is never
 * held - and grows the file inside that window. With no path set this mock is
 * the real module.
 */
const readGate = vi.hoisted(() => ({
  path: null as string | null,
  held: null as Promise<void> | null,
  entered: null as (() => void) | null,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: vi.fn(async (...args: Parameters<typeof actual.stat>) => {
      statGate.entered?.()
      if (statGate.held) await statGate.held
      return actual.stat(...args)
    }),
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      if (readGate.path !== null && String(args[0]) === readGate.path) {
        readGate.entered?.()
        if (readGate.held) await readGate.held
      }
      return actual.readFile(...args)
    }),
  }
})

/** a one-shot latch: `reached` fires when the code hits it, `release` opens it */
function latch() {
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = new Promise<void>((resolve) => {
    entered = resolve
  })
  return { held, release, reached, entered }
}

afterEach(() => {
  statGate.held = null
  statGate.entered = null
  readGate.path = null
  readGate.held = null
  readGate.entered = null
})

interface Call {
  method: string
  path: string
  query: string
  idempotencyKey: string
  body?: unknown
}

/** a small UniWork documents server: create blank/upload, rename, archive/restore, folders */
function fakeServer(
  options: {
    myLevel?: string
    bytes?: Uint8Array
    title?: string
    /** a 409 `conflict` on create/rename (never a name error: duplicate names are allowed) */
    nameTaken?: boolean
    /** D's bare 400 `invalid_request` for a title over 500 runes, on create/rename */
    nameRefused?: boolean
    /** a conflict on archive/restore */
    lifecycleConflict?: boolean
    /** D's `my_level` is omitempty: absent on a row the caller may not edit (default view) */
    omitMyLevel?: boolean
    /** an older row without the `file` block (omitempty): the title extension decides */
    omitListFile?: boolean
    /**
     * holds the upload POST open until it settles, so a test can cancel a
     * request already in flight (the abort rejects it, as real fetch does)
     */
    uploadGate?: () => Promise<void>
    /** FD-11: the kind the document rows answer with (a folder has no file block in spirit) */
    kind?: 'file' | 'folder' | 'page'
    /** FD-11: D's 409 `folder_name_taken` on create/rename of a folder */
    folderNameTaken?: boolean
    /**
     * FD-11: D's 422 `document_too_deep` on a folder create; a number/string is
     * the envelope's `max`, null omits it (the app then uses the server default)
     */
    deepMax?: number | string | null
    /** FD-11: a move whose target already holds the name renames the entry "Name (2)" */
    moveRenames?: boolean
    /**
     * SAVE-01 / MYFOLDER-01: D's 409 `my_folder_locked` (error_class
     * "conflict") on rename/move/archive of the My Folder row itself
     */
    myFolderLocked?: boolean
    /** SAVE-01: D's bare 400 `invalid_destination` on the create routes */
    invalidDestination?: boolean
    /**
     * SAVE-01 r2 (S01-R1-4): the create POST waits on this latch, so a second
     * submit can be issued while the first is still in flight
     */
    createGate?: () => Promise<void>
    /**
     * SAVE-01 r2 (S01-R1-4): the create lands (the document exists) but its
     * answer is lost once - D's idempotent retry then serves the same row to
     * the retried key
     */
    createAnswerLost?: boolean
    /** SAVE-01 r2 (S01-R1-2): these document ids answer a detail GET with a 5xx */
    getDocumentFailsFor?: string[]
    /** SAVE-01 r2 (S01-R1-2): these document ids refuse archive with a 409 */
    archiveFailsFor?: string[]
    /**
     * SAVE-01 r3 (S01-R2-3): the FIRST non-deduped create answers D's
     * fingerprint refusal `idempotency_payload_mismatch` (the key was replayed
     * against a different body); the flag is consumed once
     */
    createMismatch?: boolean
    /**
     * SAVE-01 r3 (S01-R3-3): the FIRST non-deduped create answers 409
     * `idempotency_in_flight` (D's "this key already has a request running"
     * verdict after the row was seeded); the flag is consumed once, so an
     * unchanged-body retry replays the retained key and dedupes to that row
     */
    createInFlight?: boolean
    /**
     * SAVE-01 merge M-2 (D-S1): the `documents.limits` the `GET /api/v1/config`
     * answers with. Unset keeps D's 404, which the client turns into the
     * default caps (209,715,200 bytes) - the upload tests' own preflight.
     */
    limits?: unknown
    /**
     * SAVE-01 r4 (S01-R4-3): D's own 413 `document_too_large` on the
     * upload/first-save create - the server refusing bytes the local preflight
     * let through (a stale limits cache, or a cap lowered after the read). The
     * envelope carries no `fields`, so the only size detail a caller can hand
     * the renderer is its own; no row is created.
     */
    createTooLarge?: boolean
    /** BIGUP-A1: the server's chunked threshold, answered by `GET /api/v1/config` */
    chunkedThreshold?: number
    /** BIGUP-A1: the session create refuses with 422 `upload_session_too_small` */
    sessionTooSmall?: boolean
    /** BIGUP-A1: the session create refuses with 415 `unsupported_media_type` */
    sessionRefused?: boolean
    /** BIGUP-A1: the part size the session answers with */
    sessionPartSize?: number
    /** BIGUP-A1: holds a part PUT open until it settles, so a test can cancel it */
    partGate?: () => Promise<void>
    /** BIGUP-A1: this part PUT is refused once with a non-retryable 415 */
    partFailsOnceAt?: number
    /**
     * R1-BE-04: the bytes the session's storage accumulates from the part PUTs,
     * so `complete` creates a document whose `checksum_sha256` is the truth
     * about what the server actually holds (the verification compares it).
     */
    sessionAssemblesParts?: boolean
    /** R1-BE-04: holds the session `complete` open until it settles */
    sessionCompleteGate?: () => Promise<void>
    /** R1-BE-08: the first session create answers 409 idempotency_payload_mismatch */
    sessionCreateMismatch?: boolean
    /** R1-BE-02: the session DELETE answers 500, so the abort is not reported clean */
    sessionDeleteRefused?: boolean
    /**
     * S01-R2-4: answers a first-save create BEFORE D's dedupe, by Idempotency-Key
     * (null falls through). Models a key D never committed (503, expired claim)
     * or one whose document is gone (404) without seeding a row.
     */
    createKeyAnswer?: (idempotencyKey: string) => Response | null
    /** S01-R2-4: the same hook for the upload-session open of a chunked first save */
    sessionOpenAnswer?: (idempotencyKey: string) => Response | null
    /** S01-R2-4: the FIRST session `complete` answers 410 `upload_session_expired` */
    sessionCompleteExpiredOnce?: boolean
  } = {},
) {
  const state = {
    id: DOC,
    title: options.title ?? 'Q4 plan.docx',
    kind: options.kind ?? 'file',
    myLevel: options.myLevel ?? 'manage',
    bytes: options.bytes ?? enc('v1 bytes'),
    archived: false,
    revision: 41,
    /** every document the server now holds, by id */
    documents: new Map<string, { title: string; bytes: Uint8Array; archived?: boolean }>(),
    /** D's create dedupe: the row id a create Idempotency-Key produced */
    createdByKey: new Map<string, string>(),
    /** checksum_sha256 the upload POST answered, keyed by its upload_id */
    uploadChecksums: new Map<string, string>(),
    /** the upload POSTs still running (upload_id order) */
    uploadSeq: 0,
    /** BIGUP-A1: the open upload session, and the parts `complete` named */
    session: null as {
      sessionId: string
      filename: string
      sizeBytes: number
      parentId: string | null
      title: string | null
      /** the Idempotency-Key the session was opened with */
      key: string
    } | null,
    sessionSeq: 0,
    /** S01-R2-4 fix1: D replays an open key to the document its first run completed */
    docByOpenKey: new Map<string, string>(),
    completedParts: [] as Array<{ part_number: number; etag: string }>,
    /** BIGUP-A1: the parts a `partFailsOnceAt` run has already refused */
    failedParts: new Set<number>(),
    /**
     * R1-BE-04: the session storage's own bytes, assembled from the part PUTs
     * when `sessionAssemblesParts` is set. `complete` then creates a document
     * whose `checksum_sha256` is the truth about what the server holds, which is
     * what the app's post-upload verification compares against.
     */
    sessionBytes: new Uint8Array(0),
    /** R1-BE-08: the `sessionCreateMismatch` verdict has been spent */
    sessionMismatchSpent: false,
  }
  let seq = 0
  /** every request the fake saw, in order */
  const calls: Call[] = []

  const docJson = (id: string) => ({
    id,
    organization_id: 'org_a',
    workspace_id: WS,
    title: id === DOC ? state.title : (state.documents.get(id)?.title ?? 'new.docx'),
    kind: state.kind,
    revision: String(state.revision),
    current_version: 1,
    ...(options.omitMyLevel ? {} : { my_level: state.myLevel }),
    ...(state.archived && id === DOC ? { archived_at: '2026-10-13T09:00:00Z' } : {}),
    file: {
      file_id: `f_${id}`,
      version_id: `v_${id}`,
      version: 1,
      filename: state.title,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: (id === DOC ? state.bytes : (state.documents.get(id)?.bytes ?? enc('x')))
        .byteLength,
      checksum_sha256: hex(id === DOC ? state.bytes : (state.documents.get(id)?.bytes ?? enc('x'))),
    },
  })

  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    const call: Call = {
      method: init.method ?? 'GET',
      path: u.pathname,
      query: u.search,
      idempotencyKey: headers['idempotency-key'] ?? '',
    }
    calls.push(call)

    // SAVE-01 merge M-2 (D-S1): SIZE-F1's `documents.limits` read, the one the
    // upload path makes and the first save now shares
    if (u.pathname === '/api/v1/config') {
      if (options.limits === undefined && options.chunkedThreshold === undefined) {
        return envelope(404, 'not_found')
      }
      const limits =
        typeof options.limits === 'object' && options.limits !== null ? { ...options.limits } : {}
      if (options.chunkedThreshold !== undefined) {
        ;(limits as Record<string, unknown>).chunked_upload_threshold_bytes =
          options.chunkedThreshold
      }
      return json(200, { limits })
    }

    // create blank
    if (u.pathname === `/api/v1/workspaces/${WS}/documents/files/blank`) {
      call.body = JSON.parse(String(init.body))
      if (options.nameTaken) return envelope(409, 'conflict')
      if (options.nameRefused) return envelope(400, 'invalid_request')
      // MYFOLDER-01: a create that mixes destination and parent_id, or names an
      // unknown destination, is refused before the document exists
      if (options.invalidDestination) {
        return json(400, { error: { code: 'invalid_destination', message: 'x' } })
      }
      const id = `new_${++seq}`
      const title = (call.body as { title: string }).title
      state.documents.set(id, { title, bytes: enc('blank') })
      // D stores the title verbatim while the first version's file is
      // untitled.<format>, so a name without an extension must not decide the row
      return json(201, {
        document: {
          ...docJson(id),
          title,
          file: { ...docJson(id).file, filename: 'untitled.docx' },
        },
      })
    }
    // upload / first-save create (multipart)
    if (u.pathname === `/api/v1/workspaces/${WS}/documents/files`) {
      // an in-flight request a test cancels mid-POST: fetch rejects an aborted
      // signal, the body never being read here
      if (options.uploadGate) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            const error = new Error('The operation was aborted.')
            error.name = 'AbortError'
            reject(error)
          }
          if (init.signal?.aborted) abort()
          else init.signal?.addEventListener('abort', abort, { once: true })
          options.uploadGate!().then(resolve, reject)
        })
      }
      // SAVE-01 r2: a held create keeps both submit windows open
      if (options.createGate) await options.createGate()
      const form = init.body as FormData
      const file = form.get('file') as File
      const bytes = new Uint8Array(await file.arrayBuffer())
      call.body = {
        title: form.get('title'),
        parent_id: form.get('parent_id'),
        destination: form.get('destination'),
        name: file.name,
        bytes,
      }
      if (options.invalidDestination) {
        return json(400, { error: { code: 'invalid_destination', message: 'x' } })
      }
      const keyAnswer = options.createKeyAnswer?.(call.idempotencyKey)
      if (keyAnswer) return keyAnswer
      // SAVE-01 r4 (S01-R4-3): D refuses the bytes itself - after the caller's
      // preflight passed - and no row is created. The envelope names only the
      // code, so the filename and the payload length can come from the caller.
      if (options.createTooLarge) {
        return json(413, { error: { code: 'document_too_large', message: 'x' } })
      }
      // SAVE-01 r2 (S01-R1-4): D dedupes a retried create by its
      // Idempotency-Key - the same row answers again, never a second document
      const keyed = state.createdByKey.get(call.idempotencyKey)
      if (keyed) {
        const held = state.documents.get(keyed)
        return json(201, { document: { ...docJson(keyed), title: held?.title ?? file.name } })
      }
      const id = `up_${++seq}`
      state.documents.set(id, { title: file.name, bytes })
      state.createdByKey.set(call.idempotencyKey, id)
      // SAVE-01 r3 (S01-R2-3): D refuses a key whose fingerprint does not match
      // this body's checksum (fileCreateFingerprint, document_files.go:315) -
      // one refusal only, so a retry with a fresh key proceeds
      if (options.createMismatch) {
        options.createMismatch = false
        return envelope(409, 'idempotency_payload_mismatch')
      }
      // SAVE-01 r3 (S01-R3-3): the row is seeded under this key but the create
      // answers D's in-flight verdict once - an unchanged-body retry replays
      // the retained key and dedupes to the seeded row above
      if (options.createInFlight) {
        options.createInFlight = false
        return envelope(409, 'idempotency_in_flight')
      }
      // the row exists; only the answer was lost (S01-R1-4): the retry of the
      // same key replays the create instead of minting a twin. One-shot: a
      // retry under a NEW key (edited bytes, S01-R2-3) proceeds normally
      if (options.createAnswerLost) {
        options.createAnswerLost = false
        return envelope(503, 'unavailable')
      }
      return json(201, { document: { ...docJson(id), title: file.name } })
    }
    // recent (the flat library list without a search query)
    if (u.pathname === `/api/v1/workspaces/${WS}/documents/recent`) {
      return json(200, {
        documents: [
          {
            id: DOC,
            kind: 'file',
            title: state.title,
            workspace_id: WS,
            updated_at: '2026-10-13T09:00:00Z',
            my_level: state.myLevel,
            // D's DocumentDTO carries the file block on every kind=file row
            ...(options.omitListFile ? {} : { file: docJson(DOC).file }),
          },
        ],
        next_cursor: null,
      })
    }
    // SAVE-01 / MYFOLDER-01: ensure the caller's personal folder (idempotent:
    // the same DocumentSDO row answers on every call, system_kind marks it)
    if (u.pathname === `/api/v1/workspaces/${WS}/documents/my-folder`) {
      if (!state.documents.has('fold_my')) {
        state.documents.set('fold_my', { title: 'My Folder', bytes: enc('') })
      }
      return json(200, {
        document: {
          ...docJson('fold_my'),
          kind: 'folder',
          title: 'My Folder',
          system_kind: 'my_folder',
        },
      })
    }
    // folders
    if (u.pathname === `/api/v1/workspaces/${WS}/documents`) {
      // FD-11: create one folder (or refuse it with the server's own code)
      if (call.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          kind?: string
          title?: string
          parent_id?: string
        }
        call.body = body
        if (options.folderNameTaken) return envelope(409, 'folder_name_taken')
        // MYFOLDER-01: destination on a folder create is refused the same way
        if (options.invalidDestination) {
          return json(400, { error: { code: 'invalid_destination', message: 'x' } })
        }
        if (options.deepMax !== undefined) {
          return json(422, {
            error: {
              code: 'document_too_deep',
              message: 'x',
              ...(options.deepMax === null ? {} : { fields: { max: options.deepMax } }),
            },
          })
        }
        const id = `fold_${++seq}`
        state.documents.set(id, { title: body.title ?? 'folder', bytes: enc('') })
        return json(201, {
          document: {
            ...docJson(id),
            kind: 'folder',
            title: body.title ?? 'folder',
            parent_id: body.parent_id ?? null,
          },
        })
      }
      return json(200, {
        documents: [
          {
            id: 'fold_1',
            kind: 'folder',
            title: 'Contracts',
            updated_at: '2026-10-13T09:00:00Z',
          },
          {
            id: 'doc_x',
            kind: 'file',
            title: 'ignored.docx',
            updated_at: '2026-10-13T09:00:00Z',
          },
        ],
        next_cursor: null,
      })
    }
    // archive / restore
    const archive = /^\/api\/v1\/documents\/([A-Za-z0-9_-]+)\/archive$/.exec(u.pathname)
    if (archive) {
      const id = archive[1]!
      if (options.lifecycleConflict) return envelope(409, 'conflict')
      if (options.myFolderLocked) {
        return json(409, {
          error: { code: 'my_folder_locked', message: 'x', error_class: 'conflict' },
        })
      }
      // SAVE-01 r2 (S01-R1-2): the archive that compensates a bind failure can
      // fail itself - the created row then stays where the create put it
      if (options.archiveFailsFor?.includes(id)) return envelope(409, 'conflict')
      if (id === DOC) {
        state.archived = true
        return json(200, { document: docJson(DOC), affected: [DOC] })
      }
      const entry = state.documents.get(id)
      if (!entry) return envelope(404, 'not_found')
      entry.archived = true
      return json(200, { document: docJson(id), affected: [id] })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/restore`) {
      state.archived = false
      return json(200, { document: docJson(DOC), affected: [DOC] })
    }
    // rename (PATCH)
    if (u.pathname === `/api/v1/documents/${DOC}` && call.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { revision: string; title: string }
      call.body = body
      if (options.nameTaken) return envelope(409, 'conflict')
      if (options.nameRefused) return envelope(400, 'invalid_request')
      // MYFOLDER-01: D answers rename/move/archive of the My Folder row with
      // 409 my_folder_locked and error_class "conflict"
      if (options.myFolderLocked) {
        return json(409, {
          error: { code: 'my_folder_locked', message: 'x', error_class: 'conflict' },
        })
      }
      if (body.revision !== String(state.revision)) {
        return json(422, {
          error: {
            code: 'revision_conflict',
            message: 'x',
            fields: { current_revision: String(state.revision) },
          },
        })
      }
      state.title = body.title
      state.revision += 1
      return json(200, { document: docJson(DOC) })
    }
    // FD-11: move a document or folder (the client reads its revision first)
    const move = /^\/api\/v1\/documents\/([A-Za-z0-9_-]+)\/move$/.exec(u.pathname)
    if (move) {
      const id = move[1]!
      // the fake trusts its own caller's body, like every other route here
      const body: { parent_id: string | null; revision: string } = JSON.parse(String(init.body))
      call.body = body
      if (options.folderNameTaken) return envelope(409, 'folder_name_taken')
      // MYFOLDER-01: a move into (or of) the locked My Folder row refuses
      // before the move mutates anything
      if (options.myFolderLocked) {
        return json(409, {
          error: { code: 'my_folder_locked', message: 'x', error_class: 'conflict' },
        })
      }
      const title = id === DOC ? state.title : (state.documents.get(id)?.title ?? 'new.docx')
      // a name already taken in the target folder is auto-renamed by the server
      const renamed = options.moveRenames ? `${title} (2)` : title
      if (id === DOC) state.title = renamed
      state.revision += 1
      return json(200, {
        document: { ...docJson(id), title: renamed, parent_id: body.parent_id },
      })
    }
    // detail: any document the server holds. D's decideDocumentAccess hides an
    // archived row from anyone below manage (404), while a manager still reads
    // it with its archived_at.
    const detail = /^\/api\/v1\/documents\/([A-Za-z0-9_-]+)$/.exec(u.pathname)
    if (detail && call.method === 'GET') {
      const id = detail[1]!
      // SAVE-01 r2 (S01-R1-2): the bind read can fail after the create landed
      if (options.getDocumentFailsFor?.includes(id)) return envelope(500, 'unavailable')
      if (id !== DOC && !state.documents.has(id)) return envelope(404, 'not_found')
      if (state.archived && id === DOC && state.myLevel !== 'manage') {
        return envelope(404, 'not_found')
      }
      return json(200, { document: docJson(id) })
    }
    // SAVE-01 r2 (S01-R1-8): the bound save's upload + commit pair, mirrored
    // from the save-coordinator fake so a first-saved document can be saved
    // for real in this suite
    const upload = /^\/api\/v1\/documents\/([A-Za-z0-9_-]+)\/uploads$/.exec(u.pathname)
    if (upload && call.method === 'POST') {
      const form = init.body as FormData
      const file = form.get('file') as File
      const bytes = new Uint8Array(await file.arrayBuffer())
      const uploadId = `upl_${++state.uploadSeq}`
      state.uploadChecksums.set(uploadId, hex(bytes))
      call.body = { name: file.name, bytes }
      // the canonical receipt (uniwork-docs-save.test.ts): claim_expires_at
      // is mandatory on the real D shape
      return json(200, {
        upload_id: uploadId,
        checksum_sha256: hex(bytes),
        size_bytes: bytes.byteLength,
        claim_expires_at: '2026-10-17T00:00:00Z',
      })
    }
    const commit = /^\/api\/v1\/documents\/([A-Za-z0-9_-]+)\/versions\/commit$/.exec(u.pathname)
    // the coordinator's intent reconcile reads it too: no intent = not_committed
    if (commit && call.method === 'GET') {
      return json(200, { outcome: 'not_committed' })
    }
    if (commit && call.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { upload_id: string; base_revision: string }
      call.body = body
      const id = commit[1]!
      if (body.base_revision !== String(state.revision)) {
        return envelope(409, 'document_version_conflict')
      }
      state.revision += 1
      return json(200, {
        document: { ...docJson(id), revision: String(state.revision) },
        version: {
          id: `ver_${id}`,
          document_id: id,
          version: 2,
          kind: 'file',
          checksum_sha256: state.uploadChecksums.get(body.upload_id) ?? null,
          size_bytes: 0,
        },
      })
    }
    // download (the open flow): the bytes of the requested document
    const download = /^\/api\/v1\/documents\/([A-Za-z0-9_-]+)\/download$/.exec(u.pathname)
    if (download) {
      const id = download[1]!
      const bytes = id === DOC ? state.bytes : (state.documents.get(id)?.bytes ?? enc('x'))
      return new Response(bytes as BodyInit, { status: 200 })
    }
    // BIGUP-A1: the chunked-upload session routes a file above the server's
    // threshold uses. The part PUTs go to the presigned URLs the answer
    // carries, which this same fake serves below (the client sends them with
    // no auth header and reads the ETag back).
    if (u.pathname === `/api/v1/workspaces/${WS}/documents/upload-sessions`) {
      const body = JSON.parse(String(init.body)) as {
        filename: string
        size_bytes: number
        parent_id?: string | null
        title?: string
      }
      call.body = body
      const openAnswer = options.sessionOpenAnswer?.(call.idempotencyKey)
      if (openAnswer) return openAnswer
      if (options.sessionTooSmall) {
        return json(422, { error: { code: 'upload_session_too_small', message: 'x' } })
      }
      if (options.sessionCreateMismatch && !state.sessionMismatchSpent) {
        state.sessionMismatchSpent = true
        return json(409, { error: { code: 'idempotency_payload_mismatch', message: 'x' } })
      }
      if (options.sessionRefused) {
        return json(415, {
          error: {
            code: 'unsupported_media_type',
            message: 'x',
            fields: { reason: 'zip_macro_part' },
          },
        })
      }
      state.session = {
        filename: body.filename,
        sizeBytes: body.size_bytes,
        parentId: body.parent_id ?? null,
        title: body.title ?? null,
        sessionId: `ups_${++state.sessionSeq}`,
        key: call.idempotencyKey,
      }
      state.completedParts = []
      state.sessionBytes = new Uint8Array(body.size_bytes)
      return json(201, sessionJson())
    }
    if (u.hostname === 'storage.example' && call.method === 'PUT') {
      // a real presigned PUT: an aborted request rejects, exactly as fetch does
      if (options.partGate) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            const error = new Error('The operation was aborted.')
            error.name = 'AbortError'
            reject(error)
          }
          if (init.signal?.aborted) abort()
          else init.signal?.addEventListener('abort', abort, { once: true })
          options.partGate!().then(resolve, reject)
        })
      }
      call.body = { partNumber: Number(u.pathname.split('/').pop()) }
      const partNumber = Number(u.pathname.split('/').pop())
      if (options.partFailsOnceAt === partNumber && !state.failedParts.has(partNumber)) {
        state.failedParts.add(partNumber)
        return envelope(415, 'unsupported_media_type')
      }
      // R1-BE-04: the storage keeps what it was sent, so `complete`'s document
      // checksum is the truth about the server's bytes
      if (options.sessionAssemblesParts) {
        const body = (init.body as Uint8Array | undefined) ?? new Uint8Array(0)
        const partSize = options.sessionPartSize ?? 8 * 1024 * 1024
        state.sessionBytes.set(body, (partNumber - 1) * partSize)
      }
      return new Response(null, {
        status: 200,
        headers: { ETag: `"etag-${u.pathname.split('/').pop()}"` },
      })
    }
    const sessionRoute = /^\/api\/v1\/upload-sessions\/([A-Za-z0-9_-]+)(\/complete)?$/.exec(
      u.pathname,
    )
    if (sessionRoute) {
      const session = state.session
      if (!session || session.sessionId !== sessionRoute[1]) {
        return json(404, { error: { code: 'not_found', message: 'x' } })
      }
      if (call.method === 'DELETE') {
        if (options.sessionDeleteRefused) return envelope(500, 'server_error')
        state.session = null
        return new Response(null, { status: 204 })
      }
      if (sessionRoute[2]) {
        const body = JSON.parse(String(init.body)) as {
          parts: Array<{ part_number: number; etag: string }>
        }
        call.body = body
        // R1-BE-04: holds the validation open so a test can change the source
        // while the server is checking the uploaded bytes
        if (options.sessionCompleteGate) await options.sessionCompleteGate()
        if (options.sessionCompleteExpiredOnce) {
          options.sessionCompleteExpiredOnce = false
          state.session = null
          return json(410, { error: { code: 'upload_session_expired', message: 'x' } })
        }
        state.completedParts = body.parts
        const replayed = state.docByOpenKey.get(session.key)
        if (replayed) {
          return json(200, {
            document: {
              ...docJson(replayed),
              title: session.title ?? session.filename,
              file: { ...docJson(replayed).file, filename: session.filename },
            },
          })
        }
        const id = `new_${++seq}`
        state.docByOpenKey.set(session.key, id)
        // R1-BE-04: the created document's bytes are what the storage actually
        // assembled (when the fake keeps them), so its checksum_sha256 is the
        // truth the app's post-upload verification compares against
        const bytes = options.sessionAssemblesParts ? state.sessionBytes : enc('big bytes')
        state.documents.set(id, {
          title: session.title ?? session.filename,
          bytes,
        })
        return json(200, {
          document: {
            ...docJson(id),
            title: session.title ?? session.filename,
            file: { ...docJson(id).file, filename: session.filename },
          },
        })
      }
      call.body = undefined
      return json(200, sessionJson())
    }
    return envelope(404, 'not_found')
  })

  const sessionJson = () => {
    const session = state.session!
    const partSize = options.sessionPartSize ?? 8 * 1024 * 1024
    const totalParts = Math.ceil(session.sizeBytes / partSize)
    // relative to now: a fixed date makes every presigned URL "expired" the day it passes
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const held = new Set(state.completedParts.map((part) => part.part_number))
    const parts = []
    for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
      if (held.has(partNumber)) continue
      parts.push({
        part_number: partNumber,
        method: 'PUT',
        url: `https://storage.example/part/${partNumber}`,
        headers: {},
        expires_at: expiresAt,
      })
    }
    return {
      session_id: session.sessionId,
      status: 'open',
      part_size: partSize,
      total_parts: totalParts,
      completed_parts: state.completedParts.map((part) => ({
        part_number: part.part_number,
        etag: part.etag,
        size: partSize,
      })),
      parts,
      expires_at: expiresAt,
    }
  }

  return { state, calls, fetch: fetch as unknown as FetchLike }
}

/** the server reports sha256 hex; the client compares it against the bytes it downloaded */
function hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * BIGUP-A1: a real, minimal DOCX whose bulk is one stored entry, so a test can
 * make a > 20 MiB package without writing 20 MiB of real data. `macro` adds the
 * `vbaProject.bin` part the local probe must refuse.
 */
function buildDocxBytes(bulkBytes: number, options: { macro?: boolean } = {}): Uint8Array {
  const entries: Array<{ name: string; data?: Buffer; storedSize?: number }> = [
    { name: 'word/media/image1.png', storedSize: bulkBytes },
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
  ]
  if (options.macro) entries.push({ name: 'word/vbaProject.bin', data: Buffer.from('macro') })
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const stored = entry.storedSize !== undefined
    const data = entry.data ?? Buffer.alloc(0)
    const body = stored ? null : deflateRawSync(data)
    const size = stored ? entry.storedSize! : data.length
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(stored ? 0 : 8, 8)
    header.writeUInt32LE(0, 14)
    header.writeUInt32LE(body?.length ?? size, 18)
    header.writeUInt32LE(size, 22)
    header.writeUInt16LE(name.length, 26)
    const localOffset = offset
    chunks.push(header, name, ...(body ? [body] : []))
    offset += header.length + name.length + (body?.length ?? 0)
    if (!body) {
      // the bulk entry's own bytes are zeros, left implicit: the ZIP reader
      // only needs the central directory, which the probe checks
      chunks.push(Buffer.alloc(size))
      offset += size
    }
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(stored ? 0 : 8, 10)
    cd.writeUInt32LE(0, 16)
    cd.writeUInt32LE(body?.length ?? size, 20)
    cd.writeUInt32LE(size, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(localOffset, 42)
    central.push(cd, name)
  }
  const cdBuffer = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...chunks, cdBuffer, eocd]))
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-docs-actions-'))
  // The service remembers the live session's account with a fire-and-forget
  // atomic write of last-account.json (`liveIdentity`). Seeding it as the
  // session already having been remembered removes that background write
  // entirely, so nothing can recreate the fixture directory while it is being
  // removed (R1-13) - the write raced the recursive walk and its rmdir.
  mkdirSync(join(dir, 'uniwork-documents'), { recursive: true })
  writeFileSync(
    join(dir, 'uniwork-documents', LAST_OWNER_FILE),
    JSON.stringify({ accountId: 'acc_1', deploymentId: 'default' }),
  )
})
afterEach(async () => {
  // No fixture write is outstanding by design (see above); the retry still
  // absorbs a late atomic write from a service call the test did not await
  // (a feed notice, a focus refresh), whose temp file could otherwise appear
  // between the recursive walk and the rmdir (F4's race, R1-13)
  for (let attempt = 0; ; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt >= 20) throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
})

/** the fake UniWork documents server a setup() wires the service's client to */
type FakeServer = ReturnType<typeof fakeServer>
type FakeServerOptions = NonNullable<Parameters<typeof fakeServer>[0]>

function setup(
  server: FakeServer,
  options: {
    pathOpen?: boolean
    /** SAVE-01: a module Save writes these bytes to the path, then fires onUserSave */
    moduleSaveWrites?: string
    /** SAVE-01 r2: the module answers the Save request with this (default true) */
    moduleSaveResult?: boolean
    /** SAVE-01 r2: the module accepts the Save but its hook never fires (flush timeout) */
    moduleSaveSilent?: boolean
    /** SAVE-01 r2: shrink the first-save flush wait (ms), for the timeout case */
    firstSaveFlushTimeoutMs?: number
    /** SAVE-01 r2: notifyPathRenamed / pushStatus / pushTreeChanged throw */
    callbacksThrow?: boolean
    /** SAVE-01 r2 (S01-R1-8): a real durable sync store under dir (intent saves) */
    syncStore?: boolean
    /**
     * R1-BE-02: the sync store's byte budget. A tiny budget makes the resume
     * store's `put` refuse (`store_full`), so a cancel must still issue its
     * DELETE from the session id the running operation holds in memory.
     */
    syncStoreBudgetBytes?: number
    /** SAVE-01: runs inside notifyPathRenamed, between the bind and its push */
    onPathMoved?: () => void
  } = {},
) {
  const statuses: UniworkDocStatus[] = []
  const renamed: Array<{ documentId: string; title: string }> = []
  const progress: Array<{
    path: string
    loaded: number
    total: number
    phase?: 'uploading' | 'checking'
  }> = []
  const pathRenames: Array<{ oldPath: string; newPath: string }> = []
  const titleRenames: Array<{ path: string; title: string }> = []
  /** FD-11: the tree-changed notices main pushed while the test ran */
  const treeChanged: Array<{ workspaceId: string }> = []
  /** SAVE-01 r2: every path the module's Save was asked to write */
  const moduleSaveCalls: string[] = []
  const uploadFile = join(dir, 'Q3 report.docx')
  writeFileSync(uploadFile, 'uploaded bytes')
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  let currentIdentity: {
    accountId: string
    deviceSessionId: string
    deploymentId: string
  } | null = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
  let currentOrg: { id: string; slug: string } | null = { id: 'org_a', slug: 'acme' }
  let onStopRuntime: (() => void) | undefined
  let onPushTreeChanged: (event: { workspaceId: string }) => void = (event) =>
    treeChanged.push(event)
  // SAVE-01 r2 (S01-R1-8): the durable save queue needs the real store layer -
  // intents, drafts and pause behind a lockable fake keychain under dir
  let syncStore: SyncStoreAccess | undefined
  if (options.syncStore) {
    const layer = createStoreLayer({
      root: join(dir, 'sync-store'),
      keys: createSafeStorageKeyProvider({
        safeStorage: createLockableSafeStorage(),
        dir: join(dir, 'sync-store-keys'),
      }),
      budgetBytes: options.syncStoreBudgetBytes ?? 64 * 1024 * 1024,
      clock: () => Date.now(),
    })
    for (const registration of SYNC_STORE_REGISTRATIONS) layer.register(registration)
    syncStore = createSyncStoreAccess({
      layer,
      scope: () =>
        currentIdentity
          ? { deploymentId: currentIdentity.deploymentId, accountId: currentIdentity.accountId }
          : null,
    })
  }
  const service = new UniworkDocsService({
    userDataDir: dir,
    appVersion: () => '0.0.0',
    profile: () => profile,
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () => currentIdentity,
    keystoreLocked: () => false,
    selectedOrg: () => currentOrg,
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    fetch: (url, init) => server.fetch(url, init),
    openPath: () => true,
    isPathOpen: () => options.pathOpen === true,
    firstSaveFlushTimeoutMs: options.firstSaveFlushTimeoutMs,
    syncStore,
    requestModuleSave: (path) => {
      moduleSaveCalls.push(path)
      if (options.moduleSaveResult === false) return false
      if (!options.moduleSaveSilent) {
        // the module's own Save writes the file, then its user-save hook
        // fires; the queueMicrotask is the renderer round-trip that lands it
        if (options.moduleSaveWrites !== undefined) {
          writeFileSync(path, options.moduleSaveWrites)
        }
        queueMicrotask(() => service.onUserSave(path))
      }
      return true
    },
    reloadPath: () => undefined,
    activePath: () => undefined,
    stopRuntime: () => onStopRuntime?.(),
    pickUploadFile: async () => ({ path: uploadFile, name: basename(uploadFile) }),
    pushUploadProgress: (event) => progress.push(event),
    pushDocRenamed: (event) => renamed.push(event),
    pushTreeChanged: (event) => {
      // SAVE-01 r2 (S01-R1-3): a post-bind callback may throw; the save is
      // already done, so it must not turn the result into a failure
      if (options.callbacksThrow) throw new Error('pushTreeChanged exploded')
      onPushTreeChanged(event)
    },
    notifyPathRenamed: (oldPath, newPath) => {
      if (options.callbacksThrow) throw new Error('notifyPathRenamed exploded')
      pathRenames.push({ oldPath, newPath })
      options.onPathMoved?.()
    },
    notifyTitleRenamed: (path, title) => titleRenames.push({ path, title }),
    ui,
    pushStatus: (s) => {
      if (options.callbacksThrow) throw new Error('pushStatus exploded')
      statuses.push(s)
    },
    pushLaunch: () => undefined,
    reveal: () => undefined,
  })
  return {
    service,
    statuses,
    renamed,
    progress,
    pathRenames,
    titleRenames,
    uploadFile,
    treeChanged,
    moduleSaveCalls,
    setIdentity: (next: typeof currentIdentity) => {
      currentIdentity = next
    },
    setSelectedOrg: (next: typeof currentOrg) => {
      currentOrg = next
    },
    setStopRuntime: (fn: () => void) => {
      onStopRuntime = fn
    },
    setPushTreeChanged: (fn: (event: { workspaceId: string }) => void) => {
      onPushTreeChanged = fn
    },
  }
}

const docDir = (documentId: string): string =>
  join(dir, 'uniwork-documents', 'default', 'acc_1', documentId)

/** the document files of one working-copy folder (binding.json excluded) */
const copiesIn = (documentId: string): string[] =>
  readdirSync(docDir(documentId)).filter((name) => name !== BINDING_FILE)

const binding = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(path, '..', BINDING_FILE), 'utf8')) as Record<string, unknown>

describe('create a blank document', () => {
  it('creates one document and opens it by id, with one local copy bound to that same file', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const created = await ctx.service.createDocument({
      workspaceId: WS,
      folderId: null,
      name: 'Q4 plan',
      format: 'docx',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id = created.value.id
    expect(created.value.title).toBe('Q4 plan')
    // exactly the blank route, with the name and no parent
    const blank = server.calls.find((c) => c.path.endsWith('/documents/files/blank'))!
    expect(blank.method).toBe('POST')
    expect(blank.body).toMatchObject({ format: 'docx', title: 'Q4 plan' })
    expect(blank.idempotencyKey).not.toBe('')

    // the library opens the new document by its id through the one open flow
    const opened = await ctx.service.openDocument(id)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    // one document, one local copy: the binding points at the file just downloaded
    const copies = copiesIn(id)
    expect(copies).toHaveLength(1)
    expect(opened.value.path).toBe(join(docDir(id), copies[0]!))
    expect(binding(opened.value.path)).toMatchObject({ documentId: id, state: 'ready' })
  })

  // R1-2: D keeps the typed title verbatim and its list rows carry only that
  // title, so an extensionless name must not decide the format: the row renders
  // as unsupported and the created document cannot be opened. The file block of
  // the create answer is the name that always carries the extension.
  it('derives the created format from the file block, not an extensionless title', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const created = await ctx.service.createDocument({
      workspaceId: WS,
      folderId: null,
      name: 'Q4 plan',
      format: 'docx',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.title).toBe('Q4 plan')
    expect(created.value.format).toBe('docx')
    expect(created.value.canEdit).toBe(true)
    expect(created.value.canManage).toBe(true)

    // the library row for the same document is openable (format !== null)
    const page = await ctx.service.listDocuments({ workspaceId: WS })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.value.documents[0]!.format).toBe('docx')
  })

  it('refuses an empty (trimmed) name before any request', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const result = await ctx.service.createDocument({
      workspaceId: WS,
      folderId: null,
      name: '   ',
      format: 'docx',
    })
    expect(result).toEqual({ ok: false, error: 'name_empty' })
    expect(server.calls).toHaveLength(0)
  })

  it('sends a duplicate name: duplicates are allowed, no name error', async () => {
    const server = fakeServer({ title: 'Q4 plan.docx' })
    const ctx = setup(server)
    const input = { workspaceId: WS, folderId: null, name: 'Q4 plan.docx', format: 'docx' } as const
    const first = await ctx.service.createDocument(input)
    const second = await ctx.service.createDocument(input)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const blanks = server.calls.filter((c) => c.path.endsWith('/documents/files/blank'))
    expect(blanks).toHaveLength(2)
    expect(blanks[1]!.body).toMatchObject({ title: 'Q4 plan.docx' })
  })

  it('refuses a name over 500 runes before any request, counting runes not UTF-16 units', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const create = (name: string) =>
      ctx.service.createDocument({ workspaceId: WS, folderId: null, name, format: 'docx' })
    // 501 astral characters are 1002 UTF-16 units, 500 of them are still allowed
    expect(await create('😀'.repeat(501))).toEqual({ ok: false, error: 'name_too_long' })
    expect(server.calls).toHaveLength(0)
    expect((await create('😀'.repeat(500))).ok).toBe(true)
    expect(await create('a'.repeat(501))).toEqual({ ok: false, error: 'name_too_long' })
  })

  it("maps D's 400 for a refused title to name_too_long", async () => {
    const server = fakeServer({ nameRefused: true })
    const ctx = setup(server)
    const result = await ctx.service.createDocument({
      workspaceId: WS,
      folderId: null,
      name: 'Q4 plan',
      format: 'docx',
    })
    expect(result).toEqual({ ok: false, error: 'name_too_long' })
  })

  it('treats a server 409 on create as an ordinary failure, not a name error', async () => {
    const server = fakeServer({ nameTaken: true })
    const ctx = setup(server)
    const result = await ctx.service.createDocument({
      workspaceId: WS,
      folderId: null,
      name: 'Q4 plan',
      format: 'docx',
    })
    expect(result).toEqual({ ok: false, error: 'server_error' })
  })
})

describe('upload a file', () => {
  it('uploads the local bytes as one document, then opens it by id (no second copy)', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const picked = await ctx.service.pickUploadFile()
    expect(picked).toEqual({ path: ctx.uploadFile, name: 'Q3 report.docx' })

    const uploaded = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: 'fold_1',
      path: picked!.path,
      uploadId: 'up-1',
    })
    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return
    const id = uploaded.value.id
    const call = server.calls.find((c) => c.path.endsWith('/documents/files'))!
    expect(call.method).toBe('POST')
    const body = call.body as { title: string; parent_id: string; name: string }
    expect(body.title).toBe('Q3 report.docx')
    expect(body.parent_id).toBe('fold_1')
    expect(body.name).toBe('Q3 report.docx')

    const opened = await ctx.service.openDocument(id)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(copiesIn(id)).toHaveLength(1)
    expect(binding(opened.value.path)).toMatchObject({ documentId: id })
    // progress: a start event and a final one, both for the picked path and the
    // upload they belong to (the dialog filters by uploadId)
    expect(ctx.progress[0]).toMatchObject({ uploadId: 'up-1', path: ctx.uploadFile, loaded: 0 })
    expect(ctx.progress[0]!.total).toBe(enc('uploaded bytes').byteLength)
    expect(ctx.progress.at(-1)).toMatchObject({ uploadId: 'up-1', path: ctx.uploadFile })
    expect(ctx.progress.at(-1)!.loaded).toBe(enc('uploaded bytes').byteLength)
  })

  // R1-10 / SIZE-F1: a pick past max_bytes (default 200 MiB) is refused before
  // main reads it (a multi-GB file must not be buffered only to be told too_large).
  it('refuses a pick past the document size limit without reading it', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    // the name must resolve in the formats table, or the upload is refused as
    // unsupported_format even before the (unread) size check this test pins
    const huge = join(dir, 'huge.docx')
    writeFileSync(huge, '')
    truncateSync(huge, 200 * 1024 * 1024 + 1)
    const result = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: huge,
      uploadId: 'up-big',
    })
    expect(result).toEqual({
      ok: false,
      error: 'too_large',
      name: 'huge.docx',
      sizeBytes: 200 * 1024 * 1024 + 1,
      maxBytes: 200 * 1024 * 1024,
    })
    // the pick itself is never read (its bytes never enter main): the refusal
    // happens on the stat, before the read that would buffer it
    expect(vi.mocked(readFile).mock.calls.map((call) => String(call[0]))).not.toContain(huge)
    // and nothing is sent: the limits read (`GET /api/v1/config`) is the only
    // request this call makes
    expect(server.calls.every((call) => call.method === 'GET')).toBe(true)
    expect(server.calls.filter((call) => call.path.endsWith('/documents/files'))).toHaveLength(0)
    expect(ctx.progress).toHaveLength(0)
  })

  // FX10: the dialog's Cancel aborts the request already in flight; the upload
  // call answers upload_cancelled rather than the network failure the abort
  // surfaces as, and no document is created from it.
  it('cancels a running upload through its uploadId', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const server = fakeServer({ uploadGate: () => gate })
    const ctx = setup(server)
    const started = ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: ctx.uploadFile,
      uploadId: 'up-cancel',
    })
    // the POST is in flight (the server holds it open)
    await vi.waitFor(() =>
      expect(server.calls.some((c) => c.path.endsWith('/documents/files'))).toBe(true),
    )
    ctx.service.cancelUpload('up-cancel')
    release()
    await expect(started).resolves.toEqual({ ok: false, error: 'upload_cancelled' })
    // cancelling again (the upload already settled) is a no-op, never a throw
    ctx.service.cancelUpload('up-cancel')
    ctx.service.cancelUpload('never-started')
  })

  it('keeps the created document when the cancel lands after D answered', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const uploaded = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: ctx.uploadFile,
      uploadId: 'up-late',
    })
    expect(uploaded.ok).toBe(true)
    // the dialog's late Cancel names an upload main no longer holds (never a
    // hidden delete of the document D already created)
    ctx.service.cancelUpload('up-late')
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  // R2-1 (reviewer probe "cancel during initial stat prevents a later POST"):
  // the controller is registered before the stat, so a Cancel that lands while
  // main is still stat'ing the file is not dropped: nothing is read, no POST
  // starts and the call answers upload_cancelled.
  it('cancels an upload whose Cancel lands during the stat, before any read or POST', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const stat = latch()
    statGate.held = stat.held
    statGate.entered = stat.entered
    const started = ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: ctx.uploadFile,
      uploadId: 'up-stat-cancel',
    })
    await stat.reached
    ctx.service.cancelUpload('up-stat-cancel')
    stat.release()
    await expect(started).resolves.toEqual({ ok: false, error: 'upload_cancelled' })
    // nothing left main and no progress was reported for a refused upload
    expect(server.calls).toHaveLength(0)
    expect(ctx.progress).toHaveLength(0)
    // the try/finally lifetime starts with the registration: the settled upload
    // is no longer held
    expect((ctx.service as unknown as { uploads: Map<string, AbortController> }).uploads.size).toBe(
      0,
    )
  })

  // R2-2 (reviewer probe "2xx headers before cancellation preserve the created
  // document"): D accepted the upload before the Cancel landed, so the created
  // document is returned as usual - the caller's abort is detached from the
  // body read and no hidden delete follows.
  it('returns the created document when the Cancel lands after the 201 was accepted', async () => {
    const server = fakeServer()
    const original = server.fetch
    const atBody = latch()
    const bodyHeld = latch()
    server.fetch = (async (url: string, init: RequestInit) => {
      const response = await original(url, init)
      if (!String(url).endsWith('/documents/files')) return response
      // the 201's headers are in, its body is held open: the Cancel lands
      // between the accepted answer and the read of the created document
      const raw = await response.text()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const onAbort = () =>
            controller.error(new DOMException('The operation was aborted.', 'AbortError'))
          init.signal?.addEventListener('abort', onAbort, { once: true })
          bodyHeld.held.then(() => {
            if (!init.signal?.aborted) {
              controller.enqueue(new TextEncoder().encode(raw))
              controller.close()
            }
            init.signal?.removeEventListener('abort', onAbort)
          })
        },
      })
      const accepted = new Response(stream, {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
      const readJson = accepted.json.bind(accepted)
      accepted.json = () => {
        atBody.entered()
        return readJson()
      }
      return accepted
    }) as typeof server.fetch

    const ctx = setup(server)
    const uploading = ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: ctx.uploadFile,
      uploadId: 'up-201-cancel',
    })
    await atBody.reached
    ctx.service.cancelUpload('up-201-cancel')
    bodyHeld.release()
    const result = await uploading
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe('up_1')
    // the document D created before the abort is real and was never deleted
    expect(server.state.documents.has('up_1')).toBe(true)
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  // R1-1 / R1-2 / N-1 / N-3: the upload IPC carries a renderer-supplied path, so
  // the native filter is not a contract. A basename the formats table does not
  // resolve (photo.png, a nonexistent missing.png, or a prototype key like
  // photo.constructor) must be refused with unsupported_format before stat,
  // readFile and any POST: otherwise the created document could never be opened.
  it('refuses a basename outside the formats table before any stat, read or POST', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const photo = join(dir, 'photo.png')
    writeFileSync(photo, 'not a document')
    const proto = join(dir, 'photo.constructor')
    writeFileSync(proto, 'not a document')
    vi.mocked(stat).mockClear()
    vi.mocked(readFile).mockClear()

    const result = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: photo,
      uploadId: 'up-png',
    })
    expect(result).toEqual({ ok: false, error: 'unsupported_format' })
    expect(vi.mocked(stat)).toHaveBeenCalledTimes(0)
    expect(vi.mocked(readFile)).toHaveBeenCalledTimes(0)

    const missing = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: join(dir, 'missing.png'),
      uploadId: 'up-missing-png',
    })
    expect(missing).toEqual({ ok: false, error: 'unsupported_format' })
    expect(vi.mocked(stat)).toHaveBeenCalledTimes(0)
    expect(vi.mocked(readFile)).toHaveBeenCalledTimes(0)

    const protoResult = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: proto,
      uploadId: 'up-constructor',
    })
    expect(protoResult).toEqual({ ok: false, error: 'unsupported_format' })
    expect(vi.mocked(stat)).toHaveBeenCalledTimes(0)
    expect(vi.mocked(readFile)).toHaveBeenCalledTimes(0)
    expect(server.calls).toHaveLength(0)
    expect(ctx.progress).toHaveLength(0)
  })

  // R1-2: every extension the picker offers is one the service accepts, so the
  // offer and the resolver cannot drift apart unnoticed.
  it('uploads one document per extension the picker offers', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    for (const [index, ext] of UPLOAD_EXTENSIONS.entries()) {
      const file = join(dir, `report ${index}.${ext}`)
      writeFileSync(file, `bytes of ${ext}`)
      const uploaded = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: `up-${ext}`,
      })
      expect(uploaded.ok, ext).toBe(true)
    }
    const posts = server.calls.filter((c) => c.path.endsWith('/documents/files'))
    expect(posts).toHaveLength(UPLOAD_EXTENSIONS.length)
    expect(ctx.progress.filter((event) => event.loaded === 0)).toHaveLength(
      UPLOAD_EXTENSIONS.length,
    )
  })
})

describe('folders', () => {
  // FD-11: a folder is created with the folder kind, in the chosen folder, and
  // follows the folder name rule (trim + NFC, 1..255 runes - tighter than the
  // 500 a document name gets)
  it('creates a folder in a folder with the folder name rule', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const created = await ctx.service.createFolder({
      workspaceId: WS,
      parentId: 'fold_1',
      title: '  Contracts  ',
    })
    expect(created).toMatchObject({
      ok: true,
      value: { title: 'Contracts', kind: 'folder', parentId: 'fold_1' },
    })
    const post = server.calls.find(
      (c) => c.method === 'POST' && c.path === `/api/v1/workspaces/${WS}/documents`,
    )!
    expect(post.body).toEqual({ kind: 'folder', title: 'Contracts', parent_id: 'fold_1' })
    expect(post.idempotencyKey).toBeTruthy()
  })

  it('refuses an empty folder name and one over 255 runes before any request, and normalizes NFC', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    expect(
      await ctx.service.createFolder({ workspaceId: WS, parentId: null, title: '  ' }),
    ).toEqual({ ok: false, error: 'name_empty' })
    expect(
      await ctx.service.createFolder({ workspaceId: WS, parentId: null, title: 'a'.repeat(256) }),
    ).toEqual({ ok: false, error: 'name_too_long' })
    expect(server.calls).toHaveLength(0)
    // 255 decomposed `é` (e + a combining accent) are 255 runes once normalized
    const decomposed = 'e\u0301'.repeat(255)
    expect(
      await ctx.service.createFolder({ workspaceId: WS, parentId: null, title: decomposed }),
    ).toMatchObject({ ok: true })
    const post = server.calls.find((c) => c.method === 'POST')!
    expect((post.body as { title: string }).title).toBe('é'.repeat(255))
  })

  // FD-11: only folders collide on a name, so the server's 409 stays a field
  // error the renderer shows under the name (never a generic server_error)
  it('answers a taken folder name as a field error on create, and as move_name_taken on move (B-R1-03)', async () => {
    const server = fakeServer({ folderNameTaken: true })
    const ctx = setup(server)
    expect(
      await ctx.service.createFolder({ workspaceId: WS, parentId: 'fold_1', title: 'Contracts' }),
    ).toEqual({ ok: false, error: 'folder_name_taken' })
    expect(await ctx.service.moveDocument({ documentId: DOC, parentId: 'fold_1' })).toEqual({
      ok: false,
      error: 'move_name_taken',
    })
  })

  // FD-11 / B-R1-08: the tree's depth cap (20) rides the failure
  it('carries the depth cap 20 on a too-deep refusal', async () => {
    const unnamed = setup(fakeServer({ deepMax: null }))
    expect(
      await unnamed.service.createFolder({ workspaceId: WS, parentId: 'fold_1', title: 'Deep' }),
    ).toEqual({ ok: false, error: 'document_too_deep', max: 20 })
  })

  // B-R1-07: service.moveDocument mints an Idempotency-Key and passes it to the move POST
  it('sends an Idempotency-Key header on moveDocument', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const moved = await ctx.service.moveDocument({ documentId: DOC, parentId: 'fold_1' })
    expect(moved.ok).toBe(true)
    const post = server.calls.find(
      (c) => c.method === 'POST' && c.path === `/api/v1/documents/${DOC}/move`,
    )!
    expect(post.idempotencyKey).toBeTruthy()
  })

  // FD11-B-R1-06 / B-R1-01: service-level tests driving listChildren and
  // searchDocuments through the fake server and asserting `{ items, nextCursor }`
  it('lists root children with parent_id= and answers value.items', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const root = await ctx.service.listChildren({ workspaceId: WS, parentId: null })
    expect(root.ok).toBe(true)
    if (!root.ok) return
    expect(root.value).toEqual({
      items: [
        {
          id: 'fold_1',
          kind: 'folder',
          title: 'Contracts',
          workspaceId: WS,
          format: null,
          updatedAt: '2026-10-13T09:00:00Z',
          canEdit: false,
          canManage: false,
          archived: false,
          parentId: null,
        },
        {
          id: 'doc_x',
          kind: 'file',
          title: 'ignored.docx',
          workspaceId: WS,
          format: 'docx',
          updatedAt: '2026-10-13T09:00:00Z',
          canEdit: false,
          canManage: false,
          archived: false,
          parentId: null,
        },
      ],
      nextCursor: null,
    })
    const call = server.calls.find((c) => c.path === `/api/v1/workspaces/${WS}/documents`)!
    expect(call.query).toContain('parent_id=')
    expect(call.query).not.toContain('parent_id=null')
  })

  it('searches documents with match=title, maps unknown kind to all, and answers value.items', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const found = await ctx.service.searchDocuments({
      workspaceId: WS,
      query: 'Contracts',
      kind: 'unknown' as 'all',
    })
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.value.items.map((row) => row.id)).toEqual(['fold_1', 'doc_x'])
    expect(found.value.nextCursor).toBeNull()
    const call = server.calls.find((c) => c.path === `/api/v1/workspaces/${WS}/documents`)!
    expect(call.query).toContain('match=title')
    expect(call.query).toContain('q=Contracts')
    expect(call.query).not.toContain('kind=')
  })
})

describe('rename, archive and restore', () => {
  it('renames with the current revision and follows the working copy on disk', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const before = opened.value.path

    const renamed = await ctx.service.renameDocument(DOC, 'Q4 plan v2.docx')
    expect(renamed.ok).toBe(true)
    const call = server.calls.find((c) => c.method === 'PATCH')!
    expect(call.body).toEqual({ revision: '41', title: 'Q4 plan v2.docx' })
    // the open copy followed: its binding and its file name carry the new title
    const after = join(docDir(DOC), 'Q4 plan v2.docx')
    expect(binding(after)).toMatchObject({ title: 'Q4 plan v2.docx', filename: 'Q4 plan v2.docx' })
    expect(copiesIn(DOC)).toEqual(['Q4 plan v2.docx'])
    expect(ctx.pathRenames).toContainEqual({ oldPath: before, newPath: after })
    // a rename this service made is not re-announced to the renderer
    expect(ctx.renamed).toHaveLength(0)
  })

  it('refuses an empty name before any request', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const result = await ctx.service.renameDocument(DOC, '  ')
    expect(result).toEqual({ ok: false, error: 'name_empty' })
    expect(server.calls).toHaveLength(0)
  })

  it('renames to a name another document already has: the PATCH goes out', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const result = await ctx.service.renameDocument(DOC, 'Q4 plan v2.docx')
    expect(result.ok).toBe(true)
    expect(server.calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      revision: '41',
      title: 'Q4 plan v2.docx',
    })
  })

  it('refuses a rename over 500 runes before any request', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const result = await ctx.service.renameDocument(DOC, `${'a'.repeat(496)}.docx`)
    expect(result).toEqual({ ok: false, error: 'name_too_long' })
    expect(server.calls).toHaveLength(0)
  })

  it("maps D's 400 for a refused title on rename to name_too_long", async () => {
    const server = fakeServer({ nameRefused: true })
    const ctx = setup(server)
    const result = await ctx.service.renameDocument(DOC, 'Other.docx')
    expect(result).toEqual({ ok: false, error: 'name_too_long' })
  })

  // FD-11: a folder's name cap is 255 runes, a page/file's 500. The tighter cap
  // needs the document's own kind, so the read happens before the refusal.
  it('caps a folder rename at 255 runes and leaves the 500 cap for a file', async () => {
    const folderServer = fakeServer({ kind: 'folder' })
    const folder = setup(folderServer)
    expect(await folder.service.renameDocument(DOC, 'a'.repeat(256))).toEqual({
      ok: false,
      error: 'name_too_long',
    })
    expect(folderServer.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
    expect(folderServer.calls.filter((c) => c.method === 'GET')).toHaveLength(1)

    const fileServer = fakeServer()
    const file = setup(fileServer)
    const long = `${'a'.repeat(252)}.docx`
    expect(await file.service.renameDocument(DOC, long)).toMatchObject({ ok: true })
    expect(fileServer.calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({
      title: long,
    })
  })

  it('treats a server 409 on rename as an ordinary failure, not a name error', async () => {
    const server = fakeServer({ nameTaken: true })
    const ctx = setup(server)
    const result = await ctx.service.renameDocument(DOC, 'Taken.docx')
    expect(result).toEqual({ ok: false, error: 'server_error' })
  })

  // R1-12: a rename to the title the document already has answers the detail's
  // own row (no second read, no write) - so its flags must come from that
  // detail, not from a fixed "canEdit, no manage, not archived".
  it('answers a no-op rename with the flags of the detail it read', async () => {
    const server = fakeServer({ myLevel: 'manage' })
    const ctx = setup(server)
    server.state.archived = true
    const result = await ctx.service.renameDocument(DOC, 'Q4 plan.docx')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      title: 'Q4 plan.docx',
      canEdit: true,
      canManage: true,
      archived: true,
    })
    // nothing was written: the title did not change
    expect(server.calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('archives and restores through the lifecycle routes, never a delete', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const archived = await ctx.service.archiveDocument(DOC)
    expect(archived.ok).toBe(true)
    const restore = await ctx.service.restoreDocument(DOC)
    expect(restore.ok).toBe(true)
    expect(server.calls.map((c) => c.path)).toEqual([
      `/api/v1/documents/${DOC}`,
      `/api/v1/documents/${DOC}/archive`,
      `/api/v1/documents/${DOC}`,
      `/api/v1/documents/${DOC}/restore`,
    ])
    // no DELETE ever leaves main
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  // F6: restore reads GET /documents/{id} first. D answers a manager 200 with
  // the archived row (only a below-manage caller gets 404), so the restore of a
  // manager's own archived document works; this pins that against the mirror.
  it('restores a manager own archived document, whose GET still answers 200', async () => {
    const server = fakeServer({ myLevel: 'manage' })
    const ctx = setup(server)
    expect((await ctx.service.archiveDocument(DOC)).ok).toBe(true)
    const restore = await ctx.service.restoreDocument(DOC)
    expect(restore.ok).toBe(true)
    if (!restore.ok) return
    expect(restore.value.archived).toBe(false)
    expect(server.calls.map((c) => c.path)).toEqual([
      `/api/v1/documents/${DOC}`,
      `/api/v1/documents/${DOC}/archive`,
      `/api/v1/documents/${DOC}`,
      `/api/v1/documents/${DOC}/restore`,
    ])
  })

  // the below-manage case D hides with a 404: the restore stops at the detail
  // read, so no lifecycle write ever leaves main
  it('refuses a restore when the archived document reads not_found for the caller', async () => {
    const server = fakeServer({ myLevel: 'edit' })
    const ctx = setup(server)
    server.state.archived = true
    const restore = await ctx.service.restoreDocument(DOC)
    expect(restore).toEqual({ ok: false, error: 'not_found' })
    expect(server.calls.map((c) => c.path)).toEqual([`/api/v1/documents/${DOC}`])
    expect(server.calls.some((c) => c.path.endsWith('/restore'))).toBe(false)
  })
})

describe('my_level gating', () => {
  it('refuses every action on a view-only document without a write request', async () => {
    const server = fakeServer({ myLevel: 'view' })
    const ctx = setup(server)
    expect(await ctx.service.renameDocument(DOC, 'Nope.docx')).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(await ctx.service.archiveDocument(DOC)).toEqual({ ok: false, error: 'forbidden' })
    expect(await ctx.service.restoreDocument(DOC)).toEqual({ ok: false, error: 'forbidden' })
    // only the detail reads that decide the level; no PATCH/archive/restore
    expect(server.calls.every((c) => c.method === 'GET')).toBe(true)
  })

  // R1-1: D's `my_level` is omitempty and its documented default is view, so a
  // detail without the field must fail closed exactly like a 'view' row; the
  // list rows already read it that way (`canEdit` false). No PATCH may leave
  // main for a level main cannot prove is edit or manage.
  it('refuses a rename when the detail carries no my_level, before any PATCH', async () => {
    const server = fakeServer({ omitMyLevel: true })
    const ctx = setup(server)
    expect(await ctx.service.renameDocument(DOC, 'Q4 v2.docx')).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(server.calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('refuses a rename on an unknown my_level, before any PATCH', async () => {
    const server = fakeServer({ myLevel: 'owner' })
    const ctx = setup(server)
    expect(await ctx.service.renameDocument(DOC, 'Q4 v2.docx')).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(server.calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('lets an edit-level row rename but not archive', async () => {
    const server = fakeServer({ myLevel: 'edit' })
    const ctx = setup(server)
    expect((await ctx.service.renameDocument(DOC, 'Q4 v2.docx')).ok).toBe(true)
    expect(await ctx.service.archiveDocument(DOC)).toEqual({ ok: false, error: 'forbidden' })
  })

  // R1-2 on the read path: the file block decides the format of a library row,
  // and a row that omits it (an older server, `omitempty`) falls back to the
  // title's extension - never the other way around.
  it('derives a list row format from the file block, title extension only without one', async () => {
    const withFile = setup(fakeServer({ title: 'Q4 plan' }))
    const row = await withFile.service.listDocuments({ workspaceId: WS })
    expect(row.ok).toBe(true)
    if (!row.ok) return
    expect(row.value.documents[0]!.format).toBe('docx')

    const withoutFile = setup(fakeServer({ title: 'Q4 plan', omitListFile: true }))
    const bare = await withoutFile.service.listDocuments({ workspaceId: WS })
    expect(bare.ok).toBe(true)
    if (!bare.ok) return
    expect(bare.value.documents[0]!.format).toBeNull()
  })

  it('carries the row action flags on every list row', async () => {
    const server = fakeServer({ myLevel: 'edit' })
    const ctx = setup(server)
    const page = await ctx.service.listDocuments({ workspaceId: WS })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    const row: UniworkDocSummary = page.value.documents[0]!
    expect(row.canEdit).toBe(true)
    expect(row.canManage).toBe(false)
    expect(row.archived).toBe(false)
  })
})

/**
 * Renamed elsewhere (S18). Two shapes: the document is NOT open (no tab holds
 * it), so the working copy is renamed on disk and the shell re-keys; and the
 * document IS open (F1), so the copy keeps its name and the tab is re-titled by
 * path. Each shape's tests pin one of them, so a fix for the open case cannot
 * quietly break the closed one.
 */
describe('renamed elsewhere', () => {
  it('a feed change for a closed document follows the title, renames the file and announces it', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const before = opened.value.path

    // the web renamed it; the server now answers the new title
    server.state.title = 'Renamed on web.docx'
    ctx.service.noteFeedChange(DOC)
    await vi.waitFor(() => expect(ctx.renamed).toHaveLength(1))

    expect(ctx.renamed[0]).toEqual({ documentId: DOC, title: 'Renamed on web.docx' })
    const after = join(docDir(DOC), 'Renamed on web.docx')
    expect(binding(after)).toMatchObject({ title: 'Renamed on web.docx' })
    expect(ctx.pathRenames).toContainEqual({ oldPath: before, newPath: after })
    // the status push carries the new title
    expect(ctx.statuses.at(-1)).toMatchObject({ title: 'Renamed on web.docx' })
  })

  it('a rename this service made itself is not re-announced when the feed echoes it', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    await ctx.service.openDocument(DOC)
    await ctx.service.renameDocument(DOC, 'Mine.docx')
    ctx.service.noteFeedChange(DOC)
    // the feed echo is skipped: no second announce for our own rename
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.renamed).toHaveLength(0)
  })

  it('leaves a document with local work alone', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    // the person edited the copy: it is dirty, so a rename elsewhere must not touch it
    writeFileSync(opened.value.path, 'local edits not saved')
    await ctx.service.refreshPath(opened.value.path)
    server.state.title = 'Renamed on web.docx'
    await ctx.service.refreshMetadataFor(DOC)
    expect(binding(opened.value.path)).toMatchObject({ title: 'Q4 plan.docx' })
    expect(ctx.renamed).toHaveLength(0)
  })

  // R1-3 (reviewer probe "own rename preserves the working copy while legacy
  // migration holds binding writes"): while the schema 1 -> 2 sweep owns the
  // folder, every binding write is refused - so the file must not move either,
  // or binding.json would name a file that no longer exists and the copy would
  // be unreachable by lookup. The pre-store intent pair stays untouched.
  it('a rename while the migration holds the folder keeps the file and the intent', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    // a copy from an earlier build: schema 1 + pendingIntent, its bytes still
    // beside it, and the sweep cannot move them (no store in this test)
    const dir = docDir(DOC)
    const legacy = binding(opened.value.path)
    writeFileSync(
      join(dir, BINDING_FILE),
      JSON.stringify({ ...legacy, schema: 1, pendingIntent: { idempotencyKey: 'legacy' } }),
    )
    writeFileSync(join(dir, 'pending-upload.bin'), 'pending bytes')

    const renamed = await ctx.service.renameDocument(DOC, 'Other.docx')
    expect(renamed.ok).toBe(true)
    // the binding still names a file that is really there, and the file kept
    // its name (the title could not be written: the store refused it)
    const written = binding(opened.value.path)
    expect(copiesIn(DOC)).toContain(written.filename)
    expect(written).toMatchObject({ title: 'Q4 plan.docx', filename: 'Q4 plan.docx' })
    expect(copiesIn(DOC).sort()).toEqual(['Q4 plan.docx', 'pending-upload.bin'])
    expect(ctx.pathRenames).toHaveLength(0)
  })

  // R1-4 (reviewer probe "a metadata response must preserve a dirty state
  // written during its request"): the metadata GET is async, so the binding is
  // re-read when it resolves - a copy that turned dirty meanwhile keeps its
  // state and its old title instead of being reverted to the pre-await read.
  it('a metadata response never overwrites a state written while it was pending', async () => {
    const server = fakeServer()
    const original = server.fetch
    let release: () => void = () => undefined
    let entered: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const seen = new Promise<void>((resolve) => {
      entered = resolve
    })
    let paused = false
    server.fetch = (async (url: string, init: RequestInit) => {
      const response = await original(url, init)
      if (paused && String(url).endsWith(`/documents/${DOC}`)) {
        entered()
        await gate
      }
      return response
    }) as typeof server.fetch

    const ctx = setup(server, { pathOpen: true })
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    server.state.title = 'Renamed on web.docx'
    paused = true
    const refresh = ctx.service.refreshMetadataFor(DOC)
    await seen
    // the editor made the copy dirty while the GET was in flight
    writeFileSync(
      join(docDir(DOC), BINDING_FILE),
      JSON.stringify({ ...binding(opened.value.path), state: 'dirty' }),
    )
    writeFileSync(opened.value.path, 'unsaved local work')
    release()
    await refresh

    expect(binding(opened.value.path)).toMatchObject({ state: 'dirty', title: 'Q4 plan.docx' })
    expect(ctx.renamed).toHaveLength(0)
  })

  // R1-6: the feed is off, so the echo of this service's own rename never
  // arrives; a later, genuine remote rename must not be swallowed by the
  // suppression the own rename left behind. Only the revision it produced is
  // treated as its own echo.
  it('a genuine remote rename is followed even when no echo of our own arrived', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const renamed = await ctx.service.renameDocument(DOC, 'Mine.docx')
    expect(renamed.ok).toBe(true)
    // the feed never echoed our own rename; the web renames it again (a newer
    // revision) and the single change that arrives carries that newer revision
    server.state.title = 'Theirs.docx'
    server.state.revision += 1
    ctx.service.noteFeedChange(DOC, String(server.state.revision))
    await vi.waitFor(() => expect(ctx.renamed).toHaveLength(1))
    expect(ctx.renamed[0]).toEqual({ documentId: DOC, title: 'Theirs.docx' })
  })

  it('focus refresh picks up a title change without the feed (closed document)', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    server.state.title = 'Renamed on web.docx'
    await ctx.service.refreshPath(opened.value.path)
    await vi.waitFor(() => expect(ctx.renamed).toHaveLength(1))
    expect(ctx.renamed[0]!.title).toBe('Renamed on web.docx')
  })

  // F1: the document is OPEN in a tab, so its working copy keeps its file name
  // (Windows refuses a rename under an open handle). The tab title and the
  // editor must still follow the rename; today neither does.
  it('a feed change re-titles an open tab without moving its file', async () => {
    const server = fakeServer()
    const ctx = setup(server, { pathOpen: true })
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const before = opened.value.path

    server.state.title = 'Renamed on web.docx'
    ctx.service.noteFeedChange(DOC)
    await vi.waitFor(() => expect(ctx.renamed).toHaveLength(1))

    // the tab/window is re-titled by path, and the editor is told (file.renamed)
    expect(ctx.titleRenames).toContainEqual({ path: before, title: 'Renamed on web.docx' })
    expect(ctx.renamed[0]).toEqual({ documentId: DOC, title: 'Renamed on web.docx' })
    // the file is NOT moved under the open editor: it keeps its name on disk
    expect(copiesIn(DOC)).toEqual(['Q4 plan.docx'])
    expect(binding(before)).toMatchObject({
      title: 'Renamed on web.docx',
      filename: 'Q4 plan.docx',
    })
    expect(ctx.pathRenames).toHaveLength(0)
    // the status push carries the new title
    expect(ctx.statuses.at(-1)).toMatchObject({ title: 'Renamed on web.docx' })
  })

  it('focus refresh re-titles an open tab without the feed', async () => {
    const server = fakeServer()
    const ctx = setup(server, { pathOpen: true })
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const before = opened.value.path

    server.state.title = 'Renamed on web.docx'
    await ctx.service.refreshPath(before)
    await vi.waitFor(() => expect(ctx.titleRenames).toHaveLength(1))

    expect(ctx.titleRenames[0]).toEqual({ path: before, title: 'Renamed on web.docx' })
    expect(copiesIn(DOC)).toEqual(['Q4 plan.docx'])
    expect(ctx.pathRenames).toHaveLength(0)
  })
})

// FD-11: a folder action the app makes itself must reach the other views of the
// workspace without waiting for the 60 s feed - main pushes the workspace id,
// coalesced (see the coalescer's own test).
describe('the FD-11 tree-changed push', () => {
  it('names the workspace after a new document, an upload, a folder, a rename and a move', async () => {
    const server = fakeServer({ moveRenames: true })
    const ctx = setup(server)
    const ws = { workspaceId: WS }

    await ctx.service.createDocument({
      workspaceId: WS,
      folderId: 'fold_1',
      name: 'Plan.docx',
      format: 'docx',
    })
    await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: ctx.uploadFile,
      uploadId: 'up_1',
    })
    await ctx.service.createFolder({ workspaceId: WS, parentId: null, title: 'Contracts' })
    await ctx.service.renameDocument(DOC, 'Q4 plan v2.docx')
    const moved = await ctx.service.moveDocument({ documentId: DOC, parentId: 'fold_1' })

    expect(ctx.treeChanged).toEqual([ws, ws, ws, ws, ws])
    // the move's own answer still reports the server's auto-rename
    expect(moved).toMatchObject({ ok: true, value: { renamedTo: 'Q4 plan v2.docx (2)' } })
  })

  it('says nothing when an action wrote nothing', async () => {
    const server = fakeServer()
    const ctx = setup(server)

    // a rename to the title the document already has, and a folder name the
    // service refuses itself: neither changed the tree
    await ctx.service.renameDocument(DOC, 'Q4 plan.docx')
    await ctx.service.createFolder({ workspaceId: WS, parentId: null, title: 'a'.repeat(256) })
    expect(ctx.treeChanged).toEqual([])
  })

  it('FD11-C-R1-04 / FD11-C-R2-02: suppresses pushTreeChanged when an own folder action resolves after lockSession() boundary', async () => {
    const server = fakeServer()
    const origFetch = server.fetch
    const ctx = setup(server)
    const emitted: Array<{ workspaceId: string }> = []
    const scheduled: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
    const coalescer = createTreeChangedCoalescer({
      emit: (workspaceId) => emitted.push({ workspaceId }),
      schedule: (run, ms) => {
        const entry = { run, ms, cancelled: false }
        scheduled.push(entry)
        return () => {
          entry.cancelled = true
        }
      },
    })
    ctx.setPushTreeChanged((event) => coalescer.notify(event.workspaceId))
    ctx.setStopRuntime(() => coalescer.cancel())

    let postReached!: () => void
    const onPostReached = new Promise<void>((resolve) => {
      postReached = resolve
    })
    let releasePost!: () => void
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    server.fetch = (async (url: string, init: RequestInit) => {
      if (
        new URL(url).pathname === `/api/v1/workspaces/${WS}/documents` &&
        init.method === 'POST'
      ) {
        postReached()
        await postGate
      }
      return origFetch(url, init)
    }) as typeof server.fetch

    const createPromise = ctx.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Late folder',
    })
    await onPostReached

    // Drive the real lockSession() boundary while identity is still the outgoing
    // session (before afterSignOut clears it), so only sessionEpoch suppresses
    // the late own-action push.
    await ctx.service.lockSession(undefined, undefined, { switch: true })

    releasePost()
    const created = await createPromise
    expect(created.ok).toBe(true)

    for (const timer of scheduled) {
      if (!timer.cancelled) {
        expect(timer.ms).toBe(TREE_CHANGED_WINDOW_MS)
        timer.run()
      }
    }
    expect(emitted).toEqual([])
  })

  it('FD11-C-R1-04: suppresses pushTreeChanged when an organization change occurs while an own folder action is gated', async () => {
    const server = fakeServer()
    const origFetch = server.fetch
    const ctx = setup(server)
    const emitted: Array<{ workspaceId: string }> = []
    const scheduled: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
    const coalescer = createTreeChangedCoalescer({
      emit: (workspaceId) => emitted.push({ workspaceId }),
      schedule: (run, ms) => {
        const entry = { run, ms, cancelled: false }
        scheduled.push(entry)
        return () => {
          entry.cancelled = true
        }
      },
    })
    ctx.setPushTreeChanged((event) => coalescer.notify(event.workspaceId))
    ctx.setStopRuntime(() => coalescer.cancel())

    let postReached!: () => void
    const onPostReached = new Promise<void>((resolve) => {
      postReached = resolve
    })
    let releasePost!: () => void
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    server.fetch = (async (url: string, init: RequestInit) => {
      if (
        new URL(url).pathname === `/api/v1/workspaces/${WS}/documents` &&
        init.method === 'POST'
      ) {
        postReached()
        await postGate
      }
      return origFetch(url, init)
    }) as typeof server.fetch

    const createPromise = ctx.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Org boundary folder',
    })
    await onPostReached

    // Switch organization on the same account (as wiring.ts does on status change)
    ctx.setSelectedOrg({ id: 'org_b', slug: 'beta' })
    ctx.service.noteSelectedOrg('org_b')

    releasePost()
    const created = await createPromise
    expect(created.ok).toBe(true)

    for (const timer of scheduled) {
      if (!timer.cancelled) {
        expect(timer.ms).toBe(TREE_CHANGED_WINDOW_MS)
        timer.run()
      }
    }
    expect(emitted).toEqual([])
  })

  it('R3-05: still emits pushTreeChanged when the same organization is reported again while an own folder action is gated', async () => {
    const server = fakeServer()
    const origFetch = server.fetch
    const ctx = setup(server)
    const emitted: Array<{ workspaceId: string }> = []
    const scheduled: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
    const coalescer = createTreeChangedCoalescer({
      emit: (workspaceId) => emitted.push({ workspaceId }),
      schedule: (run, ms) => {
        const entry = { run, ms, cancelled: false }
        scheduled.push(entry)
        return () => {
          entry.cancelled = true
        }
      },
    })
    ctx.setPushTreeChanged((event) => coalescer.notify(event.workspaceId))

    let postReached!: () => void
    const onPostReached = new Promise<void>((resolve) => {
      postReached = resolve
    })
    let releasePost!: () => void
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    server.fetch = (async (url: string, init: RequestInit) => {
      if (
        new URL(url).pathname === `/api/v1/workspaces/${WS}/documents` &&
        init.method === 'POST'
      ) {
        postReached()
        await postGate
      }
      return origFetch(url, init)
    }) as typeof server.fetch

    const createPromise = ctx.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Unchanged org folder',
    })
    await onPostReached

    // A status push reporting the same organization (e.g. token refresh) must not suppress the push
    ctx.service.noteSelectedOrg('org_a')

    releasePost()
    const created = await createPromise
    expect(created.ok).toBe(true)

    for (const timer of scheduled) {
      if (!timer.cancelled) {
        expect(timer.ms).toBe(TREE_CHANGED_WINDOW_MS)
        timer.run()
      }
    }
    expect(emitted).toEqual([{ workspaceId: WS }])
  })

  it('R4-01: suppresses pushTreeChanged when the live identity drops or switches to another account while an own folder action is gated with the organization unchanged', async () => {
    const server = fakeServer()
    const origFetch = server.fetch
    const ctx = setup(server)
    const emitted: Array<{ workspaceId: string }> = []
    const scheduled: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
    const coalescer = createTreeChangedCoalescer({
      emit: (workspaceId) => emitted.push({ workspaceId }),
      schedule: (run, ms) => {
        const entry = { run, ms, cancelled: false }
        scheduled.push(entry)
        return () => {
          entry.cancelled = true
        }
      },
    })
    ctx.setPushTreeChanged((event) => coalescer.notify(event.workspaceId))

    let postReached!: () => void
    let onPostReached = new Promise<void>((resolve) => {
      postReached = resolve
    })
    let releasePost!: () => void
    let postGate = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    server.fetch = (async (url: string, init: RequestInit) => {
      if (
        new URL(url).pathname === `/api/v1/workspaces/${WS}/documents` &&
        init.method === 'POST'
      ) {
        postReached()
        await postGate
      }
      return origFetch(url, init)
    }) as typeof server.fetch

    // Case 1: live identity drops to null while sessionEpoch / org stay unchanged
    const firstCreate = ctx.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Dropped identity folder',
    })
    await onPostReached
    ctx.setIdentity(null)
    releasePost()
    expect((await firstCreate).ok).toBe(true)

    for (const timer of scheduled) {
      if (!timer.cancelled) {
        expect(timer.ms).toBe(TREE_CHANGED_WINDOW_MS)
        timer.run()
      }
    }
    expect(emitted).toEqual([])

    // Case 2: live identity switches to another account while sessionEpoch / org stay unchanged
    ctx.setIdentity({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' })
    scheduled.length = 0
    onPostReached = new Promise<void>((resolve) => {
      postReached = resolve
    })
    postGate = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    const secondCreate = ctx.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Switched account folder',
    })
    await onPostReached
    ctx.setIdentity({ accountId: 'acc_2', deviceSessionId: 'dev_2', deploymentId: 'default' })
    releasePost()
    expect((await secondCreate).ok).toBe(true)

    for (const timer of scheduled) {
      if (!timer.cancelled) {
        expect(timer.ms).toBe(TREE_CHANGED_WINDOW_MS)
        timer.run()
      }
    }
    expect(emitted).toEqual([])
  })

  it('R4-02: still emits pushTreeChanged when noteSelectedOrg goes A -> null -> A during a transient org-less status push while an own folder action is gated', async () => {
    const server = fakeServer()
    const origFetch = server.fetch
    const ctx = setup(server)
    const emitted: Array<{ workspaceId: string }> = []
    const scheduled: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
    const coalescer = createTreeChangedCoalescer({
      emit: (workspaceId) => emitted.push({ workspaceId }),
      schedule: (run, ms) => {
        const entry = { run, ms, cancelled: false }
        scheduled.push(entry)
        return () => {
          entry.cancelled = true
        }
      },
    })
    ctx.setPushTreeChanged((event) => coalescer.notify(event.workspaceId))

    let postReached!: () => void
    const onPostReached = new Promise<void>((resolve) => {
      postReached = resolve
    })
    let releasePost!: () => void
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    server.fetch = (async (url: string, init: RequestInit) => {
      if (
        new URL(url).pathname === `/api/v1/workspaces/${WS}/documents` &&
        init.method === 'POST'
      ) {
        postReached()
        await postGate
      }
      return origFetch(url, init)
    }) as typeof server.fetch

    const createPromise = ctx.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Transient org-less folder',
    })
    await onPostReached

    // Transient /orgs failure reports null, then recovers with the same org_a
    ctx.setSelectedOrg(null)
    ctx.service.noteSelectedOrg(null)
    ctx.setSelectedOrg({ id: 'org_a', slug: 'acme' })
    ctx.service.noteSelectedOrg('org_a')

    releasePost()
    const created = await createPromise
    expect(created.ok).toBe(true)

    for (const timer of scheduled) {
      if (!timer.cancelled) {
        expect(timer.ms).toBe(TREE_CHANGED_WINDOW_MS)
        timer.run()
      }
    }
    expect(emitted).toEqual([{ workspaceId: WS }])
  })

  it('R5-01: suppresses pushTreeChanged when a lasting org loss (org-less status push without orgsError) lands while an own folder action is gated', async () => {
    const server = fakeServer()
    const origFetch = server.fetch
    const ctx = setup(server)
    const emitted: Array<{ workspaceId: string }> = []
    const scheduled: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
    const coalescer = createTreeChangedCoalescer({
      emit: (workspaceId) => emitted.push({ workspaceId }),
      schedule: (run, ms) => {
        const entry = { run, ms, cancelled: false }
        scheduled.push(entry)
        return () => {
          entry.cancelled = true
        }
      },
    })
    ctx.setPushTreeChanged((event) => coalescer.notify(event.workspaceId))
    ctx.setStopRuntime(() => coalescer.cancel())

    let postReached!: () => void
    const onPostReached = new Promise<void>((resolve) => {
      postReached = resolve
    })
    let releasePost!: () => void
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    server.fetch = (async (url: string, init: RequestInit) => {
      if (
        new URL(url).pathname === `/api/v1/workspaces/${WS}/documents` &&
        init.method === 'POST'
      ) {
        postReached()
        await postGate
      }
      return origFetch(url, init)
    }) as typeof server.fetch

    const createPromise = ctx.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Lasting org-less folder',
    })
    await onPostReached

    // The selected org was deactivated / the picker came back: an org-less
    // status push WITHOUT orgsError is a real session boundary, not the
    // transient /orgs read failure R4-02 keeps.
    ctx.setSelectedOrg(null)
    ctx.service.noteSelectedOrg(null, true)

    releasePost()
    const created = await createPromise
    expect(created.ok).toBe(true)

    for (const timer of scheduled) {
      if (!timer.cancelled) {
        expect(timer.ms).toBe(TREE_CHANGED_WINDOW_MS)
        timer.run()
      }
    }
    expect(emitted).toEqual([])
  })

  it('R5-02: suppresses pushTreeChanged when noteSelectedOrg goes A -> null (transient) -> B while an own folder action is gated', async () => {
    const server = fakeServer()
    const origFetch = server.fetch
    const ctx = setup(server)
    const emitted: Array<{ workspaceId: string }> = []
    const scheduled: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
    const coalescer = createTreeChangedCoalescer({
      emit: (workspaceId) => emitted.push({ workspaceId }),
      schedule: (run, ms) => {
        const entry = { run, ms, cancelled: false }
        scheduled.push(entry)
        return () => {
          entry.cancelled = true
        }
      },
    })
    ctx.setPushTreeChanged((event) => coalescer.notify(event.workspaceId))
    ctx.setStopRuntime(() => coalescer.cancel())

    let postReached!: () => void
    const onPostReached = new Promise<void>((resolve) => {
      postReached = resolve
    })
    let releasePost!: () => void
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    server.fetch = (async (url: string, init: RequestInit) => {
      if (
        new URL(url).pathname === `/api/v1/workspaces/${WS}/documents` &&
        init.method === 'POST'
      ) {
        postReached()
        await postGate
      }
      return origFetch(url, init)
    }) as typeof server.fetch

    const createPromise = ctx.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Transient null then org switch folder',
    })
    await onPostReached

    // A transient /orgs failure reports null first; the session then lands on
    // a DIFFERENT org (never back to A): the null must not eat the A -> B edge.
    ctx.setSelectedOrg(null)
    ctx.service.noteSelectedOrg(null)
    ctx.setSelectedOrg({ id: 'org_b', slug: 'beta' })
    ctx.service.noteSelectedOrg('org_b')

    releasePost()
    const created = await createPromise
    expect(created.ok).toBe(true)

    for (const timer of scheduled) {
      if (!timer.cancelled) {
        expect(timer.ms).toBe(TREE_CHANGED_WINDOW_MS)
        timer.run()
      }
    }
    expect(emitted).toEqual([])
  })
})

// SAVE-01 / MYFOLDER-01: the folder server-codes `my_folder_locked` and
// `invalid_destination` carry the action to the renderer as themselves, never
// as the bare envelope error_class. `my_folder_locked` arrives as 409 with
// error_class "conflict": if the client ever switches on the class first, the
// move would be treated as a revision conflict - re-read, retried, and finally
// reported as "conflict" while the file never moved. These tests pin the
// code-first mapping end-to-end: exactly one move POST, no re-read past the
// initial ref fetch, and the typed code on the result.
describe('SAVE-01 my_folder_locked and invalid_destination', () => {
  it('maps a 409 my_folder_locked move refusal by code, once, never as a conflict retry', async () => {
    const server = fakeServer({ myFolderLocked: true })
    const ctx = setup(server)
    const moved = await ctx.service.moveDocument({ documentId: DOC, parentId: 'fold_1' })
    expect(moved).toEqual({ ok: false, error: 'my_folder_locked' })
    // one GET /documents/{id} (the revision read) + one POST .../move: a
    // conflict path would read and post again
    expect(server.calls).toHaveLength(2)
    expect(
      server.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/move')),
    ).toHaveLength(1)
  })

  it('answers rename and archive of the locked row as my_folder_locked too', async () => {
    const server = fakeServer({ myFolderLocked: true })
    const ctx = setup(server)
    expect(await ctx.service.renameDocument(DOC, 'Q4 plan v2.docx')).toEqual({
      ok: false,
      error: 'my_folder_locked',
    })
    expect(await ctx.service.archiveDocument(DOC)).toEqual({
      ok: false,
      error: 'my_folder_locked',
    })
  })

  it('answers a create refused 400 invalid_destination as the field error, once', async () => {
    const server = fakeServer({ invalidDestination: true })
    const ctx = setup(server)
    expect(
      await ctx.service.createFolder({ workspaceId: WS, parentId: null, title: 'Contracts' }),
    ).toEqual({ ok: false, error: 'invalid_destination' })
    expect(server.calls).toHaveLength(1)
  })
})

// SAVE-01: the first Save to UniWork of an unbound tab - the editor flushes,
// the document is created (My Folder by default, or the picked folder), and
// the tab binds to it so the next Ctrl+S is a plain bound save.
describe('SAVE-01 first save', () => {
  it('flushes the editor, creates with destination my_folder and binds the tab', async () => {
    const server = fakeServer()
    const ctx = setup(server, { pathOpen: true, moduleSaveWrites: 'fresh editor bytes' })
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'stale disk bytes')

    const saved = await ctx.service.firstSave({
      tabPath: file,
      title: 'Draft.docx',
      workspaceId: WS,
      target: { kind: 'my_folder' },
    })

    expect(saved.ok).toBe(true)
    // ONE POST to the create route carrying the destination and the title in
    // the fields before the file part (Advisor Q6: title on create, no PATCH)
    const posts = server.calls.filter(
      (c) => c.method === 'POST' && c.path === `/api/v1/workspaces/${WS}/documents/files`,
    )
    expect(posts).toHaveLength(1)
    const body = posts[0]!.body as { destination?: unknown; parent_id?: unknown; title?: unknown }
    expect(body.destination).toBe('my_folder')
    expect(body.parent_id).toBeNull()
    expect(body.title).toBe('Draft.docx')
    // the bytes the editor wrote win over the stale disk copy
    expect(Buffer.from((posts[0]!.body as { bytes: Uint8Array }).bytes).toString('utf8')).toBe(
      'fresh editor bytes',
    )
    // the tab followed its file into the document's store folder
    expect(ctx.pathRenames).toHaveLength(1)
    const moved = ctx.pathRenames[0]!.newPath
    expect(ctx.service.isBound(moved)).toBe(true)
    const status = await ctx.service.docStatus(moved)
    expect(status?.state).toBe('ready')
    // the user's original file is left alone: still on disk, now unbound
    // (S01-W1-1); the store copy is the only bound file
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('fresh editor bytes')
    expect(ctx.service.isBound(file)).toBe(false)
    expect(ctx.treeChanged).toEqual([{ workspaceId: WS }])
  })

  it('creates under the picked folder with parent_id and no destination', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const file = join(dir, 'Local.docx')
    writeFileSync(file, 'bytes')

    const saved = await ctx.service.firstSave({
      tabPath: file,
      title: 'Local.docx',
      workspaceId: WS,
      target: { kind: 'folder', folderId: 'fold_1' },
    })

    expect(saved.ok).toBe(true)
    const post = server.calls.find(
      (c) => c.method === 'POST' && c.path === `/api/v1/workspaces/${WS}/documents/files`,
    )!
    const body = post.body as { destination?: unknown; parent_id?: unknown }
    expect(body.parent_id).toBe('fold_1')
    expect(body.destination).toBeNull()
  })

  it('refuses a path that is already bound (a second Lưu never double-creates)', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    // an open-by-id open leaves the tab bound to DOC's working copy
    const opened = await ctx.service.openDocument(DOC)
    expect(opened.ok).toBe(true)
    const boundPath = opened.ok ? opened.value.path : ''
    const callsBefore = server.calls.length

    const again = await ctx.service.firstSave({
      tabPath: boundPath,
      title: 'Draft.docx',
      workspaceId: WS,
      target: { kind: 'my_folder' },
    })

    expect(again).toEqual({ ok: false, error: 'conflict' })
    expect(server.calls).toHaveLength(callsBefore)
  })

  it('suppresses the tree push when the session is lost while the create is in flight', async () => {
    const server = fakeServer()
    // the drop lands inside notifyPathRenamed: the document is created and the
    // working copy bound, only the FD-11 own-action push must never arrive
    const ctx = setup(server, { onPathMoved: () => ctx.setIdentity(null) })
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')

    const saved = await ctx.service.firstSave({
      tabPath: file,
      title: 'Draft.docx',
      workspaceId: WS,
      target: { kind: 'my_folder' },
    })

    expect(saved.ok).toBe(true)
    expect(ctx.treeChanged).toEqual([])
  })

  it('ensureMyFolder posts once to the my-folder route and parses systemKind', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const ensured = await ctx.service.ensureMyFolder(WS)
    expect(ensured.ok).toBe(true)
    if (!ensured.ok) return
    expect(ensured.value.id).toBe('fold_my')
    expect(ensured.value.systemKind).toBe('my_folder')
    const post = server.calls.find(
      (c) => c.path === `/api/v1/workspaces/${WS}/documents/my-folder`,
    )!
    expect(post.method).toBe('POST')
    // a second ensure is idempotent on the server: same row id answers again
    const again = await ctx.service.ensureMyFolder(WS)
    expect(again.ok && again.value.id === 'fold_my').toBe(true)
  })
  // S01-W1-1: a first save binds the tab to a copy inside the store. The file
  // the user opened is theirs - it stays where it is, byte for byte, and the
  // old path simply stops being the tab's file.
  it('never touches the original file while re-keying the tab to the store copy', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const file = join(dir, 'Report.docx')
    writeFileSync(file, 'original bytes keep me')
    const before = statSync(file)

    const saved = await ctx.service.firstSave({
      tabPath: file,
      title: 'Report.docx',
      workspaceId: WS,
      target: { kind: 'my_folder' },
    })

    expect(saved.ok).toBe(true)
    // the original: still there, identical bytes, untouched mtime, unbound
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('original bytes keep me')
    expect(statSync(file).mtimeMs).toBe(before.mtimeMs)
    expect(ctx.service.isBound(file)).toBe(false)
    // the tab now lives at a bound working copy of the new document
    const [moved] = ctx.pathRenames
    expect(moved?.oldPath).toBe(file)
    expect(moved?.newPath).not.toBe(file)
    expect(ctx.service.isBound(moved!.newPath)).toBe(true)
    // the next save is a bound save (module-save path, never another create)
    const status = await ctx.service.save(moved!.newPath)
    expect(status).not.toBeNull()
    expect(status!.path).toBe(moved!.newPath)
    expect(status!.documentId).toBe(saved.ok ? saved.value.id : '')
    expect(
      server.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/documents/files')),
    ).toHaveLength(1)
  })
})

describe('SAVE-01 first save r2 (S01-R1 fixes)', () => {
  const input = (file: string, target?: unknown) => ({
    tabPath: file,
    title: 'Draft.docx',
    workspaceId: WS,
    target: (target ?? { kind: 'my_folder' }) as never,
  })

  // S01-R1-1: a flush the module refused (or timed out on) must fail the save
  // BEFORE anything leaves - no POST, no binding, no re-key, original file
  // untouched. Uploading the stale disk bytes would silently replace what the
  // editor holds.
  it('a refused module flush fails the save with no request at all', async () => {
    const server = fakeServer()
    const ctx = setup(server, { pathOpen: true, moduleSaveResult: false })
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'stale disk bytes')

    const saved = await ctx.service.firstSave(input(file))

    expect(saved).toEqual({ ok: false, error: 'first_save_flush_failed' })
    expect(server.calls).toHaveLength(0)
    expect(ctx.moduleSaveCalls).toEqual([file])
    expect(ctx.pathRenames).toEqual([])
    expect(ctx.service.isBound(file)).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('stale disk bytes')
  })

  it('a module flush that never answers fails the save after the wait, no request', async () => {
    const server = fakeServer()
    const ctx = setup(server, {
      pathOpen: true,
      moduleSaveSilent: true,
      firstSaveFlushTimeoutMs: 25,
    })
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'stale disk bytes')

    const saved = await ctx.service.firstSave(input(file))

    expect(saved).toEqual({ ok: false, error: 'first_save_flush_failed' })
    expect(server.calls).toHaveLength(0)
    expect(ctx.service.isBound(file)).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('stale disk bytes')
  })

  // S01-R1-5: the Advisor pin - anything outside the exact target union is
  // invalid_destination and NEVER reaches stat/read/POST, so an empty parent
  // can never land the document at the workspace root.
  it('refuses empty, blank or unknown targets as invalid_destination with zero requests', async () => {
    const server = fakeServer()
    const ctx = setup(server, { pathOpen: true })
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')

    for (const target of [
      { kind: 'folder', folderId: '' },
      { kind: 'folder', folderId: '   ' },
      { kind: 'folder' },
      { kind: 'folder', folderId: 7 },
      { kind: 'everywhere' },
      'my_folder',
    ]) {
      const saved = await ctx.service.firstSave(input(file, target))
      expect(saved).toEqual({ ok: false, error: 'invalid_destination' })
    }
    // zero requests AND zero flushes: validation precedes the editor round-trip
    expect(server.calls).toHaveLength(0)
    expect(ctx.moduleSaveCalls).toEqual([])
    expect(ctx.service.isBound(file)).toBe(false)
  })

  // S01-R1-9 / merge M-2 (D-S1): first-save runs the upload's own preflight
  // before buffering: stat + regular-file + the ONE size guard. Under D's
  // default 200 MiB cap the effective limit is the 50 MiB staging cap.
  it('refuses a file over the 50 MiB cap unread', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const file = join(dir, 'Huge.docx')
    writeFileSync(file, 'x')
    // extend with sparse zeros: 50 MiB + 1 byte, without writing 50 MiB
    truncateSync(file, 50 * 1024 * 1024 + 1)

    const saved = await ctx.service.firstSave(input(file, undefined))

    expect(saved).toEqual({
      ok: false,
      error: 'too_large',
      name: 'Huge.docx',
      sizeBytes: 50 * 1024 * 1024 + 1,
      maxBytes: 50 * 1024 * 1024,
    })
    // refused unread, and nothing created, bound or moved; the limits read
    // (`GET /api/v1/config`) is the only request the call makes
    expect(vi.mocked(readFile).mock.calls.map((call) => String(call[0]))).not.toContain(file)
    expect(server.calls.filter((call) => call.method === 'GET').map((call) => call.path)).toEqual([
      '/api/v1/config',
    ])
    expect(server.calls.filter((call) => call.method !== 'GET')).toEqual([])
    expect(ctx.pathRenames).toEqual([])
    expect(ctx.service.isBound(file)).toBe(false)
  })

  // BIGUP-A1 (UNI-1864): the same ONE preflight, but the 50 MiB branch applies
  // only to a deployment with NO chunked threshold. With a threshold present a
  // bigger file goes through an upload session instead, so the staging cap must
  // NOT refuse it.
  describe('BIGUP-A1: the single-request staging cap', () => {
    it('refuses a sparse file over 50 MiB unread when the server has no chunked threshold', async () => {
      // no threshold in `documents.limits`: a `local` storage that cannot
      // presign parts, so the 50 MiB staging cap is still the effective limit
      const server = fakeServer({ limits: { upload_max_bytes: 200 * 1024 * 1024 } })
      const ctx = setup(server)
      const file = join(dir, 'NoThreshold.docx')
      writeFileSync(file, 'x')
      truncateSync(file, 50 * 1024 * 1024 + 1)

      const uploaded = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-no-threshold',
      })

      expect(uploaded).toEqual({
        ok: false,
        error: 'too_large',
        name: 'NoThreshold.docx',
        sizeBytes: 50 * 1024 * 1024 + 1,
        maxBytes: 50 * 1024 * 1024,
      })
      // refused unread: the file's bytes never enter main
      expect(vi.mocked(readFile).mock.calls.map((call) => String(call[0]))).not.toContain(file)
      // and no upload request was made: the limits read is the only one
      expect(server.calls.filter((call) => call.method !== 'GET')).toEqual([])
      expect(ctx.progress).toHaveLength(0)
    })

    it('takes the same file through an upload session when the threshold is present', async () => {
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
      })
      const ctx = setup(server, { syncStore: true })
      const file = join(dir, 'Chunked.docx')
      // a real ZIP: the probe refuses a package without its main folder
      const bytes = buildDocxBytes(30 * 1024 * 1024)
      writeFileSync(file, bytes)

      const uploaded = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: 'fold_1',
        path: file,
        uploadId: 'up-chunked',
      })

      expect(uploaded.ok).toBe(true)
      if (!uploaded.ok) return
      // the whole file never entered main: it was read in parts off the handle
      expect(vi.mocked(readFile).mock.calls.map((call) => String(call[0]))).not.toContain(file)
      const created = server.calls.find(
        (call) => call.path === `/api/v1/workspaces/${WS}/documents/upload-sessions`,
      )!
      expect(created.method).toBe('POST')
      expect(created.body).toMatchObject({
        filename: 'Chunked.docx',
        size_bytes: bytes.byteLength,
        parent_id: 'fold_1',
        title: 'Chunked.docx',
      })
      // 30 MiB in 8 MiB parts = 4 parts, all PUT, then one complete
      const parts = server.calls.filter((call) => call.path.startsWith('/part/'))
      expect(parts).toHaveLength(4)
      for (const part of parts) expect(part.method).toBe('PUT')
      const complete = server.calls.find((call) => call.path.endsWith('/complete'))!
      expect((complete.body as { parts: unknown[] }).parts).toHaveLength(4)
      // progress: uploading first, then the checking phase, then done
      expect(ctx.progress.some((event) => event.phase === 'checking')).toBe(true)
      expect(ctx.progress.at(-1)).toMatchObject({
        loaded: bytes.byteLength,
        total: bytes.byteLength,
      })
    })

    it('refuses a macro package locally, before any session is opened', async () => {
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
      })
      const ctx = setup(server, { syncStore: true })
      const file = join(dir, 'Macro.docx')
      writeFileSync(file, buildDocxBytes(30 * 1024 * 1024, { macro: true }))

      const uploaded = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-macro',
      })

      expect(uploaded).toEqual({ ok: false, error: 'unsupported_format' })
      expect(server.calls.filter((call) => call.path.includes('upload-sessions'))).toHaveLength(0)
    })

    it('falls back to the one-request path when the server answers upload_session_too_small', async () => {
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        sessionTooSmall: true,
      })
      const ctx = setup(server, { syncStore: true })
      const file = join(dir, 'Drifted.docx')
      // the session route refuses it, so it must fit one request (< 50 MiB)
      writeFileSync(file, 'small enough for one request')

      const uploaded = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-drift',
      })

      expect(uploaded.ok).toBe(true)
      const oneRequest = server.calls.find((call) => call.path.endsWith('/documents/files'))!
      expect(oneRequest.method).toBe('POST')
      expect((oneRequest.body as { bytes: Uint8Array }).bytes.byteLength).toBe(
        enc('small enough for one request').byteLength,
      )
    })

    it('cancels a chunked upload: the in-flight PUTs stop and the session is deleted', async () => {
      const gate = latch()
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        partGate: () => {
          gate.entered()
          return gate.held
        },
      })
      const ctx = setup(server, { syncStore: true })
      const file = join(dir, 'Cancel.docx')
      writeFileSync(file, buildDocxBytes(30 * 1024 * 1024))

      const pending = ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-cancel',
      })
      // the first part PUT is held open: cancel while it is genuinely in flight
      await gate.reached
      ctx.service.cancelUpload('up-cancel')
      gate.release()
      const uploaded = await pending

      expect(uploaded).toEqual({ ok: false, error: 'upload_cancelled' })
      const deleted = server.calls.find((call) => call.method === 'DELETE')!
      expect(deleted.path).toMatch(/^\/api\/v1\/upload-sessions\//)
      expect(server.calls.filter((call) => call.path.endsWith('/complete'))).toHaveLength(0)
    })

    it('keeps its resume record when an attempt fails, and the next upload re-reads the session', async () => {
      const first = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        sessionPartSize: 8 * 1024 * 1024,
        partFailsOnceAt: 2,
      })
      const ctxA = setup(first, { syncStore: true })
      const file = join(dir, 'Resume.docx')
      writeFileSync(file, buildDocxBytes(20 * 1024 * 1024))
      // part 2 is refused for good: the run reports the server's format error.
      // A part failure is not a cancel, so the session is NOT aborted and the
      // saved record survives - that is what a crash mid-upload leaves too.
      const failed = await ctxA.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-resume',
      })
      expect(failed).toEqual({ ok: false, error: 'unsupported_format' })
      expect(first.calls.filter((call) => call.method === 'DELETE')).toHaveLength(0)

      // restart: a fresh service over the same store dir, and the server still
      // holds part 1 with the session open
      const second = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        sessionPartSize: 8 * 1024 * 1024,
      })
      second.state.session = {
        sessionId: 'ups_1',
        sizeBytes: 20 * 1024 * 1024,
        filename: 'Resume.docx',
        parentId: null,
        title: null,
        key: 'resume-fixture',
      }
      second.state.completedParts = [{ part_number: 1, etag: 'etag-1' }]
      const ctxB = setup(second, { syncStore: true })
      const resumed = await ctxB.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-resume-2',
      })

      expect(resumed.ok).toBe(true)
      // the saved session was looked up, not created, and only parts 2 and 3
      // went again
      const refresh = second.calls.find(
        (call) => call.method === 'GET' && call.path.startsWith('/api/v1/upload-sessions/'),
      )!
      expect(refresh.path).toBe('/api/v1/upload-sessions/ups_1')
      expect(
        second.calls.filter(
          (call) => call.path === '/api/v1/workspaces/ws_1/documents/upload-sessions',
        ),
      ).toHaveLength(0)
      const putParts = second.calls
        .filter((call) => call.path.startsWith('/part/'))
        .map((call) => (call.body as { partNumber: number }).partNumber)
      // only the missing parts went again; the pool runs them concurrently, so
      // their PUT order is not guaranteed
      expect([...putParts].sort((a, b) => a - b)).toEqual([2, 3])
      const complete = second.calls.find((call) => call.path.endsWith('/complete'))!
      expect((complete.body as { parts: Array<{ part_number: number }> }).parts).toHaveLength(3)
    })

    it('reports a part refused for good as the server format error and never completes', async () => {
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        sessionPartSize: 8 * 1024 * 1024,
        partFailsOnceAt: 1,
      })
      const ctx = setup(server, { syncStore: true })
      const file = join(dir, 'Abort.docx')
      writeFileSync(file, buildDocxBytes(20 * 1024 * 1024))

      const uploaded = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-abort',
      })

      // the contract maps a 415 to `unsupported_format`; `complete` never runs,
      // and the session stays for the retry the resume record enables
      expect(uploaded).toEqual({ ok: false, error: 'unsupported_format' })
      expect(server.calls.filter((call) => call.path.endsWith('/complete'))).toHaveLength(0)
      expect(server.calls.filter((call) => call.method === 'DELETE')).toHaveLength(0)
    })

    it('takes a valid > 50 MiB package through the session when the threshold is present', async () => {
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        sessionAssemblesParts: true,
      })
      const ctx = setup(server, { syncStore: true })
      const file = join(dir, 'Huge.docx')
      // a real 60 MiB package: above the 50 MiB single-request staging cap,
      // accepted only because the threshold opens the chunked path
      const bytes = buildDocxBytes(60 * 1024 * 1024)
      writeFileSync(file, bytes)

      const uploaded = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-huge',
      })

      expect(uploaded.ok).toBe(true)
      // the whole file never entered main
      expect(vi.mocked(readFile).mock.calls.map((call) => String(call[0]))).not.toContain(file)
      // 60 MiB in 8 MiB parts = 8 parts, all PUT, then one complete
      const parts = server.calls.filter((call) => call.path.startsWith('/part/'))
      expect(parts).toHaveLength(8)
      for (const part of parts) expect(part.method).toBe('PUT')
      expect(server.calls.find((call) => call.path.endsWith('/complete'))).toBeTruthy()
    })

    it('R1-BE-02: a cancel while the store refused the record still deletes the session', async () => {
      const gate = latch()
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        partGate: () => {
          gate.entered()
          return gate.held
        },
      })
      // a store so small its `put` refuses: the resume record never lands, so
      // the session id must come from the running operation's memory
      const ctx = setup(server, { syncStore: true, syncStoreBudgetBytes: 16 })
      const file = join(dir, 'CancelNoStore.docx')
      writeFileSync(file, buildDocxBytes(30 * 1024 * 1024))

      const pending = ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-cancel-nostore',
      })
      await gate.reached
      const liveSessionId = server.state.session!.sessionId
      ctx.service.cancelUpload('up-cancel-nostore')
      gate.release()
      const uploaded = await pending

      expect(uploaded).toEqual({ ok: false, error: 'upload_cancelled' })
      // the DELETE was issued even though no record was ever persisted
      const deleted = server.calls.find((call) => call.method === 'DELETE')!
      expect(deleted.path).toBe(`/api/v1/upload-sessions/${liveSessionId}`)
    })

    it('R1-BE-03: re-picking the same file for another folder aborts the old session', async () => {
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        sessionPartSize: 8 * 1024 * 1024,
        partFailsOnceAt: 1,
      })
      const ctx = setup(server, { syncStore: true })
      const file = join(dir, 'TwoFolders.docx')
      writeFileSync(file, buildDocxBytes(20 * 1024 * 1024))

      // first pick: folder A. part 1 is refused for good, so the record
      // survives (a failure is not a cancel) and the session stays open
      const first = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: 'fold_a',
        path: file,
        uploadId: 'up-folder-a',
      })
      expect(first.ok).toBe(false)
      expect(server.calls.filter((call) => call.method === 'DELETE')).toHaveLength(0)
      const sessionA = server.state.session!.sessionId

      // second pick: the same unchanged file, now aimed at folder B. The saved
      // record's fingerprint names folder A, so it is NOT resumed: the old
      // session is aborted and a fresh one is created for folder B
      const second = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: 'fold_b',
        path: file,
        uploadId: 'up-folder-b',
      })

      expect(second.ok).toBe(true)
      const aborted = server.calls.find((call) => call.method === 'DELETE')!
      expect(aborted.path).toBe(`/api/v1/upload-sessions/${sessionA}`)
      const creates = server.calls.filter(
        (call) => call.path === `/api/v1/workspaces/ws_1/documents/upload-sessions`,
      )
      expect(creates).toHaveLength(2)
      const secondCreate = creates[1]!.body as { parent_id?: string }
      expect(secondCreate.parent_id).toBe('fold_b')
    })

    it('R1-BE-03: a first save retried under another title does not finish the old command', async () => {
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        sessionPartSize: 8 * 1024 * 1024,
        partFailsOnceAt: 1,
        // R1-BE-04: the chunked first save verifies the copied working copy
        // against the server checksum, so the fake's complete must answer the
        // bytes its storage actually assembled
        sessionAssemblesParts: true,
      })
      const ctx = setup(server, { syncStore: true })
      const file = join(dir, 'Retitle.docx')
      writeFileSync(file, buildDocxBytes(20 * 1024 * 1024))

      const first = await ctx.service.firstSave({
        tabPath: file,
        title: 'First title.docx',
        workspaceId: WS,
        target: { kind: 'my_folder' },
      })
      expect(first.ok).toBe(false)
      const sessionA = server.state.session!.sessionId

      const second = await ctx.service.firstSave({
        tabPath: file,
        title: 'Second title.docx',
        workspaceId: WS,
        target: { kind: 'my_folder' },
      })
      expect(second.ok).toBe(true)
      // the old title's session was aborted, and the new create carries the
      // new title - never the old session finished under the old title
      const aborted = server.calls.find((call) => call.method === 'DELETE')!
      expect(aborted.path).toBe(`/api/v1/upload-sessions/${sessionA}`)
      const creates = server.calls.filter(
        (call) => call.path === `/api/v1/workspaces/ws_1/documents/upload-sessions`,
      )
      const secondCreate = creates[1]!.body as { title?: string }
      expect(secondCreate.title).toBe('Second title.docx')
    })

    it('R1-BE-04: a source changed under the upload is never bound as ready', async () => {
      const gate = latch()
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        sessionPartSize: 8 * 1024 * 1024,
        sessionAssemblesParts: true,
        sessionCompleteGate: () => {
          gate.entered()
          return gate.held
        },
      })
      const ctx = setup(server, { syncStore: true })
      const file = join(dir, 'Drift.docx')
      writeFileSync(file, buildDocxBytes(20 * 1024 * 1024))

      const pending = ctx.service.firstSave({
        tabPath: file,
        title: 'Drift.docx',
        workspaceId: WS,
        target: { kind: 'my_folder' },
      })
      // the server is validating the uploaded bytes: the editor autosaves a
      // new generation of the same file at the same path
      await gate.reached
      const driftedBytes = buildDocxBytes(20 * 1024 * 1024, { macro: false }).fill(7, 4096, 8192)
      writeFileSync(file, driftedBytes)
      gate.release()
      const saved = await pending

      // the mismatch is refused: nothing is bound, and the created row is
      // compensated (archived) rather than left without a binding
      expect(saved.ok).toBe(false)
      expect(ctx.pathRenames).toHaveLength(0)
      expect(
        server.calls.some((call) => call.method === 'POST' && call.path.endsWith('/archive')),
      ).toBe(true)
      // the user's own file is untouched
      expect(existsSync(file)).toBe(true)
      expect(readFileSync(file).compare(driftedBytes)).toBe(0)
    })

    it('R1-BE-02: a failed DELETE is not reported as clean and the record survives', async () => {
      const gate = latch()
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        sessionDeleteRefused: true,
        partGate: () => {
          gate.entered()
          return gate.held
        },
      })
      const ctx = setup(server, { syncStore: true })
      const file = join(dir, 'DeleteRefused.docx')
      writeFileSync(file, buildDocxBytes(30 * 1024 * 1024))

      const pending = ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-delete-refused',
      })
      await gate.reached
      ctx.service.cancelUpload('up-delete-refused')
      gate.release()
      const uploaded = await pending

      // the person still sees their cancel; the refused abort is logged, not
      // silently swallowed, and the saved record is KEPT - a later start for
      // the same unchanged file re-reads that session (a GET) instead of
      // creating a new one, so the abort can be retried
      expect(uploaded).toEqual({ ok: false, error: 'upload_cancelled' })
      expect(server.calls.some((call) => call.method === 'DELETE')).toBe(true)

      const next = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-delete-refused-2',
      })
      expect(next.ok).toBe(true)
      // the saved record was resumed: the run re-read the old session, and no
      // second session was created
      expect(
        server.calls.some(
          (call) => call.method === 'GET' && call.path.startsWith('/api/v1/upload-sessions/'),
        ),
      ).toBe(true)
      expect(
        server.calls.filter(
          (call) =>
            call.method === 'POST' &&
            call.path === `/api/v1/workspaces/ws_1/documents/upload-sessions`,
        ),
      ).toHaveLength(1)
    })

    it('R1-BE-08: a session create mismatch restarts once under a fresh key', async () => {
      const server = fakeServer({
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 20 * 1024 * 1024,
        sessionPartSize: 8 * 1024 * 1024,
        sessionCreateMismatch: true,
        sessionAssemblesParts: true,
      })
      const ctx = setup(server, { syncStore: true })
      const file = join(dir, 'Mismatch.docx')
      writeFileSync(file, buildDocxBytes(20 * 1024 * 1024))

      const uploaded = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-mismatch',
      })

      expect(uploaded.ok).toBe(true)
      const creates = server.calls.filter(
        (call) => call.path === `/api/v1/workspaces/ws_1/documents/upload-sessions`,
      )
      expect(creates).toHaveLength(2)
      // the retry never replayed the rejected key
      expect(creates[0]!.idempotencyKey).not.toBe(creates[1]!.idempotencyKey)
      expect(creates[1]!.idempotencyKey).toBeTruthy()
    })
  })

  // merge M-2 (D-S1, BINDING): upload AND first save share ONE size preflight.
  // The limits read is the upload path's own, so a server `upload_max_bytes`
  // below D's 50 MiB staging cap now refuses a first save too - typed, naming
  // the file, its size and the effective limit, before anything is read or
  // created.
  describe('merge M-2: the one upload+save size preflight', () => {
    /** the `file` part's bytes of a multipart POST the fake recorded */
    const postedBytes = (body: unknown): Uint8Array | null =>
      typeof body === 'object' &&
      body !== null &&
      'bytes' in body &&
      body.bytes instanceof Uint8Array
        ? body.bytes
        : null

    it('refuses a file above a lower server cap with the limit named, zero creates, no bind', async () => {
      const server = fakeServer({ limits: { upload_max_bytes: 1024 * 1024 } })
      const ctx = setup(server)
      const file = join(dir, 'Big.docx')
      writeFileSync(file, 'x')
      truncateSync(file, 2 * 1024 * 1024)

      const saved = await ctx.service.firstSave(input(file))

      expect(saved).toEqual({
        ok: false,
        error: 'too_large',
        name: 'Big.docx',
        sizeBytes: 2 * 1024 * 1024,
        maxBytes: 1024 * 1024,
      })
      // refused before the read: the file's bytes never enter main
      expect(vi.mocked(readFile).mock.calls.map((call) => String(call[0]))).not.toContain(file)
      // zero create/upload requests: the limits read is the only request
      expect(server.calls.filter((call) => call.path.endsWith('/documents/files'))).toHaveLength(0)
      expect(server.calls.filter((call) => call.method !== 'GET')).toEqual([])
      // no working-copy/binding change, and the file is byte-identical
      expect(ctx.pathRenames).toEqual([])
      expect(ctx.service.isBound(file)).toBe(false)
      expect(readFileSync(file).byteLength).toBe(2 * 1024 * 1024)
    })

    it('still sends a file exactly at the server cap', async () => {
      const server = fakeServer({ limits: { upload_max_bytes: 1024 * 1024 } })
      const ctx = setup(server)
      const file = join(dir, 'AtCap.docx')
      writeFileSync(file, 'x')
      truncateSync(file, 1024 * 1024)

      const saved = await ctx.service.firstSave(input(file))

      expect(saved.ok).toBe(true)
      // the cap that let it through is the server's own, read once by this call
      expect(server.calls.filter((call) => call.path === '/api/v1/config')).toHaveLength(1)
      const posts = server.calls.filter(
        (call) =>
          call.method === 'POST' && call.path === `/api/v1/workspaces/${WS}/documents/files`,
      )
      expect(posts).toHaveLength(1)
      expect(postedBytes(posts[0]?.body)?.byteLength).toBe(1024 * 1024)
      expect(ctx.service.isBound(ctx.pathRenames[0]!.newPath)).toBe(true)
    })

    it('answers the renderer the same too_large fields the upload path answers', async () => {
      // one cap, two entry points: the same file, refused by the save and by
      // the upload, carries the identical renderer shape (the shared mapper)
      const server = fakeServer({ limits: { upload_max_bytes: 1024 * 1024 } })
      const ctx = setup(server)
      const file = join(dir, 'Twin.docx')
      writeFileSync(file, 'x')
      truncateSync(file, 3 * 1024 * 1024)

      const uploaded = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-merge-2',
      })

      const saved = await ctx.service.firstSave(input(file))

      expect(saved).toEqual(uploaded)
      expect(saved).toEqual({
        ok: false,
        error: 'too_large',
        name: 'Twin.docx',
        sizeBytes: 3 * 1024 * 1024,
        maxBytes: 1024 * 1024,
      })
    })

    // S01-R4-3: D can refuse the bytes itself after the local preflight passed
    // (a stale limits cache, or a cap lowered since the read). The upload path
    // re-wraps that answer with its own basename and payload length because
    // `errorFromResponse` fills the size fields but never the filename; the
    // first save must answer the renderer the same shape.
    it("adopts a server 413 too_large with the call's own basename, size and cap", async () => {
      // the cached cap is higher than the one D enforces, so only the server
      // refuses this file - and it refuses it after the bytes were read
      const server = fakeServer({
        limits: { upload_max_bytes: 8 * 1024 * 1024 },
        createTooLarge: true,
      })
      const ctx = setup(server)
      const file = join(dir, 'Adopted.docx')
      writeFileSync(file, 'x')
      truncateSync(file, 1024 * 1024)

      const saved = await ctx.service.firstSave(input(file))

      expect(saved).toEqual({
        ok: false,
        error: 'too_large',
        name: 'Adopted.docx',
        sizeBytes: 1024 * 1024,
        maxBytes: 8 * 1024 * 1024,
      })
      // one create attempt, and it left nothing behind: no bind, no move, no
      // compensation (the refusal precedes the row), original file intact
      expect(
        server.calls.filter(
          (call) => call.method === 'POST' && call.path.endsWith('/documents/files'),
        ),
      ).toHaveLength(1)
      expect(server.calls.filter((call) => call.path.endsWith('/archive'))).toHaveLength(0)
      expect(ctx.pathRenames).toEqual([])
      expect(ctx.service.isBound(file)).toBe(false)
      expect(readFileSync(file).byteLength).toBe(1024 * 1024)
    })

    // S01-R4-1: the stat and the read are two moments - a file that grows
    // between them is refused on what was actually buffered, exactly like the
    // upload path, and nothing of it leaves.
    it('refuses a first save whose file grew past the server cap between the stat and the read', async () => {
      const server = fakeServer({ limits: { upload_max_bytes: 1024 * 1024 } })
      const ctx = setup(server)
      const file = join(dir, 'Grown.docx')
      writeFileSync(file, 'x')
      const gate = latch()
      readGate.path = file
      readGate.entered = gate.entered
      readGate.held = gate.held

      const pending = ctx.service.firstSave(input(file))
      await gate.reached
      // the stat already saw 1 byte: only the post-read guard can refuse this
      truncateSync(file, 1024 * 1024 + 1)
      gate.release()
      const saved = await pending

      expect(saved).toEqual({
        ok: false,
        error: 'too_large',
        name: 'Grown.docx',
        sizeBytes: 1024 * 1024 + 1,
        maxBytes: 1024 * 1024,
      })
      expect(
        server.calls.filter(
          (call) => call.method === 'POST' && call.path.endsWith('/documents/files'),
        ),
      ).toHaveLength(0)
      expect(ctx.pathRenames).toEqual([])
      expect(ctx.service.isBound(file)).toBe(false)
    })

    it('refuses a first save whose file grew past the 50 MiB staging cap between the stat and the read', async () => {
      // the server cap is above the staging cap, so the second branch names
      // `min(max_bytes, 50 MiB)` as the effective limit
      const server = fakeServer({ limits: { upload_max_bytes: 200 * 1024 * 1024 } })
      const ctx = setup(server)
      const file = join(dir, 'Grown big.docx')
      writeFileSync(file, 'x')
      const gate = latch()
      readGate.path = file
      readGate.entered = gate.entered
      readGate.held = gate.held

      const pending = ctx.service.firstSave(input(file))
      await gate.reached
      truncateSync(file, 50 * 1024 * 1024 + 1)
      gate.release()
      const saved = await pending

      expect(saved).toEqual({
        ok: false,
        error: 'too_large',
        name: 'Grown big.docx',
        sizeBytes: 50 * 1024 * 1024 + 1,
        maxBytes: 50 * 1024 * 1024,
      })
      expect(
        server.calls.filter(
          (call) => call.method === 'POST' && call.path.endsWith('/documents/files'),
        ),
      ).toHaveLength(0)
      expect(ctx.service.isBound(file)).toBe(false)
    })

    it('refuses an upload whose file grew past the server cap between the stat and the read', async () => {
      // the upload path's own post-read guard, the one first save shares
      const server = fakeServer({ limits: { upload_max_bytes: 1024 * 1024 } })
      const ctx = setup(server)
      const file = join(dir, 'Grown upload.docx')
      writeFileSync(file, 'x')
      const gate = latch()
      readGate.path = file
      readGate.entered = gate.entered
      readGate.held = gate.held

      const pending = ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: 'up-grown',
      })
      await gate.reached
      truncateSync(file, 1024 * 1024 + 1)
      gate.release()
      const uploaded = await pending

      expect(uploaded).toEqual({
        ok: false,
        error: 'too_large',
        name: 'Grown upload.docx',
        sizeBytes: 1024 * 1024 + 1,
        maxBytes: 1024 * 1024,
      })
      expect(
        server.calls.filter(
          (call) => call.method === 'POST' && call.path.endsWith('/documents/files'),
        ),
      ).toHaveLength(0)
    })
  })

  // S01-R4-2: a settled refusal must release the path. The join map is the
  // single-flight's whole memory, so a leaked entry would keep answering the
  // old too_large - not `conflict` - after the user shrank the file and saved
  // again, and no request would ever be made.
  it('a second first save succeeds and binds once the too_large file is under the cap', async () => {
    const server = fakeServer({ limits: { upload_max_bytes: 1024 * 1024 } })
    const ctx = setup(server)
    const file = join(dir, 'Shrink.docx')
    writeFileSync(file, 'x')
    truncateSync(file, 2 * 1024 * 1024)

    const refused = await ctx.service.firstSave(input(file))
    expect(refused).toEqual({
      ok: false,
      error: 'too_large',
      name: 'Shrink.docx',
      sizeBytes: 2 * 1024 * 1024,
      maxBytes: 1024 * 1024,
    })

    truncateSync(file, 1024 * 1024)
    const saved = await ctx.service.firstSave(input(file))

    expect(saved.ok).toBe(true)
    expect(ctx.pathRenames).toHaveLength(1)
    expect(ctx.service.isBound(ctx.pathRenames[0]!.newPath)).toBe(true)
    // the retry is the call that created: the refusal created nothing
    expect(
      server.calls.filter(
        (call) => call.method === 'POST' && call.path.endsWith('/documents/files'),
      ),
    ).toHaveLength(1)
  })

  it('refuses a directory path before any read', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const folder = join(dir, 'Folder.docx')
    mkdirSync(folder)

    const saved = await ctx.service.firstSave(input(folder))

    expect(saved).toEqual({ ok: false, error: 'not_found' })
    expect(server.calls).toHaveLength(0)
  })

  // S01-R1-4: the single-flight joins a second submit of the same path onto
  // the running attempt - one create total.
  it('joins a concurrent second submit onto the one running attempt', async () => {
    const gate = latch()
    const server = fakeServer({
      createGate: async () => {
        gate.entered()
        await gate.held
      },
    })
    const ctx = setup(server)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')

    const first = ctx.service.firstSave(input(file))
    await gate.reached
    const second = ctx.service.firstSave(input(file))
    gate.release()

    const [one, two] = await Promise.all([first, second])
    expect(one).toEqual(two)
    expect(one.ok).toBe(true)
    expect(
      server.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/documents/files')),
    ).toHaveLength(1)
    // the document count on the server is the real invariant: one row
    expect([...server.state.documents.keys()].filter((id) => id.startsWith('up_'))).toHaveLength(1)
  })

  // S01-R1-4: the create landed but its answer was lost; the retry of the same
  // attempt replays the SAME Idempotency-Key and the server dedupes to the one
  // row. A fresh key here would mint a twin.
  it('retries a lost create answer with the same Idempotency-Key, one server document', async () => {
    const server = fakeServer({ createAnswerLost: true })
    const ctx = setup(server)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')

    const lost = await ctx.service.firstSave(input(file))
    expect(lost.ok).toBe(false)

    const retried = await ctx.service.firstSave(input(file))
    expect(retried.ok).toBe(true)

    const creates = server.calls.filter(
      (c) => c.method === 'POST' && c.path.endsWith('/documents/files'),
    )
    expect(creates).toHaveLength(2)
    expect(creates[0]!.idempotencyKey).toBeTruthy()
    expect(creates[0]!.idempotencyKey).toBe(creates[1]!.idempotencyKey)
    // one server document total, and the tab bound to it
    const created = [...server.state.documents.keys()].filter((id) => id.startsWith('up_'))
    expect(created).toHaveLength(1)
    expect(retried.ok ? retried.value.id : '').toBe(created[0])
    expect(ctx.pathRenames).toHaveLength(1)
  })

  // S01-R1-2: create landed, then the local bind fails. The created document
  // is compensated exactly like the FD-11 conflict copy: archive to the trash
  // (restorable), and the typed answer names the document.
  it.each([
    ['the bind read (getDocument)', { getDocumentFailsFor: true } as const, 'get'],
    ['the working-copy write', { writeWorkingCopy: true } as const, 'copy'],
    ['the binding.json write', { storeWrite: true } as const, 'binding'],
  ])(
    'when %s fails the created document is archived and the failure names it',
    async (_label, mode) => {
      const server = fakeServer()
      const ctx = setup(server)
      const file = join(dir, 'Draft.docx')
      writeFileSync(file, 'bytes')

      if ('getDocumentFailsFor' in mode) {
        // the created id is up_1: refuse its detail read
        const orig = server.fetch
        server.fetch = ((url: string, init: RequestInit) => {
          const m = /^.*\/documents\/(up_\d+)$/.exec(new URL(url).pathname)
          if (m && init.method === 'GET') {
            return Promise.resolve(
              new Response(JSON.stringify({ error: { code: 'unavailable' } }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
              }),
            )
          }
          return orig(url, init)
        }) as never
      } else if ('writeWorkingCopy' in mode) {
        vi.spyOn(ctx.service.store, 'writeWorkingCopy').mockRejectedValue(new Error('disk full'))
      } else {
        // the migration sweep holds the document's folder: a schema-1 binding
        // with pending-upload.bin in the dir the bind will use
        const docDirPath = docDir('up_1')
        mkdirSync(docDirPath, { recursive: true })
        writeFileSync(
          join(docDirPath, BINDING_FILE),
          JSON.stringify({ schema: 1, pendingIntent: {} }),
        )
        writeFileSync(join(docDirPath, INTENT_PAYLOAD_FILE), 'x')
      }

      const saved = await ctx.service.firstSave(input(file))

      expect(saved.ok).toBe(false)
      if (!saved.ok) {
        expect(saved.error).toBe('first_save_bind_failed')
        expect(saved.documentId).toBe('up_1')
        expect(saved.documentTitle).toBeTruthy()
      }
      // the compensating archive went out for the created document (trash,
      // restorable - never a delete)
      const archives = server.calls.filter(
        (c) => c.method === 'POST' && c.path === '/api/v1/documents/up_1/archive',
      )
      expect(archives).toHaveLength(1)
      expect(server.state.documents.get('up_1')?.archived).toBe(true)
      // the user's original file is untouched and stays unbound
      expect(readFileSync(file, 'utf8')).toBe('bytes')
      expect(ctx.service.isBound(file)).toBe(false)
      expect(ctx.pathRenames).toEqual([])
      expect(ctx.moduleSaveCalls).toEqual([])
    },
  )

  it('when the compensation archive also fails, the answer still names the document', async () => {
    const server = fakeServer({ archiveFailsFor: ['up_1'] })
    const ctx = setup(server)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    // force the bind failure at the binding write (migration-hold fixture)
    const docDirPath = docDir('up_1')
    mkdirSync(docDirPath, { recursive: true })
    writeFileSync(join(docDirPath, BINDING_FILE), JSON.stringify({ schema: 1, pendingIntent: {} }))
    writeFileSync(join(docDirPath, INTENT_PAYLOAD_FILE), 'x')

    const saved = await ctx.service.firstSave(input(file))

    expect(saved.ok).toBe(false)
    if (!saved.ok) {
      expect(saved.error).toBe('first_save_orphaned')
      expect(saved.documentId).toBe('up_1')
      expect(saved.documentTitle).toBe('Draft.docx')
    }
    expect(server.state.documents.get('up_1')?.archived).toBeUndefined()
  })

  // S01-R1-3: the written binding.json is the save - everything after it
  // (tab re-key, chip push, tree push) is a notification whose failure is
  // logged, never a retryable failure. And a retry from the original path is
  // refused: the document already exists.
  it('a throwing post-bind callback still answers ok, and a retry is refused', async () => {
    const server = fakeServer()
    const ctx = setup(server, { callbacksThrow: true })
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')

    const saved = await ctx.service.firstSave(input(file))
    expect(saved.ok).toBe(true)

    // one create only; the binding landed (the save IS done)
    const bindingRaw = JSON.parse(readFileSync(join(docDir('up_1'), BINDING_FILE), 'utf8')) as {
      documentId?: string
    }
    expect(bindingRaw.documentId).toBe('up_1')

    // a retry from the old path does not create a twin
    const again = await ctx.service.firstSave(input(file))
    expect(again).toEqual(expect.objectContaining({ ok: false, error: 'conflict' }))
    expect(
      server.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/documents/files')),
    ).toHaveLength(1)
  })

  // S01-R1-8: after the first save, binding.json holds the real base
  // (revision / version / checksum of the created version) and ONE bound save
  // runs the genuine upload+commit path - no create, no dialog.
  it('binds a real base and the next save is one upload + one commit', async () => {
    const server = fakeServer()
    // moduleSaveResult:false = no tab claims the save, so save() falls through
    // to the durable coordinator (the upload + commit pair is the real bound save)
    const ctx = setup(server, { syncStore: true, moduleSaveResult: false })
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes v1')

    const saved = await ctx.service.firstSave(input(file))
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const boundPath = ctx.pathRenames[0]!.newPath

    // the binding the open flow writes: base = the created row's revision and
    // version 1, checksum = the uploaded bytes
    const bound = JSON.parse(readFileSync(join(docDir('up_1'), BINDING_FILE), 'utf8')) as {
      documentId?: string
      baseRevision?: string
      baseVersion?: number
      baseChecksum?: string
      schema?: number
    }
    expect(bound.schema).toBe(2)
    expect(bound.documentId).toBe('up_1')
    expect(bound.baseRevision).toBe('41')
    expect(bound.baseVersion).toBe(1)
    expect(bound.baseChecksum).toBe(hex(enc('bytes v1')))

    // the tab's next Ctrl+S with edited bytes: a REAL bound save through the
    // coordinator (the module answers "no tab" so the queue runs inline)
    writeFileSync(boundPath, 'bytes v2')
    const status = await ctx.service.save(boundPath)
    expect(status?.state).toBe('saved')
    const uploads = server.calls.filter(
      (c) => c.method === 'POST' && c.path === '/api/v1/documents/up_1/uploads',
    )
    const commits = server.calls.filter(
      (c) => c.method === 'POST' && c.path === '/api/v1/documents/up_1/versions/commit',
    )
    expect(uploads).toHaveLength(1)
    expect(commits).toHaveLength(1)
    // still exactly one create (no second document, no dialog)
    expect(
      server.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/documents/files')),
    ).toHaveLength(1)
    expect(server.calls.filter((c) => c.path.endsWith('/documents/files/blank'))).toHaveLength(0)
  })
})

describe('SAVE-01 first save r3 (S01-R2 fixes)', () => {
  const input = (file: string, target?: unknown) => ({
    tabPath: file,
    title: 'Draft.docx',
    workspaceId: WS,
    target: (target ?? { kind: 'my_folder' }) as never,
  })

  // S01-R2-1: the Advisor pin orders the target union BEFORE the claimed-path
  // classification - a malformed target on a store-owned or done path is
  // invalid_destination, never a conflict, and never reaches binding.json, the
  // flush or a request.
  it('a malformed target on a path inside the working-copy store is invalid_destination, not conflict', async () => {
    const server = fakeServer()
    const ctx = setup(server, { pathOpen: true })
    // a path under the store's scope directory with a real binding.json:
    // store.classify would report it bound (the binding read itself) - the
    // target union must run before any of that
    const docDirPath = ctx.service.store.dirFor('default', 'acc_1', 'doc_x')
    mkdirSync(docDirPath, { recursive: true })
    await ctx.service.store.write(docDirPath, {
      schema: 2,
      documentId: 'doc_x',
      workspaceId: WS,
      orgId: 'org_a',
      title: 'Held.docx',
      filename: 'Held.docx',
      format: 'docx',
      access: 'edit',
      baseRevision: '1',
      baseVersion: 1,
      baseChecksum: 'x',
      state: 'ready',
      minStoreLevel: 2,
      minAppVersion: '0.0.0',
    })
    const storePath = join(docDirPath, 'Held.docx')
    writeFileSync(storePath, 'bytes')
    const classify = vi.spyOn(ctx.service.store, 'classify')

    const saved = await ctx.service.firstSave(input(storePath, { kind: 'folder', folderId: '  ' }))

    expect(saved).toEqual({ ok: false, error: 'invalid_destination' })
    // no binding.json read, no flush, no request - validation precedes all of it
    expect(classify).not.toHaveBeenCalled()
    expect(server.calls).toHaveLength(0)
    expect(ctx.moduleSaveCalls).toEqual([])
  })

  it('a malformed target on an already-claimed path is invalid_destination, not conflict', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')

    const saved = await ctx.service.firstSave(input(file))
    expect(saved.ok).toBe(true)

    // the path is claimed (firstSaveDone) - a malformed retry must still be
    // refused on the target, not silently re-classified as a conflict
    const again = await ctx.service.firstSave(input(file, { kind: 'everywhere' }))
    expect(again).toEqual({ ok: false, error: 'invalid_destination' })
    // still exactly the one create of the good save
    expect(
      server.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/documents/files')),
    ).toHaveLength(1)
  })

  // S01-R2-3: the retry key belongs to the exact attempt BODY - the bytes go
  // into the key fingerprint, so edited bytes mint a new attempt (D's own
  // fingerprint includes the checksum; replaying a spent key against different
  // bytes is refused there and must never be sent).
  it('a retry after the create answer was lost with CHANGED bytes uses a new Idempotency-Key', async () => {
    const server = fakeServer({ createAnswerLost: true })
    const ctx = setup(server)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes v1')

    const lost = await ctx.service.firstSave(input(file))
    expect(lost.ok).toBe(false)

    // the user edited the file between the lost answer and the retry: this is
    // a different body, so the spent key must not be replayed against it
    writeFileSync(file, 'bytes v2 edited')
    const retried = await ctx.service.firstSave(input(file))
    expect(retried.ok).toBe(true)

    const creates = server.calls.filter(
      (c) => c.method === 'POST' && c.path.endsWith('/documents/files'),
    )
    expect(creates).toHaveLength(2)
    expect(creates[0]!.idempotencyKey).toBeTruthy()
    expect(creates[1]!.idempotencyKey).toBeTruthy()
    expect(creates[1]!.idempotencyKey).not.toBe(creates[0]!.idempotencyKey)
    // S01-R3-4: the second create's multipart bytes and the row D stored ARE
    // the edited bytes - a stale-body replay would keep 'bytes v1' on both
    const secondBody = creates[1]!.body as { bytes?: Uint8Array }
    expect(secondBody.bytes).toEqual(enc('bytes v2 edited'))
    expect(retried.ok ? retried.value.id : '').toBe('up_2')
    expect(server.state.documents.get('up_2')?.bytes).toEqual(enc('bytes v2 edited'))
    // the lost-answer row is the orphan the mismatch guard exists to avoid
    // uploading stale bytes against: it keeps the FIRST attempt's body
    expect(server.state.documents.get('up_1')?.bytes).toEqual(enc('bytes v1'))
  })

  // S01-R2-3: when D answers idempotency_payload_mismatch for a first-save
  // create, the spent key is dropped and a typed idempotency_mismatch answers -
  // the next retry mints a fresh key, never stuck on the refused one.
  it('an idempotency mismatch answer clears the retained key; the retry sends a new one', async () => {
    const server = fakeServer({ createMismatch: true })
    const ctx = setup(server)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')

    const refused = await ctx.service.firstSave(input(file))
    expect(refused).toEqual({ ok: false, error: 'idempotency_mismatch' })

    // retry unchanged: the cleared map mints a fresh key (a stuck map would
    // replay the refused key and be refused again)
    const retried = await ctx.service.firstSave(input(file))
    expect(retried.ok).toBe(true)

    const creates = server.calls.filter(
      (c) => c.method === 'POST' && c.path.endsWith('/documents/files'),
    )
    expect(creates).toHaveLength(2)
    expect(creates[1]!.idempotencyKey).toBeTruthy()
    expect(creates[1]!.idempotencyKey).not.toBe(creates[0]!.idempotencyKey)
    // S01-R3-3: the retry bound a fresh row - D owns the refused row it seeded
    // under the refused key, so two rows exist and the second is the bound one
    const created = [...server.state.documents.keys()].filter((id) => id.startsWith('up_'))
    expect(created.sort()).toEqual(['up_1', 'up_2'])
    expect(retried.ok ? retried.value.id : '').toBe('up_2')
    const bound = JSON.parse(readFileSync(join(docDir('up_2'), BINDING_FILE), 'utf8')) as {
      documentId?: string
    }
    expect(bound.documentId).toBe('up_2')
  })

  // S01-R3-3: D's 409 `idempotency_in_flight` answers a key whose request is
  // still running server-side (errors.ts maps it to the retryable `network`).
  // The attempt's key is RETAINED - the in-flight verdict never clears it - so
  // an unchanged-body retry replays the SAME key and dedupes to the one row
  // the first create seeded instead of minting a twin.
  it('a 409 idempotency_in_flight keeps the key; an unchanged retry dedupes to one row', async () => {
    const server = fakeServer({ createInFlight: true })
    const ctx = setup(server)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')

    const refused = await ctx.service.firstSave(input(file))
    expect(refused).toEqual({ ok: false, error: 'network' })

    const retried = await ctx.service.firstSave(input(file))
    expect(retried.ok).toBe(true)

    const creates = server.calls.filter(
      (c) => c.method === 'POST' && c.path.endsWith('/documents/files'),
    )
    expect(creates).toHaveLength(2)
    expect(creates[0]!.idempotencyKey).toBeTruthy()
    expect(creates[0]!.idempotencyKey).toBe(creates[1]!.idempotencyKey)
    // one server document total (the seeded row), bound to up_1
    const created = [...server.state.documents.keys()].filter((id) => id.startsWith('up_'))
    expect(created).toEqual(['up_1'])
    expect(retried.ok ? retried.value.id : '').toBe('up_1')
    const bound = JSON.parse(readFileSync(join(docDir('up_1'), BINDING_FILE), 'utf8')) as {
      documentId?: string
    }
    expect(bound.documentId).toBe('up_1')
  })

  // S01-R2-5: after a compensated bind failure the attempt boundary is real -
  // the next retry is a NEW create under a different key (one trashed row plus
  // one bound row on the server).
  it('a retry after archive compensation sends a different Idempotency-Key and binds a fresh row', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    // fail the first bind at the binding.json write (migration-hold fixture)
    const docDirPath = docDir('up_1')
    mkdirSync(docDirPath, { recursive: true })
    writeFileSync(join(docDirPath, BINDING_FILE), JSON.stringify({ schema: 1, pendingIntent: {} }))
    writeFileSync(join(docDirPath, INTENT_PAYLOAD_FILE), 'x')

    const failed = await ctx.service.firstSave(input(file))
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error).toBe('first_save_bind_failed')
    expect(server.state.documents.get('up_1')?.archived).toBe(true)

    // clear the migration hold so the retry binds cleanly
    rmSync(docDirPath, { recursive: true, force: true })
    const retried = await ctx.service.firstSave(input(file))
    expect(retried.ok).toBe(true)

    const creates = server.calls.filter(
      (c) => c.method === 'POST' && c.path.endsWith('/documents/files'),
    )
    expect(creates).toHaveLength(2)
    expect(creates[1]!.idempotencyKey).not.toBe(creates[0]!.idempotencyKey)
    // one archived row (the compensated first create) + one bound row (up_2)
    const created = [...server.state.documents.keys()].filter((id) => id.startsWith('up_'))
    expect(created.sort()).toEqual(['up_1', 'up_2'])
    expect(server.state.documents.get('up_1')?.archived).toBe(true)
    expect(server.state.documents.get('up_2')?.archived).toBeUndefined()
    const bound = JSON.parse(readFileSync(join(docDir('up_2'), BINDING_FILE), 'utf8')) as {
      documentId?: string
    }
    expect(bound.documentId).toBe('up_2')
  })

  // S01-R2-6: store.write THROWING (not only resolving false) leaves the
  // working copy behind today - the compensation path must still remove it.
  it('a thrown store.write still archives the row and removes the working copy', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    const write = vi.spyOn(ctx.service.store, 'write').mockRejectedValue(new Error('disk full'))
    // S01-R3-1: the compensation calls removeWorkingCopy for THIS attempt's
    // copy - the (dir, name) it just wrote, nothing else
    const remove = vi.spyOn(ctx.service.store, 'removeWorkingCopy')

    const saved = await ctx.service.firstSave(input(file))

    expect(saved.ok).toBe(false)
    if (!saved.ok) expect(saved.error).toBe('first_save_bind_failed')
    // archive went out and the stranded working copy is gone
    const archives = server.calls.filter(
      (c) => c.method === 'POST' && c.path === '/api/v1/documents/up_1/archive',
    )
    expect(archives).toHaveLength(1)
    expect(server.state.documents.get('up_1')?.archived).toBe(true)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(docDir('up_1'), 'Draft.docx')
    const dirEntries = existsSync(docDir('up_1')) ? readdirSync(docDir('up_1')) : []
    expect(dirEntries.filter((name) => name !== BINDING_FILE)).toEqual([])

    // S01-R3-5: the compensated attempt's key is spent - a retry creates and
    // binds a FRESH row under a different key (replaying the compensated key
    // would answer the trashed row)
    write.mockRestore()
    const retried = await ctx.service.firstSave(input(file))
    expect(retried.ok).toBe(true)

    const creates = server.calls.filter(
      (c) => c.method === 'POST' && c.path.endsWith('/documents/files'),
    )
    expect(creates).toHaveLength(2)
    expect(creates[1]!.idempotencyKey).toBeTruthy()
    expect(creates[1]!.idempotencyKey).not.toBe(creates[0]!.idempotencyKey)
    // one archived first row + one newly bound row
    const created = [...server.state.documents.keys()].filter((id) => id.startsWith('up_'))
    expect(created.sort()).toEqual(['up_1', 'up_2'])
    expect(server.state.documents.get('up_1')?.archived).toBe(true)
    expect(server.state.documents.get('up_2')?.archived).toBeUndefined()
    expect(retried.ok ? retried.value.id : '').toBe('up_2')
    const bound = JSON.parse(readFileSync(join(docDir('up_2'), BINDING_FILE), 'utf8')) as {
      documentId?: string
    }
    expect(bound.documentId).toBe('up_2')
  })

  // S01-R2-6: a cleanup failure is logged and never masks the typed failure.
  it('a failing working-copy cleanup still answers the typed bind failure', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    vi.spyOn(ctx.service.store, 'write').mockRejectedValue(new Error('disk full'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const cleanupError = new Error('unlink denied')
    const remove = vi.spyOn(ctx.service.store, 'removeWorkingCopy').mockRejectedValue(cleanupError)

    const saved = await ctx.service.firstSave(input(file))

    expect(saved.ok).toBe(false)
    if (!saved.ok) expect(saved.error).toBe('first_save_bind_failed')
    expect(server.state.documents.get('up_1')?.archived).toBe(true)
    // S01-R3-1+2: cleanup ran against this attempt's (dir, name), and its
    // rejection is logged with the stranded-copy message and the cleanup
    // error itself - a silent skip or a missing diagnostic would hide the
    // copy the user could otherwise recover
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(docDir('up_1'), 'Draft.docx')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('stranded working copy Draft.docx could not be removed'),
      cleanupError,
    )
    warn.mockRestore()
  })
})

// S01-R2-4 (UNI-1847): a restart never turns one first Save into two UniWork
// documents. "Restart" = a NEW service instance over the same store root, the
// same encrypted sync store and the same server; the first instance is dropped.
// The first save leaves the ORIGINAL file plain (by design), so after a restart
// only a durable per-account record can tell that file was already saved.
describe('SAVE-01 first save r4 (S01-R2-4 restart dedupe)', () => {
  const input = (file: string) => ({
    tabPath: file,
    title: 'Draft.docx',
    workspaceId: WS,
    target: { kind: 'my_folder' } as never,
  })
  const fileCreates = (server: FakeServer) =>
    server.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/documents/files'))
  const sessionOpens = (server: FakeServer) =>
    server.calls.filter(
      (c) => c.method === 'POST' && c.path === `/api/v1/workspaces/${WS}/documents/upload-sessions`,
    )
  const createdRows = (server: FakeServer, prefix: string) =>
    [...server.state.documents.keys()].filter((id) => id.startsWith(prefix)).sort()
  const boundId = (documentId: string): string | undefined =>
    (
      JSON.parse(readFileSync(join(docDir(documentId), BINDING_FILE), 'utf8')) as {
        documentId?: string
      }
    ).documentId
  const unavailable = () => envelope(503, 'unavailable')
  // the caller's options object is the one the fake reads: a test flips a hook on it later
  const chunkedServer = (options: FakeServerOptions = {}) =>
    fakeServer(
      Object.assign(options, {
        limits: { upload_max_bytes: 200 * 1024 * 1024 },
        chunkedThreshold: 1024 * 1024,
        sessionPartSize: 1024 * 1024,
        sessionAssemblesParts: true,
      }),
    )
  const chunkedFile = (name: string): string => {
    const file = join(dir, name)
    writeFileSync(file, buildDocxBytes(2 * 1024 * 1024))
    return file
  }

  it('(a) a first-saved original refuses a second first Save after a restart: conflict, no create', async () => {
    const server = fakeServer()
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    const first = setup(server, { syncStore: true })
    const saved = await first.service.firstSave(input(file))
    expect(saved.ok).toBe(true)
    expect(fileCreates(server)).toHaveLength(1)

    const restarted = setup(server, { syncStore: true })
    const again = await restarted.service.firstSave(input(file))

    // the existing verdict, unchanged shape (no new string, no renderer change)
    expect(again).toEqual({ ok: false, error: 'conflict' })
    expect(fileCreates(server)).toHaveLength(1)
    expect(createdRows(server, 'up_')).toEqual(['up_1'])
  })

  it('(a) the same holds for a chunked first save: no session is opened after a restart', async () => {
    const server = chunkedServer()
    const file = chunkedFile('Chunked.docx')
    const first = setup(server, { syncStore: true })
    const saved = await first.service.firstSave({ ...input(file), title: 'Chunked.docx' })
    expect(saved.ok).toBe(true)
    expect(sessionOpens(server)).toHaveLength(1)

    const restarted = setup(server, { syncStore: true })
    const again = await restarted.service.firstSave({ ...input(file), title: 'Chunked.docx' })

    expect(again).toEqual({ ok: false, error: 'conflict' })
    expect(sessionOpens(server)).toHaveLength(1)
    expect(createdRows(server, 'new_')).toHaveLength(1)
  })

  it('(a) the original is refused whatever title the second Save names', async () => {
    const server = fakeServer()
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    const first = setup(server, { syncStore: true })
    expect((await first.service.firstSave(input(file))).ok).toBe(true)

    const restarted = setup(server, { syncStore: true })
    const again = await restarted.service.firstSave({ ...input(file), title: 'Another name.docx' })

    expect(again).toEqual({ ok: false, error: 'conflict' })
    expect(fileCreates(server)).toHaveLength(1)
  })

  it('(b) a record whose binding is gone is stale: the next first Save creates exactly once', async () => {
    const server = fakeServer()
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    const first = setup(server, { syncStore: true })
    expect((await first.service.firstSave(input(file))).ok).toBe(true)
    // the working copy and its binding are removed (a wiped store folder)
    rmSync(docDir('up_1'), { recursive: true, force: true })

    const restarted = setup(server, { syncStore: true })
    const again = await restarted.service.firstSave(input(file))

    expect(again.ok).toBe(true)
    expect(fileCreates(server)).toHaveLength(2)
    // the stale record's key was spent: the second create is a new attempt
    expect(fileCreates(server)[1]!.idempotencyKey).not.toBe(fileCreates(server)[0]!.idempotencyKey)
    expect(again.ok ? again.value.id : '').toBe('up_2')
    expect(boundId('up_2')).toBe('up_2')
  })

  it('(c) a crash after the create answered but before the bind: the retry replays the SAME key and binds the same document', async () => {
    const server = fakeServer({ createAnswerLost: true })
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    const first = setup(server, { syncStore: true })
    // the row exists on D, the answer never reached the app: nothing is bound
    const lost = await first.service.firstSave(input(file))
    expect(lost.ok).toBe(false)
    expect(createdRows(server, 'up_')).toEqual(['up_1'])

    const restarted = setup(server, { syncStore: true })
    const retried = await restarted.service.firstSave(input(file))

    expect(retried.ok).toBe(true)
    const creates = fileCreates(server)
    expect(creates).toHaveLength(2)
    expect(creates[0]!.idempotencyKey).toBeTruthy()
    expect(creates[1]!.idempotencyKey).toBe(creates[0]!.idempotencyKey)
    // one server document, bound under the id the first create produced
    expect(createdRows(server, 'up_')).toEqual(['up_1'])
    expect(retried.ok ? retried.value.id : '').toBe('up_1')
    expect(boundId('up_1')).toBe('up_1')
  })

  it('(c) the same for a chunked first save whose session answer was lost', async () => {
    const opts: FakeServerOptions = { sessionOpenAnswer: () => unavailable() }
    const server = chunkedServer(opts)
    const file = chunkedFile('Chunked.docx')
    const first = setup(server, { syncStore: true })
    const lost = await first.service.firstSave({ ...input(file), title: 'Chunked.docx' })
    expect(lost.ok).toBe(false)
    expect(sessionOpens(server)).toHaveLength(1)

    opts.sessionOpenAnswer = undefined
    const restarted = setup(server, { syncStore: true })
    const retried = await restarted.service.firstSave({ ...input(file), title: 'Chunked.docx' })

    expect(retried.ok).toBe(true)
    const opens = sessionOpens(server)
    expect(opens).toHaveLength(2)
    expect(opens[0]!.idempotencyKey).toBeTruthy()
    expect(opens[1]!.idempotencyKey).toBe(opens[0]!.idempotencyKey)
    expect(createdRows(server, 'new_')).toHaveLength(1)
  })

  it('(c) a pending record with another fingerprint (edited bytes) mints a NEW key after a restart', async () => {
    const server = fakeServer({ createAnswerLost: true })
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes v1')
    const first = setup(server, { syncStore: true })
    expect((await first.service.firstSave(input(file))).ok).toBe(false)

    writeFileSync(file, 'bytes v2 edited')
    const restarted = setup(server, { syncStore: true })
    const retried = await restarted.service.firstSave(input(file))

    expect(retried.ok).toBe(true)
    const creates = fileCreates(server)
    expect(creates).toHaveLength(2)
    expect(creates[1]!.idempotencyKey).not.toBe(creates[0]!.idempotencyKey)
    expect(server.state.documents.get('up_2')?.bytes).toEqual(enc('bytes v2 edited'))
  })

  it('(d) another account on the same machine is unaffected by this account record', async () => {
    const server = fakeServer()
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    const first = setup(server, { syncStore: true })
    expect((await first.service.firstSave(input(file))).ok).toBe(true)

    const other = setup(server, { syncStore: true })
    other.setIdentity({ accountId: 'acc_2', deviceSessionId: 'dev_2', deploymentId: 'default' })
    const saved = await other.service.firstSave(input(file))

    expect(saved.ok).toBe(true)
    expect(fileCreates(server)).toHaveLength(2)
    expect(saved.ok ? saved.value.id : '').toBe('up_2')
  })

  it('(e) a post-create failure that archives removes the record: the retry after a restart creates once', async () => {
    const server = fakeServer()
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    const first = setup(server, { syncStore: true })
    // fail the first bind at the binding.json write; the created row is archived
    // (the migration-hold fixture would be swept as soon as the sync store opens)
    vi.spyOn(first.service.store, 'write').mockRejectedValueOnce(new Error('disk full'))
    const failed = await first.service.firstSave(input(file))
    expect(failed.ok).toBe(false)
    expect(server.state.documents.get('up_1')?.archived).toBe(true)

    const restarted = setup(server, { syncStore: true })
    const retried = await restarted.service.firstSave(input(file))

    // the archived row's key was spent: a replay would answer the trashed row
    expect(retried.ok).toBe(true)
    const creates = fileCreates(server)
    expect(creates).toHaveLength(2)
    expect(creates[1]!.idempotencyKey).not.toBe(creates[0]!.idempotencyKey)
    expect(createdRows(server, 'up_')).toEqual(['up_1', 'up_2'])
    expect(retried.ok ? retried.value.id : '').toBe('up_2')
    expect(boundId('up_2')).toBe('up_2')
  })

  // S01-R2-4 fix1 (Jev 140 L1): a crash between binding.json (ready) and the `bound`
  // record leaves a `pending` record next to a ready binding. The replayed key
  // answers the SAME document; re-binding it would rewrite the working copy and
  // binding.json and lose edits made in the bound copy. It must refuse instead.
  const skipBoundRecord = (service: UniworkDocsService): void => {
    const target = service as unknown as {
      saveFirstSaveRecord(attempt: unknown, state: { state: string }): Promise<void>
    }
    const original = target.saveFirstSaveRecord.bind(target)
    vi.spyOn(target, 'saveFirstSaveRecord').mockImplementation((attempt, state) =>
      state.state === 'bound' ? Promise.resolve() : original(attempt, state),
    )
  }

  it('fix1: a replayed key never re-binds over a ready binding: edits survive, conflict, then no request', async () => {
    const server = fakeServer()
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    const first = setup(server, { syncStore: true })
    skipBoundRecord(first.service)
    expect((await first.service.firstSave(input(file))).ok).toBe(true)
    // the crash window: the binding is ready, the record is still `pending`
    const copy = join(docDir('up_1'), 'Draft.docx')
    writeFileSync(copy, 'edited in the bound copy')
    const bindingBefore = readFileSync(join(docDir('up_1'), BINDING_FILE), 'utf8')

    const restarted = setup(server, { syncStore: true })
    const again = await restarted.service.firstSave(input(file))

    expect(again).toEqual({ ok: false, error: 'conflict' })
    // the replay may be sent (same key); the bound document is never touched
    expect(readFileSync(copy, 'utf8')).toBe('edited in the bound copy')
    expect(readFileSync(join(docDir('up_1'), BINDING_FILE), 'utf8')).toBe(bindingBefore)
    expect(server.calls.filter((c) => c.path.endsWith('/archive'))).toEqual([])
    expect(server.state.documents.get('up_1')?.archived).toBeUndefined()
    expect(createdRows(server, 'up_')).toEqual(['up_1'])

    // the record is now `bound`: a third Save is refused before any request
    const sent = server.calls.length
    const third = await setup(server, { syncStore: true }).service.firstSave(input(file))
    expect(third).toEqual({ ok: false, error: 'conflict' })
    expect(server.calls).toHaveLength(sent)
  })

  it('fix1: the same for a chunked first save replayed onto a ready binding', async () => {
    const server = chunkedServer()
    const file = chunkedFile('Chunked.docx')
    const first = setup(server, { syncStore: true })
    skipBoundRecord(first.service)
    expect((await first.service.firstSave({ ...input(file), title: 'Chunked.docx' })).ok).toBe(true)
    const documentId = [...server.state.documents.keys()].find((id) => id.startsWith('new_'))!
    const copy = join(docDir(documentId), 'Chunked.docx')
    writeFileSync(copy, 'edited in the bound copy')
    const bindingBefore = readFileSync(join(docDir(documentId), BINDING_FILE), 'utf8')

    const restarted = setup(server, { syncStore: true })
    const again = await restarted.service.firstSave({ ...input(file), title: 'Chunked.docx' })

    expect(again).toEqual({ ok: false, error: 'conflict' })
    expect(readFileSync(copy, 'utf8')).toBe('edited in the bound copy')
    expect(readFileSync(join(docDir(documentId), BINDING_FILE), 'utf8')).toBe(bindingBefore)
    expect(server.calls.filter((c) => c.path.endsWith('/archive'))).toEqual([])
    expect(createdRows(server, 'new_')).toEqual([documentId])

    const sent = server.calls.length
    const third = await setup(server, { syncStore: true }).service.firstSave({
      ...input(file),
      title: 'Chunked.docx',
    })
    expect(third).toEqual({ ok: false, error: 'conflict' })
    expect(server.calls).toHaveLength(sent)
  })

  it('(f) a reused key answered 409 document_upload_invalid (file_claim_expired): new key, one create', async () => {
    const opts: FakeServerOptions = { createKeyAnswer: () => unavailable() }
    const server = fakeServer(opts)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    const first = setup(server, { syncStore: true })
    // nothing was committed: D never seeded a row for this key
    expect((await first.service.firstSave(input(file))).ok).toBe(false)
    const spent = fileCreates(server)[0]!.idempotencyKey
    expect(createdRows(server, 'up_')).toEqual([])

    // the staged claim passed its 24 h ClaimTTL
    opts.createKeyAnswer = (key) =>
      key === spent
        ? json(409, {
            error: {
              code: 'document_upload_invalid',
              message: 'x',
              fields: { reason: 'file_claim_expired' },
            },
          })
        : null
    const restarted = setup(server, { syncStore: true })
    const retried = await restarted.service.firstSave(input(file))

    expect(retried.ok).toBe(true)
    const creates = fileCreates(server)
    expect(creates).toHaveLength(3)
    // the replay of the spent key, then ONE create under a new key
    expect(creates[1]!.idempotencyKey).toBe(spent)
    expect(creates[2]!.idempotencyKey).toBeTruthy()
    expect(creates[2]!.idempotencyKey).not.toBe(spent)
    expect(createdRows(server, 'up_')).toEqual(['up_1'])
    expect(boundId('up_1')).toBe('up_1')
  })

  it('(f) a chunked reused key whose session complete answers 410 upload_session_expired: new key, one create', async () => {
    const opts: FakeServerOptions = { sessionOpenAnswer: () => unavailable() }
    const server = chunkedServer(opts)
    const file = chunkedFile('Chunked.docx')
    const first = setup(server, { syncStore: true })
    expect((await first.service.firstSave({ ...input(file), title: 'Chunked.docx' })).ok).toBe(
      false,
    )
    const spent = sessionOpens(server)[0]!.idempotencyKey

    opts.sessionOpenAnswer = undefined
    opts.sessionCompleteExpiredOnce = true
    const restarted = setup(server, { syncStore: true })
    const retried = await restarted.service.firstSave({ ...input(file), title: 'Chunked.docx' })

    expect(retried.ok).toBe(true)
    const opens = sessionOpens(server)
    expect(opens).toHaveLength(3)
    expect(opens[1]!.idempotencyKey).toBe(spent)
    expect(opens[2]!.idempotencyKey).toBeTruthy()
    expect(opens[2]!.idempotencyKey).not.toBe(spent)
    expect(createdRows(server, 'new_')).toHaveLength(1)

    // the record follows the key the run adopted: a further restart is refused
    const again = await setup(server, { syncStore: true }).service.firstSave({
      ...input(file),
      title: 'Chunked.docx',
    })
    expect(again).toEqual({ ok: false, error: 'conflict' })
    expect(sessionOpens(server)).toHaveLength(3)
  })

  it('(g) a reused key answered 404 (the document is gone): new key, one create', async () => {
    const opts: FakeServerOptions = { createKeyAnswer: () => unavailable() }
    const server = fakeServer(opts)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    const first = setup(server, { syncStore: true })
    expect((await first.service.firstSave(input(file))).ok).toBe(false)
    const spent = fileCreates(server)[0]!.idempotencyKey

    // trashed / purged / access lost since: the ledger row answers 404
    opts.createKeyAnswer = (key) => (key === spent ? envelope(404, 'not_found') : null)
    const restarted = setup(server, { syncStore: true })
    const retried = await restarted.service.firstSave(input(file))

    expect(retried.ok).toBe(true)
    const creates = fileCreates(server)
    expect(creates).toHaveLength(3)
    expect(creates[1]!.idempotencyKey).toBe(spent)
    expect(creates[2]!.idempotencyKey).not.toBe(spent)
    expect(createdRows(server, 'up_')).toEqual(['up_1'])
    expect(boundId('up_1')).toBe('up_1')
  })

  it('(g) a chunked reused key whose session open answers 404: new key, one create', async () => {
    const opts: FakeServerOptions = { sessionOpenAnswer: () => unavailable() }
    const server = chunkedServer(opts)
    const file = chunkedFile('Chunked.docx')
    const first = setup(server, { syncStore: true })
    expect((await first.service.firstSave({ ...input(file), title: 'Chunked.docx' })).ok).toBe(
      false,
    )
    const spent = sessionOpens(server)[0]!.idempotencyKey

    opts.sessionOpenAnswer = (key) => (key === spent ? envelope(404, 'not_found') : null)
    const restarted = setup(server, { syncStore: true })
    const retried = await restarted.service.firstSave({ ...input(file), title: 'Chunked.docx' })

    expect(retried.ok).toBe(true)
    const opens = sessionOpens(server)
    expect(opens).toHaveLength(3)
    expect(opens[1]!.idempotencyKey).toBe(spent)
    expect(opens[2]!.idempotencyKey).not.toBe(spent)
    expect(createdRows(server, 'new_')).toHaveLength(1)
  })

  it('(h) a reused key answered 409 idempotency_payload_mismatch: typed refusal, the record is dropped, the next try mints a new key', async () => {
    const opts: FakeServerOptions = { createKeyAnswer: () => unavailable() }
    const server = fakeServer(opts)
    const file = join(dir, 'Draft.docx')
    writeFileSync(file, 'bytes')
    const first = setup(server, { syncStore: true })
    expect((await first.service.firstSave(input(file))).ok).toBe(false)
    const spent = fileCreates(server)[0]!.idempotencyKey

    // D holds the key for another body: the replay is refused
    opts.createKeyAnswer = (key) =>
      key === spent ? envelope(409, 'idempotency_payload_mismatch') : null
    const refused = await setup(server, { syncStore: true }).service.firstSave(input(file))
    expect(refused).toEqual({ ok: false, error: 'idempotency_mismatch' })
    expect(fileCreates(server)[1]!.idempotencyKey).toBe(spent)

    // a stuck record would replay the refused key for ever
    const retried = await setup(server, { syncStore: true }).service.firstSave(input(file))
    expect(retried.ok).toBe(true)
    const creates = fileCreates(server)
    expect(creates).toHaveLength(3)
    expect(creates[2]!.idempotencyKey).not.toBe(spent)
    expect(createdRows(server, 'up_')).toEqual(['up_1'])
  })
})

// SAVE-01 (Q1): New / Upload from Home or the workspace root land in the
// caller's My Folder - the wire carries `destination`, never a bare root
// parent. Folder and copy creates keep the FD-11 `parent_id` only.
describe('SAVE-01 create destinations', () => {
  it('sends destination my_folder for a blank create with no folder', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    await ctx.service.createDocument({
      workspaceId: WS,
      folderId: null,
      name: 'Plan.docx',
      format: 'docx',
    })
    const post = server.calls.find(
      (c) => c.method === 'POST' && c.path.endsWith('/documents/files/blank'),
    )!
    const body = post.body as { destination?: unknown; parent_id?: unknown }
    expect(body.destination).toBe('my_folder')
    expect(body.parent_id).toBeUndefined()
  })

  it('still sends parent_id (and no destination) when a folder is open', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    await ctx.service.createDocument({
      workspaceId: WS,
      folderId: 'fold_1',
      name: 'Plan.docx',
      format: 'docx',
    })
    const post = server.calls.find(
      (c) => c.method === 'POST' && c.path.endsWith('/documents/files/blank'),
    )!
    const body = post.body as { destination?: unknown; parent_id?: unknown }
    expect(body.parent_id).toBe('fold_1')
    expect(body.destination).toBeUndefined()
  })

  it('sends destination my_folder for an upload with no folder', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: ctx.uploadFile,
      uploadId: 'up_1',
    })
    const post = server.calls.find(
      (c) => c.method === 'POST' && c.path.endsWith('/documents/files'),
    )!
    const body = post.body as { destination?: unknown; parent_id?: unknown }
    expect(body.destination).toBe('my_folder')
    expect(body.parent_id).toBeNull()
  })

  it('sends parent_id (and no destination) for an upload into a folder', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: 'fold_1',
      path: ctx.uploadFile,
      uploadId: 'up_1',
    })
    const post = server.calls.find(
      (c) => c.method === 'POST' && c.path.endsWith('/documents/files'),
    )!
    const body = post.body as { destination?: unknown; parent_id?: unknown }
    expect(body.parent_id).toBe('fold_1')
    expect(body.destination).toBeNull()
  })
})
