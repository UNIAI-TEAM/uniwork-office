import { useCallback, useEffect, useRef, useState } from 'react'
import { loadDocProperties } from '../uniwork-library-api'
import { folderLevelOf, type FolderLevel } from './uniwork-folders-model'

/**
 * UNI-2080: the level I have on a tree folder. The tree answer carries none, so (as the web's
 * tree row menu reads the folder's detail) it is asked from the folder's properties when its
 * menu opens. A failed read leaves the level unknown, which reads as view. Levels belong to one
 * workspace.
 */
export function useFolderLevels(workspaceId: string): {
  levelOf: (id: string) => FolderLevel | undefined
  /** read the folder's level now (a menu opened); the last known level stays until it answers */
  load: (id: string) => void
} {
  const [levels, setLevels] = useState<{
    workspaceId: string
    byId: ReadonlyMap<string, FolderLevel>
  }>(() => ({ workspaceId, byId: new Map() }))
  const inflight = useRef(new Set<string>())
  const workspaceRef = useRef(workspaceId)
  workspaceRef.current = workspaceId

  useEffect(() => {
    inflight.current = new Set()
  }, [workspaceId])

  const load = useCallback((id: string) => {
    if (inflight.current.has(id)) return
    const asked = workspaceRef.current
    inflight.current.add(id)
    void Promise.resolve()
      .then(() => loadDocProperties(id))
      .then((res) => {
        inflight.current.delete(id)
        if (workspaceRef.current !== asked || !res.ok) return
        const level = folderLevelOf(res.value.myLevel)
        setLevels((prev) => {
          const byId = new Map(prev.workspaceId === asked ? prev.byId : [])
          if (level) byId.set(id, level)
          else byId.delete(id)
          return { workspaceId: asked, byId }
        })
      })
      .catch(() => {
        inflight.current.delete(id)
      })
  }, [])

  const levelOf = useCallback(
    (id: string) => (levels.workspaceId === workspaceId ? levels.byId.get(id) : undefined),
    [levels, workspaceId],
  )
  return { levelOf, load }
}
