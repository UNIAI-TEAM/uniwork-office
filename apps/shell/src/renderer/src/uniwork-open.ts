import type { HomeApi, RecentEntry, UniworkLaunchEvent } from '../../shared/home-api'
import { publishUniworkNotice } from './uniwork-notice-bus'

type OpenApi = Pick<HomeApi, 'openPath' | 'uniworkOpenDocument'>

/**
 * Open a recents row. A UniWork document goes through UniWork (so the binding,
 * the permission check and a fresh download when needed all apply) and never
 * through its working-copy path; any other row opens as a local file does.
 * Progress and failures land in the tab strip's notice.
 */
export async function openRecentEntry(
  entry: RecentEntry,
  api: OpenApi,
  notify: (event: UniworkLaunchEvent) => void = publishUniworkNotice,
): Promise<void> {
  const source = entry.uniwork
  if (!source) {
    await api.openPath(entry.path)
    return
  }
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
