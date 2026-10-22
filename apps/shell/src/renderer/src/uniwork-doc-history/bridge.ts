/**
 * UNI-2077: the renderer's view of the version history / access log bridge.
 *
 * The shapes are the shared IPC types (`shared/doc-history-api.ts`) and the
 * object is the one the preload exposes as `window.uniworkDocHistory`. An older
 * main without the bridge leaves it absent and both menu entries stay hidden.
 */
import type { UniworkDocHistoryApi } from '../../../shared/doc-history-api'

export type {
  DocAccessLog,
  DocAccessLogAction,
  DocAccessLogPage,
  DocHistoryErrorCode,
  DocHistoryResult,
  DocRestoreResult,
  DocVersion,
  DocVersionPage,
  UniworkDocHistoryApi,
} from '../../../shared/doc-history-api'

declare global {
  interface Window {
    uniworkDocHistory?: UniworkDocHistoryApi
  }
}

/** The bridge, or null when this main does not have it (the entries are then hidden) */
export function getDocHistoryBridge(): UniworkDocHistoryApi | null {
  if (typeof window === 'undefined') return null
  const bridge = window.uniworkDocHistory
  return bridge && typeof bridge.versions === 'function' ? bridge : null
}
