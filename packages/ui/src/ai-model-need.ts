import { useSyncExternalStore } from 'react'

/**
 * The AI panel's "pick a model first" state. The model chip (AiModelPicker) knows whether a key
 * is stored while no model is known; the composer (AiComposer) sits in the same panel and has to
 * keep send off with that hint, so the chip publishes it here instead of every app wiring it.
 * The hint is the localized sentence; null = a model is known (or nothing asked for the rule).
 */
let hint: string | null = null
const listeners = new Set<() => void>()

export function setAiModelNeedHint(next: string | null): void {
  if (hint === next) return
  hint = next
  for (const listener of [...listeners]) listener()
}

export function useAiModelNeedHint(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => hint,
    () => null,
  )
}
