/**
 * The UniWork step of closing a document (a tab, a detached window, the
 * shell window at quit): after the module's own unsaved-changes prompt, a
 * bound document whose local bytes are not in UniWork gets one more prompt
 * (see UniworkDocsService.confirmClose). Electron-free and installed by
 * index.ts, so the tab manager and the window guards need no service handle.
 * Without a guard (or for any other path) closing is unchanged.
 */

export interface UniworkCloseGuard {
  /** synchronous: an editable bound copy of ours (decides whether a close is held) */
  isCloseGuarded(path: string): boolean
  /** true = the document may close */
  confirmClose(path: string): Promise<boolean>
}

let guard: UniworkCloseGuard | null = null

export function setUniworkCloseGuard(next: UniworkCloseGuard | null): void {
  guard = next
}

export function isUniworkCloseGuarded(path: string | undefined): boolean {
  return !!path && !!guard && guard.isCloseGuarded(path)
}

/** true when the document may close (always for unbound paths) */
export async function confirmUniworkClose(path: string | undefined): Promise<boolean> {
  if (!path || !guard || !guard.isCloseGuarded(path)) return true
  return guard.confirmClose(path)
}
