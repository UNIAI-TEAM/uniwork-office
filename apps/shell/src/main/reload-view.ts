import type { WebContents } from 'electron'
import { queueDocsForView } from '../../../docs/src/main/docs-main'
import { clearPdfDirty } from '../../../pdf/src/main/pdf-main'
import { queueWorkbookForView } from '../../../sheets/src/main/sheets-main'
import { queueSlidesForView } from '../../../slides/src/main/slides-main'
import type { TabKind } from '../shared/tabs-api'

/** where a path is shown: a shell tab, or a detached editor window (no tab id) */
export interface ReloadTarget {
  tabId?: string
  kind: TabKind
  webContents: WebContents
}

/**
 * Remount a view's renderer so it re-reads its file from disk (View > Reload, S5 "Reload latest").
 * docs, sheets, and slides renderers get their file only through a one-shot queue, which the first
 * open consumed: without refilling it the reloaded view loses its path (docs/sheets: a blank
 * untitled document whose next Save writes outside the UniWork binding) or falls back to the stale
 * in-memory session (slides). Tabs and detached windows both reload through here so they cannot drift.
 */
export function reloadViewFromDisk(wc: WebContents, kind: TabKind, filePath?: string): void {
  if (kind === 'pdf') clearPdfDirty(wc.id)
  if (filePath) {
    if (kind === 'docs') queueDocsForView(wc, filePath)
    else if (kind === 'sheets') queueWorkbookForView(wc, filePath)
    else if (kind === 'slides') queueSlidesForView(wc, filePath)
  }
  wc.reload()
}

/** Reload whatever shows `path`: a tab goes through the tab manager, a detached window through the same helper. */
export function reloadPathTarget(
  target: ReloadTarget | undefined,
  path: string,
  reloadTab: (tabId: string) => void,
): void {
  if (!target) return
  if (target.tabId) reloadTab(target.tabId)
  else if (!target.webContents.isDestroyed())
    reloadViewFromDisk(target.webContents, target.kind, path)
}
