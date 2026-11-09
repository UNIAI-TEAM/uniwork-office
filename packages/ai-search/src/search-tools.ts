/**
<<<<<<< ours
 * ai:web-search / ai:image-search for the editors' main processes: the UniWork
 * cloud tools only. A failure (signed out, no plan, switch off, server error)
 * comes back as `method: 'error'` with the sentence the model should read, so
 * the IPC catch-all never adds an error-class prefix to it.
=======
 * ai:web-search / ai:image-search for the editors' main processes: reads
 * ai-settings.json live and turns the search provider choice into
 * SearchOptions — Genspark keeps the historic chain (gsk when signed in and
 * cloud tools are on, then env keys, then free Parallel MCP, then DuckDuckGo); a
 * selected custom provider runs first and skips gsk. Keenable's free endpoint
 * only runs when Keenable is the selected provider.
>>>>>>> theirs
 */

import { refreshUniworkCloudStatusIfNotReady } from '@genoffice/ai-provider'
import { gskImageSearch, gskWebSearch } from './gsk'
import {
  cloudToolsSwitchedOff,
  MEDIA_NOT_CONFIGURED_ERROR,
  readAiSettingsFile,
} from './media-tools'
import type { ImageSearchResult, WebSearchResult } from './shared'

<<<<<<< ours
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
=======
export function searchOptionsFromSettings(settings: AiSettings): SearchOptions {
  const provider = activeSearchProvider(settings)
  if (provider === 'genspark') return { useGsk: cloudToolsEnabled(settings) }
  const key = settings.search!.providers?.[provider]?.apiKey?.trim() ?? ''
  if (provider === 'parallel') return { useGsk: false, parallelKey: key, prefer: 'parallel' }
  if (provider === 'serply') return { useGsk: false, serplyKey: key, prefer: 'serply' }
  if (provider === 'searchapi') return { useGsk: false, searchapiKey: key, prefer: 'searchapi' }
  if (provider === 'exa') return { useGsk: false, exaKey: key, prefer: 'exa' }
  if (provider === 'firecrawl') return { useGsk: false, firecrawlKey: key, prefer: 'firecrawl' }
  if (provider === 'keenable') return { useGsk: false, keenableKey: key, prefer: 'keenable' }
  return provider === 'tavily'
    ? { useGsk: false, tavilyKey: key, prefer: 'tavily' }
    : { useGsk: false, serperKey: key }
}

export function webSearchTool(settingsPath: string, query: string, maxResults = 6) {
  return webSearch(query, maxResults, searchOptionsFromSettings(readAiSettingsFile(settingsPath)))
}

export function imageSearchTool(settingsPath: string, query: string, maxResults = 8) {
  return imageSearch(query, maxResults, searchOptionsFromSettings(readAiSettingsFile(settingsPath)))
}

/** settings-UI test: the selected backend (keyed or free) must answer one minimal query. */
export async function testSearchProvider(
  provider: AiSearchProviderId,
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  if (provider === 'genspark') return { ok: true }
  apiKey = apiKey.trim()
  if (!apiKey && provider !== 'parallel' && provider !== 'keenable')
    return { ok: false, error: 'API key is empty' }
  const options: SearchOptions = {
    useGsk: false,
    serperKey: provider === 'serper' ? apiKey : '',
    serplyKey: provider === 'serply' ? apiKey : '',
    searchapiKey: provider === 'searchapi' ? apiKey : '',
    tavilyKey: provider === 'tavily' ? apiKey : '',
    parallelKey: provider === 'parallel' ? apiKey : '',
    exaKey: provider === 'exa' ? apiKey : '',
    firecrawlKey: provider === 'firecrawl' ? apiKey : '',
    keenableKey: provider === 'keenable' ? apiKey : '',
    prefer: provider,
>>>>>>> theirs
  }
  try {
    await refreshUniworkCloudStatusIfNotReady()
    return { images: await gskImageSearch(query, maxResults), method: 'gsk' }
  } catch (err) {
    return { images: [], method: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}
