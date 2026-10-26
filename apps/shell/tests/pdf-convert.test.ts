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
import { atomicWriteFile } from '../src/main/atomic-write'
import {
  ensurePdfium,
  handleConvertJob,
  type PdfConvertChildMessage,
  type PdfConvertJob,
} from '../src/main/pdf-convert/convert-child'
import {
  activePdfConvertJobCount,
  beginPdfConvertCommitPhase,
  cancelActivePdfConvert,
  collectPosixDescendantsFromPsOutput,
  createNodeChildProcessFork,
  formatPdfConvertErrorDetail,
  isPidAbsent,
  killAllPdfConvertJobs,
  killPosixProcessTree,
  killProcessTree,
  listPosixDescendants,
  PdfConvertCancelled,
  PdfConvertCrashed,
  runPdfConvertExportFlow,
  runPdfConvertJob,
  terminatingPdfConvertJobCount,
  type ConvertChildExitListener,
  type ConvertChildMessageListener,
  type ConvertChildProcess,
  type ConvertChildSpawnListener,
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
const SHIPPED_TESS_OCR_PATH = fileURLToPath(
  new URL('../../../packages/pdf2docx/ocr-tesseract/tess-ocr.cjs', import.meta.url),
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
    if (!isPidAlive(pid) && terminatingPdfConvertJobCount() === 0) return true
    await new Promise<void>((r) => {
      setTimeout(r, 25)
    })
  }
  return !isPidAlive(pid) && terminatingPdfConvertJobCount() === 0
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
    // Block inside spawnSync and run the shipped tess-ocr.cjs watch with
    // GENOFFICE_OCR_PARENT_PID set to the immediate converter's PID (R2-1 / R2-3).
    const grandchildCode =
      'require(' +
      ${JSON.stringify(JSON.stringify(SHIPPED_TESS_OCR_PATH))} +
      '); ' +
      'require("node:fs").writeFileSync(' +
      JSON.stringify(gpidFile) +
      ', String(process.pid), "utf8"); setInterval(() => {}, 1000);';
    spawnSync(process.execPath, ['-e', grandchildCode], {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, GENOFFICE_OCR_PARENT_PID: String(process.pid) },
    });
    return;
  }

  if (mode.startsWith('mode:spawnsync-grandchild-preinit:')) {
    const files = mode.slice('mode:spawnsync-grandchild-preinit:'.length).split('|');
    const cpidFile = files[0];
    const gpidFile = files[1];
    const survivedFile = files[2];
    writeFileSync(cpidFile, String(process.pid), 'utf8');
    process.send({ type: 'progress', page: 1, total: 5 });
    // Spawn the helper with GENOFFICE_OCR_PARENT_PID, wait until the parent
    // converter has died BEFORE requiring tess-ocr.cjs, then load the shipped
    // tess-ocr.cjs watch (R2-1 / R2-3a).
    const grandchildCode =
      'const fs = require("node:fs"); ' +
      'const expectedParent = Number(process.env.GENOFFICE_OCR_PARENT_PID); ' +
      'fs.writeFileSync(' +
      JSON.stringify(gpidFile) +
      ', String(process.pid), "utf8"); ' +
      'const waitTimer = setInterval(() => { ' +
      '  let parentStillOwned = process.ppid === expectedParent; ' +
      '  if (parentStillOwned) { ' +
      '    try { process.kill(expectedParent, 0); } catch (e) { parentStillOwned = Boolean(e && e.code === "EPERM"); } ' +
      '  } ' +
      '  if (!parentStillOwned) { ' +
      '    clearInterval(waitTimer); ' +
      '    require(' +
      ${JSON.stringify(JSON.stringify(SHIPPED_TESS_OCR_PATH))} +
      '); ' +
      '    fs.writeFileSync(' +
      JSON.stringify(survivedFile) +
      ', "survived", "utf8"); ' +
      '    setInterval(() => {}, 1000); ' +
      '  } ' +
      '}, 15);';
    spawnSync(process.execPath, ['-e', grandchildCode], {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, GENOFFICE_OCR_PARENT_PID: String(process.pid) },
    });
    return;
  }
  if (mode === 'mode:slow-extraction') {
    // Simulate a slow initial whole-document extraction pass before the first progress event (R1-11)
    setTimeout(() => {
      process.send({ type: 'progress', page: 1, total: 1 });
      process.send({
        type: 'result',
        kind: job.kind,
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 77]),
        pages: 1,
        warnings: [],
        pageResults: [{ page: 1, status: 'ok' }],
        scannedDocument: false,
      });
      setTimeout(() => process.exit(0), 5000).unref();
    }, 400);
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

  it('rejects with PdfConvertCrashed and kills the child when the inactivity watchdog fires after first progress (R1-9/R1-10/R1-11)', async () => {
    let spawnedPid: number | undefined
    const baseFork = createNodeChildProcessFork(fakeChildPath)
    const fork = (modulePath: string): ConvertChildProcess => {
      const child = baseFork(modulePath)
      spawnedPid = child.pid
      return child
    }

    await expect(
      runPdfConvertJob({ kind: 'docx', pdfPath: 'mode:hang' }, { fork, watchdogMs: 250 }),
    ).rejects.toThrow(/timed out after 250ms/)

    expect(spawnedPid).toBeGreaterThan(0)
    expect(await waitForPidGone(spawnedPid)).toBe(true)
    expect(activePdfConvertJobCount()).toBe(0)
  })

  it('arms the inactivity watchdog only after the first progress message so slow initial extraction is not killed prematurely (R1-11)', async () => {
    let spawnedPid: number | undefined
    const baseFork = createNodeChildProcessFork(fakeChildPath)
    const fork = (modulePath: string): ConvertChildProcess => {
      const child = baseFork(modulePath)
      spawnedPid = child.pid
      return child
    }

    // Initial extraction takes ~400 ms before the first progress message, while
    // watchdogMs is 150 ms; it must succeed because the watchdog only arms on progress.
    const res = await runPdfConvertJob(
      { kind: 'docx', pdfPath: 'mode:slow-extraction' },
      { fork, watchdogMs: 150 },
    )
    expect(res.pages).toBe(1)
    expect(Array.from(res.bytes)).toEqual([0x50, 0x4b, 0x03, 0x04, 77])
    expect(await waitForPidGone(spawnedPid)).toBe(true)
    expect(activePdfConvertJobCount()).toBe(0)
  })

  it('retains cleanup ownership across asynchronous spawn: cancel or quit before spawn kills the process once its PID arrives and never dispatches the job (R1-1)', async () => {
    const baseFork = createNodeChildProcessFork(fakeChildPath)
    let underlyingChild: ConvertChildProcess | null = null
    let latePid: number | undefined
    let dispatchedMessages = 0

    const asyncSpawnFork = (modulePath: string): ConvertChildProcess => {
      const emitter = new EventEmitter()
      let spawned = false
      const real = baseFork(modulePath)
      underlyingChild = real
      latePid = real.pid

      real.on('message', (m) => emitter.emit('message', m))
      real.on('exit', (code) => emitter.emit('exit', code))

      // Simulate Electron utilityProcess: pid is undefined and kill() returns false
      // until the asynchronous 'spawn' event fires 120 ms later.
      setTimeout(() => {
        spawned = true
        emitter.emit('spawn')
      }, 120)

      return {
        awaitsSpawn: true,
        get pid() {
          return spawned ? real.pid : undefined
        },
        postMessage(msg: PdfConvertJob) {
          dispatchedMessages++
          real.postMessage(msg)
        },
        on(
          event: 'message' | 'exit' | 'spawn',
          listener:
            ConvertChildMessageListener | ConvertChildExitListener | ConvertChildSpawnListener,
        ) {
          emitter.on(event, listener)
          return this
        },
        off(
          event: 'message' | 'exit' | 'spawn',
          listener:
            ConvertChildMessageListener | ConvertChildExitListener | ConvertChildSpawnListener,
        ) {
          emitter.off(event, listener)
          return this
        },
        kill() {
          if (!spawned) return false
          return real.kill()
        },
      }
    }

    const controller = new AbortController()
    const cpidFile = join(scratchDir, 'async-spawn-cpid.txt')
    const jobPromise = runPdfConvertJob(
      { kind: 'docx', pdfPath: 'mode:hang', password: cpidFile },
      { fork: asyncSpawnFork, signal: controller.signal },
    )

    // Cancel immediately while pid === undefined and kill() returns false
    controller.abort()
    await expect(jobPromise).rejects.toBeInstanceOf(PdfConvertCancelled)
    expect(activePdfConvertJobCount()).toBe(0)
    // Still tracked in terminatingJobs until the async spawn arrives and is killed
    expect(terminatingPdfConvertJobCount()).toBe(1)

    expect(latePid).toBeGreaterThan(0)
    expect(await waitForPidGone(latePid, 4_000)).toBe(true)
    expect(dispatchedMessages).toBe(0)
    expect(existsSync(cpidFile)).toBe(false)
    expect(terminatingPdfConvertJobCount()).toBe(0)
    // Safety cleanup in case test assertions fail
    underlyingChild?.kill()
  })

  it('runs the shipped tess-ocr.cjs parent watch: helper exits when parent dies (a) before helper watch initializes and (b) while helper is working (R1-2/R1-4/R2-1/R2-3)', async () => {
    const fork = createNodeChildProcessFork(fakeChildPath)

    // (a) Kill the converter parent BEFORE the helper initializes tess-ocr.cjs.
    // Pass `killTree: () => {}` so host-side tree kill cannot mask a broken watcher on Windows.
    const preInitCpidFile = join(scratchDir, 'crash-preinit-cpid.txt')
    const preInitGpidFile = join(scratchDir, 'crash-preinit-gpid.txt')
    const preInitSurvivedFile = join(scratchDir, 'crash-preinit-survived.txt')

    const preInitPromise = runPdfConvertJob(
      {
        kind: 'docx',
        pdfPath: `mode:spawnsync-grandchild-preinit:${preInitCpidFile}|${preInitGpidFile}|${preInitSurvivedFile}`,
      },
      { fork, killTree: () => undefined },
    )

    const preInitChildPid = Number(await waitForFileContent(preInitCpidFile))
    const preInitGrandchildPid = Number(await waitForFileContent(preInitGpidFile))
    expect(isPidAlive(preInitChildPid)).toBe(true)
    expect(isPidAlive(preInitGrandchildPid)).toBe(true)

    process.kill(preInitChildPid, 'SIGKILL')

    await expect(preInitPromise).rejects.toBeInstanceOf(PdfConvertCrashed)
    expect(await waitForPidGone(preInitChildPid)).toBe(true)
    expect(await waitForPidGone(preInitGrandchildPid)).toBe(true)
    expect(existsSync(preInitSurvivedFile)).toBe(false)

    // (b) Kill the converter parent WHILE the helper is working after tess-ocr.cjs watch initialized.
    // Again pass `killTree: () => {}` first so only the shipped tess-ocr.cjs watch can terminate it.
    const workingCpidFile = join(scratchDir, 'crash-working-cpid.txt')
    const workingGpidFile = join(scratchDir, 'crash-working-gpid.txt')

    const workingPromise = runPdfConvertJob(
      {
        kind: 'docx',
        pdfPath: `mode:spawnsync-grandchild:${workingCpidFile}|${workingGpidFile}`,
      },
      { fork, killTree: () => undefined },
    )

    const workingChildPid = Number(await waitForFileContent(workingCpidFile))
    const workingGrandchildPid = Number(await waitForFileContent(workingGpidFile))
    expect(isPidAlive(workingChildPid)).toBe(true)
    expect(isPidAlive(workingGrandchildPid)).toBe(true)

    process.kill(workingChildPid, 'SIGKILL')

    await expect(workingPromise).rejects.toBeInstanceOf(PdfConvertCrashed)
    expect(await waitForPidGone(workingChildPid)).toBe(true)
    expect(await waitForPidGone(workingGrandchildPid)).toBe(true)
    expect(activePdfConvertJobCount()).toBe(0)
    expect(terminatingPdfConvertJobCount()).toBe(0)
  })

  it('keeps the terminating handle and exit listener until the process actually emits exit: retries failed kills and handles late exit after successful kill (R2-2)', async () => {
    // 1. Failed tree kill + kill() returning false on a child with a valid PID keeps the
    // handle in terminatingJobs so killAllPdfConvertJobs() retries it; later exit clears it.
    const emitter1 = new EventEmitter()
    let killAttempts1 = 0
    let allowKill1 = false
    const treeKillCalls1: Array<[number | undefined, boolean]> = []

    const fork1 = (): ConvertChildProcess => ({
      pid: 42424,
      postMessage() {
        // stay in flight until aborted
      },
      on(event, listener) {
        emitter1.on(event, listener)
        return this
      },
      off(event, listener) {
        emitter1.off(event, listener)
        return this
      },
      kill() {
        killAttempts1++
        return allowKill1
      },
    })

    const controller1 = new AbortController()
    const job1 = runPdfConvertJob(
      { kind: 'docx', pdfPath: 'x.pdf' },
      {
        fork: fork1,
        signal: controller1.signal,
        killTree: (pid, rootAlreadyExited) => {
          treeKillCalls1.push([pid, rootAlreadyExited])
        },
      },
    )

    controller1.abort()
    await expect(job1).rejects.toBeInstanceOf(PdfConvertCancelled)

    // Even though child.pid === 42424, kill() returned false and 'exit' has not fired:
    // terminating handle and exit listener MUST remain registered.
    expect(killAttempts1).toBe(1)
    expect(treeKillCalls1).toEqual([[42424, false]])
    expect(activePdfConvertJobCount()).toBe(0)
    expect(terminatingPdfConvertJobCount()).toBe(1)
    expect(emitter1.listenerCount('exit')).toBe(1)

    // Calling killAllPdfConvertJobs() retries both killTree and child.kill()
    allowKill1 = true
    killAllPdfConvertJobs()
    expect(killAttempts1).toBe(2)
    expect(treeKillCalls1).toEqual([
      [42424, false],
      [42424, false],
    ])
    // Still waiting for the actual 'exit' event
    expect(terminatingPdfConvertJobCount()).toBe(1)
    expect(emitter1.listenerCount('exit')).toBe(1)

    // Once 'exit' arrives, ownership and listeners are released
    emitter1.emit('exit', null)
    expect(terminatingPdfConvertJobCount()).toBe(0)
    expect(emitter1.listenerCount('exit')).toBe(0)
    expect(emitter1.listenerCount('spawn')).toBe(0)

    // 2. Successful kill (kill() returns true) with late asynchronous exit event:
    // handle stays registered until the late 'exit' event fires.
    const emitter2 = new EventEmitter()
    let killAttempts2 = 0
    const fork2 = (): ConvertChildProcess => ({
      pid: 52525,
      postMessage(job: PdfConvertJob) {
        setImmediate(() => {
          emitter2.emit('message', {
            type: 'result',
            kind: job.kind,
            bytes: new Uint8Array([1, 2, 3]),
            pages: 1,
            warnings: [],
            pageResults: [{ page: 1, status: 'ok' }],
            scannedDocument: false,
          })
        })
      },
      on(event, listener) {
        emitter2.on(event, listener)
        return this
      },
      off(event, listener) {
        emitter2.off(event, listener)
        return this
      },
      kill() {
        killAttempts2++
        return true
      },
    })

    const res2 = await runPdfConvertJob(
      { kind: 'docx', pdfPath: 'x.pdf' },
      { fork: fork2, killTree: () => undefined },
    )
    expect(res2.pages).toBe(1)
    expect(killAttempts2).toBe(1)
    // Before the delayed 'exit' fires, terminating handle is still held
    expect(terminatingPdfConvertJobCount()).toBe(1)
    expect(emitter2.listenerCount('exit')).toBe(1)

    emitter2.emit('exit', 0)
    expect(terminatingPdfConvertJobCount()).toBe(0)
    expect(emitter2.listenerCount('exit')).toBe(0)
  })

  it('runs Windows post-exit taskkill only when process.kill(pid, 0) throws ESRCH, skipping reused PIDs (R1-12)', () => {
    const esrchError = () => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
    }
    const epermError = () => {
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
    }
    const aliveProbe = () => undefined

    expect(isPidAbsent(9001, esrchError)).toBe(true)
    expect(isPidAbsent(9001, aliveProbe)).toBe(false)
    expect(isPidAbsent(9001, epermError)).toBe(false)

    // Branch 1: Converter exited and probePid throws ESRCH (PID not reused) -> run taskkill /T /F, no process.kill
    const taskkillOnEsrch: number[] = []
    const killPidOnEsrch: Array<[number, string]> = []
    killProcessTree(9001, true, {
      platform: 'win32',
      probePid: esrchError,
      runTaskkill: (pid) => taskkillOnEsrch.push(pid),
      killPid: (pid, sig) => killPidOnEsrch.push([pid, sig]),
    })
    expect(taskkillOnEsrch).toEqual([9001])
    expect(killPidOnEsrch).toEqual([])

    // Branch 2a: Converter exited and probePid succeeds (PID reused by another process) -> skip taskkill
    const taskkillOnReused: number[] = []
    killProcessTree(9002, true, {
      platform: 'win32',
      probePid: aliveProbe,
      runTaskkill: (pid) => taskkillOnReused.push(pid),
    })
    expect(taskkillOnReused).toEqual([])

    // Branch 2b: Converter exited and probePid throws EPERM (PID reused by another user/elevated process) -> skip taskkill
    const taskkillOnEperm: number[] = []
    killProcessTree(9003, true, {
      platform: 'win32',
      probePid: epermError,
      runTaskkill: (pid) => taskkillOnEperm.push(pid),
    })
    expect(taskkillOnEperm).toEqual([])

    // Live root (rootAlreadyExited = false): always runs taskkill and SIGKILLs root
    const taskkillOnLive: number[] = []
    const killPidOnLive: Array<[number, string]> = []
    killProcessTree(9004, false, {
      platform: 'win32',
      probePid: aliveProbe,
      runTaskkill: (pid) => taskkillOnLive.push(pid),
      killPid: (pid, sig) => killPidOnLive.push([pid, sig]),
    })
    expect(taskkillOnLive).toEqual([9004])
    expect(killPidOnLive).toEqual([[9004, 'SIGKILL']])
  })
  it('POSIX tree killer sends SIGSTOP to root before killing descendants and falls back to ps when pgrep fails (R1-5, R1-6)', () => {
    const signals: Array<[number, string]> = []
    const psOutput = [
      '  100     1',
      '  200   100',
      '  201   100',
      '  300   200',
      '  999     1',
    ].join('\n')

    // 1. Verify ps parser orders descendants leaf-first (300 before 200)
    expect(collectPosixDescendantsFromPsOutput(psOutput, 100)).toEqual([300, 200, 201])

    // 2. When pgrep fails (e.g. ENOENT or status 2), listPosixDescendants falls back to ps
    const descendantsOnPgrepFailure = listPosixDescendants(100, (cmd) => {
      if (cmd === 'pgrep') {
        return { status: null, error: new Error('spawnSync pgrep ENOENT'), stdout: '' }
      }
      return { status: 0, stdout: psOutput }
    })
    expect(descendantsOnPgrepFailure).toEqual([300, 200, 201])

    // 3. killPosixProcessTree sends SIGSTOP to root first, then SIGKILLs leaves, then SIGKILLs root
    killPosixProcessTree(
      100,
      (cmd) => {
        if (cmd === 'pgrep') {
          return { status: 2, stdout: '' }
        }
        return { status: 0, stdout: psOutput }
      },
      (pid, sig) => {
        signals.push([pid, sig])
      },
    )

    expect(signals).toEqual([
      [100, 'SIGSTOP'],
      [300, 'SIGKILL'],
      [200, 'SIGKILL'],
      [201, 'SIGKILL'],
      [100, 'SIGKILL'],
    ])
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
        emitter.emit('exit', 0)
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
  it('exercises the shared runPdfConvertExportFlow + cancelActivePdfConvert across docx, pptx, and xlsx: emits done once before write and notice, makes post-commit cancel a no-op, and never double-sends done (R1-7 + FE-R1-2 + R2-4)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uniwork-pdf-export-flow-'))
    try {
      const kinds = ['docx', 'pptx', 'xlsx'] as const
      const senderId = 701

      for (const kind of kinds) {
        const target = join(dir, `converted.${kind}`)
        writeFileSync(target, 'old-destination-bytes', 'utf8')

        const trace: string[] = []
        const progressEvents: PdfConvertProgressEvent[] = []
        const newBytes = new TextEncoder().encode(`new-${kind}-bytes`)

        const { promise: writeEntered, resolve: notifyWriteEntered } = Promise.withResolvers<void>()
        const { promise: writeGate, resolve: releaseWrite } = Promise.withResolvers<void>()
        const { promise: noticeEntered, resolve: notifyNoticeEntered } =
          Promise.withResolvers<void>()
        const { promise: noticeGate, resolve: releaseNotice } = Promise.withResolvers<void>()
        const closePwd = () => {
          trace.push('password:close')
        }

        const exportPromise = runPdfConvertExportFlow({
          kind,
          pdfPath: `/tmp/source-${kind}.pdf`,
          senderId,
          prepareTarget: () => Promise.resolve(target),
          setProgressBar: (value) => {
            trace.push(`progressBar:${value}`)
          },
          sendProgress: (payload) => {
            progressEvents.push(payload)
            trace.push(
              payload.done
                ? `done:${payload.page}/${payload.total}`
                : `progress:${payload.page}/${payload.total}`,
            )
          },
          closePasswordDialog: closePwd,
          promptPassword: () => Promise.resolve(null),
          convertDocx: (_pdfPath, _prompt, onProgress) => {
            onProgress(1, 2)
            onProgress(2, 2)
            return Promise.resolve({
              docx: newBytes,
              pages: 2,
              warnings: [],
              pageResults: [
                { page: 1, status: 'ok' as const },
                { page: 2, status: 'ocr' as const, confidence: 0.95 },
              ],
              scannedDocument: false,
            })
          },
          convertPptx: (_pdfPath, _prompt, onProgress) => {
            onProgress(1, 2)
            onProgress(2, 2)
            return Promise.resolve({
              pptx: newBytes,
              pages: 2,
              warnings: [],
              pageResults: [
                { page: 1, status: 'ok' as const },
                { page: 2, status: 'degraded' as const },
              ],
              scannedDocument: false,
            })
          },
          convertXlsx: (_pdfPath, _prompt, onProgress) => {
            onProgress(1, 2)
            onProgress(2, 2)
            return Promise.resolve({
              xlsx: newBytes,
              pages: 2,
              warnings: [],
              pageResults: [
                { page: 1, status: 'ok' as const },
                { page: 2, status: 'degraded' as const },
              ],
              scannedDocument: false,
            })
          },
          writeDocx: async (outPath, res) => {
            trace.push('write:start')
            notifyWriteEntered()
            await writeGate
            await atomicWriteFile(outPath, res.docx)
            trace.push('write:end')
          },
          writePptx: async (outPath, res) => {
            trace.push('write:start')
            notifyWriteEntered()
            await writeGate
            await atomicWriteFile(outPath, res.pptx)
            trace.push('write:end')
          },
          writeXlsx: async (outPath, res) => {
            trace.push('write:start')
            notifyWriteEntered()
            await writeGate
            await atomicWriteFile(outPath, res.xlsx)
            trace.push('write:end')
          },
          showDocxNotice: async () => {
            trace.push('notice:start')
            notifyNoticeEntered()
            await noticeGate
            trace.push('notice:end')
          },
          showPptxNotice: async () => {
            trace.push('notice:start')
            notifyNoticeEntered()
            await noticeGate
            trace.push('notice:end')
          },
          showXlsxNotice: async () => {
            trace.push('notice:start')
            notifyNoticeEntered()
            await noticeGate
            trace.push('notice:end')
          },
          showError: () => {
            trace.push('error:shown')
          },
        })

        // Wait until the flow has entered the write callback (before atomicWriteFile runs)
        await writeEntered

        // At the write boundary (before disk persistence and before notice dialog):
        // 1. done:true has already been emitted once
        // 2. password dialog was closed and progress bar reset to -1
        // 3. existing destination still has old bytes until writeGate releases
        expect(progressEvents.filter((e) => e.done)).toEqual([
          { format: kind, page: 2, total: 2, done: true },
        ])
        expect(readFileSync(target, 'utf8')).toBe('old-destination-bytes')
        expect(trace).toEqual([
          'progressBar:2',
          'progress:0/0',
          'progressBar:0.5',
          'progress:1/2',
          'progressBar:1',
          'progress:2/2',
          'password:close',
          'done:2/2',
          'progressBar:-1',
          'write:start',
        ])

        // Cancel after the commit point is a no-op
        expect(cancelActivePdfConvert(senderId, senderId, closePwd)).toBe(false)

        // Release the write and wait until the completion notice dialog is held open
        releaseWrite()
        await noticeEntered

        expect(readFileSync(target, 'utf8')).toBe(`new-${kind}-bytes`)
        expect(cancelActivePdfConvert(senderId, senderId, closePwd)).toBe(false)
        expect(progressEvents.filter((e) => e.done)).toHaveLength(1)

        // Release the notice dialog and verify the flow finishes without a duplicate done event
        releaseNotice()
        expect(await exportPromise).toBe(target)
        expect(progressEvents.filter((e) => e.done)).toHaveLength(1)
        expect(trace).toEqual([
          'progressBar:2',
          'progress:0/0',
          'progressBar:0.5',
          'progress:1/2',
          'progressBar:1',
          'progress:2/2',
          'password:close',
          'done:2/2',
          'progressBar:-1',
          'write:start',
          'write:end',
          'notice:start',
          'notice:end',
          'password:close',
        ])
      }

      // Also verify pre-commit cancel aborts the in-flight conversion, leaves destination intact,
      // and sends done:true once from finally
      const cancelTarget = join(dir, 'cancelled.docx')
      writeFileSync(cancelTarget, 'untouched', 'utf8')
      const cancelEvents: PdfConvertProgressEvent[] = []
      const { promise: inFlight, resolve: notifyInFlight } = Promise.withResolvers<void>()

      const cancelledFlow = runPdfConvertExportFlow({
        kind: 'docx',
        pdfPath: '/tmp/cancel.pdf',
        senderId,
        prepareTarget: () => Promise.resolve(cancelTarget),
        setProgressBar: () => undefined,
        sendProgress: (p) => cancelEvents.push(p),
        closePasswordDialog: () => undefined,
        promptPassword: () => Promise.resolve(null),
        convertDocx: (_pdfPath, _prompt, onProgress, signal) => {
          const { promise, reject } = Promise.withResolvers<{
            docx: Uint8Array
            pages: number
            warnings: string[]
            pageResults: Array<{ page: number; status: 'ok' }>
            scannedDocument: boolean
          } | null>()
          onProgress(1, 4)
          notifyInFlight()
          signal.addEventListener(
            'abort',
            () => {
              reject(new PdfConvertCancelled())
            },
            { once: true },
          )
          return promise
        },
        convertPptx: () => Promise.resolve(null),
        convertXlsx: () => Promise.resolve(null),
        writeDocx: async () => {
          throw new Error('should not write on cancel')
        },
        writePptx: async () => undefined,
        writeXlsx: async () => undefined,
        showDocxNotice: async () => {
          throw new Error('should not show notice on cancel')
        },
        showPptxNotice: async () => undefined,
        showXlsxNotice: async () => undefined,
        showError: () => {
          throw new Error('should not show error dialog on cancel')
        },
      })

      await inFlight
      expect(cancelActivePdfConvert(999, 999)).toBe(false)
      expect(cancelActivePdfConvert(senderId, senderId)).toBe(true)
      expect(await cancelledFlow).toBeNull()
      expect(readFileSync(cancelTarget, 'utf8')).toBe('untouched')
      expect(cancelEvents.filter((e) => e.done)).toEqual([
        { format: 'docx', page: 1, total: 4, done: true },
      ])
      expect(
        beginPdfConvertCommitPhase({
          isAborted: () => true,
          disableCancel: () => undefined,
          closePasswordDialog: () => undefined,
          sendDoneProgress: () => undefined,
          resetProgressBar: () => undefined,
        }),
      ).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stops after prepareTarget when the owner window is destroyed during held preparation while another window stays alive across docx, pptx, and xlsx (R3-1)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uniwork-pdf-owner-destroyed-'))
    try {
      const kinds = ['docx', 'pptx', 'xlsx'] as const
      const secondWindow = { destroyed: false }

      for (const kind of kinds) {
        const target = join(dir, `existing-${kind}.${kind}`)
        writeFileSync(target, 'old-destination-bytes', 'utf8')

        const ownerWindow = { destroyed: false }
        const senderId = 810
        const trace: string[] = []
        const { promise: prepareEntered, resolve: notifyPrepareEntered } =
          Promise.withResolvers<void>()
        const { promise: prepareGate, resolve: releasePrepare } = Promise.withResolvers<string>()

        const exportPromise = runPdfConvertExportFlow({
          kind,
          pdfPath: `/tmp/source-${kind}.pdf`,
          senderId,
          isHostDestroyed: () => ownerWindow.destroyed,
          prepareTarget: async () => {
            trace.push('prepare:start')
            notifyPrepareEntered()
            const resolvedTarget = await prepareGate
            trace.push('prepare:end')
            return resolvedTarget
          },
          setProgressBar: (value) => {
            trace.push(`progressBar:${value}`)
          },
          sendProgress: (payload) => {
            trace.push(`progress:${payload.page}/${payload.total}:${Boolean(payload.done)}`)
          },
          closePasswordDialog: () => {
            trace.push('password:close')
          },
          promptPassword: () => {
            trace.push('password:prompt')
            return Promise.resolve(null)
          },
          convertDocx: () => {
            trace.push('convert:docx')
            return Promise.resolve(null)
          },
          convertPptx: () => {
            trace.push('convert:pptx')
            return Promise.resolve(null)
          },
          convertXlsx: () => {
            trace.push('convert:xlsx')
            return Promise.resolve(null)
          },
          writeDocx: async () => {
            trace.push('write:docx')
          },
          writePptx: async () => {
            trace.push('write:pptx')
          },
          writeXlsx: async () => {
            trace.push('write:xlsx')
          },
          showDocxNotice: async () => {
            trace.push('notice:docx')
          },
          showPptxNotice: async () => {
            trace.push('notice:pptx')
          },
          showXlsxNotice: async () => {
            trace.push('notice:xlsx')
          },
          showError: () => {
            trace.push('error:shown')
          },
        })

        await prepareEntered
        // Destroy owner window while target preparation is held; secondWindow remains alive
        ownerWindow.destroyed = true
        expect(secondWindow.destroyed).toBe(false)
        releasePrepare(target)

        expect(await exportPromise).toBeNull()
        expect(readFileSync(target, 'utf8')).toBe('old-destination-bytes')
        expect(trace).toEqual(['prepare:start', 'prepare:end', 'password:close'])
        // Export ownership is cleared so cancelActivePdfConvert is false and another live window can export
        expect(cancelActivePdfConvert(senderId, senderId)).toBe(false)
      }

      // Follow-up export on the remaining live window works normally
      const liveTarget = join(dir, 'live-window.docx')
      writeFileSync(liveTarget, 'old-live', 'utf8')
      const liveBytes = new TextEncoder().encode('new-live-docx')
      const liveResult = await runPdfConvertExportFlow({
        kind: 'docx',
        pdfPath: '/tmp/live.pdf',
        senderId: 811,
        isHostDestroyed: () => secondWindow.destroyed,
        prepareTarget: () => Promise.resolve(liveTarget),
        setProgressBar: () => undefined,
        sendProgress: () => undefined,
        closePasswordDialog: () => undefined,
        promptPassword: () => Promise.resolve(null),
        convertDocx: () =>
          Promise.resolve({
            docx: liveBytes,
            pages: 1,
            warnings: [],
            pageResults: [{ page: 1, status: 'ok' as const }],
            scannedDocument: false,
          }),
        convertPptx: () => Promise.resolve(null),
        convertXlsx: () => Promise.resolve(null),
        writeDocx: async (outPath, res) => {
          await atomicWriteFile(outPath, res.docx)
        },
        writePptx: async () => undefined,
        writeXlsx: async () => undefined,
        showDocxNotice: async () => undefined,
        showPptxNotice: async () => undefined,
        showXlsxNotice: async () => undefined,
        showError: () => undefined,
      })
      expect(liveResult).toBe(liveTarget)
      expect(readFileSync(liveTarget, 'utf8')).toBe('new-live-docx')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('maps PdfConvertCrashed to localized pdfDocxLocalCrashedDetail in all locales while logging the technical message to the console', async () => {
    const indexSource = readFileSync(
      fileURLToPath(new URL('../src/main/index.ts', import.meta.url)),
      'utf8',
    )
    expect(indexSource).toContain('formatPdfConvertErrorDetail(err, {')
    expect(indexSource).toContain("crashed: tm('pdfDocxLocalCrashedDetail')")

    // Verify every locale block in tMain defines a non-empty localized pdfDocxLocalCrashedDetail
    const tableSlice = indexSource.slice(
      indexSource.indexOf('const tMain = createI18n('),
      indexSource.indexOf('const tm = '),
    )
    const localeHeaders = [...tableSlice.matchAll(/\n {2}(?:'([^']+)'|(\w+)): \{/g)].map(
      (m) => m[1] ?? m[2]!,
    )
    expect(localeHeaders.length).toBe(21)

    const crashedByLocale = new Map<string, string>()
    for (let i = 0; i < localeHeaders.length; i++) {
      const locale = localeHeaders[i]!
      const headerPattern = locale.includes('-') ? `'${locale}': {` : `${locale}: {`
      const start = tableSlice.indexOf(`\n  ${headerPattern}`)
      const nextLocale = localeHeaders[i + 1]
      const nextPattern = nextLocale
        ? nextLocale.includes('-')
          ? `\n  '${nextLocale}': {`
          : `\n  ${nextLocale}: {`
        : '\n})'
      const end = tableSlice.indexOf(nextPattern, start + 1)
      const block = tableSlice.slice(start, end)
      const match = block.match(/pdfDocxLocalCrashedDetail:\s*(?:'([^']*)'|"([^"]*)")/)
      const value = match?.[1] ?? match?.[2]
      expect(value, `missing pdfDocxLocalCrashedDetail in ${locale}`).toBeTruthy()
      crashedByLocale.set(locale, value!)
    }

    expect(crashedByLocale.get('en')).toBe(
      'The conversion process stopped unexpectedly. Please try again.',
    )
    expect(crashedByLocale.get('vi')).toBe(
      'Quá trình chuyển đổi đã dừng đột ngột. Vui lòng thử lại.',
    )
    expect(crashedByLocale.get('zh')).toBe('转换进程意外停止，请重试。')

    const copyVi = {
      encrypted: 'Tệp PDF này đã được mã hóa và không thể mở nếu không có mật khẩu chính xác.',
      unsupported:
        'Tệp PDF này sử dụng mã hóa dựa trên chứng thư số hoặc mã hóa không được hỗ trợ khác và không thể chuyển đổi.',
      corrupt: 'Tệp bị hỏng hoặc không phải là tệp PDF hợp lệ và không thể chuyển đổi.',
      crashed: crashedByLocale.get('vi')!,
    }

    // 1. Exit crash: localized detail returned, raw technical message logged to console.error
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const exitCrash = new PdfConvertCrashed(1)
      expect(formatPdfConvertErrorDetail(exitCrash, copyVi)).toBe(
        'Quá trình chuyển đổi đã dừng đột ngột. Vui lòng thử lại.',
      )
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[shell] pdf convert crashed:',
        'PDF conversion process exited unexpectedly without a result (exit code 1)',
      )

      // 2. Watchdog crash: localized detail returned, watchdog technical message logged
      consoleErrorSpy.mockClear()
      const watchdogCrash = new PdfConvertCrashed(
        null,
        'PDF conversion process timed out after 180000ms without progress',
      )
      expect(formatPdfConvertErrorDetail(watchdogCrash, copyVi)).toBe(
        'Quá trình chuyển đổi đã dừng đột ngột. Vui lòng thử lại.',
      )
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[shell] pdf convert crashed:',
        'PDF conversion process timed out after 180000ms without progress',
      )

      // 3. PdfLoadError codes and ordinary Error still map as before without crash logging
      consoleErrorSpy.mockClear()
      expect(formatPdfConvertErrorDetail(new PdfLoadError('password-required', 4), copyVi)).toBe(
        copyVi.encrypted,
      )
      expect(formatPdfConvertErrorDetail(new PdfLoadError('unsupported', 5), copyVi)).toBe(
        copyVi.unsupported,
      )
      expect(formatPdfConvertErrorDetail(new PdfLoadError('corrupt', 3), copyVi)).toBe(
        copyVi.corrupt,
      )
      expect(formatPdfConvertErrorDetail(new Error('disk full'), copyVi)).toBe('disk full')
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
