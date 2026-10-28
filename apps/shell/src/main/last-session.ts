import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { isDraftPreviewPath } from '@genoffice/electron-utils/draft-preview'
import { describeExtraRoot } from './folder-roots'
import { isInsideRoot } from './folder-tree'

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

export interface LastSessionFilterEnv {
  userDataDir: string
  extraRoots: readonly string[]
  inStore: (path: string) => boolean
  inSourceViews: (path: string) => boolean
}

export function createLastSessionFilterDeps(env: LastSessionFilterEnv): LastSessionFilterDeps {
  const unreachableRoots = env.extraRoots.filter((root) => !describeExtraRoot(root).readable)
  return {
    inUniworkStore: (path) =>
      env.inStore(path) || env.inSourceViews(path) || isDraftPreviewPath(env.userDataDir, path),
    inUnreachableRoot: (path) => unreachableRoots.some((root) => isInsideRoot(root, path)),
  }
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

export interface LaunchSequenceDeps {
  targets: readonly string[]
  launchUrl: string | null
  openPath: (path: string) => boolean
  openUrl: (url: string) => Promise<boolean> | boolean
  openHomeTab: () => void
}

/**
 * Execute the startup open sequence:
 * - Each target in `targets` (restored session documents + launch paths) is opened at most once.
 * - When `launchUrl` is present, it is opened after `targets` so the URL document becomes active.
 * - The Home tab opens only when neither a target nor the launch URL opened a document.
 */
export async function openLaunchSequence(deps: LaunchSequenceDeps): Promise<void> {
  const { targets, launchUrl, openPath, openUrl, openHomeTab } = deps
  let targetOpened = false
  for (const filePath of targets) {
    targetOpened = openPath(filePath) || targetOpened
  }
  let urlOpened = false
  if (launchUrl) {
    urlOpened = await openUrl(launchUrl)
  }
  if (!targetOpened && !urlOpened) {
    openHomeTab()
  }
}

export interface SessionSnapshotRecorderDeps {
  enabled: () => boolean
  filterDeps: () => LastSessionFilterDeps
  write: (paths: string[]) => void
}

export interface SessionSnapshotRecorder {
  onBeforeQuit: (shellPaths: readonly string[] | null, detachedPaths: readonly string[]) => void
  onShellClosed: (droppedShellPaths: readonly string[], detachedPaths: readonly string[]) => void
  onShellCreated: () => void
  onQuitVetoed: () => void
}

/**
 * Process-wide session snapshot state:
 * - `onBeforeQuit` writes `[...shellPaths (or paths captured when the shell closed earlier), ...detachedPaths]`
 *   and marks quit in progress so the shell `closed` listener does not overwrite it with a smaller list.
 * - `onShellClosed` captures the shell's closed paths and writes `[...droppedShellPaths, ...detachedPaths]`
 *   when a quit is not already in progress.
 */
export function createSessionSnapshotRecorder(
  deps: SessionSnapshotRecorderDeps,
): SessionSnapshotRecorder {
  let quitInProgress = false
  let closedShellPaths: string[] = []

  const persist = (raw: readonly string[]): void => {
    if (!deps.enabled()) return
    deps.write(filterLastSessionDocuments(raw, deps.filterDeps()))
  }

  return {
    onBeforeQuit(shellPaths, detachedPaths) {
      if (quitInProgress) return
      const activeShell = shellPaths ? [...shellPaths] : closedShellPaths
      quitInProgress = true
      persist([...activeShell, ...detachedPaths])
    },
    onShellClosed(droppedShellPaths, detachedPaths) {
      closedShellPaths = [...droppedShellPaths]
      if (quitInProgress) return
      persist([...droppedShellPaths, ...detachedPaths])
    },
    onShellCreated() {
      closedShellPaths = []
      quitInProgress = false
    },
    onQuitVetoed() {
      quitInProgress = false
    },
  }
}
