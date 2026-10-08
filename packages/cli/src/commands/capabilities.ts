import {
  activeMediaProvider,
  activeSearchProvider,
  imageGenerationAvailable,
  mediaAnalysisAvailable,
} from '@genoffice/ai-provider'
import { hasGskAuth, readAiSettingsFile } from '@genoffice/ai-search'
import { aiSettingsPath, prepareCloud } from '../cloud'
import type { CommandDef } from '../registry'
import { appLaunch } from '../resources'

/**
 * What the cloud commands can do on this machine, decided from UniWork Office's
 * own settings without a network call: a BYOK key, or explicitly selected free
 * Parallel search. The UniWork cloud is off, and unkeyed fallbacks in the default
 * `auto` chain (free Parallel MCP, DuckDuckGo) do not count as configured. Agents
 * check this once before planning work that needs photos or web facts.
 */
export const capabilitiesCommand: CommandDef = {
  name: 'capabilities',
  summary:
    'Report which cloud features (search, image search, image generation, media analysis) are configured in UniWork Office, and whether the app is installed.',
  usage: 'capabilities',
  async run(_args, ctx) {
    await prepareCloud(ctx.env)
    const settings = readAiSettingsFile(aiSettingsPath(ctx.env))
    const searchProvider = activeSearchProvider(settings)
    const search = searchProvider !== 'auto'
    const imageSearch = searchProvider === 'serper' || searchProvider === 'serply'
    const imageGeneration = imageGenerationAvailable(settings, hasGskAuth())
    const mediaAnalysis = mediaAnalysisAvailable(settings, hasGskAuth())
    // only BYOK providers are reported; the UniWork cloud route is off
    const via = (provider: string) => (provider === 'genspark' ? null : provider)
    const detail = {
      search: {
        available: search,
        via: search ? searchProvider : null,
      },
      image_search: {
        available: imageSearch,
        via: imageSearch ? searchProvider : null,
      },
      image_generation: {
        available: imageGeneration,
        via: imageGeneration ? via(activeMediaProvider(settings, 'image')) : null,
      },
      media_analysis: {
        available: mediaAnalysis,
        via: mediaAnalysis ? via(activeMediaProvider(settings, 'analysis')) : null,
      },
      app: { available: appLaunch(ctx.env) !== null },
      settings_path: aiSettingsPath(ctx.env),
    }
    const on = Object.entries(detail)
      .filter(([k, v]) => k !== 'settings_path' && (v as { available: boolean }).available)
      .map(([k]) => k)
    return {
      summary: on.length
        ? `configured: ${on.join(', ')}`
        : 'no cloud feature configured; the app is not installed',
      detail,
    }
  },
}
