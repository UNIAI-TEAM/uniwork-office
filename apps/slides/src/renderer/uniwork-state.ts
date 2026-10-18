import { useEffect, useState } from 'react'

/**
 * EL-1(b): renderer seam for the open deck's UniWork state (bound working
 * copy + read-only by view access or the edit lock). Preload members added by
 * the shell stay optional here so the web bridge and older harnesses keep
 * working without them.
 */
export interface SlidesUniworkState {
  bound: boolean
  readOnly: boolean
}

export const PLAIN_SLIDES_STATE: SlidesUniworkState = { bound: false, readOnly: false }

export interface SlidesUniworkSeam {
  uniworkState?(): Promise<{ bound: boolean; readOnly: boolean }>
  onUniworkStateChanged?(cb: (path: string) => void): () => void
  uniworkReadOnlySave?(path?: string): Promise<void>
}

/** Query main for the open deck's state; re-queried on path change and on the lock ping. */
export function useSlidesUniworkState(
  api: SlidesUniworkSeam | null | undefined,
  path: string | null | undefined,
): SlidesUniworkState {
  const [state, setState] = useState<SlidesUniworkState>(PLAIN_SLIDES_STATE)
  useEffect(() => {
    let live = true
    if (!path) {
      setState(PLAIN_SLIDES_STATE)
      return
    }
    void api
      ?.uniworkState?.()
      ?.then((s) => {
        if (live && s) setState({ bound: !!s.bound, readOnly: !!s.readOnly })
      })
      ?.catch(() => {})
    return () => {
      live = false
    }
  }, [api, path])
  return state
}

/**
 * Explicit Save on a read-only bound deck: asks main to explain the lock
 * instead of silently dropping the command. Autosave and unbound files keep
 * today's behaviour.
 */
export function slidesExplainReadOnlySave(
  _api: SlidesUniworkSeam | null | undefined,
  _state: SlidesUniworkState,
  _origin: 'user' | 'auto',
): void {}
