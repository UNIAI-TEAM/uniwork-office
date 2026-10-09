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
 * Who started a save. `'auto'` is the AutoSave timer / blur tick and the silent
 * close-guard save of an AutoSave-on deck; everything else (button, menu,
 * shortcut, close-guard "Save") is `'user'`. A missing value reads as `'user'`,
 * which keeps every existing caller on today's path.
 */
export type UniworkSaveOrigin = 'user' | 'auto'

export function parseUniworkSaveOrigin(value: unknown): UniworkSaveOrigin {
  return value === 'auto' ? 'auto' : 'user'
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

/**
 * Pure save gate (no Electron): a read-only UniWork path is never written; an
 * AutoSave pass never writes a bound path (UniWork only takes explicit saves);
 * the user-save hook fires only for an explicit in-place Save of a deck that
 * already had that path. With no policy installed this always writes and the
 * hook (null outside the shell) is the only difference.
 */
export function uniworkSaveDecision(input: UniworkSaveInput): UniworkSaveDecision {
  if (uniworkIsReadOnly(input.targetPath)) return { write: false, fireHook: false }
  if (input.origin === 'auto' && uniworkIsBound(input.targetPath)) {
    return { write: false, fireHook: false }
  }
  const fireHook =
    input.kind === 'save' &&
    input.origin === 'user' &&
    !!input.currentPath &&
    input.currentPath === input.targetPath
  return { write: true, fireHook }
}
