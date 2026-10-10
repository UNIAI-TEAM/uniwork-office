import { basename } from 'node:path'

/**
 * The name a workbook shows in status texts. The engine names a session after
 * the file it opened, which is the random temp snapshot, so the name comes
 * from the file the user opened (a CSV import shows its source, a recovered
 * copy the original).
 */
export function workbookDisplayName(paths: {
  path: string
  restoreTarget?: string | undefined
  csvSourcePath?: string | undefined
}): string {
  return basename(paths.restoreTarget ?? paths.csvSourcePath ?? paths.path)
}
