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
  /**
   * G5-11: consumes a one-shot capture request for `path` so a main-triggered
   * save writes the working copy to disk without firing the user-save hook.
   */
  consumeCapture?(path: string): boolean
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
 * Who started a save. `'auto'` is the AutoSave timer / blur tick and the silent
 * close-guard save of an AutoSave-on deck; `'capture'` is a sign-out working-copy
 * flush; everything else (button, menu, shortcut, close-guard "Save") is `'user'`.
 * A missing value reads as `'user'`, which keeps every existing caller on today's path.
 */
export type UniworkSaveOrigin = 'user' | 'auto' | 'capture'

export function parseUniworkSaveOrigin(value: unknown): UniworkSaveOrigin {
  if (value === 'auto') return 'auto'
  if (value === 'capture') return 'capture'
  return 'user'
}

export interface UniworkSaveInput {
  /** `save` = in-place Save, `save-as` = dialog-picked path, `mcp` = agent save-to-path */
  kind: 'save' | 'save-as' | 'mcp'
  origin: UniworkSaveOrigin
  /** The path the document had before this save (null for an untitled deck) */
  currentPath: string | null
  /** Where the bytes would be written */
  targetPath: string
}

export interface UniworkSaveDecision {
  write: boolean
  fireHook: boolean
}

function consumeCaptureFor(path: string | null | undefined): boolean {
  if (!path || !policy?.consumeCapture) return false
  try {
    return policy.consumeCapture(path) === true
  } catch {
    return false
  }
}

/**
 * Pure save gate (no Electron): a read-only UniWork path is never written; an
 * AutoSave pass never writes a bound path (UniWork only takes explicit saves);
 * the user-save hook fires only for an explicit Save (or a Save As that picks
 * the deck's own file) of a deck that already had that path. With no policy installed this always writes and the
 * hook (null outside the shell) is the only difference.
 */
export function uniworkSaveDecision(input: UniworkSaveInput): UniworkSaveDecision {
  const effectiveOrigin: UniworkSaveOrigin =
    input.origin === 'user' && consumeCaptureFor(input.targetPath) ? 'capture' : input.origin
  if (uniworkIsReadOnly(input.targetPath)) return { write: false, fireHook: false }
  if (effectiveOrigin === 'auto' && uniworkIsBound(input.targetPath)) {
    return { write: false, fireHook: false }
  }
  const fireHook =
    input.kind !== 'mcp' &&
    effectiveOrigin === 'user' &&
    uniworkSamePath(input.currentPath, input.targetPath)
  return { write: true, fireHook }
}
