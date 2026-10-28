import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/**
 * Reopen the documents of the previous session at launch.
 * Off by default; when on, the shell window's file tabs and detached editor
 * windows are stored in app-settings.json as it closes and reopened at the
 * next launch.
 */
export const RESTORE_LAST_SESSION_KEY = 'restoreLastSession'
export const LAST_SESSION_DOCUMENTS_KEY = 'lastSessionDocuments'

/** a hand-edited settings file must not open hundreds of tabs at launch */
const MAX_RESTORED_DOCUMENTS = 50

export interface LastSessionFilterDeps {
  /** path lies inside the UniWork working-copy store (reopening as a plain file would bypass the bound open flow and edit lock) */
  inUniworkStore?: (path: string) => boolean
  /** path lies under a revoked or unreachable folder root */
  inUnreachableRoot?: (path: string) => boolean
}

export function restoreLastSessionEnabled(settings: Record<string, unknown>): boolean {
  return settings[RESTORE_LAST_SESSION_KEY] === true
}

/**
 * Filter paths eligible for session persistence and restoration:
 * - absolute string paths only, deduplicated in order, capped at 50
 * - excludes paths inside the UniWork store
 * - excludes paths under revoked or unreachable folder roots
 */
export function filterLastSessionDocuments(
  raw: unknown,
  deps: LastSessionFilterDeps = {},
): string[] {
  if (!Array.isArray(raw)) return []
  const { inUniworkStore, inUnreachableRoot } = deps
  const paths = raw.filter(
    (p): p is string =>
      typeof p === 'string' && isAbsolute(p) && !inUniworkStore?.(p) && !inUnreachableRoot?.(p),
  )
  return [...new Set(paths)].slice(0, MAX_RESTORED_DOCUMENTS)
}

/** the saved tab paths, once each, absolute only, in tab order */
export function readLastSessionDocuments(
  settings: Record<string, unknown>,
  deps: LastSessionFilterDeps = {},
): string[] {
  return filterLastSessionDocuments(settings[LAST_SESSION_DOCUMENTS_KEY], deps)
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * What to open at launch: the previous session's documents that still exist,
 * then the files the launch itself names, so a double-clicked file ends up the
 * active tab. A file already restored is not opened twice.
 */
export function launchPathsWithLastSession(
  settings: Record<string, unknown>,
  launchPaths: readonly string[],
  exists: (path: string) => boolean = isFile,
  deps: LastSessionFilterDeps = {},
): string[] {
  if (!restoreLastSessionEnabled(settings)) return [...launchPaths]
  const restored = readLastSessionDocuments(settings, deps).filter(
    (p) => !launchPaths.includes(p) && exists(p),
  )
  return [...restored, ...launchPaths]
}
