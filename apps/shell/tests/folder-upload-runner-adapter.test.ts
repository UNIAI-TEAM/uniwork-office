import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { createFolderUploadService } from '../src/main/uniwork-docs/folder-upload/service'
import type {
  FolderUploadRunnerPort,
  FolderUploadRunOptions,
} from '../src/main/uniwork-docs/folder-upload/runner-port'
import {
  createFolderUploadRunnerAdapter,
  type RunnerAdapterDeps,
} from '../src/main/uniwork-docs/folder-upload/runner-adapter'
import {
  createFakeFolderUploadTransport,
  folderUploadApiError,
  type FakeFolderUploadOptions,
} from '../src/main/uniwork-docs/folder-upload/fake-transport'
import type { FolderUploadLimits } from '../src/main/uniwork-docs/folder-upload/types'
import type { FolderUploadRunLimits } from '../src/main/uniwork-docs/limits'
import type { BatchUploadProgress, PreflightSDO } from '../src/shared/folder-upload-api'
import type { UniworkFolderNode } from '../src/shared/home-api'

/**
 * UNI-2052 FU-E: the runner adapter end to end. A real temp directory is
 * picked and planned by the FU-C service, the FU-B runner uploads it over the
 * in-memory fake transport, and the pushed progress events are what the
 * renderer would see.
 */

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'uw-fu-adapter-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const PLANNER_LIMITS: FolderUploadLimits = {
  maxFiles: 100,
  maxFolders: 50,
  maxTotalBytes: 10_000_000,
  maxDepth: 5,
  perFileMaxBytes: 1_000_000,
}

const RUN_LIMITS: FolderUploadRunLimits = {
  ...PLANNER_LIMITS,
  maxFolders: 50,
  parallel: 2,
  completeBatch: 1,
}

const node = (id: string, title: string, systemKind?: 'my_folder'): UniworkFolderNode => ({
  id,
  parentId: null,
  title,
  position: 0,
  children: [],
  ...(systemKind ? { systemKind } : {}),
})

function file(rel: string, bytes = 10): string {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, Buffer.alloc(bytes, 1))
  return abs
}

function sequentialStub() {
  const start = vi.fn<FolderUploadRunnerPort['start']>((_plan, opts) => ({ runId: opts.runId }))
  const port: FolderUploadRunnerPort = {
    start,
    cancel: () => undefined,
    retry: () => undefined,
    dismiss: () => undefined,
  }
  return { port, start }
}

interface SetupOptions {
  transport?: FakeFolderUploadOptions
  runLimits?: FolderUploadRunLimits | null
  adapter?: Partial<RunnerAdapterDeps>
}

function setup(over: SetupOptions = {}) {
  const transport = createFakeFolderUploadTransport(over.transport)
  const invalidated: string[] = []
  const transportFor = vi.fn((_workspaceId: string) => transport)
  const runLimits = over.runLimits === undefined ? RUN_LIMITS : over.runLimits
  const runner = createFolderUploadRunnerAdapter({
    transportFor,
    runLimits: async () => runLimits,
    onInvalidate: (workspaceId) => void invalidated.push(workspaceId),
    ...over.adapter,
  })
  const sequential = sequentialStub()
  let seq = 0
  const service = createFolderUploadService({
    pickDirectory: async () => join(root, 'Docs'),
    pickFiles: async () => [],
    folderTree: async () => [node('my1', 'My Folder', 'my_folder'), node('f1', 'Contracts')],
    ensureMyFolder: async () => ({ id: 'my1', title: 'My Folder' }),
    getFolderUploadLimits: () => (RUN_LIMITS ? PLANNER_LIMITS : null),
    sequentialLimits: async () => PLANNER_LIMITS,
    runner,
    sequential: sequential.port,
    newId: () => `run${++seq}`,
  })
  const events: BatchUploadProgress[] = []
  const sink = (event: BatchUploadProgress): void => void events.push(event)
  return { service, transport, events, sink, invalidated, transportFor, sequential }
}

type Harness = ReturnType<typeof setup>

async function pickFolder(h: Harness, folderId: string | null = null): Promise<PreflightSDO> {
  const preflight = await h.service.pick({ workspaceId: 'w1', folderId, mode: 'folder' })
  if (!preflight) throw new Error('no preflight')
  return preflight
}

function startRun(h: Harness, preflight: PreflightSDO, share = false): string {
  const started = h.service.start(
    { preflightId: preflight.preflightId, shareWithWorkspace: share },
    h.sink,
  )
  if (!started.ok) throw new Error(`start refused: ${started.error}`)
  return started.runId
}

const TERMINAL = new Set(['done', 'canceled', 'failed'])
const terminals = (events: BatchUploadProgress[]) => events.filter((e) => TERMINAL.has(e.phase))

/** waits until `count` terminal events have been pushed */
async function settled(h: Harness, count = 1): Promise<BatchUploadProgress> {
  await vi.waitFor(() => expect(terminals(h.events).length).toBeGreaterThanOrEqual(count), {
    timeout: 5000,
  })
  return terminals(h.events)[count - 1] as BatchUploadProgress
}

const planBody = (h: Harness) => {
  const call = h.transport.calls.find((c) => c.method === 'plan')
  if (call?.method !== 'plan') throw new Error('no plan call')
  return call.body
}

describe('a folder run from pick to done', () => {
  it('uploads every planned file and reports one final done event', async () => {
    const h = setup({ transport: { rootTitle: 'Docs (1)' } })
    file('Docs/a.docx', 11)
    file('Docs/sub/b.pdf', 22)
    file('Docs/sub/c.txt', 33)
    const preflight = await pickFolder(h)
    const runId = startRun(h, preflight)

    const last = await settled(h)

    expect(last).toMatchObject({
      runId,
      phase: 'done',
      done: 3,
      failed: 0,
      total: 3,
      sentBytes: 66,
      totalBytes: 66,
      rootTitle: 'Docs (1)',
      rootFolderId: 'folder-root',
    })
    expect(last.failures).toBeUndefined()
    expect(last.error).toBeUndefined()
    // planning comes from the service, uploading from the runner, one terminal event only
    expect(h.events[0]?.phase).toBe('planning')
    expect(h.events.some((e) => e.phase === 'uploading')).toBe(true)
    expect(terminals(h.events)).toHaveLength(1)
    expect(h.events.every((e) => e.runId === runId)).toBe(true)
    // the uploading counters only grow
    const uploading = h.events.filter((e) => e.phase === 'uploading' || e.phase === 'finishing')
    for (const [i, event] of uploading.entries()) {
      if (i > 0) expect(event.done).toBeGreaterThanOrEqual((uploading[i - 1] as typeof event).done)
    }
  })

  it('plans into the destination folder with the tree the planner found', async () => {
    const h = setup()
    file('Docs/a.docx')
    file('Docs/sub/b.pdf')
    const preflight = await pickFolder(h, 'f1')
    startRun(h, preflight)
    await settled(h)

    const body = planBody(h)
    expect(h.transportFor).toHaveBeenCalledWith('w1')
    expect(body.parent_id).toBe('f1')
    expect(body.root_name).toBe('Docs')
    expect(body.folders).toEqual(['sub'])
    expect(body.files.map((f) => [f.path, f.filename, f.size_bytes])).toEqual([
      ['', 'a.docx', 10],
      ['sub', 'b.pdf', 10],
    ])
  })

  it('the workspace root means My Folder: its id is the parent of the batch', async () => {
    const h = setup()
    file('Docs/a.docx')
    startRun(h, await pickFolder(h, null))
    await settled(h)
    expect(planBody(h).parent_id).toBe('my1')
  })

  it('carries the share switch to the plan, on and off', async () => {
    for (const share of [true, false]) {
      const h = setup()
      file('Docs/a.docx')
      startRun(h, await pickFolder(h), share)
      await settled(h)
      expect(planBody(h).share_with_workspace).toBe(share)
    }
  })

  it('refreshes the lists of the workspace, ending with a final refresh', async () => {
    const h = setup()
    file('Docs/a.docx')
    file('Docs/b.docx')
    startRun(h, await pickFolder(h))
    await settled(h)
    expect(h.invalidated.length).toBeGreaterThanOrEqual(1)
    expect(new Set(h.invalidated)).toEqual(new Set(['w1']))
    // never more than the runner's own throttle: one at the plan, one at the end
    expect(h.invalidated.length).toBeLessThanOrEqual(3)
  })

  it('reads the bytes of each file from its own absolute path', async () => {
    const opened: string[] = []
    const h = setup({
      adapter: {
        openFile: async (path) => {
          opened.push(path)
          return new Blob([Buffer.alloc(10, 1)])
        },
      },
    })
    const a = file('Docs/a.docx')
    const b = file('Docs/sub/b.pdf')
    startRun(h, await pickFolder(h))
    await settled(h)
    expect(opened.sort()).toEqual([a, b].sort())
  })

  it('opens the real file as a blob of its size by default', async () => {
    const h = setup()
    file('Docs/a.docx', 123)
    startRun(h, await pickFolder(h))
    const last = await settled(h)
    expect(last).toMatchObject({ phase: 'done', done: 1, sentBytes: 123 })
  })
})

describe('files mode', () => {
  it('plans loose files without a root into the destination folder', async () => {
    const h = setup()
    const a = file('x/a.docx', 5)
    const b = file('y/b.pdf', 7)
    const [preflight] = await h.service.preflight({
      workspaceId: 'w1',
      folderId: 'f1',
      paths: [a, b],
    })
    expect(preflight?.mode).toBe('files')
    startRun(h, preflight as PreflightSDO, true)

    const last = await settled(h)

    expect(last).toMatchObject({ phase: 'done', done: 2, total: 2, sentBytes: 12 })
    expect(last.rootTitle).toBeUndefined()
    expect(last.rootFolderId).toBeUndefined()
    const body = planBody(h)
    expect(body.root_name).toBeUndefined()
    expect(body.folders).toBeUndefined()
    expect(body.parent_id).toBe('f1')
    expect(body.share_with_workspace).toBe(true)
    expect(body.files.map((f) => f.filename)).toEqual(['a.docx', 'b.pdf'])
  })
})

describe('partial failure, retry and dismiss', () => {
  const failing: FakeFolderUploadOptions = {
    fileErrors: {
      // the server keeps this one pending: a retry may succeed
      'b.docx': { code: 'upload_missing', message: 'bytes missing' },
      // the server's final word on this one
      'c.docx': { code: 'unsupported_media', message: 'not a docx', reason: 'zip_unreadable' },
    },
  }

  async function failedRun() {
    const h = setup({ transport: failing })
    file('Docs/a.docx')
    file('Docs/b.docx')
    file('Docs/c.docx')
    const runId = startRun(h, await pickFolder(h))
    const first = await settled(h)
    return { h, runId, first }
  }

  it('ends done with the failed files named by path, code and retryable flag', async () => {
    const { first } = await failedRun()
    expect(first).toMatchObject({ phase: 'done', done: 1, failed: 2, total: 3 })
    expect(first.failures).toEqual([
      { path: 'Docs/b.docx', code: 'upload_missing', retryable: true },
      { path: 'Docs/c.docx', code: 'unsupported_media', retryable: false },
    ])
    expect(first.error).toBeUndefined()
  })

  it('retries only the retryable file and reports what is left', async () => {
    const { h, runId } = await failedRun()
    h.service.retry(runId)
    const second = await settled(h, 2)

    expect(second).toMatchObject({ phase: 'done', done: 2, failed: 1, total: 3 })
    expect(second.failures).toEqual([
      { path: 'Docs/c.docx', code: 'unsupported_media', retryable: false },
    ])
    // the retry shows as uploading, never as a second finished run
    const afterFirst = h.events.slice(h.events.findIndex((e) => TERMINAL.has(e.phase)) + 1)
    expect(afterFirst.some((e) => e.phase === 'uploading')).toBe(true)
    expect(terminals(h.events)).toHaveLength(2)
  })

  it('a retry that finds nothing left to send settles clean and forgets the run', async () => {
    const h = setup({
      transport: { fileErrors: { 'b.docx': { code: 'upload_missing', message: 'x' } } },
    })
    file('Docs/a.docx')
    file('Docs/b.docx')
    const runId = startRun(h, await pickFolder(h))
    await settled(h)
    h.service.retry(runId)
    const second = await settled(h, 2)
    expect(second).toMatchObject({ phase: 'done', done: 2, failed: 0 })
    expect(second.failures).toBeUndefined()
    // clean: the service forgot the run, so a further retry is a no-op
    const count = h.events.length
    h.service.retry(runId)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(h.events).toHaveLength(count)
  })

  it('dismiss lets the run go: a later retry does nothing', async () => {
    const { h, runId } = await failedRun()
    const count = h.events.length
    h.service.dismiss(runId)
    h.service.retry(runId)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(h.events).toHaveLength(count)
    expect(h.transport.calls.filter((c) => c.method === 'status')).toHaveLength(0)
  })

  it('a file deleted after the pre-flight fails as retryable unreadable', async () => {
    const h = setup()
    file('Docs/a.docx')
    const gone = file('Docs/gone.docx')
    const preflight = await pickFolder(h)
    rmSync(gone)
    startRun(h, preflight)
    const last = await settled(h)
    expect(last).toMatchObject({ phase: 'done', done: 1, failed: 1 })
    expect(last.failures).toEqual([{ path: 'Docs/gone.docx', code: 'unreadable', retryable: true }])
  })
})

describe('cancel', () => {
  it('aborts the run, cancels the batch and ends canceled once', async () => {
    const h = setup({ runLimits: { ...RUN_LIMITS, parallel: 1 } })
    const release = h.transport.holdPuts()
    file('Docs/a.docx')
    file('Docs/b.docx')
    const runId = startRun(h, await pickFolder(h))
    await vi.waitFor(() => expect(h.transport.calls.some((c) => c.method === 'put')).toBe(true))

    h.service.cancel(runId)
    const last = await settled(h)
    release()

    expect(last).toMatchObject({ phase: 'canceled', runId, total: 2 })
    expect(h.transport.calls.some((c) => c.method === 'cancel')).toBe(true)
    expect(terminals(h.events)).toHaveLength(1)
    // the service forgot the run: nothing more to cancel or retry
    h.service.retry(runId)
    expect(terminals(h.events)).toHaveLength(1)
  })

  it('a cancel before the server answered the plan still ends canceled', async () => {
    const h = setup({ transport: { latencyMs: 20 } })
    file('Docs/a.docx')
    const runId = startRun(h, await pickFolder(h))
    h.service.cancel(runId)
    const last = await settled(h)
    expect(last.phase).toBe('canceled')
  })
})

describe('whole-run errors', () => {
  it('a busy server refuses the run with its Retry-After', async () => {
    const h = setup()
    const busy = () => folderUploadApiError(429, 'folder_uploads_busy', { retry_after: 0 }, 0)
    h.transport.failNext('plan', busy())
    h.transport.failNext('plan', busy())
    file('Docs/a.docx')
    startRun(h, await pickFolder(h))

    const last = await settled(h)

    expect(last).toMatchObject({
      phase: 'failed',
      done: 0,
      total: 1,
      error: { code: 'folder_uploads_busy', retryAfterSeconds: 0 },
    })
    expect(last.failures).toBeUndefined()
    // it waited once and asked again before giving up: no queue
    expect(h.transport.calls.filter((c) => c.method === 'plan')).toHaveLength(2)
  })

  it('a busy server that frees up within the wait lets the run through', async () => {
    const h = setup()
    h.transport.failNext(
      'plan',
      folderUploadApiError(429, 'folder_uploads_busy', { retry_after: 0 }),
    )
    file('Docs/a.docx')
    startRun(h, await pickFolder(h))
    expect((await settled(h)).phase).toBe('done')
  })

  it('a refused plan fails the run with the server code', async () => {
    const h = setup()
    h.transport.failNext(
      'plan',
      folderUploadApiError(422, 'folder_upload_too_many_files', { max: 500, count: 600 }),
    )
    file('Docs/a.docx')
    startRun(h, await pickFolder(h))
    const last = await settled(h)
    expect(last).toMatchObject({ phase: 'failed', error: { code: 'folder_upload_too_many_files' } })
    expect(last.error?.retryAfterSeconds).toBeUndefined()
  })

  it('a plan the network lost fails the run as network', async () => {
    const h = setup()
    h.transport.failNext('plan', new TypeError('fetch failed'))
    file('Docs/a.docx')
    startRun(h, await pickFolder(h))
    expect(await settled(h)).toMatchObject({ phase: 'failed', error: { code: 'network' } })
  })

  it('an expired batch ends the run as failed with folder_upload_expired', async () => {
    const h = setup()
    h.transport.failNext('complete', folderUploadApiError(410, 'folder_upload_expired'))
    file('Docs/a.docx')
    startRun(h, await pickFolder(h))
    expect(await settled(h)).toMatchObject({
      phase: 'failed',
      error: { code: 'folder_upload_expired' },
    })
  })

  it('a server that dropped the folder_upload block fails the run before any call', async () => {
    const h = setup({ runLimits: null })
    file('Docs/a.docx')
    startRun(h, await pickFolder(h))
    const last = await settled(h)
    expect(last).toMatchObject({ phase: 'failed', error: { code: 'folder_upload_unavailable' } })
    expect(h.transport.calls).toHaveLength(0)
  })
})

describe('a file the probe refuses is a per-file failure, never a rejected run', () => {
  // above 5 bytes every file needs a probe
  const limits: FolderUploadRunLimits = { ...RUN_LIMITS, chunkedThresholdBytes: 5 }

  it('drops the refused file from the plan and reports it as not retryable', async () => {
    const probed: string[] = []
    const h = setup({
      runLimits: limits,
      adapter: {
        probeOf: async (_path, _size, filename) => {
          probed.push(filename)
          if (filename === 'bad.docx') throw new UniworkDocError('unsupported_format')
          return { head_b64: 'aGVhZA==', central_dir_b64: '', cd_offset: null, cd_size: null }
        },
      },
    })
    file('Docs/ok.docx', 20)
    file('Docs/bad.docx', 20)
    startRun(h, await pickFolder(h))

    const last = await settled(h)

    expect(probed.sort()).toEqual(['bad.docx', 'ok.docx'])
    expect(last).toMatchObject({ phase: 'done', done: 1, failed: 1, total: 2 })
    expect(last.failures).toEqual([
      { path: 'Docs/bad.docx', code: 'unsupported_format', retryable: false },
    ])
    const body = planBody(h)
    expect(body.files.map((f) => f.filename)).toEqual(['ok.docx'])
    expect(body.files[0]?.probe).toMatchObject({ head_b64: 'aGVhZA==' })
  })

  it('an I/O error while probing is a per-file failure too', async () => {
    const h = setup({
      runLimits: limits,
      adapter: {
        probeOf: async () => {
          throw new Error('EIO')
        },
      },
    })
    file('Docs/a.docx', 20)
    startRun(h, await pickFolder(h))
    const last = await settled(h)
    expect(last).toMatchObject({ phase: 'done', done: 0, failed: 1, total: 1 })
    expect(last.failures).toEqual([{ path: 'Docs/a.docx', code: 'unreadable', retryable: false }])
    // nothing was left to plan: the server never heard of this run
    expect(h.transport.calls).toHaveLength(0)
  })

  it('the default probe reads the real file: a docx that is not a zip is refused', async () => {
    const h = setup({ runLimits: limits })
    file('Docs/broken.docx', 20)
    startRun(h, await pickFolder(h))
    const last = await settled(h)
    expect(last).toMatchObject({ phase: 'done', done: 0, failed: 1 })
    expect(last.failures?.[0]).toMatchObject({
      path: 'Docs/broken.docx',
      code: 'unsupported_format',
      retryable: false,
    })
  })

  it('a probe refusal survives a retry of the others', async () => {
    const h = setup({
      runLimits: limits,
      transport: { fileErrors: { 'b.docx': { code: 'upload_missing', message: 'x' } } },
      adapter: {
        probeOf: async (_path, _size, filename) => {
          if (filename === 'bad.docx') throw new UniworkDocError('unsupported_format')
          return { head_b64: 'aA==', central_dir_b64: '', cd_offset: null, cd_size: null }
        },
      },
    })
    file('Docs/b.docx', 20)
    file('Docs/bad.docx', 20)
    const runId = startRun(h, await pickFolder(h))
    const first = await settled(h)
    expect(first.failures?.map((f) => f.path).sort()).toEqual(['Docs/b.docx', 'Docs/bad.docx'])

    h.service.retry(runId)
    const second = await settled(h, 2)
    expect(second).toMatchObject({ done: 1, failed: 1, total: 2 })
    expect(second.failures).toEqual([
      { path: 'Docs/bad.docx', code: 'unsupported_format', retryable: false },
    ])
  })

  it('a cancel while probing never reaches the server', async () => {
    let release = () => undefined as void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const h = setup({
      runLimits: limits,
      adapter: {
        probeOf: async () => {
          await gate
          return { head_b64: 'aA==', central_dir_b64: '', cd_offset: null, cd_size: null }
        },
      },
    })
    file('Docs/a.docx', 20)
    const runId = startRun(h, await pickFolder(h))
    h.service.cancel(runId)
    release()
    const last = await settled(h)
    expect(last.phase).toBe('canceled')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(h.transport.calls).toHaveLength(0)
  })
})

describe('port contract', () => {
  it('start returns the run id and never throws for an unknown run on cancel, retry, dismiss', () => {
    const runner = createFolderUploadRunnerAdapter({
      transportFor: () => createFakeFolderUploadTransport(),
      runLimits: async () => RUN_LIMITS,
    })
    expect(() => {
      runner.cancel('nope')
      runner.retry('nope')
      runner.dismiss('nope')
    }).not.toThrow()
    const opts: FolderUploadRunOptions = {
      runId: 'r1',
      workspaceId: 'w1',
      parentId: 'p1',
      shareWithWorkspace: false,
      filePath: () => join(root, 'missing.docx'),
      onProgress: () => undefined,
    }
    const handle = runner.start(
      {
        rootName: null,
        rootTitle: null,
        folders: [],
        files: [],
        skipped: [],
        totals: { files: 0, bytes: 0 },
        refusal: null,
      },
      opts,
    )
    expect(handle).toEqual({ runId: 'r1' })
  })
})
