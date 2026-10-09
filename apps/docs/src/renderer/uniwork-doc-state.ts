import { useEffect, useState } from 'react'

/**
 * UniWork seam, renderer half. The main process answers whether the open file
 * is a UniWork working copy (bound: file autosave is forced off, Save always
 * writes) and whether the user may only view it. A plain local file (or no
 * shell policy) reads as neither, so nothing changes.
 */
export interface UniworkDocState {
  /** the path this answer belongs to: a stale answer never applies to a new path */
  path: string | null
  bound: boolean
  readOnly: boolean
}

export const NO_UNIWORK_STATE: UniworkDocState = { path: null, bound: false, readOnly: false }

/** the answer for `path`, or "plain local file" while it is unknown / for another path */
export function uniworkStateFor(
  state: UniworkDocState,
  path: string | null | undefined,
): { bound: boolean; readOnly: boolean } {
  if (!path || state.path !== path) return { bound: false, readOnly: false }
  return { bound: state.bound, readOnly: state.readOnly }
}

/**
 * Whether a renderer save request may run. Autosave never runs on a bound
 * document; an in-place Save never runs on a view-only one (Save As to
 * another path stays allowed and produces a plain local copy). Saves of a
 * pathless document are never gated: it cannot be a UniWork document.
 */
export function uniworkAllowsSave(
  state: { bound: boolean; readOnly: boolean },
  saveAs: boolean,
  auto: boolean,
): boolean {
  if (saveAs) return true
  if (state.readOnly) return false
  if (auto && state.bound) return false
  return true
}

/** Query main for the document at `path`; re-queried whenever the path changes. */
export function useUniworkDocState(path: string | null | undefined): UniworkDocState {
  const [state, setState] = useState<UniworkDocState>(NO_UNIWORK_STATE)
  useEffect(() => {
    if (!path) {
      setState(NO_UNIWORK_STATE)
      return
    }
    let live = true
    const query = window.desktop.uniworkState?.(path)
    if (!query) return
    query.then(
      (answer) => {
        if (!live) return
        setState({ path, bound: answer?.bound === true, readOnly: answer?.readOnly === true })
      },
      () => {
        /* no answer: keep treating it as a plain local file */
      },
    )
    return () => {
      live = false
    }
  }, [path])
  return state
}
