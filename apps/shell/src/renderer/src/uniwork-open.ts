import type { HomeApi, RecentEntry, UniworkLaunchEvent } from '../../shared/home-api'
import { publishUniworkNotice } from './uniwork-notice-bus'

type OpenApi = Pick<HomeApi, 'openPath' | 'uniworkOpenDocument'>

/**
 * Open a UniWork document through UniWork (so the binding, the permission
 * check and a fresh download when needed all apply). Progress and failures
 * land in the tab strip's notice.
 */
export async function openUniworkDocument(
  source: { documentId: string; title: string },
  api: Pick<HomeApi, 'uniworkOpenDocument'>,
  notify: (event: UniworkLaunchEvent) => void = publishUniworkNotice,
): Promise<void> {
  notify({ phase: 'opening', title: source.title })
  try {
    const result = await api.uniworkOpenDocument(source.documentId)
    notify(
      result.ok
        ? { phase: 'opened', path: result.value.path, title: source.title }
        : { phase: 'failed', error: result.error },
    )
  } catch {
    notify({ phase: 'failed', error: 'network' })
  }
}

/**
 * Open a recents row. A UniWork document goes through UniWork and never
 * through its working-copy path; any other row opens as a local file does.
 */
export async function openRecentEntry(
  entry: RecentEntry,
  api: OpenApi,
  notify: (event: UniworkLaunchEvent) => void = publishUniworkNotice,
): Promise<void> {
  if (!entry.uniwork) {
    await api.openPath(entry.path)
    return
  }
  await openUniworkDocument(entry.uniwork, api, notify)
}
