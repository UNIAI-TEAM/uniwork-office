/**
 * The respell kick (App.tsx) types one trusted space with ProseMirror's DOM
 * observer paused and later restores the caret text node from a snapshot. Its
 * key shield keeps the user's typing out of that window; edits that arrive
 * another way (a spelling suggestion from the context menu) wait here until
 * the kick has scrubbed and resynced, or the scrub would put the old text back
 * on screen behind ProseMirror and wipe the paragraph's spelling markers.
 */

let inFlight: Promise<void> | null = null

/** Marks a kick as running; the returned function ends it (call it exactly once). */
export function beginRespellKick(): () => void {
  let done = () => {}
  const current = new Promise<void>((resolve) => {
    done = resolve
  })
  inFlight = current
  return () => {
    if (inFlight === current) inFlight = null
    done()
  }
}

/** Runs `edit` now when no kick is running, else right after the running one ends. */
export function afterRespellKick(edit: () => void): void {
  if (inFlight) void inFlight.then(edit)
  else edit()
}
