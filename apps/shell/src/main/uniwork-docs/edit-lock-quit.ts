/**
 * EL-1(b): will-quit gate for releasing held edit locks.
 *
 * `will-quit` fires only after every window closed with no veto. The first
 * pass preventDefaults, releases every held lock under one 1.5 s cap, then
 * re-issues quit. The second pass is a no-op so we cannot loop. Token is
 * still valid here: callers must run this BEFORE stopUniworkAccount.
 */

export const EDIT_LOCK_QUIT_CAP_MS = 1500

export type EditLockWillQuitOutcome = 'released' | 'passthrough'

let releasingOnQuit = false

/** test-only: the production process never needs this (one quit per run). */
export function resetEditLockWillQuitForTests(): void {
  releasingOnQuit = false
}

/**
 * Sync probe for the Electron handler: first pass must preventDefault before
 * any await; second pass must run token teardown synchronously.
 */
export function beginEditLockWillQuit(): 'hold' | 'passthrough' {
  if (releasingOnQuit) return 'passthrough'
  releasingOnQuit = true
  return 'hold'
}

export async function finishEditLockWillQuit(
  release: (capMs: number) => Promise<void>,
  capMs = EDIT_LOCK_QUIT_CAP_MS,
): Promise<void> {
  try {
    await release(capMs)
  } catch {
    // best-effort: a hung or throwing DELETE must not skip the re-quit
  }
}

export async function runEditLockWillQuit(opts: {
  preventDefault: () => void
  release: (capMs: number) => Promise<void>
  quitAgain: () => void
  capMs?: number
}): Promise<EditLockWillQuitOutcome> {
  if (beginEditLockWillQuit() === 'passthrough') return 'passthrough'
  opts.preventDefault()
  await finishEditLockWillQuit(opts.release, opts.capMs)
  opts.quitAgain()
  return 'released'
}
