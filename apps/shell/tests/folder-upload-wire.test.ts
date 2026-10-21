import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FetchLike, UniworkDocsClientOptions } from '../src/main/uniwork-docs/client'
import { createFakeFolderUploadTransport } from '../src/main/uniwork-docs/folder-upload/fake-transport'
import type { FolderUploadRunnerPort } from '../src/main/uniwork-docs/folder-upload/runner-port'
import { createFolderUploadService } from '../src/main/uniwork-docs/folder-upload/service'
import {
  createFolderUploadWiring,
  type FolderUploadWireDeps,
} from '../src/main/uniwork-docs/folder-upload/wire'
import { DEFAULT_DOCUMENT_LIMITS, type DocumentLimits } from '../src/main/uniwork-docs/limits'
import type { BatchUploadProgress } from '../src/shared/folder-upload-api'

/**
 * UNI-2052 FU-E: the seam index.ts hands to `createUniworkDocs`. It reads the
 * server's limits, builds one transport per workspace over the signed-in
 * client options and Electron's `net.fetch` for storage, and routes the
 * runner's list refresh to the host.
 */

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'uw-fu-wire-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const WITH_BLOCK: DocumentLimits = {
  ...DEFAULT_DOCUMENT_LIMITS,
  max_bytes: 50_000_000,
  upload_extensions: ['docx', 'pdf'],
  chunked_upload_threshold_bytes: 8_000_000,
  folderUpload: {
    max_files: 300,
    max_folders: 40,
    max_total_bytes: 1_000_000_000,
    max_depth: 7,
    parallel: 4,
    complete_batch: 20,
  },
}

const OPTIONS: UniworkDocsClientOptions = {
  apiOrigin: 'https://uniwork.example',
  authorized: (call) => call('token'),
  isSignedIn: () => true,
}

const storageFetch: FetchLike = vi.fn(async () => new Response(null, { status: 200 }))

function deps(over: Partial<FolderUploadWireDeps> = {}): FolderUploadWireDeps {
  return {
    limits: async () => WITH_BLOCK,
    clientOptions: () => OPTIONS,
    storageFetch,
    ...over,
  }
}

describe('getLimits', () => {
  it('is the planner view of the server block, with the document cap and the allow-list', async () => {
    const wiring = createFolderUploadWiring(deps())
    expect(await wiring.getLimits()).toEqual({
      maxFiles: 300,
      maxFolders: 40,
      maxTotalBytes: 1_000_000_000,
      maxDepth: 7,
      perFileMaxBytes: 50_000_000,
      uploadExtensions: ['docx', 'pdf'],
    })
  })

  it('is null when the server has no folder_upload block', async () => {
    const wiring = createFolderUploadWiring(deps({ limits: async () => DEFAULT_DOCUMENT_LIMITS }))
    expect(await wiring.getLimits()).toBeNull()
  })

  it('leaves the allow-list out when the server sent none', async () => {
    const { upload_extensions: _dropped, ...noList } = WITH_BLOCK
    const wiring = createFolderUploadWiring(deps({ limits: async () => noList }))
    expect(await wiring.getLimits()).not.toHaveProperty('uploadExtensions')
  })
})

describe('the runner factory', () => {
  it('builds each transport from the client options, the workspace and net.fetch', async () => {
    const transport = createFakeFolderUploadTransport()
    const createTransport = vi.fn(() => transport)
    const wiring = createFolderUploadWiring(deps({ createTransport }))
    const runner = wiring.runner({ invalidate: () => undefined })
    const abs = join(root, 'a.docx')
    writeFileSync(abs, 'x'.repeat(10))
    const events: unknown[] = []

    runner.start(
      {
        rootName: null,
        rootTitle: null,
        folders: [],
        files: [{ path: 'a.docx', filename: 'a.docx', folderPath: '', size: 10, index: 0 }],
        skipped: [],
        totals: { files: 1, bytes: 10 },
        refusal: null,
      },
      {
        runId: 'r1',
        workspaceId: 'w9',
        parentId: 'p1',
        shareWithWorkspace: false,
        filePath: () => abs,
        onProgress: (progress) => void events.push(progress),
      },
    )
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({ phase: 'done', done: 1, failed: 0 }),
    )

    expect(createTransport).toHaveBeenCalledTimes(1)
    expect(createTransport).toHaveBeenCalledWith(OPTIONS, 'w9', { storageFetch })
  })

  it('tells the host which workspace to refresh', async () => {
    const invalidate = vi.fn()
    const wiring = createFolderUploadWiring(
      deps({ createTransport: () => createFakeFolderUploadTransport() }),
    )
    const runner = wiring.runner({ invalidate })
    const abs = join(root, 'a.docx')
    writeFileSync(abs, 'x'.repeat(10))
    const events: Array<{ phase: string }> = []
    runner.start(
      {
        rootName: null,
        rootTitle: null,
        folders: [],
        files: [{ path: 'a.docx', filename: 'a.docx', folderPath: '', size: 10, index: 0 }],
        skipped: [],
        totals: { files: 1, bytes: 10 },
        refusal: null,
      },
      {
        runId: 'r1',
        workspaceId: 'w9',
        parentId: 'p1',
        shareWithWorkspace: false,
        filePath: () => abs,
        onProgress: (progress) => void events.push(progress),
      },
    )
    await vi.waitFor(() => expect(events.at(-1)?.phase).toBe('done'))
    expect(invalidate).toHaveBeenCalledWith('w9')
  })

  it('a signed-out app fails the run as session, with no transport built', async () => {
    const createTransport = vi.fn(() => createFakeFolderUploadTransport())
    const wiring = createFolderUploadWiring(deps({ clientOptions: () => null, createTransport }))
    const runner = wiring.runner({ invalidate: () => undefined })
    const events: Array<{ phase: string; error?: { code: string } }> = []
    runner.start(
      {
        rootName: null,
        rootTitle: null,
        folders: [],
        files: [{ path: 'a.docx', filename: 'a.docx', folderPath: '', size: 10, index: 0 }],
        skipped: [],
        totals: { files: 1, bytes: 10 },
        refusal: null,
      },
      {
        runId: 'r1',
        workspaceId: 'w9',
        parentId: 'p1',
        shareWithWorkspace: false,
        filePath: () => join(root, 'a.docx'),
        onProgress: (progress) => void events.push(progress),
      },
    )
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ phase: 'failed' }))
    expect(events.at(-1)?.error?.code).toBe('session')
    expect(createTransport).not.toHaveBeenCalled()
  })
})

describe('through the folder-upload service', () => {
  function build(limits: DocumentLimits) {
    const wiring = createFolderUploadWiring(
      deps({
        limits: async () => limits,
        createTransport: () => createFakeFolderUploadTransport(),
      }),
    )
    const batch = wiring.runner({ invalidate: () => undefined })
    const batchStart = vi.spyOn(batch, 'start')
    const sequentialStart = vi.fn<FolderUploadRunnerPort['start']>((_plan, opts) => ({
      runId: opts.runId,
    }))
    const sequential: FolderUploadRunnerPort = {
      start: sequentialStart,
      cancel: () => undefined,
      retry: () => undefined,
      dismiss: () => undefined,
    }
    const service = createFolderUploadService({
      pickDirectory: async () => root,
      pickFiles: async () => [],
      folderTree: async () => [],
      ensureMyFolder: async () => ({ id: 'my1', title: 'My Folder' }),
      getFolderUploadLimits: () => wiring.getLimits(),
      sequentialLimits: async () => ({
        maxFiles: 100,
        maxTotalBytes: 1_000_000,
        maxDepth: 20,
        perFileMaxBytes: 1_000_000,
      }),
      runner: batch,
      sequential,
    })
    return { service, batchStart, sequentialStart }
  }

  function seed(): string {
    mkdirSync(join(root, 'f'))
    const abs = join(root, 'f', 'a.docx')
    writeFileSync(abs, 'x'.repeat(10))
    return abs
  }

  it('a server without the block sends several files down the sequential fallback', async () => {
    const { service, batchStart, sequentialStart } = build(DEFAULT_DOCUMENT_LIMITS)
    const a = seed()
    const [preflight] = await service.preflight({ workspaceId: 'w1', folderId: null, paths: [a] })
    expect(preflight).toMatchObject({ mode: 'files', shareAvailable: false })
    service.start(
      {
        preflightId: (preflight as { preflightId: string }).preflightId,
        shareWithWorkspace: false,
      },
      () => undefined,
    )
    expect(sequentialStart).toHaveBeenCalledTimes(1)
    expect(batchStart).not.toHaveBeenCalled()
  })

  it('a server with the block sends them to the batch runner', async () => {
    const { service, batchStart, sequentialStart } = build(WITH_BLOCK)
    const a = seed()
    const [preflight] = await service.preflight({ workspaceId: 'w1', folderId: null, paths: [a] })
    expect(preflight).toMatchObject({ mode: 'files', shareAvailable: true })
    const events: BatchUploadProgress[] = []
    service.start(
      { preflightId: (preflight as { preflightId: string }).preflightId, shareWithWorkspace: true },
      (event) => void events.push(event),
    )
    await vi.waitFor(() => expect(events.at(-1)?.phase).toBe('done'))
    expect(batchStart).toHaveBeenCalledTimes(1)
    expect(sequentialStart).not.toHaveBeenCalled()
  })
})
