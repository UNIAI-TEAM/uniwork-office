import {
  ASKUNI_MAX_LOOKUP_RESULTS,
  type AskUniLookupItem,
  type AskUniLookupRequest,
  type AskUniLookupResult,
  type AskUniObjectKind,
} from '../../shared/askuni-api'
import {
  createUniworkDocsClient,
  createUniworkSend,
  METADATA_TIMEOUT_MS,
  type UniworkDocsClientOptions,
} from '../uniwork-docs/client'
import { askUniFailure } from './rest-client'

/**
 * The scope (+) and mention (@) pickers of Ask UNI v2: read-only lists on the
 * same endpoints the web lookup uses (packages/views/ai/ask-uni-lookup.ts).
 * Tasks, meetings, documents and projects are searched on the server; members
 * and rooms are listed and filtered here, without accents like the web.
 * Every row is validated (id) and bounded (title); at most 20 come back.
 */

export interface AskUniLookupClient {
  lookup(req: AskUniLookupRequest): Promise<AskUniLookupResult>
}

const ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_TITLE = 300
const LIMIT = ASKUNI_MAX_LOOKUP_RESULTS

/** lower case without diacritics (đ included), for the client-side match */
export function foldForMatch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase()
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const listOf = (raw: unknown, key: string): unknown[] => {
  const list = isObj(raw) ? raw[key] : undefined
  return Array.isArray(list) ? list : []
}

/** one row -> an item, or null when its id or title is not usable */
function item(
  kind: AskUniObjectKind,
  id: unknown,
  title: unknown,
  subtitle?: unknown,
): AskUniLookupItem | null {
  if (typeof id !== 'string' || !ID.test(id)) return null
  if (typeof title !== 'string' || !title.trim()) return null
  return {
    kind,
    id,
    title: title.slice(0, MAX_TITLE),
    ...(typeof subtitle === 'string' && subtitle ? { subtitle: subtitle.slice(0, MAX_TITLE) } : {}),
  }
}

const finish = (items: Array<AskUniLookupItem | null>): AskUniLookupResult => ({
  ok: true,
  items: items.filter((i): i is AskUniLookupItem => i !== null).slice(0, LIMIT),
})

/** client-side match for the lists the server does not search */
const matches = (query: string) => {
  const needle = foldForMatch(query.trim())
  return (...hay: string[]) => !needle || hay.some((h) => foldForMatch(h).includes(needle))
}

export function createAskUniLookupClient(options: UniworkDocsClientOptions): AskUniLookupClient {
  const send = createUniworkSend(options)
  const timeoutMs = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const enc = encodeURIComponent
  const get = (route: string, query?: URLSearchParams): Promise<unknown> =>
    send({ method: 'GET', route, ...(query ? { query } : {}), timeoutMs, read: (r) => r.json() })

  const byKind: Partial<
    Record<AskUniObjectKind, (ws: string, q: string) => Promise<AskUniLookupResult>>
  > = {
    async task(ws, q) {
      // an empty query asks nothing, as on the web
      if (!q) return { ok: true, items: [] }
      const raw = await send({
        method: 'POST',
        route: `/workspaces/${enc(ws)}/tasks/table/rows`,
        // the web's tableRowsPageBody: a flat, ungrouped search page
        json: {
          query: { search: q },
          group_by: 'none',
          group_key: null,
          hierarchy: false,
          parent_id: null,
          cursor: null,
          limit: LIMIT,
        },
        timeoutMs,
        read: (r) => r.json(),
      })
      return finish(
        listOf(raw, 'rows').map((row) => {
          const task = isObj(row) ? row.task : undefined
          return isObj(task) ? item('task', task.id, task.title) : null
        }),
      )
    },
    async meeting(ws, q) {
      const query = new URLSearchParams()
      if (q) query.set('q', q)
      query.set('limit', String(LIMIT))
      const raw = await get(`/workspaces/${enc(ws)}/meetings`, query)
      return finish(
        listOf(raw, 'meetings').map((m) =>
          isObj(m) ? item('meeting', m.id, m.title, m.starts_at) : null,
        ),
      )
    },
    async document(ws, q) {
      const list = await createUniworkDocsClient(options).searchDocuments({
        workspaceId: ws,
        query: q,
        kind: 'document',
        limit: LIMIT,
      })
      return finish(list.documents.map((d) => item('document', d.id, d.title)))
    },
    async project(ws, q) {
      const raw = q
        ? await get(
            `/workspaces/${enc(ws)}/projects/search`,
            new URLSearchParams({ q, limit: String(LIMIT) }),
          )
        : await get(`/workspaces/${enc(ws)}/projects`)
      return finish(
        listOf(raw, 'projects').map((p) => (isObj(p) ? item('project', p.id, p.title) : null)),
      )
    },
    async member(ws, q) {
      const members = await createUniworkDocsClient(options).listWorkspaceMembers(ws)
      const match = matches(q)
      return finish(
        members
          .filter((m) => match(m.displayName))
          .map((m) => item('member', m.userId, m.displayName)),
      )
    },
    async room(ws, q) {
      const raw = await get(`/workspaces/${enc(ws)}/chat/rooms`)
      const match = matches(q)
      return finish(
        listOf(raw, 'rooms').map((r) =>
          isObj(r) && typeof r.name === 'string' && match(r.name)
            ? item('room', r.id, r.name)
            : null,
        ),
      )
    },
  }

  return {
    async lookup(req) {
      const run = Object.hasOwn(byKind, req.kind) ? byKind[req.kind] : undefined
      if (!run) return { ok: false, error: 'error' }
      try {
        return await run(req.workspaceId, req.query.trim())
      } catch (error) {
        return askUniFailure(error)
      }
    },
  }
}
