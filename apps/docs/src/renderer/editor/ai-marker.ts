import type { Node as PmNode } from '@tiptap/pm/model'

/** per document: any block carries the AI marker (a PM doc is immutable, so the answer never changes) */
const markedMemo = new WeakMap<PmNode, boolean>()

/** some node of the document still carries the AI change marker (memoised per document) */
export function docHasAiMarks(doc: PmNode): boolean {
  const known = markedMemo.get(doc)
  if (known !== undefined) return known
  let found = false
  doc.descendants((node) => {
    if (found) return false
    if (node.attrs?.aiChanged) found = true
    return !found
  })
  markedMemo.set(doc, found)
  return found
}

/** the document as JSON with the marker normalised away (the marker is not file content) */
function unmarkedJson(node: PmNode): unknown {
  const walk = (n: Record<string, unknown>): Record<string, unknown> => {
    const attrs = n.attrs as Record<string, unknown> | undefined
    return {
      ...n,
      ...(attrs && 'aiChanged' in attrs ? { attrs: { ...attrs, aiChanged: false } } : {}),
      ...(Array.isArray(n.content)
        ? { content: (n.content as Record<string, unknown>[]).map(walk) }
        : {}),
    }
  }
  return walk(node.toJSON() as Record<string, unknown>)
}

/**
 * Document equality that ignores the AI marker. A save compares the live doc with the one
 * reloaded from the written bytes (which never carry the marker); a marked doc must still count
 * as unchanged there, or the save would rewrite it, wipe the marker and reset undo history.
 */
export function sameDocIgnoringAiMarks(a: PmNode, b: PmNode): boolean {
  if (a.eq(b)) return true
  if (!docHasAiMarks(a) && !docHasAiMarks(b)) return false
  return JSON.stringify(unmarkedJson(a)) === JSON.stringify(unmarkedJson(b))
}
