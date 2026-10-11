/**
 * The respell kick (App.tsx) types one trusted space with ProseMirror's DOM
 * observer paused and later restores the caret text node from a snapshot. Its
 * key shield keeps the user's typing out of that window; edits that arrive
 * another way (a spelling suggestion from the context menu) wait here until
 * the kick has scrubbed and resynced, or the scrub would put the old text back
 * on screen behind ProseMirror and wipe the paragraph's spelling markers.
 *
 * The gate closes as soon as a kick is requested (Add to Dictionary, Ignore
 * All, a language change), not only once it runs: the request reaches the kick
 * through an IPC round trip, two frames and a React render, and a suggestion
 * picked in that gap used to start its Blink round trip just before the kick
 * snapshotted the caret text node. The other way round, a kick does not start
 * while a suggestion's replacement is still in flight (`spellingEditInFlight`).
 */

/** How long a requested kick may take to start before the gate gives up on it. */
export const RESPELL_REQUEST_TIMEOUT_MS = 2000

let gate: { promise: Promise<void>; open: () => void } | null = null
let requestTimer: ReturnType<typeof setTimeout> | undefined
let kickRunning = false
let editsInFlight = 0

function closeGate() {
  if (!gate) {
    let open = () => {}
    const promise = new Promise<void>((resolve) => {
      open = resolve
    })
    gate = { promise, open }
  }
  return gate
}

function openGate() {
  const current = gate
  gate = null
  current?.open()
}

/**
 * A kick was requested and will start shortly: hold spelling edits from now
 * on. Released by the kick's end, or after `timeoutMs` when no kick started
 * (spellcheck off, the kick was cancelled or gave up). Calling it again
 * extends the wait.
 */
export function requestRespellKick(timeoutMs = RESPELL_REQUEST_TIMEOUT_MS): void {
  closeGate()
  if (requestTimer !== undefined) clearTimeout(requestTimer)
  requestTimer = setTimeout(() => {
    requestTimer = undefined
    if (!kickRunning) openGate()
  }, timeoutMs)
}

/** Marks a kick as running; the returned function ends it (call it exactly once). */
export function beginRespellKick(): () => void {
  if (requestTimer !== undefined) clearTimeout(requestTimer)
  requestTimer = undefined
  kickRunning = true
  const current = closeGate()
  let ended = false
  return () => {
    if (ended) return
    ended = true
    kickRunning = false
    // another kick requested meanwhile keeps the gate closed until it ran
    if (gate === current && requestTimer === undefined) openGate()
  }
}

/** Runs `edit` now when no kick is running or requested, else right after it ends. */
export function afterRespellKick(edit: () => void): void {
  if (gate) void gate.promise.then(edit)
  else edit()
}

/** Marks a spelling replacement as in flight; the returned function ends it. */
export function beginSpellingEdit(): () => void {
  editsInFlight++
  let ended = false
  return () => {
    if (ended) return
    ended = true
    editsInFlight--
  }
}

/** True while a spelling replacement is still on its way into the document: a kick must wait. */
export function spellingEditInFlight(): boolean {
  return editsInFlight > 0
}
