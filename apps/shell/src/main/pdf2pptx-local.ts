/**
 * Local PDF → PowerPoint conversion for the shell's pdf tabs (pdf2pptx P25, UNI-2167).
 * Mirrors pdf2docx-local.ts: runs the @genoffice/pdf2docx pipeline inside the
 * shared utility-process host (`convert-host.ts`) with the same password retry loop.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ConvertPptxResult } from '../../../../packages/pdf2docx/src'
import { runPdfConvertJob } from './pdf-convert/convert-host'
import { convertWithPasswordRetry } from './pdf2docx-local'

export type { ConvertPptxResult } from '../../../../packages/pdf2docx/src'

const devPackageDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/pdf2docx')

/** Convert a PDF file on disk to pptx bytes, off the main process. */
export async function convertPdfFileToPptxLocal(
  pdfPath: string,
  onProgress?: (page: number, total: number) => void,
  password?: string,
  signal?: AbortSignal,
): Promise<ConvertPptxResult> {
  const res = await runPdfConvertJob(
    {
      kind: 'pptx',
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
    pptx: res.bytes,
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
export function convertPdfFileToPptxLocalWithPrompt(
  pdfPath: string,
  promptPassword: (retry: boolean) => Promise<string | null>,
  onProgress?: (page: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ConvertPptxResult | null> {
  return convertWithPasswordRetry(
    (password) => convertPdfFileToPptxLocal(pdfPath, onProgress, password, signal),
    promptPassword,
  )
}
