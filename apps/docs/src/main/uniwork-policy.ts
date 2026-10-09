/**
 * UniWork document seam. The shell decides which open paths are working
 * copies of a UniWork document (bound) and which of those the signed-in user
 * may only view; this module only asks. With no policy installed (standalone
 * app, or the shell before sign-in wiring) every path is a plain local file
 * and nothing here changes behaviour.
 */
export interface UniworkDocumentPolicy {
  isBound(path: string): boolean
  isReadOnly(path: string): boolean
}

let policy: UniworkDocumentPolicy | null = null
let userSaveHook: ((path: string) => void) | null = null

export function setUniworkDocumentPolicy(next: UniworkDocumentPolicy | null): void {
  policy = next
}

export function setUniworkUserSaveHook(hook: ((path: string) => void) | null): void {
  userSaveHook = hook
}

/** A policy that throws must never break a local save, so it reads as "not bound". */
export function uniworkIsBound(path: string | null | undefined): boolean {
  if (!path || !policy) return false
  try {
    return policy.isBound(path)
  } catch {
    return false
  }
}

export function uniworkIsReadOnly(path: string | null | undefined): boolean {
  if (!path || !policy) return false
  try {
    return policy.isReadOnly(path)
  } catch {
    return false
  }
}

/** Called once after an explicit user Save wrote bytes to `path` (never autosave/save-as). */
export function notifyUniworkUserSave(path: string): void {
  if (!userSaveHook) return
  try {
    userSaveHook(path)
  } catch (err) {
    console.error('[uniwork] user-save hook failed', err)
  }
}

/**
 * Where a write came from. `user`: an explicit Save (button, menu, shortcut,
 * close-guard Save) onto the document's own path. `auto`: the module's file
 * autosave or another silent in-place save. `save-as` / `save-new` / `mcp`:
 * writes that land on a path chosen by a dialog, the default folder or an
 * MCP caller.
 */
export type UniworkSaveOrigin = 'user' | 'auto' | 'save-as' | 'save-new' | 'mcp'

export interface UniworkSaveDecision {
  /** false: refuse the save, no bytes written */
  write: boolean
  /** true: call notifyUniworkUserSave(targetPath) once the write succeeded */
  fireHook: boolean
  reason?: 'uniwork-read-only' | 'uniwork-bound'
}

/**
 * Seam rules for one save, decided before anything touches the disk:
 * a view-only UniWork path is never written; a bound path is never written by
 * autosave; only an explicit Save onto the same path reports a user save.
 * With no policy installed every save writes and the hook (null) is inert.
 */
export function uniworkSaveDecision(
  origin: UniworkSaveOrigin,
  targetPath: string | null | undefined,
): UniworkSaveDecision {
  if (uniworkIsReadOnly(targetPath)) {
    return { write: false, fireHook: false, reason: 'uniwork-read-only' }
  }
  if (origin === 'auto' && uniworkIsBound(targetPath)) {
    return { write: false, fireHook: false, reason: 'uniwork-bound' }
  }
  return { write: true, fireHook: origin === 'user' }
}

/** What the renderer needs to know about its document (disable autosave / editing). */
export function uniworkDocState(path: string | null | undefined): {
  bound: boolean
  readOnly: boolean
} {
  return { bound: uniworkIsBound(path), readOnly: uniworkIsReadOnly(path) }
}
