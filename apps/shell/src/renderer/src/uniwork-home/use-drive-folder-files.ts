import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DriveFile,
  DriveFileListPage,
  UniworkDriveErrorCode,
  UniworkDriveResult,
} from '../../../shared/home-api'

/**
 * The files of one Drive folder (or of the files with no known folder) of an account, read from the
 * server's folder filter (`drive_folder_id`, UNI-2223 follow-up): one cursor-paged list with the same
 * load-more behavior as the flat list, no walk of the account's pages.
 *
 * The server confirms a filtered answer by echoing the filter. A first page that comes back without
 * that echo (or with another one) is an old server that ignored the param and sent the whole account:
 * the account is then reported in `unsupportedAccountIds` and the host keeps the page walk
 * (`use-drive-account-files`) for it. That is the only remaining user of the walk.
 */

/** the `drive_folder_id` value of the files that have no known parent */
export const NO_FOLDER_FILTER = 'none'

export type DriveFetchFolderPage = (
  connectionId: string,
  driveFolderId: string,
  cursor?: string,
) => Promise<UniworkDriveResult<DriveFileListPage>>

export interface DriveFolderFiles {
  status: 'loading' | 'ready' | 'error'
  files: readonly DriveFile[]
  nextCursor: string | null
  loadingMore: boolean
  /** the first page failed */
  error?: UniworkDriveErrorCode
  /** a refresh or a next page failed; the files already read stay */
  moreError?: UniworkDriveErrorCode
}

export interface DriveFolderFilesTarget {
  accountId: string
  /** a Drive folder id, or `NO_FOLDER_FILTER` */
  filter: string
}

type Held = DriveFolderFiles & { key: string }

const EMPTY: Held = { key: '', status: 'loading', files: [], nextCursor: null, loadingMore: false }

const NETWORK_FAILURE = { ok: false, error: 'network' } as const

export function useDriveFolderFiles({
  workspaceId,
  enabled,
  target,
  refreshKey,
  fetchPage,
}: {
  workspaceId: string
  /** false while the Drive view is closed or the device is offline: nothing is fetched */
  enabled: boolean
  /** what to read; null = nothing is needed now (an account known to be unsupported is skipped too) */
  target: DriveFolderFilesTarget | null
  /** a new value reloads the target (list refresh, focus, Retry) */
  refreshKey: string
  fetchPage: DriveFetchFolderPage
}): {
  /** the target's files; null until its first request is made, and for an unsupported account */
  files: DriveFolderFiles | null
  loadMore: () => void
  /** accounts whose server did not filter: the host reads their folders by walking the pages */
  unsupportedAccountIds: ReadonlySet<string>
} {
  const [held, setHeld] = useState<Held>(EMPTY)
  const [unsupportedAccountIds, setUnsupported] = useState<ReadonlySet<string>>(new Set())
  const seqRef = useRef(0)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage

  const prevWsRef = useRef(workspaceId)
  if (prevWsRef.current !== workspaceId) {
    prevWsRef.current = workspaceId
    seqRef.current += 1
    setHeld(EMPTY)
    setUnsupported(new Set())
  }

  // an account found unsupported is read by the walk from then on: nothing more is asked of it here
  const live = target && !unsupportedAccountIds.has(target.accountId) ? target : null
  const accountId = live?.accountId
  const filter = live?.filter
  const key = live ? `${live.accountId}\u0000${live.filter}` : null

  useEffect(() => {
    if (!enabled || !key || !accountId || !filter) return
    const seq = ++seqRef.current
    // a reload of the same target keeps the files it has; another target starts empty
    setHeld((prev) =>
      prev.key === key && prev.files.length > 0
        ? { ...prev, loadingMore: false, moreError: undefined }
        : { ...EMPTY, key },
    )
    void fetchRef
      .current(accountId, filter)
      .catch(() => NETWORK_FAILURE)
      .then((res) => {
        if (seqRef.current !== seq) return
        if (!res.ok) {
          setHeld((prev) =>
            prev.key === key && prev.files.length > 0
              ? { ...prev, loadingMore: false, moreError: res.error }
              : { ...EMPTY, key, status: 'error', error: res.error },
          )
          return
        }
        if (res.value.driveFolderId !== filter) {
          setUnsupported((prev) => new Set(prev).add(accountId))
          return
        }
        setHeld({
          key,
          status: 'ready',
          files: res.value.files,
          nextCursor: res.value.nextCursor,
          loadingMore: false,
        })
      })
  }, [workspaceId, enabled, key, accountId, filter, refreshKey])

  const loadMore = useCallback(() => {
    const cursor = held.nextCursor
    if (!key || !accountId || !filter || held.key !== key) return
    if (!cursor || held.loadingMore || held.status !== 'ready') return
    const seq = seqRef.current
    setHeld((prev) => ({ ...prev, loadingMore: true, moreError: undefined }))
    void fetchRef
      .current(accountId, filter, cursor)
      .catch(() => NETWORK_FAILURE)
      .then((res) => {
        if (seqRef.current !== seq) return
        setHeld((prev) => {
          if (prev.key !== key) return prev
          return res.ok
            ? {
                ...prev,
                files: [...prev.files, ...res.value.files],
                nextCursor: res.value.nextCursor,
                loadingMore: false,
              }
            : { ...prev, loadingMore: false, moreError: res.error }
        })
      })
  }, [held, key, accountId, filter])

  return {
    files: key !== null && held.key === key ? held : null,
    loadMore,
    unsupportedAccountIds,
  }
}
