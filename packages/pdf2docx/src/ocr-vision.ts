/**
 * Node-side OcrEngines backed by the platform system-OCR helper binaries in
 * ocr-helper/ (macOS Vision: vision-ocr.swift; Windows.Media.Ocr:
 * win-ocr.cs). Both helpers speak the same protocol — PNG on stdin, JSON
 * lines with normalized bottom-left boxes and a paper-tone share on stdout —
 * so one spawn wrapper serves every platform.
 *
 * Kept OUT of src/index.ts on purpose: it pulls in node:child_process, which
 * browser/renderer bundles must not see — consumers that run in Node
 * (Electron main, tests, eval scripts) import this module directly and pass
 * the engine via ConvertOptions.ocr.
 */
import { spawn, spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Rect } from './geometry'
import type { OcrEngine, OcrRecognition } from './ocr'
import type { AsyncOcrEngine } from './ocr-chain'

/** helper output caps: a page render is a few MB, JSON a few hundred KB */
const HELPER_MAX_BUFFER = 64 * 1024 * 1024
const HELPER_TIMEOUT_MS = 30_000

interface HelperChar {
  t: string
  b: [number, number, number, number]
}
interface HelperLine {
  t: string
  c: number
  b: [number, number, number, number]
  chars?: HelperChar[]
}

const toRect = (b: [number, number, number, number]): Rect => ({
  x0: b[0],
  y0: b[1],
  x1: b[2],
  y1: b[3],
})

/** how a helper process is run: the system helpers take the defaults */
export interface HelperRunOptions {
  /** extra environment on top of process.env */
  env?: NodeJS.ProcessEnv
  /** variables removed from the inherited environment (matched case-insensitively) */
  dropEnv?: readonly string[]
  /** working directory of the helper (default: the caller's) */
  cwd?: string
  /** kill the helper after this long (default 30 s) */
  timeoutMs?: number
  /** stdout cap in bytes (default 64 MB); the helper is killed above it */
  maxBufferBytes?: number
  /** keep a console window from flashing up on Windows */
  windowsHide?: boolean
}

/**
 * Environment variable set to the immediate spawner's `process.pid` on every
 * OCR helper launch (sync and async) so the helper can verify its parent both
 * immediately at startup (catching parent death before initial `ppid` capture)
 * and on every watchdog tick (R2-1).
 */
export const OCR_PARENT_PID_ENV = 'GENOFFICE_OCR_PARENT_PID'

/**
 * Environment of a helper run: the caller's minus `dropEnv`, plus `env`, with
 * `GENOFFICE_OCR_PARENT_PID` always overwritten to the immediate spawner's PID.
 */
function helperEnv(options: HelperRunOptions): NodeJS.ProcessEnv {
  const drop = new Set([OCR_PARENT_PID_ENV, ...(options.dropEnv ?? []).map((k) => k.toUpperCase())])
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (!drop.has(k.toUpperCase())) env[k] = v
  }
  return {
    ...env,
    ...options.env,
    [OCR_PARENT_PID_ENV]: String(process.pid),
  }
}

/** shared by the sync and the async spawn */
function spawnOptions(
  options: HelperRunOptions,
): Pick<SpawnSyncOptions, 'env' | 'cwd' | 'windowsHide'> {
  return {
    env: helperEnv(options),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.windowsHide ? { windowsHide: true } : {}),
  }
}

const isBox = (b: unknown): b is [number, number, number, number] =>
  Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && Number.isFinite(n))

const isHelperChar = (c: unknown): c is HelperChar =>
  typeof c === 'object' &&
  c !== null &&
  typeof (c as HelperChar).t === 'string' &&
  isBox((c as HelperChar).b)

const isHelperLine = (l: unknown): l is HelperLine => {
  if (typeof l !== 'object' || l === null) return false
  const line = l as HelperLine
  if (typeof line.t !== 'string' || typeof line.c !== 'number' || !isBox(line.b)) return false
  return line.chars === undefined || (Array.isArray(line.chars) && line.chars.every(isHelperChar))
}

/**
 * helper stdout -> recognition; null when it is not the protocol — unparseable
 * JSON and any malformed line or glyph (a null entry, a missing or non-numeric
 * box, a non-array `chars`) alike. Never throws: the async runner calls it from
 * an event listener, where a throw would reach the main process.
 */
function parseHelperOutput(stdout: Buffer): OcrRecognition | null {
  let parsed: { lines?: unknown; paper?: unknown }
  try {
    // defense in depth: .NET Framework consoles can prepend a UTF-8 BOM
    const raw = stdout.toString('utf8')
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    parsed = JSON.parse(text) as { lines?: unknown; paper?: unknown }
  } catch {
    return null
  }
  if (!parsed || !Array.isArray(parsed.lines) || !parsed.lines.every(isHelperLine)) return null
  return {
    lines: parsed.lines.map((l) => ({
      text: l.t,
      confidence: l.c,
      box: toRect(l.b),
      ...(l.chars ? { chars: l.chars.map((c) => ({ text: c.t, box: toRect(c.b) })) } : {}),
    })),
    ...(typeof parsed.paper === 'number' ? { paperShare: parsed.paper } : {}),
  }
}

/**
 * Spawn one OCR helper for one page and parse its stdout (protocol shared by
 * every helper: vision-ocr, win-ocr, tess-ocr). `null` = the helper failed,
 * timed out, printed too much or printed something unparseable.
 */
export function runOcrHelper(
  command: string,
  args: string[],
  png: Uint8Array,
  options: HelperRunOptions = {},
): OcrRecognition | null {
  const res = spawnSync(command, args, {
    ...spawnOptions(options),
    input: png,
    maxBuffer: options.maxBufferBytes ?? HELPER_MAX_BUFFER,
    timeout: options.timeoutMs ?? HELPER_TIMEOUT_MS,
  })
  if (res.status !== 0 || res.stdout == null) return null
  return parseHelperOutput(res.stdout)
}

/**
 * Async twin of runOcrHelper (same helper protocol, timeout, stdout cap, env,
 * cwd and windowsHide) that leaves the event loop running while the helper
 * works. Never rejects: every failure — spawn error, EPIPE on a helper that
 * exits before reading its stdin, non-zero exit, timeout kill, oversized
 * stdout — resolves to null.
 */
export function runOcrHelperAsync(
  command: string,
  args: string[],
  png: Uint8Array,
  options: HelperRunOptions = {},
): Promise<OcrRecognition | null> {
  const maxBuffer = options.maxBufferBytes ?? HELPER_MAX_BUFFER
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { ...spawnOptions(options), stdio: ['pipe', 'pipe', 'ignore'] })
    } catch {
      resolve(null)
      return
    }
    let settled = false
    const chunks: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => {
      child.kill()
      done(null)
    }, options.timeoutMs ?? HELPER_TIMEOUT_MS)
    const done = (result: OcrRecognition | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.on('error', () => done(null))
    child.stdout!.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBuffer) {
        child.kill()
        done(null)
        return
      }
      chunks.push(chunk)
    })
    child.stdout!.on('error', () => done(null))
    // a helper that exits before it has read its stdin raises EPIPE here
    child.stdin!.on('error', () => undefined)
    child.on('close', (code) => {
      // a throw out of a listener would reach the main process and leave the promise pending
      let result: OcrRecognition | null = null
      try {
        if (code === 0) result = parseHelperOutput(Buffer.concat(chunks))
      } catch {
        result = null
      }
      done(result)
    })
    child.stdin!.end(png)
  })
}

const helperArgs = (languages?: string[]): string[] =>
  languages && languages.length > 0 ? [languages.join(',')] : []

/** spawn wrapper shared by the platform engines (protocol is identical) */
function createHelperOcrEngine(helperPath: string, languages?: string[]): OcrEngine {
  return (png: Uint8Array): OcrRecognition | null =>
    runOcrHelper(helperPath, helperArgs(languages), png)
}

function createHelperOcrEngineAsync(helperPath: string, languages?: string[]): AsyncOcrEngine {
  return (png: Uint8Array) => runOcrHelperAsync(helperPath, helperArgs(languages), png)
}

const canServe = (platform: NodeJS.Platform, helperPath: string): boolean =>
  process.platform === platform && existsSync(helperPath)

/**
 * Build an OcrEngine that shells out to the compiled macOS Vision helper.
 * Returns null when the platform or binary cannot serve (caller converts
 * without OCR — scanned pages keep the bitmap fallback).
 *
 * @param helperPath absolute path to the compiled vision-ocr binary
 * @param languages  optional recognition hints, e.g. ['zh-Hans', 'en-US'];
 *                   omit to let Vision auto-detect
 */
export function createVisionOcrEngine(helperPath: string, languages?: string[]): OcrEngine | null {
  return canServe('darwin', helperPath) ? createHelperOcrEngine(helperPath, languages) : null
}

/** async twin of createVisionOcrEngine (the viewer must not block the main process) */
export function createVisionOcrEngineAsync(
  helperPath: string,
  languages?: string[],
): AsyncOcrEngine | null {
  return canServe('darwin', helperPath) ? createHelperOcrEngineAsync(helperPath, languages) : null
}

/**
 * Build an OcrEngine that shells out to the compiled Windows.Media.Ocr
 * helper (win-ocr.exe). Same null-on-unavailable contract as the Vision
 * engine; machines without any OCR recognizer language make the helper exit
 * non-zero, which the wrapper already maps to "no result" per page.
 *
 * @param helperPath absolute path to the compiled win-ocr.exe
 * @param languages  optional BCP-47 hints tried in order, e.g. ['zh-Hans-CN'];
 *                   omit to use the user-profile languages
 */
export function createWindowsOcrEngine(helperPath: string, languages?: string[]): OcrEngine | null {
  return canServe('win32', helperPath) ? createHelperOcrEngine(helperPath, languages) : null
}

/** async twin of createWindowsOcrEngine */
export function createWindowsOcrEngineAsync(
  helperPath: string,
  languages?: string[],
): AsyncOcrEngine | null {
  return canServe('win32', helperPath) ? createHelperOcrEngineAsync(helperPath, languages) : null
}
