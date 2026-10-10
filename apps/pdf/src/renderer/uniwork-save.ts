import type { SavePdfRequest } from '../shared/ipc'

/** Who asked for a save; main fires the UniWork user-save hook only for 'user' */
export type SaveOrigin = NonNullable<SavePdfRequest['origin']>

/**
 * Whether a save writes even though nothing is pending. Only an explicit Save of a
 * bound, editable document does (so Retry after a failed upload reaches UniWork),
 * and not one that was queued behind a user Save that has just written: it would
 * rewrite the same bytes and report a second user save for one click.
 */
export function forcesBoundSave(input: {
  origin: SaveOrigin
  bound: boolean
  readOnly: boolean
  pendingRedactions: number
  afterUserSave: boolean
}): boolean {
  return (
    input.origin === 'user' &&
    input.bound &&
    !input.readOnly &&
    input.pendingRedactions === 0 &&
    !input.afterUserSave
  )
}

/** One explicit request makes the whole drained batch explicit (autosave opt-in) */
export function drainedOrigin(queued: readonly SaveOrigin[]): SaveOrigin {
  return queued.some((o) => o === 'user')
    ? 'user'
    : queued.every((o) => o === 'auto')
      ? 'auto'
      : 'internal'
}
