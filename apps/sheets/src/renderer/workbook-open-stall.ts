/**
 * Bounds the "Opening workbook…" screen. An open that never settles (a lost
 * shell-queued path, a sidecar that does not answer) must not leave the tab on
 * that screen forever: after WORKBOOK_OPEN_STALL_MS it says so and offers Retry.
 * An open that still finishes later simply replaces the notice.
 */

/** how long the opening screen may stay before it offers Retry */
export const WORKBOOK_OPEN_STALL_MS = 60_000

export interface OpenStallTimer {
  /** (re)arms the timer for an opening screen that just appeared */
  start(): void
  /** the opening screen is gone: never report a stall for it */
  done(): void
}

export function createOpenStallTimer(
  onStall: () => void,
  stallMs: number = WORKBOOK_OPEN_STALL_MS,
): OpenStallTimer {
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  return {
    start() {
      clear()
      timer = setTimeout(() => {
        timer = null
        onStall()
      }, stallMs)
    },
    done: clear,
  }
}

/**
 * Once the grid is mounted: what an opening screen shown at boot waits for.
 * `open` pulls the queued workbook; `stalled` means nothing will ever arrive
 * (no queued path and no open running), so the tab shows the failure at once.
 */
export function bootOpenAction(state: {
  queued: boolean
  opening: boolean
  inFlight: boolean
}): 'open' | 'stalled' | 'none' {
  if (state.queued) return 'open'
  if (state.opening && !state.inFlight) return 'stalled'
  return 'none'
}
