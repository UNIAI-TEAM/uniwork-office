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

export interface PdfReadOnlySaveSeam {
  uniworkReadOnlySave?(path?: string): Promise<void>
}

/**
 * Explicit Save of a read-only bound PDF: asks main to explain the lock and
 * returns true when the save must stop before writing. Autosave, internal
 * flushes and local read-only files return false.
 */
export function pdfExplainReadOnlySave(
  api: PdfReadOnlySaveSeam | null | undefined,
  input: {
    origin: SaveOrigin
    bound: boolean
    readOnly: boolean
    filePath: string | null | undefined
  },
): boolean {
  if (input.origin !== 'user' || !input.bound || !input.readOnly || !input.filePath) return false
  void api?.uniworkReadOnlySave?.(input.filePath)?.catch(() => {})
  return true
}
