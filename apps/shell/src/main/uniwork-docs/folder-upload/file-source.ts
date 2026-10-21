import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'

/**
 * A file-backed Blob of the file at `absolutePath`: its bytes are read from
 * disk lazily as a request body or slice is consumed, never copied into memory
 * or sent over IPC. A directory or a missing file rejects.
 */
export async function openFileBlob(absolutePath: string): Promise<Blob> {
  const info = await stat(absolutePath)
  if (!info.isFile()) throw new Error('not a regular file')
  return openAsBlob(absolutePath)
}
