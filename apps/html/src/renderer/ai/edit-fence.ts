import type { ParseMap } from '../document/parse-map'
import type { Patch } from '../document/patch'

/**
 * Edit fence of an element-scoped AI turn: a turn sent from "Ask AI" on the
 * selected element, or an edit-queue submission, may only change those
 * elements (by sid, which the parse map keeps stable across rebuilds). The
 * panel sets the fence at send; apply_ops compiles the batch first and
 * refuses it whole when a patch lands outside every fenced element, and the
 * whole-page writers are refused, so the source outside stays
 * byte-identical whatever the model sends. A patch exactly at an element's
 * edge (inserting a sibling right before or after it) counts as inside.
 */

export const FENCE_REFUSAL =
  'This turn edits only the selected element (or the queued elements); the change touched source outside the selected element, so nothing was applied. Address the fenced sid(s) only, or ask the user to clear the selection to edit the rest of the page.'

/** null when every patch stays within a fenced element; else the refusal message */
export function fenceViolation(
  map: ParseMap,
  patches: readonly Patch[],
  sids: readonly number[],
): string | null {
  const ranges = sids
    .map((sid) => map.bySid.get(sid)?.range)
    .filter((range): range is [number, number] => range !== undefined)
  const inside = (p: Patch) => ranges.some(([from, to]) => p.from >= from && p.to <= to)
  return patches.every(inside) ? null : FENCE_REFUSAL
}

/** the fence a send carries: an empty or missing sid list means no fence */
export function sendFence(sids: readonly number[] | null | undefined): readonly number[] | null {
  return sids && sids.length > 0 ? sids : null
}
