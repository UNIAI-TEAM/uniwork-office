import { useEffect, useRef, useState } from 'react'
import type { DriveFolderSummary, UniworkDriveResult } from '../../../shared/home-api'

/**
 * The server folder list of each Drive account the sidebar shows (UNI-2223 v3): one request per
 * account, no page walk. `ready` carries the list; `fallback` means this server has none (404, the
 * list missing, or the request failed) and the host derives the folders from the account's files
 * instead (`use-drive-account-files`). A refresh that fails keeps the last good list.
 */

export interface DriveFolderListEntry {
  status: 'loading' | 'ready' | 'fallback'
  folders: readonly DriveFolderSummary[]
}

export type DriveFetchFolders = (
  connectionId: string,
) => Promise<UniworkDriveResult<DriveFolderSummary[] | null>>

export function useDriveFolderLists({
  workspaceId,
  enabled,
  accountIds,
  refreshKey,
  fetchFolders,
}: {
  workspaceId: string
  /** false while the Drive view is closed or the device is offline: nothing is fetched */
  enabled: boolean
  /** the accounts to list: the expanded ones and the selected one */
  accountIds: readonly string[]
  /** a new value reloads every account (list refresh, focus, Retry) */
  refreshKey: string
  fetchFolders: DriveFetchFolders
}): Readonly<Record<string, DriveFolderListEntry>> {
  const [byAccount, setByAccount] = useState<Record<string, DriveFolderListEntry>>({})
  // the account -> `workspace:refreshKey` it was last requested for, so an expand does not refetch the rest
  const requestedRef = useRef(new Map<string, string>())
  const seqRef = useRef(0)
  const fetchRef = useRef(fetchFolders)
  fetchRef.current = fetchFolders

  const prevWsRef = useRef(workspaceId)
  if (prevWsRef.current !== workspaceId) {
    prevWsRef.current = workspaceId
    requestedRef.current = new Map()
    seqRef.current += 1
    setByAccount({})
  }

  const idsKey = accountIds.join('\u0000')
  useEffect(() => {
    if (!enabled) return
    const stamp = `${workspaceId}:${refreshKey}`
    const wanted = idsKey ? idsKey.split('\u0000') : []
    const todo = wanted.filter((id) => requestedRef.current.get(id) !== stamp)
    if (todo.length === 0) return
    const seq = seqRef.current
    for (const id of todo) {
      requestedRef.current.set(id, stamp)
      setByAccount((prev) =>
        prev[id] ? prev : { ...prev, [id]: { status: 'loading', folders: [] } },
      )
      void fetchRef
        .current(id)
        .catch((): UniworkDriveResult<DriveFolderSummary[] | null> => ({
          ok: false,
          error: 'network',
        }))
        .then((res) => {
          if (seqRef.current !== seq || requestedRef.current.get(id) !== stamp) return
          setByAccount((prev) => {
            if (res.ok && res.value)
              return { ...prev, [id]: { status: 'ready', folders: res.value } }
            const last = prev[id]
            // a refresh that fails keeps what the tree already shows; a first read that fails falls back
            return last?.status === 'ready'
              ? prev
              : { ...prev, [id]: { status: 'fallback', folders: [] } }
          })
        })
    }
  }, [workspaceId, enabled, idsKey, refreshKey])

  return byAccount
}
