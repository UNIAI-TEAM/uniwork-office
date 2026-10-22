import { useEffect, useSyncExternalStore } from 'react'
import {
  currentShortcutPlatform,
  findShortcut,
  matchShortcut,
  type ShortcutPlatform,
} from '@genoffice/shortcuts'
import { asAskUniFlags, type AskUniV2Bridge } from '../../shared/askuni-api'
import { hasAskUniBridge } from './AskUniPane'

/**
 * The renderer-side switches around Ask UNI: the public `ask_uni_stream` flag (which version of the
 * pane shows), the request to open My AI in Ask UNI mode (Ctrl/Cmd+J), and the shortcut itself.
 * Everything lives in the shell renderer: no new main channel.
 */

/** the flag is read again when the window regains focus, at most this often */
export const ASKUNI_FLAGS_REFRESH_MS = 60_000

/** the table row of the shortcut (shell scope: fires only while the shell page has focus) */
const SHORTCUT_ROW = 'shell-21'

// -- flag store --------------------------------------------------------------------------------

interface FlagSnapshot {
  loaded: boolean
  enabled: boolean
}

let flagState: { loaded: boolean; enabled: boolean } = { loaded: false, enabled: false }
let flagStamp = 0
let flagInFlight: Promise<void> | null = null
const flagListeners = new Set<() => void>()
const SETTLED_OFF: FlagSnapshot = { loaded: true, enabled: false }

function flagsCall(): AskUniV2Bridge['askUniFlags'] | undefined {
  const b = (window as unknown as { aiOffice?: Partial<AskUniV2Bridge> }).aiOffice
  return typeof b?.askUniFlags === 'function' ? b.askUniFlags.bind(b) : undefined
}

function emitFlags(): void {
  for (const l of flagListeners) l()
}

/**
 * Reads the flag from the bridge. Skipped inside the refresh window unless forced (a sign-in or a
 * workspace change); callers share one call in flight. A failed read keeps the last answer.
 */
export function refreshAskUniFlags(opts: { force?: boolean } = {}): Promise<void> {
  const call = flagsCall()
  if (!call) return Promise.resolve()
  if (flagInFlight) return flagInFlight
  const now = Date.now()
  if (!opts.force && flagState.loaded && now - flagStamp < ASKUNI_FLAGS_REFRESH_MS) {
    return Promise.resolve()
  }
  flagStamp = now
  const run = call().then(
    (raw) => {
      const next = { loaded: true, enabled: asAskUniFlags(raw).streamEnabled }
      if (next.enabled !== flagState.enabled || !flagState.loaded) {
        flagState = next
        emitFlags()
      }
    },
    () => {
      // keep what was known; an unanswered first read settles as off
      if (!flagState.loaded) {
        flagState = { loaded: true, enabled: false }
        emitFlags()
      }
    },
  )
  const tracked = run.finally(() => {
    flagInFlight = null
  })
  flagInFlight = tracked
  return tracked
}

function flagSnapshot(): FlagSnapshot {
  // a bridge with no flags method never has an answer to wait for: the P1 pane, at once
  if (!flagsCall()) return SETTLED_OFF
  return flagState
}

function subscribeFlags(cb: () => void): () => void {
  flagListeners.add(cb)
  return () => {
    flagListeners.delete(cb)
  }
}

/** `loaded` false = the first answer is still on its way; `enabled` = show the v2 pane */
export function useAskUniStreamFlag(): FlagSnapshot {
  const snap = useSyncExternalStore(subscribeFlags, flagSnapshot, flagSnapshot)
  useEffect(() => {
    void refreshAskUniFlags()
    const onFocus = () => void refreshAskUniFlags()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  return snap
}

// -- open request ------------------------------------------------------------------------------

let requestSeq = 0
let pendingSeq: number | null = null
const requestListeners = new Set<() => void>()

/** ask My AI to open in Ask UNI mode; waits for the first subscriber if none is mounted yet */
export function requestAskUniOpen(): void {
  pendingSeq = ++requestSeq
  for (const l of requestListeners) l()
}

/** the request has been applied; a newer one stays */
export function consumeAskUniOpen(seq: number): void {
  if (pendingSeq !== seq) return
  pendingSeq = null
  for (const l of requestListeners) l()
}

const NO_REQUEST = null
let requestSnapshot: { seq: number } | null = NO_REQUEST
function requestSnap(): { seq: number } | null {
  if (pendingSeq === null) return (requestSnapshot = NO_REQUEST)
  if (requestSnapshot?.seq !== pendingSeq) requestSnapshot = { seq: pendingSeq }
  return requestSnapshot
}
function subscribeRequests(cb: () => void): () => void {
  requestListeners.add(cb)
  return () => {
    requestListeners.delete(cb)
  }
}

/** the open request nobody has consumed yet (null when none) */
export function useAskUniOpenRequest(): { seq: number } | null {
  return useSyncExternalStore(subscribeRequests, requestSnap, requestSnap)
}

// -- shortcut ----------------------------------------------------------------------------------

/** the event is the table's Ask UNI chord on this platform (Ctrl+J / Cmd+J) */
export function isAskUniShortcut(
  event: KeyboardEvent,
  platform: ShortcutPlatform = currentShortcutPlatform(),
): boolean {
  const action = findShortcut('shell', SHORTCUT_ROW)
  return action !== undefined && matchShortcut(event, [action], platform, 'desktop') !== null
}

/**
 * Ctrl/Cmd+J opens Home My AI in Ask UNI mode. A window keydown of the shell page, so it only fires
 * while the shell webContents has focus (Home, the tab strip): the editors are other webContents and
 * keep Justify. Nothing happens when the shell has no Ask UNI.
 */
export function useAskUniShortcut(platform?: ShortcutPlatform): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hasAskUniBridge() || !isAskUniShortcut(e, platform)) return
      // a modal dialog (Settings, onboarding) owns the keys: switching Home behind it would surprise
      if (document.querySelector('[aria-modal="true"]')) return
      e.preventDefault()
      // the tab strip keeps focus in the shell page: bring Home forward, then ask it to open
      void window.aiOfficeTabs?.activate('home')?.catch?.(() => undefined)
      requestAskUniOpen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [platform])
}

/** tests start from a clean module */
export function resetAskUniEntryForTests(): void {
  flagState = { loaded: false, enabled: false }
  flagStamp = 0
  flagInFlight = null
  requestSeq = 0
  pendingSeq = null
  requestSnapshot = NO_REQUEST
}
