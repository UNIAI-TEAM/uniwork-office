/**
 * Node-side OcrEngine backed by the bundled Tesseract helper in
 * ocr-tesseract/ (tess-ocr.cjs: Tesseract 5 LSTM through tesseract.js WASM,
 * tessdata_fast `vie`). Same stdin-PNG / stdout-JSON protocol as the system
 * helpers (see ocr-vision.ts), so the spawn + parse is shared; the only
 * difference is the process: a Node script run on the app's own binary with
 * ELECTRON_RUN_AS_NODE (the RunAsNode fuse stays enabled for the CLI too), so
 * no second runtime ships and the pipeline stays synchronous.
 *
 * Kept OUT of src/index.ts for the same reason as ocr-vision.ts
 * (node:child_process must not reach renderer bundles).
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { OcrEngine, OcrRecognition } from './ocr'
import type { AsyncOcrEngine } from './ocr-chain'
import { runOcrHelper, runOcrHelperAsync, type HelperRunOptions } from './ocr-vision'

/** a 300 dpi A4 page takes 2-5 s on a laptop core; leave room for slow VMs */
const TESSERACT_TIMEOUT_MS = 90_000

export interface TesseractOcrOptions {
  /** the Node-compatible binary: process.execPath (the app binary under Electron) */
  nodePath: string
  /** absolute path to tess-ocr.cjs */
  helperScript: string
  /** directory holding <lang>.traineddata */
  tessdataDir: string
  /** recognition language(s), '+'-joined; default 'vie' */
  lang?: string
}

/** true when tesseract.js and pngjs resolve from the helper's location */
function runtimeAvailable(helperScript: string): boolean {
  try {
    const req = createRequire(helperScript)
    req.resolve('tesseract.js/package.json')
    req.resolve('pngjs/package.json')
    return true
  } catch {
    return false
  }
}

/** variables that make a process run foreign code or reach a foreign CA: never handed to the helper */
const HELPER_DROPPED_ENV = ['NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS'] as const

/** true when the script, its npm runtime and the language model(s) are all in place */
function helperInstalled(options: TesseractOcrOptions, lang: string): boolean {
  const { helperScript, tessdataDir } = options
  if (!existsSync(helperScript)) return false
  for (const l of lang.split('+')) {
    if (!existsSync(join(tessdataDir, `${l}.traineddata`))) return false
  }
  return runtimeAvailable(helperScript)
}

/** how the helper runs: the app binary as plain Node, a scrubbed environment, its own directory */
function helperRun(options: TesseractOcrOptions): HelperRunOptions {
  return {
    env: { ELECTRON_RUN_AS_NODE: '1' },
    dropEnv: HELPER_DROPPED_ENV,
    cwd: dirname(options.helperScript),
    timeoutMs: TESSERACT_TIMEOUT_MS,
    windowsHide: true,
  }
}

/**
 * Build an OcrEngine that shells out to tess-ocr.cjs. Returns null when the
 * script, its npm runtime or a language model is missing (caller falls back
 * to the system engine / the bitmap).
 */
export function createTesseractOcrEngine(options: TesseractOcrOptions): OcrEngine | null {
  const lang = options.lang ?? 'vie'
  if (!helperInstalled(options, lang)) return null
  const run = helperRun(options)
  return (png: Uint8Array): OcrRecognition | null =>
    runOcrHelper(options.nodePath, [options.helperScript, options.tessdataDir, lang], png, run)
}

/** async twin of createTesseractOcrEngine (the viewer must not block the main process) */
export function createTesseractOcrEngineAsync(options: TesseractOcrOptions): AsyncOcrEngine | null {
  const lang = options.lang ?? 'vie'
  if (!helperInstalled(options, lang)) return null
  const run = helperRun(options)
  return (png: Uint8Array) =>
    runOcrHelperAsync(options.nodePath, [options.helperScript, options.tessdataDir, lang], png, run)
}
