import type { AiTrack } from './protocol'
import type { AiDocProtection } from './docs-skill'

/** whether the AI's edits are recorded as tracked revisions: the panel toggle, or tracked-changes protection */
export function aiTracksChanges(toggle: boolean, _protection: AiDocProtection): boolean {
  return toggle
}

/** the track option the AI tools receive (undefined = untracked edit) */
export function aiTrackFor(
  toggle: boolean,
  protection: AiDocProtection,
  author: string,
): AiTrack | undefined {
  return aiTracksChanges(toggle, protection) ? { author } : undefined
}
