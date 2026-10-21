import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZipDownloadProgress } from '../src/shared/zip-download-api'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import type { ZipDownloadClient } from '../src/main/uniwork-docs/zip-download/client'
import {
  runZipDownload,
  ZipRunError,
  type ZipProgressPatch,
  type ZipSink,
} from '../src/main/uniwork-docs/zip-download/runner'
import type { ZipJob } from '../src/main/uniwork-docs/zip-download/wire'

const WS = 'ws_1'
const A = '01J8X4D0C0N1P2Q3R4S5T6V7WA'
const B = '01J8X4D0C0N1P2Q3R4S5T6V7WB'
const URL_OF = `/api/v1/workspaces/${WS}/documents/download-jobs/job_1/download`

const job = (extra: Partial<ZipJob> = {}): ZipJob => ({
  id: 'job_1',
  status: 'queued',
  downloadUrl: null,
  fileCount: null,
  skipped: [],
  error: null,
  ...extra,
})
const ready = (extra: Partial<ZipJob> = {}) =>
  job({ status: 'ready', downloadUrl: URL_OF, fileCount: 2, ...extra })

function fakeSink() {
  const calls: string[] = []
  const sink: ZipSink = {
    write: vi.fn(async (chunk: Uint8Array) => void calls.push(`write${chunk.byteLength}`)),
    commit: vi.fn(async () => {
      calls.push('commit')
      return '/saved/documents.zip'
    }),
    abort: vi.fn(async () => void calls.push('abort')),
  }
  return { sink, calls }
}

interface Script {
  create?: () => Promise<ZipJob>
  polls?: Array<ZipJob | Error>
  fetch?: ZipDownloadClient['fetchZip']
}

function fakeClient(script: Script) {
  const polls = [...(script.polls ?? [])]
  const getJob = vi.fn(async () => {
    const next = polls.shift() ?? job({ status: 'running' })
    if (next instanceof Error) throw next
    return next
  })
  const client: ZipDownloadClient = {
    createJob: vi.fn(script.create ?? (async () => job())),
    getJob,
    fetchZip:
      script.fetch ??
      vi.fn(async (_target, write, options) => {
        await write(new Uint8Array(10))
        options?.onProgress?.({ receivedBytes: 10, totalBytes: 10 })
        return { bytes: 10 }
      }),
  }
  return { client, getJob }
}

function harness(script: Script, signal = new AbortController().signal) {
  const { client, getJob } = fakeClient(script)
  const sinkBox = fakeSink()
  const events: ZipProgressPatch[] = []
  const openSink = vi.fn(async () => sinkBox.sink)
  const done = runZipDownload(
    { workspaceId: WS, documentIds: [A, B] },
    { client, openSink, now: () => Date.now(), progressEveryMs: 0 },
    signal,
    (event) => events.push(event),
  )
  return { done, events, client, getJob, openSink, ...sinkBox }
}

const settle = async (run: Promise<unknown>) => {
  await vi.advanceTimersByTimeAsync(0)
  return run
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('runZipDownload', () => {
  it('opens the sink, creates the job, polls every 2 s, fetches, commits', async () => {
    const h = harness({ polls: [job({ status: 'queued' }), job({ status: 'running' }), ready()] })
    // the create answer is `queued`: nothing is polled before the first 2 s
    await vi.advanceTimersByTimeAsync(1_999)
    expect(h.getJob).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.getJob).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(h.getJob).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2_000)
    const final = await h.done
    expect(final).toMatchObject({
      phase: 'done',
      path: '/saved/documents.zip',
      fileCount: 2,
      bytes: 10,
      error: null,
    })
    expect(h.calls).toEqual(['write10', 'commit'])
    expect(h.events.map((e) => e.phase)).toEqual(
      expect.arrayContaining(['saving', 'building', 'downloading', 'done']),
    )
    expect(h.events[0]!.phase).toBe('saving')
    expect(h.events.at(-1)).toBe(final)
    expect(h.openSink).toHaveBeenCalledTimes(1)
  })

  it('does not poll when the create answer is already ready', async () => {
    const h = harness({ create: async () => ready() })
    const final = await settle(h.done)
    expect(final.phase).toBe('done')
    expect(h.getJob).not.toHaveBeenCalled()
  })

  it('gives up with zip_timeout after 90 polls and removes the temp file', async () => {
    const h = harness({})
    for (let i = 0; i < 89; i++) await vi.advanceTimersByTimeAsync(2_000)
    expect(h.getJob).toHaveBeenCalledTimes(89)
    await vi.advanceTimersByTimeAsync(2_000)
    const final = await h.done
    expect(h.getJob).toHaveBeenCalledTimes(90)
    expect(final).toMatchObject({ phase: 'failed', error: { code: 'zip_timeout' } })
    expect(h.calls).toEqual(['abort'])
    expect(h.client.fetchZip).not.toHaveBeenCalled()
  })

  it('passes the skipped list of the job through to the progress', async () => {
    const skipped = [{ documentId: B, reason: 'not_a_file' as const }]
    const h = harness({ create: async () => ready({ fileCount: 1, skipped }) })
    const final = await settle(h.done)
    expect(final.skipped).toEqual(skipped)
    expect(final.fileCount).toBe(1)
    expect(h.events.some((e) => e.phase === 'downloading' && e.skipped.length === 1)).toBe(true)
  })

  it.each([
    ['failed with nothing_to_download', job({ status: 'failed', error: 'nothing_to_download' })],
    ['failed with build_failed', job({ status: 'failed', error: 'build_failed' })],
    ['ready without a download link', job({ status: 'ready' })],
    [
      "ready with a link that is not this job's route",
      ready({ downloadUrl: 'https://evil.example/x' }),
    ],
  ])('maps %s to zip_failed and removes the temp file', async (_name, answer) => {
    const fetchZip = vi.fn()
    const h = harness({ create: async () => answer, fetch: fetchZip })
    const final = await settle(h.done)
    expect(final).toMatchObject({ phase: 'failed', error: { code: 'zip_failed' } })
    expect(h.calls).toEqual(['abort'])
    expect(fetchZip).not.toHaveBeenCalled()
  })

  it('maps an expired job to zip_expired', async () => {
    const h = harness({ polls: [job({ status: 'expired' })] })
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await h.done).error).toEqual({ code: 'zip_expired' })
  })

  it('a failed poll ends the run with the mapped code', async () => {
    const h = harness({ polls: [new UniworkDocError('network')] })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await h.done).toMatchObject({ phase: 'failed', error: { code: 'network' } })
  })

  it.each([
    [404, 'zip_unavailable'],
    [501, 'zip_unavailable'],
  ])('maps HTTP %s on create to %s (an older server)', async (status, code) => {
    const h = harness({
      create: async () => {
        throw new UniworkDocError('server_error', { status })
      },
    })
    expect(await settle(h.done)).toMatchObject({ phase: 'failed', error: { code } })
    expect(h.calls).toEqual(['abort'])
  })

  it('maps 422 / 429 on create and carries retryAfterSeconds for busy, no auto-wait', async () => {
    const tooLarge = harness({
      create: async () => {
        throw new UniworkDocError('server_error', { zip: 'zip_too_large', status: 422 })
      },
    })
    expect((await settle(tooLarge.done)).error).toEqual({ code: 'zip_too_large' })
    const busy = harness({
      create: async () => {
        throw new UniworkDocError('server_error', {
          zip: 'zip_busy',
          status: 429,
          retryAfterMs: 30_000,
        })
      },
    })
    expect(await settle(busy.done)).toMatchObject({
      phase: 'failed',
      error: { code: 'zip_busy', retryAfterSeconds: 30 },
    })
    expect(busy.client.createJob).toHaveBeenCalledTimes(1)
  })

  it('maps 410 on the fetch to zip_expired and removes the temp file', async () => {
    const h = harness({
      create: async () => ready(),
      fetch: async () => {
        throw new UniworkDocError('server_error', { zip: 'zip_expired', status: 410 })
      },
    })
    expect(await settle(h.done)).toMatchObject({ phase: 'failed', error: { code: 'zip_expired' } })
    expect(h.calls).toEqual(['abort'])
  })

  it('maps the stream cap to too_large and a sink failure to its own code', async () => {
    const big = harness({
      create: async () => ready(),
      fetch: async () => {
        throw new UniworkDocError('too_large')
      },
    })
    expect((await settle(big.done)).error).toEqual({ code: 'too_large' })
    const disk = harness({
      create: async () => ready(),
      fetch: async () => {
        throw new ZipRunError('write_failed')
      },
    })
    expect((await settle(disk.done)).error).toEqual({ code: 'write_failed' })
    expect(disk.calls).toEqual(['abort'])
  })

  it('a sink that cannot open fails the run before any job is created', async () => {
    const { client } = fakeClient({})
    const events: ZipProgressPatch[] = []
    const final = await runZipDownload(
      { workspaceId: WS, documentIds: [A, B] },
      {
        client,
        openSink: async () => {
          throw new ZipRunError('forbidden_target')
        },
      },
      new AbortController().signal,
      (event) => events.push(event),
    )
    expect(final).toMatchObject({ phase: 'failed', error: { code: 'forbidden_target' } })
    expect(client.createJob).not.toHaveBeenCalled()
  })

  it('a commit failure removes the temp file and reports it', async () => {
    const h = harness({ create: async () => ready() })
    ;(h.sink.commit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ZipRunError('forbidden_target'),
    )
    expect(await settle(h.done)).toMatchObject({
      phase: 'failed',
      error: { code: 'forbidden_target' },
    })
    expect(h.calls).toContain('abort')
  })

  it('an abort before the sink opens creates no temp file and no job', async () => {
    const controller = new AbortController()
    controller.abort()
    const h = harness({}, controller.signal)
    expect(await h.done).toMatchObject({ phase: 'canceled' })
    expect(h.openSink).not.toHaveBeenCalled()
    expect(h.client.createJob).not.toHaveBeenCalled()
  })

  it('cancel while polling ends as canceled, removes the temp file, makes no more calls', async () => {
    const controller = new AbortController()
    const h = harness({}, controller.signal)
    await vi.advanceTimersByTimeAsync(2_000)
    controller.abort()
    const final = await h.done
    expect(final).toMatchObject({ phase: 'canceled', error: null, path: null })
    expect(h.calls).toEqual(['abort'])
    const polled = h.getJob.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.getJob.mock.calls.length).toBe(polled)
  })

  it('cancel while streaming ends as canceled and aborts the sink', async () => {
    const controller = new AbortController()
    const h = harness(
      {
        create: async () => ready(),
        fetch: async (_target, write) => {
          await write(new Uint8Array(4))
          controller.abort()
          throw new UniworkDocError('network')
        },
      },
      controller.signal,
    )
    expect(await settle(h.done)).toMatchObject({ phase: 'canceled' })
    expect(h.calls).toEqual(['write4', 'abort'])
  })

  it('an abort for sign-out ends as failed with signed_out, not as a user cancel', async () => {
    const controller = new AbortController()
    const h = harness({}, controller.signal)
    await vi.advanceTimersByTimeAsync(2_000)
    controller.abort('signed_out')
    expect(await h.done).toMatchObject({ phase: 'failed', error: { code: 'signed_out' } })
    expect(h.calls).toEqual(['abort'])
  })

  it('reports download progress with the declared total, and throttles the events', async () => {
    const times = [0, 10, 20, 400, 410]
    let tick = 0
    const events: ZipProgressPatch[] = []
    const { client } = fakeClient({
      create: async () => ready(),
      fetch: async (_t, write, options) => {
        for (let i = 1; i <= 4; i++) {
          await write(new Uint8Array(100))
          options?.onProgress?.({ receivedBytes: i * 100, totalBytes: 400 })
        }
        return { bytes: 400 }
      },
    })
    const { sink } = fakeSink()
    await runZipDownload(
      { workspaceId: WS, documentIds: [A, B] },
      {
        client,
        openSink: async () => sink,
        now: () => times[Math.min(tick++, times.length - 1)]!,
        progressEveryMs: 250,
      },
      new AbortController().signal,
      (event) => events.push(event),
    )
    const byteEvents = events.filter((e) => e.phase === 'downloading' && e.bytes > 0)
    expect(byteEvents.length).toBeLessThan(4)
    expect(byteEvents.every((e) => e.totalBytes === 400)).toBe(true)
    expect(events.at(-1)).toMatchObject({ phase: 'done', bytes: 400, totalBytes: 400 })
  })
})

// keeps the pinned shape honest: a patch plus a run id is a full progress event
const _shape: ZipDownloadProgress = { runId: 'r', ...({} as ZipProgressPatch) }
void _shape
