// The selection of a Documents list is UI state: a set of document ids. These helpers
// turn it into the rows the bulk bar acts on and keep it from naming rows that left.
import type { DocumentsHomeDoc } from '../uniwork-home/documents-home-model'

/** the selected rows that are loaded, in list order (an id that left the list is ignored) */
export function selectedDocsOf(
  items: readonly DocumentsHomeDoc[],
  selected: ReadonlySet<string>,
): DocumentsHomeDoc[] {
  if (selected.size === 0) return []
  return items.filter((doc) => selected.has(doc.id))
}

/** the selection without the rows that left the loaded list; the same set when nothing left */
export function pruneSelection(
  selected: ReadonlySet<string>,
  items: readonly DocumentsHomeDoc[],
): ReadonlySet<string> {
  if (selected.size === 0) return selected
  const present = new Set(items.map((doc) => doc.id))
  const next = new Set([...selected].filter((id) => present.has(id)))
  return next.size === selected.size ? selected : next
}
