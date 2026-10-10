import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SavedSignature } from '../shared/ipc'
import { sanitizeSignatures } from '../shared/signature-list'

export {
  MAX_SAVED_SIGNATURES,
  addSignature,
  isSignatureData,
  removeSignature,
  sanitizeSignatures,
} from '../shared/signature-list'

/** Missing or unreadable file is just an empty list; a broken JSON must not break signing */
export async function loadSignatures(filePath: string): Promise<SavedSignature[]> {
  try {
    return sanitizeSignatures(JSON.parse(await readFile(filePath, 'utf8')))
  } catch {
    return []
  }
}

/** Atomic write (tmp + rename) so a crash mid-write can't corrupt the saved list */
export async function saveSignatures(filePath: string, list: SavedSignature[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(list))
  await rename(tmp, filePath)
}
