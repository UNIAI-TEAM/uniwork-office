import { useCallback, useState } from 'react'
import type { DocListScreen, SortSpec } from './columns'
import { readSort, writeSort } from './persist'

/**
 * The sort a person chose on a screen, remembered per account and screen.
 * `null` until they sort (the screen default applies); a screen change reads
 * that screen's own choice. The setter stores it before the next render.
 */
export function useDocListSort(
  screen: DocListScreen,
): readonly [SortSpec | null, (next: SortSpec) => void] {
  const [stored, setStored] = useState<{ screen: DocListScreen; sort: SortSpec | null }>(() => ({
    screen,
    sort: readSort(screen),
  }))
  let current = stored
  if (stored.screen !== screen) {
    current = { screen, sort: readSort(screen) }
    setStored(current)
  }
  const set = useCallback(
    (next: SortSpec) => {
      writeSort(screen, next)
      setStored({ screen, sort: next })
    },
    [screen],
  )
  return [current.sort, set] as const
}
