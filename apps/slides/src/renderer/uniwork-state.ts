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
  /** a converted legacy .ppt held as a temp copy: it never autosaves */
  converted?: boolean
}

export const PLAIN_SLIDES_STATE: SlidesUniworkState = { bound: false, readOnly: false }

export interface SlidesUniworkSeam {
  uniworkState?(): Promise<{ bound: boolean; readOnly: boolean; converted?: boolean }>
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
    const query = () => {
      void api
        ?.uniworkState?.()
        ?.then((s) => {
          if (live && s)
            setState({ bound: !!s.bound, readOnly: !!s.readOnly, converted: !!s.converted })
        })
        ?.catch(() => {})
    }
    query()
    // EL-1(b): the edit lock makes readOnly change while the deck stays open;
    // the shell pings the affected path, and only a ping for this deck's path
    // re-queries (other tabs' pings stay ignored).
    const unsubscribe = api?.onUniworkStateChanged?.((p) => {
      if (p === path) query()
    })
    return () => {
      live = false
      unsubscribe?.()
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
  api: SlidesUniworkSeam | null | undefined,
  state: SlidesUniworkState,
  origin: 'user' | 'auto',
): void {
  if (origin !== 'user' || !state.bound || !state.readOnly) return
  void api?.uniworkReadOnlySave?.()?.catch(() => {})
}
