import { compileOps } from './ops'
import { applyPatches } from './patch'
import type { ParseMap } from './parse-map'

/**
 * The source text with live style edits that are not committed yet applied (UNI-1232 A6).
 *
 * A style poke from the inspector or the style panel shows in the preview at once but reaches the
 * source on a short timer. A draft checkpoint taken inside that window would miss it, and a reload
 * would restore a page without the user's last change. This is the text the same `set_style` commit
 * would produce, computed without committing: no state, history or preview changes. A batch that
 * does not compile (the element is gone) leaves the committed text.
 */
export function textWithPendingStyles(
  text: string,
  map: ParseMap,
  sid: number | null,
  styles: Record<string, string | null>,
): string {
  if (sid === null || Object.keys(styles).length === 0) return text
  const compiled = compileOps(text, map, [{ op: 'set_style', sid, styles }])
  return compiled.errors.length > 0 ? text : applyPatches(text, compiled.patches)
}
