/**
 * ai:web-search / ai:image-search for the editors' main processes: reads
 * ai-settings.json live and turns the search provider choice into
 * SearchOptions — `auto` tries the UniWork cloud first while it is on (signed
 * in, entitled, cloud tools not switched off), then the keyless chain (env
 * keys, then free Parallel MCP, then DuckDuckGo); a selected custom provider
 * runs first and never spends UniWork credits.
 */

import {
  activeSearchProvider,
  aiTestFailure,
  aiTestFailureKindForText,
  cloudToolsEnabled,
  refreshUniworkCloudStatusIfNotReady,
  type AiSearchProviderId,
  type AiSettings,
  type AiTestResult,
} from '@genoffice/ai-provider'
import { imageSearch, webSearch, type SearchOptions } from './index'
import { readAiSettingsFile } from './media-tools'

export function searchOptionsFromSettings(settings: AiSettings): SearchOptions {
  const provider = activeSearchProvider(settings)
  if (provider === 'auto') return { useGsk: cloudToolsEnabled(settings) }
  const key = settings.search!.providers?.[provider]?.apiKey?.trim() ?? ''
  if (provider === 'parallel') return { useGsk: false, parallelKey: key, prefer: 'parallel' }
  if (provider === 'serply') return { useGsk: false, serplyKey: key, prefer: 'serply' }
  if (provider === 'exa') return { useGsk: false, exaKey: key, prefer: 'exa' }
  if (provider === 'firecrawl') return { useGsk: false, firecrawlKey: key, prefer: 'firecrawl' }
  return provider === 'tavily'
    ? { useGsk: false, tavilyKey: key, prefer: 'tavily' }
    : { useGsk: false, serperKey: key }
}

export async function webSearchTool(settingsPath: string, query: string, maxResults = 6) {
  // the snapshot may predate a plan change: Auto search re-reads before it settles for the free chain
  await refreshUniworkCloudStatusIfNotReady()
  return webSearch(query, maxResults, searchOptionsFromSettings(readAiSettingsFile(settingsPath)))
}

export async function imageSearchTool(settingsPath: string, query: string, maxResults = 8) {
  await refreshUniworkCloudStatusIfNotReady()
  return imageSearch(query, maxResults, searchOptionsFromSettings(readAiSettingsFile(settingsPath)))
}

/**
 * settings-UI test: the selected backend (keyed or free) must answer one minimal query.
 * `error` is the log detail; `errorKind` is what the settings UI shows.
 */
export async function testSearchProvider(
  provider: AiSearchProviderId,
  apiKey: string,
): Promise<AiTestResult> {
  if (provider === 'auto') return { ok: true }
  apiKey = apiKey.trim()
  if (!apiKey && provider !== 'parallel') return aiTestFailure('invalid_key', 'API key is empty')
  const options: SearchOptions = {
    useGsk: false,
    serperKey: provider === 'serper' ? apiKey : '',
    serplyKey: provider === 'serply' ? apiKey : '',
    tavilyKey: provider === 'tavily' ? apiKey : '',
    parallelKey: provider === 'parallel' ? apiKey : '',
    exaKey: provider === 'exa' ? apiKey : '',
    firecrawlKey: provider === 'firecrawl' ? apiKey : '',
    prefer: provider,
  }
  const r = await webSearch('UniWork Office', 1, options)
  if (r.method === provider) return { ok: true }
  if (r.method === 'error') {
    const detail = r.error ?? 'search failed'
    return aiTestFailure(aiTestFailureKindForText(detail), detail)
  }
  return aiTestFailure(
    'unavailable',
    `${provider} did not answer (service unavailable, key rejected or quota exhausted); fell back to ${r.method}`,
  )
}
