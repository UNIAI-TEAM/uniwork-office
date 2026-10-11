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

/** Who asked for a workbook save: the user (Save, menu, shortcut, close guard) or the AutoSave timer / AI-run autosave. */
export type UniworkSaveOrigin = 'user' | 'auto'

export interface UniworkSaveInput {
  mode: 'save' | 'save-as'
  /** The handler resolves a request without one from `quiet`; absent here saves as before and never fires the hook. */
  origin: UniworkSaveOrigin | undefined
  /** The document's user-visible file before the save; null while it has none yet (unsaved new workbook, converted import). */
  documentPath: string | null
  /** The user-visible file the bytes land on. */
  targetPath: string
  /** MCP / agent explicit-path save (save_to). */
  mcp: boolean
}

export interface UniworkSaveDecision {
  write: boolean
  fireHook: boolean
}

/**
 * The origin of a workbook:save request. A renderer that names none is judged by
 * what it asks for: a quiet save is an AutoSave tick, anything else is the user's
 * own Save. (A missing origin must never let AutoSave write a bound document.)
 */
export function uniworkRequestOrigin(request: {
  origin?: UniworkSaveOrigin | undefined
  quiet?: boolean | undefined
}): UniworkSaveOrigin {
  return request.origin ?? (request.quiet ? 'auto' : 'user')
}

/**
 * Pure save gate for the workbook:save handler. A read-only target is never
 * written; AutoSave never writes a bound document; only an explicit user Save
 * that lands on the file the document already had reports to the shell, and
 * so does a Save As that picks that very file.
 */
export function uniworkSaveDecision(input: UniworkSaveInput): UniworkSaveDecision {
  const { origin, documentPath, targetPath, mcp } = input
  if (uniworkIsReadOnly(targetPath)) return { write: false, fireHook: false }
  if (origin === 'auto' && uniworkIsBound(documentPath)) return { write: false, fireHook: false }
  const fireHook =
    !mcp && origin === 'user' && documentPath !== null && uniworkSamePath(documentPath, targetPath)
  return { write: true, fireHook }
}
