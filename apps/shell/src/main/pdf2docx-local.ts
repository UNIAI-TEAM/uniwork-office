/**
 * Local PDF → Word conversion for the shell's pdf tabs (pdf2docx P4, UNI-2167).
 * Runs the @genoffice/pdf2docx pipeline + local OCR chain inside an isolated
 * Electron utility process via `convert-host.ts` so long scanned documents
 * never block the main process and can be cancelled immediately.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ConvertResult, PageResult } from '../../../../packages/pdf2docx/src'
import { PdfLoadError } from '../../../../packages/pdf2docx/src/extract/pdfium'
import { PdfConvertCancelled, runPdfConvertJob } from './pdf-convert/convert-host'

export type { ConvertResult, PageResult }
export { PdfLoadError }

const devPackageDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/pdf2docx')

/** Convert a PDF file on disk to docx bytes, off the main process. */
export async function convertPdfFileToDocxLocal(
  pdfPath: string,
  onProgress?: (page: number, total: number) => void,
  password?: string,
  signal?: AbortSignal,
): Promise<ConvertResult> {
  const res = await runPdfConvertJob(
    {
      kind: 'docx',
      pdfPath,
      ...(password !== undefined ? { password } : {}),
      ...(process.resourcesPath ? { resourcesPath: process.resourcesPath } : {}),
      devPackageDir,
    },
    {
      ...(onProgress !== undefined ? { onProgress } : {}),
      ...(signal !== undefined ? { signal } : {}),
    },
  )
  return {
    docx: res.bytes,
    pages: res.pages,
    warnings: res.warnings,
    pageResults: res.pageResults,
    scannedDocument: res.scannedDocument,
  }
}

/**
 * Password retry loop around a conversion attempt (P23). Runs `convert`
 * without a password first; on PdfLoadError('password-required') asks
 * `promptPassword` (retry=true once a submitted password was rejected) and
 * re-runs until it succeeds, a different error is thrown, or the prompt
 * returns null (user cancelled) → resolves null. Pure state machine, exported
 * separately from the UI so tests can drive it with fakes or the real
 * converter.
 */
export async function convertWithPasswordRetry<T>(
  convert: (password: string | undefined) => Promise<T>,
  promptPassword: (retry: boolean) => Promise<string | null>,
  signal?: AbortSignal,
): Promise<T | null> {
  let password: string | undefined
  for (;;) {
    if (signal?.aborted) return null
    try {
      const result = await convert(password)
      if (signal?.aborted) return null
      return result
    } catch (err) {
      if (signal?.aborted || err instanceof PdfConvertCancelled) return null
      if (!(err instanceof PdfLoadError) || err.code !== 'password-required') throw err
      const entered = await promptPassword(password !== undefined)
      if (entered === null || signal?.aborted) return null
      password = entered
    }
  }
}

/**
 * Local conversion with an interactive password prompt: like
 * convertPdfFileToDocxLocal but encrypted PDFs ask the user for the password
 * (looping on wrong entries) instead of failing. Resolves null when the user
 * cancels the prompt.
 */
export function convertPdfFileToDocxLocalWithPrompt(
  pdfPath: string,
  promptPassword: (retry: boolean) => Promise<string | null>,
  onProgress?: (page: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ConvertResult | null> {
  return convertWithPasswordRetry(
    (password) => convertPdfFileToDocxLocal(pdfPath, onProgress, password, signal),
    promptPassword,
    signal,
  )
}
