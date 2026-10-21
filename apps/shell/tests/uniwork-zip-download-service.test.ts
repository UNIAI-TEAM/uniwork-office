import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZipDownloadProgress } from '../src/shared/zip-download-api'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import type { ZipDownloadClient } from '../src/main/uniwork-docs/zip-download/client'
import { createZipDownloadService } from '../src/main/uniwork-docs/zip-download/service'
import type { ZipJob } from '../src/main/uniwork-docs/zip-download/wire'

const WS = 'ws_1'
const A = '01J8X4D0C0N1P2Q3R4S5T6V7WA'
const B = '01J8X4D0C0N1P2Q3R4S5T6V7WB'
const URL_OF = `/api/v1/workspaces/${WS}/documents/download-jobs/job_1/download`
const READY: ZipJob = {
  id: 'job_1',
  status: 'ready',
  downloadUrl: URL_OF,
  fileCount: 2,
  skipped: [],
  error: null,
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-zip-service-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const files = () => readdirSync(dir).sort()
const tmpFiles = () => files().filter((name) => name.startsWith('.uw-dl-') && name.endsWith('.tmp'))
const settleTick = () => new Promise((resolve) => setTimeout(resolve, 20))

interface Harness {
  push: ReturnType<typeof vi.fn<(event: ZipDownloadProgress) => void>>
  events: ZipDownloadProgress[]
  pick: ReturnType<typeof vi.fn<(name: string) => Promise<string | null>>>
  client: ZipDownloadClient
  createJob: ReturnType<typeof vi.fn>
  forbidden: { value: boolean }
  service: ReturnType<typeof createZipDownloadService>
}

function harness(
  options: {
    target?: string | null
    fetch?: ZipDownloadClient['fetchZip']
    signedIn?: boolean
    now?: () => Date
  } = {},
): Harness {
  const events: ZipDownloadProgress[] = []
  const push = vi.fn((event: ZipDownloadProgress) => void events.push(event))
  const target = options.target === undefined ? join(dir, 'documents.zip') : options.target
  const pick = vi.fn(async (_name: string) => target)
  const createJob = vi.fn(async () => READY)
  const client: ZipDownloadClient = {
    createJob,
    getJob: vi.fn(async () => READY),
    fetchZip:
      options.fetch ??
      (async (_target, write) => {
        await write(new Uint8Array([1, 2, 3]))
        await write(new Uint8Array([4, 5]))
        return { bytes: 5 }
      }),
  }
  const forbidden = { value: false }
  const service = createZipDownloadService({
    pickPath: pick,
    isForbiddenTarget: async () => forbidden.value,
    client: () => (options.signedIn === false ? null : client),
    newRunId: () => 'run_1',
    ...(options.now ? { now: options.now } : {}),
    runner: { sleep: async () => undefined },
  })
  return { push, events, pick, client, createJob, forbidden, service }
}

const input = { workspaceId: WS, documentIds: [A, B] }
const last = (h: Harness) => h.events.at(-1)!

describe('start', () => {
  it('opens the save dialog first; a canceled dialog creates no job and no file', async () => {
    const h = harness({ target: null })
    const result = await h.service.start(input, h.push)
    expect(result).toEqual({ ok: false, code: 'dialog_canceled' })
    await settleTick()
    expect(h.createJob).not.toHaveBeenCalled()
    expect(h.push).not.toHaveBeenCalled()
    expect(files()).toEqual([])
  })

  it('asks for the suggested name, or documents-<local datetime>.zip', async () => {
    const stamp = new Date(2026, 9, 22, 4, 5, 9)
    const a = harness({ target: null, now: () => stamp })
    await a.service.start(input, a.push)
    expect(a.pick).toHaveBeenCalledWith('documents-20261022T0405.zip')
    const b = harness({ target: null })
    await b.service.start({ ...input, suggestedName: 'Contracts' }, b.push)
    expect(b.pick).toHaveBeenCalledWith('Contracts.zip')
    const c = harness({ target: null })
    await c.service.start({ ...input, suggestedName: '../../etc/passwd' }, c.push)
    expect(c.pick).toHaveBeenCalledWith('passwd.zip')
  })

  it('refuses a signed-out start before the dialog opens', async () => {
    const h = harness({ signedIn: false })
    expect(await h.service.start(input, h.push)).toEqual({ ok: false, code: 'signed_out' })
    expect(h.pick).not.toHaveBeenCalled()
  })

  it('refuses a forbidden target (the working-copy root, a link) with no job', async () => {
    const h = harness()
    h.forbidden.value = true
    expect(await h.service.start(input, h.push)).toEqual({ ok: false, code: 'forbidden_target' })
    expect(h.createJob).not.toHaveBeenCalled()
    expect(files()).toEqual([])
  })

  it('refuses input outside 2..100 distinct document ids before the dialog opens', async () => {
    const h = harness()
    for (const bad of [
      null,
      { workspaceId: WS, documentIds: [A] },
      { workspaceId: WS, documentIds: [A, A] },
      { workspaceId: WS, documentIds: [A, 'nope'] },
      { workspaceId: '', documentIds: [A, B] },
      { workspaceId: WS, documentIds: 'x' },
    ]) {
      const result = await h.service.start(bad, h.push)
      expect(result.ok).toBe(false)
    }
    expect(h.pick).not.toHaveBeenCalled()
  })
})

describe('a run', () => {
  it('streams into a .uw-dl-*.tmp next to the target, renames on success, pushes tagged events', async () => {
    let seenDuringDownload: string[] = []
    const h = harness({
      fetch: async (_t, write) => {
        await write(new Uint8Array([1, 2, 3]))
        seenDuringDownload = files()
        await write(new Uint8Array([4, 5]))
        return { bytes: 5 }
      },
    })
    const result = await h.service.start(input, h.push)
    expect(result).toEqual({ ok: true, runId: 'run_1' })
    await settleTick()
    expect(seenDuringDownload).toHaveLength(1)
    expect(seenDuringDownload[0]).toMatch(/^\.uw-dl-[0-9a-f]+\.tmp$/)
    expect(files()).toEqual(['documents.zip'])
    expect([...readFileSync(join(dir, 'documents.zip'))]).toEqual([1, 2, 3, 4, 5])
    expect(h.events.every((e) => e.runId === 'run_1')).toBe(true)
    expect(last(h)).toMatchObject({ phase: 'done', path: join(dir, 'documents.zip'), error: null })
  })

  it('adds .zip when the chosen name has no extension', async () => {
    const h = harness({ target: join(dir, 'mine') })
    await h.service.start(input, h.push)
    await settleTick()
    expect(files()).toEqual(['mine.zip'])
  })

  it('on a server failure removes the temp file and leaves an existing target untouched', async () => {
    writeFileSync(join(dir, 'documents.zip'), 'old')
    const h = harness({
      fetch: async (_t, write) => {
        await write(new Uint8Array([9, 9]))
        throw new UniworkDocError('server_error', { zip: 'zip_expired', status: 410 })
      },
    })
    await h.service.start(input, h.push)
    await settleTick()
    expect(last(h)).toMatchObject({ phase: 'failed', error: { code: 'zip_expired' } })
    expect(files()).toEqual(['documents.zip'])
    expect(readFileSync(join(dir, 'documents.zip'), 'utf8')).toBe('old')
  })

  it('cancel stops a running download, removes the temp file and ends as canceled', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const h = harness({
      fetch: async (_t, write, options) => {
        await write(new Uint8Array([1]))
        await gate
        if (options?.signal?.aborted) throw new UniworkDocError('network')
        return { bytes: 1 }
      },
    })
    await h.service.start(input, h.push)
    await settleTick()
    expect(tmpFiles()).toHaveLength(1)
    h.service.cancel('run_1')
    release()
    await settleTick()
    expect(last(h)).toMatchObject({ phase: 'canceled' })
    expect(files()).toEqual([])
  })

  it('cancel of an unknown run is a no-op', () => {
    const h = harness()
    expect(() => h.service.cancel('nope')).not.toThrow()
    expect(() => h.service.cancel(undefined)).not.toThrow()
  })

  it('sign-out aborts the run, tells the renderer signed_out and removes the temp file', async () => {
    const h = harness({
      fetch: async (_t, write, options) => {
        await write(new Uint8Array([1]))
        await new Promise((resolve) => options?.signal?.addEventListener('abort', resolve))
        throw new UniworkDocError('network')
      },
    })
    await h.service.start(input, h.push)
    await settleTick()
    h.service.abortAll('signed_out')
    await settleTick()
    expect(last(h)).toMatchObject({ phase: 'failed', error: { code: 'signed_out' } })
    expect(files()).toEqual([])
  })

  it('dispose (quit) removes the temp file synchronously and aborts the run', async () => {
    let aborted = false
    const h = harness({
      fetch: async (_t, write, options) => {
        await write(new Uint8Array([1]))
        await new Promise((resolve) => options?.signal?.addEventListener('abort', resolve))
        aborted = true
        throw new UniworkDocError('network')
      },
    })
    await h.service.start(input, h.push)
    await settleTick()
    expect(tmpFiles()).toHaveLength(1)
    h.service.dispose()
    expect(tmpFiles()).toHaveLength(0)
    await settleTick()
    expect(aborted).toBe(true)
    expect(files()).toEqual([])
  })

  it('a target that turns forbidden before the rename fails the run and leaves nothing', async () => {
    const h = harness({
      fetch: async (_t, write) => {
        await write(new Uint8Array([1]))
        h.forbidden.value = true
        return { bytes: 1 }
      },
    })
    await h.service.start(input, h.push)
    await settleTick()
    expect(last(h)).toMatchObject({ phase: 'failed', error: { code: 'forbidden_target' } })
    expect(files()).toEqual([])
  })

  it('an unwritable folder fails with write_failed before any job is created', async () => {
    const h = harness({ target: join(dir, 'missing-folder', 'documents.zip') })
    await h.service.start(input, h.push)
    await settleTick()
    expect(last(h)).toMatchObject({ phase: 'failed', error: { code: 'write_failed' } })
    expect(h.createJob).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'missing-folder'))).toBe(false)
  })

  it('forgets a settled run: its id can no longer be canceled', async () => {
    const h = harness()
    await h.service.start(input, h.push)
    await settleTick()
    expect(h.service.activeRuns()).toBe(0)
  })
})
