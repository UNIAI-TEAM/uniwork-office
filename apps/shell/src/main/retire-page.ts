import type { WebContents } from 'electron'

/**
 * A closed docs tab or window keeps its webContents alive (destroying it
 * wedges the shell, see TabManager.removeTab). Left as it is, the orphan still
 * holds the document text and the AI chat of the account that closed it, and
 * stays listed as a debugging target. Navigating it to a blank page unloads
 * the document and its renderer state without destroying the webContents.
 */
export function blankRetiredPage(contents: WebContents): void {
  if (contents.isDestroyed()) return
  void contents.loadURL('about:blank').catch(() => undefined)
}
