import { createElement, Fragment, useSyncExternalStore, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

/**
 * The one window-level live region pair of the shell (save pill, queue popover, cancel toast).
 *
 * Two nodes live in a body-level host that exists from app start and is never re-created:
 * a `role=status` node (polite) and a `role=alert` node (assertive). Their role is fixed because a
 * screen reader only announces text written into a region that was already in the page; text is
 * replaced inside them, never the nodes. The host carries `data-uw-live` so the modal S5 dialog's
 * inert sweep over `document.body` children skips it (a modal must not silence the live region).
 */

export const LIVE_HOST_ID = 'uw-live-host'
/** How long an assertive sentence stays in the alert node before it is cleared. */
export const ASSERTIVE_CLEAR_MS = 1000

interface LiveEntry {
  /** Bumped on every write so the same sentence twice is a new node and is read again. */
  n: number
  text: string
}

interface LiveSnapshot {
  polite: LiveEntry
  assertive: LiveEntry
}

const EMPTY: LiveSnapshot = { polite: { n: 0, text: '' }, assertive: { n: 0, text: '' } }

let snapshot: LiveSnapshot = EMPTY
let counter = 0
let clearTimer: ReturnType<typeof setTimeout> | null = null
const assertiveQueue: string[] = []
const listeners = new Set<() => void>()

function emit(next: LiveSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): LiveSnapshot {
  return snapshot
}

function writeAssertive(text: string) {
  counter += 1
  emit({ ...snapshot, assertive: { n: counter, text } })
  clearTimer = setTimeout(() => {
    clearTimer = null
    const next = assertiveQueue.shift()
    if (next !== undefined) {
      writeAssertive(next)
      return
    }
    counter += 1
    emit({ ...snapshot, assertive: { n: counter, text: '' } })
  }, ASSERTIVE_CLEAR_MS)
}

/**
 * Say one sentence to assistive technology. Polite replaces the status text; assertive writes the
 * alert text, clears it after ~1 s, and a second assertive inside that window waits for the clear
 * (queued, never overwritten) so neither sentence is lost.
 */
export function announce(text: string, opts: { assertive?: boolean } = {}): void {
  if (!text) return
  if (opts.assertive) {
    if (clearTimer !== null) assertiveQueue.push(text)
    else writeAssertive(text)
    return
  }
  counter += 1
  emit({ ...snapshot, polite: { n: counter, text } })
}

/** Create the body-level host once (main.tsx calls this before React renders); idempotent. */
export function ensureLiveHost(): HTMLElement {
  const existing = document.getElementById(LIVE_HOST_ID)
  if (existing) return existing
  const host = document.createElement('div')
  host.id = LIVE_HOST_ID
  host.setAttribute('data-uw-live', '')
  document.body.appendChild(host)
  return host
}

/** Mounted once in the shell root: renders the two fixed regions into the body-level host. */
export function UniworkLiveHost(): ReactElement {
  const live = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return createPortal(
    createElement(
      Fragment,
      null,
      createElement(
        'span',
        { className: 'uw-sr-only', role: 'status' },
        live.polite.text ? createElement('span', { key: live.polite.n }, live.polite.text) : null,
      ),
      createElement(
        'span',
        { className: 'uw-sr-only', role: 'alert' },
        live.assertive.text
          ? createElement('span', { key: live.assertive.n }, live.assertive.text)
          : null,
      ),
    ),
    ensureLiveHost(),
  )
}

/** Test seam: drop all queued / pending state between cases. */
export function resetLiveForTests(): void {
  if (clearTimer !== null) clearTimeout(clearTimer)
  clearTimer = null
  assertiveQueue.length = 0
  counter = 0
  emit(EMPTY)
}
