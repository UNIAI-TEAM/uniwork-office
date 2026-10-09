import { readFile } from 'node:fs/promises'
import type { SavePdfRequest } from '../shared/ipc'
import { writePdfAtomically } from './atomic-write'
import { applyAndVerifySaveRequest, type SavePdfSkips } from './save-pdf'

/**
 * Apply the request to the PDF at sourcePath and atomically write the result to targetPath
 * (temp file next to the target + rename, so a mid-write crash can't corrupt it).
 * The source file is only ever read: Save As (targetPath !== sourcePath) must never mutate
 * the original document, and a failed or cancelled save leaves both paths untouched.
 * In-place Save passes targetPath === sourcePath.
 * Returns the text edits that no longer matched the document and were skipped.
 *
 * Desktop only (node:fs); the bytes-in/bytes-out core is save-pdf.ts, shared with the web frame.
 */
export async function savePdfToPath(
  sourcePath: string,
  targetPath: string,
  request: SavePdfRequest,
): Promise<SavePdfSkips> {
  const { bytes, ...skips } = await applyAndVerifySaveRequest(
    new Uint8Array(await readFile(sourcePath)),
    request,
  )
  await writePdfAtomically(targetPath, bytes)
  return skips
}
