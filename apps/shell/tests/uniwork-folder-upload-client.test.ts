import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import {
  createFolderUploadClient,
  createFolderUploadTransport,
} from '../src/main/uniwork-docs/folder-upload-client'
import {
  FolderUploadApiError,
  FolderUploadError,
  type FileTarget,
} from '../src/main/uniwork-docs/folder-upload/transport'

const ORIGIN = 'https://uniwork.example'
const WS = 'ws_1'
const BATCH = '01J8X4BATCH0N1P2Q3R4S5T6'
const BASE = `${ORIGIN}/api/v1/workspaces/${WS}/documents/folder-uploads`

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
const envelope = (
  status: number,
  code: string,
  fields?: Record<string, unknown>,
  headers?: Record<string, string>,
) => json(status, { error: { code, message: 'x', ...(fields ? { fields } : {}) } }, headers)

function options(fetch: FetchLike) {
  return {
    apiOrigin: ORIGIN,
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch,
  }
}

const client = (fetch: FetchLike) => createFolderUploadClient(options(fetch))

const putTarget = {
  kind: 'put',
  method: 'PUT',
  url: 'https://storage.example/f-0001?sig=1',
  headers: { 'Content-Type': 'application/pdf' },
  expires_at: '2099-01-01T00:00:00Z',
}

const wireBatch = (over: Record<string, unknown> = {}) => ({
  id: BATCH,
  status: 'open',
  parent_id: 'parent-1',
  mode: 'folder',
  root_folder_id: 'root-1',
  root_title: 'Hồ sơ (1)',
  share_with_workspace: true,
  folders: [
    { path: '', id: 'root-1' },
    { path: 'Hợp đồng', id: 'folder-2' },
  ],
  files: [
    {
      file_key: 'f-0001',
      path: 'Hợp đồng',
      filename: 'a.pdf',
      size_bytes: 12,
      status: 'pending',
      document_id: null,
      error: null,
      target: putTarget,
    },
    {
      file_key: 'f-0002',
      path: '',
      filename: 'big.docx',
      size_bytes: 40_000_000,
      status: 'pending',
      document_id: null,
      error: null,
      target: {
        kind: 'multipart',
        session_id: 's-1',
        part_size: 8_388_608,
        parts: [
          { part_number: 1, url: 'https://storage.example/p1', expires_at: '2099-01-01T00:00:00Z' },
        ],
        expires_at: '2099-01-01T00:00:00Z',
      },
    },
  ],
  counts: { total: 2, done: 0, failed: 0, pending: 2 },
  total_bytes: 40_000_012,
  expires_at: '2099-01-02T00:00:00Z',
  created_at: '2099-01-01T00:00:00Z',
  ...over,
})

const planBody = {
  parent_id: 'parent-1',
  root_name: 'Hồ sơ',
  share_with_workspace: true,
  folders: ['Hợp đồng'],
  files: [{ file_key: 'f-0001', path: 'Hợp đồng', filename: 'a.pdf', size_bytes: 12 }],
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return undefined
}

describe('folder-upload client: POST plan', () => {
  it('posts the body with Idempotency-Key and the bearer, and reads the batch', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(201, wireBatch()))
    const batch = await client(fetch).createFolderUpload(WS, planBody, { idempotencyKey: 'key-1' })

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(BASE)
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Idempotency-Key': 'key-1',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init.body as string)).toEqual(planBody)

    expect(batch).toMatchObject({
      id: BATCH,
      status: 'open',
      mode: 'folder',
      root_folder_id: 'root-1',
      root_title: 'Hồ sơ (1)',
      share_with_workspace: true,
      folders: [
        { path: '', id: 'root-1' },
        { path: 'Hợp đồng', id: 'folder-2' },
      ],
      counts: { total: 2, done: 0, failed: 0, pending: 2 },
      total_bytes: 40_000_012,
    })
    expect(batch.files[0]).toMatchObject({
      file_key: 'f-0001',
      status: 'pending',
      target: putTarget,
    })
    expect(batch.files[1]?.target).toMatchObject({
      kind: 'multipart',
      session_id: 's-1',
      part_size: 8_388_608,
      parts: [{ part_number: 1, method: 'PUT', url: 'https://storage.example/p1', headers: {} }],
    })
  })

  it('sends a probe with null directory fields as zeros, the shape the server wants', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(201, wireBatch()))
    await client(fetch).createFolderUpload(
      WS,
      {
        ...planBody,
        files: [
          {
            file_key: 'f-0001',
            path: '',
            filename: 'a.pdf',
            size_bytes: 30_000_000,
            probe: { head_b64: 'aA==', central_dir_b64: '', cd_offset: null, cd_size: null },
          },
        ],
      },
      { idempotencyKey: 'k' },
    )
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body.files[0].probe).toEqual({
      head_b64: 'aA==',
      central_dir_b64: '',
      cd_offset: 0,
      cd_size: 0,
    })
  })

  it('reads a files-mode answer (no root) and derives the mode when the server leaves it out', async () => {
    const answer = wireBatch({ root_folder_id: null, root_title: null, folders: [] })
    delete (answer as Record<string, unknown>).mode
    const batch = await client(async () => json(201, answer)).createFolderUpload(
      WS,
      { parent_id: null, share_with_workspace: false, files: planBody.files },
      { idempotencyKey: 'k' },
    )
    expect(batch).toMatchObject({
      mode: 'files',
      root_folder_id: null,
      root_title: null,
      folders: [],
    })
  })

  it('is lenient: unknown statuses, a half-read target, and bad list entries never break the answer', async () => {
    const answer = wireBatch({
      status: 'weird',
      folders: [{ path: 'x' }, { path: '', id: 'root-1' }, 7],
      files: [
        {
          file_key: 'f-0001',
          path: '',
          filename: 'a.pdf',
          size_bytes: 1,
          status: 'maybe',
          document_id: null,
          error: null,
          target: { kind: 'put', url: '' },
        },
        { filename: 'no-key.pdf' },
        {
          file_key: 'f-0002',
          path: '',
          filename: 'b.pdf',
          size_bytes: 'big',
          status: 'failed',
          document_id: null,
          error: { code: 'size_mismatch', message: 'm', reason: 'r' },
          target: null,
        },
      ],
      counts: 'nope',
    })
    const batch = await client(async () => json(201, answer)).createFolderUpload(WS, planBody, {
      idempotencyKey: 'k',
    })
    expect(batch.status).toBe('open')
    expect(batch.folders).toEqual([{ path: '', id: 'root-1' }])
    expect(batch.counts).toEqual({ total: 0, done: 0, failed: 0, pending: 0 })
    expect(batch.files.map((f) => f.file_key)).toEqual(['f-0001', 'f-0002'])
    expect(batch.files[0]).toMatchObject({ status: 'pending', target: null })
    expect(batch.files[1]).toMatchObject({
      status: 'failed',
      size_bytes: 0,
      error: { code: 'size_mismatch', message: 'm', reason: 'r' },
    })
  })

  it('marks the content-route target (auth session) and drops other auth values', async () => {
    const answer = wireBatch({
      files: [
        {
          file_key: 'f-0001',
          path: '',
          filename: 'a.pdf',
          size_bytes: 1,
          status: 'pending',
          document_id: null,
          error: null,
          target: { ...putTarget, url: '/api/v1/workspaces/ws_1/x/content', auth: 'session' },
        },
        {
          file_key: 'f-0002',
          path: '',
          filename: 'b.pdf',
          size_bytes: 1,
          status: 'pending',
          document_id: null,
          error: null,
          target: { ...putTarget, auth: 'basic' },
        },
      ],
    })
    const batch = await client(async () => json(201, answer)).createFolderUpload(WS, planBody, {
      idempotencyKey: 'k',
    })
    expect(batch.files[0]?.target).toMatchObject({ kind: 'put', auth: 'session' })
    expect(batch.files[1]?.target).not.toHaveProperty('auth')
  })

  it.each([
    ['an empty object', {}],
    ['a batch without an id', wireBatch({ id: '' })],
    ['an array', []],
    ['null', null],
    ['a string', 'ok'],
  ])('refuses %s as malformed_response', async (_name, answer) => {
    const error = await failure(
      client(async () => json(201, answer)).createFolderUpload(WS, planBody, {
        idempotencyKey: 'k',
      }),
    )
    expect(error).toBeInstanceOf(UniworkDocError)
    expect((error as UniworkDocError).code).toBe('malformed_response')
  })

  it('keeps the server code, status and fields of a refusal (limits the dialog names)', async () => {
    const error = (await failure(
      client(async () =>
        envelope(422, 'folder_upload_too_many_files', {
          max: 500,
          count: 612,
          note: { nested: 1 },
        }),
      ).createFolderUpload(WS, planBody, { idempotencyKey: 'k' }),
    )) as UniworkDocError
    expect(error.serverCode).toBe('folder_upload_too_many_files')
    expect(error.status).toBe(422)
    // only flat values survive; a nested object is never carried
    expect(error.fields).toEqual({ max: 500, count: 612 })
  })

  it('reads folder_uploads_busy: 429, the Retry-After header and fields.retry_after', async () => {
    const error = (await failure(
      client(async () =>
        envelope(429, 'folder_uploads_busy', { retry_after: 30 }, { 'Retry-After': '30' }),
      ).createFolderUpload(WS, planBody, { idempotencyKey: 'k' }),
    )) as UniworkDocError
    expect(error).toMatchObject({
      status: 429,
      serverCode: 'folder_uploads_busy',
      retryAfterMs: 30_000,
    })
    expect(error.fields).toEqual({ retry_after: 30 })
  })

  it.each([
    [409, 'idempotency_payload_mismatch', 'idempotency_mismatch'],
    [422, 'document_too_deep', 'document_too_deep'],
    [422, 'document_parent_kind', 'document_parent_kind'],
    [403, 'forbidden', 'permission_revoked'],
  ])('maps %i %s to %s', async (status, code, expected) => {
    const error = await failure(
      client(async () => envelope(status, code)).createFolderUpload(WS, planBody, {
        idempotencyKey: 'k',
      }),
    )
    expect((error as UniworkDocError).code).toBe(expected)
    expect((error as UniworkDocError).serverCode).toBe(code)
  })

  it('a network failure is the typed network error', async () => {
    const error = await failure(
      client(async () => {
        throw new TypeError('fetch failed')
      }).createFolderUpload(WS, planBody, { idempotencyKey: 'k' }),
    )
    expect((error as UniworkDocError).code).toBe('network')
  })

  it('refuses ids that would leave the route, without a request', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(201, wireBatch()))
    const api = client(fetch)
    const bad = await failure(api.createFolderUpload('../x', planBody, { idempotencyKey: 'k' }))
    expect((bad as UniworkDocError).code).toBe('not_found')
    expect(((await failure(api.getFolderUpload(WS, 'a/b'))) as UniworkDocError).code).toBe(
      'not_found',
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('folder-upload client: GET / DELETE batch', () => {
  it('GET reads the batch with fresh targets', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, wireBatch()))
    const batch = await client(fetch).getFolderUpload(WS, BATCH)
    expect(fetch.mock.calls[0]?.[0]).toBe(`${BASE}/${BATCH}`)
    expect((fetch.mock.calls[0]?.[1] as RequestInit).method).toBe('GET')
    expect(batch.id).toBe(BATCH)
  })

  it('GET passes the abort signal through', async () => {
    const controller = new AbortController()
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      expect(init.signal).toBeInstanceOf(AbortSignal)
      return json(200, wireBatch())
    })
    await client(fetch).getFolderUpload(WS, BATCH, { signal: controller.signal })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('DELETE reads the canceled batch', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, wireBatch({ status: 'canceled' })))
    const batch = await client(fetch).cancelFolderUpload(WS, BATCH)
    expect(fetch.mock.calls[0]?.[0]).toBe(`${BASE}/${BATCH}`)
    expect((fetch.mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE')
    expect(batch.status).toBe('canceled')
  })

  it.each([
    ['GET', (api: ReturnType<typeof client>) => api.getFolderUpload(WS, BATCH)],
    ['DELETE', (api: ReturnType<typeof client>) => api.cancelFolderUpload(WS, BATCH)],
  ])('%s with a malformed answer is malformed_response', async (_method, call) => {
    const error = await failure(call(client(async () => json(200, { status: 'open' }))))
    expect((error as UniworkDocError).code).toBe('malformed_response')
  })

  it('keeps 410 folder_upload_expired and 409 folder_upload_canceled as statuses with their codes', async () => {
    const expired = (await failure(
      client(async () => envelope(410, 'folder_upload_expired')).getFolderUpload(WS, BATCH),
    )) as UniworkDocError
    expect(expired).toMatchObject({ status: 410, serverCode: 'folder_upload_expired' })
    const canceled = (await failure(
      client(async () => envelope(409, 'folder_upload_canceled')).getFolderUpload(WS, BATCH),
    )) as UniworkDocError
    expect(canceled).toMatchObject({ status: 409, serverCode: 'folder_upload_canceled' })
  })
})

describe('folder-upload client: POST complete', () => {
  const items = [
    { file_key: 'f-0001', etag: '"abc"' },
    { file_key: 'f-0002', parts: [{ part_number: 1, etag: '"p1"' }] },
  ]

  it('posts {files} to …/complete and reads done and failed results', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        results: [
          { file_key: 'f-0001', status: 'done', document_id: 'doc-1', error: null },
          {
            file_key: 'f-0002',
            status: 'failed',
            document_id: null,
            error: { code: 'unsupported_media', message: 'no', reason: 'macro' },
            retryable: false,
          },
        ],
        batch: { status: 'completed', counts: { total: 2, done: 1, failed: 1, pending: 0 } },
      }),
    )
    const answer = await client(fetch).completeFolderUpload(WS, BATCH, items)
    expect(fetch.mock.calls[0]?.[0]).toBe(`${BASE}/${BATCH}/complete`)
    expect((fetch.mock.calls[0]?.[1] as RequestInit).method).toBe('POST')
    expect(JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      files: items,
    })
    expect(answer.results).toEqual([
      { file_key: 'f-0001', status: 'done', document_id: 'doc-1', error: null },
      {
        file_key: 'f-0002',
        status: 'failed',
        document_id: null,
        error: { code: 'unsupported_media', message: 'no', reason: 'macro' },
        retryable: false,
      },
    ])
    expect(answer.batch).toEqual({
      status: 'completed',
      counts: { total: 2, done: 1, failed: 1, pending: 0 },
    })
  })

  it('carries retryable (Q11) and treats a done result without a document as a retryable failure', async () => {
    const answer = await client(async () =>
      json(200, {
        results: [
          {
            file_key: 'f-0001',
            status: 'failed',
            document_id: null,
            error: { code: 'upload_missing', message: '' },
            retryable: true,
          },
          { file_key: 'f-0002', status: 'done', document_id: null, error: null },
          { file_key: 'f-0003', status: 'failed', document_id: null, error: null },
        ],
        batch: { status: 'open', counts: { total: 3, done: 0, failed: 0, pending: 3 } },
      }),
    ).completeFolderUpload(WS, BATCH, items)
    expect(answer.results[0]).toMatchObject({ status: 'failed', retryable: true })
    expect(answer.results[1]).toMatchObject({
      file_key: 'f-0002',
      status: 'failed',
      retryable: true,
      error: { code: 'unknown' },
    })
    // a failure with no flag and no error carries neither
    expect(answer.results[2]).toMatchObject({ status: 'failed', error: { code: 'unknown' } })
    expect(answer.results[2]).not.toHaveProperty('retryable')
  })

  it('reads a malformed answer as no results, so the files stay pending and are asked again', async () => {
    for (const body of [{}, { results: 'x' }, [], null]) {
      const answer = await client(async () => json(200, body)).completeFolderUpload(
        WS,
        BATCH,
        items,
      )
      expect(answer.results).toEqual([])
      expect(answer.batch.status).toBe('open')
    }
  })

  it('keeps the server code of a refused complete (400 over the cap, 409 canceled)', async () => {
    const tooMany = (await failure(
      client(async () => envelope(400, 'invalid_request', { max: 50 })).completeFolderUpload(
        WS,
        BATCH,
        items,
      ),
    )) as UniworkDocError
    expect(tooMany).toMatchObject({ status: 400, serverCode: 'invalid_request' })
    expect(tooMany.fields).toEqual({ max: 50 })
  })
})

describe('folder-upload transport: PUT to storage', () => {
  const blob = new Blob(['hello'])

  function transport(api: FetchLike, storage: FetchLike) {
    return createFolderUploadTransport(options(api), WS, { storageFetch: storage })
  }

  it('a target without auth goes to storage with no credentials at all', async () => {
    const api = vi.fn<FetchLike>(async () => json(200, {}))
    const storage = vi.fn<FetchLike>(
      async () => new Response(null, { status: 200, headers: { ETag: '"s3-etag"' } }),
    )
    const stored = await transport(api, storage).put(putTarget as FileTarget, blob)

    expect(stored).toEqual({ etag: '"s3-etag"' })
    expect(api).not.toHaveBeenCalled()
    const [url, init] = storage.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(putTarget.url)
    expect(init.method).toBe('PUT')
    expect(init.credentials).toBe('omit')
    expect(init.redirect).toBe('error')
    expect(init.body).toBe(blob)
    expect(init.headers).toEqual({ 'Content-Type': 'application/pdf' })
  })

  it('never forwards an Authorization, Host or Cookie header a target carries', async () => {
    const storage = vi.fn<FetchLike>(
      async () => new Response(null, { status: 200, headers: { ETag: '"e"' } }),
    )
    await transport(vi.fn<FetchLike>(), storage).put(
      {
        ...putTarget,
        headers: { authorization: 'Bearer x', Host: 'evil', Cookie: 'a=b', 'Content-Type': 'x/y' },
      } as FileTarget,
      blob,
    )
    expect((storage.mock.calls[0]?.[1] as RequestInit).headers).toEqual({ 'Content-Type': 'x/y' })
  })

  it('a presigned PUT without an ETag is a missing_etag failure', async () => {
    const storage = vi.fn<FetchLike>(async () => new Response(null, { status: 200 }))
    const error = await failure(
      transport(vi.fn<FetchLike>(), storage).put(putTarget as FileTarget, blob),
    )
    expect(error).toBeInstanceOf(FolderUploadError)
    expect(error).toMatchObject({ code: 'missing_etag' })
  })

  it('a storage refusal rejects as an API error with the status (403 reads as an expired URL)', async () => {
    const storage = vi.fn<FetchLike>(async () => new Response('<Error/>', { status: 403 }))
    const error = await failure(
      transport(vi.fn<FetchLike>(), storage).put(putTarget as FileTarget, blob),
    )
    expect(error).toBeInstanceOf(FolderUploadApiError)
    expect(error).toMatchObject({ status: 403, code: 'http_403' })
  })

  it('a storage 503 carries its status so the runner retries it', async () => {
    const storage = vi.fn<FetchLike>(async () => new Response('', { status: 503 }))
    const error = await failure(
      transport(vi.fn<FetchLike>(), storage).put(putTarget as FileTarget, blob),
    )
    expect(error).toMatchObject({ status: 503 })
  })

  it('a network failure rejects as a TypeError (the runner retries those)', async () => {
    const storage = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed')
    })
    const error = await failure(
      transport(vi.fn<FetchLike>(), storage).put(putTarget as FileTarget, blob),
    )
    expect(error).toBeInstanceOf(TypeError)
  })

  it('an abort rejects as an AbortError, not as a network failure', async () => {
    const controller = new AbortController()
    const storage = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new TypeError('aborted')))
        }),
    )
    const pending = failure(
      transport(vi.fn<FetchLike>(), storage).put(putTarget as FileTarget, blob, {
        signal: controller.signal,
      }),
    )
    controller.abort()
    const error = (await pending) as DOMException
    expect(error.name).toBe('AbortError')
  })

  const sessionTarget = {
    ...putTarget,
    url: `/api/v1/workspaces/${WS}/documents/folder-uploads/${BATCH}/files/f-0001/content`,
    headers: { 'Content-Type': 'application/pdf' },
    auth: 'session',
  } as FileTarget

  it('an auth "session" target is the API origin + the bearer, and the ETag header wins over the body', async () => {
    const api = vi.fn<FetchLike>(async () =>
      json(200, { etag: '"body-etag"' }, { ETag: '"header-etag"' }),
    )
    const storage = vi.fn<FetchLike>()
    const stored = await transport(api, storage).put(sessionTarget, blob)

    expect(stored).toEqual({ etag: '"header-etag"' })
    expect(storage).not.toHaveBeenCalled()
    const [url, init] = api.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${ORIGIN}${(sessionTarget as { url: string }).url}`)
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/pdf',
    })
    expect(init.body).toBe(blob)
  })

  it('reads the ETag from the body {etag} when a proxy hides the header', async () => {
    const api = vi.fn<FetchLike>(async () => json(200, { etag: '"body-etag"' }))
    expect(await transport(api, vi.fn<FetchLike>()).put(sessionTarget, blob)).toEqual({
      etag: '"body-etag"',
    })
  })

  it('a content answer with neither header nor body etag is missing_etag', async () => {
    const api = vi.fn<FetchLike>(async () => json(200, {}))
    const error = await failure(transport(api, vi.fn<FetchLike>()).put(sessionTarget, blob))
    expect(error).toMatchObject({ code: 'missing_etag' })
  })

  it('refuses a session target outside the API origin without sending the bearer anywhere', async () => {
    const api = vi.fn<FetchLike>(async () => json(200, {}))
    const storage = vi.fn<FetchLike>()
    for (const url of [
      '//evil.example/api/v1/x',
      '/\\evil.example/api/v1/x',
      'https://evil.example/api/v1/x',
      '/api/v1/../../admin',
      '/etc/passwd',
      '/api/v1/workspaces/a/b?token=1',
      '/api/v1/\tfoo',
    ]) {
      const error = await failure(
        transport(api, storage).put({ ...(sessionTarget as object), url } as FileTarget, blob),
      )
      expect(error, url).toMatchObject({ code: 'untrusted_target' })
    }
    expect(api).not.toHaveBeenCalled()
    expect(storage).not.toHaveBeenCalled()
  })

  it('accepts an absolute URL that is under the API origin', async () => {
    const api = vi.fn<FetchLike>(async () => json(200, {}, { ETag: '"e"' }))
    const stored = await transport(api, vi.fn<FetchLike>()).put(
      {
        ...(sessionTarget as object),
        url: `${ORIGIN}${(sessionTarget as { url: string }).url}`,
      } as FileTarget,
      blob,
    )
    expect(stored).toEqual({ etag: '"e"' })
  })

  it('a content-route refusal keeps its status and code (415 unsupported_media, 409 settled)', async () => {
    const unsupported = await failure(
      transport(async () => envelope(415, 'unsupported_media'), vi.fn<FetchLike>()).put(
        sessionTarget,
        blob,
      ),
    )
    expect(unsupported).toMatchObject({
      name: 'FolderUploadApiError',
      status: 415,
      code: 'unsupported_media',
    })
    const settled = await failure(
      transport(async () => envelope(409, 'folder_upload_file_settled'), vi.fn<FetchLike>()).put(
        sessionTarget,
        blob,
      ),
    )
    expect(settled).toMatchObject({ status: 409, code: 'folder_upload_file_settled' })
  })

  it('a 429 carries Retry-After in seconds', async () => {
    const error = await failure(
      transport(
        async () => envelope(429, 'rate_limited', undefined, { 'Retry-After': '7' }),
        vi.fn<FetchLike>(),
      ).put(sessionTarget, blob),
    )
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 7 })
  })

  const multipart = {
    kind: 'multipart',
    session_id: 's-1',
    part_size: 4,
    parts: [
      {
        part_number: 1,
        method: 'PUT',
        url: 'https://storage.example/p1',
        headers: {},
        expires_at: '',
      },
      {
        part_number: 2,
        method: 'PUT',
        url: 'https://storage.example/p2',
        headers: { 'X-A': '1' },
        expires_at: '',
      },
    ],
    expires_at: '',
  } as FileTarget

  it('a multipart target sends the parts one after another, never with the bearer, and returns their ETags', async () => {
    const seen: Array<{ url: string; size: number }> = []
    const storage = vi.fn<FetchLike>(async (url, init) => {
      seen.push({ url, size: (init.body as Blob).size })
      return new Response(null, { status: 200, headers: { ETag: `"etag-${seen.length}"` } })
    })
    const api = vi.fn<FetchLike>()
    const stored = await transport(api, storage).put(multipart, new Blob(['hello!']))

    expect(seen).toEqual([
      { url: 'https://storage.example/p1', size: 4 },
      { url: 'https://storage.example/p2', size: 2 },
    ])
    expect(stored).toEqual({
      parts: [
        { part_number: 1, etag: '"etag-1"' },
        { part_number: 2, etag: '"etag-2"' },
      ],
    })
    expect(api).not.toHaveBeenCalled()
    for (const [, init] of storage.mock.calls) {
      expect((init as RequestInit).credentials).toBe('omit')
      expect(JSON.stringify((init as RequestInit).headers)).not.toMatch(/authorization/i)
    }
  })

  it('skips parts already stored and records each part as it lands, so a retry resumes', async () => {
    const storedParts = new Map<number, string>([[1, '"old-1"']])
    let calls = 0
    const storage = vi.fn<FetchLike>(async () => {
      calls += 1
      if (calls === 1) return new Response(null, { status: 200, headers: { ETag: '"new-2"' } })
      return new Response(null, { status: 200, headers: { ETag: '"new-3"' } })
    })
    const three = {
      ...(multipart as object),
      parts: [
        ...(multipart as { parts: unknown[] }).parts,
        {
          part_number: 3,
          method: 'PUT',
          url: 'https://storage.example/p3',
          headers: {},
          expires_at: '',
        },
      ],
    } as FileTarget
    const stored = await transport(vi.fn<FetchLike>(), storage).put(
      three,
      new Blob(['0123456789']),
      {
        storedParts,
      },
    )
    expect(storage).toHaveBeenCalledTimes(2)
    expect(stored).toEqual({
      parts: [
        { part_number: 1, etag: '"old-1"' },
        { part_number: 2, etag: '"new-2"' },
        { part_number: 3, etag: '"new-3"' },
      ],
    })
    expect(storedParts.get(3)).toBe('"new-3"')
  })

  it('a missing part URL is a missing_part_url failure; a part without ETag is missing_etag', async () => {
    const short = {
      ...(multipart as object),
      parts: [(multipart as { parts: unknown[] }).parts[0]],
    } as FileTarget
    const noUrl = await failure(
      transport(
        vi.fn<FetchLike>(),
        vi.fn<FetchLike>(async () => new Response(null, { status: 200, headers: { ETag: '"e"' } })),
      ).put(short, new Blob(['hello!'])),
    )
    expect(noUrl).toMatchObject({ code: 'missing_part_url' })
    const noEtag = await failure(
      transport(
        vi.fn<FetchLike>(),
        vi.fn<FetchLike>(async () => new Response(null, { status: 200 })),
      ).put(multipart, new Blob(['hello!'])),
    )
    expect(noEtag).toMatchObject({ code: 'missing_etag' })
  })
})

describe('folder-upload transport: the five routes behind the runner interface', () => {
  it('plan/status/cancel/complete go through the API client; a malformed plan answer rejects', async () => {
    const fetch = vi.fn<FetchLike>(async (url, init) => {
      if (url === BASE && init.method === 'POST') return json(201, wireBatch())
      if (url === `${BASE}/${BATCH}` && init.method === 'GET') return json(200, wireBatch())
      if (url === `${BASE}/${BATCH}` && init.method === 'DELETE')
        return json(200, wireBatch({ status: 'canceled' }))
      if (url === `${BASE}/${BATCH}/complete`) {
        return json(200, { results: [], batch: { status: 'open', counts: {} } })
      }
      return json(404, {})
    })
    const t = createFolderUploadTransport(options(fetch), WS, { storageFetch: vi.fn<FetchLike>() })
    expect((await t.plan(planBody, { idempotencyKey: 'k' })).id).toBe(BATCH)
    expect((await t.status(BATCH)).id).toBe(BATCH)
    expect((await t.cancel(BATCH)).status).toBe('canceled')
    expect((await t.complete(BATCH, [])).results).toEqual([])

    const bad = createFolderUploadTransport(
      options(async () => json(201, {})),
      WS,
      {
        storageFetch: vi.fn<FetchLike>(),
      },
    )
    await expect(bad.plan(planBody, { idempotencyKey: 'k' })).rejects.toThrow(/malformed/i)
  })

  it('maps API failures to the errors the runner reads: 4xx as FolderUploadApiError with fields, network as TypeError', async () => {
    const refused = createFolderUploadTransport(
      options(async () => envelope(422, 'folder_upload_too_many_files', { max: 500, count: 612 })),
      WS,
      { storageFetch: vi.fn<FetchLike>() },
    )
    const error = await failure(refused.plan(planBody, { idempotencyKey: 'k' }))
    expect(error).toBeInstanceOf(FolderUploadApiError)
    expect(error).toMatchObject({
      status: 422,
      code: 'folder_upload_too_many_files',
      fields: { max: 500, count: 612 },
    })

    const busy = createFolderUploadTransport(
      options(async () =>
        envelope(429, 'folder_uploads_busy', { retry_after: 30 }, { 'Retry-After': '30' }),
      ),
      WS,
      { storageFetch: vi.fn<FetchLike>() },
    )
    expect(await failure(busy.plan(planBody, { idempotencyKey: 'k' }))).toMatchObject({
      status: 429,
      code: 'folder_uploads_busy',
      retryAfterSeconds: 30,
      fields: { retry_after: 30 },
    })

    const down = createFolderUploadTransport(
      options(async () => {
        throw new TypeError('fetch failed')
      }),
      WS,
      { storageFetch: vi.fn<FetchLike>() },
    )
    expect(await failure(down.status(BATCH))).toBeInstanceOf(TypeError)

    const gone = createFolderUploadTransport(
      options(async () => envelope(410, 'folder_upload_expired')),
      WS,
      {
        storageFetch: vi.fn<FetchLike>(),
      },
    )
    expect(await failure(gone.status(BATCH))).toMatchObject({
      status: 410,
      code: 'folder_upload_expired',
    })

    const bare = createFolderUploadTransport(
      options(async () => json(502, 'bad gateway')),
      WS,
      {
        storageFetch: vi.fn<FetchLike>(),
      },
    )
    expect(await failure(bare.status(BATCH))).toMatchObject({ status: 502, code: 'http_502' })
  })

  it('a signed-out client rejects without a request, and the runner reads it as a session failure', async () => {
    const fetch = vi.fn<FetchLike>()
    const t = createFolderUploadTransport({ ...options(fetch), isSignedIn: () => false }, WS, {
      storageFetch: vi.fn<FetchLike>(),
    })
    expect(await failure(t.status(BATCH))).toMatchObject({ code: 'session' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
