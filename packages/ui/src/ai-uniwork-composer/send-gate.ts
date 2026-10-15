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
 */
export interface UniworkSendGate {
  /** `uniwork.onSendBlockedChange` of the composer */
  readonly onSendBlockedChange: (blocked: boolean) => void
  /** `uniwork.registerBlockedHandler` of the composer: what a refused user action does */
  readonly registerBlockedHandler: (handler: (() => void) | null) => void
  /** The panel's own view, independent of the composer being mounted (UniWork picked and unacked) */
  readonly setPanelBlocked: (blocked: boolean) => void
  /** True while the disclosure blocks Send. Silent: use it from the queue pump */
  readonly isBlocked: () => boolean
  /**
   * For a user-initiated entry (preset, retry, continue): true when the disclosure blocks the
   * send, after announcing the needs-ack line and focusing the disclosure, as Send does.
   */
  readonly refuse: () => boolean
}

export function createUniworkSendGate(): UniworkSendGate {
  let composerBlocked = false
  let panelBlocked = false
  let handler: (() => void) | null = null
  return {
    onSendBlockedChange: (next) => {
      composerBlocked = next
    },
    setPanelBlocked: (next) => {
      panelBlocked = next
    },
    registerBlockedHandler: (next) => {
      handler = next
    },
    isBlocked: () => composerBlocked || panelBlocked,
    refuse: () => {
      if (!composerBlocked && !panelBlocked) return false
      handler?.()
      return true
    },
  }
}

/** One gate per panel instance (stable across renders). */
export function useUniworkSendGate(): UniworkSendGate {
  return useState(createUniworkSendGate)[0]
}
