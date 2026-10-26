/**
 * Local PDF → Excel conversion for the shell's pdf tabs (pdf2xlsx P26, UNI-2167).
 * Mirrors pdf2pptx-local.ts: runs the @genoffice/pdf2docx pipeline inside the
 * shared utility-process host (`convert-host.ts`) with the same password retry loop.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ConvertXlsxResult } from '../../../../packages/pdf2docx/src'
import { runPdfConvertJob } from './pdf-convert/convert-host'
import { convertWithPasswordRetry } from './pdf2docx-local'

export type { ConvertXlsxResult } from '../../../../packages/pdf2docx/src'

const devPackageDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/pdf2docx')

/** Convert a PDF file on disk to xlsx bytes, off the main process. */
export async function convertPdfFileToXlsxLocal(
  pdfPath: string,
  onProgress?: (page: number, total: number) => void,
  password?: string,
  signal?: AbortSignal,
): Promise<ConvertXlsxResult> {
  const res = await runPdfConvertJob(
    {
      kind: 'xlsx',
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
    xlsx: res.bytes,
    pages: res.pages,
    warnings: res.warnings,
    pageResults: res.pageResults,
    scannedDocument: res.scannedDocument,
  }
}

/**
 * Local conversion with an interactive password prompt: encrypted PDFs ask
 * the user for the password (looping on wrong entries) instead of failing.
 * Resolves null when the user cancels the prompt.
 */
export function convertPdfFileToXlsxLocalWithPrompt(
  pdfPath: string,
  promptPassword: (retry: boolean) => Promise<string | null>,
  onProgress?: (page: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ConvertXlsxResult | null> {
  return convertWithPasswordRetry(
    (password) => convertPdfFileToXlsxLocal(pdfPath, onProgress, password, signal),
    promptPassword,
    signal,
  )
}
