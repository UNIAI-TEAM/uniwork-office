import type {
  CommentsAnchorsInput,
  CommentsCreateInput,
  CommentsListInput,
  MentionsSearchInput,
} from '@genoffice/electron-utils/comments-ipc'
import { TransportError } from '../uniwork-auth/transport'
import {
  DocsProtocolError,
  commentsErrorFromHttp,
  type CommentsAnchorsResult,
  type CommentsDeleteResult,
  type CommentsListResult,
  type CommentsRevisionsResult,
  type CommentMention,
  type CommentResult,
  type DocumentComment,
  type MentionsSearchResult,
} from '../../../../../web/docs/protocol/types'

/**
 * G8-08 (UNI-1403): the main-process client for the UniWork document-comment
 * routes (contract-collab §2), the desktop half of the frame protocol's
 * comments seam. Every call is made for a document BOUND to the signed-in
 * account only (the wiring resolves the path and refuses an unbound one before
 * this client is reached), over the same `authorizedRequest` the documents
 * client uses (single in-flight refresh, one retry on 401, no redirect, no
 * cache). HTTP results are mapped through the ONE shared table of §9
 * (`commentsErrorFromHttp`), so the desktop main and the web host agree: a 409
 * `comment_deleted` is a `conflict` carrying `details.code`, never retryable,
 * and a server that cannot be reached reads `network` (never `internal`).
 *
 * Responses are read strictly from the server's snake_case DTOs; anything else
 * is `malformed`. The comment DTOs are the frame protocol's own types: the main
 * process forwards the server bodies unchanged so a comment body (Markdown
 * subset + mention tokens) reaches the editor byte for byte.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export const COMMENTS_TIMEOUT_MS = 30_000
const ID = /^[A-Za-z0-9_-]{1,128}$/

export interface CommentBinding {
  documentId: string
}

export interface UniworkCommentsClientOptions {
  /** normalized deployment origin (no trailing slash) */
  apiOrigin: string
  authorized<T>(call: (token: string) => Promise<T>): Promise<T>
  isSignedIn(): boolean
  fetch?: FetchLike
  timeoutMs?: number
  /** a fresh Idempotency-Key per `comments.create` send (kept across that send's retry) */
  idempotencyKey?(): string
}

export interface UniworkCommentsClient {
  list(binding: CommentBinding, input: CommentsListInput): Promise<CommentsListResult>
  create(binding: CommentBinding, input: CommentsCreateInput): Promise<CommentResult>
  update(binding: CommentBinding, commentId: string, body: string): Promise<CommentResult>
  remove(binding: CommentBinding, commentId: string): Promise<CommentsDeleteResult>
  resolve(binding: CommentBinding, commentId: string): Promise<CommentResult>
  reopen(binding: CommentBinding, commentId: string): Promise<CommentResult>
  revisions(binding: CommentBinding, commentId: string): Promise<CommentsRevisionsResult>
  anchors(binding: CommentBinding, input: CommentsAnchorsInput): Promise<CommentsAnchorsResult>
  searchMentions(binding: CommentBinding, input: MentionsSearchInput): Promise<MentionsSearchResult>
}

function fail(message: string): never {
  throw new DocsProtocolError({ code: 'malformed', message, retryable: false })
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('comments: not an object')
  return value as Record<string, unknown>
}

function str(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || value.length > max) fail('comments: not a string')
  return value
}

function optionalStr(value: unknown, max = 4096): string | undefined {
  return value === undefined || value === null ? undefined : str(value, max)
}

function optionalNullableStr(value: unknown, max = 4096): string | null | undefined {
  return value === undefined ? undefined : value === null ? null : str(value, max)
}

function num(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail('comments: not an int')
  return value
}

function arr(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail('comments: not an array')
  return value
}

/** a DocumentComment, read leniently (unknown keys pass through; the frame renders only known ones) */
function comment(value: unknown): DocumentComment {
  const c = record(value)
  const id = str(c.id, 128)
  const documentId = str(c.document_id, 128)
  if (typeof c.body !== 'string') fail('comments: body')
  const out: DocumentComment = { ...c, id, document_id: documentId, body: c.body }
  return out
}

function mention(value: unknown): CommentMention {
  const m = record(value)
  const state = m.state
  if (state !== 'ok' && state !== 'unavailable') fail('comments: mention state')
  const displayName = optionalStr(m.display_name, 512)
  return {
    user_id: str(m.user_id, 128),
    state,
    ...(displayName !== undefined ? { display_name: displayName } : {}),
    ...(m.avatar_url !== undefined ? { avatar_url: str(m.avatar_url, 2048) } : {}),
  }
}

export function parseCommentsList(raw: unknown): CommentsListResult {
  const body = record(raw)
  const listToken = str(body.list_token, 512)
  const unchanged = body.unchanged
  if (typeof unchanged !== 'boolean') fail('comments: unchanged')
  return {
    comments: arr(body.comments).map(comment),
    mentions: arr(body.mentions).map(mention),
    list_token: listToken,
    unchanged,
  }
}

export function parseCommentResult(raw: unknown): CommentResult {
  return { comment: comment(record(raw).comment) }
}

export function parseCommentsDelete(raw: unknown): CommentsDeleteResult {
  const outcome = record(raw).outcome
  if (outcome !== 'tombstoned' && outcome !== 'removed') fail('comments: delete outcome')
  return { outcome }
}

export function parseCommentsRevisions(raw: unknown): CommentsRevisionsResult {
  const revisions = arr(record(raw).revisions).map((value) => {
    const r = record(value)
    const createdBy = optionalNullableStr(r.created_by_id, 128)
    return {
      id: str(r.id, 128),
      revision: num(r.revision),
      body: str(r.body, 100_000),
      // a system / AI revision has no author id; the DTO says string | null
      created_by_id: createdBy ?? null,
      created_by_kind: str(r.created_by_kind, 32),
      created_at: str(r.created_at, 64),
    }
  })
  return { revisions }
}

export function parseCommentsAnchors(raw: unknown): CommentsAnchorsResult {
  const body = record(raw)
  const updated = arr(body.updated).map((value) => str(value, 128))
  const skipped = arr(body.skipped).map((value) => {
    const s = record(value)
    const reason = s.reason
    if (reason !== 'older_version' && reason !== 'not_applicable') fail('comments: skip reason')
    return {
      comment_id: str(s.comment_id, 128),
      reason: reason as 'older_version' | 'not_applicable',
    }
  })
  return { updated, skipped, list_token: str(body.list_token, 512) }
}

export function parseMentionsSearch(raw: unknown): MentionsSearchResult {
  const candidates = arr(record(raw).candidates).map((value) => {
    const c = record(value)
    return {
      user_id: str(c.user_id, 128),
      display_name: str(c.display_name, 512),
      ...(c.avatar_url !== undefined ? { avatar_url: str(c.avatar_url, 2048) } : {}),
      ...(c.email !== undefined ? { email: str(c.email, 512) } : {}),
    }
  })
  return { candidates }
}

/** the ONE §9 mapping, shared with the web host through the protocol package */
export function mapCommentsError(status: number, body: unknown): DocsProtocolError {
  return commentsErrorFromHttp(status, body)
}

function id(value: string): string {
  if (!ID.test(value)) fail('comments: bad id')
  return encodeURIComponent(value)
}

function fromAuthFailure(error: unknown): DocsProtocolError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const e = error as { name?: string; code?: unknown; message?: string }
    if (e.name === 'DocsProtocolError') return error as DocsProtocolError
  }
  if (error instanceof TransportError) {
    if (error.code === 'network') return commentsErrorFromHttp(0)
    if (error.code === 'timeout') return commentsErrorFromHttp(0)
    if (
      error.code === 'unauthorized' ||
      error.code === 'device_revoked' ||
      error.code === 'refresh_reused'
    ) {
      return commentsErrorFromHttp(401)
    }
    return commentsErrorFromHttp(error.status ?? 500)
  }
  return commentsErrorFromHttp(0)
}

export function createUniworkCommentsClient(
  options: UniworkCommentsClientOptions,
): UniworkCommentsClient {
  const origin = new URL(options.apiOrigin).origin
  const base = `${origin}/api/v1`
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? COMMENTS_TIMEOUT_MS
  const idempotencyKey =
    options.idempotencyKey ??
    (() => `uwc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`)

  interface Call<T> {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'
    route: string
    query?: URLSearchParams
    json?: unknown
    idempotencyKey?: string
    read(response: Response): Promise<T>
  }

  async function send<T>(call: Call<T>): Promise<T> {
    // an unbound document never reaches here (the wiring refuses first); a
    // signed-out session reads as the 401 of §9, never a local guess
    if (!options.isSignedIn()) throw commentsErrorFromHttp(401)
    const query = call.query?.toString()
    const url = `${base}${call.route}${query ? `?${query}` : ''}`
    if (!url.startsWith(`${base}/`)) throw commentsErrorFromHttp(0)
    try {
      return await options.authorized(async (token) => {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        }
        if (call.json !== undefined) headers['Content-Type'] = 'application/json'
        if (call.idempotencyKey) headers['Idempotency-Key'] = call.idempotencyKey
        const controller = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
        try {
          let response: Response
          try {
            response = await fetchImpl(url, {
              method: call.method,
              headers,
              cache: 'no-store',
              redirect: 'error',
              signal: controller.signal,
              ...(call.json !== undefined ? { body: JSON.stringify(call.json) } : {}),
            })
          } catch {
            // offline / aborted / a refused redirect: no HTTP response at all
            throw commentsErrorFromHttp(0)
          }
          if (response.redirected || (response.status >= 300 && response.status < 400)) {
            throw commentsErrorFromHttp(0)
          }
          if (response.status === 401) {
            // authorized() refreshes once and retries; a second 401 ends it
            throw new TransportError('unauthorized', 401)
          }
          if (!response.ok) {
            const body: unknown = await response.json().catch(() => undefined)
            throw commentsErrorFromHttp(response.status, body)
          }
          try {
            return await call.read(response)
          } catch (error) {
            if (
              error &&
              typeof error === 'object' &&
              (error as { name?: string }).name === 'DocsProtocolError'
            ) {
              throw error
            }
            throw new DocsProtocolError({
              code: 'malformed',
              message: 'comments: malformed response',
              retryable: false,
            })
          }
        } finally {
          clearTimeout(timer)
        }
      })
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error as { name?: string }).name === 'DocsProtocolError'
      ) {
        throw error
      }
      throw fromAuthFailure(error)
    }
  }

  const json = (response: Response): Promise<unknown> => response.json()
  const doc = (binding: CommentBinding) => `/documents/${id(binding.documentId)}/comments`

  return {
    async list(binding, input) {
      const params = new URLSearchParams()
      if (input.kind) params.set('kind', input.kind)
      if (input.sinceToken) params.set('since_token', input.sinceToken)
      const raw = await send({
        method: 'GET',
        route: doc(binding),
        query: params,
        read: json,
      })
      return parseCommentsList(raw)
    },

    async create(binding, input) {
      const raw = await send({
        method: 'POST',
        route: doc(binding),
        idempotencyKey: idempotencyKey(),
        json: {
          kind: input.kind,
          body: input.body,
          ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
          ...(input.anchor !== undefined ? { anchor: input.anchor } : {}),
          ...(input.baseVersionId !== undefined ? { base_version_id: input.baseVersionId } : {}),
        },
        read: json,
      })
      return parseCommentResult(raw)
    },

    async update(binding, commentId, body) {
      const raw = await send({
        method: 'PATCH',
        route: `${doc(binding)}/${id(commentId)}`,
        json: { body },
        read: json,
      })
      return parseCommentResult(raw)
    },

    async remove(binding, commentId) {
      const raw = await send({
        method: 'DELETE',
        route: `${doc(binding)}/${id(commentId)}`,
        read: json,
      })
      return parseCommentsDelete(raw)
    },

    async resolve(binding, commentId) {
      const raw = await send({
        method: 'POST',
        route: `${doc(binding)}/${id(commentId)}/resolve`,
        read: json,
      })
      return parseCommentResult(raw)
    },

    async reopen(binding, commentId) {
      const raw = await send({
        method: 'DELETE',
        route: `${doc(binding)}/${id(commentId)}/resolve`,
        read: json,
      })
      return parseCommentResult(raw)
    },

    async revisions(binding, commentId) {
      const raw = await send({
        method: 'GET',
        route: `${doc(binding)}/${id(commentId)}/revisions`,
        read: json,
      })
      return parseCommentsRevisions(raw)
    },

    async anchors(binding, input) {
      const raw = await send({
        method: 'PUT',
        route: `${doc(binding)}/anchors`,
        json: {
          version_id: input.versionId,
          anchors: input.anchors.map((item) => ({
            comment_id: item.commentId,
            anchor: item.anchor,
            state: item.state,
          })),
        },
        read: json,
      })
      return parseCommentsAnchors(raw)
    },

    async searchMentions(binding, input) {
      const params = new URLSearchParams()
      params.set('q', input.q)
      if (input.limit !== undefined) params.set('limit', String(input.limit))
      const raw = await send({
        method: 'GET',
        route: `/documents/${id(binding.documentId)}/mention-candidates`,
        query: params,
        read: json,
      })
      return parseMentionsSearch(raw)
    },
  }
}
