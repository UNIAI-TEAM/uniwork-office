import type { AiSettings } from './types'

/**
 * The media tools run on the UniWork cloud only: available while signed in to UniWork with the
 * plan's cloud AI (`gskLoggedIn`, which callers take from the shell main process: `ai:gsk-status`
 * / hasGskAuth(), since a renderer holds no cloud status of its own) and the cloud tools not
 * switched off.
 */
function cloudMediaAvailable(
  settings: Pick<AiSettings, 'gskToolsEnabled'> | null | undefined,
  gskLoggedIn: boolean,
): boolean {
  return gskLoggedIn && settings?.gskToolsEnabled !== false
}

/** live predicate for the generate_image tool */
export function imageGenerationAvailable(
  settings: Pick<AiSettings, 'gskToolsEnabled'> | null | undefined,
  gskLoggedIn: boolean,
): boolean {
  return cloudMediaAvailable(settings, gskLoggedIn)
}

/** live predicate for the analyze_media tool (images) */
export function mediaAnalysisAvailable(
  settings: Pick<AiSettings, 'gskToolsEnabled'> | null | undefined,
  gskLoggedIn: boolean,
): boolean {
  return cloudMediaAvailable(settings, gskLoggedIn)
}

/** live predicate for analyze_media with video or audio input */
export function videoAnalysisAvailable(
  settings: Pick<AiSettings, 'gskToolsEnabled'> | null | undefined,
  gskLoggedIn: boolean,
): boolean {
  return cloudMediaAvailable(settings, gskLoggedIn)
}
