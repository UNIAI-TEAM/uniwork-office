import { useCallback, useState } from 'react'
import type { DocListScreen } from './columns'
import type { GroupId } from './groups'
import { readCollapsedGroups, writeCollapsedGroups } from './persist'

/**
 * The collapsed groups of a screen, remembered per account and screen. A
 * screen change reads that screen's own set. The state lives here too, so a
 * store that cannot be written still collapses and expands for the session.
 */
export function useCollapsedGroups(
  screen: DocListScreen,
): readonly [ReadonlySet<GroupId>, (id: GroupId) => void] {
  const [stored, setStored] = useState<{ screen: DocListScreen; ids: readonly GroupId[] }>(() => ({
    screen,
    ids: readCollapsedGroups(screen),
  }))
  let current = stored
  if (stored.screen !== screen) {
    current = { screen, ids: readCollapsedGroups(screen) }
    setStored(current)
  }
  const toggle = useCallback(
    (id: GroupId) => {
      const open = current.ids.includes(id)
      const ids = open ? current.ids.filter((g) => g !== id) : [...current.ids, id]
      writeCollapsedGroups(screen, ids)
      setStored({ screen, ids })
    },
    [screen, current.ids],
  )
  return [new Set(current.ids), toggle] as const
}
