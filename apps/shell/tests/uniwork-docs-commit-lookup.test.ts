import { describe, expect, it, vi } from 'vitest'
import type { UniworkDocErrorCode } from '../src/shared/home-api'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import {
  UniworkDocError,
  errorFromResponse,
  isTerminalRefusal,
} from '../src/main/uniwork-docs/errors'
import * as parse from '../src/main/uniwork-docs/parse'

/**
 * G5-06 W2 (UNI-1352): the commit-intent lookup route (G5-07) and the error
 * rows of the shared contract. `unknown` is a verdict, not a failure; a base
 * 409 is no longer a terminal refusal, and capability_off / intent_unknown
 * keep the intent. The `W2 red-before` block pins the two mappings the
 * contract fixes and was run against the unchanged code first (the failing
 * output is in the G5-06-W2 report).
 */

const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const KEY = 'office-key-1'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string, fields?: Record<string, unknown>) =>
  json(status, { error: { code, message: 'x', ...(fields ? { fields } : {}) } })

function client(fetch: FetchLike) {
  return createUniworkDocsClient({
    apiOrigin: ORIGIN,
    authorized: (call) => call('tok'),
    isSignedIn: () => true,
    fetch,
  })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof UniworkDocError ? error.code : `other:${String(error)}`
  }
  return 'resolved'
}

describe('W2 red-before: the two mappings the contract fixes', () => {
  it('403 office_capability_off maps to capability_off and is not terminal', () => {
    const error = errorFromResponse(403, {
      error: { code: 'office_capability_off', message: 'x', fields: { capability: 'sync_write' } },
    })
    expect(error.code).toBe('capability_off')
    expect(isTerminalRefusal(error)).toBe(false)
  })

  it('410 commit_intent_unknown maps to intent_unknown, never deleted', () => {
    const error = errorFromResponse(410, {
      error: { code: 'commit_intent_unknown', message: 'x', fields: { outcome: 'unknown' } },
    })
    expect(error.code).toBe('intent_unknown')
    expect(error.code).not.toBe('deleted')
    expect(isTerminalRefusal(error)).toBe(false)
  })
})

describe('error mapping rows (shared contract)', () => {
  const rows: Array<[number, string, string]> = [
    [403, 'office_capability_off', 'capability_off'],
    [410, 'commit_intent_unknown', 'intent_unknown'],
    [410, 'document_deleted', 'document_deleted'],
    [403, 'forbidden', 'permission_revoked'],
    [403, 'member_deactivated', 'member_deactivated'],
    [403, 'organization_suspended', 'organization_suspended'],
    [403, 'quota_exceeded', 'quota_exceeded'],
    // a coded 410 the contract does not name keeps the old tombstone verdict
    [410, 'document_gone', 'deleted'],
    // any other coded 403 stays the generic permission denial
    [403, 'some_other_denial', 'forbidden'],
  ]
  it.each(rows)('HTTP %i %s -> %s', (status, code, expected) => {
    expect(errorFromResponse(status, { error: { code, message: 'x' } }).code).toBe(expected)
  })

  const terminal: Array<[UniworkDocErrorCode, boolean]> = [
    ['capability_off', false],
    ['intent_unknown', false],
    // 409 base conflict keeps the intent: replaying with the same key can settle it
    ['conflict', false],
    ['permission_revoked', true],
    ['member_deactivated', true],
    ['organization_suspended', true],
    ['document_deleted', true],
    ['deleted', true],
    ['forbidden', true],
    ['not_found', true],
    ['quota_exceeded', true],
    ['idempotency_mismatch', true],
    ['too_large', true],
    ['engine_incompatible', true],
    ['network', false],
    ['timeout', false],
    ['session_expired', false],
    ['server_error', false],
  ]
  it.each(terminal)('isTerminalRefusal(%s) -> %s', (code, expected) => {
    expect(isTerminalRefusal(new UniworkDocError(code))).toBe(expected)
  })

  it('a 409 the pipeline cannot replay is still terminal; other statuses are not', () => {
    expect(isTerminalRefusal(new UniworkDocError('server_error', { status: 409 }))).toBe(true)
    expect(isTerminalRefusal(new UniworkDocError('server_error', { status: 500 }))).toBe(false)
  })
})

describe('GET /documents/{id}/versions/commit (lookupCommit)', () => {
  it('committed: GET on the commit route with the Idempotency-Key header, receipt parsed', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, { outcome: 'committed', version_id: 'v_9', version: 5, revision: '42' }),
    )
    const api = client(fetch)
    expect(await api.lookupCommit({ documentId: DOC, idempotencyKey: KEY })).toEqual({
      outcome: 'committed',
      receipt: { versionId: 'v_9', version: 5, revision: '42' },
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/documents/${DOC}/versions/commit`)
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(KEY)
    expect(init.body).toBeUndefined()
    expect(init.redirect).toBe('error')
  })

  it('a revision past 2^53 stays the server decimal string', async () => {
    const api = client(async () =>
      json(200, {
        outcome: 'committed',
        version_id: 'v_9',
        version: 5,
        revision: '90071992547409931',
      }),
    )
    const lookup = await api.lookupCommit({ documentId: DOC, idempotencyKey: KEY })
    expect(lookup).toEqual({
      outcome: 'committed',
      receipt: { versionId: 'v_9', version: 5, revision: '90071992547409931' },
    })
    if (lookup.outcome === 'committed') expect(typeof lookup.receipt.revision).toBe('string')
  })

  it.each(['in_flight', 'not_committed'] as const)(
    '%s resolves with the outcome only',
    async (o) => {
      const api = client(async () => json(200, { outcome: o }))
      expect(await api.lookupCommit({ documentId: DOC, idempotencyKey: KEY })).toEqual({
        outcome: o,
      })
    },
  )

  it('410 commit_intent_unknown is {outcome:unknown}, not an error and not deleted', async () => {
    const api = client(async () => envelope(410, 'commit_intent_unknown', { outcome: 'unknown' }))
    await expect(api.lookupCommit({ documentId: DOC, idempotencyKey: KEY })).resolves.toEqual({
      outcome: 'unknown',
    })
  })

  it('401 -> session_expired', async () => {
    const api = client(async () => envelope(401, 'unauthorized'))
    expect(await codeOf(api.lookupCommit({ documentId: DOC, idempotencyKey: KEY }))).toBe(
      'session_expired',
    )
  })

  it('404 -> not_found, never a lookup outcome', async () => {
    const api = client(async () => envelope(404, 'not_found'))
    expect(await codeOf(api.lookupCommit({ documentId: DOC, idempotencyKey: KEY }))).toBe(
      'not_found',
    )
  })

  it('400 is a failure (a client bug), never not_committed or unknown', async () => {
    const api = client(async () => envelope(400, 'invalid_request'))
    let thrown: unknown
    try {
      await api.lookupCommit({ documentId: DOC, idempotencyKey: KEY })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(UniworkDocError)
    expect((thrown as UniworkDocError).code).toBe('server_error')
  })

  it('malformed bodies are malformed_response, never outcomes', async () => {
    const bodies: unknown[] = [
      {},
      // a 200 never carries the 410-only verdict
      { outcome: 'unknown' },
      { outcome: 'committed' },
      { outcome: 'committed', version_id: 'v_9', version: 5 },
      { outcome: 'committed', version_id: 'v_9', version: 5, revision: 42 },
      { outcome: 'committed', version_id: 7, version: 5, revision: '42' },
      { outcome: 'committed', version_id: 'v_9', version: -1, revision: '42' },
      { outcome: 'done' },
    ]
    for (const body of bodies) {
      const api = client(async () => json(200, body))
      expect(await codeOf(api.lookupCommit({ documentId: DOC, idempotencyKey: KEY }))).toBe(
        'malformed_response',
      )
    }
  })

  it('parseCommitLookup reads the same bodies directly', () => {
    expect(parse.parseCommitLookup({ outcome: 'in_flight' })).toEqual({ outcome: 'in_flight' })
    expect(parse.parseCommitLookup({ outcome: 'not_committed' })).toEqual({
      outcome: 'not_committed',
    })
    expect(
      parse.parseCommitLookup({
        outcome: 'committed',
        version_id: 'v_9',
        version: 1,
        revision: '90071992547409931',
      }),
    ).toEqual({
      outcome: 'committed',
      receipt: { versionId: 'v_9', version: 1, revision: '90071992547409931' },
    })
    expect(() => parse.parseCommitLookup({ outcome: 'unknown' })).toThrow(UniworkDocError)
  })

  it('an id that would leave the route is refused before any request', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { outcome: 'in_flight' }))
    expect(
      await codeOf(client(fetch).lookupCommit({ documentId: '../../evil', idempotencyKey: KEY })),
    ).toBe('not_found')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('parseDetail / commentsLevelOf (G8-18 / DOC-05)', () => {
  const detailEnvelope = (myLevel?: unknown) => ({
    document: {
      id: DOC,
      organization_id: 'org_1',
      workspace_id: 'ws_1',
      title: 'Plan.docx',
      kind: 'file',
      revision: '41',
      current_version: 1,
      ...(myLevel !== undefined ? { my_level: myLevel } : {}),
      file: {
        filename: 'Plan.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        version: 1,
        checksum_sha256: 'a'.repeat(64),
        size_bytes: 128,
      },
    },
  })

  it.each(['view', 'comment', 'edit', 'manage'] as const)(
    'passes %s through unchanged',
    (level) => {
      expect(parse.commentsLevelOf(level)).toBe(level)
      expect(parse.parseDetail(detailEnvelope(level)).myLevel).toBe(level)
    },
  )

  it.each(['suggest', 'admin', 'owner', 'future_level'])(
    'downgrades an unknown level %s to view (never more)',
    (unknownLevel) => {
      expect(parse.commentsLevelOf(unknownLevel)).toBe('view')
      expect(parse.parseDetail(detailEnvelope(unknownLevel)).myLevel).toBe('view')
    },
  )

  it('keeps missing, null, or empty my_level as null and rejects non-strings', () => {
    expect(parse.commentsLevelOf(undefined)).toBeNull()
    expect(parse.commentsLevelOf(null)).toBeNull()
    expect(parse.commentsLevelOf('')).toBeNull()
    expect(parse.parseDetail(detailEnvelope()).myLevel).toBeNull()
    expect(parse.parseDetail(detailEnvelope(null)).myLevel).toBeNull()
    expect(parse.parseDetail(detailEnvelope('')).myLevel).toBeNull()
    expect(() => parse.commentsLevelOf(42)).toThrow(UniworkDocError)
  })
})
