/**
 * Stopgap sender check for the UNI-2079 inbox and open-at-comment channels:
 * only the main frame of a live webContents may call them (the same check as
 * uniwork-cloud-status.ts). UNI-2073 replaces it: its guarded ipcMain gives
 * every uniwork-work:* and uniwork-doc:* channel the 'shell' policy, after
 * which the callers drop this helper.
 */
export function isMainFrameSender(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  const e = event as {
    sender?: { isDestroyed?: () => boolean; mainFrame?: unknown }
    senderFrame?: unknown
  }
  if (!e.sender || e.sender.isDestroyed?.()) return false
  return Boolean(e.senderFrame && e.senderFrame === e.sender.mainFrame)
}
