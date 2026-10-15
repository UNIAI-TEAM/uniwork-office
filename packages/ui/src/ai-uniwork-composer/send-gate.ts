import { useState } from 'react'

/**
 * The UniWork disclosure gate of one AI panel, shared by every way a message can leave for UniWork
 * AI (Send, presets, retry, continue, the queue pump). The composer feeds it through the
 * `onSendBlockedChange` / `registerBlockedHandler` props of `AiComposerUniworkProps`; the panel
 * asks it at the single send entry every path goes through.
 *
 * The composer is not mounted while the panel is collapsed to its rail, yet a ribbon action can
 * still fire a send then. So the panel also reports its own state (`setPanelBlocked`, computed
 * from the same ack key during render); the gate blocks when either side says so.
 *
 * A refusal while the panel is collapsed has nobody to speak to: the composer is unmounted or
 * hidden. The gate then asks the panel to expand (`setPanelOpen`'s callback), remembers the
 * refusal, and the panel replays it with `flushPendingRefusal` once it is open and its composer
 * has registered, so the reason is announced and the disclosure focused exactly as for Send.
 */
export interface UniworkSendGate {
  /** `uniwork.onSendBlockedChange` of the composer */
  readonly onSendBlockedChange: (blocked: boolean) => void
  /** `uniwork.registerBlockedHandler` of the composer: what a refused user action does */
  readonly registerBlockedHandler: (handler: (() => void) | null) => void
  /** The panel's own view, independent of the composer being mounted (UniWork picked and unacked) */
  readonly setPanelBlocked: (blocked: boolean) => void
  /**
   * The panel's visibility and how to expand it (a no-op for an open panel). Call it during render,
   * as `setPanelBlocked`.
   */
  readonly setPanelOpen: (open: boolean, expand?: () => void) => void
  /**
   * Replay a refusal that arrived while collapsed: announce + focus through the composer handler.
   * Call it from an effect that runs when the panel opens (after the composer's own effects).
   */
  readonly flushPendingRefusal: () => void
  /** True while the disclosure blocks Send. Silent: use it from the queue pump */
  readonly isBlocked: () => boolean
  /**
   * For a user-initiated entry (preset, retry, continue): true when the disclosure blocks the
   * send, after announcing the needs-ack line and focusing the disclosure, as Send does. While
   * the panel is collapsed it expands the panel first and announces once it is open.
   */
  readonly refuse: () => boolean
}

export function createUniworkSendGate(): UniworkSendGate {
  let composerBlocked = false
  let panelBlocked = false
  let handler: (() => void) | null = null
  let panelOpen = true
  let expand: (() => void) | undefined
  let pendingRefusal = false
  return {
    onSendBlockedChange: (next) => {
      composerBlocked = next
    },
    setPanelBlocked: (next) => {
      panelBlocked = next
      // acknowledged before the panel opened: nothing left to announce
      if (!next && !composerBlocked) pendingRefusal = false
    },
    setPanelOpen: (open, onExpand) => {
      panelOpen = open
      expand = onExpand
    },
    flushPendingRefusal: () => {
      if (!pendingRefusal || !panelOpen) return
      pendingRefusal = false
      if (composerBlocked || panelBlocked) handler?.()
    },
    registerBlockedHandler: (next) => {
      handler = next
    },
    isBlocked: () => composerBlocked || panelBlocked,
    refuse: () => {
      if (!composerBlocked && !panelBlocked) return false
      if (!panelOpen) {
        pendingRefusal = true
        expand?.()
        return true
      }
      handler?.()
      return true
    },
  }
}

/** One gate per panel instance (stable across renders). */
export function useUniworkSendGate(): UniworkSendGate {
  return useState(createUniworkSendGate)[0]
}
