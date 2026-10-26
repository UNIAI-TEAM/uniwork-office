import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { convertPdfToDocx, PdfLoadError } from '../../../packages/pdf2docx/src'
import { buildLatinPdf } from '../../../packages/pdf2docx/tests/helpers/fixtures'
import { PDF_CHANNELS, type PdfConvertProgressEvent } from '../../pdf/src/shared/ipc'
import {
  ensurePdfium,
  handleConvertJob,
  type PdfConvertChildMessage,
  type PdfConvertJob,
} from '../src/main/pdf-convert/convert-child'
import {
  activePdfConvertJobCount,
  createNodeChildProcessFork,
  killAllPdfConvertJobs,
  PdfConvertCancelled,
  PdfConvertCrashed,
  runPdfConvertJob,
  type ConvertChildProcess,
} from '../src/main/pdf-convert/convert-host'
import {
  convertPdfFileToDocxLocal,
  convertPdfFileToDocxLocalWithPrompt,
  convertWithPasswordRetry,
} from '../src/main/pdf2docx-local'
import { convertPdfFileToPptxLocal } from '../src/main/pdf2pptx-local'
import { convertPdfFileToXlsxLocal } from '../src/main/pdf2xlsx-local'

const PASSWORD_FIXTURE = fileURLToPath(
  new URL('./fixtures/testPassword4Spaces.pdf', import.meta.url),
)

function isPidAlive(pid: number | undefined): boolean {
  if (typeof pid !== 'number' || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForFileContent(filePath: string, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      const text = readFileSync(filePath, 'utf8').trim()
      if (text.length > 0) return text
    }
    await new Promise<void>((r) => {
      setTimeout(r, 20)
    })
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

async function waitForPidGone(pid: number | undefined, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true
    await new Promise<void>((r) => {
      setTimeout(r, 25)
    })
  }
  return !isPidAlive(pid)
}

/**
 * Fake child script driven via `child_process.fork` (serialization: 'advanced').
 * Behavior is controlled by `job.pdfPath` or `job.password` so one script covers
 * every protocol, error, crash, cancel, and grandchild tree-kill scenario.
 */
const FAKE_CHILD_SCRIPT = `
'use strict';
const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');

process.on('message', (job) => {
  const mode = job.pdfPath;

  if (mode === 'mode:success') {
    process.send({ type: 'progress', page: 1, total: 3 });
    process.send({ type: 'progress', page: 2, total: 3 });
    process.send({ type: 'progress', page: 3, total: 3 });
    process.send({
      type: 'result',
      kind: job.kind,
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 10, 20, 30, 255]),
      pages: 3,
      warnings: ['page 2: ocr applied'],
      pageResults: [
        { page: 1, status: 'ok' },
        { page: 2, status: 'ocr', confidence: 0.92 },
        { page: 3, status: 'ok' },
      ],
      scannedDocument: false,
    });
    setTimeout(() => process.exit(0), 5000).unref();
    return;
  }

  if (mode === 'mode:password-retry') {
    if (job.password !== 'secret-pw') {
      process.send({
        type: 'error',
        name: 'PdfLoadError',
        code: 'password-required',
        pdfiumError: 4,
        message: 'PDFium could not load the document (password-required, FPDF error 4)',
      });
    } else {
      process.send({ type: 'progress', page: 1, total: 1 });
      process.send({
        type: 'result',
        kind: job.kind,
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 99]),
        pages: 1,
        warnings: [],
        pageResults: [{ page: 1, status: 'ok' }],
        scannedDocument: false,
      });
    }
    setTimeout(() => process.exit(0), 5000).unref();
    return;
  }

  if (mode === 'mode:unsupported') {
    process.send({
      type: 'error',
      name: 'PdfLoadError',
      code: 'unsupported',
      pdfiumError: 5,
      message: 'PDFium could not load the document (unsupported, FPDF error 5)',
    });
    setTimeout(() => process.exit(0), 5000).unref();
    return;
  }

  if (mode === 'mode:corrupt') {
    process.send({
      type: 'error',
      name: 'PdfLoadError',
      code: 'corrupt',
      pdfiumError: 3,
      message: 'PDFium could not load the document (corrupt, FPDF error 3)',
    });
    setTimeout(() => process.exit(0), 5000).unref();
    return;
  }

  if (mode === 'mode:crash') {
    process.send({ type: 'progress', page: 1, total: 4 });
    setTimeout(() => process.exit(134), 20);
    return;
  }

  if (mode === 'mode:exit-without-result') {
    process.send({ type: 'progress', page: 1, total: 2 });
    setTimeout(() => process.exit(0), 20);
    return;
  }

  if (mode === 'mode:hang') {
    if (job.password) {
      writeFileSync(job.password, String(process.pid), 'utf8');
    }
    process.send({ type: 'progress', page: 1, total: 10 });
    setInterval(() => {}, 1000);
    return;
  }

  if (mode === 'mode:silent-hang') {
    if (job.password) {
      writeFileSync(job.password, String(process.pid), 'utf8');
    }
    setInterval(() => {}, 1000);
    return;
  }

  if (mode.startsWith('mode:spawnsync-grandchild:')) {
    const files = mode.slice('mode:spawnsync-grandchild:'.length).split('|');
    const cpidFile = files[0];
    const gpidFile = files[1];
    writeFileSync(cpidFile, String(process.pid), 'utf8');
    process.send({ type: 'progress', page: 1, total: 5 });
    // Block inside spawnSync exactly like ocr-vision.ts / ocr-tesseract.ts
    const grandchildCode =
      'require("node:fs").writeFileSync(' +
      JSON.stringify(gpidFile) +
      ', String(process.pid), "utf8"); setInterval(() => {}, 1000);';
    spawnSync(process.execPath, ['-e', grandchildCode], { stdio: 'ignore', windowsHide: true });
    return;
  }
});
`

describe('PDF -> Office utilityProcess host protocol (fake child via child_process.fork)', () => {
  let scratchDir = ''
  let fakeChildPath = ''

  beforeAll(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'uniwork-pdf-convert-test-'))
    fakeChildPath = join(scratchDir, 'fake-convert-child.cjs')
    writeFileSync(fakeChildPath, FAKE_CHILD_SCRIPT, 'utf8')
  })

  afterAll(() => {
    killAllPdfConvertJobs()
    if (scratchDir) {
      rmSync(scratchDir, { recursive: true, force: true })
    }
  })

  it('delivers progress events in order, preserves result bytes via structured clone, and terminates the child', async () => {
    let spawnedPid: number | undefined
    const baseFork = createNodeChildProcessFork(fakeChildPath)
    const fork = (modulePath: string): ConvertChildProcess => {
      const child = baseFork(modulePath)
      spawnedPid = child.pid
      return child
    }

    const progress: Array<[number, number]> = []
    const res = await runPdfConvertJob(
      { kind: 'docx', pdfPath: 'mode:success' },
      {
        fork,
        onProgress: (page, total) => progress.push([page, total]),
      },
    )

    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    expect(res.kind).toBe('docx')
    expect(res.pages).toBe(3)
    expect(res.warnings).toEqual(['page 2: ocr applied'])
    expect(res.pageResults).toEqual([
      { page: 1, status: 'ok' },
      { page: 2, status: 'ocr', confidence: 0.92 },
      { page: 3, status: 'ok' },
    ])
    expect(res.scannedDocument).toBe(false)
    expect(res.bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(res.bytes)).toEqual([0x50, 0x4b, 0x03, 0x04, 10, 20, 30, 255])
    expect(activePdfConvertJobCount()).toBe(0)
    expect(await waitForPidGone(spawnedPid)).toBe(true)
  })

  it('round-trips PdfLoadError codes (password-required, unsupported, corrupt) so password retry works unchanged', async () => {
    const fork = createNodeChildProcessFork(fakeChildPath)

    await expect(
      runPdfConvertJob({ kind: 'docx', pdfPath: 'mode:unsupported' }, { fork }),
    ).rejects.toMatchObject({
      name: 'PdfLoadError',
      code: 'unsupported',
      pdfiumError: 5,
    })

    await expect(
      runPdfConvertJob({ kind: 'docx', pdfPath: 'mode:corrupt' }, { fork }),
    ).rejects.toMatchObject({
      name: 'PdfLoadError',
      code: 'corrupt',
      pdfiumError: 3,
    })

    const retryFlags: boolean[] = []
    const passwords = ['wrong-1', 'secret-pw']
    const result = await convertWithPasswordRetry(
      (password) =>
        runPdfConvertJob(
          {
            kind: 'docx',
            pdfPath: 'mode:password-retry',
            ...(password !== undefined ? { password } : {}),
          },
          { fork },
        ),
      (retry) => {
        retryFlags.push(retry)
        return Promise.resolve(passwords.shift() ?? null)
      },
    )

    expect(retryFlags).toEqual([false, true])
    expect(result).not.toBeNull()
    expect(Array.from(result!.bytes)).toEqual([0x50, 0x4b, 0x03, 0x04, 99])
  })

  it('cancels mid-job via AbortSignal: rejects with PdfConvertCancelled and kills the child process by PID', async () => {
    const pidFile = join(scratchDir, 'hang-cpid.txt')
    const fork = createNodeChildProcessFork(fakeChildPath)
    const controller = new AbortController()

    const jobPromise = runPdfConvertJob(
      { kind: 'docx', pdfPath: 'mode:hang', password: pidFile },
      {
        fork,
        signal: controller.signal,
        onProgress: () => {
          controller.abort()
        },
      },
    )

    await expect(jobPromise).rejects.toBeInstanceOf(PdfConvertCancelled)
    const childPid = Number(await waitForFileContent(pidFile))
    expect(childPid).toBeGreaterThan(0)
    expect(await waitForPidGone(childPid)).toBe(true)
    expect(activePdfConvertJobCount()).toBe(0)
  })

  it('kills both the child and a spawnSync grandchild on cancel (no orphan OCR helper)', async () => {
    const cpidFile = join(scratchDir, 'tree-cpid.txt')
    const gpidFile = join(scratchDir, 'tree-gpid.txt')
    const fork = createNodeChildProcessFork(fakeChildPath)
    const controller = new AbortController()

    const jobPromise = runPdfConvertJob(
      {
        kind: 'docx',
        pdfPath: `mode:spawnsync-grandchild:${cpidFile}|${gpidFile}`,
      },
      {
        fork,
        signal: controller.signal,
      },
    )

    const childPid = Number(await waitForFileContent(cpidFile))
    const grandchildPid = Number(await waitForFileContent(gpidFile))
    expect(childPid).toBeGreaterThan(0)
    expect(grandchildPid).toBeGreaterThan(0)
    expect(isPidAlive(childPid)).toBe(true)
    expect(isPidAlive(grandchildPid)).toBe(true)

    controller.abort()

    await expect(jobPromise).rejects.toBeInstanceOf(PdfConvertCancelled)
    expect(await waitForPidGone(childPid)).toBe(true)
    expect(await waitForPidGone(grandchildPid)).toBe(true)
    expect(activePdfConvertJobCount()).toBe(0)
  })

  it('killAllPdfConvertJobs (before-quit hook) kills live child + grandchild trees and rejects in-flight jobs', async () => {
    const cpidFile = join(scratchDir, 'quit-cpid.txt')
    const gpidFile = join(scratchDir, 'quit-gpid.txt')
    const fork = createNodeChildProcessFork(fakeChildPath)

    const jobPromise = runPdfConvertJob(
      {
        kind: 'docx',
        pdfPath: `mode:spawnsync-grandchild:${cpidFile}|${gpidFile}`,
      },
      { fork },
    )

    const childPid = Number(await waitForFileContent(cpidFile))
    const grandchildPid = Number(await waitForFileContent(gpidFile))
    expect(isPidAlive(childPid)).toBe(true)
    expect(isPidAlive(grandchildPid)).toBe(true)
    expect(activePdfConvertJobCount()).toBe(1)

    killAllPdfConvertJobs()

    await expect(jobPromise).rejects.toBeInstanceOf(PdfConvertCancelled)
    expect(activePdfConvertJobCount()).toBe(0)
    expect(await waitForPidGone(childPid)).toBe(true)
    expect(await waitForPidGone(grandchildPid)).toBe(true)
  })

  it('rejects with PdfConvertCrashed (including exit code) when the child crashes non-zero', async () => {
    const fork = createNodeChildProcessFork(fakeChildPath)
    let caught: unknown
    try {
      await runPdfConvertJob({ kind: 'docx', pdfPath: 'mode:crash' }, { fork })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(PdfConvertCrashed)
    expect((caught as PdfConvertCrashed).exitCode).toBe(134)
    expect((caught as PdfConvertCrashed).message).toContain('134')
  })

  it('rejects with PdfConvertCrashed when the child exits 0 without posting a result', async () => {
    const fork = createNodeChildProcessFork(fakeChildPath)
    let caught: unknown
    try {
      await runPdfConvertJob({ kind: 'docx', pdfPath: 'mode:exit-without-result' }, { fork })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(PdfConvertCrashed)
    expect((caught as PdfConvertCrashed).exitCode).toBe(0)
  })

  it('rejects with PdfConvertCrashed and kills the child when the inactivity watchdog fires', async () => {
    const pidFile = join(scratchDir, 'watchdog-cpid.txt')
    const fork = createNodeChildProcessFork(fakeChildPath)

    await expect(
      runPdfConvertJob(
        { kind: 'docx', pdfPath: 'mode:silent-hang', password: pidFile },
        { fork, watchdogMs: 250 },
      ),
    ).rejects.toThrow(/timed out after 250ms/)

    const childPid = Number(await waitForFileContent(pidFile))
    expect(await waitForPidGone(childPid)).toBe(true)
    expect(activePdfConvertJobCount()).toBe(0)
  })

  it('leaves no listener or timer leaks on the child emitter or AbortSignal after completion, error, or cancel', async () => {
    const emitter = new EventEmitter()
    let currentBehavior: 'ok' | 'err' | 'hang' = 'ok'

    const fakeFork = (): ConvertChildProcess => ({
      pid: undefined,
      postMessage(job: PdfConvertJob) {
        if (currentBehavior === 'ok') {
          setImmediate(() => {
            emitter.emit('message', {
              type: 'result',
              kind: job.kind,
              bytes: new Uint8Array([1, 2, 3]),
              pages: 1,
              warnings: [],
              pageResults: [{ page: 1, status: 'ok' }],
              scannedDocument: false,
            })
          })
        } else if (currentBehavior === 'err') {
          setImmediate(() => {
            emitter.emit('message', {
              type: 'error',
              name: 'PdfLoadError',
              code: 'corrupt',
              pdfiumError: 3,
              message: 'bad pdf',
            })
          })
        }
      },
      on(event, listener) {
        emitter.on(event, listener)
        return this
      },
      off(event, listener) {
        emitter.off(event, listener)
        return this
      },
      kill() {
        return true
      },
    })

    const sharedController = new AbortController()
    await runPdfConvertJob(
      { kind: 'docx', pdfPath: 'x.pdf' },
      { fork: fakeFork, signal: sharedController.signal },
    )
    expect(emitter.listenerCount('message')).toBe(0)
    expect(emitter.listenerCount('exit')).toBe(0)

    currentBehavior = 'err'
    await expect(
      runPdfConvertJob(
        { kind: 'docx', pdfPath: 'x.pdf' },
        { fork: fakeFork, signal: sharedController.signal },
      ),
    ).rejects.toBeInstanceOf(PdfLoadError)
    expect(emitter.listenerCount('message')).toBe(0)
    expect(emitter.listenerCount('exit')).toBe(0)

    currentBehavior = 'hang'
    const cancelController = new AbortController()
    const pending = runPdfConvertJob(
      { kind: 'docx', pdfPath: 'x.pdf' },
      { fork: fakeFork, signal: cancelController.signal },
    )
    cancelController.abort()
    await expect(pending).rejects.toBeInstanceOf(PdfConvertCancelled)
    expect(emitter.listenerCount('message')).toBe(0)
    expect(emitter.listenerCount('exit')).toBe(0)
    expect(activePdfConvertJobCount()).toBe(0)
  })
})

describe('end-to-end Node child entry: convert-child matches direct convertPdfToDocx', () => {
  let scratchDir = ''
  let latinPdfPath = ''

  beforeAll(async () => {
    scratchDir = mkdtempSync(join(tmpdir(), 'uniwork-pdf-e2e-'))
    latinPdfPath = join(scratchDir, 'latin-sample.pdf')
    writeFileSync(latinPdfPath, await buildLatinPdf())
  })

  afterAll(() => {
    if (scratchDir) {
      rmSync(scratchDir, { recursive: true, force: true })
    }
  })

  it('produces identical word/document.xml via convert-child / convertPdfFileToDocxLocal and direct convertPdfToDocx', async () => {
    const pdfium = await ensurePdfium()
    const rawBytes = readFileSync(latinPdfPath)
    const directResult = await convertPdfToDocx(
      new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength),
      { pdfium },
    )

    const childMessages: PdfConvertChildMessage[] = []
    await handleConvertJob({ kind: 'docx', pdfPath: latinPdfPath }, (msg) => {
      childMessages.push(msg)
    })

    const progressMsgs = childMessages.filter((m) => m.type === 'progress')
    expect(progressMsgs).toEqual([{ type: 'progress', page: 1, total: 1 }])

    const resultMsg = childMessages.find((m) => m.type === 'result')
    expect(resultMsg).toBeDefined()
    expect(resultMsg?.type).toBe('result')

    const hostResult = await convertPdfFileToDocxLocal(latinPdfPath)
    expect(hostResult.pages).toBe(directResult.pages)
    expect(hostResult.pageResults).toEqual(directResult.pageResults)
    expect(hostResult.scannedDocument).toBe(directResult.scannedDocument)

    const directZip = await JSZip.loadAsync(directResult.docx)
    const childEntryZip = await JSZip.loadAsync(
      resultMsg && resultMsg.type === 'result' ? resultMsg.bytes : new Uint8Array(),
    )
    const hostZip = await JSZip.loadAsync(hostResult.docx)

    const directXml = await directZip.file('word/document.xml')!.async('string')
    const childEntryXml = await childEntryZip.file('word/document.xml')!.async('string')
    const hostXml = await hostZip.file('word/document.xml')!.async('string')

    expect(childEntryXml).toBe(directXml)
    expect(hostXml).toBe(directXml)
    expect(hostXml).toContain('Sample Document')
    expect(hostXml).toContain('The quick brown fox jumps over the lazy dog')
  }, 60_000)

  it('also converts pptx and xlsx through the host/child pipeline', async () => {
    const pptx = await convertPdfFileToPptxLocal(PASSWORD_FIXTURE, undefined, '    ')
    expect(pptx.pages).toBeGreaterThan(0)
    expect(Array.from(pptx.pptx.slice(0, 2))).toEqual([0x50, 0x4b])

    const xlsx = await convertPdfFileToXlsxLocal(PASSWORD_FIXTURE, undefined, '    ')
    expect(xlsx.pages).toBe(pptx.pages)
    expect(Array.from(xlsx.xlsx.slice(0, 2))).toEqual([0x50, 0x4b])

    const docx = await convertPdfFileToDocxLocalWithPrompt(PASSWORD_FIXTURE, () =>
      Promise.resolve('    '),
    )
    expect(docx).not.toBeNull()
    expect(docx!.pages).toBe(pptx.pages)
  }, 60_000)
})

describe('PDF convert progress + cancel IPC wiring', () => {
  it('defines convertProgress and convertCancel channels and wires them in preload and shell main', async () => {
    expect(PDF_CHANNELS.convertProgress).toBe('pdf:convert-progress')
    expect(PDF_CHANNELS.convertCancel).toBe('pdf:convert-cancel')

    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    const invoked: string[] = []
    let exposedPdfApi: {
      convertCancel(): Promise<void>
      onConvertProgress(cb: (p: PdfConvertProgressEvent) => void): () => void
    } | null = null

    vi.resetModules()
    vi.doMock('electron', () => ({
      contextBridge: {
        exposeInMainWorld: (name: string, api: unknown) => {
          if (name === 'pdfApi') {
            exposedPdfApi = api as typeof exposedPdfApi
          }
        },
      },
      ipcRenderer: {
        invoke: (channel: string) => {
          invoked.push(channel)
          return Promise.resolve()
        },
        on: (channel: string, cb: (...args: unknown[]) => void) => {
          if (!listeners.has(channel)) listeners.set(channel, new Set())
          listeners.get(channel)!.add(cb)
        },
        removeListener: (channel: string, cb: (...args: unknown[]) => void) => {
          listeners.get(channel)?.delete(cb)
        },
        send: () => undefined,
      },
    }))

    await import('../../pdf/src/preload/index')
    expect(exposedPdfApi).not.toBeNull()

    const events: PdfConvertProgressEvent[] = []
    const off = exposedPdfApi!.onConvertProgress((ev) => events.push(ev))
    const emit = (payload: unknown) => {
      for (const fn of listeners.get(PDF_CHANNELS.convertProgress) ?? []) {
        fn({}, payload)
      }
    }

    // Malformed payloads are ignored by the preload guard
    emit(null)
    emit({ format: 'invalid', page: 1, total: 2 })
    emit('bad')

    // Valid progress + terminal done events pass through
    emit({ format: 'docx', page: 0, total: 0 })
    emit({ format: 'docx', page: 2, total: 5 })
    emit({ format: 'docx', page: 5, total: 5, done: true })

    expect(events).toEqual([
      { format: 'docx', page: 0, total: 0 },
      { format: 'docx', page: 2, total: 5 },
      { format: 'docx', page: 5, total: 5, done: true },
    ])

    off()
    expect(listeners.get(PDF_CHANNELS.convertProgress)?.size ?? 0).toBe(0)

    await exposedPdfApi!.convertCancel()
    expect(invoked).toContain(PDF_CHANNELS.convertCancel)

    vi.doUnmock('electron')
  })
})
