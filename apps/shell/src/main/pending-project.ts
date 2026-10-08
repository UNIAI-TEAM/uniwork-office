/**
 * "Create from a project view" remembers which project the new file belongs to.
 * The click only knows the kind of file, so the project waits per kind until the
 * editor tab for it exists, is then bound to that tab's webContents, and the tab's
 * first save moves the fresh file into the project. Binding to the tab (instead of
 * a bare per-kind slot) keeps an unrelated file of the same kind, e.g. a workbook
 * opened while a new sheet is still unsaved, out of the project. A pending project
 * also expires, so one that is never consumed cannot capture a file hours later:
 * an unbound entry counts from the click, a tab-bound one from the bind (the tab
 * exists, so the user may take a while to save; the freshness check on the file
 * keeps an old file out), and a tab that closes forgets its binding.
 */
export type PendingProjectKind = 'doc' | 'sheet' | 'slide' | 'markdown' | 'html' | 'pdf'

export interface PendingProject {
  kind: PendingProjectKind
  projectId: string
  /** the click; a file born before it never qualifies */
  setAt: number
  /** when the entry was bound to its tab; the TTL of a bound entry counts from here */
  boundAt?: number
}

/** an unbound pending project only applies within this window after the click; a bound one, after the bind */
export const PENDING_PROJECT_TTL_MS = 30 * 60 * 1000

/** the kind of new file a path can be, by extension (null: not a document the project store tracks) */
export function pendingKindForPath(filePath: string): PendingProjectKind | null {
  const ext = /\.([^./\\]+)$/.exec(filePath)?.[1]?.toLowerCase()
  if (ext === 'docx') return 'doc'
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xls' || ext === 'csv') return 'sheet'
  if (ext === 'pptx') return 'slide'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'pdf') return 'pdf'
  return null
}

export class PendingProjects {
  private readonly byKind = new Map<PendingProjectKind, PendingProject>()
  private readonly byWc = new Map<number, PendingProject>()

  /**
   * The click: remember the project for this kind. A click without a project (the
   * default project, or the global view) clears whatever an earlier click left.
   */
  remember(
    kind: PendingProjectKind,
    projectId: string | undefined,
    now: number = Date.now(),
  ): void {
    this.prune(now)
    if (projectId && projectId !== 'default') {
      this.byKind.set(kind, { kind, projectId, setAt: now })
    } else this.byKind.delete(kind)
  }

  /** the project remembered for this kind, consumed; null when none or expired */
  take(kind: PendingProjectKind, now: number = Date.now()): PendingProject | null {
    const pending = this.byKind.get(kind) ?? null
    this.byKind.delete(kind)
    return pending && now - pending.setAt <= PENDING_PROJECT_TTL_MS ? pending : null
  }

  /** hand a taken project to the tab that was just opened for it */
  bind(pending: PendingProject | null, wcId: number | undefined, now: number = Date.now()): void {
    this.prune(now)
    if (pending && wcId !== undefined) this.byWc.set(wcId, { ...pending, boundAt: now })
  }

  /**
   * A file of this tab first hit disk. Returns (and consumes) the tab's project,
   * unless the file is not of the kind the tab was created for or `accept` refuses
   * it (not a fresh file); those leave the binding in place for the real first save.
   */
  takeForTab(
    wcId: number,
    filePath: string,
    accept: (pending: PendingProject) => boolean = () => true,
    now: number = Date.now(),
  ): PendingProject | null {
    const pending = this.byWc.get(wcId)
    if (!pending) return null
    if (now - (pending.boundAt ?? pending.setAt) > PENDING_PROJECT_TTL_MS) {
      this.byWc.delete(wcId)
      return null
    }
    if (pendingKindForPath(filePath) !== pending.kind || !accept(pending)) return null
    this.byWc.delete(wcId)
    return pending
  }

  /** drop what the tab was waiting for (it closed, or its file went elsewhere) */
  forgetTab(wcId: number): void {
    this.byWc.delete(wcId)
  }

  private prune(now: number): void {
    for (const [kind, p] of this.byKind) {
      if (now - p.setAt > PENDING_PROJECT_TTL_MS) this.byKind.delete(kind)
    }
    for (const [wcId, p] of this.byWc) {
      if (now - (p.boundAt ?? p.setAt) > PENDING_PROJECT_TTL_MS) this.byWc.delete(wcId)
    }
  }
}
