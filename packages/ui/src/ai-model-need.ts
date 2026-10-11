import { useSyncExternalStore } from 'react'

/**
 * The AI panel's "nothing to chat with yet" state: no key stored, or a key but no model. The model
 * chip (AiModelPicker) knows both; the composer (AiComposer) sits in the same panel and has to
 * keep send off with that hint, so the chip publishes it here instead of every app wiring it.
 * The hint is the localized sentence; null = a model is known (or nothing asked for the rule).
 * `action` opens the AI settings (the way out of the state), when the host has one.
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

/** opens the AI settings from the hint; null when the host has no such entry */
export function useAiModelNeedAction(): (() => void) | null {
  return useSyncExternalStore(
    subscribe,
    () => state.action,
    () => null,
  )
}
