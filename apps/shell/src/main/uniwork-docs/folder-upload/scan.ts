import { lstat, opendir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { isHiddenName, isUploadableName } from './plan'
import type {
  FolderUploadEntry,
  FolderUploadLimits,
  FolderUploadPlan,
  FolderUploadSkipReason,
} from './types'

/**
 * Disk side of a folder upload (UNI-2052 contract section 4): reads a picked or
 * dropped folder (or loose files) into the `{ path, size }` pairs that the pure
 * planner takes. Main process only; the renderer never sees an absolute path.
 */

/** Skip reasons only the desktop app knows (the web vectors have none of them). */
export type AppSkipReason = 'link' | 'unreadable' | 'not_a_file'

export interface AppSkip {
  /** Relative path, root folder first (files mode: the file name). */
  path: string
  reason: AppSkipReason
}

export interface ScanLimits {
  /** `max_files` of the folder-upload limits. */
  maxFiles: number
  /** `max_depth` of the folder-upload limits. */
  maxDepth: number
  /** The server's extension allow-list; absent = the client's own list (as given to the planner). */
  uploadExtensions?: readonly string[]
}

export interface ScanResult {
  entries: FolderUploadEntry[]
  skipped: AppSkip[]
  /**
   * Why the walk stopped before reading everything (so the list is incomplete
   * and the planner must refuse): more than the entry bound, or a folder below
   * `max_depth + 1`. Null = the folder was listed whole.
   */
  truncated: 'entries' | 'depth' | null
}

/** Uploadable files past `max_files * this` stop the walk: the planner refuses it anyway. */
const UPLOADABLE_BOUND_FACTOR = 2
/** Hard ceiling on every entry read (also those the planner skips), so a flood of junk cannot hang the scan. */
const VISITED_BOUND_FACTOR = 20

interface WalkState {
  entries: FolderUploadEntry[]
  skipped: AppSkip[]
  truncated: ScanResult['truncated']
  uploadable: number
  visited: number
  uploadableBound: number
  visitedBound: number
  maxDepth: number
  uploadExtensions?: readonly string[]
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

type Kind = 'link' | 'directory' | 'file' | 'other'

/** Entries of one directory, sorted so the entry order does not depend on the file system. */
async function readDirectory(
  dir: string,
  state: WalkState,
): Promise<{ name: string; kind: Kind | null }[]> {
  const out: { name: string; kind: Kind | null }[] = []
  const handle = await opendir(dir)
  try {
    for await (const dirent of handle) {
      state.visited += 1
      // a file system that does not report the type gives none of the three: lstat decides later
      const kind: Kind | null = dirent.isSymbolicLink()
        ? 'link'
        : dirent.isDirectory()
          ? 'directory'
          : dirent.isFile()
            ? 'file'
            : null
      out.push({ name: dirent.name, kind })
      if (state.visited > state.visitedBound) {
        state.truncated = 'entries'
        break
      }
    }
  } finally {
    // the iterator closes the handle itself unless it was left early
    await handle.close().catch(() => undefined)
  }
  return out.sort((a, b) => compareNames(a.name, b.name))
}

/**
 * Depth-first read. Symlinks and junctions are never followed (reason `link`),
 * hidden directories (`.git`, `__MACOSX`, ...) are never opened (the web reader
 * skips them the same way), and the walk stops early on the bounds above.
 * Returns false when it stopped.
 */
async function walk(dir: string, rel: string, depth: number, state: WalkState): Promise<boolean> {
  let items: Awaited<ReturnType<typeof readDirectory>>
  try {
    items = await readDirectory(dir, state)
  } catch {
    state.skipped.push({ path: rel, reason: 'unreadable' })
    return true
  }
  for (const item of items) {
    const path = `${rel}/${item.name}`
    const full = join(dir, item.name)
    let kind = item.kind
    let size = 0
    if (kind === null || kind === 'file') {
      const stat = await lstat(full).catch(() => null)
      if (!stat) {
        state.skipped.push({ path, reason: 'unreadable' })
        continue
      }
      kind = stat.isSymbolicLink()
        ? 'link'
        : stat.isDirectory()
          ? 'directory'
          : stat.isFile()
            ? 'file'
            : 'other'
      size = stat.size
    }
    if (kind === 'link') {
      state.skipped.push({ path, reason: 'link' })
    } else if (kind === 'other') {
      state.skipped.push({ path, reason: 'not_a_file' })
    } else if (kind === 'directory') {
      if (isHiddenName(item.name)) continue
      if (depth + 1 > state.maxDepth + 1) {
        state.truncated = 'depth'
        continue
      }
      if (!(await walk(full, path, depth + 1, state))) return false
    } else {
      state.entries.push({ path, size })
      if (isUploadableName(item.name, state.uploadExtensions)) state.uploadable += 1
      if (state.uploadable > state.uploadableBound) {
        state.truncated = 'entries'
        return false
      }
    }
  }
  return state.truncated !== 'entries'
}

/**
 * Reads the folder at `rootPath` into `{ path, size }` pairs with POSIX
 * relative paths whose first segment is the folder's own name. A root that is
 * a link or cannot be read yields no entries and one skip.
 */
export async function scanFolder(rootPath: string, limits: ScanLimits): Promise<ScanResult> {
  const absolute = resolve(rootPath)
  const rootName = basename(absolute)
  const state: WalkState = {
    entries: [],
    skipped: [],
    truncated: null,
    uploadable: 0,
    visited: 0,
    uploadableBound: Math.max(1, limits.maxFiles) * UPLOADABLE_BOUND_FACTOR,
    visitedBound: Math.max(1, limits.maxFiles) * VISITED_BOUND_FACTOR,
    maxDepth: limits.maxDepth,
    uploadExtensions: limits.uploadExtensions,
  }
  const stat = await lstat(absolute).catch(() => null)
  if (!stat) {
    state.skipped.push({ path: rootName, reason: 'unreadable' })
  } else if (stat.isSymbolicLink()) {
    state.skipped.push({ path: rootName, reason: 'link' })
  } else if (!stat.isDirectory()) {
    state.skipped.push({ path: rootName, reason: 'not_a_file' })
  } else {
    await walk(absolute, rootName, 0, state)
  }
  return { entries: state.entries, skipped: state.skipped, truncated: state.truncated }
}

/**
 * Files mode: one `{ path: file name, size }` per picked or dropped path. A
 * directory, a link (never followed) or anything that is not a regular file is
 * rejected into `skipped`; the rest goes to `planFileUpload`.
 */
export async function filesEntries(
  paths: readonly string[],
): Promise<{ entries: FolderUploadEntry[]; skipped: AppSkip[] }> {
  const entries: FolderUploadEntry[] = []
  const skipped: AppSkip[] = []
  for (const path of paths) {
    const name = basename(path)
    const stat = await lstat(path).catch(() => null)
    if (!stat) skipped.push({ path: name, reason: 'unreadable' })
    else if (stat.isSymbolicLink()) skipped.push({ path: name, reason: 'link' })
    else if (!stat.isFile()) skipped.push({ path: name, reason: 'not_a_file' })
    else entries.push({ path: name, size: stat.size })
  }
  return { entries, skipped }
}

/** A plan whose skipped list also carries the app-only reasons. */
export type AppFolderUploadPlan = Omit<FolderUploadPlan, 'skipped'> & {
  skipped: { path: string; reason: FolderUploadSkipReason | AppSkipReason }[]
}

/**
 * Folds the scan's app-only skips into a plan (after the planner's own, in
 * scan order) and makes a truncated scan refuse: the planner saw an incomplete
 * list, so it may have found nothing wrong. A refusal it did find stays; a
 * `nothing_to_upload` of a cut-off scan becomes the cut-off's own refusal.
 * `actual` is then a lower bound ("over N"), like the web reader's.
 */
export function mergeScanSkips(
  plan: FolderUploadPlan,
  scan:
    Pick<ScanResult, 'skipped' | 'truncated'> | { skipped: readonly AppSkip[]; truncated: null },
  limits: Pick<FolderUploadLimits, 'maxFiles' | 'maxDepth'>,
): AppFolderUploadPlan {
  let refusal = plan.refusal
  if (scan.truncated && (refusal === null || refusal.code === 'nothing_to_upload')) {
    refusal =
      scan.truncated === 'depth'
        ? { code: 'too_deep', limit: limits.maxDepth, actual: limits.maxDepth + 1 }
        : {
            code: 'too_many_files',
            limit: limits.maxFiles,
            actual: Math.max(plan.totals.files, limits.maxFiles + 1),
          }
  }
  return { ...plan, skipped: [...plan.skipped, ...scan.skipped], refusal }
}
