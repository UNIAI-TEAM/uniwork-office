import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { atomicCopyFileExclusive } from './atomic-write'

export interface DuplicateFileDeps {
  copySuffix: string
  recordRecentFile(path: string): void
  onError(error: unknown): void
}

/** Shared by Home and the tab menu; copying and error reporting use the existing shell paths. */
export async function duplicateDocumentFile(
  path: string,
  deps: DuplicateFileDeps,
): Promise<string | undefined> {
  const ext = extname(path)
  const base = basename(path, ext)
  for (let i = 1; ; i++) {
    const target = join(dirname(path), `${base} ${deps.copySuffix}${i === 1 ? '' : ` ${i}`}${ext}`)
    if (existsSync(target)) continue
    try {
      await atomicCopyFileExclusive(path, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      deps.onError(error)
      return
    }
    deps.recordRecentFile(target)
    return target
  }
}
