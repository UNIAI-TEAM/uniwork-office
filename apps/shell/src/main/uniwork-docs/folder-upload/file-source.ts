import { constants, openAsBlob } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { FolderUploadError } from './transport'

/**
 * What a file looked like when it was looked at: a link, another file in its
 * place, or a different size than at the last look all read as "not the file
 * that was planned".
 */
interface Identity {
  dev: bigint
  ino: bigint
  size: bigint
}

const unreadable = (message: string) => new FolderUploadError('unreadable', message)

const sameFile = (a: Identity, b: Identity): boolean =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size

/** the identity of a regular file, never through a link; a link or a non-file is not one */
async function plainFile(absolutePath: string): Promise<Identity> {
  const info = await lstat(absolutePath, { bigint: true })
  if (!info.isFile()) throw unreadable('not a regular file')
  return { dev: info.dev, ino: info.ino, size: info.size }
}

/**
 * Throws unless `absolutePath` is still a regular file (not a link) of `size`
 * bytes. For the probe read, which opens the path itself.
 */
export async function assertPlainFile(absolutePath: string, size: number): Promise<void> {
  const seen = await plainFile(absolutePath)
  if (seen.size !== BigInt(size)) throw new FolderUploadError('size_changed', 'size changed')
}

/**
 * A file-backed Blob of the file at `absolutePath`: its bytes are read from
 * disk lazily as a request body or slice is consumed, never copied into memory
 * or sent over IPC. A directory or a missing file rejects.
 *
 * The scan never followed a link, and neither does this: the path is lstat-ed,
 * opened with O_NOFOLLOW where the platform has it (Windows has not: the same
 * check is the lstat plus the identity compare), and the opened handle and a
 * second lstat taken after the Blob exists must be the file first seen. A link,
 * or another file in the place of the planned one, rejects as `unreadable`
 * (final: nothing was sent and a retry would see the same). What is left is
 * the gap between that last look and the lazy read.
 */
export async function openFileBlob(absolutePath: string): Promise<Blob> {
  const before = await plainFile(absolutePath)
  const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
    (error: unknown) => {
      // O_NOFOLLOW on a path that became a link between the lstat and the open
      throw (error as NodeJS.ErrnoException).code === 'ELOOP'
        ? unreadable('not a regular file')
        : error
    },
  )
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameFile(before, opened)) throw unreadable('file changed')
    const blob = await openAsBlob(absolutePath)
    if (!sameFile(before, await plainFile(absolutePath)) || BigInt(blob.size) !== before.size) {
      throw unreadable('file changed')
    }
    return blob
  } finally {
    await handle.close().catch(() => undefined)
  }
}
