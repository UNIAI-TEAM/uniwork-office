import { useCallback, useEffect, useRef, useState } from 'react'
import { pathKey } from '../../shared/path-key'
import type { SourceViewState } from '../../shared/source-view'
import type { TabSummary } from '../../shared/tabs-api'
import { sourceViewStateOf } from './uniwork-library-api'

export interface SourceViewStates {
  /** the chip's facts for a tab's path; null for any path that is not a view-only source */
  stateOf(path: string | undefined): SourceViewState | null
}

/**
 * UNI-1993: which of the open tabs hold a view-only source file. The shell registers the path
 * before the tab exists, so one read when a path first shows up in the strip is enough; a path
 * that leaves the strip is forgotten (a later tab on the same path asks again), and a path the
 * shell answers null for has no chip. A read that fails is a null.
 */
export function useSourceViewStates(tabs: TabSummary[]): SourceViewStates {
  const [byPath, setByPath] = useState<ReadonlyMap<string, SourceViewState | null>>(new Map())
  const seen = useRef(new Set<string>())

  const paths = tabs.flatMap((tab) => (tab.filePath ? [tab.filePath] : []))
  const pathsKey = paths.map(pathKey).join('\n')

  useEffect(() => {
    const wanted = new Set(pathsKey ? pathsKey.split('\n') : [])
    for (const key of [...seen.current]) if (!wanted.has(key)) seen.current.delete(key)
    setByPath((prev) => {
      if (![...prev.keys()].some((key) => !wanted.has(key))) return prev
      return new Map([...prev].filter(([key]) => wanted.has(key)))
    })
    for (const path of paths) {
      const key = pathKey(path)
      if (seen.current.has(key)) continue
      seen.current.add(key)
      void sourceViewStateOf(path).then((state) => {
        // the tab went away while the shell answered: nothing to keep
        if (!seen.current.has(key)) return
        setByPath((prev) => new Map(prev).set(key, state))
      })
    }
    // the paths are compared through their key
  }, [pathsKey])

  const stateOf = useCallback(
    (path: string | undefined) => (path ? (byPath.get(pathKey(path)) ?? null) : null),
    [byPath],
  )
  return { stateOf }
}
