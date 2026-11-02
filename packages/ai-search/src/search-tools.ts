/**
 * ai:web-search / ai:image-search for the editors' main processes: the UniWork
 * cloud tools only. A failure (signed out, no plan, switch off, server error)
 * comes back as `method: 'error'` with the sentence the model should read, so
 * the IPC catch-all never adds an error-class prefix to it.
 */

import { refreshUniworkCloudStatusIfNotReady } from '@genoffice/ai-provider'
import { gskImageSearch, gskWebSearch } from './gsk'
import {
  cloudToolsSwitchedOff,
  MEDIA_NOT_CONFIGURED_ERROR,
  readAiSettingsFile,
} from './media-tools'
import type { ImageSearchResult, WebSearchResult } from './shared'

export async function webSearchTool(
  settingsPath: string,
  query: string,
  maxResults = 6,
): Promise<{ results: WebSearchResult[]; answer?: string; method: string; error?: string }> {
  if (cloudToolsSwitchedOff(readAiSettingsFile(settingsPath))) {
    return { results: [], method: 'error', error: MEDIA_NOT_CONFIGURED_ERROR }
  }
  try {
    // the snapshot may predate a plan change: re-read before the cloud is refused
    await refreshUniworkCloudStatusIfNotReady()
    return { ...(await gskWebSearch(query, maxResults)), method: 'gsk' }
  } catch (err) {
    return { results: [], method: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

export async function imageSearchTool(
  settingsPath: string,
  query: string,
  maxResults = 8,
): Promise<{ images: ImageSearchResult[]; method: string; error?: string }> {
  if (cloudToolsSwitchedOff(readAiSettingsFile(settingsPath))) {
    return { images: [], method: 'error', error: MEDIA_NOT_CONFIGURED_ERROR }
  }
  try {
    await refreshUniworkCloudStatusIfNotReady()
    return { images: await gskImageSearch(query, maxResults), method: 'gsk' }
  } catch (err) {
    return { images: [], method: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}
