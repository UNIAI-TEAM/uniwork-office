/**
 * EL-1(b): will-quit gate for releasing held edit locks.
 *
 * `will-quit` fires only after every window closed with no veto. The first
 * pass preventDefaults, releases every held lock under one 1.5 s cap, then
 * re-issues quit. The second pass is a no-op so we cannot loop. Token is
 * still valid here: callers must run this BEFORE stopUniworkAccount.
 *
 * Stub until the production body lands (red tests import this symbol).
 */

export const EDIT_LOCK_QUIT_CAP_MS = 1500

export type EditLockWillQuitOutcome = 'released' | 'passthrough'

export async function runEditLockWillQuit(_opts: {
  preventDefault: () => void
  release: (capMs: number) => Promise<void>
  quitAgain: () => void
  capMs?: number
}): Promise<EditLockWillQuitOutcome> {
  throw new Error('runEditLockWillQuit: not implemented')
}
