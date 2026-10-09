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

/** Who asked for a workbook save: the user (Save, menu, shortcut, close guard) or the AutoSave timer / AI-run autosave. */
export type UniworkSaveOrigin = 'user' | 'auto'

export interface UniworkSaveInput {
  mode: 'save' | 'save-as'
  /** Absent = an older caller: saves exactly as before, never fires the hook. */
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
 * Pure save gate for the workbook:save handler. A read-only target is never
 * written; AutoSave never writes a bound document; only an explicit user Save
 * that lands on the file the document already had reports to the shell.
 */
export function uniworkSaveDecision(input: UniworkSaveInput): UniworkSaveDecision {
  const { mode, origin, documentPath, targetPath, mcp } = input
  if (uniworkIsReadOnly(targetPath)) return { write: false, fireHook: false }
  if (origin === 'auto' && uniworkIsBound(documentPath)) return { write: false, fireHook: false }
  const fireHook =
    !mcp &&
    mode === 'save' &&
    origin === 'user' &&
    documentPath !== null &&
    targetPath === documentPath
  return { write: true, fireHook }
}
