import { statSync } from 'node:fs'

/** mtime of `copyPath` when it is newer than `filePath`, else null (either missing included); read-only */
export function newerCopyMtime(copyPath: string, filePath: string): number | null {
  try {
    const at = statSync(copyPath).mtimeMs
    return at > statSync(filePath).mtimeMs ? at : null
  } catch {
    return null
  }
}
