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

// Plain JSON-like data only (rects, text, ids): Map / Set / Date compare by own keys, so two instances look equal.
const sameContent = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        sameContent((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  )
}

/**
 * Pending items minus the ones the last save already wrote: same id AND same content.
 * A save queued behind another one is drained from state that can still list the edits
 * that save wrote, and sending them again commits them a second time. Same id with
 * changed content is a new edit of that block, made while the write was in flight, and
 * stays. Returns `pending` itself when nothing is dropped.
 */
export function dropWrittenPending<T extends { id: string }>(
  pending: T[],
  written: readonly T[],
): T[] {
  if (written.length === 0) return pending
  const byId = new Map(written.map((w) => [w.id, w]))
  const kept = pending.filter((p) => {
    const w = byId.get(p.id)
    return !(w !== undefined && sameContent(p, w))
  })
  return kept.length === pending.length ? pending : kept
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
