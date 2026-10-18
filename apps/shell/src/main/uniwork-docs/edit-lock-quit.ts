/**
 * EL-1(b): will-quit gate for releasing held edit locks.
 *
 * `will-quit` fires only after every window closed with no veto. The first
 * pass preventDefaults, releases every held lock under one 1.5 s cap, then
 * re-issues quit. The second pass is a no-op so we cannot loop. Token is
 * still valid here: callers must run this BEFORE stopUniworkAccount.
 *
 * Two quit-semantics rules (fix9, sheets-find-replace app.close hang):
 * - Hold only when there is something to release. A gate that always holds
 *   changes quit behaviour for every user with no lock.
 * - Re-issue quit on a later macrotask. Electron clears its quitting flag only
 *   after the will-quit emit returns, and microtasks drain inside that emit, so
 *   an app.quit() from a promise that already settled is ignored and the app
 *   never exits.
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
export function beginEditLockWillQuit(hasWork = true): 'hold' | 'passthrough' {
  if (releasingOnQuit || !hasWork) return 'passthrough'
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

/** Run `quit` after the current will-quit emit has fully unwound. */
export function quitAgainAfterWillQuit(quit: () => void): void {
  setImmediate(quit)
}

export async function runEditLockWillQuit(opts: {
  preventDefault: () => void
  release: (capMs: number) => Promise<void>
  quitAgain: () => void
  capMs?: number
  hasWork?: () => boolean
}): Promise<EditLockWillQuitOutcome> {
  if (beginEditLockWillQuit(opts.hasWork?.() ?? true) === 'passthrough') return 'passthrough'
  opts.preventDefault()
  await finishEditLockWillQuit(opts.release, opts.capMs)
  await new Promise<void>((resolve) =>
    quitAgainAfterWillQuit(() => {
      opts.quitAgain()
      resolve()
    }),
  )
  return 'released'
}
