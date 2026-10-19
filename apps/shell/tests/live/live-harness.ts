/**
 * Seeding and instrumentation for the AC-5 live run (G5-04 stage FM).
 *
 * The test next to this file is the only consumer. It drives the fork's REAL
 * feed and capability modules against a REAL D server whose origin arrives in
 * `UNIWORK_LIVE_ORIGIN`, and it skips unless that variable is set, so the
 * normal shell suite neither needs a server nor changes behaviour. The seeding
 * calls reuse the D H1 endpoints the harness
 * `scripts/office/g5g6g7/harness/document-step.mjs` calls. Its page documents
 * come from the JSON `POST /api/v1/workspaces/{workspaceId}/documents` route,
 * which the D repo's `api-contract.mjs` does NOT pin: that contract declares
 * only the multipart file-document create `document-step.mjs` itself seeds, so
 * a page-create regression is not caught there.
 *
 * Nothing here fakes HTTP: every request goes through the global `fetch`. The
 * only substitutions are the ones the product itself takes as seams - the
 * `authorized` callback the wired clients receive (`authorizedRequest` in the
 * app) and the in-memory `CursorStore`/`DocCache` the consumer is documented to
 * accept. Every failure message names the step, HTTP method, path and status;
 * a token or password never enters one.
 */

import type { AuthorizedGetOptions } from '../../src/main/uniwork-sync/feed/http'
import type { FeedChange, FeedClient, FeedPage } from '../../src/main/uniwork-sync/feed/client'
import type { DocCache } from '../../src/main/uniwork-sync/feed/consumer'
import {
  createMemoryCursorStore,
  type CursorStore,
  type MemoryCursorStore,
} from '../../src/main/uniwork-sync/feed/cursor-store'
import { compareRevision } from '../../src/main/uniwork-sync/feed/revision'
import type { FetchLike } from '../../src/main/uniwork-docs/client'

/** the deployment origin under test, no trailing slash; '' when the run is not live */
export const LIVE_ORIGIN = (process.env.UNIWORK_LIVE_ORIGIN ?? '').replace(/\/+$/, '')
export const LIVE = LIVE_ORIGIN.length > 0

/** the `error.code` of a D JSON answer, or '' when the body carries none */
export function envelopeCode(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const error = (body as { error?: unknown }).error
  if (!error || typeof error !== 'object') return ''
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** `step: METHOD /path -> status [code]`; never a URL with a cursor, a token or a body */
export class LiveApiError extends Error {
  readonly step: string
  readonly method: string
  readonly path: string
  readonly status: number
  readonly code: string

  constructor(step: string, method: string, path: string, status: number, code = '') {
    super(`${step}: ${method} ${path} -> ${status}${code ? ` ${code}` : ''}`)
    this.name = 'LiveApiError'
    this.step = step
    this.method = method
    this.path = path
    this.status = status
    this.code = code
  }
}

export interface LiveResponse {
  status: number
  text: string
  body: unknown
}

export interface LiveApi {
  /**
   * one real request; a transport failure throws a LiveApiError with status 0.
   * `headers` carries the extra headers a route needs (the G5-07 commit-intent
   * lookup is addressed by `Idempotency-Key`, never by the URL).
   */
  request(
    step: string,
    method: string,
    path: string,
    options?: { token?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<LiveResponse>
  /** the same, but a non-2xx answer throws a LiveApiError naming method, path and status */
  ok(
    step: string,
    method: string,
    path: string,
    options?: { token?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<LiveResponse>
  count(): number
}

export function createLiveApi(origin: string): LiveApi {
  let calls = 0
  const request: LiveApi['request'] = async (step, method, path, options = {}) => {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    // a route's own header (the commit-intent lookup's Idempotency-Key) rides
    // last, so it can override a default; a token never enters this map
    Object.assign(headers, options.headers ?? {})
    let response: Response
    try {
      response = await fetch(`${origin}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown'
      throw new LiveApiError(step, method, path, 0, `network:${reason}`)
    }
    calls += 1
    const text = await response.text()
    return { status: response.status, text, body: parseJson(text) }
  }
  const ok: LiveApi['ok'] = async (step, method, path, options) => {
    const response = await request(step, method, path, options)
    if (response.status < 200 || response.status >= 300) {
      throw new LiveApiError(step, method, path, response.status, envelopeCode(response.body))
    }
    return response
  }
  return { request, ok, count: () => calls }
}

/** a dotted field of a response body; a missing one fails naming the step and the field */
export function fieldAt(step: string, value: unknown, path: string): unknown {
  let current = value
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object') {
      throw new Error(`${step}: response has no field ${path}`)
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export function stringAt(step: string, value: unknown, path: string): string {
  const found = fieldAt(step, value, path)
  if (typeof found !== 'string' || found.length === 0) {
    throw new Error(`${step}: response field ${path} is not a non-empty string`)
  }
  return found
}

export interface LiveSeed {
  token: string
  userId: string
  orgId: string
  workspaceId: string
  secondWorkspaceId: string
  documentIds: string[]
}

/**
 * The document-step seeding, one call at a time: register a throwaway user,
 * verify it with the dev code, create the org and the workspace (the org path
 * param is the org ID, not its slug), create `documents` page documents, and a
 * second empty workspace for the cross-workspace cursor step.
 */
export async function seedLiveRun(api: LiveApi, documents = 3): Promise<LiveSeed> {
  const run = Date.now().toString(36)
  const registered = await api.ok('seed:register', 'POST', '/api/v1/auth/register', {
    body: {
      email: `g5-04-live-${run}@example.com`,
      password: 'password123',
      display_name: 'G5-04 live',
    },
  })
  const token = stringAt('seed:register', registered.body, 'access_token')
  const userId = stringAt('seed:register', registered.body, 'user.id')
  await api.ok('seed:verify-email', 'POST', '/api/v1/me/email/verify', {
    token,
    body: { code: '123456' },
  })
  const org = await api.ok('seed:create-org', 'POST', '/api/v1/orgs', {
    token,
    body: { name: 'G5-04 live', slug: `o-g504-${run}` },
  })
  const orgId = stringAt('seed:create-org', org.body, 'organization.id')
  const workspace = await api.ok(
    'seed:create-workspace',
    'POST',
    `/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces`,
    { token, body: { name: 'G5-04 live', slug: `w-g504-${run}` } },
  )
  const workspaceId = stringAt('seed:create-workspace', workspace.body, 'workspace.id')
  const documentIds: string[] = []
  for (let index = 1; index <= documents; index += 1) {
    const created = await api.ok(
      `seed:create-document-${index}`,
      'POST',
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/documents`,
      { token, body: { title: `G5-04 live ${index}`, kind: 'page' } },
    )
    documentIds.push(stringAt(`seed:create-document-${index}`, created.body, 'document.id'))
  }
  const second = await api.ok(
    'seed:create-second-workspace',
    'POST',
    `/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces`,
    { token, body: { name: 'G5-04 live 2', slug: `w2-g504-${run}` } },
  )
  const secondWorkspaceId = stringAt('seed:create-second-workspace', second.body, 'workspace.id')
  return { token, userId, orgId, workspaceId, secondWorkspaceId, documentIds }
}

export interface CountedFetch {
  fetch: FetchLike
  count(): number
}

/** the global fetch behind a counter; requests stay real */
export function countedFetch(): CountedFetch {
  let calls = 0
  const counted: FetchLike = (input, init) => {
    calls += 1
    return fetch(input, init)
  }
  return { fetch: counted, count: () => calls }
}

/**
 * The auth seam of the live run: hand the callback the seeded bearer token
 * (no refresh - the live run mints its own token and never stores a session).
 */
export function tokenAuthorized(token: string): AuthorizedGetOptions['authorized'] {
  return <T>(call: (token: string) => Promise<T>) => call(token)
}

export interface RecordingCacheState {
  docs: Map<string, FeedChange>
  drafts: Set<string>
  applyCalls: FeedChange[][]
  reconcileCalls: Array<{ ids: Set<string>; keepDrafts: boolean }>
  evicted: string[]
  /** net row writes: a replayed page adds nothing */
  effects: number
  /** ordered commit log shared with the recording cursor store */
  events: string[]
}

export interface RecordingCache extends DocCache {
  readonly state: RecordingCacheState
}

/** an in-memory DocCache (allowed by the task) that records what the consumer committed */
export function createRecordingCache(events: string[] = []): RecordingCache {
  const state: RecordingCacheState = {
    docs: new Map(),
    drafts: new Set(),
    applyCalls: [],
    reconcileCalls: [],
    evicted: [],
    effects: 0,
    events,
  }
  return {
    state,
    async applyPage(changes: readonly FeedChange[]) {
      state.applyCalls.push([...changes])
      for (const change of changes) {
        const known = state.docs.get(change.documentId)
        if (known && compareRevision(change.revision, known.revision) <= 0) continue
        state.docs.set(change.documentId, { ...change })
        state.effects += 1
      }
      state.events.push(`cache:apply:${changes.length}`)
      return { kind: 'ok' }
    },
    async reconcile(ids: ReadonlySet<string>, options: { keepDrafts: true }) {
      state.reconcileCalls.push({ ids: new Set(ids), keepDrafts: options.keepDrafts })
      for (const documentId of [...state.docs.keys()]) {
        if (ids.has(documentId)) continue
        if (options.keepDrafts && state.drafts.has(documentId)) continue
        state.docs.delete(documentId)
        state.evicted.push(documentId)
      }
      state.events.push(`cache:reconcile:${state.docs.size}`)
      return { kind: 'ok' }
    },
  }
}

export interface RecordingCursorStore {
  store: CursorStore
  memory: MemoryCursorStore
}

/** the fork's in-memory cursor store (real module) behind a commit log */
export function createRecordingCursorStore(events: string[]): RecordingCursorStore {
  const memory = createMemoryCursorStore()
  return {
    memory,
    store: {
      get: (key) => memory.get(key),
      async set(key, cursor) {
        await memory.set(key, cursor)
        events.push('cursor:set')
      },
      async clear(key) {
        await memory.clear(key)
        events.push('cursor:clear')
      },
    },
  }
}

export interface ObservedFeedClient {
  client: FeedClient
  /** every page the server answered, in order */
  pages: FeedPage[]
  /** every request, in order; `cursor` undefined means a cold-start snapshot */
  requests: Array<{ workspaceId: string; cursor?: string; limit?: number }>
  snapshotOpens(): number
}

/** the real feed client behind an observer; the round trip is untouched */
export function observeFeedClient(real: FeedClient): ObservedFeedClient {
  const pages: FeedPage[] = []
  const requests: ObservedFeedClient['requests'] = []
  let snapshotOpens = 0
  return {
    pages,
    requests,
    snapshotOpens: () => snapshotOpens,
    client: {
      async listChanges(workspaceId, cursor, limit) {
        // the attempt is recorded before the call: a request the server
        // refuses (a 501 for a feed cursor, a 400 for a tamper) must still be
        // visible to the step that asserts what the consumer did with it
        requests.push({
          workspaceId,
          ...(cursor === undefined ? {} : { cursor }),
          ...(limit === undefined ? {} : { limit }),
        })
        if (cursor === undefined) snapshotOpens += 1
        const page = await real.listChanges(workspaceId, cursor, limit)
        pages.push(page)
        return page
      },
    },
  }
}

/**
 * Flip one character inside a `dcc1.<payload>.<sig>` cursor's payload: the
 * base64 stays decodable, the signature stops matching, so the server can only
 * answer change_cursor_invalid.
 */
export function tamperCursor(cursor: string): string {
  const head = cursor.indexOf('.') + 1
  const tail = cursor.lastIndexOf('.')
  if (!(tail > head)) return `${cursor}0`
  const at = head + Math.floor((tail - head) / 2)
  const replacement = cursor[at] === 'A' ? 'B' : 'A'
  return cursor.slice(0, at) + replacement + cursor.slice(at + 1)
}

/**
 * One page of `GET /api/v1/documents/{id}/versions` (newest first): the count
 * and the version ids/ordinals. The AC-4 save-queue suite uses it as the
 * "exactly one version" oracle - a commit or a dispatch that appended a
 * version changes the count, a replay or a lookup-only settle does not.
 */
export async function listDocumentVersions(
  api: LiveApi,
  token: string,
  documentId: string,
): Promise<{ count: number; ids: string[]; versions: number[] }> {
  const raw = await api.ok(
    'versions:list',
    'GET',
    `/api/v1/documents/${encodeURIComponent(documentId)}/versions`,
    { token },
  )
  const versions = (raw.body as { versions?: unknown } | undefined)?.versions
  if (!Array.isArray(versions)) {
    throw new Error('versions:list: the response carries no versions array')
  }
  const rows = versions as Array<Record<string, unknown>>
  return {
    count: rows.length,
    ids: rows.map((row) => String(row.id)),
    versions: rows.map((row) => Number(row.version)),
  }
}

/** one file document seeded through the multipart create route */
export interface SeededFileDocument {
  documentId: string
  /** decimal string */
  revision: string
  currentVersion: number
}

/**
 * Create one FILE document through the D API's multipart route
 * (`POST /api/v1/workspaces/{workspaceID}/documents/files`) - the seeding call
 * the G7-01 harness makes (`document-step.mjs`, pinned by `api-contract.mjs`).
 * The save-queue suite needs a file document (only file documents take staged
 * versions); the response carries the id, the revision and the current version
 * so a new version can be staged against them.
 */
export async function seedFileDocument(
  origin: string,
  token: string,
  workspaceId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<SeededFileDocument> {
  const path = '/api/v1/workspaces/{workspaceID}/documents/files'
  const form = new FormData()
  // the text field precedes the file part: the server streams the file part
  // and a title that trails it would fall back to the file name
  form.set('title', filename)
  form.set('file', new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), filename)
  let response: Response
  try {
    response = await fetch(
      `${origin}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/documents/files`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      },
    )
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown'
    throw new LiveApiError('seed:create-file-document', 'POST', path, 0, `network:${reason}`)
  }
  const text = await response.text()
  if (response.status < 200 || response.status >= 300) {
    throw new LiveApiError(
      'seed:create-file-document',
      'POST',
      path,
      response.status,
      envelopeCode(parseJson(text)),
    )
  }
  const doc = (parseJson(text) as { document?: Record<string, unknown> } | undefined)?.document
  if (!doc || typeof doc.id !== 'string' || doc.id.length === 0) {
    throw new Error('seed:create-file-document: the response carries no document id')
  }
  if (typeof doc.revision !== 'string' || !/^\d{1,30}$/.test(doc.revision)) {
    throw new Error('seed:create-file-document: the response revision is not a decimal string')
  }
  const currentVersion = Number(doc.current_version ?? 0)
  return {
    documentId: doc.id,
    revision: doc.revision,
    currentVersion: Number.isSafeInteger(currentVersion) ? currentVersion : 0,
  }
}

/** wait past a point in time; used only where the run must observe an expiry */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
