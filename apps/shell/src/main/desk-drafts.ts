import { basename } from 'node:path'
import type { DeskDraft } from '../shared/home-api'
import type { DocumentTabKind, OpenDocumentTab } from '../shared/tabs-api'

/** One editor's crash-copy probe: which recents it owns and the copy's mtime (null = none newer). */
export interface RecoveryProbe {
  app: DocumentTabKind
  ext: RegExp
  mtime(path: string): number | null
}

/**
 * The Desk's "In progress" drafts: every open tab (main window and detached)
 * with unsaved changes, then each recent file that is not open but has a
 * crash copy newer than itself. Only stats, never reads a document.
 */
export async function listDeskDrafts(deps: {
  openTabs(): Promise<OpenDocumentTab[]>
  recents(): string[]
  probes: readonly RecoveryProbe[]
}): Promise<DeskDraft[]> {
  const tabs = await deps.openTabs()
  const open = new Set(tabs.flatMap((t) => (t.filePath ? [t.filePath] : [])))
  const unsaved = tabs
    .filter((t) => t.dirty)
    .map((t): DeskDraft => ({
      kind: 'unsaved',
      title: t.title,
      app: t.kind,
      tabId: t.id,
      ...(t.filePath ? { filePath: t.filePath } : {}),
    }))
  const recovery: DeskDraft[] = []
  for (const path of deps.recents()) {
    if (open.has(path)) continue
    const probe = deps.probes.find((p) => p.ext.test(path))
    const at = probe ? probe.mtime(path) : null
    if (probe && at !== null) {
      recovery.push({
        kind: 'recovery',
        title: basename(path),
        app: probe.app,
        filePath: path,
        modifiedMs: at,
      })
    }
  }
  return [...unsaved, ...recovery]
}
