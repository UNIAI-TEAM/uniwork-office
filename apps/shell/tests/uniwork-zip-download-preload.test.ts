/**
 * @vitest-environment jsdom
 */
/**
 * UNI-2068: the preload bridge of the zip download (`window.aiOffice.zipDownload`).
 * Like every uniwork-doc bridge, what main answers or pushes is narrowed before
 * the renderer sees it: a reply of the wrong shape becomes a refusal / null,
 * and a field the contract does not name never crosses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  asFileDownloadResult,
  asZipDownloadProgress,
  asZipStartResult,
} from '../src/preload/zip-download-guards'
import { ZIP_DOWNLOAD_CHANNELS, type ZipDownloadBridge } from '../src/shared/zip-download-api'

const DOC = '01J8X4D0C0N1P2Q3R4S5T6V7WA'

async function loadBridge(reply: unknown) {
  vi.resetModules()
  const handlers = new Map<string, (event: unknown, raw: unknown) => void>()
  const invoked: Array<{ channel: string; args: unknown[] }> = []
  const exposed: Record<string, unknown> = {}
  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => void (exposed[key] = value),
    },
    ipcRenderer: {
      on: (channel: string, cb: (event: unknown, raw: unknown) => void) => {
        handlers.set(channel, cb)
      },
      invoke: async (channel: string, ...args: unknown[]) => {
        invoked.push({ channel, args })
        return reply
      },
      send: () => undefined,
      removeListener: () => undefined,
    },
    webUtils: { getPathForFile: () => '' },
  }))
  await import('../src/preload/index')
  invoked.length = 0
  const home = exposed.aiOffice as { zipDownload?: ZipDownloadBridge }
  return { bridge: home.zipDownload, invoked, handlers }
}

afterEach(() => vi.doUnmock('electron'))

describe('guards', () => {
  it('asZipStartResult keeps a run id or a known refusal, anything else is refused', () => {
    expect(asZipStartResult({ ok: true, runId: 'r1', extra: 1 })).toEqual({ ok: true, runId: 'r1' })
    expect(asZipStartResult({ ok: false, code: 'dialog_canceled' })).toEqual({
      ok: false,
      code: 'dialog_canceled',
    })
    expect(asZipStartResult({ ok: false, code: 'zip_busy' })).toEqual({
      ok: false,
      code: 'zip_busy',
    })
    expect(asZipStartResult({ ok: false, code: 'weird' })).toEqual({
      ok: false,
      code: 'server_error',
    })
    expect(asZipStartResult({ ok: true })).toEqual({ ok: false, code: 'server_error' })
    expect(asZipStartResult(null)).toEqual({ ok: false, code: 'server_error' })
  })

  it('asFileDownloadResult keeps ok / path / a known code and nothing else', () => {
    expect(asFileDownloadResult({ ok: true, path: '/a/b.docx', leak: 'x' })).toEqual({
      ok: true,
      path: '/a/b.docx',
    })
    expect(asFileDownloadResult({ ok: false, path: null, code: 'dialog_canceled' })).toEqual({
      ok: false,
      path: null,
      code: 'dialog_canceled',
    })
    expect(asFileDownloadResult({ ok: false, path: null, code: 'nope' })).toEqual({
      ok: false,
      path: null,
      code: 'server_error',
    })
    expect(asFileDownloadResult('x')).toEqual({ ok: false, path: null, code: 'server_error' })
    // a success with no path is not a success
    expect(asFileDownloadResult({ ok: true, path: null })).toEqual({
      ok: false,
      path: null,
      code: 'server_error',
    })
  })

  it('asZipDownloadProgress narrows a push and drops what the contract does not name', () => {
    const progress = asZipDownloadProgress({
      runId: 'r1',
      phase: 'downloading',
      bytes: 10,
      totalBytes: 100,
      fileCount: 2,
      skipped: [
        { documentId: DOC, reason: 'not_a_file', extra: 1 },
        { documentId: '', reason: 'not_a_file' },
        { documentId: DOC, reason: 'bogus' },
      ],
      path: null,
      error: { code: 'zip_busy', retryAfterSeconds: 30, detail: 'x' },
      secret: 'x',
    })
    expect(progress).toEqual({
      runId: 'r1',
      phase: 'downloading',
      bytes: 10,
      totalBytes: 100,
      fileCount: 2,
      skipped: [{ documentId: DOC, reason: 'not_a_file' }],
      path: null,
      error: { code: 'zip_busy', retryAfterSeconds: 30 },
    })
  })

  it('asZipDownloadProgress refuses a push of the wrong shape', () => {
    for (const raw of [
      null,
      'x',
      {},
      {
        runId: 'r',
        phase: 'nope',
        bytes: 0,
        totalBytes: null,
        fileCount: null,
        skipped: [],
        path: null,
        error: null,
      },
      {
        runId: '',
        phase: 'done',
        bytes: 0,
        totalBytes: null,
        fileCount: null,
        skipped: [],
        path: null,
        error: null,
      },
      {
        runId: 'r',
        phase: 'done',
        bytes: -1,
        totalBytes: null,
        fileCount: null,
        skipped: [],
        path: null,
        error: null,
      },
      {
        runId: 'r',
        phase: 'done',
        bytes: 0,
        totalBytes: null,
        fileCount: null,
        skipped: [],
        path: null,
        error: 'x',
      },
    ]) {
      expect(asZipDownloadProgress(raw)).toBeNull()
    }
  })

  it('asZipDownloadProgress turns an unknown error code into server_error, keeping the event', () => {
    const progress = asZipDownloadProgress({
      runId: 'r',
      phase: 'failed',
      bytes: 0,
      totalBytes: null,
      fileCount: null,
      skipped: [],
      path: null,
      error: { code: 'bogus' },
    })
    expect(progress).toMatchObject({ phase: 'failed', error: { code: 'server_error' } })
  })
})

describe('window.aiOffice.zipDownload', () => {
  it('is exposed with the four calls of the contract', async () => {
    const { bridge } = await loadBridge(undefined)
    expect(bridge).toBeDefined()
    expect(Object.keys(bridge!).sort()).toEqual(['cancel', 'downloadFile', 'onProgress', 'start'])
  })

  it('start sends the input over the start channel and narrows the reply', async () => {
    const { bridge, invoked } = await loadBridge({ ok: true, runId: 'r1', extra: 1 })
    const input = { workspaceId: 'ws', documentIds: [DOC, DOC] }
    expect(await bridge!.start(input)).toEqual({ ok: true, runId: 'r1' })
    expect(invoked).toEqual([{ channel: ZIP_DOWNLOAD_CHANNELS.start, args: [input] }])
    const bad = await loadBridge('garbage')
    expect(await bad.bridge!.start(input)).toEqual({ ok: false, code: 'server_error' })
  })

  it('cancel ignores anything but a run id', async () => {
    const { bridge, invoked } = await loadBridge(undefined)
    await bridge!.cancel('')
    await bridge!.cancel(7 as unknown as string)
    expect(invoked).toEqual([])
    await bridge!.cancel('r1')
    expect(invoked).toEqual([{ channel: ZIP_DOWNLOAD_CHANNELS.cancel, args: ['r1'] }])
  })

  it('downloadFile goes over its channel and narrows the reply', async () => {
    const { bridge, invoked } = await loadBridge({ ok: true, path: '/x/y.docx', leak: 1 })
    const input = { workspaceId: 'ws', documentId: DOC, suggestedName: 'y.docx' }
    expect(await bridge!.downloadFile(input)).toEqual({ ok: true, path: '/x/y.docx' })
    expect(invoked[0]).toEqual({ channel: ZIP_DOWNLOAD_CHANNELS.downloadFile, args: [input] })
  })

  it('onProgress hands over narrowed pushes only, and unsubscribes', async () => {
    const { bridge, handlers } = await loadBridge(undefined)
    const listener = vi.fn()
    const off = bridge!.onProgress(listener)
    const push = handlers.get(ZIP_DOWNLOAD_CHANNELS.progress)!
    expect(push).toBeTypeOf('function')
    push({}, { nonsense: true })
    expect(listener).not.toHaveBeenCalled()
    push(
      {},
      {
        runId: 'r1',
        phase: 'done',
        bytes: 5,
        totalBytes: 5,
        fileCount: 1,
        skipped: [],
        path: '/x/documents.zip',
        error: null,
      },
    )
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]![0]).toMatchObject({
      runId: 'r1',
      phase: 'done',
      path: '/x/documents.zip',
    })
    off()
    push(
      {},
      {
        runId: 'r2',
        phase: 'saving',
        bytes: 0,
        totalBytes: null,
        fileCount: null,
        skipped: [],
        path: null,
        error: null,
      },
    )
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
