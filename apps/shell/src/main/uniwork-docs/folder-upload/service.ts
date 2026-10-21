import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { UniworkFolderNode } from '../../../shared/home-api'
import type {
  BatchUploadMode,
  BatchUploadProgress,
  BatchUploadRefusal,
  BatchUploadStartResult,
  PreflightSDO,
} from '../../../shared/folder-upload-api'
import { UPLOAD_EXTENSIONS } from '../formats'
import { planFileUpload, planFolderUpload } from './plan'
import type { FolderUploadRunnerPort, FolderUploadRunProgress } from './runner-port'
import { filesEntries, mergeScanSkips, scanFolder } from './scan'
import type { AppFolderUploadPlan } from './scan'
import type { FolderUploadLimits } from './types'

/**
 * UNI-2052 folder / multi-file upload, main side of the IPC (CONTRACT-app
 * sections 3 to 5). It turns a pick or a drop into pre-flights (resolve the
 * destination, read the disk, plan with the shared planner), keeps the absolute
 * paths under a pre-flight id, and hands a started pre-flight to a runner port.
 * Electron-free: the dialogs, the document client and the runners are injected,
 * so the wiring supplies them and the tests fake them.
 */

export interface FolderUploadServiceDeps {
  /** the native folder dialog; null when cancelled */
  pickDirectory(): Promise<string | null>
  /** the native multi-file dialog, filtered by these extensions; [] when cancelled */
  pickFiles(extensions: readonly string[]): Promise<string[]>
  /** the workspace's folder tree; throws when it cannot be read */
  folderTree(workspaceId: string): Promise<UniworkFolderNode[]>
  /** the caller's My Folder (created on first use); throws when it cannot be had */
  ensureMyFolder(workspaceId: string): Promise<{ id: string; title: string }>
  /**
   * The server's folder_upload limits as the planner takes them; null when the
   * server sent no folder_upload block (folder mode is then off and files go
   * one by one).
   */
  getFolderUploadLimits(): FolderUploadLimits | null | Promise<FolderUploadLimits | null>
  /** the planner limits of the sequential fallback (a server without folder_upload) */
  sequentialLimits(): Promise<FolderUploadLimits>
  /** the batch runner (5 server routes); used when `getFolderUploadLimits` is not null */
  runner: FolderUploadRunnerPort
  /** single uploads one after the other; used when it is null */
  sequential: FolderUploadRunnerPort
  now?(): number
  newId?(): string
}

export interface FolderUploadService {
  /** the server takes folders (it sent a folder_upload block); read fresh each call */
  foldersAvailable(): Promise<boolean>
  pick(input: unknown): Promise<PreflightSDO | null>
  preflight(input: unknown): Promise<PreflightSDO[]>
  /** `sink` receives the run's progress (the window that started it) */
  start(input: unknown, sink: (event: BatchUploadProgress) => void): BatchUploadStartResult
  cancel(runId: unknown): void
  retry(runId: unknown): void
  dismiss(runId: unknown): void
}

/** how long a pre-flight can wait for its Upload press before main forgets its paths */
const PREFLIGHT_TTL_MS = 30 * 60 * 1000
/** pre-flights held at once; the oldest goes first */
const MAX_PREFLIGHTS = 32
/** finished runs kept for retry / dismiss; the oldest goes first */
const MAX_RUNS = 32
/** dropped paths read in one call */
const MAX_DROPPED_PATHS = 2000
const MAX_PATH_LENGTH = 4096
const MAX_ID_LENGTH = 200

interface PreflightRecord {
  workspaceId: string
  /** the destination folder id (My Folder when the caller was at the workspace root) */
  parentId: string
  plan: AppFolderUploadPlan
  /** absolute path of each input entry, by `PlannedFile.index` */
  paths: string[]
  sequential: boolean
  expiresAt: number
}

interface RunRecord {
  port: FolderUploadRunnerPort
  /** false after a done/failed report (kept for retry) until a retry reports progress again */
  running: boolean
}

interface Target {
  folderId: string
  label: string
  /** tree level of the destination for the depth check: workspace root 0, My Folder 1 */
  level: number
  siblingNames: string[]
}

type Groups = { files: string[]; dirs: string[] }

function nonEmptyString(value: unknown, max = MAX_ID_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** the node with `id` and its level (a root node is level 1), or null */
function locate(
  nodes: readonly UniworkFolderNode[],
  id: string,
  level = 1,
): { node: UniworkFolderNode; level: number } | null {
  for (const node of nodes) {
    if (node.id === id) return { node, level }
    const inside = locate(node.children, id, level + 1)
    if (inside) return inside
  }
  return null
}

export function createFolderUploadService(deps: FolderUploadServiceDeps): FolderUploadService {
  const now = deps.now ?? (() => Date.now())
  const newId = deps.newId ?? (() => randomUUID())
  const preflights = new Map<string, PreflightRecord>()
  const runs = new Map<string, RunRecord>()

  function expire(): void {
    const at = now()
    for (const [id, held] of preflights) if (held.expiresAt <= at) preflights.delete(id)
  }

  /** room for one more pre-flight: the expired go, then the oldest */
  function sweep(): void {
    expire()
    while (preflights.size >= MAX_PREFLIGHTS) {
      const oldest = preflights.keys().next().value
      if (oldest === undefined) break
      preflights.delete(oldest)
    }
  }

  async function resolveTarget(
    workspaceId: string,
    folderId: string | null,
  ): Promise<Target | null> {
    try {
      let id = folderId
      let fallbackLabel = ''
      if (id === null) {
        // the workspace root means My Folder, as an upload from the toolbar does today
        const mine = await deps.ensureMyFolder(workspaceId)
        id = mine.id
        fallbackLabel = mine.title
      }
      const tree = await deps.folderTree(workspaceId)
      const hit = locate(tree, id)
      if (hit) {
        return {
          folderId: id,
          label: hit.node.title,
          level: hit.level,
          siblingNames: hit.node.children.map((child) => child.title),
        }
      }
      // a My Folder the tree does not list yet is a root-level folder with nothing in it
      return folderId === null
        ? { folderId: id, label: fallbackLabel, level: 1, siblingNames: [] }
        : null
    } catch {
      return null
    }
  }

  function refused(
    mode: BatchUploadMode,
    workspaceId: string,
    folderId: string | null,
    refusal: BatchUploadRefusal,
    shareAvailable: boolean,
  ): PreflightSDO {
    return {
      preflightId: newId(),
      mode,
      target: { workspaceId, folderId, label: '' },
      totals: { files: 0, bytes: 0 },
      skipped: [],
      refusal,
      shareAvailable,
    }
  }

  function remember(
    workspaceId: string,
    target: Target,
    plan: AppFolderUploadPlan,
    paths: string[],
    sequential: boolean,
  ): string {
    sweep()
    const preflightId = newId()
    preflights.set(preflightId, {
      workspaceId,
      parentId: target.folderId,
      plan,
      paths,
      sequential,
      expiresAt: now() + PREFLIGHT_TTL_MS,
    })
    return preflightId
  }

  async function folderPreflight(
    workspaceId: string,
    target: Target,
    path: string,
    limits: FolderUploadLimits,
  ): Promise<PreflightSDO> {
    const absolute = resolve(path)
    const scan = await scanFolder(absolute, {
      maxFiles: limits.maxFiles,
      maxDepth: limits.maxDepth,
      uploadExtensions: limits.uploadExtensions,
    })
    const plan = mergeScanSkips(
      planFolderUpload(scan.entries, {
        limits,
        parentLevel: target.level,
        siblingNames: target.siblingNames,
      }),
      scan,
      limits,
    )
    // entry paths start with the folder's own name, so they sit under its parent
    const parent = dirname(absolute)
    const paths = scan.entries.map((entry) => join(parent, ...entry.path.split('/')))
    const preflightId = remember(workspaceId, target, plan, paths, false)
    const rootName = plan.rootName || basename(absolute)
    return {
      preflightId,
      mode: 'folder',
      rootName,
      ...(plan.rootTitle && plan.rootTitle !== rootName ? { rootNamePreview: plan.rootTitle } : {}),
      target: { workspaceId, folderId: target.folderId, label: target.label },
      totals: plan.totals,
      skipped: plan.skipped,
      refusal: plan.refusal,
      shareAvailable: true,
    }
  }

  async function filesPreflight(
    workspaceId: string,
    target: Target,
    paths: readonly string[],
    limits: FolderUploadLimits,
    sequential: boolean,
  ): Promise<PreflightSDO> {
    const entries: { path: string; size: number }[] = []
    const absolute: string[] = []
    const skipped: Awaited<ReturnType<typeof filesEntries>>['skipped'] = []
    for (const path of paths) {
      // one path at a time, so each entry keeps the path it was read from
      const read = await filesEntries([path])
      entries.push(...read.entries)
      if (read.entries.length > 0) absolute.push(path)
      skipped.push(...read.skipped)
    }
    const plan = mergeScanSkips(
      planFileUpload(entries, { limits, parentLevel: target.level }),
      { skipped, truncated: null },
      limits,
    )
    const preflightId = remember(workspaceId, target, plan, absolute, sequential)
    return {
      preflightId,
      mode: 'files',
      target: { workspaceId, folderId: target.folderId, label: target.label },
      totals: plan.totals,
      skipped: plan.skipped,
      refusal: plan.refusal,
      shareAvailable: !sequential,
    }
  }

  /** the fallback uploads through the single-file path, which only takes the formats the app opens */
  async function fallbackLimits(): Promise<FolderUploadLimits> {
    return { ...(await deps.sequentialLimits()), uploadExtensions: UPLOAD_EXTENSIONS }
  }

  /** the pre-flights of one pick or drop: the loose files first, then each folder */
  async function build(
    workspaceId: string,
    folderId: string | null,
    groups: Groups,
    limits: FolderUploadLimits | null,
  ): Promise<PreflightSDO[]> {
    const shareAvailable = limits !== null
    const out: PreflightSDO[] = []
    const target = await resolveTarget(workspaceId, folderId)
    const unavailable = (mode: BatchUploadMode) =>
      refused(mode, workspaceId, folderId, { code: 'target_unavailable' }, shareAvailable)
    if (groups.files.length > 0) {
      out.push(
        target
          ? await filesPreflight(
              workspaceId,
              target,
              groups.files,
              limits ?? (await fallbackLimits()),
              limits === null,
            )
          : unavailable('files'),
      )
    }
    // a drop never holds more pre-flights than the store keeps, or its own earliest ones would be evicted
    const room = MAX_PREFLIGHTS - (groups.files.length > 0 ? 1 : 0)
    for (const dir of groups.dirs.slice(0, room)) {
      if (limits === null) {
        out.push(
          refused('folder', workspaceId, folderId, { code: 'folder_upload_unavailable' }, false),
        )
      } else {
        out.push(
          target ? await folderPreflight(workspaceId, target, dir, limits) : unavailable('folder'),
        )
      }
    }
    if (groups.dirs.length > room) {
      out.push(
        refused(
          'folder',
          workspaceId,
          folderId,
          { code: 'too_many_folders', limit: room, actual: groups.dirs.length },
          shareAvailable,
        ),
      )
    }
    return out
  }

  function destination(input: unknown): { workspaceId: string; folderId: string | null } | null {
    const body = record(input)
    if (!body || !nonEmptyString(body.workspaceId)) return null
    const folderId = body.folderId
    if (folderId !== null && !nonEmptyString(folderId)) return null
    return { workspaceId: body.workspaceId, folderId }
  }

  async function pick(input: unknown): Promise<PreflightSDO | null> {
    const where = destination(input)
    const mode = record(input)?.mode
    if (!where || (mode !== 'folder' && mode !== 'files')) return null
    const limits = await deps.getFolderUploadLimits()
    if (mode === 'folder') {
      if (limits === null) {
        return refused(
          'folder',
          where.workspaceId,
          where.folderId,
          { code: 'folder_upload_unavailable' },
          false,
        )
      }
      const dir = await deps.pickDirectory()
      if (!dir) return null
      return (
        (await build(where.workspaceId, where.folderId, { files: [], dirs: [dir] }, limits))[0] ??
        null
      )
    }
    const files = await deps.pickFiles(limits?.uploadExtensions ?? UPLOAD_EXTENSIONS)
    if (files.length === 0) return null
    return (await build(where.workspaceId, where.folderId, { files, dirs: [] }, limits))[0] ?? null
  }

  async function preflight(input: unknown): Promise<PreflightSDO[]> {
    const where = destination(input)
    const raw = record(input)?.paths
    if (!where || !Array.isArray(raw)) return []
    const paths = [
      ...new Set(
        raw
          .filter((p): p is string => nonEmptyString(p, MAX_PATH_LENGTH) && isAbsolute(p))
          .slice(0, MAX_DROPPED_PATHS),
      ),
    ]
    if (paths.length === 0) return []
    const groups: Groups = { files: [], dirs: [] }
    for (const path of paths) {
      // lstat: a link is never followed, so a link to a folder is a file entry that is skipped as a link
      const stat = await lstat(path).catch(() => null)
      if (stat?.isDirectory()) groups.dirs.push(path)
      else groups.files.push(path)
    }
    return build(where.workspaceId, where.folderId, groups, await deps.getFolderUploadLimits())
  }

  function start(
    input: unknown,
    sink: (event: BatchUploadProgress) => void,
  ): BatchUploadStartResult {
    const body = record(input)
    if (
      !body ||
      !nonEmptyString(body.preflightId) ||
      typeof body.shareWithWorkspace !== 'boolean'
    ) {
      return { ok: false, error: 'invalid_input' }
    }
    expire()
    const held = preflights.get(body.preflightId)
    if (!held || held.expiresAt <= now()) return { ok: false, error: 'unknown_preflight' }
    // one Upload press per pre-flight
    preflights.delete(body.preflightId)
    if (held.plan.refusal) return { ok: false, error: 'refused' }

    const runId = newId()
    const port = held.sequential ? deps.sequential : deps.runner
    const { plan } = held
    const emit = (progress: FolderUploadRunProgress): void => {
      const event: BatchUploadProgress = {
        runId,
        ...progress,
        ...(progress.rootTitle === undefined && plan.rootTitle
          ? { rootTitle: plan.rootTitle }
          : {}),
      }
      // a run is kept only while a report or a retry may still name it
      const settled =
        progress.phase === 'canceled' ||
        ((progress.phase === 'done' || progress.phase === 'failed') && !progress.failures?.length)
      if (settled) runs.delete(runId)
      else {
        const held = runs.get(runId)
        if (held) held.running = progress.phase !== 'done' && progress.phase !== 'failed'
      }
      try {
        sink(event)
      } catch {
        // the window that started the run is gone; the run goes on without a view
      }
    }
    runs.set(runId, { port, running: true })
    // only a run that finished (kept for its report) can be forgotten: a running one must stay cancellable
    for (const [id, held] of runs) {
      if (runs.size <= MAX_RUNS) break
      if (!held.running) runs.delete(id)
    }
    emit({
      phase: 'planning',
      done: 0,
      failed: 0,
      total: plan.totals.files,
      sentBytes: 0,
      totalBytes: plan.totals.bytes,
    })
    try {
      port.start(plan, {
        runId,
        workspaceId: held.workspaceId,
        parentId: held.parentId,
        shareWithWorkspace: body.shareWithWorkspace,
        filePath: (index) => held.paths[index] ?? '',
        onProgress: emit,
      })
    } catch {
      emit({
        phase: 'failed',
        done: 0,
        failed: 0,
        total: plan.totals.files,
        sentBytes: 0,
        totalBytes: plan.totals.bytes,
        error: { code: 'start_failed' },
      })
    }
    return { ok: true, runId }
  }

  function control(runId: unknown, act: (port: FolderUploadRunnerPort, id: string) => void): void {
    if (!nonEmptyString(runId)) return
    const run = runs.get(runId)
    if (run) act(run.port, runId)
  }

  return {
    foldersAvailable: async () => (await deps.getFolderUploadLimits()) !== null,
    pick,
    preflight,
    start,
    cancel: (runId) => control(runId, (port, id) => port.cancel(id)),
    retry: (runId) => control(runId, (port, id) => port.retry(id)),
    dismiss: (runId) =>
      control(runId, (port, id) => {
        runs.delete(id)
        port.dismiss(id)
      }),
  }
}
