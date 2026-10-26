/**
 * Utility-process child entry for local PDF -> Office conversions (UNI-2167).
 *
 * Receives one job over `process.parentPort` (Electron utilityProcess) or
 * an injected port/IPC channel (Node tests), loads PDFium WASM and the local
 * OCR chain lazily, runs the synchronous @genoffice/pdf2docx converter off the
 * Electron main process, posts per-page progress, and posts either the binary
 * result (`Uint8Array` via structured clone, never JSON-encoded) or a
 * structured error (`PdfLoadError` round-trips with `code` and `pdfiumError`).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  convertPdfToDocx,
  convertPdfToPptx,
  convertPdfToXlsx,
  PdfLoadError,
} from '../../../../../packages/pdf2docx/src'
import type {
  OcrEngine,
  PageResult,
  PdfiumModule,
  PdfLoadErrorCode,
} from '../../../../../packages/pdf2docx/src'
import { resolveLocalOcrEngine } from '../../../../../packages/pdf2docx/src/ocr-local'
import { pdfiumWasmPath } from '../../../../pdf/src/main/wasm-path'

export type PdfConvertKind = 'docx' | 'pptx' | 'xlsx'

export interface PdfConvertJob {
  kind: PdfConvertKind
  pdfPath: string
  password?: string
  resourcesPath?: string
  devPackageDir?: string
}

export type PdfConvertChildMessage =
  | {
      type: 'progress'
      page: number
      total: number
    }
  | {
      type: 'result'
      kind: PdfConvertKind
      bytes: Uint8Array
      pages: number
      warnings: string[]
      pageResults: PageResult[]
      scannedDocument: boolean
    }
  | {
      type: 'error'
      name: string
      code?: PdfLoadErrorCode
      pdfiumError?: number
      message: string
    }

export interface ConvertChildPort {
  on(event: 'message', listener: (eventOrMessage: unknown) => void): unknown
  postMessage(message: PdfConvertChildMessage): void
}

function defaultDevPackageDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // From src/main/pdf-convert/ (5 levels up) vs out/main/ (4 levels up)
  const fromSrc = join(here, '../../../../../packages/pdf2docx')
  if (existsSync(fromSrc)) return fromSrc
  return join(here, '../../../../packages/pdf2docx')
}

let cachedOcrKey: string | undefined
let ocrEngine: OcrEngine | null | undefined

export function ensureOcrEngine(options?: {
  resourcesPath?: string
  devPackageDir?: string
}): OcrEngine | null {
  const resourcesPath = options?.resourcesPath || process.resourcesPath || undefined
  const devPackageDir = options?.devPackageDir || defaultDevPackageDir()
  const key = `${resourcesPath ?? ''}|${devPackageDir}`
  if (ocrEngine !== undefined && cachedOcrKey === key) return ocrEngine
  cachedOcrKey = key
  ocrEngine = resolveLocalOcrEngine({
    ...(resourcesPath ? { resourcesPath } : {}),
    devPackageDir,
  })
  return ocrEngine
}

let pdfiumPromise: Promise<PdfiumModule> | null = null

/**
 * Load the PDFium WASM bytes directly from disk: bundled main/child entries
 * must not rely on the package's own file resolution.
 */
export function ensurePdfium(resourcesPath?: string): Promise<PdfiumModule> {
  pdfiumPromise ??= (async () => {
    // Dynamic import defers loading the Emscripten JS glue until PDFium is needed
    const pdfiumMod = (await import('@embedpdf/pdfium')) as unknown as {
      init(overrides: object): Promise<object>
    }
    const raw = readFileSync(pdfiumWasmPath(resourcesPath))
    // exact slice: Buffer.buffer may be a shared pool larger than the file
    const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    // thisProgram: emscripten's synthetic environ writes process.argv[1] via
    // ASCII-asserting stringToAscii; a document path with CJK characters handed
    // to the packaged app by a Windows file association aborts init
    const wrapped = (await pdfiumMod.init({ wasmBinary, thisProgram: 'genoffice-pdf' })) as {
      pdfium?: unknown
    }
    const m = (wrapped.pdfium ?? wrapped) as PdfiumModule & { _PDFiumExt_Init(): void }
    m._PDFiumExt_Init()
    return m
  })()
  return pdfiumPromise
}

/** Run one conversion job and emit progress + terminal result/error messages. */
export async function handleConvertJob(
  job: PdfConvertJob,
  postMessage: (message: PdfConvertChildMessage) => void,
): Promise<void> {
  try {
    const pdfium = await ensurePdfium(job.resourcesPath)
    const raw = readFileSync(job.pdfPath)
    const pdf = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    const onProgress = (page: number, total: number) => {
      postMessage({ type: 'progress', page, total })
    }
    const commonOpts = {
      pdfium,
      onProgress,
      ...(job.password !== undefined ? { password: job.password } : {}),
    }

    if (job.kind === 'docx') {
      const ocr = ensureOcrEngine({
        ...(job.resourcesPath ? { resourcesPath: job.resourcesPath } : {}),
        ...(job.devPackageDir ? { devPackageDir: job.devPackageDir } : {}),
      })
      const res = await convertPdfToDocx(pdf, {
        ...commonOpts,
        ...(ocr ? { ocr } : {}),
      })
      postMessage({
        type: 'result',
        kind: 'docx',
        bytes: res.docx,
        pages: res.pages,
        warnings: res.warnings,
        pageResults: res.pageResults,
        scannedDocument: res.scannedDocument,
      })
      return
    }

    if (job.kind === 'pptx') {
      const res = await convertPdfToPptx(pdf, commonOpts)
      postMessage({
        type: 'result',
        kind: 'pptx',
        bytes: res.pptx,
        pages: res.pages,
        warnings: res.warnings,
        pageResults: res.pageResults,
        scannedDocument: res.scannedDocument,
      })
      return
    }

    if (job.kind === 'xlsx') {
      const res = await convertPdfToXlsx(pdf, commonOpts)
      postMessage({
        type: 'result',
        kind: 'xlsx',
        bytes: res.xlsx,
        pages: res.pages,
        warnings: res.warnings,
        pageResults: res.pageResults,
        scannedDocument: res.scannedDocument,
      })
      return
    }

    const unsupportedKind = 'kind' in job ? String(job.kind) : 'unknown'
    throw new Error(`Unsupported PDF conversion kind: ${unsupportedKind}`)
  } catch (err) {
    if (err instanceof PdfLoadError) {
      postMessage({
        type: 'error',
        name: 'PdfLoadError',
        code: err.code,
        pdfiumError: err.pdfiumError,
        message: err.message,
      })
      return
    }
    const name = err instanceof Error && err.name ? err.name : 'Error'
    const message = err instanceof Error ? err.message : String(err)
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? (err.code as PdfLoadErrorCode)
        : undefined
    const pdfiumError =
      err && typeof err === 'object' && 'pdfiumError' in err && typeof err.pdfiumError === 'number'
        ? err.pdfiumError
        : undefined
    postMessage({
      type: 'error',
      name,
      ...(code !== undefined ? { code } : {}),
      ...(pdfiumError !== undefined ? { pdfiumError } : {}),
      message,
    })
  }
}

/**
 * Wire a `process.parentPort` (or test port) to handle a single conversion job.
 */
export function attachConvertChild(port: ConvertChildPort, keepAliveForHostKill = false): void {
  let handled = false
  port.on('message', (eventOrMessage: unknown) => {
    if (handled) return
    const payload =
      eventOrMessage &&
      typeof eventOrMessage === 'object' &&
      'data' in eventOrMessage &&
      !('kind' in eventOrMessage && 'pdfPath' in eventOrMessage)
        ? eventOrMessage.data
        : eventOrMessage
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('kind' in payload) ||
      !('pdfPath' in payload)
    ) {
      return
    }
    handled = true
    void handleConvertJob(payload as PdfConvertJob, (msg) => {
      port.postMessage(msg)
    }).finally(() => {
      if (keepAliveForHostKill) {
        // Let the parent receive the final IPC message and kill the process;
        // fallback exit ensures we never linger if the parent itself died.
        setTimeout(() => process.exit(0), 5_000).unref()
      }
    })
  })
}

const parentPort = (process as NodeJS.Process & { parentPort?: ConvertChildPort }).parentPort
if (
  parentPort &&
  typeof parentPort.on === 'function' &&
  typeof parentPort.postMessage === 'function'
) {
  attachConvertChild(parentPort, true)
} else if (process.env.PDF_CONVERT_CHILD_ENTRY === '1' && typeof process.send === 'function') {
  attachConvertChild(
    {
      on: (_event, listener) => process.on('message', listener),
      postMessage: (msg) => {
        process.send?.(msg)
      },
    },
    true,
  )
}
