/**
 * UniWork document seam. The shell decides which open paths are working
 * copies of a UniWork document (bound) and which of those the signed-in user
 * may only view; this module only asks. With no policy installed (standalone
 * app, or the shell before sign-in wiring) every path is a plain local file
 * and nothing here changes behaviour.
 */
import { resolve } from 'node:path'

export interface UniworkDocumentPolicy {
  isBound(path: string): boolean
  isReadOnly(path: string): boolean
  /**
   * G5-03a: the server revoked or deleted this open working copy, so it may not
   * be saved, exported or printed. Optional: no shell, or an older shell, never
   * locks.
   */
  isLocked?(path: string): boolean
  /**
   * G5-04g: true when the path's folder declares a store this build does not
   * read (a working copy the shell must not open). Optional: the shell installs
   * it for the three editor modules that own a working copy.
   */
  refuseOpen?(path: string): boolean
  /**
   * G8-02: author name for a new comment on `path` — the shell's single source
   * (the signed-in account's display name for a bound document, else the
   * neutral constant). Absent = neutral constant; never the OS account name.
   */
  commentAuthor?(path: string): string
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

/**
 * G5-03a: true when the shell locked this working copy — the server revoked or
 * deleted a document that is still open. The lock gates export, Save As and
 * print in this module. A policy without isLocked, or one that throws, reads as
 * not locked, so a standalone app and a plain local file are unaffected.
 */
export function uniworkIsLocked(path: string | null | undefined): boolean {
  if (!path || !policy?.isLocked) return false
  try {
    return policy.isLocked(path)
  } catch {
    return false
  }
}

/** G8-02: the author written into a comment when no UniWork account resolves. */
export const NEUTRAL_COMMENT_AUTHOR = 'User'

/**
 * G8-02: author name for a new comment on `path` — the installed source's
 * answer, or the neutral constant when no source is installed or it fails.
 * Never the OS account name: no author path reads the OS account any more.
 */
export function uniworkCommentAuthor(path: string | null | undefined): string {
  if (!path || !policy?.commentAuthor) return NEUTRAL_COMMENT_AUTHOR
  try {
    const name = policy.commentAuthor(path).trim()
    return name.length > 0 ? name : NEUTRAL_COMMENT_AUTHOR
  } catch {
    return NEUTRAL_COMMENT_AUTHOR
  }
}

/**
 * G5-04g: the open chokepoint asks before it reads. A policy that throws, or a
 * policy without refuseOpen, reads as not refused, so a standalone app and a
 * plain local file are unaffected.
 */
export function uniworkRefusesOpen(path: string | null | undefined): boolean {
  if (!path || !policy || !policy.refuseOpen) return false
  try {
    return policy.refuseOpen(path)
  } catch {
    return false
  }
}

/** Same file, ignoring separators and (on Windows) letter case, so a dialog pick of the open file matches. */
export function uniworkSamePath(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false
  const norm = (p: string): string => {
    const r = resolve(p)
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  return norm(a) === norm(b)
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
