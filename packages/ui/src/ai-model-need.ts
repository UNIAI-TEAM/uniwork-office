import { useSyncExternalStore } from 'react'

/**
 * The AI panel's "nothing to chat with" state: UniWork AI is not on here (signed out, the
 * organization or the format without it, or a cloud state other than ready). The model chip
 * (AiModelPicker) knows it; the composer (AiComposer) sits in the same panel and has to keep send
 * off with that hint, so the chip publishes it here instead of every app wiring it. The hint is
 * the localized sentence (`needModel`); null = UniWork AI can answer (or nothing asked for the
 * rule). `action` opens the account settings (the way out of the state), when the host has one.
 */
interface NeedState {
  hint: string | null
  action: (() => void) | null
}

let state: NeedState = { hint: null, action: null }
const listeners = new Set<() => void>()

export function setAiModelNeedHint(next: string | null, action: (() => void) | null = null): void {
  const hint = next
  const act = next === null ? null : action
  if (state.hint === hint && state.action === act) return
  state = { hint, action: act }
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAiModelNeedHint(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => state.hint,
    () => null,
  )
}

/** opens the account settings from the hint; null when the host has no such entry */
export function useAiModelNeedAction(): (() => void) | null {
  return useSyncExternalStore(
    subscribe,
    () => state.action,
    () => null,
  )
}
