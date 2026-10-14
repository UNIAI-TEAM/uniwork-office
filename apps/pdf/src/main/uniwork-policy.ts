/**
 * UniWork document seam. The shell decides which open paths are working
 * copies of a UniWork document (bound) and which of those the signed-in user
 * may only view; this module only asks. With no policy installed (standalone
 * app, or the shell before sign-in wiring) every path is a plain local file
 * and nothing here changes behaviour.
 */
import { resolve } from 'node:path'
import { PDF_UNIWORK_AUTOSAVE_OFF, PDF_UNIWORK_VIEW_ONLY } from '../shared/uniwork-refusal'

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
 * Who asked for a pdf:save. `user` = an explicit Save (toolbar, ⌘S, menu Save,
 * close-guard Save); `auto` = the renderer's autosave tick / blur; `internal` =
 * a flush the app does on its own before another operation (page tools,
 * exports). Absent (older renderer, Save As) behaves like today and never
 * fires the user-save hook.
 */
export type UniworkSaveOrigin = 'user' | 'auto' | 'internal'

export interface UniworkSaveInput {
  origin: UniworkSaveOrigin | undefined
  /** The document the view has open */
  currentPath: string
  /** Where the bytes go (equals currentPath for a plain Save) */
  targetPath: string
  /** Save As / redaction copy flow (granted by the main-process dialog) */
  saveAs: boolean
}

export interface UniworkSaveDecision {
  /** false = refuse the save: nothing is written and the hook does not fire */
  write: boolean
  /** Fire the user-save hook after the write succeeds */
  fireHook: boolean
  /** Write even when there are no pending edits (bound document, explicit Save) */
  forceWrite: boolean
  /** Readable reason when write is false */
  reason?: string
}

/** Pure save policy for one pdf:save request; with no policy installed it is a pass-through. */
export function uniworkSaveDecision(input: UniworkSaveInput): UniworkSaveDecision {
  const { origin, currentPath, targetPath, saveAs } = input
  const sameFile = uniworkSamePath(currentPath, targetPath)
  if (uniworkIsReadOnly(targetPath)) {
    return {
      write: false,
      fireHook: false,
      forceWrite: false,
      reason: PDF_UNIWORK_VIEW_ONLY,
    }
  }
  if (origin === 'auto' && uniworkIsBound(targetPath)) {
    return {
      write: false,
      fireHook: false,
      forceWrite: false,
      reason: PDF_UNIWORK_AUTOSAVE_OFF,
    }
  }
  // A Save As that picks the open file itself is an explicit Save of it (the
  // renderer sends no origin on that path); onto any other file it is a copy.
  const explicitInPlace =
    sameFile && (saveAs ? origin === undefined || origin === 'user' : origin === 'user')
  return {
    write: true,
    fireHook: explicitInPlace,
    forceWrite: explicitInPlace && uniworkIsBound(currentPath),
  }
}

/** Page tools and other immediate rewrites of the open file: refused for view-only documents. */
export function uniworkMayRewriteInPlace(path: string): boolean {
  return !uniworkIsReadOnly(path)
}
