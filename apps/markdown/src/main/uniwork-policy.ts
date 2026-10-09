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

export type UniworkSaveOrigin = 'user' | 'auto'

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

/**
 * Whether a save may write `targetPath`, and whether it counts as the user's
 * explicit Save of the document they already had open. A view-only UniWork
 * copy is never written; a bound copy is never written by autosave.
 */
export function uniworkSaveDecision(input: UniworkSaveInput): {
  write: boolean
  fireHook: boolean
} {
  const origin = input.origin ?? 'user'
  if (uniworkIsReadOnly(input.targetPath)) return { write: false, fireHook: false }
  if (origin === 'auto' && uniworkIsBound(input.targetPath))
    return { write: false, fireHook: false }
  const samePath = !!input.currentPath && resolve(input.currentPath) === resolve(input.targetPath)
  return {
    write: true,
    fireHook: origin === 'user' && !input.mcp && input.mode === 'save' && samePath,
  }
}
