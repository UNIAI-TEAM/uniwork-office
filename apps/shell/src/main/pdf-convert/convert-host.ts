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

/**
 * Default per-message inactivity timeout (3 minutes: covers 90 s Tesseract + 30 s system OCR).
 * Armed only after the first `progress` message arrives: before that, the initial
 * whole-document extraction pass in @genoffice/pdf2docx runs without progress messages
 * and may legitimately take longer on large PDFs (the user's Cancel button is the
 * remedy for a stuck initial extraction; R1-11).
 */
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
export type ConvertChildSpawnListener = () => void

export interface ConvertChildProcess {
  readonly pid: number | undefined
  /**
   * When true, the process spawns asynchronously and emits `'spawn'` once its
   * OS PID is assigned (or `'exit'` if spawn fails). Electron `utilityProcess`
   * instances (which expose `stdout`/`stderr`) are detected automatically;
   * custom test fork adapters with asynchronous PID assignment can set this
   * flag or expose `stdout`/`stderr` to defer `postMessage(job)` until `'spawn'`.
   */
  readonly awaitsSpawn?: boolean
  postMessage(message: PdfConvertJob): void
  on(event: 'message', listener: ConvertChildMessageListener): unknown
  on(event: 'exit', listener: ConvertChildExitListener): unknown
  on(event: 'spawn', listener: ConvertChildSpawnListener): unknown
  off?(event: 'message', listener: ConvertChildMessageListener): unknown
  off?(event: 'exit', listener: ConvertChildExitListener): unknown
  off?(event: 'spawn', listener: ConvertChildSpawnListener): unknown
  removeListener?(event: 'message', listener: ConvertChildMessageListener): unknown
  removeListener?(event: 'exit', listener: ConvertChildExitListener): unknown
  removeListener?(event: 'spawn', listener: ConvertChildSpawnListener): unknown
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
export interface CommitPdfConvertPhaseContext {
  isAborted(): boolean
  disableCancel(): void
  closePasswordDialog(): void
  sendDoneProgress(): void
  resetProgressBar(): void
}

/**
 * Execute the non-cancellable commit boundary (R1-7 + FE-R1-2):
 * Called immediately after the conversion child returns its result bytes and
 * before `atomicWriteFile`. If already aborted, returns `false` so nothing is
 * written. Otherwise disables `convertCancel`, closes the password dialog,
 * emits the single `{ done: true }` progress event, and resets the window
 * progress bar before disk write and completion notice dialogs run.
 */
export function beginPdfConvertCommitPhase(ctx: CommitPdfConvertPhaseContext): boolean {
  if (ctx.isAborted()) return false
  ctx.disableCancel()
  ctx.closePasswordDialog()
  ctx.sendDoneProgress()
  ctx.resetProgressBar()
  return true
}

export type PosixSpawnSyncFn = (
  command: string,
  args: string[],
) => { status: number | null; error?: Error; stdout: string }

const defaultPosixSpawnSync: PosixSpawnSyncFn = (command, args) => {
  const res = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 2_000,
  })
  return {
    status: res.status,
    ...(res.error ? { error: res.error } : {}),
    stdout: typeof res.stdout === 'string' ? res.stdout : '',
  }
}

/**
 * Parse `ps -A -o pid=,ppid=` output and return all descendant PIDs of `rootPid`
 * in bottom-up (leaf-first) order so children are killed before their parents.
 */
export function collectPosixDescendantsFromPsOutput(stdout: string, rootPid: number): number[] {
  const childrenByParent = new Map<number, number[]>()
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    if (parts.length < 2) continue
    const pid = Number(parts[0])
    const ppid = Number(parts[1])
    if (
      Number.isInteger(pid) &&
      pid > 0 &&
      Number.isInteger(ppid) &&
      ppid >= 0 &&
      pid !== ppid &&
      pid !== process.pid
    ) {
      let list = childrenByParent.get(ppid)
      if (!list) {
        list = []
        childrenByParent.set(ppid, list)
      }
      list.push(pid)
    }
  }
  const visited = new Set<number>([rootPid])
  const ordered: number[] = []
  const walk = (parentPid: number) => {
    const kids = childrenByParent.get(parentPid)
    if (!kids) return
    for (const childPid of kids) {
      if (visited.has(childPid)) continue
      visited.add(childPid)
      walk(childPid)
      ordered.push(childPid)
    }
  }
  walk(rootPid)
  return ordered
}

/**
 * Enumerate all descendant PIDs of `rootPid` on POSIX (leaf-first).
 * Uses `pgrep -P` recursively and falls back to `ps -A -o pid=,ppid=` if any
 * `pgrep` invocation errors, times out, or returns an unexpected exit status
 * (exit 0 = found children, exit 1 = no children; anything else triggers fallback).
 */
export function listPosixDescendants(
  rootPid: number,
  runCmd: PosixSpawnSyncFn = defaultPosixSpawnSync,
): number[] {
  const visited = new Set<number>([rootPid])
  const ordered: number[] = []
  let pgrepFailed = false

  const walkPgrep = (parentPid: number) => {
    let res: { status: number | null; error?: Error; stdout: string }
    try {
      res = runCmd('pgrep', ['-P', String(parentPid)])
    } catch {
      pgrepFailed = true
      return
    }
    if (res.error || (res.status !== 0 && res.status !== 1)) {
      pgrepFailed = true
      return
    }
    if (!res.stdout) return
    const directChildren: number[] = []
    for (const token of res.stdout.split(/\s+/)) {
      const childPid = Number(token.trim())
      if (
        Number.isInteger(childPid) &&
        childPid > 0 &&
        childPid !== process.pid &&
        !visited.has(childPid)
      ) {
        visited.add(childPid)
        directChildren.push(childPid)
      }
    }
    for (const childPid of directChildren) {
      try {
        process.kill(childPid, 'SIGSTOP')
      } catch {
        // already exited
      }
      walkPgrep(childPid)
      ordered.push(childPid)
    }
  }

  walkPgrep(rootPid)

  if (pgrepFailed) {
    try {
      const psRes = runCmd('ps', ['-A', '-o', 'pid=,ppid='])
      if (!psRes.error && psRes.status === 0 && psRes.stdout) {
        const fromPs = collectPosixDescendantsFromPsOutput(psRes.stdout, rootPid)
        for (const pid of fromPs) {
          if (!visited.has(pid)) {
            visited.add(pid)
            ordered.push(pid)
          }
        }
      }
    } catch {
      // ps also unavailable
    }
  }

  return ordered
}

/**
 * POSIX termination sequence (R1-5, R1-6):
 * 1. `SIGSTOP` the root converter first so it cannot wake from `spawnSync` and
 *    start a fallback OCR helper while descendants are being killed.
 * 2. Enumerate descendants (`pgrep -P` with `ps -A -o pid=,ppid=` fallback).
 * 3. `SIGKILL` all descendants, then `SIGKILL` the root converter.
 */
export function killPosixProcessTree(
  rootPid: number,
  runCmd: PosixSpawnSyncFn = defaultPosixSpawnSync,
  killFn: (pid: number, signal: NodeJS.Signals) => void = (p, sig) => {
    process.kill(p, sig)
  },
): void {
  try {
    killFn(rootPid, 'SIGSTOP')
  } catch {
    // root already exited
  }
  const descendants = listPosixDescendants(rootPid, runCmd)
  for (const childPid of descendants) {
    try {
      killFn(childPid, 'SIGKILL')
    } catch {
      // already exited
    }
  }
  try {
    killFn(rootPid, 'SIGKILL')
  } catch {
    // already exited
  }
}

/**
 * Terminate a process and all descendants it spawned (such as `tess-ocr.cjs`
 * or `win-ocr.exe` started via `spawnSync`). Targets only the owned PID, never
 * image names.
 *
 * When `rootAlreadyExited` is true (R1-2 / R1-12), the converter process itself
 * has already exited: never signal the saved root PID directly (OS PID reuse
 * hazard); on Windows `taskkill /T /F` still cleans remaining child processes
 * bearing that parent PID, while on POSIX reparented OCR helpers self-terminate
 * via their `ppid` orphan watch.
 */
export function killProcessTree(pid: number | undefined, rootAlreadyExited = false): void {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5_000,
      })
    } catch {
      // fall through
    }
    if (!rootAlreadyExited) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already exited
      }
    }
    return
  }

  if (rootAlreadyExited) {
    return
  }
  killPosixProcessTree(pid)
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
        event: 'message' | 'exit' | 'spawn',
        listener:
          ConvertChildMessageListener | ConvertChildExitListener | ConvertChildSpawnListener,
      ) {
        if (event === 'message') {
          child.on('message', listener as ConvertChildMessageListener)
        } else if (event === 'exit') {
          child.on('exit', listener as ConvertChildExitListener)
        } else {
          child.on('spawn', listener as ConvertChildSpawnListener)
        }
        return this
      },
      off(
        event: 'message' | 'exit' | 'spawn',
        listener:
          ConvertChildMessageListener | ConvertChildExitListener | ConvertChildSpawnListener,
      ) {
        if (event === 'message') {
          child.off('message', listener as ConvertChildMessageListener)
        } else if (event === 'exit') {
          child.off('exit', listener as ConvertChildExitListener)
        } else {
          child.off('spawn', listener as ConvertChildSpawnListener)
        }
        return this
      },
      removeListener(
        event: 'message' | 'exit' | 'spawn',
        listener:
          ConvertChildMessageListener | ConvertChildExitListener | ConvertChildSpawnListener,
      ) {
        if (event === 'message') {
          child.removeListener('message', listener as ConvertChildMessageListener)
        } else if (event === 'exit') {
          child.removeListener('exit', listener as ConvertChildExitListener)
        } else {
          child.removeListener('spawn', listener as ConvertChildSpawnListener)
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
      event: 'message' | 'exit' | 'spawn',
      listener: ConvertChildMessageListener | ConvertChildExitListener | ConvertChildSpawnListener,
    ) {
      emitter.on(event, listener)
      return this
    },
    off(
      event: 'message' | 'exit' | 'spawn',
      listener: ConvertChildMessageListener | ConvertChildExitListener | ConvertChildSpawnListener,
    ) {
      emitter.off(event, listener)
      return this
    },
    removeListener(
      event: 'message' | 'exit' | 'spawn',
      listener: ConvertChildMessageListener | ConvertChildExitListener | ConvertChildSpawnListener,
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

interface TerminatingJobHandle {
  forceKill(): void
}

const liveJobs = new Set<LiveJobHandle>()
const terminatingJobs = new Set<TerminatingJobHandle>()

/**
 * Kill all active and still-terminating PDF conversion jobs and their process
 * trees (called on `before-quit`). Covers processes cancelled before their
 * asynchronous `spawn` event has delivered a PID (R1-1).
 */
export function killAllPdfConvertJobs(): void {
  for (const job of [...liveJobs]) {
    job.abortOnQuit()
  }
  for (const job of [...terminatingJobs]) {
    job.forceKill()
  }
}

/** Number of in-flight conversion jobs (exposed for diagnostics and leak tests). */
export function activePdfConvertJobCount(): number {
  return liveJobs.size
}

/** Number of jobs awaiting process exit after cancel/settlement (exposed for tests). */
export function terminatingPdfConvertJobCount(): number {
  return terminatingJobs.size
}

function detachListener(
  child: ConvertChildProcess,
  event: 'message' | 'exit' | 'spawn',
  listener: ConvertChildMessageListener | ConvertChildExitListener | ConvertChildSpawnListener,
): void {
  if (typeof child.off === 'function') {
    if (event === 'message') child.off('message', listener as ConvertChildMessageListener)
    else if (event === 'exit') child.off('exit', listener as ConvertChildExitListener)
    else child.off('spawn', listener as ConvertChildSpawnListener)
  } else if (typeof child.removeListener === 'function') {
    if (event === 'message')
      child.removeListener('message', listener as ConvertChildMessageListener)
    else if (event === 'exit') child.removeListener('exit', listener as ConvertChildExitListener)
    else child.removeListener('spawn', listener as ConvertChildSpawnListener)
  }
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

  let resolve!: (value: PdfConvertHostResult) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<PdfConvertHostResult>((res, rej) => {
    resolve = res
    reject = rej
  })
  let child: ConvertChildProcess
  try {
    child = fork(modulePath)
  } catch (err) {
    reject(err instanceof Error ? err : new Error(String(err)))
    return promise
  }
  let settled = false
  let terminationRequested = false
  let exited = false
  let jobDispatched = false
  let capturedPid: number | undefined = child.pid
  let watchdogTimer: NodeJS.Timeout | null = null

  const clearWatchdog = () => {
    if (watchdogTimer !== null) {
      clearTimeout(watchdogTimer)
      watchdogTimer = null
    }
  }

  const finalizeExitOwnership = () => {
    if (exited) return
    exited = true
    terminatingJobs.delete(terminatingHandle)
    detachListener(child, 'spawn', onSpawn)
    detachListener(child, 'exit', onExit)
  }

  const performKillNow = (rootAlreadyExited: boolean) => {
    if (typeof child.pid === 'number' && child.pid > 0) {
      capturedPid = child.pid
    }
    const pid = child.pid ?? capturedPid
    if (typeof pid === 'number' && pid > 0) {
      killProcessTree(pid, rootAlreadyExited)
    }
    if (rootAlreadyExited) {
      finalizeExitOwnership()
      return
    }
    let killed = false
    try {
      killed = child.kill()
    } catch {
      // already exited
    }
    // Once the process has spawned (has a PID so killProcessTree ran, or
    // `child.kill()` returned true), termination is complete; release exit
    // listeners and `terminatingJobs` ownership immediately. Before spawn
    // (`pid === undefined` and `killed === false`, e.g. Electron utilityProcess
    // cancelled before its async `'spawn'` event), keep ownership in
    // `terminatingJobs` until `'spawn'` or `'exit'` fires so the process is
    // killed as soon as it acquires its PID (R1-1).
    if ((typeof pid === 'number' && pid > 0) || killed) {
      finalizeExitOwnership()
    }
  }

  const requestTermination = (rootAlreadyExited = false) => {
    terminationRequested = true
    if (!rootAlreadyExited && !exited) {
      terminatingJobs.add(terminatingHandle)
    }
    performKillNow(rootAlreadyExited)
  }

  const cleanupActiveJob = () => {
    clearWatchdog()
    liveJobs.delete(liveHandle)
    detachListener(child, 'message', onMessage)
    signal?.removeEventListener('abort', onAbort)
  }

  const armWatchdog = () => {
    clearWatchdog()
    if (watchdogMs <= 0) return
    watchdogTimer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanupActiveJob()
      requestTermination(false)
      reject(
        new PdfConvertCrashed(
          null,
          `PDF conversion process timed out after ${watchdogMs}ms without progress`,
        ),
      )
    }, watchdogMs)
    watchdogTimer.unref?.()
  }

  const dispatchJobIfReady = () => {
    if (jobDispatched || settled || terminationRequested || exited) return
    jobDispatched = true
    try {
      child.postMessage(job)
      if (typeof child.pid === 'number' && child.pid > 0) {
        capturedPid = child.pid
      }
    } catch (err) {
      if (!settled) {
        settled = true
        cleanupActiveJob()
        requestTermination(false)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  const onSpawn = () => {
    if (typeof child.pid === 'number' && child.pid > 0) {
      capturedPid = child.pid
    }
    if (settled || terminationRequested) {
      performKillNow(false)
      return
    }
    dispatchJobIfReady()
  }

  const onAbort = () => {
    if (settled) return
    settled = true
    cleanupActiveJob()
    requestTermination(false)
    reject(new PdfConvertCancelled())
  }

  const onExit = (code: number | null) => {
    if (typeof child.pid === 'number' && child.pid > 0) {
      capturedPid = child.pid
    }
    if (settled) {
      finalizeExitOwnership()
      return
    }
    settled = true
    cleanupActiveJob()
    requestTermination(true)
    reject(new PdfConvertCrashed(typeof code === 'number' ? code : null))
  }

  const onMessage = (raw: unknown) => {
    if (settled) return
    if (typeof child.pid === 'number' && child.pid > 0) {
      capturedPid = child.pid
    }

    const unwrapped =
      raw && typeof raw === 'object' && 'data' in raw && !('type' in raw) ? raw.data : raw
    if (!unwrapped || typeof unwrapped !== 'object' || !('type' in unwrapped)) return
    const msg = unwrapped as Record<string, unknown>

    if (msg.type === 'progress') {
      // Arm the inactivity watchdog on the first progress message and reset it on
      // each subsequent progress message (R1-11).
      armWatchdog()
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
        cleanupActiveJob()
        requestTermination(false)
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      settled = true
      cleanupActiveJob()
      requestTermination(false)
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
      cleanupActiveJob()
      requestTermination(false)
      reject(reconstructChildError(msg))
    }
  }

  const liveHandle: LiveJobHandle = {
    abortOnQuit: onAbort,
  }
  const terminatingHandle: TerminatingJobHandle = {
    forceKill: () => performKillNow(false),
  }
  liveJobs.add(liveHandle)

  child.on('message', onMessage)
  child.on('exit', onExit)
  if (typeof child.on === 'function') {
    child.on('spawn', onSpawn)
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  // If the fork adapter already has a PID synchronously (e.g. Node child_process.fork),
  // dispatch the job immediately. If `pid` is initially undefined on an async-spawning
  // process (Electron utilityProcess or a test adapter with `awaitsSpawn: true`),
  // wait for `'spawn'` before calling `postMessage(job)` so a pre-spawn cancel or
  // quit never delivers the job to an untracked process (R1-1).
  const isAsyncSpawnProcess =
    child.awaitsSpawn === true ||
    'stdout' in child ||
    'stderr' in child ||
    child.constructor?.name === 'UtilityProcess'

  if (typeof child.pid === 'number' && child.pid > 0) {
    dispatchJobIfReady()
  } else if (!isAsyncSpawnProcess) {
    // In-process MessageChannel / synchronous EventEmitter test mocks have
    // `pid === undefined` permanently and do not emit `'spawn'`.
    dispatchJobIfReady()
  }

  return promise
}
