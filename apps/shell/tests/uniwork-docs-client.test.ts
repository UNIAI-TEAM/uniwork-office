import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { AccountManager } from '../src/main/uniwork-auth/manager'
import type { DesktopSession, UniworkTransport } from '../src/main/uniwork-auth/transport'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError, isTerminalRefusal } from '../src/main/uniwork-docs/errors'
import { createMemoryCredentialStore } from './uniwork-auth-fakes'

const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string) => json(status, { error: { code, message: 'x' } })

function client(
  fetch: FetchLike,
  authorized = <T>(call: (t: string) => Promise<T>) => call('tok'),
) {
  return createUniworkDocsClient({ apiOrigin: ORIGIN, authorized, isSignedIn: () => true, fetch })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof UniworkDocError ? error.code : `other:${String(error)}`
  }
  return 'resolved'
}

describe('egress', () => {
  it('builds only apiOrigin/api/v1 URLs, never follows redirects, never caches', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        workspaces: [
          {
            id: 'ws_1',
            name: 'Team',
            slug: 'team',
            organization_id: 'org_a',
            organization_slug: 'acme',
          },
        ],
      }),
    )
    const api = client(fetch)
    expect(await api.listWorkspaces('org_a')).toEqual([
      { id: 'ws_1', name: 'Team', orgId: 'org_a', slug: 'team', orgSlug: 'acme', myRole: null },
    ])
    await api.listDocuments({ workspaceId: 'ws_1' }).catch(() => undefined)
    await api
      .listDocuments({ workspaceId: 'ws_1', query: 'plan', cursor: 'c1' })
      .catch(() => undefined)
    await api.getDocument(DOC).catch(() => undefined)
    await api.download(DOC, 2).catch(() => undefined)
    const urls = fetch.mock.calls.map(([url]) => url)
    expect(urls).toEqual([
      `${ORIGIN}/api/v1/orgs/org_a/workspaces`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents/recent?limit=50&kind=file`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents?q=plan&cursor=c1&limit=50&kind=file`,
      `${ORIGIN}/api/v1/documents/${DOC}`,
      `${ORIGIN}/api/v1/documents/${DOC}/download?version=2`,
    ])
    for (const [, init] of fetch.mock.calls) {
      expect(init.redirect).toBe('error')
      expect(init.cache).toBe('no-store')
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('refuses ids that would leave the route', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, {}))
    const api = client(fetch)
    expect(await codeOf(api.getDocument('../../evil'))).toBe('not_found')
    expect(await codeOf(api.getDocument('a/b'))).toBe('not_found')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a redirect is an error, never followed', async () => {
    const refused = client(async () => {
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') })
    })
    expect(await codeOf(refused.getDocument(DOC))).toBe('server_error')
    const redirected = client(async () => {
      const response = json(200, {})
      Object.defineProperty(response, 'redirected', { value: true })
      return response
    })
    expect(await codeOf(redirected.getDocument(DOC))).toBe('server_error')
    const otherHost = client(async () => {
      const response = json(200, {})
      Object.defineProperty(response, 'url', { value: 'https://storage.example/x' })
      return response
    })
    expect(await codeOf(otherHost.getDocument(DOC))).toBe('server_error')
  })

  it('times out a stalled request', async () => {
    const api = createUniworkDocsClient({
      apiOrigin: ORIGIN,
      authorized: (call) => call('tok'),
      isSignedIn: () => true,
      metadataTimeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    })
    expect(await codeOf(api.getDocument(DOC))).toBe('timeout')
  })

  it('not signed in never reaches the network', async () => {
    const fetch = vi.fn<FetchLike>()
    const api = createUniworkDocsClient({
      apiOrigin: ORIGIN,
      authorized: (call) => call('tok'),
      isSignedIn: () => false,
      fetch,
    })
    expect(await codeOf(api.listWorkspaces('org_a'))).toBe('not_signed_in')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('workspace slugs', () => {
  it('reads as empty when the server sends none', async () => {
    const api = client(async () => json(200, { workspaces: [{ id: 'ws_1', name: 'Team' }] }))
    expect(await api.listWorkspaces('org_a')).toEqual([
      { id: 'ws_1', name: 'Team', orgId: 'org_a', slug: '', orgSlug: '', myRole: null },
    ])
  })
})

describe('error envelope mapping', () => {
  const cases: Array<[Response, string]> = [
    [envelope(403, 'forbidden'), 'permission_revoked'],
    [envelope(403, 'quota_exceeded'), 'quota_exceeded'],
    [new Response('denied', { status: 403 }), 'server_error'],
    [envelope(404, 'not_found'), 'not_found'],
    [new Response('', { status: 404 }), 'server_error'],
    [envelope(410, 'document_deleted'), 'document_deleted'],
    // OQ-F6 / OQ-F12 Q1=b: a write refused for a document in the trash or the
    // archive is a block the queue can lift, never a terminal refusal - and the
    // archive is NOT read as the trash: archiving is reversible, so it keeps its
    // own code (the row says archived, not deleted)
    [envelope(403, 'document_deleted'), 'document_deleted'],
    [envelope(403, 'document_archived'), 'document_archived'],
    [envelope(410, 'document_archived'), 'document_archived'],
    // the change feed's cursor verdicts are about the cursor, never a document
    [envelope(410, 'change_cursor_expired'), 'server_error'],
    [envelope(400, 'change_cursor_invalid'), 'server_error'],
    [envelope(413, 'file_too_large'), 'too_large'],
    [envelope(409, 'idempotency_payload_mismatch'), 'idempotency_mismatch'],
    [envelope(409, 'idempotency_key_reuse'), 'idempotency_mismatch'],
    [envelope(409, 'engine_incompatible'), 'engine_incompatible'],
    [envelope(502, 'bad_gateway'), 'server_error'],
  ]
  it.each(cases.map(([response, code], i) => [i, response, code] as const))(
    'case %i -> %s',
    async (_i, response, code) => {
      expect(await codeOf(client(async () => response.clone()).getDocument(DOC))).toBe(code)
    },
  )

  it('409 document_version_conflict keeps fields.current_revision as a string', async () => {
    const api = client(async () =>
      json(409, {
        error: {
          code: 'document_version_conflict',
          message: 'x',
          fields: { current_revision: '90071992547409931' },
        },
      }),
    )
    try {
      await api.commit({ documentId: DOC, uploadId: 'u', baseRevision: '41', idempotencyKey: 'k' })
      throw new Error('expected a conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(UniworkDocError)
      expect((error as UniworkDocError).code).toBe('conflict')
      expect((error as UniworkDocError).currentRevision).toBe('90071992547409931')
    }
  })

  it('strict parsing: a revision as a number is malformed', async () => {
    const api = client(async () =>
      json(200, {
        document: {
          id: DOC,
          organization_id: 'o',
          workspace_id: 'w',
          title: 't.docx',
          kind: 'file',
          revision: 41,
          current_version: 1,
          file: {
            filename: 't.docx',
            mime_type: '',
            version: 1,
            checksum_sha256: 'a'.repeat(64),
            size_bytes: 1,
          },
        },
      }),
    )
    expect(await codeOf(api.getDocument(DOC))).toBe('malformed_response')
  })

  it('sends the commit body in snake_case with the revision as a decimal string', async () => {
    const fetch = vi.fn<FetchLike>(async () => envelope(500, 'internal'))
    await client(fetch)
      .commit({
        documentId: DOC,
        uploadId: 'up_1',
        baseRevision: '41',
        idempotencyKey: 'office-key-1',
      })
      .catch(() => undefined)
    const [, init] = fetch.mock.calls[0]!
    expect(JSON.parse(String(init.body))).toEqual({ upload_id: 'up_1', base_revision: '41' })
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('office-key-1')
  })

  it('EL-1(b): commit sends edit_lock_id only when the input carries one', async () => {
    const fetch = vi.fn<FetchLike>(async () => envelope(500, 'internal'))
    await client(fetch)
      .commit({
        documentId: DOC,
        uploadId: 'up_1',
        baseRevision: '41',
        idempotencyKey: 'office-key-1',
        editLockId: '01J8X4LOCK0N1P2Q3R4S5T6U7V',
      })
      .catch(() => undefined)
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toEqual({
      upload_id: 'up_1',
      base_revision: '41',
      edit_lock_id: '01J8X4LOCK0N1P2Q3R4S5T6U7V',
    })
  })
})

describe('Retry-After (G5-06 be-9)', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-13T12:00:00Z'), toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  const dated = (status: number, body: unknown, retryAfter: string) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Retry-After': retryAfter },
    })
  const failureOf = async (response: () => Promise<Response>): Promise<UniworkDocError> => {
    try {
      await client(response).commit({
        documentId: DOC,
        uploadId: 'up_1',
        baseRevision: '41',
        idempotencyKey: 'office-key-1',
      })
    } catch (error) {
      if (error instanceof UniworkDocError) return error
      throw error
    }
    throw new Error('expected a failure')
  }

  it('429 / 503 / 409 idempotency_in_flight carry it, delta-seconds or an HTTP date', async () => {
    // a throttle is retryable, never a terminal refusal, and keeps the delay
    const throttled = await failureOf(async () => dated(429, 'busy', '900'))
    expect(throttled.code).toBe('server_error')
    expect(isTerminalRefusal(throttled)).toBe(false)
    expect(throttled.retryAfterMs).toBe(900_000)
    // an HTTP date is the delay from now
    const date = new Date(Date.now() + 42_000).toUTCString()
    const unavailable = await failureOf(async () => dated(503, '', date))
    expect(unavailable.code).toBe('server_error')
    expect(unavailable.retryAfterMs).toBe(42_000)
    // the in-flight idempotency answer is retried with a bounded backoff
    const inFlight = await failureOf(async () =>
      dated(409, { error: { code: 'idempotency_in_flight' } }, '120'),
    )
    expect(inFlight.code).toBe('network')
    expect(inFlight.retryAfterMs).toBe(120_000)
    // a malformed header, or one on a status that does not carry it, is ignored
    expect((await failureOf(async () => dated(429, 'busy', 'later'))).retryAfterMs).toBeUndefined()
    const denied = await failureOf(async () => dated(403, { error: { code: 'forbidden' } }, '900'))
    expect(denied.code).toBe('permission_revoked')
    expect(denied.retryAfterMs).toBeUndefined()
  })
})

describe('BIGUP-A1: upload-session routes', () => {
  const SESSION = 'ups_01ja09k3'
  const sessionBody = {
    session_id: SESSION,
    part_size: 8388608,
    total_parts: 6,
    completed_parts: [{ part_number: 1, etag: '"e1"', size: 8388608 }],
    parts: [
      {
        part_number: 2,
        method: 'PUT',
        url: 'https://storage.example/part/2?sig=abc',
        headers: { 'x-amz-acl': 'private' },
        expires_at: '2026-10-18T15:00:00Z',
      },
    ],
    expires_at: '2026-10-19T14:00:00Z',
  }
  const probe = {
    head_b64: 'UEsDBBQAAAAIAA==',
    central_dir_b64: 'UEsFBgAAAAABAAEALgAuAAAA',
    cd_offset: 83820000,
    cd_size: 66080,
  }

  it('creates a workspace session with the probe and the mandatory key', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(201, sessionBody))
    const session = await client(fetch).createWorkspaceUploadSession({
      workspaceId: 'ws_1',
      filename: 'Bao-cao.docx',
      sizeBytes: 45 * 1024 * 1024,
      probe,
      idempotencyKey: 'office-key-1',
      parentId: 'fold_1',
      title: 'Báo cáo',
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/workspaces/ws_1/documents/upload-sessions`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('office-key-1')
    expect(JSON.parse(String(init.body))).toEqual({
      filename: 'Bao-cao.docx',
      size_bytes: 45 * 1024 * 1024,
      probe,
      parent_id: 'fold_1',
      title: 'Báo cáo',
    })
    // the create answer carries no status: the reader leaves it null
    expect(session).toEqual({
      sessionId: SESSION,
      status: null,
      partSize: 8388608,
      totalParts: 6,
      completedParts: [{ partNumber: 1, etag: '"e1"', size: 8388608 }],
      parts: [
        {
          partNumber: 2,
          method: 'PUT',
          url: 'https://storage.example/part/2?sig=abc',
          headers: { 'x-amz-acl': 'private' },
          expiresAt: '2026-10-18T15:00:00Z',
        },
      ],
      expiresAt: '2026-10-19T14:00:00Z',
    })
  })

  it('creates a document session (a new version) and omits a null cd_offset as 0', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(201, sessionBody))
    await client(fetch).createDocumentUploadSession({
      documentId: DOC,
      filename: 'v2.docx',
      sizeBytes: 45 * 1024 * 1024,
      probe: { head_b64: 'AA==', central_dir_b64: '', cd_offset: null, cd_size: null },
      idempotencyKey: 'k',
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/documents/${DOC}/upload-sessions`)
    expect(JSON.parse(String(init.body))).toEqual({
      filename: 'v2.docx',
      size_bytes: 45 * 1024 * 1024,
      probe: { head_b64: 'AA==', central_dir_b64: '', cd_offset: 0, cd_size: 0 },
    })
  })

  it('reads a session by id, and its status, and sends the parts in snake_case', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { ...sessionBody, status: 'open' }))
    const api = client(fetch)
    const state = await api.getUploadSession(SESSION)
    expect(fetch.mock.calls[0]![0]).toBe(`${ORIGIN}/api/v1/upload-sessions/${SESSION}`)
    expect(state.status).toBe('open')

    const completing = vi.fn<FetchLike>(async () =>
      json(200, {
        document: {
          id: DOC,
          organization_id: 'o',
          workspace_id: 'w',
          title: 't.docx',
          kind: 'file',
          revision: '1',
          current_version: 1,
          file: {
            filename: 't.docx',
            mime_type: '',
            version: 1,
            checksum_sha256: 'a'.repeat(64),
            size_bytes: 1,
          },
        },
      }),
    )
    const done = await client(completing).completeUploadSession({
      sessionId: SESSION,
      parts: [
        { partNumber: 1, etag: '"e1"' },
        { partNumber: 2, etag: '"e2"' },
      ],
    })
    const [, init] = completing.mock.calls[0]!
    expect(completing.mock.calls[0]![0]).toBe(
      `${ORIGIN}/api/v1/upload-sessions/${SESSION}/complete`,
    )
    expect(JSON.parse(String(init.body))).toEqual({
      parts: [
        { part_number: 1, etag: '"e1"' },
        { part_number: 2, etag: '"e2"' },
      ],
    })
    expect(done.kind).toBe('document')
  })

  it('reads a version complete as the staged upload the commit route claims', async () => {
    const api = client(async () =>
      json(200, {
        upload_id: 'upl_1',
        checksum_sha256: 'a'.repeat(64),
        size_bytes: 45 * 1024 * 1024,
        claim_expires_at: '2026-10-18T00:00:00Z',
      }),
    )
    const answer = await api.completeUploadSession({ sessionId: SESSION, parts: [] })
    expect(answer).toEqual({
      kind: 'upload',
      upload: {
        uploadId: 'upl_1',
        checksumSha256: 'a'.repeat(64),
        sizeBytes: 45 * 1024 * 1024,
        claimExpiresAt: '2026-10-18T00:00:00Z',
      },
    })
  })

  it('deletes a session with a 204', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(null, { status: 204 }))
    await client(fetch).deleteUploadSession(SESSION)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/upload-sessions/${SESSION}`)
    expect(init.method).toBe('DELETE')
  })

  it('PUTs a part straight to the presigned URL: no bearer, no cookie, ETag read', async () => {
    const fetch = vi.fn<FetchLike>(
      async () =>
        new Response(null, {
          status: 200,
          headers: { ETag: '"d41d8cd98f00b204e9800998ecf8427e"' },
        }),
    )
    const answer = await client(fetch).putUploadPart({
      partNumber: 3,
      url: 'https://storage.example/part/3?sig=abc',
      headers: { 'x-amz-acl': 'private' },
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(answer).toEqual({ etag: '"d41d8cd98f00b204e9800998ecf8427e"' })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://storage.example/part/3?sig=abc')
    expect(init.method).toBe('PUT')
    expect(init.credentials).toBe('omit')
    expect(init.headers).toEqual({ 'x-amz-acl': 'private' })
  })

  it('a part PUT without an ETag, or refused, is a typed failure', async () => {
    const noEtag = client(async () => new Response(null, { status: 200 }))
    expect(
      await codeOf(
        noEtag.putUploadPart({
          partNumber: 1,
          url: 'https://storage.example/p',
          bytes: new Uint8Array(1),
        }),
      ),
    ).toBe('malformed_response')

    const expired = client(
      async () =>
        new Response(JSON.stringify({ error: { code: 'access_denied' } }), { status: 403 }),
    )
    expect(
      await codeOf(
        expired.putUploadPart({
          partNumber: 1,
          url: 'https://storage.example/p',
          bytes: new Uint8Array(1),
        }),
      ),
    ).toBe('forbidden')
  })

  const sessionFailures: Array<[Response, string, string | undefined]> = [
    // a threshold drift: the caller falls back to the single-request path
    [envelope(422, 'upload_session_too_small'), 'server_error', 'upload_session_too_small'],
    // a session that expired is gone, not a document tombstone
    [envelope(410, 'upload_session_expired'), 'not_found', 'upload_session_expired'],
    [envelope(404, 'not_found'), 'not_found', 'not_found'],
    [envelope(422, 'upload_parts_invalid'), 'server_error', 'upload_parts_invalid'],
    // the file changed under us: never retried silently
    [envelope(422, 'upload_size_mismatch'), 'malformed_response', 'upload_size_mismatch'],
    [envelope(422, 'upload_probe_mismatch'), 'malformed_response', 'upload_probe_mismatch'],
    [envelope(415, 'unsupported_media_type'), 'unsupported_format', 'unsupported_media_type'],
    [envelope(429, 'upload_sessions_exhausted'), 'server_error', 'upload_sessions_exhausted'],
    [
      envelope(409, 'idempotency_payload_mismatch'),
      'idempotency_mismatch',
      'idempotency_payload_mismatch',
    ],
    [envelope(403, 'quota_exceeded'), 'quota_exceeded', 'quota_exceeded'],
  ]
  it.each(
    sessionFailures.map(
      ([response, code, serverCode], i) => [i, response, code, serverCode] as const,
    ),
  )('session failure %i -> %s', async (_i, response, code, serverCode) => {
    const api = client(async () => response.clone())
    try {
      await api.getUploadSession(SESSION)
      throw new Error('expected a failure')
    } catch (error) {
      expect(error).toBeInstanceOf(UniworkDocError)
      expect((error as UniworkDocError).code).toBe(code)
      expect((error as UniworkDocError).serverCode).toBe(serverCode)
    }
  })

  it('409 upload_session_busy keeps the delay from fields.retry_after', async () => {
    const api = client(async () =>
      json(409, {
        error: { code: 'upload_session_busy', message: 'x', fields: { retry_after: 5 } },
      }),
    )
    try {
      await api.completeUploadSession({ sessionId: SESSION, parts: [] })
      throw new Error('expected a failure')
    } catch (error) {
      expect(error).toBeInstanceOf(UniworkDocError)
      expect((error as UniworkDocError).code).toBe('server_error')
      expect((error as UniworkDocError).serverCode).toBe('upload_session_busy')
      expect((error as UniworkDocError).retryAfterMs).toBe(5_000)
    }
  })

  it('429 upload_sessions_exhausted keeps Retry-After from the header', async () => {
    const api = client(
      async () =>
        new Response(JSON.stringify({ error: { code: 'upload_sessions_exhausted' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
        }),
    )
    try {
      await api.createWorkspaceUploadSession({
        workspaceId: 'ws_1',
        filename: 'x.docx',
        sizeBytes: 45 * 1024 * 1024,
        probe,
        idempotencyKey: 'k',
      })
      throw new Error('expected a failure')
    } catch (error) {
      expect((error as UniworkDocError).code).toBe('server_error')
      expect((error as UniworkDocError).retryAfterMs).toBe(60_000)
    }
  })

  it('413 file_too_large carries the cap, and a part route is refused before the network', async () => {
    const api = client(async () =>
      json(413, {
        error: { code: 'file_too_large', message: 'x', fields: { max_bytes: 209715200 } },
      }),
    )
    try {
      await api.getUploadSession(SESSION)
      throw new Error('expected a failure')
    } catch (error) {
      expect((error as UniworkDocError).code).toBe('too_large')
      expect((error as UniworkDocError).maxBytes).toBe(209715200)
    }

    const fetch = vi.fn<FetchLike>(async () => json(200, {}))
    expect(await codeOf(client(fetch).getUploadSession('../../evil'))).toBe('not_found')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('401: one shared refresh, one retry (real account session)', () => {
  const profile: DeploymentProfile = {
    deploymentId: 'default',
    apiOrigin: ORIGIN,
    clientId: 'uniwork-office',
    channel: 'stable',
  }
  let seq = 0
  const session = (): DesktopSession => {
    seq += 1
    return {
      accountId: 'acc_1',
      deviceSessionId: 'dev_1',
      sessionId: 's',
      deploymentId: 'default',
      accessToken: `at_${seq}`,
      refreshToken: `rt_${seq}`,
      expiresIn: 900,
      refreshExpiresIn: 86400,
    }
  }
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-01T00:00:00Z'), toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  async function signedIn() {
    const transport = {
      start: vi.fn(async () => ({ authorizationUrl: `${ORIGIN}/auth/desktop/authorize?a=1` })),
      exchange: vi.fn(async () => session()),
      refresh: vi.fn(async () => session()),
      logout: vi.fn(async () => undefined),
      me: vi.fn(async () => ({ id: 'acc_1', email: 'mai@example.com', displayName: 'Mai' })),
      orgs: vi.fn(async () => [
        { id: 'org_a', name: 'Acme', slug: 'acme', role: 'owner', status: 'active' },
      ]),
      orgMembership: vi.fn(async () => ({ role: 'owner' })),
      billing: vi.fn(async () => ({
        planCode: 'p',
        planName: 'P',
        status: 'active',
        features: [],
      })),
    } satisfies UniworkTransport
    const manager = new AccountManager({
      resolveProfile: () => profile,
      createTransport: () => transport,
      credentials: createMemoryCredentialStore(),
      openBrowser: async () => undefined,
      readSelectedOrgId: () => 'org_a',
      persistSelectedOrgId: () => undefined,
    })
    await manager.login()
    const state = (transport.start.mock.calls.at(-1)?.[0] as { state: string }).state
    await manager.completeCallback(
      `uniwork-office://auth/callback?code=c&state=${encodeURIComponent(state)}`,
    )
    expect(manager.status().state).toBe('signed-in')
    return { manager, transport }
  }

  it('refreshes once and retries with the new token', async () => {
    const { manager, transport } = await signedIn()
    const seen: string[] = []
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization
      seen.push(auth)
      return seen.length === 1 ? envelope(401, 'unauthorized') : json(200, { workspaces: [] })
    })
    const api = client(fetch, (call) => manager.authorizedRequest(call))
    expect(await api.listWorkspaces('org_a')).toEqual([])
    expect(transport.refresh).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1])
  })

  it('a second 401 is session_expired; concurrent 401s share one refresh', async () => {
    const { manager, transport } = await signedIn()
    const api = client(
      async () => envelope(401, 'unauthorized'),
      (call) => manager.authorizedRequest(call),
    )
    const [a, b] = await Promise.all([
      codeOf(api.listWorkspaces('org_a')),
      codeOf(api.listWorkspaces('org_a')),
    ])
    expect([a, b]).toEqual(['session_expired', 'session_expired'])
    expect(transport.refresh).toHaveBeenCalledTimes(1)
  })

  const exchangeInput = {
    launchTicket: 't',
    deploymentId: 'default',
    clientId: 'uniwork-office',
    deviceSessionId: 'dev_1',
  }
  const exchanged = {
    receipt_id: 'r1',
    redeemed_at: '2026-10-01T00:00:00Z',
    document: {
      id: DOC,
      organization_id: 'org_a',
      workspace_id: 'ws_1',
      title: 'Plan.docx',
      kind: 'file',
      operation: 'edit',
      version: 0,
      revision: '4',
      download_path: `/api/v1/documents/${DOC}/download`,
    },
  }

  it('the launch exchange refreshes once on a 401 (an idle-expired token) and redeems', async () => {
    const { manager, transport } = await signedIn()
    const seen: string[] = []
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      seen.push((init.headers as Record<string, string>).Authorization)
      return seen.length === 1 ? envelope(401, 'unauthorized') : json(200, exchanged)
    })
    const api = client(fetch, (call) => manager.authorizedRequest(call))
    expect((await api.exchange(exchangeInput)).id).toBe(DOC)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(transport.refresh).toHaveBeenCalledTimes(1)
    expect(seen[0]).not.toBe(seen[1])
  })

  it('a second 401 on the launch exchange is session_expired', async () => {
    const { manager, transport } = await signedIn()
    const fetch = vi.fn<FetchLike>(async () => envelope(401, 'unauthorized'))
    const api = client(fetch, (call) => manager.authorizedRequest(call))
    expect(await codeOf(api.exchange(exchangeInput))).toBe('session_expired')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(transport.refresh).toHaveBeenCalledTimes(1)
  })

  it('parses visibility, myLevel and updatedById on list and shared-with-me rows, dropping unknown values', async () => {
    const fetch = vi.fn<FetchLike>(async (url) => {
      if (url.includes('/shared-with-me')) {
        return json(200, {
          documents: [
            {
              id: 's1',
              workspace_id: 'ws_1',
              title: 'Shared.docx',
              kind: 'file',
              updated_at: '2026-10-17T01:00:00Z',
              visibility: 'restricted',
              my_level: 'comment',
              updated_by: 'usr_9',
            },
          ],
          next_cursor: null,
        })
      }
      return json(200, {
        documents: [
          {
            id: 'd_priv',
            workspace_id: 'ws_1',
            title: 'Private.docx',
            kind: 'file',
            updated_at: '2026-10-17T01:00:00Z',
            visibility: 'private',
            my_level: 'manage',
            updated_by: 'usr_1',
          },
          {
            id: 'd_ws',
            workspace_id: 'ws_1',
            title: 'Workspace.xlsx',
            kind: 'file',
            updated_at: '2026-10-17T02:00:00Z',
            visibility: 'workspace',
            my_level: 'view',
            updated_by: '',
          },
          {
            id: 'd_unknown',
            workspace_id: 'ws_1',
            title: 'Unknown.pptx',
            kind: 'file',
            updated_at: '2026-10-17T03:00:00Z',
            visibility: 'public_link',
            my_level: 'superadmin',
          },
        ],
        next_cursor: null,
      })
    })
    const api = client(fetch)
    const list = await api.listDocuments({ workspaceId: 'ws_1' })
    expect(list.documents[0]).toMatchObject({
      id: 'd_priv',
      visibility: 'private',
      myLevel: 'manage',
      updatedById: 'usr_1',
      canEdit: true,
      canManage: true,
    })
    expect(list.documents[1]).toMatchObject({
      id: 'd_ws',
      visibility: 'workspace',
      myLevel: 'view',
      canEdit: false,
      canManage: false,
    })
    expect(list.documents[1]!.updatedById).toBeUndefined()
    expect(list.documents[2]!.visibility).toBeUndefined()
    expect(list.documents[2]!.myLevel).toBeUndefined()
    expect(list.documents[2]!.updatedById).toBeUndefined()

    const shared = await api.listSharedWithMe({ workspaceId: 'ws_1' })
    expect(shared.documents[0]).toMatchObject({
      id: 's1',
      visibility: 'restricted',
      myLevel: 'comment',
      updatedById: 'usr_9',
      canEdit: false,
      canManage: false,
    })
  })

  // UNI-1975 guard tests (pass on the base too): the app adds nothing to the
  // server's folder-sharing answers (UNI-1973 / UNI-1974 reach it with no app change)
  it('lists Shared by me exactly as the server answers: no folder rows added, a recipient row without parent_id lands at the root', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        documents: [
          {
            id: 'top_doc',
            workspace_id: 'ws_1',
            title: 'Top.docx',
            kind: 'file',
            updated_at: '2026-10-17T03:00:00Z',
            visibility: 'restricted',
            my_level: 'manage',
          },
        ],
        next_cursor: null,
      }),
    )
    const api = client(fetch)
    const page = await api.listSharedByMe({ workspaceId: 'ws_1' })
    expect(page.documents.map((d) => d.id)).toEqual(['top_doc'])
    expect(page.documents.some((d) => d.kind === 'folder')).toBe(false)
    // the server masked parent_id: the row stays at the workspace root, never a guessed folder
    expect(page.documents[0]!.parentId).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sends listSharedByMe, listTrash, listWorkspaceMembers and filter params only when set', async () => {
    const seen: string[] = []
    const fetch = vi.fn<FetchLike>(async (url) => {
      seen.push(url)
      if (url.endsWith('/members')) {
        return json(200, {
          members: [
            { user_id: 'u_1', display_name: 'Alice' },
            { user_id: 'u_2', display_name: '' },
          ],
        })
      }
      return json(200, { documents: [], next_cursor: null })
    })
    const api = client(fetch)

    // Unset filters stay byte-identical
    await api.listSharedByMe({ workspaceId: 'ws_1' })
    await api.listTrash({ workspaceId: 'ws_1', limit: 25, cursor: 'c_trash' })
    await api.listChildren({ workspaceId: 'ws_1', parentId: null })
    await api.listDocuments({ workspaceId: 'ws_1' })

    // Set filters append format, updated_by, updated_from
    await api.listSharedByMe({
      workspaceId: 'ws_1',
      format: 'docx',
      updatedBy: 'u_1',
      updatedFrom: '2026-10-01T00:00:00Z',
    })
    await api.listTrash({
      workspaceId: 'ws_1',
      format: 'xlsx',
      updatedBy: 'u_2',
      updatedFrom: '2026-10-10T00:00:00Z',
    })
    await api.listChildren({
      workspaceId: 'ws_1',
      parentId: 'fold_1',
      format: 'pptx',
      updatedBy: 'u_3',
      updatedFrom: '2026-10-15T00:00:00Z',
    })
    // DH1-BE-1: the server forwards `format` to `/documents/recent`, so a
    // format-only Recent keeps the caller's recent scope. Only the filters
    // that route cannot forward (updater, date) need the flat workspace list.
    await api.listDocuments({ workspaceId: 'ws_1', format: 'pdf' })
    await api.listDocuments({ workspaceId: 'ws_1', updatedBy: 'u_4' })
    await api.listDocuments({
      workspaceId: 'ws_1',
      updatedBy: 'u_4',
      updatedFrom: '2026-10-16T00:00:00Z',
    })

    const members = await api.listWorkspaceMembers('ws_1')
    expect(members).toEqual([{ userId: 'u_1', displayName: 'Alice' }])

    expect(seen).toEqual([
      `${ORIGIN}/api/v1/workspaces/ws_1/documents?shared_by_me=true&limit=50`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents?archived=1&limit=25&cursor=c_trash`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents?parent_id=&limit=50`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents/recent?limit=50&kind=file`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents?shared_by_me=true&limit=50&format=docx&updated_by=u_1&updated_from=2026-10-01T00%3A00%3A00Z`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents?archived=1&limit=50&format=xlsx&updated_by=u_2&updated_from=2026-10-10T00%3A00%3A00Z`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents?parent_id=fold_1&limit=50&format=pptx&updated_by=u_3&updated_from=2026-10-15T00%3A00%3A00Z`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents/recent?limit=50&kind=file&format=pdf`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents?limit=50&kind=file&updated_by=u_4`,
      `${ORIGIN}/api/v1/workspaces/ws_1/documents?limit=50&kind=file&updated_by=u_4&updated_from=2026-10-16T00%3A00%3A00Z`,
      `${ORIGIN}/api/v1/workspaces/ws_1/members`,
    ])
  })
})

/**
 * UNI-1953 CT1-1: Recent and Shared with me list UniNote pages for the
 * Documents home (`includePages`), while every other caller (the picker, the
 * overview, the tray) keeps the files-only list.
 */
describe('UniNote pages on the library lists (UNI-1953 CT1-1)', () => {
  const rows = [
    {
      id: 'f1',
      kind: 'file',
      workspace_id: 'ws_1',
      title: 'A.docx',
      updated_at: '2026-10-17T01:00:00Z',
    },
    {
      id: 'p1',
      kind: 'page',
      workspace_id: 'ws_1',
      title: 'Ghi chú',
      updated_at: '2026-10-17T02:00:00Z',
    },
    {
      id: 'd1',
      kind: 'folder',
      workspace_id: 'ws_1',
      title: 'Folder',
      updated_at: '2026-10-17T03:00:00Z',
    },
  ]
  const serve = () => {
    const seen: string[] = []
    const fetch = vi.fn<FetchLike>(async (url) => {
      seen.push(url)
      return json(200, { documents: rows, next_cursor: null })
    })
    return { api: client(fetch), seen }
  }

  it('listDocuments stays files-only by default (kind=file, no page row)', async () => {
    const { api, seen } = serve()
    const list = await api.listDocuments({ workspaceId: 'ws_1' })
    expect(list.documents.map((d) => d.id)).toEqual(['f1'])
    expect(seen[0]).toContain('kind=file')
  })

  it('listDocuments with includePages keeps files and pages, never a folder', async () => {
    const { api, seen } = serve()
    const list = await api.listDocuments({ workspaceId: 'ws_1', includePages: true })
    expect(list.documents.map((d) => [d.id, d.kind])).toEqual([
      ['f1', 'file'],
      ['p1', 'page'],
    ])
    expect(seen[0]).not.toContain('kind=file')
    // a page has no document format, whatever its title ends in
    expect(list.documents[1]!.format).toBeNull()
  })

  it('listSharedWithMe stays files-only by default', async () => {
    const { api } = serve()
    const shared = await api.listSharedWithMe({ workspaceId: 'ws_1' })
    expect(shared.documents.map((d) => d.id)).toEqual(['f1'])
  })

  it('listSharedWithMe with includePages keeps the page row as a page', async () => {
    const { api } = serve()
    const shared = await api.listSharedWithMe({ workspaceId: 'ws_1', includePages: true })
    expect(shared.documents.map((d) => [d.id, d.kind])).toEqual([
      ['f1', 'file'],
      ['p1', 'page'],
    ])
  })
})
