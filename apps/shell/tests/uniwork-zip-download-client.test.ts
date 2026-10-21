import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { createZipDownloadClient } from '../src/main/uniwork-docs/zip-download/client'

const ORIGIN = 'https://uniwork.example'
const WS = 'ws_1'
const JOB = 'job_1'
const DOC_A = '01J8X4D0C0N1P2Q3R4S5T6V7WA'
const DOC_B = '01J8X4D0C0N1P2Q3R4S5T6V7WB'
const DOWNLOAD_URL = `/api/v1/workspaces/${WS}/documents/download-jobs/${JOB}/download`

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
const jobBody = (extra: Record<string, unknown> = {}) => ({
  id: JOB,
  status: 'queued',
  created_at: '2026-10-22T00:00:00Z',
  expires_at: null,
  download_url: null,
  file_count: null,
  skipped: [],
  error: null,
  ...extra,
})

function zipBody(chunks: Uint8Array[], onPull?: (index: number) => void) {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      onPull?.(index)
      const next = chunks[index++]
      if (next) controller.enqueue(next)
      else controller.close()
    },
  })
}

function client(fetch: FetchLike, tuning: Parameters<typeof createZipDownloadClient>[1] = {}) {
  return createZipDownloadClient(
    {
      apiOrigin: ORIGIN,
      authorized: (call) => call('tok'),
      isSignedIn: () => true,
      fetch,
    },
    tuning,
  )
}

async function errorOf(promise: Promise<unknown>): Promise<UniworkDocError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof UniworkDocError) return error
    throw error
  }
  throw new Error('resolved')
}

describe('createJob', () => {
  it('POSTs the ids to the workspace download-jobs route with the bearer', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(202, jobBody()))
    const job = await client(fetch).createJob(WS, [DOC_A, DOC_B])
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/workspaces/${WS}/documents/download-jobs`)
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(JSON.parse(String(init.body))).toEqual({ document_ids: [DOC_A, DOC_B] })
    expect(job).toMatchObject({ id: JOB, status: 'queued', downloadUrl: null, skipped: [] })
  })

  it('refuses malformed, duplicate or too many ids before any request', async () => {
    const fetch = vi.fn<FetchLike>()
    const c = client(fetch)
    await expect(c.createJob(WS, [DOC_A, 'not-a-ulid'])).rejects.toBeInstanceOf(UniworkDocError)
    await expect(c.createJob(WS, [DOC_A, DOC_A])).rejects.toBeInstanceOf(UniworkDocError)
    await expect(c.createJob(WS, [])).rejects.toBeInstanceOf(UniworkDocError)
    const many = Array.from(
      { length: 101 },
      (_, i) => `01J8X4D0C0N1P2Q3R4S5T6${String(i).padStart(4, '0')}`,
    )
    await expect(c.createJob(WS, many)).rejects.toBeInstanceOf(UniworkDocError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads 422 download_too_large, 429 download_jobs_busy and 501 apart', async () => {
    const tooLarge = await errorOf(
      client(async () => envelope(422, 'download_too_large', { max_bytes: 1073741824 })).createJob(
        WS,
        [DOC_A, DOC_B],
      ),
    )
    expect(tooLarge.zip).toBe('zip_too_large')
    const busy = await errorOf(
      client(async () =>
        envelope(429, 'download_jobs_busy', { retry_after: 30 }, { 'Retry-After': '30' }),
      ).createJob(WS, [DOC_A, DOC_B]),
    )
    expect(busy.zip).toBe('zip_busy')
    expect(busy.retryAfterMs).toBe(30_000)
    const missing = await errorOf(
      client(async () => envelope(501, 'storage_unavailable')).createJob(WS, [DOC_A, DOC_B]),
    )
    expect(missing.status).toBe(501)
    const old = await errorOf(client(async () => json(404, {})).createJob(WS, [DOC_A, DOC_B]))
    expect(old.status).toBe(404)
  })

  it('a create answer with no usable job id is malformed_response', async () => {
    const error = await errorOf(
      client(async () => json(202, { status: 'queued' })).createJob(WS, [DOC_A, DOC_B]),
    )
    expect(error.code).toBe('malformed_response')
  })
})

describe('getJob', () => {
  it('reads queued, running and ready with its skipped list', async () => {
    const answers = [
      jobBody({ status: 'queued' }),
      jobBody({ status: 'running' }),
      jobBody({
        status: 'ready',
        download_url: DOWNLOAD_URL,
        file_count: 1,
        expires_at: '2026-10-22T01:00:00Z',
        skipped: [
          { document_id: DOC_B, reason: 'not_a_file' },
          { document_id: 'bad id', reason: 'not_found' },
          { document_id: DOC_A, reason: 'something_new' },
        ],
      }),
    ]
    const fetch = vi.fn<FetchLike>(async () => json(200, answers.shift()))
    const c = client(fetch)
    expect((await c.getJob(WS, JOB)).status).toBe('queued')
    expect((await c.getJob(WS, JOB)).status).toBe('running')
    const ready = await c.getJob(WS, JOB)
    expect(fetch.mock.calls[0]![0]).toBe(
      `${ORIGIN}/api/v1/workspaces/${WS}/documents/download-jobs/${JOB}`,
    )
    expect(fetch.mock.calls[0]![1].method).toBe('GET')
    expect(ready).toMatchObject({ status: 'ready', downloadUrl: DOWNLOAD_URL, fileCount: 1 })
    expect(ready.skipped).toEqual([
      { documentId: DOC_B, reason: 'not_a_file' },
      { documentId: DOC_A, reason: 'not_found' },
    ])
  })

  it('reads an unknown status as still running and keeps failed with its error', async () => {
    expect(
      (await client(async () => json(200, jobBody({ status: 'paused' }))).getJob(WS, JOB)).status,
    ).toBe('running')
    const failed = await client(async () =>
      json(200, jobBody({ status: 'failed', error: 'nothing_to_download' })),
    ).getJob(WS, JOB)
    expect(failed).toMatchObject({ status: 'failed', error: 'nothing_to_download' })
  })

  it("a job that is not the creator's is a bare 404", async () => {
    const error = await errorOf(client(async () => json(404, {})).getJob(WS, JOB))
    expect(error.status).toBe(404)
  })
})

describe('fetchZip', () => {
  const target = { workspaceId: WS, jobId: JOB, downloadUrl: DOWNLOAD_URL }

  it('streams every chunk to the sink as it arrives, with progress, never joining them', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])]
    const fetch = vi.fn<FetchLike>(
      async () =>
        new Response(zipBody(chunks), { status: 200, headers: { 'Content-Length': '6' } }),
    )
    const written: number[][] = []
    const progress: Array<{ receivedBytes: number; totalBytes: number | null }> = []
    const result = await client(fetch).fetchZip(
      target,
      async (chunk) => void written.push([...chunk]),
      { onProgress: (p) => progress.push(p) },
    )
    expect(fetch.mock.calls[0]![0]).toBe(`${ORIGIN}${DOWNLOAD_URL}`)
    expect((fetch.mock.calls[0]![1].headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    )
    expect(written).toEqual([[1, 2, 3], [4, 5], [6]])
    expect(progress.at(-1)).toEqual({ receivedBytes: 6, totalBytes: 6 })
    expect(result).toEqual({ bytes: 6 })
  })

  it('waits for the sink before it pulls the next chunk (backpressure)', async () => {
    const order: string[] = []
    const fetch = vi.fn<FetchLike>(
      async () =>
        new Response(
          zipBody([new Uint8Array([1]), new Uint8Array([2])], (i) => order.push(`pull${i}`)),
          { status: 200 },
        ),
    )
    await client(fetch).fetchZip(target, async (chunk) => {
      order.push(`write${chunk[0]}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push(`done${chunk[0]}`)
    })
    expect(order.indexOf('done1')).toBeLessThan(order.indexOf('write2'))
  })

  it('follows only the download route of this very job', async () => {
    const fetch = vi.fn<FetchLike>()
    const c = client(fetch)
    for (const downloadUrl of [
      `https://evil.example${DOWNLOAD_URL}`,
      `/api/v1/workspaces/ws_2/documents/download-jobs/${JOB}/download`,
      `/api/v1/workspaces/${WS}/documents/download-jobs/other/download`,
      `/api/v1/workspaces/${WS}/documents/download-jobs/${JOB}/download?x=1`,
      `${DOWNLOAD_URL}/../../x`,
      '',
    ]) {
      const error = await errorOf(c.fetchZip({ ...target, downloadUrl }, async () => undefined))
      expect(error.code).toBe('malformed_response')
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a declared length over the cap before the first write', async () => {
    const write = vi.fn(async () => undefined)
    const fetch = vi.fn<FetchLike>(
      async () =>
        new Response(zipBody([new Uint8Array(4)]), {
          status: 200,
          headers: { 'Content-Length': '999' },
        }),
    )
    const error = await errorOf(client(fetch).fetchZip(target, write, { maxBytes: 100 }))
    expect(error.code).toBe('too_large')
    expect(write).not.toHaveBeenCalled()
  })

  it('stops reading and throws too_large when the stream passes the cap', async () => {
    let pulls = 0
    const fetch = vi.fn<FetchLike>(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls++
              controller.enqueue(new Uint8Array(40))
            },
          }),
          { status: 200 },
        ),
    )
    const error = await errorOf(
      client(fetch).fetchZip(target, async () => undefined, { maxBytes: 100 }),
    )
    expect(error.code).toBe('too_large')
    expect(pulls).toBeLessThan(10)
  })

  it('a caller abort ends the read and rejects', async () => {
    const controller = new AbortController()
    const fetch = vi.fn<FetchLike>(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              c.enqueue(new Uint8Array(8))
            },
          }),
          { status: 200 },
        ),
    )
    let writes = 0
    const run = client(fetch).fetchZip(
      target,
      async () => {
        writes++
        if (writes === 2) controller.abort()
      },
      { signal: controller.signal },
    )
    await expect(run).rejects.toBeInstanceOf(UniworkDocError)
    expect(writes).toBeLessThan(5)
  })

  it("rethrows the sink's own error, not a generic one", async () => {
    const boom = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    const fetch = vi.fn<FetchLike>(
      async () => new Response(zipBody([new Uint8Array([1])]), { status: 200 }),
    )
    await expect(
      client(fetch).fetchZip(target, async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
  })

  it('reads 410 document_download_expired as the zip_expired verdict, 404 as a bare error', async () => {
    const expired = await errorOf(
      client(async () => envelope(410, 'document_download_expired')).fetchZip(
        target,
        async () => undefined,
      ),
    )
    expect(expired.zip).toBe('zip_expired')
    expect(expired.code).not.toBe('deleted')
    const gone = await errorOf(
      client(async () => json(404, {})).fetchZip(target, async () => undefined),
    )
    expect(gone.status).toBe(404)
  })

  it('a 200 with no body is malformed_response', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(null, { status: 200 }))
    const error = await errorOf(client(fetch).fetchZip(target, async () => undefined))
    expect(error.code).toBe('malformed_response')
  })
})
