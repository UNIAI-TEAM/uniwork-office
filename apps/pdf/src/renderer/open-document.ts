import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { DOC_OPTS } from './view-config'

export function loadPdfForView(bytes: Uint8Array, password?: string) {
  // PDF.js transfers its input to the worker; retain the source for the
  // encrypted-document IPC and metadata checks later in the open pipeline.
  return getDocument({ data: bytes.slice(), password, ...DOC_OPTS })
}

/**
 * Opens `bytes` with the active password (the on-disk password when known,
 * falling back to the session password) and runs `fn` against the loaded
 * document, retiring the PDF.js loading task whether the open or `fn` fails.
 */
export async function withLoadedPdf<T>(
  bytes: Uint8Array,
  password: string | null | undefined,
  fn: (doc: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const task = loadPdfForView(bytes, password ?? undefined)
  let doc: PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (err) {
    void task.destroy()
    throw err
  }
  try {
    return await fn(doc)
  } finally {
    void doc.loadingTask.destroy()
  }
}
