/**
 * G8-08 (UNI-1403): a test-only, in-memory fake of the UniWork comment routes
 * of contract §2. It exists because the real G8-03/G8-06 routes are not merged
 * on D yet: every main-process call in the comments tests runs against THIS
 * fake, never a real server (the report says so).
 *
 * It implements list (with `kind` and `since_token` -> `unchanged`), create
 * (with an Idempotency-Key), update, delete (tombstone when it has replies,
 * else hard remove), resolve/reopen, revisions, anchors, mention candidates,
 * and the fixed failures the §9 table keys on: 401, 403, 404, 409
 * `comment_deleted`, 400 `anchor_version_invalid`, and a 5xx.
 */
import type { FetchLike } from '../../src/main/uniwork-docs/comments'

export interface FakeComment {
  id: string
  document_id: string
  author_id: string
  author_kind: string
  parent_id: string | null
  body: string
  kind: 'comment' | 'discussion'
  type: string
  revision: number
  anchor: Record<string, unknown> | null
  anchor_version_id: string | null
  anchor_state: 'exact' | 'stale' | 'lost' | null
  resolved_at: string | null
  deleted_at: string | null
  deleted_by_id: string | null
  deleted_by_kind: string | null
  created_at: string
  updated_at: string
  display_name: string
}

interface Stored {
  comments: FakeComment[]
  /** a monotonic token revision; every mutation bumps it */
  version: number
  /** idempotency ledger: key -> the created comment id */
  idempotency: Map<string, string>
  /** one failing answer for the next matching request, then cleared */
  failures: Array<{ status: number; body?: unknown; method?: string; path?: RegExp }>
}

export interface FakeCommentServer {
  fetch: FetchLike
  /** queue one failing answer (method/path optional filters) */
  fail(status: number, body?: unknown, match?: { method?: string; path?: RegExp }): void
  seed(documentId: string, comments: Array<Partial<FakeComment>>): void
  list(documentId: string): FakeComment[]
  token(documentId: string): string
  /** every request the client made, in order */
  calls: Array<{ method: string; url: string; idempotencyKey?: string; body?: unknown }>
  /** the last request only */
  lastCall(): { method: string; url: string; idempotencyKey?: string; body?: unknown } | undefined
  reset(): void
}

const ORIGIN = 'https://uniwork.example'
/** the path prefix (a pathname has no origin) */
const BASE = '/api/v1'
const T0 = '2026-10-13T09:00:00Z'

function token(version: number): string {
  return `lt1:${version.toString(16).padStart(8, '0')}`
}

function comment(documentId: string, over: Partial<FakeComment>, index: number): FakeComment {
  return {
    id: over.id ?? `01J8X4CMTN${String(index).padStart(15, '0')}`,
    document_id: documentId,
    author_id: over.author_id ?? '01J8X4USR0AAAAAAAAAAAAAAAA',
    author_kind: over.author_kind ?? 'human',
    parent_id: over.parent_id ?? null,
    body: over.body ?? 'hello',
    kind: over.kind ?? 'discussion',
    type: over.type ?? over.kind ?? 'discussion',
    revision: over.revision ?? 1,
    anchor: over.anchor ?? null,
    anchor_version_id: over.anchor_version_id ?? null,
    anchor_state: over.anchor_state ?? null,
    resolved_at: over.resolved_at ?? null,
    deleted_at: over.deleted_at ?? null,
    deleted_by_id: over.deleted_by_id ?? null,
    deleted_by_kind: over.deleted_by_kind ?? null,
    created_at: over.created_at ?? T0,
    updated_at: over.updated_at ?? T0,
    display_name: over.display_name ?? 'An',
  }
}

export function createFakeCommentServer(): FakeCommentServer {
  const stores = new Map<string, Stored>()
  const calls: FakeCommentServer['calls'] = []

  const store = (documentId: string): Stored => {
    let s = stores.get(documentId)
    if (!s) {
      s = { comments: [], version: 1, idempotency: new Map(), failures: [] }
      stores.set(documentId, s)
    }
    return s
  }

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  const failBody = (code: string): unknown => ({ error: { code, message: code } })

  const server: FakeCommentServer = {
    calls,
    fail(status, body, match) {
      // the failure is queued on a synthetic store keyed per document; simpler:
      // a global queue consulted before routing
      globalFailures.push({ status, body, ...(match ?? {}) })
    },
    seed(documentId, comments) {
      const s = store(documentId)
      for (const [i, over] of comments.entries()) s.comments.push(comment(documentId, over, i + 1))
      s.version += 1
    },
    list(documentId) {
      return [...store(documentId).comments]
    },
    token(documentId) {
      return token(store(documentId).version)
    },
    reset() {
      stores.clear()
      calls.length = 0
      globalFailures.length = 0
    },
    lastCall() {
      return calls[calls.length - 1]
    },
    async fetch(input, init) {
      const method = (init.method ?? 'GET').toUpperCase()
      const url = new URL(input)
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      const idempotencyKey =
        (init.headers as Record<string, string> | undefined)?.['Idempotency-Key'] ?? undefined
      calls.push({
        method,
        url: url.toString(),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(body !== undefined ? { body } : {}),
      })

      // a queued failure fires first (matching method/path when given)
      const fi = globalFailures.findIndex(
        (f) =>
          (f.method === undefined || f.method === method) &&
          (f.path === undefined || f.path.test(url.pathname)),
      )
      if (fi >= 0) {
        const f = globalFailures.splice(fi, 1)[0]!
        return json(f.status, f.body ?? failBody('server_error'))
      }

      const path = url.pathname
      if (!path.startsWith(`${BASE}/documents/`)) return json(404, failBody('not_found'))
      const rest = path.slice(`${BASE}/documents/`.length)
      const [docId, ...tail] = rest.split('/')
      if (!docId) return json(404, failBody('not_found'))
      const s = store(docId)

      // GET /documents/{id}/comments
      if (tail[0] === 'comments' && tail.length === 1 && method === 'GET') {
        const kind = url.searchParams.get('kind')
        const since = url.searchParams.get('since_token')
        const current = token(s.version)
        if (since !== null && since === current) {
          return json(200, { comments: [], mentions: [], list_token: current, unchanged: true })
        }
        const rows = s.comments.filter((c) => (kind ? c.kind === kind : true))
        return json(200, {
          comments: rows.map((c) => ({ ...c })),
          mentions: rows
            .flatMap((c) => c.body.match(/mention:\/\/member\/([0-9A-Za-z]{26})/g) ?? [])
            .map(() => ({ user_id: '01J8X4USR0AAAAAAAAAAAAAAAA', display_name: 'An', state: 'ok' }))
            .filter((m, i, all) => all.findIndex((x) => x.user_id === m.user_id) === i),
          list_token: current,
          unchanged: false,
        })
      }

      // POST /documents/{id}/comments
      if (tail[0] === 'comments' && tail.length === 1 && method === 'POST') {
        const input = body as { kind?: string; body?: string; parent_id?: string; anchor?: unknown }
        if (idempotencyKey && s.idempotency.has(idempotencyKey)) {
          const id = s.idempotency.get(idempotencyKey)!
          return json(201, { comment: s.comments.find((c) => c.id === id) })
        }
        const parent = input.parent_id
          ? s.comments.find((c) => c.id === input.parent_id)
          : undefined
        if (parent?.deleted_at) return json(409, failBody('comment_deleted'))
        const created = comment(
          docId,
          {
            id: `01J8X4CMTN${String(s.comments.length + 1).padStart(15, '9')}`,
            kind: (input.kind as 'comment' | 'discussion') ?? 'discussion',
            body: input.body ?? '',
            parent_id: parent?.id ?? null,
            anchor: (input.anchor as Record<string, unknown> | undefined) ?? null,
            anchor_state: input.anchor ? 'exact' : null,
          },
          s.comments.length + 1,
        )
        s.comments.push(created)
        s.version += 1
        if (idempotencyKey) s.idempotency.set(idempotencyKey, created.id)
        return json(201, { comment: { ...created } })
      }

      if (tail[0] === 'mention-candidates' && method === 'GET') {
        return json(200, {
          candidates: [{ user_id: '01J8X4USR0AAAAAAAAAAAAAAAA', display_name: 'An' }],
        })
      }

      const commentId = tail[1]
      // PUT /documents/{id}/comments/anchors
      if (tail[0] === 'comments' && commentId === 'anchors' && method === 'PUT') {
        const input = body as { version_id?: string; anchors?: Array<{ comment_id: string }> }
        if (!input.version_id || !/^[A-Za-z0-9_-]{1,128}$/.test(input.version_id)) {
          return json(400, failBody('anchor_version_invalid'))
        }
        const updated = (input.anchors ?? []).map((a) => a.comment_id)
        s.version += 1
        return json(200, { updated, skipped: [], list_token: token(s.version) })
      }

      const found = commentId ? s.comments.find((c) => c.id === commentId) : undefined
      if (!found) return json(404, failBody('not_found'))

      if (tail[0] === 'comments' && tail.length === 2 && method === 'PATCH') {
        if (found.deleted_at) return json(409, failBody('comment_deleted'))
        const input = body as { body?: string }
        found.body = input.body ?? found.body
        found.revision += 1
        found.updated_at = '2026-10-13T09:30:00Z'
        s.version += 1
        return json(200, { comment: { ...found } })
      }

      if (tail[0] === 'comments' && tail.length === 2 && method === 'DELETE') {
        const hasChildren = s.comments.some((c) => c.parent_id === found.id)
        if (hasChildren) {
          found.body = ''
          found.deleted_at = '2026-10-13T10:00:00Z'
          found.deleted_by_id = found.author_id
          found.deleted_by_kind = 'human'
          s.version += 1
          return json(200, { status: 'ok', outcome: 'tombstoned' })
        }
        s.comments = s.comments.filter((c) => c.id !== found.id)
        s.version += 1
        return json(200, { status: 'ok', outcome: 'removed' })
      }

      if (tail[0] === 'comments' && tail[2] === 'resolve') {
        if (found.deleted_at) return json(409, failBody('comment_deleted'))
        found.resolved_at = method === 'POST' ? '2026-10-13T10:00:00Z' : null
        found.updated_at = '2026-10-13T10:00:00Z'
        s.version += 1
        return json(200, { comment: { ...found } })
      }

      if (tail[0] === 'comments' && tail[2] === 'revisions' && method === 'GET') {
        if (found.deleted_at) return json(409, failBody('comment_deleted'))
        return json(200, {
          revisions: [
            {
              id: '01J8X4REV0000000000000001',
              revision: found.revision,
              body: found.body,
              created_by_id: found.author_id,
              created_by_kind: 'human',
              created_at: found.updated_at,
            },
          ],
        })
      }

      return json(404, failBody('not_found'))
    },
  }

  const globalFailures: Array<{ status: number; body?: unknown; method?: string; path?: RegExp }> =
    []
  return server
}
