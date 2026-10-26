/**
 * Host-side runner for local PDF -> Office conversions (UNI-2167).
 *
 * Spawns one Electron `utilityProcess` (or an injected `fork` in unit tests)
 * per conversion attempt, forwards per-page progress, reconstructs
 * `PdfLoadError` with its `code` and `pdfiumError`, and guarantees no orphan
 * processes (utility process or OCR helpers spawned via `spawnSync` inside it)
 * remain after completion, cancel, crash, or `before-quit`.
 */
import { fork as nodeFork, spawnSync, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MessageChannel } from 'node:worker_threads'
import type { PageResult } from '../../../../../packages/pdf2docx/src'
import {
  PdfLoadError,
  type PdfLoadErrorCode,
} from '../../../../../packages/pdf2docx/src/extract/pdfium'
import type { ConvertChildPort, PdfConvertJob, PdfConvertKind } from './convert-child'

export type { PdfConvertChildMessage, PdfConvertJob, PdfConvertKind } from './convert-child'

/** Default per-message inactivity timeout (3 minutes: covers 90 s Tesseract + 30 s system OCR). */
const DEFAULT_WATCHDOG_MS = 180_000

export class PdfConvertCancelled extends Error {
  readonly code = 'cancelled' as const

  constructor(message = 'PDF conversion was cancelled') {
    super(message)
    this.name = 'PdfConvertCancelled'
  }
}

export class PdfConvertCrashed extends Error {
  readonly code = 'crashed' as const
  readonly exitCode: number | null

  constructor(exitCode: number | null, detail?: string) {
    super(
      detail ??
        `PDF conversion process exited unexpectedly without a result (exit code ${exitCode ?? 'unknown'})`,
    )
    this.name = 'PdfConvertCrashed'
    this.exitCode = exitCode
  }
}

export type ConvertChildMessageListener = (message: unknown) => void
export type ConvertChildExitListener = (code: number | null) => void

export interface ConvertChildProcess {
  readonly pid: number | undefined
  postMessage(message: PdfConvertJob): void
  on(event: 'message', listener: ConvertChildMessageListener): unknown
  on(event: 'exit', listener: ConvertChildExitListener): unknown
  off?(event: 'message', listener: ConvertChildMessageListener): unknown
  off?(event: 'exit', listener: ConvertChildExitListener): unknown
  removeListener?(event: 'message', listener: ConvertChildMessageListener): unknown
  removeListener?(event: 'exit', listener: ConvertChildExitListener): unknown
  kill(): boolean
}

export type PdfConvertForkFn = (modulePath: string) => ConvertChildProcess

export interface PdfConvertHostResult {
  kind: PdfConvertKind
  bytes: Uint8Array
  pages: number
  warnings: string[]
  pageResults: PageResult[]
  scannedDocument: boolean
}

export interface RunPdfConvertOptions {
  onProgress?: (page: number, total: number) => void
  signal?: AbortSignal
  fork?: PdfConvertForkFn
  modulePath?: string
  /** Per-message inactivity timeout in ms (default 180_000; <= 0 disables). */
  watchdogMs?: number
}

function killPosixDescendants(parentPid: number): void {
  try {
    const res = spawnSync('pgrep', ['-P', String(parentPid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    })
    if (res.stdout) {
      for (const token of res.stdout.split(/\s+/)) {
        const childPid = Number(token.trim())
        if (Number.isInteger(childPid) && childPid > 0 && childPid !== parentPid) {
          killPosixDescendants(childPid)
          try {
            process.kill(childPid, 'SIGKILL')
          } catch {
            // already exited
          }
        }
      }
    }
  } catch {
    // pgrep unavailable or failed
  }
}

/**
 * Terminate a process and all descendants it spawned (such as `tess-ocr.cjs`
 * or `win-ocr.exe` started via `spawnSync`). Targets only the owned PID, never
 * image names.
 */
export function killProcessTree(pid: number | undefined): void {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5_000,
      })
    } catch {
      // fall through to direct kill
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already exited
    }
    return
  }

  killPosixDescendants(pid)
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already exited
  }
}

/**
 * Build a `PdfConvertForkFn` backed by Node's `child_process.fork` (with V8
 * structured-clone serialization so `Uint8Array` transfers in binary). Used by
 * unit tests to drive `runPdfConvertJob` with real OS child processes.
 */
export function createNodeChildProcessFork(
  overrideModulePath?: string,
  execArgv?: string[],
): PdfConvertForkFn {
  return (defaultModulePath: string): ConvertChildProcess => {
    const target = overrideModulePath ?? defaultModulePath
    const child: ChildProcess = nodeFork(target, [], {
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, PDF_CONVERT_CHILD_ENTRY: '1' },
      ...(execArgv ? { execArgv } : {}),
    })
    return {
      get pid() {
        return child.pid
      },
      postMessage(msg: PdfConvertJob) {
        if (child.connected) {
          child.send(msg)
        }
      },
      on(
        event: 'message' | 'exit',
        listener: ConvertChildMessageListener | ConvertChildExitListener,
      ) {
        if (event === 'message') {
          child.on('message', listener as ConvertChildMessageListener)
        } else {
          child.on('exit', listener as ConvertChildExitListener)
        }
        return this
      },
      off(
        event: 'message' | 'exit',
        listener: ConvertChildMessageListener | ConvertChildExitListener,
      ) {
        if (event === 'message') {
          child.off('message', listener as ConvertChildMessageListener)
        } else {
          child.off('exit', listener as ConvertChildExitListener)
        }
        return this
      },
      removeListener(
        event: 'message' | 'exit',
        listener: ConvertChildMessageListener | ConvertChildExitListener,
      ) {
        if (event === 'message') {
          child.removeListener('message', listener as ConvertChildMessageListener)
        } else {
          child.removeListener('exit', listener as ConvertChildExitListener)
        }
        return this
      },
      kill() {
        return child.kill('SIGKILL')
      },
    }
  }
}

/**
 * In-process MessageChannel adapter used only when running inside Vitest (no
 * Electron `utilityProcess` and no custom `fork` passed). Exercises the full
 * message serialization / error round-trip protocol.
 */
function createInProcessFork(): ConvertChildProcess {
  const { port1, port2 } = new MessageChannel()
  const emitter = new EventEmitter()
  let closed = false

  port1.on('message', (msg) => {
    if (!closed) emitter.emit('message', msg)
  })
  const childSpec = './convert-child'
  // Dynamic import only in Vitest (where Electron utilityProcess is absent) so the
  // shell main bundle never statically links the child entry into index.js.
  void (
    import(/* @vite-ignore */ childSpec) as Promise<{
      attachConvertChild(port: ConvertChildPort, keepAliveForHostKill?: boolean): void
    }>
  ).then(({ attachConvertChild }) => {
    if (closed) return
    attachConvertChild(
      {
        on: (_event, listener) => port2.on('message', listener),
        postMessage: (msg) => {
          if (!closed) port2.postMessage(msg)
        },
      },
      false,
    )
  })
  return {
    get pid() {
      return undefined
    },
    postMessage(msg: PdfConvertJob) {
      if (!closed) port1.postMessage(msg)
    },
    on(
      event: 'message' | 'exit',
      listener: ConvertChildMessageListener | ConvertChildExitListener,
    ) {
      emitter.on(event, listener)
      return this
    },
    off(
      event: 'message' | 'exit',
      listener: ConvertChildMessageListener | ConvertChildExitListener,
    ) {
      emitter.off(event, listener)
      return this
    },
    removeListener(
      event: 'message' | 'exit',
      listener: ConvertChildMessageListener | ConvertChildExitListener,
    ) {
      emitter.removeListener(event, listener)
      return this
    },
    kill() {
      if (closed) return false
      closed = true
      port1.close()
      port2.close()
      emitter.emit('exit', 0)
      return true
    },
  }
}

interface ElectronUtilityProcessModule {
  fork(modulePath: string, args?: string[], options?: { serviceName?: string }): ConvertChildProcess
}

function resolveElectronUtilityProcess(): ElectronUtilityProcessModule | null {
  if (!process.versions.electron) return null
  try {
    const req = createRequire(import.meta.url)
    const electron = req('electron') as { utilityProcess?: ElectronUtilityProcessModule }
    if (electron && typeof electron.utilityProcess?.fork === 'function') {
      return electron.utilityProcess
    }
  } catch {
    // not running under Electron main
  }
  return null
}

export function defaultConvertChildModulePath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, 'convert-child.js')
}

const defaultFork: PdfConvertForkFn = (modulePath: string): ConvertChildProcess => {
  const utilityProcess = resolveElectronUtilityProcess()
  if (utilityProcess) {
    return utilityProcess.fork(modulePath, [], { serviceName: 'UniWork PDF Converter' })
  }
  return createInProcessFork()
}

function toUint8Array(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw)
  }
  if (
    raw &&
    typeof raw === 'object' &&
    'type' in raw &&
    raw.type === 'Buffer' &&
    'data' in raw &&
    Array.isArray(raw.data)
  ) {
    return Uint8Array.from(raw.data as number[])
  }
  throw new Error('Invalid output bytes received from PDF conversion process')
}

function isPdfLoadErrorCode(code: unknown): code is PdfLoadErrorCode {
  return code === 'password-required' || code === 'corrupt' || code === 'unsupported'
}

function reconstructChildError(msg: Record<string, unknown>): Error {
  const name = typeof msg.name === 'string' && msg.name ? msg.name : 'Error'
  const message = typeof msg.message === 'string' ? msg.message : 'PDF conversion failed'
  const code = msg.code
  const pdfiumError = typeof msg.pdfiumError === 'number' ? msg.pdfiumError : 0

  if (name === 'PdfLoadError' && isPdfLoadErrorCode(code)) {
    return new PdfLoadError(code, pdfiumError)
  }
  const err = new Error(message)
  err.name = name
  if (typeof code === 'string') {
    Object.assign(err, { code })
  }
  if (typeof msg.pdfiumError === 'number') {
    Object.assign(err, { pdfiumError: msg.pdfiumError })
  }
  return err
}

interface LiveJobHandle {
  abortOnQuit(): void
}

const liveJobs = new Set<LiveJobHandle>()

/** Kill all active PDF conversion jobs and their process trees (called on `before-quit`). */
export function killAllPdfConvertJobs(): void {
  for (const job of [...liveJobs]) {
    job.abortOnQuit()
  }
}

/** Number of in-flight conversion jobs (exposed for diagnostics and leak tests). */
export function activePdfConvertJobCount(): number {
  return liveJobs.size
}

/**
 * Run one PDF -> Office conversion attempt in a child process.
 */
export function runPdfConvertJob(
  job: PdfConvertJob,
  options: RunPdfConvertOptions = {},
): Promise<PdfConvertHostResult> {
  const {
    onProgress,
    signal,
    fork = defaultFork,
    modulePath = defaultConvertChildModulePath(),
    watchdogMs = DEFAULT_WATCHDOG_MS,
  } = options

  if (signal?.aborted) {
    return Promise.reject(new PdfConvertCancelled())
  }

  return new Promise<PdfConvertHostResult>((resolve, reject) => {
    let child: ConvertChildProcess
    try {
      child = fork(modulePath)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    let settled = false
    let capturedPid: number | undefined = child.pid
    let watchdogTimer: NodeJS.Timeout | null = null

    const clearWatchdog = () => {
      if (watchdogTimer !== null) {
        clearTimeout(watchdogTimer)
        watchdogTimer = null
      }
    }

    const terminateChild = () => {
      const pid = child.pid ?? capturedPid
      if (typeof pid === 'number' && pid > 0) {
        killProcessTree(pid)
      }
      try {
        child.kill()
      } catch {
        // already exited
      }
    }

    const cleanup = () => {
      clearWatchdog()
      liveJobs.delete(liveHandle)
      if (typeof child.off === 'function') {
        child.off('message', onMessage)
        child.off('exit', onExit)
      } else if (typeof child.removeListener === 'function') {
        child.removeListener('message', onMessage)
        child.removeListener('exit', onExit)
      }
      signal?.removeEventListener('abort', onAbort)
    }

    const armWatchdog = () => {
      clearWatchdog()
      if (watchdogMs <= 0) return
      watchdogTimer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        terminateChild()
        reject(
          new PdfConvertCrashed(
            null,
            `PDF conversion process timed out after ${watchdogMs}ms without progress`,
          ),
        )
      }, watchdogMs)
      watchdogTimer.unref?.()
    }

    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      terminateChild()
      reject(new PdfConvertCancelled())
    }

    const onExit = (code: number | null) => {
      if (settled) return
      settled = true
      cleanup()
      terminateChild()
      reject(new PdfConvertCrashed(typeof code === 'number' ? code : null))
    }

    const onMessage = (raw: unknown) => {
      if (settled) return
      if (typeof child.pid === 'number') {
        capturedPid = child.pid
      }
      armWatchdog()

      const unwrapped =
        raw && typeof raw === 'object' && 'data' in raw && !('type' in raw) ? raw.data : raw
      if (!unwrapped || typeof unwrapped !== 'object' || !('type' in unwrapped)) return
      const msg = unwrapped as Record<string, unknown>

      if (msg.type === 'progress') {
        if (
          typeof msg.page === 'number' &&
          Number.isFinite(msg.page) &&
          typeof msg.total === 'number' &&
          Number.isFinite(msg.total)
        ) {
          onProgress?.(msg.page, msg.total)
        }
        return
      }

      if (msg.type === 'result') {
        let bytes: Uint8Array
        try {
          bytes = toUint8Array(msg.bytes)
        } catch (err) {
          settled = true
          cleanup()
          terminateChild()
          reject(err instanceof Error ? err : new Error(String(err)))
          return
        }
        settled = true
        cleanup()
        terminateChild()
        const kind =
          msg.kind === 'docx' || msg.kind === 'pptx' || msg.kind === 'xlsx' ? msg.kind : job.kind
        const pages = typeof msg.pages === 'number' && Number.isFinite(msg.pages) ? msg.pages : 0
        const warnings = Array.isArray(msg.warnings)
          ? msg.warnings.filter((w): w is string => typeof w === 'string')
          : []
        const pageResults = Array.isArray(msg.pageResults) ? (msg.pageResults as PageResult[]) : []
        const scannedDocument = msg.scannedDocument === true
        resolve({
          kind,
          bytes,
          pages,
          warnings,
          pageResults,
          scannedDocument,
        })
        return
      }

      if (msg.type === 'error') {
        settled = true
        cleanup()
        terminateChild()
        reject(reconstructChildError(msg))
      }
    }

    const liveHandle: LiveJobHandle = {
      abortOnQuit: onAbort,
    }
    liveJobs.add(liveHandle)

    child.on('message', onMessage)
    child.on('exit', onExit)
    signal?.addEventListener('abort', onAbort, { once: true })
    armWatchdog()

    try {
      child.postMessage(job)
      if (typeof child.pid === 'number') {
        capturedPid = child.pid
      }
    } catch (err) {
      if (!settled) {
        settled = true
        cleanup()
        terminateChild()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
  })
}
