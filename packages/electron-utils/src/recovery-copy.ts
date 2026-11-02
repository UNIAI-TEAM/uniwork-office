<<<<<<< ours
import { statSync } from 'node:fs'

/** mtime of `copyPath` when it is newer than `filePath`, else null (either missing included); read-only */
export function newerCopyMtime(copyPath: string, filePath: string): number | null {
  try {
    const at = statSync(copyPath).mtimeMs
    return at > statSync(filePath).mtimeMs ? at : null
  } catch {
    return null
  }
=======
/**
 * A crash-recovery copy is offered whenever it still exists on open: a newer
 * original is not proof the copy is obsolete (the file may have been edited
 * elsewhere after the crash), it only changes the prompt wording.
 */
export function recoveryCopyDiskNewer(copyMtimeMs: number, originalMtimeMs: number): boolean {
  return originalMtimeMs >= copyMtimeMs
>>>>>>> theirs
}
