import { useEffect, useRef, useState } from 'react'
import type { DriveFile, DriveFileListPage, UniworkDriveResult } from '../../../shared/home-api'

/**
 * Every file of the Drive accounts whose folders the sidebar shows (UNI-2223 v2). The files list is
 * cursor-paginated, so the folders of an account (and what is in each) are only known once all its
 * pages are in: this hook walks them. It is the one place the folder tree gets its data from, so a
 * server folder list can replace it without touching the views.
 */

export interface DriveAccountFiles {
  status: 'loading' | 'ready' | 'error'
  files: readonly DriveFile[]
}

export type DriveFetchPage = (
  connectionId: string,
  cursor?: string,
) => Promise<UniworkDriveResult<DriveFileListPage>>

/** a runaway cursor chain must not spin forever; 40 pages is far past any real account */
export const MAX_ACCOUNT_PAGES = 40

/** all pages of one account, or null when a page fails (a partial folder tree would lie about counts) */
export async function fetchAllAccountFiles(
  fetchPage: DriveFetchPage,
  connectionId: string,
  isStale: () => boolean = () => false,
): Promise<DriveFile[] | null> {
  const files: DriveFile[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_ACCOUNT_PAGES; page += 1) {
    const res = await fetchPage(connectionId, cursor)
    if (isStale()) return null
    if (!res.ok) return null
    files.push(...res.value.files)
    if (!res.value.nextCursor) return files
    cursor = res.value.nextCursor
  }
  return files
}

export function useDriveAccountFiles({
  workspaceId,
  enabled,
  accountIds,
  refreshKey,
  fetchPage,
}: {
  workspaceId: string
  /** false while the Drive view is closed or the device is offline: nothing is fetched */
  enabled: boolean
  /** the accounts to load: the expanded ones and the selected one */
  accountIds: readonly string[]
  /** a new value reloads every account (list refresh, focus, Retry) */
  refreshKey: string
  fetchPage: DriveFetchPage
}): Readonly<Record<string, DriveAccountFiles>> {
  const [byAccount, setByAccount] = useState<Record<string, DriveAccountFiles>>({})
  // the account -> `workspace:refreshKey` it was last requested for, so an expand does not refetch the rest
  const requestedRef = useRef(new Map<string, string>())
  const seqRef = useRef(0)
  const fetchPageRef = useRef(fetchPage)
  fetchPageRef.current = fetchPage

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
      // a reload keeps the files it already has: the tree does not blink while the pages come in
      setByAccount((prev) =>
        prev[id] ? prev : { ...prev, [id]: { status: 'loading', files: [] } },
      )
      void fetchAllAccountFiles(
        (acct, cursor) => fetchPageRef.current(acct, cursor),
        id,
        () => seqRef.current !== seq || requestedRef.current.get(id) !== stamp,
      ).then((files) => {
        if (seqRef.current !== seq || requestedRef.current.get(id) !== stamp) return
        setByAccount((prev) => ({
          ...prev,
          [id]: files
            ? { status: 'ready', files }
            : { status: 'error', files: prev[id]?.files ?? [] },
        }))
      })
    }
  }, [workspaceId, enabled, idsKey, refreshKey])

  return byAccount
}
