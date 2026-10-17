import { useEffect, useState } from 'react'
import type { OfflineLibrarySnapshot } from '../../shared/offline-library'
import type { UniworkSyncCenterApi } from '../../shared/sync-center'

/**
 * G5-05u: the offline library block of the Sync Center snapshot, for the
 * document menus (pin / unpin labels) and the Open card. Null until main
 * answers, or when there is no sync center (an older main): the callers then
 * offer nothing.
 */
export function useOfflineLibrary(
  api:
    Pick<UniworkSyncCenterApi, 'getSnapshot' | 'subscribe'> | undefined = window.uniworkSyncCenter,
): OfflineLibrarySnapshot | null {
  const [offline, setOffline] = useState<OfflineLibrarySnapshot | null>(null)
  useEffect(() => {
    if (!api) return
    let alive = true
    void api.getSnapshot().then(
      (snap) => alive && setOffline(snap?.offline ?? null),
      () => undefined,
    )
    const off = api.subscribe((snap) => {
      if (alive) setOffline(snap?.offline ?? null)
    })
    return () => {
      alive = false
      off()
    }
  }, [api])
  return offline
}
