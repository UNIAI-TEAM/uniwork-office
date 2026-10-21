import { closeSync, openSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Create an empty `<baseName>.txt` in `dir` and return its path. A name already taken gets
 * `-2`, `-3`, … (the same suffix style as the other blank files). The file is created with the
 * exclusive flag, so a name taken between the check and the write is never overwritten.
 */
export function createBlankTxtFile(dir: string, baseName: string): string {
  for (let i = 1; ; i++) {
    const path = join(dir, i === 1 ? `${baseName}.txt` : `${baseName}-${i}.txt`)
    try {
      closeSync(openSync(path, 'wx'))
      return path
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
}
