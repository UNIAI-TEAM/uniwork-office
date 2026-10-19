/**
 * UniWork document seam. The shell decides which open paths are working
 * copies of a UniWork document (bound) and which of those the signed-in user
 * may only view; this module only asks. With no policy installed (standalone
 * app, or the shell before sign-in wiring) every path is a plain local file
 * and nothing here changes behaviour.
 */
import { basename, resolve } from 'node:path'

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
   * G5-11: consumes a one-shot capture request for `path` so a main-triggered
   * save writes the working copy to disk without firing the user-save hook.
   */
  consumeCapture?(path: string): boolean
  /**
   * EL-1(b) fix6 (VEL-1): an explicit Save on a read-only bound document asks
   * the shell to explain the lock / view-only state instead of writing.
   */
  readOnlySave?(path: string): void
}

let policy: UniworkDocumentPolicy | null = null
let userSaveHook: ((path: string) => void) | null = null

export function setUniworkDocumentPolicy(next: UniworkDocumentPolicy | null): void {
  policy = next
}

export function setUniworkUserSaveHook(hook: ((path: string) => void) | null): void {
  userSaveHook = hook
}

/** EL-1(b) fix6 (VEL-1): forward a read-only Save attempt to the installed policy. */
export function uniworkReadOnlySave(path: string | null | undefined): void {
  if (!path || !policy?.readOnlySave) return
  try {
    policy.readOnlySave(path)
  } catch {
    /* best-effort explain */
  }
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

/**
 * Where Save As starts for `path`. A UniWork working copy sits in a hidden
 * per-document folder next to its binding, so its Save As offers just the file
 * name (the remembered or default save folder); a local file starts next to itself.
 */
export function uniworkSaveAsDefault(path: string): string {
  return uniworkIsBound(path) ? basename(path) : path
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

export type UniworkSaveOrigin = 'user' | 'auto' | 'capture'

export interface UniworkSaveInput {
  /** absent = an explicit user save (the pre-UniWork renderer never sent one) */
  origin?: UniworkSaveOrigin
  mode: 'save' | 'saveAs'
  /** the document's path before this save; absent for an untitled document */
  currentPath?: string
  targetPath: string
  /** the save was started by an agent/MCP save-to, not by the user */
  mcp?: boolean
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
 * Whether a save may write `targetPath`, and whether it counts as the user's
 * explicit Save of the document they already had open (a Save As onto its own
 * file counts). A view-only UniWork
 * copy is never written; a bound copy is never written by autosave.
 */
export function uniworkSaveDecision(input: UniworkSaveInput): {
  write: boolean
  fireHook: boolean
} {
  const rawOrigin = input.origin ?? 'user'
  const origin: UniworkSaveOrigin =
    rawOrigin === 'user' && consumeCaptureFor(input.targetPath) ? 'capture' : rawOrigin
  if (uniworkIsReadOnly(input.targetPath)) return { write: false, fireHook: false }
  if (origin === 'auto' && uniworkIsBound(input.targetPath))
    return { write: false, fireHook: false }
  const samePath = uniworkSamePath(input.currentPath, input.targetPath)
  return {
    write: true,
    fireHook: origin === 'user' && !input.mcp && samePath,
  }
}
