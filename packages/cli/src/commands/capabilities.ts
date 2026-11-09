import type { CommandDef } from '../registry'
import { appLaunch } from '../resources'

/**
 * Whether the UniWork Office app is installed (the one thing the CLI cannot do
 * without it is open a document in the GUI). Everything else the CLI does runs
 * locally; it has no cloud features. Agents check this once before planning
 * work that needs the app open.
 */
export const capabilitiesCommand: CommandDef = {
  name: 'capabilities',
  summary: 'Report whether the UniWork Office app is installed.',
  usage: 'capabilities',
  async run(_args, ctx) {
<<<<<<< ours
    const available = appLaunch(ctx.env) !== null
=======
    await prepareCloud(ctx.env)
    const settings = readAiSettingsFile(aiSettingsPath(ctx.env))
    const gsk = hasGskAuth() && cloudToolsEnabled(settings)
    const searchProvider = activeSearchProvider(settings)
    const gskSearch = gsk && searchProvider === 'genspark'
    const customSearch = searchProvider !== 'genspark'
    const search = gskSearch || customSearch
    const keyedImageSearch =
      searchProvider === 'serper' || searchProvider === 'serply' || searchProvider === 'searchapi'
    const imageSearch = gskSearch || keyedImageSearch
    const imageGeneration = imageGenerationAvailable(settings, hasGskAuth())
    const mediaAnalysis = mediaAnalysisAvailable(settings, hasGskAuth())
    const via = (byok: string | null | undefined) => (byok ? byok : gsk ? 'genspark' : null)
    const detail = {
      search: {
        available: search,
        via: customSearch ? searchProvider : gskSearch ? 'genspark' : null,
      },
      image_search: {
        available: imageSearch,
        via: keyedImageSearch ? searchProvider : gskSearch ? 'genspark' : null,
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
>>>>>>> theirs
    return {
      summary: available ? 'the app is installed' : 'the app is not installed',
      detail: { app: { available } },
    }
  },
}
