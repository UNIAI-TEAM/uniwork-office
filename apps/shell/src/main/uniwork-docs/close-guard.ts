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
  /**
   * synchronous: closing would actually show the UniWork prompt (an editable
   * copy of ours whose local bytes are not in UniWork); a clean copy is false
   */
  needsClosePrompt(path: string): boolean
  /** true = the document may close */
  confirmClose(path: string): Promise<boolean>
}

let guard: UniworkCloseGuard | null = null
/** EL-1(b) B2: one service hook for MCP / removeTab / window-closed drops */
let dropHook: ((paths: string[]) => void) | null = null

export function setUniworkCloseGuard(next: UniworkCloseGuard | null): void {
  guard = next
}

export function setUniworkPathDropHook(next: ((paths: string[]) => void) | null): void {
  dropHook = next
}

/** best-effort; the service caps the DELETE. Fire-and-forget from tab teardown. */
export function notePathsDropped(paths: string[]): void {
  if (!dropHook || paths.length === 0) return
  dropHook(paths)
}

export function isUniworkCloseGuarded(path: string | undefined): boolean {
  return !!path && !!guard && guard.isCloseGuarded(path)
}

/** true when closing `path` would show the UniWork prompt (false for unbound paths) */
export function uniworkNeedsClosePrompt(path: string | undefined): boolean {
  return !!path && !!guard && guard.needsClosePrompt(path)
}

/** true when the document may close (always for unbound paths) */
export async function confirmUniworkClose(path: string | undefined): Promise<boolean> {
  if (!path || !guard || !guard.isCloseGuarded(path)) return true
  return guard.confirmClose(path)
}
