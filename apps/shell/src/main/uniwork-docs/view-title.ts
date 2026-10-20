import { basename, dirname } from 'node:path'
import { tUniworkDocs } from './strings'

/**
 * UNI-2033: a read-only copy of an older version lives in the `<documentId>@vN`
 * working-copy folder (service.openFromServer). Its tab / window title says so:
 * "Plan.docx · phiên bản 2, chỉ đọc". The long banner sentence of the comments kit
 * does not fit a title, so the shell has its own short form (`viewVersionSuffix`).
 */

const VERSION_FOLDER = /@v([1-9]\d*)$/

/** N of a `…@vN/<file>` working copy, or null for any other path */
export function viewVersionOfPath(path: string): number | null {
  if (!path) return null
  // a Windows path read on any host: the folder name is the last separator-delimited part of the dir
  const dir = dirname(path.replace(/\\/g, '/'))
  const match = VERSION_FOLDER.exec(basename(dir))
  if (!match) return null
  const version = Number(match[1])
  return Number.isSafeInteger(version) ? version : null
}

/** `title` with the read-only version suffix when `path` is a version copy; idempotent */
export function withViewVersionTitle(
  title: string,
  path: string | undefined,
  lang: string,
): string {
  const version = path ? viewVersionOfPath(path) : null
  if (version === null) return title
  const suffix = tUniworkDocs(lang, 'viewVersionSuffix', { version })
  return title.endsWith(` · ${suffix}`) ? title : `${title} · ${suffix}`
}
